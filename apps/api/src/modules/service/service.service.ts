import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, Transaction } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { AppEvents } from '../../common/events/event-names.js';
import {
  SERVICE_REASON_REQUIRED,
  SERVICE_SLA_PAUSE_STATUSES,
  SERVICE_DONE_STATUSES,
  SERVICE_TRANSITIONS,
  PORTAL_PROBLEM_CATEGORIES,
  allowedNextServiceStatuses,
  canTransitionService,
  normalizeServiceStatus,
  type ServiceStatus,
  type Database,
  type AuthUser,
  type PaginatedResult,
} from '@arihant/shared';
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
  type LinkOrganisationDto,
  UUID_REGEX,
} from './service.dto.js';
import {
  cleanText,
  computeSla,
  detectRepeatComplaint,
  generateTicketNo,
  getServiceSetting,
  normalizeWarranty,
} from './service.core.js';

type Db = Kysely<Database> | Transaction<Database>;

const VIEW_ROLES = ['management', 'regional_manager', 'sales', 'service_team', 'admin', 'demo_team', 'tender_team'];
const MANAGER_ROLES = ['management', 'regional_manager', 'admin'];
const ASSIGN_ROLES = ['management', 'regional_manager', 'admin', 'service_team'];
const COMPLAINT_SOURCES = ['Phone', 'Email', 'WhatsApp', 'Walk-in', 'Customer Portal', 'Sales Rep', 'Demo Team', 'Field Visit', 'Official Letter', 'Auto-PM'];
const WARRANTY_INPUTS = ['in_warranty', 'out_of_warranty', 'amc', 'Under Warranty', 'Under AMC', 'Out of Warranty', 'Partial Coverage', 'Unknown'];
const CONFIRMATION_TYPES = ['Signature', 'OTP', 'Email Confirmation', 'Photo of Signed Job Sheet', 'Not Obtained'];
const VISIT_OUTCOMES = ['Completed', 'Partially Completed', 'Customer Not Available', 'Part Required', 'Escalation Needed', 'Revisit Required'];
const PART_STATUSES = ['Requested', 'Reserved', 'Issued', 'Partially Issued', 'Unavailable – Ordered', 'Cancelled', 'Returned'];
const PART_TRANSITIONS: Record<string, string[]> = {
  Requested: ['Reserved', 'Unavailable – Ordered', 'Issued', 'Cancelled'],
  Reserved: ['Issued', 'Partially Issued', 'Unavailable – Ordered', 'Cancelled'],
  'Partially Issued': ['Issued', 'Returned', 'Cancelled'],
  'Unavailable – Ordered': ['Reserved', 'Issued', 'Cancelled'],
  Issued: ['Returned'],
  Cancelled: [],
  Returned: [],
};
const TICKET_NO_FORMAT = /^[A-Za-z0-9][A-Za-z0-9\-_/]{2,39}$/;

export interface CoreCreateInput {
  organisationId: string;
  contactId?: string | null;
  productId?: string | null;
  serial?: string | null;
  equipmentUnverified?: boolean;
  location?: string | null;
  siteLocationId?: string | null;
  complaint: string;
  source: string;
  problemCategory: string;
  priority: string;
  warranty?: string | null;
  warrantyOverride?: boolean;
  overrideReason?: string | null;
  isChargeable?: boolean;
  coverageDetails?: Record<string, boolean> | null;
  assignedTo?: string | null;
  additionalEngineerIds?: string[];
  plannedVisitDate?: string | null;
  parentTicketId?: string | null;
  regionId?: string | null;
  receivedDate?: string | null;
  customTicketNo?: string | null;
  claimedOrganisationName?: string | null;
  intakeRequestId?: string | null;
  actorId: string | null;
  initialReason?: string;
}

@Injectable()
export class ServiceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // =========================================================================
  // 0. Shared helpers: scope, validation, dates
  // =========================================================================
  private assertViewRole(user: AuthUser) {
    if (!VIEW_ROLES.includes(user.role)) {
      throw new ForbiddenException('Your role does not have access to the Service module');
    }
  }

  private isManager(user: AuthUser) {
    return MANAGER_ROLES.includes(user.role);
  }

  /** IST calendar date (YYYY-MM-DD). */
  private todayIst(): string {
    return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  }

  private parseDateOnly(value: unknown, field: string): string {
    const raw = String(value ?? '').trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
    if (!dateOnly || Number.isNaN(Date.parse(`${dateOnly}T00:00:00Z`))) {
      throw new BadRequestException(`${field} must be a valid date (YYYY-MM-DD)`);
    }
    // reject impossible dates like 2026-02-31 that Date.parse would roll over
    const round = new Date(`${dateOnly}T00:00:00Z`).toISOString().slice(0, 10);
    if (round !== dateOnly) throw new BadRequestException(`${field} is not a real calendar date`);
    return dateOnly;
  }

  private assertFutureOrToday(date: string, field: string, allowPast: boolean) {
    if (!allowPast && date < this.todayIst()) {
      throw new BadRequestException(`${field} cannot be in the past`);
    }
  }

  /** Territory filter shared by lists, stats and detail. null = unrestricted. */
  private scopeWhere(user: AuthUser): ((eb: any) => any) | null {
    if (user.role === 'management' || user.role === 'admin' || user.role === 'tender_team') return null;

    if (user.role === 'service_team') {
      return (eb: any) =>
        eb.or([
          eb('service_tickets.assigned_to', '=', user.id),
          eb('service_tickets.assigned_to', 'is', null),
          sql<boolean>`service_tickets.additional_engineer_ids @> ${JSON.stringify([user.id])}::jsonb`,
        ]);
    }

    // regional_manager, sales, demo_team: their own territory (+ tickets they raised)
    return (eb: any) => {
      const parts: any[] = [];
      if (user.zone_id) {
        parts.push(eb('organisations.zone_id', '=', user.zone_id));
        parts.push(sql<boolean>`service_tickets.region_id in (select id from regions where zone_id = ${user.zone_id})`);
      }
      if (user.region_id) {
        parts.push(eb('organisations.region_id', '=', user.region_id));
        parts.push(eb('service_tickets.region_id', '=', user.region_id));
      }
      if (user.role !== 'regional_manager') parts.push(eb('service_tickets.created_by', '=', user.id));
      if (parts.length === 0) parts.push(sql<boolean>`false`);
      return eb.or(parts);
    };
  }

  private async requireEngineer(db: Db, id: string, label = 'Assigned engineer') {
    if (!UUID_REGEX.test(String(id).trim())) throw new BadRequestException(`${label} must be a valid UUID`);
    const u = await db.selectFrom('users').select(['id', 'role', 'is_active', 'full_name']).where('id', '=', id).executeTakeFirst();
    if (!u) throw new BadRequestException(`${label} not found`);
    if (!u.is_active) throw new BadRequestException(`${label} is deactivated and cannot take tickets`);
    if (u.role !== 'service_team') throw new BadRequestException(`${label} must be a Service Team engineer`);
    return u;
  }

  private emit(event: string, payload: Record<string, any>) {
    try {
      this.eventEmitter.emit(event, payload);
    } catch {
      /* a failing listener must never fail the request */
    }
  }

  private audit(actorId: string | null, entityType: string, entityId: string, action: string, previousValue: any, newValue: any) {
    this.emit('audit.log', { actorId, entityType, entityId, action, previousValue, newValue });
  }

  private async ticketContext(ticketId: string) {
    return this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('regions', 'service_tickets.region_id', 'regions.id')
      .select([
        'service_tickets.id',
        sql<string>`coalesce(service_tickets.ticket_no, service_tickets.ticket_number)`.as('ticket_no'),
        'service_tickets.organisation_id',
        'service_tickets.priority',
        'service_tickets.status',
        'service_tickets.assigned_to',
        'service_tickets.created_by',
        'service_tickets.is_repeat_complaint',
        'service_tickets.complaint_source',
        'service_tickets.claimed_organisation_name',
        'service_tickets.region_id',
        'organisations.name as organisation_name',
        sql<string | null>`coalesce(organisations.zone_id, regions.zone_id)`.as('zone_id'),
      ])
      .where('service_tickets.id', '=', ticketId)
      .executeTakeFirst();
  }

  async emitTicketEvent(event: string, ticketId: string, extra: Record<string, any> = {}) {
    const ctx = await this.ticketContext(ticketId);
    if (!ctx) return;
    this.emit(event, {
      ticketId: ctx.id,
      ticketNo: ctx.ticket_no,
      organisationId: ctx.organisation_id,
      organisationName: ctx.claimed_organisation_name || ctx.organisation_name,
      priority: ctx.priority,
      status: ctx.status,
      assignedTo: ctx.assigned_to,
      creatorId: ctx.created_by,
      isRepeat: !!ctx.is_repeat_complaint,
      source: ctx.complaint_source,
      zoneId: ctx.zone_id,
      regionId: ctx.region_id,
      unverified: !!ctx.claimed_organisation_name,
      ...extra,
    });
  }

  private withAllowed<T extends { status?: string | null }>(row: T) {
    return { ...row, allowed_next_statuses: allowedNextServiceStatuses(String(row.status || 'received')) };
  }

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
      complaint_source?: string;
      overdue?: string | boolean;
      unassigned?: string | boolean;
      repeat?: string | boolean;
      unverified?: string | boolean;
    },
    user: AuthUser,
  ): Promise<PaginatedResult<any>> {
    this.assertViewRole(user);
    const { page, limit, offset } = getPaginationParams(query);
    const truthy = (v: unknown) => v === true || v === 'true' || v === '1';

    let baseQuery = this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('contacts', 'service_tickets.contact_id', 'contacts.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .where('service_tickets.deleted_at', 'is', null);

    const scope = this.scopeWhere(user);
    if (scope) baseQuery = baseQuery.where(scope as any);

    if (query.status) {
      const wanted = normalizeServiceStatus(query.status);
      const legacy = wanted === 'received' ? ['received', 'new', 'created'] : wanted === 'revisit_required' ? ['revisit_required', 'revisit'] : [wanted];
      baseQuery = baseQuery.where('service_tickets.status', 'in', legacy as any);
    }
    if (query.priority) baseQuery = baseQuery.where('service_tickets.priority', '=', query.priority as any);
    if (query.assigned_to) {
      if (!UUID_REGEX.test(query.assigned_to)) throw new BadRequestException('assigned_to must be a valid UUID');
      baseQuery = baseQuery.where('service_tickets.assigned_to', '=', query.assigned_to);
    }
    if (query.complaint_source) baseQuery = baseQuery.where('service_tickets.complaint_source', '=', query.complaint_source);
    if (truthy(query.unassigned)) baseQuery = baseQuery.where('service_tickets.assigned_to', 'is', null);
    if (truthy(query.repeat)) baseQuery = baseQuery.where('service_tickets.is_repeat_complaint', '=', true);
    if (truthy(query.unverified)) baseQuery = baseQuery.where('service_tickets.claimed_organisation_name', 'is not', null);
    if (truthy(query.overdue)) {
      baseQuery = baseQuery
        .where('service_tickets.status', 'not in', SERVICE_DONE_STATUSES as any)
        .where('service_tickets.status', 'not in', SERVICE_SLA_PAUSE_STATUSES as any)
        .where((eb) =>
          eb.or([
            eb('service_tickets.planned_visit_date', '<', this.todayIst() as any),
            eb('service_tickets.sla_resolution_due_at', '<', new Date()),
          ]),
        );
    }

    if (query.search) {
      const s = `%${String(query.search).toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(coalesce(service_tickets.ticket_no, service_tickets.ticket_number, '')) like ${s}`,
          sql<boolean>`lower(coalesce(service_tickets.complaint, service_tickets.complaint_description, '')) like ${s}`,
          sql<boolean>`lower(coalesce(service_tickets.equipment_serial, service_tickets.serial_number, '')) like ${s}`,
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(coalesce(service_tickets.claimed_organisation_name, '')) like ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery.select(sql<number>`count(service_tickets.id)::int`.as('total')).executeTakeFirst();
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
        'service_tickets.equipment_unverified',
        'service_tickets.location',
        'service_tickets.complaint',
        sql<string>`coalesce(service_tickets.complaint_description, service_tickets.complaint)`.as('complaint_description'),
        'service_tickets.complaint_source',
        'service_tickets.problem_category',
        'service_tickets.is_repeat_complaint',
        'service_tickets.parent_ticket_id',
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
        'service_tickets.sla_paused_minutes',
        'service_tickets.sla_pause_started_at',
        'service_tickets.first_response_at',
        'service_tickets.resolved_at',
        'service_tickets.closed_at',
        'service_tickets.reopened_count',
        'service_tickets.claimed_organisation_name',
        'service_tickets.intake_request_id',
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

    return buildPaginatedResult(tickets.map((t) => this.withAllowed(t)), total, page, limit);
  }

  async findOneTicket(id: string, user?: AuthUser) {
    if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
      throw new NotFoundException(`Service ticket ${id} not found`);
    }
    if (user) this.assertViewRole(user);

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

    if (!ticket) throw new NotFoundException('Service ticket not found');

    if (user) {
      const scope = this.scopeWhere(user);
      if (scope) {
        const visible = await this.db
          .selectFrom('service_tickets')
          .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
          .select('service_tickets.id')
          .where('service_tickets.id', '=', id)
          .where(scope as any)
          .executeTakeFirst();
        if (!visible) {
          throw new ForbiddenException(
            user.role === 'service_team'
              ? 'Access denied: You are not assigned to this service ticket'
              : 'Access denied: this ticket is outside your territory',
          );
        }
      }
    }

    const [reports, visits, partRequests, comments, statusHistory, assignmentHistory, intake] = await Promise.all([
      this.db
        .selectFrom('service_reports')
        .leftJoin('users', 'service_reports.submitted_by', 'users.id')
        .selectAll('service_reports')
        .select('users.full_name as submitted_by_name')
        .where('service_reports.ticket_id', '=', id)
        .orderBy('service_reports.created_at', 'desc')
        .execute(),
      this.db.selectFrom('service_visits').selectAll('service_visits').where('service_visits.ticket_id', '=', id).orderBy('service_visits.visit_number', 'asc').execute(),
      this.db
        .selectFrom('part_requests')
        .leftJoin('users', 'part_requests.requested_by', 'users.id')
        .selectAll('part_requests')
        .select('users.full_name as requested_by_name')
        .where('part_requests.ticket_id', '=', id)
        .orderBy('part_requests.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('ticket_comments')
        .leftJoin('users', 'ticket_comments.author_id', 'users.id')
        .selectAll('ticket_comments')
        .select('users.full_name as author_name')
        .where('ticket_comments.ticket_id', '=', id)
        .orderBy('ticket_comments.created_at', 'asc')
        .execute(),
      this.db
        .selectFrom('ticket_status_history')
        .leftJoin('users', 'ticket_status_history.changed_by', 'users.id')
        .selectAll('ticket_status_history')
        .select('users.full_name as changed_by_name')
        .where('ticket_status_history.ticket_id', '=', id)
        .orderBy('ticket_status_history.changed_at', 'desc')
        .execute(),
      this.db
        .selectFrom('ticket_assignment_history')
        .selectAll()
        .where('ticket_id', '=', id)
        .orderBy('changed_at', 'desc')
        .execute(),
      ticket.intake_request_id
        ? this.db
            .selectFrom('service_intake_requests')
            .select([
              'reference',
              'claimed_organisation',
              'claimed_department',
              'claimed_city',
              'claimed_state',
              'contact_name',
              'contact_designation',
              'contact_phone',
              'contact_email',
              'match_method',
              'match_confidence',
              'urgency',
              'preferred_visit_date',
              'site_access_notes',
              'created_at',
            ])
            .where('id', '=', ticket.intake_request_id)
            .executeTakeFirst()
        : Promise.resolve(null),
    ]);

    const serial = ticket.equipment_serial || ticket.serial_number;
    const prodId = ticket.product_id || ticket.equipment_id;
    const repeat = await detectRepeatComplaint(this.db, {
      organisationId: ticket.organisation_id,
      serial,
      productId: prodId,
      excludeId: id,
      before: new Date(ticket.created_at as any),
    });

    const now = Date.now();
    const slaDue = ticket.sla_resolution_due_at ? new Date(ticket.sla_resolution_due_at as any).getTime() : null;
    const isOpen = !SERVICE_DONE_STATUSES.includes(normalizeServiceStatus(ticket.status));
    const paused = SERVICE_SLA_PAUSE_STATUSES.includes(normalizeServiceStatus(ticket.status));

    return this.withAllowed({
      ...ticket,
      ticket_no: ticket.ticket_no || ticket.ticket_number,
      ticket_number: ticket.ticket_number || ticket.ticket_no,
      complaint: ticket.complaint || ticket.complaint_description,
      complaint_description: ticket.complaint_description || ticket.complaint,
      equipment_serial: serial,
      serial_number: serial,
      is_repeat_complaint: repeat.isRepeat || !!ticket.is_repeat_complaint,
      repeat_count: repeat.priorCount,
      repeat_window_days: repeat.windowDays,
      sla_breached: isOpen && !paused && slaDue !== null && slaDue < now,
      reports,
      visits,
      part_requests: partRequests,
      comments,
      status_history: statusHistory,
      assignment_history: assignmentHistory,
      intake,
    });
  }

  // =========================================================================
  // 2. Ticket Creation
  // =========================================================================
  async createTicket(dto: CreateTicketDto, user: AuthUser) {
    this.assertViewRole(user);

    const orgId = (dto.organisation_id || dto.customer_id || '').trim();
    if (!orgId) throw new BadRequestException('Organisation is required');
    if (!UUID_REGEX.test(orgId)) throw new BadRequestException('Organisation must be a valid UUID');

    const complaint = cleanText(dto.complaint || dto.complaint_description || '', 4000);
    if (!complaint) throw new BadRequestException('Complaint details are required');
    if (complaint.length < 10) throw new BadRequestException('Complaint must be at least 10 characters');

    const priority = dto.priority || 'medium';
    const problemCategory = dto.problem_category || 'Breakdown';
    if (!(PORTAL_PROBLEM_CATEGORIES as readonly string[]).includes(problemCategory)) {
      throw new BadRequestException(`problem_category must be one of: ${PORTAL_PROBLEM_CATEGORIES.join(', ')}`);
    }
    const source = dto.complaint_source || 'Phone';
    if (!COMPLAINT_SOURCES.includes(source)) {
      throw new BadRequestException(`complaint_source must be one of: ${COMPLAINT_SOURCES.join(', ')}`);
    }
    if (dto.warranty_status && !WARRANTY_INPUTS.includes(dto.warranty_status)) {
      throw new BadRequestException(`warranty_status must be one of: in_warranty, out_of_warranty, amc`);
    }

    const serial = cleanText(dto.equipment_serial || dto.serial_number || '', 80) || null;
    if ((dto.equipment_serial || dto.serial_number || '').length > 80) throw new BadRequestException('Equipment serial is too long (max 80)');
    const prodId = dto.product_id || dto.equipment_id || null;

    const assignedTo = dto.assigned_to || dto.assigned_engineer_id || null;
    const visitDate = dto.planned_visit_date ? this.parseDateOnly(dto.planned_visit_date, 'planned_visit_date') : null;
    if (visitDate && !assignedTo) throw new BadRequestException('A planned visit date requires an assigned engineer');
    if (visitDate) this.assertFutureOrToday(visitDate, 'planned_visit_date', false);

    if ((assignedTo || (dto.additional_engineer_ids || []).length) && !ASSIGN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the service team, regional managers, management or admin can assign an engineer');
    }
    if (user.role === 'service_team' && assignedTo && assignedTo !== user.id) {
      throw new ForbiddenException('Service engineers can only assign a new ticket to themselves');
    }

    if (dto.ticket_no || dto.ticket_number) {
      const custom = String(dto.ticket_no || dto.ticket_number).trim();
      if (!TICKET_NO_FORMAT.test(custom)) throw new BadRequestException('ticket_no may contain letters, digits, - _ / and be 3–40 characters');
    }

    if (dto.is_chargeable !== undefined && !this.isManager(user)) {
      throw new ForbiddenException('Only managers can override the chargeable flag');
    }
    if (dto.warranty_override && !this.isManager(user)) {
      throw new ForbiddenException('Only managers can override warranty coverage');
    }

    const created = await this.db.transaction().execute(async (trx) => {
      const org = await trx.selectFrom('organisations').select(['id', 'region_id']).where('id', '=', orgId).executeTakeFirst();
      if (!org) throw new BadRequestException('Organisation not found');

      if (dto.contact_id) {
        const contact = await trx.selectFrom('contacts').select(['id', 'organisation_id']).where('id', '=', dto.contact_id).executeTakeFirst();
        if (!contact) throw new BadRequestException('Contact not found');
        if (contact.organisation_id !== orgId) throw new BadRequestException('Contact does not belong to this organisation');
      }
      if (prodId) {
        const p = await trx.selectFrom('products').select('id').where('id', '=', prodId).executeTakeFirst();
        if (!p) throw new BadRequestException('Product not found');
      }
      if (assignedTo) await this.requireEngineer(trx, assignedTo);
      for (const eid of dto.additional_engineer_ids || []) await this.requireEngineer(trx, eid, 'Additional engineer');
      if (dto.parent_ticket_id) {
        const parent = await trx.selectFrom('service_tickets').select(['id', 'organisation_id']).where('id', '=', dto.parent_ticket_id).executeTakeFirst();
        if (!parent) throw new BadRequestException('Parent ticket not found');
        if (parent.organisation_id !== orgId) throw new BadRequestException('Parent ticket belongs to a different organisation');
      }

      return this.createTicketCore(trx, {
        organisationId: orgId,
        contactId: dto.contact_id || null,
        productId: prodId,
        serial,
        equipmentUnverified: dto.equipment_unverified,
        location: cleanText(dto.location || '', 300) || null,
        siteLocationId: dto.site_location_id || null,
        complaint,
        source,
        problemCategory,
        priority,
        warranty: dto.warranty_status || null,
        warrantyOverride: dto.warranty_override,
        overrideReason: dto.override_reason || null,
        isChargeable: dto.is_chargeable,
        coverageDetails: dto.coverage_details || null,
        assignedTo,
        additionalEngineerIds: dto.additional_engineer_ids || [],
        plannedVisitDate: visitDate,
        parentTicketId: dto.parent_ticket_id || null,
        regionId: dto.region_id || org.region_id || null,
        receivedDate: dto.received_date || dto.date_received || null,
        customTicketNo: dto.ticket_no || dto.ticket_number || null,
        actorId: user.id,
      });
    });

    await this.afterCreate(created.ticket, user.id);
    return {
      ...created.ticket,
      ticket_no: created.ticket.ticket_no || created.ticket.ticket_number,
      ticket_number: created.ticket.ticket_number || created.ticket.ticket_no,
      equipment_serial: created.ticket.equipment_serial || created.ticket.serial_number,
      serial_number: created.ticket.serial_number || created.ticket.equipment_serial,
      repeat_count: created.repeatCount,
    };
  }

  /**
   * The one place that writes a ticket. Used by the authenticated API, the demo-failure
   * automation and the public customer portal, so numbering / SLA / repeat detection / history
   * are identical regardless of the entry point. Must run inside the caller's transaction.
   */
  async createTicketCore(trx: Db, input: CoreCreateInput) {
    const customNo = input.customTicketNo ? String(input.customTicketNo).trim() : null;
    if (customNo) {
      const clash = await trx
        .selectFrom('service_tickets')
        .select('id')
        .where((eb) => eb.or([eb('ticket_no', '=', customNo), eb('ticket_number', '=', customNo)]))
        .executeTakeFirst();
      if (clash) throw new ConflictException(`Ticket number ${customNo} already exists`);
    }
    const ticketNo = customNo || (await generateTicketNo(trx as any));

    const warranty = normalizeWarranty(input.warranty);
    const isChargeable = input.isChargeable !== undefined ? input.isChargeable : warranty === 'out_of_warranty';
    const priority = ['low', 'medium', 'high', 'critical'].includes(input.priority) ? input.priority : 'medium';

    const repeat = await detectRepeatComplaint(trx as any, {
      organisationId: input.organisationId,
      serial: input.serial,
      productId: input.productId,
    });
    const parentTicketId = input.parentTicketId || repeat.parentTicketId;

    const status: ServiceStatus = input.assignedTo && input.plannedVisitDate ? 'visit_scheduled' : input.assignedTo ? 'assigned' : 'received';
    const now = new Date();
    const sla = await computeSla(trx as any, priority, warranty, now);

    const ticket = await trx
      .insertInto('service_tickets')
      .values({
        ticket_no: ticketNo,
        ticket_number: ticketNo,
        organisation_id: input.organisationId,
        customer_id: input.organisationId,
        contact_id: input.contactId || null,
        product_id: input.productId || null,
        equipment_id: input.productId || null,
        equipment_serial: input.serial || null,
        serial_number: input.serial || null,
        equipment_unverified: input.equipmentUnverified || false,
        location: input.location || null,
        site_location_id: input.siteLocationId || null,
        complaint: input.complaint,
        complaint_description: input.complaint,
        complaint_source: input.source,
        problem_category: input.problemCategory,
        received_date: (input.receivedDate ? String(input.receivedDate).slice(0, 10) : now.toISOString().slice(0, 10)) as any,
        date_received: now,
        priority: priority as any,
        warranty_status: warranty as any,
        warranty_status_snapshot: warranty,
        warranty_override: input.warrantyOverride || false,
        override_reason: input.overrideReason || null,
        coverage_details: JSON.stringify(
          input.coverageDetails || { parts_covered: !isChargeable, labour_covered: !isChargeable, travel_covered: !isChargeable },
        ),
        is_chargeable: isChargeable,
        billing_status: isChargeable ? 'invoice_pending' : 'not_chargeable',
        assigned_to: input.assignedTo || null,
        assigned_engineer_id: input.assignedTo || null,
        additional_engineer_ids: JSON.stringify(input.additionalEngineerIds || []),
        planned_visit_date: (input.plannedVisitDate as any) || null,
        status: status as any,
        first_response_at: input.assignedTo ? now : null,
        sla_response_due_at: sla.responseDueAt,
        sla_resolution_due_at: sla.resolutionDueAt,
        parent_ticket_id: parentTicketId || null,
        is_repeat_complaint: repeat.isRepeat,
        region_id: input.regionId || null,
        claimed_organisation_name: input.claimedOrganisationName || null,
        intake_request_id: input.intakeRequestId || null,
        created_by: input.actorId,
        updated_by: input.actorId,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('ticket_status_history')
      .values({
        ticket_id: ticket.id,
        from_status: null,
        to_status: status,
        reason: input.initialReason || 'Ticket created',
        changed_by: input.actorId,
        sla_impact: 'none',
      })
      .execute();

    if (input.assignedTo) {
      await trx
        .insertInto('ticket_assignment_history')
        .values({
          ticket_id: ticket.id,
          from_engineer: null,
          to_engineer: input.assignedTo,
          reason: 'Initial assignment on ticket creation',
          changed_by: input.actorId,
        })
        .execute();
    }

    // "Enter once, use everywhere": the customer timeline learns about it immediately
    if (input.organisationId !== '00000000-0000-4000-8000-0000000000a1') {
      await trx
        .insertInto('interactions')
        .values({
          organisation_id: input.organisationId,
          contact_id: input.contactId || null,
          type: 'service',
          employee_id: input.actorId,
          occurred_on: now.toISOString().slice(0, 10),
          remarks: `Service ticket ${ticketNo} registered (${priority} priority, via ${input.source}): ${input.complaint.slice(0, 180)}`,
          outcome: repeat.isRepeat ? 'Repeat complaint — same equipment within window' : 'Service request logged',
        })
        .execute();
    }

    return { ticket, repeatCount: repeat.priorCount, repeat };
  }

  /** Post-commit side effects of a new ticket. */
  async afterCreate(ticket: any, actorId: string | null, extra: Record<string, any> = {}) {
    this.audit(actorId, 'service_ticket', ticket.id, 'create', null, ticket);
    await this.emitTicketEvent(AppEvents.SERVICE_CREATED, ticket.id, { actorId, ...extra });
    if (ticket.assigned_to) {
      await this.emitTicketEvent(AppEvents.SERVICE_ASSIGNED, ticket.id, { actorId, engineerId: ticket.assigned_to, previousEngineerId: null });
    }
  }

  // =========================================================================
  // 3. State machine core
  // =========================================================================
  /**
   * Applies one status change atomically: optimistic lock, SLA pause/resume accounting,
   * lifecycle timestamps and the audit-grade status history row.
   */
  async applyTransition(
    db: Db,
    existing: any,
    to: ServiceStatus,
    o: {
      actorId: string | null;
      reason?: string | null;
      assignedTo?: string | null;
      plannedVisitDate?: string | null;
      set?: Record<string, any>;
    },
  ) {
    const from = normalizeServiceStatus(existing.status);
    const now = new Date();
    const set: Record<string, any> = {
      status: to,
      status_reason: o.reason ?? null,
      version: (existing.version || 1) + 1,
      updated_by: o.actorId,
      updated_at: now,
      ...(o.set || {}),
    };

    const wasPaused = SERVICE_SLA_PAUSE_STATUSES.includes(from);
    const willPause = SERVICE_SLA_PAUSE_STATUSES.includes(to);
    let slaImpact: 'paused' | 'resumed' | 'none' = 'none';
    if (!wasPaused && willPause) {
      set.sla_pause_started_at = now;
      slaImpact = 'paused';
    } else if (wasPaused && !willPause) {
      const startedAt = existing.sla_pause_started_at ? new Date(existing.sla_pause_started_at) : null;
      if (startedAt) {
        const ms = Math.max(0, now.getTime() - startedAt.getTime());
        set.sla_paused_minutes = (existing.sla_paused_minutes || 0) + Math.ceil(ms / 60000);
        // the clock stood still, so every deadline slides by the time spent paused
        if (existing.sla_resolution_due_at) set.sla_resolution_due_at = new Date(new Date(existing.sla_resolution_due_at).getTime() + ms);
        if (!existing.first_response_at && existing.sla_response_due_at) set.sla_response_due_at = new Date(new Date(existing.sla_response_due_at).getTime() + ms);
      }
      set.sla_pause_started_at = null;
      slaImpact = 'resumed';
    }

    if (o.assignedTo !== undefined) {
      set.assigned_to = o.assignedTo;
      set.assigned_engineer_id = o.assignedTo;
    }
    if (o.plannedVisitDate !== undefined) set.planned_visit_date = o.plannedVisitDate;

    if (!existing.first_response_at && !['received', 'created'].includes(to)) set.first_response_at = now;
    if (to === 'resolved') set.resolved_at = now;
    if (from === 'resolved' && to === 'in_progress') set.resolved_at = null;
    if (to === 'closed') set.closed_at = now;
    if (to === 'cancelled') set.cancelled_at = now;

    const row = await db
      .updateTable('service_tickets')
      .set(set as any)
      .where('id', '=', existing.id)
      .where('version', '=', existing.version ?? 1)
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      throw new ConflictException('This ticket was updated by another user — please reload and try again');
    }

    await db
      .insertInto('ticket_status_history')
      .values({
        ticket_id: existing.id,
        from_status: existing.status,
        to_status: to,
        reason: o.reason || null,
        changed_by: o.actorId,
        sla_impact: slaImpact,
      })
      .execute();

    if (o.assignedTo && o.assignedTo !== existing.assigned_to) {
      await db
        .insertInto('ticket_assignment_history')
        .values({
          ticket_id: existing.id,
          from_engineer: existing.assigned_to,
          to_engineer: o.assignedTo,
          reason: o.reason || 'Engineer assignment',
          changed_by: o.actorId,
        })
        .execute();
    }

    return row;
  }

  /** Domain events fired after a transition commits. */
  async announceTransition(existing: any, row: any, actorId: string | null, reason?: string | null) {
    const from = normalizeServiceStatus(existing.status);
    const to = normalizeServiceStatus(row.status);
    this.audit(actorId, 'service_ticket', row.id, 'status_change', { status: existing.status, assigned_to: existing.assigned_to }, { status: to, assigned_to: row.assigned_to, reason });
    await this.emitTicketEvent(AppEvents.SERVICE_STATUS_CHANGED, row.id, { actorId, from, to, reason });
    if (row.assigned_to && row.assigned_to !== existing.assigned_to) {
      await this.emitTicketEvent(AppEvents.SERVICE_ASSIGNED, row.id, { actorId, engineerId: row.assigned_to, previousEngineerId: existing.assigned_to });
    }
    if (to === 'escalated') await this.emitTicketEvent(AppEvents.SERVICE_ESCALATED, row.id, { actorId, reason });
    if (to === 'resolved') await this.emitTicketEvent(AppEvents.SERVICE_RESOLVED, row.id, { actorId });
    if (to === 'closed') await this.emitTicketEvent(AppEvents.SERVICE_CLOSED, row.id, { actorId });
    if (to === 'reopened') await this.emitTicketEvent(AppEvents.SERVICE_REOPENED, row.id, { actorId, reason });
    void from;
  }

  async updateTicketStatus(id: string, dto: UpdateTicketStatusDto, user: AuthUser) {
    const existing: any = await this.findOneTicket(id, user);
    const from = normalizeServiceStatus(existing.status);
    const to = normalizeServiceStatus(dto.status);

    if (!(to in SERVICE_TRANSITIONS)) {
      throw new BadRequestException(`Unknown status "${dto.status}"`);
    }

    // Closing has its own rules (report approval, sign-off) — keep one code path.
    if (to === 'closed') {
      return this.closeTicket(id, user, { remarks: dto.remarks || dto.status_reason });
    }
    if (to === 'report_submitted') {
      throw new BadRequestException('Status report_submitted is set by filing a service report — use the report endpoint');
    }

    if (from === 'closed' && to !== 'reopened') {
      throw new BadRequestException('Cannot modify a closed service ticket. Reopening requires management authorization.');
    }
    if (from === to) {
      throw new BadRequestException(`Ticket is already ${to}`);
    }
    if (dto.version !== undefined && existing.version !== undefined && dto.version !== existing.version) {
      throw new ConflictException(`This ticket was updated by another user (version mismatch: submitted ${dto.version}, current ${existing.version}) — please reload`);
    }
    if (!canTransitionService(from, to)) {
      const allowed = allowedNextServiceStatuses(from);
      throw new BadRequestException(
        `Cannot move a ticket from ${from} to ${to}.${allowed.length ? ` Allowed next steps: ${allowed.join(', ')}.` : ' This status is final.'}`,
      );
    }

    // ---- who may make this move
    if (from === 'escalated' && !this.isManager(user)) {
      throw new ForbiddenException('Only a regional manager, management or admin can de-escalate a ticket');
    }
    if (to === 'reopened') {
      if (user.role !== 'management' && user.role !== 'admin') {
        throw new ForbiddenException('Only management or admin can reopen a closed ticket');
      }
      const windowDays = await getServiceSetting<number>(this.db, 'reopen_window_days', 7);
      const closedAt = existing.closed_at ? new Date(existing.closed_at).getTime() : null;
      if (closedAt && Date.now() - closedAt > windowDays * 86400000) {
        throw new BadRequestException(`The ${windowDays}-day reopen window has passed — raise a new ticket linked to this one`);
      }
    }
    if (to === 'cancelled' && user.role === 'service_team' && existing.assigned_to !== user.id && existing.assigned_to !== null) {
      throw new ForbiddenException('Only the assigned engineer or a manager can cancel this ticket');
    }

    const reason = cleanText(dto.remarks || dto.status_reason || '', 1000) || null;
    if (SERVICE_REASON_REQUIRED.includes(to) && (!reason || reason.length < 5)) {
      throw new BadRequestException(`A reason (at least 5 characters) is required to move a ticket to ${to}`);
    }

    // ---- assignee
    const requestedAssignee = dto.assigned_to || dto.assigned_engineer_id;
    let assignedTo: string | null | undefined = undefined;
    if (requestedAssignee) {
      if (!ASSIGN_ROLES.includes(user.role)) throw new ForbiddenException('You cannot assign engineers');
      if (user.role === 'service_team' && requestedAssignee !== user.id) {
        throw new ForbiddenException('Service engineers can only assign a ticket to themselves');
      }
      await this.requireEngineer(this.db, requestedAssignee);
      assignedTo = requestedAssignee;
    }
    const effectiveAssignee = assignedTo !== undefined ? assignedTo : existing.assigned_to;

    if (to === 'assigned' && !effectiveAssignee) {
      throw new BadRequestException('Status assigned requires an assigned engineer');
    }

    // ---- visit date
    let visitDate: string | null | undefined = undefined;
    if (dto.planned_visit_date) {
      visitDate = this.parseDateOnly(dto.planned_visit_date, 'planned_visit_date');
    }
    if (to === 'visit_scheduled') {
      if (!effectiveAssignee) throw new BadRequestException('Status visit_scheduled requires an assigned engineer');
      const date = visitDate || (existing.planned_visit_date ? String(existing.planned_visit_date).slice(0, 10) : null);
      if (!date) throw new BadRequestException('Status visit_scheduled requires a planned visit date');
      const mayOverride = this.isManager(user) && dto.manager_override === true;
      this.assertFutureOrToday(date, 'planned_visit_date', mayOverride);
      visitDate = date;
    } else if (visitDate) {
      this.assertFutureOrToday(visitDate, 'planned_visit_date', this.isManager(user) && dto.manager_override === true);
    }

    // ---- resolution evidence
    if (to === 'resolved') {
      const hasReport = (existing.reports || []).length > 0;
      if (!hasReport && (!reason || reason.length < 10)) {
        throw new BadRequestException('Marking a ticket resolved needs rectification details (at least 10 characters) or an existing service report');
      }
    }

    const extra: Record<string, any> = {};
    if (to === 'reopened') {
      extra.reopened_count = (existing.reopened_count || 0) + 1;
      extra.reopened_at = new Date();
      extra.closed_at = null;
      const sla = await computeSla(this.db, existing.priority, existing.warranty_status_snapshot || existing.warranty_status, new Date());
      extra.sla_resolution_due_at = sla.resolutionDueAt;
      extra.sla_resolution_breach_notified_at = null;
      extra.sla_breach_notified_at = null;
    }
    if (dto.billing_waived !== undefined) {
      if (!this.isManager(user)) throw new ForbiddenException('Only managers can waive billing');
      if (dto.billing_waived && (!dto.billing_waived_reason || dto.billing_waived_reason.trim().length < 5)) {
        throw new BadRequestException('A reason is required to waive billing');
      }
      extra.billing_waived = dto.billing_waived;
      extra.billing_waived_reason = dto.billing_waived ? dto.billing_waived_reason : null;
      extra.billing_waived_by = dto.billing_waived ? user.id : null;
      if (dto.billing_waived) extra.billing_status = 'waived';
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      if (to === 'cancelled') {
        await trx
          .updateTable('part_requests')
          .set({ status: 'Cancelled', store_remarks: 'Auto-released due to ticket cancellation', updated_at: new Date() })
          .where('ticket_id', '=', id)
          .where('status', 'in', ['Requested', 'Reserved', 'Partially Issued', 'Unavailable – Ordered'])
          .execute();
      }
      return this.applyTransition(trx, existing, to, {
        actorId: user.id,
        reason,
        assignedTo,
        plannedVisitDate: visitDate,
        set: extra,
      });
    });

    await this.announceTransition(existing, updated, user.id, reason);
    return this.withAllowed(updated);
  }

  // =========================================================================
  // 4. Closure, reopening & manual linking
  // =========================================================================
  async closeTicket(id: string, user: AuthUser, body?: { remarks?: string }) {
    const existing: any = await this.findOneTicket(id, user);
    const from = normalizeServiceStatus(existing.status);

    if (from === 'closed') return existing; // idempotent

    if (from !== 'report_submitted') {
      throw new BadRequestException(
        from === 'cancelled'
          ? 'A cancelled ticket cannot be closed'
          : `Only a ticket with a submitted service report can be closed (currently ${from}). File the service report first.`,
      );
    }

    const latest = (existing.reports || [])[0];
    if (!latest) throw new BadRequestException('Cannot close: no service report is on file');
    if (latest.report_status === 'Returned for Correction') {
      throw new BadRequestException('Cannot close: the latest service report was returned for correction');
    }

    const needsApproval = latest.report_status !== 'Approved';
    if (needsApproval && !this.isManager(user)) {
      throw new ForbiddenException('The service report must be approved by a manager before the ticket can be closed');
    }
    const remarks = cleanText(body?.remarks || '', 1000);
    if (latest.customer_confirmation === false && remarks.length < 5) {
      throw new BadRequestException('Customer confirmation was not obtained — add a closure remark explaining why the ticket can still be closed');
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      if (needsApproval) {
        await trx
          .updateTable('service_reports')
          .set({ report_status: 'Approved', approved_by: user.id, approved_at: new Date(), updated_at: new Date() })
          .where('id', '=', latest.id)
          .execute();
      }
      const billing = existing.billing_waived ? 'waived' : existing.is_chargeable ? 'invoice_pending' : 'not_chargeable';
      const row = await this.applyTransition(trx, existing, 'closed', {
        actorId: user.id,
        reason: remarks || 'Ticket closed and signed off',
        set: { billing_status: billing },
      });
      await trx
        .insertInto('interactions')
        .values({
          organisation_id: existing.organisation_id,
          contact_id: existing.contact_id,
          type: 'service',
          employee_id: user.id,
          occurred_on: new Date().toISOString().slice(0, 10),
          remarks: `Service ticket ${existing.ticket_no} closed${remarks ? `: ${remarks}` : ''}`,
          outcome: 'Service ticket closed',
        })
        .execute();
      return row;
    });

    await this.announceTransition(existing, updated, user.id, remarks || null);
    return updated;
  }

  /** Re-point a portal ticket from the "unverified customer" holding record to the real organisation. */
  async linkOrganisation(id: string, dto: LinkOrganisationDto, user: AuthUser) {
    const existing: any = await this.findOneTicket(id, user);
    if (!existing.claimed_organisation_name) {
      throw new BadRequestException('This ticket is already linked to a verified customer');
    }
    const updated = await this.db.transaction().execute(async (trx) => {
      const org = await trx.selectFrom('organisations').select(['id', 'region_id', 'zone_id', 'name']).where('id', '=', dto.organisation_id).executeTakeFirst();
      if (!org) throw new BadRequestException('Organisation not found');
      if (org.id === '00000000-0000-4000-8000-0000000000a1') throw new BadRequestException('Choose a real customer organisation');
      if (dto.contact_id) {
        const c = await trx.selectFrom('contacts').select(['id', 'organisation_id']).where('id', '=', dto.contact_id).executeTakeFirst();
        if (!c || c.organisation_id !== org.id) throw new BadRequestException('Contact does not belong to this organisation');
      }
      const repeat = await detectRepeatComplaint(trx as any, {
        organisationId: org.id,
        serial: existing.equipment_serial,
        productId: existing.product_id,
        excludeId: id,
      });
      const row = await trx
        .updateTable('service_tickets')
        .set({
          organisation_id: org.id,
          customer_id: org.id,
          contact_id: dto.contact_id || existing.contact_id,
          claimed_organisation_name: null,
          equipment_unverified: false,
          region_id: org.region_id || existing.region_id,
          is_repeat_complaint: repeat.isRepeat,
          parent_ticket_id: existing.parent_ticket_id || repeat.parentTicketId,
          version: (existing.version || 1) + 1,
          updated_by: user.id,
          updated_at: new Date(),
        } as any)
        .where('id', '=', id)
        .where('version', '=', existing.version ?? 1)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new ConflictException('This ticket was updated by another user — please reload');
      await trx
        .insertInto('ticket_status_history')
        .values({
          ticket_id: id,
          from_status: existing.status,
          to_status: existing.status,
          reason: `Customer verified and linked to ${org.name}${dto.remarks ? `: ${cleanText(dto.remarks, 300)}` : ''}`,
          changed_by: user.id,
          sla_impact: 'none',
        })
        .execute();
      if (existing.intake_request_id) {
        await trx
          .updateTable('service_intake_requests')
          .set({ organisation_id: org.id, match_method: 'manual', match_confidence: 1, updated_at: new Date() })
          .where('id', '=', existing.intake_request_id)
          .execute();
      }
      await trx
        .insertInto('interactions')
        .values({
          organisation_id: org.id,
          contact_id: dto.contact_id || null,
          type: 'service',
          employee_id: user.id,
          occurred_on: new Date().toISOString().slice(0, 10),
          remarks: `Portal service request ${existing.ticket_no} verified and linked to this customer: ${String(existing.complaint).slice(0, 160)}`,
          outcome: 'Customer verified',
        })
        .execute();
      return row;
    });
    this.audit(user.id, 'service_ticket', id, 'link_organisation', { organisation_id: existing.organisation_id }, { organisation_id: dto.organisation_id });
    return updated;
  }

  // =========================================================================
  // 5. Service Reports & Approval Workflow (§33)
  // =========================================================================
  async submitReport(ticketId: string, dto: SubmitServiceReportDto, user: AuthUser) {
    const ticket: any = await this.findOneTicket(ticketId, user);
    const status = normalizeServiceStatus(ticket.status);

    if (status === 'closed') throw new BadRequestException('Cannot submit a service report for an already closed ticket');
    if (status === 'cancelled') throw new BadRequestException('Cannot submit a service report for a cancelled ticket');
    if (!['in_progress', 'resolved'].includes(status)) {
      throw new BadRequestException(`A service report can be filed once work has started (ticket is ${status}). Start the visit first.`);
    }
    if (user.role === 'service_team') {
      const mine =
        ticket.assigned_to === user.id ||
        (Array.isArray(ticket.additional_engineer_ids) && (ticket.additional_engineer_ids as string[]).includes(user.id));
      if (!mine) throw new ForbiddenException('Only the assigned engineer can file the service report');
    }

    const problem = cleanText(dto.problem_identified, 2000);
    const action = cleanText(dto.action_taken, 4000);
    if (problem.length < 5) throw new BadRequestException('Problem identified must be at least 5 characters');
    if (action.length < 5) throw new BadRequestException('Action taken must be at least 5 characters');

    const confirmationType = dto.customer_confirmation_type || 'Signature';
    if (!CONFIRMATION_TYPES.includes(confirmationType)) {
      throw new BadRequestException(`customer_confirmation_type must be one of: ${CONFIRMATION_TYPES.join(', ')}`);
    }
    const obtained = dto.customer_confirmation !== false && confirmationType !== 'Not Obtained';
    const signedName = cleanText(dto.customer_name_signed || '', 120);
    if (obtained && signedName.length < 2) {
      throw new BadRequestException('Customer officer name (and designation) is required when customer sign-off is obtained');
    }
    if (!obtained && cleanText(dto.confirmation_not_obtained_reason || '', 500).length < 5) {
      throw new BadRequestException('A reason is required when customer confirmation is not obtained');
    }
    if (dto.customer_feedback_rating !== undefined && (!Number.isInteger(dto.customer_feedback_rating) || dto.customer_feedback_rating < 1 || dto.customer_feedback_rating > 5)) {
      throw new BadRequestException('customer_feedback_rating must be a whole number from 1 to 5');
    }

    let nextVisit: string | null = null;
    if (dto.further_work_required) {
      if (!dto.next_visit_date) throw new BadRequestException('next_visit_date is required when further work is needed');
      nextVisit = this.parseDateOnly(dto.next_visit_date, 'next_visit_date');
      this.assertFutureOrToday(nextVisit, 'next_visit_date', false);
      if (cleanText(dto.further_work_description || '', 1000).length < 5) {
        throw new BadRequestException('Describe the further work required (at least 5 characters)');
      }
    }

    const partsJson = this.normalizeParts(dto.parts_replaced);
    if (dto.visit_id) {
      const v = await this.db.selectFrom('service_visits').select('id').where('id', '=', dto.visit_id).where('ticket_id', '=', ticketId).executeTakeFirst();
      if (!v) throw new BadRequestException('Visit does not belong to this ticket');
    }

    const nextStatus: ServiceStatus = dto.further_work_required ? 'revisit_required' : 'report_submitted';
    const now = new Date();

    const report = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('service_reports')
        .values({
          ticket_id: ticketId,
          visit_id: dto.visit_id || null,
          problem_identified: problem,
          root_cause: dto.root_cause ? cleanText(dto.root_cause, 2000) : null,
          action_taken: action,
          parts_replaced: partsJson,
          warranty_status: dto.warranty_status || ticket.warranty_status || null,
          warranty_status_confirmed: dto.warranty_status_confirmed || ticket.warranty_status_snapshot || null,
          customer_confirmation: obtained,
          customer_confirmation_type: confirmationType,
          customer_signature: dto.customer_signature || null,
          customer_name_signed: signedName || null,
          customer_feedback_rating: dto.customer_feedback_rating || null,
          customer_remarks: dto.customer_remarks ? cleanText(dto.customer_remarks, 1500) : null,
          confirmation_not_obtained_reason: obtained ? null : cleanText(dto.confirmation_not_obtained_reason || '', 500),
          further_work_required: !!dto.further_work_required,
          further_work_description: dto.further_work_description ? cleanText(dto.further_work_description, 1000) : null,
          next_visit_date: nextVisit,
          report_url: dto.report_url || null,
          attachments: JSON.stringify(dto.attachments || []),
          report_status: 'Submitted',
          submitted_by: user.id,
          submitted_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // two honest history rows: work finished, then paperwork filed
      let current = ticket;
      if (status === 'in_progress') {
        const resolved = await this.applyTransition(trx, current, 'resolved', {
          actorId: user.id,
          reason: `Rectification completed: ${action.slice(0, 160)}`,
        });
        current = { ...current, ...resolved };
      }
      if (dto.further_work_required) {
        await this.applyTransition(trx, current, 'report_submitted', { actorId: user.id, reason: 'Service report submitted: further work required' }).then(async (row) => {
          await this.applyTransition(trx, { ...current, ...row }, 'revisit_required', {
            actorId: user.id,
            reason: `Further work required: ${cleanText(dto.further_work_description || '', 300)}`,
            plannedVisitDate: nextVisit,
          });
        });
      } else {
        await this.applyTransition(trx, current, 'report_submitted', { actorId: user.id, reason: 'Service report submitted for sign-off' });
      }

      await trx
        .insertInto('interactions')
        .values({
          organisation_id: ticket.organisation_id,
          contact_id: ticket.contact_id,
          type: 'service',
          employee_id: user.id,
          occurred_on: now.toISOString().slice(0, 10),
          remarks: `Service ticket ${ticket.ticket_no} service report filed: ${action}`,
          outcome: dto.further_work_required ? 'Revisit required for pending spares/work' : 'Service report submitted & confirmed',
        })
        .execute();

      return inserted;
    });

    this.audit(user.id, 'service_report', report.id, 'create', null, report);
    await this.emitTicketEvent(AppEvents.SERVICE_REPORT_SUBMITTED, ticketId, { actorId: user.id, reportId: report.id, furtherWork: !!dto.further_work_required, nextStatus });
    return report;
  }

  private normalizeParts(input: any): string | null {
    if (input === undefined || input === null || input === '') return null;
    if (typeof input === 'string') return cleanText(input, 2000);
    if (!Array.isArray(input)) throw new BadRequestException('parts_replaced must be text or a list of parts');
    const cleaned = input.map((p, i) => {
      if (!p || typeof p !== 'object') throw new BadRequestException(`parts_replaced[${i}] must be an object`);
      const name = cleanText((p as any).part_name ?? (p as any).name ?? '', 160);
      const qty = Number((p as any).quantity ?? (p as any).qty ?? 1);
      if (!name) throw new BadRequestException(`parts_replaced[${i}] needs a part name`);
      if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new BadRequestException(`parts_replaced[${i}] quantity must be a whole number from 1 to 9999`);
      return {
        part_name: name,
        quantity: qty,
        serial_new: cleanText((p as any).serial_new ?? '', 80) || undefined,
        serial_old: cleanText((p as any).serial_old ?? '', 80) || undefined,
        returned_to_store: !!(p as any).returned_to_store,
      };
    });
    return JSON.stringify(cleaned);
  }

  async reviewReport(ticketId: string, reportId: string, dto: ReviewServiceReportDto, user: AuthUser) {
    const ticket: any = await this.findOneTicket(ticketId, user);
    if (!UUID_REGEX.test(reportId)) throw new NotFoundException(`Service report ${reportId} not found for ticket`);

    const report = await this.db.selectFrom('service_reports').selectAll().where('id', '=', reportId).where('ticket_id', '=', ticketId).executeTakeFirst();
    if (!report) throw new NotFoundException(`Service report ${reportId} not found for ticket`);
    if (report.report_status !== 'Submitted') {
      throw new BadRequestException(`Only a submitted report can be reviewed (this one is ${report.report_status})`);
    }
    if (normalizeServiceStatus(ticket.status) !== 'report_submitted' && normalizeServiceStatus(ticket.status) !== 'revisit_required') {
      throw new BadRequestException(`The ticket is ${ticket.status}; reports are reviewed once they are submitted`);
    }

    if (dto.approved) {
      return this.db
        .updateTable('service_reports')
        .set({ report_status: 'Approved', approved_by: user.id, approved_at: new Date(), updated_at: new Date() })
        .where('id', '=', reportId)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    const reason = cleanText(dto.return_reason || '', 500);
    if (reason.length < 5) throw new BadRequestException('A reason (at least 5 characters) is required to return a report for correction');

    const updated = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('service_reports')
        .set({ report_status: 'Returned for Correction', return_reason: reason, updated_at: new Date() })
        .where('id', '=', reportId)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (normalizeServiceStatus(ticket.status) === 'report_submitted') {
        await this.applyTransition(trx, ticket, 'in_progress', { actorId: user.id, reason: `Service report returned: ${reason}` });
      }
      return r;
    });
    await this.emitTicketEvent(AppEvents.SERVICE_STATUS_CHANGED, ticketId, { actorId: user.id, from: 'report_submitted', to: 'in_progress', reason: `Report returned: ${reason}` });
    return updated;
  }

  // =========================================================================
  // 6. Visits Management (check-in / check-out)
  // =========================================================================
  private assertCanWork(ticket: any, user: AuthUser) {
    if (['closed', 'cancelled'].includes(normalizeServiceStatus(ticket.status))) {
      throw new BadRequestException(`This ticket is ${ticket.status}`);
    }
    if (user.role === 'service_team') {
      const mine =
        ticket.assigned_to === user.id ||
        (Array.isArray(ticket.additional_engineer_ids) && (ticket.additional_engineer_ids as string[]).includes(user.id));
      if (!mine) throw new ForbiddenException('Only the assigned engineer can do this');
    }
  }

  async createVisit(ticketId: string, dto: CreateVisitDto, user: AuthUser) {
    const ticket: any = await this.findOneTicket(ticketId, user);
    if (['closed', 'cancelled'].includes(normalizeServiceStatus(ticket.status))) {
      throw new BadRequestException(`Cannot schedule a visit on a ${ticket.status} ticket`);
    }
    const start = dto.scheduled_start ? new Date(dto.scheduled_start) : null;
    const end = dto.scheduled_end ? new Date(dto.scheduled_end) : null;
    if (start && Number.isNaN(start.getTime())) throw new BadRequestException('scheduled_start is not a valid date-time');
    if (end && Number.isNaN(end.getTime())) throw new BadRequestException('scheduled_end is not a valid date-time');
    if (start && end && end <= start) throw new BadRequestException('scheduled_end must be after scheduled_start');
    for (const eid of dto.engineer_ids || []) await this.requireEngineer(this.db, eid, 'Visit engineer');

    const countRes = await this.db.selectFrom('service_visits').select(sql<number>`count(id)::int`.as('count')).where('ticket_id', '=', ticketId).executeTakeFirst();
    const nextVisitNumber = (countRes?.count || 0) + 1;

    return this.db
      .insertInto('service_visits')
      .values({
        ticket_id: ticketId,
        visit_number: nextVisitNumber,
        engineer_ids: JSON.stringify(dto.engineer_ids?.length ? dto.engineer_ids : [ticket.assigned_to || user.id]),
        scheduled_start: start,
        scheduled_end: end,
        notes: dto.notes ? cleanText(dto.notes, 1000) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getVisits(ticketId: string, user: AuthUser) {
    await this.findOneTicket(ticketId, user);
    return this.db.selectFrom('service_visits').selectAll().where('ticket_id', '=', ticketId).orderBy('visit_number', 'asc').execute();
  }

  async checkInVisit(ticketId: string, visitId: string, dto: CheckInVisitDto, user: AuthUser) {
    const ticket: any = await this.findOneTicket(ticketId, user);
    this.assertCanWork(ticket, user);
    if (!UUID_REGEX.test(visitId)) throw new NotFoundException('Visit not found');

    const visit = await this.db.selectFrom('service_visits').selectAll().where('id', '=', visitId).where('ticket_id', '=', ticketId).executeTakeFirst();
    if (!visit) throw new NotFoundException('Visit not found for this ticket');
    if (visit.actual_check_in) throw new BadRequestException('This visit has already been checked in');

    if (dto.check_in_lat !== undefined && (dto.check_in_lat < -90 || dto.check_in_lat > 90)) throw new BadRequestException('check_in_lat must be between -90 and 90');
    if (dto.check_in_lng !== undefined && (dto.check_in_lng < -180 || dto.check_in_lng > 180)) throw new BadRequestException('check_in_lng must be between -180 and 180');
    const at = dto.actual_check_in ? new Date(dto.actual_check_in) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException('actual_check_in is not a valid date-time');
    if (at.getTime() > Date.now() + 5 * 60000) throw new BadRequestException('Check-in time cannot be in the future');

    const status = normalizeServiceStatus(ticket.status);
    const startable = ['visit_scheduled', 'assigned', 'awaiting_part', 'awaiting_customer', 'reopened', 'revisit_required', 'in_progress'];
    if (!startable.includes(status)) {
      throw new BadRequestException(`Cannot check in while the ticket is ${status}`);
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      const v = await trx
        .updateTable('service_visits')
        .set({ actual_check_in: at, check_in_lat: dto.check_in_lat ?? null, check_in_lng: dto.check_in_lng ?? null, updated_at: new Date() })
        .where('id', '=', visitId)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (status !== 'in_progress') {
        await this.applyTransition(trx, ticket, 'in_progress', { actorId: user.id, reason: 'Visit check-in recorded by service engineer' });
      }
      return v;
    });
    if (status !== 'in_progress') {
      await this.emitTicketEvent(AppEvents.SERVICE_STATUS_CHANGED, ticketId, { actorId: user.id, from: status, to: 'in_progress', reason: 'Engineer checked in on site' });
    }
    return updated;
  }

  async checkOutVisit(ticketId: string, visitId: string, dto: CheckOutVisitDto, user: AuthUser) {
    const ticket: any = await this.findOneTicket(ticketId, user);
    this.assertCanWork(ticket, user);
    if (!UUID_REGEX.test(visitId)) throw new NotFoundException('Visit not found');

    const visit = await this.db.selectFrom('service_visits').selectAll().where('id', '=', visitId).where('ticket_id', '=', ticketId).executeTakeFirst();
    if (!visit) throw new NotFoundException('Visit not found for this ticket');
    if (!visit.actual_check_in) throw new BadRequestException('Check in before checking out');
    if (visit.actual_check_out) throw new BadRequestException('This visit has already been checked out');

    const outcome = dto.visit_outcome || 'Completed';
    if (!VISIT_OUTCOMES.includes(outcome)) throw new BadRequestException(`visit_outcome must be one of: ${VISIT_OUTCOMES.join(', ')}`);
    const out = dto.actual_check_out ? new Date(dto.actual_check_out) : new Date();
    if (Number.isNaN(out.getTime())) throw new BadRequestException('actual_check_out is not a valid date-time');
    if (out < new Date(visit.actual_check_in as any)) throw new BadRequestException('Check-out cannot be earlier than check-in');
    const notes = dto.notes ? cleanText(dto.notes, 1500) : null;
    if (['Customer Not Available', 'Part Required', 'Escalation Needed', 'Revisit Required', 'Partially Completed'].includes(outcome) && (!notes || notes.length < 5)) {
      throw new BadRequestException(`Visit notes (at least 5 characters) are required for outcome "${outcome}"`);
    }

    const status = normalizeServiceStatus(ticket.status);
    const nextByOutcome: Record<string, ServiceStatus | undefined> = {
      'Customer Not Available': 'awaiting_customer',
      'Part Required': 'awaiting_part',
      'Escalation Needed': 'escalated',
      'Revisit Required': 'revisit_required',
      // 'Partially Completed' keeps the ticket in_progress: the engineer then raises a part request, files a report, etc.
    };
    const next = nextByOutcome[outcome];

    const result = await this.db.transaction().execute(async (trx) => {
      const v = await trx
        .updateTable('service_visits')
        .set({ actual_check_out: out, visit_outcome: outcome, notes, updated_at: new Date() })
        .where('id', '=', visitId)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (next && status === 'in_progress') {
        await this.applyTransition(trx, ticket, next, { actorId: user.id, reason: notes || outcome });
      }
      return v;
    });
    if (next && status === 'in_progress') {
      await this.emitTicketEvent(AppEvents.SERVICE_STATUS_CHANGED, ticketId, { actorId: user.id, from: status, to: next, reason: notes || outcome });
      if (next === 'escalated') await this.emitTicketEvent(AppEvents.SERVICE_ESCALATED, ticketId, { actorId: user.id, reason: notes });
    }
    return result;
  }

  // =========================================================================
  // 7. Part Requests (connects to inventory)
  // =========================================================================
  async createPartRequest(ticketId: string, dto: CreatePartRequestDto, user: AuthUser) {
    const ticket: any = await this.findOneTicket(ticketId, user);
    if (['closed', 'cancelled'].includes(normalizeServiceStatus(ticket.status))) {
      throw new BadRequestException(`Cannot request parts on a ${ticket.status} ticket`);
    }
    const name = cleanText(dto.part_name, 160);
    if (name.length < 2) throw new BadRequestException('Part name must be at least 2 characters');
    const qty = dto.quantity === undefined ? 1 : Number(dto.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new BadRequestException('Quantity must be a whole number from 1 to 9999');
    let expected: string | null = null;
    if (dto.expected_date) {
      expected = this.parseDateOnly(dto.expected_date, 'expected_date');
      this.assertFutureOrToday(expected, 'expected_date', false);
    }
    if (dto.part_id) {
      const p = await this.db.selectFrom('products').select('id').where('id', '=', dto.part_id).executeTakeFirst();
      if (!p) throw new BadRequestException('Part (product) not found');
    }

    return this.db
      .insertInto('part_requests')
      .values({
        ticket_id: ticketId,
        part_id: dto.part_id || null,
        part_name: name,
        quantity: qty,
        requested_by: user.id,
        status: 'Requested',
        expected_date: expected,
        store_remarks: dto.store_remarks ? cleanText(dto.store_remarks, 500) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
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
    const ticket: any = await this.findOneTicket(ticketId, user);
    if (!UUID_REGEX.test(requestId)) throw new NotFoundException('Part request not found');
    if (!PART_STATUSES.includes(dto.status)) throw new BadRequestException(`status must be one of: ${PART_STATUSES.join(', ')}`);

    const current = await this.db.selectFrom('part_requests').selectAll().where('id', '=', requestId).where('ticket_id', '=', ticketId).executeTakeFirst();
    if (!current) throw new NotFoundException('Part request not found for this ticket');
    if (current.status === dto.status) throw new BadRequestException(`Part request is already ${dto.status}`);
    if (!(PART_TRANSITIONS[current.status] || []).includes(dto.status)) {
      throw new BadRequestException(`Cannot move a part request from ${current.status} to ${dto.status}`);
    }

    const updated = await this.db
      .updateTable('part_requests')
      .set({
        status: dto.status,
        store_remarks: dto.store_remarks ? cleanText(dto.store_remarks, 500) : current.store_remarks,
        serial_issued: dto.serial_issued ? cleanText(dto.serial_issued, 80) : current.serial_issued,
        serial_returned: dto.serial_returned ? cleanText(dto.serial_returned, 80) : current.serial_returned,
        updated_at: new Date(),
      })
      .where('id', '=', requestId)
      .returningAll()
      .executeTakeFirstOrThrow();

    const status = normalizeServiceStatus(ticket.status);

    // Stock unavailable → the ticket waits for the part (SLA clock pauses)
    if (dto.status === 'Unavailable – Ordered' && status === 'in_progress') {
      const row = await this.db.transaction().execute((trx) =>
        this.applyTransition(trx, ticket, 'awaiting_part', { actorId: user.id, reason: `Part ${updated.part_name} is unavailable / on backorder` }),
      );
      await this.announceTransition(ticket, row, user.id, `Part ${updated.part_name} unavailable`);
    }

    // Everything issued → resume work (SLA clock restarts)
    if (dto.status === 'Issued') {
      const stillOpen = await this.db
        .selectFrom('part_requests')
        .select(sql<number>`count(id)::int`.as('n'))
        .where('ticket_id', '=', ticketId)
        .where('status', 'in', ['Requested', 'Reserved', 'Partially Issued', 'Unavailable – Ordered'])
        .executeTakeFirst();
      await this.emitTicketEvent(AppEvents.SERVICE_PART_ISSUED, ticketId, { actorId: user.id, partName: updated.part_name, quantity: updated.quantity });
      if ((stillOpen?.n || 0) === 0 && status === 'awaiting_part') {
        const today = this.todayIst();
        const future = ticket.planned_visit_date && String(ticket.planned_visit_date).slice(0, 10) >= today && ticket.assigned_to;
        const to: ServiceStatus = future ? 'visit_scheduled' : 'in_progress';
        const row = await this.db.transaction().execute((trx) =>
          this.applyTransition(trx, ticket, to, { actorId: user.id, reason: 'All requested spares issued — work can resume' }),
        );
        await this.announceTransition(ticket, row, user.id, 'Spares issued');
      }
    }
    return updated;
  }

  // =========================================================================
  // 8. Comments & Internal Notes
  // =========================================================================
  async createComment(ticketId: string, dto: CreateTicketCommentDto, user: AuthUser) {
    await this.findOneTicket(ticketId, user);
    const body = cleanText(dto.body, 4000);
    if (!body) throw new BadRequestException('Comment body is required');
    const isInternal = dto.is_internal !== undefined ? dto.is_internal : true;
    return this.db
      .insertInto('ticket_comments')
      .values({ ticket_id: ticketId, author_id: user.id, body, is_internal: isInternal, mentions: JSON.stringify([]) })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getComments(ticketId: string, user: AuthUser) {
    await this.findOneTicket(ticketId, user);
    return this.db
      .selectFrom('ticket_comments')
      .leftJoin('users', 'ticket_comments.author_id', 'users.id')
      .selectAll('ticket_comments')
      .select('users.full_name as author_name')
      .where('ticket_comments.ticket_id', '=', ticketId)
      .orderBy('ticket_comments.created_at', 'asc')
      .execute();
  }

  // =========================================================================
  // 9. Service Dashboard Metrics (§34)
  // =========================================================================
  async getDashboardStats(user: AuthUser) {
    this.assertViewRole(user);
    const today = this.todayIst();
    const scope = this.scopeWhere(user);
    const open = SERVICE_DONE_STATUSES as any;
    const pausable = SERVICE_SLA_PAUSE_STATUSES as any;

    const q = () => {
      let b = this.db
        .selectFrom('service_tickets')
        .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
        .where('service_tickets.deleted_at', 'is', null);
      if (scope) b = b.where(scope as any);
      return b;
    };
    const count = sql<number>`count(service_tickets.id)::int`;

    const [total, fresh, pending, assigned, overdue, awaitingParts, completed, critical, repeat, closure, slaBreached, portalNew, unverified, workloadRows, engineers] = await Promise.all([
      q().select(count.as('c')).executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.status', 'in', ['received', 'new', 'created']).executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.status', 'not in', open).executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.assigned_to', 'is not', null).where('service_tickets.status', 'not in', open).executeTakeFirst(),
      q()
        .select(count.as('c'))
        .where('service_tickets.status', 'not in', open)
        .where('service_tickets.status', 'not in', pausable)
        .where((eb) => eb.or([eb('service_tickets.planned_visit_date', '<', today as any), eb('service_tickets.sla_resolution_due_at', '<', new Date())]))
        .executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.status', '=', 'awaiting_part').executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.status', 'in', ['resolved', 'report_submitted', 'closed']).executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.priority', '=', 'critical').where('service_tickets.status', 'not in', open).executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.is_repeat_complaint', '=', true).executeTakeFirst(),
      q()
        .select(sql<number>`coalesce(round(avg(greatest(extract(epoch from (coalesce(service_tickets.closed_at, service_tickets.resolved_at, service_tickets.updated_at) - service_tickets.created_at)), 0) / 86400)::numeric, 1), 0)::float`.as('avg_days'))
        .where('service_tickets.status', 'in', ['resolved', 'report_submitted', 'closed'])
        .executeTakeFirst(),
      q()
        .select(count.as('c'))
        .where('service_tickets.status', 'not in', open)
        .where('service_tickets.status', 'not in', pausable)
        .where('service_tickets.sla_resolution_due_at', '<', new Date())
        .executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.complaint_source', '=', 'Customer Portal').where('service_tickets.status', 'in', ['received', 'new', 'created']).executeTakeFirst(),
      q().select(count.as('c')).where('service_tickets.claimed_organisation_name', 'is not', null).where('service_tickets.status', 'not in', ['closed', 'cancelled']).executeTakeFirst(),
      q()
        .innerJoin('users', 'service_tickets.assigned_to', 'users.id')
        .select([
          'users.id as employee_id',
          sql<number>`count(service_tickets.id) filter (where service_tickets.status not in ('resolved','closed','report_submitted','cancelled'))::int`.as('active_tickets'),
          sql<number>`count(service_tickets.id) filter (where service_tickets.status not in ('resolved','closed','report_submitted','cancelled') and (service_tickets.planned_visit_date < ${today}::date or service_tickets.sla_resolution_due_at < now()) and service_tickets.status not in ('awaiting_part','awaiting_customer','on_hold'))::int`.as('overdue_tickets'),
          sql<number>`count(service_tickets.id) filter (where service_tickets.status in ('resolved','closed','report_submitted'))::int`.as('completed_tickets'),
        ])
        .groupBy('users.id')
        .execute(),
      // every active engineer in scope, including those with an empty queue (AVAILABLE badge)
      (() => {
        let e = this.db.selectFrom('users').select(['id', 'full_name', 'email']).where('role', '=', 'service_team').where('is_active', '=', true);
        if (user.role === 'service_team') e = e.where('id', '=', user.id);
        else if (user.role === 'regional_manager' || user.role === 'sales' || user.role === 'demo_team') {
          if (user.zone_id) e = e.where((eb) => eb.or([eb('zone_id', '=', user.zone_id as any), eb('zone_id', 'is', null)]));
          else if (user.region_id) e = e.where((eb) => eb.or([eb('region_id', '=', user.region_id as any), eb('region_id', 'is', null)]));
        }
        return e.execute();
      })(),
    ]);

    const byEmployee = new Map(workloadRows.map((r) => [r.employee_id, r]));
    const employeeWorkload = engineers
      .map((e) => {
        const r = byEmployee.get(e.id);
        const active = r?.active_tickets || 0;
        const overdueN = r?.overdue_tickets || 0;
        const status = overdueN > 0 ? 'OVERDUE RISK' : active >= 4 ? 'HEAVY QUEUE' : active >= 1 ? 'OPTIMAL LOAD' : 'AVAILABLE';
        return {
          id: e.id,
          name: e.full_name,
          email: e.email,
          activeTickets: active,
          overdueTickets: overdueN,
          completedTickets: r?.completed_tickets || 0,
          workloadStatus: status,
        };
      })
      .sort((a, b) => b.activeTickets - a.activeTickets || a.name.localeCompare(b.name));

    return {
      total: total?.c || 0,
      newTickets: fresh?.c || 0,
      pendingTickets: pending?.c || 0,
      assignedTickets: assigned?.c || 0,
      overdueTickets: overdue?.c || 0,
      awaitingParts: awaitingParts?.c || 0,
      completedTickets: completed?.c || 0,
      resolvedTickets: completed?.c || 0,
      criticalTickets: critical?.c || 0,
      repeatComplaints: repeat?.c || 0,
      avgClosureDays: closure?.avg_days || 0,
      slaBreached: slaBreached?.c || 0,
      portalNew: portalNew?.c || 0,
      unverifiedCustomers: unverified?.c || 0,
      employeeWorkload,
    };
  }

  // =========================================================================
  // 10. Customer & Equipment history (cross-module)
  // =========================================================================
  async getCustomerServiceHistory(customerId: string, user: AuthUser) {
    this.assertViewRole(user);
    if (!customerId || !UUID_REGEX.test(customerId.trim())) throw new NotFoundException(`Customer ${customerId} not found`);

    let q = this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .selectAll('service_tickets')
      .select(['products.name as product_name', 'assignee.full_name as assignee_name'])
      .where((eb) => eb.or([eb('service_tickets.organisation_id', '=', customerId), eb('service_tickets.customer_id', '=', customerId)]))
      .where('service_tickets.deleted_at', 'is', null);
    const scope = this.scopeWhere(user);
    if (scope) q = q.where(scope as any);
    const tickets = await q.orderBy('service_tickets.created_at', 'desc').execute();

    const doneOrDead = ['resolved', 'report_submitted', 'closed', 'cancelled'];
    return {
      customerId,
      totalTickets: tickets.length,
      openTickets: tickets.filter((t) => !doneOrDead.includes(normalizeServiceStatus(t.status))).length,
      closedTickets: tickets.filter((t) => t.status === 'closed').length,
      tickets,
    };
  }

  async getEquipmentServiceHistory(serialOrId: string, user: AuthUser) {
    this.assertViewRole(user);
    const key = String(serialOrId || '').trim();
    if (!key) throw new BadRequestException('Equipment ID or Serial number is required');
    if (key.length > 80) throw new BadRequestException('Equipment identifier is too long');

    let q = this.db
      .selectFrom('service_tickets')
      .innerJoin('organisations', 'service_tickets.organisation_id', 'organisations.id')
      .leftJoin('products', 'service_tickets.product_id', 'products.id')
      .leftJoin('users as assignee', 'service_tickets.assigned_to', 'assignee.id')
      .selectAll('service_tickets')
      .select(['organisations.name as organisation_name', 'products.name as product_name', 'assignee.full_name as assignee_name'])
      .where((eb) =>
        eb.or([
          eb('service_tickets.equipment_serial', '=', key),
          eb('service_tickets.serial_number', '=', key),
          sql<boolean>`service_tickets.product_id::text = ${key}`,
          sql<boolean>`service_tickets.equipment_id::text = ${key}`,
        ]),
      )
      .where('service_tickets.deleted_at', 'is', null);
    const scope = this.scopeWhere(user);
    if (scope) q = q.where(scope as any);
    const tickets = await q.orderBy('service_tickets.created_at', 'desc').execute();

    return {
      equipmentIdentifier: key,
      totalBreakdowns: tickets.length,
      repeatComplaints: Math.max(0, tickets.length - 1),
      tickets,
    };
  }

  // =========================================================================
  // 11. Configuration tables: SLA rules & settings
  // =========================================================================
  async getSlaRules() {
    return this.db.selectFrom('sla_rules').selectAll().orderBy('priority', 'asc').orderBy('warranty_type', 'asc').execute();
  }

  async updateSlaRule(id: string, dto: { response_hours?: number; resolution_hours?: number; business_hours_only?: boolean }) {
    if (!UUID_REGEX.test(id)) throw new NotFoundException('SLA rule not found');
    const r = dto.response_hours;
    const s = dto.resolution_hours;
    if (r !== undefined && (!Number.isFinite(r) || r < 1 || r > 720)) throw new BadRequestException('response_hours must be between 1 and 720');
    if (s !== undefined && (!Number.isFinite(s) || s < 1 || s > 2160)) throw new BadRequestException('resolution_hours must be between 1 and 2160');
    const existing = await this.db.selectFrom('sla_rules').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('SLA rule not found');
    if ((r ?? existing.response_hours) > (s ?? existing.resolution_hours)) {
      throw new BadRequestException('Response time cannot be longer than resolution time');
    }
    return this.db
      .updateTable('sla_rules')
      .set({ response_hours: r, resolution_hours: s, business_hours_only: dto.business_hours_only, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getServiceSettings() {
    return this.db.selectFrom('service_settings').selectAll().orderBy('key', 'asc').execute();
  }

  async updateServiceSetting(key: string, value: any) {
    if (!/^[a-z0-9_]{3,64}$/.test(key)) throw new BadRequestException('Setting key must be lowercase letters, digits and underscores');
    if (value === undefined) throw new BadRequestException('value is required');
    const numericKeys = ['repeat_complaint_window_days', 'reopen_window_days', 'auto_escalation_critical_unassigned_hours', 'portal_rate_limit_per_hour', 'portal_rate_limit_per_phone_per_day', 'portal_duplicate_window_minutes', 'business_day_start_hour', 'business_day_end_hour'];
    if (numericKeys.includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 3650) throw new BadRequestException(`${key} must be a number between 0 and 3650`);
      value = n;
    }
    return this.db
      .insertInto('service_settings')
      .values({ key, value: JSON.stringify(value), description: `Configured ${key}`, updated_at: new Date() })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(value), updated_at: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // =========================================================================
  // 12. Background sweep: SLA breaches & auto-escalation
  // =========================================================================
  async runSlaSweep(actorId: string | null = null) {
    const now = new Date();
    const result = { escalated: 0, responseBreaches: 0, resolutionBreaches: 0 };

    // 12.1 critical + unassigned too long → escalate to management (setting-driven)
    const hours = await getServiceSetting<number>(this.db, 'auto_escalation_critical_unassigned_hours', 1);
    const cutoff = new Date(now.getTime() - hours * 3600000);
    const stuck = await this.db
      .selectFrom('service_tickets')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('priority', '=', 'critical')
      .where('assigned_to', 'is', null)
      .where('status', 'in', ['received', 'new', 'created'])
      .where('auto_escalated_at', 'is', null)
      .where('created_at', '<', cutoff)
      .execute();
    for (const t of stuck) {
      try {
        const row = await this.db.transaction().execute((trx) =>
          this.applyTransition(trx, t, 'escalated', {
            actorId,
            reason: `Auto-escalated: critical ticket unassigned for more than ${hours}h`,
            set: { auto_escalated_at: now },
          }),
        );
        await this.announceTransition(t, row, actorId, 'Auto-escalated (critical & unassigned)');
        result.escalated++;
      } catch {
        /* another worker got there first (optimistic lock) */
      }
    }

    // 12.2 response SLA missed (nobody has picked it up)
    const respLate = await this.db
      .selectFrom('service_tickets')
      .select('id')
      .where('deleted_at', 'is', null)
      .where('status', 'in', ['received', 'new', 'created'])
      .where('first_response_at', 'is', null)
      .where('sla_response_due_at', '<', now)
      .where('sla_response_breach_notified_at', 'is', null)
      .execute();
    for (const t of respLate) {
      await this.db.updateTable('service_tickets').set({ sla_response_breach_notified_at: now } as any).where('id', '=', t.id).execute();
      await this.emitTicketEvent(AppEvents.SERVICE_SLA_BREACHED, t.id, { kind: 'response' });
      result.responseBreaches++;
    }

    // 12.3 resolution SLA missed (paused tickets are exempt)
    const resLate = await this.db
      .selectFrom('service_tickets')
      .select('id')
      .where('deleted_at', 'is', null)
      .where('status', 'not in', [...SERVICE_DONE_STATUSES, ...SERVICE_SLA_PAUSE_STATUSES] as any)
      .where('sla_resolution_due_at', '<', now)
      .where('sla_resolution_breach_notified_at', 'is', null)
      .execute();
    for (const t of resLate) {
      await this.db.updateTable('service_tickets').set({ sla_resolution_breach_notified_at: now, sla_breach_notified_at: now } as any).where('id', '=', t.id).execute();
      await this.emitTicketEvent(AppEvents.SERVICE_SLA_BREACHED, t.id, { kind: 'resolution' });
      result.resolutionBreaches++;
    }
    return result;
  }
}
