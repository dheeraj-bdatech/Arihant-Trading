import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import {
  CLOSED_LEAD_STATUSES,
  PROPOSAL_STATUS_LABELS,
  TENDER_STATUSES,
  TENDER_STATUS_LABELS,
  type AuthUser,
  type Database,
  type PipelineBreakdownRow,
  type PipelineGroupBy,
  type PipelineModule,
  type PipelineModuleKey,
  type ReportCount,
  type SalesPipelineReportDto,
} from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import {
  DEMO_DAY,
  LEAD_ACTIVE,
  LEAD_VALUE,
  PROPOSAL_ORG,
  PROPOSAL_OUTCOME_DAY,
  PROPOSAL_OWNER,
  TENDER_DONE,
  TENDER_OWNER,
  TENDER_RESULT_DAY,
  TENDER_ROW,
  TENDER_SUBMITTED,
  TENDER_SUBMITTED_DAY,
  istDay,
  territoryLeads,
  territoryTenders,
  territoryVisits,
} from '../dashboard/dashboard-metrics.js';
import { num, parseReportPeriod, pct, rate, resolveTerritory, territoryOwned } from './report-scope.js';

type Cond = RawBuilder<unknown>;
type Row = Record<string, any>;

const TOTAL = '__total__';
const NONE = 'none';
const LAKH = 100000;

const LEAD_CONVERTED = ['converted', 'won'];
const LEAD_ORDER = ['new', 'contacted', 'qualified', 'follow_up', 'demo', 'proposal', 'quoted', 'tender_discussion', 'negotiation', 'open', 'on_hold', 'converted', 'won', 'lost', 'dropped'];
const VISIT_ORDER = ['planned', 'modified', 'rescheduled', 'completed', 'not_completed', 'cancelled'];
const VISIT_TERMINAL = ['completed', 'not_completed', 'cancelled'];
const DEMO_ORDER = ['requested', 'under_planning', 'confirmed', 'equipment_reserved', 'team_assigned', 'rescheduled', 'completed', 'cancelled'];
const DEMO_TERMINAL = ['completed', 'cancelled'];
const PROPOSAL_ORDER = ['PROPOSAL_REQUESTED', 'UNDER_PREPARATION', 'READY_FOR_REVIEW', 'APPROVED', 'SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'CONVERTED', 'LOST', 'CLOSED'];
const PROPOSAL_TERMINAL = ['CONVERTED', 'LOST', 'CLOSED'];
/** Statuses that mean the proposal reached the customer. */
const PROPOSAL_SENT_STATUSES = ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED', 'CONVERTED', 'LOST'];
/** Tenders past identification / internal approval: someone is working the bid. */
const TENDER_NOT_WORKED = ['identified', 'awaiting_approval', 'rejected_internally'];

/** Current proposal stage, with the legacy lower-case statuses folded onto the workflow codes. */
const PROPOSAL_STAGE = sql`case upper(coalesce(p.status, ''))
  when '' then 'PROPOSAL_REQUESTED' when 'REQUESTED' then 'PROPOSAL_REQUESTED'
  when 'SENT' then 'SENT_TO_CUSTOMER' when 'FOLLOWUP_REQUIRED' then 'FOLLOW_UP_REQUIRED'
  else upper(p.status) end`;
const TENDER_VALUE = sql`greatest(coalesce(t.tender_value, t.estimated_value, 0), 0)`;

const sentence = (code: string) => {
  const t = code.replace(/_/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Report 1 — Sales pipeline & conversion (GET /reports/sales-pipeline).
 *
 * Period rules (IST days) follow Module 9 so a figure here and on Salesperson & Regional Performance agree:
 * leads by created date, visits by planned date, demos by held date (confirmed → requested → logged), proposals
 * requested / sent / decided on their own dates, tenders identified (created) / submitted / decided likewise.
 * Snapshots (open lead value, open proposal value, live tender value) are as of now and ignore the period.
 *
 * Breakdown attribution: each record has exactly one owner (lead / visit assignee, demo requester, proposal
 * responsible person, tender salesperson) and one territory (customer organisation, or the tender's own tags, falling
 * back to the owner's home zone / region), so the rows add up to the totals.
 */
@Injectable()
export class PipelineReportService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async report(user: AuthUser, q: Record<string, unknown>): Promise<SalesPipelineReportDto> {
    const period = parseReportPeriod(q.from, q.to);
    const groupBy: PipelineGroupBy = q.group_by === 'region' || q.group_by === 'salesperson' ? q.group_by : 'zone';
    const { territory, filters } = await resolveTerritory(this.db, user, q.zone_id, q.region_id);
    const { from, to } = period;
    const inP = (day: Cond) => sql`${day} between ${from}::date and ${to}::date`;

    /** Breakdown key of a record: its owner, or its territory falling back to the owner's (ow) home territory. */
    const key = (owner: Cond, zone: Cond, region: Cond) =>
      groupBy === 'salesperson'
        ? sql`coalesce(${owner}::text, ${NONE})`
        : groupBy === 'region'
          ? sql`coalesce(${region}::text, ow.region_id::text, ${NONE})`
          : sql`coalesce(${zone}::text, ow.zone_id::text, ${NONE})`;

    // ── One row per record in scope, with the flags every aggregate below reads ──
    const leads = sql`
      select ${key(sql`l.assigned_to`, sql`o.zone_id`, sql`o.region_id`)} as key, l.id,
             ${inP(istDay(sql`l.created_at`))} as created,
             lower(coalesce(l.lead_status, l.status, 'new')) as st,
             ${LEAD_ACTIVE} as open, ${LEAD_VALUE} * ${LAKH} as value,
             nullif(lower(trim(l.loss_reason)), '') as reason
      from leads l left join organisations o on o.id = l.organisation_id left join users ow on ow.id = l.assigned_to
      where ${territoryLeads(territory)}`;
    const visits = sql`
      select ${key(sql`v.assigned_to`, sql`o.zone_id`, sql`o.region_id`)} as key, v.id, v.status as st
      from visits v left join organisations o on o.id = v.organisation_id left join users ow on ow.id = v.assigned_to
      where ${territoryVisits(territory)} and ${inP(sql`v.planned_date`)}`;
    const demos = sql`
      select ${key(sql`d.requested_by`, sql`o.zone_id`, sql`o.region_id`)} as key, d.id, d.status as st, oc.result,
             coalesce(oc.failure_reason, 'UNSPECIFIED') as reason
      from demos d left join organisations o on o.id = d.organisation_id left join users ow on ow.id = d.requested_by
      left join lateral (select x.result, x.failure_reason from demo_outcomes x where x.demo_id = d.id order by x.created_at desc limit 1) oc on true
      where ${territoryOwned(territory, sql`d.requested_by`)} and ${inP(DEMO_DAY)}`;
    const proposals = sql`
      select ${key(PROPOSAL_OWNER, sql`o.zone_id`, sql`o.region_id`)} as key, p.id, ${PROPOSAL_STAGE} as st,
             greatest(coalesce(p.quoted_value, 0), 0) as value,
             ${inP(sql`coalesce(p.request_date, ${istDay(sql`p.created_at`)})`)} as requested,
             p.sent_date is not null and ${inP(sql`p.sent_date`)} as sent,
             ${inP(PROPOSAL_OUTCOME_DAY)} as decided,
             nullif(lower(trim(coalesce(p.lost_reason_code, p.lost_reason))), '') as reason
      from proposals p left join organisations o on o.id = ${PROPOSAL_ORG} left join users ow on ow.id = ${PROPOSAL_OWNER}
      where coalesce(p.is_deleted, false) = false and ${territoryOwned(territory, PROPOSAL_OWNER)}`;
    const tenders = sql`
      select ${key(TENDER_OWNER, sql`t.zone_id`, sql`t.region_id`)} as key, t.id, t.status as st, t.category::text as category,
             ${TENDER_VALUE} as value,
             ${inP(istDay(sql`t.created_at`))} as created,
             t.status = any(${TENDER_SUBMITTED}::text[]) and ${inP(TENDER_SUBMITTED_DAY)} as submitted,
             ${inP(TENDER_RESULT_DAY)} as decided,
             nullif(lower(trim(t.loss_reason)), '') as reason
      from tenders t left join users ow on ow.id = ${TENDER_OWNER}
      where ${TENDER_ROW} and ${territoryTenders(territory)}`;

    const [
      leadBy, leadStages, leadReasons,
      visitBy, visitStages,
      demoBy, demoStages, demoReasons,
      propBy, propStages, propReasons,
      tenderBy, tenderStages, tenderReasons,
      journey,
    ] = await Promise.all([
      this.byKey(leads, sql`
        count(*) filter (where s.created)::int as created,
        count(*) filter (where s.created and s.st = any(${LEAD_CONVERTED}::text[]))::int as converted,
        count(*) filter (where s.open)::int as open,
        coalesce(sum(s.value) filter (where s.open), 0)::float as open_value`),
      this.byStage(leads, sql`s.created`, true),
      this.reasons(leads, sql`s.created and s.st in ('lost', 'dropped')`),
      this.byKey(visits, sql`
        count(*) filter (where s.st = 'completed')::int as completed,
        count(*) filter (where s.st <> 'cancelled')::int as held`),
      this.byStage(visits, sql`true`, false),
      this.byKey(demos, sql`
        count(*) filter (where s.st = 'completed')::int as completed,
        count(*) filter (where s.st = 'completed' and s.result = 'success')::int as successful`),
      this.byStage(demos, sql`true`, false),
      this.reasons(demos, sql`s.st <> 'cancelled' and s.result in ('fail', 'partial')`),
      this.byKey(proposals, sql`
        count(*) filter (where s.sent)::int as sent,
        count(*) filter (where s.decided and s.st = 'CONVERTED')::int as converted,
        count(*) filter (where s.decided and s.st = 'LOST')::int as lost,
        coalesce(sum(s.value) filter (where s.decided and s.st = 'CONVERTED'), 0)::float as converted_value,
        coalesce(sum(s.value) filter (where s.st <> all(${PROPOSAL_TERMINAL}::text[])), 0)::float as open_value`),
      this.byStage(proposals, sql`s.requested`, true),
      this.reasons(proposals, sql`s.decided and s.st = 'LOST'`),
      this.byKey(tenders, sql`
        count(*) filter (where s.created)::int as identified,
        count(*) filter (where s.created and s.category = 'pq')::int as pq,
        count(*) filter (where s.created and s.category = 'general_mha')::int as general_mha,
        count(*) filter (where s.created and s.st <> all(${TENDER_NOT_WORKED}::text[]))::int as worked_upon,
        count(*) filter (where s.created and s.st <> all(${TENDER_DONE}::text[]))::int as pending,
        count(*) filter (where s.submitted)::int as submitted,
        count(*) filter (where s.decided and s.st = 'won')::int as won,
        count(*) filter (where s.decided and s.st = 'lost')::int as lost,
        coalesce(sum(s.value) filter (where s.decided and s.st = 'won'), 0)::float as won_value,
        coalesce(sum(s.value) filter (where s.st <> all(${TENDER_DONE}::text[])), 0)::float as live_value`),
      this.byStage(tenders, sql`s.created`, true),
      this.reasons(tenders, sql`s.decided and s.st = 'lost'`),
      this.journey(territoryLeads(territory), inP),
    ]);

    const L = leadBy.get(TOTAL) ?? {};
    const V = visitBy.get(TOTAL) ?? {};
    const D = demoBy.get(TOTAL) ?? {};
    const P = propBy.get(TOTAL) ?? {};
    const T = tenderBy.get(TOTAL) ?? {};
    const identified = num(T.identified);

    const modules: PipelineModule[] = [
      this.module('leads', 'Leads', 'Created in the period', leadStages, LEAD_ORDER, [...CLOSED_LEAD_STATUSES], sentence, true),
      this.module('visits', 'Visits', 'Planned for a date in the period', visitStages, VISIT_ORDER, VISIT_TERMINAL, sentence, false),
      this.module('demos', 'Demos', 'Held (confirmed, else requested date) in the period', demoStages, DEMO_ORDER, DEMO_TERMINAL, sentence, false),
      this.module('proposals', 'Proposals', 'Requested in the period', propStages, PROPOSAL_ORDER, PROPOSAL_TERMINAL, (k) => PROPOSAL_STATUS_LABELS[k] ?? sentence(k), true),
      this.module('tenders', 'Tenders', 'Identified (logged) in the period', tenderStages, TENDER_STATUSES, TENDER_DONE, (k) => TENDER_STATUS_LABELS[k] ?? sentence(k), true),
    ];

    const created = num(journey.created);
    const step = (k: SalesPipelineReportDto['journey'][number]['key'], label: string, count: number) => ({ key: k, label, count, share: pct(count, created) });

    return {
      period,
      group_by: groupBy,
      filters,
      rates: {
        lead_conversion: rate(num(L.converted), num(L.created)),
        visit_completion: rate(num(V.completed), num(V.held)),
        demo_success: rate(num(D.successful), num(D.completed)),
        proposal_win: rate(num(P.converted), num(P.converted) + num(P.lost)),
        tender_win: rate(num(T.won), num(T.won) + num(T.lost)),
      },
      values: {
        open_leads: Math.round(num(L.open_value)),
        open_proposals: Math.round(num(P.open_value)),
        live_tenders: Math.round(num(T.live_value)),
        tenders_won: Math.round(num(T.won_value)),
        proposals_converted: Math.round(num(P.converted_value)),
      },
      journey: [
        step('created', 'Leads created', created),
        step('visited', 'Customer visited', num(journey.visited)),
        step('demo', 'Demo held', num(journey.demo)),
        step('proposal', 'Proposal sent', num(journey.proposal)),
        step('tender', 'Bid submitted', num(journey.tender)),
        step('converted', 'Converted / won', num(journey.converted)),
      ],
      modules,
      tender: {
        identified,
        pq: num(T.pq),
        general_mha: num(T.general_mha),
        other: identified - num(T.pq) - num(T.general_mha),
        worked_upon: num(T.worked_upon),
        submitted: num(T.submitted),
        won: num(T.won),
        lost: num(T.lost),
        pending: num(T.pending),
        win_rate: pct(num(T.won), num(T.won) + num(T.lost)),
      },
      loss_reasons: { leads: leadReasons, demos: demoReasons, proposals: propReasons, tenders: tenderReasons },
      breakdown: await this.breakdown(groupBy, filters, territory.managerId ?? null, { leadBy, visitBy, demoBy, propBy, tenderBy }),
      generated_at: new Date().toISOString(),
    };
  }

  /** Aggregates per breakdown key plus a grand total (under TOTAL). */
  private async byKey(src: Cond, aggs: Cond): Promise<Map<string, Row>> {
    const res = await sql<Row>`
      select grouping(s.key) as g, s.key, ${aggs}
      from (${src}) s group by grouping sets ((s.key), ())`.execute(this.db);
    return new Map(res.rows.map((r) => [num(r.g) === 1 ? TOTAL : String(r.key), r]));
  }

  private async byStage(src: Cond, where: Cond, withValue: boolean): Promise<Map<string, { count: number; value: number | null }>> {
    const res = await sql<Row>`
      select s.st, count(*)::int as c, ${withValue ? sql`coalesce(sum(s.value), 0)::float` : sql`null::float`} as v
      from (${src}) s where ${where} group by s.st`.execute(this.db);
    return new Map(res.rows.map((r) => [String(r.st ?? ''), { count: num(r.c), value: r.v === null ? null : Math.round(num(r.v)) }]));
  }

  private async reasons(src: Cond, where: Cond): Promise<ReportCount[]> {
    const res = await sql<Row>`
      select coalesce(s.reason, 'unspecified') as reason, count(*)::int as c
      from (${src}) s where ${where} group by 1 order by 2 desc, 1 limit 8`.execute(this.db);
    return res.rows.map((r) => ({ key: String(r.reason), label: sentence(String(r.reason)), count: num(r.c) }));
  }

  /** Lead journey over the leads created in the period (see PipelineJourneyStep). */
  private async journey(leadScope: Cond, inP: (day: Cond) => Cond): Promise<Row> {
    const res = await sql<Row>`
      with c as (
        select l.id, l.organisation_id as org, ${istDay(sql`l.created_at`)} as day,
               lower(coalesce(l.lead_status, l.status, '')) = any(${LEAD_CONVERTED}::text[]) as conv
        from leads l left join organisations o on o.id = l.organisation_id
        where ${leadScope} and ${inP(istDay(sql`l.created_at`))}
      )
      select count(*)::int as created,
        count(*) filter (where exists (
          select 1 from visits v where v.organisation_id = c.org and v.status = 'completed' and v.planned_date >= c.day))::int as visited,
        count(*) filter (where exists (
          select 1 from demos d where d.status = 'completed'
            and (d.lead_id = c.id or (d.lead_id is null and d.organisation_id = c.org and ${DEMO_DAY} >= c.day))))::int as demo,
        count(*) filter (where exists (
          select 1 from proposals p where coalesce(p.is_deleted, false) = false
            and (p.sent_date is not null or ${PROPOSAL_STAGE} = any(${PROPOSAL_SENT_STATUSES}::text[]))
            and (p.lead_id = c.id or (p.lead_id is null and ${PROPOSAL_ORG} = c.org
                 and coalesce(p.request_date, ${istDay(sql`p.created_at`)}) >= c.day))))::int as proposal,
        count(*) filter (where exists (
          select 1 from tenders t where ${TENDER_ROW} and t.organisation_id = c.org
            and t.status = any(${TENDER_SUBMITTED}::text[]) and ${TENDER_SUBMITTED_DAY} >= c.day))::int as tender,
        count(*) filter (where c.conv)::int as converted
      from c`.execute(this.db);
    return res.rows[0] ?? {};
  }

  /** Stage list in workflow order; statuses outside the known order follow at the end. */
  private module(
    key: PipelineModuleKey,
    label: string,
    basis: string,
    stages: Map<string, { count: number; value: number | null }>,
    order: readonly string[],
    terminal: readonly string[],
    stageLabel: (code: string) => string,
    withValue: boolean,
  ): PipelineModule {
    const codes = [...order.filter((s) => stages.has(s)), ...[...stages.keys()].filter((s) => !order.includes(s)).sort()];
    const list = codes.map((code) => ({
      key: code,
      label: code ? stageLabel(code) : 'Not set',
      count: stages.get(code)!.count,
      value: withValue ? (stages.get(code)!.value ?? 0) : null,
      terminal: terminal.includes(code),
    }));
    return {
      key,
      label,
      period_basis: basis,
      total: list.reduce((a, s) => a + s.count, 0),
      value: withValue ? list.reduce((a, s) => a + (s.value ?? 0), 0) : null,
      stages: list,
    };
  }

  /**
   * One row per zone / region / salesperson in scope (zero rows included, so a quiet territory or rep is visible),
   * plus any other key records landed on, and a "none" row when something has no territory / owner.
   */
  private async breakdown(
    groupBy: PipelineGroupBy,
    filters: SalesPipelineReportDto['filters'],
    managerId: string | null,
    m: Record<'leadBy' | 'visitBy' | 'demoBy' | 'propBy' | 'tenderBy', Map<string, Row>>,
  ): Promise<SalesPipelineReportDto['breakdown']> {
    const dataKeys = new Set<string>();
    for (const map of Object.values(m)) for (const k of map.keys()) if (k !== TOTAL) dataKeys.add(k);

    const [zones, regions] = await Promise.all([
      this.db.selectFrom('zones').select(['id', 'name']).execute(),
      this.db.selectFrom('regions').select(['id', 'name', 'zone_id']).execute(),
    ]);
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const regionOf = new Map(regions.map((r) => [r.id, r]));

    type Head = Pick<PipelineBreakdownRow, 'key' | 'label' | 'zone_name' | 'region_name'>;
    const heads = new Map<string, Head>();
    if (groupBy === 'zone') {
      for (const z of filters.zones) heads.set(z.id, { key: z.id, label: z.name, zone_name: z.name, region_name: null });
      for (const k of dataKeys) if (!heads.has(k)) heads.set(k, { key: k, label: zoneName.get(k) ?? 'No zone', zone_name: zoneName.get(k) ?? null, region_name: null });
    } else if (groupBy === 'region') {
      const base = filters.region_id ? filters.regions.filter((r) => r.id === filters.region_id) : filters.regions;
      for (const r of base) heads.set(r.id, { key: r.id, label: r.name, zone_name: (r.zone_id && zoneName.get(r.zone_id)) || null, region_name: r.name });
      for (const k of dataKeys) {
        if (heads.has(k)) continue;
        const r = regionOf.get(k);
        heads.set(k, { key: k, label: r?.name ?? 'No region', zone_name: (r?.zone_id && zoneName.get(r.zone_id)) || null, region_name: r?.name ?? null });
      }
    } else {
      // Active sales reps / regional managers in scope, plus every other owner records landed on.
      const people = sql`u.is_active and u.role::text in ('sales', 'regional_manager')
        and ${filters.zone_id ? sql`u.zone_id = ${filters.zone_id}` : sql`true`}
        and ${filters.region_id ? sql`u.region_id = ${filters.region_id}` : sql`true`}
        and ${managerId ? sql`(u.id = ${managerId} or u.reporting_manager_id = ${managerId} or u.zone_id = ${filters.zone_id})` : sql`true`}`;
      const ids = [...dataKeys].filter((k) => k !== NONE);
      const res = await sql<Row>`
        select u.id, u.full_name, r.name as region_name, z.name as zone_name
        from users u left join regions r on r.id = u.region_id left join zones z on z.id = coalesce(u.zone_id, r.zone_id)
        where (${people}) or u.id::text = any(${ids}::text[])`.execute(this.db);
      for (const u of res.rows) heads.set(String(u.id), { key: String(u.id), label: u.full_name, zone_name: u.zone_name ?? null, region_name: u.region_name ?? null });
      if (dataKeys.has(NONE)) heads.set(NONE, { key: NONE, label: 'Unassigned', zone_name: null, region_name: null });
    }

    const figures = (k: string): Omit<PipelineBreakdownRow, keyof Head> => {
      const l = m.leadBy.get(k) ?? {};
      const v = m.visitBy.get(k) ?? {};
      const d = m.demoBy.get(k) ?? {};
      const p = m.propBy.get(k) ?? {};
      const t = m.tenderBy.get(k) ?? {};
      return {
        leads_created: num(l.created),
        leads_converted: num(l.converted),
        lead_conversion_rate: pct(num(l.converted), num(l.created)),
        open_leads: num(l.open),
        open_lead_value: Math.round(num(l.open_value)),
        visits_completed: num(v.completed),
        demos_completed: num(d.completed),
        demos_successful: num(d.successful),
        proposals_sent: num(p.sent),
        proposals_converted: num(p.converted),
        proposals_lost: num(p.lost),
        tenders_submitted: num(t.submitted),
        tenders_won: num(t.won),
        tenders_lost: num(t.lost),
        tender_win_rate: pct(num(t.won), num(t.won) + num(t.lost)),
        tender_won_value: Math.round(num(t.won_value)),
        live_tender_value: Math.round(num(t.live_value)),
      };
    };

    const rows = [...heads.values()]
      .map((h) => ({ ...h, ...figures(h.key) }))
      .sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.label.localeCompare(b.label)));
    const totalLabel = groupBy === 'salesperson' ? 'All salespeople' : groupBy === 'region' ? 'All regions' : 'All zones';
    return { rows, totals: { key: TOTAL, label: totalLabel, zone_name: null, region_name: null, ...figures(TOTAL) } };
  }
}
