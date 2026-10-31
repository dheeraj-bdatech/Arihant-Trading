/**
 * Blocker workflow (§5) — separates genuine dependencies from poor execution.
 * Raise (assignee) → PENDING_REVIEW; the reviewer is the assignee's current manager (never the assignee).
 * Accept with EXTEND (new deadline now) or PAUSE (deadline shifts by the blocked time on resolution),
 * Reject (task returns to its previous status, the clock never paused), Resolve, Withdraw.
 * Approved leave matching the leave register can be auto-accepted (setting).
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import {
  TASK_BLOCKER_TYPES,
  TASK_MIN_BLOCKER_DESCRIPTION,
  TASK_MIN_COMMENT_LENGTH,
  istDateOf,
  planPauseResume,
  resolveTaskAction,
  todayInKolkata,
  type AuthUser,
  type TaskBlockerType,
} from '@arihant/shared';
import { TaskStore, TASK_EVENTS } from './task-store.service.js';
import { TasksService } from './tasks.service.js';
import { TaskWorkflowService, forbiddenFor } from './task-workflow.service.js';
import { isAdminLike } from './task-masters.service.js';
import {
  TaskValidationException,
  UUID_RE,
  conflict,
  readComment,
  readDate,
  readDeadline,
  readEnum,
  readText,
  readUuid,
  readVersion,
  staleVersion,
  throwIfErrors,
  type FieldErrors,
} from './task-common.js';

@Injectable()
export class TaskBlockersService {
  constructor(
    private readonly store: TaskStore,
    private readonly tasks: TasksService,
    private readonly workflow: TaskWorkflowService,
  ) {}

  private get db() {
    return this.store.db;
  }

  private async loadBlocker(id: string, user: AuthUser) {
    if (!UUID_RE.test(id)) throw new NotFoundException('Blocker not found');
    const b = await this.db.selectFrom('task_blockers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!b) throw new NotFoundException('Blocker not found');
    await this.store.getVisible(b.task_id, user);
    return b;
  }

  // ========================================================================== raise
  async raise(taskId: string, dto: Record<string, unknown>, user: AuthUser) {
    await this.store.getVisible(taskId, user);
    const s = await this.store.masters.settings();
    const result = await this.db.transaction().execute(async (trx) => {
      const task = await this.store.lock(trx, taskId);
      const kinds = await this.store.access.actorKinds(task, user);
      const r = resolveTaskAction(task.status, 'raise_blocker', kinds);
      if (!r.ok) {
        if (r.reason === 'invalid_status') throw conflict(task.status === 'blocked' ? 'This task already has an open blocker.' : 'Blockers can only be raised on tasks that are not started or in progress.');
        throw new ForbiddenException('Only the assignee can raise a blocker on this task.');
      }
      if (task.version !== readVersion(dto.version)) throw staleVersion();
      if (await this.store.openBlocker(trx, taskId)) throw conflict('This task already has an open blocker.');

      const errors: FieldErrors = {};
      const type = readEnum(errors, 'blocker_type', dto.blocker_type, TASK_BLOCKER_TYPES, { label: 'Blocker type', required: true }) as TaskBlockerType | null;
      const description = readText(errors, 'description', dto.description, 2000, { required: true, minLength: TASK_MIN_BLOCKER_DESCRIPTION, label: 'Description' });
      const expected = readDate(errors, 'expected_resolution_date', dto.expected_resolution_date, { label: 'Expected resolution date' });
      if (expected && expected < todayInKolkata()) errors.expected_resolution_date = 'Expected resolution cannot be in the past.';
      const requested = readDeadline(errors, 'requested_new_deadline', dto.requested_new_deadline, { label: 'Requested new deadline' });
      if (requested && requested.getTime() <= Date.now()) errors.requested_new_deadline = 'Requested deadline must be in the future.';
      const values: Record<string, unknown> = {};
      let leaveValid = false;
      switch (type) {
        case 'another_employee': {
          const dep = readUuid(errors, 'dependency_user_id', dto.dependency_user_id, { required: true, label: 'Employee you are waiting on' });
          if (dep && dep === task.assigned_to) errors.dependency_user_id = 'You cannot be blocked by yourself.';
          else if (dep) {
            const u = await trx.selectFrom('users').select(['is_active', 'full_name']).where('id', '=', dep).executeTakeFirst();
            if (!u) errors.dependency_user_id = 'Employee not found.';
            else if (!u.is_active) errors.dependency_user_id = `${u.full_name} is inactive — raise it with your manager instead.`;
          }
          values.dependency_user_id = dep;
          break;
        }
        case 'customer_dependency': {
          const c = readUuid(errors, 'dependency_customer_id', dto.dependency_customer_id ?? task.customer_id, { required: true, label: 'Customer' });
          if (c && !(await trx.selectFrom('organisations').select('id').where('id', '=', c).executeTakeFirst())) errors.dependency_customer_id = 'Customer not found.';
          values.dependency_customer_id = c;
          break;
        }
        case 'vendor_dependency':
          values.vendor_name = readText(errors, 'vendor_name', dto.vendor_name, 200, { required: true, label: 'Vendor / reference' });
          break;
        case 'external_portal_issue':
          values.portal_name = readText(errors, 'portal_name', dto.portal_name, 200, { required: true, label: 'Portal' });
          break;
        case 'management_approval':
          values.approval_pending_from = readText(errors, 'approval_pending_from', dto.approval_pending_from, 200, { required: true, label: 'Approval pending from' });
          break;
        case 'approved_leave': {
          const leaveId = readUuid(errors, 'leave_id', dto.leave_id, { label: 'Leave' });
          const windowFrom = task.start_date || istDateOf(new Date());
          const windowTo = task.deadline ? istDateOf(task.deadline) : windowFrom;
          let q = trx
            .selectFrom('employee_leaves')
            .select(['id', 'from_date', 'to_date'])
            .where('employee_id', '=', task.assigned_to!)
            .where('status', '=', 'approved')
            .where('to_date', '>=', windowFrom < todayInKolkata() ? todayInKolkata() : windowFrom)
            .where('from_date', '<=', windowTo > todayInKolkata() ? windowTo : todayInKolkata())
            .orderBy('from_date');
          if (leaveId) q = q.where('id', '=', leaveId);
          const leave = await q.executeTakeFirst();
          if (!leave) errors.leave_id = 'No approved leave overlaps this task. Ask your manager to record the leave first, or choose another blocker type.';
          else {
            values.leave_id = leave.id;
            leaveValid = true;
          }
          break;
        }
      }
      throwIfErrors(errors);

      const now = new Date();
      const afterDeadline = task.deadline ? new Date(task.deadline) < now : false;
      const autoAccept = type === 'approved_leave' && leaveValid && s.auto_accept_leave_blockers;
      const blocker = await trx
        .insertInto('task_blockers')
        .values({
          task_id: taskId,
          blocker_type: type!,
          description: description!,
          raised_by: user.id,
          ...(values as any),
          expected_resolution_date: expected,
          requested_new_deadline: requested,
          raised_after_deadline: afterDeadline,
          previous_task_status: task.status,
          deadline_at_raise: task.deadline,
          status: autoAccept ? 'accepted' : 'pending_review',
          ...(autoAccept ? { decision: 'auto_accept_leave', decided_at: now, decision_comment: 'Auto-accepted: matches approved leave in the leave register' } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const res = await trx
        .updateTable('tasks')
        .set({ status: 'blocked', last_update_at: now, version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', taskId)
        .where('version', '=', task.version)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) throw staleVersion();
      await this.store.log(trx, taskId, {
        kind: 'blocker_raised',
        author: user,
        comment: description,
        from: task.status,
        to: 'blocked',
        metadata: { blocker_id: blocker.id, blocker_type: type, raised_after_deadline: afterDeadline, ...values },
      });
      if (autoAccept) await this.store.log(trx, taskId, { kind: 'blocker_auto_accepted', author: null, comment: 'Approved leave — deadline will move out by the blocked time when resolved.', metadata: { blocker_id: blocker.id } });
      const reviewers = task.assigned_to ? (await this.store.access.resolveApprovers(task.assigned_to)).ids : [];
      return { task, blocker, reviewers, autoAccept };
    });

    this.store.emit(TASK_EVENTS.BLOCKER_RAISED, {
      taskId,
      taskNumber: result.task.task_number,
      title: result.task.title,
      assigneeId: result.task.assigned_to,
      blockerId: result.blocker.id,
      blockerType: result.blocker.blocker_type,
      reviewerIds: result.reviewers,
      dependencyUserId: result.blocker.dependency_user_id,
      raisedAfterDeadline: result.blocker.raised_after_deadline,
      autoAccepted: result.autoAccept,
      actorId: user.id,
      actorName: user.full_name,
    });
    this.store.audit(user, 'task_blocker', result.blocker.id, 'task_blocker_raise', undefined, result.blocker);
    return this.tasks.detail(taskId, user);
  }

  // ========================================================================== decisions
  private async decide(blockerId: string, action: 'withdraw' | 'accept' | 'reject' | 'resolve', dto: Record<string, unknown>, user: AuthUser) {
    const b0 = await this.loadBlocker(blockerId, user);
    const outcome = await this.db.transaction().execute(async (trx) => {
      const task = await this.store.lock(trx, b0.task_id);
      const b = await trx.selectFrom('task_blockers').selectAll().where('id', '=', blockerId).forUpdate().executeTakeFirstOrThrow();
      if (task.version !== readVersion(dto.version)) throw staleVersion();
      const kinds = await this.store.access.actorKinds(task, user);
      const isAssignee = kinds.has('assignee');
      const isManager = kinds.has('manager') && !isAssignee;
      const now = new Date();
      const restore = (b.previous_task_status as any) || 'in_progress';
      let taskPatch: Record<string, unknown> = {};
      let blockerPatch: Record<string, unknown> = {};
      let kind = '';
      let comment: string | null = null;
      let event: string = TASK_EVENTS.BLOCKER_DECIDED;

      switch (action) {
        case 'withdraw': {
          if (b.status !== 'pending_review') throw conflict('Only a blocker awaiting review can be withdrawn.');
          if (b.raised_by !== user.id) throw new ForbiddenException('Only the person who raised this blocker can withdraw it.');
          comment = readComment(dto.comment, { required: false });
          blockerPatch = { status: 'withdrawn', resolved_at: now, resolved_by: user.id, resolution_note: comment };
          taskPatch = { status: restore, last_update_at: now };
          kind = 'blocker_withdrawn';
          event = TASK_EVENTS.BLOCKER_WITHDRAWN;
          break;
        }
        case 'accept': {
          if (b.status !== 'pending_review') throw conflict('This blocker has already been decided.');
          if (isAssignee) throw new ForbiddenException('You cannot review your own blocker — your manager does this.');
          if (!isManager) throw forbiddenFor('forbidden', 'accept blocker', task.status);
          comment = readComment(dto.comment, { required: true, min: TASK_MIN_COMMENT_LENGTH });
          const errors: FieldErrors = {};
          const mode = readEnum(errors, 'mode', dto.mode, ['extend', 'pause'] as const, { label: 'Decision', required: true });
          throwIfErrors(errors);
          if (mode === 'extend') {
            const nd = readDeadline(errors, 'new_deadline', dto.new_deadline, { required: true, label: 'New deadline' });
            throwIfErrors(errors);
            this.workflow.assertLaterDeadline(task, nd!, now);
            const ext = await this.workflow.recordExtension(trx, task, nd!, `Blocker accepted: ${comment}`, 'blocker_accepted', { id: b.id, created_at: b.created_at }, now, user);
            taskPatch = ext.patch;
            blockerPatch = { status: 'accepted', decision: 'accept_extend', decided_by: user.id, decided_at: now, decision_comment: comment, excused_minutes: ext.plan.excused_minutes };
          } else {
            blockerPatch = { status: 'accepted', decision: 'accept_pause', decided_by: user.id, decided_at: now, decision_comment: comment };
          }
          kind = 'blocker_accepted';
          break;
        }
        case 'reject': {
          if (b.status !== 'pending_review') throw conflict('This blocker has already been decided.');
          if (isAssignee) throw new ForbiddenException('You cannot review your own blocker — your manager does this.');
          if (!isManager) throw forbiddenFor('forbidden', 'reject blocker', task.status);
          comment = readComment(dto.comment, { required: true, min: TASK_MIN_COMMENT_LENGTH });
          blockerPatch = { status: 'rejected', decision: 'reject', decided_by: user.id, decided_at: now, decision_comment: comment };
          // The overdue clock was never paused — any delay counts as unapproved.
          taskPatch = { status: restore };
          kind = 'blocker_rejected';
          break;
        }
        case 'resolve': {
          if (b.status !== 'pending_review' && b.status !== 'accepted') throw conflict('This blocker is already closed.');
          if (!isAssignee && !isManager) throw new ForbiddenException('Only the assignee or their manager can resolve this blocker.');
          // Closing it undecided would skip the review: the manager accepts or rejects; only the employee may drop it.
          if (b.status === 'pending_review' && !isAssignee) throw new ForbiddenException('This blocker is waiting for your review — accept or reject it.');
          comment = readComment(dto.note ?? dto.comment, { required: true, min: TASK_MIN_COMMENT_LENGTH, field: 'note', label: 'Resolution note' });
          blockerPatch = { status: b.status === 'accepted' ? 'resolved' : 'withdrawn', resolved_at: now, resolved_by: user.id, resolution_note: comment };
          taskPatch = { status: restore, last_update_at: now };
          const p =
            b.status === 'accepted' && (b.decision === 'accept_pause' || b.decision === 'auto_accept_leave') && task.deadline
              ? planPauseResume({ deadline: new Date(task.deadline), raised_at: new Date(b.created_at), resolved_at: now, within: await this.store.leaveWindowFor(trx, b) })
              : null;
          if (p && p.shift_minutes > 0) {
            await trx
              .insertInto('task_deadline_changes')
              .values({ task_id: task.id, old_deadline: task.deadline, new_deadline: p.new_deadline, reason: `Blocked time added back: ${comment}`, source: 'pause_resume', blocker_id: b.id, excused_minutes: p.shift_minutes, changed_by: user.id })
              .execute();
            taskPatch.deadline = p.new_deadline;
            taskPatch.excused_delay_minutes = task.excused_delay_minutes + p.shift_minutes;
            blockerPatch.excused_minutes = b.excused_minutes + p.shift_minutes;
          }
          kind = 'blocker_resolved';
          event = TASK_EVENTS.BLOCKER_RESOLVED;
          break;
        }
      }

      await trx.updateTable('task_blockers').set(blockerPatch as any).where('id', '=', blockerId).execute();
      const res = await trx
        .updateTable('tasks')
        .set({ ...(taskPatch as any), version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', task.id)
        .where('version', '=', task.version)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) throw staleVersion();
      const to = (taskPatch.status as string) || task.status;
      await this.store.log(trx, task.id, {
        kind,
        author: user,
        comment,
        from: task.status,
        to,
        metadata: { blocker_id: b.id, blocker_type: b.blocker_type, mode: dto.mode ?? null, new_deadline: (taskPatch.deadline as Date | undefined)?.toISOString?.() ?? null },
      });
      const reviewers = task.assigned_to ? (await this.store.access.resolveApprovers(task.assigned_to)).ids : [];
      return { task, blocker: b, kind, comment, to, reviewers, event };
    });

    this.store.emit(outcome.event, {
      taskId: outcome.task.id,
      taskNumber: outcome.task.task_number,
      title: outcome.task.title,
      assigneeId: outcome.task.assigned_to,
      blockerId: blockerId,
      blockerType: outcome.blocker.blocker_type,
      decision: action,
      mode: dto.mode ?? null,
      comment: outcome.comment,
      reviewerIds: outcome.reviewers,
      dependencyUserId: outcome.blocker.dependency_user_id,
      actorId: user.id,
      actorName: user.full_name,
    });
    this.store.audit(user, 'task_blocker', blockerId, `task_blocker_${action}`, { status: outcome.blocker.status }, { comment: outcome.comment, task_status: outcome.to });
    return this.tasks.detail(outcome.task.id, user);
  }

  withdraw(id: string, dto: Record<string, unknown>, user: AuthUser) {
    return this.decide(id, 'withdraw', dto, user);
  }
  accept(id: string, dto: Record<string, unknown>, user: AuthUser) {
    return this.decide(id, 'accept', dto, user);
  }
  reject(id: string, dto: Record<string, unknown>, user: AuthUser) {
    return this.decide(id, 'reject', dto, user);
  }
  resolve(id: string, dto: Record<string, unknown>, user: AuthUser) {
    return this.decide(id, 'resolve', dto, user);
  }

  // ========================================================================== leave cancelled
  /**
   * A cancelled leave ends its blockers now: an accepted one is resolved, crediting only leave already taken (none if
   * the leave had not started); one still awaiting review is withdrawn. The task returns to its previous status.
   */
  async closeForCancelledLeave(leaveId: string, user: AuthUser) {
    const open = await this.db.selectFrom('task_blockers').select('task_id').where('leave_id', '=', leaveId).where('status', 'in', ['pending_review', 'accepted']).execute();
    for (const { task_id } of open) {
      await this.db.transaction().execute(async (trx) => {
        const task = await this.store.lock(trx, task_id);
        const now = new Date();
        const closed = await this.workflow.closeOpenBlocker(trx, task, user, 'Leave cancelled', now, true);
        if (!closed) return;
        const patch: Record<string, unknown> = { ...(closed.patch || {}), ...(closed.restoreStatus ? { status: closed.restoreStatus } : {}), last_update_at: now };
        await trx
          .updateTable('tasks')
          .set({ ...(patch as any), version: sql`version + 1`, updated_by: user.id })
          .where('id', '=', task.id)
          .execute();
        await this.store.log(trx, task.id, {
          kind: closed.blocker.status === 'accepted' ? 'blocker_resolved' : 'blocker_withdrawn',
          author: user,
          comment: 'Leave cancelled — blocker closed; only leave already taken is credited.',
          from: task.status,
          to: (patch.status as string) || task.status,
          metadata: { blocker_id: closed.blocker.id, leave_id: leaveId },
        });
      });
    }
  }

  // ========================================================================== queues
  private blockerColumns() {
    return [
      'b.id',
      'b.task_id',
      'b.blocker_type',
      'b.description',
      'b.status',
      'b.created_at',
      'b.raised_by',
      'b.raised_after_deadline',
      'b.dependency_user_id',
      'b.vendor_name',
      'b.portal_name',
      'b.approval_pending_from',
      'b.expected_resolution_date',
      'b.requested_new_deadline',
      'b.decision',
      'b.decided_at',
      'b.decision_comment',
      't.task_number',
      't.title as task_title',
      't.deadline',
      't.original_deadline',
      't.priority',
      't.version as task_version',
      't.assigned_to',
      't.extension_count',
      't.customer_id',
      't.tender_id',
      't.demo_id',
      't.service_ticket_id',
      'emp.full_name as assignee_name',
      'dep.full_name as dependency_user_name',
      'org.name as dependency_customer_name',
      sql<number>`(select count(*)::int from task_blockers x where x.task_id = b.task_id and x.blocker_type = b.blocker_type)`.as('same_type_count'),
      sql<number>`(select count(*)::int from task_blockers x where x.task_id = b.task_id)`.as('blocker_count'),
    ] as const;
  }

  async pendingQueue(query: Record<string, unknown>, user: AuthUser) {
    const s = await this.store.masters.settings();
    let q = this.db
      .selectFrom('task_blockers as b')
      .innerJoin('tasks as t', 't.id', 'b.task_id')
      .leftJoin('users as emp', 'emp.id', 't.assigned_to')
      .leftJoin('users as dep', 'dep.id', 'b.dependency_user_id')
      .leftJoin('organisations as org', 'org.id', 'b.dependency_customer_id')
      .select(this.blockerColumns() as any)
      .where('b.status', '=', 'pending_review')
      .where(this.store.access.scope(user, s));
    if (!(query.scope === 'all' && isAdminLike(user))) q = q.where(this.store.routedToSql(user, s));
    const rows: any[] = await q.orderBy('b.created_at').limit(300).execute();
    const now = Date.now();
    return rows.map((r) => {
      const ageHours = Math.floor((now - new Date(r.created_at).getTime()) / 3600000);
      return {
        ...r,
        age_hours: ageHours,
        sla_hours: s.blocker_review_sla_hours,
        sla_breached: ageHours >= s.blocker_review_sla_hours,
        repeated_flag: Number(r.same_type_count) >= s.repeated_blocker_threshold,
        is_task_overdue: r.deadline ? new Date(r.deadline).getTime() < now : false,
      };
    });
  }

  async waitingOnMe(user: AuthUser) {
    const rows: any[] = await this.db
      .selectFrom('task_blockers as b')
      .innerJoin('tasks as t', 't.id', 'b.task_id')
      .leftJoin('users as emp', 'emp.id', 't.assigned_to')
      .leftJoin('users as dep', 'dep.id', 'b.dependency_user_id')
      .leftJoin('organisations as org', 'org.id', 'b.dependency_customer_id')
      .select(this.blockerColumns() as any)
      .where('b.dependency_user_id', '=', user.id)
      .where('b.status', 'in', ['pending_review', 'accepted'])
      .orderBy('b.created_at')
      .execute();
    const now = Date.now();
    return rows.map((r) => ({ ...r, waiting_hours: Math.floor((now - new Date(r.created_at).getTime()) / 3600000) }));
  }
}
