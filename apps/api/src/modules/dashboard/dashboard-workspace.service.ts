import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { addIsoDays, todayInKolkata } from '../../common/utils/ist-date.util.js';
import type { AuthUser, Database, DashboardWorkspaceDto, WorkspaceItem, WorkspaceTone } from '@arihant/shared';
import {
  DashboardMetricsService,
  LEAD_ACTIVE,
  LEAD_VALUE,
  TENDER_AWAITING_APPROVAL,
  TENDER_DEADLINE,
  TENDER_DONE,
  TENDER_ROW,
  VISIT_OPEN,
  teamScope,
  tenderClosingWithin,
  tenderScopeFor,
  territoryLeads,
  territoryVisits,
} from './dashboard-metrics.js';
import { TICKET_CLOSURE_SECONDS } from '../service/service.core.js';

/**
 * GET /dashboard/workspace — each role's own home screen (Blueprint §5 role matrix, §34 service KPIs,
 * §45 executive command buckets). Every figure is scoped like the module screens it links to:
 * management / admin / tender / accounts desks see all India, a regional manager sees the zone and
 * the team, field roles see their own records.
 */
type Section = Omit<DashboardWorkspaceDto, 'role' | 'generatedAt'>;
type Row = Record<string, any>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const human = (s: unknown) => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Pipeline, tender, visit and task definitions live in dashboard-metrics.ts — the same ones Zonal Command uses.
const TENDER_EVAL = ['pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval'];
const TICKET_DONE = ['resolved', 'report_submitted', 'closed', 'cancelled'];
const PROPOSAL_DONE = ['CONVERTED', 'CLOSED', 'LOST'];
const DEMO_DONE = ['completed', 'cancelled'];
const RESERVATION_DONE = ['rejected', 'cancelled', 'released', 'returned', 'completed'];
const FIELD_ROLES = ['sales', 'demo_team', 'service_team'];

const DEADLINE = TENDER_DEADLINE;
const TENDER_LIVE = TENDER_ROW;
const TICKET_OPEN = sql`s.deleted_at is null and s.status <> all(${TICKET_DONE}::text[])`;
/** Resolution SLA missed with the clock running: a ticket paused for a part / the customer / on hold is not late. */
const TICKET_PAUSED = ['awaiting_part', 'awaiting_customer', 'on_hold'];
const TICKET_SLA_LATE = sql`s.sla_resolution_due_at < now() and s.status <> all(${TICKET_PAUSED}::text[])`;
const LEAD_OPEN = LEAD_ACTIVE;

/** Deep links open the record itself (each list page reads ?open= / ?highlight= via useOpenParam). */
const link = {
  tender: (id: string) => `/tenders?highlight=${id}`,
  ticket: (id: string) => `/service?open=${id}`,
  lead: (id: string) => `/leads?open=${id}`,
  proposal: (id: string) => `/proposals?open=${id}`,
  demo: (id: string) => `/demos?open=${id}`,
  /** Visits have no single-record view; the customer's visit history is the closest record. */
  visitsAt: (orgId: string | null | undefined) => (orgId ? `/visits?customer=${orgId}` : '/visits'),
};

const ticketTone = (priority: string, due: unknown): WorkspaceTone => {
  if (due && new Date(String(due)).getTime() < Date.now()) return 'critical';
  if (priority === 'critical') return 'critical';
  if (priority === 'high') return 'warning';
  return 'info';
};
const deadlineTone = (date: unknown): WorkspaceTone => {
  const ms = new Date(String(date)).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'neutral';
  if (ms <= 48 * 3600e3) return 'critical';
  if (ms <= 7 * 864e5) return 'warning';
  return 'info';
};

@Injectable()
export class DashboardWorkspaceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly metrics: DashboardMetricsService,
  ) {}

  async getWorkspace(user: AuthUser): Promise<DashboardWorkspaceDto> {
    const build: Record<string, (u: AuthUser) => Promise<Section>> = {
      management: (u) => this.management(u),
      regional_manager: (u) => this.regional(u),
      sales: (u) => this.sales(u),
      tender_team: (u) => this.tender(u),
      demo_team: (u) => this.demo(u),
      service_team: (u) => this.service(u),
      accounts: (u) => this.accounts(u),
      admin: (u) => this.admin(u),
    };
    const section = await (build[user.role] ?? build.management)(user);
    return { role: user.role, generatedAt: new Date().toISOString(), ...section };
  }

  private async rows(query: RawBuilder<unknown>): Promise<Row[]> {
    const res = await query.execute(this.db);
    return res.rows as Row[];
  }
  private async one(query: RawBuilder<unknown>): Promise<Row> {
    return (await this.rows(query))[0] ?? {};
  }

  private async zoneName(zoneId: string | null | undefined): Promise<string | null> {
    if (!zoneId) return null;
    const z = await this.one(sql`select name from zones where id = ${zoneId}`);
    return z.name ?? null;
  }

  /* -------------------------------------------------------------- shared lists -- */
  private async closingTenders(scope: RawBuilder<unknown>, days: number, limit: number): Promise<WorkspaceItem[]> {
    const list = await this.rows(sql`
      select t.id, t.tender_no, t.status, t.emd_fee, coalesce(o.name, t.department) as buyer, ${DEADLINE} as deadline
      from tenders t left join organisations o on o.id = t.organisation_id
      where ${TENDER_LIVE} and ${tenderClosingWithin(days * 24)} and ${scope}
      order by ${DEADLINE} asc limit ${limit}`);
    return list.map((r) => ({
      id: r.id,
      title: r.tender_no || 'Tender',
      subtitle: r.buyer,
      date: iso(r.deadline),
      status: human(r.status),
      tone: deadlineTone(r.deadline),
      amount: r.emd_fee == null ? null : num(r.emd_fee),
      href: link.tender(r.id),
    }));
  }

  private tenderScope(user: AuthUser): RawBuilder<unknown> {
    return tenderScopeFor(user);
  }

  private async blockers(scope: RawBuilder<unknown>, limit: number): Promise<WorkspaceItem[]> {
    const list = await this.rows(sql`
      select b.id, b.blocker_type, b.description, b.created_at, k.id as task_id, k.title, u.full_name as raised_by
      from task_blockers b join tasks k on k.id = b.task_id left join users u on u.id = b.raised_by
      where b.status = 'pending_review' and ${scope}
      order by b.created_at asc limit ${limit}`);
    return list.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: `${human(r.blocker_type)}${r.description ? ` — ${r.description}` : ''}`,
      date: iso(r.created_at),
      tone: 'warning',
      meta: r.raised_by,
      href: `/tasks/${r.task_id}`,
    }));
  }

  /* -------------------------------------------------------------- management -- */
  private async management(_user: AuthUser): Promise<Section> {
    const today = todayInKolkata();
    const weekEnd = addIsoDays(today, 6);
    const [tenders, demos, conflicts, tickets, claims, blockers, leads, zones, closing, urgent, blockerList] = await Promise.all([
      this.metrics.tenderSummary(sql`true`),
      this.one(sql`
        select count(*) filter (where coalesce(d.confirmed_date, d.requested_date) between ${today}::date and ${weekEnd}::date and d.status <> all(${DEMO_DONE}::text[]))::int as week,
               count(*) filter (where d.status in ('requested', 'under_planning'))::int as pending
        from demos d`),
      this.one(sql`
        select count(*)::int as c from demo_reservations a
        join demo_reservations b on b.equipment_id = a.equipment_id and a.id < b.id
        where a.status <> all(${RESERVATION_DONE}::text[]) and b.status <> all(${RESERVATION_DONE}::text[])
          and coalesce(a.reserved_to, a.reserved_from) >= ${today}::date
          and coalesce(a.reserved_from, '-infinity'::date) <= coalesce(b.reserved_to, 'infinity'::date)
          and coalesce(b.reserved_from, '-infinity'::date) <= coalesce(a.reserved_to, 'infinity'::date)`),
      this.one(sql`
        select count(*) filter (where s.priority in ('critical', 'high'))::int as urgent,
               count(*) filter (where ${TICKET_SLA_LATE})::int as breached,
               count(*)::int as open
        from service_tickets s where ${TICKET_OPEN}`),
      this.one(sql`
        select count(*)::int as c, coalesce(sum(c.total_claimed), 0)::float as amt
        from expense_claims c where c.deleted_at is null and c.status in ('submitted', 'manager_approved', 'accounts_review', 'accounts_approved')`),
      this.one(sql`select count(*)::int as c from task_blockers b where b.status = 'pending_review'`),
      this.metrics.leadPipeline(sql`true`, today),
      this.rows(sql`
        select z.id, z.name,
               coalesce((select sum(${LEAD_VALUE}) from leads l join organisations o on o.id = l.organisation_id where o.zone_id = z.id and ${LEAD_OPEN}), 0)::float as lakh,
               (select count(*) from tenders t where t.zone_id = z.id and ${TENDER_LIVE} and t.status <> all(${TENDER_DONE}::text[]))::int as open_tenders
        from zones z order by lakh desc`),
      this.closingTenders(sql`true`, 7, 6),
      this.rows(sql`
        select s.id, s.ticket_no, s.priority, s.status, s.sla_resolution_due_at, o.name as org
        from service_tickets s left join organisations o on o.id = s.organisation_id
        where ${TICKET_OPEN} and s.priority in ('critical', 'high')
        order by (s.priority = 'critical') desc, s.sla_resolution_due_at asc nulls last limit 5`),
      this.blockers(sql`true`, 5),
    ]);

    return {
      scopeLabel: 'All India',
      numbers: {
        tendersClosing48h: tenders.closing48h,
        tendersClosing7d: tenders.closing7d,
        tendersAwaitingApproval: tenders.awaitingApproval,
        tendersWon: tenders.won,
        tendersLost: tenders.lost,
        tendersLive: tenders.live,
        tendersTotal: tenders.total,
        demosThisWeek: num(demos.week),
        demosPending: num(demos.pending),
        depotConflicts: num(conflicts.c),
        urgentTickets: num(tickets.urgent),
        slaBreached: num(tickets.breached),
        openTickets: num(tickets.open),
        expenseBatches: num(claims.c),
        expenseAmount: num(claims.amt),
        criticalBlockers: num(blockers.c),
        pipelineLakh: leads.lakh,
        openLeads: leads.active,
      },
      lists: {
        closing,
        urgentTickets: urgent.map((r) => ({
          id: r.id,
          title: r.ticket_no || 'Ticket',
          subtitle: r.org,
          date: iso(r.sla_resolution_due_at),
          status: human(r.status),
          tone: ticketTone(r.priority, r.sla_resolution_due_at),
          meta: human(r.priority),
          href: link.ticket(r.id),
        })),
        blockers: blockerList,
      },
      bars: {
        zones: zones.map((z) => ({ key: z.id, label: z.name, value: num(z.lakh), secondary: num(z.open_tenders) })),
      },
    };
  }

  /* -------------------------------------------------------- regional manager -- */
  private async regional(user: AuthUser): Promise<Section> {
    const today = todayInKolkata();
    const weekEnd = addIsoDays(today, 6);
    const zone = user.zone_id ?? null;
    // Same territory Zonal Command uses for this manager (GET /dashboard/regional-performance without a region).
    const territory = { zoneId: zone, managerId: user.id };
    const leadScope = territoryLeads(territory);
    const visitScope = territoryVisits(territory);
    const myClaims = sql`c.deleted_at is null and c.status = 'submitted' and (c.manager_id = ${user.id} or emp.reporting_manager_id = ${user.id})`;

    const [stage1, blockers, visits, leads, tenders, approvals, blockerList, agenda, team, zoneLabel] = await Promise.all([
      this.one(sql`select count(*)::int as c, coalesce(sum(c.total_claimed), 0)::float as amt from expense_claims c join users emp on emp.id = c.employee_id where ${myClaims}`),
      this.one(sql`select count(*)::int as c from task_blockers b join tasks k on k.id = b.task_id where b.status = 'pending_review' and (k.reporting_manager_id = ${user.id} or k.assigned_by = ${user.id})`),
      this.metrics.visitSummary(visitScope, today),
      this.metrics.leadPipeline(leadScope, today),
      this.metrics.tenderSummary(tenderScopeFor(user)),
      this.rows(sql`
        select c.id, c.claim_number, c.title, c.total_claimed, c.submitted_at, emp.full_name
        from expense_claims c join users emp on emp.id = c.employee_id where ${myClaims}
        order by c.submitted_at asc nulls last limit 6`),
      this.blockers(sql`(k.reporting_manager_id = ${user.id} or k.assigned_by = ${user.id})`, 5),
      this.rows(sql`
        select v.id, v.organisation_id, v.planned_date::text as day, v.start_time, v.purpose, v.status, o.name as org, rep.full_name as rep
        from visits v left join organisations o on o.id = v.organisation_id left join users rep on rep.id = v.assigned_to
        where v.status = any(${VISIT_OPEN}::text[]) and v.planned_date between ${today}::date and ${weekEnd}::date and ${visitScope}
        order by v.planned_date asc, v.start_time asc nulls last limit 8`),
      this.metrics.teamFigures(teamScope(user.id, zone), today),
      this.zoneName(zone),
    ]);
    const scorecard = [...team].sort((a, b) => b.pipelineLakh - a.pipelineLakh || a.full_name.localeCompare(b.full_name)).slice(0, 10);

    return {
      scopeLabel: zoneLabel ? `${zoneLabel} Zone` : 'Your team',
      numbers: {
        stage1Pending: num(stage1.c),
        stage1Amount: num(stage1.amt),
        blockersToReview: num(blockers.c),
        visitsToday: visits.today,
        visitsWeek: visits.week,
        visitsDone30d: visits.completed30d,
        visitsCompleted: visits.completed,
        visitsTotal: visits.total,
        visitsUpcoming: visits.upcoming,
        pipelineLakh: leads.lakh,
        openLeads: leads.active,
        followupsOverdue: leads.followupsOverdue,
        tendersClosing7d: tenders.closing7d,
        tendersLive: tenders.live,
        tendersWon: tenders.won,
        tendersLost: tenders.lost,
        teamSize: team.length,
      },
      lists: {
        approvals: approvals.map((r) => ({
          id: r.id,
          title: r.full_name,
          subtitle: `${r.claim_number}${r.title ? ` · ${r.title}` : ''}`,
          date: iso(r.submitted_at),
          amount: num(r.total_claimed),
          tone: 'warning',
          href: `/expenses/${r.id}`,
        })),
        blockers: blockerList,
        agenda: agenda.map((r) => ({
          id: r.id,
          title: r.org,
          subtitle: r.purpose,
          date: r.day,
          status: human(r.status),
          meta: [r.rep, r.start_time].filter(Boolean).join(' · ') || null,
          tone: r.day === today ? 'info' : 'neutral',
          href: link.visitsAt(r.organisation_id),
        })),
        team: scorecard.map((r) => ({
          id: r.id,
          title: r.full_name,
          subtitle: human(r.role),
          tone: r.tasksOverdue > 2 ? 'critical' : r.tasksOverdue > 0 ? 'warning' : 'success',
          figures: { openTasks: r.tasksOpen, overdue: r.tasksOverdue, visitsDone: r.visitsCompleted30d, pipelineLakh: r.pipelineLakh },
          href: '/regional',
        })),
      },
      bars: {},
    };
  }

  /* ------------------------------------------------------------------- sales -- */
  private async sales(user: AuthUser): Promise<Section> {
    const today = todayInKolkata();
    const weekEnd = addIsoDays(today, 6);
    const me = user.id;
    const myProposal = sql`(p.requested_by = ${me} or p.requested_by_id = ${me} or p.responsible_id = ${me} or p.responsible_person_id = ${me} or p.followup_owner_id = ${me} or p.follow_up_owner_id = ${me})`;
    const proposalOpen = sql`p.is_deleted = false and upper(p.status) <> all(${PROPOSAL_DONE}::text[])`;

    const [visits, leads, proposals, demos, claims, bids, agenda, followups, proposalList, demoList, funnel, tasks, tenders] = await Promise.all([
      this.metrics.visitSummary(sql`v.assigned_to = ${me}`, today),
      this.metrics.leadPipeline(sql`l.assigned_to = ${me}`, today),
      // Same visibility as GET /proposals for this role (own + region), so the card count matches the list it opens
      this.one(sql`
        select count(*)::int as c from proposals p left join organisations o on o.id = p.organisation_id
        where p.is_deleted = false and upper(p.status) in ('REQUESTED', 'PROPOSAL_REQUESTED')
          and (${myProposal}${user.region_id ? sql` or o.region_id = ${user.region_id}` : sql``})`),
      this.one(sql`select count(*)::int as c from demos d where d.requested_by = ${me} and d.status <> all(${DEMO_DONE}::text[])`),
      this.one(sql`
        select count(*) filter (where c.status in ('submitted', 'manager_approved', 'accounts_review', 'accounts_approved', 'clarification_required'))::int as live,
               coalesce(sum(c.total_claimed) filter (where c.status in ('submitted', 'manager_approved', 'accounts_review', 'accounts_approved', 'clarification_required')), 0)::float as amt,
               count(*) filter (where c.status = 'draft')::int as drafts,
               count(*) filter (where c.status = 'clarification_required')::int as clarify
        from expense_claims c where c.deleted_at is null and c.employee_id = ${me}`),
      this.closingTenders(this.tenderScope(user), 7, 4),
      this.rows(sql`
        select v.id, v.organisation_id, v.planned_date::text as day, v.start_time, v.purpose, v.status, v.location, o.name as org
        from visits v left join organisations o on o.id = v.organisation_id
        where v.assigned_to = ${me} and v.status = any(${VISIT_OPEN}::text[]) and v.planned_date between ${today}::date and ${weekEnd}::date
        order by v.planned_date asc, v.start_time asc nulls last limit 8`),
      this.rows(sql`
        select l.id, l.next_followup_date::text as day, l.value_lakh, o.name as org, pr.name as product
        from leads l join organisations o on o.id = l.organisation_id left join products pr on pr.id = l.product_id
        where l.assigned_to = ${me} and ${LEAD_OPEN} and l.next_followup_date is not null and l.next_followup_date <= ${addIsoDays(today, 3)}::date
        order by l.next_followup_date asc limit 6`),
      this.rows(sql`
        select p.id, p.proposal_number, p.status, p.required_date::text as day, o.name as org
        from proposals p left join organisations o on o.id = p.organisation_id
        where ${proposalOpen} and ${myProposal} order by p.required_date asc nulls last, p.updated_at desc limit 5`),
      this.rows(sql`
        select d.id, d.demo_no, d.status, coalesce(d.confirmed_date, d.requested_date)::text as day, d.location, o.name as org
        from demos d left join organisations o on o.id = d.organisation_id
        where d.requested_by = ${me} and d.status <> all(${DEMO_DONE}::text[])
        order by coalesce(d.confirmed_date, d.requested_date) asc nulls last limit 4`),
      this.rows(sql`select l.category, count(*)::int as c from leads l where l.assigned_to = ${me} and ${LEAD_OPEN} group by l.category`),
      this.metrics.taskFigures(sql`k.assigned_to = ${me}`),
      this.metrics.tenderSummary(this.tenderScope(user)),
    ]);

    const byCat = Object.fromEntries(funnel.map((r) => [r.category, num(r.c)]));
    const FUNNEL = ['new_lead', 'follow_up', 'active', 'expected'];
    // leads whose category is outside the four funnel stages still count, so the funnel always sums to "open leads"
    const otherCat = funnel.filter((r) => !FUNNEL.includes(r.category)).reduce((a, r) => a + num(r.c), 0);
    return {
      scopeLabel: 'Your accounts',
      numbers: {
        visitsToday: visits.today,
        visitsWeek: visits.week,
        visitsUpcoming: visits.upcoming,
        visitsCompleted: visits.completed,
        visitsTotal: visits.total,
        followupsDue: leads.followupsDue,
        pipelineLakh: leads.lakh,
        openLeads: leads.active,
        totalLeads: leads.total,
        tasksOpen: tasks.open,
        tasksOverdue: tasks.overdue,
        tasksBlocked: tasks.blocked,
        tendersWon: tenders.won,
        tendersLost: tenders.lost,
        proposalsRequested: num(proposals.c),
        demosOpen: num(demos.c),
        claimsLive: num(claims.live),
        claimsAmount: num(claims.amt),
        claimsDraft: num(claims.drafts),
        claimsClarify: num(claims.clarify),
        bidsClosing: tenders.closing7d,
      },
      lists: {
        agenda: agenda.map((r) => ({
          id: r.id,
          title: r.org,
          subtitle: r.purpose,
          date: r.day,
          meta: [r.start_time, r.location].filter(Boolean).join(' · ') || null,
          status: human(r.status),
          tone: r.day === today ? 'info' : 'neutral',
          href: link.visitsAt(r.organisation_id),
        })),
        followups: followups.map((r) => ({
          id: r.id,
          title: r.org,
          subtitle: r.product,
          date: r.day,
          amount: r.value_lakh == null ? null : num(r.value_lakh) * 100000,
          tone: r.day < today ? 'critical' : r.day === today ? 'warning' : 'info',
          href: link.lead(r.id),
        })),
        proposals: proposalList.map((r) => ({
          id: r.id,
          title: r.org || r.proposal_number,
          subtitle: r.proposal_number,
          date: r.day,
          status: human(r.status),
          tone: r.day && r.day < today ? 'critical' : 'info',
          href: link.proposal(r.id),
        })),
        demos: demoList.map((r) => ({
          id: r.id,
          title: r.org || r.demo_no,
          subtitle: [r.demo_no, r.location].filter(Boolean).join(' · '),
          date: r.day,
          status: human(r.status),
          tone: 'info',
          href: link.demo(r.id),
        })),
        bids,
      },
      bars: {
        funnel: [
          { key: 'new_lead', label: 'New', value: byCat.new_lead ?? 0 },
          { key: 'follow_up', label: 'Follow-up', value: byCat.follow_up ?? 0 },
          { key: 'active', label: 'Active', value: byCat.active ?? 0 },
          { key: 'expected', label: 'Expected', value: byCat.expected ?? 0 },
          ...(otherCat ? [{ key: 'other', label: 'Uncategorised', value: otherCat }] : []),
        ],
      },
    };
  }

  /* ------------------------------------------------------------- tender team -- */
  private async tender(_user: AuthUser): Promise<Section> {
    const [summary, counts, deadlines, approvals, evaluation] = await Promise.all([
      this.metrics.tenderSummary(sql`true`),
      this.one(sql`
        select count(*) filter (where t.status = 'identified')::int as identified,
               count(*) filter (where t.status = any(${TENDER_EVAL}::text[]))::int as evaluating,
               coalesce(sum(t.emd_fee) filter (where t.status in ('under_preparation', 'submitted', 'pq_submitted', 'pq_qualified', 'technical_eval', 'commercial_eval')), 0)::float as emd
        from tenders t where ${TENDER_LIVE}`),
      this.closingTenders(sql`t.status in ('identified', 'awaiting_approval', 'under_preparation')`, 30, 8),
      this.rows(sql`
        select t.id, t.tender_no, coalesce(o.name, t.department) as buyer, ${DEADLINE} as deadline, t.estimated_value
        from tenders t left join organisations o on o.id = t.organisation_id
        where ${TENDER_LIVE} and ${TENDER_AWAITING_APPROVAL} order by ${DEADLINE} asc nulls last limit 5`),
      this.rows(sql`
        select t.id, t.tender_no, t.status, coalesce(o.name, t.department) as buyer, t.updated_at
        from tenders t left join organisations o on o.id = t.organisation_id
        where ${TENDER_LIVE} and t.status = any(${TENDER_EVAL}::text[]) order by t.updated_at desc limit 5`),
    ]);
    return {
      scopeLabel: 'National GeM & state portals',
      numbers: {
        closing48h: summary.closing48h,
        closing7d: summary.closing7d,
        identified: num(counts.identified),
        awaitingApproval: summary.awaitingApproval,
        underPreparation: summary.underPreparation,
        inEvaluation: num(counts.evaluating),
        won: summary.won,
        lost: summary.lost,
        live: summary.live,
        total: summary.total,
        emdAtStake: num(counts.emd),
      },
      lists: {
        deadlines,
        approvals: approvals.map((r) => ({
          id: r.id,
          title: r.tender_no || 'Tender',
          subtitle: r.buyer,
          date: iso(r.deadline),
          amount: r.estimated_value == null ? null : num(r.estimated_value),
          tone: deadlineTone(r.deadline),
          href: link.tender(r.id),
        })),
        evaluation: evaluation.map((r) => ({
          id: r.id,
          title: r.tender_no || 'Tender',
          subtitle: r.buyer,
          date: iso(r.updated_at),
          status: human(r.status),
          tone: 'info',
          href: link.tender(r.id),
        })),
      },
      bars: {
        stages: [
          { key: 'identified', label: 'Identified', value: num(counts.identified) },
          { key: 'awaiting_approval', label: 'Awaiting approval', value: summary.awaitingApproval },
          { key: 'under_preparation', label: 'Preparing bid', value: summary.underPreparation },
          { key: 'evaluation', label: 'Submitted / in evaluation', value: num(counts.evaluating) },
          { key: 'won', label: 'Won', value: summary.won },
          { key: 'lost', label: 'Lost', value: summary.lost },
        ],
      },
    };
  }

  /* --------------------------------------------------------------- demo team -- */
  private async demo(user: AuthUser): Promise<Section> {
    const today = todayInKolkata();
    const weekEnd = addIsoDays(today, 6);
    const DAY = sql`coalesce(d.confirmed_date, d.requested_date)`;
    const [counts, fleet, conflicts, schedule, requests, outcomes, depots] = await Promise.all([
      this.one(sql`
        select count(*) filter (where ${DAY} between ${today}::date and ${weekEnd}::date and d.status <> all(${DEMO_DONE}::text[]))::int as week,
               count(*) filter (where d.status in ('requested', 'under_planning', 'rescheduled'))::int as pending,
               count(*) filter (where d.assigned_to = ${user.id} and d.status <> all(${DEMO_DONE}::text[]))::int as mine,
               count(*) filter (where d.status = 'completed' and not exists (select 1 from demo_outcomes x where x.demo_id = d.id))::int as outcomes_due,
               count(*) filter (where d.status <> all(${DEMO_DONE}::text[]) and ${DAY} < ${today}::date)::int as overdue
        from demos d`),
      this.rows(sql`select e.availability_status as status, count(*)::int as c from demo_equipment e group by 1`),
      this.one(sql`
        select count(*)::int as c from demo_reservations a
        join demo_reservations b on b.equipment_id = a.equipment_id and a.id < b.id
        where a.status <> all(${RESERVATION_DONE}::text[]) and b.status <> all(${RESERVATION_DONE}::text[])
          and coalesce(a.reserved_to, a.reserved_from) >= ${today}::date
          and coalesce(a.reserved_from, '-infinity'::date) <= coalesce(b.reserved_to, 'infinity'::date)
          and coalesce(b.reserved_from, '-infinity'::date) <= coalesce(a.reserved_to, 'infinity'::date)`),
      this.rows(sql`
        select d.id, d.demo_no, d.status, ${DAY}::text as day, d.location, o.name as org, u.full_name as engineer, pr.name as product
        from demos d left join organisations o on o.id = d.organisation_id left join users u on u.id = d.assigned_to left join products pr on pr.id = d.product_id
        where d.status <> all(${DEMO_DONE}::text[]) and ${DAY} between ${today}::date and ${weekEnd}::date
        order by ${DAY} asc limit 8`),
      // §16: limited demo units go to the bids with the highest tender value first
      this.rows(sql`
        select d.id, d.demo_no, d.status, ${DAY}::text as day, d.location, o.name as org, pr.name as product,
               coalesce(d.deal_value, t.estimated_value, t.tender_value) as value
        from demos d left join organisations o on o.id = d.organisation_id left join products pr on pr.id = d.product_id left join tenders t on t.id = d.tender_id
        where d.status in ('requested', 'under_planning', 'rescheduled')
        order by coalesce(d.deal_value, t.estimated_value, t.tender_value) desc nulls last, ${DAY} asc nulls last limit 6`),
      this.rows(sql`
        select d.id, d.demo_no, ${DAY}::text as day, o.name as org
        from demos d left join organisations o on o.id = d.organisation_id
        where d.status = 'completed' and not exists (select 1 from demo_outcomes x where x.demo_id = d.id)
        order by ${DAY} desc nulls last limit 5`),
      this.rows(sql`
        select coalesce(nullif(trim(e.current_location), ''), 'Unassigned') as depot,
               count(*) filter (where e.availability_status = 'available')::int as available, count(*)::int as total
        from demo_equipment e group by 1 order by total desc limit 6`),
    ]);
    const f = Object.fromEntries(fleet.map((r) => [r.status, num(r.c)]));
    return {
      scopeLabel: 'Demo depots (Delhi · Patna · Kolkata)',
      numbers: {
        thisWeek: num(counts.week),
        pendingRequests: num(counts.pending),
        assignedToMe: num(counts.mine),
        outcomesDue: num(counts.outcomes_due),
        overdue: num(counts.overdue),
        conflicts: num(conflicts.c),
        fleetAvailable: f.available ?? 0,
        fleetReserved: f.reserved ?? 0,
        fleetInUse: f.in_use ?? 0,
        fleetMaintenance: f.maintenance ?? 0,
      },
      lists: {
        schedule: schedule.map((r) => ({
          id: r.id,
          title: r.org || r.demo_no,
          subtitle: [r.product, r.location].filter(Boolean).join(' · ') || null,
          date: r.day,
          status: human(r.status),
          meta: r.engineer ? `Engineer: ${r.engineer}` : 'No engineer yet',
          tone: r.engineer ? (r.day === today ? 'info' : 'neutral') : 'warning',
          href: link.demo(r.id),
        })),
        requests: requests.map((r) => ({
          id: r.id,
          title: r.org || r.demo_no,
          subtitle: [r.demo_no, r.product].filter(Boolean).join(' · '),
          date: r.day,
          amount: r.value == null ? null : num(r.value),
          status: human(r.status),
          tone: r.day && r.day < today ? 'critical' : 'warning',
          href: link.demo(r.id),
        })),
        outcomes: outcomes.map((r) => ({
          id: r.id,
          title: r.org || r.demo_no,
          subtitle: r.demo_no,
          date: r.day,
          tone: 'warning',
          href: link.demo(r.id),
        })),
      },
      bars: {
        fleet: [
          { key: 'available', label: 'Available', value: f.available ?? 0 },
          { key: 'reserved', label: 'Reserved', value: f.reserved ?? 0 },
          { key: 'in_use', label: 'In use', value: f.in_use ?? 0 },
          { key: 'maintenance', label: 'Maintenance', value: f.maintenance ?? 0 },
        ],
        depots: depots.map((r) => ({ key: r.depot, label: r.depot, value: num(r.available), secondary: num(r.total) })),
      },
    };
  }

  /* ------------------------------------------------------------ service team -- */
  private async service(user: AuthUser): Promise<Section> {
    const mine = sql`(s.assigned_to = ${user.id} or s.additional_engineer_ids @> ${JSON.stringify([user.id])}::jsonb)`;
    const [counts, pool, queue, unassigned, workload] = await Promise.all([
      this.one(sql`
        select count(*)::int as open,
               count(*) filter (where ${TICKET_SLA_LATE})::int as overdue,
               count(*) filter (where s.status = 'awaiting_part')::int as parts,
               count(*) filter (where s.priority = 'critical')::int as critical,
               count(*) filter (where s.status = 'visit_scheduled')::int as visits
        from service_tickets s where ${TICKET_OPEN} and ${mine}`),
      this.one(sql`
        select count(*) filter (where s.assigned_to is null and ${TICKET_OPEN})::int as unassigned,
               count(*) filter (where coalesce(s.is_repeat_complaint, false) and ${TICKET_OPEN})::int as repeat,
               -- §34 closure time, as on the Service page: closed tickets, from when the complaint was received
               (select avg(${TICKET_CLOSURE_SECONDS}) / 3600 from service_tickets
                 where service_tickets.deleted_at is null and service_tickets.status = 'closed'
                   and service_tickets.closed_at >= now() - interval '90 days')::float as avg_hours,
               count(*) filter (where s.resolved_at >= now() - interval '30 days' and ${mine})::int as resolved30
        from service_tickets s where s.deleted_at is null`),
      this.rows(sql`
        select s.id, s.ticket_no, s.priority, s.status, s.sla_resolution_due_at, s.location, o.name as org, coalesce(pr.name, s.equipment_serial) as equipment
        from service_tickets s left join organisations o on o.id = s.organisation_id left join products pr on pr.id = s.product_id
        where ${TICKET_OPEN} and ${mine}
        order by s.sla_resolution_due_at asc nulls last, (s.priority = 'critical') desc limit 8`),
      this.rows(sql`
        select s.id, s.ticket_no, s.priority, s.status, s.created_at, o.name as org
        from service_tickets s left join organisations o on o.id = s.organisation_id
        where ${TICKET_OPEN} and s.assigned_to is null order by (s.priority = 'critical') desc, s.created_at asc limit 5`),
      // §34 engineer workload: every active engineer, including an empty queue
      this.rows(sql`
        select u.id, u.full_name,
               count(s.id)::int as open,
               count(s.id) filter (where ${TICKET_SLA_LATE})::int as overdue
        from users u left join service_tickets s on s.assigned_to = u.id and ${TICKET_OPEN}
        where u.is_active and u.role = 'service_team' group by u.id, u.full_name order by open desc, u.full_name asc`),
    ]);
    return {
      scopeLabel: 'Your service queue',
      numbers: {
        open: num(counts.open),
        overdue: num(counts.overdue),
        awaitingParts: num(counts.parts),
        critical: num(counts.critical),
        visitsScheduled: num(counts.visits),
        unassigned: num(pool.unassigned),
        repeatComplaints: num(pool.repeat),
        avgClosureHours: Math.round(num(pool.avg_hours)),
        resolved30d: num(pool.resolved30),
      },
      lists: {
        queue: queue.map((r) => ({
          id: r.id,
          title: r.ticket_no || 'Ticket',
          subtitle: [r.org, r.equipment].filter(Boolean).join(' · ') || null,
          date: iso(r.sla_resolution_due_at),
          status: human(r.status),
          meta: [human(r.priority), r.location].filter(Boolean).join(' · ') || null,
          tone: ticketTone(r.priority, r.sla_resolution_due_at),
          href: link.ticket(r.id),
        })),
        unassigned: unassigned.map((r) => ({
          id: r.id,
          title: r.ticket_no || 'Ticket',
          subtitle: r.org,
          date: iso(r.created_at),
          status: human(r.status),
          tone: r.priority === 'critical' ? 'critical' : r.priority === 'high' ? 'warning' : 'info',
          href: link.ticket(r.id),
        })),
      },
      bars: {
        workload: workload.map((r) => ({ key: r.id, label: r.full_name, value: num(r.open), secondary: num(r.overdue) })),
      },
    };
  }

  /* ---------------------------------------------------------------- accounts -- */
  private async accounts(_user: AuthUser): Promise<Section> {
    const STAGE2 = sql`c.deleted_at is null and c.status in ('manager_approved', 'accounts_review')`;
    const WAIT = sql`coalesce(c.manager_actioned_at, c.submitted_at, c.created_at)`;
    const [counts, queue, aging] = await Promise.all([
      this.one(sql`
        select count(*) filter (where c.status in ('manager_approved', 'accounts_review'))::int as stage2,
               coalesce(sum(c.total_claimed) filter (where c.status in ('manager_approved', 'accounts_review')), 0)::float as stage2_amt,
               count(*) filter (where c.status = 'accounts_approved')::int as payable,
               coalesce(sum(coalesce(c.total_approved, c.total_claimed)) filter (where c.status = 'accounts_approved'), 0)::float as payable_amt,
               count(*) filter (where c.status = 'clarification_required')::int as clarify,
               count(*) filter (where c.status = 'submitted')::int as stage1,
               count(*) filter (where c.status = 'processed' and c.processed_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::int as settled,
               coalesce(sum(coalesce(c.total_approved, c.total_claimed)) filter (where c.status = 'processed' and c.processed_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0)::float as settled_amt
        from expense_claims c where c.deleted_at is null`),
      this.rows(sql`
        select c.id, c.claim_number, c.title, c.total_claimed, c.status, ${WAIT} as waiting_since, emp.full_name,
               greatest(0, extract(day from now() - ${WAIT}))::int as days
        from expense_claims c join users emp on emp.id = c.employee_id
        where ${STAGE2} order by ${WAIT} asc limit 8`),
      this.one(sql`
        select count(*) filter (where now() - ${WAIT} <= interval '3 days')::int as d3,
               count(*) filter (where now() - ${WAIT} > interval '3 days' and now() - ${WAIT} <= interval '7 days')::int as d7,
               count(*) filter (where now() - ${WAIT} > interval '7 days' and now() - ${WAIT} <= interval '15 days')::int as d15,
               count(*) filter (where now() - ${WAIT} > interval '15 days')::int as older
        from expense_claims c where ${STAGE2}`),
    ]);
    return {
      scopeLabel: 'Corporate accounts · all India',
      numbers: {
        stage2Pending: num(counts.stage2),
        stage2Amount: num(counts.stage2_amt),
        awaitingPayment: num(counts.payable),
        awaitingPaymentAmount: num(counts.payable_amt),
        clarification: num(counts.clarify),
        withManagers: num(counts.stage1),
        settledThisMonth: num(counts.settled),
        settledThisMonthAmount: num(counts.settled_amt),
      },
      lists: {
        queue: queue.map((r) => ({
          id: r.id,
          title: r.full_name,
          subtitle: `${r.claim_number}${r.title ? ` · ${r.title}` : ''}`,
          date: iso(r.waiting_since),
          amount: num(r.total_claimed),
          status: human(r.status),
          tone: num(r.days) > 7 ? 'critical' : num(r.days) > 3 ? 'warning' : 'info',
          figures: { days: num(r.days) },
          href: `/expenses/${r.id}`,
        })),
      },
      bars: {
        aging: [
          { key: 'd3', label: '0–3 days', value: num(aging.d3) },
          { key: 'd7', label: '4–7 days', value: num(aging.d7) },
          { key: 'd15', label: '8–15 days', value: num(aging.d15) },
          { key: 'older', label: 'Over 15 days', value: num(aging.older) },
        ],
      },
    };
  }

  /* ------------------------------------------------------------------- admin -- */
  private async admin(_user: AuthUser): Promise<Section> {
    const [users, masters, audit, dead, byRole, auditList, newUsers] = await Promise.all([
      this.one(sql`
        select count(*) filter (where u.is_active)::int as active,
               count(*) filter (where not u.is_active)::int as inactive,
               count(*) filter (where u.is_active and u.role::text = any(${FIELD_ROLES}::text[]) and u.reporting_manager_id is null)::int as no_manager,
               count(*) filter (where u.is_active and u.role::text = any(${FIELD_ROLES}::text[]) and u.zone_id is null)::int as no_zone
        from users u`),
      this.one(sql`
        select (select count(*) from products)::int as products, (select count(*) from zones)::int as zones,
               (select count(*) from regions)::int as regions, (select count(*) from demo_equipment)::int as equipment`),
      this.one(sql`
        select count(*) filter (where a.created_at >= now() - interval '24 hours')::int as day,
               count(*) filter (where a.created_at >= now() - interval '7 days')::int as week,
               count(*)::int as total
        from audit_log a`),
      this.one(sql`select count(*)::int as c from dead_letter_events where replayed_at is null`),
      this.rows(sql`select u.role, count(*)::int as c from users u where u.is_active group by u.role order by c desc`),
      this.rows(sql`
        select a.id, a.action, a.entity_type, a.created_at, u.full_name
        from audit_log a left join users u on u.id = a.actor_id order by a.created_at desc limit 8`),
      this.rows(sql`select u.id, u.full_name, u.role, u.email, u.is_active, u.created_at from users u order by u.created_at desc limit 5`),
    ]);
    return {
      scopeLabel: 'Platform · all roles',
      numbers: {
        activeUsers: num(users.active),
        inactiveUsers: num(users.inactive),
        noManager: num(users.no_manager),
        noZone: num(users.no_zone),
        products: num(masters.products),
        zones: num(masters.zones),
        regions: num(masters.regions),
        equipment: num(masters.equipment),
        audit24h: num(audit.day),
        audit7d: num(audit.week),
        auditTotal: num(audit.total),
        deadLetters: num(dead.c),
      },
      lists: {
        audit: auditList.map((r) => ({
          id: r.id,
          title: human(r.action),
          subtitle: human(r.entity_type),
          date: iso(r.created_at),
          meta: r.full_name || 'System',
          tone: /(delete|reject|cancel|deactivat)/i.test(r.action) ? 'warning' : 'neutral',
          href: '/admin?tab=audit',
        })),
        newUsers: newUsers.map((r) => ({
          id: r.id,
          title: r.full_name,
          subtitle: r.email,
          date: iso(r.created_at),
          status: human(r.role),
          tone: r.is_active ? 'success' : 'neutral',
          href: `/admin?tab=users&open=${r.id}`,
        })),
      },
      bars: {
        roles: byRole.map((r) => ({ key: r.role, label: human(r.role), value: num(r.c) })),
      },
    };
  }
}

