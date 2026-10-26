/**
 * Module 8 task register: role-scoped lists with the full filter set, detail (timeline, blockers, deadline &
 * assignment history, escalations, allowed actions), creation (single or bulk — one task per person),
 * pre-flight warnings, edits, the 15-minute "created by mistake" delete, badges and queues.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, type ExpressionBuilder } from 'kysely';
import {
  TASK_DELAY_CLASSES,
  TASK_DISPLAY_STATUSES,
  TASK_MAX_BULK_ASSIGNEES,
  TASK_PRIORITIES,
  addIsoDays,
  allowedTaskActions,
  isIsoDateString,
  istDateOf,
  istEndOfDay,
  resolveTaskAction,
  todayInKolkata,
  type AuthUser,
  type TaskDelayClass,
  type TaskStatus,
} from '@arihant/shared';
import { TaskStore, TASK_EVENTS } from './task-store.service.js';
import { TaskInputService, isLinked, type TaskLinks } from './task-input.service.js';
import { isAdminLike, type TaskSettings } from './task-masters.service.js';
import {
  TaskValidationException,
  UUID_RE,
  conflict,
  readBool,
  readDate,
  readDeadline,
  readText,
  readVersion,
  staleVersion,
  throwIfErrors,
  type FieldErrors,
} from './task-common.js';

const SORTS: Record<string, any> = {
  deadline: sql`t.deadline`,
  priority: sql`case t.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end`,
  created_at: sql`t.created_at`,
  updated_at: sql`t.updated_at`,
  last_update_at: sql`t.last_update_at`,
  task_number: sql`t.task_number`,
  title: sql`lower(t.title)`,
  assignee_name: sql`lower(emp.full_name)`,
  status: sql`t.status`,
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',') : []).map((s) => s.trim()).filter(Boolean);
const uuids = (v: unknown) => list(v).filter((x) => UUID_RE.test(x));

export interface TaskFilters {
  assignee_ids: string[];
  manager_ids: string[];
  department_ids: string[];
  category_ids: string[];
  priorities: string[];
  statuses: string[];
  recurrence_type: string | null;
  customer_id: string | null;
  tender_id: string | null;
  demo_id: string | null;
  service_ticket_id: string | null;
  /** Originating record, e.g. related_entity_type=proposal&related_entity_id=<id> for proposal follow-up tasks. */
  related_entity_type: string | null;
  related_entity_id: string | null;
  template_id: string | null;
  group_id: string | null;
  deadline_from: string | null;
  deadline_to: string | null;
  has_open_blocker: boolean | null;
  no_update: boolean;
  delay_class: TaskDelayClass | null;
  search: string | null;
  view: 'mine' | 'team' | 'assigned_by_me' | 'all';
  include_cancelled: boolean;
  page: number;
  page_size: number;
  sort_by: string;
  sort_dir: 'asc' | 'desc';
}

export function parseTaskFilters(q: Record<string, unknown>): TaskFilters {
  const one = (k: string) => (typeof q[k] === 'string' && UUID_RE.test(q[k] as string) ? (q[k] as string) : null);
  const date = (k: string) => (isIsoDateString(q[k]) ? (q[k] as string) : null);
  const statuses = list(q.statuses ?? q.status).filter((s) => (TASK_DISPLAY_STATUSES as string[]).includes(s));
  const sortBy = typeof q.sort_by === 'string' && SORTS[q.sort_by] ? q.sort_by : 'deadline';
  return {
    assignee_ids: uuids(q.assignee_ids),
    manager_ids: uuids(q.manager_ids),
    department_ids: uuids(q.department_ids),
    category_ids: uuids(q.category_ids),
    priorities: list(q.priority ?? q.priorities).filter((p) => (TASK_PRIORITIES as string[]).includes(p)),
    statuses,
    recurrence_type: typeof q.recurrence_type === 'string' && q.recurrence_type ? q.recurrence_type : null,
    customer_id: one('customer_id'),
    tender_id: one('tender_id'),
    demo_id: one('demo_id'),
    service_ticket_id: one('service_ticket_id'),
    related_entity_type: typeof q.related_entity_type === 'string' && /^[a-z_]{1,40}$/.test(q.related_entity_type) ? q.related_entity_type : null,
    related_entity_id: one('related_entity_id'),
    template_id: one('template_id'),
    group_id: one('group_id'),
    deadline_from: date('deadline_from'),
    deadline_to: date('deadline_to'),
    has_open_blocker: q.has_open_blocker === 'true' ? true : q.has_open_blocker === 'false' ? false : null,
    no_update: q.no_update === 'true',
    delay_class: (TASK_DELAY_CLASSES as string[]).includes(q.delay_class as string) ? (q.delay_class as TaskDelayClass) : null,
    search: typeof q.search === 'string' && q.search.trim() ? q.search.trim().slice(0, 100) : null,
    view: (['mine', 'team', 'assigned_by_me', 'all'] as const).includes(q.view as any) ? (q.view as any) : 'all',
    include_cancelled: q.include_cancelled === 'true' || statuses.includes('cancelled'),
    page: Math.max(1, Math.floor(Number(q.page) || 1)),
    page_size: Math.min(100, Math.max(1, Math.floor(Number(q.page_size ?? q.limit) || 20))),
    sort_by: sortBy,
    sort_dir: q.sort_dir === 'desc' ? 'desc' : 'asc',
  };
}

@Injectable()
export class TasksService {
  constructor(
    readonly store: TaskStore,
    private readonly input: TaskInputService,
  ) {}

  private get db() {
    return this.store.db;
  }

  // ========================================================================== list
  filterExpressions(f: TaskFilters, s: TaskSettings, user: AuthUser, teamIds: string[]) {
    return (eb: ExpressionBuilder<any, any>) => {
      const and: any[] = [];
      if (f.view === 'mine') and.push(eb('t.assigned_to', '=', user.id));
      if (f.view === 'assigned_by_me') and.push(eb('t.assigned_by', '=', user.id));
      if (f.view === 'team') and.push(teamIds.length ? eb('t.assigned_to', 'in', teamIds) : sql<boolean>`false`);
      if (f.assignee_ids.length) and.push(eb('t.assigned_to', 'in', f.assignee_ids));
      if (f.manager_ids.length) and.push(eb('emp.reporting_manager_id', 'in', f.manager_ids));
      if (f.department_ids.length) and.push(eb('t.department_id', 'in', f.department_ids));
      if (f.category_ids.length) and.push(eb('t.category_id', 'in', f.category_ids));
      if (f.priorities.length) and.push(eb('t.priority', 'in', f.priorities));
      if (f.statuses.length) {
        const stored = f.statuses.filter((x) => x !== 'overdue');
        const ors: any[] = [];
        if (stored.length) ors.push(eb('t.status', 'in', stored));
        if (f.statuses.includes('overdue')) ors.push(this.store.overdueSql());
        and.push(eb.or(ors));
      } else if (!f.include_cancelled) and.push(eb('t.status', '<>', 'cancelled'));
      if (f.recurrence_type === 'one_time') and.push(eb('t.template_id', 'is', null));
      else if (f.recurrence_type) and.push(eb('t.template_id', 'in', eb.selectFrom('task_templates').select('id').where('recurrence_type', '=', f.recurrence_type)));
      if (f.customer_id) and.push(eb('t.customer_id', '=', f.customer_id));
      if (f.tender_id) and.push(eb('t.tender_id', '=', f.tender_id));
      if (f.demo_id) and.push(eb('t.demo_id', '=', f.demo_id));
      if (f.service_ticket_id) and.push(eb('t.service_ticket_id', '=', f.service_ticket_id));
      if (f.related_entity_type) and.push(eb('t.related_entity_type', '=', f.related_entity_type));
      if (f.related_entity_id) and.push(eb('t.related_entity_id', '=', f.related_entity_id));
      if (f.template_id) and.push(eb('t.template_id', '=', f.template_id));
      if (f.group_id) and.push(eb('t.group_id', '=', f.group_id));
      if (f.deadline_from) and.push(eb('t.deadline', '>=', sql<Date>`${f.deadline_from}::date::timestamp at time zone 'Asia/Kolkata'`));
      if (f.deadline_to) and.push(eb('t.deadline', '<=', istEndOfDay(f.deadline_to)));
      if (f.has_open_blocker !== null) {
        const ex = sql<boolean>`exists (select 1 from task_blockers hb where hb.task_id = t.id and hb.status in ('pending_review', 'accepted'))`;
        and.push(f.has_open_blocker ? ex : sql<boolean>`not ${ex}`);
      }
      if (f.no_update) and.push(this.store.noUpdateSql(s));
      if (f.delay_class) and.push(this.store.delayClassSql(f.delay_class));
      if (f.search) {
        const like = `%${f.search.toLowerCase()}%`;
        and.push(eb.or([sql<boolean>`lower(t.title) like ${like}`, sql<boolean>`lower(t.task_number) like ${like}`, sql<boolean>`lower(emp.full_name) like ${like}`]));
      }
      return and.length ? eb.and(and) : sql<boolean>`true`;
    };
  }

  async list(query: Record<string, unknown>, user: AuthUser) {
    const f = parseTaskFilters(query);
    const s = await this.store.masters.settings();
    const team = f.view === 'team' ? await this.store.access.teamIds(user, s) : [];
    const base = this.store.scoped(user, s).where(this.filterExpressions(f, s, user, team));
    const [countRow, rows] = await Promise.all([
      base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      this.store
        .withJoins(base)
        .orderBy(sql`${SORTS[f.sort_by]} ${sql.raw(f.sort_dir)} nulls last`)
        .orderBy('t.task_number', 'desc')
        .limit(f.page_size)
        .offset((f.page - 1) * f.page_size)
        .execute(),
    ]);
    const total = Number(countRow?.n || 0);
    const now = new Date();
    return {
      data: rows.map((r) => this.store.serialize(r, s, now)),
      total,
      page: f.page,
      limit: f.page_size,
      totalPages: Math.max(1, Math.ceil(total / f.page_size)),
    };
  }

  // ========================================================================== detail
  async detail(id: string, user: AuthUser) {
    const s = await this.store.masters.settings();
    if (!UUID_RE.test(id)) throw new NotFoundException('Task not found');
    const row: any = await this.store.withJoins(this.store.scoped(user, s)).where('t.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Task not found');
    const task: any = this.store.serialize(row, s);

    const [updates, attachments, blockers, deadlineChanges, assignments, escalations, approvers] = await Promise.all([
      this.db
        .selectFrom('task_updates as u')
        .leftJoin('users as a', 'a.id', 'u.author_id')
        .selectAll('u')
        .select(['a.full_name as author_name', 'a.role as author_role'])
        .where('u.task_id', '=', id)
        .orderBy('u.created_at', 'desc')
        .orderBy('u.id', 'desc')
        .execute(),
      this.db
        .selectFrom('task_attachments as a')
        .leftJoin('users as u', 'u.id', 'a.uploaded_by')
        .select(['a.id', 'a.purpose', 'a.related_id', 'a.file_name', 'a.mime_type', 'a.size_bytes', 'a.uploaded_at', 'a.uploaded_by', 'u.full_name as uploaded_by_name'])
        .where('a.task_id', '=', id)
        .where('a.deleted_at', 'is', null)
        .orderBy('a.uploaded_at')
        .execute(),
      this.db
        .selectFrom('task_blockers as b')
        .leftJoin('users as r', 'r.id', 'b.raised_by')
        .leftJoin('users as d', 'd.id', 'b.decided_by')
        .leftJoin('users as dep', 'dep.id', 'b.dependency_user_id')
        .leftJoin('organisations as o', 'o.id', 'b.dependency_customer_id')
        .leftJoin('employee_leaves as l', 'l.id', 'b.leave_id')
        .selectAll('b')
        .select(['r.full_name as raised_by_name', 'd.full_name as decided_by_name', 'dep.full_name as dependency_user_name', 'o.name as dependency_customer_name', 'l.from_date as leave_from', 'l.to_date as leave_to'])
        .where('b.task_id', '=', id)
        .orderBy('b.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('task_deadline_changes as c')
        .leftJoin('users as u', 'u.id', 'c.changed_by')
        .selectAll('c')
        .select('u.full_name as changed_by_name')
        .where('c.task_id', '=', id)
        .orderBy('c.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('task_assignment_history as h')
        .leftJoin('users as f', 'f.id', 'h.from_user_id')
        .leftJoin('users as to', 'to.id', 'h.to_user_id')
        .leftJoin('users as c', 'c.id', 'h.changed_by')
        .selectAll('h')
        .select(['f.full_name as from_name', 'to.full_name as to_name', 'c.full_name as changed_by_name'])
        .where('h.task_id', '=', id)
        .orderBy('h.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('task_escalations as e')
        .leftJoin('users as by', 'by.id', 'e.escalated_by')
        .leftJoin('users as to', 'to.id', 'e.escalated_to')
        .selectAll('e')
        .select(['by.full_name as escalated_by_name', 'to.full_name as escalated_to_name'])
        .where('e.task_id', '=', id)
        .orderBy('e.created_at', 'desc')
        .execute(),
      task.assigned_to ? this.store.access.resolveApprovers(task.assigned_to) : Promise.resolve({ primary: null, ids: [], viaFallback: true }),
    ]);

    const kinds = await this.store.access.actorKinds(task, user);
    const actions: string[] = allowedTaskActions(task.status as TaskStatus, kinds);
    const ob = blockers.find((b) => b.status === 'pending_review' || b.status === 'accepted');
    // Blocker actions are decided by the blocker service; surface them here so the UI has one source.
    if (ob) {
      if (ob.status === 'pending_review' && ob.raised_by === user.id) actions.push('withdraw_blocker');
      if (ob.status === 'pending_review' && kinds.has('manager') && !kinds.has('assignee')) actions.push('accept_blocker', 'reject_blocker');
      if (ob.status === 'accepted' && (kinds.has('assignee') || (kinds.has('manager') && !kinds.has('assignee')))) actions.push('resolve_blocker');
      if (ob.status === 'pending_review' && kinds.has('assignee')) actions.push('resolve_blocker');
    }
    const minutesSinceCreate = (Date.now() - new Date(task.created_at).getTime()) / 60000;
    if (row.created_by === user.id && task.status === 'not_started' && task.version === 1 && minutesSinceCreate <= s.hard_delete_window_minutes) actions.push('delete');
    const approverNames = approvers.ids.length
      ? await this.db.selectFrom('users').select(['id', 'full_name']).where('id', 'in', approvers.ids).execute()
      : [];
    const template = task.template_id
      ? await this.db.selectFrom('task_templates').select(['id', 'title', 'recurrence_type', 'recurrence_rule', 'status']).where('id', '=', task.template_id).executeTakeFirst()
      : null;

    return {
      ...task,
      created_by: row.created_by,
      updates,
      attachments,
      blockers: blockers.map((b) => ({ ...b, open: b.status === 'pending_review' || b.status === 'accepted' })),
      deadline_changes: deadlineChanges,
      assignment_history: assignments,
      escalations,
      template,
      approvers: approverNames,
      approver_via_fallback: approvers.viaFallback,
      viewer: { kinds: Array.from(kinds) },
      allowed_actions: Array.from(new Set(actions)),
      repeated_blocker_types: this.repeatedBlockerTypes(blockers, s),
    };
  }

  private repeatedBlockerTypes(blockers: { blocker_type: string }[], s: TaskSettings) {
    const counts: Record<string, number> = {};
    for (const b of blockers) counts[b.blocker_type] = (counts[b.blocker_type] || 0) + 1;
    return Object.entries(counts).map(([type, count]) => ({ type, count, flagged: count >= s.repeated_blocker_threshold }));
  }

  // ========================================================================== create
  private async readCreate(dtoRaw: Record<string, unknown>, user: AuthUser) {
    const dto = await this.input.normaliseLegacy(dtoRaw);
    const errors: FieldErrors = {};
    const core = this.input.readCore(errors, dto, false);
    const category = await this.input.loadCategory(errors, dto.category_id);
    const links = await this.input.readLinks(errors, dto, category);
    const flags = this.input.readFlags(dto, category, false);
    const today = todayInKolkata();
    const explicitStart = readDate(errors, 'start_date', dto.start_date, { label: 'Start date' });
    const deadline = readDeadline(errors, 'deadline', dto.deadline, { required: true, label: 'Deadline' });
    const isBacklog = readBool(dto.is_backlog);
    // A backlog entry without an explicit start starts on its (past) deadline day.
    const startDate = explicitStart ?? (isBacklog && deadline && istDateOf(deadline) < today ? istDateOf(deadline) : today);
    if (deadline) {
      if (deadline.getTime() < Date.now() && !isBacklog) {
        errors.deadline = 'Deadline is in the past. Pick a future deadline, or tick "Backlog entry" to record already-late work (excluded from compliance metrics).';
      } else if (istDateOf(deadline) < startDate) errors.deadline = 'Deadline must be on or after the start date.';
    }
    if (isBacklog && !isAdminLike(user) && user.role !== 'regional_manager') {
      const team = await this.store.access.teamIds(user, await this.store.masters.settings());
      if (!team.length) errors.is_backlog = 'Only managers can record backlog entries.';
    }
    const assignees = await this.input.readAssignees(errors, dto, user, isLinked(links), TASK_MAX_BULK_ASSIGNEES);
    throwIfErrors(errors);
    if (flags.approval_required) for (const a of assignees) await this.store.access.requireApprovers(a.id);
    const source = typeof dto.source === 'string' && ['lead_workflow', 'proposal_followup'].includes(dto.source) ? dto.source : 'manual';
    return { dto, core, category: category!, links, flags, startDate, deadline: deadline!, isBacklog, assignees, today, source };
  }

  async create(dtoRaw: Record<string, unknown>, user: AuthUser) {
    const v = await this.readCreate(dtoRaw, user);
    const warnings = await this.warningsFor(v.assignees.map((a) => a.id), v.startDate, v.deadline, v.today);
    const groupId = v.assignees.length > 1 ? randomUUID() : null;

    const created = await this.db.transaction().execute(async (trx) => {
      const out: any[] = [];
      for (const a of v.assignees) {
        const row = await trx
          .insertInto('tasks')
          .values({
            title: v.core.title!,
            description: v.core.description ?? null,
            expected_outcome: v.core.expected_outcome ?? null,
            priority: v.core.priority!,
            category_id: v.category.id,
            ...v.links,
            assigned_to: a.id,
            assigned_by: user.id,
            reporting_manager_id: a.reporting_manager_id,
            department_id: a.department_id,
            start_date: v.startDate,
            deadline: v.deadline,
            original_deadline: v.deadline,
            evidence_required: v.flags.evidence_required!,
            approval_required: v.flags.approval_required!,
            is_backlog: v.isBacklog,
            group_id: groupId,
            source: v.source,
            related_entity_type: typeof v.dto.related_entity_type === 'string' ? v.dto.related_entity_type : null,
            related_entity_id: typeof v.dto.related_entity_id === 'string' && UUID_RE.test(v.dto.related_entity_id) ? v.dto.related_entity_id : null,
            created_by: user.id,
            updated_by: user.id,
            last_update_at: new Date(),
          } as any)
          .returning(['id', 'task_number', 'title', 'assigned_to', 'deadline', 'status', 'version'])
          .executeTakeFirstOrThrow();
        await this.store.log(trx, row.id, {
          kind: 'created',
          author: user,
          to: 'not_started',
          metadata: { group_id: groupId, assignee_id: a.id, backlog: v.isBacklog || undefined },
        });
        out.push(row);
      }
      return out;
    });

    for (const t of created) {
      this.store.audit(user, 'task', t.id, 'task_create', undefined, t);
      if (t.assigned_to !== user.id) {
        this.store.emit(TASK_EVENTS.ASSIGNED, { taskId: t.id, taskNumber: t.task_number, title: t.title, assigneeId: t.assigned_to, actorId: user.id, actorName: user.full_name, deadline: t.deadline });
      }
    }
    return { data: created, group_id: groupId, warnings };
  }

  /** Non-blocking warnings: approved leave covering the deadline, deadline on a holiday/weekly off, past start. */
  async warningsFor(assigneeIds: string[], startDate: string | null, deadline: Date | null, today = todayInKolkata()) {
    const warnings: { field: string; message: string; assignee_id?: string }[] = [];
    if (startDate && startDate < today) warnings.push({ field: 'start_date', message: 'Start date is in the past.' });
    if (!deadline) return warnings;
    const dDate = istDateOf(deadline);
    const cal = await this.store.masters.calendar(assigneeIds, startDate && startDate < dDate ? startDate : dDate, dDate);
    const names = assigneeIds.length ? await this.db.selectFrom('users').select(['id', 'full_name']).where('id', 'in', assigneeIds).execute() : [];
    const nameOf = (id: string) => names.find((n) => n.id === id)?.full_name || 'Assignee';
    for (const id of assigneeIds) {
      const leave = cal.leaveOn(id, dDate);
      if (leave) warnings.push({ field: 'deadline', assignee_id: id, message: `${nameOf(id)} is on approved ${leave.leave_type.replace('_', ' ')} leave ${leave.from_date} → ${leave.to_date}, covering the deadline.` });
      const h = cal.holidayName(id, dDate);
      if (h) warnings.push({ field: 'deadline', assignee_id: id, message: `Deadline falls on a holiday (${h}).` });
      else if (cal.isNonWorkingDay(id, dDate)) warnings.push({ field: 'deadline', assignee_id: id, message: 'Deadline falls on a weekly off day.' });
    }
    // de-duplicate identical holiday/weekly-off messages across assignees
    return warnings.filter((w, i) => warnings.findIndex((x) => x.message === w.message) === i);
  }

  /** Pre-flight for the create form: scope per assignee + warnings, without creating anything. */
  async check(dtoRaw: Record<string, unknown>, user: AuthUser) {
    const dto = await this.input.normaliseLegacy(dtoRaw);
    const errors: FieldErrors = {};
    const startDate = readDate(errors, 'start_date', dto.start_date, { label: 'Start date' });
    const deadline = readDeadline(errors, 'deadline', dto.deadline, { label: 'Deadline' });
    const linked = isLinked(dto as any);
    const ids = (Array.isArray(dto.assignee_ids) ? dto.assignee_ids : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x));
    const scopes = await Promise.all(ids.map(async (id) => ({ assignee_id: id, ...(await this.store.access.assignScope(user, id, linked)) })));
    return { errors, assignees: scopes, warnings: await this.warningsFor(ids, startDate, deadline) };
  }

  // ========================================================================== edit
  async edit(id: string, dto: Record<string, unknown>, user: AuthUser) {
    await this.store.getVisible(id, user);
    const result = await this.db.transaction().execute(async (trx) => {
      const task = await this.store.lock(trx, id);
      const kinds = await this.store.access.actorKinds(task, user);
      const r = resolveTaskAction(task.status, 'edit', kinds);
      if (!r.ok) {
        if (r.reason === 'invalid_status') throw conflict('Completed, cancelled or awaiting-approval tasks cannot be edited.');
        throw new ForbiddenException(r.reason === 'self' ? 'Ask your manager to change a task assigned to you.' : 'Only the assigner or a manager can edit this task.');
      }
      if (task.version !== readVersion(dto.version)) throw staleVersion();
      if (dto.deadline !== undefined && String(dto.deadline) !== '') {
        throw new TaskValidationException({ deadline: 'Use "Extend deadline" to change the deadline — every change is recorded.' });
      }
      const errors: FieldErrors = {};
      const core = this.input.readCore(errors, dto, true);
      const categoryChanged = dto.category_id !== undefined && dto.category_id !== task.category_id;
      const category = await this.input.loadCategory(errors, dto.category_id ?? task.category_id, { allowInactiveId: task.category_id });
      const existing: TaskLinks = { customer_id: task.customer_id, tender_id: task.tender_id, demo_id: task.demo_id, service_ticket_id: task.service_ticket_id, project_id: task.project_id };
      const links = await this.input.readLinks(errors, dto, category, existing);
      const flags = this.input.readFlags(dto, category, true);
      let startDate: string | null | undefined;
      if (dto.start_date !== undefined) {
        startDate = readDate(errors, 'start_date', dto.start_date, { label: 'Start date', required: true });
        if (startDate && task.status !== 'not_started') errors.start_date = 'Start date can only change before work starts.';
        if (startDate && task.deadline && startDate > istDateOf(task.deadline)) errors.start_date = 'Start date cannot be after the deadline.';
      }
      throwIfErrors(errors);
      if (flags.approval_required && task.assigned_to) await this.store.access.requireApprovers(task.assigned_to);

      const patch: Record<string, unknown> = { ...core, ...links, ...flags };
      if (categoryChanged) patch.category_id = category!.id;
      if (startDate) patch.start_date = startDate;
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(patch)) {
        if (String((task as any)[k] ?? '') !== String(val ?? '')) {
          before[k] = (task as any)[k];
          after[k] = val;
        }
      }
      if (!Object.keys(after).length) return { task, changed: false };
      const res = await trx
        .updateTable('tasks')
        .set({ ...(after as any), version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', id)
        .where('version', '=', task.version)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) throw staleVersion();
      await this.store.log(trx, id, { kind: 'edit', author: user, comment: readText({}, 'reason', dto.reason, 500, {}) ?? null, metadata: { before, after } });
      return { task, changed: true, before, after };
    });
    if (result.changed) this.store.audit(user, 'task', id, 'task_edit', result.before, result.after);
    return this.detail(id, user);
  }

  // ========================================================================== delete (created by mistake)
  async remove(id: string, user: AuthUser) {
    const s = await this.store.masters.settings();
    await this.store.getVisible(id, user);
    const snapshot = await this.db.transaction().execute(async (trx) => {
      const task = await this.store.lock(trx, id);
      const ageMin = (Date.now() - new Date(task.created_at).getTime()) / 60000;
      if (task.created_by !== user.id) throw new ForbiddenException('Only the person who created this task can delete it. Use Cancel instead.');
      const touched = await trx
        .selectFrom('task_updates')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('task_id', '=', id)
        .where('kind', '<>', 'created')
        .executeTakeFirst();
      const files = await trx.selectFrom('task_attachments').select('id').where('task_id', '=', id).executeTakeFirst();
      const blocker = await trx.selectFrom('task_blockers').select('id').where('task_id', '=', id).executeTakeFirst();
      if (ageMin > s.hard_delete_window_minutes || task.status !== 'not_started' || task.version !== 1 || Number(touched?.n) > 0 || files || blocker) {
        throw conflict(`Tasks can only be deleted within ${s.hard_delete_window_minutes} minutes of creation and before anyone works on them. Cancel it with a reason instead.`, 'DELETE_NOT_ALLOWED');
      }
      await sql`set local arihant.allow_task_purge = 'on'`.execute(trx);
      await trx.deleteFrom('task_updates').where('task_id', '=', id).execute();
      await trx.deleteFrom('tasks').where('id', '=', id).execute();
      return task;
    });
    this.store.audit(user, 'task', id, 'task_delete_within_window', snapshot, null);
    return { id, deleted: true };
  }

  // ========================================================================== summary / badges
  async summary(user: AuthUser) {
    const s = await this.store.masters.settings();
    const mine = this.db.selectFrom('tasks as t').where('t.assigned_to', '=', user.id);
    const today = todayInKolkata();
    const [counts, routed, blockerRows, waiting, escalations, team] = await Promise.all([
      mine
        .select([
          sql<number>`count(*) filter (where t.status in ('not_started', 'in_progress', 'blocked', 'awaiting_approval'))::int`.as('my_open'),
          sql<number>`count(*) filter (where ${this.store.overdueSql()})::int`.as('my_overdue'),
          sql<number>`count(*) filter (where t.status in ('not_started', 'in_progress', 'blocked') and t.deadline >= ${sql`${today}::date::timestamp at time zone 'Asia/Kolkata'`} and t.deadline <= ${istEndOfDay(today)})::int`.as('my_due_today'),
          sql<number>`count(*) filter (where t.status = 'blocked')::int`.as('my_blocked'),
          sql<number>`count(*) filter (where t.status = 'awaiting_approval')::int`.as('my_awaiting_approval'),
          sql<number>`count(*) filter (where ${this.store.noUpdateSql(s)})::int`.as('my_no_update'),
        ])
        .executeTakeFirst(),
      this.db
        .selectFrom('tasks as t')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('t.status', '=', 'awaiting_approval')
        .where(this.store.routedToSql(user, s))
        .executeTakeFirst(),
      this.db
        .selectFrom('task_blockers as b')
        .innerJoin('tasks as t', 't.id', 'b.task_id')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('b.status', '=', 'pending_review')
        .where(this.store.routedToSql(user, s))
        .executeTakeFirst(),
      this.db
        .selectFrom('task_blockers as b')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('b.dependency_user_id', '=', user.id)
        .where('b.status', 'in', ['pending_review', 'accepted'])
        .executeTakeFirst(),
      this.db
        .selectFrom('task_escalations')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('escalated_to', '=', user.id)
        .where('status', '<>', 'closed')
        .executeTakeFirst(),
      this.store.access.teamIds(user, s),
    ]);
    const needs = await this.needsReassignmentCount(user, team);
    return {
      ...(counts as any),
      pending_approvals: Number(routed?.n || 0),
      pending_blockers: Number(blockerRows?.n || 0),
      waiting_on_me: Number(waiting?.n || 0),
      open_escalations: Number(escalations?.n || 0),
      needs_reassignment: needs,
      has_team: team.length > 0,
      team_size: team.length,
      can_view_all: this.store.access.canViewAll(user),
      can_manage_settings: user.role === 'admin',
      can_view_evidence: this.store.access.canViewAll(user) || team.length > 0,
      can_snapshot_evidence: this.store.access.canViewAll(user),
    };
  }

  private async needsReassignmentCount(user: AuthUser, team: string[]) {
    let q = this.db
      .selectFrom('tasks as t')
      .innerJoin('users as emp', 'emp.id', 't.assigned_to')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('emp.is_active', '=', false)
      .where('t.status', 'in', ['not_started', 'in_progress', 'blocked']);
    if (!isAdminLike(user)) q = team.length ? q.where('t.assigned_to', 'in', team) : q.where(sql<boolean>`false`);
    const r = await q.executeTakeFirst();
    return Number(r?.n || 0);
  }

  // ========================================================================== queues
  async approvalsQueue(query: Record<string, unknown>, user: AuthUser) {
    const s = await this.store.masters.settings();
    let q = this.store.withJoins(this.store.scoped(user, s)).where('t.status', '=', 'awaiting_approval');
    if (!(query.scope === 'all' && isAdminLike(user))) q = q.where(this.store.routedToSql(user, s));
    const rows = await q.orderBy('t.completed_at').limit(200).execute();
    const ids = rows.map((r: any) => r.id);
    const evidence = ids.length
      ? await this.db
          .selectFrom('task_attachments')
          .select(['id', 'task_id', 'file_name', 'mime_type', 'size_bytes', 'purpose', 'uploaded_at'])
          .where('task_id', 'in', ids)
          .where('deleted_at', 'is', null)
          .where('purpose', 'in', ['evidence', 'update'])
          .execute()
      : [];
    const now = new Date();
    return rows.map((r: any) => {
      const t = this.store.serialize(r, s, now);
      const waitingHours = r.completed_at ? Math.floor((now.getTime() - new Date(r.completed_at).getTime()) / 3600000) : 0;
      return { ...t, evidence: evidence.filter((e) => e.task_id === r.id), waiting_hours: waitingHours, sla_breached: waitingHours >= s.approval_sla_hours };
    });
  }

  async needsReassignment(user: AuthUser) {
    const s = await this.store.masters.settings();
    const team = await this.store.access.teamIds(user, s);
    if (!isAdminLike(user) && !team.length) return { tasks: [], templates: [] };
    let tq = this.store.withJoins(this.store.scoped(user, s)).where('emp.is_active', '=', false).where('t.status', 'in', ['not_started', 'in_progress', 'blocked']);
    if (!isAdminLike(user)) tq = tq.where('t.assigned_to', 'in', team);
    let pq = this.db
      .selectFrom('task_templates as tp')
      .innerJoin('users as emp', 'emp.id', 'tp.assigned_to')
      .select(['tp.id', 'tp.title', 'tp.status', 'tp.status_reason', 'tp.recurrence_type', 'tp.assigned_to', 'emp.full_name as assignee_name', 'emp.is_active as assignee_active'])
      .where('tp.needs_reassignment', '=', true)
      .where('tp.status', '<>', 'ended');
    if (!isAdminLike(user)) pq = pq.where('tp.assigned_to', 'in', team);
    const [tasks, templates] = await Promise.all([tq.orderBy('t.deadline').limit(300).execute(), pq.execute()]);
    return { tasks: tasks.map((r: any) => this.store.serialize(r, s)), templates };
  }

  // ========================================================================== pickers
  async lookupAssignees(query: Record<string, unknown>, user: AuthUser) {
    const s = await this.store.masters.settings();
    const team = await this.store.access.teamIds(user, s);
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    let q = this.db
      .selectFrom('users as u')
      .leftJoin('departments as d', 'd.id', 'u.department_id')
      .leftJoin('users as m', 'm.id', 'u.reporting_manager_id')
      .select(['u.id', 'u.full_name', 'u.role', 'u.email', 'u.department_id', 'd.name as department_name', 'u.reporting_manager_id', 'm.full_name as manager_name'])
      .where('u.is_active', '=', true)
      .orderBy('u.full_name')
      .limit(300);
    if (search) q = q.where(sql<boolean>`lower(u.full_name) like ${`%${search}%`}`);
    const admin = isAdminLike(user);
    if (!admin && !s.allow_peer_linked_assignment) q = q.where((eb) => eb.or([eb('u.id', '=', user.id), ...(team.length ? [eb('u.id', 'in', team)] : [])]));
    const rows = await q.execute();
    const date = isIsoDateString(query.on_date) ? (query.on_date as string) : null;
    const cal = date ? await this.store.masters.calendar(rows.map((r) => r.id), date, date) : null;
    return rows
      .map((r) => {
        const scope = r.id === user.id ? 'self' : admin ? 'all' : team.includes(r.id) ? 'team' : 'peer';
        const leave = cal && date ? cal.leaveOn(r.id, date) : null;
        return { ...r, scope, on_leave: leave ? { from_date: leave.from_date, to_date: leave.to_date, leave_type: leave.leave_type } : null };
      })
      .filter((r) => r.scope !== 'self' || s.allow_self_tasks || admin);
  }

  async lookupLinks(query: Record<string, unknown>) {
    const type = query.type;
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const like = `%${search}%`;
    const id = typeof query.id === 'string' && UUID_RE.test(query.id) ? query.id : null;
    switch (type) {
      case 'customer': {
        let q = this.db.selectFrom('organisations').select(['id', 'name as label', 'city as sub']).orderBy('name').limit(25);
        if (id) q = q.where('id', '=', id);
        else if (search) q = q.where(sql<boolean>`lower(name) like ${like}`);
        return q.execute();
      }
      case 'tender': {
        let q = this.db
          .selectFrom('tenders')
          .select(['id', sql<string>`coalesce(tender_no, tender_number, 'Tender')`.as('label'), sql<string>`concat_ws(' · ', organisation, status, to_char(bid_closing_date, 'DD-MM-YYYY'))`.as('sub'), 'organisation_id'])
          .where('is_deleted', '=', false)
          .orderBy('bid_closing_date', 'desc')
          .limit(25);
        if (id) q = q.where('id', '=', id);
        else {
          q = q.where('status', 'not in', ['lost', 'cancelled', 'rejected_internally'] as any);
          if (search) q = q.where(sql<boolean>`(lower(coalesce(tender_no, '')) like ${like} or lower(coalesce(organisation, '')) like ${like})`);
        }
        return q.execute();
      }
      case 'demo': {
        let q = this.db
          .selectFrom('demos as d')
          .leftJoin('organisations as o', 'o.id', 'd.organisation_id')
          .select(['d.id', 'd.demo_no as label', sql<string>`concat_ws(' · ', o.name, d.status, to_char(d.requested_date, 'DD-MM-YYYY'))`.as('sub'), 'd.organisation_id'])
          .orderBy('d.requested_date', 'desc')
          .limit(25);
        if (id) q = q.where('d.id', '=', id);
        else {
          q = q.where('d.status', '<>', 'cancelled');
          if (search) q = q.where(sql<boolean>`(lower(d.demo_no) like ${like} or lower(coalesce(o.name, '')) like ${like})`);
        }
        return q.execute();
      }
      case 'service': {
        let q = this.db
          .selectFrom('service_tickets as s')
          .leftJoin('organisations as o', (join) => join.on(sql<boolean>`o.id = coalesce(s.customer_id, s.organisation_id)`))
          .select(['s.id', sql<string>`coalesce(s.ticket_no, s.ticket_number, 'Ticket')`.as('label'), sql<string>`concat_ws(' · ', o.name, s.status)`.as('sub'), 's.organisation_id'])
          .where('s.deleted_at', 'is', null)
          .orderBy('s.created_at', 'desc')
          .limit(25);
        if (id) q = q.where('s.id', '=', id);
        else {
          q = q.where('s.status', 'not in', ['closed', 'cancelled'] as any);
          if (search) q = q.where(sql<boolean>`(lower(coalesce(s.ticket_no, '')) like ${like} or lower(coalesce(o.name, '')) like ${like})`);
        }
        return q.execute();
      }
      case 'project': {
        let q = this.db.selectFrom('projects').select(['id', 'name as label', 'code as sub']).where('is_active', '=', true).orderBy('name').limit(25);
        if (id) q = q.where('id', '=', id);
        else if (search) q = q.where(sql<boolean>`lower(name) like ${like}`);
        return q.execute();
      }
      default:
        throw new TaskValidationException({ type: 'type must be customer, tender, demo, service or project.' });
    }
  }

  /** Upcoming days with holiday / weekly-off flags for the deadline picker. */
  async calendarHints(query: Record<string, unknown>, user: AuthUser) {
    const from = isIsoDateString(query.from) ? (query.from as string) : todayInKolkata();
    const to = isIsoDateString(query.to) ? (query.to as string) : addIsoDays(from, 60);
    const userId = typeof query.user_id === 'string' && UUID_RE.test(query.user_id) ? query.user_id : user.id;
    const cal = await this.store.masters.calendar([userId], from, to);
    const days: { date: string; holiday: string | null; weekly_off: boolean; leave: boolean }[] = [];
    for (let d = from, i = 0; d <= to && i < 400; d = addIsoDays(d, 1), i++) {
      const holiday = cal.holidayName(userId, d);
      const nonWorking = cal.isNonWorkingDay(userId, d);
      const leave = Boolean(cal.leaveOn(userId, d));
      if (holiday || nonWorking || leave) days.push({ date: d, holiday, weekly_off: nonWorking && !holiday, leave });
    }
    return days;
  }
}
