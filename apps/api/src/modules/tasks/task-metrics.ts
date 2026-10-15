/**
 * Pure aggregation for accountability and performance evidence. Every number is derived with the shared
 * computeTaskDelay(), so the dashboard, the evidence report, exports and snapshots always agree.
 * There are deliberately no monetary fields, rates of pay, penalties or recommendations here.
 */
import { computeTaskDelay, isTaskOverdue, isTaskWithoutUpdate, minutesToDays, type NoUpdateSettings, type TaskDelayClass } from '@arihant/shared';

export interface MetricTask {
  id: string;
  task_number: string;
  title: string;
  assigned_to: string | null;
  status: string;
  priority: string;
  category_name: string | null;
  template_id: string | null;
  deadline: Date | string | null;
  original_deadline: Date | string | null;
  completed_at: Date | string | null;
  unexcused_locked_minutes: number;
  extension_count: number;
  rework_count: number;
  reopen_count: number;
  is_backlog: boolean;
  generated_late: boolean;
  last_update_at: Date | string | null;
  accepted_blocker_raised_at: Date | string | null;
}

export interface MetricBlocker {
  id: string;
  task_id: string;
  blocker_type: string;
  status: string;
  decision: string | null;
  raised_after_deadline: boolean;
  requested_new_deadline: Date | string | null;
  excused_minutes: number;
  created_at: Date | string;
}

export interface ClassifiedTask extends MetricTask {
  delay_class: TaskDelayClass | null;
  is_overdue: boolean;
  no_update: boolean;
  total_delay_minutes: number;
  excused_delay_minutes: number;
  unexcused_delay_minutes: number;
  /** Excluded from compliance metrics (cancelled, backlog entry, generated late after downtime). */
  excluded: 'cancelled' | 'backlog' | 'generated_late' | null;
}

export function classify(t: MetricTask, s: NoUpdateSettings, now: Date): ClassifiedTask {
  const input = { ...t, has_accepted_blocker: Boolean(t.accepted_blocker_raised_at) };
  const d = computeTaskDelay(input, now);
  return {
    ...t,
    delay_class: d.delay_class,
    is_overdue: isTaskOverdue(input, now),
    no_update: isTaskWithoutUpdate(input, s, now),
    total_delay_minutes: d.total_delay_minutes,
    excused_delay_minutes: d.excused_delay_minutes,
    unexcused_delay_minutes: d.unexcused_delay_minutes,
    excluded: t.status === 'cancelled' ? 'cancelled' : t.is_backlog ? 'backlog' : t.generated_late ? 'generated_late' : null,
  };
}

const ACCEPTED = ['accept_extend', 'accept_pause', 'auto_accept_leave'];
export const isAcceptedBlocker = (b: MetricBlocker) => b.decision !== null && ACCEPTED.includes(b.decision);

export function complianceSummary(tasks: ClassifiedTask[]) {
  const counted = tasks.filter((t) => !t.excluded);
  const done = counted.filter((t) => t.delay_class === 'on_time' || t.delay_class === 'late_excused' || t.delay_class === 'late_unexcused');
  const by = (c: TaskDelayClass) => counted.filter((t) => t.delay_class === c).length;
  const lateUnexcused = counted.filter((t) => t.delay_class === 'late_unexcused');
  const unexcusedMinutes = counted.reduce((a, t) => a + (t.delay_class === 'open' ? 0 : t.unexcused_delay_minutes), 0);
  const excusedMinutes = counted.reduce((a, t) => a + t.excused_delay_minutes, 0);
  return {
    assessed: counted.length,
    completed: done.length,
    on_time: by('on_time'),
    late_excused: by('late_excused'),
    late_unexcused: lateUnexcused.length,
    open_overdue: by('open_overdue'),
    open: by('open'),
    on_time_pct: done.length ? Math.round((by('on_time') / done.length) * 1000) / 10 : null,
    avg_unexcused_delay_days: lateUnexcused.length ? minutesToDays(lateUnexcused.reduce((a, t) => a + t.unexcused_delay_minutes, 0) / lateUnexcused.length) : 0,
    total_unexcused_delay_days: minutesToDays(unexcusedMinutes),
    total_excused_delay_days: minutesToDays(excusedMinutes),
  };
}

export function blockerSummary(blockers: MetricBlocker[]) {
  const accepted = blockers.filter(isAcceptedBlocker);
  const byType: Record<string, number> = {};
  for (const b of accepted) byType[b.blocker_type] = (byType[b.blocker_type] || 0) + 1;
  return {
    raised: blockers.length,
    accepted: accepted.length,
    accepted_by_type: byType,
    rejected: blockers.filter((b) => b.status === 'rejected').length,
    pending: blockers.filter((b) => b.status === 'pending_review').length,
    withdrawn: blockers.filter((b) => b.status === 'withdrawn').length,
    raised_after_deadline: blockers.filter((b) => b.raised_after_deadline).length,
    excused_days: minutesToDays(accepted.reduce((a, b) => a + (b.excused_minutes || 0), 0)),
    extensions_requested: blockers.filter((b) => b.requested_new_deadline).length,
  };
}

export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || '—';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
