import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import {
  SERVICE_DONE_STATUSES,
  SERVICE_SLA_PAUSE_STATUSES,
  type AuthUser,
  type Database,
  type ServiceBreakdownRow,
  type ServiceReportDto,
  type ServiceReportGroupBy,
  type ServiceTrendPoint,
} from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { todayInKolkata } from '../../common/utils/ist-date.util.js';
import { istDay } from '../dashboard/dashboard-metrics.js';
import { ServiceService } from '../service/service.service.js';
import { getServiceSetting, TICKET_CLOSURE_SECONDS, TICKET_RECEIVED_AT } from '../service/service.core.js';
import { isNational, num, parseReportPeriod, pct, rate, resolveTerritory } from './report-scope.js';

type Cond = RawBuilder<unknown>;
type Row = Record<string, any>;

const TOTAL = '__total__';
const NONE = 'none';
const DONE = SERVICE_DONE_STATUSES as string[];
const PAUSED = SERVICE_SLA_PAUSE_STATUSES as string[];
const WORK_DONE = ['resolved', 'report_submitted', 'closed'];
/** Service Desk stage groups (TICKET_STAGES in ServiceService), legacy aliases included. */
const NEW_STATUSES = ['received', 'new', 'created'];
const ESCALATED_STATUSES = ['escalated', 'revisit_required', 'revisit', 'reopened'];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

const days = (v: unknown) => (v === null || v === undefined ? null : Math.round(num(v) * 10) / 10);
const sentence = (code: string) => {
  const t = code.replace(/_/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Report 2 — Service closure time & repeat complaints (GET /reports/service, Blueprint §34).
 *
 * Scope is the Service Desk's own territory rule (ServiceService.scopeWhere), so a regional manager sees exactly the
 * tickets their desk shows; national roles may narrow to a zone / region (customer's territory or the ticket's own).
 * Snapshot figures use the desk's tile definitions; period figures use the complaint-received day (received_date,
 * else when logged) for intake and the IST closing day for closures. Closure time = received → closed (TICKET_CLOSURE_SECONDS,
 * the same rule as the desk's "average closure time").
 */
@Injectable()
export class ServiceReportService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly service: ServiceService,
  ) {}

  async report(user: AuthUser, q: Record<string, unknown>): Promise<ServiceReportDto> {
    const period = parseReportPeriod(q.from, q.to);
    const groupBy: ServiceReportGroupBy = q.group_by === 'region' || q.group_by === 'zone' || q.group_by === 'priority' ? q.group_by : 'engineer';
    const { filters } = await resolveTerritory(this.db, user, q.zone_id, q.region_id);
    const { from, to } = period;
    const today = todayInKolkata();
    const inP = (day: Cond) => sql`${day} between ${from}::date and ${to}::date`;

    const key =
      groupBy === 'engineer'
        ? sql`coalesce(service_tickets.assigned_to::text, ${NONE})`
        : groupBy === 'region'
          ? sql`coalesce(service_tickets.region_id::text, organisations.region_id::text, ${NONE})`
          : groupBy === 'zone'
            ? sql`coalesce(organisations.zone_id::text, tr.zone_id::text, ${NONE})`
            : sql`coalesce(service_tickets.priority::text, ${NONE})`;
    const receivedDay = sql`coalesce(service_tickets.received_date, ${istDay(sql`service_tickets.created_at`)})`;
    const closedDay = istDay(sql`service_tickets.closed_at`);
    const pending = sql`service_tickets.status <> all(${DONE}::text[])`;
    const running = sql`${pending} and service_tickets.status <> all(${PAUSED}::text[])`;

    let base = this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'organisations.id', 'service_tickets.organisation_id')
      .leftJoin('regions as tr', 'tr.id', 'service_tickets.region_id')
      .leftJoin('products as pr', 'pr.id', 'service_tickets.product_id')
      .where('service_tickets.deleted_at', 'is', null);
    const scope = this.service.scopeWhere(user);
    if (scope) base = base.where(scope as any);
    if (isNational(user) && filters.zone_id) base = base.where(sql<boolean>`(organisations.zone_id = ${filters.zone_id} or tr.zone_id = ${filters.zone_id})`);
    if (filters.region_id) base = base.where(sql<boolean>`(organisations.region_id = ${filters.region_id} or service_tickets.region_id = ${filters.region_id})`);

    const records = base.select([
      sql<string>`${key}`.as('key'),
      'service_tickets.id as id',
      'service_tickets.organisation_id as organisation_id',
      'organisations.name as organisation_name',
      sql<string | null>`coalesce(nullif(trim(service_tickets.equipment_serial), ''), nullif(trim(service_tickets.serial_number), ''), pr.name)`.as('equipment'),
      sql<string>`coalesce(service_tickets.priority::text, ${NONE})`.as('priority'),
      sql<string>`coalesce(nullif(service_tickets.problem_category, ''), 'Unspecified')`.as('category'),
      sql<string>`${receivedDay}`.as('rday'),
      sql<string>`${closedDay}`.as('cday'),
      sql<boolean>`${inP(receivedDay)}`.as('received'),
      sql<boolean>`service_tickets.status = 'closed' and service_tickets.closed_at is not null and ${inP(closedDay)}`.as('closed_in'),
      sql<boolean>`service_tickets.status = any(${WORK_DONE}::text[]) and ${inP(istDay(sql`coalesce(service_tickets.closed_at, service_tickets.resolved_at, service_tickets.updated_at)`))}`.as('completed_in'),
      sql<number>`case when service_tickets.closed_at is not null then ${TICKET_CLOSURE_SECONDS} end`.as('secs'),
      sql<boolean>`service_tickets.sla_resolution_due_at is not null`.as('sla_due'),
      sql<boolean>`coalesce(service_tickets.resolved_at, service_tickets.closed_at) <= service_tickets.sla_resolution_due_at`.as('in_sla'),
      sql<boolean>`coalesce(service_tickets.is_repeat_complaint, false)`.as('repeat'),
      sql<boolean>`${pending}`.as('pending'),
      sql<boolean>`${running} and (service_tickets.planned_visit_date < ${today}::date or service_tickets.sla_resolution_due_at < now())`.as('overdue'),
      sql<boolean>`${running} and service_tickets.sla_resolution_due_at < now()`.as('breached'),
      sql<boolean>`service_tickets.status = any(${NEW_STATUSES}::text[])`.as('is_new'),
      sql<boolean>`${pending} and service_tickets.assigned_to is not null`.as('assigned'),
      sql<boolean>`service_tickets.status = 'awaiting_part'`.as('awaiting_parts'),
      sql<boolean>`service_tickets.status = any(${ESCALATED_STATUSES}::text[])`.as('escalated'),
    ]);
    const src = sql`(${records})`;

    const [byKey, byPriority, byCategory, hotspots, trend, windowDays] = await Promise.all([
      sql<Row>`
        select grouping(s.key) as g, s.key,
          count(*) filter (where s.received)::int as received,
          count(*) filter (where s.closed_in)::int as closed,
          count(*) filter (where s.completed_in)::int as completed,
          avg(s.secs) filter (where s.closed_in) / 86400 as avg_days,
          percentile_cont(0.5) within group (order by s.secs) filter (where s.closed_in) / 86400 as median_days,
          percentile_cont(0.9) within group (order by s.secs) filter (where s.closed_in) / 86400 as p90_days,
          count(*) filter (where s.closed_in and s.sla_due)::int as sla_whole,
          count(*) filter (where s.closed_in and s.sla_due and s.in_sla)::int as sla_part,
          count(*) filter (where s.received and s.repeat)::int as repeats,
          count(*) filter (where s.pending)::int as pending,
          count(*) filter (where s.overdue)::int as overdue,
          count(*) filter (where s.breached)::int as breached,
          count(*) filter (where s.is_new)::int as new,
          count(*) filter (where s.assigned)::int as assigned,
          count(*) filter (where s.awaiting_parts)::int as awaiting_parts,
          count(*) filter (where s.escalated)::int as escalated
        from ${src} s group by grouping sets ((s.key), ())`.execute(this.db),
      sql<Row>`
        select s.priority, count(*)::int as closed, avg(s.secs) / 3600 as avg_hours
        from ${src} s where s.closed_in group by s.priority`.execute(this.db),
      sql<Row>`
        select s.category, count(*)::int as received, count(*) filter (where s.repeat)::int as repeats
        from ${src} s where s.received group by s.category order by repeats desc, received desc limit 12`.execute(this.db),
      sql<Row>`
        select s.organisation_id, s.organisation_name, s.equipment, count(*)::int as tickets,
               count(*) filter (where s.repeat)::int as repeats, count(*) filter (where s.pending)::int as open,
               max(s.rday)::text as last_received
        from ${src} s where s.received
        group by s.organisation_id, s.organisation_name, s.equipment
        having count(*) filter (where s.repeat) > 0 or (count(*) >= 2 and s.equipment is not null)
        order by repeats desc, tickets desc, last_received desc limit 10`.execute(this.db),
      sql<Row>`
        select x.m, sum(x.rec)::int as received, sum(x.cl)::int as closed, avg(x.secs) / 86400 as avg_days, sum(x.rep)::int as repeats
        from (
          select to_char(s.rday::date, 'YYYY-MM') as m, 1 as rec, 0 as cl, null::float as secs, s.repeat::int as rep from ${src} s where s.received
          union all
          select to_char(s.cday::date, 'YYYY-MM'), 0, 1, s.secs, 0 from ${src} s where s.closed_in
        ) x group by x.m order by x.m`.execute(this.db),
      getServiceSetting<number>(this.db, 'repeat_complaint_window_days', 90),
    ]);

    const rows = new Map(byKey.rows.map((r) => [num(r.g) === 1 ? TOTAL : String(r.key), r]));
    const T = rows.get(TOTAL) ?? {};
    const received = num(T.received);

    return {
      period,
      group_by: groupBy,
      filters,
      snapshot: {
        new: num(T.new),
        pending: num(T.pending),
        assigned: num(T.assigned),
        overdue: num(T.overdue),
        awaiting_parts: num(T.awaiting_parts),
        escalated: num(T.escalated),
        sla_breached: num(T.breached),
      },
      closure: {
        received,
        closed: num(T.closed),
        completed: num(T.completed),
        avg_closure_days: days(T.avg_days),
        median_closure_days: days(T.median_days),
        p90_closure_days: days(T.p90_days),
        within_sla: rate(num(T.sla_part), num(T.sla_whole)),
        repeats: num(T.repeats),
        repeat_rate: pct(num(T.repeats), received),
      },
      closure_by_priority: byPriority.rows
        .map((r) => ({ priority: String(r.priority), closed: num(r.closed), avg_hours: days(r.avg_hours) }))
        .sort((a, b) => this.priorityRank(a.priority) - this.priorityRank(b.priority)),
      repeat_by_category: byCategory.rows.map((r) => ({ category: String(r.category), received: num(r.received), repeats: num(r.repeats) })),
      hotspots: hotspots.rows.map((r) => ({
        organisation_id: String(r.organisation_id),
        organisation_name: String(r.organisation_name ?? '—'),
        equipment: r.equipment ? String(r.equipment) : 'Equipment not recorded',
        tickets: num(r.tickets),
        repeats: num(r.repeats),
        open: num(r.open),
        last_received: String(r.last_received),
      })),
      trend: this.months(from, to, trend.rows),
      breakdown: await this.breakdown(user, groupBy, filters, rows),
      repeat_window_days: num(windowDays) || 30,
      generated_at: new Date().toISOString(),
    };
  }

  private priorityRank(p: string) {
    const i = PRIORITY_ORDER.indexOf(p);
    return i < 0 ? PRIORITY_ORDER.length : i;
  }

  /** Every month of the period (gaps filled with zeros), so the trend has no missing bars. */
  private months(from: string, to: string, data: Row[]): ServiceTrendPoint[] {
    const byMonth = new Map(data.map((r) => [String(r.m), r]));
    const out: ServiceTrendPoint[] = [];
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    const end = to.slice(0, 7);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > end) break;
      const r = byMonth.get(key);
      out.push({ month: key, received: num(r?.received), closed: num(r?.closed), avg_closure_days: days(r?.avg_days), repeats: num(r?.repeats) });
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }

  private async breakdown(
    user: AuthUser,
    groupBy: ServiceReportGroupBy,
    filters: ServiceReportDto['filters'],
    data: Map<string, Row>,
  ): Promise<ServiceReportDto['breakdown']> {
    const dataKeys = [...data.keys()].filter((k) => k !== TOTAL);
    type Head = Pick<ServiceBreakdownRow, 'key' | 'label' | 'detail'>;
    const heads = new Map<string, Head>();

    if (groupBy === 'engineer') {
      // Active engineers in the territory (an idle engineer is worth seeing) plus anyone tickets landed on.
      const territory = isNational(user)
        ? sql`${filters.zone_id ? sql`(u.zone_id = ${filters.zone_id} or u.zone_id is null)` : sql`true`}`
        : user.zone_id
          ? sql`(u.zone_id = ${user.zone_id} or u.zone_id is null)`
          : sql`(u.region_id = ${user.region_id} or u.region_id is null)`;
      const ids = dataKeys.filter((k) => k !== NONE);
      const res = await sql<Row>`
        select u.id, u.full_name, r.name as region_name from users u left join regions r on r.id = u.region_id
        where (u.role::text = 'service_team' and u.is_active and ${territory}) or u.id::text = any(${ids}::text[])`.execute(this.db);
      for (const u of res.rows) heads.set(String(u.id), { key: String(u.id), label: u.full_name, detail: u.region_name ?? null });
      if (data.has(NONE)) heads.set(NONE, { key: NONE, label: 'Unassigned', detail: 'Intake queue' });
    } else if (groupBy === 'priority') {
      for (const p of [...PRIORITY_ORDER, ...dataKeys.filter((k) => !PRIORITY_ORDER.includes(k))]) {
        if (PRIORITY_ORDER.includes(p) || data.has(p)) heads.set(p, { key: p, label: p === NONE ? 'Not set' : sentence(p), detail: null });
      }
    } else {
      const [zones, regions] = await Promise.all([
        this.db.selectFrom('zones').select(['id', 'name']).execute(),
        this.db.selectFrom('regions').select(['id', 'name', 'zone_id']).execute(),
      ]);
      const zoneName = new Map(zones.map((z) => [z.id, z.name]));
      if (groupBy === 'zone') {
        for (const z of filters.zones) heads.set(z.id, { key: z.id, label: z.name, detail: null });
        for (const k of dataKeys) if (!heads.has(k)) heads.set(k, { key: k, label: zoneName.get(k) ?? 'No zone', detail: null });
      } else {
        const regionOf = new Map(regions.map((r) => [r.id, r]));
        const base = filters.region_id ? filters.regions.filter((r) => r.id === filters.region_id) : filters.regions;
        for (const r of base) heads.set(r.id, { key: r.id, label: r.name, detail: (r.zone_id && zoneName.get(r.zone_id)) || null });
        for (const k of dataKeys) {
          if (heads.has(k)) continue;
          const r = regionOf.get(k);
          heads.set(k, { key: k, label: r?.name ?? 'No region', detail: (r?.zone_id && zoneName.get(r.zone_id)) || null });
        }
      }
    }

    const figures = (k: string): Omit<ServiceBreakdownRow, keyof Head> => {
      const r = data.get(k) ?? {};
      return {
        received: num(r.received),
        closed: num(r.closed),
        avg_closure_days: days(r.avg_days),
        median_closure_days: days(r.median_days),
        within_sla_rate: pct(num(r.sla_part), num(r.sla_whole)),
        repeats: num(r.repeats),
        open: num(r.pending),
        overdue: num(r.overdue),
      };
    };
    let rows = [...heads.values()].map((h) => ({ ...h, ...figures(h.key) }));
    if (groupBy === 'priority') rows = rows.sort((a, b) => this.priorityRank(a.key) - this.priorityRank(b.key));
    else rows = rows.sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.label.localeCompare(b.label)));
    return { rows, totals: { key: TOTAL, label: 'Total', detail: null, ...figures(TOTAL) } };
  }
}
