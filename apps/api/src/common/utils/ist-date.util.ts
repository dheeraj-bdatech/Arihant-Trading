/**
 * Business-day (Asia/Kolkata) helpers for the API.
 *
 * The server and Postgres run in UTC, 5h30 behind India. Between 00:00 and 05:30 IST a UTC "today"
 * (`new Date().toISOString().split('T')[0]`, SQL `CURRENT_DATE`) is still yesterday. Every "today", "in the future" or
 * "before X" check on a calendar date must compare IST calendar-day strings ('YYYY-MM-DD') produced here.
 */
import { addIsoDays, istDateOf, isoDaysBetween, todayInKolkata } from '@arihant/shared';

export { addIsoDays, istDateOf, isoDaysBetween, todayInKolkata };

/**
 * Normalises a calendar value to an IST 'YYYY-MM-DD' day string.
 * - 'YYYY-MM-DD' strings are returned as-is (they already are a calendar date).
 * - Date objects / ISO instants are mapped to their IST calendar date. A Postgres DATE column read by node-postgres
 *   arrives as local midnight of that day, which falls on the same IST date for a UTC or IST server clock.
 * Returns null for empty / invalid input.
 */
export function calendarDay(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      // Round-trip so impossible days ("2026-02-30") are rejected instead of passed through.
      const d = new Date(`${trimmed}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === trimmed ? trimmed : null;
    }
  }
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  if (typeof value === 'string' && Number.isNaN(new Date(value).getTime())) return null;
  return istDateOf(value);
}
