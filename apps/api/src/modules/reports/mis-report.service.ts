import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { SERVICE_DONE_STATUSES, type AuthUser, type Database, type MisFigures, type MisGroupBy, type MisReportDto, type MisRow } from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import {
  PROPOSAL_ORG,
  PROPOSAL_OUTCOME_DAY,
  PROPOSAL_OWNER,
  TENDER_OWNER,
  TENDER_RESULT_DAY,
  TENDER_ROW,
  TENDER_SUBMITTED,
  TENDER_SUBMITTED_DAY,
  istDay,
  territoryTenders,
} from '../dashboard/dashboard-metrics.js';
import { ServiceService } from '../service/service.service.js';
import { isNational, num, parseReportPeriod, pct, resolveTerritory, territoryOwned } from './report-scope.js';

type Cond = RawBuilder<unknown>;
type Row = Record<string, any>;

const TOTAL = '__total__';
const NONE = 'none';
const GROUPS: MisGroupBy[] = ['zone', 'person', 'state', 'product'];

const TENDER_VALUE = sql`greatest(coalesce(t.tender_value, t.estimated_value, 0), 0)`;
const UNDER_EVALUATION = ['technical_eval', 'commercial_eval'];
const RESULT_AWAITED = ['submitted', 'pq_submitted'];
const DELIVERY_PENDING = ['scheduled', 'dispatched', 'in_transit'];
/** Money out of the company and not back yet (SECURITY_STATE_STATUSES held + refund_due). */
const MONEY_HELD = ['Issued', 'Submitted', 'Refund Due'];
/** A customer's state as typed, folded to one spelling per case / spacing. */
const stateKey = (col: Cond) => sql`nullif(lower(trim(${col})), '')`;

/**
 * Report 5 — Business MIS (GET /reports/mis): the management MIS sheet's zone-wise, person-wise, state-wise and
 * product-wise tables, counted from tenders, proposals, deliveries, service tickets, follow-ups and the tenders'
 * EMD / performance-security instruments. Invoices and payments live in Tally (Blueprint §3), so they are not here.
 *
 * Each record counts once, under one key, so rows add up to the total:
 *  - zone: the record's own zone (tender tag, customer, ticket region), else its owner's home zone;
 *  - person: tender salesperson / owner, proposal responsible person, the linked order's owner for a delivery, the
 *    assigned engineer for a service case, the assignee for a follow-up;
 *  - state: the customer's state, else the tender's own;
 *  - product: the record's product.
 * Territory scope is the Sales pipeline report's for tenders, proposals, deliveries and follow-ups and the Service
 * Desk's own for tickets, so a figure here matches those reports for the same filters.
 */
@Injectable()
export class MisReportService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly service: ServiceService,
  ) {}

  async report(user: AuthUser, q: Record<string, unknown>): Promise<MisReportDto> {
    const period = parseReportPeriod(q.from, q.to);
    const groupBy: MisGroupBy = GROUPS.includes(q.group_by as MisGroupBy) ? (q.group_by as MisGroupBy) : 'zone';
    const { territory, filters } = await resolveTerritory(this.db, user, q.zone_id, q.region_id);
    const { from, to } = period;
    const inP = (day: Cond) => sql`${day} between ${from}::date and ${to}::date`;

    /** Breakdown key of a record (ow = its owner, whose home zone stands in when the record has none). */
    const key = (owner: Cond, zone: Cond, state: Cond, product: Cond) =>
      groupBy === 'person'
        ? sql`coalesce(${owner}::text, ${NONE})`
        : groupBy === 'state'
          ? sql`coalesce(${stateKey(state)}, ${NONE})`
          : groupBy === 'product'
            ? sql`coalesce(${product}::text, ${NONE})`
            : sql`coalesce(${zone}::text, ow.zone_id::text, ${NONE})`;

    const tenders = sql`
      select ${key(TENDER_OWNER, sql`t.zone_id`, sql`coalesce(nullif(trim(o.state), ''), t.state)`, sql`t.product_id`)} as key,
             t.status as st, ${TENDER_VALUE} as value, greatest(coalesce(t.quantity, 0), 0) as qty,
             ${inP(istDay(sql`t.created_at`))} as created,
             t.status = any(${TENDER_SUBMITTED}::text[]) and ${inP(TENDER_SUBMITTED_DAY)} as submitted,
             ${inP(TENDER_RESULT_DAY)} as decided,
             coalesce(nullif(r.awarded_value, 0), ${TENDER_VALUE}) as order_value
      from tenders t left join organisations o on o.id = t.organisation_id left join users ow on ow.id = ${TENDER_OWNER}
      left join lateral (select x.awarded_value from tender_results x where x.tender_id = t.id order by x.created_at desc limit 1) r on true
      where ${TENDER_ROW} and ${territoryTenders(territory)}`;
    // Proposals converted to a purchase order in the period (the other way an order arrives besides a won bid).
    const proposals = sql`
      select ${key(PROPOSAL_OWNER, sql`o.zone_id`, sql`o.state`, sql`p.product_id`)} as key,
             greatest(coalesce(p.quoted_value, 0), 0) as value
      from proposals p left join organisations o on o.id = ${PROPOSAL_ORG} left join users ow on ow.id = ${PROPOSAL_OWNER}
      where coalesce(p.is_deleted, false) = false and upper(coalesce(p.status, '')) = 'CONVERTED'
        and ${inP(PROPOSAL_OUTCOME_DAY)} and ${territoryOwned(territory, PROPOSAL_OWNER)}`;
    const deliveryOwner = sql`coalesce(${TENDER_OWNER}, ${PROPOSAL_OWNER}, d.assigned_to)`;
    const deliveries = sql`
      select ${key(deliveryOwner, sql`o.zone_id`, sql`o.state`, sql`d.product_id`)} as key
      from deliveries d left join organisations o on o.id = d.organisation_id
      left join tenders t on t.id = d.tender_id left join proposals p on p.id = d.proposal_id
      left join users ow on ow.id = ${deliveryOwner}
      where d.status::text = any(${DELIVERY_PENDING}::text[]) and ${territoryOwned(territory, deliveryOwner)}`;
    const followUps = sql`
      select ${key(sql`f.assigned_to`, sql`o.zone_id`, sql`o.state`, sql`l.product_id`)} as key
      from follow_ups f left join organisations o on o.id = f.organisation_id left join leads l on l.id = f.lead_id
      left join users ow on ow.id = f.assigned_to
      where f.status = 'pending' and ${territoryOwned(territory, sql`f.assigned_to`)}`;
    const money = sql`
      select ${key(TENDER_OWNER, sql`t.zone_id`, sql`coalesce(nullif(trim(o.state), ''), t.state)`, sql`t.product_id`)} as key,
             i.instrument_type as type, i.status, greatest(coalesce(i.amount, 0), 0) as amount
      from tender_financial_instruments i join tenders t on t.id = i.tender_id
      left join organisations o on o.id = t.organisation_id left join users ow on ow.id = ${TENDER_OWNER}
      where ${TENDER_ROW} and ${territoryTenders(territory)} and i.status = any(${MONEY_HELD}::text[])`;

    const [tenderBy, proposalBy, deliveryBy, serviceBy, followBy, moneyBy] = await Promise.all([
      this.byKey(tenders, sql`
        count(*) filter (where s.created)::int as total,
        coalesce(sum(s.value) filter (where s.created), 0)::float as value,
        coalesce(sum(s.qty) filter (where s.created), 0)::float as qty,
        count(*) filter (where s.submitted)::int as submitted,
        count(*) filter (where s.st = any(${UNDER_EVALUATION}::text[]))::int as evaluating,
        count(*) filter (where s.st = any(${RESULT_AWAITED}::text[]))::int as awaited,
        count(*) filter (where s.decided and s.st = 'won')::int as won,
        count(*) filter (where s.decided and s.st = 'lost')::int as lost,
        coalesce(sum(s.order_value) filter (where s.decided and s.st = 'won'), 0)::float as won_value`),
      this.byKey(proposals, sql`count(*)::int as orders, coalesce(sum(s.value), 0)::float as value`),
      this.byKey(deliveries, sql`count(*)::int as pending`),
      this.byKey(this.serviceCases(user, filters, key, inP), sql`
        count(*) filter (where s.open)::int as open,
        count(*) filter (where s.closed_in)::int as closed`),
      this.byKey(followUps, sql`count(*)::int as pending`),
      this.byKey(money, sql`
        coalesce(sum(s.amount) filter (where s.type = 'EMD'), 0)::float as emd,
        coalesce(sum(s.amount) filter (where s.type = 'EMD' and s.status = 'Refund Due'), 0)::float as emd_due,
        coalesce(sum(s.amount) filter (where s.type in ('PBG', 'Security Deposit')), 0)::float as security`),
    ]);

    const figures = (k: string): MisFigures => {
      const t = tenderBy.get(k) ?? {};
      const p = proposalBy.get(k) ?? {};
      const m = moneyBy.get(k) ?? {};
      return {
        tenders_total: num(t.total),
        tenders_submitted: num(t.submitted),
        tenders_under_evaluation: num(t.evaluating),
        tenders_result_awaited: num(t.awaited),
        tenders_won: num(t.won),
        tenders_lost: num(t.lost),
        win_rate: pct(num(t.won), num(t.won) + num(t.lost)),
        tender_value: Math.round(num(t.value)),
        tender_quantity: num(t.qty),
        orders: num(t.won) + num(p.orders),
        order_value: Math.round(num(t.won_value) + num(p.value)),
        pending_deliveries: num(deliveryBy.get(k)?.pending),
        open_service_cases: num(serviceBy.get(k)?.open),
        closed_service_cases: num(serviceBy.get(k)?.closed),
        pending_follow_ups: num(followBy.get(k)?.pending),
        emd_blocked: Math.round(num(m.emd)),
        emd_refund_due: Math.round(num(m.emd_due)),
        security_held: Math.round(num(m.security)),
      };
    };

    const dataKeys = new Set<string>();
    for (const map of [tenderBy, proposalBy, deliveryBy, serviceBy, followBy, moneyBy]) for (const k of map.keys()) if (k !== TOTAL) dataKeys.add(k);
    const heads = await this.heads(groupBy, filters, territory.managerId ?? null, dataKeys);
    const rows = [...heads.values()]
      .map((h) => ({ ...h, ...figures(h.key) }))
      .sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.label.localeCompare(b.label)));
    const totalLabel = { zone: 'All zones', person: 'Everyone', state: 'All states', product: 'All products' }[groupBy];

    return {
      period,
      group_by: groupBy,
      filters,
      rows,
      totals: { key: TOTAL, label: totalLabel, sub: null, ...figures(TOTAL) },
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Service cases in the Service Desk's own scope (ServiceService.scopeWhere) and the picked zone / region — the
   * Service report's rule, so open and closed counts match it. Closed = status closed with closed_at in the period.
   */
  private serviceCases(
    user: AuthUser,
    filters: MisReportDto['filters'],
    key: (owner: Cond, zone: Cond, state: Cond, product: Cond) => Cond,
    inP: (day: Cond) => Cond,
  ): Cond {
    let base = this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'organisations.id', 'service_tickets.organisation_id')
      .leftJoin('regions as tr', 'tr.id', 'service_tickets.region_id')
      .leftJoin('users as ow', 'ow.id', 'service_tickets.assigned_to')
      .where('service_tickets.deleted_at', 'is', null);
    const scope = this.service.scopeWhere(user);
    if (scope) base = base.where(scope as any);
    if (isNational(user) && filters.zone_id) base = base.where(sql<boolean>`(organisations.zone_id = ${filters.zone_id} or tr.zone_id = ${filters.zone_id})`);
    if (filters.region_id) base = base.where(sql<boolean>`(organisations.region_id = ${filters.region_id} or service_tickets.region_id = ${filters.region_id})`);
    const records = base.select([
      sql<string>`${key(sql`service_tickets.assigned_to`, sql`coalesce(organisations.zone_id, tr.zone_id)`, sql`organisations.state`, sql`service_tickets.product_id`)}`.as('key'),
      sql<boolean>`service_tickets.status <> all(${SERVICE_DONE_STATUSES as string[]}::text[])`.as('open'),
      sql<boolean>`service_tickets.status = 'closed' and service_tickets.closed_at is not null and ${inP(istDay(sql`service_tickets.closed_at`))}`.as('closed_in'),
    ]);
    return sql`${records}`;
  }

  /** Aggregates per key plus a grand total (under TOTAL). */
  private async byKey(src: Cond, aggs: Cond): Promise<Map<string, Row>> {
    const res = await sql<Row>`
      select grouping(s.key) as g, s.key, ${aggs}
      from (${src}) s group by grouping sets ((s.key), ())`.execute(this.db);
    return new Map(res.rows.map((r) => [num(r.g) === 1 ? TOTAL : String(r.key), r]));
  }

  /**
   * The rows to show: every zone in scope, the active sales people in scope, or every product — so a quiet one is
   * visible — plus whatever else records landed on, and a "none" row last when something had no zone / owner / state /
   * product.
   */
  private async heads(groupBy: MisGroupBy, filters: MisReportDto['filters'], managerId: string | null, dataKeys: Set<string>) {
    type Head = Pick<MisRow, 'key' | 'label' | 'sub'>;
    const heads = new Map<string, Head>();
    const none: Record<MisGroupBy, string> = { zone: 'No zone', person: 'Unassigned', state: 'State not recorded', product: 'No product' };
    const ids = [...dataKeys].filter((k) => k !== NONE);

    if (groupBy === 'zone') {
      const zones = await this.db.selectFrom('zones').select(['id', 'name']).execute();
      const zoneName = new Map(zones.map((z) => [z.id, z.name]));
      for (const z of filters.zones) heads.set(z.id, { key: z.id, label: z.name, sub: null });
      for (const k of ids) if (!heads.has(k)) heads.set(k, { key: k, label: zoneName.get(k) ?? none.zone, sub: null });
    } else if (groupBy === 'person') {
      const people = sql`u.is_active and u.role::text in ('sales', 'regional_manager')
        and ${filters.zone_id ? sql`u.zone_id = ${filters.zone_id}` : sql`true`}
        and ${filters.region_id ? sql`u.region_id = ${filters.region_id}` : sql`true`}
        and ${managerId ? sql`(u.id = ${managerId} or u.reporting_manager_id = ${managerId} or u.zone_id = ${filters.zone_id})` : sql`true`}`;
      const res = await sql<Row>`
        select u.id, u.full_name, r.name as region_name, z.name as zone_name
        from users u left join regions r on r.id = u.region_id left join zones z on z.id = coalesce(u.zone_id, r.zone_id)
        where (${people}) or u.id::text = any(${ids}::text[])`.execute(this.db);
      for (const u of res.rows) {
        heads.set(String(u.id), { key: String(u.id), label: u.full_name, sub: [u.region_name, u.zone_name].filter(Boolean).join(' · ') || null });
      }
    } else if (groupBy === 'state') {
      for (const k of ids) heads.set(k, { key: k, label: k.replace(/(^|[\s/(-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()), sub: null });
    } else {
      const products = await this.db.selectFrom('products').select(['id', 'name', 'category']).execute();
      for (const p of products) heads.set(p.id, { key: p.id, label: p.name, sub: p.category || null });
      for (const k of ids) if (!heads.has(k)) heads.set(k, { key: k, label: none.product, sub: null });
    }
    if (dataKeys.has(NONE)) heads.set(NONE, { key: NONE, label: none[groupBy], sub: null });
    return heads;
  }
}
