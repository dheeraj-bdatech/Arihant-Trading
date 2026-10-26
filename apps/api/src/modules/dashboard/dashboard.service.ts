import { todayInKolkata } from '../../common/utils/ist-date.util.js';
import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database, AuthUser, DashboardMetricsDto } from '@arihant/shared';
import { claimScopeFilter } from '../expense-management/expense-scope.js';
import {
  DashboardMetricsService,
  LEAD_ACTIVE,
  TENDER_AWAITING_APPROVAL,
  TENDER_DEADLINE,
  TENDER_ROW,
  tenderClosingWithin,
  tenderScopeFor,
  teamScope,
  territoryLeads,
  territoryTenders,
  territoryVisits,
  type Territory,
} from './dashboard-metrics.js';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly metrics: DashboardMetricsService,
  ) {}

  /** Sidebar badges: the same live / closing figures the dashboards show for this user's scope. */
  async getNavCounts(user: AuthUser) {
    const t = await this.metrics.tenderSummary(tenderScopeFor(user));
    return { tendersLive: t.live, tendersClosing7d: t.closing7d, tendersAwaitingApproval: t.awaitingApproval, tendersTotal: t.total };
  }

  async getMetrics(user: AuthUser): Promise<DashboardMetricsDto> {
    const today = todayInKolkata(new Date());

    // 1. Tenders metrics — shared definitions (dashboard-metrics.ts): closing = still being chased, deadline ahead.
    const tenderSummary = await this.metrics.tenderSummary(tenderScopeFor(user));
    // 2. Leads metrics — active pipeline excludes converted / won / lost / dropped, same as the Leads page KPI.
    const leadScope =
      user.role === 'sales'
        ? sql`l.assigned_to = ${user.id}`
        : user.role === 'regional_manager'
          ? territoryLeads({ zoneId: user.zone_id ?? null, managerId: user.id })
          : sql`true`;
    const pipeline = await this.metrics.leadPipeline(leadScope, today);
    const leadCats = await sql<{ category: string; c: number }>`
      select l.category, count(*)::int as c from leads l left join organisations o on o.id = l.organisation_id
      where ${leadScope} and ${LEAD_ACTIVE} group by l.category`.execute(this.db);
    const cat = (k: string) => leadCats.rows.find((r) => r.category === k)?.c ?? 0;

    // 3. Tasks metrics — open ⊇ overdue (dashboard-metrics.ts)
    const taskScope =
      ['sales', 'demo_team', 'service_team', 'tender_team'].includes(user.role)
        ? sql`k.assigned_to = ${user.id}`
        : user.role === 'regional_manager'
          ? sql`(k.assigned_to = ${user.id} or k.reporting_manager_id = ${user.id})`
          : sql`true`;
    const tasks = await this.metrics.taskFigures(taskScope);

    // 4. Expenses metrics (Module 9 claims, same role scope as the expense screens)
    const expQuery = this.db
      .selectFrom('expense_claims as c')
      .innerJoin('users as emp', 'emp.id', 'c.employee_id')
      .where('c.deleted_at', 'is', null)
      .where(claimScopeFilter(user));

    const [
      expPendingManager,
      expPendingAccounts,
      expProcessed,
      expPendingAmount,
    ] = await Promise.all([
      expQuery.select(sql<number>`count(c.id)::int`.as('c')).where('c.status', '=', 'submitted').executeTakeFirst(),
      expQuery.select(sql<number>`count(c.id)::int`.as('c')).where('c.status', 'in', ['accounts_review', 'accounts_approved']).executeTakeFirst(),
      expQuery.select(sql<number>`count(c.id)::int`.as('c')).where('c.status', '=', 'processed').executeTakeFirst(),
      expQuery
        .select(sql<number>`coalesce(sum(c.total_claimed), 0)::float`.as('amt'))
        .where('c.status', 'in', ['submitted', 'accounts_review', 'accounts_approved', 'clarification_required'])
        .executeTakeFirst(),
    ]);

    // 5. Service tickets metrics (deleted tickets excluded; cancelled tickets are not open)
    const tickets = () => this.db.selectFrom('service_tickets').where('deleted_at', 'is', null);
    const [ticketTotal, ticketOpen, ticketCritical] = await Promise.all([
      tickets().select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      tickets()
        .select(sql<number>`count(id)::int`.as('c'))
        .where('status', 'not in', ['resolved', 'closed', 'cancelled'])
        .executeTakeFirst(),
      tickets()
        .select(sql<number>`count(id)::int`.as('c'))
        .where('priority', '=', 'critical')
        .where('status', 'not in', ['resolved', 'closed', 'cancelled'])
        .executeTakeFirst(),
    ]);

    // 6. Deliveries metrics
    const [delivTotal, delivScheduled, delivInTransit, delivDelivered, delivInstalled] = await Promise.all([
      this.db.selectFrom('deliveries').select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      this.db.selectFrom('deliveries').select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'scheduled').executeTakeFirst(),
      this.db.selectFrom('deliveries').select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'in_transit').executeTakeFirst(),
      this.db.selectFrom('deliveries').select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'delivered').executeTakeFirst(),
      this.db.selectFrom('deliveries').select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'installed').executeTakeFirst(),
    ]);

    // 7. Visits metrics
    let visitQuery = this.db.selectFrom('visits');
    if (['sales', 'demo_team', 'service_team'].includes(user.role)) {
      visitQuery = visitQuery.where('assigned_to', '=', user.id);
    }
    const [visitTotal, visitPlanned, visitCompleted] = await Promise.all([
      visitQuery.select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      visitQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'planned').executeTakeFirst(),
      visitQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'completed').executeTakeFirst(),
    ]);

    // 8. Proposals metrics (deleted proposals excluded, as on the proposals list)
    const proposals = () => this.db.selectFrom('proposals').where('is_deleted', '=', false);
    const [propTotal, propUnderPrep, propSent, propConverted, propLost] = await Promise.all([
      proposals().select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      proposals().select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['under_preparation', 'UNDER_PREPARATION']).executeTakeFirst(),
      // Submitted = with the customer: sent, or sent and awaiting a follow-up.
      proposals().select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['sent', 'SENT_TO_CUSTOMER', 'followup_required', 'FOLLOW_UP_REQUIRED']).executeTakeFirst(),
      proposals().select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['converted', 'CONVERTED']).executeTakeFirst(),
      proposals().select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['lost', 'LOST']).executeTakeFirst(),
    ]);

    // 9. Recent critical exceptions (for management command center)
    const recentExceptions: any[] = [];

    // Tenders closing soon (still being chased — won / lost / submitted bids are never deadline alerts)
    const urgentTenders = await sql<{ id: string; tender_no: string | null; deadline: Date | string }>`
      select t.id, t.tender_no, ${TENDER_DEADLINE} as deadline
      from tenders t where ${TENDER_ROW} and ${tenderScopeFor(user)} and ${tenderClosingWithin(7 * 24)}
      order by ${TENDER_DEADLINE} asc limit 3`.execute(this.db);

    for (const ut of urgentTenders.rows) {
      recentExceptions.push({
        id: `tend-${ut.id}`,
        type: 'tender_deadline',
        title: `Tender ${ut.tender_no} Closes Soon`,
        description: `Bid closing deadline: ${new Date(ut.deadline).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        entityId: ut.id,
        severity: 'critical',
        timestamp: new Date(ut.deadline).toISOString(),
      });
    }

    // Blocked tasks — timestamp is when the blocker was raised, not "now"
    const blockedTasks = await this.db
      .selectFrom('tasks')
      .innerJoin('task_blockers', 'tasks.id', 'task_blockers.task_id')
      .select(['tasks.id', 'tasks.title', 'task_blockers.blocker_type', 'task_blockers.description', 'task_blockers.created_at'])
      .where('tasks.status', '=', 'blocked')
      .where('task_blockers.status', 'in', ['pending_review', 'accepted'])
      .orderBy('task_blockers.created_at', 'desc')
      .limit(2)
      .execute();

    for (const bt of blockedTasks) {
      recentExceptions.push({
        id: `task-${bt.id}`,
        type: 'task_blocked',
        title: `Blocked: ${bt.title}`,
        description: `${bt.blocker_type}: ${bt.description}`,
        entityId: bt.id,
        severity: 'warning',
        timestamp: bt.created_at ? new Date(bt.created_at as any).toISOString() : null,
      });
    }

    // Tenders awaiting approval — timestamp is when approval was last requested (row updated_at)
    const approvalTenders = await sql<{ id: string; tender_no: string | null; department: string | null; updated_at: Date | null }>`
      select t.id, t.tender_no, t.department, t.updated_at from tenders t
      where ${TENDER_ROW} and ${TENDER_AWAITING_APPROVAL} and ${tenderScopeFor(user)}
      order by t.updated_at desc limit 2`.execute(this.db);

    for (const at of approvalTenders.rows) {
      recentExceptions.push({
        id: `appr-${at.id}`,
        type: 'tender_approval',
        title: `Approval Required: ${at.tender_no}`,
        description: `Participation approval requested for ${at.department || 'Government Buyer'}`,
        entityId: at.id,
        severity: 'warning',
        timestamp: at.updated_at ? new Date(at.updated_at).toISOString() : null,
      });
    }

    return {
      tendersCount: {
        total: tenderSummary.total,
        closingSoon: tenderSummary.closing7d,
        underPreparation: tenderSummary.underPreparation,
        awaitingApproval: tenderSummary.awaitingApproval,
        won: tenderSummary.won,
        lost: tenderSummary.lost,
      },
      leadsCount: {
        total: pipeline.total,
        active: pipeline.active,
        expected: cat('expected'),
        followUp: cat('follow_up'),
        totalValueLakh: pipeline.lakh,
      },
      tasksCount: {
        total: tasks.total,
        // open work (not started / in progress / blocked) — always ≥ overdue
        pending: tasks.open,
        blocked: tasks.blocked,
        overdue: tasks.overdue,
      },
      expensesCount: {
        pendingManager: expPendingManager?.c || 0,
        pendingAccounts: expPendingAccounts?.c || 0,
        processed: expProcessed?.c || 0,
        pendingAmount: Math.round((expPendingAmount?.amt || 0) * 100) / 100,
      },
      serviceTicketsCount: {
        total: ticketTotal?.c || 0,
        open: ticketOpen?.c || 0,
        critical: ticketCritical?.c || 0,
      },
      deliveriesCount: {
        total: delivTotal?.c || 0,
        scheduled: delivScheduled?.c || 0,
        inTransit: delivInTransit?.c || 0,
        delivered: delivDelivered?.c || 0,
        installed: delivInstalled?.c || 0,
      },
      visitsCount: {
        total: visitTotal?.c || 0,
        planned: visitPlanned?.c || 0,
        completed: visitCompleted?.c || 0,
      },
      proposalsCount: {
        total: propTotal?.c || 0,
        draft: propUnderPrep?.c || 0,
        submitted: propSent?.c || 0,
        won: propConverted?.c || 0,
        lost: propLost?.c || 0,
      },
      recentExceptions,
    };
  }

  /**
   * Zonal Command (GET /dashboard/regional-performance). Every figure comes from DashboardMetricsService over the
   * zone's Territory — for a regional manager the same territory their home screen (GET /dashboard/workspace) uses,
   * so zone pipeline, field visits, bids and each rep's pipeline match across both screens.
   */
  async getRegionalPerformance(user: AuthUser, query?: { zone_id?: string; region_id?: string }) {
    const today = todayInKolkata();

    // 1. Resolve available zones and the target zone (management / admin may pick; an RM is locked to their zone)
    const availableZones = await this.db.selectFrom('zones').select(['id', 'code', 'name']).orderBy('name', 'asc').execute();
    const canPick = user.role === 'management' || user.role === 'admin';
    let targetZoneId: string | null = user.zone_id ?? null;
    if (canPick && query?.zone_id) targetZoneId = query.zone_id;
    if (!targetZoneId && canPick && availableZones.length > 0) targetZoneId = availableZones[0].id;

    const currentZone = availableZones.find((z) => z.id === targetZoneId) ?? (canPick ? availableZones[0] : undefined) ?? null;
    const activeZoneId = currentZone?.id ?? null;

    const regionsInZone = activeZoneId
      ? await this.db.selectFrom('regions').select(['id', 'name']).where('zone_id', '=', activeZoneId).orderBy('name', 'asc').execute()
      : [];
    // a region filter only applies when it belongs to the zone in view
    const regionId = query?.region_id && regionsInZone.some((r) => r.id === query.region_id) ? query.region_id : null;

    const managerId = user.role === 'regional_manager' ? user.id : null;
    const territory: Territory = { zoneId: activeZoneId, regionId, managerId };
    const leadScope = territoryLeads(territory);
    const visitScope = territoryVisits(territory);
    const tenderScope = territoryTenders(territory);

    const [pipeline, leadCats, visitSummary, tenderSummary, team] = await Promise.all([
      this.metrics.leadPipeline(leadScope, today),
      sql<{ category: string; c: number }>`
        select l.category, count(*)::int as c from leads l left join organisations o on o.id = l.organisation_id
        where ${leadScope} and ${LEAD_ACTIVE} group by l.category`.execute(this.db),
      this.metrics.visitSummary(visitScope, today),
      this.metrics.tenderSummary(tenderScope),
      this.metrics.teamFigures(teamScope(managerId, activeZoneId), today),
    ]);
    const cat = (...keys: string[]) => leadCats.rows.filter((r) => keys.includes(r.category)).reduce((a, r) => a + Number(r.c || 0), 0);

    const recentLeads = await sql<Record<string, any>>`
      select l.id, o.name as organisation_name, o.city as city, pr.name as product_name, l.category, l.probability, l.channel,
             l.value_lakh, l.next_followup_date, l.status, rep.full_name as assigned_rep_name
      from leads l left join organisations o on o.id = l.organisation_id
      left join users rep on rep.id = l.assigned_to left join products pr on pr.id = l.product_id
      where ${leadScope} and ${LEAD_ACTIVE}
      order by l.created_at desc limit 10`.execute(this.db);

    const recentVisits = await sql<Record<string, any>>`
      select v.id, v.organisation_id, o.name as organisation_name, v.location, v.planned_date, v.purpose, v.status, v.remarks,
             v.assigned_by_manager, rep.full_name as assigned_rep_name
      from visits v left join organisations o on o.id = v.organisation_id left join users rep on rep.id = v.assigned_to
      where ${visitScope}
      order by v.planned_date desc limit 10`.execute(this.db);

    const regionalTendersList = await sql<Record<string, any>>`
      select t.id, t.tender_no, t.department, t.city, t.state, t.category, t.requirement_text, t.quantity, t.emd_fee,
             ${TENDER_DEADLINE} as bid_closing_date, t.status
      from tenders t where ${TENDER_ROW} and ${tenderScope}
      order by ${TENDER_DEADLINE} asc nulls last limit 1000`.execute(this.db);

    // 5. Team accountability: figures from teamFigures; pending blockers listed per rep
    const blockers = team.length
      ? await this.db
          .selectFrom('task_blockers')
          .innerJoin('tasks', 'task_blockers.task_id', 'tasks.id')
          .select([
            'task_blockers.id',
            'task_blockers.raised_by',
            'task_blockers.blocker_type',
            'task_blockers.description',
            'task_blockers.created_at',
            'tasks.title as task_title',
          ])
          .where('task_blockers.raised_by', 'in', team.map((m) => m.id))
          .where('task_blockers.status', '=', 'pending_review')
          .execute()
      : [];

    const teamPerformance = team.map((emp) => {
      const activeBlockers = blockers.filter((b) => b.raised_by === emp.id).map(({ raised_by: _r, ...b }) => b);
      const totalT = emp.tasksTotal;
      const compT = emp.tasksCompleted;
      const overdueT = emp.tasksOverdue;
      // no tasks assigned = nothing to rate (never a fake 100% / "Excellent")
      const rate = totalT > 0 ? Math.round((compT / totalT) * 100) : null;
      let rating: 'Excellent' | 'Good' | 'Needs Attention' | 'Critical' | 'No data';
      if (rate === null) rating = 'No data';
      else if (rate >= 80 && overdueT === 0) rating = 'Excellent';
      else if (rate >= 65 && overdueT <= 1) rating = 'Good';
      else if (overdueT <= 2) rating = 'Needs Attention';
      else rating = 'Critical';
      return {
        id: emp.id,
        full_name: emp.full_name,
        email: emp.email,
        phone: emp.phone,
        role: emp.role,
        region_name: emp.region_name || '—',
        tasks: { total: totalT, completed: compT, open: emp.tasksOpen, overdue: overdueT, blocked: emp.tasksBlocked, completionRate: rate },
        visits: { total: emp.visitsTotal, completed: emp.visitsCompleted, completed30d: emp.visitsCompleted30d },
        // pipeline = active leads only (same as the rep's own "My pipeline")
        leads: { total: emp.leadsTotal, active: emp.leadsActive, valueLakh: emp.pipelineLakh },
        activeBlockers,
        complianceRating: rating,
        evidenceNote:
          rate === null
            ? `No milestones assigned yet. ${activeBlockers.length} active blockers.`
            : `${compT}/${totalT} milestones delivered (${rate}%). ${overdueT} overdue deadlines, ${activeBlockers.length} active blockers.`,
      };
    });

    return {
      zone: currentZone,
      availableZones,
      regionsInZone,
      sales: {
        totalLeads: pipeline.total,
        activeCount: pipeline.active,
        expectedCount: cat('expected'),
        followUpCount: cat('follow_up', 'new_lead'),
        totalPipelineValueLakh: pipeline.lakh,
        highProbValueLakh: pipeline.highLakh,
        medProbValueLakh: pipeline.mediumLakh,
        lowProbValueLakh: pipeline.lowLakh,
        followupsOverdue: pipeline.followupsOverdue,
        recentLeads: recentLeads.rows,
      },
      visits: {
        total: visitSummary.total,
        // still to be made: planned, modified or rescheduled, today or later
        planned: visitSummary.upcoming,
        completed: visitSummary.completed,
        completed30d: visitSummary.completed30d,
        cancelled: visitSummary.cancelled,
        rescheduled: visitSummary.rescheduled,
        interventionCount: visitSummary.withManagerDirective,
        completionRate: visitSummary.completionRate,
        recentVisits: recentVisits.rows,
      },
      tenders: {
        total: tenderSummary.total,
        live: tenderSummary.live,
        closingSoon: tenderSummary.closing7d,
        awaitingApproval: tenderSummary.awaitingApproval,
        underPreparation: tenderSummary.underPreparation,
        won: tenderSummary.won,
        lost: tenderSummary.lost,
        regionalTendersList: regionalTendersList.rows,
      },
      teamPerformance,
    };
  }
}
