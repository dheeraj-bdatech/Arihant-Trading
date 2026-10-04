import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { AppEvents } from '../../common/events/event-names.js';
import type { Database, AuthUser, PaginatedResult } from '@arihant/shared';
import type {
  CreateDemoDto,
  UpdateDemoDto,
  AssignTeamDto,
  ConfirmDemoDto,
  RescheduleDemoDto,
  CancelDemoDto,
  ReserveEquipmentDto,
  SuggestAlternativeDto,
  ApproveReservationDto,
  RejectReservationDto,
  AllocateAnotherUnitDto,
  SubmitDemoOutcomeDto,
  CreateEquipmentDto,
  UpdateEquipmentDto,
} from './demos.dto.js';

function formatDateOnly(d: any, fallback: string = ''): string {
  if (!d) return fallback;
  if (d instanceof Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const str = String(d);
  if (str.includes('T')) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return str.split('T')[0];
  }
  return str;
}

@Injectable()
export class DemosService {
  private readonly logger = new Logger(DemosService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // =========================================================================
  // 1. EQUIPMENT MANAGEMENT & AVAILABILITY
  // =========================================================================

  async getEquipment(query: { location?: string; status?: string; product_id?: string }) {
    let q = this.db
      .selectFrom('demo_equipment')
      .innerJoin('products', 'demo_equipment.product_id', 'products.id')
      .leftJoin('users', 'demo_equipment.responsible_person', 'users.id')
      .select([
        'demo_equipment.id',
        'demo_equipment.product_id',
        'demo_equipment.model',
        'demo_equipment.serial_no',
        'demo_equipment.current_location',
        'demo_equipment.availability_status',
        'demo_equipment.condition',
        'demo_equipment.reserved_until',
        'demo_equipment.remarks',
        'demo_equipment.created_at',
        'products.name as product_name',
        'products.category as product_category',
        'users.full_name as responsible_person_name',
      ]);

    if (query.location) {
      q = q.where('demo_equipment.current_location', '=', query.location);
    }

    if (query.status) {
      q = q.where('demo_equipment.availability_status', '=', query.status as any);
    }

    if (query.product_id) {
      q = q.where('demo_equipment.product_id', '=', query.product_id);
    }

    return q.orderBy('demo_equipment.current_location', 'asc')
      .orderBy('demo_equipment.model', 'asc')
      .execute();
  }

  async getEquipmentById(id: string) {
    const equip = await this.db
      .selectFrom('demo_equipment')
      .innerJoin('products', 'demo_equipment.product_id', 'products.id')
      .leftJoin('users', 'demo_equipment.responsible_person', 'users.id')
      .selectAll('demo_equipment')
      .select([
        'products.name as product_name',
        'products.category as product_category',
        'users.full_name as responsible_person_name',
      ])
      .where('demo_equipment.id', '=', id)
      .executeTakeFirst();

    if (!equip) {
      throw new NotFoundException('Equipment unit not found');
    }

    const reservations = await this.db
      .selectFrom('demo_reservations')
      .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
      .selectAll('demo_reservations')
      .select(['demos.demo_no', 'demos.location as demo_location', 'demos.status as demo_status'])
      .where('demo_reservations.equipment_id', '=', id)
      .where('demo_reservations.status', 'in', ['approved', 'requested'])
      .where('demos.status', 'not in', ['cancelled', 'completed'])
      .orderBy('demo_reservations.reserved_from', 'asc')
      .execute();

    return {
      ...equip,
      reservations,
    };
  }

  async createEquipment(dto: CreateEquipmentDto, actorId: string) {
    const equip = await this.db
      .insertInto('demo_equipment')
      .values({
        product_id: dto.product_id,
        model: dto.model,
        serial_no: dto.serial_no,
        current_location: dto.current_location,
        responsible_person: dto.responsible_person || actorId,
        availability_status: 'available',
        condition: dto.condition || 'Operational',
        remarks: dto.remarks || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId,
      entityType: 'demo_equipment',
      entityId: equip.id,
      action: 'create_equipment',
      newValue: equip,
    });

    return equip;
  }

  async updateEquipment(id: string, dto: UpdateEquipmentDto, actorId: string) {
    const existing = await this.getEquipmentById(id);

    const updatePayload: any = {
      updated_at: new Date(),
    };
    if (dto.model !== undefined) updatePayload.model = dto.model;
    if (dto.current_location !== undefined) updatePayload.current_location = dto.current_location;
    if (dto.responsible_person !== undefined) updatePayload.responsible_person = dto.responsible_person;
    if (dto.availability_status !== undefined) updatePayload.availability_status = dto.availability_status;
    if (dto.condition !== undefined) updatePayload.condition = dto.condition;
    if (dto.remarks !== undefined) updatePayload.remarks = dto.remarks;

    const updated = await this.db
      .updateTable('demo_equipment')
      .set(updatePayload)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId,
      entityType: 'demo_equipment',
      entityId: id,
      action: 'update_equipment',
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async getEquipmentAvailability(query: {
    product_id?: string;
    location?: string;
    from_date?: string;
    to_date?: string;
  }) {
    let q = this.db
      .selectFrom('demo_equipment')
      .innerJoin('products', 'demo_equipment.product_id', 'products.id')
      .select([
        'demo_equipment.id',
        'demo_equipment.product_id',
        'demo_equipment.model',
        'demo_equipment.serial_no',
        'demo_equipment.current_location',
        'demo_equipment.availability_status',
        'demo_equipment.condition',
        'demo_equipment.reserved_until',
        'products.name as product_name',
      ]);

    if (query.product_id) {
      q = q.where('demo_equipment.product_id', '=', query.product_id);
    }
    if (query.location) {
      q = q.where('demo_equipment.current_location', '=', query.location);
    }

    const allUnits = await q.execute();

    const fromDate = (query.from_date || new Date().toISOString()).split('T')[0];
    const toDate = (query.to_date || fromDate).split('T')[0];

    // Fetch active reservations in range
    const activeReservations = await this.db
      .selectFrom('demo_reservations')
      .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
      .select([
        'demo_reservations.equipment_id',
        'demo_reservations.reserved_from',
        'demo_reservations.reserved_to',
        'demos.id as demo_id',
        'demos.demo_no',
        'demos.location as demo_location',
      ])
      .where('demo_reservations.status', 'in', ['approved', 'requested', 'alternative_suggested'])
      .where(sql<boolean>`coalesce(demos.status, '') not in ('cancelled', 'completed')`)
      .where('demo_reservations.reserved_from', '<=', toDate)
      .where(sql<boolean>`coalesce(demo_reservations.reserved_to, demo_reservations.reserved_from) >= ${fromDate}`)
      .execute();

    const reservedMap = new Map<string, any>();
    for (const r of activeReservations) {
      reservedMap.set(r.equipment_id, r);
    }

    const unitsWithStatus = allUnits.map((unit) => {
      const reservation = reservedMap.get(unit.id);
      let calculatedStatus: 'available' | 'reserved' | 'maintenance' = 'available';

      if (unit.availability_status === 'maintenance') {
        calculatedStatus = 'maintenance';
      } else if (reservation) {
        calculatedStatus = 'reserved';
      } else if (unit.availability_status === 'reserved' && unit.reserved_until) {
        const untilStr = formatDateOnly(unit.reserved_until);
        if (untilStr >= fromDate) {
          calculatedStatus = 'reserved';
        }
      }

      const conflictingReservation = reservation
        ? {
            demo_no: reservation.demo_no,
            demo_location: reservation.demo_location,
            reserved_from: formatDateOnly(reservation.reserved_from, fromDate),
            reserved_to: formatDateOnly(reservation.reserved_to, toDate),
          }
        : calculatedStatus === 'reserved' && unit.reserved_until
        ? {
            demo_no: 'Depot Fleet Hold',
            demo_location: unit.current_location,
            reserved_from: fromDate,
            reserved_to: formatDateOnly(unit.reserved_until, toDate),
          }
        : null;

      return {
        ...unit,
        is_available_for_dates: calculatedStatus === 'available',
        effective_status: calculatedStatus,
        conflicting_reservation: conflictingReservation,
      };
    });

    const total = unitsWithStatus.length;
    const available = unitsWithStatus.filter((u) => u.effective_status === 'available').length;
    const reserved = unitsWithStatus.filter((u) => u.effective_status === 'reserved').length;
    const maintenance = unitsWithStatus.filter((u) => u.effective_status === 'maintenance').length;

    return {
      query: { product_id: query.product_id, location: query.location, from_date: fromDate, to_date: toDate },
      summary: { total, available, reserved, maintenance },
      units: unitsWithStatus,
    };
  }

  // =========================================================================
  // 2. DEMO PIPELINE & CRUD
  // =========================================================================

  async findAllDemos(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      assigned_to?: string;
      requested_by?: string;
      organisation_id?: string;
      product_id?: string;
      location?: string;
      date_from?: string;
      date_to?: string;
    },
    user: AuthUser,
  ): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('demos')
      .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .leftJoin('products', 'demos.product_id', 'products.id')
      .leftJoin('users as requestedUser', 'demos.requested_by', 'requestedUser.id')
      .leftJoin('users as assignee', 'demos.assigned_to', 'assignee.id')
      .leftJoin('visits', 'demos.visit_id', 'visits.id');

    // Role-based visibility
    if (user.role === 'sales') {
      baseQuery = baseQuery.where('demos.requested_by', '=', user.id);
    } else if (user.role === 'regional_manager') {
      if (user.zone_id) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb('organisations.zone_id', '=', user.zone_id),
            eb('demos.requested_by', '=', user.id),
          ]),
        );
      } else if (user.region_id) {
        baseQuery = baseQuery.where((eb) =>
          eb.or([
            eb('organisations.region_id', '=', user.region_id),
            eb('demos.requested_by', '=', user.id),
          ]),
        );
      }
    }

    if (query.status) {
      baseQuery = baseQuery.where('demos.status', '=', query.status as any);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('demos.assigned_to', '=', query.assigned_to);
    }

    if (query.requested_by) {
      baseQuery = baseQuery.where('demos.requested_by', '=', query.requested_by);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('demos.organisation_id', '=', query.organisation_id);
    }

    if (query.product_id) {
      baseQuery = baseQuery.where('demos.product_id', '=', query.product_id);
    }

    if (query.location) {
      baseQuery = baseQuery.where('demos.location', '=', query.location);
    }

    if (query.date_from) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('demos.confirmed_date', '>=', query.date_from!),
          eb.and([
            eb('demos.confirmed_date', 'is', null),
            eb('demos.requested_date', '>=', query.date_from!),
          ]),
        ]),
      );
    }

    if (query.date_to) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('demos.confirmed_date', '<=', query.date_to!),
          eb.and([
            eb('demos.confirmed_date', 'is', null),
            eb('demos.requested_date', '<=', query.date_to!),
          ]),
        ]),
      );
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(demos.demo_no) like ${s}`,
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(demos.location) like ${s}`,
          sql<boolean>`lower(products.name) like ${s}`,
          sql<boolean>`lower(requestedUser.full_name) like ${s}`,
          sql<boolean>`lower(assignee.full_name) like ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery
      .select(sql<number>`count(demos.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const demos = await baseQuery
      .select([
        'demos.id',
        'demos.demo_no',
        'demos.organisation_id',
        'demos.lead_id',
        'demos.product_id',
        'demos.requested_by',
        'demos.coordinator_id',
        'demos.assigned_to',
        'demos.location',
        'demos.requested_date',
        'demos.confirmed_date',
        'demos.purpose',
        'demos.expected_audience',
        'demos.equipment_required',
        'demos.special_requirements',
        'demos.remarks',
        'demos.visit_id',
        'demos.reschedule_reason',
        'demos.rescheduled_from',
        'demos.cancellation_reason',
        'demos.travel_required',
        'demos.travel_from',
        'demos.travel_to',
        'demos.travel_date',
        'demos.status',
        'demos.version',
        'demos.created_at',
        'demos.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'requestedUser.full_name as requested_by_name',
        'assignee.full_name as assignee_name',
        'visits.planned_date as visit_planned_date',
        'visits.status as visit_status',
      ])
      .orderBy(sql`coalesce(demos.confirmed_date, demos.requested_date)`, 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const demoIds = demos.map((d) => d.id);
    const reservationsByDemo: Record<string, any[]> = {};
    const outcomesByDemo: Record<string, any> = {};

    if (demoIds.length > 0) {
      const reservations = await this.db
        .selectFrom('demo_reservations')
        .innerJoin('demo_equipment', 'demo_reservations.equipment_id', 'demo_equipment.id')
        .leftJoin('products', 'demo_equipment.product_id', 'products.id')
        .leftJoin('users as approver', 'demo_reservations.approved_by', 'approver.id')
        .leftJoin('demo_equipment as altEquip', 'demo_reservations.alternative_equipment_id', 'altEquip.id')
        .selectAll('demo_reservations')
        .select([
          'demo_equipment.model',
          'demo_equipment.serial_no',
          'demo_equipment.current_location',
          'demo_equipment.condition as equipment_condition',
          'products.name as product_name',
          'approver.full_name as approved_by_name',
          'altEquip.model as alt_model',
          'altEquip.serial_no as alt_serial_no',
          'altEquip.current_location as alt_location',
        ])
        .where('demo_reservations.demo_id', 'in', demoIds)
        .orderBy('demo_reservations.created_at', 'desc')
        .execute();

      for (const res of reservations) {
        if (!reservationsByDemo[res.demo_id]) {
          reservationsByDemo[res.demo_id] = [];
        }
        reservationsByDemo[res.demo_id].push(res);
      }

      const outcomes = await this.db
        .selectFrom('demo_outcomes')
        .leftJoin('users as submitter', 'demo_outcomes.submitted_by', 'submitter.id')
        .selectAll('demo_outcomes')
        .select(['submitter.full_name as submitted_by_name'])
        .where('demo_outcomes.demo_id', 'in', demoIds)
        .execute();

      for (const out of outcomes) {
        outcomesByDemo[out.demo_id] = out;
      }
    }

    const enhancedDemos = demos.map((d) => ({
      ...d,
      reservations: reservationsByDemo[d.id] || [],
      outcome: outcomesByDemo[d.id] || null,
    }));

    return buildPaginatedResult(enhancedDemos, total, page, limit);
  }

  async findOneDemo(id: string) {
    const demo = await this.db
      .selectFrom('demos')
      .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .leftJoin('products', 'demos.product_id', 'products.id')
      .leftJoin('users as requestedUser', 'demos.requested_by', 'requestedUser.id')
      .leftJoin('users as assignee', 'demos.assigned_to', 'assignee.id')
      .leftJoin('visits', 'demos.visit_id', 'visits.id')
      .selectAll('demos')
      .select([
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'requestedUser.full_name as requested_by_name',
        'requestedUser.email as requested_by_email',
        'assignee.full_name as assignee_name',
        'assignee.email as assignee_email',
        'visits.planned_date as visit_planned_date',
        'visits.purpose as visit_purpose',
        'visits.status as visit_status',
      ])
      .where('demos.id', '=', id)
      .executeTakeFirst();

    if (!demo) {
      throw new NotFoundException('Demo request not found');
    }

    const reservations = await this.db
      .selectFrom('demo_reservations')
      .innerJoin('demo_equipment', 'demo_reservations.equipment_id', 'demo_equipment.id')
      .leftJoin('products', 'demo_equipment.product_id', 'products.id')
      .leftJoin('users as approver', 'demo_reservations.approved_by', 'approver.id')
      .leftJoin('demo_equipment as altEquip', 'demo_reservations.alternative_equipment_id', 'altEquip.id')
      .selectAll('demo_reservations')
      .select([
        'demo_equipment.model',
        'demo_equipment.serial_no',
        'demo_equipment.current_location',
        'demo_equipment.condition as equipment_condition',
        'products.name as product_name',
        'approver.full_name as approved_by_name',
        'altEquip.model as alt_model',
        'altEquip.serial_no as alt_serial_no',
        'altEquip.current_location as alt_location',
      ])
      .where('demo_reservations.demo_id', '=', id)
      .execute();

    const outcome = await this.db
      .selectFrom('demo_outcomes')
      .selectAll()
      .where('demo_id', '=', id)
      .executeTakeFirst();

    const rescheduleHistory = await this.db
      .selectFrom('demo_reschedule_history')
      .leftJoin('users', 'demo_reschedule_history.changed_by', 'users.id')
      .selectAll('demo_reschedule_history')
      .select('users.full_name as changed_by_name')
      .where('demo_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();

    return {
      ...demo,
      reservations,
      outcome: outcome || null,
      reschedule_history: rescheduleHistory,
    };
  }

  async createDemo(dto: CreateDemoDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      // 1. Check network retry idempotency: identical request by same user within past 60 seconds
      const sixtySecondsAgo = new Date(Date.now() - 60000);
      const duplicate = await trx
        .selectFrom('demos')
        .where('organisation_id', '=', dto.organisation_id)
        .where('requested_by', '=', user.id)
        .where('requested_date', '=', dto.requested_date)
        .where('created_at', '>=', sixtySecondsAgo)
        .selectAll()
        .executeTakeFirst();

      if (duplicate) {
        this.logger.warn(`Idempotent retry detected for demo creation: ${duplicate.demo_no}`);
        return duplicate;
      }

      // 2. Insert new demo record
      const demo = await trx
        .insertInto('demos')
        .values({
          organisation_id: dto.organisation_id,
          lead_id: dto.lead_id || null,
          product_id: dto.product_id || null,
          visit_id: dto.visit_id || null,
          requested_by: user.id,
          assigned_to: dto.assigned_to || null,
          location: dto.location || null,
          requested_date: dto.requested_date,
          confirmed_date: dto.confirmed_date || null,
          purpose: dto.purpose || null,
          expected_audience: dto.expected_audience || null,
          equipment_required: dto.equipment_required || null,
          special_requirements: dto.special_requirements || null,
          remarks: dto.remarks || null,
          travel_required: dto.travel_required || false,
          travel_from: dto.travel_from || null,
          travel_to: dto.travel_to || null,
          travel_date: dto.travel_date || null,
          travel_remarks: dto.travel_remarks || null,
          tender_id: dto.tender_id || null,
          deal_value: dto.deal_value || null,
          status: 'requested',
          version: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // If created from a visit, update the visit to link/record demo_required
      if (dto.visit_id) {
        await trx
          .updateTable('visits')
          .set({ demo_required: true })
          .where('id', '=', dto.visit_id)
          .execute();
      }

      // Fetch org name for notification
      const org = await trx
        .selectFrom('organisations')
        .select('name')
        .where('id', '=', dto.organisation_id)
        .executeTakeFirst();

      // Audit Log
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demo.id,
        action: 'DEMO_CREATED',
        newValue: demo,
      });

      // Notification
      this.eventEmitter.emit(AppEvents.DEMO_REQUESTED, {
        demoId: demo.id,
        demoNo: demo.demo_no,
        organisationName: org?.name || 'Client',
        requestedBy: user.id,
        requestedByName: user.full_name || 'Salesperson',
        location: demo.location,
      });

      return demo;
    });
  }

  async updateDemo(id: string, dto: UpdateDemoDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'completed' || demo.status === 'cancelled') {
        throw new BadRequestException(`Cannot update demo in terminal state "${demo.status}"`);
      }

      // Concurrency check
      if (dto.version !== undefined && dto.version !== demo.version) {
        throw new ConflictException('Concurrent modification detected. Please refresh and try again.');
      }

      const updatePayload: any = {
        updated_at: new Date(),
        version: demo.version + 1,
      };
      if (dto.location !== undefined) updatePayload.location = dto.location;
      if (dto.requested_date !== undefined) updatePayload.requested_date = dto.requested_date;
      if (dto.purpose !== undefined) updatePayload.purpose = dto.purpose;
      if (dto.expected_audience !== undefined) updatePayload.expected_audience = dto.expected_audience;
      if (dto.equipment_required !== undefined) updatePayload.equipment_required = dto.equipment_required;
      if (dto.special_requirements !== undefined) updatePayload.special_requirements = dto.special_requirements;
      if (dto.remarks !== undefined) updatePayload.remarks = dto.remarks;

      const updated = await trx
        .updateTable('demos')
        .set(updatePayload)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: id,
        action: 'DEMO_UPDATED',
        previousValue: demo,
        newValue: updated,
      });

      return updated;
    });
  }

  // =========================================================================
  // 3. TEAM ASSIGNMENT & CONFLICT PREVENTION (§5 & §11)
  // =========================================================================

  async getTeamAvailability(date: string) {
    const demoDate = date || new Date().toISOString().split('T')[0];

    // Fetch team members eligible for demos
    const teamMembers = await this.db
      .selectFrom('users')
      .select(['id', 'full_name', 'email', 'role', 'phone'])
      .where('role', 'in', ['demo_team', 'service_team', 'sales', 'regional_manager'])
      .where('is_active', '=', true)
      .orderBy('full_name', 'asc')
      .execute();

    // Query active demos assigned on that date
    const assignedDemos = await this.db
      .selectFrom('demos')
      .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .select([
        'demos.id',
        'demos.demo_no',
        'demos.assigned_to',
        'demos.location',
        'demos.status',
        'organisations.name as organisation_name',
      ])
      .where('demos.status', 'not in', ['cancelled', 'completed'])
      .where((eb) =>
        eb.or([
          eb('demos.confirmed_date', '=', demoDate),
          eb.and([
            eb('demos.confirmed_date', 'is', null),
            eb('demos.requested_date', '=', demoDate),
          ]),
        ]),
      )
      .execute();

    const assignedMap = new Map<string, any>();
    for (const d of assignedDemos) {
      if (d.assigned_to) {
        assignedMap.set(d.assigned_to, d);
      }
    }

    return teamMembers.map((member) => {
      const activeDemo = assignedMap.get(member.id);
      return {
        ...member,
        is_available: !activeDemo,
        availability_status: activeDemo ? 'already_assigned' : 'available',
        active_demo: activeDemo || null,
      };
    });
  }

  async assignTeam(demoId: string, dto: AssignTeamDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .selectAll('demos')
        .select('organisations.name as organisation_name')
        .where('demos.id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'completed' || demo.status === 'cancelled') {
        throw new BadRequestException(`Cannot assign team to demo in terminal state "${demo.status}"`);
      }

      const targetDate = dto.confirmed_date || demo.confirmed_date || demo.requested_date;

      // §11: Prevent team member double-booking on overlapping active demos
      if (targetDate) {
        const conflict = await trx
          .selectFrom('demos')
          .where('assigned_to', '=', dto.assigned_to)
          .where('id', '!=', demoId)
          .where('status', 'not in', ['cancelled', 'completed'])
          .where((eb) =>
            eb.or([
              eb('confirmed_date', '=', targetDate),
              eb.and([
                eb('confirmed_date', 'is', null),
                eb('requested_date', '=', targetDate),
              ]),
            ]),
          )
          .select(['id', 'demo_no', 'location'])
          .executeTakeFirst();

        if (conflict) {
          throw new ConflictException({
            code: 'TEAM_MEMBER_ALREADY_ASSIGNED',
            message: `Team member is already assigned to Demo ${conflict.demo_no || conflict.id} at ${conflict.location || 'Site'} on ${targetDate}.`,
          });
        }
      }

      const nextStatus = demo.status === 'requested' ? 'team_assigned' : demo.status;

      const updatePayload: any = {
        assigned_to: dto.assigned_to,
        coordinator_id: user.id,
        status: nextStatus,
        updated_at: new Date(),
        version: demo.version + 1,
      };

      if (dto.confirmed_date) updatePayload.confirmed_date = dto.confirmed_date;
      if (dto.travel_required !== undefined) updatePayload.travel_required = dto.travel_required;
      if (dto.travel_from !== undefined) updatePayload.travel_from = dto.travel_from;
      if (dto.travel_to !== undefined) updatePayload.travel_to = dto.travel_to;
      if (dto.travel_date !== undefined) updatePayload.travel_date = dto.travel_date;
      if (dto.travel_remarks !== undefined) updatePayload.travel_remarks = dto.travel_remarks;
      if (dto.remarks !== undefined) updatePayload.remarks = dto.remarks;

      const updated = await trx
        .updateTable('demos')
        .set(updatePayload)
        .where('id', '=', demoId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Audit log
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demoId,
        action: 'TEAM_MEMBER_ASSIGNED',
        previousValue: { assigned_to: demo.assigned_to },
        newValue: { assigned_to: dto.assigned_to, travel_required: dto.travel_required },
      });

      // Notification to assigned member
      this.eventEmitter.emit(AppEvents.DEMO_TEAM_ASSIGNED, {
        demoId,
        demoNo: demo.demo_no,
        assignedToId: dto.assigned_to,
        organisationName: demo.organisation_name,
        demoDate: targetDate,
        location: demo.location,
      });

      return updated;
    });
  }

  // =========================================================================
  // 4. CONCURRENCY-SAFE EQUIPMENT RESERVATION (§9 & §10)
  // =========================================================================

  async reserveEquipment(demoId: string, dto: ReserveEquipmentDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      // 1. Lock the demo record
      const demo = await trx
        .selectFrom('demos')
        .selectAll()
        .where('id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'completed' || demo.status === 'cancelled') {
        throw new BadRequestException(`Cannot reserve equipment for demo in terminal state "${demo.status}"`);
      }

      const fromDate = (dto.reserved_from || '').split('T')[0];
      const toDate = (dto.reserved_to || fromDate).split('T')[0];

      if (!fromDate || !toDate) {
        throw new BadRequestException('Reservation start and end dates are required.');
      }

      if (fromDate > toDate) {
        throw new BadRequestException('Reservation start date cannot be after end date.');
      }

      // 2. Lock the equipment unit row (§10: prevent concurrent race conditions)
      const equipment = await trx
        .selectFrom('demo_equipment')
        .selectAll()
        .where('id', '=', dto.equipment_id)
        .forUpdate()
        .executeTakeFirst();

      if (!equipment) {
        throw new NotFoundException('Equipment unit not found');
      }

      if (equipment.availability_status === 'maintenance') {
        throw new BadRequestException('Equipment is currently under maintenance and cannot be reserved.');
      }

      // Check if this equipment unit is ALREADY reserved on THIS demo
      const existingOnThisDemo = await trx
        .selectFrom('demo_reservations')
        .where('demo_id', '=', demoId)
        .where('equipment_id', '=', dto.equipment_id)
        .where('status', 'in', ['approved', 'requested'])
        .executeTakeFirst();

      if (existingOnThisDemo) {
        throw new ConflictException({
          code: 'EQUIPMENT_ALREADY_RESERVED_ON_THIS_DEMO',
          message: `Equipment unit ${equipment.model} (${equipment.serial_no || 'Unit'}) is already reserved for this demo.`,
        });
      }

      // Location Mismatch Alert (§7): check if equipment depot differs from demo location
      let locationMismatch = false;
      if (
        equipment.current_location &&
        demo.location &&
        !demo.location.toLowerCase().includes(equipment.current_location.toLowerCase())
      ) {
        locationMismatch = true;
        this.logger.warn(
          `Location mismatch: Demo ${demo.demo_no} is at "${demo.location}", but equipment unit ${equipment.serial_no} is stationed at "${equipment.current_location}".`,
        );
      }

      // 3. Double-Booking overlap check: (reserved_from <= new_to AND reserved_to >= new_from)
      const conflict = await trx
        .selectFrom('demo_reservations')
        .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
        .leftJoin('tenders', 'demos.tender_id', 'tenders.id')
        .leftJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .leftJoin('users as requester', 'demos.requested_by', 'requester.id')
        .where('demo_reservations.equipment_id', '=', dto.equipment_id)
        .where('demo_reservations.status', 'in', ['approved', 'requested'])
        .where(sql<boolean>`coalesce(demos.status, '') not in ('cancelled', 'completed')`)
        .where('demo_reservations.reserved_from', '<=', toDate)
        .where(sql<boolean>`coalesce(demo_reservations.reserved_to, demo_reservations.reserved_from) >= ${fromDate}`)
        .select([
          'demo_reservations.id',
          'demo_reservations.reserved_from',
          'demo_reservations.reserved_to',
          'demo_reservations.demo_id',
          'demos.demo_no',
          'demos.location as demo_location',
          'demos.deal_value',
          'demos.tender_id',
          'tenders.tender_no',
          'tenders.estimated_value as tender_value',
          'organisations.name as organisation_name',
          'requester.full_name as requested_by_name',
        ])
        .executeTakeFirst();

      const currentTender = demo.tender_id
        ? await trx.selectFrom('tenders').select(['tender_no', 'estimated_value']).where('id', '=', demo.tender_id).executeTakeFirst()
        : null;
      const currentEffectiveValue = Number(demo.deal_value || currentTender?.estimated_value || 0);

      if (conflict) {
        const confFrom = formatDateOnly(conflict.reserved_from, fromDate);
        const confTo = formatDateOnly(conflict.reserved_to, confFrom);
        const conflictEffectiveValue = Number(conflict.deal_value || conflict.tender_value || 0);
        const isCurrentHigher = currentEffectiveValue > conflictEffectiveValue;

        if (dto.override_conflict && ['management', 'admin'].includes(user.role)) {
          // Management Strategic Override based on Higher Tender Value (§16)
          await trx
            .updateTable('demo_reservations')
            .set({
              status: 'alternative_suggested',
              remarks: `Superseded by Management: Unit prioritized to Demo ${demo.demo_no} due to higher tender value (₹${currentEffectiveValue.toLocaleString('en-IN')} vs ₹${conflictEffectiveValue.toLocaleString('en-IN')}). ${dto.override_reason || ''}`.trim(),
            })
            .where('id', '=', conflict.id)
            .execute();

          this.eventEmitter.emit('audit.log', {
            actorId: user.id,
            entityType: 'demo_reservation',
            entityId: conflict.id,
            action: 'management_tender_priority_override',
            previousValue: { status: 'approved', demo_id: conflict.demo_id },
            newValue: {
              status: 'alternative_suggested',
              superseded_by_demo_id: demoId,
              current_tender_value: currentEffectiveValue,
              superseded_tender_value: conflictEffectiveValue,
              reason: dto.override_reason,
            },
          });
        } else {
          throw new ConflictException({
            code: 'EQUIPMENT_ALREADY_RESERVED',
            message: `Equipment unit ${equipment.model} (${equipment.serial_no || 'Unit'}) is already reserved from ${confFrom} to ${confTo} for Demo ${conflict.demo_no || ''} (${conflict.organisation_name || 'Client'}).`,
            conflicting_reservation: conflict,
            priority_analysis: {
              conflicting_demo: {
                demo_no: conflict.demo_no,
                organisation: conflict.organisation_name,
                salesperson: conflict.requested_by_name,
                tender_no: conflict.tender_no,
                tender_value: conflictEffectiveValue,
              },
              current_demo: {
                demo_no: demo.demo_no,
                tender_no: currentTender?.tender_no,
                tender_value: currentEffectiveValue,
              },
              recommendation: isCurrentHigher
                ? `Current demo has higher tender value (₹${currentEffectiveValue.toLocaleString('en-IN')} vs ₹${conflictEffectiveValue.toLocaleString('en-IN')}). Management approval can override reservation.`
                : `Conflicting demo has higher or equal tender value (₹${conflictEffectiveValue.toLocaleString('en-IN')} vs ₹${currentEffectiveValue.toLocaleString('en-IN')}). Keep existing reservation or select alternate unit/dates.`,
            },
          });
        }
      }

      // Check if equipment availability_status is 'reserved' and reserved_until covers the date
      if (!dto.override_conflict && equipment.availability_status === 'reserved' && equipment.reserved_until) {
        const reservedUntilStr = formatDateOnly(equipment.reserved_until);
        if (reservedUntilStr >= fromDate) {
          throw new ConflictException({
            code: 'EQUIPMENT_ALREADY_RESERVED',
            message: `Equipment unit ${equipment.model} (${equipment.serial_no || 'Unit'}) is currently reserved until ${reservedUntilStr}.`,
          });
        }
      }

      // 4. Create reservation
      const reservation = await trx
        .insertInto('demo_reservations')
        .values({
          demo_id: demoId,
          equipment_id: dto.equipment_id,
          reserved_from: fromDate,
          reserved_to: toDate,
          status: 'approved',
          approved_by: user.id,
          remarks: dto.remarks || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 5. Update equipment availability status & reserved_until
      await trx
        .updateTable('demo_equipment')
        .set({
          availability_status: 'reserved',
          reserved_until: toDate,
        })
        .where('id', '=', dto.equipment_id)
        .execute();

      // 6. Update demo status
      const nextStatus = demo.status === 'requested' || demo.status === 'under_planning'
        ? 'equipment_reserved'
        : demo.status;

      await trx
        .updateTable('demos')
        .set({
          status: nextStatus,
          updated_at: new Date(),
          version: demo.version + 1,
        })
        .where('id', '=', demoId)
        .execute();

      // Audit Log
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demoId,
        action: 'EQUIPMENT_RESERVED',
        newValue: { ...reservation, location_mismatch: locationMismatch },
      });

      // Notification
      this.eventEmitter.emit(AppEvents.DEMO_EQUIPMENT_RESERVED, {
        demoId,
        demoNo: demo.demo_no,
        equipmentModel: equipment.model || 'Demo Unit',
        serialNo: equipment.serial_no,
        salespersonId: demo.requested_by,
        assignedToId: demo.assigned_to,
      });

      return {
        ...reservation,
        location_mismatch: locationMismatch,
        equipment_location: equipment.current_location,
        demo_location: demo.location,
      };
    });
  }

  async suggestAlternative(
    reservationId: string,
    dto: SuggestAlternativeDto,
    user: AuthUser,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const reservation = await trx
        .selectFrom('demo_reservations')
        .selectAll()
        .where('id', '=', reservationId)
        .forUpdate()
        .executeTakeFirst();

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      // Check alternate unit existence
      const altEquip = await trx
        .selectFrom('demo_equipment')
        .selectAll()
        .where('id', '=', dto.alternative_equipment_id)
        .executeTakeFirst();

      if (!altEquip) {
        throw new NotFoundException('Alternative equipment unit not found');
      }

      const updated = await trx
        .updateTable('demo_reservations')
        .set({
          status: 'alternative_suggested',
          alternative_equipment_id: dto.alternative_equipment_id,
          alternative_reason: dto.alternative_reason,
          updated_at: new Date(),
        })
        .where('id', '=', reservationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: reservation.demo_id,
        action: 'EQUIPMENT_ALTERNATIVE_SUGGESTED',
        previousValue: reservation,
        newValue: updated,
      });

      return updated;
    });
  }

  async approveReservation(
    reservationId: string,
    dto: ApproveReservationDto,
    user: AuthUser,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const reservation = await trx
        .selectFrom('demo_reservations')
        .selectAll()
        .where('id', '=', reservationId)
        .forUpdate()
        .executeTakeFirst();

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      const updated = await trx
        .updateTable('demo_reservations')
        .set({
          status: 'approved',
          approved_by: user.id,
          remarks: dto.remarks || reservation.remarks,
          updated_at: new Date(),
        })
        .where('id', '=', reservationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Lock equipment availability status to 'reserved'
      await trx
        .updateTable('demo_equipment')
        .set({
          availability_status: 'reserved',
          reserved_until: reservation.reserved_to,
          updated_at: new Date(),
        })
        .where('id', '=', reservation.equipment_id)
        .execute();

      // Update demo status to equipment_reserved if still in requested or under_planning
      await trx
        .updateTable('demos')
        .set({
          status: 'equipment_reserved',
          updated_at: new Date(),
        })
        .where('id', '=', reservation.demo_id)
        .where('status', 'in', ['requested', 'under_planning'])
        .execute();

      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: reservation.demo_id,
        action: 'EQUIPMENT_RESERVATION_APPROVED',
        previousValue: reservation,
        newValue: updated,
      });

      return updated;
    });
  }

  async rejectReservation(
    reservationId: string,
    dto: RejectReservationDto,
    user: AuthUser,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const reservation = await trx
        .selectFrom('demo_reservations')
        .selectAll()
        .where('id', '=', reservationId)
        .forUpdate()
        .executeTakeFirst();

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      const updated = await trx
        .updateTable('demo_reservations')
        .set({
          status: 'rejected',
          approved_by: user.id,
          alternative_reason: dto.rejection_reason,
          remarks: dto.remarks || reservation.remarks,
          updated_at: new Date(),
        })
        .where('id', '=', reservationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const todayStr = new Date().toISOString().split('T')[0];

      // Check if equipment has any other active approved reservations
      const otherActiveReservations = await trx
        .selectFrom('demo_reservations')
        .select('id')
        .where('equipment_id', '=', reservation.equipment_id)
        .where('id', '!=', reservationId)
        .where('status', '=', 'approved')
        .where('reserved_to', '>=', todayStr)
        .executeTakeFirst();

      if (!otherActiveReservations) {
        await trx
          .updateTable('demo_equipment')
          .set({
            availability_status: 'available',
            reserved_until: null,
            updated_at: new Date(),
          })
          .where('id', '=', reservation.equipment_id)
          .execute();
      }

      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: reservation.demo_id,
        action: 'EQUIPMENT_RESERVATION_REJECTED',
        previousValue: reservation,
        newValue: updated,
      });

      return updated;
    });
  }

  async allocateAnotherUnit(
    reservationId: string,
    dto: AllocateAnotherUnitDto,
    user: AuthUser,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const reservation = await trx
        .selectFrom('demo_reservations')
        .selectAll()
        .where('id', '=', reservationId)
        .forUpdate()
        .executeTakeFirst();

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      const newUnit = await trx
        .selectFrom('demo_equipment')
        .selectAll()
        .where('id', '=', dto.equipment_id)
        .executeTakeFirst();

      if (!newUnit) {
        throw new NotFoundException('Target equipment unit not found');
      }

      const todayStr = new Date().toISOString().split('T')[0];

      // Release previous equipment unit if no other active reservation
      const oldEquipId = reservation.equipment_id;
      if (oldEquipId !== dto.equipment_id) {
        const otherApproved = await trx
          .selectFrom('demo_reservations')
          .select('id')
          .where('equipment_id', '=', oldEquipId)
          .where('id', '!=', reservationId)
          .where('status', '=', 'approved')
          .where('reserved_to', '>=', todayStr)
          .executeTakeFirst();

        if (!otherApproved) {
          await trx
            .updateTable('demo_equipment')
            .set({
              availability_status: 'available',
              reserved_until: null,
              updated_at: new Date(),
            })
            .where('id', '=', oldEquipId)
            .execute();
        }
      }

      const reservedFrom = dto.reserved_from || reservation.reserved_from;
      const reservedTo = dto.reserved_to || reservation.reserved_to;

      const updated = await trx
        .updateTable('demo_reservations')
        .set({
          equipment_id: dto.equipment_id,
          status: 'approved',
          approved_by: user.id,
          alternative_reason: dto.reason || null,
          remarks: dto.remarks || reservation.remarks,
          reserved_from: reservedFrom,
          reserved_to: reservedTo,
          updated_at: new Date(),
        })
        .where('id', '=', reservationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Lock new unit availability status to 'reserved'
      await trx
        .updateTable('demo_equipment')
        .set({
          availability_status: 'reserved',
          reserved_until: reservedTo,
          updated_at: new Date(),
        })
        .where('id', '=', dto.equipment_id)
        .execute();

      // Update demo status
      await trx
        .updateTable('demos')
        .set({
          status: 'equipment_reserved',
          updated_at: new Date(),
        })
        .where('id', '=', reservation.demo_id)
        .where('status', 'in', ['requested', 'under_planning'])
        .execute();

      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: reservation.demo_id,
        action: 'EQUIPMENT_REALLOCATED_AND_APPROVED',
        previousValue: reservation,
        newValue: updated,
      });

      return updated;
    });
  }

  // =========================================================================
  // 5. DATE CONFIRMATION, RESCHEDULING & CANCELLATION (§14, §15, §16)
  // =========================================================================

  async confirmDemo(demoId: string, dto: ConfirmDemoDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .selectAll('demos')
        .select('organisations.name as organisation_name')
        .where('demos.id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'completed' || demo.status === 'cancelled') {
        throw new BadRequestException(`Cannot confirm demo in terminal state "${demo.status}"`);
      }

      const updated = await trx
        .updateTable('demos')
        .set({
          confirmed_date: dto.confirmed_date,
          status: 'confirmed',
          remarks: dto.remarks || demo.remarks,
          coordinator_id: user.id,
          updated_at: new Date(),
          version: demo.version + 1,
        })
        .where('id', '=', demoId)
        .returningAll()
        .executeTakeFirstOrThrow();

      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demoId,
        action: 'DEMO_CONFIRMED',
        previousValue: { confirmed_date: demo.confirmed_date, status: demo.status },
        newValue: { confirmed_date: dto.confirmed_date, status: 'confirmed' },
      });

      this.eventEmitter.emit(AppEvents.DEMO_CONFIRMED, {
        demoId,
        demoNo: demo.demo_no,
        organisationName: demo.organisation_name,
        confirmedDate: dto.confirmed_date,
        salespersonId: demo.requested_by,
        assignedToId: demo.assigned_to,
      });

      return updated;
    });
  }

  async rescheduleDemo(demoId: string, dto: RescheduleDemoDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .selectAll('demos')
        .select('organisations.name as organisation_name')
        .where('demos.id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'completed' || demo.status === 'cancelled') {
        throw new BadRequestException(`Cannot reschedule demo in terminal state "${demo.status}"`);
      }

      const oldDate = demo.confirmed_date || demo.requested_date;

      // 1. Recheck team availability on new date
      if (demo.assigned_to) {
        const teamConflict = await trx
          .selectFrom('demos')
          .where('assigned_to', '=', demo.assigned_to)
          .where('id', '!=', demoId)
          .where('status', 'not in', ['cancelled', 'completed'])
          .where((eb) =>
            eb.or([
              eb('confirmed_date', '=', dto.new_date),
              eb.and([
                eb('confirmed_date', 'is', null),
                eb('requested_date', '=', dto.new_date),
              ]),
            ]),
          )
          .select(['id', 'demo_no'])
          .executeTakeFirst();

        if (teamConflict) {
          throw new ConflictException({
            code: 'TEAM_MEMBER_CONFLICT_ON_RESCHEDULE',
            message: `Assigned team member has a conflicting demo (${teamConflict.demo_no || ''}) on ${dto.new_date}. Please reassign or select an alternate date.`,
          });
        }
      }

      // 2. Recheck / update equipment reservations
      const reservations = await trx
        .selectFrom('demo_reservations')
        .selectAll()
        .where('demo_id', '=', demoId)
        .where('status', 'in', ['approved', 'requested'])
        .execute();

      for (const res of reservations) {
        // Check if unit is available on new date
        const equipConflict = await trx
          .selectFrom('demo_reservations')
          .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
          .where('demo_reservations.equipment_id', '=', res.equipment_id)
          .where('demo_reservations.status', 'in', ['approved', 'requested'])
          .where('demos.status', 'not in', ['cancelled', 'completed'])
          .where('demo_reservations.demo_id', '!=', demoId)
          .where('demo_reservations.reserved_from', '<=', dto.new_date)
          .where('demo_reservations.reserved_to', '>=', dto.new_date)
          .select(['demo_reservations.id', 'demos.demo_no'])
          .executeTakeFirst();

        if (equipConflict) {
          throw new ConflictException({
            code: 'EQUIPMENT_CONFLICT_ON_RESCHEDULE',
            message: `Reserved equipment is already booked on ${dto.new_date} by Demo ${equipConflict.demo_no || ''}. Please release/replace unit before rescheduling.`,
          });
        }

        // Update reservation date range to cover new date
        await trx
          .updateTable('demo_reservations')
          .set({
            reserved_from: dto.new_date,
            reserved_to: dto.new_date,
            updated_at: new Date(),
          })
          .where('id', '=', res.id)
          .execute();

        await trx
          .updateTable('demo_equipment')
          .set({ reserved_until: dto.new_date })
          .where('id', '=', res.equipment_id)
          .execute();
      }

      // 3. Record in reschedule history
      await trx
        .insertInto('demo_reschedule_history')
        .values({
          demo_id: demoId,
          old_date: oldDate,
          new_date: dto.new_date,
          reason: dto.reason,
          changed_by: user.id,
        })
        .execute();

      // 4. Update demo
      const updated = await trx
        .updateTable('demos')
        .set({
          confirmed_date: dto.new_date,
          rescheduled_from: oldDate,
          reschedule_reason: dto.reason,
          status: 'rescheduled',
          updated_at: new Date(),
          version: demo.version + 1,
        })
        .where('id', '=', demoId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Audit Log
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demoId,
        action: 'DEMO_RESCHEDULED',
        previousValue: { date: oldDate },
        newValue: { date: dto.new_date, reason: dto.reason },
      });

      // Notification
      this.eventEmitter.emit(AppEvents.DEMO_RESCHEDULED, {
        demoId,
        demoNo: demo.demo_no,
        organisationName: demo.organisation_name,
        oldDate: oldDate || undefined,
        newDate: dto.new_date,
        reason: dto.reason,
        salespersonId: demo.requested_by,
        assignedToId: demo.assigned_to,
      });

      return updated;
    });
  }

  async cancelDemo(demoId: string, dto: CancelDemoDto, user: AuthUser) {
    return this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .selectAll('demos')
        .select('organisations.name as organisation_name')
        .where('demos.id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'completed') {
        throw new BadRequestException('Cannot cancel an already completed demonstration.');
      }

      // 1. Release all equipment reservations (§15 & §26)
      const reservations = await trx
        .selectFrom('demo_reservations')
        .select(['id', 'equipment_id'])
        .where('demo_id', '=', demoId)
        .where('status', 'in', ['approved', 'requested'])
        .execute();

      for (const r of reservations) {
        await trx
          .updateTable('demo_reservations')
          .set({ status: 'cancelled', updated_at: new Date() })
          .where('id', '=', r.id)
          .execute();

        // Release equipment availability status back to available
        await trx
          .updateTable('demo_equipment')
          .set({
            availability_status: 'available',
            reserved_until: null,
          })
          .where('id', '=', r.equipment_id)
          .execute();
      }

      // 2. Cancel demo
      const updated = await trx
        .updateTable('demos')
        .set({
          status: 'cancelled',
          cancellation_reason: dto.cancellation_reason,
          remarks: dto.remarks ? `${demo.remarks ? demo.remarks + ' | ' : ''}Cancellation: ${dto.remarks}` : demo.remarks,
          updated_at: new Date(),
          version: demo.version + 1,
        })
        .where('id', '=', demoId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Audit Log
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demoId,
        action: 'DEMO_CANCELLED',
        previousValue: { status: demo.status },
        newValue: { status: 'cancelled', reason: dto.cancellation_reason },
      });

      // Notification
      this.eventEmitter.emit(AppEvents.DEMO_CANCELLED, {
        demoId,
        demoNo: demo.demo_no,
        organisationName: demo.organisation_name,
        reason: dto.cancellation_reason,
        salespersonId: demo.requested_by,
        assignedToId: demo.assigned_to,
      });

      return updated;
    });
  }

  // =========================================================================
  // 6. DEMO OUTCOME & STRUCTURED FAILURE ANALYSIS (§17 & §18)
  // =========================================================================

  async submitOutcome(demoId: string, dto: SubmitDemoOutcomeDto, user: AuthUser) {
    // Failure reason is strictly REQUIRED if demo result is 'fail'
    if (dto.result === 'fail' && !dto.failure_reason) {
      throw new BadRequestException({
        code: 'MISSING_FAILURE_REASON',
        message: 'A structured failure reason is required when demo result is unsuccessful.',
      });
    }

    return this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .selectAll('demos')
        .select('organisations.name as organisation_name')
        .where('demos.id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'cancelled') {
        throw new BadRequestException('Cannot submit outcome for a cancelled demo.');
      }

      // Check if outcome already exists (idempotent / prevent duplicate)
      const existingOutcome = await trx
        .selectFrom('demo_outcomes')
        .selectAll()
        .where('demo_id', '=', demoId)
        .executeTakeFirst();

      let outcome;
      if (existingOutcome) {
        outcome = await trx
          .updateTable('demo_outcomes')
          .set({
            completed: dto.completed !== undefined ? dto.completed : true,
            customer_response: dto.customer_response || null,
            technical_performance: dto.technical_performance || null,
            product_suitability: dto.product_suitability || null,
            decision_maker_present: dto.decision_maker_present !== undefined ? dto.decision_maker_present : null,
            competitor_involved: dto.competitor_involved || null,
            next_step: dto.next_step || null,
            opportunity_stage: dto.opportunity_stage || null,
            result: dto.result,
            failure_reason: dto.result === 'fail' ? dto.failure_reason || 'OTHER' : null,
            remarks: dto.remarks || null,
            submitted_by: user.id,
          })
          .where('id', '=', existingOutcome.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        outcome = await trx
          .insertInto('demo_outcomes')
          .values({
            demo_id: demoId,
            completed: dto.completed !== undefined ? dto.completed : true,
            customer_response: dto.customer_response || null,
            technical_performance: dto.technical_performance || null,
            product_suitability: dto.product_suitability || null,
            decision_maker_present: dto.decision_maker_present !== undefined ? dto.decision_maker_present : null,
            competitor_involved: dto.competitor_involved || null,
            next_step: dto.next_step || null,
            opportunity_stage: dto.opportunity_stage || null,
            result: dto.result,
            failure_reason: dto.result === 'fail' ? dto.failure_reason || 'OTHER' : null,
            remarks: dto.remarks || null,
            submitted_by: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      // 1. Mark demo completed
      await trx
        .updateTable('demos')
        .set({
          status: 'completed',
          updated_at: new Date(),
          version: demo.version + 1,
        })
        .where('id', '=', demoId)
        .execute();

      // 2. Release reserved equipment back to available
      const reservations = await trx
        .selectFrom('demo_reservations')
        .select('equipment_id')
        .where('demo_id', '=', demoId)
        .execute();

      for (const r of reservations) {
        await trx
          .updateTable('demo_equipment')
          .set({
            availability_status: 'available',
            reserved_until: null,
          })
          .where('id', '=', r.equipment_id)
          .execute();
      }

      // 3. Customer timeline interaction (§20: idempotent using demo_id unique constraint)
      const occurredDate = demo.confirmed_date || demo.requested_date || new Date().toISOString().split('T')[0];
      const interactionRemarks = `Product Demonstration (${demo.demo_no}): Result = ${dto.result.toUpperCase()}${dto.failure_reason ? ' | Failure: ' + dto.failure_reason : ''}${dto.remarks ? ' | Notes: ' + dto.remarks : ''}`;

      const existingInteraction = await trx
        .selectFrom('interactions')
        .select('id')
        .where('demo_id', '=', demoId)
        .executeTakeFirst();

      if (!existingInteraction) {
        await trx
          .insertInto('interactions')
          .values({
            organisation_id: demo.organisation_id,
            lead_id: demo.lead_id,
            demo_id: demoId,
            visit_id: demo.visit_id,
            type: 'demo',
            employee_id: demo.assigned_to || user.id,
            occurred_on: occurredDate,
            remarks: interactionRemarks,
            outcome: dto.customer_response || dto.result,
            next_action: dto.next_step || null,
          })
          .execute();
      }

      // 4. Record in employee activity log
      await trx
        .insertInto('employee_activities')
        .values({
          employee_id: demo.assigned_to || user.id,
          activity_type: 'demo',
          entity_type: 'demo',
          entity_id: demoId,
          activity_date: occurredDate,
          title: `Field Trial: ${demo.organisation_name} (${demo.demo_no})`,
          status: 'completed',
          outcome: dto.result,
          next_action: dto.next_step || null,
          details: {
            customer_response: dto.customer_response,
            technical_performance: dto.technical_performance,
            product_suitability: dto.product_suitability,
            failure_reason: dto.failure_reason,
            competitor_involved: dto.competitor_involved,
          },
        })
        .onConflict((oc) =>
          oc.columns(['employee_id', 'entity_type', 'entity_id']).doUpdateSet({
            outcome: dto.result,
            next_action: dto.next_step || null,
            details: {
              customer_response: dto.customer_response,
              technical_performance: dto.technical_performance,
              product_suitability: dto.product_suitability,
              failure_reason: dto.failure_reason,
              competitor_involved: dto.competitor_involved,
            },
          }),
        )
        .execute();

      // Audit Log
      this.eventEmitter.emit('audit.log', {
        actorId: user.id,
        entityType: 'demo',
        entityId: demoId,
        action: 'DEMO_COMPLETED',
        newValue: outcome,
      });

      // Completion event
      this.eventEmitter.emit(AppEvents.DEMO_COMPLETED, {
        demoId,
        demoNo: demo.demo_no,
        organisationName: demo.organisation_name,
        result: dto.result,
        failureReason: dto.failure_reason,
        actorName: user.full_name,
      });

      return outcome;
    });
  }

  // =========================================================================
  // 7. MANAGEMENT ANALYTICS (§19)
  // =========================================================================

  async getAnalytics() {
    // Total counts by status
    const statusCounts = await this.db
      .selectFrom('demos')
      .select([
        sql<number>`count(*)::int`.as('total_demos'),
        sql<number>`count(*) filter (where status = 'completed')::int`.as('completed_demos'),
        sql<number>`count(*) filter (where status = 'cancelled')::int`.as('cancelled_demos'),
        sql<number>`count(*) filter (where status = 'rescheduled')::int`.as('rescheduled_demos'),
        sql<number>`count(*) filter (where status in ('requested', 'under_planning', 'team_assigned', 'equipment_reserved', 'confirmed'))::int`.as('active_pipeline'),
      ])
      .executeTakeFirst();

    // Outcomes counts: success vs fail
    const outcomeCounts = await this.db
      .selectFrom('demo_outcomes')
      .select([
        sql<number>`count(*) filter (where result = 'success')::int`.as('successful'),
        sql<number>`count(*) filter (where result = 'fail')::int`.as('unsuccessful'),
        sql<number>`count(*) filter (where result = 'partial')::int`.as('partial'),
      ])
      .executeTakeFirst();

    const successful = outcomeCounts?.successful || 0;
    const unsuccessful = outcomeCounts?.unsuccessful || 0;
    const partial = outcomeCounts?.partial || 0;
    const totalOutcomes = successful + unsuccessful + partial;
    const successRate = totalOutcomes > 0 ? Math.round((successful / totalOutcomes) * 100) : 0;

    // Structured failure reasons breakdown
    const failureBreakdownRows = await this.db
      .selectFrom('demo_outcomes')
      .select([
        'failure_reason',
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('result', '=', 'fail')
      .where('failure_reason', 'is not', null)
      .groupBy('failure_reason')
      .execute();

    const failureBreakdown = failureBreakdownRows.map((row) => ({
      reason: row.failure_reason!,
      count: row.count,
      percentage: unsuccessful > 0 ? Math.round((row.count / unsuccessful) * 100) : 0,
    }));

    // Depot Fleet Inventory & Availability
    const depotBreakdown = await this.db
      .selectFrom('demo_equipment')
      .select([
        'current_location',
        sql<number>`count(*)::int`.as('total_units'),
        sql<number>`count(*) filter (where availability_status = 'available')::int`.as('available_units'),
        sql<number>`count(*) filter (where availability_status = 'reserved')::int`.as('reserved_units'),
        sql<number>`count(*) filter (where availability_status = 'maintenance')::int`.as('maintenance_units'),
      ])
      .groupBy('current_location')
      .execute();

    // Competitor involvement distribution
    const competitorRows = await this.db
      .selectFrom('demo_outcomes')
      .select([
        'competitor_involved',
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('competitor_involved', 'is not', null)
      .where('competitor_involved', '!=', '')
      .groupBy('competitor_involved')
      .orderBy('count', 'desc')
      .limit(5)
      .execute();

    // Decision-maker attendance correlation
    const dmStats = await this.db
      .selectFrom('demo_outcomes')
      .select([
        sql<number>`count(*) filter (where decision_maker_present = true)::int`.as('dm_present_total'),
        sql<number>`count(*) filter (where decision_maker_present = true and result = 'success')::int`.as('dm_present_success'),
        sql<number>`count(*) filter (where decision_maker_present = false)::int`.as('dm_absent_total'),
        sql<number>`count(*) filter (where decision_maker_present = false and result = 'success')::int`.as('dm_absent_success'),
      ])
      .executeTakeFirst();

    const dmPresentTotal = dmStats?.dm_present_total || 0;
    const dmPresentSuccess = dmStats?.dm_present_success || 0;
    const dmAbsentTotal = dmStats?.dm_absent_total || 0;
    const dmAbsentSuccess = dmStats?.dm_absent_success || 0;

    // Product Failure Correlation
    const productFailureRows = await this.db
      .selectFrom('demo_outcomes')
      .innerJoin('demos', 'demo_outcomes.demo_id', 'demos.id')
      .leftJoin('products', 'demos.product_id', 'products.id')
      .select([
        sql<string>`coalesce(products.name, 'Unspecified Product')`.as('product_name'),
        'demo_outcomes.failure_reason',
        sql<number>`count(*)::int`.as('fail_count'),
      ])
      .where('demo_outcomes.result', '=', 'fail')
      .where('demo_outcomes.failure_reason', 'is not', null)
      .groupBy(['products.name', 'demo_outcomes.failure_reason'])
      .orderBy('fail_count', 'desc')
      .limit(6)
      .execute();

    return {
      overview: {
        total_demos: statusCounts?.total_demos || 0,
        completed_demos: statusCounts?.completed_demos || 0,
        cancelled_demos: statusCounts?.cancelled_demos || 0,
        rescheduled_demos: statusCounts?.rescheduled_demos || 0,
        active_pipeline: statusCounts?.active_pipeline || 0,
        successful,
        unsuccessful,
        partial,
        success_rate_percent: successRate,
      },
      failure_analysis: failureBreakdown,
      product_failures: productFailureRows,
      depot_fleet: depotBreakdown,
      competitors: competitorRows,
      decision_maker_impact: {
        present_total: dmPresentTotal,
        present_success: dmPresentSuccess,
        present_success_rate: dmPresentTotal > 0 ? Math.round((dmPresentSuccess / dmPresentTotal) * 100) : 0,
        absent_total: dmAbsentTotal,
        absent_success: dmAbsentSuccess,
        absent_success_rate: dmAbsentTotal > 0 ? Math.round((dmAbsentSuccess / dmAbsentTotal) * 100) : 0,
        attended: {
          total: dmPresentTotal,
          successful: dmPresentSuccess,
          rate_percent: dmPresentTotal > 0 ? Math.round((dmPresentSuccess / dmPresentTotal) * 100) : 0,
        },
        absent: {
          total: dmAbsentTotal,
          successful: dmAbsentSuccess,
          rate_percent: dmAbsentTotal > 0 ? Math.round((dmAbsentSuccess / dmAbsentTotal) * 100) : 0,
        },
      },
    };
  }

  // =========================================================================
  // 8. AUDIT TRAIL (§23)
  // =========================================================================

  async getAuditTrail(demoId: string) {
    const logs = await this.db
      .selectFrom('audit_log')
      .leftJoin('users as actor', 'audit_log.actor_id', 'actor.id')
      .select([
        'audit_log.id',
        'audit_log.action',
        'audit_log.previous_value',
        'audit_log.new_value',
        'audit_log.created_at',
        'actor.full_name as actor_name',
        'actor.role as actor_role',
      ])
      .where('audit_log.entity_id', '=', demoId)
      .orderBy('audit_log.created_at', 'desc')
      .execute();

    const reschedules = await this.db
      .selectFrom('demo_reschedule_history')
      .leftJoin('users as actor', 'demo_reschedule_history.changed_by', 'actor.id')
      .select([
        'demo_reschedule_history.id',
        'demo_reschedule_history.old_date',
        'demo_reschedule_history.new_date',
        'demo_reschedule_history.reason',
        'demo_reschedule_history.created_at',
        'actor.full_name as actor_name',
        'actor.role as actor_role',
      ])
      .where('demo_id', '=', demoId)
      .orderBy('created_at', 'desc')
      .execute();

    return {
      audit_logs: logs,
      reschedule_events: reschedules,
    };
  }
}
