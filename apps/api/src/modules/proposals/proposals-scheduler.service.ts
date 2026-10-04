import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AppEvents } from '../../common/events/event-names.js';
import type { Database } from '@arihant/shared';

@Injectable()
export class ProposalsSchedulerService {
  private readonly logger = new Logger(ProposalsSchedulerService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Hourly scheduler run with distributed DB advisory lock (E54, E55)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runHourlyProposalChecks(): Promise<{ processedAlerts: number }> {
    this.logger.log('Starting hourly proposal state-based evaluation sweep...');

    // 1. Acquire PostgreSQL advisory lock (key 550005)
    const lockRes = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(550005) as locked`.execute(this.db);
    const hasLock = lockRes.rows[0]?.locked;

    if (!hasLock) {
      this.logger.debug('Another scheduler instance is currently executing proposal checks. Skipping.');
      return { processedAlerts: 0 };
    }

    let alertCount = 0;

    try {
      // 2. Fetch current proposal settings
      let settings: any = null;
      try {
        settings = await this.db
          .selectFrom('proposal_settings')
          .selectAll()
          .where('id', '=', 1)
          .executeTakeFirst();
      } catch (err: any) {
        if (err?.code === '42P01' || err?.message?.includes('proposal_settings')) {
          this.logger.warn('proposal_settings table not available. Using default configuration.');
        } else {
          throw err;
        }
      }

      const tz = settings?.business_timezone || 'Asia/Kolkata';
      const businessDate = this.getBusinessDate(tz);
      const now = new Date();

      this.logger.debug(`Evaluating proposals for business date: ${businessDate} (${tz})`);

      const nonTerminal = [
        'REQUESTED',
        'PROPOSAL_REQUESTED',
        'UNDER_PREPARATION',
        'READY_FOR_REVIEW',
        'APPROVED',
        'SENT_TO_CUSTOMER',
        'FOLLOW_UP_REQUIRED',
      ];
      const dispatched = ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'];

      // --- 3. Follow-up Due Today (E44, 6b) ---
      const dueTodayProposals = await this.db
        .selectFrom('proposals')
        .selectAll()
        .where('status', 'in', dispatched as any)
        .where('is_deleted', '=', false)
        .where((eb) =>
          eb.or([
            eb('next_follow_up_date', '=', businessDate),
            eb('next_followup', '=', businessDate),
          ]),
        )
        .execute();

      for (const p of dueTodayProposals) {
        const emitted = await this.emitDailyAlert(
          p.id,
          AppEvents.PROPOSAL_FOLLOWUP_DUE,
          businessDate,
          {
            proposalId: p.id,
            proposalNo: p.proposal_no || p.proposal_number,
            followUpOwnerId: p.follow_up_owner_id || p.followup_owner_id,
            dueDate: businessDate,
          },
        );
        if (emitted) alertCount++;
      }

      // --- 4. Overdue Follow-ups (6c, E40) ---
      const overdueProposals = await this.db
        .selectFrom('proposals')
        .selectAll()
        .where('status', 'in', dispatched as any)
        .where('is_deleted', '=', false)
        .where((eb) =>
          eb.or([
            eb('next_follow_up_date', '<', businessDate),
            eb('next_followup', '<', businessDate),
          ]),
        )
        .execute();

      const escalateDays = settings?.escalate_after_overdue_days ?? 3;

      for (const p of overdueProposals) {
        const nextDateStr = p.next_follow_up_date || p.next_followup;
        if (!nextDateStr) continue;

        const nextDate = new Date(nextDateStr);
        const currDate = new Date(businessDate);
        const daysOverdue = Math.max(1, Math.floor((currDate.getTime() - nextDate.getTime()) / (1000 * 60 * 60 * 24)));

        const emitted = await this.emitDailyAlert(
          p.id,
          AppEvents.PROPOSAL_FOLLOWUP_OVERDUE,
          businessDate,
          {
            proposalId: p.id,
            proposalNo: p.proposal_no || p.proposal_number,
            followUpOwnerId: p.follow_up_owner_id || p.followup_owner_id,
            daysOverdue,
            dueDate: nextDateStr,
          },
        );
        if (emitted) alertCount++;

        // Check escalation threshold
        if (daysOverdue >= escalateDays) {
          const ownerId = p.follow_up_owner_id || p.followup_owner_id;
          let managerId: string | null = null;
          if (ownerId) {
            const owner = await this.db
              .selectFrom('users')
              .select('reporting_manager_id')
              .where('id', '=', ownerId)
              .executeTakeFirst();
            managerId = owner?.reporting_manager_id || null;
          }

          const escEmitted = await this.emitDailyAlert(
            p.id,
            AppEvents.PROPOSAL_FOLLOWUP_ESCALATED,
            businessDate,
            {
              proposalId: p.id,
              proposalNo: p.proposal_no || p.proposal_number,
              followUpOwnerId: ownerId,
              managerId,
              daysOverdue,
            },
          );
          if (escEmitted) alertCount++;
        }
      }

      // --- 5. Required Date Approaching & Missed (6f) ---
      const activePreDispatch = await this.db
        .selectFrom('proposals')
        .selectAll()
        .where('status', 'in', ['REQUESTED', 'PROPOSAL_REQUESTED', 'UNDER_PREPARATION', 'READY_FOR_REVIEW', 'APPROVED'] as any)
        .where('is_deleted', '=', false)
        .execute();

      const warningDays = settings?.required_date_warning_days ?? 2;

      for (const p of activePreDispatch) {
        if (!p.required_date) continue;

        const reqDate = new Date(p.required_date);
        const currDate = new Date(businessDate);
        const diffDays = Math.round((reqDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          // Missed required date
          const emitted = await this.emitDailyAlert(
            p.id,
            AppEvents.PROPOSAL_REQUIRED_DATE_MISSED,
            businessDate,
            {
              proposalId: p.id,
              proposalNo: p.proposal_no || p.proposal_number,
              responsibleId: p.responsible_person_id || p.responsible_id,
              requiredDate: p.required_date,
              daysLate: Math.abs(diffDays),
            },
          );
          if (emitted) alertCount++;
        } else if (diffDays <= warningDays) {
          // Approaching required date
          const emitted = await this.emitDailyAlert(
            p.id,
            AppEvents.PROPOSAL_REQUIRED_DATE_APPROACHING,
            businessDate,
            {
              proposalId: p.id,
              proposalNo: p.proposal_no || p.proposal_number,
              responsibleId: p.responsible_person_id || p.responsible_id,
              requiredDate: p.required_date,
              daysLeft: diffDays,
            },
          );
          if (emitted) alertCount++;
        }
      }

      // --- 6. Stale Proposals Without Meaningful Movement (6d, E45) ---
      const allActive = await this.db
        .selectFrom('proposals')
        .selectAll()
        .where('status', 'in', nonTerminal as any)
        .where('is_deleted', '=', false)
        .execute();

      for (const p of allActive) {
        const status = (p.status || '').toUpperCase();
        let thresholdDays = 7;
        if (status.includes('REQUESTED')) {
          thresholdDays = settings?.stale_requested_days ?? 2;
        } else if (status === 'UNDER_PREPARATION') {
          thresholdDays = settings?.stale_preparation_days ?? 7;
        } else if (status === 'READY_FOR_REVIEW') {
          thresholdDays = settings?.stale_review_days ?? 2;
        } else if (status === 'APPROVED') {
          thresholdDays = settings?.stale_approved_days ?? 2;
        } else if (dispatched.includes(status)) {
          thresholdDays = settings?.stale_followup_days ?? 21;
        }

        const lastActive = p.last_activity_at ? new Date(p.last_activity_at) : new Date(p.created_at);
        const daysInactive = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

        if (daysInactive >= thresholdDays) {
          const emitted = await this.emitDailyAlert(
            p.id,
            AppEvents.PROPOSAL_STALE,
            businessDate,
            {
              proposalId: p.id,
              proposalNo: p.proposal_no || p.proposal_number,
              status,
              lastActivityAt: lastActive.toISOString(),
              daysInactive,
            },
          );
          if (emitted) alertCount++;
        }
      }

      // --- 7. Pending Approval Queue (6f) ---
      const pendingApproval = await this.db
        .selectFrom('proposals')
        .selectAll()
        .where('status', '=', 'READY_FOR_REVIEW')
        .where('is_deleted', '=', false)
        .execute();

      for (const p of pendingApproval) {
        const emitted = await this.emitDailyAlert(
          p.id,
          AppEvents.PROPOSAL_APPROVAL_PENDING,
          businessDate,
          {
            proposalId: p.id,
            proposalNo: p.proposal_no || p.proposal_number,
            responsibleId: p.responsible_person_id || p.responsible_id,
          },
        );
        if (emitted) alertCount++;
      }

      // --- 8. Suggest Closure (6f, E41) ---
      const suggestClosureDays = settings?.suggest_closure_after_days ?? 60;
      for (const p of overdueProposals) {
        if (!p.sent_date) continue;
        const sentDate = new Date(p.sent_date);
        const daysSinceSent = Math.floor((now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceSent >= suggestClosureDays) {
          const emitted = await this.emitDailyAlert(
            p.id,
            AppEvents.PROPOSAL_SUGGEST_CLOSURE,
            businessDate,
            {
              proposalId: p.id,
              proposalNo: p.proposal_no || p.proposal_number,
              followUpOwnerId: p.follow_up_owner_id || p.followup_owner_id,
              sentDate: p.sent_date,
              daysSinceSent,
            },
          );
          if (emitted) alertCount++;
        }
      }

      // --- 9. Check Deactivated Owners (E14) ---
      const proposalsWithUsers = await this.db
        .selectFrom('proposals')
        .leftJoin('users as resp', 'proposals.responsible_person_id', 'resp.id')
        .leftJoin('users as owner', 'proposals.follow_up_owner_id', 'owner.id')
        .select([
          'proposals.id',
          'proposals.proposal_no',
          'proposals.proposal_number',
          'proposals.owner_inactive_flag',
          'resp.is_active as resp_active',
          'owner.is_active as owner_active',
        ])
        .where('proposals.status', 'in', nonTerminal as any)
        .where('proposals.is_deleted', '=', false)
        .execute();

      for (const p of proposalsWithUsers) {
        const isOwnerInactive = p.resp_active === false || p.owner_active === false;
        if (isOwnerInactive && !p.owner_inactive_flag) {
          await this.db
            .updateTable('proposals')
            .set({ owner_inactive_flag: true })
            .where('id', '=', p.id)
            .execute();

          this.logger.warn(`Proposal ${p.proposal_no || p.proposal_number} flagged for inactive owner reassignment.`);
        }
      }

      // Trigger immediate outbox relay processing
      if (alertCount > 0) {
        this.outboxService.triggerImmediate();
      }

      this.logger.log(`Hourly proposal sweep finished. Emitted ${alertCount} alerts.`);
    } catch (err: any) {
      this.logger.error(`Error in proposal scheduler sweep: ${err.message}`, err.stack);
    } finally {
      // Release advisory lock
      await sql`SELECT pg_advisory_unlock(550005)`.execute(this.db);
    }

    return { processedAlerts: alertCount };
  }

  /**
   * Computes the current date string (YYYY-MM-DD) in the specified business timezone (E44)
   */
  getBusinessDate(timezone = 'Asia/Kolkata'): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }

  /**
   * Idempotent once-per-day alert emitter using scheduler_dedupe table (E54)
   */
  async emitDailyAlert(
    proposalId: string,
    eventType: string,
    businessDate: string,
    payload: any,
  ): Promise<boolean> {
    const dedupeKey = `${proposalId}_${eventType}_${businessDate}`;

    try {
      const inserted = await this.db
        .insertInto('scheduler_dedupe')
        .values({
          dedupe_key: dedupeKey,
          event_type: eventType,
          proposal_id: proposalId,
          business_date: businessDate,
          created_at: new Date(),
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .returning('id')
        .executeTakeFirst();

      if (!inserted) {
        return false; // Already fired today
      }

      await this.outboxService.queueEvent(this.db, {
        eventType,
        aggregateType: 'Proposal',
        aggregateId: proposalId,
        payload: {
          ...payload,
          businessDate,
        },
      });

      return true;
    } catch (err: any) {
      this.logger.warn(`Failed to emit daily alert for key ${dedupeKey}: ${err.message}`);
      return false;
    }
  }

  /**
   * Triggers the daily morning digest (Section 7.4)
   */
  async triggerDailyDigest(): Promise<{ digestSentUsers: number }> {
    this.logger.log('Compiling proposal daily digest...');

    let settings: any = null;
    try {
      settings = await this.db
        .selectFrom('proposal_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
    } catch (err: any) {
      if (err?.code === '42P01' || err?.message?.includes('proposal_settings')) {
        this.logger.warn('proposal_settings table not available. Using default configuration.');
      } else {
        throw err;
      }
    }

    const tz = settings?.business_timezone || 'Asia/Kolkata';
    const businessDate = this.getBusinessDate(tz);

    // Fetch all active users with sales, regional_manager, management, or admin roles
    const users = await this.db
      .selectFrom('users')
      .selectAll()
      .where('is_active', '=', true)
      .where('role', 'in', ['sales', 'regional_manager', 'management', 'admin'])
      .execute();

    let count = 0;
    for (const u of users) {
      // Find proposals relevant to this user
      const userProposals = await this.db
        .selectFrom('proposals')
        .selectAll()
        .where('is_deleted', '=', false)
        .where((eb) =>
          eb.or([
            eb('responsible_person_id', '=', u.id),
            eb('responsible_id', '=', u.id),
            eb('follow_up_owner_id', '=', u.id),
            eb('followup_owner_id', '=', u.id),
            eb('requested_by_id', '=', u.id),
            eb('requested_by', '=', u.id),
          ]),
        )
        .execute();

      if (userProposals.length > 0) {
        count++;
        this.logger.debug(`Compiled daily proposal digest for user ${u.full_name} (${userProposals.length} items).`);
      }
    }

    return { digestSentUsers: count };
  }

  /**
   * Aliases for scheduler engines
   */
  async runHourlyAlertEngine(): Promise<{ processedAlerts: number }> {
    return this.runHourlyProposalChecks();
  }

  async runDailyDigest(): Promise<{ digestSentUsers: number }> {
    return this.triggerDailyDigest();
  }
}
