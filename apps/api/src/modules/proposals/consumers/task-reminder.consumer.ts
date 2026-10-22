import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../common/database/database.module.js';
import { OutboxService, type DomainEventEnvelope } from '../../../common/outbox/outbox.service.js';
import { istEndOfDay, todayInKolkata, type Database } from '@arihant/shared';
import { proposalDisplayNo } from '../proposals.workflow.js';

const OUTCOME_EVENTS = ['proposal.lost', 'proposal.closed', 'proposal.converted'];
const OUTCOME_TEXT: Record<string, string> = {
  'proposal.lost': 'marked Lost',
  'proposal.closed': 'closed',
  'proposal.converted': 'converted',
};

@Injectable()
export class ProposalTaskReminderConsumer {
  private readonly logger = new Logger(ProposalTaskReminderConsumer.name);
  private readonly handlerName = 'TaskReminderConsumer';

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * DEF-104: when a proposal is converted, lost or closed its follow-up is over. Every open task linked to it
   * (not started / in progress / blocked) is cancelled with the outcome as the reason, open blockers are withdrawn
   * and the change is written to the task timeline. Idempotent per event.
   */
  private async closeFollowupTasks(envelope: DomainEventEnvelope) {
    const { eventId, eventType, aggregateId, actorId, payload } = envelope;
    const handler = `${this.handlerName}:outcome`;
    if (!aggregateId || (await this.outboxService.isEventProcessed(eventId, handler))) return;
    try {
      const proposal = await this.db
        .selectFrom('proposals')
        .select(['proposal_number', 'proposal_no'])
        .where('id', '=', aggregateId)
        .executeTakeFirst();
      const no = proposalDisplayNo(proposal) || payload?.proposalNo || 'the proposal';
      const outcome = OUTCOME_TEXT[eventType] || 'concluded';
      const reason = `Proposal ${no} was ${outcome}; follow-up no longer needed.`;
      const now = new Date();
      await this.db.transaction().execute(async (trx) => {
        const open = await trx
          .selectFrom('tasks')
          .select(['id', 'status'])
          .where('related_entity_type', '=', 'proposal')
          .where('related_entity_id', '=', aggregateId)
          .where('status', 'in', ['not_started', 'in_progress', 'blocked'])
          .forUpdate()
          .execute();
        for (const t of open) {
          await trx
            .updateTable('task_blockers')
            .set({ status: 'withdrawn', resolved_at: now, resolved_by: actorId || null, resolution_note: reason })
            .where('task_id', '=', t.id)
            .where('status', 'in', ['pending_review', 'accepted'])
            .execute();
          await trx
            .updateTable('tasks')
            .set({
              status: 'cancelled',
              cancelled_reason: reason,
              cancelled_by: actorId || null,
              cancelled_at: now,
              version: sql`version + 1`,
              updated_at: now,
            })
            .where('id', '=', t.id)
            .execute();
          await trx
            .insertInto('task_updates')
            .values({
              task_id: t.id,
              author_id: actorId || null,
              kind: 'cancel',
              status_from: t.status,
              status_to: 'cancelled',
              comment: reason,
              metadata: JSON.stringify({ event_id: eventId, source: 'proposal_outcome', outcome: eventType }),
            })
            .execute();
        }
      });
      await this.outboxService.markEventProcessed(eventId, handler);
    } catch (err: any) {
      this.logger.error(`[${handler}] Failed to close follow-up tasks for event ${eventId}: ${err.message}`);
    }
  }

  @OnEvent('proposal.*')
  async handleTaskReminder(envelope: DomainEventEnvelope) {
    const { eventId, eventType, aggregateId, payload, suppressNotifications } = envelope;

    // DEF-104: an outcome ends the follow-up work — close the proposal's open follow-up tasks (even for silent syncs).
    if (OUTCOME_EVENTS.includes(eventType)) {
      await this.closeFollowupTasks(envelope);
      return;
    }

    if (suppressNotifications) return;

    if (
      eventType !== 'proposal.sent' &&
      eventType !== 'proposal.followup_scheduled' &&
      eventType !== 'proposal.followup_logged'
    ) {
      return;
    }

    const isProcessed = await this.outboxService.isEventProcessed(eventId, this.handlerName);
    if (isProcessed) return;

    try {
      // DEF-105: tasks carry the number every screen shows (PROP-2026-1076), not the internal PRP- id.
      const proposalRow = aggregateId
        ? await this.db
            .selectFrom('proposals')
            .select(['proposal_number', 'proposal_no', 'customer_id', 'organisation_id'])
            .where('id', '=', aggregateId)
            .executeTakeFirst()
        : undefined;
      const proposalNo = proposalDisplayNo(proposalRow) || payload?.proposalNo || '';
      const ownerId = payload?.followUpOwnerId || payload?.ownerId;
      const dueDateStr = payload?.nextFollowUpDate || payload?.scheduledDate;

      if (ownerId && dueDateStr && aggregateId) {
        // Module 8: a follow-up date means 23:59:59 IST that day; every reschedule is recorded so the
        // delay classification stays honest (original_deadline never moves).
        const raw = String(dueDateStr);
        const deadline = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? istEndOfDay(raw) : new Date(raw);
        if (Number.isNaN(deadline.getTime())) throw new Error(`Invalid follow-up date "${raw}"`);
        const existingTask = await this.db
          .selectFrom('tasks')
          .select(['id', 'deadline'])
          .where('related_entity_type', '=', 'proposal')
          .where('related_entity_id', '=', aggregateId)
          .where('assigned_to', '=', ownerId)
          .where('status', 'in', ['not_started', 'in_progress', 'blocked'])
          .executeTakeFirst();

        if (existingTask) {
          if (!existingTask.deadline || new Date(existingTask.deadline).getTime() !== deadline.getTime()) {
            await this.db.transaction().execute(async (trx) => {
              await trx
                .updateTable('tasks')
                .set({ deadline, version: sql`version + 1`, updated_at: new Date() })
                .where('id', '=', existingTask.id)
                .execute();
              await trx
                .insertInto('task_deadline_changes')
                .values({ task_id: existingTask.id, old_deadline: existingTask.deadline, new_deadline: deadline, reason: `Proposal follow-up rescheduled (${eventType})`, source: 'linked_reschedule' })
                .execute();
              await trx
                .insertInto('task_updates')
                .values({ task_id: existingTask.id, author_id: null, kind: 'linked_reschedule', comment: 'Follow-up date moved on the proposal', metadata: JSON.stringify({ event_id: eventId }) })
                .execute();
            });
          }
        } else {
          const customerId = proposalRow?.customer_id || proposalRow?.organisation_id || null;
          const category = await this.db.selectFrom('task_categories').select('id').where('code', '=', customerId ? 'CUSTOMER' : 'GENERAL').executeTakeFirst();
          const created = await this.db
            .insertInto('tasks')
            .values({
              title: `Proposal Follow-up: ${proposalNo}`,
              description: `Conduct scheduled customer follow-up for proposal ${proposalNo}.`,
              assigned_to: ownerId,
              priority: 'high',
              task_type: 'follow_up',
              related_entity_type: 'proposal',
              related_entity_id: aggregateId,
              customer_id: customerId,
              ...(category ? { category_id: category.id } : {}),
              source: 'proposal_followup',
              start_date: todayInKolkata(),
              deadline,
              expected_outcome: 'Log customer decision or reschedule follow-up interaction',
              status: 'not_started',
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returning('id')
            .executeTakeFirst();
          if (created) {
            await this.db
              .insertInto('task_updates')
              .values({ task_id: created.id, author_id: null, kind: 'created', status_to: 'not_started', comment: 'Created from a proposal follow-up', metadata: JSON.stringify({ event_id: eventId }) })
              .execute();
          }
        }
      }

      await this.outboxService.markEventProcessed(eventId, this.handlerName);
    } catch (err: any) {
      this.logger.error(`[${this.handlerName}] Failed to process task reminder for event ${eventId}: ${err.message}`);
    }
  }
}
