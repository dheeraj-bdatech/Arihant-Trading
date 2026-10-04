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
import type { Database, AuthUser, PaginatedResult } from '@arihant/shared';
import {
  CreateDeliveryDto,
  UpdateDeliveryStatusDto,
  DeliveryQueryDto,
  UUID_REGEX,
} from './deliveries.dto.js';

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

  async findAll(query: DeliveryQueryDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('deliveries')
      .innerJoin('organisations', 'deliveries.organisation_id', 'organisations.id')
      .leftJoin('products', 'deliveries.product_id', 'products.id')
      .leftJoin('tenders', 'deliveries.tender_id', 'tenders.id')
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

    if (query.status) {
      baseQuery = baseQuery.where('deliveries.status', '=', query.status as any);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('deliveries.organisation_id', '=', query.organisation_id);
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
      const s = `%${query.search.toLowerCase()}%`;
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
        'deliveries.document_url',
        'deliveries.version',
        'deliveries.created_at',
        'deliveries.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'tenders.tender_no',
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
      .leftJoin('users as assignee', 'deliveries.assigned_to', 'assignee.id')
      .leftJoin('users as installer', 'deliveries.installed_by', 'installer.id')
      .selectAll('deliveries')
      .select([
        'organisations.name as organisation_name',
        'organisations.city as city',
        'organisations.state as state',
        'products.name as product_name',
        'tenders.tender_no',
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
    const org = await this.db
      .selectFrom('organisations')
      .select(['id', 'name'])
      .where('id', '=', dto.organisation_id)
      .executeTakeFirst();

    if (!org) {
      throw new BadRequestException('The selected organisation does not exist');
    }

    const year = new Date().getFullYear();
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
        product_id: dto.product_id || null,
        model: dto.model || null,
        equipment_serial: dto.equipment_serial || null,
        delivery_date: dto.delivery_date,
        delivery_location: dto.delivery_location,
        assigned_to: dto.assigned_to || user.id,
        tender_id: dto.tender_id || null,
        order_reference: dto.order_reference || null,
        status: 'scheduled',
        installation_required: dto.installation_required || false,
        installation_date: dto.installation_date || null,
        installed_by: dto.installed_by || null,
        installation_notes: dto.installation_notes || null,
        remarks: dto.remarks || null,
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
      actorId: user.id,
    });

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'delivery',
      entityId: delivery.id,
      action: 'create',
      newValue: delivery,
    });

    return delivery;
  }

  async updateStatus(id: string, dto: UpdateDeliveryStatusDto, user: AuthUser) {
    this.validateId(id);
    const existing = await this.findOne(id, user);

    const updated = await this.db
      .updateTable('deliveries')
      .set({
        status: dto.status,
        installation_date: dto.installation_date !== undefined ? dto.installation_date : existing.installation_date,
        installed_by: dto.installed_by !== undefined ? dto.installed_by : existing.installed_by,
        installation_notes: dto.installation_notes !== undefined ? dto.installation_notes : existing.installation_notes,
        remarks: dto.remarks !== undefined ? dto.remarks : existing.remarks,
        document_url: dto.document_url !== undefined ? dto.document_url : existing.document_url,
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
      newValue: { status: dto.status },
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

  async getDeliveryMetrics(user: AuthUser) {
    let baseQuery = this.db
      .selectFrom('deliveries')
      .innerJoin('organisations', 'deliveries.organisation_id', 'organisations.id');

    if (user.role === 'regional_manager' && user.zone_id) {
      baseQuery = baseQuery.where('organisations.zone_id', '=', user.zone_id);
    }

    const [
      totalRes,
      scheduledRes,
      inTransitRes,
      deliveredRes,
      installedRes,
      completedRes,
    ] = await Promise.all([
      baseQuery.select(sql<number>`count(deliveries.id)::int`.as('c')).executeTakeFirst(),
      baseQuery.select(sql<number>`count(deliveries.id)::int`.as('c')).where('deliveries.status', '=', 'scheduled').executeTakeFirst(),
      baseQuery.select(sql<number>`count(deliveries.id)::int`.as('c')).where('deliveries.status', '=', 'in_transit').executeTakeFirst(),
      baseQuery.select(sql<number>`count(deliveries.id)::int`.as('c')).where('deliveries.status', '=', 'delivered').executeTakeFirst(),
      baseQuery.select(sql<number>`count(deliveries.id)::int`.as('c')).where('deliveries.status', '=', 'installed').executeTakeFirst(),
      baseQuery.select(sql<number>`count(deliveries.id)::int`.as('c')).where('deliveries.status', '=', 'handover_completed').executeTakeFirst(),
    ]);

    return {
      total: totalRes?.c || 0,
      scheduled: scheduledRes?.c || 0,
      inTransit: inTransitRes?.c || 0,
      delivered: deliveredRes?.c || 0,
      installed: installedRes?.c || 0,
      handoverCompleted: completedRes?.c || 0,
    };
  }
}
