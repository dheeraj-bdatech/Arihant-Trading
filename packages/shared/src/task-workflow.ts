/**
 * Module 8 — Task & Productivity Management: single source of truth for the task state machine,
 * derived overdue / delay classification, the recurrence engine, IST date handling and labels.
 * The API enforces these rules; the web app reads them to decide what to offer, so the two cannot drift.
 *
 * Hard rule: nothing in this module computes a salary, incentive, penalty or deduction. It produces evidence only.
 */
import type { TaskBlockerType, TaskStatus, UserRole } from './enums.js';


// ============================================================================ vocabulary
export type TaskDisplayStatus = TaskStatus | 'overdue';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskRecurrenceType = 'one_time' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type TaskLinkType = 'customer' | 'tender' | 'demo' | 'service';
export type TaskBlockerStatus = 'pending_review' | 'accepted' | 'rejected' | 'resolved' | 'withdrawn';
export type TaskDelayClass = 'on_time' | 'late_excused' | 'late_unexcused' | 'open_overdue' | 'open';
export type TaskHolidayPolicy = 'skip' | 'shift_before' | 'shift_after' | 'keep';
export type TaskLeavePolicy = 'skip' | 'keep';
export type TaskTemplateStatus = 'active' | 'paused' | 'ended';
export type TaskAttachmentPurpose = 'supporting_doc' | 'evidence' | 'blocker_evidence' | 'update';
export type TaskDeadlineChangeSource =
  | 'blocker_accepted'
  | 'manager_extension'
  | 'reassignment'
  | 'pause_resume'
  | 'linked_reschedule'
  | 'correction';
export type TaskReassignReason = 'workload' | 'leave' | 'skills' | 'non_performance' | 'deactivation' | 'other';
export type TaskEscalationStatus = 'open' | 'acknowledged' | 'closed';
export type PerformanceReviewStatus = 'draft' | 'submitted' | 'acknowledged';
export type TaskEvidenceBasis = 'deadline' | 'completion';

export const TASK_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'awaiting_approval', 'completed', 'cancelled'];
export const TASK_DISPLAY_STATUSES: TaskDisplayStatus[] = ['not_started', 'in_progress', 'blocked', 'overdue', 'awaiting_approval', 'completed', 'cancelled'];
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
export const TASK_RECURRENCE_TYPES: TaskRecurrenceType[] = ['one_time', 'daily', 'weekly', 'monthly', 'custom'];
export const TASK_BLOCKER_TYPES: TaskBlockerType[] = [
  'management_approval',
  'customer_dependency',
  'vendor_dependency',
  'another_employee',
  'missing_information',
  'external_portal_issue',
  'technical_issue',
  'approved_leave',
];
export const TASK_BLOCKER_STATUSES: TaskBlockerStatus[] = ['pending_review', 'accepted', 'rejected', 'resolved', 'withdrawn'];
export const TASK_DELAY_CLASSES: TaskDelayClass[] = ['on_time', 'late_excused', 'late_unexcused', 'open_overdue', 'open'];
export const TASK_HOLIDAY_POLICIES: TaskHolidayPolicy[] = ['skip', 'shift_before', 'shift_after', 'keep'];
export const TASK_REASSIGN_REASONS: TaskReassignReason[] = ['workload', 'leave', 'skills', 'non_performance', 'deactivation', 'other'];

/** Statuses that still need work. Cancelled / completed are terminal. */
export const TASK_OPEN_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'awaiting_approval'];
/** Statuses that can be overdue (awaiting approval means the assignee's part is done). */
export const TASK_OVERDUE_CAPABLE_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked'];
export const TASK_OPEN_BLOCKER_STATUSES: TaskBlockerStatus[] = ['pending_review', 'accepted'];

// ============================================================================ limits
export const TASK_TEXT_LIMITS = {
  title: 200,
  description: 5000,
  expected_outcome: 1000,
  comment: 2000,
  remarks: 2000,
  short: 200,
} as const;
export const TASK_MIN_COMMENT_LENGTH = 5;
export const TASK_MIN_BLOCKER_DESCRIPTION = 15;
export const TASK_MIN_EVIDENCE_REMARKS = 20;
export const TASK_MAX_BULK_ASSIGNEES = 50;

/** Shown on every evidence screen and export. Do not shorten. */
export const TASK_EVIDENCE_DISCLAIMER =
  'This report is supporting evidence only. Decisions on salary, incentive or deductions are made by authorised management/accounts as per company policy and applicable law.';

// ============================================================================ state machine
/** Who may perform an action relative to the task. `manager` = anyone with manager authority over the assignee. */
export type TaskActorKind = 'assignee' | 'manager' | 'assigner' | 'admin';

export type TaskAction =
  | 'start'
  | 'progress'
  | 'complete'
  | 'approve'
  | 'send_back'
  | 'reopen'
  | 'cancel'
  | 'extend_deadline'
  | 'reassign'
  | 'escalate'
  | 'raise_blocker'
  | 'edit'
  | 'correction';

export interface TaskTransitionRule {
  action: TaskAction;
  from: TaskStatus[];
  /** Target status. `same` = no status change, `by_approval` = completed or awaiting_approval depending on the task. */
  to: TaskStatus | 'same' | 'by_approval';
  actors: TaskActorKind[];
  commentRequired: boolean;
  /** The assignee must never perform this action on their own task (self-approval rule). */
  notByAssignee?: boolean;
}

/**
 * Explicit allowed-transitions map. Anything not listed is rejected with 409.
 * Blocker outcomes (reject / resolve / withdraw → previous status) are handled by the blocker service
 * using `task_blockers.previous_task_status`; raising one is listed here.
 */
export const TASK_TRANSITIONS: TaskTransitionRule[] = [
  { action: 'start', from: ['not_started'], to: 'in_progress', actors: ['assignee'], commentRequired: false },
  { action: 'progress', from: ['not_started', 'in_progress', 'blocked'], to: 'same', actors: ['assignee', 'manager', 'assigner'], commentRequired: false },
  { action: 'complete', from: ['not_started', 'in_progress'], to: 'by_approval', actors: ['assignee'], commentRequired: false },
  { action: 'approve', from: ['awaiting_approval'], to: 'completed', actors: ['manager'], commentRequired: false, notByAssignee: true },
  { action: 'send_back', from: ['awaiting_approval'], to: 'in_progress', actors: ['manager'], commentRequired: true, notByAssignee: true },
  { action: 'reopen', from: ['completed'], to: 'in_progress', actors: ['manager'], commentRequired: true, notByAssignee: true },
  { action: 'cancel', from: ['not_started', 'in_progress', 'blocked', 'awaiting_approval'], to: 'cancelled', actors: ['manager', 'assigner'], commentRequired: true, notByAssignee: true },
  { action: 'extend_deadline', from: ['not_started', 'in_progress', 'blocked'], to: 'same', actors: ['manager'], commentRequired: true, notByAssignee: true },
  { action: 'reassign', from: ['not_started', 'in_progress', 'blocked'], to: 'same', actors: ['manager'], commentRequired: true, notByAssignee: true },
  { action: 'escalate', from: ['not_started', 'in_progress', 'blocked', 'awaiting_approval'], to: 'same', actors: ['manager'], commentRequired: true, notByAssignee: true },
  { action: 'raise_blocker', from: ['not_started', 'in_progress'], to: 'blocked', actors: ['assignee'], commentRequired: false },
  { action: 'edit', from: ['not_started', 'in_progress', 'blocked'], to: 'same', actors: ['manager', 'assigner'], commentRequired: false, notByAssignee: true },
  { action: 'correction', from: TASK_STATUSES, to: 'same', actors: ['admin'], commentRequired: true },
];

export function findTaskTransition(action: TaskAction): TaskTransitionRule | undefined {
  return TASK_TRANSITIONS.find((t) => t.action === action);
}

/**
 * Pure permission + status resolution. Returns the rule or a reason code; the API turns
 * `forbidden` into 403 and `invalid_status` into 409.
 */
export function resolveTaskAction(
  status: TaskStatus,
  action: TaskAction,
  kinds: Set<TaskActorKind>,
): { ok: true; rule: TaskTransitionRule; reason?: undefined } | { ok: false; reason: 'unknown' | 'forbidden' | 'self' | 'invalid_status'; rule?: undefined } {
  const rule = findTaskTransition(action);
  if (!rule) return { ok: false, reason: 'unknown' };
  // Nobody approves, cancels, extends or reassigns their own work — even admins and self-created tasks.
  if (rule.notByAssignee && kinds.has('assignee')) return { ok: false, reason: 'self' };
  if (!rule.actors.some((a) => kinds.has(a))) return { ok: false, reason: 'forbidden' };
  if (!rule.from.includes(status)) return { ok: false, reason: 'invalid_status' };
  return { ok: true, rule };
}

/** Actions currently available to this user (used by the detail endpoint to drive buttons). */
export function allowedTaskActions(status: TaskStatus, kinds: Set<TaskActorKind>): TaskAction[] {
  return TASK_TRANSITIONS.filter((t) => resolveTaskAction(status, t.action, kinds).ok).map((t) => t.action);
}

// ============================================================================ task views by role
/** Boards and pages of the Tasks module. Every role has the module; these decide what each person sees in it. */
export type TaskViewKey =
  | 'mine'
  | 'team'
  | 'blockers'
  | 'approvals'
  | 'waiting'
  | 'recurring'
  | 'accountability'
  | 'evidence'
  | 'my_performance'
  | 'calendar'
  | 'settings';

/** The per-user facts the API reports in GET /tasks/my/summary. */
export interface TaskViewFlags {
  has_team: boolean;
  can_view_all: boolean;
  can_view_evidence: boolean;
  can_manage_settings: boolean;
  pending_blockers: number;
  pending_approvals: number;
}

/** Management and admin review blockers and approve work for anyone without an active manager (fallback approvers). */
export const TASK_FALLBACK_REVIEWER_ROLES: UserRole[] = ['management', 'admin'];

/** Views every employee gets, whatever the role. */
export const TASK_VIEWS_FOR_EVERYONE: TaskViewKey[] = ['mine', 'waiting', 'recurring', 'my_performance', 'calendar'];

/**
 * Which task views a user gets. Mirrors the API's own checks so nobody is shown a board that would be empty or refused:
 * - Team board, accountability: people with reports, plus management / admin / accounts (they see every task).
 * - Blocker reviews, approvals: people with reports, management / admin (fallback reviewers), and anyone something
 *   is routed to right now (department head, escalation target). Accounts sees all tasks for audit but does not decide.
 * - Performance evidence: managers and authorised viewers (`can_view_evidence`). Settings: admin only.
 */
export function taskViewsFor(role: UserRole, f: TaskViewFlags | null | undefined): Set<TaskViewKey> {
  const views = new Set<TaskViewKey>(TASK_VIEWS_FOR_EVERYONE);
  if (!f) return views;
  const reviewer = f.has_team || TASK_FALLBACK_REVIEWER_ROLES.includes(role);
  if (f.has_team || f.can_view_all) views.add('team').add('accountability');
  if (reviewer || f.pending_blockers > 0) views.add('blockers');
  if (reviewer || f.pending_approvals > 0) views.add('approvals');
  if (f.can_view_evidence) views.add('evidence');
  if (f.can_manage_settings) views.add('settings');
  return views;
}

// ============================================================================ labels
export const TASK_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  awaiting_approval: 'Awaiting Approval',
  completed: 'Completed',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const TASK_RECURRENCE_LABELS: Record<TaskRecurrenceType, string> = {
  one_time: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom recurring',
};
export const TASK_BLOCKER_TYPE_LABELS: Record<TaskBlockerType, string> = {
  management_approval: 'Management approval',
  customer_dependency: 'Customer dependency',
  vendor_dependency: 'Vendor dependency',
  another_employee: 'Another employee',
  missing_information: 'Missing information',
  external_portal_issue: 'External portal issue',
  technical_issue: 'Technical issue',
  approved_leave: 'Approved leave',
};
export const TASK_BLOCKER_STATUS_LABELS: Record<TaskBlockerStatus, string> = {
  pending_review: 'Pending review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};
export const TASK_DELAY_CLASS_LABELS: Record<TaskDelayClass, string> = {
  on_time: 'On time',
  late_excused: 'Late (excused)',
  late_unexcused: 'Late (unexcused)',
  open_overdue: 'Open & overdue',
  open: 'Open',
};
export const TASK_HOLIDAY_POLICY_LABELS: Record<TaskHolidayPolicy, string> = {
  skip: 'Skip that occurrence',
  shift_before: 'Move to previous working day',
  shift_after: 'Move to next working day',
  keep: 'Keep the date',
};
export const TASK_LEAVE_POLICY_LABELS: Record<TaskLeavePolicy, string> = {
  skip: 'Skip while on approved leave',
  keep: 'Generate anyway',
};
export const TASK_REASSIGN_REASON_LABELS: Record<TaskReassignReason, string> = {
  workload: 'Workload balancing',
  leave: 'Assignee on leave',
  skills: 'Needs different skills',
  non_performance: 'Non-performance',
  deactivation: 'Employee left / deactivated',
  other: 'Other',
};
export const TASK_DEADLINE_SOURCE_LABELS: Record<TaskDeadlineChangeSource, string> = {
  blocker_accepted: 'Blocker accepted',
  manager_extension: 'Deadline extended',
  reassignment: 'Reassigned',
  pause_resume: 'Paused time added back',
  linked_reschedule: 'Linked follow-up rescheduled',
  correction: 'Admin correction',
};
export const TASK_ACTION_LABELS: Record<string, string> = {
  created: 'Task created',
  legacy_import: 'Imported from v1 register',
  start: 'Started',
  progress: 'Progress update',
  comment: 'Comment',
  complete: 'Marked complete',
  submit_for_approval: 'Submitted for approval',
  approve: 'Approved',
  send_back: 'Sent back for rework',
  reopen: 'Reopened',
  cancel: 'Cancelled',
  extend_deadline: 'Deadline extended',
  reassign: 'Reassigned',
  escalate: 'Escalated',
  escalation_acknowledged: 'Escalation acknowledged',
  escalation_closed: 'Escalation closed',
  edit: 'Details edited',
  correction: 'Admin correction',
  blocker_raised: 'Blocker raised',
  blocker_withdrawn: 'Blocker withdrawn',
  blocker_accepted: 'Blocker accepted',
  blocker_auto_accepted: 'Blocker auto-accepted (approved leave)',
  blocker_rejected: 'Blocker rejected',
  blocker_resolved: 'Blocker resolved',
  attachment_added: 'File attached',
  attachment_removed: 'File removed',
  linked_reschedule: 'Follow-up date moved',
  approver_rerouted: 'Approval rerouted',
  sla_escalated: 'Escalated automatically (SLA)',
};

/** Which extra field a blocker type needs (the API validates; the form renders these). */
export const TASK_BLOCKER_REQUIREMENTS: Record<TaskBlockerType, { field: string | null; label: string | null; hint: string }> = {
  management_approval: { field: 'approval_pending_from', label: 'Approval pending from', hint: 'Who or what approval is pending (e.g. "MD sign-off on pricing").' },
  customer_dependency: { field: 'dependency_customer_id', label: 'Customer', hint: 'Defaults to the task’s customer.' },
  vendor_dependency: { field: 'vendor_name', label: 'Vendor / reference', hint: 'Vendor name, PO or reference.' },
  another_employee: { field: 'dependency_user_id', label: 'Waiting on', hint: 'They will be notified and see this in "Waiting on me".' },
  missing_information: { field: null, label: null, hint: 'Describe exactly what information is missing.' },
  external_portal_issue: { field: 'portal_name', label: 'Portal', hint: 'e.g. GeM, CPPP, state e-procurement. Attach a screenshot if you can.' },
  technical_issue: { field: null, label: null, hint: 'Describe the technical problem.' },
  approved_leave: { field: 'leave_id', label: 'Approved leave', hint: 'Must match approved leave overlapping the task.' },
};

// ============================================================================ IST dates
export const TASK_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 330;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Calendar date (YYYY-MM-DD) of an instant in IST. */
export function istDateOf(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * 60000);
  return shifted.toISOString().slice(0, 10);
}

/** The instant for a wall-clock time (HH:mm or HH:mm:ss) in IST on a calendar date. */
export function istDateTime(date: string, time = '23:59:59'): Date {
  const t = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return new Date(`${date}T${t}+05:30`);
}

/** A date-only deadline means the very end of that day in IST. */
export function istEndOfDay(date: string): Date {
  return istDateTime(date, '23:59:59');
}

export function addIsoDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** DD-MM-YYYY hh:mm A in IST. */
export function formatTaskDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const s = new Date(d.getTime() + IST_OFFSET_MINUTES * 60000);
  const h = s.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad2(s.getUTCDate())}-${pad2(s.getUTCMonth() + 1)}-${s.getUTCFullYear()} ${pad2(h12)}:${pad2(s.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** DD-MM-YYYY for a YYYY-MM-DD date or an instant (IST). */
export function formatTaskDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}-${m}-${y}`;
  }
  const iso = istDateOf(value);
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** "due in 3h", "due in 2 days", "overdue by 2 days", "overdue by 40 min". */
export function relativeDue(deadline: string | Date | null | undefined, now: Date = new Date()): { label: string; overdue: boolean } {
  if (!deadline) return { label: 'No deadline', overdue: false };
  const diff = new Date(deadline).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const span = mins < 60 ? `${Math.max(1, mins)} min` : hours < 24 ? `${hours}h` : `${days} day${days === 1 ? '' : 's'}`;
  return diff >= 0 ? { label: `due in ${span}`, overdue: false } : { label: `overdue by ${span}`, overdue: true };
}

// ============================================================================ overdue & delay
export interface OverdueInput {
  status: TaskStatus | string;
  deadline: string | Date | null;
  /** An accepted (still open) blocker pauses the overdue clock. */
  has_accepted_blocker?: boolean;
}

/** Derived OVERDUE: deadline passed and the assignee's work is still open (accepted blockers excepted). */
export function isTaskOverdue(t: OverdueInput, now: Date = new Date()): boolean {
  if (!t.deadline) return false;
  if (!TASK_OVERDUE_CAPABLE_STATUSES.includes(t.status as TaskStatus)) return false;
  if (t.status === 'blocked' && t.has_accepted_blocker) return false;
  return new Date(t.deadline).getTime() < now.getTime();
}

/** OVERDUE takes display priority over the stored status. */
export function taskDisplayStatus(t: OverdueInput, now: Date = new Date()): TaskDisplayStatus {
  return isTaskOverdue(t, now) ? 'overdue' : (t.status as TaskStatus);
}

export interface DelayInput extends OverdueInput {
  original_deadline: string | Date | null;
  completed_at: string | Date | null;
  unexcused_locked_minutes?: number | null;
  /** When the open accepted blocker was raised; the delay clock freezes there while it is open. */
  accepted_blocker_raised_at?: string | Date | null;
}

export interface DelayResult {
  delay_class: TaskDelayClass | null;
  total_delay_minutes: number;
  excused_delay_minutes: number;
  unexcused_delay_minutes: number;
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));

/**
 * Delay classification, measured honestly against the original deadline:
 *  - total delay       = finish (or now) − original deadline
 *  - unexcused delay   = time already overdue when an extension/blocker was granted (locked)
 *                        + time past the current (extended) deadline
 *  - excused delay     = the rest (covered by accepted blockers / approved extensions)
 * Completed work is ON_TIME, LATE_EXCUSED (no unexcused part) or LATE_UNEXCUSED.
 * Open work is OPEN_OVERDUE (derived overdue) or OPEN. Cancelled work is not classified.
 */
export function computeTaskDelay(t: DelayInput, now: Date = new Date()): DelayResult {
  const none: DelayResult = { delay_class: null, total_delay_minutes: 0, excused_delay_minutes: 0, unexcused_delay_minutes: 0 };
  if (t.status === 'cancelled') return none;
  const done = !!t.completed_at && (t.status === 'completed' || t.status === 'awaiting_approval');
  const originalRaw = t.original_deadline ?? t.deadline;
  if (!originalRaw) return { ...none, delay_class: done ? 'on_time' : 'open' };
  const original = new Date(originalRaw);
  const effective = new Date(t.deadline ?? originalRaw);
  let ref: Date;
  if (done) ref = new Date(t.completed_at as string | Date);
  else if (t.status === 'blocked' && t.has_accepted_blocker) ref = t.accepted_blocker_raised_at ? new Date(t.accepted_blocker_raised_at) : now;
  else ref = now;

  const total = minutesBetween(original, ref);
  const locked = Math.max(0, Number(t.unexcused_locked_minutes) || 0);
  const unexcused = Math.min(total, locked + minutesBetween(effective, ref));
  const excused = Math.max(0, total - unexcused);
  // Classification compares exact instants (the SQL list filters use the same comparisons).
  let delay_class: TaskDelayClass;
  if (done) {
    if (ref.getTime() <= original.getTime()) delay_class = 'on_time';
    else if (locked === 0 && ref.getTime() <= effective.getTime()) delay_class = 'late_excused';
    else delay_class = 'late_unexcused';
  } else delay_class = isTaskOverdue(t, now) ? 'open_overdue' : 'open';
  return { delay_class, total_delay_minutes: total, excused_delay_minutes: excused, unexcused_delay_minutes: unexcused };
}

export const minutesToDays = (m: number) => Math.round((m / 1440) * 100) / 100;

/**
 * Accepting a blocker in EXTEND mode, or a manager extension. Time the task was already overdue
 * when the excuse started (blocker raise / extension grant) is locked as unexcused — excuses are
 * never retroactive. Excused credit is the part of the extension after that point.
 */
export function planDeadlineExtension(input: {
  deadline: Date | null;
  new_deadline: Date;
  /** Blocker raise time, or the time the extension is granted. */
  excuse_from: Date;
}): { locked_minutes: number; excused_minutes: number } {
  if (!input.deadline) return { locked_minutes: 0, excused_minutes: 0 };
  const locked = input.excuse_from > input.deadline ? minutesBetween(input.deadline, input.excuse_from) : 0;
  const base = input.excuse_from > input.deadline ? input.excuse_from : input.deadline;
  return { locked_minutes: locked, excused_minutes: minutesBetween(base, input.new_deadline) };
}

/**
 * Accepting a blocker in PAUSE mode: when it is resolved the deadline moves out by the time the task
 * was blocked (raise → resolve; pending manager review time included, so slow decisions never count
 * against the employee). Time already overdue before the raise stays in "finish − deadline".
 */
export function planPauseResume(input: { deadline: Date; raised_at: Date; resolved_at: Date }): { new_deadline: Date; shift_minutes: number } {
  const shift = minutesBetween(input.raised_at, input.resolved_at);
  return { new_deadline: new Date(input.deadline.getTime() + shift * 60000), shift_minutes: shift };
}

// ============================================================================ no-update signal
export interface NoUpdateSettings {
  no_update_days_critical: number;
  no_update_days_high: number;
  no_update_days_medium: number;
  no_update_days_low: number;
}

export function noUpdateThresholdDays(priority: TaskPriority | string, s: NoUpdateSettings): number {
  switch (priority) {
    case 'critical':
      return s.no_update_days_critical;
    case 'high':
      return s.no_update_days_high;
    case 'low':
      return s.no_update_days_low;
    default:
      return s.no_update_days_medium;
  }
}

/** Open work with no assignee update for longer than its priority allows. Accepted blockers are excluded. */
export function isTaskWithoutUpdate(
  t: { status: string; priority: string; last_update_at: string | Date | null; has_accepted_blocker?: boolean },
  s: NoUpdateSettings,
  now: Date = new Date(),
): boolean {
  if (!TASK_OVERDUE_CAPABLE_STATUSES.includes(t.status as TaskStatus)) return false;
  if (t.status === 'blocked' && t.has_accepted_blocker) return false;
  if (!t.last_update_at) return true;
  return now.getTime() - new Date(t.last_update_at).getTime() > noUpdateThresholdDays(t.priority, s) * 86400000;
}

// ============================================================================ recurrence engine
export interface TaskRecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly';
  /** Every N days / weeks / months (≥ 1). */
  interval: number;
  /** 0 = Sunday … 6 = Saturday. Required for weekly; optional filter for daily ("weekdays only"). */
  weekdays?: number[];
  /** Monthly: calendar days 1–31; 29/30/31 fall back to the last day of shorter months. */
  month_days?: number[];
  /** Monthly: the last calendar day. */
  month_last_day?: boolean;
  /** Monthly: the last working day (weekly offs and holidays respected). */
  month_last_working_day?: boolean;
}

export function validateRecurrenceRule(type: TaskRecurrenceType, raw: unknown): { rule: TaskRecurrenceRule | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (type === 'one_time') return { rule: null, errors };
  if (!raw || typeof raw !== 'object') return { rule: null, errors: { recurrence_rule: 'Choose how often this task repeats.' } };
  const r = raw as Record<string, unknown>;
  const freq = (type === 'custom' ? r.freq : type) as TaskRecurrenceRule['freq'];
  if (!['daily', 'weekly', 'monthly'].includes(freq as string)) errors['recurrence_rule.freq'] = 'Repeat unit must be days, weeks or months.';
  if (type !== 'custom' && r.freq !== undefined && r.freq !== type) errors['recurrence_rule.freq'] = `A ${type} task repeats by ${type === 'daily' ? 'day' : type === 'weekly' ? 'week' : 'month'}.`;
  const interval = r.interval === undefined || r.interval === null || r.interval === '' ? 1 : Number(r.interval);
  const maxInterval = freq === 'daily' ? 365 : freq === 'weekly' ? 52 : 12;
  if (!Number.isInteger(interval) || interval < 1 || interval > maxInterval) errors['recurrence_rule.interval'] = `Interval must be a whole number between 1 and ${maxInterval}.`;
  if (type !== 'custom' && interval !== 1) errors['recurrence_rule.interval'] = 'Use "Custom recurring" to repeat every N days/weeks/months.';

  const ints = (v: unknown, min: number, max: number) =>
    Array.isArray(v) ? Array.from(new Set(v.map(Number))).filter((n) => Number.isInteger(n) && n >= min && n <= max).sort((a, b) => a - b) : [];
  const weekdays = ints(r.weekdays, 0, 6);
  if (Array.isArray(r.weekdays) && weekdays.length !== new Set(r.weekdays).size) errors['recurrence_rule.weekdays'] = 'Weekdays must be numbers 0 (Sun) to 6 (Sat).';
  const monthDays = ints(r.month_days, 1, 31);
  if (Array.isArray(r.month_days) && monthDays.length !== new Set(r.month_days).size) errors['recurrence_rule.month_days'] = 'Month days must be between 1 and 31.';
  const lastDay = r.month_last_day === true;
  const lastWorking = r.month_last_working_day === true;

  const rule: TaskRecurrenceRule = { freq, interval };
  if (freq === 'weekly') {
    if (!weekdays.length) errors['recurrence_rule.weekdays'] = 'Pick at least one weekday.';
    rule.weekdays = weekdays;
  } else if (freq === 'daily') {
    if (weekdays.length && weekdays.length < 7) rule.weekdays = weekdays;
  } else if (freq === 'monthly') {
    const kinds = (monthDays.length ? 1 : 0) + (lastDay ? 1 : 0) + (lastWorking ? 1 : 0);
    if (kinds === 0) errors['recurrence_rule.month_days'] = 'Pick day(s) of the month, the last day, or the last working day.';
    if (lastDay && lastWorking) errors['recurrence_rule.month_days'] = 'Choose either the last day or the last working day.';
    if (monthDays.length) rule.month_days = monthDays;
    if (lastDay) rule.month_last_day = true;
    if (lastWorking) rule.month_last_working_day = true;
  }
  return { rule: Object.keys(errors).length ? null : rule, errors };
}

export type OccurrenceAdjustment = 'none' | 'shifted_before' | 'shifted_after' | 'kept_on_holiday' | 'skipped_holiday' | 'skipped_collision';

export interface TaskOccurrence {
  /** Nominal date from the rule — the idempotency key with the template id. */
  occurrence_date: string;
  /** Date the work is scheduled for after the holiday policy (null when skipped). */
  work_date: string | null;
  adjustment: OccurrenceAdjustment;
  /** 1-based position in the series (counts towards max_occurrences, including skipped ones). */
  index: number;
}

export interface ExpandRecurrenceInput {
  rule: TaskRecurrenceRule;
  start_date: string;
  end_date?: string | null;
  max_occurrences?: number | null;
  /** Window of nominal dates to return (inclusive). */
  from: string;
  to: string;
  holiday_policy: TaskHolidayPolicy;
  /** Weekly off or holiday for the assignee. */
  isNonWorkingDay: (date: string) => boolean;
  /** Work dates already used by existing instances of this template (collision guard across runs). */
  usedWorkDates?: Set<string>;
  /** Stop after this many occurrences in the window (previews). */
  limit?: number;
}

const weekIndex = (start: string, date: string) => {
  // weeks start on Monday
  const startMonday = addIsoDays(start, -((isoWeekday(start) + 6) % 7));
  const dateMonday = addIsoDays(date, -((isoWeekday(date) + 6) % 7));
  return Math.round(isoDaysBetween(startMonday, dateMonday) / 7);
};

function lastWorkingDayOfMonth(year: number, month1: number, isNonWorkingDay: (d: string) => boolean): string {
  let d = `${year}-${pad2(month1)}-${pad2(daysInMonth(year, month1))}`;
  for (let i = 0; i < 31 && isNonWorkingDay(d); i++) d = addIsoDays(d, -1);
  return d;
}

/** Nominal dates of the rule, in order, from start_date (unbounded generator capped by `until`). */
function* nominalDates(rule: TaskRecurrenceRule, start: string, until: string, isNonWorkingDay: (d: string) => boolean): Generator<{ date: string; exactWorkingDay: boolean }> {
  if (rule.freq === 'monthly') {
    const [sy, sm] = start.split('-').map(Number);
    for (let i = 0; i < 1200; i += rule.interval) {
      const y = sy + Math.floor((sm - 1 + i) / 12);
      const m = ((sm - 1 + i) % 12) + 1;
      if (`${y}-${pad2(m)}-01` > until) return;
      const dim = daysInMonth(y, m);
      const days = new Set<string>();
      for (const md of rule.month_days || []) days.add(`${y}-${pad2(m)}-${pad2(Math.min(md, dim))}`);
      if (rule.month_last_day) days.add(`${y}-${pad2(m)}-${pad2(dim)}`);
      const lwd = rule.month_last_working_day ? lastWorkingDayOfMonth(y, m, isNonWorkingDay) : null;
      if (lwd) days.add(lwd);
      for (const d of Array.from(days).sort()) {
        if (d < start) continue;
        if (d > until) return;
        yield { date: d, exactWorkingDay: d === lwd };
      }
    }
    return;
  }
  let d = start;
  for (let guard = 0; guard < 20000 && d <= until; guard++, d = addIsoDays(d, 1)) {
    const wd = isoWeekday(d);
    if (rule.freq === 'daily') {
      if (isoDaysBetween(start, d) % rule.interval !== 0) continue;
      if (rule.weekdays?.length && !rule.weekdays.includes(wd)) continue;
      yield { date: d, exactWorkingDay: false };
    } else {
      if (!rule.weekdays?.includes(wd)) continue;
      if (weekIndex(start, d) % rule.interval !== 0) continue;
      yield { date: d, exactWorkingDay: false };
    }
  }
}

/**
 * Expands a recurring rule into occurrences within [from, to], applying the holiday policy.
 * Pure and deterministic: the same inputs always give the same occurrence dates, which together
 * with the unique (template_id, occurrence_date) key makes generation idempotent.
 */
export function expandRecurrence(input: ExpandRecurrenceInput): TaskOccurrence[] {
  const out: TaskOccurrence[] = [];
  const until = input.end_date && input.end_date < input.to ? input.end_date : input.to;
  const used = new Set(input.usedWorkDates || []);
  let index = 0;
  for (const nominal of nominalDates(input.rule, input.start_date, until, input.isNonWorkingDay)) {
    index++;
    if (input.max_occurrences && index > input.max_occurrences) break;
    if (nominal.date < input.from) {
      continue;
    }
    let work: string | null = nominal.date;
    let adjustment: OccurrenceAdjustment = 'none';
    if (!nominal.exactWorkingDay && input.isNonWorkingDay(nominal.date)) {
      switch (input.holiday_policy) {
        case 'keep':
          adjustment = 'kept_on_holiday';
          break;
        case 'skip':
          work = null;
          adjustment = 'skipped_holiday';
          break;
        case 'shift_before': {
          let d = addIsoDays(nominal.date, -1);
          for (let i = 0; i < 31 && input.isNonWorkingDay(d); i++) d = addIsoDays(d, -1);
          if (d < input.start_date) {
            d = addIsoDays(nominal.date, 1);
            for (let i = 0; i < 31 && input.isNonWorkingDay(d); i++) d = addIsoDays(d, 1);
            adjustment = 'shifted_after';
          } else adjustment = 'shifted_before';
          work = d;
          break;
        }
        case 'shift_after': {
          let d = addIsoDays(nominal.date, 1);
          for (let i = 0; i < 31 && input.isNonWorkingDay(d); i++) d = addIsoDays(d, 1);
          work = d;
          adjustment = 'shifted_after';
          break;
        }
      }
    }
    if (work && used.has(work)) {
      work = null;
      adjustment = 'skipped_collision';
    }
    if (work) used.add(work);
    out.push({ occurrence_date: nominal.date, work_date: work, adjustment, index });
    if (input.limit && out.length >= input.limit) break;
  }
  return out;
}

/** Plain-English summary of a rule, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRecurrence(type: TaskRecurrenceType, rule: TaskRecurrenceRule | null | undefined): string {
  if (type === 'one_time' || !rule) return 'One-time';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const every = (unit: string) => (rule.interval > 1 ? `Every ${rule.interval} ${unit}s` : `Every ${unit}`);
  if (rule.freq === 'daily') return `${every('day')}${rule.weekdays?.length ? ` (${rule.weekdays.map((d) => days[d]).join(', ')})` : ''}`;
  if (rule.freq === 'weekly') return `${every('week')} on ${(rule.weekdays || []).map((d) => days[d]).join(', ')}`;
  const parts: string[] = [];
  if (rule.month_days?.length) parts.push(`day ${rule.month_days.join(', ')}`);
  if (rule.month_last_day) parts.push('the last day');
  if (rule.month_last_working_day) parts.push('the last working day');
  return `${every('month')} on ${parts.join(' & ')}`;
}
