import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { addIsoDays, todayInKolkata } from '../../common/utils/ist-date.util.js';
import type {
  AuthUser,
  Database,
  PerformanceFigures,
  PerformanceGroupBy,
  SalesPerformanceDto,
  SalesPerformanceRow,
} from '@arihant/shared';
import {
  DEMO_DAY,
  LEAD_ACTIVE,
  PROPOSAL_ORG,
  PROPOSAL_OUTCOME_DAY,
  PROPOSAL_OWNER,
  TENDER_OWNER,
  TENDER_RESULT_DAY,
  TENDER_ROW,
  TENDER_SUBMITTED,
  TENDER_SUBMITTED_DAY,
  istDay,
} from './dashboard-metrics.js';

type Row = Record<string, any>;
type Cond = RawBuilder<unknown>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** A percentage, or null when there is nothing to divide by. */
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const TOTAL = '__total__';
const NO_REGION = 'none';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** People evaluated per salesperson (Blueprint §44: "sales reps and regional managers"). */
const EVALUATED_ROLES = ['sales', 'regional_manager'];
const TENDER_WON = ['won'];
const TENDER_LOST = ['lost'];

export interface SalesPerformanceQuery {
  from?: string;
  to?: string;
  group_by?: string;
  zone_id?: string;
  region_id?: string;
}

/**
 * Module 9 — Salesperson & Regional Performance (GET /dashboard/sales-performance).
 *
 * Attribution
 *  - Rep: lead / follow-up / visit → assigned_to; interaction → employee_id; demo → requested_by;
 *    proposal → coalesce(responsible_person_id, responsible_id, requested_by_id, requested_by) (the table carries four
 *    legacy owner columns); tender → anyone involved (salesperson_id, assigned_to, owner, tender_owner_id, created_by),
 *    the same set the rep's own "my bids" scope uses; contacts → contacts at organisations the rep holds a lead at or created.
 *  - Region: the record's own territory (customer organisation region, tender region), falling back to the owner's
 *    home region; records with neither land in a "No region" row (management, unfiltered only).
 *
 * Period (IST calendar days, default: current month)
 *  - leads: created_at; follow-ups done: completed_at (else due date); pending: open and due by the period end;
 *  - visits: planned_date; interactions: occurred_on; demos: confirmed_date, else requested_date, else created_at;
 *  - proposals sent: sent_date; converted: outcome_date (else updated_at); proposal follow-ups: contact_date
 *    (proposal_follow_ups — the table ProposalsService reads; proposal_followups is a legacy mirror);
 *  - tenders PQ / General-MHA: created_at; submitted: submission_date, else participated_date, else bid deadline;
 *    won / lost: result_date, else updated_at.
 *  - Not period-bound (snapshots): contacts, active leads.
 *
 * Totals count distinct records across the rows shown.
 */
@Injectable()
export class DashboardPerformanceService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async getSalesPerformance(user: AuthUser, query: SalesPerformanceQuery = {}): Promise<SalesPerformanceDto> {
    const { from, to } = this.period(query.from, query.to);
    const isAll = user.role === 'management' || user.role === 'admin';
    const isRm = user.role === 'regional_manager';
    const isSelf = !isAll && !isRm;
    const groupBy: PerformanceGroupBy = !isSelf && query.group_by === 'region' ? 'region' : 'rep';

    // ── Scope: zone / region the caller may look at ──
    const zones = await this.db.selectFrom('zones').select(['id', 'name', 'code']).orderBy('name', 'asc').execute();
    let zoneId: string | null = null;
    if (isAll) zoneId = query.zone_id && zones.some((z) => z.id === query.zone_id) ? query.zone_id : null;
    else if (isRm) zoneId = user.zone_id ?? null;

    let regionsQ = this.db.selectFrom('regions').select(['id', 'name', 'zone_id']).orderBy('name', 'asc');
    if (zoneId) regionsQ = regionsQ.where('zone_id', '=', zoneId);
    else if (isRm) regionsQ = regionsQ.where('id', '=', user.region_id ?? '00000000-0000-0000-0000-000000000000');
    const regions = isSelf ? [] : await regionsQ.execute();
    const regionId = !isSelf && query.region_id && regions.some((r) => r.id === query.region_id) ? query.region_id : null;

    // ── Rows to show ──
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    let rows: Omit<SalesPerformanceRow, keyof PerformanceFigures>[];
    if (groupBy === 'rep') {
      const people = isSelf
        ? sql`u.id = ${user.id}`
        : sql`u.is_active and u.role::text = any(${EVALUATED_ROLES}::text[])
              and ${isRm ? sql`(u.id = ${user.id} or u.reporting_manager_id = ${user.id} or (${zoneId}::uuid is not null and u.zone_id = ${zoneId}::uuid))` : zoneId ? sql`u.zone_id = ${zoneId}` : sql`true`}
              and ${regionId ? sql`u.region_id = ${regionId}` : sql`true`}`;
      const res = await sql<Row>`
        select u.id, u.full_name, u.role::text as role, r.name as region_name, z.name as zone_name
        from users u left join regions r on r.id = u.region_id left join zones z on z.id = coalesce(u.zone_id, r.zone_id)
        where ${people} order by u.full_name asc`.execute(this.db);
      rows = res.rows.map((r) => ({ key: r.id, label: r.full_name, role: r.role, region_name: r.region_name ?? null, zone_name: r.zone_name ?? null }));
    } else {
      rows = regions
        .filter((r) => !regionId || r.id === regionId)
        .map((r) => ({ key: r.id, label: r.name, role: null, region_name: r.name, zone_name: (r.zone_id && zoneName.get(r.zone_id)) || null }));
      if (isAll && !zoneId && !regionId) rows.push({ key: NO_REGION, label: 'No region', role: null, region_name: null, zone_name: null });
    }
    const keys = rows.map((r) => r.key);

    const figures = keys.length ? await this.figures(groupBy, keys, from, to) : new Map<string, PerformanceFigures>();
    const blank = this.blank();
    const out: SalesPerformanceRow[] = rows.map((r) => ({ ...r, ...(figures.get(r.key) ?? this.blank()) }));
    // the "No region" row only earns its place when something landed there
    const shown = out.filter((r) => r.key !== NO_REGION || this.hasData(r));

    return {
      group_by: groupBy,
      period: { from, to },
      filters: {
        zone_id: zoneId,
        region_id: regionId,
        can_pick_zone: isAll,
        can_pick_region: !isSelf,
        can_group_by_region: !isSelf,
        zones: isAll ? zones : zones.filter((z) => z.id === zoneId),
        regions,
      },
      rows: shown,
      totals: figures.get(TOTAL) ?? blank,
    };
  }

  /** Validated IST period; default the current calendar month. */
  private period(fromQ?: string, toQ?: string) {
    const today = todayInKolkata();
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonth = addIsoDays(monthStart, 32).slice(0, 7);
    const monthEnd = addIsoDays(`${nextMonth}-01`, -1);
    const valid = (d?: string) => !!d && ISO_DATE.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
    if ((fromQ && !valid(fromQ)) || (toQ && !valid(toQ))) throw new BadRequestException('from / to must be YYYY-MM-DD dates');
    const from = fromQ || (toQ ? `${toQ.slice(0, 7)}-01` : monthStart);
    const to = toQ || (fromQ ? (fromQ > monthEnd ? fromQ : monthEnd) : monthEnd);
    if (from > to) throw new BadRequestException('from must be on or before to');
    return { from, to };
  }

  private blank(): PerformanceFigures {
    return {
      lead: { contacts: 0, new: 0, active: 0, reapproached: 0, followups_done: 0, followups_pending: 0, converted: 0, conversion_rate: null },
      visit: { planned: 0, completed: 0, cancelled: 0, interactions: 0 },
      demo: { planned: 0, completed: 0, successful: 0, failure_reasons: {} },
      proposal: { sent: 0, followups: 0, converted: 0 },
      tender: { pq: 0, general_mha: 0, submitted: 0, won: 0, lost: 0, win_rate: null },
    };
  }

  private hasData(f: PerformanceFigures) {
    const vals = [
      ...Object.values(f.lead), ...Object.values(f.visit), f.demo.planned, f.demo.completed,
      ...Object.values(f.proposal), f.tender.pq, f.tender.general_mha, f.tender.submitted, f.tender.won, f.tender.lost,
    ];
    return vals.some((v) => typeof v === 'number' && v > 0);
  }

  /**
   * `src` selects `key` plus per-record columns; rows outside `keys` are dropped. Returns one aggregate row per key plus
   * the distinct-record total under TOTAL.
   */
  private async agg(src: Cond, keys: string[], aggs: Cond): Promise<Map<string, Row>> {
    const res = await sql<Row>`
      select grouping(s.key) as g, s.key, ${aggs}
      from (${src}) s where s.key = any(${keys}::text[])
      group by grouping sets ((s.key), ())`.execute(this.db);
    return new Map(res.rows.map((r) => [num(r.g) === 1 ? TOTAL : String(r.key), r]));
  }

  private async figures(groupBy: PerformanceGroupBy, keys: string[], from: string, to: string) {
    const inP = (day: Cond) => sql`${day} between ${from}::date and ${to}::date`;
    /** Group key of a record: its owner (rep), or its territory falling back to the owner's home region (ow). */
    const key = (owner: Cond, region: Cond) =>
      groupBy === 'rep' ? sql`${owner}::text` : sql`coalesce(${region}::text, ow.region_id::text, ${NO_REGION})`;

    const proposalOwner = PROPOSAL_OWNER;
    const proposalOrg = PROPOSAL_ORG;
    const demoDay = DEMO_DAY;
    const tenderOwner = TENDER_OWNER;
    const tenderPeople = sql`array[t.salesperson_id, t.assigned_to, t.owner, t.tender_owner_id, t.created_by]`;

    const [leads, followups, contacts, visits, interactions, demos, reasons, proposals, propFollowups, tenders] = await Promise.all([
      this.agg(
        sql`select ${key(sql`l.assigned_to`, sql`o.region_id`)} as key, l.id,
                   ${inP(istDay(sql`l.created_at`))} as created,
                   coalesce(l.lead_type, 'fresh') = 're_approached' as reap,
                   lower(coalesce(l.lead_status, l.status, '')) in ('converted', 'won') as conv,
                   ${LEAD_ACTIVE} as active
            from leads l left join organisations o on o.id = l.organisation_id left join users ow on ow.id = l.assigned_to`,
        keys,
        sql`count(distinct s.id) filter (where s.created and not s.reap)::int as new,
            count(distinct s.id) filter (where s.created and s.reap)::int as reap,
            count(distinct s.id) filter (where s.created)::int as created,
            count(distinct s.id) filter (where s.created and s.conv)::int as conv,
            count(distinct s.id) filter (where s.active)::int as active`,
      ),
      this.agg(
        sql`select ${key(sql`f.assigned_to`, sql`o.region_id`)} as key, f.id,
                   f.status = 'completed' and ${inP(sql`coalesce(${istDay(sql`f.completed_at`)}, f.due_date)`)} as done,
                   f.status = 'pending' and f.due_date <= ${to}::date as pending
            from follow_ups f left join organisations o on o.id = f.organisation_id left join users ow on ow.id = f.assigned_to`,
        keys,
        sql`count(distinct s.id) filter (where s.done)::int as done, count(distinct s.id) filter (where s.pending)::int as pending`,
      ),
      this.agg(
        groupBy === 'rep'
          ? sql`select k.uid::text as key, c.id from contacts c join organisations o on o.id = c.organisation_id
                cross join lateral (select l.assigned_to as uid from leads l where l.organisation_id = o.id
                                    union select o.created_by) k`
          : sql`select ${key(sql`null::uuid`, sql`o.region_id`)} as key, c.id from contacts c
                join organisations o on o.id = c.organisation_id left join users ow on ow.id = o.created_by`,
        keys,
        sql`count(distinct s.id)::int as contacts`,
      ),
      this.agg(
        sql`select ${key(sql`v.assigned_to`, sql`o.region_id`)} as key, v.id, v.status
            from visits v left join organisations o on o.id = v.organisation_id left join users ow on ow.id = v.assigned_to
            where ${inP(sql`v.planned_date`)}`,
        keys,
        sql`count(distinct s.id)::int as planned,
            count(distinct s.id) filter (where s.status = 'completed')::int as completed,
            count(distinct s.id) filter (where s.status = 'cancelled')::int as cancelled`,
      ),
      this.agg(
        sql`select ${key(sql`i.employee_id`, sql`o.region_id`)} as key, i.id
            from interactions i left join organisations o on o.id = i.organisation_id left join users ow on ow.id = i.employee_id
            where ${inP(sql`coalesce(i.occurred_on, ${istDay(sql`i.created_at`)})`)}`,
        keys,
        sql`count(distinct s.id)::int as interactions`,
      ),
      this.agg(
        sql`select ${key(sql`d.requested_by`, sql`o.region_id`)} as key, d.id, d.status, oc.result
            from demos d left join organisations o on o.id = d.organisation_id left join users ow on ow.id = d.requested_by
            left join lateral (select x.result from demo_outcomes x where x.demo_id = d.id order by x.created_at desc limit 1) oc on true
            where d.status <> 'cancelled' and ${inP(demoDay)}`,
        keys,
        sql`count(distinct s.id)::int as planned,
            count(distinct s.id) filter (where s.status = 'completed')::int as completed,
            count(distinct s.id) filter (where s.status = 'completed' and s.result = 'success')::int as successful`,
      ),
      // failure reasons: (key, reason) and (reason) for the totals
      sql<Row>`
        select grouping(s.key) as g, s.key, s.reason, count(distinct s.id)::int as c
        from (select ${key(sql`d.requested_by`, sql`o.region_id`)} as key, d.id, coalesce(oc.failure_reason, 'UNSPECIFIED') as reason
              from demos d left join organisations o on o.id = d.organisation_id left join users ow on ow.id = d.requested_by
              join lateral (select x.result, x.failure_reason from demo_outcomes x where x.demo_id = d.id order by x.created_at desc limit 1) oc on true
              where d.status <> 'cancelled' and oc.result in ('fail', 'partial') and ${inP(demoDay)}) s
        where s.key = any(${keys}::text[])
        group by grouping sets ((s.key, s.reason), (s.reason))`.execute(this.db),
      this.agg(
        sql`select ${key(proposalOwner, sql`o.region_id`)} as key, p.id,
                   p.sent_date is not null and ${inP(sql`p.sent_date`)} as sent,
                   upper(p.status) = 'CONVERTED' and ${inP(PROPOSAL_OUTCOME_DAY)} as conv
            from proposals p left join organisations o on o.id = ${proposalOrg} left join users ow on ow.id = ${proposalOwner}
            where coalesce(p.is_deleted, false) = false`,
        keys,
        sql`count(distinct s.id) filter (where s.sent)::int as sent, count(distinct s.id) filter (where s.conv)::int as conv`,
      ),
      this.agg(
        sql`select ${key(proposalOwner, sql`o.region_id`)} as key, pf.id
            from proposal_follow_ups pf join proposals p on p.id = pf.proposal_id
            left join organisations o on o.id = ${proposalOrg} left join users ow on ow.id = ${proposalOwner}
            where coalesce(p.is_deleted, false) = false and ${inP(sql`coalesce(pf.contact_date, ${istDay(sql`pf.created_at`)})`)}`,
        keys,
        sql`count(distinct s.id)::int as followups`,
      ),
      this.agg(
        sql`select ${groupBy === 'rep' ? sql`k.uid::text` : key(sql`null::uuid`, sql`t.region_id`)} as key, t.id,
                   ${inP(istDay(sql`t.created_at`))} as created, t.category::text as category,
                   t.status = any(${TENDER_SUBMITTED}::text[])
                     and ${inP(TENDER_SUBMITTED_DAY)} as submitted,
                   ${inP(TENDER_RESULT_DAY)} as decided, t.status
            from tenders t left join users ow on ow.id = ${tenderOwner}
            ${groupBy === 'rep' ? sql`cross join lateral (select distinct x as uid from unnest(${tenderPeople}) x where x is not null) k` : sql``}
            where ${TENDER_ROW}`,
        keys,
        sql`count(distinct s.id) filter (where s.created and s.category = 'pq')::int as pq,
            count(distinct s.id) filter (where s.created and s.category = 'general_mha')::int as general_mha,
            count(distinct s.id) filter (where s.submitted)::int as submitted,
            count(distinct s.id) filter (where s.decided and s.status = any(${TENDER_WON}::text[]))::int as won,
            count(distinct s.id) filter (where s.decided and s.status = any(${TENDER_LOST}::text[]))::int as lost`,
      ),
    ]);

    const reasonsBy = new Map<string, Record<string, number>>();
    for (const r of reasons.rows) {
      const k = num(r.g) === 1 ? TOTAL : String(r.key);
      const bucket = reasonsBy.get(k) ?? {};
      bucket[String(r.reason)] = num(r.c);
      reasonsBy.set(k, bucket);
    }

    const result = new Map<string, PerformanceFigures>();
    for (const k of [...keys, TOTAL]) {
      const l = leads.get(k) ?? {};
      const created = num(l.created);
      const conv = num(l.conv);
      const t = tenders.get(k) ?? {};
      const won = num(t.won);
      const lost = num(t.lost);
      const v = visits.get(k) ?? {};
      const d = demos.get(k) ?? {};
      const p = proposals.get(k) ?? {};
      result.set(k, {
        lead: {
          contacts: num(contacts.get(k)?.contacts),
          new: num(l.new),
          active: num(l.active),
          reapproached: num(l.reap),
          followups_done: num(followups.get(k)?.done),
          followups_pending: num(followups.get(k)?.pending),
          converted: conv,
          conversion_rate: rate(conv, created),
        },
        visit: { planned: num(v.planned), completed: num(v.completed), cancelled: num(v.cancelled), interactions: num(interactions.get(k)?.interactions) },
        demo: { planned: num(d.planned), completed: num(d.completed), successful: num(d.successful), failure_reasons: reasonsBy.get(k) ?? {} },
        proposal: { sent: num(p.sent), followups: num(propFollowups.get(k)?.followups), converted: num(p.conv) },
        tender: { pq: num(t.pq), general_mha: num(t.general_mha), submitted: num(t.submitted), won, lost, win_rate: rate(won, won + lost) },
      });
    }
    return result;
  }
}
