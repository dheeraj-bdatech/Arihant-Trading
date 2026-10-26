import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../common/database/database.module.js';
import { AppEvents } from '../common/events/event-names.js';
import { EventsGateway } from '../common/realtime/events.gateway.js';
import { OutboxService } from '../common/outbox/outbox.service.js';
import {
  TENDER_UPCOMING_DAYS,
  TENDER_URGENT_HOURS,
  todayInKolkata,
  istDateOf,
  isoDaysBetween,
  type Database,
} from '@arihant/shared';

/** Pre-submission stages — the only ones whose submission deadline can still be missed. */
const PRE_SUBMISSION_STATUSES = ['identified', 'awaiting_approval', 'under_preparation', 'pq_qualified'];

@Injectable()
export class DeadlineRemindersJob {
  private readonly logger = new Logger(DeadlineRemindersJob.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
    private readonly eventsGateway: EventsGateway,
    private readonly outboxService: OutboxService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkTenderDeadlines() {
    this.logger.log('Running tender deadline & compliance check job...');

    const now = new Date();
    // Windows come from Tender Settings when configured; the shared constants are only the fallback.
    const settings = await this.db
      .selectFrom('tender_settings')
      .select(['upcoming_days', 'approaching_days', 'approval_sla_hours', 'escalation_user_ids'])
      .executeTakeFirst()
      .catch(() => undefined);
    const upcomingMs = (settings?.upcoming_days || TENDER_UPCOMING_DAYS) * 24 * 60 * 60 * 1000;
    const urgentMs = settings?.approaching_days
      ? settings.approaching_days * 24 * 60 * 60 * 1000
      : TENDER_URGENT_HOURS * 60 * 60 * 1000;

    // B2/B3: only live (not deleted), pre-submission bids can miss or approach their submission deadline —
    // a submitted / under-evaluation / closed bid is never "overdue".
    const activeTenders = await this.db
      .selectFrom('tenders')
      .selectAll()
      .where('is_deleted', '=', false)
      .where('status', 'in', PRE_SUBMISSION_STATUSES as any)
      .where((eb) =>
        eb.or([
          eb('submission_deadline', 'is not', null),
          eb('bid_closing_date', 'is not', null),
        ]),
      )
      .execute();

    for (const tender of activeTenders) {
      const rawDeadline = tender.submission_deadline || tender.bid_closing_date;
      if (!rawDeadline) continue;
      const closingDate = new Date(rawDeadline);
      const diffMs = closingDate.getTime() - now.getTime();
      const hoursLeft = Math.round(diffMs / (1000 * 60 * 60));
      // Calendar days and the dedupe key use the IST day (server clock is UTC; 00:00–05:30 IST is still "yesterday" in UTC).
      const daysLeft = isoDaysBetween(todayInKolkata(now), istDateOf(closingDate));
      const deadlineKey = istDateOf(closingDate);

      // Overdue
      if (diffMs < 0) {
        const idempotencyKey = `overdue_${tender.id}_${deadlineKey}`;
        const alreadyNotified = await this.outboxService.isEventProcessed(idempotencyKey, 'TenderDeadlineCheck');
        if (!alreadyNotified) {
          await this.outboxService.queueEvent(this.db, {
            eventType: AppEvents.TENDER_DEADLINE_EXCEEDED,
            aggregateType: 'TENDER',
            aggregateId: tender.id,
            payload: {
              tenderId: tender.id,
              tenderNo: tender.tender_no,
              deadline: closingDate.toISOString(),
              assignedPersonId: tender.assigned_to || (tender as any).assigned_person_id,
              tenderOwnerId: (tender as any).tender_owner_id,
            },
          });
          await this.outboxService.markEventProcessed(idempotencyKey, 'TenderDeadlineCheck');
        }
      } else if (diffMs <= urgentMs) {
        // Urgent: within the approaching window (settings.approaching_days, else 48h)
        const idempotencyKey = `urgent_${tender.id}_${deadlineKey}`;
        const alreadyNotified = await this.outboxService.isEventProcessed(idempotencyKey, 'TenderDeadlineCheck');
        if (!alreadyNotified) {
          await this.outboxService.queueEvent(this.db, {
            eventType: AppEvents.TENDER_DEADLINE_APPROACHING,
            aggregateType: 'TENDER',
            aggregateId: tender.id,
            payload: {
              tenderId: tender.id,
              tenderNo: tender.tender_no,
              deadline: closingDate.toISOString(),
              hoursLeft,
              assignedPersonId: tender.assigned_to || (tender as any).assigned_person_id,
              tenderOwnerId: (tender as any).tender_owner_id,
            },
          });
          await this.outboxService.markEventProcessed(idempotencyKey, 'TenderDeadlineCheck');
        }
      } else if (diffMs <= upcomingMs) {
        // Upcoming: within settings.upcoming_days (else 7 days) - warning broadcast
        this.eventsGateway.broadcast('tender:deadline_warning', {
          tenderId: tender.id,
          tenderNo: tender.tender_no,
          daysLeft,
          bidClosingDate: rawDeadline,
        });
      }
    }

    await this.sweepApprovalSla(now, settings?.approval_sla_hours ?? 24, settings?.escalation_user_ids);

    this.outboxService.triggerImmediate();
  }

  /**
   * Approval SLA: a bid waiting in awaiting_approval longer than tender_settings.approval_sla_hours is escalated to
   * the configured escalation users, once per tender per IST day (deduped through processed_events).
   */
  private async sweepApprovalSla(now: Date, slaHours: number, rawEscalationIds: unknown) {
    const escalationIds = (Array.isArray(rawEscalationIds) ? rawEscalationIds : []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (!escalationIds.length || !slaHours) return;

    const cutoff = new Date(now.getTime() - slaHours * 60 * 60 * 1000);
    const waiting = await this.db
      .selectFrom('tenders')
      .select(['tenders.id', 'tenders.tender_no', 'tenders.tender_number', 'tenders.updated_at', 'tenders.created_at'])
      .select((eb) =>
        eb
          .selectFrom('tender_status_history')
          .select((h) => h.fn.max('tender_status_history.changed_at').as('since'))
          .whereRef('tender_status_history.tender_id', '=', 'tenders.id')
          .where('tender_status_history.to_status', '=', 'awaiting_approval')
          .as('awaiting_since'),
      )
      .where('tenders.is_deleted', '=', false)
      .where('tenders.status', '=', 'awaiting_approval' as any)
      .where((eb) => eb.or([eb('tenders.on_hold', '=', false), eb('tenders.on_hold', 'is', null)]))
      .execute();

    const today = todayInKolkata(now);
    for (const t of waiting) {
      const since = new Date((t.awaiting_since as any) || t.updated_at || t.created_at);
      if (since > cutoff) continue;

      const dedupeKey = `approval_sla_${t.id}_${today}`;
      if (await this.outboxService.isEventProcessed(dedupeKey, 'TenderApprovalSla')) continue;

      const tenderNo = t.tender_number || t.tender_no || 'Tender';
      const waitedHours = Math.round((now.getTime() - since.getTime()) / (60 * 60 * 1000));
      for (const userId of escalationIds) {
        try {
          const row = await this.db
            .insertInto('notifications')
            .values({
              user_id: userId,
              type: 'tender_approval_escalation',
              title: `Approval SLA breached: ${tenderNo}`,
              body: `Tender ${tenderNo} has been awaiting internal approval for ${waitedHours} hours (SLA ${slaHours}h).`,
              entity_type: 'tender',
              entity_id: t.id,
              is_read: false,
            })
            .returningAll()
            .executeTakeFirst();
          if (row) this.eventsGateway.sendToUser(userId, 'notification:new', row);
        } catch (err: any) {
          this.logger.warn(`Approval SLA notification failed for tender ${t.id}: ${err.message}`);
        }
      }
      await this.outboxService.markEventProcessed(dedupeKey, 'TenderApprovalSla');
    }
  }

  // Task overdue detection moved to Module 8 (tasks/task-jobs.service.ts): OVERDUE is derived, never stored.

  // Proposal follow-up / inactivity alerts live in ProposalsSchedulerService.runHourlyProposalChecks, which emits
  // proposal.followup_due / followup_overdue / stale as outbox envelopes deduped per day via scheduler_dedupe.
  // The legacy raw-payload emitter that used to sit here broke every proposal.* envelope consumer.

  @Cron(CronExpression.EVERY_HOUR)
  async checkLeadFollowupsOverdue() {
    this.logger.log('Running CRM lead & customer follow-up overdue compliance check...');
    const today = todayInKolkata();

    const overdueFollowUps = await this.db
      .selectFrom('follow_ups')
      .innerJoin('organisations', 'follow_ups.organisation_id', 'organisations.id')
      .select([
        'follow_ups.id',
        'follow_ups.assigned_to',
        'follow_ups.due_date',
        'follow_ups.lead_id',
        'organisations.name as organisation_name',
      ])
      .where('follow_ups.status', '=', 'pending')
      .where('follow_ups.due_date', '<', today)
      .execute();

    for (const fu of overdueFollowUps) {
      const idempotencyKey = `overdue_fu_${fu.id}_${today}`;
      const alreadyHandled = await this.outboxService.isEventProcessed(
        idempotencyKey,
        'DeadlineRemindersJob.checkLeadFollowupsOverdue',
      );

      if (!alreadyHandled) {
        await this.outboxService.queueEvent(this.db, {
          eventType: AppEvents.FOLLOWUP_OVERDUE,
          aggregateType: 'FOLLOW_UP',
          aggregateId: fu.id,
          payload: {
            followUpId: fu.id,
            leadId: fu.lead_id,
            assignedTo: fu.assigned_to,
            dueDate: fu.due_date,
            organisationName: fu.organisation_name,
          },
        });
        await this.outboxService.markEventProcessed(
          idempotencyKey,
          'DeadlineRemindersJob.checkLeadFollowupsOverdue',
        );
      }
    }

    if (overdueFollowUps.length > 0) {
      this.outboxService.triggerImmediate();
    }
  }
}
