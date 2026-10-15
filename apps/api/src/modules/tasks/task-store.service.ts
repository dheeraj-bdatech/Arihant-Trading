/**
 * Shared plumbing for the Module 8 services: scoped reads, row locks, the progress log, event/audit
 * emission, serialisation (derived overdue / display status / delay class) and the SQL fragments
 * that mirror the shared TS rules so list filters and evidence numbers always agree.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, type RawBuilder, type Transaction } from 'kysely';
import {
  TASK_STATUS_LABELS,
  computeTaskDelay,
  isTaskOverdue,
  isTaskWithoutUpdate,
  minutesToDays,
  relativeDue,
  taskDisplayStatus,
  type AuthUser,
  type Database,
  type TaskDelayClass,
} from '@arihant/shared';
import { TASK_DB } from './task-db.js';
import { TASK_CONFIG, type TaskConfig } from './task.config.js';
import { TaskMastersService, type TaskSettings } from './task-masters.service.js';
import { TaskAccessService } from './task-access.service.js';
import { UUID_RE } from './task-common.js';

export type DB = Kysely<Database> | Transaction<Database>;

export const TASK_EVENTS = {
  ASSIGNED: 'task_flow.assigned',
  REASSIGNED: 'task_flow.reassigned',
  COMPLETED: 'task_flow.completed',
  APPROVED: 'task_flow.approved',
  SENT_BACK: 'task_flow.sent_back',
  REOPENED: 'task_flow.reopened',
  CANCELLED: 'task_flow.cancelled',
  DEADLINE_EXTENDED: 'task_flow.deadline_extended',
  ESCALATED: 'task_flow.escalated',
  COMMENTED: 'task_flow.commented',
  BLOCKER_RAISED: 'task_flow.blocker_raised',
  BLOCKER_DECIDED: 'task_flow.blocker_decided',
  BLOCKER_RESOLVED: 'task_flow.blocker_resolved',
  BLOCKER_WITHDRAWN: 'task_flow.blocker_withdrawn',
  BADGES: 'task_flow.badges',
} as const;

/** Columns every task read returns (aliases: t, emp, plus the joins in `withJoins`). */
export const TASK_LIST_COLUMNS = [
  't.id',
  't.task_number',
  't.title',
  't.description',
  't.expected_outcome',
  't.status',
  't.priority',
  't.progress_percent',
  't.start_date',
  't.deadline',
  't.original_deadline',
  't.completed_at',
  't.approved_at',
  't.last_update_at',
  't.first_overdue_at',
  't.assigned_to',
  't.assigned_by',
  't.reporting_manager_id',
  't.department_id',
  't.category_id',
  't.customer_id',
  't.tender_id',
  't.demo_id',
  't.service_ticket_id',
  't.project_id',
  't.template_id',
  't.occurrence_date',
  't.group_id',
  't.evidence_required',
  't.approval_required',
  't.reopen_count',
  't.rework_count',
  't.extension_count',
  't.reassign_count',
  't.excused_delay_minutes',
  't.unexcused_locked_minutes',
  't.is_backlog',
  't.generated_late',
  't.source',
  't.related_entity_type',
  't.related_entity_id',
  't.version',
  't.created_at',
  't.updated_at',
  't.cancelled_reason',
  't.cancelled_at',
  't.completion_remarks',
  't.delay_reason',
  't.created_by',
  't.progress_at_completion',
] as const;

@Injectable()
export class TaskStore {
  constructor(
    @Inject(TASK_DB) readonly db: Kysely<Database>,
    @Inject(TASK_CONFIG) readonly config: TaskConfig,
    readonly events: EventEmitter2,
    readonly masters: TaskMastersService,
    readonly access: TaskAccessService,
  ) {}

  // ------------------------------------------------------------------ reads
  /** Base scoped query: tasks `t`, assignee `emp`. */
  scoped(user: AuthUser, s: TaskSettings, db: DB = this.db) {
    return db.selectFrom('tasks as t').leftJoin('users as emp', 'emp.id', 't.assigned_to').where(this.access.scope(user, s));
  }

  /** Adds display joins (names, codes) and the open-blocker summary. */
  withJoins<Q extends ReturnType<TaskStore['scoped']>>(q: Q) {
    return q
      .leftJoin('users as asg', 'asg.id', 't.assigned_by')
      .leftJoin('users as rm', 'rm.id', 't.reporting_manager_id')
      .leftJoin('task_categories as cat', 'cat.id', 't.category_id')
      .leftJoin('departments as dep', 'dep.id', 't.department_id')
      .leftJoin('organisations as cust', 'cust.id', 't.customer_id')
      .leftJoin('tenders as tdr', 'tdr.id', 't.tender_id')
      .leftJoin('demos as dmo', 'dmo.id', 't.demo_id')
      .leftJoin('service_tickets as stk', 'stk.id', 't.service_ticket_id')
      .leftJoin('task_templates as tpl', 'tpl.id', 't.template_id')
      .select([
        ...TASK_LIST_COLUMNS,
        'emp.full_name as assignee_name',
        'emp.is_active as assignee_active',
        'asg.full_name as assigned_by_name',
        'rm.full_name as reporting_manager_name',
        'cat.code as category_code',
        'cat.name as category_name',
        'dep.name as department_name',
        'cust.name as customer_name',
        'tdr.tender_no as tender_no',
        'dmo.demo_no as demo_no',
        'stk.ticket_no as ticket_no',
        'tpl.recurrence_type as recurrence_type',
        sql<any>`(select json_build_object('id', b.id, 'status', b.status, 'blocker_type', b.blocker_type, 'raised_at', b.created_at,
                  'raised_after_deadline', b.raised_after_deadline, 'raised_by', b.raised_by, 'dependency_user_id', b.dependency_user_id)
                  from task_blockers b where b.task_id = t.id and b.status in ('pending_review', 'accepted') limit 1)`.as('open_blocker'),
      ] as any);
  }

  /** Visible task or 404 (never 403 — do not leak existence). */
  async getVisible(id: string, user: AuthUser, db: DB = this.db) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Task not found');
    const s = await this.masters.settings();
    const row = await this.scoped(user, s, db).selectAll('t').where('t.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Task not found');
    return row;
  }

  /** Row lock for a mutation; re-read inside the transaction so status/version are current. */
  async lock(trx: Transaction<Database>, id: string) {
    const row = await trx.selectFrom('tasks').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw new NotFoundException('Task not found');
    return row;
  }

  async openBlocker(db: DB, taskId: string) {
    return db
      .selectFrom('task_blockers')
      .selectAll()
      .where('task_id', '=', taskId)
      .where('status', 'in', ['pending_review', 'accepted'])
      .executeTakeFirst();
  }

  // ------------------------------------------------------------------ writes
  async log(
    db: DB,
    taskId: string,
    row: { kind: string; author: AuthUser | null; comment?: string | null; progress?: number | null; from?: string | null; to?: string | null; metadata?: unknown },
  ) {
    await db
      .insertInto('task_updates')
      .values({
        task_id: taskId,
        author_id: row.author?.id ?? null,
        kind: row.kind,
        comment: row.comment ?? null,
        progress_percent: row.progress ?? null,
        status_from: row.from ?? null,
        status_to: row.to ?? null,
        metadata: row.metadata === undefined ? null : JSON.stringify(row.metadata),
      })
      .execute();
  }

  audit(user: AuthUser | null, entityType: string, entityId: string, action: string, previousValue?: unknown, newValue?: unknown) {
    this.events.emit('audit.log', { actorId: user?.id ?? null, entityType, entityId, action, previousValue, newValue });
  }

  emit(event: string, payload: Record<string, unknown>) {
    this.events.emit(event, payload);
  }

  // ------------------------------------------------------------------ serialisation
  serialize(r: any, s: TaskSettings, now: Date = new Date()) {
    if (!r) return r;
    const ob = typeof r.open_blocker === 'string' ? JSON.parse(r.open_blocker) : r.open_blocker || null;
    const hasAccepted = ob?.status === 'accepted';
    const input = { ...r, has_accepted_blocker: hasAccepted, accepted_blocker_raised_at: hasAccepted ? ob.raised_at : null };
    const delay = computeTaskDelay(input, now);
    const display = taskDisplayStatus(input, now);
    return {
      ...r,
      open_blocker: ob,
      is_overdue: isTaskOverdue(input, now),
      display_status: display,
      display_status_label: TASK_STATUS_LABELS[display],
      delay_class: delay.delay_class,
      total_delay_days: minutesToDays(delay.total_delay_minutes),
      excused_delay_days: minutesToDays(delay.excused_delay_minutes),
      unexcused_delay_days: minutesToDays(delay.unexcused_delay_minutes),
      no_update: isTaskWithoutUpdate(input, s, now),
      due_label: r.deadline && ['not_started', 'in_progress', 'blocked'].includes(r.status) ? relativeDue(r.deadline, now).label : null,
    };
  }

  // ------------------------------------------------------------------ SQL mirrors of the shared rules
  /** Derived OVERDUE (mirrors isTaskOverdue). */
  overdueSql(alias = 't'): RawBuilder<boolean> {
    const t = sql.ref(alias);
    return sql<boolean>`(${t}.deadline is not null and ${t}.deadline < now() and (${t}.status in ('not_started', 'in_progress')
      or (${t}.status = 'blocked' and not exists (select 1 from task_blockers ob where ob.task_id = ${t}.id and ob.status = 'accepted'))))`;
  }

  /** No assignee update beyond the priority threshold (mirrors isTaskWithoutUpdate). */
  noUpdateSql(s: TaskSettings, alias = 't'): RawBuilder<boolean> {
    const t = sql.ref(alias);
    return sql<boolean>`(${t}.status in ('not_started', 'in_progress', 'blocked')
      and not (${t}.status = 'blocked' and exists (select 1 from task_blockers nb where nb.task_id = ${t}.id and nb.status = 'accepted'))
      and coalesce(${t}.last_update_at, ${t}.created_at) < now() - make_interval(days => case ${t}.priority
        when 'critical' then ${s.no_update_days_critical}::int when 'high' then ${s.no_update_days_high}::int
        when 'low' then ${s.no_update_days_low}::int else ${s.no_update_days_medium}::int end))`;
  }

  /** Delay classes (mirrors computeTaskDelay's classification). */
  delayClassSql(cls: TaskDelayClass, alias = 't'): RawBuilder<boolean> {
    const t = sql.ref(alias);
    const done = sql`(${t}.completed_at is not null and ${t}.status in ('completed', 'awaiting_approval'))`;
    const orig = sql`coalesce(${t}.original_deadline, ${t}.deadline)`;
    switch (cls) {
      case 'on_time':
        return sql<boolean>`(${done} and (${orig} is null or ${t}.completed_at <= ${orig}))`;
      case 'late_excused':
        return sql<boolean>`(${done} and ${t}.completed_at > ${orig} and ${t}.unexcused_locked_minutes = 0 and ${t}.completed_at <= coalesce(${t}.deadline, ${orig}))`;
      case 'late_unexcused':
        return sql<boolean>`(${done} and ${t}.completed_at > ${orig} and (${t}.unexcused_locked_minutes > 0 or ${t}.completed_at > coalesce(${t}.deadline, ${orig})))`;
      case 'open_overdue':
        return this.overdueSql(alias);
      default:
        return sql<boolean>`(${t}.status in ('not_started', 'in_progress', 'blocked') and not ${this.overdueSql(alias)})`;
    }
  }

  /**
   * Work routed to `user` for a decision (approval / blocker review): they are the assignee's first active
   * manager, an open escalation target, the department head, or a fallback approver when no manager exists.
   */
  routedToSql(user: AuthUser, s: TaskSettings, alias = 't'): RawBuilder<boolean> {
    const t = sql.ref(alias);
    const fallbackRoles = s.fallback_approver_role === 'admin' ? ['admin'] : ['management', 'admin'];
    const isFallback = fallbackRoles.includes(user.role);
    return sql<boolean>`(${t}.assigned_to <> ${user.id} and (
      (select c.id from user_manager_chain(${t}.assigned_to) c where c.is_active order by c.depth limit 1) = ${user.id}
      or exists (select 1 from task_escalations e where e.task_id = ${t}.id and e.escalated_to = ${user.id} and e.status <> 'closed')
      or ${t}.department_id in (select id from departments where head_user_id = ${user.id})
      or (${isFallback}::boolean and not exists (select 1 from user_manager_chain(${t}.assigned_to) c where c.is_active))
    ))`;
  }
}
