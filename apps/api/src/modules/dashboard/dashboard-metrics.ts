import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { addIsoDays } from '../../common/utils/ist-date.util.js';
import { CLOSED_LEAD_STATUSES, type AuthUser, type Database } from '@arihant/shared';

/**
 * The ONE definition of every figure the dashboards share. The role home screen (GET /dashboard/workspace),
 * Zonal Command (GET /dashboard/regional-performance) and the sidebar tender badge (GET /dashboard/nav-counts)
 * all call these, so the same metric over the same scope can never show two numbers on two screens.
 *
 * SQL aliases used by the fragments: t = tenders, l = leads, o = organisations, v = visits, k = tasks, u = users.
 */
type Cond = RawBuilder<unknown>;
type Row = Record<string, any>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** IST calendar day of a timestamptz column. */
export const istDay = (col: Cond) => sql`(${col} at time zone 'Asia/Kolkata')::date`;

export const FIELD_ROLES = ['sales', 'demo_team', 'service_team'];

/* ------------------------------------------------------------------ leads -- */
/**
 * Statuses that have left the pipeline. The Leads page "Active Pipeline" KPI (LeadsService.getDashboard:
 * total − converted/won − lost/dropped, on lower(coalesce(lead_status, status))) excludes exactly these.
 */
export const LEAD_CLOSED_STATUSES: string[] = [...CLOSED_LEAD_STATUSES];
export const LEAD_ACTIVE = sql`lower(coalesce(l.lead_status, l.status, 'new')) <> all(${LEAD_CLOSED_STATUSES}::text[])`;
/** A lead's share of pipeline value (₹ lakh). A negative estimate is a data-entry error, never negative pipeline. */
export const LEAD_VALUE = sql`greatest(coalesce(l.value_lakh, 0), 0)`;

/* ---------------------------------------------------------------- tenders -- */
/** Decided or abandoned bids: no deadline left to chase, not counted as live. */
export const TENDER_DONE = ['won', 'lost', 'cancelled', 'rejected_internally'];
/**
 * Pre-submission stages: the only ones whose submission deadline can still be missed. The Tenders register's Deadline
 * filter and its Upcoming / Urgent KPIs (TendersService.tenderDeadlineMatch) use the same stages and column, so every
 * "closing soon" figure on a dashboard opens the same bids in the register.
 */
export const TENDER_PRE_SUBMISSION = ['identified', 'awaiting_approval', 'under_preparation', 'pq_qualified'];
/** The bid's deadline for display and ordering; older rows may only carry bid_closing_date. */
export const TENDER_DEADLINE = sql`coalesce(t.submission_deadline, t.bid_closing_date)`;
/** The deadline the register counts down to. */
export const TENDER_SUBMISSION_DEADLINE = sql`t.submission_deadline`;
export const TENDER_ROW = sql`coalesce(t.is_deleted, false) = false`;
export const TENDER_CHASING = sql`t.status::text = any(${TENDER_PRE_SUBMISSION}::text[])`;
/** Same rule as the Tenders Approvals Inbox (TendersService.pendingApprovalsQuery): awaiting approval and not on hold. */
export const TENDER_AWAITING_APPROVAL = sql`t.status = 'awaiting_approval' and coalesce(t.on_hold, false) = false`;
/** Bid closes within the next `hours` (instant comparison — a deadline is a timestamp, not a calendar day). */
export const tenderClosingWithin = (hours: number) =>
  sql`${TENDER_CHASING} and ${TENDER_SUBMISSION_DEADLINE} between now() and now() + make_interval(hours => ${hours})`;
/** Tender statuses at or past submission (the bid went in). */
export const TENDER_SUBMITTED = ['pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'];
/** The bid's owner: salesperson, else owner, else tender owner, else assignee. */
export const TENDER_OWNER = sql`coalesce(t.salesperson_id, t.owner, t.tender_owner_id, t.assigned_to)`;
/** IST day the bid went in: submission date, else participated date, else its deadline, else when it was logged. */
export const TENDER_SUBMITTED_DAY = sql`coalesce(t.submission_date, t.participated_date, ${istDay(TENDER_DEADLINE)}, ${istDay(sql`t.created_at`)})`;
/** IST day the bid was decided: result date, else its last update. */
export const TENDER_RESULT_DAY = sql`coalesce(t.result_date, ${istDay(sql`t.updated_at`)})`;

/* --------------------------------------------------------------- demos / proposals -- */
/** IST day a demo is held: confirmed date, else requested date, else when it was logged (alias d). */
export const DEMO_DAY = sql`coalesce(d.confirmed_date, d.requested_date, ${istDay(sql`d.created_at`)})`;
/** A proposal's owner — the table carries four legacy owner columns (alias p). */
export const PROPOSAL_OWNER = sql`coalesce(p.responsible_person_id, p.responsible_id, p.requested_by_id, p.requested_by)`;
/** A proposal's customer organisation (alias p). */
export const PROPOSAL_ORG = sql`coalesce(p.customer_id, p.organisation_id)`;
/** IST day a proposal was decided: outcome date, else its last update (alias p). */
export const PROPOSAL_OUTCOME_DAY = sql`coalesce(p.outcome_date, ${istDay(sql`p.updated_at`)})`;

/* ----------------------------------------------------------------- visits -- */
/** A visit still to be made: planned, or moved (modified / rescheduled) but not yet done. */
export const VISIT_OPEN = ['planned', 'modified', 'rescheduled'];

/* ------------------------------------------------------------------ tasks -- */
/** Open work. Overdue tasks are always a subset of these. */
export const TASK_OPEN = ['not_started', 'in_progress', 'blocked'];
/** Module 8: overdue = deadline passed, work open, no clock-pausing blocker (derived, never stored; mirrors isTaskOverdue). */
export const TASK_OVERDUE = sql`k.deadline < now() and (k.status in ('not_started', 'in_progress') or (k.status = 'blocked' and not exists (select 1 from task_blockers b where b.task_id = k.id and b.status = 'accepted' and b.decision is distinct from 'accept_extend')))`;

/* ----------------------------------------------------------------- scopes -- */
/**
 * Tender rows a user's dashboards count. Sales: bids they own. Regional manager: their zone's bids plus bids owned
 * by their team (so the rep's "my bids" are always inside the manager's figure — see territoryTenders).
 * Everyone else: all India.
 */
export function tenderScopeFor(user: AuthUser): Cond {
  if (user.role === 'regional_manager') return territoryTenders({ zoneId: user.zone_id ?? null, managerId: user.id });
  if (user.role === 'sales') {
    return sql`(t.assigned_to = ${user.id} or t.owner = ${user.id} or t.tender_owner_id = ${user.id} or t.created_by = ${user.id})`;
  }
  return sql`true`;
}

/** Tenders tagged to a zone (and optionally one region of it). */
export function tenderTerritory(zoneId: string | null | undefined, regionId?: string | null): Cond {
  const zone = zoneId ? sql`t.zone_id = ${zoneId}` : sql`true`;
  return regionId ? sql`${zone} and t.region_id = ${regionId}` : zone;
}

/** Customer organisations in a zone (and optionally one region of it): the territory of leads and visits. */
export function orgTerritory(zoneId: string | null | undefined, regionId?: string | null): Cond {
  const zone = zoneId ? sql`o.zone_id = ${zoneId}` : sql`true`;
  return regionId ? sql`${zone} and o.region_id = ${regionId}` : zone;
}

/**
 * A manager's field team: active sales / demo / service users reporting to `managerId`, or based in `zoneId`.
 * Zonal Command and the regional manager's home screen use this same set.
 */
export function teamScope(managerId: string | null, zoneId: string | null): Cond {
  return sql`u.is_active and u.role::text = any(${FIELD_ROLES}::text[]) and (
    (${managerId}::uuid is not null and u.reporting_manager_id = ${managerId}::uuid)
    or (${zoneId}::uuid is not null and u.zone_id = ${zoneId}::uuid))`;
}

/** Ids of the field team (see teamScope) — for "owned by someone on the team" conditions. */
export function teamIds(managerId: string | null, zoneId: string | null): Cond {
  return sql`(select u.id from users u where ${teamScope(managerId, zoneId)})`;
}

/**
 * A manager's territory: a zone, optionally narrowed to one region, plus — when no region is picked — the
 * records owned by the zone's field team. For leads and visits that is only at customers with no zone tag: wherever
 * a customer's zone is known, geography decides, so a rep's lead in another zone belongs to that zone (QA BUG-001).
 * Bids owned by the team count wherever they are tagged (QA DEF-037 / DEF-038). `managerId` is the regional manager
 * whose direct reports count as the team (null for management looking at a zone).
 *
 * The regional manager's home screen and Zonal Command both build their scope from this, so for the same zone
 * they report the same pipeline, visits and bids.
 */
export interface Territory {
  zoneId: string | null;
  regionId?: string | null;
  managerId?: string | null;
}

/** The geographic half of a territory. A manager without a zone has no geography — only their team. */
function territoryGeo(t: Territory, geo: (zone: string | null | undefined, region?: string | null) => Cond): Cond {
  if (!t.zoneId && t.managerId) return sql`false`;
  return geo(t.zoneId, t.regionId);
}

export function territoryLeads(t: Territory): Cond {
  const geo = territoryGeo(t, orgTerritory);
  if (t.regionId) return geo;
  const team = teamIds(t.managerId ?? null, t.zoneId);
  const rm = t.managerId ? sql` or l.regional_manager_id = ${t.managerId}` : sql``;
  // The manager's own leads always count (as on the lead register).
  const own = t.managerId ? sql` or l.assigned_to = ${t.managerId}` : sql``;
  return sql`(${geo}${own} or (o.zone_id is null and (l.assigned_to in ${team}${rm})))`;
}

export function territoryVisits(t: Territory): Cond {
  const geo = territoryGeo(t, orgTerritory);
  if (t.regionId) return geo;
  return sql`(${geo} or (o.zone_id is null and v.assigned_to in ${teamIds(t.managerId ?? null, t.zoneId)}))`;
}

export function territoryTenders(t: Territory): Cond {
  const geo = territoryGeo(t, tenderTerritory);
  if (t.regionId || (!t.zoneId && !t.managerId)) return geo;
  const team = teamIds(t.managerId ?? null, t.zoneId);
  // Bids follow the people (QA DEF-037 / DEF-038): a team member's bid counts even when tagged to another zone.
  return sql`(${geo} or t.assigned_to in ${team} or t.owner in ${team} or t.tender_owner_id in ${team})`;
}

/* ---------------------------------------------------------------- results -- */
export interface LeadPipeline {
  /** Every lead in scope, open or closed. */
  total: number;
  /** Active pipeline: leads not converted / won / lost / dropped. */
  active: number;
  /** ₹ lakh across active leads. */
  lakh: number;
  highLakh: number;
  mediumLakh: number;
  lowLakh: number;
  /** Active leads whose next follow-up is today or earlier (IST). */
  followupsDue: number;
  /** Active leads whose next follow-up date has passed (IST). */
  followupsOverdue: number;
}

export interface TenderSummary {
  /** Every tender in scope (not deleted). */
  total: number;
  /** Not yet decided or abandoned. */
  live: number;
  closing48h: number;
  closing7d: number;
  awaitingApproval: number;
  underPreparation: number;
  won: number;
  lost: number;
}

export interface VisitSummary {
  /** Open visits planned for today (IST). */
  today: number;
  /** Open visits planned today … today + 6. */
  week: number;
  /** Open visits planned today or later. */
  upcoming: number;
  completed: number;
  completed30d: number;
  /** Every visit that was not cancelled — the completion-rate denominator. */
  total: number;
  cancelled: number;
  rescheduled: number;
  withManagerDirective: number;
  /** completed ÷ total × 100; null when there are no visits to complete. */
  completionRate: number | null;
}

export interface TaskFigures {
  /** Every task in scope that was not cancelled. */
  total: number;
  /** not_started / in_progress / blocked — always ≥ overdue. */
  open: number;
  blocked: number;
  overdue: number;
  completed: number;
}

export interface TeamFigures {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  region_name: string | null;
  tasksTotal: number;
  tasksCompleted: number;
  tasksOpen: number;
  tasksOverdue: number;
  tasksBlocked: number;
  visitsTotal: number;
  visitsCompleted: number;
  visitsCompleted30d: number;
  leadsTotal: number;
  leadsActive: number;
  pipelineLakh: number;
}

@Injectable()
export class DashboardMetricsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private async one(query: RawBuilder<unknown>): Promise<Row> {
    const res = await query.execute(this.db);
    return ((res.rows as Row[])[0] ?? {}) as Row;
  }

  /** Lead pipeline over `scope` (a condition on l / o). */
  async leadPipeline(scope: Cond, today: string): Promise<LeadPipeline> {
    const r = await this.one(sql`
      select count(*)::int as total,
             count(*) filter (where ${LEAD_ACTIVE})::int as active,
             coalesce(sum(${LEAD_VALUE}) filter (where ${LEAD_ACTIVE}), 0)::float as lakh,
             coalesce(sum(${LEAD_VALUE}) filter (where ${LEAD_ACTIVE} and l.probability = 'high'), 0)::float as high,
             coalesce(sum(${LEAD_VALUE}) filter (where ${LEAD_ACTIVE} and l.probability = 'medium'), 0)::float as medium,
             coalesce(sum(${LEAD_VALUE}) filter (where ${LEAD_ACTIVE} and l.probability = 'low'), 0)::float as low,
             count(*) filter (where ${LEAD_ACTIVE} and l.next_followup_date <= ${today}::date)::int as due,
             count(*) filter (where ${LEAD_ACTIVE} and l.next_followup_date < ${today}::date)::int as overdue
      from leads l left join organisations o on o.id = l.organisation_id
      where ${scope}`);
    return {
      total: num(r.total),
      active: num(r.active),
      lakh: round2(num(r.lakh)),
      highLakh: round2(num(r.high)),
      mediumLakh: round2(num(r.medium)),
      lowLakh: round2(num(r.low)),
      followupsDue: num(r.due),
      followupsOverdue: num(r.overdue),
    };
  }

  /** Tender counts over `scope` (a condition on t). */
  async tenderSummary(scope: Cond): Promise<TenderSummary> {
    const r = await this.one(sql`
      select count(*)::int as total,
             count(*) filter (where t.status <> all(${TENDER_DONE}::text[]))::int as live,
             count(*) filter (where ${tenderClosingWithin(48)})::int as closing48,
             count(*) filter (where ${tenderClosingWithin(7 * 24)})::int as closing7,
             count(*) filter (where ${TENDER_AWAITING_APPROVAL})::int as awaiting,
             count(*) filter (where t.status = 'under_preparation')::int as preparing,
             count(*) filter (where t.status = 'won')::int as won,
             count(*) filter (where t.status = 'lost')::int as lost
      from tenders t where ${TENDER_ROW} and ${scope}`);
    return {
      total: num(r.total),
      live: num(r.live),
      closing48h: num(r.closing48),
      closing7d: num(r.closing7),
      awaitingApproval: num(r.awaiting),
      underPreparation: num(r.preparing),
      won: num(r.won),
      lost: num(r.lost),
    };
  }

  /** Visit counts over `scope` (a condition on v / o); calendar days are IST. */
  async visitSummary(scope: Cond, today: string): Promise<VisitSummary> {
    const weekEnd = addIsoDays(today, 6);
    const open = sql`v.status = any(${VISIT_OPEN}::text[])`;
    const r = await this.one(sql`
      select count(*) filter (where ${open} and v.planned_date = ${today}::date)::int as today,
             count(*) filter (where ${open} and v.planned_date between ${today}::date and ${weekEnd}::date)::int as week,
             count(*) filter (where ${open} and v.planned_date >= ${today}::date)::int as upcoming,
             count(*) filter (where v.status = 'completed')::int as completed,
             count(*) filter (where v.status = 'completed' and v.planned_date >= ${today}::date - 30)::int as completed30,
             count(*) filter (where v.status <> 'cancelled')::int as total,
             count(*) filter (where v.status = 'cancelled')::int as cancelled,
             count(*) filter (where v.status = 'rescheduled')::int as rescheduled,
             count(*) filter (where v.assigned_by_manager is not null)::int as directive
      from visits v left join organisations o on o.id = v.organisation_id
      where ${scope}`);
    const total = num(r.total);
    const completed = num(r.completed);
    return {
      today: num(r.today),
      week: num(r.week),
      upcoming: num(r.upcoming),
      completed,
      completed30d: num(r.completed30),
      total,
      cancelled: num(r.cancelled),
      rescheduled: num(r.rescheduled),
      withManagerDirective: num(r.directive),
      completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
    };
  }

  /** Task counts over `scope` (a condition on k). Overdue ⊆ open by construction. */
  async taskFigures(scope: Cond): Promise<TaskFigures> {
    const r = await this.one(sql`
      select count(*) filter (where k.status <> 'cancelled')::int as total,
             count(*) filter (where k.status = any(${TASK_OPEN}::text[]))::int as open,
             count(*) filter (where k.status = 'blocked')::int as blocked,
             count(*) filter (where ${TASK_OVERDUE})::int as overdue,
             count(*) filter (where k.status = 'completed')::int as completed
      from tasks k where ${scope}`);
    return {
      total: num(r.total),
      open: num(r.open),
      blocked: num(r.blocked),
      overdue: num(r.overdue),
      completed: num(r.completed),
    };
  }

  /** Per-person tasks, visits and pipeline for a team (see teamScope), alphabetical. */
  async teamFigures(team: Cond, today: string): Promise<TeamFigures[]> {
    const res = await sql`
      select u.id, u.full_name, u.email, u.phone, u.role, r.name as region_name,
             (select count(*) from tasks k where k.assigned_to = u.id and k.status <> 'cancelled')::int as tasks_total,
             (select count(*) from tasks k where k.assigned_to = u.id and k.status = 'completed')::int as tasks_completed,
             (select count(*) from tasks k where k.assigned_to = u.id and k.status = any(${TASK_OPEN}::text[]))::int as tasks_open,
             (select count(*) from tasks k where k.assigned_to = u.id and ${TASK_OVERDUE})::int as tasks_overdue,
             (select count(*) from tasks k where k.assigned_to = u.id and k.status = 'blocked')::int as tasks_blocked,
             (select count(*) from visits v where v.assigned_to = u.id and v.status <> 'cancelled')::int as visits_total,
             (select count(*) from visits v where v.assigned_to = u.id and v.status = 'completed')::int as visits_completed,
             (select count(*) from visits v where v.assigned_to = u.id and v.status = 'completed' and v.planned_date >= ${today}::date - 30)::int as visits_completed30,
             (select count(*) from leads l where l.assigned_to = u.id)::int as leads_total,
             (select count(*) from leads l where l.assigned_to = u.id and ${LEAD_ACTIVE})::int as leads_active,
             coalesce((select sum(${LEAD_VALUE}) from leads l where l.assigned_to = u.id and ${LEAD_ACTIVE}), 0)::float as pipeline_lakh
      from users u left join regions r on r.id = u.region_id
      where ${team}
      order by u.full_name asc`.execute(this.db);
    return (res.rows as Row[]).map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone ?? null,
      role: String(r.role),
      region_name: r.region_name ?? null,
      tasksTotal: num(r.tasks_total),
      tasksCompleted: num(r.tasks_completed),
      tasksOpen: num(r.tasks_open),
      tasksOverdue: num(r.tasks_overdue),
      tasksBlocked: num(r.tasks_blocked),
      visitsTotal: num(r.visits_total),
      visitsCompleted: num(r.visits_completed),
      visitsCompleted30d: num(r.visits_completed30),
      leadsTotal: num(r.leads_total),
      leadsActive: num(r.leads_active),
      pipelineLakh: round2(num(r.pipeline_lakh)),
    }));
  }
}
