import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../common/database/database.module.js';
import { OutboxService, type DomainEventEnvelope } from '../../../common/outbox/outbox.service.js';
import { istEndOfDay, todayInKolkata, type Database } from '@arihant/shared';

@Injectable()
export class ProposalTaskReminderConsumer {
  private readonly logger = new Logger(ProposalTaskReminderConsumer.name);
  private readonly handlerName = 'TaskReminderConsumer';

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
  ) {}

  @OnEvent('proposal.*')
  async handleTaskReminder(envelope: DomainEventEnvelope) {
    const { eventId, eventType, aggregateId, payload, suppressNotifications } = envelope;

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
          .where('status', 'in', ['not_started', 'in_progress'])
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
          const org = await this.db.selectFrom('proposals').select(['customer_id', 'organisation_id']).where('id', '=', aggregateId).executeTakeFirst();
          const customerId = org?.customer_id || org?.organisation_id || null;
          const category = await this.db.selectFrom('task_categories').select('id').where('code', '=', customerId ? 'CUSTOMER' : 'GENERAL').executeTakeFirst();
          const created = await this.db
            .insertInto('tasks')
            .values({
              title: `Proposal Follow-up: ${payload?.proposalNo || ''}`,
              description: `Conduct scheduled customer follow-up for proposal ${payload?.proposalNo || ''}.`,
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
