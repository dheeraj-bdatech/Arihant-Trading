import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService, type DomainEventEnvelope } from '../../common/outbox/outbox.service.js';
import type { Database } from '@arihant/shared';

/**
 * Blueprint §45: every approval / rejection / stage change is written to the security audit trail with the actor
 * and payload. Tender lifecycle moves and proposal decisions are published as outbox domain events; this listener
 * turns the decision-bearing ones into audit_log rows (idempotent per event via processed_events).
 *
 * Reminder / projection events (deadline_approaching, portal issues, follow-up nudges…) are not decisions and are
 * skipped so the trail stays readable.
 */
const TENDER_DECISIONS: Record<string, string> = {
  'tender.created': 'tender_created',
  'tender.assigned': 'tender_assigned',
  'tender.status_changed': 'tender_stage_changed',
  'tender.approval_requested': 'tender_approval_requested',
  'tender.approved': 'tender_approved',
  'tender.rejected': 'tender_rejected',
  'tender.preparation_started': 'tender_preparation_started',
  'tender.pq_submitted': 'tender_pq_submitted',
  'tender.pq_qualified': 'tender_pq_qualified',
  'tender.submitted': 'tender_submitted',
  'tender.won': 'tender_won',
  'tender.lost': 'tender_lost',
  'tender.cancelled': 'tender_cancelled',
};

/**
 * Target stages of a tender move that TendersService.transitionTender (lifecycleEventFor) also announces with a
 * specific decision event (tender.approval_requested / approved / preparation_started / rejected / pq_submitted /
 * pq_qualified / submitted / won / lost / cancelled). Their generic tender.status_changed is not written, so each
 * decision is one audit row; stages without a decision event (technical / commercial evaluation,
 * back to identified …) keep their tender_stage_changed row. Used only for events queued before the
 * status_changed payload carried `decisionEvent`.
 */
const TENDER_STAGES_WITH_DECISION_EVENT = new Set([
  'AWAITING_INTERNAL_APPROVAL',
  'UNDER_PREPARATION',
  'REJECTED_INTERNALLY',
  'PQ_SUBMITTED',
  'PQ_QUALIFIED',
  'TENDER_SUBMITTED',
  'WON',
  'LOST',
  'CANCELLED',
]);

/** A tender.status_changed whose move is already recorded under its specific decision event. */
function isDuplicatedStageChange(envelope: DomainEventEnvelope): boolean {
  if (envelope.eventType !== 'tender.status_changed') return false;
  const p = (envelope.payload ?? {}) as Record<string, any>;
  if ('decisionEvent' in p) return Boolean(p.decisionEvent);
  const from = String(p.fromStatus ?? '').toUpperCase();
  const to = String(p.toStatus ?? '').toUpperCase();
  return Boolean(to) && from !== to && TENDER_STAGES_WITH_DECISION_EVENT.has(to);
}

/**
 * Proposal decisions are recorded here under their own action codes; ProposalAuditLogConsumer skips these event
 * types (PROPOSAL_DECISION_EVENTS) so each decision is logged once.
 */
const PROPOSAL_DECISIONS: Record<string, string> = {
  'proposal.approved': 'proposal_approved',
  'proposal.changes_requested': 'proposal_changes_requested',
  'proposal.revision_requested': 'proposal_revision_requested',
  'proposal.approval_invalidated': 'proposal_approval_invalidated',
  'proposal.sent': 'proposal_sent',
  'proposal.converted': 'proposal_converted',
  'proposal.lost': 'proposal_lost',
  'proposal.closed': 'proposal_closed',
  'proposal.reopened': 'proposal_reopened',
};

export const PROPOSAL_DECISION_EVENTS = new Set(Object.keys(PROPOSAL_DECISIONS));

const HANDLER = 'SecurityAuditTrailListener';

@Injectable()
export class AuditTrailListener {
  private readonly logger = new Logger(AuditTrailListener.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outbox: OutboxService,
  ) {}

  @OnEvent('tender.*')
  async onTenderEvent(envelope: DomainEventEnvelope) {
    await this.record(envelope, 'tender', TENDER_DECISIONS);
  }

  @OnEvent('proposal.*')
  async onProposalEvent(envelope: DomainEventEnvelope) {
    await this.record(envelope, 'proposal', PROPOSAL_DECISIONS);
  }

  private async record(envelope: DomainEventEnvelope, entityType: string, actions: Record<string, string>) {
    const action = envelope && actions[envelope.eventType];
    if (!action || !envelope.eventId || !envelope.aggregateId) return;
    if (isDuplicatedStageChange(envelope)) return;
    try {
      if (await this.outbox.isEventProcessed(envelope.eventId, HANDLER)) return;
      const p = (envelope.payload ?? {}) as Record<string, any>;
      const from = p.fromStatus ?? p.from_status ?? p.previousStatus ?? p.before?.status;
      const previous = from ? { status: from } : null;
      await this.db
        .insertInto('audit_log')
        .values({
          actor_id: envelope.actorId || p.actorId || p.approverId || null,
          entity_type: entityType,
          entity_id: envelope.aggregateId,
          action,
          previous_value: previous ? JSON.stringify(previous) : null,
          new_value: JSON.stringify(p),
          created_at: envelope.occurredAt ? new Date(envelope.occurredAt) : new Date(),
        })
        .execute();
      await this.outbox.markEventProcessed(envelope.eventId, HANDLER);
    } catch (err: any) {
      // The audit trail must never break the business transaction that raised the event.
      this.logger.error(`Audit trail for ${envelope.eventType} ${envelope.aggregateId} failed: ${err?.message}`);
    }
  }
}
