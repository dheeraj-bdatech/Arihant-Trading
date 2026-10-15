/**
 * Module 8 scheduled jobs (§8). All idempotent and safe to re-run: generation relies on the unique
 * (template_id, occurrence_date) key, stamps use "WHERE … IS NULL", and every notification claims a
 * dedupe key in task_notification_log first. Times are Asia/Kolkata.
 *
 *  - Recurring generator      hourly at :05, and once on startup
 *  - Overdue detector         every 15 minutes (stamps first_overdue_at, notifies once per deadline)
 *  - Deadline reminder        hourly at :10 (X hours before the deadline, once per deadline)
 *  - No-update detector       daily 10:00
 *  - Blocker / approval SLA   hourly at :20 (reminder after SLA, auto-escalation after 2× SLA; ends leave blockers)
 *  - Manager daily digest     daily 09:00
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'kysely';
import {
  formatTaskDateTime,
  istEndOfDay,
  planPauseResume,
  todayInKolkata,
} from '@arihant/shared';
import { TaskStore, TASK_EVENTS } from './task-store.service.js';
import { TaskGeneratorService } from './task-generator.service.js';
import { TaskNotificationsListener } from './task-notifications.listener.js';
import { TASK_CONFIG, type TaskConfig } from './task.config.js';

@Injectable()
export class TaskJobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskJobsService.name);
  private running = new Set<string>();

  constructor(
    private readonly store: TaskStore,
    private readonly generator: TaskGeneratorService,
    private readonly notifier: TaskNotificationsListener,
    @Inject(TASK_CONFIG) private readonly config: TaskConfig,
  ) {}

  private get db() {
    return this.store.db;
  }

  onApplicationBootstrap() {
    if (!this.config.jobsEnabled) return;
    // Catch up missed generation after downtime without delaying startup.
    setTimeout(() => void this.runGenerator(), 5000);
  }

  /** Prevents overlapping runs of the same job inside this process. */
  private async guard(name: string, fn: () => Promise<unknown>) {
    if (!this.config.jobsEnabled || this.running.has(name)) return;
    this.running.add(name);
    const started = Date.now();
    try {
      const result = await fn();
      this.logger.log(`[${name}] done in ${Date.now() - started}ms ${result ? JSON.stringify(result) : ''}`);
    } catch (err: any) {
      this.logger.error(`[${name}] failed: ${err.message}`, err.stack);
    } finally {
      this.running.delete(name);
    }
  }

  @Cron('5 * * * *', { timeZone: 'Asia/Kolkata' })
  runGenerator() {
    return this.guard('recurring-generator', () => this.generator.generateAll());
  }

  @Cron('*/15 * * * *', { timeZone: 'Asia/Kolkata' })
  runOverdue() {
    return this.guard('overdue-detector', () => this.overdue());
  }

  @Cron('10 * * * *', { timeZone: 'Asia/Kolkata' })
  runReminders() {
    return this.guard('deadline-reminder', () => this.reminders());
  }

  @Cron('0 10 * * *', { timeZone: 'Asia/Kolkata' })
  runNoUpdate() {
    return this.guard('no-update', () => this.noUpdate());
  }

  @Cron('20 * * * *', { timeZone: 'Asia/Kolkata' })
  runSla() {
    return this.guard('blocker-approval-sla', () => this.sla());
  }

  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  runDigest() {
    return this.guard('manager-digest', () => this.digest());
  }

  // ------------------------------------------------------------------ jobs (public for tests / manual runs)
  async overdue() {
    const stamped = await this.db
      .updateTable('tasks as t')
      .set({ first_overdue_at: new Date() })
      .where('t.first_overdue_at', 'is', null)
      .where(this.store.overdueSql())
      .returning('t.id')
      .execute();
    const rows = await this.db
      .selectFrom('tasks as t')
      .select(['t.id', 't.task_number', 't.title', 't.assigned_to', 't.deadline'])
      .where(this.store.overdueSql())
      .where('t.deadline', '>', new Date(Date.now() - 3 * 86400000))
      .execute();
    let notified = 0;
    for (const t of rows) {
      if (!(await this.notifier.claim(`overdue:${t.id}:${new Date(t.deadline!).toISOString()}`, t.id))) continue;
      const approvers = t.assigned_to ? (await this.store.access.resolveApprovers(t.assigned_to)).ids : [];
      await this.notifier.notify([t.assigned_to], 'task_overdue', `Overdue: ${t.task_number} · ${t.title}`, `The deadline (${formatTaskDateTime(t.deadline)}) has passed. Update progress, complete it, or raise a blocker if something is in your way.`, { type: 'task', id: t.id });
      await this.notifier.notify(approvers, 'task_overdue', `Team task overdue: ${t.task_number} · ${t.title}`, `Deadline ${formatTaskDateTime(t.deadline)} has passed.`, { type: 'task', id: t.id }, [t.assigned_to]);
      notified++;
    }
    return { stamped: stamped.length, notified };
  }

  async reminders() {
    const s = await this.store.masters.settings();
    const now = new Date();
    const until = new Date(now.getTime() + s.reminder_hours_before_deadline * 3600000);
    const rows = await this.db
      .selectFrom('tasks as t')
      .select(['t.id', 't.task_number', 't.title', 't.assigned_to', 't.deadline'])
      .where('t.status', 'in', ['not_started', 'in_progress'])
      .where('t.deadline', '>', now)
      .where('t.deadline', '<=', until)
      .execute();
    let sent = 0;
    for (const t of rows) {
      if (!(await this.notifier.claim(`reminder:${t.id}:${new Date(t.deadline!).toISOString()}`, t.id))) continue;
      const hours = Math.max(1, Math.round((new Date(t.deadline!).getTime() - now.getTime()) / 3600000));
      await this.notifier.notify([t.assigned_to], 'task_due', `Due in ${hours}h: ${t.task_number} · ${t.title}`, `Deadline ${formatTaskDateTime(t.deadline)}.`, { type: 'task', id: t.id });
      sent++;
    }
    return { sent };
  }

  async noUpdate() {
    const s = await this.store.masters.settings();
    const rows = await this.db
      .selectFrom('tasks as t')
      .select(['t.id', 't.task_number', 't.title', 't.assigned_to', 't.last_update_at', 't.priority'])
      .where(this.store.noUpdateSql(s))
      .execute();
    let sent = 0;
    for (const t of rows) {
      if (!(await this.notifier.claim(`noupdate:${t.id}:${t.last_update_at ? new Date(t.last_update_at).toISOString() : 'never'}`, t.id))) continue;
      await this.notifier.notify([t.assigned_to], 'task_no_update', `No update on ${t.task_number} · ${t.title}`, `Last update ${formatTaskDateTime(t.last_update_at)}. Post a progress note so your manager knows where it stands.`, { type: 'task', id: t.id });
      sent++;
    }
    return { sent, flagged: rows.length };
  }

  async sla() {
    const s = await this.store.masters.settings();
    const now = Date.now();
    const result = { blocker_reminders: 0, blocker_escalations: 0, approval_reminders: 0, approval_escalations: 0, leave_blockers_closed: 0 };

    // Blockers waiting on a manager decision.
    const pending = await this.db
      .selectFrom('task_blockers as b')
      .innerJoin('tasks as t', 't.id', 'b.task_id')
      .select(['b.id', 'b.task_id', 'b.created_at', 't.task_number', 't.title', 't.assigned_to'])
      .where('b.status', '=', 'pending_review')
      .where('b.created_at', '<', new Date(now - s.blocker_review_sla_hours * 3600000))
      .execute();
    for (const b of pending) {
      const age = (now - new Date(b.created_at).getTime()) / 3600000;
      const approvers = await this.store.access.resolveApprovers(b.assigned_to!);
      if (await this.notifier.claim(`blocker_sla_remind:${b.id}`, b.task_id)) {
        await this.notifier.notify(approvers.ids, 'task_blocked', `Blocker waiting ${Math.floor(age)}h: ${b.task_number}`, `"${b.title}" has a blocker pending your review beyond the ${s.blocker_review_sla_hours}h SLA. The waiting time is not counted against the employee.`, { type: 'task', id: b.task_id });
        result.blocker_reminders++;
      }
      if (age >= 2 * s.blocker_review_sla_hours && approvers.primary && (await this.notifier.claim(`blocker_sla_escalate:${b.id}`, b.task_id))) {
        if (await this.escalate(b.task_id, b.id, approvers.primary, `Blocker pending review for ${Math.floor(age)}h (SLA ${s.blocker_review_sla_hours}h).`)) result.blocker_escalations++;
      }
    }

    // Completed work waiting for approval.
    const waiting = await this.db
      .selectFrom('tasks as t')
      .select(['t.id', 't.task_number', 't.title', 't.assigned_to', 't.completed_at'])
      .where('t.status', '=', 'awaiting_approval')
      .where('t.completed_at', '<', new Date(now - s.approval_sla_hours * 3600000))
      .execute();
    for (const t of waiting) {
      const age = (now - new Date(t.completed_at!).getTime()) / 3600000;
      const approvers = await this.store.access.resolveApprovers(t.assigned_to!);
      const stamp = new Date(t.completed_at!).toISOString();
      if (await this.notifier.claim(`approval_remind:${t.id}:${stamp}`, t.id)) {
        await this.notifier.notify(approvers.ids, 'task_approval', `Approval waiting ${Math.floor(age)}h: ${t.task_number}`, `"${t.title}" is waiting for your approval beyond the ${s.approval_sla_hours}h SLA.`, { type: 'task', id: t.id });
        result.approval_reminders++;
      }
      if (age >= 2 * s.approval_sla_hours && approvers.primary && (await this.notifier.claim(`approval_escalate:${t.id}:${stamp}`, t.id))) {
        if (await this.escalate(t.id, null, approvers.primary, `Completion awaiting approval for ${Math.floor(age)}h (SLA ${s.approval_sla_hours}h).`)) result.approval_escalations++;
      }
    }

    result.leave_blockers_closed = await this.closeEndedLeaveBlockers();
    return result;
  }

  /** System escalation to the next active manager above the overdue reviewer. */
  private async escalate(taskId: string, blockerId: string | null, reviewerId: string, reason: string) {
    const above = (await this.store.access.managerChain(reviewerId)).find((c) => c.is_active);
    let target = above?.id ?? null;
    if (!target) {
      const mgmt = await this.db.selectFrom('users').select('id').where('role', '=', 'management').where('is_active', '=', true).where('id', '<>', reviewerId).orderBy('created_at').executeTakeFirst();
      target = mgmt?.id ?? null;
    }
    if (!target) return false;
    const task = await this.db.selectFrom('tasks').select(['task_number', 'title', 'assigned_to']).where('id', '=', taskId).executeTakeFirst();
    if (!task || target === task.assigned_to) return false;
    await this.db.transaction().execute(async (trx) => {
      const esc = await trx.insertInto('task_escalations').values({ task_id: taskId, blocker_id: blockerId, escalated_by: null, escalated_to: target!, reason }).returning('id').executeTakeFirstOrThrow();
      await this.store.log(trx, taskId, { kind: 'sla_escalated', author: null, comment: reason, metadata: { escalation_id: esc.id, to_user_id: target, blocker_id: blockerId } });
    });
    this.store.emit(TASK_EVENTS.ESCALATED, { taskId, taskNumber: task.task_number, title: task.title, escalatedToId: target, actorId: null, actorName: 'System (SLA)', comment: reason });
    return true;
  }

  /** Approved-leave blockers end with the leave: resolved at the end of the last leave day, blocked time credited. */
  private async closeEndedLeaveBlockers() {
    const today = todayInKolkata();
    const rows = await this.db
      .selectFrom('task_blockers as b')
      .innerJoin('employee_leaves as l', 'l.id', 'b.leave_id')
      .select(['b.id', 'b.task_id', 'b.created_at', 'b.previous_task_status', 'b.excused_minutes', 'l.to_date'])
      .where('b.status', '=', 'accepted')
      .where('b.blocker_type', '=', 'approved_leave')
      .where('l.to_date', '<', today)
      .execute();
    let closed = 0;
    for (const b of rows) {
      await this.db.transaction().execute(async (trx) => {
        const task = await this.store.lock(trx, b.task_id);
        const fresh = await trx.selectFrom('task_blockers').select('status').where('id', '=', b.id).forUpdate().executeTakeFirst();
        if (fresh?.status !== 'accepted') return;
        const resolvedAt = istEndOfDay(b.to_date as unknown as string);
        const patch: Record<string, unknown> = { status: task.status === 'blocked' ? b.previous_task_status || 'in_progress' : task.status, last_update_at: new Date() };
        let shift = 0;
        if (task.deadline) {
          const p = planPauseResume({ deadline: new Date(task.deadline), raised_at: new Date(b.created_at), resolved_at: resolvedAt });
          shift = p.shift_minutes;
          patch.deadline = p.new_deadline;
          patch.excused_delay_minutes = task.excused_delay_minutes + shift;
          await trx.insertInto('task_deadline_changes').values({ task_id: task.id, old_deadline: task.deadline, new_deadline: p.new_deadline, reason: 'Approved leave ended — blocked time added back', source: 'pause_resume', blocker_id: b.id, excused_minutes: shift }).execute();
        }
        await trx.updateTable('task_blockers').set({ status: 'resolved', resolved_at: resolvedAt, resolution_note: 'Leave ended (closed automatically)', excused_minutes: b.excused_minutes + shift }).where('id', '=', b.id).execute();
        await trx.updateTable('tasks').set({ ...(patch as any), version: sql`version + 1` }).where('id', '=', task.id).execute();
        await this.store.log(trx, task.id, { kind: 'blocker_resolved', author: null, comment: 'Approved leave ended — blocker closed and blocked time added to the deadline.', from: task.status, to: patch.status as string, metadata: { blocker_id: b.id, shift_minutes: shift } });
        closed++;
      });
    }
    return closed;
  }

  async digest() {
    const s = await this.store.masters.settings();
    const today = todayInKolkata();
    const managers = await this.db
      .selectFrom('users as m')
      .select(['m.id', 'm.full_name'])
      .where('m.is_active', '=', true)
      .where((eb) => eb.or([eb.exists(eb.selectFrom('users as u').select('u.id').whereRef('u.reporting_manager_id', '=', 'm.id').where('u.is_active', '=', true)), eb.exists(eb.selectFrom('departments as d').select('d.id').whereRef('d.head_user_id', '=', 'm.id'))]))
      .execute();
    let sent = 0;
    for (const m of managers) {
      const team = await this.store.access.teamIds(m as any, s);
      if (!team.length) continue;
      const counts = await this.db
        .selectFrom('tasks as t')
        .select([
          sql<number>`count(*) filter (where t.status in ('not_started', 'in_progress', 'blocked') and t.deadline >= ${new Date(`${today}T00:00:00+05:30`)} and t.deadline <= ${istEndOfDay(today)})::int`.as('due_today'),
          sql<number>`count(*) filter (where ${this.store.overdueSql()})::int`.as('overdue'),
          sql<number>`count(*) filter (where ${this.store.noUpdateSql(s)})::int`.as('no_update'),
          sql<number>`count(*) filter (where t.status = 'awaiting_approval')::int`.as('approvals'),
          sql<number>`count(*) filter (where exists (select 1 from task_blockers b where b.task_id = t.id and b.status = 'pending_review'))::int`.as('blockers'),
        ])
        .where('t.assigned_to', 'in', team)
        .executeTakeFirst();
      const c = counts as any;
      const total = Number(c?.due_today) + Number(c?.overdue) + Number(c?.no_update) + Number(c?.approvals) + Number(c?.blockers);
      if (!total) continue;
      if (!(await this.notifier.claim(`digest:${m.id}:${today}`, null, m.id))) continue;
      await this.notifier.notify(
        [m.id],
        'task_digest',
        `Team tasks today: ${c.overdue} overdue, ${c.due_today} due today`,
        `Due today ${c.due_today} · Overdue ${c.overdue} · Blockers to review ${c.blockers} · Approvals pending ${c.approvals} · No recent update ${c.no_update}.`,
        { type: 'task_digest', id: null },
      );
      sent++;
    }
    return { managers: managers.length, sent };
  }
}
