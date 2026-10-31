/**
 * The one place task statuses change (§4). Every action:
 * visibility (404) → permission via the shared transition map (403) → current status (409) → version (409)
 * → one DB transaction with a row lock → task_updates row → audit → notification event.
 * The frontend never sets a status directly.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import {
  TASK_MIN_COMMENT_LENGTH,
  TASK_MIN_EVIDENCE_REMARKS,
  TASK_REASSIGN_REASONS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  planDeadlineExtension,
  planPauseResume,
  resolveTaskAction,
  type AuthUser,
  type Database,
  type TaskAction,
  type TaskStatus,
  type TaskTransitionRule,
} from '@arihant/shared';
import { TaskStore, TASK_EVENTS, type DB } from './task-store.service.js';
import { TasksService } from './tasks.service.js';
import { isLinked } from './task-input.service.js';
import { isAdminLike, type TaskSettings } from './task-masters.service.js';
import {
  TaskValidationException,
  UUID_RE,
  conflict,
  readComment,
  readDeadline,
  readEnum,
  readInt,
  readText,
  readUuid,
  readVersion,
  staleVersion,
  throwIfErrors,
  type FieldErrors,
} from './task-common.js';

type TaskRow = Awaited<ReturnType<TaskStore['lock']>>;
type Outcome = { from: string; to: string; events: [string, Record<string, unknown>][]; audit: Record<string, unknown> };

export function forbiddenFor(reason: string, action: string, status: string) {
  if (reason === 'invalid_status') {
    return conflict(`"${action.replace(/_/g, ' ')}" is not allowed while the task is ${TASK_STATUS_LABELS[status as TaskStatus] || status}. Refresh to see its current state.`);
  }
  if (reason === 'self') return new ForbiddenException('You cannot approve, cancel, extend, reassign or escalate your own task — your manager does this.');
  if (reason === 'unknown') return new BadRequestException(`Unknown action "${action}".`);
  return new ForbiddenException('You do not have permission to do this on this task.');
}

const COMMENT_FIELD: Partial<Record<TaskAction, string>> = { send_back: 'reason', reopen: 'reason', cancel: 'reason', extend_deadline: 'reason', reassign: 'reason', escalate: 'reason', correction: 'reason' };

@Injectable()
export class TaskWorkflowService {
  constructor(
    private readonly store: TaskStore,
    private readonly tasks: TasksService,
  ) {}

  private get db() {
    return this.store.db;
  }

  async act(id: string, action: TaskAction, dto: Record<string, unknown>, user: AuthUser) {
    await this.store.getVisible(id, user);
    const s = await this.store.masters.settings();
    const outcome = await this.db.transaction().execute(async (trx) => {
      const task = await this.store.lock(trx, id);
      const kinds = await this.store.access.actorKinds(task, user);
      const r = resolveTaskAction(task.status, action, kinds);
      if (!r.ok) throw forbiddenFor(r.reason, action, task.status);
      if (task.version !== readVersion(dto.version)) throw staleVersion();
      const field = COMMENT_FIELD[action] || 'comment';
      const comment = readComment(dto[field] ?? dto.comment ?? dto.reason, {
        required: r.rule.commentRequired,
        min: TASK_MIN_COMMENT_LENGTH,
        field,
        label: field === 'reason' ? 'Reason' : 'Comment',
      });
      return this.apply(trx, task, r.rule, comment, dto, user, s, kinds.has('assignee'));
    });
    for (const [event, payload] of outcome.events) this.store.emit(event, payload);
    this.store.audit(user, 'task', id, `task_${action}`, { status: outcome.from }, { status: outcome.to, ...outcome.audit });
    return this.tasks.detail(id, user);
  }

  /** Writes the status/version change; the shared map has already authorised it. */
  private async commit(trx: Transaction<Database>, task: TaskRow, patch: Record<string, unknown>, user: AuthUser | null) {
    const res = await trx
      .updateTable('tasks')
      .set({ ...(patch as any), version: sql`version + 1`, updated_by: user?.id ?? null })
      .where('id', '=', task.id)
      .where('version', '=', task.version)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw staleVersion();
  }

  private base(task: TaskRow) {
    return { taskId: task.id, taskNumber: task.task_number, title: task.title, assigneeId: task.assigned_to };
  }

  private async apply(
    trx: Transaction<Database>,
    task: TaskRow,
    rule: TaskTransitionRule,
    comment: string | null,
    dto: Record<string, unknown>,
    user: AuthUser,
    s: TaskSettings,
    isAssignee: boolean,
  ): Promise<Outcome> {
    const now = new Date();
    const from = task.status;
    const events: Outcome['events'] = [];
    switch (rule.action) {
      // ------------------------------------------------------------------ assignee
      case 'start': {
        await this.commit(trx, task, { status: 'in_progress', started_at: now, last_update_at: now }, user);
        await this.store.log(trx, task.id, { kind: 'start', author: user, comment, from, to: 'in_progress' });
        return { from, to: 'in_progress', events, audit: {} };
      }

      case 'progress': {
        const errors: FieldErrors = {};
        const progress = dto.progress_percent === undefined || dto.progress_percent === null || dto.progress_percent === '' ? null : readInt(errors, 'progress_percent', dto.progress_percent, { min: 0, max: 100, label: 'Progress' });
        const attachmentIds = Array.isArray(dto.attachment_ids) ? dto.attachment_ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
        throwIfErrors(errors);
        if (!isAssignee && progress !== null) throw new TaskValidationException({ progress_percent: 'Only the assignee updates progress — add a comment instead.' });
        if (!comment && progress === null && !attachmentIds.length) throw new TaskValidationException({ comment: 'Add a comment, a progress value or a file.' });
        if (isAssignee) {
          const to: TaskStatus = task.status === 'not_started' && (progress ?? 0) > 0 ? 'in_progress' : task.status;
          await this.commit(trx, task, {
            ...(progress !== null ? { progress_percent: progress } : {}),
            status: to,
            ...(to !== from ? { started_at: now } : {}),
            last_update_at: now,
          }, user);
          await this.store.log(trx, task.id, { kind: 'progress', author: user, comment, progress, from, to, metadata: attachmentIds.length ? { attachment_ids: attachmentIds } : undefined });
          return { from, to, events, audit: { progress } };
        }
        await this.commit(trx, task, {}, user);
        await this.store.log(trx, task.id, { kind: 'comment', author: user, comment, metadata: attachmentIds.length ? { attachment_ids: attachmentIds } : undefined });
        events.push([TASK_EVENTS.COMMENTED, { ...this.base(task), actorId: user.id, actorName: user.full_name, comment }]);
        return { from, to: from, events, audit: {} };
      }

      case 'complete': {
        const errors: FieldErrors = {};
        const remarks = readText(errors, 'remarks', dto.remarks ?? comment, 2000, {
          required: task.evidence_required,
          minLength: task.evidence_required ? TASK_MIN_EVIDENCE_REMARKS : undefined,
          label: 'Completion remarks',
        });
        const late = task.deadline ? now.getTime() > new Date(task.deadline).getTime() : false;
        const delayReason = readText(errors, 'delay_reason', dto.delay_reason, 1000, { required: late, minLength: late ? 10 : undefined, label: 'Reason for delay' });
        if (task.evidence_required) {
          const ev = await trx
            .selectFrom('task_attachments')
            .select(sql<number>`count(*)::int`.as('n'))
            .where('task_id', '=', task.id)
            .where('purpose', '=', 'evidence')
            .where('deleted_at', 'is', null)
            .executeTakeFirst();
          if (!Number(ev?.n)) errors.evidence = 'Upload at least one evidence file before completing this task.';
        }
        // Progress is no longer tracked as a percentage in the app (status shows where the work is), so completing
        // a task needs no "it is really 100%" confirmation; it is still recorded as 100% below.
        throwIfErrors(errors);
        let to: TaskStatus = 'completed';
        let approverIds: string[] = [];
        if (task.approval_required) {
          approverIds = (await this.store.access.requireApprovers(task.assigned_to!)).ids;
          to = 'awaiting_approval';
        }
        if (from === 'not_started') await this.store.log(trx, task.id, { kind: 'start', author: user, from, to: 'in_progress', metadata: { auto: true } });
        await this.commit(trx, task, {
          status: to,
          started_at: task.started_at ?? now,
          completed_at: now,
          progress_at_completion: task.progress_percent,
          progress_percent: 100,
          completion_remarks: remarks,
          delay_reason: delayReason,
          last_update_at: now,
          ...(to === 'completed' ? { approved_at: null, approved_by: null } : {}),
        }, user);
        await this.store.log(trx, task.id, {
          kind: to === 'awaiting_approval' ? 'submit_for_approval' : 'complete',
          author: user,
          comment: remarks,
          progress: 100,
          from: from === 'not_started' ? 'in_progress' : from,
          to,
          metadata: { late, delay_reason: delayReason, progress_before: task.progress_percent },
        });
        events.push([TASK_EVENTS.COMPLETED, { ...this.base(task), actorId: user.id, actorName: user.full_name, awaitingApproval: to === 'awaiting_approval', approverIds, late }]);
        return { from, to, events, audit: { late } };
      }

      // ------------------------------------------------------------------ manager
      case 'approve': {
        await this.commit(trx, task, { status: 'completed', approved_at: now, approved_by: user.id }, user);
        await this.store.log(trx, task.id, { kind: 'approve', author: user, comment, from, to: 'completed' });
        events.push([TASK_EVENTS.APPROVED, { ...this.base(task), actorId: user.id, actorName: user.full_name, comment }]);
        return { from, to: 'completed', events, audit: {} };
      }

      case 'send_back':
      case 'reopen': {
        const extension = await this.optionalExtension(trx, task, dto, user, comment!, now);
        const counter = rule.action === 'send_back' ? { rework_count: task.rework_count + 1 } : { reopen_count: task.reopen_count + 1 };
        await this.commit(trx, task, {
          status: 'in_progress',
          completed_at: null,
          approved_at: null,
          approved_by: null,
          last_update_at: now,
          ...counter,
          ...extension.patch,
        }, user);
        await this.store.log(trx, task.id, { kind: rule.action, author: user, comment, from, to: 'in_progress', metadata: extension.meta });
        events.push([rule.action === 'send_back' ? TASK_EVENTS.SENT_BACK : TASK_EVENTS.REOPENED, { ...this.base(task), actorId: user.id, actorName: user.full_name, comment }]);
        return { from, to: 'in_progress', events, audit: { ...counter } };
      }

      case 'cancel': {
        await this.closeOpenBlocker(trx, task, user, 'Task cancelled', now, false);
        await trx
          .updateTable('task_escalations')
          .set({ status: 'closed', closed_at: now, closed_by: user.id, outcome_comment: 'Task cancelled' })
          .where('task_id', '=', task.id)
          .where('status', '<>', 'closed')
          .execute();
        await this.commit(trx, task, { status: 'cancelled', cancelled_reason: comment, cancelled_by: user.id, cancelled_at: now }, user);
        await this.store.log(trx, task.id, { kind: 'cancel', author: user, comment, from, to: 'cancelled' });
        events.push([TASK_EVENTS.CANCELLED, { ...this.base(task), actorId: user.id, actorName: user.full_name, comment }]);
        return { from, to: 'cancelled', events, audit: { reason: comment } };
      }

      case 'extend_deadline': {
        const errors: FieldErrors = {};
        const newDeadline = readDeadline(errors, 'new_deadline', dto.new_deadline, { required: true, label: 'New deadline' });
        throwIfErrors(errors);
        this.assertLaterDeadline(task, newDeadline!, now);
        const ext = await this.recordExtension(trx, task, newDeadline!, comment!, 'manager_extension', null, now, user);
        await this.commit(trx, task, ext.patch, user);
        await this.store.log(trx, task.id, { kind: 'extend_deadline', author: user, comment, metadata: ext.meta });
        events.push([TASK_EVENTS.DEADLINE_EXTENDED, { ...this.base(task), actorId: user.id, actorName: user.full_name, newDeadline: newDeadline!.toISOString(), comment }]);
        return { from, to: from, events, audit: ext.meta };
      }

      case 'reassign': {
        const errors: FieldErrors = {};
        const toId = readUuid(errors, 'to_user_id', dto.to_user_id, { required: true, label: 'New assignee' });
        const reasonType = readEnum(errors, 'reason_type', dto.reason_type, TASK_REASSIGN_REASONS, { label: 'Reason type', fallback: 'other' });
        const newDeadline = readDeadline(errors, 'new_deadline', dto.new_deadline, { label: 'New deadline' });
        throwIfErrors(errors);
        if (toId === task.assigned_to) throw new TaskValidationException({ to_user_id: 'This task is already assigned to that person.' });
        const target = await trx.selectFrom('users').select(['id', 'full_name', 'is_active', 'reporting_manager_id', 'department_id']).where('id', '=', toId!).executeTakeFirst();
        if (!target) throw new TaskValidationException({ to_user_id: 'Employee not found.' });
        if (!target.is_active) throw new TaskValidationException({ to_user_id: `${target.full_name} is inactive.` });
        const scope = await this.store.access.assignScope(user, target.id, isLinked(task));
        if (!scope.ok) throw new TaskValidationException({ to_user_id: scope.reason });
        if (task.approval_required) await this.store.access.requireApprovers(target.id);
        if (newDeadline && newDeadline.getTime() <= now.getTime()) throw new TaskValidationException({ new_deadline: 'The new deadline must be in the future.' });

        const overdueMinutes = task.deadline && new Date(task.deadline) < now ? Math.floor((now.getTime() - new Date(task.deadline).getTime()) / 60000) : 0;
        // An open blocker belonged to the previous assignee's situation: close it (pause time is credited).
        const closed = await this.closeOpenBlocker(trx, task, user, 'Closed on reassignment', now, true);
        const patch: Record<string, unknown> = {
          assigned_to: target.id,
          reporting_manager_id: target.reporting_manager_id,
          department_id: target.department_id,
          reassign_count: task.reassign_count + 1,
          unexcused_locked_minutes: 0,
          last_update_at: now,
          ...(closed?.restoreStatus ? { status: closed.restoreStatus } : {}),
          ...(closed?.patch || {}),
        };
        if (newDeadline) {
          const current = (closed?.patch?.deadline as Date | undefined) ?? task.deadline;
          await trx
            .insertInto('task_deadline_changes')
            .values({ task_id: task.id, old_deadline: current, new_deadline: newDeadline, reason: comment!, source: 'reassignment', changed_by: user.id })
            .execute();
          patch.deadline = newDeadline;
        }
        await trx
          .insertInto('task_assignment_history')
          .values({
            task_id: task.id,
            from_user_id: task.assigned_to,
            to_user_id: target.id,
            reason: comment!,
            reason_type: reasonType!,
            was_overdue: overdueMinutes > 0,
            overdue_minutes: overdueMinutes,
            changed_by: user.id,
          })
          .execute();
        await this.commit(trx, task, patch, user);
        const to = (patch.status as string) || from;
        await this.store.log(trx, task.id, {
          kind: 'reassign',
          author: user,
          comment,
          from,
          to,
          metadata: { from_user_id: task.assigned_to, to_user_id: target.id, to_name: target.full_name, reason_type: reasonType, new_deadline: newDeadline?.toISOString() ?? null, was_overdue: overdueMinutes > 0 },
        });
        events.push([TASK_EVENTS.REASSIGNED, { ...this.base(task), previousAssigneeId: task.assigned_to, assigneeId: target.id, actorId: user.id, actorName: user.full_name, comment }]);
        return { from, to, events, audit: { from_user_id: task.assigned_to, to_user_id: target.id, reason_type: reasonType } };
      }

      case 'escalate': {
        const errors: FieldErrors = {};
        let toId = readUuid(errors, 'to_user_id', dto.to_user_id, { label: 'Escalate to' });
        throwIfErrors(errors);
        const allowed = new Set((await this.escalationTargets(trx, task, user)).map((t) => t.id));
        if (!toId) {
          const mine = (await this.store.access.managerChain(user.id)).find((c) => c.is_active && allowed.has(c.id));
          if (mine) toId = mine.id;
          else {
            const mgmt = await trx
              .selectFrom('users')
              .select('id')
              .where('role', '=', 'management')
              .where('is_active', '=', true)
              .where('id', 'not in', [user.id, task.assigned_to!].filter(Boolean))
              .orderBy('created_at')
              .execute();
            toId = mgmt.find((m) => allowed.has(m.id))?.id ?? null;
          }
        }
        if (!toId) throw new TaskValidationException({ to_user_id: 'There is nobody above you to escalate to — choose a management user.' });
        if (toId === user.id || toId === task.assigned_to) throw new TaskValidationException({ to_user_id: 'Escalate to someone other than yourself or the assignee.' });
        if (!allowed.has(toId)) {
          throw new TaskValidationException({ to_user_id: 'Escalate upward — to someone above you in the reporting line, a department head or management.' });
        }
        const target = await trx.selectFrom('users').select(['id', 'full_name', 'is_active', 'role']).where('id', '=', toId).executeTakeFirst();
        if (!target?.is_active) throw new TaskValidationException({ to_user_id: 'Escalation target must be an active user.' });
        const ob = await this.store.openBlocker(trx, task.id);
        const esc = await trx
          .insertInto('task_escalations')
          .values({ task_id: task.id, blocker_id: ob?.id ?? null, escalated_by: user.id, escalated_to: target.id, reason: comment! })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.commit(trx, task, {}, user);
        await this.store.log(trx, task.id, { kind: 'escalate', author: user, comment, metadata: { escalation_id: esc.id, to_user_id: target.id, to_name: target.full_name, blocker_id: ob?.id ?? null } });
        events.push([TASK_EVENTS.ESCALATED, { ...this.base(task), escalatedToId: target.id, actorId: user.id, actorName: user.full_name, comment }]);
        return { from, to: from, events, audit: { escalated_to: target.id } };
      }

      case 'correction': {
        const errors: FieldErrors = {};
        const status = dto.status === undefined ? null : readEnum(errors, 'status', dto.status, TASK_STATUSES, { label: 'Status' });
        const progress = dto.progress_percent === undefined ? null : readInt(errors, 'progress_percent', dto.progress_percent, { min: 0, max: 100, label: 'Progress' });
        const deadline = dto.deadline === undefined ? null : readDeadline(errors, 'deadline', dto.deadline, { label: 'Deadline', required: true });
        const completedAt = dto.completed_at === undefined ? undefined : dto.completed_at === null || dto.completed_at === '' ? null : readDeadline(errors, 'completed_at', dto.completed_at, { label: 'Completed at' });
        throwIfErrors(errors);
        const patch: Record<string, unknown> = {};
        if (status && status !== task.status) {
          const ob = await this.store.openBlocker(trx, task.id);
          if (status === 'blocked' && !ob) throw new TaskValidationException({ status: 'A task can only be BLOCKED with an open blocker — raise one instead.' });
          if (status !== 'blocked' && ob) {
            // Same as resolving it: an accepted PAUSE blocker's blocked time is added to the deadline.
            const closed = await this.closeOpenBlocker(trx, task, user, 'Closed by admin correction', now, true);
            if (closed?.patch) Object.assign(patch, closed.patch);
          }
          patch.status = status;
          if (status === 'cancelled') Object.assign(patch, { cancelled_reason: comment, cancelled_by: user.id, cancelled_at: now });
          if ((status === 'completed' || status === 'awaiting_approval') && !task.completed_at && completedAt === undefined) patch.completed_at = now;
        }
        if (progress !== null) patch.progress_percent = progress;
        if (completedAt !== undefined) patch.completed_at = completedAt;
        if (deadline) {
          const current = (patch.deadline as Date | undefined) ?? task.deadline;
          await trx.insertInto('task_deadline_changes').values({ task_id: task.id, old_deadline: current, new_deadline: deadline, reason: comment!, source: 'correction', changed_by: user.id }).execute();
          patch.deadline = deadline;
        }
        if (!Object.keys(patch).length) throw new TaskValidationException({ status: 'Nothing to correct.' });
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (task as any)[k]]));
        await this.commit(trx, task, patch, user);
        await this.store.log(trx, task.id, { kind: 'correction', author: user, comment, from, to: (patch.status as string) || from, metadata: { before, after: patch } });
        return { from, to: (patch.status as string) || from, events, audit: { before, after: patch } };
      }

      default:
        throw new BadRequestException(`Action "${rule.action}" is handled elsewhere.`);
    }
  }

  // ------------------------------------------------------------------ escalation targets
  /**
   * Escalation goes upward: the escalating manager's own reporting line, the head of the task's or their own
   * department, or management / admin. Never the escalator, the assignee, or the person the open blocker is
   * waiting on (they would be deciding their own dependency).
   */
  async escalationTargets(db: DB, task: TaskRow, user: AuthUser) {
    const chain = (await this.store.access.managerChain(user.id)).filter((c) => c.is_active).map((c) => c.id);
    const ob = await this.store.openBlocker(db, task.id);
    const exclude = [user.id, task.assigned_to, ob?.dependency_user_id].filter((x): x is string => Boolean(x));
    return db
      .selectFrom('users as u')
      .select(['u.id', 'u.full_name', 'u.role'])
      .where('u.is_active', '=', true)
      .where('u.id', 'not in', exclude)
      .where((eb) =>
        eb.or([
          ...(chain.length ? [eb('u.id', 'in', chain)] : []),
          eb('u.role', 'in', ['management', 'admin']),
          sql<boolean>`u.id in (select d.head_user_id from departments d where d.head_user_id is not null
            and (d.id = ${task.department_id} or d.id = (select me.department_id from users me where me.id = ${user.id})))`,
        ]),
      )
      .orderBy('u.full_name')
      .execute();
  }

  /** Who `user` may escalate this task to (the escalate dialog's list); refused like the action itself. */
  async listEscalationTargets(id: string, user: AuthUser) {
    const task = await this.store.getVisible(id, user);
    const r = resolveTaskAction(task.status, 'escalate', await this.store.access.actorKinds(task, user));
    if (!r.ok) throw forbiddenFor(r.reason, 'escalate', task.status);
    return this.escalationTargets(this.db, task, user);
  }

  // ------------------------------------------------------------------ helpers
  assertLaterDeadline(task: { deadline: Date | null }, newDeadline: Date, now: Date) {
    if (newDeadline.getTime() <= now.getTime()) throw new TaskValidationException({ new_deadline: 'The new deadline must be in the future.' });
    if (task.deadline && newDeadline.getTime() <= new Date(task.deadline).getTime()) {
      throw new TaskValidationException({ new_deadline: 'The new deadline must be later than the current deadline.' });
    }
  }

  /** Writes the deadline change with excused / locked minutes (excuses are never retroactive). */
  async recordExtension(
    trx: Transaction<Database>,
    task: TaskRow,
    newDeadline: Date,
    reason: string,
    source: 'manager_extension' | 'blocker_accepted',
    blocker: { id: string; created_at: Date } | null,
    now: Date,
    user: AuthUser,
  ) {
    const plan = planDeadlineExtension({ deadline: task.deadline ? new Date(task.deadline) : null, new_deadline: newDeadline, excuse_from: blocker ? new Date(blocker.created_at) : now });
    await trx
      .insertInto('task_deadline_changes')
      .values({
        task_id: task.id,
        old_deadline: task.deadline,
        new_deadline: newDeadline,
        reason,
        source,
        blocker_id: blocker?.id ?? null,
        excused_minutes: plan.excused_minutes,
        locked_unexcused_minutes: plan.locked_minutes,
        changed_by: user.id,
      })
      .execute();
    return {
      plan,
      patch: {
        deadline: newDeadline,
        extension_count: task.extension_count + 1,
        excused_delay_minutes: task.excused_delay_minutes + plan.excused_minutes,
        unexcused_locked_minutes: task.unexcused_locked_minutes + plan.locked_minutes,
      },
      meta: { old_deadline: task.deadline, new_deadline: newDeadline.toISOString(), excused_minutes: plan.excused_minutes, locked_unexcused_minutes: plan.locked_minutes, source },
    };
  }

  /** Optional new deadline when sending back / reopening (the manager decides whether rework time is excused). */
  private async optionalExtension(trx: Transaction<Database>, task: TaskRow, dto: Record<string, unknown>, user: AuthUser, reason: string, now: Date) {
    if (dto.new_deadline === undefined || dto.new_deadline === null || dto.new_deadline === '') return { patch: {}, meta: undefined };
    const errors: FieldErrors = {};
    const d = readDeadline(errors, 'new_deadline', dto.new_deadline, { label: 'New deadline', required: true });
    throwIfErrors(errors);
    this.assertLaterDeadline(task, d!, now);
    const ext = await this.recordExtension(trx, task, d!, reason, 'manager_extension', null, now, user);
    return { patch: ext.patch, meta: ext.meta };
  }

  /**
   * Closes the task's open blocker (cancel / reassign / correction). One still awaiting review is withdrawn (never
   * decided); an accepted one is resolved, so it keeps counting once, as accepted. An accepted PAUSE blocker credits
   * its blocked time to the deadline exactly like a normal resolution when `creditPause` is set.
   */
  async closeOpenBlocker(trx: Transaction<Database>, task: TaskRow, user: AuthUser, note: string, now: Date, creditPause: boolean) {
    const ob = await this.store.openBlocker(trx, task.id);
    if (!ob) return null;
    let patch: Record<string, unknown> | undefined;
    let excused = 0;
    if (creditPause && ob.status === 'accepted' && (ob.decision === 'accept_pause' || ob.decision === 'auto_accept_leave') && task.deadline) {
      const p = planPauseResume({ deadline: new Date(task.deadline), raised_at: new Date(ob.created_at), resolved_at: now, within: await this.store.leaveWindowFor(trx, ob) });
      if (p.shift_minutes > 0) {
        excused = p.shift_minutes;
        await trx
          .insertInto('task_deadline_changes')
          .values({ task_id: task.id, old_deadline: task.deadline, new_deadline: p.new_deadline, reason: note, source: 'pause_resume', blocker_id: ob.id, excused_minutes: p.shift_minutes, changed_by: user.id })
          .execute();
        patch = { deadline: p.new_deadline, excused_delay_minutes: task.excused_delay_minutes + p.shift_minutes };
      }
    }
    await trx
      .updateTable('task_blockers')
      .set({ status: ob.status === 'pending_review' ? 'withdrawn' : 'resolved', resolved_at: now, resolved_by: user.id, resolution_note: note, excused_minutes: ob.excused_minutes + excused })
      .where('id', '=', ob.id)
      .execute();
    return { blocker: ob, patch, restoreStatus: task.status === 'blocked' ? ((ob.previous_task_status as TaskStatus) || 'in_progress') : null };
  }

  // ------------------------------------------------------------------ bulk
  async bulk(action: 'reassign' | 'extend_deadline', dto: Record<string, unknown>, user: AuthUser) {
    const items = Array.isArray(dto.items) ? dto.items.slice(0, 100) : [];
    if (!items.length) throw new TaskValidationException({ items: 'Select at least one task.' });
    const results: { id: string; task_number?: string; ok: boolean; error?: string }[] = [];
    for (const raw of items) {
      const item = (raw || {}) as Record<string, unknown>;
      const id = String(item.id || '');
      try {
        const res: any = await this.act(id, action, { ...dto, items: undefined, version: item.version }, user);
        results.push({ id, task_number: res.task_number, ok: true });
      } catch (err: any) {
        const body = err?.getResponse?.();
        const fieldMsg = body?.errors ? Object.values(body.errors).join(' ') : null;
        results.push({ id, ok: false, error: fieldMsg || body?.message || err?.message || 'Failed' });
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  // ------------------------------------------------------------------ escalations
  async escalationAction(escalationId: string, action: 'acknowledge' | 'close', dto: Record<string, unknown>, user: AuthUser) {
    if (!UUID_RE.test(escalationId)) throw new TaskValidationException({ id: 'Invalid escalation.' });
    const esc = await this.db.selectFrom('task_escalations').selectAll().where('id', '=', escalationId).executeTakeFirst();
    if (!esc) throw new TaskValidationException({ id: 'Escalation not found.' });
    await this.store.getVisible(esc.task_id, user);
    if (esc.escalated_to !== user.id && !isAdminLike(user)) throw new ForbiddenException('Only the person this was escalated to can respond.');
    if (esc.status === 'closed') throw conflict('This escalation is already closed.');
    if (action === 'acknowledge' && esc.status !== 'open') throw conflict('This escalation was already acknowledged.');
    const comment = readComment(dto.comment, { required: action === 'close', min: TASK_MIN_COMMENT_LENGTH });
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('task_escalations')
        .set(action === 'acknowledge' ? { status: 'acknowledged', acknowledged_at: now } : { status: 'closed', closed_at: now, closed_by: user.id, outcome_comment: comment })
        .where('id', '=', escalationId)
        .execute();
      await this.store.log(trx, esc.task_id, { kind: action === 'acknowledge' ? 'escalation_acknowledged' : 'escalation_closed', author: user, comment, metadata: { escalation_id: escalationId } });
    });
    this.store.audit(user, 'task', esc.task_id, `task_escalation_${action}`, { status: esc.status }, { comment });
    return this.tasks.detail(esc.task_id, user);
  }
}
