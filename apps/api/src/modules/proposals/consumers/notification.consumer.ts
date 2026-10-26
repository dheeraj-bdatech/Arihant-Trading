import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../common/database/database.module.js';
import { OutboxService, type DomainEventEnvelope } from '../../../common/outbox/outbox.service.js';
import { EventsGateway } from '../../../common/realtime/events.gateway.js';
import type { Database } from '@arihant/shared';
import { formatINR } from '@arihant/shared';
import { proposalDisplayNo, managementApprovalThreshold } from '../proposals.workflow.js';

@Injectable()
export class ProposalNotificationConsumer {
  private readonly logger = new Logger(ProposalNotificationConsumer.name);
  private readonly handlerName = 'NotificationConsumer';

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @OnEvent('proposal.*')
  async handleProposalNotification(envelope: DomainEventEnvelope) {
    // Only outbox envelopes are processed; a raw payload on proposal.* (wildcard) must not crash or poison processed_events.
    if (!envelope?.eventId || !envelope?.eventType) return;
    const { eventId, eventType, aggregateId, payload, suppressNotifications } = envelope;

    // E67: Notifications suppressed during imports or silent syncs
    if (suppressNotifications) {
      this.logger.debug(`[${this.handlerName}] Notifications suppressed for event ${eventId}`);
      return;
    }

    // Idempotency check (E51)
    const isProcessed = await this.outboxService.isEventProcessed(eventId, this.handlerName);
    if (isProcessed) {
      return;
    }

    try {
      // DEF-105: notifications show the number every screen uses (PROP-2026-1076), never the internal PRP- id.
      const row = aggregateId
        ? await this.db
            .selectFrom('proposals')
            .select(['proposal_number', 'proposal_no'])
            .where('id', '=', aggregateId)
            .executeTakeFirst()
        : undefined;
      const no = proposalDisplayNo(row) || payload?.proposalNo || '';
      const recipientUserIds = new Set<string>();
      let title = '';
      let body = '';

      switch (eventType) {
        case 'proposal.assigned':
          if (payload?.newResponsibleId) recipientUserIds.add(payload.newResponsibleId);
          title = `Proposal Assigned to You: ${no}`;
          body = `You have been assigned responsibility for proposal ${no}.`;
          break;

        case 'proposal.requested':
          if (payload?.responsiblePersonId && payload.responsiblePersonId !== envelope.actorId) {
            recipientUserIds.add(payload.responsiblePersonId);
            title = `Proposal Assigned to You: ${no}`;
            body = `You have been assigned responsibility for proposal ${no}.`;
          }
          break;

        case 'proposal.submitted_for_review':
        case 'proposal.review_requested': {
          // Only the approver for the value band is asked: Management / Admin for major proposals (quoted value at or
          // above the threshold), the Regional Manager of the customer's region for the rest — Management only when
          // that region has no active RM.
          const info = aggregateId
            ? await this.db
                .selectFrom('proposals')
                .leftJoin('organisations', 'organisations.id', 'proposals.organisation_id')
                .select(['proposals.quoted_value', 'organisations.region_id'])
                .where('proposals.id', '=', aggregateId)
                .executeTakeFirst()
            : undefined;
          const settings = await this.db.selectFrom('proposal_settings').select('management_approval_threshold').executeTakeFirst();
          const threshold = managementApprovalThreshold(settings);
          const major = Number(info?.quoted_value) >= threshold;
          const regionalApprovers =
            !major && info?.region_id
              ? await this.db
                  .selectFrom('users')
                  .select('id')
                  .where('role', '=', 'regional_manager')
                  .where('region_id', '=', info.region_id)
                  .where('is_active', '=', true)
                  .execute()
              : [];
          const approvers = regionalApprovers.length
            ? regionalApprovers
            : await this.db
                .selectFrom('users')
                .select('id')
                .where('role', 'in', ['management', 'admin'])
                .where('is_active', '=', true)
                .execute();
          approvers.forEach((a) => recipientUserIds.add(a.id));
          title = `Proposal Submitted for Review: ${no}`;
          body = regionalApprovers.length
            ? `Proposal ${no} (below ${formatINR(threshold)}) is awaiting your approval as Regional Manager.`
            : `Proposal ${no} is awaiting your approval${major ? ` (${formatINR(threshold)} or more)` : ''}.`;
          break;
        }

        case 'proposal.approved':
          if (payload?.responsiblePersonId) recipientUserIds.add(payload.responsiblePersonId);
          if (payload?.requestedById) recipientUserIds.add(payload.requestedById);
          title = `Proposal Approved: ${no}`;
          body = `Proposal ${no} has been approved for customer dispatch.`;
          break;

        case 'proposal.changes_requested':
          if (payload?.responsiblePersonId) recipientUserIds.add(payload.responsiblePersonId);
          if (payload?.requestedById) recipientUserIds.add(payload.requestedById);
          title = `Proposal Changes Requested: ${no}`;
          body = `Reviewer requested changes on proposal ${no}: ${payload?.comment || ''}`;
          break;

        case 'proposal.sent':
          if (payload?.requestedById) recipientUserIds.add(payload.requestedById);
          if (payload?.followUpOwnerId) recipientUserIds.add(payload.followUpOwnerId);
          title = 'Proposal Dispatched to Customer';
          body = `Proposal ${no} has been sent. Follow-up is now active.`;
          break;

        case 'proposal.follow_up_owner_changed':
          if (payload?.oldOwnerId) recipientUserIds.add(payload.oldOwnerId);
          if (payload?.newOwnerId) recipientUserIds.add(payload.newOwnerId);
          title = 'Follow-up Ownership Updated';
          body = `Follow-up ownership for proposal ${no} was transferred.`;
          break;

        case 'proposal.revision_requested':
          if (payload?.responsiblePersonId) recipientUserIds.add(payload.responsiblePersonId);
          title = 'Revision Requested by Customer';
          body = `Customer requested a revision on proposal ${no}. Follow-up schedule suspended.`;
          break;

        case 'proposal.converted':
        case 'proposal.lost':
        case 'proposal.closed':
          if (payload?.requestedById) recipientUserIds.add(payload.requestedById);
          if (payload?.responsiblePersonId) recipientUserIds.add(payload.responsiblePersonId);
          {
            const outcome = { 'proposal.converted': 'Converted', 'proposal.lost': 'Lost', 'proposal.closed': 'Closed' }[eventType] || 'Concluded';
            title = `Proposal ${outcome}: ${no}`;
            body = `Proposal ${no} was concluded as ${outcome}. Its open follow-up tasks have been closed.`;
          }
          break;

        case 'proposal.followup_escalated':
          if (payload?.managerId) recipientUserIds.add(payload.managerId);
          title = 'ESCALATION: Proposal Follow-up Overdue';
          body = `Proposal ${no} follow-up is severely overdue and requires intervention.`;
          break;

        // §46: daily follow-up reminders from ProposalsSchedulerService (deduped per proposal per day via scheduler_dedupe)
        case 'proposal.followup_due':
          if (payload?.followUpOwnerId) recipientUserIds.add(payload.followUpOwnerId);
          title = `Follow-up Due Today: ${no}`;
          body = `Customer follow-up for proposal ${no} is due today. Please log the interaction.`;
          break;

        case 'proposal.followup_overdue':
          if (payload?.followUpOwnerId) recipientUserIds.add(payload.followUpOwnerId);
          title = `Overdue Follow-up: ${no}`;
          body = `Customer follow-up for proposal ${no} is ${payload?.daysOverdue ?? 1} day(s) overdue. Please log the interaction.`;
          break;

        case 'proposal.approval_pending': {
          // Approvers: Management & Admin only (Module 5 §3.1, DEF-073)
          const approvers = await this.db
            .selectFrom('users')
            .select('id')
            .where('role', 'in', ['management', 'admin'])
            .where('is_active', '=', true)
            .execute();
          approvers.forEach((a) => recipientUserIds.add(a.id));
          title = `Proposal Awaiting Approval: ${no}`;
          body = `Proposal ${no} is still waiting for approval.`;
          break;
        }

        case 'proposal.required_date_missed':
          if (payload?.responsibleId) recipientUserIds.add(payload.responsibleId);
          title = 'Required Date Missed';
          body = `Proposal ${no} has exceeded its customer required deadline without dispatch.`;
          break;

        default:
          // Routine events do not send immediate notifications; they feed into the daily digest (E57)
          await this.outboxService.markEventProcessed(eventId, this.handlerName);
          return;
      }

      // Dispatch in-app notifications
      for (const userId of recipientUserIds) {
        if (!userId) continue;
        await this.db
          .insertInto('notifications')
          .values({
            user_id: userId,
            type: eventType,
            title,
            body,
            entity_type: 'proposal',
            entity_id: aggregateId,
            is_read: false,
            created_at: new Date(),
          })
          .execute();

        // Realtime broadcast via WebSocket
        this.eventsGateway.sendToUser(userId, 'notification', {
          id: eventId,
          type: eventType,
          title,
          body,
          entity_id: aggregateId,
          entity_type: 'proposal',
          created_at: new Date(),
        });

        // Simulated resilient email transport (E56)
        this.sendEmailSafely(userId, title, body);
      }

      await this.outboxService.markEventProcessed(eventId, this.handlerName);
    } catch (err: any) {
      this.logger.error(`[${this.handlerName}] Failed to process event ${eventId}: ${err.message}`);
    }
  }

  /**
   * Resilient email dispatch: failures do not block the caller or in-app notification (E56)
   */
  private sendEmailSafely(userId: string, subject: string, message: string): void {
    try {
      this.logger.debug(`[Email Service Simulation] Sent email notification to user ${userId}: "${subject}"`);
    } catch (err: any) {
      this.logger.warn(`[Email Service Warning] Failed sending email to user ${userId}: ${err.message}`);
    }
  }
}
