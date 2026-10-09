import { Kysely, sql } from 'kysely';
import type { Database } from '@arihant/shared';

type Db = Kysely<Database>;

/* ------------------------------------------------------------------ settings -- */

export async function getServiceSetting<T = unknown>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await db.selectFrom('service_settings').select('value').where('key', '=', key).executeTakeFirst();
  if (!row || row.value === null || row.value === undefined) return fallback;
  const v = row.value as any;
  // jsonb scalars can come back as strings depending on the driver
  if (typeof fallback === 'number') return (Number(v) as unknown as T) ?? fallback;
  if (typeof fallback === 'boolean') return (v === true || v === 'true') as unknown as T;
  return v as T;
}

/* ------------------------------------------------------------- ticket numbers -- */

/**
 * TCK-YYYY-NNNNNN from a DB sequence. Loops past any number already taken (older rows were
 * created from random numbers) so a collision can never surface as a 500.
 */
export async function generateTicketNo(db: Db): Promise<string> {
  const year = new Date().getFullYear();
  for (let i = 0; i < 12; i++) {
    const { rows } = await sql<{ n: string }>`select nextval('service_ticket_no_seq')::text as n`.execute(db);
    const candidate = `TCK-${year}-${String(rows[0].n).padStart(6, '0')}`;
    const clash = await db
      .selectFrom('service_tickets')
      .select('id')
      .where((eb) => eb.or([eb('ticket_no', '=', candidate), eb('ticket_number', '=', candidate)]))
      .executeTakeFirst();
    if (!clash) return candidate;
  }
  return `TCK-${year}-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
}

/* ---------------------------------------------------------------------- SLA -- */

const IST_OFFSET_MIN = 330;

/**
 * Adds working hours (Mon–Sat, startHour–endHour IST) to a moment. Used when an SLA rule says
 * `business_hours_only`; 24x7 rules (critical) just add wall-clock hours.
 */
export function addBusinessHours(from: Date, hours: number, startHour = 9, endHour = 18): Date {
  const toIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  const fromIst = (d: Date) => new Date(d.getTime() - IST_OFFSET_MIN * 60000);
  let cur = toIst(from); // fields read with getUTC*, these are IST wall-clock values
  let remaining = hours * 60; // minutes

  const isWorkDay = (d: Date) => d.getUTCDay() !== 0; // Sunday off
  const dayStart = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(startHour, 0, 0, 0);
    return x;
  };
  const dayEnd = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(endHour, 0, 0, 0);
    return x;
  };
  const nextDayStart = (d: Date) => {
    const x = dayStart(d);
    x.setUTCDate(x.getUTCDate() + 1);
    return x;
  };

  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    if (!isWorkDay(cur)) {
      cur = nextDayStart(cur);
      continue;
    }
    const s = dayStart(cur);
    const e = dayEnd(cur);
    if (cur < s) cur = s;
    if (cur >= e) {
      cur = nextDayStart(cur);
      continue;
    }
    const availableToday = (e.getTime() - cur.getTime()) / 60000;
    if (remaining <= availableToday) {
      cur = new Date(cur.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= availableToday;
      cur = nextDayStart(cur);
    }
  }
  return fromIst(cur);
}

export function normalizeWarranty(w: string | null | undefined): 'in_warranty' | 'out_of_warranty' | 'amc' {
  const s = String(w || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'amc' || s === 'under_amc') return 'amc';
  if (s === 'out_of_warranty' || s === 'billable') return 'out_of_warranty';
  return 'in_warranty'; // in_warranty, under_warranty, partial_coverage, unknown …
}

const FALLBACK_SLA: Record<string, [number, number, boolean]> = {
  critical: [2, 8, false],
  high: [4, 24, true],
  medium: [8, 48, true],
  low: [24, 72, true],
};

/** Response/resolution deadlines from the configurable `sla_rules` table (priority × coverage). */
export async function computeSla(
  db: Db,
  priority: string,
  warranty: string | null | undefined,
  from: Date = new Date(),
): Promise<{ responseDueAt: Date; resolutionDueAt: Date; responseHours: number; resolutionHours: number; businessHours: boolean }> {
  const p = FALLBACK_SLA[priority] ? priority : 'medium';
  const w = normalizeWarranty(warranty);
  const rule =
    (await db.selectFrom('sla_rules').selectAll().where('priority', '=', p).where('warranty_type', '=', w).executeTakeFirst()) ||
    (await db.selectFrom('sla_rules').selectAll().where('priority', '=', p).where('warranty_type', '=', 'in_warranty').executeTakeFirst());

  const [fbResp, fbRes, fbBiz] = FALLBACK_SLA[p];
  const responseHours = rule?.response_hours ?? fbResp;
  const resolutionHours = rule?.resolution_hours ?? fbRes;
  const businessHours = rule?.business_hours_only ?? fbBiz;

  const startHour = await getServiceSetting<number>(db, 'business_day_start_hour', 9);
  const endHour = await getServiceSetting<number>(db, 'business_day_end_hour', 18);
  const add = (h: number) =>
    businessHours ? addBusinessHours(from, h, startHour, endHour) : new Date(from.getTime() + h * 3600000);

  return { responseDueAt: add(responseHours), resolutionDueAt: add(resolutionHours), responseHours, resolutionHours, businessHours };
}

/* ---------------------------------------------------------------- repeats -- */

/**
 * Repeat complaint (§34): same organisation + same serial (or, when no serial, same product)
 * inside `repeat_complaint_window_days`. Returns the most recent prior ticket so the new one
 * can be linked through `parent_ticket_id`.
 */
export async function detectRepeatComplaint(
  db: Db,
  args: { organisationId: string; serial?: string | null; productId?: string | null; excludeId?: string; before?: Date },
): Promise<{ isRepeat: boolean; parentTicketId: string | null; priorCount: number; windowDays: number }> {
  const windowDays = await getServiceSetting<number>(db, 'repeat_complaint_window_days', 30);
  if (!args.serial && !args.productId) return { isRepeat: false, parentTicketId: null, priorCount: 0, windowDays };

  const since = new Date((args.before || new Date()).getTime() - windowDays * 86400000);
  let q = db
    .selectFrom('service_tickets')
    .select(['id', 'created_at'])
    .where('organisation_id', '=', args.organisationId)
    .where('deleted_at', 'is', null)
    .where('created_at', '>=', since)
    .where('status', '<>', 'cancelled');
  if (args.excludeId) q = q.where('id', '<>', args.excludeId);
  if (args.before) q = q.where('created_at', '<', args.before);
  if (args.serial) {
    q = q.where((eb) => eb.or([eb('equipment_serial', '=', args.serial!), eb('serial_number', '=', args.serial!)]));
  } else {
    q = q.where((eb) => eb.or([eb('product_id', '=', args.productId!), eb('equipment_id', '=', args.productId!)]));
  }
  const rows = await q.orderBy('created_at', 'desc').execute();
  return { isRepeat: rows.length > 0, parentTicketId: rows[0]?.id ?? null, priorCount: rows.length, windowDays };
}

/* ------------------------------------------------------------------ text -- */

/** Strips control characters and HTML tags; collapses whitespace. Output is plain text only. */
export function cleanText(input: unknown, max = 4000): string {
  return String(input ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}
