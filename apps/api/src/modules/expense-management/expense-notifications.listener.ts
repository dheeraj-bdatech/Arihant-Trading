/**
 * §7 notifications for Module 9 (in-app + realtime push) and the daily reminder for claims
 * that have been waiting on a manager or on Accounts for too long.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Kysely, sql } from 'kysely';
import { EXPENSE_DB } from './expense-db.js';
import { EventsGateway } from '../../common/realtime/events.gateway.js';
import { formatExpenseAmount, type Database } from '@arihant/shared';
import { EXPENSE_CONFIG, type ExpenseConfig } from './expense.config.js';
import { EXPENSE_EVENTS } from './expense-workflow.service.js';

interface ClaimEvent {
  claimId: string;
  claimNumber: string;
  employeeId: string;
  comment?: string | null;
  approverId?: string | null;
  amount?: number;
  employeeName?: string;
  resubmitted?: boolean;
  stage?: 'manager' | 'accounts';
  tallyRef?: string;
  paymentReference?: string | null;
  paymentDate?: string | null;
}

@Injectable()
export class ExpenseNotificationsListener {
  private readonly logger = new Logger(ExpenseNotificationsListener.name);

  constructor(
    @Inject(EXPENSE_DB) private readonly db: Kysely<Database>,
    @Inject(EXPENSE_CONFIG) private readonly config: ExpenseConfig,
    private readonly gateway: EventsGateway,
  ) {}

  private async notify(userIds: (string | null | undefined)[], type: string, title: string, body: string, claimId: string | null) {
    const unique = Array.from(new Set(userIds.filter((u): u is string => Boolean(u))));
    for (const userId of unique) {
      try {
        const row = await this.db
          .insertInto('notifications')
          .values({ user_id: userId, type, title, body, entity_type: claimId ? 'expense_claim' : 'expense_queue', entity_id: claimId, is_read: false })
          .returningAll()
          .executeTakeFirst();
        if (row) this.gateway.sendToUser(userId, 'notification:new', row);
      } catch (err: any) {
        this.logger.error(`Could not notify ${userId}: ${err.message}`);
      }
    }
    if (unique.length) {
      for (const userId of unique) this.gateway.sendToUser(userId, 'expense:badge_refresh', { claimId });
    }
  }

  private async accountsUsers(excludeId: string) {
    const rows = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'accounts')
      .where('is_active', '=', true)
      .where('id', '<>', excludeId)
      .execute();
    return rows.map((r) => r.id);
  }

  @OnEvent(EXPENSE_EVENTS.SUBMITTED)
  async onSubmitted(e: ClaimEvent) {
    await this.notify(
      [e.approverId],
      'expense_approval',
      e.resubmitted ? `Expense claim ${e.claimNumber} resubmitted` : `Expense claim ${e.claimNumber} awaits your approval`,
      `${e.employeeName || 'An employee'} ${e.resubmitted ? 'resubmitted' : 'submitted'} ${formatExpenseAmount(e.amount ?? 0)} for review.`,
      e.claimId,
    );
  }

  @OnEvent(EXPENSE_EVENTS.MANAGER_APPROVED)
  async onManagerApproved(e: ClaimEvent) {
    await this.notify(
      await this.accountsUsers(e.employeeId),
      'expense_accounts',
      `Expense claim ${e.claimNumber} ready for Accounts`,
      `Manager approved ${formatExpenseAmount(e.amount ?? 0)}. Please verify and process.`,
      e.claimId,
    );
    await this.notify(
      [e.employeeId],
      'expense_status',
      `${e.claimNumber} approved by your manager`,
      `${formatExpenseAmount(e.amount ?? 0)} approved and forwarded to Accounts.${e.comment ? ` Comment: ${e.comment}` : ''}`,
      e.claimId,
    );
  }

  @OnEvent(EXPENSE_EVENTS.ACCOUNTS_APPROVED)
  async onAccountsApproved(e: ClaimEvent) {
    await this.notify(
      [e.employeeId],
      'expense_status',
      `${e.claimNumber} verified by Accounts`,
      `${formatExpenseAmount(e.amount ?? 0)} verified. It will be marked processed once entered in Tally.`,
      e.claimId,
    );
  }

  @OnEvent(EXPENSE_EVENTS.REJECTED)
  async onRejected(e: ClaimEvent) {
    await this.notify(
      [e.employeeId],
      'expense_status',
      `${e.claimNumber} was rejected`,
      `${e.stage === 'accounts' ? 'Accounts' : 'Your manager'} rejected this claim: ${e.comment || 'no comment'}. You can copy it into a new draft.`,
      e.claimId,
    );
  }

  @OnEvent(EXPENSE_EVENTS.CLARIFICATION)
  async onClarification(e: ClaimEvent) {
    await this.notify(
      [e.employeeId],
      'expense_status',
      `Clarification needed on ${e.claimNumber}`,
      `${e.stage === 'accounts' ? 'Accounts' : 'Your manager'} asked: ${e.comment}`,
      e.claimId,
    );
  }

  @OnEvent(EXPENSE_EVENTS.PROCESSED)
  async onProcessed(e: ClaimEvent) {
    const pay = [e.paymentReference && `payment ref ${e.paymentReference}`, e.paymentDate && `paid on ${e.paymentDate}`].filter(Boolean).join(', ');
    await this.notify(
      [e.employeeId],
      'expense_status',
      `${e.claimNumber} paid`,
      `${formatExpenseAmount(e.amount ?? 0)} processed in Tally (voucher ${e.tallyRef})${pay ? `; ${pay}` : ''}.`,
      e.claimId,
    );
  }

  @OnEvent(EXPENSE_EVENTS.WITHDRAWN)
  async onWithdrawn(e: ClaimEvent) {
    if (!e.approverId) return;
    await this.notify([e.approverId], 'expense_status', `${e.claimNumber} withdrawn`, 'The employee withdrew this claim; no action is needed.', e.claimId);
  }

  @OnEvent(EXPENSE_EVENTS.APPROVER_REASSIGNED)
  async onReassigned(e: ClaimEvent) {
    await this.notify(
      [e.approverId],
      'expense_approval',
      `Expense claim ${e.claimNumber} reassigned to you`,
      `You are now the approver for ${formatExpenseAmount(e.amount ?? 0)}.`,
      e.claimId,
    );
  }

  /** Daily 09:30 IST nudge for claims pending longer than EXPENSE_REMINDER_AFTER_DAYS. */
  @Cron('30 9 * * *', { timeZone: 'Asia/Kolkata' })
  async remindStaleClaims() {
    const days = this.config.reminderAfterDays;
    const cutoff = sql<Date>`now() - (${days} || ' days')::interval`;
    const managerRows = await this.db
      .selectFrom('expense_claims')
      .select(['manager_id', sql<number>`count(*)::int`.as('n')])
      .where('status', '=', 'submitted')
      .where('deleted_at', 'is', null)
      .where('updated_at', '<', cutoff)
      .groupBy('manager_id')
      .execute();
    for (const r of managerRows) {
      if (!r.manager_id) continue;
      await this.notify([r.manager_id], 'expense_reminder', `${r.n} expense claim(s) waiting over ${days} days`, 'Please review your pending expense approvals.', null);
    }
    const acc = await this.db
      .selectFrom('expense_claims')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('status', 'in', ['accounts_review', 'accounts_approved'])
      .where('deleted_at', 'is', null)
      .where('updated_at', '<', cutoff)
      .executeTakeFirst();
    if (Number(acc?.n) > 0) {
      const users = await this.db.selectFrom('users').select('id').where('role', '=', 'accounts').where('is_active', '=', true).execute();
      for (const u of users) {
        await this.notify([u.id], 'expense_reminder', `${acc!.n} claim(s) waiting in the Accounts queue over ${days} days`, 'Please verify and process them.', null);
      }
    }
    this.logger.log(`Expense reminders sent (managers: ${managerRows.length}, accounts pending: ${acc?.n ?? 0}).`);
  }
}
