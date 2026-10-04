import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import type { Database, AuthUser, PaginatedResult } from '@arihant/shared';
import {
  type CreateTicketDto,
  type UpdateTicketStatusDto,
  type SubmitServiceReportDto,
  type CreateVisitDto,
  type CheckInVisitDto,
  type CheckOutVisitDto,
  type CreatePartRequestDto,
  type UpdatePartRequestStatusDto,
  type CreateTicketCommentDto,
  type ReviewServiceReportDto,
  UUID_REGEX,
} from './service.dto.js';

@Injectable()
export class ServiceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // =========================================================================
  // 1. Ticket Query & Retrieval
  // =========================================================================
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
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .where('service_tickets.deleted_at', 'is', null);

    // Role-based territorial scoping (§3 RBAC)
    if (user.role === 'service_team') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('service_tickets.assigned_to', '=', user.id),
          eb('service_tickets.assigned_to', 'is', null),
          sql<boolean>`service_tickets.additional_engineer_ids @> ${JSON.stringify([user.id])}::jsonb`,
        ]),
      );
    } else if (user.role === 'regional_manager' || user.role === 'sales') {
      if (user.zone_id) {
        baseQuery = baseQuery.where('organisations.zone_id', '=', user.zone_id);
      } else if (user.region_id) {
        baseQuery = baseQuery.where('organisations.region_id', '=', user.region_id);
      }
    }

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
          sql<boolean>`lower(coalesce(service_tickets.ticket_no, service_tickets.ticket_number, '')) like ${s}`,
          sql<boolean>`lower(coalesce(service_tickets.complaint, service_tickets.complaint_description, '')) like ${s}`,
          sql<boolean>`lower(coalesce(service_tickets.equipment_serial, service_tickets.serial_number, '')) like ${s}`,
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
        sql<string>`coalesce(service_tickets.ticket_no, service_tickets.ticket_number)`.as('ticket_no'),
        sql<string>`coalesce(service_tickets.ticket_number, service_tickets.ticket_no)`.as('ticket_number'),
        'service_tickets.organisation_id',
        sql<string>`coalesce(service_tickets.customer_id, service_tickets.organisation_id)`.as('customer_id'),
        'service_tickets.contact_id',
        'service_tickets.product_id',
        sql<string>`coalesce(service_tickets.equipment_id, service_tickets.product_id)`.as('equipment_id'),
        'service_tickets.equipment_serial',
        sql<string>`coalesce(service_tickets.serial_number, service_tickets.equipment_serial)`.as('serial_number'),
        'service_tickets.location',
        'service_tickets.complaint',
        sql<string>`coalesce(service_tickets.complaint_description, service_tickets.complaint)`.as('complaint_description'),
        'service_tickets.received_date',
        'service_tickets.priority',
        'service_tickets.warranty_status',
        'service_tickets.warranty_status_snapshot',
        'service_tickets.is_chargeable',
        'service_tickets.assigned_to',
        sql<string>`coalesce(service_tickets.assigned_engineer_id, service_tickets.assigned_to)`.as('assigned_engineer_id'),
        'service_tickets.planned_visit_date',
        'service_tickets.status',
        'service_tickets.status_reason',
        'service_tickets.sla_response_due_at',
        'service_tickets.sla_resolution_due_at',
        'service_tickets.version',
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

  async findOneTicket(id: string, user?: AuthUser) {
    if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
      throw new NotFoundException(`Service ticket ${id} not found`);
    }

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
      .where('service_tickets.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!ticket) {
      throw new NotFoundException('Service ticket not found');
    }

    // Role security check: Service engineer can only access their assigned tickets
    if (user && user.role === 'service_team') {
      const isAssigned =
        ticket.assigned_to === user.id ||
        ticket.assigned_engineer_id === user.id ||
        (Array.isArray(ticket.additional_engineer_ids) && (ticket.additional_engineer_ids as string[]).includes(user.id)) ||
        ticket.assigned_to === null;
      if (!isAssigned) {
        throw new ForbiddenException('Access denied: You are not assigned to this service ticket');
      }
    }

    // Related collections
    const reports = await this.db
      .selectFrom('service_reports')
      .leftJoin('users', 'service_reports.submitted_by', 'users.id')
      .selectAll('service_reports')
      .select('users.full_name as submitted_by_name')
      .where('service_reports.ticket_id', '=', id)
      .orderBy('service_reports.created_at', 'desc')
      .execute();

    const visits = await this.db
      .selectFrom('service_visits')
      .selectAll('service_visits')
      .where('service_visits.ticket_id', '=', id)
      .orderBy('service_visits.visit_number', 'asc')
      .execute();

    const partRequests = await this.db
      .selectFrom('part_requests')
      .leftJoin('users', 'part_requests.requested_by', 'users.id')
      .selectAll('part_requests')
      .select('users.full_name as requested_by_name')
      .where('part_requests.ticket_id', '=', id)
      .orderBy('part_requests.created_at', 'desc')
      .execute();

    let commentsQuery = this.db
      .selectFrom('ticket_comments')
      .leftJoin('users', 'ticket_comments.author_id', 'users.id')
      .selectAll('ticket_comments')
      .select('users.full_name as author_name')
      .where('ticket_comments.ticket_id', '=', id)
      .orderBy('ticket_comments.created_at', 'asc');

    // Strip internal comments if viewing as customer
    if (user && (user as any).role === 'customer') {
      commentsQuery = commentsQuery.where('ticket_comments.is_internal', '=', false);
    }
    const comments = await commentsQuery.execute();

    const statusHistory = await this.db
      .selectFrom('ticket_status_history')
      .leftJoin('users', 'ticket_status_history.changed_by', 'users.id')
      .selectAll('ticket_status_history')
      .select('users.full_name as changed_by_name')
      .where('ticket_status_history.ticket_id', '=', id)
      .orderBy('ticket_status_history.changed_at', 'desc')
      .execute();

    // Check repeat complaint for same organisation and serial or product (§34)
    let repeatCount = 0;
    const serial = ticket.equipment_serial || ticket.serial_number;
    const prodId = ticket.product_id || ticket.equipment_id;
    if (ticket.organisation_id && (serial || prodId)) {
      const repeatRes = await this.db
        .selectFrom('service_tickets')
        .select(sql<number>`count(id)::int`.as('count'))
        .where('organisation_id', '=', ticket.organisation_id)
        .where('id', '<>', id)
        .where((eb) => {
          if (serial) {
            return eb.or([
              eb('equipment_serial', '=', serial),
              eb('serial_number', '=', serial),
            ]);
          }
          return eb.or([
            eb('product_id', '=', prodId),
            eb('equipment_id', '=', prodId),
          ]);
        })
        .where('created_at', '<', ticket.created_at)
        .executeTakeFirst();
      repeatCount = repeatRes?.count || 0;
    }

    return {
      ...ticket,
      ticket_no: ticket.ticket_no || ticket.ticket_number,
      ticket_number: ticket.ticket_number || ticket.ticket_no,
      complaint: ticket.complaint || ticket.complaint_description,
      complaint_description: ticket.complaint_description || ticket.complaint,
      equipment_serial: serial,
      serial_number: serial,
      is_repeat_complaint: repeatCount > 0,
      repeat_count: repeatCount,
      reports,
      visits,
      part_requests: partRequests,
      comments,
      status_history: statusHistory,
    };
  }

  // =========================================================================
  // 2. Ticket Creation
  // =========================================================================
  async createTicket(dto: CreateTicketDto, user: AuthUser) {
    const orgId = dto.organisation_id || dto.customer_id;
    if (!orgId || typeof orgId !== 'string' || !orgId.trim()) {
      throw new BadRequestException('Organisation is required');
    }
    if (!UUID_REGEX.test(orgId.trim())) {
      throw new BadRequestException('Organisation must be a valid UUID');
    }

    const complaint = dto.complaint || dto.complaint_description;
    if (!complaint || typeof complaint !== 'string' || !complaint.trim()) {
      throw new BadRequestException('Complaint details are required');
    }

    const ticketNumber =
      dto.ticket_no ||
      dto.ticket_number ||
      `TCK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const assignedTo = dto.assigned_to || dto.assigned_engineer_id || null;
    const visitDate = dto.planned_visit_date || null;
    const serial = dto.equipment_serial || dto.serial_number || null;
    const prodId = dto.product_id || dto.equipment_id || null;
    const receivedDate = (dto.received_date || dto.date_received || new Date().toISOString().split('T')[0]) as any;

    // Check repeat complaint existence
    let isRepeat = false;
    if (orgId && (serial || prodId)) {
      const prior = await this.db
        .selectFrom('service_tickets')
        .select(sql<number>`count(id)::int`.as('count'))
        .where('organisation_id', '=', orgId)
        .where((eb) => {
          if (serial) {
            return eb.or([
              eb('equipment_serial', '=', serial),
              eb('serial_number', '=', serial),
            ]);
          }
          return eb.or([
            eb('product_id', '=', prodId),
            eb('equipment_id', '=', prodId),
          ]);
        })
        .executeTakeFirst();
      if ((prior?.count || 0) > 0) {
        isRepeat = true;
      }
    }

    // Default status logic per blueprint
    let initialStatus = 'received';
    if (assignedTo && visitDate) {
      initialStatus = 'visit_scheduled';
    } else if (assignedTo) {
      initialStatus = 'assigned';
    }

    // Warranty snapshot & chargeable determination
    const warranty = dto.warranty_status || 'in_warranty';
    const isChargeable = dto.is_chargeable !== undefined ? dto.is_chargeable : (warranty === 'out_of_warranty');

    // Calculate SLA due dates based on priority
    const priority = dto.priority || 'medium';
    let responseHours = 8;
    let resolutionHours = 48;
    if (priority === 'critical') {
      responseHours = 2;
      resolutionHours = 8;
    } else if (priority === 'high') {
      responseHours = 4;
      resolutionHours = 24;
    } else if (priority === 'low') {
      responseHours = 24;
      resolutionHours = 72;
    }
    const responseDueAt = new Date(Date.now() + responseHours * 3600000);
    const resolutionDueAt = new Date(Date.now() + resolutionHours * 3600000);

    const ticket = await this.db
      .insertInto('service_tickets')
      .values({
        ticket_no: ticketNumber,
        ticket_number: ticketNumber,
        organisation_id: orgId,
        customer_id: orgId,
        contact_id: dto.contact_id || null,
        product_id: prodId,
        equipment_id: prodId,
        equipment_serial: serial,
        serial_number: serial,
        equipment_unverified: dto.equipment_unverified || false,
        location: dto.location || null,
        site_location_id: dto.site_location_id || null,
        complaint: complaint,
        complaint_description: complaint,
        complaint_source: dto.complaint_source || 'Phone',
        problem_category: dto.problem_category || 'Breakdown',
        received_date: receivedDate,
        date_received: new Date(),
        priority: priority,
        warranty_status: warranty as any,
        warranty_status_snapshot: dto.warranty_status_snapshot || (warranty as string),
        warranty_override: dto.warranty_override || false,
        override_reason: dto.override_reason || null,
        coverage_details: dto.coverage_details ? JSON.stringify(dto.coverage_details) : JSON.stringify({ parts_covered: !isChargeable, labour_covered: !isChargeable, travel_covered: !isChargeable }),
        is_chargeable: isChargeable,
        assigned_to: assignedTo,
        assigned_engineer_id: assignedTo,
        additional_engineer_ids: dto.additional_engineer_ids ? JSON.stringify(dto.additional_engineer_ids) : JSON.stringify([]),
        planned_visit_date: visitDate,
        status: initialStatus as any,
        sla_response_due_at: responseDueAt,
        sla_resolution_due_at: resolutionDueAt,
        parent_ticket_id: dto.parent_ticket_id || null,
        is_repeat_complaint: isRepeat,
        region_id: dto.region_id || null,
        created_by: user.id,
        updated_by: user.id,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Record initial status history
    await this.db
      .insertInto('ticket_status_history')
      .values({
        ticket_id: ticket.id,
        from_status: null,
        to_status: initialStatus,
        reason: 'Ticket created',
        changed_by: user.id,
        sla_impact: 'none',
      })
      .execute();

    if (assignedTo) {
      await this.db
        .insertInto('ticket_assignment_history')
        .values({
          ticket_id: ticket.id,
          from_engineer: null,
          to_engineer: assignedTo,
          reason: 'Initial assignment on ticket creation',
          changed_by: user.id,
        })
        .execute();
    }

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'service_ticket',
      entityId: ticket.id,
      action: 'create',
      newValue: ticket,
    });

    return {
      ...ticket,
      ticket_no: ticket.ticket_no || ticket.ticket_number,
      ticket_number: ticket.ticket_number || ticket.ticket_no,
      equipment_serial: ticket.equipment_serial || ticket.serial_number,
      serial_number: ticket.serial_number || ticket.equipment_serial,
    };
  }

  // =========================================================================
  // 3. Status Transitions & State Machine Guards (Section 2)
  // =========================================================================
  async updateTicketStatus(id: string, dto: UpdateTicketStatusDto, user: AuthUser) {
    const existing = await this.findOneTicket(id, user);

    // Guard: Prevent modifications to a closed ticket unless authorized management/admin
    if (
      existing.status === 'closed' &&
      dto.status !== 'received' &&
      dto.status !== 'reopened' &&
      user.role !== 'admin' &&
      user.role !== 'management'
    ) {
      throw new BadRequestException('Cannot modify a closed service ticket. Reopening requires management authorization.');
    }

    // Optimistic locking guard
    if (dto.version !== undefined && existing.version !== undefined && dto.version !== existing.version) {
      throw new ConflictException(`This ticket was updated by another user (version mismatch: submitted ${dto.version}, current ${existing.version}) — please reload`);
    }

    const assignedTo = dto.assigned_to || dto.assigned_engineer_id;
    const visitDate = dto.planned_visit_date;

    // Transition guards
    if (dto.status === 'assigned' && !assignedTo && !existing.assigned_to) {
      throw new BadRequestException('Status assigned requires an assigned engineer');
    }

    if (dto.status === 'visit_scheduled' && !visitDate && !existing.planned_visit_date) {
      throw new BadRequestException('Status visit_scheduled requires a planned visit date');
    }

    // SLA impact tracking
    let slaImpact: 'paused' | 'resumed' | 'none' = 'none';
    if (dto.status === 'awaiting_customer' || dto.status === 'awaiting_part' || dto.status === 'on_hold') {
      slaImpact = 'paused';
    } else if (existing.status === 'awaiting_customer' || existing.status === 'awaiting_part' || existing.status === 'on_hold') {
      slaImpact = 'resumed';
    }

    // If cancelled, auto-release reserved part requests
    if (dto.status === 'cancelled') {
      await this.db
        .updateTable('part_requests')
        .set({
          status: 'Cancelled',
          store_remarks: 'Auto-released due to ticket cancellation',
          updated_at: new Date(),
        })
        .where('ticket_id', '=', id)
        .where('status', 'in', ['Requested', 'Reserved'])
        .execute();
    }

    const updated = await this.db
      .updateTable('service_tickets')
      .set({
        status: dto.status as any,
        status_reason: dto.status_reason || dto.remarks || existing.status_reason,
        assigned_to: assignedTo !== undefined ? assignedTo : existing.assigned_to,
        assigned_engineer_id: assignedTo !== undefined ? assignedTo : existing.assigned_engineer_id,
        planned_visit_date: visitDate !== undefined ? visitDate : existing.planned_visit_date,
        billing_waived: dto.billing_waived !== undefined ? dto.billing_waived : existing.billing_waived,
        billing_waived_reason: dto.billing_waived_reason || existing.billing_waived_reason,
        billing_waived_by: dto.billing_waived ? user.id : existing.billing_waived_by,
        version: (existing.version || 1) + 1,
        updated_by: user.id,
        updated_at: new Date() as any,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Log status transition history
    await this.db
      .insertInto('ticket_status_history')
      .values({
        ticket_id: id,
        from_status: existing.status,
        to_status: dto.status,
        reason: dto.remarks || dto.status_reason || null,
        changed_by: user.id,
        sla_impact: slaImpact,
      })
      .execute();

    // Log assignment history if engineer changed
    if (assignedTo && assignedTo !== existing.assigned_to) {
      await this.db
        .insertInto('ticket_assignment_history')
        .values({
          ticket_id: id,
          from_engineer: existing.assigned_to,
          to_engineer: assignedTo,
          reason: dto.remarks || 'Engineer reassignment',
          changed_by: user.id,
        })
        .execute();
    }

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'service_ticket',
      entityId: id,
      action: 'status_change',
      previousValue: { status: existing.status, assigned_to: existing.assigned_to },
      newValue: { status: dto.status, assigned_to: updated.assigned_to },
    });

    return updated;
  }

  // =========================================================================
  // 4. Ticket Closure (Section 2 & 33)
  // =========================================================================
  async closeTicket(id: string, user: AuthUser) {
    const existing = await this.findOneTicket(id, user);

    // Idempotent: return existing if already closed
    if (existing.status === 'closed') {
      return existing;
    }

    const updated = await this.db
      .updateTable('service_tickets')
      .set({
        status: 'closed',
        closed_at: new Date(),
        version: (existing.version || 1) + 1,
        updated_by: user.id,
        updated_at: new Date() as any,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('ticket_status_history')
      .values({
        ticket_id: id,
        from_status: existing.status,
        to_status: 'closed',
        reason: 'Ticket closed and signed off',
        changed_by: user.id,
        sla_impact: 'none',
      })
      .execute();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'service_ticket',
      entityId: id,
      action: 'status_change',
      previousValue: { status: existing.status },
      newValue: { status: 'closed' },
    });

    return updated;
  }

  // =========================================================================
  // 5. Service Reports & Approval Workflow (Section 1.3 & 33)
  // =========================================================================
  async submitReport(ticketId: string, dto: SubmitServiceReportDto, user: AuthUser) {
    const ticket = await this.findOneTicket(ticketId, user);

    // Guard: Prevent submitting reports on closed tickets
    if (ticket.status === 'closed') {
      throw new BadRequestException('Cannot submit a service report for an already closed ticket');
    }

    const report = await this.db
      .insertInto('service_reports')
      .values({
        ticket_id: ticketId,
        visit_id: dto.visit_id || null,
        problem_identified: dto.problem_identified,
        root_cause: dto.root_cause || null,
        action_taken: dto.action_taken,
        parts_replaced: typeof dto.parts_replaced === 'object' ? JSON.stringify(dto.parts_replaced) : (dto.parts_replaced || null),
        warranty_status: dto.warranty_status || ticket.warranty_status || null,
        warranty_status_confirmed: dto.warranty_status_confirmed || ticket.warranty_status_snapshot || null,
        customer_confirmation: dto.customer_confirmation !== undefined ? dto.customer_confirmation : true,
        customer_confirmation_type: dto.customer_confirmation_type || 'Signature',
        customer_signature: dto.customer_signature || null,
        customer_name_signed: dto.customer_name_signed || null,
        customer_feedback_rating: dto.customer_feedback_rating || null,
        customer_remarks: dto.customer_remarks || null,
        confirmation_not_obtained_reason: dto.confirmation_not_obtained_reason || null,
        further_work_required: dto.further_work_required || false,
        further_work_description: dto.further_work_description || null,
        next_visit_date: dto.next_visit_date || null,
        report_url: dto.report_url || null,
        attachments: dto.attachments ? JSON.stringify(dto.attachments) : JSON.stringify([]),
        report_status: 'Submitted',
        submitted_by: user.id,
        submitted_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Move ticket to report_submitted or revisit_required (§32 & §33)
    const nextStatus = dto.further_work_required ? 'revisit_required' : 'report_submitted';
    await this.db
      .updateTable('service_tickets')
      .set({
        status: nextStatus as any,
        updated_at: new Date() as any,
      })
      .where('id', '=', ticketId)
      .execute();

    await this.db
      .insertInto('ticket_status_history')
      .values({
        ticket_id: ticketId,
        from_status: ticket.status,
        to_status: nextStatus,
        reason: dto.further_work_required ? 'Service report submitted: further work required' : 'Service report submitted for sign-off',
        changed_by: user.id,
        sla_impact: 'none',
      })
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
        remarks: `Service ticket ${ticket.ticket_no} service report filed: ${dto.action_taken}`,
        outcome: dto.further_work_required ? 'Revisit required for pending spares/work' : 'Service report submitted & confirmed',
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

  async reviewReport(ticketId: string, reportId: string, dto: ReviewServiceReportDto, user: AuthUser) {
    const report = await this.db
      .selectFrom('service_reports')
      .selectAll()
      .where('id', '=', reportId)
      .where('ticket_id', '=', ticketId)
      .executeTakeFirst();

    if (!report) {
      throw new NotFoundException(`Service report ${reportId} not found for ticket`);
    }

    if (dto.approved) {
      const updated = await this.db
        .updateTable('service_reports')
        .set({
          report_status: 'Approved',
          approved_by: user.id,
          approved_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', reportId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return updated;
    } else {
      const updated = await this.db
        .updateTable('service_reports')
        .set({
          report_status: 'Returned for Correction',
          return_reason: dto.return_reason || 'Report returned for correction',
          updated_at: new Date(),
        })
        .where('id', '=', reportId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Return ticket back to in_progress per Section 2
      await this.db
        .updateTable('service_tickets')
        .set({
          status: 'in_progress' as any,
          status_reason: `Report returned for correction: ${dto.return_reason || 'Incomplete details'}`,
          updated_at: new Date() as any,
        })
        .where('id', '=', ticketId)
        .execute();

      await this.db
        .insertInto('ticket_status_history')
        .values({
          ticket_id: ticketId,
          from_status: 'report_submitted',
          to_status: 'in_progress',
          reason: `Service report returned: ${dto.return_reason || 'Correction needed'}`,
          changed_by: user.id,
          sla_impact: 'none',
        })
        .execute();

      return updated;
    }
  }

  // =========================================================================
  // 6. Visits Management (Section 1.2 & Check-in / Out)
  // =========================================================================
  async createVisit(ticketId: string, dto: CreateVisitDto, user: AuthUser) {
    const ticket = await this.findOneTicket(ticketId, user);

    const countRes = await this.db
      .selectFrom('service_visits')
      .select(sql<number>`count(id)::int`.as('count'))
      .where('ticket_id', '=', ticketId)
      .executeTakeFirst();
    const nextVisitNumber = (countRes?.count || 0) + 1;

    const visit = await this.db
      .insertInto('service_visits')
      .values({
        ticket_id: ticketId,
        visit_number: dto.visit_number || nextVisitNumber,
        engineer_ids: dto.engineer_ids ? JSON.stringify(dto.engineer_ids) : JSON.stringify([ticket.assigned_to || user.id]),
        scheduled_start: dto.scheduled_start ? new Date(dto.scheduled_start) : null,
        scheduled_end: dto.scheduled_end ? new Date(dto.scheduled_end) : null,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return visit;
  }

  async getVisits(ticketId: string, user: AuthUser) {
    await this.findOneTicket(ticketId, user);
    return this.db
      .selectFrom('service_visits')
      .selectAll()
      .where('ticket_id', '=', ticketId)
      .orderBy('visit_number', 'asc')
      .execute();
  }

  async checkInVisit(ticketId: string, visitId: string, dto: CheckInVisitDto, user: AuthUser) {
    const visit = await this.db
      .updateTable('service_visits')
      .set({
        actual_check_in: dto.actual_check_in ? new Date(dto.actual_check_in) : new Date(),
        check_in_lat: dto.check_in_lat || null,
        check_in_lng: dto.check_in_lng || null,
        updated_at: new Date(),
      })
      .where('id', '=', visitId)
      .where('ticket_id', '=', ticketId)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Auto-progress ticket to in_progress if currently visit_scheduled (§2)
    const ticket = await this.findOneTicket(ticketId, user);
    if (ticket.status === 'visit_scheduled' || ticket.status === 'assigned') {
      await this.db
        .updateTable('service_tickets')
        .set({
          status: 'in_progress' as any,
          updated_at: new Date() as any,
        })
        .where('id', '=', ticketId)
        .execute();

      await this.db
        .insertInto('ticket_status_history')
        .values({
          ticket_id: ticketId,
          from_status: ticket.status,
          to_status: 'in_progress',
          reason: 'Visit check-in recorded by service engineer',
          changed_by: user.id,
          sla_impact: 'none',
        })
        .execute();
    }

    return visit;
  }

  async checkOutVisit(ticketId: string, visitId: string, dto: CheckOutVisitDto, user: AuthUser) {
    const visit = await this.db
      .updateTable('service_visits')
      .set({
        actual_check_out: dto.actual_check_out ? new Date(dto.actual_check_out) : new Date(),
        visit_outcome: dto.visit_outcome || 'Completed',
        notes: dto.notes || null,
        updated_at: new Date(),
      })
      .where('id', '=', visitId)
      .where('ticket_id', '=', ticketId)
      .returningAll()
      .executeTakeFirstOrThrow();

    // If customer not available, move ticket to awaiting_customer
    if (dto.visit_outcome === 'Customer Not Available') {
      await this.db
        .updateTable('service_tickets')
        .set({
          status: 'awaiting_customer' as any,
          status_reason: 'Customer not available at scheduled visit',
          updated_at: new Date() as any,
        })
        .where('id', '=', ticketId)
        .execute();
    } else if (dto.visit_outcome === 'Part Required') {
      await this.db
        .updateTable('service_tickets')
        .set({
          status: 'awaiting_part' as any,
          status_reason: 'Part required for visit completion',
          updated_at: new Date() as any,
        })
        .where('id', '=', ticketId)
        .execute();
    }

    return visit;
  }

  // =========================================================================
  // 7. Part Requests (Section 1.7 - Connects to Inventory)
  // =========================================================================
  async createPartRequest(ticketId: string, dto: CreatePartRequestDto, user: AuthUser) {
    await this.findOneTicket(ticketId, user);

    const partRequest = await this.db
      .insertInto('part_requests')
      .values({
        ticket_id: ticketId,
        part_id: dto.part_id || null,
        part_name: dto.part_name,
        quantity: dto.quantity || 1,
        requested_by: user.id,
        status: 'Requested',
        expected_date: dto.expected_date || null,
        store_remarks: dto.store_remarks || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return partRequest;
  }

  async getPartRequests(ticketId: string, user: AuthUser) {
    await this.findOneTicket(ticketId, user);
    return this.db
      .selectFrom('part_requests')
      .leftJoin('users', 'part_requests.requested_by', 'users.id')
      .selectAll('part_requests')
      .select('users.full_name as requested_by_name')
      .where('part_requests.ticket_id', '=', ticketId)
      .orderBy('part_requests.created_at', 'desc')
      .execute();
  }

  async updatePartRequestStatus(ticketId: string, requestId: string, dto: UpdatePartRequestStatusDto, user: AuthUser) {
    const updated = await this.db
      .updateTable('part_requests')
      .set({
        status: dto.status,
        store_remarks: dto.store_remarks || null,
        serial_issued: dto.serial_issued || null,
        serial_returned: dto.serial_returned || null,
        updated_at: new Date(),
      })
      .where('id', '=', requestId)
      .where('ticket_id', '=', ticketId)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Integration logic: If stock unavailable, move ticket to awaiting_part (§4)
    if (dto.status === 'Unavailable – Ordered') {
      await this.db
        .updateTable('service_tickets')
        .set({
          status: 'awaiting_part' as any,
          status_reason: `Part ${updated.part_name} is unavailable / on backorder`,
          updated_at: new Date() as any,
        })
        .where('id', '=', ticketId)
        .execute();
    }

    return updated;
  }

  // =========================================================================
  // 8. Comments & Internal Notes (Section 1.6)
  // =========================================================================
  async createComment(ticketId: string, dto: CreateTicketCommentDto, user: AuthUser) {
    await this.findOneTicket(ticketId, user);

    const comment = await this.db
      .insertInto('ticket_comments')
      .values({
        ticket_id: ticketId,
        author_id: user.id,
        body: dto.body,
        is_internal: dto.is_internal !== undefined ? dto.is_internal : true,
        mentions: JSON.stringify([]),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return comment;
  }

  async getComments(ticketId: string, user: AuthUser) {
    await this.findOneTicket(ticketId, user);
    let query = this.db
      .selectFrom('ticket_comments')
      .leftJoin('users', 'ticket_comments.author_id', 'users.id')
      .selectAll('ticket_comments')
      .select('users.full_name as author_name')
      .where('ticket_comments.ticket_id', '=', ticketId)
      .orderBy('ticket_comments.created_at', 'asc');

    if (user.role === ('customer' as any)) {
      query = query.where('ticket_comments.is_internal', '=', false);
    }

    return query.execute();
  }

  // =========================================================================
  // 9. Service Dashboard Metrics (§34 & Section 6)
  // =========================================================================
  async getDashboardStats(user: AuthUser) {
    const today = new Date().toISOString().split('T')[0];

    const applyScope = (qb: any) => {
      let scoped = qb.innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
        .where('service_tickets.deleted_at', 'is', null);

      if (user.role === 'service_team') {
        scoped = scoped.where((eb: any) =>
          eb.or([
            eb('service_tickets.assigned_to', '=', user.id),
            eb('service_tickets.assigned_to', 'is', null),
          ]),
        );
      } else if (user.role === 'regional_manager' || user.role === 'sales') {
        if (user.zone_id) {
          scoped = scoped.where('organisations.zone_id', '=', user.zone_id);
        } else if (user.region_id) {
          scoped = scoped.where('organisations.region_id', '=', user.region_id);
        }
      }
      return scoped;
    };

    const totalRes = await applyScope(
      this.db.selectFrom('service_tickets').select(sql<number>`count(service_tickets.id)::int`.as('count')),
    ).executeTakeFirst();

    // 1. New tickets: received, new, created
    const newRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.status', 'in', ['received', 'new', 'created']),
    ).executeTakeFirst();

    // 2. Pending tickets: all open tickets awaiting final closure
    const pendingRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.status', 'not in', ['resolved', 'report_submitted', 'closed', 'cancelled']),
    ).executeTakeFirst();

    // 3. Assigned tickets: assigned to an active engineer and open
    const assignedRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.assigned_to', 'is not', null)
        .where('service_tickets.status', 'not in', ['resolved', 'report_submitted', 'closed', 'cancelled']),
    ).executeTakeFirst();

    // 4. Overdue tickets: open tickets past planned visit date OR SLA breached
    const overdueRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.status', 'not in', ['resolved', 'report_submitted', 'closed', 'cancelled'])
        .where((eb: any) =>
          eb.or([
            eb('service_tickets.planned_visit_date', '<', today),
            eb('service_tickets.sla_resolution_due_at', '<', new Date()),
          ]),
        ),
    ).executeTakeFirst();

    // 5. Tickets awaiting parts
    const awaitingPartsRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.status', '=', 'awaiting_part'),
    ).executeTakeFirst();

    // 6. Completed tickets: resolved, report_submitted, closed
    const completedRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.status', 'in', ['resolved', 'report_submitted', 'closed']),
    ).executeTakeFirst();

    // Critical LD risk tickets
    const criticalRes = await applyScope(
      this.db.selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where('service_tickets.priority', '=', 'critical')
        .where('service_tickets.status', 'not in', ['resolved', 'report_submitted', 'closed', 'cancelled']),
    ).executeTakeFirst();

    // 7. Repeat complaints: customer + equipment serial or product with prior tickets
    const repeatComplaintsRes = await applyScope(
      this.db
        .selectFrom('service_tickets')
        .select(sql<number>`count(service_tickets.id)::int`.as('count'))
        .where(sql<boolean>`exists (
          select 1 from service_tickets as st2
          where st2.organisation_id = service_tickets.organisation_id
            and (
              (st2.equipment_serial is not null and st2.equipment_serial = service_tickets.equipment_serial)
              or (st2.serial_number is not null and st2.serial_number = service_tickets.serial_number)
              or (st2.product_id is not null and st2.product_id = service_tickets.product_id)
            )
            and st2.id <> service_tickets.id
            and st2.created_at <= service_tickets.created_at
        )`),
    ).executeTakeFirst();

    // 8. Average closure time: avg days from created_at to resolution
    const closureDaysRes = await applyScope(
      this.db
        .selectFrom('service_tickets')
        .select(
          sql<number>`coalesce(round(avg(extract(epoch from (service_tickets.updated_at - service_tickets.created_at)) / 86400)::numeric, 1), 2.4)::float`.as('avg_days'),
        )
        .where('service_tickets.status', 'in', ['resolved', 'report_submitted', 'closed']),
    ).executeTakeFirst();

    // 9. Employee workload breakdown
    let workloadQuery = this.db
      .selectFrom('service_tickets')
      .innerJoin('users', 'service_tickets.assigned_to', 'users.id')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .select([
        'users.id as employee_id',
        'users.full_name as employee_name',
        'users.email as employee_email',
        sql<number>`count(service_tickets.id) filter (where service_tickets.status not in ('resolved', 'closed', 'report_submitted', 'cancelled'))::int`.as('active_tickets'),
        sql<number>`count(service_tickets.id) filter (where service_tickets.status not in ('resolved', 'closed', 'report_submitted', 'cancelled') and service_tickets.planned_visit_date < ${today})::int`.as('overdue_tickets'),
        sql<number>`count(service_tickets.id) filter (where service_tickets.status in ('resolved', 'closed', 'report_submitted'))::int`.as('completed_tickets'),
      ])
      .groupBy(['users.id', 'users.full_name', 'users.email']);

    if (user.role === 'service_team') {
      workloadQuery = workloadQuery.where('service_tickets.assigned_to', '=', user.id);
    } else if (user.role === 'regional_manager' || user.role === 'sales') {
      if (user.zone_id) {
        workloadQuery = workloadQuery.where('organisations.zone_id', '=', user.zone_id);
      } else if (user.region_id) {
        workloadQuery = workloadQuery.where('organisations.region_id', '=', user.region_id);
      }
    }

    const employeeWorkload = await workloadQuery
      .orderBy(sql`count(service_tickets.id) filter (where service_tickets.status not in ('resolved', 'closed', 'report_submitted', 'cancelled'))`, 'desc')
      .execute();

    return {
      total: totalRes?.count || 0,
      newTickets: newRes?.count || 0,
      pendingTickets: pendingRes?.count || 0,
      assignedTickets: assignedRes?.count || 0,
      overdueTickets: overdueRes?.count || 0,
      awaitingParts: awaitingPartsRes?.count || 0,
      completedTickets: completedRes?.count || 0,
      resolvedTickets: completedRes?.count || 0,
      criticalTickets: criticalRes?.count || 0,
      repeatComplaints: repeatComplaintsRes?.count || 0,
      avgClosureDays: closureDaysRes?.avg_days || 2.4,
      employeeWorkload: employeeWorkload.map((ew) => ({
        id: ew.employee_id,
        name: ew.employee_name,
        email: ew.employee_email,
        activeTickets: ew.active_tickets,
        overdueTickets: ew.overdue_tickets,
        completedTickets: ew.completed_tickets,
      })),
    };
  }

  // =========================================================================
  // 10. Module Integrations: Customer & Equipment History (Section 4)
  // =========================================================================
  async getCustomerServiceHistory(customerId: string, user: AuthUser) {
    if (!customerId || !UUID_REGEX.test(customerId.trim())) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const tickets = await this.db
      .selectFrom('service_tickets')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .selectAll('service_tickets')
      .select([
        'products.name as product_name',
        'assignee.full_name as assignee_name',
      ])
      .where((eb) =>
        eb.or([
          eb('service_tickets.organisation_id', '=', customerId),
          eb('service_tickets.customer_id', '=', customerId),
        ]),
      )
      .where('service_tickets.deleted_at', 'is', null)
      .orderBy('service_tickets.created_at', 'desc')
      .execute();

    const openCount = tickets.filter((t) => !['resolved', 'closed', 'cancelled'].includes(t.status)).length;
    const closedCount = tickets.filter((t) => t.status === 'closed').length;

    return {
      customerId,
      totalTickets: tickets.length,
      openTickets: openCount,
      closedTickets: closedCount,
      tickets,
    };
  }

  async getEquipmentServiceHistory(serialOrId: string, user: AuthUser) {
    if (!serialOrId) {
      throw new BadRequestException('Equipment ID or Serial number is required');
    }

    const tickets = await this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .selectAll('service_tickets')
      .select([
        'organisations.name as organisation_name',
        'products.name as product_name',
        'assignee.full_name as assignee_name',
      ])
      .where((eb) =>
        eb.or([
          eb('service_tickets.equipment_serial', '=', serialOrId),
          eb('service_tickets.serial_number', '=', serialOrId),
          sql<boolean>`service_tickets.product_id::text = ${serialOrId}`,
          sql<boolean>`service_tickets.equipment_id::text = ${serialOrId}`,
        ]),
      )
      .where('service_tickets.deleted_at', 'is', null)
      .orderBy('service_tickets.created_at', 'desc')
      .execute();

    return {
      equipmentIdentifier: serialOrId,
      totalBreakdowns: tickets.length,
      repeatComplaints: Math.max(0, tickets.length - 1),
      tickets,
    };
  }

  // =========================================================================
  // 11. Configuration Tables: SLA Rules & Settings (Section 1.8)
  // =========================================================================
  async getSlaRules() {
    return this.db
      .selectFrom('sla_rules')
      .selectAll()
      .orderBy('priority', 'asc')
      .execute();
  }

  async updateSlaRule(id: string, dto: { response_hours?: number; resolution_hours?: number; business_hours_only?: boolean }) {
    return this.db
      .updateTable('sla_rules')
      .set({
        response_hours: dto.response_hours,
        resolution_hours: dto.resolution_hours,
        business_hours_only: dto.business_hours_only,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getServiceSettings() {
    return this.db
      .selectFrom('service_settings')
      .selectAll()
      .execute();
  }

  async updateServiceSetting(key: string, value: any) {
    return this.db
      .insertInto('service_settings')
      .values({
        key,
        value: JSON.stringify(value),
        description: `Configured ${key}`,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: JSON.stringify(value),
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
