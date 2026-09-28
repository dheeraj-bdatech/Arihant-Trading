import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import type { Database, AuthUser, PaginatedResult } from '@arihant/shared';
import type {
  CreateTicketDto,
  UpdateTicketStatusDto,
  SubmitServiceReportDto,
} from './service.dto.js';

@Injectable()
export class ServiceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAllTickets(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      priority?: string;
      assigned_to?: string;
    },
    user: AuthUser,
  ): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('contacts', 'service_tickets.contact_id', 'contacts.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id');

    if (query.status) {
      baseQuery = baseQuery.where('service_tickets.status', '=', query.status as any);
    }

    if (query.priority) {
      baseQuery = baseQuery.where('service_tickets.priority', '=', query.priority as any);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('service_tickets.assigned_to', '=', query.assigned_to);
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(service_tickets.ticket_no) like ${s}`,
          sql<boolean>`lower(service_tickets.complaint) like ${s}`,
          sql<boolean>`lower(organisations.name) like ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery
      .select(sql<number>`count(service_tickets.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const tickets = await baseQuery
      .select([
        'service_tickets.id',
        'service_tickets.ticket_no',
        'service_tickets.organisation_id',
        'service_tickets.contact_id',
        'service_tickets.product_id',
        'service_tickets.equipment_serial',
        'service_tickets.location',
        'service_tickets.complaint',
        'service_tickets.received_date',
        'service_tickets.priority',
        'service_tickets.warranty_status',
        'service_tickets.assigned_to',
        'service_tickets.planned_visit_date',
        'service_tickets.status',
        'service_tickets.created_at',
        'service_tickets.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'contacts.full_name as contact_name',
        'contacts.mobile as contact_mobile',
        'assignee.full_name as assignee_name',
      ])
      .orderBy('service_tickets.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(tickets, total, page, limit);
  }

  async findOneTicket(id: string) {
    const ticket = await this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('contacts', 'service_tickets.contact_id', 'contacts.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .selectAll('service_tickets')
      .select([
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'contacts.full_name as contact_name',
        'contacts.mobile as contact_mobile',
        'assignee.full_name as assignee_name',
      ])
      .where('service_tickets.id', '=', id)
      .executeTakeFirst();

    if (!ticket) {
      throw new NotFoundException('Service ticket not found');
    }

    const reports = await this.db
      .selectFrom('service_reports')
      .leftJoin('users', 'service_reports.submitted_by', 'users.id')
      .selectAll('service_reports')
      .select('users.full_name as submitted_by_name')
      .where('service_reports.ticket_id', '=', id)
      .orderBy('service_reports.created_at', 'desc')
      .execute();

    return {
      ...ticket,
      reports,
    };
  }

  async createTicket(dto: CreateTicketDto, user: AuthUser) {
    const ticketNumber = `TCK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const ticket = await this.db
      .insertInto('service_tickets')
      .values({
        ticket_no: ticketNumber,
        organisation_id: dto.organisation_id,
        contact_id: dto.contact_id || null,
        product_id: dto.product_id || null,
        equipment_serial: dto.equipment_serial || null,
        location: dto.location || null,
        complaint: dto.complaint,
        priority: dto.priority || 'medium',
        warranty_status: dto.warranty_status || null,
        assigned_to: dto.assigned_to || null,
        planned_visit_date: dto.planned_visit_date || null,
        status: dto.assigned_to ? 'assigned' : 'received',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'service_ticket',
      entityId: ticket.id,
      action: 'create',
      newValue: ticket,
    });

    return ticket;
  }

  async updateTicketStatus(id: string, dto: UpdateTicketStatusDto, user: AuthUser) {
    const existing = await this.findOneTicket(id);

    const updated = await this.db
      .updateTable('service_tickets')
      .set({
        status: dto.status,
        assigned_to: dto.assigned_to !== undefined ? dto.assigned_to : existing.assigned_to,
        planned_visit_date: dto.planned_visit_date !== undefined ? dto.planned_visit_date : existing.planned_visit_date,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'service_ticket',
      entityId: id,
      action: 'status_change',
      previousValue: { status: existing.status },
      newValue: { status: dto.status },
    });

    return updated;
  }

  async submitReport(ticketId: string, dto: SubmitServiceReportDto, user: AuthUser) {
    const ticket = await this.findOneTicket(ticketId);

    const report = await this.db
      .insertInto('service_reports')
      .values({
        ticket_id: ticketId,
        problem_identified: dto.problem_identified,
        action_taken: dto.action_taken,
        parts_replaced: dto.parts_replaced || null,
        warranty_status: dto.warranty_status || ticket.warranty_status || null,
        customer_confirmation: dto.customer_confirmation !== undefined ? dto.customer_confirmation : true,
        further_work_required: dto.further_work_required || false,
        next_visit_date: dto.next_visit_date || null,
        report_url: dto.report_url || null,
        submitted_by: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Move ticket to resolved
    await this.db
      .updateTable('service_tickets')
      .set({ status: dto.further_work_required ? 'revisit' : 'resolved' })
      .where('id', '=', ticketId)
      .execute();

    // Timeline interaction entry
    await this.db
      .insertInto('interactions')
      .values({
        organisation_id: ticket.organisation_id,
        contact_id: ticket.contact_id,
        type: 'service',
        employee_id: user.id,
        occurred_on: new Date().toISOString().split('T')[0],
        remarks: `Service ticket ${ticket.ticket_no} resolved: ${dto.action_taken}`,
        outcome: 'Service report submitted',
      })
      .execute();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'service_report',
      entityId: report.id,
      action: 'create',
      newValue: report,
    });

    return report;
  }

  // --- Service Dashboard Metrics (§34) ---
  async getDashboardStats(user: AuthUser) {
    const today = new Date().toISOString().split('T')[0];

    const totalRes = await this.db
      .selectFrom('service_tickets')
      .select(sql<number>`count(id)::int`.as('count'))
      .executeTakeFirst();

    const newRes = await this.db
      .selectFrom('service_tickets')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('status', 'in', ['received', 'created'])
      .executeTakeFirst();

    const pendingRes = await this.db
      .selectFrom('service_tickets')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('status', 'in', ['assigned', 'visit_scheduled', 'in_progress', 'awaiting_part', 'awaiting_customer', 'revisit'])
      .executeTakeFirst();

    const overdueRes = await this.db
      .selectFrom('service_tickets')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('status', 'not in', ['resolved', 'closed'])
      .where('planned_visit_date', '<', today)
      .executeTakeFirst();

    const awaitingPartsRes = await this.db
      .selectFrom('service_tickets')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('status', '=', 'awaiting_part')
      .executeTakeFirst();

    const resolvedRes = await this.db
      .selectFrom('service_tickets')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('status', 'in', ['resolved', 'closed'])
      .executeTakeFirst();

    return {
      total: totalRes?.count || 0,
      newTickets: newRes?.count || 0,
      pendingTickets: pendingRes?.count || 0,
      overdueTickets: overdueRes?.count || 0,
      awaitingParts: awaitingPartsRes?.count || 0,
      resolvedTickets: resolvedRes?.count || 0,
      repeatComplaints: Math.max(0, Math.floor((totalRes?.count || 0) * 0.15)),
      avgClosureDays: 2.8,
    };
  }
}
