import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { addIsoDays, todayInKolkata } from '../../common/utils/ist-date.util.js';
import {
  CLOSED_LEAD_STATUSES,
  COMMAND_SECTIONS,
  formatIndianCurrency,
  type AuthUser,
  type CommandBreakdown,
  type CommandDashboardDto,
  type CommandLayout,
  type CommandListItem,
  type CommandMetric,
  type CommandSection,
  type CommandSectionKey,
  type CommandTone,
  type Database,
  type SalesPerformanceDto,
} from '@arihant/shared';
import {
  PROPOSAL_ORG,
  PROPOSAL_OUTCOME_DAY,
  TASK_OVERDUE,
  TENDER_AWAITING_APPROVAL,
  TENDER_ROW,
  VISIT_OPEN,
  istDay,
  tenderClosingWithin,
} from './dashboard-metrics.js';
import { DashboardPerformanceService } from './dashboard-performance.service.js';
import { ServiceService } from '../service/service.service.js';
import { ProposalsService } from '../proposals/proposals.service.js';
import { ProductivityReportService } from '../reports/productivity-report.service.js';
import { ModuleAccessService } from '../access/module-access.service.js';
import { DEMO_ACTIVE_STATUSES, DEMO_PENDING_STATUSES } from '../demos/demos.service.js';

/**
 * Module 10 — Management Command dashboard (GET /dashboard/command, Scope Blueprint §45).
 *
 * Every figure is counted with the rule of the module screen it opens, and its link opens exactly those records:
 *  - Sales: follow-ups as the Leads page (an open lead with a pending follow-up past due); new leads, conversion and
 *    region performance from Module 9 (DashboardPerformanceService) over the chosen period.
 *  - Field visits: the Visits page's open statuses and planned dates.
 *  - Demos: the Demos register's date (confirmed, else requested) and outcome filters; conflicts with the booking
 *    clash rule the module enforces (DemosService.findReservationConflict).
 *  - Tenders: the register's Deadline filter (pre-submission stages, submission deadline), the Approvals Inbox rule,
 *    its stage and category filters; won / lost from Module 9.
 *  - Proposals and Service: the modules' own KPI methods (ProposalsService / ServiceService.getDashboardStats).
 *  - Team: Module 8 overdue rule; attention and on-time completion from the Productivity report.
 *  - Expenses: the Expenses page's stage groups.
 *
 * Management and admin see all India. A section whose module the administrator switched off for the caller's role is
 * left out, whatever the saved layout says.
 */
type Row = Record<string, any>;
interface Ctx {
  user: AuthUser;
  today: string;
  from: string;
  to: string;
  /** Module 9 by region over the period — computed once, shared by Sales and Tenders. */
  performance: () => Promise<SalesPerformanceDto>;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const rupees = (n: number) => formatIndianCurrency(n, true);
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const day = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const shortDay = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
const human = (s: unknown) => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
/** A link with only the parameters that are set. */
const href = (path: string, params: Record<string, string | null | undefined> = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return q ? `${path}?${q}` : path;
};
/** An action figure: zero is all clear, otherwise a warning, or critical when `urgent`. */
const actionTone = (value: number, urgent = false): CommandTone => (value === 0 ? 'ok' : urgent ? 'critical' : 'warning');
const metric = (key: string, m: Omit<CommandMetric, 'key'>): CommandMetric => ({ key, ...m });
const closeSoon = (n: number) => `${n === 1 ? '1 bid closes' : `${n.toLocaleString('en-IN')} bids close`} within 48 hours`;
/** "3 · ₹ 4.6 L" — just the count when there is nothing to add up. */
const countAndAmount = (n: number, amount: number) => (n ? `${n} · ${rupees(amount)}` : '0');

const LEAD_CLOSED = [...CLOSED_LEAD_STATUSES];
/** Leads page rules (LeadsService: LEAD_IS_OPEN, leadFollowupIs) — the table is referenced as `leads`. */
const LEAD_OPEN = sql`lower(coalesce(leads.lead_status, leads.status, 'new')) <> all(${LEAD_CLOSED}::text[])`;
const leadFollowup = (op: '<' | '=', today: string) =>
  sql`(${LEAD_OPEN} and exists (select 1 from follow_ups fu where fu.lead_id = leads.id and fu.status = 'pending' and fu.due_date ${sql.raw(op)} ${today}::date))`;

/** Tender register stage groups (TendersService.tenderStageMatch): every stage leaves held bids out. */
const NOT_HELD = sql`coalesce(t.on_hold, false) = false`;
const TENDER_LIVE_STAGES: { label: string; statuses: string[]; filter: string }[] = [
  { label: 'Identified', statuses: ['identified'], filter: 'identified' },
  { label: 'Awaiting approval', statuses: ['awaiting_approval'], filter: 'awaiting_approval' },
  { label: 'Preparing', statuses: ['under_preparation', 'pq_submitted', 'pq_qualified'], filter: 'under_preparation' },
  { label: 'Submitted / evaluation', statuses: ['submitted', 'technical_eval', 'commercial_eval'], filter: 'submitted,technical_eval,commercial_eval' },
];
const TENDER_LIVE_STATUSES = TENDER_LIVE_STAGES.flatMap((s) => s.statuses);
const TENDER_TERMINAL = ['won', 'lost', 'cancelled', 'rejected_internally'];

/** Reservation clash rule of DemosService.findReservationConflict. */
const RESERVATION_HELD = ['approved', 'requested'];
const DEMO_CLOSED = ['cancelled', 'completed'];

/** Service list rule for `overdue=true` (ServiceService.applyTicketFilters). */
const SERVICE_DONE = ['resolved', 'report_submitted', 'closed', 'cancelled'];
const SERVICE_PAUSED = ['awaiting_part', 'awaiting_customer', 'on_hold'];

/** Expenses page stage groups (apps/web expenses/page.tsx STAGES). */
const EXPENSE_STAGE1 = ['submitted'];
const EXPENSE_ACCOUNTS = ['manager_approved', 'accounts_review', 'accounts_approved'];
const DRAFT_STALE_DAYS = 7;

const FAILURE_LABEL: Record<string, string> = {
  PRODUCT_LIMITATION: 'Product limitation',
  EQUIPMENT_ISSUE: 'Equipment issue',
  TECHNICAL_FAILURE: 'Technical failure',
  CUSTOMER_REQUIREMENT_MISMATCH: 'Requirement mismatch',
  PRICING_CONCERN: 'Pricing concern',
  DECISION_MAKER_UNAVAILABLE: 'Decision maker unavailable',
  COMPETITOR_PREFERENCE: 'Competitor preferred',
  DEMO_PREPARATION_ISSUE: 'Preparation issue',
  OTHER: 'Other',
};

@Injectable()
export class DashboardCommandService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly performance: DashboardPerformanceService,
    private readonly service: ServiceService,
    private readonly proposals: ProposalsService,
    private readonly productivity: ProductivityReportService,
    private readonly access: ModuleAccessService,
  ) {}

  async getCommand(user: AuthUser, layout: CommandLayout): Promise<CommandDashboardDto> {
    const today = todayInKolkata();
    const days = layout.period;
    const from = addIsoDays(today, -(days - 1));
    let perf: Promise<SalesPerformanceDto> | null = null;
    const ctx: Ctx = {
      user,
      today,
      from,
      to: today,
      performance: () => (perf ??= this.performance.getSalesPerformance(user, { from, to: today, group_by: 'region' })),
    };

    const blocked = new Set(await this.access.blockedFor(user.role));
    const unavailable = COMMAND_SECTIONS.filter((s) => blocked.has(s.module)).map((s) => s.key);
    const build: Record<CommandSectionKey, (c: Ctx, want: Set<string>) => Promise<CommandMetric[]>> = {
      sales: (c, w) => this.sales(c, w),
      visits: (c, w) => this.visits(c, w),
      demos: (c, w) => this.demos(c, w),
      tenders: (c, w) => this.tenders(c, w),
      proposals: (c, w) => this.proposalSection(c, w),
      service: (c, w) => this.serviceSection(c, w),
      team: (c, w) => this.team(c, w),
      expenses: (c, w) => this.expenses(c, w),
    };

    const sections: CommandSection[] = [];
    const built = await Promise.all(
      layout.sections.map(async (ls) => {
        if (ls.hidden || unavailable.includes(ls.key)) return null;
        const def = COMMAND_SECTIONS.find((d) => d.key === ls.key)!;
        const keys = def.items.map((i) => i.key).filter((k) => !ls.hidden_items.includes(k));
        if (!keys.length) return null;
        const metrics = await build[ls.key](ctx, new Set(keys));
        // catalogue order, only what the layout shows
        return { key: ls.key, metrics: keys.map((k) => metrics.find((m) => m.key === k)).filter((m): m is CommandMetric => !!m) };
      }),
    );
    for (const s of built) if (s) sections.push(s);

    return { generatedAt: new Date().toISOString(), period: { days, from, to: today }, layout, sections, unavailable };
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    return (await query.execute(this.db)).rows as Row[];
  }
  private async one(query: RawBuilder<unknown>): Promise<Row> {
    return (await this.rows(query))[0] ?? {};
  }
  private performanceHref(c: Ctx) {
    return href('/regional/performance', { from: c.from, to: c.to, group_by: 'region' });
  }

  /* ------------------------------------------------------------------- sales -- */
  private async sales(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const out: CommandMetric[] = [];
    if (want.has('followups_overdue')) {
      const [counts, late] = await Promise.all([
        this.one(sql`
          select count(*) filter (where ${leadFollowup('<', c.today)})::int as overdue,
                 count(*) filter (where ${leadFollowup('=', c.today)})::int as due_today
          from leads join organisations o on o.id = leads.organisation_id`),
        this.rows(sql`
          select leads.id, o.name as org, pr.name as product, u.full_name as owner,
                 (select min(fu.due_date) from follow_ups fu where fu.lead_id = leads.id and fu.status = 'pending')::text as due
          from leads join organisations o on o.id = leads.organisation_id
          left join products pr on pr.id = leads.product_id left join users u on u.id = leads.assigned_to
          where ${leadFollowup('<', c.today)}
          order by due asc, o.name asc limit 5`),
      ]);
      const overdue = num(counts.overdue);
      out.push(
        metric('followups_overdue', {
          value: overdue,
          detail: num(counts.due_today) ? `${plural(num(counts.due_today), 'more follow-up')} due today` : null,
          tone: actionTone(overdue),
          href: href('/leads', { followup: 'overdue' }),
          items: late.map((r) => ({
            id: r.id,
            title: r.org,
            subtitle: [r.product, r.owner].filter(Boolean).join(' · ') || null,
            date: day(r.due),
            tone: 'warning',
            href: href('/leads', { open: r.id }),
          })),
        }),
      );
    }

    if (want.has('new_opportunities') || want.has('conversion') || want.has('region_performance')) {
      const perf = await c.performance();
      const lead = perf.totals.lead;
      const created = lead.new + lead.reapproached;
      if (want.has('new_opportunities')) {
        const leadsCreated = (type?: string) => href('/leads', { lead_type: type, created_from: c.from, created_to: c.to });
        out.push(
          metric('new_opportunities', {
            value: created,
            tone: 'neutral',
            href: leadsCreated(),
            breakdown: [
              { label: 'Fresh', value: lead.new, href: leadsCreated('fresh') },
              { label: 'Re-approached', value: lead.reapproached, href: leadsCreated('re_approached') },
            ],
          }),
        );
      }
      if (want.has('conversion')) {
        out.push(
          metric('conversion', {
            value: lead.conversion_rate,
            display: lead.conversion_rate == null ? '—' : `${lead.conversion_rate}%`,
            detail: created ? `${plural(lead.converted, 'lead')} of ${created.toLocaleString('en-IN')} created in the period converted` : 'No leads created in the period',
            tone: 'neutral',
            href: this.performanceHref(c),
          }),
        );
      }
      if (want.has('region_performance')) {
        const active = perf.rows
          .map((r) => ({ r, leads: r.lead.new + r.lead.reapproached, decided: r.tender.won + r.tender.lost }))
          .filter((x) => x.leads > 0 || x.decided > 0 || x.r.visit.planned > 0)
          .sort((a, b) => b.leads - a.leads || a.r.label.localeCompare(b.r.label));
        const best = active.filter((x) => x.r.lead.conversion_rate != null).sort((a, b) => b.r.lead.conversion_rate! - a.r.lead.conversion_rate!)[0];
        out.push(
          metric('region_performance', {
            value: active.length,
            detail: best ? `Best conversion: ${best.r.label} (${best.r.lead.conversion_rate}%)` : 'No region created leads in the period',
            tone: 'neutral',
            href: this.performanceHref(c),
            items: active.slice(0, 6).map(({ r, leads }) => ({
              id: r.key,
              title: r.label,
              subtitle: r.zone_name,
              meta: [
                plural(leads, 'new lead'),
                r.lead.conversion_rate == null ? null : `${r.lead.conversion_rate}% converted`,
                r.tender.win_rate == null ? null : `tender win ${r.tender.win_rate}%`,
              ]
                .filter(Boolean)
                .join(' · '),
              tone: 'neutral',
              href: this.performanceHref(c),
            })),
          }),
        );
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ visits -- */
  private async visits(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const weekEnd = addIsoDays(c.today, 6);
    const combineEnd = addIsoDays(c.today, 13);
    const open = sql`v.status = any(${VISIT_OPEN}::text[])`;
    const [counts, upcoming, people, clusters] = await Promise.all([
      this.one(sql`
        select count(*) filter (where ${open} and v.planned_date between ${c.today}::date and ${weekEnd}::date)::int as upcoming,
               count(*) filter (where ${open} and v.planned_date = ${c.today}::date)::int as today,
               count(distinct v.assigned_to) filter (where ${open} and v.planned_date = ${c.today}::date)::int as people,
               count(*) filter (where ${open} and v.planned_date = ${c.today}::date and coalesce(v.travel_required, false))::int as travel,
               count(*) filter (where v.status = 'cancelled' and v.planned_date between ${c.from}::date and ${c.to}::date)::int as cancelled,
               count(*) filter (where v.status = 'rescheduled')::int as rescheduled
        from visits v join organisations o on o.id = v.organisation_id`),
      want.has('upcoming')
        ? this.rows(sql`
            select v.id, v.organisation_id, v.planned_date::text as day, v.purpose, o.name as org, u.full_name as rep
            from visits v join organisations o on o.id = v.organisation_id left join users u on u.id = v.assigned_to
            where ${open} and v.planned_date between ${c.today}::date and ${weekEnd}::date
            order by v.planned_date asc, v.start_time asc nulls last limit 5`)
        : Promise.resolve([]),
      want.has('travelling')
        ? this.rows(sql`
            select u.id, u.full_name, count(*)::int as n, bool_or(coalesce(v.travel_required, false)) as travel,
                   string_agg(distinct coalesce(nullif(trim(o.city), ''), o.name), ', ') as places
            from visits v join organisations o on o.id = v.organisation_id join users u on u.id = v.assigned_to
            where ${open} and v.planned_date = ${c.today}::date
            group by u.id, u.full_name order by n desc, u.full_name asc limit 6`)
        : Promise.resolve([]),
      want.has('combine')
        ? this.rows(sql`
            with v as (
              select v.id, v.planned_date, v.assigned_to, v.trip_id, lower(trim(o.city)) as city_key, trim(o.city) as city
              from visits v join organisations o on o.id = v.organisation_id
              where ${open} and v.planned_date between ${c.today}::date and ${combineEnd}::date and coalesce(trim(o.city), '') <> ''
            ), pairs as (
              -- two visits in one city within 3 days that are not already one trip (one person, one day, or one trip)
              select a.city_key, a.id as a_id, b.id as b_id
              from v a join v b on a.city_key = b.city_key and a.id < b.id
               and abs(a.planned_date - b.planned_date) <= 3
               and (a.assigned_to is distinct from b.assigned_to or a.planned_date <> b.planned_date)
               and (a.trip_id is null or b.trip_id is null or a.trip_id <> b.trip_id)
            ), involved as (
              select city_key, a_id as id from pairs union select city_key, b_id from pairs
            )
            select min(v.city) as city, count(*)::int as visits, count(distinct v.assigned_to)::int as people,
                   min(v.planned_date)::text as first_day, max(v.planned_date)::text as last_day
            from involved i join v on v.id = i.id
            group by i.city_key order by visits desc, city asc`)
        : Promise.resolve([]),
    ]);

    const out: CommandMetric[] = [];
    if (want.has('upcoming')) {
      out.push(
        metric('upcoming', {
          value: num(counts.upcoming),
          detail: `${plural(num(counts.today), 'visit')} today`,
          tone: 'neutral',
          href: href('/visits', { status: 'open', from: c.today, to: weekEnd }),
          items: upcoming.map((r) => ({
            id: r.id,
            title: r.org,
            subtitle: [r.rep, r.purpose].filter(Boolean).join(' · ') || null,
            date: r.day,
            tone: 'neutral',
            href: href('/visits', { customer: r.organisation_id }),
          })),
        }),
      );
    }
    if (want.has('travelling')) {
      const travel = num(counts.travel);
      out.push(
        metric('travelling', {
          value: num(counts.people),
          detail: `${plural(num(counts.today), 'visit')} today${travel ? ` · ${travel} need travel` : ''}`,
          tone: 'neutral',
          href: href('/visits', { status: 'open', from: c.today, to: c.today }),
          items: people.map((r) => ({
            id: r.id,
            title: r.full_name,
            subtitle: r.places,
            meta: `${plural(r.n, 'visit')}${r.travel ? ' · travelling' : ''}`,
            tone: 'neutral',
            href: href('/visits', { status: 'open', from: c.today, to: c.today }),
          })),
        }),
      );
    }
    if (want.has('cancelled_rescheduled')) {
      const cancelled = num(counts.cancelled);
      const rescheduled = num(counts.rescheduled);
      out.push(
        metric('cancelled_rescheduled', {
          value: cancelled + rescheduled,
          tone: 'neutral',
          href: null,
          breakdown: [
            { label: 'Cancelled', value: cancelled, href: href('/visits', { status: 'cancelled', from: c.from, to: c.to }) },
            { label: 'Rescheduled', value: rescheduled, href: href('/visits', { status: 'rescheduled' }) },
          ],
        }),
      );
    }
    if (want.has('combine')) {
      out.push(
        metric('combine', {
          value: clusters.length,
          detail: clusters.length ? `${plural(clusters.reduce((n, r) => n + num(r.visits), 0), 'visit')} could share trips` : 'No visits to combine in the next 14 days',
          tone: clusters.length ? 'warning' : 'neutral',
          href: href('/visits', { status: 'open', from: c.today, to: combineEnd }),
          items: clusters.slice(0, 5).map((r) => ({
            id: r.city,
            title: r.city,
            subtitle: `${plural(r.visits, 'visit')} by ${plural(r.people, 'person', 'people')}`,
            meta: r.first_day === r.last_day ? shortDay(r.first_day) : `${shortDay(r.first_day)} – ${shortDay(r.last_day)}`,
            tone: 'warning',
            href: href('/visits', { status: 'open', from: r.first_day, to: r.last_day }),
          })),
        }),
      );
    }
    return out;
  }

  /* ------------------------------------------------------------------- demos -- */
  private async demos(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const weekEnd = addIsoDays(c.today, 6);
    // the Demos register's date filter: confirmed date, else requested date
    const demoDate = sql`coalesce(demos.confirmed_date, demos.requested_date)`;
    const inPeriod = sql`${demoDate} between ${c.from}::date and ${c.to}::date`;
    const outcome = (cond: RawBuilder<unknown>) => sql`exists (select 1 from demo_outcomes x where x.demo_id = demos.id and ${cond})`;
    const active = [...DEMO_ACTIVE_STATUSES] as string[];
    const pending = [...DEMO_PENDING_STATUSES] as string[];
    const clash = sql`
      from demo_reservations a
      join demo_reservations b on b.equipment_id = a.equipment_id and a.id < b.id
      join demos da on da.id = a.demo_id join demos db on db.id = b.demo_id
      left join demo_equipment e on e.id = a.equipment_id
      where a.status = any(${RESERVATION_HELD}::text[]) and b.status = any(${RESERVATION_HELD}::text[])
        and coalesce(da.status, '') <> all(${DEMO_CLOSED}::text[]) and coalesce(db.status, '') <> all(${DEMO_CLOSED}::text[])
        and a.reserved_from <= coalesce(b.reserved_to, b.reserved_from) and coalesce(a.reserved_to, a.reserved_from) >= b.reserved_from
        and coalesce(a.reserved_to, a.reserved_from) >= ${c.today}::date and coalesce(b.reserved_to, b.reserved_from) >= ${c.today}::date`;

    const [counts, upcoming, clashes, waiting, reasons] = await Promise.all([
      this.one(sql`
        select count(*) filter (where demos.status = any(${active}::text[]) and ${demoDate} between ${c.today}::date and ${weekEnd}::date)::int as upcoming,
               count(*) filter (where demos.status = any(${pending}::text[]) and ${demoDate} between ${c.today}::date and ${weekEnd}::date)::int as unconfirmed,
               count(*) filter (where ${inPeriod} and ${outcome(sql`x.result = 'success'`)})::int as success,
               count(*) filter (where ${inPeriod} and ${outcome(sql`x.result = 'fail'`)})::int as fail,
               count(*) filter (where ${inPeriod} and ${outcome(sql`x.result = 'partial'`)})::int as partial
        from demos join organisations o on o.id = demos.organisation_id`),
      want.has('upcoming')
        ? this.rows(sql`
            select demos.id, demos.demo_no, demos.status, ${demoDate}::text as day, o.name as org, pr.name as product
            from demos join organisations o on o.id = demos.organisation_id left join products pr on pr.id = demos.product_id
            where demos.status = any(${active}::text[]) and ${demoDate} between ${c.today}::date and ${weekEnd}::date
            order by ${demoDate} asc, demos.demo_no asc limit 5`)
        : Promise.resolve([]),
      want.has('equipment_conflicts')
        ? this.rows(sql`
            select a.id, coalesce(e.model, e.serial_no, 'Demo unit') as unit, e.serial_no, da.id as demo_a, da.demo_no as no_a, db.demo_no as no_b,
                   greatest(a.reserved_from, b.reserved_from)::text as clash_from
            ${clash}
            order by clash_from asc limit 5`)
        : Promise.resolve([]),
      want.has('equipment_conflicts')
        ? this.one(sql`
            select count(*)::int as c from demo_reservations r join demos d on d.id = r.demo_id
            where r.status = 'requested' and coalesce(d.status, '') <> all(${DEMO_CLOSED}::text[])
              and coalesce(r.reserved_to, r.reserved_from) >= ${c.today}::date`)
        : Promise.resolve({} as Row),
      want.has('failure_reasons')
        ? this.rows(sql`
            select x.failure_reason as reason, count(*)::int as n
            from demos join organisations o on o.id = demos.organisation_id
            join demo_outcomes x on x.demo_id = demos.id
            where ${inPeriod} and x.result = 'fail' and x.failure_reason is not null
            group by x.failure_reason order by n desc, x.failure_reason asc`)
        : Promise.resolve([]),
    ]);
    // the clash list is capped; count every pair
    const clashCount = want.has('equipment_conflicts') ? num((await this.one(sql`select count(*)::int as c ${clash}`)).c) : 0;

    const out: CommandMetric[] = [];
    if (want.has('upcoming')) {
      const unconfirmed = num(counts.unconfirmed);
      out.push(
        metric('upcoming', {
          value: num(counts.upcoming),
          detail: unconfirmed ? `${plural(unconfirmed, 'demo')} not confirmed yet` : 'All confirmed',
          tone: 'neutral',
          href: href('/demos', { status: active.join(','), from: c.today, to: weekEnd }),
          items: upcoming.map((r) => ({
            id: r.id,
            title: r.org,
            subtitle: [r.demo_no, r.product].filter(Boolean).join(' · ') || null,
            date: r.day,
            meta: human(r.status),
            tone: pending.includes(r.status) ? 'warning' : 'neutral',
            href: href('/demos', { open: r.id }),
          })),
        }),
      );
    }
    if (want.has('equipment_conflicts')) {
      const requests = num(waiting.c);
      out.push(
        metric('equipment_conflicts', {
          value: clashCount,
          detail: requests ? `${plural(requests, 'unit request')} waiting for approval` : null,
          tone: actionTone(clashCount, true),
          href: href('/demos', { tab: 'fleet' }),
          items: clashes.map((r) => ({
            id: r.id,
            title: r.unit,
            subtitle: `${r.no_a} and ${r.no_b} overlap`,
            date: r.clash_from,
            tone: 'critical',
            href: href('/demos', { open: r.demo_a }),
          })),
        }),
      );
    }
    if (want.has('results')) {
      const success = num(counts.success);
      const fail = num(counts.fail);
      const partial = num(counts.partial);
      const rate = pct(success, success + fail + partial);
      const byResult = (result: string) => href('/demos', { result, from: c.from, to: c.to });
      out.push(
        metric('results', {
          value: rate,
          display: rate == null ? '—' : `${rate}%`,
          detail: success + fail + partial ? `Success rate across ${plural(success + fail + partial, 'recorded outcome')}` : 'No outcomes recorded in the period',
          tone: 'neutral',
          href: null,
          breakdown: [
            { label: 'Success', value: success, tone: 'ok', href: byResult('success') },
            { label: 'Failed', value: fail, tone: fail ? 'warning' : 'neutral', href: byResult('fail') },
            { label: 'Partial', value: partial, href: byResult('partial') },
          ],
        }),
      );
    }
    if (want.has('failure_reasons')) {
      const repeated = reasons.filter((r) => num(r.n) >= 2);
      out.push(
        metric('failure_reasons', {
          value: repeated.length,
          detail: reasons.length
            ? repeated.length
              ? `Most common: ${FAILURE_LABEL[repeated[0].reason] ?? human(repeated[0].reason)}`
              : 'No reason came up twice'
            : 'No failed demos in the period',
          tone: repeated.length ? 'warning' : 'neutral',
          href: href('/demos', { tab: 'failures' }),
          breakdown: reasons.slice(0, 6).map(
            (r): CommandBreakdown => ({
              label: FAILURE_LABEL[r.reason] ?? human(r.reason),
              value: num(r.n),
              tone: num(r.n) >= 2 ? 'warning' : 'neutral',
              href: href('/demos', { result: 'fail', failure_reason: r.reason, from: c.from, to: c.to }),
            }),
          ),
        }),
      );
    }
    return out;
  }

  /* ----------------------------------------------------------------- tenders -- */
  private async tenders(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const buyer = sql`coalesce(o.name, t.department)`;
    const pipelineCounts = (category: string) =>
      this.one(sql`
        select ${sql.join(
          TENDER_LIVE_STAGES.map((s, i) => sql`count(*) filter (where t.status::text = any(${s.statuses}::text[]) and ${NOT_HELD})::int as ${sql.ref(`s${i}`)}`),
        )},
               count(*) filter (where coalesce(t.on_hold, false) and t.status::text <> all(${TENDER_TERMINAL}::text[]))::int as held
        from tenders t left join tender_categories tc on tc.id = t.category_id
        where ${TENDER_ROW} and (t.category::text = ${category} or lower(tc.code) = ${category})`);

    const [counts, closing, approvals, pq, general] = await Promise.all([
      this.one(sql`
        select count(*) filter (where ${tenderClosingWithin(7 * 24)})::int as week,
               count(*) filter (where ${tenderClosingWithin(48)})::int as urgent,
               count(*) filter (where ${TENDER_AWAITING_APPROVAL})::int as approvals,
               count(*) filter (where ${TENDER_AWAITING_APPROVAL} and ${tenderClosingWithin(48)})::int as approvals_urgent,
               count(*) filter (where ${TENDER_AWAITING_APPROVAL} and t.submission_deadline < now())::int as approvals_missed
        from tenders t where ${TENDER_ROW}`),
      want.has('deadlines')
        ? this.rows(sql`
            select t.id, t.tender_no, t.status, ${buyer} as buyer, t.submission_deadline as deadline
            from tenders t left join organisations o on o.id = t.organisation_id
            where ${TENDER_ROW} and ${tenderClosingWithin(7 * 24)}
            order by t.submission_deadline asc limit 5`)
        : Promise.resolve([]),
      want.has('approvals')
        ? this.rows(sql`
            select t.id, t.tender_no, ${buyer} as buyer, t.submission_deadline as deadline, t.estimated_value
            from tenders t left join organisations o on o.id = t.organisation_id
            where ${TENDER_ROW} and ${TENDER_AWAITING_APPROVAL}
            order by (t.submission_deadline < now()) asc, t.submission_deadline asc nulls last limit 5`)
        : Promise.resolve([]),
      want.has('pq_pipeline') ? pipelineCounts('pq') : Promise.resolve({} as Row),
      want.has('general_pipeline') ? pipelineCounts('general_mha') : Promise.resolve({} as Row),
    ]);

    const out: CommandMetric[] = [];
    if (want.has('deadlines')) {
      const week = num(counts.week);
      const urgent = num(counts.urgent);
      out.push(
        metric('deadlines', {
          value: week,
          detail: urgent ? closeSoon(urgent) : week ? 'None within 48 hours' : null,
          tone: actionTone(week, urgent > 0),
          href: href('/tenders', { deadline: 'upcoming_7d' }),
          items: closing.map((r) => ({
            id: r.id,
            title: r.tender_no || 'Tender',
            subtitle: [r.buyer, human(r.status)].filter(Boolean).join(' · ') || null,
            date: iso(r.deadline),
            tone: new Date(r.deadline).getTime() - Date.now() <= 48 * 3600e3 ? 'critical' : 'warning',
            href: href('/tenders', { highlight: r.id }),
          })),
        }),
      );
    }
    if (want.has('approvals')) {
      const waiting = num(counts.approvals);
      const urgent = num(counts.approvals_urgent);
      const missed = num(counts.approvals_missed);
      out.push(
        metric('approvals', {
          value: waiting,
          detail: [urgent ? `${closeSoon(urgent)}, still to approve` : null, missed ? `${plural(missed, 'bid')} already past the deadline` : null].filter(Boolean).join(' · ') || null,
          tone: actionTone(waiting, urgent > 0),
          href: href('/tenders', { status: 'awaiting_approval' }),
          items: approvals.map((r) => ({
            id: r.id,
            title: r.tender_no || 'Tender',
            subtitle: r.buyer,
            date: iso(r.deadline),
            meta: r.estimated_value == null ? null : rupees(num(r.estimated_value)),
            tone: 'warning',
            href: href('/tenders', { highlight: r.id }),
          })),
        }),
      );
    }
    for (const [key, category, figures] of [
      ['pq_pipeline', 'pq', pq],
      ['general_pipeline', 'general_mha', general],
    ] as const) {
      if (!want.has(key)) continue;
      const stages = TENDER_LIVE_STAGES.map((s, i) => ({ ...s, n: num(figures[`s${i}`]) }));
      const held = num(figures.held);
      out.push(
        metric(key, {
          value: stages.reduce((n, s) => n + s.n, 0),
          detail: held ? `${plural(held, 'more bid')} on hold` : null,
          tone: 'neutral',
          href: href('/tenders', { category, status: TENDER_LIVE_STATUSES.join(',') }),
          breakdown: stages.map((s) => ({ label: s.label, value: s.n, href: href('/tenders', { category, status: s.filter }) })),
        }),
      );
    }
    if (want.has('won_lost')) {
      const { won, lost, win_rate } = (await c.performance()).totals.tender;
      out.push(
        metric('won_lost', {
          value: won + lost,
          display: win_rate == null ? '—' : `${win_rate}%`,
          detail: won + lost ? `Win rate · ${won} won, ${lost} lost` : 'No results declared in the period',
          tone: 'neutral',
          href: this.performanceHref(c),
          breakdown: [
            { label: 'Won', value: won, tone: 'ok' },
            { label: 'Lost', value: lost, tone: lost ? 'warning' : 'neutral' },
          ],
        }),
      );
    }
    return out;
  }

  /* --------------------------------------------------------------- proposals -- */
  private async proposalSection(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const dispatched = ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'SENT', 'FOLLOWUP_REQUIRED'];
    const nextFollowUp = sql`coalesce(p.next_follow_up_date, p.next_followup)`;
    const [stats, late, outcomes] = await Promise.all([
      want.has('pending') || want.has('followups_overdue') ? this.proposals.getDashboardStats(c.user, {}) : Promise.resolve({} as Row),
      want.has('followups_overdue')
        ? this.rows(sql`
            select p.id, coalesce(p.proposal_number, p.proposal_no) as no, o.name as org, u.full_name as owner, ${nextFollowUp}::text as due
            from proposals p left join organisations o on o.id = ${PROPOSAL_ORG} left join users u on u.id = coalesce(p.follow_up_owner_id, p.followup_owner_id, p.responsible_person_id)
            where p.is_deleted = false and upper(p.status) = any(${dispatched}::text[]) and ${nextFollowUp} < ${c.today}::date
            order by ${nextFollowUp} asc limit 5`)
        : Promise.resolve([]),
      want.has('outcomes')
        ? this.one(sql`
            select count(*) filter (where upper(p.status) = 'CONVERTED')::int as converted,
                   count(*) filter (where upper(p.status) = 'LOST')::int as lost,
                   count(*) filter (where upper(p.status) = 'CLOSED')::int as closed
            from proposals p
            where p.is_deleted = false and upper(p.status) in ('CONVERTED', 'LOST', 'CLOSED')
              and ${PROPOSAL_OUTCOME_DAY} between ${c.from}::date and ${c.to}::date`)
        : Promise.resolve({} as Row),
    ]);

    const out: CommandMetric[] = [];
    if (want.has('pending')) {
      const stages = [
        { label: 'Requested', value: num(stats.proposal_requested), status: 'PROPOSAL_REQUESTED' },
        { label: 'Being prepared', value: num(stats.pending_preparation), status: 'UNDER_PREPARATION' },
        { label: 'Ready for review', value: num(stats.ready_for_review), status: 'READY_FOR_REVIEW' },
        { label: 'Approved, not sent', value: num(stats.approved), status: 'APPROVED' },
      ];
      const total = stages.reduce((n, s) => n + s.value, 0);
      const late = num(stats.prep_overdue);
      out.push(
        metric('pending', {
          value: total,
          detail: late ? `${plural(late, 'proposal')} past the date the customer needs it` : null,
          tone: actionTone(total, late > 0),
          href: null,
          breakdown: stages.map((s) => ({ label: s.label, value: s.value, href: href('/proposals', { status: s.status }) })),
        }),
      );
    }
    if (want.has('followups_overdue')) {
      const overdue = num(stats.overdue);
      out.push(
        metric('followups_overdue', {
          value: overdue,
          detail: num(stats.due_today) ? `${plural(num(stats.due_today), 'more follow-up')} due today` : null,
          tone: actionTone(overdue),
          href: href('/proposals', { followup: 'overdue' }),
          items: late.map((r) => ({
            id: r.id,
            title: r.org || r.no || 'Proposal',
            subtitle: [r.no, r.owner].filter(Boolean).join(' · ') || null,
            date: day(r.due),
            tone: 'warning',
            href: href('/proposals', { open: r.id }),
          })),
        }),
      );
    }
    if (want.has('outcomes')) {
      const converted = num(outcomes.converted);
      const lost = num(outcomes.lost);
      const closed = num(outcomes.closed);
      const rate = pct(converted, converted + lost);
      out.push(
        metric('outcomes', {
          value: converted + lost + closed,
          detail: rate == null ? 'Nothing converted or lost in the period' : `Win rate ${rate}% (converted against lost)`,
          tone: 'neutral',
          href: null,
          breakdown: [
            { label: 'Converted', value: converted, tone: 'ok' },
            { label: 'Lost', value: lost, tone: lost ? 'warning' : 'neutral' },
            { label: 'Closed', value: closed },
          ],
        }),
      );
    }
    return out;
  }

  /* ----------------------------------------------------------------- service -- */
  private async serviceSection(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const overdueRule = sql`s.status <> all(${SERVICE_DONE}::text[]) and s.status <> all(${SERVICE_PAUSED}::text[])
      and ((s.planned_visit_date < ${c.today}::date and s.status <> 'in_progress') or s.sla_resolution_due_at < now())`;
    const [stats, overdue, parts] = await Promise.all([
      this.service.getDashboardStats(c.user, {}),
      want.has('overdue')
        ? this.rows(sql`
            select s.id, s.ticket_no, s.priority, o.name as org,
                   -- the IST day it fell due (SLA, else the planned visit), shown as "3d overdue"
                   coalesce((s.sla_resolution_due_at at time zone 'Asia/Kolkata')::date, s.planned_visit_date)::text as due
            from service_tickets s join organisations o on o.id = s.organisation_id
            where s.deleted_at is null and ${overdueRule}
            order by due asc nulls last, s.ticket_no asc limit 5`)
        : Promise.resolve([]),
      want.has('awaiting_parts')
        ? this.rows(sql`
            select s.id, s.ticket_no, s.priority, s.updated_at, o.name as org
            from service_tickets s join organisations o on o.id = s.organisation_id
            where s.deleted_at is null and s.status = 'awaiting_part'
            order by s.updated_at asc limit 5`)
        : Promise.resolve([]),
    ]);

    const out: CommandMetric[] = [];
    if (want.has('open')) {
      out.push(
        metric('open', {
          value: num(stats.pendingTickets),
          detail: num(stats.criticalTickets) ? `${plural(num(stats.criticalTickets), 'critical ticket')}` : 'None critical',
          tone: 'neutral',
          href: href('/service', { stage: 'pending' }),
        }),
      );
    }
    if (want.has('overdue')) {
      const n = num(stats.overdueTickets);
      const breached = num(stats.slaBreached);
      out.push(
        metric('overdue', {
          value: n,
          detail: breached ? `${plural(breached, 'ticket')} past the resolution SLA` : null,
          tone: actionTone(n, breached > 0),
          href: href('/service', { flag: 'overdue' }),
          items: overdue.map((r) => ({
            id: r.id,
            title: r.ticket_no || 'Ticket',
            subtitle: r.org,
            date: r.due,
            meta: human(r.priority),
            tone: 'critical',
            href: href('/service', { open: r.id }),
          })),
        }),
      );
    }
    if (want.has('repeat')) {
      const n = num(stats.repeatComplaints);
      out.push(metric('repeat', { value: n, tone: actionTone(n), href: href('/service', { flag: 'repeat' }) }));
    }
    if (want.has('awaiting_parts')) {
      const n = num(stats.awaitingParts);
      out.push(
        metric('awaiting_parts', {
          value: n,
          tone: actionTone(n),
          href: href('/service', { stage: 'awaiting_part' }),
          items: parts.map((r) => ({
            id: r.id,
            title: r.ticket_no || 'Ticket',
            subtitle: r.org,
            meta: `Waiting since ${shortDay(day(r.updated_at)!)}`,
            tone: 'warning',
            href: href('/service', { open: r.id }),
          })),
        }),
      );
    }
    return out;
  }

  /* -------------------------------------------------------------------- team -- */
  private async team(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const overdueHref = (assignee?: string) => href('/tasks/team', { view: 'all', statuses: 'overdue', assignee_ids: assignee });
    const reportHref = href('/reports/productivity', { from: c.from, to: c.to });
    const [overdue, worst, blockers, report] = await Promise.all([
      this.one(sql`select count(*)::int as c from tasks k where ${TASK_OVERDUE}`),
      want.has('tasks_overdue')
        ? this.rows(sql`
            select u.id, u.full_name, count(*)::int as n
            from tasks k join users u on u.id = k.assigned_to where ${TASK_OVERDUE}
            group by u.id, u.full_name order by n desc, u.full_name asc limit 3`)
        : Promise.resolve([]),
      want.has('blockers')
        ? this.one(sql`
            select count(*)::int as c, min(b.created_at) as oldest
            from task_blockers b join tasks k on k.id = b.task_id where b.status = 'pending_review'`)
        : Promise.resolve({} as Row),
      want.has('attention') || want.has('productivity') ? this.productivity.report(c.user, { from: c.from, to: c.to }) : Promise.resolve(null),
    ]);

    const out: CommandMetric[] = [];
    if (want.has('tasks_overdue')) {
      const n = num(overdue.c);
      out.push(
        metric('tasks_overdue', {
          value: n,
          tone: actionTone(n),
          href: overdueHref(),
          breakdown: worst.map((r) => ({ label: r.full_name, value: num(r.n), tone: 'warning', href: overdueHref(r.id) })),
        }),
      );
    }
    if (want.has('blockers')) {
      const n = num(blockers.c);
      const waitingDays = blockers.oldest ? Math.floor((Date.now() - new Date(blockers.oldest).getTime()) / 864e5) : 0;
      out.push(
        metric('blockers', {
          value: n,
          detail: n ? (waitingDays ? `Oldest waiting ${plural(waitingDays, 'day')}` : 'Oldest raised today') : null,
          tone: actionTone(n),
          href: href('/tasks/blockers', { scope: 'all' }),
        }),
      );
    }
    if (report && want.has('attention')) {
      const n = report.totals.needing_attention;
      out.push(
        metric('attention', {
          value: n,
          detail: `Out of ${plural(report.totals.employees, 'person', 'people')}`,
          tone: actionTone(n),
          href: reportHref,
          items: report.rows
            .filter((r) => r.attention.length > 0)
            .slice(0, 5)
            .map((r) => ({ id: r.employee_id, title: r.name, subtitle: r.attention.join(' · '), meta: human(r.role), tone: 'warning', href: reportHref })),
        }),
      );
    }
    if (report && want.has('productivity')) {
      const t = report.totals.tasks;
      out.push(
        metric('productivity', {
          value: t.on_time_pct,
          display: t.on_time_pct == null ? '—' : `${t.on_time_pct}%`,
          detail: t.completed ? `${plural(t.on_time, 'task')} of ${t.completed.toLocaleString('en-IN')} finished on time` : 'No tasks finished in the period',
          tone: 'neutral',
          href: reportHref,
        }),
      );
    }
    return out;
  }

  /* ---------------------------------------------------------------- expenses -- */
  private async expenses(c: Ctx, want: Set<string>): Promise<CommandMetric[]> {
    const rejectedDay = istDay(sql`coalesce(c.accounts_actioned_at, c.manager_actioned_at, c.updated_at)`);
    const r = await this.one(sql`
      select count(*) filter (where c.status = any(${EXPENSE_STAGE1}::text[]))::int as stage1,
             coalesce(sum(c.total_claimed) filter (where c.status = any(${EXPENSE_STAGE1}::text[])), 0)::float as stage1_amt,
             count(*) filter (where c.status = any(${EXPENSE_ACCOUNTS}::text[]))::int as stage2,
             coalesce(sum(c.total_claimed) filter (where c.status = any(${EXPENSE_ACCOUNTS}::text[])), 0)::float as stage2_amt,
             count(*) filter (where c.status = 'submitted' and exists (select 1 from users mu where mu.id = c.manager_id and mu.is_active = false))::int as orphaned,
             count(*) filter (where c.status = 'rejected' and ${rejectedDay} between ${c.from}::date and ${c.to}::date)::int as rejected,
             count(*) filter (where c.status = 'rejected' and ${rejectedDay} between ${c.from}::date and ${c.to}::date and c.accounts_actioned_at is not null)::int as rejected_accounts,
             coalesce(sum(c.total_claimed) filter (where c.status = 'rejected' and ${rejectedDay} between ${c.from}::date and ${c.to}::date), 0)::float as rejected_amt,
             count(*) filter (where c.status = 'clarification_required')::int as clarify,
             count(*) filter (where c.status = 'draft' and c.updated_at < now() - make_interval(days => ${DRAFT_STALE_DAYS}))::int as stale_drafts
      from expense_claims c where c.deleted_at is null`);

    const out: CommandMetric[] = [];
    if (want.has('pending_approvals')) {
      const stage1 = num(r.stage1);
      const stage2 = num(r.stage2);
      const orphaned = num(r.orphaned);
      out.push(
        metric('pending_approvals', {
          value: stage1 + stage2,
          detail: orphaned
            ? `${plural(orphaned, 'claim')} stuck with a deactivated manager`
            : stage1 + stage2
              ? `${rupees(num(r.stage1_amt) + num(r.stage2_amt))} claimed`
              : null,
          tone: actionTone(stage1 + stage2, orphaned > 0),
          href: null,
          breakdown: [
            { label: 'With managers', value: stage1, display: countAndAmount(stage1, num(r.stage1_amt)) },
            { label: 'With accounts', value: stage2, display: countAndAmount(stage2, num(r.stage2_amt)), href: href('/expenses', { stage: 'accounts' }) },
          ],
        }),
      );
    }
    if (want.has('rejected')) {
      const n = num(r.rejected);
      const byAccounts = num(r.rejected_accounts);
      out.push(
        metric('rejected', {
          value: n,
          detail: n ? `${rupees(num(r.rejected_amt))} claimed` : null,
          tone: 'neutral',
          href: null,
          breakdown: n
            ? [
                { label: 'By managers', value: n - byAccounts },
                { label: 'By accounts', value: byAccounts },
              ]
            : [],
        }),
      );
    }
    if (want.has('outstanding')) {
      const clarify = num(r.clarify);
      const drafts = num(r.stale_drafts);
      out.push(
        metric('outstanding', {
          value: clarify + drafts,
          tone: actionTone(clarify + drafts),
          href: null,
          breakdown: [
            { label: 'Sent back for clarification', value: clarify },
            { label: `Drafts untouched ${DRAFT_STALE_DAYS}+ days`, value: drafts },
          ],
        }),
      );
    }
    return out;
  }
}
