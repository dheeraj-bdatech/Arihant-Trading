/**
 * Module 8 masters: task settings (thresholds/SLAs), categories, holiday calendar, approved-leave register,
 * department heads — plus the per-employee working calendar used by recurrence, warnings and leave checks.
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import {
  TASK_HOLIDAY_POLICIES,
  addIsoDays,
  isoWeekday,
  todayInKolkata,
  type AuthUser,
  type Database,
  type TaskHolidayPolicy,
  type TaskLeavePolicy,
} from '@arihant/shared';
import { TASK_DB } from './task-db.js';
import {
  TaskValidationException,
  UUID_RE,
  readBool,
  readComment,
  readDate,
  readEnum,
  readInt,
  readText,
  readUuid,
  throwIfErrors,
  type FieldErrors,
} from './task-common.js';

export interface TaskSettings {
  no_update_days_critical: number;
  no_update_days_high: number;
  no_update_days_medium: number;
  no_update_days_low: number;
  repeated_delay_threshold: number;
  repeated_delay_window_days: number;
  max_extensions_before_flag: number;
  repeated_blocker_threshold: number;
  blocker_review_sla_hours: number;
  approval_sla_hours: number;
  reminder_hours_before_deadline: number;
  allow_self_tasks: boolean;
  allow_indirect_reports: boolean;
  allow_peer_linked_assignment: boolean;
  auto_accept_leave_blockers: boolean;
  evidence_period_basis: 'deadline' | 'completion';
  review_rating_scale: number;
  weekly_off_days: number[];
  default_holiday_policy: TaskHolidayPolicy;
  default_leave_policy: TaskLeavePolicy;
  fallback_approver_role: 'management' | 'admin';
  horizon_days_daily: number;
  horizon_days_weekly: number;
  horizon_days_monthly: number;
  hard_delete_window_minutes: number;
  updated_at?: Date;
}

const INT_SETTINGS: Record<string, [number, number, string]> = {
  no_update_days_critical: [1, 60, 'No-update threshold (critical)'],
  no_update_days_high: [1, 60, 'No-update threshold (high)'],
  no_update_days_medium: [1, 60, 'No-update threshold (medium)'],
  no_update_days_low: [1, 60, 'No-update threshold (low)'],
  repeated_delay_threshold: [1, 50, 'Repeated delay threshold'],
  repeated_delay_window_days: [1, 365, 'Repeated delay window'],
  max_extensions_before_flag: [0, 20, 'Max extensions before flag'],
  repeated_blocker_threshold: [1, 20, 'Repeated blocker threshold'],
  blocker_review_sla_hours: [1, 720, 'Blocker review SLA'],
  approval_sla_hours: [1, 720, 'Approval SLA'],
  reminder_hours_before_deadline: [1, 336, 'Reminder before deadline'],
  review_rating_scale: [3, 10, 'Review rating scale'],
  horizon_days_daily: [1, 60, 'Daily generation horizon'],
  horizon_days_weekly: [1, 120, 'Weekly generation horizon'],
  horizon_days_monthly: [1, 400, 'Monthly generation horizon'],
  hard_delete_window_minutes: [0, 120, 'Delete window'],
};
const BOOL_SETTINGS = ['allow_self_tasks', 'allow_indirect_reports', 'allow_peer_linked_assignment', 'auto_accept_leave_blockers'];

export interface WorkingCalendar {
  isNonWorkingDay(userId: string, date: string): boolean;
  holidayName(userId: string, date: string): string | null;
  leaveOn(userId: string, date: string): { id: string; leave_type: string; from_date: string; to_date: string } | null;
}

export const isAdminLike = (user: Pick<AuthUser, 'role'>) => user.role === 'admin' || user.role === 'management';

@Injectable()
export class TaskMastersService {
  private cache: { at: number; value: TaskSettings } | null = null;

  constructor(
    @Inject(TASK_DB) readonly db: Kysely<Database>,
    private readonly events: EventEmitter2,
  ) {}

  // ========================================================================== settings
  async settings(fresh = false): Promise<TaskSettings> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 15000) return this.cache.value;
    const row = await this.db.selectFrom('task_settings').selectAll().where('id', '=', 1).executeTakeFirst();
    if (!row) {
      await this.db.insertInto('task_settings').values({ id: 1 } as any).onConflict((oc) => oc.column('id').doNothing()).execute();
      return this.settings(true);
    }
    const value = { ...(row as any), weekly_off_days: (row.weekly_off_days || []).map(Number) } as TaskSettings;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async updateSettings(dto: Record<string, unknown>, user: AuthUser) {
    if (user.role !== 'admin') throw new ForbiddenException('Only an administrator can change task settings.');
    const errors: FieldErrors = {};
    const patch: Record<string, unknown> = {};
    for (const [k, [min, max, label]] of Object.entries(INT_SETTINGS)) {
      if (dto[k] === undefined) continue;
      const v = readInt(errors, k, dto[k], { min, max, label });
      if (v !== null) patch[k] = v;
    }
    for (const k of BOOL_SETTINGS) if (dto[k] !== undefined) patch[k] = readBool(dto[k]);
    if (dto.evidence_period_basis !== undefined) patch.evidence_period_basis = readEnum(errors, 'evidence_period_basis', dto.evidence_period_basis, ['deadline', 'completion'] as const, { label: 'Evidence period basis', required: true });
    if (dto.default_holiday_policy !== undefined) patch.default_holiday_policy = readEnum(errors, 'default_holiday_policy', dto.default_holiday_policy, TASK_HOLIDAY_POLICIES, { label: 'Holiday policy', required: true });
    if (dto.default_leave_policy !== undefined) patch.default_leave_policy = readEnum(errors, 'default_leave_policy', dto.default_leave_policy, ['skip', 'keep'] as const, { label: 'Leave policy', required: true });
    if (dto.fallback_approver_role !== undefined) patch.fallback_approver_role = readEnum(errors, 'fallback_approver_role', dto.fallback_approver_role, ['management', 'admin'] as const, { label: 'Fallback approver role', required: true });
    if (dto.weekly_off_days !== undefined) {
      const days = Array.isArray(dto.weekly_off_days) ? Array.from(new Set(dto.weekly_off_days.map(Number))) : null;
      if (!days || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || days.length > 3) errors.weekly_off_days = 'Pick up to three weekly off days (0 = Sunday … 6 = Saturday).';
      else patch.weekly_off_days = sql`${sql.raw(`'{${days.sort().join(',')}}'`)}::integer[]`;
    }
    throwIfErrors(errors);
    if (!Object.keys(patch).length) return this.settings(true);
    const before = await this.settings(true);
    await this.db.updateTable('task_settings').set({ ...(patch as any), updated_at: new Date(), updated_by: user.id }).where('id', '=', 1).execute();
    this.cache = null;
    const after = await this.settings(true);
    this.events.emit('audit.log', { actorId: user.id, entityType: 'task_settings', entityId: '00000000-0000-0000-0000-000000000001', action: 'task_settings_update', previousValue: before, newValue: after });
    return after;
  }

  // ========================================================================== categories
  async listCategories(includeInactive: boolean) {
    let q = this.db.selectFrom('task_categories').selectAll().orderBy('display_order').orderBy('name');
    if (!includeInactive) q = q.where('is_active', '=', true);
    return q.execute();
  }

  private readCategory(dto: Record<string, unknown>, partial: boolean) {
    const errors: FieldErrors = {};
    const out: Record<string, unknown> = {};
    if (!partial || dto.code !== undefined) {
      const code = typeof dto.code === 'string' ? dto.code.trim().toUpperCase() : '';
      if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) errors.code = 'Code must be 2–30 capital letters, digits or underscores.';
      else out.code = code;
    }
    if (!partial || dto.name !== undefined) out.name = readText(errors, 'name', dto.name, 80, { required: true, label: 'Name' });
    if (dto.requires_link_type !== undefined) {
      out.requires_link_type = dto.requires_link_type === null || dto.requires_link_type === '' ? null : readEnum(errors, 'requires_link_type', dto.requires_link_type, ['customer', 'tender', 'demo', 'service'] as const, { label: 'Required link' });
    }
    if (dto.default_evidence_required !== undefined) out.default_evidence_required = readBool(dto.default_evidence_required);
    if (dto.is_active !== undefined) out.is_active = readBool(dto.is_active, true);
    if (dto.display_order !== undefined) out.display_order = readInt(errors, 'display_order', dto.display_order, { min: 0, max: 999, label: 'Display order' }) ?? 0;
    throwIfErrors(errors);
    return out;
  }

  async createCategory(dto: Record<string, unknown>, user: AuthUser) {
    const values = this.readCategory(dto, false);
    const dup = await this.db.selectFrom('task_categories').select('id').where('code', '=', values.code as string).executeTakeFirst();
    if (dup) throw new TaskValidationException({ code: 'A category with this code already exists.' });
    const row = await this.db.insertInto('task_categories').values({ ...(values as any), created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'task_category', entityId: row.id, action: 'task_category_create', newValue: row });
    return row;
  }

  async updateCategory(id: string, dto: Record<string, unknown>, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Category not found');
    const before = await this.db.selectFrom('task_categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new NotFoundException('Category not found');
    const values = this.readCategory(dto, true);
    if (values.code && values.code !== before.code) throw new TaskValidationException({ code: 'The code of an existing category cannot change (tasks reference it).' });
    const row = await this.db.updateTable('task_categories').set({ ...(values as any), updated_by: user.id }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'task_category', entityId: id, action: 'task_category_update', previousValue: before, newValue: row });
    return row;
  }

  // ========================================================================== holidays
  async listHolidays(from?: string, to?: string) {
    let q = this.db
      .selectFrom('holidays as h')
      .leftJoin('regions as r', 'r.id', 'h.region_id')
      .selectAll('h')
      .select('r.name as region_name')
      .where('h.is_active', '=', true)
      .orderBy('h.holiday_date');
    if (from) q = q.where('h.holiday_date', '>=', from);
    if (to) q = q.where('h.holiday_date', '<=', to);
    return q.execute();
  }

  async createHoliday(dto: Record<string, unknown>, user: AuthUser) {
    if (user.role !== 'admin' && user.role !== 'management') throw new ForbiddenException('Only admin or management can maintain the holiday calendar.');
    const errors: FieldErrors = {};
    const holiday_date = readDate(errors, 'holiday_date', dto.holiday_date, { required: true, label: 'Date' });
    const name = readText(errors, 'name', dto.name, 120, { required: true, label: 'Name' });
    const region_id = readUuid(errors, 'region_id', dto.region_id, { label: 'Region' });
    throwIfErrors(errors);
    const dup = await this.db
      .selectFrom('holidays')
      .select('id')
      .where('holiday_date', '=', holiday_date!)
      .where(sql<boolean>`coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${region_id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .executeTakeFirst();
    if (dup) {
      const row = await this.db.updateTable('holidays').set({ name: name!, is_active: true, updated_by: user.id }).where('id', '=', dup.id).returningAll().executeTakeFirstOrThrow();
      return row;
    }
    const row = await this.db.insertInto('holidays').values({ holiday_date: holiday_date!, name: name!, region_id, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'holiday', entityId: row.id, action: 'holiday_create', newValue: row });
    return row;
  }

  async removeHoliday(id: string, user: AuthUser) {
    if (user.role !== 'admin' && user.role !== 'management') throw new ForbiddenException('Only admin or management can maintain the holiday calendar.');
    if (!UUID_RE.test(id)) throw new NotFoundException('Holiday not found');
    const row = await this.db.updateTable('holidays').set({ is_active: false, updated_by: user.id }).where('id', '=', id).returningAll().executeTakeFirst();
    if (!row) throw new NotFoundException('Holiday not found');
    this.events.emit('audit.log', { actorId: user.id, entityType: 'holiday', entityId: id, action: 'holiday_remove', previousValue: row });
    return { id, removed: true };
  }

  // ========================================================================== departments
  async listDepartments() {
    return this.db
      .selectFrom('departments as d')
      .leftJoin('users as h', 'h.id', 'd.head_user_id')
      .select(['d.id', 'd.code', 'd.name', 'd.head_user_id', 'h.full_name as head_name'])
      .orderBy('d.name')
      .execute();
  }

  async setDepartmentHead(id: string, dto: Record<string, unknown>, user: AuthUser) {
    if (user.role !== 'admin') throw new ForbiddenException('Only an administrator can set department heads.');
    if (!UUID_RE.test(id)) throw new NotFoundException('Department not found');
    const errors: FieldErrors = {};
    const headId = readUuid(errors, 'head_user_id', dto.head_user_id, { label: 'Department head' });
    throwIfErrors(errors);
    if (headId) {
      const u = await this.db.selectFrom('users').select(['is_active']).where('id', '=', headId).executeTakeFirst();
      if (!u?.is_active) throw new TaskValidationException({ head_user_id: 'Choose an active user.' });
    }
    const before = await this.db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw new NotFoundException('Department not found');
    await this.db.updateTable('departments').set({ head_user_id: headId } as any).where('id', '=', id).execute();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'department', entityId: id, action: 'department_head_set', previousValue: { head_user_id: before.head_user_id }, newValue: { head_user_id: headId } });
    return (await this.listDepartments()).find((d) => d.id === id);
  }

  async setUserDepartment(userId: string, dto: Record<string, unknown>, user: AuthUser) {
    if (user.role !== 'admin') throw new ForbiddenException('Only an administrator can change an employee’s department.');
    if (!UUID_RE.test(userId)) throw new NotFoundException('User not found');
    const errors: FieldErrors = {};
    const departmentId = readUuid(errors, 'department_id', dto.department_id, { label: 'Department', required: true });
    throwIfErrors(errors);
    const before = await this.db.selectFrom('users').select(['id', 'department_id']).where('id', '=', userId).executeTakeFirst();
    if (!before) throw new NotFoundException('User not found');
    // Existing tasks keep their department snapshot; only new tasks use the new department (§7.30).
    await this.db.updateTable('users').set({ department_id: departmentId } as any).where('id', '=', userId).execute();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'user', entityId: userId, action: 'user_department_change', previousValue: { department_id: before.department_id }, newValue: { department_id: departmentId } });
    return { id: userId, department_id: departmentId };
  }

  // ========================================================================== leave register
  private async canManageLeaveFor(user: AuthUser, employeeId: string): Promise<boolean> {
    if (isAdminLike(user)) return true;
    if (employeeId === user.id) return false; // nobody records (approves) their own leave
    const sub = await sql<{ id: string }>`select user_subordinate_ids(${user.id}) as id`.execute(this.db);
    if (sub.rows.some((r) => r.id === employeeId)) return true;
    const head = await this.db
      .selectFrom('users as u')
      .innerJoin('departments as d', 'd.id', 'u.department_id')
      .select('u.id')
      .where('u.id', '=', employeeId)
      .where('d.head_user_id', '=', user.id)
      .executeTakeFirst();
    return Boolean(head);
  }

  async listLeaves(query: Record<string, unknown>, user: AuthUser) {
    let q = this.db
      .selectFrom('employee_leaves as l')
      .innerJoin('users as e', 'e.id', 'l.employee_id')
      .leftJoin('users as a', 'a.id', 'l.approved_by')
      .selectAll('l')
      .select(['e.full_name as employee_name', 'a.full_name as approved_by_name'])
      .orderBy('l.from_date', 'desc')
      .limit(500);
    if (!isAdminLike(user) && user.role !== 'accounts') {
      q = q.where((eb) =>
        eb.or([
          eb('l.employee_id', '=', user.id),
          eb('l.employee_id', 'in', sql<string>`(select user_subordinate_ids(${user.id}))`),
          eb('e.department_id', 'in', sql<string>`(select id from departments where head_user_id = ${user.id})`),
        ]),
      );
    }
    if (typeof query.employee_id === 'string' && UUID_RE.test(query.employee_id)) q = q.where('l.employee_id', '=', query.employee_id);
    if (query.include_cancelled !== 'true') q = q.where('l.status', '=', 'approved');
    if (typeof query.from === 'string' && query.from) q = q.where('l.to_date', '>=', query.from);
    if (typeof query.to === 'string' && query.to) q = q.where('l.from_date', '<=', query.to);
    return q.execute();
  }

  async createLeave(dto: Record<string, unknown>, user: AuthUser) {
    const errors: FieldErrors = {};
    const employeeId = readUuid(errors, 'employee_id', dto.employee_id, { required: true, label: 'Employee' });
    const from = readDate(errors, 'from_date', dto.from_date, { required: true, label: 'From' });
    const to = readDate(errors, 'to_date', dto.to_date, { required: true, label: 'To' });
    const leaveType = readEnum(errors, 'leave_type', dto.leave_type, ['casual', 'sick', 'earned', 'comp_off', 'other'] as const, { label: 'Leave type', fallback: 'casual' });
    const reason = readText(errors, 'reason', dto.reason, 500, { label: 'Reason' });
    if (from && to && from > to) errors.to_date = '"To" must be on or after "From".';
    if (from && to && (Date.parse(to) - Date.parse(from)) / 86400000 > 120) errors.to_date = 'A single leave entry can cover at most 120 days.';
    throwIfErrors(errors);
    const emp = await this.db.selectFrom('users').select(['id', 'is_active', 'full_name']).where('id', '=', employeeId!).executeTakeFirst();
    if (!emp) throw new TaskValidationException({ employee_id: 'Employee not found.' });
    if (!(await this.canManageLeaveFor(user, employeeId!))) {
      throw new ForbiddenException(employeeId === user.id ? 'Your leave must be recorded by your manager.' : 'You can only record leave for your own team.');
    }
    const overlap = await this.db
      .selectFrom('employee_leaves')
      .select(['id', 'from_date', 'to_date'])
      .where('employee_id', '=', employeeId!)
      .where('status', '=', 'approved')
      .where('from_date', '<=', to!)
      .where('to_date', '>=', from!)
      .executeTakeFirst();
    if (overlap) throw new TaskValidationException({ from_date: `Overlaps approved leave ${overlap.from_date} → ${overlap.to_date}.` });

    const row = await this.db.transaction().execute(async (trx) => {
      const leave = await trx
        .insertInto('employee_leaves')
        .values({ employee_id: employeeId!, from_date: from!, to_date: to!, leave_type: leaveType!, reason, approved_by: user.id, created_by: user.id, updated_by: user.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      // Recurring instances already generated for leave days (leave_policy = skip) are skipped, never "missed".
      const instances = await trx
        .selectFrom('tasks as t')
        .innerJoin('task_templates as tp', 'tp.id', 't.template_id')
        .select(['t.id', 't.template_id', 't.occurrence_date', 't.status'])
        .where('t.assigned_to', '=', employeeId!)
        .where('tp.leave_policy', '=', 'skip')
        .where('t.status', '=', 'not_started')
        .where('t.start_date', '>=', from!)
        .where('t.start_date', '<=', to!)
        .where(sql<boolean>`not exists (select 1 from task_updates u where u.task_id = t.id and u.author_id is not null)`)
        .execute();
      for (const inst of instances) {
        await trx
          .updateTable('tasks')
          .set({ status: 'cancelled', cancelled_reason: 'Skipped — assignee on approved leave', cancelled_at: new Date(), cancelled_by: user.id, version: sql`version + 1`, updated_by: user.id })
          .where('id', '=', inst.id)
          .execute();
        await trx
          .insertInto('task_template_skips')
          .values({ template_id: inst.template_id!, occurrence_date: inst.occurrence_date!, reason: 'skipped_leave', detail: `Approved leave ${from} → ${to}` })
          .onConflict((oc) => oc.columns(['template_id', 'occurrence_date']).doNothing())
          .execute();
        await trx
          .insertInto('task_updates')
          .values({ task_id: inst.id, author_id: user.id, kind: 'cancel', comment: 'Skipped — assignee on approved leave', status_from: 'not_started', status_to: 'cancelled', metadata: JSON.stringify({ leave_id: leave.id }) })
          .execute();
      }
      return { ...leave, skipped_instances: instances.length };
    });
    this.events.emit('audit.log', { actorId: user.id, entityType: 'employee_leave', entityId: row.id, action: 'leave_record', newValue: row });
    return row;
  }

  async cancelLeave(id: string, dto: Record<string, unknown>, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Leave not found');
    const leave = await this.db.selectFrom('employee_leaves').selectAll().where('id', '=', id).executeTakeFirst();
    if (!leave || leave.status !== 'approved') throw new NotFoundException('Leave not found');
    if (!(await this.canManageLeaveFor(user, leave.employee_id))) throw new ForbiddenException('You can only change leave for your own team.');
    const reason = readComment(dto.reason, { required: true, min: 5, field: 'reason', label: 'Reason' });
    const row = await this.db
      .updateTable('employee_leaves')
      .set({ status: 'cancelled', cancelled_at: new Date(), cancelled_by: user.id, reason: `${leave.reason ? `${leave.reason} — ` : ''}Cancelled: ${reason}`, updated_by: user.id })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'employee_leave', entityId: id, action: 'leave_cancel', previousValue: leave, newValue: row });
    return row;
  }

  // ========================================================================== working calendar
  /** Weekly offs + holidays (national or the employee's region) + approved leave, for a set of employees and a window. */
  async calendar(userIds: string[], from: string, to: string): Promise<WorkingCalendar> {
    const s = await this.settings();
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    const regions = new Map<string, string | null>();
    if (ids.length) {
      for (const u of await this.db.selectFrom('users').select(['id', 'region_id']).where('id', 'in', ids).execute()) regions.set(u.id, u.region_id);
    }
    const holidays = await this.db
      .selectFrom('holidays')
      .select(['holiday_date', 'name', 'region_id'])
      .where('is_active', '=', true)
      .where('holiday_date', '>=', addIsoDays(from, -40))
      .where('holiday_date', '<=', addIsoDays(to, 40))
      .execute();
    const leaves = ids.length
      ? await this.db
          .selectFrom('employee_leaves')
          .select(['id', 'employee_id', 'leave_type', 'from_date', 'to_date'])
          .where('employee_id', 'in', ids)
          .where('status', '=', 'approved')
          .where('to_date', '>=', from)
          .where('from_date', '<=', to)
          .execute()
      : [];
    const off = new Set(s.weekly_off_days);
    const holidayName = (userId: string, date: string) => {
      const region = regions.get(userId) ?? null;
      const h = holidays.find((x) => x.holiday_date === date && (x.region_id === null || x.region_id === region));
      return h ? h.name : null;
    };
    return {
      holidayName,
      isNonWorkingDay: (userId, date) => off.has(isoWeekday(date)) || holidayName(userId, date) !== null,
      leaveOn: (userId, date) => leaves.find((l) => l.employee_id === userId && l.from_date <= date && l.to_date >= date) || null,
    };
  }

  today() {
    return todayInKolkata();
  }
}
