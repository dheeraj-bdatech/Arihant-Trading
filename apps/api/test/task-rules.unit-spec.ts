/**
 * Module 8 — pure rule tests: transition map, derived overdue (IST end of day), delay classification
 * and excused time (extend vs pause, accepted after deadline), recurrence engine (month end, leap year,
 * holidays, collisions, limits, determinism), no-update thresholds and IST formatting. No database or HTTP.
 */
import {
  TASK_STATUSES,
  TASK_TRANSITIONS,
  allowedTaskActions,
  computeTaskDelay,
  describeRecurrence,
  expandRecurrence,
  formatTaskDateTime,
  isTaskOverdue,
  isTaskWithoutUpdate,
  istDateOf,
  istEndOfDay,
  noUpdateThresholdDays,
  planDeadlineExtension,
  planPauseResume,
  relativeDue,
  resolveTaskAction,
  taskDisplayStatus,
  validateRecurrenceRule,
  type TaskAction,
  type TaskActorKind,
  type TaskStatus,
} from '@arihant/shared';

const kinds = (...k: TaskActorKind[]) => new Set<TaskActorKind>(k);
const at = (s: string) => new Date(s);
const DAY = 1440;

describe('Module 8 — transition map', () => {
  const expectOk = (status: TaskStatus, action: TaskAction, k: Set<TaskActorKind>) => expect(resolveTaskAction(status, action, k)).toMatchObject({ ok: true });
  const expectNo = (status: TaskStatus, action: TaskAction, k: Set<TaskActorKind>, reason: string) =>
    expect(resolveTaskAction(status, action, k)).toEqual({ ok: false, reason });

  it('every rule lists only real statuses', () => {
    for (const t of TASK_TRANSITIONS) for (const s of t.from) expect(TASK_STATUSES).toContain(s);
  });

  it('assignee starts, raises blockers and completes', () => {
    expectOk('not_started', 'start', kinds('assignee'));
    expectNo('in_progress', 'start', kinds('assignee'), 'invalid_status');
    expectOk('not_started', 'complete', kinds('assignee')); // straight to done is allowed
    expectOk('in_progress', 'complete', kinds('assignee'));
    expectNo('blocked', 'complete', kinds('assignee'), 'invalid_status');
    expectNo('awaiting_approval', 'complete', kinds('assignee'), 'invalid_status');
    expectNo('in_progress', 'complete', kinds('manager'), 'forbidden');
  });

  it('blockers cannot be raised on completed, cancelled or awaiting-approval tasks (§7.21)', () => {
    expectOk('not_started', 'raise_blocker', kinds('assignee'));
    expectOk('in_progress', 'raise_blocker', kinds('assignee'));
    for (const s of ['completed', 'cancelled', 'awaiting_approval', 'blocked'] as TaskStatus[]) expectNo(s, 'raise_blocker', kinds('assignee'), 'invalid_status');
  });

  it('nobody approves, cancels, extends or reassigns their own work', () => {
    for (const a of ['approve', 'send_back', 'reopen', 'cancel', 'extend_deadline', 'reassign', 'escalate', 'edit'] as TaskAction[]) {
      const from = TASK_TRANSITIONS.find((t) => t.action === a)!.from[0];
      expectNo(from, a, kinds('assignee', 'manager', 'assigner', 'admin'), 'self');
    }
  });

  it('managers approve / send back / reopen; assigners may only cancel and edit', () => {
    expectOk('awaiting_approval', 'approve', kinds('manager'));
    expectOk('awaiting_approval', 'send_back', kinds('manager'));
    expectOk('completed', 'reopen', kinds('manager'));
    expectNo('in_progress', 'approve', kinds('manager'), 'invalid_status');
    expectNo('awaiting_approval', 'approve', kinds('assigner'), 'forbidden');
    expectOk('in_progress', 'cancel', kinds('assigner'));
    expectOk('blocked', 'edit', kinds('assigner'));
    expectNo('completed', 'edit', kinds('manager'), 'invalid_status'); // not after completion
    expectNo('completed', 'cancel', kinds('manager'), 'invalid_status');
    expectNo('cancelled', 'cancel', kinds('manager'), 'invalid_status');
  });

  it('reassign is not allowed once work is awaiting approval or complete (§7.27)', () => {
    expectOk('blocked', 'reassign', kinds('manager'));
    expectNo('awaiting_approval', 'reassign', kinds('manager'), 'invalid_status');
    expectNo('completed', 'reassign', kinds('manager'), 'invalid_status');
  });

  it('admin correction works from any status', () => {
    for (const s of TASK_STATUSES) expectOk(s, 'correction', kinds('admin'));
    expectNo('completed', 'correction', kinds('manager'), 'forbidden');
  });

  it('allowedTaskActions drives the UI buttons', () => {
    expect(allowedTaskActions('not_started', kinds('assignee'))).toEqual(expect.arrayContaining(['start', 'complete', 'raise_blocker', 'progress']));
    expect(allowedTaskActions('not_started', kinds('assignee'))).not.toContain('cancel');
    expect(allowedTaskActions('awaiting_approval', kinds('manager'))).toEqual(expect.arrayContaining(['approve', 'send_back', 'cancel', 'escalate']));
  });
});

describe('Module 8 — derived overdue (IST)', () => {
  const deadline = istEndOfDay('2026-10-14');

  it('a deadline of "today" means 23:59:59 IST', () => {
    expect(deadline.toISOString()).toBe('2026-10-14T18:29:59.000Z');
    expect(istDateOf(deadline)).toBe('2026-10-14');
  });

  it('is overdue only after the end of the IST day', () => {
    const t = { status: 'in_progress', deadline };
    expect(isTaskOverdue(t, at('2026-10-14T23:59:00+05:30'))).toBe(false);
    expect(isTaskOverdue(t, at('2026-10-15T00:00:30+05:30'))).toBe(true);
  });

  it('awaiting approval, completed and cancelled are never overdue', () => {
    const later = at('2026-11-01T00:00:00Z');
    for (const status of ['awaiting_approval', 'completed', 'cancelled']) expect(isTaskOverdue({ status, deadline }, later)).toBe(false);
  });

  it('an accepted blocker pauses overdue; a pending one does not', () => {
    const later = at('2026-11-01T00:00:00Z');
    expect(isTaskOverdue({ status: 'blocked', deadline, has_accepted_blocker: true }, later)).toBe(false);
    expect(isTaskOverdue({ status: 'blocked', deadline, has_accepted_blocker: false }, later)).toBe(true);
    expect(taskDisplayStatus({ status: 'in_progress', deadline }, later)).toBe('overdue');
    expect(taskDisplayStatus({ status: 'in_progress', deadline }, at('2026-10-01T00:00:00Z'))).toBe('in_progress');
  });
});

describe('Module 8 — delay classification & excused time', () => {
  const D = at('2026-10-10T18:29:59Z'); // 10 Oct 23:59:59 IST
  const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60000);

  it('on time, late unexcused, open overdue and cancelled', () => {
    expect(computeTaskDelay({ status: 'completed', deadline: D, original_deadline: D, completed_at: plus(D, -60) }).delay_class).toBe('on_time');
    const late = computeTaskDelay({ status: 'completed', deadline: D, original_deadline: D, completed_at: plus(D, 2 * DAY) });
    expect(late).toMatchObject({ delay_class: 'late_unexcused', total_delay_minutes: 2 * DAY, unexcused_delay_minutes: 2 * DAY, excused_delay_minutes: 0 });
    expect(computeTaskDelay({ status: 'in_progress', deadline: D, original_deadline: D, completed_at: null }, plus(D, 30)).delay_class).toBe('open_overdue');
    expect(computeTaskDelay({ status: 'in_progress', deadline: D, original_deadline: D, completed_at: null }, plus(D, -30)).delay_class).toBe('open');
    expect(computeTaskDelay({ status: 'cancelled', deadline: D, original_deadline: D, completed_at: null }).delay_class).toBeNull();
  });

  it('completion measured at hand-in, not at approval', () => {
    const r = computeTaskDelay({ status: 'awaiting_approval', deadline: D, original_deadline: D, completed_at: plus(D, -5) }, plus(D, 3 * DAY));
    expect(r.delay_class).toBe('on_time');
  });

  it('extension granted before the deadline excuses the delay (LATE_EXCUSED)', () => {
    const newDeadline = plus(D, 3 * DAY);
    const plan = planDeadlineExtension({ deadline: D, new_deadline: newDeadline, excuse_from: plus(D, -DAY) });
    expect(plan).toEqual({ locked_minutes: 0, excused_minutes: 3 * DAY });
    const r = computeTaskDelay({ status: 'completed', deadline: newDeadline, original_deadline: D, completed_at: plus(D, 2 * DAY), unexcused_locked_minutes: plan.locked_minutes });
    expect(r).toMatchObject({ delay_class: 'late_excused', excused_delay_minutes: 2 * DAY, unexcused_delay_minutes: 0 });
  });

  it('a blocker accepted while already overdue only excuses time from the raise (§7.25)', () => {
    // deadline 10 Oct, blocker raised 12 Oct, manager extends to 17 Oct, done 16 Oct.
    const raised = plus(D, 2 * DAY);
    const newDeadline = plus(D, 7 * DAY);
    const plan = planDeadlineExtension({ deadline: D, new_deadline: newDeadline, excuse_from: raised });
    expect(plan).toEqual({ locked_minutes: 2 * DAY, excused_minutes: 5 * DAY });
    const r = computeTaskDelay({ status: 'completed', deadline: newDeadline, original_deadline: D, completed_at: plus(D, 6 * DAY), unexcused_locked_minutes: plan.locked_minutes });
    expect(r).toMatchObject({ delay_class: 'late_unexcused', total_delay_minutes: 6 * DAY, unexcused_delay_minutes: 2 * DAY, excused_delay_minutes: 4 * DAY });
  });

  it('PAUSE: the deadline moves out by the blocked time, pending review included', () => {
    // raised 3 days before the deadline, resolved 2 days later → deadline + 2 days
    const raised = plus(D, -3 * DAY);
    const resolved = plus(D, -DAY);
    const { new_deadline, shift_minutes } = planPauseResume({ deadline: D, raised_at: raised, resolved_at: resolved });
    expect(shift_minutes).toBe(2 * DAY);
    const r = computeTaskDelay({ status: 'completed', deadline: new_deadline, original_deadline: D, completed_at: plus(D, DAY) });
    expect(r.delay_class).toBe('late_excused');
  });

  it('PAUSE raised after the deadline keeps the pre-raise lateness unexcused', () => {
    const raised = plus(D, 2 * DAY);
    const resolved = plus(D, 4 * DAY);
    const { new_deadline } = planPauseResume({ deadline: D, raised_at: raised, resolved_at: resolved });
    const r = computeTaskDelay({ status: 'completed', deadline: new_deadline, original_deadline: D, completed_at: plus(D, 5 * DAY) });
    expect(r).toMatchObject({ delay_class: 'late_unexcused', unexcused_delay_minutes: 3 * DAY, excused_delay_minutes: 2 * DAY });
  });

  it('while an accepted blocker is open the delay clock is frozen at the raise', () => {
    const raised = plus(D, DAY);
    const r = computeTaskDelay(
      { status: 'blocked', deadline: D, original_deadline: D, completed_at: null, has_accepted_blocker: true, accepted_blocker_raised_at: raised },
      plus(D, 10 * DAY),
    );
    expect(r).toMatchObject({ delay_class: 'open', unexcused_delay_minutes: DAY });
  });

  it('a rejected blocker never paused the clock — all delay is unexcused', () => {
    const r = computeTaskDelay({ status: 'completed', deadline: D, original_deadline: D, completed_at: plus(D, 4 * DAY) });
    expect(r.unexcused_delay_minutes).toBe(4 * DAY);
  });
});

describe('Module 8 — no-update signal', () => {
  const s = { no_update_days_critical: 1, no_update_days_high: 2, no_update_days_medium: 3, no_update_days_low: 5 };
  const now = at('2026-10-14T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000 - 1000);

  it('threshold depends on priority', () => {
    expect(noUpdateThresholdDays('critical', s)).toBe(1);
    expect(noUpdateThresholdDays('low', s)).toBe(5);
    expect(noUpdateThresholdDays('unknown', s)).toBe(3);
    expect(isTaskWithoutUpdate({ status: 'in_progress', priority: 'critical', last_update_at: daysAgo(1) }, s, now)).toBe(true);
    expect(isTaskWithoutUpdate({ status: 'in_progress', priority: 'low', last_update_at: daysAgo(4) }, s, now)).toBe(false);
  });

  it('accepted blockers, approvals and terminal work are excluded (§7.34)', () => {
    expect(isTaskWithoutUpdate({ status: 'blocked', priority: 'high', last_update_at: daysAgo(9), has_accepted_blocker: true }, s, now)).toBe(false);
    expect(isTaskWithoutUpdate({ status: 'blocked', priority: 'high', last_update_at: daysAgo(9) }, s, now)).toBe(true);
    expect(isTaskWithoutUpdate({ status: 'awaiting_approval', priority: 'high', last_update_at: daysAgo(9) }, s, now)).toBe(false);
    expect(isTaskWithoutUpdate({ status: 'completed', priority: 'high', last_update_at: daysAgo(9) }, s, now)).toBe(false);
  });
});

describe('Module 8 — recurrence engine', () => {
  const sundaysOff = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  const withHolidays = (holidays: string[]) => (d: string) => sundaysOff(d) || holidays.includes(d);
  const base = { holiday_policy: 'keep' as const, isNonWorkingDay: () => false };

  it('monthly on the 31st falls back to the last day of shorter months, incl. leap years', () => {
    const occ = expandRecurrence({ ...base, rule: { freq: 'monthly', interval: 1, month_days: [31] }, start_date: '2027-12-01', from: '2027-12-01', to: '2028-04-30' });
    expect(occ.map((o) => o.occurrence_date)).toEqual(['2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
    const nonLeap = expandRecurrence({ ...base, rule: { freq: 'monthly', interval: 1, month_days: [30] }, start_date: '2026-02-01', from: '2026-02-01', to: '2026-02-28' });
    expect(nonLeap.map((o) => o.occurrence_date)).toEqual(['2026-02-28']);
  });

  it('1st & 15th, and every 3 months', () => {
    const twice = expandRecurrence({ ...base, rule: { freq: 'monthly', interval: 1, month_days: [1, 15] }, start_date: '2026-10-10', from: '2026-10-10', to: '2026-11-30' });
    expect(twice.map((o) => o.occurrence_date)).toEqual(['2026-10-15', '2026-11-01', '2026-11-15']);
    const quarterly = expandRecurrence({ ...base, rule: { freq: 'monthly', interval: 3, month_days: [5] }, start_date: '2026-01-01', from: '2026-01-01', to: '2026-12-31' });
    expect(quarterly.map((o) => o.occurrence_date)).toEqual(['2026-01-05', '2026-04-05', '2026-07-05', '2026-10-05']);
  });

  it('last working day respects weekly offs and holidays', () => {
    // 31 Jan 2027 is a Sunday; 30 Jan is a declared holiday → 29 Jan
    const occ = expandRecurrence({
      rule: { freq: 'monthly', interval: 1, month_last_working_day: true },
      start_date: '2027-01-01', from: '2027-01-01', to: '2027-01-31',
      holiday_policy: 'skip', isNonWorkingDay: withHolidays(['2027-01-30']),
    });
    expect(occ).toEqual([{ occurrence_date: '2027-01-29', work_date: '2027-01-29', adjustment: 'none', index: 1 }]);
  });

  it('weekly every 2 weeks on Mon & Thu', () => {
    const occ = expandRecurrence({ ...base, rule: { freq: 'weekly', interval: 2, weekdays: [1, 4] }, start_date: '2026-10-12', from: '2026-10-12', to: '2026-11-08' });
    expect(occ.map((o) => o.occurrence_date)).toEqual(['2026-10-12', '2026-10-15', '2026-10-26', '2026-10-29']);
  });

  it('holiday policies: skip, shift before/after, keep', () => {
    const rule = { freq: 'weekly' as const, interval: 1, weekdays: [0] }; // Sundays
    const common = { rule, start_date: '2026-10-11', from: '2026-10-11', to: '2026-10-11', isNonWorkingDay: sundaysOff };
    expect(expandRecurrence({ ...common, holiday_policy: 'skip' })[0]).toMatchObject({ work_date: null, adjustment: 'skipped_holiday' });
    expect(expandRecurrence({ ...common, holiday_policy: 'shift_after' })[0]).toMatchObject({ work_date: '2026-10-12', adjustment: 'shifted_after' });
    expect(expandRecurrence({ ...common, holiday_policy: 'keep' })[0]).toMatchObject({ work_date: '2026-10-11', adjustment: 'kept_on_holiday' });
    // shift_before would land before the series start → falls forward instead
    expect(expandRecurrence({ ...common, holiday_policy: 'shift_before' })[0]).toMatchObject({ work_date: '2026-10-12', adjustment: 'shifted_after' });
    const later = { ...common, from: '2026-10-18', to: '2026-10-18' };
    expect(expandRecurrence({ ...later, holiday_policy: 'shift_before' })[0]).toMatchObject({ occurrence_date: '2026-10-18', work_date: '2026-10-17', adjustment: 'shifted_before' });
  });

  it('a shifted occurrence never doubles up on an existing work date', () => {
    const occ = expandRecurrence({
      rule: { freq: 'daily', interval: 1 }, start_date: '2026-10-10', from: '2026-10-10', to: '2026-10-13',
      holiday_policy: 'shift_after', isNonWorkingDay: sundaysOff,
    });
    expect(occ.map((o) => [o.occurrence_date, o.work_date])).toEqual([
      ['2026-10-10', '2026-10-10'],
      ['2026-10-11', '2026-10-12'],
      ['2026-10-12', null],
      ['2026-10-13', '2026-10-13'],
    ]);
    const acrossRuns = expandRecurrence({
      rule: { freq: 'weekly', interval: 1, weekdays: [1] }, start_date: '2026-10-12', from: '2026-10-12', to: '2026-10-12',
      holiday_policy: 'keep', isNonWorkingDay: () => false, usedWorkDates: new Set(['2026-10-12']),
    });
    expect(acrossRuns[0].adjustment).toBe('skipped_collision');
  });

  it('daily weekdays-only, end date, max occurrences and preview limit', () => {
    const occ = expandRecurrence({ ...base, rule: { freq: 'daily', interval: 1, weekdays: [1, 2, 3, 4, 5, 6] }, start_date: '2026-10-10', from: '2026-10-10', to: '2026-10-20', end_date: '2026-10-14' });
    expect(occ.map((o) => o.occurrence_date)).toEqual(['2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14']);
    const capped = expandRecurrence({ ...base, rule: { freq: 'daily', interval: 2 }, start_date: '2026-10-01', from: '2026-10-05', to: '2026-12-31', max_occurrences: 4 });
    expect(capped.map((o) => [o.occurrence_date, o.index])).toEqual([['2026-10-05', 3], ['2026-10-07', 4]]);
    expect(expandRecurrence({ ...base, rule: { freq: 'daily', interval: 1 }, start_date: '2026-10-01', from: '2026-10-01', to: '2030-01-01', limit: 10 })).toHaveLength(10);
  });

  it('is deterministic — the same window always yields the same keys (idempotent generation)', () => {
    const input = { rule: { freq: 'weekly' as const, interval: 1, weekdays: [2, 5] }, start_date: '2026-09-01', from: '2026-10-01', to: '2026-12-31', holiday_policy: 'shift_after' as const, isNonWorkingDay: withHolidays(['2026-10-20']) };
    expect(expandRecurrence(input)).toEqual(expandRecurrence(input));
  });

  it('validates rules per frequency', () => {
    expect(validateRecurrenceRule('weekly', { weekdays: [] }).errors['recurrence_rule.weekdays']).toBeDefined();
    expect(validateRecurrenceRule('monthly', {}).errors['recurrence_rule.month_days']).toBeDefined();
    expect(validateRecurrenceRule('daily', { interval: 2 }).errors['recurrence_rule.interval']).toBeDefined();
    expect(validateRecurrenceRule('custom', { freq: 'weekly', interval: 2, weekdays: [1] }).rule).toEqual({ freq: 'weekly', interval: 2, weekdays: [1] });
    expect(validateRecurrenceRule('monthly', { month_last_day: true, month_last_working_day: true }).rule).toBeNull();
    expect(describeRecurrence('custom', { freq: 'weekly', interval: 2, weekdays: [1, 4] })).toBe('Every 2 weeks on Mon, Thu');
  });
});

describe('Module 8 — IST formatting', () => {
  it('formats DD-MM-YYYY hh:mm A in IST', () => {
    expect(formatTaskDateTime('2026-10-14T18:29:59Z')).toBe('14-10-2026 11:59 PM');
    expect(formatTaskDateTime('2026-10-14T04:00:00Z')).toBe('14-10-2026 09:30 AM');
  });
  it('relative due labels', () => {
    const now = at('2026-10-14T06:00:00Z');
    expect(relativeDue(at('2026-10-14T09:00:00Z'), now)).toEqual({ label: 'due in 3h', overdue: false });
    expect(relativeDue(at('2026-10-12T06:00:00Z'), now)).toEqual({ label: 'overdue by 2 days', overdue: true });
  });
});
