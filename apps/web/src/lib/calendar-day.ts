import { istDateOf } from '@/lib/ist-date';

/**
 * A calendar value from the API as its IST day ('YYYY-MM-DD').
 *
 * Postgres DATE columns reach the browser either as 'YYYY-MM-DD' or as a serialized instant (midnight of that day in
 * the API server's timezone, e.g. '2026-10-13T00:00:00.000Z' on a UTC server). Both land on the same IST calendar day,
 * whereas `.split('T')[0]` / `new Date(v).toDateString()` drift by a day depending on the server or browser timezone.
 * Returns '' for empty or invalid input.
 */
export function calendarDay(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? '' : istDateOf(d);
}
