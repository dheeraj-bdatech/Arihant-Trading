/**
 * Module 6 — SLA working-hours arithmetic used when a paused ticket resumes: the deadline of a working-hours SLA
 * slides by the working time the pause consumed (Mon–Sat, 09:00–18:00 IST), never by wall-clock time.
 * No database or HTTP.
 */
import { addBusinessHours, businessMsBetween } from '../src/modules/service/service.core';

const ist = (s: string) => new Date(`${s}+05:30`);
const H = 3600000;

describe('businessMsBetween (IST working day)', () => {
  it('counts only the working part of the same day', () => {
    expect(businessMsBetween(ist('2026-10-27T08:00:00'), ist('2026-10-27T10:30:00'))).toBe(1.5 * H);
    expect(businessMsBetween(ist('2026-10-27T17:00:00'), ist('2026-10-27T21:00:00'))).toBe(1 * H);
  });

  it('a Saturday-evening-to-Monday pause costs only Monday morning (Sunday is off)', () => {
    // 2026-10-31 is a Saturday, 2026-11-02 a Monday
    expect(businessMsBetween(ist('2026-10-31T17:00:00'), ist('2026-11-02T10:00:00'))).toBe(2 * H);
  });

  it('a pause entirely outside working hours costs nothing', () => {
    expect(businessMsBetween(ist('2026-10-27T19:00:00'), ist('2026-10-28T08:30:00'))).toBe(0);
    expect(businessMsBetween(ist('2026-11-01T09:00:00'), ist('2026-11-01T18:00:00'))).toBe(0); // Sunday
  });

  it('is zero for an empty or reversed span', () => {
    const t = ist('2026-10-27T12:00:00');
    expect(businessMsBetween(t, t)).toBe(0);
    expect(businessMsBetween(t, new Date(t.getTime() - H))).toBe(0);
  });

  it('honours a configured working day', () => {
    expect(businessMsBetween(ist('2026-10-27T07:00:00'), ist('2026-10-27T21:00:00'), 8, 20)).toBe(12 * H);
  });

  it('sliding a deadline by the worked time lands in working hours', () => {
    const due = ist('2026-10-31T17:00:00'); // Saturday 17:00
    const worked = businessMsBetween(ist('2026-10-31T16:00:00'), ist('2026-11-02T10:00:00')); // Sat 16–18 + Mon 09–10 = 3h
    expect(worked).toBe(3 * H);
    // 1h left on Saturday, Sunday off, 2h into Monday
    expect(addBusinessHours(due, worked / H).getTime()).toBe(ist('2026-11-02T11:00:00').getTime());
  });
});
