import { calendarDay, todayInKolkata } from '../../common/utils/ist-date.util.js';
import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AppEvents } from '../../common/events/event-names.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import type { Database, AuthUser, PaginatedResult } from '@arihant/shared';
import type {
  CreateFollowUpDto,
  CompleteFollowUpDto,
  RescheduleFollowUpDto,
  CancelFollowUpDto,
} from './follow-ups.dto.js';

/** Follow-ups are booked for today or later in IST — never in the past (QA DEF-053). */
function assertNotPast(date: string, label: string) {
  const day = calendarDay(date);
  if (day && day < todayInKolkata()) {
    throw new BadRequestException(`${label} cannot be in the past — choose today or a later date.`);
  }
}

@Injectable()
export class FollowUpsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly outboxService: OutboxService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Loads a follow-up the user may act on: sales only their own, RMs their territory (as the list), others any. */
  private async getActionable(id: string, user: AuthUser) {
    const existing = await this.db
      .selectFrom('follow_ups')
      .leftJoin('organisations', 'follow_ups.organisation_id', 'organisations.id')
      .leftJoin('users as assignee', 'follow_ups.assigned_to', 'assignee.id')
      .selectAll('follow_ups')
      .select([
        'organisations.region_id as org_region_id',
        'organisations.zone_id as org_zone_id',
        'assignee.reporting_manager_id as assignee_manager_id',
      ])
      .where('follow_ups.id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException(`Follow-up with id '${id}' not found`);
    }
    if (user.role === 'sales' && existing.assigned_to !== user.id) {
      throw new ForbiddenException('You can update only your own follow-ups.');
    }
    const inTerritory =
      (!!user.zone_id && existing.org_zone_id === user.zone_id) ||
      (!!user.region_id && existing.org_region_id === user.region_id) ||
      existing.assigned_to === user.id ||
      (!existing.org_zone_id && existing.assignee_manager_id === user.id);
    if (user.role === 'regional_manager' && !inTerritory) {
      throw new ForbiddenException('This follow-up is outside your region.');
    }
    return existing;
  }

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      assigned_to?: string;
      organisation_id?: string;
      lead_id?: string;
      timeframe?: 'due_today' | 'overdue' | 'upcoming';
    },
    user: AuthUser,
  ): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);
    const today = todayInKolkata();

    let baseQuery = this.db
      .selectFrom('follow_ups')
      .innerJoin('organisations', 'follow_ups.organisation_id', 'organisations.id')
      .leftJoin('leads', 'follow_ups.lead_id', 'leads.id')
      // the follow-up's own contact, else the lead's primary contact (QA DEF-095: designation was blank)
      .leftJoin('contacts', (join) =>
        join.on(sql<boolean>`contacts.id = coalesce(follow_ups.contact_id, leads.primary_contact_id)`),
      )
      .leftJoin('users as assignee', 'follow_ups.assigned_to', 'assignee.id')
      .leftJoin('users as completed_by_user', 'follow_ups.completed_by', 'completed_by_user.id');

    if (user.role === 'sales') {
      baseQuery = baseQuery.where('follow_ups.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager') {
      // Same territory as the lead register (QA BUG-001): zone or region, their own, and a direct report's only at
      // customers with no zone tag.
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          ...(user.zone_id ? [eb('organisations.zone_id', '=', user.zone_id)] : []),
          ...(user.region_id ? [eb('organisations.region_id', '=', user.region_id)] : []),
          eb('follow_ups.assigned_to', '=', user.id),
          eb.and([eb('organisations.zone_id', 'is', null), eb('assignee.reporting_manager_id', '=', user.id)]),
        ]),
      );
    }

    if (query.status) {
      baseQuery = baseQuery.where('follow_ups.status', '=', query.status as any);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('follow_ups.assigned_to', '=', query.assigned_to);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('follow_ups.organisation_id', '=', query.organisation_id);
    }

    if (query.lead_id) {
      baseQuery = baseQuery.where('follow_ups.lead_id', '=', query.lead_id);
    }

    if (query.timeframe === 'due_today') {
      baseQuery = baseQuery
        .where('follow_ups.status', '=', 'pending')
        .where('follow_ups.due_date', '=', today);
    } else if (query.timeframe === 'overdue') {
      baseQuery = baseQuery
        .where('follow_ups.status', '=', 'pending')
        .where('follow_ups.due_date', '<', today);
    } else if (query.timeframe === 'upcoming') {
      baseQuery = baseQuery
        .where('follow_ups.status', '=', 'pending')
        .where('follow_ups.due_date', '>', today);
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(coalesce(contacts.full_name, '')) like ${s}`,
          sql<boolean>`lower(coalesce(follow_ups.remarks, '')) like ${s}`,
          sql<boolean>`lower(coalesce(assignee.full_name, '')) like ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery
      .select(sql<number>`count(follow_ups.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const followUps = await baseQuery
      .select([
        'follow_ups.id',
        'follow_ups.organisation_id',
        'follow_ups.contact_id',
        'follow_ups.lead_id',
        'follow_ups.interaction_id',
        'follow_ups.assigned_to',
        'follow_ups.due_date',
        'follow_ups.due_time',
        'follow_ups.status',
        'follow_ups.remarks',
        'follow_ups.outcome',
        'follow_ups.completed_at',
        'follow_ups.completed_by',
        'follow_ups.created_at',
        'follow_ups.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as organisation_city',
        'contacts.full_name as contact_name',
        'contacts.mobile as contact_mobile',
        'contacts.designation as contact_designation',
        'contacts.email as contact_email',
        'leads.lead_status',
        'assignee.full_name as assigned_to_name',
        'assignee.full_name as assigned_salesperson_name',
        'completed_by_user.full_name as completed_by_name',
      ])
      .orderBy('follow_ups.due_date', 'asc')
      .orderBy('follow_ups.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(followUps, total, page, limit);
  }

  async getMetrics(user: AuthUser) {
    const today = todayInKolkata();
    let query = this.db
      .selectFrom('follow_ups')
      .leftJoin('organisations', 'follow_ups.organisation_id', 'organisations.id')
      .leftJoin('users as assignee', 'follow_ups.assigned_to', 'assignee.id');

    if (user.role === 'sales') {
      query = query.where('follow_ups.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager') {
      // Same territory as the lead register (QA BUG-001): zone or region, their own, and a direct report's only at
      // customers with no zone tag.
      query = query.where((eb) =>
        eb.or([
          ...(user.zone_id ? [eb('organisations.zone_id', '=', user.zone_id)] : []),
          ...(user.region_id ? [eb('organisations.region_id', '=', user.region_id)] : []),
          eb('follow_ups.assigned_to', '=', user.id),
          eb.and([eb('organisations.zone_id', 'is', null), eb('assignee.reporting_manager_id', '=', user.id)]),
        ]),
      );
    }

    const stats = await query
      .select([
        sql<number>`count(case when follow_ups.status = 'pending' and follow_ups.due_date = ${today}::date then 1 end)::int`.as('due_today'),
        sql<number>`count(case when follow_ups.status = 'pending' and follow_ups.due_date < ${today}::date then 1 end)::int`.as('overdue'),
        sql<number>`count(case when follow_ups.status = 'pending' and follow_ups.due_date > ${today}::date then 1 end)::int`.as('upcoming'),
        sql<number>`count(case when follow_ups.status = 'completed' then 1 end)::int`.as('completed'),
        sql<number>`count(case when follow_ups.status = 'cancelled' then 1 end)::int`.as('cancelled'),
        sql<number>`count(follow_ups.id)::int`.as('total'),
      ])
      .executeTakeFirst();

    const dueToday = Number(stats?.due_today) || 0;
    const overdue = Number(stats?.overdue) || 0;
    const upcoming = Number(stats?.upcoming) || 0;
    const completed = Number(stats?.completed) || 0;
    const cancelled = Number(stats?.cancelled) || 0;
    const total = Number(stats?.total) || 0;

    return {
      dueToday,
      due_today: dueToday,
      overdue,
      upcoming,
      completed,
      cancelled,
      total,
    };
  }

  async create(dto: CreateFollowUpDto, user: AuthUser) {
    assertNotPast(dto.due_date, 'Follow-up date');
    if (user.role === 'sales' && dto.assigned_to !== user.id) {
      throw new ForbiddenException('Sales executives can schedule follow-ups only for themselves.');
    }
    const result = await this.db.transaction().execute(async (trx) => {
      const followUp = await trx
        .insertInto('follow_ups')
        .values({
          organisation_id: dto.organisation_id,
          contact_id: dto.contact_id || null,
          lead_id: dto.lead_id || null,
          interaction_id: dto.interaction_id || null,
          assigned_to: dto.assigned_to,
          due_date: dto.due_date,
          due_time: dto.due_time || null,
          status: 'pending',
          remarks: dto.remarks || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (dto.lead_id) {
        await trx
          .updateTable('leads')
          .set({
            next_followup_at: new Date(dto.due_date),
            next_followup_date: dto.due_date,
            updated_at: new Date(),
          })
          .where('id', '=', dto.lead_id)
          .execute();
      }

      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.FOLLOWUP_CREATED,
        aggregateType: 'FOLLOW_UP',
        aggregateId: followUp.id,
        actorId: user.id,
        payload: {
          followUpId: followUp.id,
          organisationId: dto.organisation_id,
          leadId: dto.lead_id,
          assignedTo: dto.assigned_to,
          dueDate: dto.due_date,
        },
      });

      return followUp;
    });

    this.outboxService.triggerImmediate();
    this.audit(user, result.id, 'follow_up_scheduled', null, {
      due_date: dto.due_date,
      due_time: dto.due_time || null,
      assigned_to: dto.assigned_to,
      lead_id: dto.lead_id || null,
      remarks: dto.remarks || null,
    });
    return result;
  }

  /** Follow-up work in the security audit trail (entity type `follow_up`), written once the change is committed. */
  private audit(user: AuthUser, followUpId: string, action: string, previousValue: Record<string, unknown> | null, newValue: Record<string, unknown>) {
    this.eventEmitter.emit('audit.log', { actorId: user.id, entityType: 'follow_up', entityId: followUpId, action, previousValue, newValue });
  }

  async complete(id: string, dto: CompleteFollowUpDto, user: AuthUser) {
    const existing = await this.getActionable(id, user);

    if (existing.status === 'completed') {
      throw new BadRequestException('Follow-up is already marked as completed.');
    }
    if (existing.status === 'cancelled') {
      throw new BadRequestException('This follow-up was cancelled and cannot be completed.');
    }
    if (dto.next_followup_date) {
      assertNotPast(dto.next_followup_date, 'Next follow-up date');
    }
    dto.outcome = dto.outcome.trim();

    const result = await this.db.transaction().execute(async (trx) => {
      // Mark completed
      const updated = await trx
        .updateTable('follow_ups')
        .set({
          status: 'completed',
          outcome: dto.outcome,
          remarks: dto.remarks ? `${existing.remarks || ''}\nOutcome: ${dto.remarks}`.trim() : existing.remarks,
          completed_at: new Date(),
          completed_by: user.id,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Log interaction representing the completion of this follow-up
      await trx
        .insertInto('interactions')
        .values({
          organisation_id: existing.organisation_id,
          contact_id: existing.contact_id,
          lead_id: existing.lead_id,
          type: 'follow_up',
          employee_id: user.id,
          occurred_on: todayInKolkata(),
          remarks: `Follow-up completed: ${dto.remarks || 'Client contacted.'}`,
          outcome: dto.outcome,
          next_action: dto.next_followup_date ? `Next follow-up on ${dto.next_followup_date}` : null,
          followup_date: dto.next_followup_date || null,
        })
        .execute();

      // If next follow-up date was requested, spawn next follow-up!
      let nextFollowUp: any = null;
      if (dto.next_followup_date) {
        nextFollowUp = await trx
          .insertInto('follow_ups')
          .values({
            organisation_id: existing.organisation_id,
            contact_id: existing.contact_id,
            lead_id: existing.lead_id,
            assigned_to: existing.assigned_to,
            due_date: dto.next_followup_date,
            due_time: dto.next_followup_time || null,
            status: 'pending',
            remarks: `Continuation: ${dto.outcome}`,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      // Update lead
      if (existing.lead_id) {
        await trx
          .updateTable('leads')
          .set({
            last_interaction_at: new Date(),
            next_followup_at: dto.next_followup_date ? new Date(dto.next_followup_date) : null,
            next_followup_date: dto.next_followup_date || null,
            updated_at: new Date(),
          })
          .where('id', '=', existing.lead_id)
          .execute();
      }

      // Queue domain event: FollowUpCompleted
      await this.outboxService.queueEvent(trx, {
        eventType: AppEvents.FOLLOWUP_COMPLETED,
        aggregateType: 'FOLLOW_UP',
        aggregateId: id,
        actorId: user.id,
        payload: {
          followUpId: id,
          leadId: existing.lead_id,
          organisationId: existing.organisation_id,
          outcome: dto.outcome,
          nextFollowUpDate: dto.next_followup_date,
          completedBy: user.id,
        },
      });

      return {
        completed: updated,
        nextFollowUp,
      };
    });

    this.outboxService.triggerImmediate();
    this.audit(user, id, 'follow_up_completed', { status: existing.status }, {
      status: 'completed',
      outcome: dto.outcome,
      remarks: dto.remarks || null,
      next_followup_date: dto.next_followup_date || null,
    });
    if (result.nextFollowUp) {
      this.audit(user, result.nextFollowUp.id, 'follow_up_scheduled', null, {
        due_date: result.nextFollowUp.due_date,
        assigned_to: result.nextFollowUp.assigned_to,
        lead_id: result.nextFollowUp.lead_id,
        remarks: result.nextFollowUp.remarks,
      });
    }
    return result;
  }

  async reschedule(id: string, dto: RescheduleFollowUpDto, user: AuthUser) {
    const existing = await this.getActionable(id, user);

    if (existing.status !== 'pending') {
      throw new BadRequestException(`A ${existing.status} follow-up cannot be rescheduled.`);
    }
    assertNotPast(dto.new_due_date, 'New due date');

    const updated = await this.db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable('follow_ups')
        .set({
          due_date: dto.new_due_date,
          due_time: dto.new_due_time || null,
          // Every reschedule is noted on the follow-up, with the reason when one is given
          remarks: `${existing.remarks || ''}\nRescheduled to ${dto.new_due_date}${dto.new_due_time ? ` ${dto.new_due_time}` : ''}${
            dto.reason?.trim() ? `: ${dto.reason.trim()}` : ''
          }`.trim(),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (existing.lead_id) {
        await trx
          .updateTable('leads')
          .set({
            next_followup_at: new Date(dto.new_due_date),
            next_followup_date: dto.new_due_date,
            updated_at: new Date(),
          })
          .where('id', '=', existing.lead_id)
          .execute();
      }

      return res;
    });

    this.audit(
      user,
      id,
      'follow_up_rescheduled',
      { due_date: calendarDay(existing.due_date as any), due_time: existing.due_time ?? null },
      { due_date: dto.new_due_date, due_time: dto.new_due_time || null, reason: dto.reason?.trim() || null },
    );
    return updated;
  }

  async cancel(id: string, dto: CancelFollowUpDto, user: AuthUser) {
    const existing = await this.getActionable(id, user);

    const updated = await this.db
      .updateTable('follow_ups')
      .set({
        status: 'cancelled',
        remarks: dto.reason
          ? `${existing.remarks || ''}\nCancelled: ${dto.reason}`.trim()
          : existing.remarks,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.audit(user, id, 'follow_up_cancelled', { status: existing.status }, { status: 'cancelled', reason: dto.reason || null });
    return updated;
  }
}
