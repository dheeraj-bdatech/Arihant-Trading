/**
 * Accountability dashboard (§10 / Blueprint §42): per employee and in total — tasks due, overdue, without
 * updates, repeated delays, incomplete work (rework/reopen), approved blockers and unapproved delays — for
 * a scope (my team / department / all) and period. Each count maps to a task-list filter for drill-down.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  addIsoDays,
  istEndOfDay,
  isIsoDateString,
  minutesToDays,
  todayInKolkata,
  type AuthUser,
} from '@arihant/shared';
import { TaskStore } from './task-store.service.js';
import { UUID_RE } from './task-common.js';
import { blockerSummary, classify, type ClassifiedTask, type MetricBlocker, type MetricTask } from './task-metrics.js';

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

@Injectable()
export class TaskAccountabilityService {
  constructor(private readonly store: TaskStore) {}

  private get db() {
    return this.store.db;
  }

  private async scopeEmployees(query: Record<string, unknown>, user: AuthUser) {
    const s = await this.store.masters.settings();
    const all = this.store.access.canViewAll(user);
    const scope = query.scope === 'department' ? 'department' : query.scope === 'all' ? 'all' : query.scope === 'team' ? 'team' : all ? 'all' : 'team';
    let ids: string[] | null = null;
    if (scope === 'all') {
      if (!all) throw new ForbiddenException('Company-wide accountability is limited to management, admin and accounts.');
    } else if (scope === 'department') {
      const deptId = typeof query.department_id === 'string' && UUID_RE.test(query.department_id) ? query.department_id : null;
      const heads = await this.db.selectFrom('departments').select('id').where('head_user_id', '=', user.id).execute();
      const dept = deptId ?? heads[0]?.id ?? null;
      if (!dept) throw new ForbiddenException('Choose a department you head.');
      if (!all && !heads.some((h) => h.id === dept)) throw new ForbiddenException('You can only view departments you head.');
      ids = (await this.db.selectFrom('users').select('id').where('department_id', '=', dept).execute()).map((r) => r.id);
    } else {
      ids = await this.store.access.teamIds(user, s);
    }
    return { scope, ids, s };
  }

  async dashboard(query: Record<string, unknown>, user: AuthUser) {
    const { scope, ids, s } = await this.scopeEmployees(query, user);
    const today = todayInKolkata();
    const from = isIsoDateString(query.from) ? (query.from as string) : `${today.slice(0, 7)}-01`;
    const to = isIsoDateString(query.to) ? (query.to as string) : today;
    const fromTs = istStart(from);
    const toTs = istEndOfDay(to);
    const windowStart = new Date(Date.now() - s.repeated_delay_window_days * 86400000);
    const weekEnd = istEndOfDay(addIsoDays(today, 6));
    const now = new Date();

    let uq = this.db
      .selectFrom('users as u')
      .leftJoin('departments as d', 'd.id', 'u.department_id')
      .leftJoin('users as m', 'm.id', 'u.reporting_manager_id')
      .select(['u.id', 'u.full_name', 'u.role', 'u.is_active', 'd.name as department_name', 'm.full_name as manager_name']);
    if (ids) uq = ids.length ? uq.where('u.id', 'in', ids) : uq.where(sql<boolean>`false`);
    else uq = uq.where((eb) => eb.or([eb('u.is_active', '=', true), eb.exists(eb.selectFrom('tasks').select('id').whereRef('tasks.assigned_to', '=', 'u.id').where('tasks.status', 'in', ['not_started', 'in_progress', 'blocked']))]));
    const employees = await uq.orderBy('u.full_name').execute();
    const empIds = employees.map((e) => e.id);
    if (!empIds.length) return { scope, period: { from, to }, settings: this.publicSettings(s), totals: this.emptyRow(), employees: [], trend: [] };

    const tasksRaw = await this.db
      .selectFrom('tasks as t')
      .select([
        't.id',
        't.task_number',
        't.title',
        't.assigned_to',
        't.status',
        't.priority',
        't.template_id',
        't.deadline',
        't.original_deadline',
        't.completed_at',
        't.unexcused_locked_minutes',
        't.extension_count',
        't.rework_count',
        't.reopen_count',
        't.is_backlog',
        't.generated_late',
        't.last_update_at',
        sql<string | null>`null`.as('category_name'),
        sql<Date | null>`(select b.created_at from task_blockers b where b.task_id = t.id and b.status = 'accepted' limit 1)`.as('accepted_blocker_raised_at'),
      ])
      .where('t.assigned_to', 'in', empIds)
      .where((eb) =>
        eb.or([
          eb('t.status', 'in', ['not_started', 'in_progress', 'blocked', 'awaiting_approval']),
          sql<boolean>`coalesce(t.original_deadline, t.deadline) between ${fromTs} and ${toTs}`,
          eb('t.completed_at', '>=', windowStart < fromTs ? windowStart : fromTs),
        ]),
      )
      .execute();
    const tasks = tasksRaw.map((t: any) => classify(t as MetricTask, s, now));
    const blockers = (await this.db
      .selectFrom('task_blockers as b')
      .innerJoin('tasks as t', 't.id', 'b.task_id')
      .select(['b.id', 'b.task_id', 'b.blocker_type', 'b.status', 'b.decision', 'b.raised_after_deadline', 'b.requested_new_deadline', 'b.excused_minutes', 'b.created_at', 't.assigned_to'])
      .where('t.assigned_to', 'in', empIds)
      .where('b.created_at', '>=', fromTs)
      .where('b.created_at', '<=', toTs)
      .execute()) as unknown as (MetricBlocker & { assigned_to: string })[];

    const inPeriod = (t: ClassifiedTask) => {
      const due = t.original_deadline ?? t.deadline;
      return due ? new Date(due) >= fromTs && new Date(due) <= toTs : false;
    };
    const rowFor = (empTasks: ClassifiedTask[], empBlockers: MetricBlocker[]) => {
      const open = empTasks.filter((t) => ['not_started', 'in_progress', 'blocked'].includes(t.status));
      const period = empTasks.filter((t) => inPeriod(t) && !t.excluded);
      const lateWindow = empTasks.filter((t) => !t.excluded && t.delay_class === 'late_unexcused' && t.completed_at && new Date(t.completed_at) >= windowStart);
      const excessive = empTasks.filter((t) => t.status !== 'cancelled' && t.extension_count > s.max_extensions_before_flag);
      const b = blockerSummary(empBlockers);
      const lateUnexcused = period.filter((t) => t.delay_class === 'late_unexcused').length;
      const done = period.filter((t) => ['on_time', 'late_excused', 'late_unexcused'].includes(t.delay_class || ''));
      return {
        due_today: open.filter((t) => t.deadline && new Date(t.deadline) >= istStart(today) && new Date(t.deadline) <= istEndOfDay(today)).length,
        due_this_week: open.filter((t) => t.deadline && new Date(t.deadline) >= now && new Date(t.deadline) <= weekEnd).length,
        overdue: open.filter((t) => t.is_overdue).length,
        no_update: open.filter((t) => t.no_update).length,
        late_unexcused_window: lateWindow.length,
        excessive_extension_tasks: excessive.length,
        repeated_delay_flag: lateWindow.length >= s.repeated_delay_threshold || excessive.length > 0,
        incomplete_work: period.filter((t) => t.rework_count > 0 || t.reopen_count > 0).length,
        approved_blockers: b.accepted,
        approved_blockers_by_type: b.accepted_by_type,
        rejected_blockers: b.rejected,
        unapproved_delays: lateUnexcused + period.filter((t) => t.delay_class === 'open_overdue').length + b.rejected,
        assigned: period.length,
        completed: done.length,
        on_time: period.filter((t) => t.delay_class === 'on_time').length,
        late_excused: period.filter((t) => t.delay_class === 'late_excused').length,
        late_unexcused: lateUnexcused,
        open_overdue: period.filter((t) => t.delay_class === 'open_overdue').length,
        on_time_pct: done.length ? Math.round((period.filter((t) => t.delay_class === 'on_time').length / done.length) * 1000) / 10 : null,
        unexcused_delay_days: minutesToDays(period.reduce((a, t) => a + (t.delay_class === 'open' ? 0 : t.unexcused_delay_minutes), 0)),
      };
    };

    const rows = employees.map((e) => ({
      employee_id: e.id,
      name: e.full_name,
      role: e.role,
      is_active: e.is_active,
      department: e.department_name,
      manager: e.manager_name,
      ...rowFor(tasks.filter((t) => t.assigned_to === e.id), blockers.filter((b) => b.assigned_to === e.id)),
    }));
    const totals = rowFor(tasks, blockers);
    // Weekly on-time trend for the period (completed tasks by IST week of completion).
    const trend: Record<string, { week: string; on_time: number; late_excused: number; late_unexcused: number }> = {};
    for (const t of tasks) {
      if (t.excluded || !t.completed_at || !['on_time', 'late_excused', 'late_unexcused'].includes(t.delay_class || '')) continue;
      const c = new Date(t.completed_at);
      if (c < fromTs || c > toTs) continue;
      const d = new Date(c.getTime() + 330 * 60000);
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
      const key = monday.toISOString().slice(0, 10);
      trend[key] = trend[key] || { week: key, on_time: 0, late_excused: 0, late_unexcused: 0 };
      (trend[key] as any)[t.delay_class!]++;
    }
    this.store.audit(user, 'accountability_dashboard', user.id, 'accountability_view', undefined, { scope, from, to });
    return {
      scope,
      period: { from, to },
      settings: this.publicSettings(s),
      totals,
      employees: rows,
      trend: Object.values(trend).sort((a, b) => a.week.localeCompare(b.week)),
    };
  }

  private emptyRow() {
    return { due_today: 0, due_this_week: 0, overdue: 0, no_update: 0, late_unexcused_window: 0, excessive_extension_tasks: 0, repeated_delay_flag: false, incomplete_work: 0, approved_blockers: 0, approved_blockers_by_type: {}, rejected_blockers: 0, unapproved_delays: 0, assigned: 0, completed: 0, on_time: 0, late_excused: 0, late_unexcused: 0, open_overdue: 0, on_time_pct: null, unexcused_delay_days: 0 };
  }

  private publicSettings(s: any) {
    return {
      repeated_delay_threshold: s.repeated_delay_threshold,
      repeated_delay_window_days: s.repeated_delay_window_days,
      max_extensions_before_flag: s.max_extensions_before_flag,
      no_update_days: { critical: s.no_update_days_critical, high: s.no_update_days_high, medium: s.no_update_days_medium, low: s.no_update_days_low },
    };
  }

  /** Flagged items by type, role-scoped. */
  async flags(query: Record<string, unknown>, user: AuthUser) {
    const { ids, s } = await this.scopeEmployees(query, user);
    if (ids && !ids.length) return {};
    const empFilter = (col: string) => (ids ? (ids.length ? sql<boolean>`${sql.ref(col)} in (${sql.join(ids)})` : sql<boolean>`false`) : sql<boolean>`true`);
    const type = typeof query.type === 'string' ? query.type : null;
    const want = (t: string) => !type || type === t;
    const out: Record<string, any[]> = {};
    const base = () =>
      this.db
        .selectFrom('tasks as t')
        .leftJoin('users as emp', 'emp.id', 't.assigned_to')
        .select(['t.id', 't.task_number', 't.title', 't.status', 't.priority', 't.deadline', 't.last_update_at', 't.extension_count', 't.rework_count', 't.reopen_count', 't.assigned_to', 'emp.full_name as assignee_name'])
        .where(empFilter('t.assigned_to'));
    if (want('overdue')) out.overdue = await base().where(this.store.overdueSql()).orderBy('t.deadline').limit(200).execute();
    if (want('no_update')) out.no_update = await base().where(this.store.noUpdateSql(s)).orderBy('t.last_update_at').limit(200).execute();
    if (want('excessive_extensions')) out.excessive_extensions = await base().where('t.status', '<>', 'cancelled').where('t.extension_count', '>', s.max_extensions_before_flag).limit(200).execute();
    if (want('rework')) out.rework = await base().where('t.status', '<>', 'cancelled').where((eb) => eb.or([eb('t.rework_count', '>', 0), eb('t.reopen_count', '>', 0)])).orderBy('t.updated_at', 'desc').limit(200).execute();
    const blockerBase = () =>
      this.db
        .selectFrom('task_blockers as b')
        .innerJoin('tasks as t', 't.id', 'b.task_id')
        .leftJoin('users as emp', 'emp.id', 't.assigned_to')
        .select(['b.id', 'b.task_id', 'b.blocker_type', 'b.status', 'b.created_at', 'b.raised_after_deadline', 'b.decision_comment', 't.task_number', 't.title', 'emp.full_name as assignee_name', 't.assigned_to'])
        .where(empFilter('t.assigned_to'));
    if (want('blocker_after_deadline')) out.blocker_after_deadline = await blockerBase().where('b.raised_after_deadline', '=', true).orderBy('b.created_at', 'desc').limit(200).execute();
    if (want('rejected_blocker')) out.rejected_blocker = await blockerBase().where('b.status', '=', 'rejected').orderBy('b.created_at', 'desc').limit(200).execute();
    if (want('blocker_sla')) {
      out.blocker_sla = await blockerBase()
        .where('b.status', '=', 'pending_review')
        .where('b.created_at', '<', new Date(Date.now() - s.blocker_review_sla_hours * 3600000))
        .orderBy('b.created_at')
        .limit(200)
        .execute();
    }
    if (want('repeated_blocker')) {
      out.repeated_blocker = await this.db
        .selectFrom('task_blockers as b')
        .innerJoin('tasks as t', 't.id', 'b.task_id')
        .leftJoin('users as emp', 'emp.id', 't.assigned_to')
        .select(['t.id', 't.task_number', 't.title', 'b.blocker_type', 'emp.full_name as assignee_name', sql<number>`count(*)::int`.as('count')])
        .where(empFilter('t.assigned_to'))
        .groupBy(['t.id', 't.task_number', 't.title', 'b.blocker_type', 'emp.full_name'])
        .having(sql<number>`count(*)`, '>=', s.repeated_blocker_threshold)
        .execute();
    }
    if (want('repeated_delay')) {
      const since = new Date(Date.now() - s.repeated_delay_window_days * 86400000);
      out.repeated_delay = await this.db
        .selectFrom('tasks as t')
        .innerJoin('users as emp', 'emp.id', 't.assigned_to')
        .select(['t.assigned_to as employee_id', 'emp.full_name as name', sql<number>`count(*)::int`.as('late_unexcused')])
        .where(empFilter('t.assigned_to'))
        .where('t.completed_at', '>=', since)
        .where('t.is_backlog', '=', false)
        .where('t.generated_late', '=', false)
        .where(this.store.delayClassSql('late_unexcused'))
        .groupBy(['t.assigned_to', 'emp.full_name'])
        .having(sql<number>`count(*)`, '>=', s.repeated_delay_threshold)
        .execute();
    }
    return out;
  }
}
