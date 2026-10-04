import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database, AuthUser, DashboardMetricsDto } from '@arihant/shared';

@Injectable()
export class DashboardService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async getMetrics(user: AuthUser): Promise<DashboardMetricsDto> {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    // 1. Tenders metrics
    let tenderQuery = this.db.selectFrom('tenders');
    if (user.role === 'regional_manager' && user.zone_id) {
      tenderQuery = tenderQuery.where('zone_id', '=', user.zone_id);
    }

    const [
      tenderTotal,
      tenderClosingSoon,
      tenderUnderPrep,
      tenderAwaitingApproval,
      tenderWon,
      tenderLost,
    ] = await Promise.all([
      tenderQuery.select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      tenderQuery
        .select(sql<number>`count(id)::int`.as('c'))
        .where('status', 'not in', ['won', 'lost', 'cancelled'])
        .where('bid_closing_date', 'is not', null)
        .where('bid_closing_date', '<=', sevenDaysFromNow.toISOString())
        .where('bid_closing_date', '>=', now.toISOString())
        .executeTakeFirst(),
      tenderQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'under_preparation').executeTakeFirst(),
      tenderQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'awaiting_approval').executeTakeFirst(),
      tenderQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'won').executeTakeFirst(),
      tenderQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'lost').executeTakeFirst(),
    ]);

    // 2. Leads metrics
    let leadQuery = this.db.selectFrom('leads');
    if (user.role === 'sales') {
      leadQuery = leadQuery.where('assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager' && user.region_id) {
      leadQuery = leadQuery.where('regional_manager_id', '=', user.id);
    }

    const [
      leadTotal,
      leadActive,
      leadExpected,
      leadFollowUp,
      leadValue,
    ] = await Promise.all([
      leadQuery.select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      leadQuery.select(sql<number>`count(id)::int`.as('c')).where('category', '=', 'active').executeTakeFirst(),
      leadQuery.select(sql<number>`count(id)::int`.as('c')).where('category', '=', 'expected').executeTakeFirst(),
      leadQuery.select(sql<number>`count(id)::int`.as('c')).where('category', '=', 'follow_up').executeTakeFirst(),
      leadQuery.select(sql<number>`coalesce(sum(value_lakh), 0)::float`.as('val')).executeTakeFirst(),
    ]);

    // 3. Tasks metrics
    let taskQuery = this.db.selectFrom('tasks');
    if (['sales', 'demo_team', 'service_team', 'tender_team'].includes(user.role)) {
      taskQuery = taskQuery.where('assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager') {
      taskQuery = taskQuery.where((eb) =>
        eb.or([
          eb('assigned_to', '=', user.id),
          eb('reporting_manager_id', '=', user.id),
        ]),
      );
    }

    const [
      taskTotal,
      taskPending,
      taskBlocked,
      taskOverdue,
    ] = await Promise.all([
      taskQuery.select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      taskQuery.select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['not_started', 'in_progress']).executeTakeFirst(),
      taskQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'blocked').executeTakeFirst(),
      taskQuery
        .select(sql<number>`count(id)::int`.as('c'))
        .where('status', '!=', 'completed')
        .where('deadline', '<', today)
        .executeTakeFirst(),
    ]);

    // 4. Expenses metrics
    let expQuery = this.db.selectFrom('expenses');
    if (['sales', 'demo_team', 'service_team'].includes(user.role)) {
      expQuery = expQuery.where('employee_id', '=', user.id);
    }

    const [
      expPendingManager,
      expPendingAccounts,
      expProcessed,
      expPendingAmount,
    ] = await Promise.all([
      expQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'submitted').executeTakeFirst(),
      expQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'manager_approved').executeTakeFirst(),
      expQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'accounts_processed').executeTakeFirst(),
      expQuery
        .select(sql<number>`coalesce(sum(amount), 0)::float`.as('amt'))
        .where('status', 'in', ['submitted', 'manager_approved'])
        .executeTakeFirst(),
    ]);

    // 5. Service tickets metrics
    const [ticketTotal, ticketOpen, ticketCritical] = await Promise.all([
      this.db.selectFrom('service_tickets').select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      this.db
        .selectFrom('service_tickets')
        .select(sql<number>`count(id)::int`.as('c'))
        .where('status', 'not in', ['resolved', 'closed'])
        .executeTakeFirst(),
      this.db
        .selectFrom('service_tickets')
        .select(sql<number>`count(id)::int`.as('c'))
        .where('priority', '=', 'critical')
        .where('status', 'not in', ['resolved', 'closed'])
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

    // 8. Proposals metrics
    const [propTotal, propUnderPrep, propSent, propConverted, propLost] = await Promise.all([
      this.db.selectFrom('proposals').select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      this.db.selectFrom('proposals').select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['under_preparation', 'UNDER_PREPARATION']).executeTakeFirst(),
      this.db.selectFrom('proposals').select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['sent', 'SENT_TO_CUSTOMER']).executeTakeFirst(),
      this.db.selectFrom('proposals').select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['converted', 'CONVERTED']).executeTakeFirst(),
      this.db.selectFrom('proposals').select(sql<number>`count(id)::int`.as('c')).where('status', 'in', ['lost', 'LOST']).executeTakeFirst(),
    ]);

    // 9. Recent critical exceptions (for management command center)
    const recentExceptions: any[] = [];

    // Tenders closing soon
    const urgentTenders = await this.db
      .selectFrom('tenders')
      .leftJoin('organisations', 'tenders.organisation_id', 'organisations.id')
      .select(['tenders.id', 'tenders.tender_no', 'tenders.bid_closing_date', 'organisations.name as org_name'])
      .where('status', 'not in', ['won', 'lost', 'cancelled'])
      .where('bid_closing_date', 'is not', null)
      .where('bid_closing_date', '<=', sevenDaysFromNow.toISOString())
      .where('bid_closing_date', '>=', now.toISOString())
      .limit(3)
      .execute();

    for (const ut of urgentTenders) {
      recentExceptions.push({
        id: `tend-${ut.id}`,
        type: 'tender_deadline',
        title: `Tender ${ut.tender_no} Closes Soon`,
        description: `Bid closing deadline: ${new Date(ut.bid_closing_date!).toLocaleDateString('en-IN')}`,
        entityId: ut.id,
        severity: 'critical',
        timestamp: ut.bid_closing_date,
      });
    }

    // Blocked tasks
    const blockedTasks = await this.db
      .selectFrom('tasks')
      .innerJoin('task_blockers', 'tasks.id', 'task_blockers.task_id')
      .select(['tasks.id', 'tasks.title', 'task_blockers.blocker_type', 'task_blockers.description'])
      .where('tasks.status', '=', 'blocked')
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
        timestamp: new Date().toISOString(),
      });
    }

    // Tenders awaiting approval
    const approvalTenders = await this.db
      .selectFrom('tenders')
      .select(['id', 'tender_no', 'department'])
      .where('status', '=', 'awaiting_approval')
      .limit(2)
      .execute();

    for (const at of approvalTenders) {
      recentExceptions.push({
        id: `appr-${at.id}`,
        type: 'tender_approval',
        title: `Approval Required: ${at.tender_no}`,
        description: `Participation approval requested for ${at.department || 'Government Buyer'}`,
        entityId: at.id,
        severity: 'warning',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      tendersCount: {
        total: tenderTotal?.c || 0,
        closingSoon: tenderClosingSoon?.c || 0,
        underPreparation: tenderUnderPrep?.c || 0,
        awaitingApproval: tenderAwaitingApproval?.c || 0,
        won: tenderWon?.c || 0,
        lost: tenderLost?.c || 0,
      },
      leadsCount: {
        total: leadTotal?.c || 0,
        active: leadActive?.c || 0,
        expected: leadExpected?.c || 0,
        followUp: leadFollowUp?.c || 0,
        totalValueLakh: Math.round((leadValue?.val || 0) * 100) / 100,
      },
      tasksCount: {
        total: taskTotal?.c || 0,
        pending: taskPending?.c || 0,
        blocked: taskBlocked?.c || 0,
        overdue: taskOverdue?.c || 0,
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

  async getRegionalPerformance(user: AuthUser, query?: { zone_id?: string; region_id?: string }) {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    // 1. Resolve Available Zones and Target Zone
    const availableZones = await this.db
      .selectFrom('zones')
      .select(['id', 'code', 'name'])
      .orderBy('name', 'asc')
      .execute();

    let targetZoneId = user.zone_id;
    if (user.role === 'management' || user.role === 'admin') {
      if (query?.zone_id) {
        targetZoneId = query.zone_id;
      }
    }

    if (!targetZoneId && availableZones.length > 0) {
      targetZoneId = availableZones[0].id;
    }

    const currentZone = availableZones.find((z) => z.id === targetZoneId) || availableZones[0];
    const activeZoneId = currentZone?.id;

    // Load regions in this zone
    const regionsInZone = activeZoneId
      ? await this.db
          .selectFrom('regions')
          .select(['id', 'name'])
          .where('zone_id', '=', activeZoneId)
          .orderBy('name', 'asc')
          .execute()
      : [];

    // 2. Regional Sales & Leads Pipeline
    let leadsQuery = this.db
      .selectFrom('leads')
      .innerJoin('organisations', 'leads.organisation_id', 'organisations.id');

    if (activeZoneId) {
      leadsQuery = leadsQuery.where('organisations.zone_id', '=', activeZoneId);
    }
    if (query?.region_id) {
      leadsQuery = leadsQuery.where('organisations.region_id', '=', query.region_id);
    }

    const [
      leadsTotalRes,
      leadsActiveRes,
      leadsExpectedRes,
      leadsFollowUpRes,
      leadsValueRes,
      highProbValRes,
      medProbValRes,
      lowProbValRes,
    ] = await Promise.all([
      leadsQuery.select(sql<number>`count(leads.id)::int`.as('c')).executeTakeFirst(),
      leadsQuery.select(sql<number>`count(leads.id)::int`.as('c')).where('leads.category', '=', 'active').executeTakeFirst(),
      leadsQuery.select(sql<number>`count(leads.id)::int`.as('c')).where('leads.category', '=', 'expected').executeTakeFirst(),
      leadsQuery.select(sql<number>`count(leads.id)::int`.as('c')).where('leads.category', 'in', ['follow_up', 'new_lead']).executeTakeFirst(),
      leadsQuery.select(sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('v')).executeTakeFirst(),
      leadsQuery.select(sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('v')).where('leads.probability', '=', 'high').executeTakeFirst(),
      leadsQuery.select(sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('v')).where('leads.probability', '=', 'medium').executeTakeFirst(),
      leadsQuery.select(sql<number>`coalesce(sum(leads.value_lakh), 0)::float`.as('v')).where('leads.probability', '=', 'low').executeTakeFirst(),
    ]);

    const recentLeads = await leadsQuery
      .leftJoin('users as rep', 'leads.assigned_to', 'rep.id')
      .leftJoin('products', 'leads.product_id', 'products.id')
      .select([
        'leads.id',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'leads.category',
        'leads.probability',
        'leads.channel',
        'leads.value_lakh',
        'leads.next_followup_date',
        'leads.status',
        'rep.full_name as assigned_rep_name',
      ])
      .orderBy('leads.created_at', 'desc')
      .limit(10)
      .execute();

    // 3. Regional Visits & Tour Planning
    let visitsQuery = this.db
      .selectFrom('visits')
      .innerJoin('organisations', 'visits.organisation_id', 'organisations.id');

    if (activeZoneId) {
      visitsQuery = visitsQuery.where('organisations.zone_id', '=', activeZoneId);
    }
    if (query?.region_id) {
      visitsQuery = visitsQuery.where('organisations.region_id', '=', query.region_id);
    }

    const [
      visitsTotalRes,
      visitsPlannedRes,
      visitsCompletedRes,
      visitsCancelledRes,
      visitsRescheduledRes,
      visitsInterventionRes,
    ] = await Promise.all([
      visitsQuery.select(sql<number>`count(visits.id)::int`.as('c')).executeTakeFirst(),
      visitsQuery.select(sql<number>`count(visits.id)::int`.as('c')).where('visits.status', '=', 'planned').executeTakeFirst(),
      visitsQuery.select(sql<number>`count(visits.id)::int`.as('c')).where('visits.status', '=', 'completed').executeTakeFirst(),
      visitsQuery.select(sql<number>`count(visits.id)::int`.as('c')).where('visits.status', '=', 'cancelled').executeTakeFirst(),
      visitsQuery.select(sql<number>`count(visits.id)::int`.as('c')).where('visits.status', '=', 'rescheduled').executeTakeFirst(),
      visitsQuery.select(sql<number>`count(visits.id)::int`.as('c')).where('visits.assigned_by_manager', 'is not', null).executeTakeFirst(),
    ]);

    const recentVisits = await visitsQuery
      .leftJoin('users as rep', 'visits.assigned_to', 'rep.id')
      .select([
        'visits.id',
        'organisations.name as organisation_name',
        'visits.location',
        'visits.planned_date',
        'visits.purpose',
        'visits.status',
        'visits.remarks',
        'visits.assigned_by_manager',
        'rep.full_name as assigned_rep_name',
      ])
      .orderBy('visits.planned_date', 'desc')
      .limit(10)
      .execute();

    const totalVisits = visitsTotalRes?.c || 0;
    const completedVisits = visitsCompletedRes?.c || 0;
    const visitCompletionRate = totalVisits > 0 ? Math.round((completedVisits / totalVisits) * 100) : 0;

    // 4. Regional Tender Pipeline
    let tendersQuery = this.db.selectFrom('tenders');
    if (activeZoneId) {
      tendersQuery = tendersQuery.where('zone_id', '=', activeZoneId);
    }
    if (query?.region_id) {
      tendersQuery = tendersQuery.where('region_id', '=', query.region_id);
    }

    const [
      tendersTotalRes,
      tendersClosingSoonRes,
      tendersAwaitingRes,
      tendersUnderPrepRes,
      tendersWonRes,
      tendersLostRes,
    ] = await Promise.all([
      tendersQuery.select(sql<number>`count(id)::int`.as('c')).executeTakeFirst(),
      tendersQuery
        .select(sql<number>`count(id)::int`.as('c'))
        .where('status', 'not in', ['won', 'lost', 'cancelled'])
        .where('bid_closing_date', 'is not', null)
        .where('bid_closing_date', '<=', sevenDaysFromNow.toISOString())
        .where('bid_closing_date', '>=', now.toISOString())
        .executeTakeFirst(),
      tendersQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'awaiting_approval').executeTakeFirst(),
      tendersQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'under_preparation').executeTakeFirst(),
      tendersQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'won').executeTakeFirst(),
      tendersQuery.select(sql<number>`count(id)::int`.as('c')).where('status', '=', 'lost').executeTakeFirst(),
    ]);

    const regionalTendersList = await tendersQuery
      .select([
        'id',
        'tender_no',
        'department',
        'city',
        'state',
        'category',
        'requirement_text',
        'quantity',
        'emd_fee',
        'bid_closing_date',
        'status',
      ])
      .orderBy('bid_closing_date', 'asc')
      .limit(10)
      .execute();

    // 5. Regional Employee Performance & Accountability
    let teamQuery = this.db
      .selectFrom('users')
      .leftJoin('regions', 'users.region_id', 'regions.id')
      .where('users.is_active', '=', true)
      .where('users.role', 'in', ['sales', 'demo_team', 'service_team']);

    if (user.role === 'regional_manager') {
      teamQuery = teamQuery.where((eb) =>
        eb.or([
          eb('users.reporting_manager_id', '=', user.id),
          eb('users.zone_id', '=', activeZoneId),
        ]),
      );
    } else if (activeZoneId) {
      teamQuery = teamQuery.where('users.zone_id', '=', activeZoneId);
    }

    const teamMembers = await teamQuery
      .select([
        'users.id',
        'users.full_name',
        'users.email',
        'users.phone',
        'users.role',
        'regions.name as region_name',
      ])
      .orderBy('users.full_name', 'asc')
      .execute();

    const employeePerformance = await Promise.all(
      teamMembers.map(async (emp) => {
        const [
          tasksTotal,
          tasksCompleted,
          tasksOverdue,
          tasksBlocked,
          empVisitsTotal,
          empVisitsCompleted,
          empLeadsTotal,
          empLeadsVal,
          activeBlockers,
        ] = await Promise.all([
          this.db.selectFrom('tasks').select(sql<number>`count(id)::int`.as('c')).where('assigned_to', '=', emp.id).executeTakeFirst(),
          this.db.selectFrom('tasks').select(sql<number>`count(id)::int`.as('c')).where('assigned_to', '=', emp.id).where('status', '=', 'completed').executeTakeFirst(),
          this.db
            .selectFrom('tasks')
            .select(sql<number>`count(id)::int`.as('c'))
            .where('assigned_to', '=', emp.id)
            .where('status', '!=', 'completed')
            .where('deadline', '<', today)
            .executeTakeFirst(),
          this.db.selectFrom('tasks').select(sql<number>`count(id)::int`.as('c')).where('assigned_to', '=', emp.id).where('status', '=', 'blocked').executeTakeFirst(),
          this.db.selectFrom('visits').select(sql<number>`count(id)::int`.as('c')).where('assigned_to', '=', emp.id).executeTakeFirst(),
          this.db.selectFrom('visits').select(sql<number>`count(id)::int`.as('c')).where('assigned_to', '=', emp.id).where('status', '=', 'completed').executeTakeFirst(),
          this.db.selectFrom('leads').select(sql<number>`count(id)::int`.as('c')).where('assigned_to', '=', emp.id).executeTakeFirst(),
          this.db.selectFrom('leads').select(sql<number>`coalesce(sum(value_lakh), 0)::float`.as('v')).where('assigned_to', '=', emp.id).executeTakeFirst(),
          this.db
            .selectFrom('task_blockers')
            .innerJoin('tasks', 'task_blockers.task_id', 'tasks.id')
            .select([
              'task_blockers.id',
              'task_blockers.blocker_type',
              'task_blockers.description',
              'task_blockers.created_at',
              'tasks.title as task_title',
            ])
            .where('task_blockers.raised_by', '=', emp.id)
            .where('task_blockers.manager_decision', 'is', null)
            .execute(),
        ]);

        const totalT = tasksTotal?.c || 0;
        const compT = tasksCompleted?.c || 0;
        const overdueT = tasksOverdue?.c || 0;
        const blockedT = tasksBlocked?.c || 0;
        const rate = totalT > 0 ? Math.round((compT / totalT) * 100) : 100;

        let rating: 'Excellent' | 'Good' | 'Needs Attention' | 'Critical' = 'Good';
        if (rate >= 80 && overdueT === 0) {
          rating = 'Excellent';
        } else if (rate >= 65 && overdueT <= 1) {
          rating = 'Good';
        } else if (overdueT <= 2) {
          rating = 'Needs Attention';
        } else {
          rating = 'Critical';
        }

        return {
          id: emp.id,
          full_name: emp.full_name,
          email: emp.email,
          phone: emp.phone,
          role: emp.role,
          region_name: emp.region_name || 'Territory Core',
          tasks: {
            total: totalT,
            completed: compT,
            overdue: overdueT,
            blocked: blockedT,
            completionRate: rate,
          },
          visits: {
            total: empVisitsTotal?.c || 0,
            completed: empVisitsCompleted?.c || 0,
          },
          leads: {
            total: empLeadsTotal?.c || 0,
            valueLakh: Math.round((empLeadsVal?.v || 0) * 100) / 100,
          },
          activeBlockers,
          complianceRating: rating,
          evidenceNote: `${compT}/${totalT} milestones delivered (${rate}%). ${overdueT} overdue deadlines, ${activeBlockers.length} active blockers.`,
        };
      }),
    );

    return {
      zone: currentZone,
      availableZones,
      regionsInZone,
      sales: {
        totalLeads: leadsTotalRes?.c || 0,
        activeCount: leadsActiveRes?.c || 0,
        expectedCount: leadsExpectedRes?.c || 0,
        followUpCount: leadsFollowUpRes?.c || 0,
        totalPipelineValueLakh: Math.round((leadsValueRes?.v || 0) * 100) / 100,
        highProbValueLakh: Math.round((highProbValRes?.v || 0) * 100) / 100,
        medProbValueLakh: Math.round((medProbValRes?.v || 0) * 100) / 100,
        lowProbValueLakh: Math.round((lowProbValRes?.v || 0) * 100) / 100,
        recentLeads,
      },
      visits: {
        total: totalVisits,
        planned: visitsPlannedRes?.c || 0,
        completed: completedVisits,
        cancelled: visitsCancelledRes?.c || 0,
        rescheduled: visitsRescheduledRes?.c || 0,
        interventionCount: visitsInterventionRes?.c || 0,
        completionRate: visitCompletionRate,
        recentVisits,
      },
      tenders: {
        total: tendersTotalRes?.c || 0,
        closingSoon: tendersClosingSoonRes?.c || 0,
        awaitingApproval: tendersAwaitingRes?.c || 0,
        underPreparation: tendersUnderPrepRes?.c || 0,
        won: tendersWonRes?.c || 0,
        lost: tendersLostRes?.c || 0,
        regionalTendersList,
      },
      teamPerformance: employeePerformance,
    };
  }
}

