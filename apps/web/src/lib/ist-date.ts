/**
 * Business-time (India, Asia/Kolkata) date helpers for the web app.
 *
 * Arihant operates in IST, but browsers, `new Date().toISOString()` and the server clock all work in UTC, which is
 * 5h30 behind. Between 00:00 and 05:30 IST a UTC-based "today" is still yesterday, and a bare `YYYY-MM-DD` parsed with
 * `new Date()` lands on 05:30 IST. Use these helpers for every date default, "is it today / in the future" check and
 * datetime input instead of `toISOString().split('T')[0]`.
 */
import { addIsoDays, istDateOf, istDateTime, todayInKolkata } from '@arihant/shared';

export { addIsoDays, istDateOf, istDateTime };

/** Today's calendar date in IST (YYYY-MM-DD) — the default for every date input. */
export const istToday = (now: Date = new Date()): string => todayInKolkata(now);

/** True when an instant or YYYY-MM-DD date falls on today's IST calendar date. */
export const isIstToday = (value: Date | string | null | undefined): boolean => {
  if (!value) return false;
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : istDateOf(value);
  return day === istToday();
};

/** True when a YYYY-MM-DD date is after today in IST (today itself is never "in the future"). */
export const isIstFutureDate = (date: string): boolean => date > istToday();

/** Current IST wall-clock time as a `datetime-local` value: 'YYYY-MM-DDTHH:mm'. */
export const istNowLocalInput = (now: Date = new Date()): string => toIstLocalInput(now);

/** An instant (ISO string / Date) as an IST `datetime-local` value: 'YYYY-MM-DDTHH:mm'. Empty for null. */
export const toIstLocalInput = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16);
};

/**
 * A `datetime-local` value typed by the user (IST wall clock, 'YYYY-MM-DDTHH:mm') as an ISO instant for the API.
 * A bare date ('YYYY-MM-DD') means the end of that IST day. Empty input gives null.
 */
export const fromIstLocalInput = (local: string | null | undefined): string | null => {
  if (!local) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(local)) return istDateTime(local, '23:59:59').toISOString();
  const d = istDateTime(local.slice(0, 10), local.slice(11, 16) || '00:00');
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
