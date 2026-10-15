import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../common/database/database.module.js';
import { AppEvents } from '../common/events/event-names.js';
import { EventsGateway } from '../common/realtime/events.gateway.js';
import { OutboxService } from '../common/outbox/outbox.service.js';
import {
  ProposalStatus,
  PROPOSAL_INACTIVITY_DAYS,
  TENDER_UPCOMING_DAYS,
  TENDER_URGENT_HOURS,
  type Database,
} from '@arihant/shared';

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
    const upcomingWindow = new Date(now.getTime() + TENDER_UPCOMING_DAYS * 24 * 60 * 60 * 1000);
    const urgentWindow = new Date(now.getTime() + TENDER_URGENT_HOURS * 60 * 60 * 1000);

    const terminalStatuses = ['won', 'lost', 'cancelled', 'WON', 'LOST', 'CANCELLED'];

    // 1. Fetch active tenders with deadlines
    const activeTenders = await this.db
      .selectFrom('tenders')
      .selectAll()
      .where('status', 'not in', terminalStatuses as any)
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
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const deadlineKey = closingDate.toISOString().slice(0, 10);

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
      } else if (diffMs <= TENDER_URGENT_HOURS * 60 * 60 * 1000) {
        // Urgent: <= 48 hours
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
      } else if (diffMs <= TENDER_UPCOMING_DAYS * 24 * 60 * 60 * 1000) {
        // Upcoming: <= 7 days - warning broadcast
        this.eventsGateway.broadcast('tender:deadline_warning', {
          tenderId: tender.id,
          tenderNo: tender.tender_no,
          daysLeft,
          bidClosingDate: rawDeadline,
        });
      }
    }

    this.outboxService.triggerImmediate();
  }

  // Task overdue detection moved to Module 8 (tasks/task-jobs.service.ts): OVERDUE is derived, never stored.

  @Cron(CronExpression.EVERY_HOUR)
  async checkProposalFollowupsAndInactivity() {
    this.logger.log('Running proposal follow-ups and inactivity compliance check...');
    const now = new Date();

    // 1. Check overdue follow-ups
    const terminalStatuses: ProposalStatus[] = ['CONVERTED', 'CLOSED', 'LOST'];
    const overdueProposals = await this.db
      .selectFrom('proposals')
      .selectAll()
      .where('status', 'not in', terminalStatuses)
      .where('is_deleted', '=', false)
      .where('next_followup', 'is not', null)
      .where('next_followup', '<', now as any)
      .execute();

    for (const prop of overdueProposals) {
      this.eventEmitter.emit(AppEvents.PROPOSAL_OVERDUE_FOLLOWUP, {
        proposalId: prop.id,
        proposalNumber: prop.proposal_number,
        followUpOwnerId: prop.followup_owner_id,
        nextFollowup: prop.next_followup,
      });
    }

    // 2. Check inactive proposals without movement > PROPOSAL_INACTIVITY_DAYS
    const sevenDaysAgo = new Date(now.getTime() - PROPOSAL_INACTIVITY_DAYS * 24 * 60 * 60 * 1000);
    const inactiveProposals = await this.db
      .selectFrom('proposals')
      .selectAll()
      .where('status', 'not in', terminalStatuses)
      .where('is_deleted', '=', false)
      .where('updated_at', '<=', sevenDaysAgo as any)
      .execute();

    for (const prop of inactiveProposals) {
      this.eventEmitter.emit(AppEvents.PROPOSAL_INACTIVITY_WARNING, {
        proposalId: prop.id,
        proposalNumber: prop.proposal_number,
        responsibleId: prop.responsible_id,
        updatedAt: prop.updated_at,
      });
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkLeadFollowupsOverdue() {
    this.logger.log('Running CRM lead & customer follow-up overdue compliance check...');
    const today = new Date().toISOString().split('T')[0];

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
