import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import {
  SECURITY_STATE_STATUSES,
  type AuthUser,
  type Database,
  type SecurityKind,
  type SecurityRegisterDto,
  type SecurityRegisterRow,
  type SecurityState,
} from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { todayInKolkata } from '../../common/utils/ist-date.util.js';
import { TENDER_OWNER, TENDER_ROW, territoryTenders } from '../dashboard/dashboard-metrics.js';
import { num, resolveTerritory } from './report-scope.js';

type Row = Record<string, any>;

const STATES = Object.keys(SECURITY_STATE_STATUSES) as SecurityState[];
const KIND_TYPES: Record<SecurityKind, string[]> = { emd: ['EMD'], performance: ['PBG', 'Security Deposit'] };
/** Statuses where the money is out and an expiry still matters. */
const LIVE = [...SECURITY_STATE_STATUSES.held, ...SECURITY_STATE_STATUSES.refund_due];
const EXPIRY_WINDOW_DAYS = 30;
const MAX_LIMIT = 2000;

const STATE_OF = sql<SecurityState>`case
  ${sql.join(
    STATES.map((s) => sql`when i.status = any(${SECURITY_STATE_STATUSES[s] as string[]}::text[]) then ${s}`),
    sql` `,
  )}
  else 'pending' end`;

/**
 * Report 6 — EMD & performance security register (GET /reports/securities): every EMD, PBG and security deposit
 * recorded on a tender, with where the money is, its expiry and the bid / contract it belongs to — the MIS sheet's
 * "EMD" and "Performance security" registers. Scope is the tender's (territoryTenders), as on the MIS report.
 *
 * Query: kind (emd | performance), state (pending | held | refund_due | returned | closed), expiring=1 (held or refund
 * due, expiring within 30 days or already expired), zone_id, region_id, search, page, limit (max 2000, for export).
 */
@Injectable()
export class SecurityRegisterService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async report(user: AuthUser, q: Record<string, unknown>): Promise<SecurityRegisterDto> {
    const kind: SecurityKind = q.kind === 'performance' ? 'performance' : 'emd';
    const state = STATES.includes(q.state as SecurityState) ? (q.state as SecurityState) : null;
    const expiringOnly = q.expiring === '1' || q.expiring === 'true';
    const search = typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '';
    const limit = Math.min(Math.max(Math.trunc(num(q.limit)) || 25, 1), MAX_LIMIT);
    const page = Math.max(Math.trunc(num(q.page)) || 1, 1);
    const { territory, filters } = await resolveTerritory(this.db, user, q.zone_id, q.region_id);
    const today = todayInKolkata();

    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const searchCond = search
      ? sql`(t.tender_no ilike ${like} or t.tender_title ilike ${like} or o.name ilike ${like} or t.department ilike ${like}
          or i.reference_number ilike ${like} or i.bank ilike ${like} or pr.name ilike ${like})`
      : sql`true`;
    const expiring = sql`i.status = any(${LIVE}::text[]) and i.expiry_date is not null and i.expiry_date <= ${today}::date + ${EXPIRY_WINDOW_DAYS}`;
    const from = sql`
      from tender_financial_instruments i
      join tenders t on t.id = i.tender_id
      left join organisations o on o.id = t.organisation_id
      left join products pr on pr.id = t.product_id
      left join users ow on ow.id = ${TENDER_OWNER}`;
    // Everything but the state / expiring filters: what the summary counts.
    const base = sql`${TENDER_ROW} and ${territoryTenders(territory)} and i.instrument_type = any(${KIND_TYPES[kind]}::text[]) and ${searchCond}`;
    const narrowed = sql`${base}
      and ${state ? sql`i.status = any(${SECURITY_STATE_STATUSES[state] as string[]}::text[])` : sql`true`}
      and ${expiringOnly ? expiring : sql`true`}`;

    const [summary, expiringTotal, count, list] = await Promise.all([
      sql<Row>`select ${STATE_OF} as state, count(*)::int as c, coalesce(sum(greatest(coalesce(i.amount, 0), 0)), 0)::float as amount
        ${from} where ${base} group by 1`.execute(this.db),
      sql<Row>`select count(*)::int as c, coalesce(sum(greatest(coalesce(i.amount, 0), 0)), 0)::float as amount ${from} where ${base} and ${expiring}`.execute(this.db),
      sql<Row>`select count(*)::int as c ${from} where ${narrowed}`.execute(this.db),
      sql<Row>`
        select i.id, i.tender_id, i.instrument_type, i.status, ${STATE_OF} as state, i.amount, i.mode, i.bank, i.reference_number,
               i.issue_date::text as issue_date, i.expiry_date::text as expiry_date,
               (i.expiry_date - ${today}::date)::int as days_to_expiry, i.remarks,
               t.tender_no, t.tender_title, t.status::text as tender_status,
               coalesce(t.submission_date, (t.bid_closing_date at time zone 'Asia/Kolkata')::date)::text as bid_date,
               coalesce(r.po_number, r.order_number, r.loa_number) as contract_no, r.loa_date::text as contract_date,
               o.name as customer, coalesce(nullif(trim(t.department), ''), o.department) as department,
               coalesce(nullif(trim(o.state), ''), t.state) as state_name, z.name as zone_name,
               pr.name as item, t.quantity, ow.full_name as owner_name, fo.full_name as finance_owner_name
        ${from}
        left join lateral (
          select x.po_number, x.order_number, x.loa_number, x.loa_date from tender_results x where x.tender_id = t.id order by x.created_at desc limit 1
        ) r on true
        left join zones z on z.id = coalesce(t.zone_id, o.zone_id)
        left join users fo on fo.id = i.finance_owner_id
        where ${narrowed}
        order by (i.status = any(${LIVE}::text[])) desc, i.expiry_date asc nulls last, i.created_at desc
        limit ${limit} offset ${(page - 1) * limit}`.execute(this.db),
    ]);

    const byState = Object.fromEntries(STATES.map((s) => [s, { count: 0, amount: 0 }])) as SecurityRegisterDto['by_state'];
    for (const r of summary.rows) byState[r.state as SecurityState] = { count: num(r.c), amount: Math.round(num(r.amount)) };
    const total = num(count.rows[0]?.c);

    return {
      kind,
      state,
      filters,
      by_state: byState,
      expiring: { count: num(expiringTotal.rows[0]?.c), amount: Math.round(num(expiringTotal.rows[0]?.amount)) },
      data: list.rows.map(
        (r): SecurityRegisterRow => ({
          ...(r as SecurityRegisterRow),
          amount: r.amount === null ? null : num(r.amount),
          quantity: r.quantity === null ? null : num(r.quantity),
          days_to_expiry: r.days_to_expiry === null ? null : num(r.days_to_expiry),
        }),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      generated_at: new Date().toISOString(),
    };
  }
}
