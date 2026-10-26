import { calendarDay, todayInKolkata } from '../../common/utils/ist-date.util.js';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import {
  PROPOSAL_ORDER_TYPES,
  type Database,
  type AuthUser,
  type DeliveryStatus,
  type PaginatedResult,
} from '@arihant/shared';
import {
  CreateDeliveryDto,
  UpdateDeliveryStatusDto,
  DeliveryQueryDto,
  UUID_REGEX,
} from './deliveries.dto.js';
import { containsPattern } from '../../common/utils/like-pattern.js';

/** Consignment milestones in the only order they can be recorded (cancellation aside). */
const DELIVERY_FLOW = ['scheduled', 'dispatched', 'in_transit', 'delivered', 'installed', 'handover_completed'] as const;
const DELIVERY_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  installed: 'Installed',
  handover_completed: 'Handover Completed',
  cancelled: 'Cancelled',
};
const label = (status: string) => DELIVERY_LABEL[status] || status;
const DELIVERY_STATUSES: readonly DeliveryStatus[] = [...DELIVERY_FLOW, 'cancelled'];
/** `status=a,b` → the known milestones it names (unknown keys are dropped, never sent to the enum column). */
const parseStatuses = (value: string): DeliveryStatus[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DeliveryStatus => (DELIVERY_STATUSES as readonly string[]).includes(s));

/** A calendar value (DATE column, ISO instant or 'YYYY-MM-DD') as DD/MM/YYYY for user-facing messages. */
function dmy(value: unknown): string {
  const day = calendarDay(value as any);
  if (!day) return String(value ?? '');
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private validateId(id: string): void {
    if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
      throw new NotFoundException(`Delivery with ID ${id} not found`);
    }
  }

  /**
   * The register's rows: role scope + every filter in `query`. The list and its KPI counts both read from here,
   * so they always agree. `ignoreStatus` drops the status filter (the per-status counts are that dimension).
   */
  private filteredDeliveries(query: DeliveryQueryDto, user: AuthUser, { ignoreStatus = false } = {}) {
    let baseQuery = this.db
      .selectFrom('deliveries')
      .innerJoin('organisations', 'deliveries.organisation_id', 'organisations.id')
      .leftJoin('products', 'deliveries.product_id', 'products.id')
      .leftJoin('tenders', 'deliveries.tender_id', 'tenders.id')
      .leftJoin('proposals', 'deliveries.proposal_id', 'proposals.id')
      .leftJoin('users as assignee', 'deliveries.assigned_to', 'assignee.id')
      .leftJoin('users as installer', 'deliveries.installed_by', 'installer.id');

    // Scoping
    if (['sales', 'demo_team', 'service_team'].includes(user.role)) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('deliveries.assigned_to', '=', user.id),
          eb('deliveries.installed_by', '=', user.id),
          eb('deliveries.created_by', '=', user.id),
        ]),
      );
    } else if (user.role === 'regional_manager' && user.zone_id) {
      baseQuery = baseQuery.where('organisations.zone_id', '=', user.zone_id);
    }

    // One milestone or several, comma-separated ("In transit" card = dispatched,in_transit).
    if (query.status && !ignoreStatus) {
      const statuses = parseStatuses(query.status);
      baseQuery = statuses.length
        ? baseQuery.where('deliveries.status', 'in', statuses)
        : baseQuery.where(sql<boolean>`false`);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('deliveries.organisation_id', '=', query.organisation_id);
    }

    // Sales orders / deliveries raised against a tender (tender dossier → linked records)
    if (query.tender_id) {
      baseQuery = baseQuery.where('deliveries.tender_id', '=', query.tender_id);
    }

    // Dispatches raised against a converted proposal (proposal detail → linked deliveries)
    if (query.proposal_id) {
      baseQuery = baseQuery.where('deliveries.proposal_id', '=', query.proposal_id);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('deliveries.assigned_to', '=', query.assigned_to);
    }

    if (query.dateFrom) {
      baseQuery = baseQuery.where('deliveries.delivery_date', '>=', query.dateFrom);
    }

    if (query.dateTo) {
      baseQuery = baseQuery.where('deliveries.delivery_date', '<=', query.dateTo);
    }

    if (query.search) {
      const s = containsPattern(query.search);
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(deliveries.delivery_no) like ${s}`,
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(deliveries.delivery_location) like ${s}`,
          sql<boolean>`lower(deliveries.model) like ${s}`,
          sql<boolean>`lower(deliveries.order_reference) like ${s}`,
        ]),
      );
    }

    return baseQuery;
  }

  async findAll(query: DeliveryQueryDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);
    const baseQuery = this.filteredDeliveries(query, user);

    const countRes = await baseQuery
      .select(sql<number>`count(deliveries.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const items = await baseQuery
      .select([
        'deliveries.id',
        'deliveries.delivery_no',
        'deliveries.organisation_id',
        'deliveries.product_id',
        'deliveries.model',
        'deliveries.equipment_serial',
        'deliveries.delivery_date',
        'deliveries.delivery_location',
        'deliveries.assigned_to',
        'deliveries.tender_id',
        'deliveries.order_reference',
        'deliveries.status',
        'deliveries.installation_required',
        'deliveries.installation_date',
        'deliveries.installed_by',
        'deliveries.installation_notes',
        'deliveries.remarks',
        'deliveries.proposal_id',
        'deliveries.document_url',
        'deliveries.version',
        'deliveries.created_at',
        'deliveries.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        sql<string>`coalesce(tenders.tender_number, tenders.tender_no)`.as('tender_no'),
        sql<string | null>`coalesce(proposals.proposal_number, proposals.proposal_no)`.as('proposal_no'),
        'assignee.full_name as assignee_name',
        'installer.full_name as installer_name',
      ])
      .orderBy('deliveries.delivery_date', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(items, total, page, limit);
  }

  async findOne(id: string, user?: AuthUser) {
    this.validateId(id);

    const delivery = await this.db
      .selectFrom('deliveries')
      .innerJoin('organisations', 'deliveries.organisation_id', 'organisations.id')
      .leftJoin('products', 'deliveries.product_id', 'products.id')
      .leftJoin('tenders', 'deliveries.tender_id', 'tenders.id')
      .leftJoin('proposals', 'deliveries.proposal_id', 'proposals.id')
      .leftJoin('users as assignee', 'deliveries.assigned_to', 'assignee.id')
      .leftJoin('users as installer', 'deliveries.installed_by', 'installer.id')
      .selectAll('deliveries')
      .select([
        'organisations.name as organisation_name',
        'organisations.city as city',
        'organisations.state as state',
        'products.name as product_name',
        sql<string>`coalesce(tenders.tender_number, tenders.tender_no)`.as('tender_no'),
        sql<string | null>`coalesce(proposals.proposal_number, proposals.proposal_no)`.as('proposal_no'),
        'assignee.full_name as assignee_name',
        'installer.full_name as installer_name',
      ])
      .where('deliveries.id', '=', id)
      .executeTakeFirst();

    if (!delivery) {
      throw new NotFoundException(`Delivery with ID ${id} not found`);
    }

    return delivery;
  }

  async create(dto: CreateDeliveryDto, user: AuthUser) {
    // Target date: today or later in IST — a dispatch is never scheduled into the past.
    const deliveryDay = calendarDay(dto.delivery_date) || '';
    if (deliveryDay < todayInKolkata()) {
      throw new BadRequestException({
        code: 'PAST_DATE_NOT_ALLOWED',
        message: `The target delivery date (${dmy(deliveryDay)}) is in the past. Choose today or a later date.`,
      });
    }

    const org = await this.db
      .selectFrom('organisations')
      .select(['id', 'name'])
      .where('id', '=', dto.organisation_id)
      .executeTakeFirst();

    if (!org) {
      throw new BadRequestException('The selected organisation does not exist');
    }

    // Dispatch against a converted proposal: it must be converted and belong to this customer; its PO
    // (conversion reference) and product fill the order fields the user left empty.
    let proposal: {
      id: string;
      proposal_number: string;
      proposal_no?: string | null;
      status: string;
      organisation_id: string;
      customer_id?: string | null;
      product_id: string | null;
      conversion_reference?: string | null;
      converted_reference: string | null;
      converted_to: string | null;
    } | undefined;
    if (dto.proposal_id) {
      proposal = await this.db
        .selectFrom('proposals')
        .select([
          'id',
          'proposal_number',
          'proposal_no',
          'status',
          'organisation_id',
          'customer_id',
          'product_id',
          'conversion_reference',
          'converted_reference',
          'converted_to',
        ])
        .where('id', '=', dto.proposal_id)
        .where('is_deleted', '=', false)
        .executeTakeFirst();
      if (!proposal) {
        throw new BadRequestException('The selected proposal does not exist.');
      }
      const proposalNo = proposal.proposal_number || proposal.proposal_no;
      if (String(proposal.status).toUpperCase() !== 'CONVERTED') {
        throw new BadRequestException({
          code: 'PROPOSAL_NOT_CONVERTED',
          message: `Proposal ${proposalNo} has not been converted to an order yet. Only converted proposals can be dispatched.`,
        });
      }
      if (proposal.organisation_id !== dto.organisation_id && proposal.customer_id !== dto.organisation_id) {
        throw new BadRequestException({
          code: 'PROPOSAL_CUSTOMER_MISMATCH',
          message: `Proposal ${proposalNo} belongs to another customer than ${org.name}.`,
        });
      }
    }
    const proposalNo = proposal ? proposal.proposal_number || proposal.proposal_no : null;
    const orderReference =
      dto.order_reference?.trim() ||
      proposal?.conversion_reference ||
      proposal?.converted_reference ||
      // Older conversions recorded the PO number in converted_to; it now holds the order type ("Purchase Order" …).
      (proposal?.converted_to && !(PROPOSAL_ORDER_TYPES as readonly string[]).includes(proposal.converted_to) ? proposal.converted_to : null) ||
      null;
    const remarks = [dto.remarks?.trim(), proposalNo && `Proposal: ${proposalNo}`].filter(Boolean).join('\n') || null;

    const year = Number(todayInKolkata().slice(0, 4)); // IST business year
    const countRes = await this.db
      .selectFrom('deliveries')
      .select(sql<number>`count(id)::int`.as('count'))
      .executeTakeFirst();
    const seq = (countRes?.count || 0) + 1;
    const deliveryNo = `DEL-${year}-${String(seq).padStart(4, '0')}`;

    const delivery = await this.db
      .insertInto('deliveries')
      .values({
        delivery_no: deliveryNo,
        organisation_id: dto.organisation_id,
        product_id: dto.product_id || proposal?.product_id || null,
        model: dto.model?.trim() || null,
        equipment_serial: dto.equipment_serial?.trim() || null,
        delivery_date: deliveryDay,
        delivery_location: dto.delivery_location.trim(),
        assigned_to: dto.assigned_to || user.id,
        tender_id: dto.tender_id || null,
        proposal_id: proposal?.id ?? null,
        order_reference: orderReference,
        status: 'scheduled',
        installation_required: dto.installation_required || false,
        installation_date: dto.installation_date || null,
        installed_by: dto.installed_by || null,
        installation_notes: dto.installation_notes || null,
        remarks,
        document_url: dto.document_url || null,
        created_by: user.id,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('delivery.created', {
      deliveryId: delivery.id,
      deliveryNo: delivery.delivery_no,
      organisationId: delivery.organisation_id,
      assignedTo: delivery.assigned_to,
      proposalId: proposal?.id,
      actorId: user.id,
    });

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'delivery',
      entityId: delivery.id,
      action: 'create',
      newValue: proposal ? { ...delivery, proposal_id: proposal.id, proposal_no: proposalNo } : delivery,
    });

    return delivery;
  }

  async updateStatus(id: string, dto: UpdateDeliveryStatusDto, user: AuthUser) {
    this.validateId(id);
    const existing = await this.findOne(id, user);
    const from = String(existing.status);
    const to = dto.status;

    // 1. Closed consignments stay closed.
    if (from === 'handover_completed' || from === 'cancelled') {
      throw new BadRequestException({
        code: 'DELIVERY_CLOSED',
        message: `Delivery ${existing.delivery_no} is ${label(from).toLowerCase()} and closed; its milestones can no longer change.`,
      });
    }

    // 2. Milestones move one step at a time: Scheduled → Dispatched → In Transit → Delivered → Installed → Handover.
    //    Staying on the same milestone updates its details; cancelling is possible from any open milestone.
    if (to !== from && to !== 'cancelled') {
      const fromIdx = DELIVERY_FLOW.indexOf(from as any);
      const toIdx = DELIVERY_FLOW.indexOf(to as any);
      const next = fromIdx >= 0 ? DELIVERY_FLOW[fromIdx + 1] : undefined;
      if (toIdx !== fromIdx + 1) {
        throw new BadRequestException({
          code: 'INVALID_DELIVERY_TRANSITION',
          message:
            toIdx >= 0 && toIdx < fromIdx
              ? `Delivery ${existing.delivery_no} is already ${label(from)}; it cannot move back to ${label(to)}.`
              : `Milestones are recorded in order. Delivery ${existing.delivery_no} is ${label(from)}${next ? `; the next milestone is ${label(next)}` : ''}.`,
          allowed_next: next ? [next, 'cancelled'] : ['cancelled'],
        });
      }
    }

    // 3. Evidence for the milestone being recorded.
    const receivedBy = dto.received_by?.trim() || '';
    const signoffRef = (dto.document_url !== undefined ? dto.document_url : existing.document_url)?.trim() || '';
    if (to === 'handover_completed' && (receivedBy.length < 3 || !signoffRef)) {
      throw new BadRequestException({
        code: 'HANDOVER_SIGNOFF_REQUIRED',
        message:
          'Handover needs the client sign-off: enter the officer who signed the handover and the signed handover certificate (link or reference number).',
      });
    }
    if (to === 'installed' && dto.installation_date && (calendarDay(dto.installation_date) || '') > todayInKolkata()) {
      throw new BadRequestException({
        code: 'INSTALLATION_DATE_IN_FUTURE',
        message: `The commissioning date (${dmy(dto.installation_date)}) cannot be in the future.`,
      });
    }

    // 4. Milestone log: each update appends a dated line to the remarks instead of overwriting earlier entries.
    const logParts = [
      dto.remarks?.trim(),
      receivedBy && `${to === 'handover_completed' ? 'Signed off by' : 'Received by'}: ${receivedBy}`,
      to === 'handover_completed' && signoffRef && `Handover certificate: ${signoffRef}`,
    ].filter(Boolean);
    const logLine = logParts.length
      ? `[${dmy(todayInKolkata())}] ${label(to)}${to !== from ? '' : ' (update)'}: ${logParts.join(' · ')}`
      : to !== from
        ? `[${dmy(todayInKolkata())}] ${label(to)}`
        : '';
    const remarks = [existing.remarks, logLine].filter(Boolean).join('\n') || null;

    const updated = await this.db
      .updateTable('deliveries')
      .set({
        status: to,
        installation_date:
          dto.installation_date !== undefined
            ? dto.installation_date || null
            : to === 'installed' && !existing.installation_date
              ? todayInKolkata()
              : existing.installation_date,
        installed_by:
          dto.installed_by !== undefined
            ? dto.installed_by
            : to === 'installed' && !existing.installed_by
              ? user.id
              : existing.installed_by,
        installation_notes: dto.installation_notes !== undefined ? dto.installation_notes : existing.installation_notes,
        remarks,
        document_url: dto.document_url !== undefined ? dto.document_url.trim() || null : existing.document_url,
        version: existing.version + 1,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('delivery.status_changed', {
      deliveryId: id,
      deliveryNo: existing.delivery_no,
      previousStatus: existing.status,
      newStatus: dto.status,
      actorId: user.id,
    });

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'delivery',
      entityId: id,
      action: 'status_change',
      previousValue: { status: existing.status },
      newValue: {
        status: dto.status,
        ...(receivedBy ? { received_by: receivedBy } : {}),
        ...(dto.document_url ? { document_url: dto.document_url } : {}),
        ...(dto.remarks ? { remarks: dto.remarks } : {}),
      },
    });

    return updated;
  }

  async delete(id: string, user: AuthUser) {
    this.validateId(id);
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'management') {
      throw new ForbiddenException('Only management or administrators can cancel/delete delivery orders');
    }

    await this.findOne(id, user);

    await this.db
      .updateTable('deliveries')
      .set({
        status: 'cancelled',
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return { success: true, message: 'Delivery cancelled successfully' };
  }

  /**
   * KPI counts for the register: same role scope and filters as findAll, per milestone. The status filter is
   * ignored (the counts are that dimension), so picking a status never zeroes the other cards.
   */
  async getDeliveryMetrics(user: AuthUser, query: DeliveryQueryDto = {}) {
    const rows = await this.filteredDeliveries(query, user, { ignoreStatus: true })
      .select(['deliveries.status', sql<number>`count(deliveries.id)::int`.as('c')])
      .groupBy('deliveries.status')
      .execute();

    const byStatus = Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, 0])) as Record<DeliveryStatus, number>;
    for (const r of rows) byStatus[r.status] = r.c;

    return {
      total: rows.reduce((sum, r) => sum + r.c, 0),
      scheduled: byStatus.scheduled,
      dispatched: byStatus.dispatched,
      inTransit: byStatus.in_transit,
      delivered: byStatus.delivered,
      installed: byStatus.installed,
      handoverCompleted: byStatus.handover_completed,
      cancelled: byStatus.cancelled,
      byStatus,
    };
  }
}
