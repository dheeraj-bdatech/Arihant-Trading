import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../common/database/database.module.js';
import { OutboxService, type DomainEventEnvelope } from '../../../common/outbox/outbox.service.js';
import type { Database } from '@arihant/shared';
import { PROPOSAL_DECISION_EVENTS } from '../../audit/audit-trail.listener.js';

@Injectable()
export class ProposalAuditLogConsumer {
  private readonly logger = new Logger(ProposalAuditLogConsumer.name);
  private readonly handlerName = 'AuditLogConsumer';

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
  ) {}

  @OnEvent('proposal.*')
  async handleProposalEvent(envelope: DomainEventEnvelope) {
    const { eventId, eventType, aggregateId, actorId, payload } = envelope;

    // Idempotency check (E51)
    const isProcessed = await this.outboxService.isEventProcessed(eventId, this.handlerName);
    if (isProcessed) {
      this.logger.debug(`[${this.handlerName}] Skipping duplicate event ${eventId}`);
      return;
    }

    // QA DEF-028: no in-memory sequence check. Only the creation events carry a real aggregate_sequence (1-3);
    // every later event defaults to 1, so the old "older than last applied" guard dropped nearly every decision.
    // The audit trail is append-only and idempotent per event, so ordering is carried by created_at instead.
    // Decision events (approved, sent, converted, lost…) are written by AuditTrailListener under readable codes.
    if (PROPOSAL_DECISION_EVENTS.has(eventType)) return;

    try {
      // Determine action name from eventType e.g. "proposal.requested" -> "create"
      let action = 'update';
      if (eventType.includes('requested') || eventType.includes('created')) {
        action = 'create';
      } else if (eventType.includes('deleted')) {
        action = 'delete';
      } else if (eventType.includes('status_changed')) {
        action = 'status_change';
      } else if (eventType.includes('approved')) {
        action = 'approve';
      } else if (eventType.includes('changes_requested')) {
        action = 'reject';
      }

      await this.db
        .insertInto('audit_log')
        .values({
          actor_id: actorId || null,
          entity_type: 'proposal',
          entity_id: aggregateId,
          action,
          previous_value: payload?.before ? JSON.stringify(payload.before) : null,
          new_value: payload ? JSON.stringify(payload) : null,
          created_at: new Date(),
        })
        .execute();

      await this.outboxService.markEventProcessed(eventId, this.handlerName);
      this.logger.debug(`[${this.handlerName}] Recorded audit log for event ${eventId}`);
    } catch (err: any) {
      this.logger.error(`[${this.handlerName}] Failed to process event ${eventId}: ${err.message}`, err.stack);
      // Consumer failure must not block the system or crash the app
    }
  }
}
