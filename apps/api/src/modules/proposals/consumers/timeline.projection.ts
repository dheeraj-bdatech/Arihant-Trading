import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../common/database/database.module.js';
import { OutboxService, type DomainEventEnvelope } from '../../../common/outbox/outbox.service.js';
import type { Database } from '@arihant/shared';

@Injectable()
export class ProposalTimelineProjection {
  private readonly logger = new Logger(ProposalTimelineProjection.name);
  private readonly handlerName = 'TimelineProjection';

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
  ) {}

  @OnEvent('proposal.*')
  async handleProposalEvent(envelope: DomainEventEnvelope) {
    // Only outbox envelopes are processed; a raw payload on proposal.* (wildcard) must not crash or poison processed_events.
    if (!envelope?.eventId || !envelope?.eventType) return;
    const { eventId, eventType, aggregateId, actorId, occurredAt, payload } = envelope;

    if (!aggregateId) return;

    // Idempotency check (E51)
    const isProcessed = await this.outboxService.isEventProcessed(eventId, this.handlerName);
    if (isProcessed) {
      return;
    }

    // QA DEF-028: no in-memory sequence check — events after creation all default to aggregate_sequence 1, so the
    // guard discarded them. Entries are idempotent per event and ordered by occurred_at.

    try {
      const { title, description, category } = this.formatTimelineEntry(eventType, payload);

      await this.db
        .insertInto('proposal_timeline')
        .values({
          proposal_id: aggregateId,
          event_type: eventType,
          category,
          title,
          description,
          actor_id: actorId || null,
          metadata: payload ? payload : {},
          occurred_at: occurredAt || new Date(),
        })
        .execute();

      await this.outboxService.markEventProcessed(eventId, this.handlerName);
    } catch (err: any) {
      this.logger.error(`[${this.handlerName}] Failed to project event ${eventId}: ${err.message}`);
    }
  }

  /**
   * Rebuilds the timeline projection from source events and records (E59)
   */
  async rebuildProjections(): Promise<{ rebuiltCount: number }> {
    this.logger.log('Starting proposal timeline projection rebuild...');

    // Delete existing timeline entries
    await this.db.deleteFrom('proposal_timeline').execute();

    let count = 0;

    // 1. Rebuild from proposals creation
    const proposals = await this.db.selectFrom('proposals').selectAll().execute();
    for (const p of proposals) {
      await this.db
        .insertInto('proposal_timeline')
        .values({
          proposal_id: p.id,
          event_type: 'proposal.requested',
          category: 'lifecycle',
          title: 'Proposal Requested',
          description: `Proposal ${p.proposal_no || p.proposal_number} was created for customer.`,
          actor_id: p.created_by_id || p.created_by,
          metadata: { proposal_no: p.proposal_no || p.proposal_number },
          occurred_at: p.created_at,
        })
        .execute();
      count++;
    }

    // 2. Rebuild from status history
    const history = await this.db
      .selectFrom('proposal_status_history')
      .selectAll()
      .orderBy('occurred_at', 'asc')
      .execute();
    for (const h of history) {
      await this.db
        .insertInto('proposal_timeline')
        .values({
          proposal_id: h.proposal_id,
          event_type: 'proposal.status_changed',
          category: 'workflow',
          title: `Status Changed to ${h.to_status}`,
          description: h.reason || `Status transitioned from ${h.from_status || 'initial'} to ${h.to_status}.`,
          actor_id: h.actor_id,
          metadata: { from_status: h.from_status, to_status: h.to_status },
          occurred_at: h.occurred_at,
        })
        .execute();
      count++;
    }

    // 3. Rebuild from follow-ups
    const followups = await this.db
      .selectFrom('proposal_follow_ups')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    for (const f of followups) {
      await this.db
        .insertInto('proposal_timeline')
        .values({
          proposal_id: f.proposal_id,
          event_type: f.is_postpone ? 'proposal.followup_postponed' : 'proposal.followup_logged',
          category: 'follow_up',
          title: f.is_postpone ? 'Follow-up Postponed' : `Follow-up Logged (${f.mode})`,
          description: f.is_postpone ? (f.postpone_reason || 'Rescheduled') : f.summary,
          actor_id: f.logged_by,
          metadata: {
            mode: f.mode,
            response: f.response,
            next_follow_up_date: f.next_follow_up_date,
          },
          occurred_at: f.created_at,
        })
        .execute();
      count++;
    }

    this.logger.log(`Proposal timeline projection rebuilt successfully with ${count} items.`);
    return { rebuiltCount: count };
  }

  private formatTimelineEntry(
    eventType: string,
    payload: any,
  ): { title: string; description: string; category: string } {
    switch (eventType) {
      case 'proposal.requested':
      case 'proposal.created':
        return {
          title: 'Proposal Requested',
          description: `Proposal ${payload?.proposalNo || ''} requested for customer.`,
          category: 'lifecycle',
        };
      case 'proposal.preparation_started':
        return {
          title: 'Preparation Started',
          description: 'Responsible person started proposal preparation.',
          category: 'workflow',
        };
      case 'proposal.submitted_for_review':
      case 'proposal.review_requested':
        return {
          title: 'Submitted for Review',
          description: payload?.changeSummary || 'Draft proposal submitted for internal manager review.',
          category: 'workflow',
        };
      case 'proposal.approved':
        return {
          title: 'Proposal Approved',
          description: 'Proposal approved by management for customer dispatch.',
          category: 'workflow',
        };
      case 'proposal.changes_requested':
        return {
          title: 'Changes Requested',
          description: payload?.comment || 'Reviewer requested modifications before approval.',
          category: 'workflow',
        };
      case 'proposal.approval_invalidated':
        return {
          title: 'Approval Invalidated',
          description: payload?.invalidationReason || 'Material changes required approval invalidation.',
          category: 'workflow',
        };
      case 'proposal.sent':
        return {
          title: 'Dispatched to Customer',
          description: `Dispatched on ${payload?.sentDate || 'today'}. Follow-up owner assigned.`,
          category: 'communication',
        };
      case 'proposal.revision_requested':
        return {
          title: 'Revision Requested by Customer',
          description: payload?.revisionReason || 'Customer requested modifications.',
          category: 'workflow',
        };
      case 'proposal.followup_logged':
        return {
          title: `Follow-up Logged (${payload?.mode || 'Call'})`,
          description: payload?.summary || 'Client interaction recorded.',
          category: 'follow_up',
        };
      case 'proposal.followup_postponed':
        return {
          title: 'Follow-up Postponed',
          description: payload?.postponeReason || 'Follow-up rescheduled without contact.',
          category: 'follow_up',
        };
      case 'proposal.converted':
        return {
          title: 'Proposal Converted',
          description: `Proposal successfully converted on ${payload?.outcomeDate || 'today'}.`,
          category: 'outcome',
        };
      case 'proposal.lost':
        return {
          title: 'Proposal Marked Lost',
          description: `Reason: ${payload?.lostReasonCode || 'Unknown'} - ${payload?.lostReasonText || ''}`,
          category: 'outcome',
        };
      case 'proposal.closed':
        return {
          title: 'Proposal Closed',
          description: `Closure: ${payload?.closureReasonCode || 'Closed'} - ${payload?.closureReasonText || ''}`,
          category: 'outcome',
        };
      case 'proposal.reopened':
        return {
          title: 'Proposal Reopened',
          description: payload?.reopenReason || 'Proposal reopened by administration.',
          category: 'workflow',
        };
      case 'proposal.assigned':
        return {
          title: 'Proposal Reassigned',
          description: payload?.reason || 'Responsible person changed.',
          category: 'management',
        };
      case 'proposal.follow_up_owner_changed':
        return {
          title: 'Follow-up Owner Changed',
          description: 'Follow-up responsibility reassigned.',
          category: 'management',
        };
      default:
        return {
          title: eventType.replace('proposal.', '').replace(/_/g, ' ').toUpperCase(),
          description: JSON.stringify(payload || {}),
          category: 'system',
        };
    }
  }
}
