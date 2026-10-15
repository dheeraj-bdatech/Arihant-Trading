/**
 * Module 8 notifications (in-app + realtime). Workflow events arrive via EventEmitter2; scheduled jobs call
 * `notify` directly with a dedupe key so a reminder is only ever sent once (task_notification_log).
 * Inactive users are never notified. Every notification also nudges the recipients' sidebar badges.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { TASK_BLOCKER_TYPE_LABELS, formatTaskDateTime, type Database, type TaskBlockerType } from '@arihant/shared';
import { EventsGateway } from '../../common/realtime/events.gateway.js';
import { TASK_DB } from './task-db.js';
import { TASK_EVENTS } from './task-store.service.js';
import { REVIEW_EVENTS } from './performance-reviews.service.js';

type Ev = Record<string, any>;

@Injectable()
export class TaskNotificationsListener {
  private readonly logger = new Logger(TaskNotificationsListener.name);

  constructor(
    @Inject(TASK_DB) private readonly db: Kysely<Database>,
    private readonly gateway: EventsGateway,
  ) {}

  /** Claims a dedupe key; false when this notification was already sent. */
  async claim(key: string, taskId: string | null = null, userId: string | null = null): Promise<boolean> {
    const r = await this.db
      .insertInto('task_notification_log')
      .values({ dedupe_key: key, task_id: taskId, user_id: userId })
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning('dedupe_key')
      .executeTakeFirst();
    return Boolean(r);
  }

  async notify(userIds: (string | null | undefined)[], type: string, title: string, body: string, entity: { type: string; id: string | null } = { type: 'task', id: null }, exclude: (string | null | undefined)[] = []) {
    const ids = Array.from(new Set(userIds.filter((u): u is string => Boolean(u) && !exclude.includes(u))));
    if (!ids.length) return 0;
    const active = await this.db.selectFrom('users').select('id').where('id', 'in', ids).where('is_active', '=', true).execute();
    for (const { id } of active) {
      try {
        const row = await this.db
          .insertInto('notifications')
          .values({ user_id: id, type, title: title.slice(0, 200), body: body.slice(0, 1000), entity_type: entity.type, entity_id: entity.id, is_read: false })
          .returningAll()
          .executeTakeFirst();
        if (row) this.gateway.sendToUser(id, 'notification:new', row);
        this.gateway.sendToUser(id, 'task:badge_refresh', { taskId: entity.id });
      } catch (err: any) {
        this.logger.error(`Could not notify ${id}: ${err.message}`);
      }
    }
    return active.length;
  }

  private ref(e: Ev) {
    return `${e.taskNumber ? `${e.taskNumber} · ` : ''}${e.title || 'Task'}`;
  }

  @OnEvent(TASK_EVENTS.ASSIGNED)
  async onAssigned(e: Ev) {
    await this.notify([e.assigneeId], 'task_assigned', `New task: ${this.ref(e)}`, `${e.actorName || 'Your manager'} assigned you a task${e.deadline ? `, due ${formatTaskDateTime(e.deadline)}` : ''}.`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.REASSIGNED)
  async onReassigned(e: Ev) {
    await this.notify([e.assigneeId], 'task_assigned', `Task reassigned to you: ${this.ref(e)}`, `${e.actorName} reassigned this task to you. Reason: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
    await this.notify([e.previousAssigneeId], 'task_status', `Task reassigned: ${this.ref(e)}`, `${e.actorName} moved this task to someone else. Reason: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.COMPLETED)
  async onCompleted(e: Ev) {
    if (e.awaitingApproval) {
      await this.notify(e.approverIds || [], 'task_approval', `Approval needed: ${this.ref(e)}`, `${e.actorName} completed this task${e.late ? ' (after the deadline)' : ''} and it awaits your approval.`, { type: 'task', id: e.taskId }, [e.actorId]);
    }
  }

  @OnEvent(TASK_EVENTS.APPROVED)
  async onApproved(e: Ev) {
    await this.notify([e.assigneeId], 'task_status', `Approved: ${this.ref(e)}`, `${e.actorName} approved your completed task.${e.comment ? ` ${e.comment}` : ''}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.SENT_BACK)
  async onSentBack(e: Ev) {
    await this.notify([e.assigneeId], 'task_status', `Sent back for rework: ${this.ref(e)}`, `${e.actorName}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.REOPENED)
  async onReopened(e: Ev) {
    await this.notify([e.assigneeId], 'task_status', `Reopened: ${this.ref(e)}`, `${e.actorName}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.CANCELLED)
  async onCancelled(e: Ev) {
    await this.notify([e.assigneeId], 'task_status', `Cancelled: ${this.ref(e)}`, `${e.actorName}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.DEADLINE_EXTENDED)
  async onExtended(e: Ev) {
    await this.notify([e.assigneeId], 'task_status', `Deadline extended: ${this.ref(e)}`, `New deadline ${formatTaskDateTime(e.newDeadline)}. ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.ESCALATED)
  async onEscalated(e: Ev) {
    await this.notify([e.escalatedToId], 'task_escalation', `Escalated to you: ${this.ref(e)}`, `${e.actorName || 'System (SLA)'}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.COMMENTED)
  async onCommented(e: Ev) {
    await this.notify([e.assigneeId], 'task_comment', `Comment on ${this.ref(e)}`, `${e.actorName}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.BLOCKER_RAISED)
  async onBlockerRaised(e: Ev) {
    const label = TASK_BLOCKER_TYPE_LABELS[e.blockerType as TaskBlockerType] || e.blockerType;
    if (e.autoAccepted) {
      await this.notify(e.reviewerIds || [], 'task_blocked', `On approved leave: ${this.ref(e)}`, `${e.actorName} is on approved leave; the blocker was accepted automatically.`, { type: 'task', id: e.taskId }, [e.actorId]);
    } else {
      await this.notify(
        e.reviewerIds || [],
        'task_blocked',
        `Blocker to review: ${this.ref(e)}`,
        `${e.actorName} raised "${label}"${e.raisedAfterDeadline ? ' after the deadline had passed' : ''}. Accept, reject, extend, reassign or escalate.`,
        { type: 'task', id: e.taskId },
        [e.actorId],
      );
    }
    if (e.dependencyUserId) {
      await this.notify([e.dependencyUserId], 'task_waiting_on_you', `${e.actorName} is waiting on you`, `Task ${this.ref(e)} is blocked waiting for you. See "Waiting on me".`, { type: 'task', id: e.taskId }, [e.actorId]);
    }
  }

  @OnEvent(TASK_EVENTS.BLOCKER_DECIDED)
  async onBlockerDecided(e: Ev) {
    const verb = e.decision === 'accept' ? (e.mode === 'pause' ? 'accepted (deadline paused)' : 'accepted (deadline extended)') : 'rejected';
    await this.notify([e.assigneeId], 'task_status', `Blocker ${verb}: ${this.ref(e)}`, `${e.actorName}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
  }

  @OnEvent(TASK_EVENTS.BLOCKER_RESOLVED)
  async onBlockerResolved(e: Ev) {
    await this.notify([e.assigneeId, ...(e.reviewerIds || [])], 'task_status', `Blocker resolved: ${this.ref(e)}`, `${e.actorName}: ${e.comment}`, { type: 'task', id: e.taskId }, [e.actorId]);
    if (e.dependencyUserId) this.gateway.sendToUser(e.dependencyUserId, 'task:badge_refresh', { taskId: e.taskId });
  }

  @OnEvent(TASK_EVENTS.BLOCKER_WITHDRAWN)
  async onBlockerWithdrawn(e: Ev) {
    for (const id of [...(e.reviewerIds || []), e.dependencyUserId].filter(Boolean)) this.gateway.sendToUser(id, 'task:badge_refresh', { taskId: e.taskId });
  }

  @OnEvent(REVIEW_EVENTS.SUBMITTED)
  async onReviewSubmitted(e: Ev) {
    await this.notify([e.employeeId], 'performance_review', 'Your manager submitted a performance review', `${e.reviewerName} submitted your review for ${e.periodFrom} → ${e.periodTo}. You can read it, add your response and acknowledge it.`, { type: 'performance_review', id: e.reviewId });
  }

  @OnEvent(REVIEW_EVENTS.RESPONDED)
  async onReviewResponded(e: Ev) {
    await this.notify([e.reviewerId], 'performance_review', e.acknowledged ? `${e.employeeName} acknowledged their review` : `${e.employeeName} responded to their review`, 'Open the review to read it.', { type: 'performance_review', id: e.reviewId });
  }
}
