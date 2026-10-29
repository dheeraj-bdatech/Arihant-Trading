import { calendarDay, todayInKolkata } from '../../common/utils/ist-date.util.js';
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
import { ServiceService } from '../service/service.service.js';
import type { Database, AuthUser, PaginatedResult, DemoStatus } from '@arihant/shared';
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
  DemoQueryDto,
} from './demos.dto.js';
import { containsPattern } from '../../common/utils/like-pattern.js';

const DEMO_STATUS_VALUES: DemoStatus[] = [
  'requested', 'under_planning', 'team_assigned', 'equipment_reserved', 'confirmed', 'completed', 'cancelled', 'rescheduled',
];

/**
 * "Pending requests" — the demo coordinator's planning queue (MODULE_3 §4.1–4.2): open demos whose date is not
 * (re)confirmed yet. A rescheduled demo is back in it: its next step is "re-verify specialist & unit; confirm date".
 */
export const DEMO_PENDING_STATUSES: DemoStatus[] = ['requested', 'under_planning', 'team_assigned', 'equipment_reserved', 'rescheduled'];

/** "Active pipeline" — every open demo: the pending requests plus confirmed ones (all but completed / cancelled). */
export const DEMO_ACTIVE_STATUSES: DemoStatus[] = [...DEMO_PENDING_STATUSES, 'confirmed'];

/** A filter dimension a breakdown can leave out (see DemosService.demoScope). */
type DemoFilterDimension = 'status' | 'location' | 'outcome';

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

/** A calendar value (DATE column, ISO instant or 'YYYY-MM-DD') as DD/MM/YYYY for user-facing messages. */
function dmy(value: unknown): string {
  const day = calendarDay(value as any);
  if (!day) return String(value ?? '');
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * A calendar value sent by a client, as the IST day ('YYYY-MM-DD') to write into a DATE column. Clients may echo a
 * DATE back as the serialized instant they read (e.g. '2026-10-27T18:30:00.000Z' for 28 Oct on an IST server); cast
 * straight to DATE, Postgres keeps the UTC date part and the day slips back by one.
 */
function toDay<T extends string | null | undefined>(value: T): T {
  if (!value) return value;
  return (calendarDay(value) ?? value) as T;
}

/** Demo dates are planned for today or later (IST), like field visits. */
function assertNotPastDemoDate(value: unknown, what: string) {
  const day = calendarDay(value as any) || '';
  if (day && day < todayInKolkata()) {
    throw new BadRequestException({
      code: 'PAST_DATE_NOT_ALLOWED',
      message: `The ${what} (${dmy(day)}) is in the past. Choose today or a later date.`,
    });
  }
}

@Injectable()
export class DemosService {
  private readonly logger = new Logger(DemosService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly serviceService: ServiceService,
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
        'demo_equipment.responsible_person',
        'demo_equipment.availability_status',
        'demo_equipment.condition',
        'demo_equipment.reserved_until',
        'demo_equipment.remarks',
        'demo_equipment.created_at',
        'products.name as product_name',
        'products.category as product_category',
        'users.full_name as responsible_person_name',
        // §15 "Reserved date": the current or next live booking window of this unit.
        sql<string | null>`(select r.reserved_from::text from demo_reservations r join demos d on d.id = r.demo_id
          where r.equipment_id = demo_equipment.id and r.status = 'approved' and coalesce(d.status, '') not in ('cancelled', 'completed')
            and coalesce(r.reserved_to, r.reserved_from) >= current_date order by r.reserved_from limit 1)`.as('next_reserved_from'),
        sql<string | null>`(select coalesce(r.reserved_to, r.reserved_from)::text from demo_reservations r join demos d on d.id = r.demo_id
          where r.equipment_id = demo_equipment.id and r.status = 'approved' and coalesce(d.status, '') not in ('cancelled', 'completed')
            and coalesce(r.reserved_to, r.reserved_from) >= current_date order by r.reserved_from limit 1)`.as('next_reserved_to'),
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

  /** Serial numbers are unique across the fleet (unique index): answer a clash with a readable 409, not a raw 23505. */
  private async assertSerialFree(serialNo: string, exceptId?: string) {
    let q = this.db.selectFrom('demo_equipment').select(['id', 'model']).where('serial_no', '=', serialNo);
    if (exceptId) q = q.where('id', '!=', exceptId);
    const taken = await q.executeTakeFirst();
    if (taken) {
      throw new ConflictException({
        code: 'SERIAL_NO_TAKEN',
        message: `Serial number ${serialNo} is already registered to another unit (${taken.model || 'demo unit'}).`,
      });
    }
  }

  async createEquipment(dto: CreateEquipmentDto, actorId: string) {
    await this.assertSerialFree(dto.serial_no.trim());
    const equip = await this.db
      .insertInto('demo_equipment')
      .values({
        product_id: dto.product_id,
        model: dto.model,
        serial_no: dto.serial_no.trim(),
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
    if (dto.serial_no !== undefined && dto.serial_no.trim() !== (existing.serial_no || '')) {
      await this.assertSerialFree(dto.serial_no.trim(), id);
      updatePayload.serial_no = dto.serial_no.trim();
    }
    if (dto.product_id !== undefined && dto.product_id !== existing.product_id) {
      // A booked unit keeps its product: the demos holding it were matched (or substituted) against that product.
      if (existing.reservations.length > 0) {
        throw new BadRequestException({
          code: 'EQUIPMENT_HAS_BOOKINGS',
          message: 'This unit is booked or requested for open demos. Release those bookings before changing its product.',
        });
      }
      updatePayload.product_id = dto.product_id;
    }
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

    const fromDate = calendarDay(query.from_date) || todayInKolkata();
    const toDate = calendarDay(query.to_date) || fromDate;

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
      // Same set the booking check treats as a clash (a superseded / alternative-suggested row no longer holds the unit).
      .where('demo_reservations.status', 'in', ['approved', 'requested'])
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

      // Bookings decide reserved-ness for the asked window; a unit out in use is unavailable whatever the dates.
      if (unit.availability_status === 'maintenance') {
        calculatedStatus = 'maintenance';
      } else if (reservation || unit.availability_status === 'in_use') {
        calculatedStatus = 'reserved';
      }

      const conflictingReservation = reservation
        ? {
            demo_no: reservation.demo_no,
            demo_location: reservation.demo_location,
            reserved_from: formatDateOnly(reservation.reserved_from, fromDate),
            reserved_to: formatDateOnly(reservation.reserved_to, toDate),
          }
        : unit.availability_status === 'in_use'
        ? {
            demo_no: 'In use',
            demo_location: unit.current_location,
            reserved_from: fromDate,
            reserved_to: unit.reserved_until ? formatDateOnly(unit.reserved_until, toDate) : toDate,
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

  /**
   * The demo register's scope: the caller's RBAC visibility plus the register filters. The list, its counts
   * (getDemoSummary) and the analytics all start here, so a figure on screen always counts the rows the list shows.
   * `except` drops the filter on one dimension, so a breakdown by that dimension (e.g. the Status menu's counts)
   * shows every value of it rather than only the selected one.
   */
  private demoScope(query: DemoQueryDto, user: AuthUser, except?: DemoFilterDimension) {
    let baseQuery = this.db
      .selectFrom('demos')
      .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .leftJoin('products', 'demos.product_id', 'products.id')
      .leftJoin('users as requestedUser', 'demos.requested_by', 'requestedUser.id')
      .leftJoin('users as assignee', 'demos.assigned_to', 'assignee.id');

    // Role-based visibility
    if (user.role === 'sales') {
      baseQuery = baseQuery.where('demos.requested_by', '=', user.id);
    } else if (user.role === 'service_team') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('demos.assigned_to', '=', user.id),
          eb('demos.service_engineer_id', '=', user.id),
        ]),
      );
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

    if (query.status && except !== 'status') {
      const statuses = query.status.split(',').map((st) => st.trim()).filter(Boolean);
      const unknown = statuses.filter((st) => !DEMO_STATUS_VALUES.includes(st as DemoStatus));
      if (unknown.length) throw new BadRequestException(`Unknown demo status: ${unknown.join(', ')}`);
      if (statuses.length) baseQuery = baseQuery.where('demos.status', 'in', statuses as DemoStatus[]);
    }

    // Id filters, incl. the cross-module lookups: demos for a lead, a tender, or the demo a service ticket came from.
    for (const [param, column] of [
      ['assigned_to', 'demos.assigned_to'],
      ['requested_by', 'demos.requested_by'],
      ['organisation_id', 'demos.organisation_id'],
      ['product_id', 'demos.product_id'],
      ['lead_id', 'demos.lead_id'],
      ['tender_id', 'demos.tender_id'],
      ['service_ticket_id', 'demos.service_ticket_id'],
    ] as const) {
      const value = query[param];
      if (!value) continue;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new BadRequestException(`${param} must be a valid UUID`);
      }
      baseQuery = baseQuery.where(column, '=', value);
    }

    if (query.location && except !== 'location') {
      baseQuery = baseQuery.where('demos.location', '=', query.location);
    }

    // The demo's day is its confirmed date, else the requested one: DATE columns, so both bounds are whole IST
    // calendar days and inclusive (a demo on the "to" day is in range).
    for (const [param, op] of [['date_from', '>='], ['date_to', '<=']] as const) {
      if (!query[param]) continue;
      const day = calendarDay(query[param]);
      if (!day) throw new BadRequestException(`${param} must be a date (YYYY-MM-DD)`);
      baseQuery = baseQuery.where(sql<boolean>`coalesce(demos.confirmed_date, demos.requested_date) ${sql.raw(op)} ${day}::date`);
    }

    if ((query.result || query.failure_reason) && except !== 'outcome') {
      baseQuery = baseQuery.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('demo_outcomes')
            .select('demo_outcomes.id')
            .whereRef('demo_outcomes.demo_id', '=', 'demos.id')
            .$if(Boolean(query.result), (qb) => qb.where('demo_outcomes.result', '=', query.result!))
            .$if(Boolean(query.failure_reason), (qb) => qb.where('demo_outcomes.failure_reason', '=', query.failure_reason!)),
        ),
      );
    }

    if (query.search) {
      const s = containsPattern(query.search);
      // sql.ref quotes the camelCase aliases ("requestedUser"); unquoted, Postgres folds them and the query fails.
      const columns = ['demos.demo_no', 'organisations.name', 'demos.location', 'products.name', 'requestedUser.full_name', 'assignee.full_name'];
      baseQuery = baseQuery.where((eb) => eb.or(columns.map((c) => sql<boolean>`lower(${sql.ref(c)}) like ${s}`)));
    }

    return baseQuery;
  }

  async findAllDemos(query: DemoQueryDto, user: AuthUser): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams({ page: Number(query.page), limit: Number(query.limit) });

    const baseQuery = this.demoScope(query, user)
      .leftJoin('users as serviceEngineer', 'demos.service_engineer_id', 'serviceEngineer.id')
      .leftJoin('service_tickets', 'demos.service_ticket_id', 'service_tickets.id')
      .leftJoin('visits', 'demos.visit_id', 'visits.id')
      .leftJoin('tenders', 'demos.tender_id', 'tenders.id');

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
        'demos.service_escort_required',
        'demos.service_engineer_id',
        'demos.service_ticket_id',
        'demos.created_at',
        'demos.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'requestedUser.full_name as requested_by_name',
        'assignee.full_name as assignee_name',
        'serviceEngineer.full_name as service_engineer_name',
        'service_tickets.ticket_no as service_ticket_no',
        'visits.planned_date as visit_planned_date',
        'visits.status as visit_status',
        'demos.tender_id',
        'demos.deal_value',
        sql<string>`coalesce(tenders.tender_number, tenders.tender_no)`.as('tender_no'),
      ])
      .orderBy(sql`coalesce(demos.confirmed_date, demos.requested_date)`, 'desc')
      .orderBy('demos.created_at', 'desc')
      .orderBy('demos.id')
      .limit(limit)
      .offset(offset)
      .execute();

    const demoIds = demos.map((d) => d.id);
    const reservationsByDemo: Record<string, any[]> = {};
    const outcomesByDemo: Record<string, any> = {};
    // Open tasks on the demo that need manager sign-off: 'pending' once one is handed in, else 'required'
    const taskApprovalByDemo: Record<string, 'required' | 'pending'> = {};

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

      const approvalTasks = await this.db
        .selectFrom('tasks')
        .select(['tasks.demo_id', 'tasks.status'])
        .where('tasks.demo_id', 'in', demoIds)
        .where('tasks.approval_required', '=', true)
        .where('tasks.status', 'not in', ['completed', 'cancelled'])
        .execute();

      for (const t of approvalTasks) {
        if (!t.demo_id) continue;
        if (t.status === 'awaiting_approval') taskApprovalByDemo[t.demo_id] = 'pending';
        else taskApprovalByDemo[t.demo_id] ??= 'required';
      }
    }

    const enhancedDemos = demos.map((d) => ({
      ...d,
      reservations: reservationsByDemo[d.id] || [],
      outcome: outcomesByDemo[d.id] || null,
      task_approval: taskApprovalByDemo[d.id] || null,
    }));

    return buildPaginatedResult(enhancedDemos, total, page, limit);
  }

  /**
   * Counts of the demo register under its current filters, for the page's menus, view counts and KPI cards.
   * `total` applies every filter (it is the list's total). Each breakdown applies every filter except its own
   * dimension, so e.g. the status counts still show every status while one status is selected.
   */
  async getDemoSummary(query: DemoQueryDto, user: AuthUser) {
    const countOf = sql<number>`count(distinct demos.id)::int`;
    const [totalRow, statusRows, locationRows, resultRows] = await Promise.all([
      this.demoScope(query, user).select(countOf.as('count')).executeTakeFirst(),
      this.demoScope(query, user, 'status').select(['demos.status', countOf.as('count')]).groupBy('demos.status').execute(),
      this.demoScope(query, user, 'location')
        .where('demos.location', 'is not', null)
        .where('demos.location', '!=', '')
        .select(['demos.location', countOf.as('count')])
        .groupBy('demos.location')
        .execute(),
      this.demoScope(query, user, 'outcome')
        .innerJoin('demo_outcomes', 'demo_outcomes.demo_id', 'demos.id')
        .where('demo_outcomes.result', 'is not', null)
        .select(['demo_outcomes.result', countOf.as('count')])
        .groupBy('demo_outcomes.result')
        .execute(),
    ]);

    const by_status: Record<string, number> = {};
    for (const r of statusRows) by_status[r.status] = r.count;
    const by_location: Record<string, number> = {};
    for (const r of locationRows) by_location[r.location!] = r.count;
    const by_result: Record<string, number> = { success: 0, fail: 0, partial: 0 };
    for (const r of resultRows) by_result[r.result!] = r.count;
    const sumOf = (statuses: DemoStatus[]) => statuses.reduce((n, st) => n + (by_status[st] || 0), 0);

    return {
      total: totalRow?.count || 0,
      status_total: sumOf(DEMO_STATUS_VALUES),
      by_status,
      by_location,
      by_result,
      pending_requests: sumOf(DEMO_PENDING_STATUSES),
      active_pipeline: sumOf(DEMO_ACTIVE_STATUSES),
    };
  }

  /**
   * Re-derives a unit's availability from its live bookings instead of patching it per action:
   * reserved (until the last day) while an approved reservation of a still-open demo runs today or later,
   * otherwise available. Maintenance / in-use units are left alone — only people move a unit out of those.
   * Every real change is audited against the equipment (§47 "equipment availability changed").
   */
  private async syncEquipmentAvailability(trx: Kysely<Database>, equipmentId: string, actorId: string | null, cause: string) {
    const unit = await trx.selectFrom('demo_equipment').select(['availability_status', 'reserved_until']).where('id', '=', equipmentId).executeTakeFirst();
    if (!unit || unit.availability_status === 'maintenance' || unit.availability_status === 'in_use') return;
    const live = await trx
      .selectFrom('demo_reservations')
      .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
      .select(sql<string | null>`max(coalesce(demo_reservations.reserved_to, demo_reservations.reserved_from))::text`.as('until'))
      .where('demo_reservations.equipment_id', '=', equipmentId)
      .where('demo_reservations.status', '=', 'approved')
      .where(sql<boolean>`coalesce(demos.status, '') not in ('cancelled', 'completed')`)
      .where(sql<boolean>`coalesce(demo_reservations.reserved_to, demo_reservations.reserved_from) >= ${todayInKolkata()}::date`)
      .executeTakeFirst();
    const until = live?.until ? live.until.slice(0, 10) : null;
    const next = { availability_status: until ? 'reserved' : 'available', reserved_until: until };
    const prevUntil = unit.reserved_until ? formatDateOnly(unit.reserved_until) : null;
    if (unit.availability_status === next.availability_status && prevUntil === until) return;
    await trx
      .updateTable('demo_equipment')
      .set({ availability_status: next.availability_status as any, reserved_until: until as any, updated_at: new Date() })
      .where('id', '=', equipmentId)
      .execute();
    this.eventEmitter.emit('audit.log', {
      actorId,
      entityType: 'demo_equipment',
      entityId: equipmentId,
      action: 'availability_changed',
      previousValue: { availability_status: unit.availability_status, reserved_until: prevUntil },
      newValue: { ...next, cause },
    });
  }

  /** Overlapping approved/requested booking of an open demo on this unit (optionally ignoring one reservation). */
  private async findReservationConflict(trx: Kysely<Database>, equipmentId: string, from: string, to: string, excludeReservationId?: string) {
    let q = trx
      .selectFrom('demo_reservations')
      .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
      .leftJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .select(['demo_reservations.id', 'demo_reservations.demo_id', 'demo_reservations.reserved_from', 'demo_reservations.reserved_to', 'demos.demo_no', 'organisations.name as organisation_name'])
      .where('demo_reservations.equipment_id', '=', equipmentId)
      .where('demo_reservations.status', 'in', ['approved', 'requested'])
      .where(sql<boolean>`coalesce(demos.status, '') not in ('cancelled', 'completed')`)
      .where('demo_reservations.reserved_from', '<=', to as any)
      .where(sql<boolean>`coalesce(demo_reservations.reserved_to, demo_reservations.reserved_from) >= ${from}`);
    if (excludeReservationId) q = q.where('demo_reservations.id', '!=', excludeReservationId);
    return q.executeTakeFirst();
  }

  /** 409 for a clash — and tell the people involved (§46 "equipment conflict"). */
  private conflictError(equipment: { id: string; model?: string | null; serial_no?: string | null }, conflict: { demo_id: string; demo_no: string | null; organisation_name: string | null; reserved_from: any; reserved_to: any }, demoId: string, actorId: string) {
    const from = formatDateOnly(conflict.reserved_from);
    const to = formatDateOnly(conflict.reserved_to, from);
    this.eventEmitter.emit(AppEvents.DEMO_EQUIPMENT_CONFLICT, {
      equipmentId: equipment.id,
      equipmentLabel: `${equipment.model || 'Unit'} (${equipment.serial_no || 'no serial'})`,
      requestedForDemoId: demoId,
      conflictingDemoId: conflict.demo_id,
      conflictingDemoNo: conflict.demo_no,
      from,
      to,
      actorId,
    });
    return new ConflictException({
      code: 'EQUIPMENT_ALREADY_RESERVED',
      message: `Equipment unit ${equipment.model || ''} (${equipment.serial_no || 'Unit'}) is already booked from ${dmy(from)} to ${dmy(to)} for Demo ${conflict.demo_no || ''} (${conflict.organisation_name || 'Client'}).`,
      conflicting_reservation: conflict,
    });
  }

  /**
   * Row-level access for a single demo — the same visibility findAllDemos applies to the list
   * (sales: own requests; service team: assigned to them; regional manager: their zone/region or own).
   * Unknown and out-of-scope demos both answer 404 so ids cannot be probed.
   */
  private async assertDemoAccess(demoId: string, user: AuthUser) {
    const row = await this.db
      .selectFrom('demos')
      .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .select(['demos.requested_by', 'demos.assigned_to', 'demos.service_engineer_id', 'organisations.zone_id', 'organisations.region_id'])
      .where('demos.id', '=', demoId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Demo not found');
    let allowed = true;
    if (user.role === 'sales') allowed = row.requested_by === user.id;
    else if (user.role === 'service_team') allowed = row.assigned_to === user.id || row.service_engineer_id === user.id;
    else if (user.role === 'regional_manager') {
      if (user.zone_id) allowed = row.zone_id === user.zone_id || row.requested_by === user.id;
      else if (user.region_id) allowed = row.region_id === user.region_id || row.requested_by === user.id;
    }
    if (!allowed) throw new NotFoundException('Demo not found');
  }

  /**
   * Row-level access for a custodian action on a reservation: the unit's responsible person may always act on it
   * (§16, they approve their own kit); anyone else needs access to the demo the reservation belongs to.
   */
  private async assertReservationAccess(reservationId: string, user: AuthUser) {
    const row = await this.db
      .selectFrom('demo_reservations')
      .innerJoin('demo_equipment', 'demo_reservations.equipment_id', 'demo_equipment.id')
      .select(['demo_reservations.demo_id', 'demo_equipment.responsible_person'])
      .where('demo_reservations.id', '=', reservationId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Reservation not found');
    if (row.responsible_person && row.responsible_person === user.id) return;
    await this.assertDemoAccess(row.demo_id, user);
  }

  /** §11: another open demo the specialist already carries on that day (confirmed day, else requested day). */
  private async findTeamConflict(trx: Kysely<Database>, assignedTo: string, day: string, excludeDemoId?: string) {
    let q = trx
      .selectFrom('demos')
      .where('assigned_to', '=', assignedTo)
      .where('status', 'not in', ['cancelled', 'completed'])
      .where((eb) =>
        eb.or([
          eb('confirmed_date', '=', day),
          eb.and([eb('confirmed_date', 'is', null), eb('requested_date', '=', day)]),
        ]),
      )
      .select(['id', 'demo_no', 'location']);
    if (excludeDemoId) q = q.where('id', '!=', excludeDemoId);
    return q.executeTakeFirst();
  }

  async findOneDemo(id: string, user: AuthUser) {
    await this.assertDemoAccess(id, user);
    const demo = await this.db
      .selectFrom('demos')
      .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
      .leftJoin('products', 'demos.product_id', 'products.id')
      .leftJoin('users as requestedUser', 'demos.requested_by', 'requestedUser.id')
      .leftJoin('users as assignee', 'demos.assigned_to', 'assignee.id')
      .leftJoin('users as serviceEngineer', 'demos.service_engineer_id', 'serviceEngineer.id')
      .leftJoin('service_tickets', 'demos.service_ticket_id', 'service_tickets.id')
      .leftJoin('visits', 'demos.visit_id', 'visits.id')
      .leftJoin('tenders', 'demos.tender_id', 'tenders.id')
      .selectAll('demos')
      .select([
        sql<string>`coalesce(tenders.tender_number, tenders.tender_no)`.as('tender_no'),
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        'requestedUser.full_name as requested_by_name',
        'requestedUser.email as requested_by_email',
        'assignee.full_name as assignee_name',
        'assignee.email as assignee_email',
        'serviceEngineer.full_name as service_engineer_name',
        'service_tickets.ticket_no as service_ticket_no',
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
    // A trial is requested for today or later (IST) — same rule as the tour planner.
    dto.requested_date = toDay(dto.requested_date);
    dto.confirmed_date = toDay(dto.confirmed_date);
    dto.travel_date = toDay(dto.travel_date);
    assertNotPastDemoDate(dto.requested_date, 'requested trial date');
    if (dto.confirmed_date) assertNotPastDemoDate(dto.confirmed_date, 'confirmed demo date');

    return this.db.transaction().execute(async (trx) => {
      // 1. Check network retry idempotency: identical request by same user within past 60 seconds. Identical means the
      // same product too (two products for one customer and day are two demos), and a cancelled demo is never returned.
      const sixtySecondsAgo = new Date(Date.now() - 60000);
      const duplicate = await trx
        .selectFrom('demos')
        .where('organisation_id', '=', dto.organisation_id)
        .where('requested_by', '=', user.id)
        .where('requested_date', '=', dto.requested_date)
        .where((eb) => (dto.product_id ? eb('product_id', '=', dto.product_id) : eb('product_id', 'is', null)))
        .where('status', '<>', 'cancelled')
        .where('created_at', '>=', sixtySecondsAgo)
        .selectAll()
        .executeTakeFirst();

      if (duplicate) {
        this.logger.warn(`Idempotent retry detected for demo creation: ${duplicate.demo_no}`);
        // Flag it, so the screen can say the request already exists instead of reporting it as new (QA BUG-023).
        return { ...duplicate, duplicate: true as const };
      }

      // §11: a specialist picked on the request is held to the same no-double-booking rule as assignTeam
      if (dto.assigned_to) {
        const day = dto.confirmed_date || dto.requested_date;
        const conflict = await this.findTeamConflict(trx as any, dto.assigned_to, day);
        if (conflict) {
          throw new ConflictException({
            code: 'TEAM_MEMBER_ALREADY_ASSIGNED',
            message: `Team member is already assigned to Demo ${conflict.demo_no || conflict.id} at ${conflict.location || 'Site'} on ${dmy(day)}. Pick another specialist or leave it for the coordinator.`,
          });
        }
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
          service_escort_required: dto.service_escort_required || false,
          service_engineer_id: dto.service_engineer_id || null,
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

      // If created from a visit, update the visit to link/record demo_required and service escort
      if (dto.visit_id) {
        await trx
          .updateTable('visits')
          .set({
            demo_required: true,
            service_escort_required: dto.service_escort_required || false,
            service_engineer_id: dto.service_engineer_id || null,
          })
          .where('id', '=', dto.visit_id)
          .execute();
      }

      // Fetch org details for notification
      const org = await trx
        .selectFrom('organisations')
        .select(['name', 'region_id', 'zone_id', 'city'])
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

      if (dto.service_escort_required) {
        this.eventEmitter.emit(AppEvents.DEMO_SERVICE_ESCORT_REQUESTED, {
          demoId: demo.id,
          demoNo: demo.demo_no,
          organisationName: org?.name || 'Client',
          location: demo.location,
          requestedDate: demo.requested_date,
          requestedById: user.id,
          requestedByName: user.full_name || 'Salesperson',
          serviceEngineerId: dto.service_engineer_id,
          regionId: org?.region_id,
          zoneId: org?.zone_id,
        });
      }

      return demo;
    });
  }

  async updateDemo(id: string, dto: UpdateDemoDto, user: AuthUser) {
    await this.assertDemoAccess(id, user);
    dto.requested_date = toDay(dto.requested_date);
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
      if (dto.requested_date !== undefined && calendarDay(dto.requested_date) !== calendarDay(demo.requested_date as any)) {
        assertNotPastDemoDate(dto.requested_date, 'requested trial date');
      }
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
    const demoDate = date || todayInKolkata();

    // Fetch team members eligible for demos
    const teamMembers = await this.db
      .selectFrom('users')
      .select(['id', 'full_name', 'email', 'role', 'phone'])
      .where('role', '=', 'demo_team')
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

  /** §14 "Under Planning": a coordinator has reviewed the request and is arranging team, equipment and date. */
  async startPlanning(demoId: string, user: AuthUser) {
    await this.assertDemoAccess(demoId, user);
    const updated = await this.db
      .updateTable('demos')
      .set({ status: 'under_planning', updated_at: new Date(), version: sql`version + 1` })
      .where('id', '=', demoId)
      .where('status', '=', 'requested')
      .returningAll()
      .executeTakeFirst();
    if (!updated) throw new BadRequestException('Only a new request (status Requested) can move to Under Planning.');
    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'demo',
      entityId: demoId,
      action: 'DEMO_PLANNING_STARTED',
      previousValue: { status: 'requested' },
      newValue: { status: 'under_planning' },
    });
    // Management's approval: tell the salesperson, and hand the date over to the demo team
    {
      this.eventEmitter.emit(AppEvents.DEMO_REQUEST_APPROVED, {
        demoId,
        demoNo: updated.demo_no,
        requestedById: updated.requested_by,
        assignedToId: updated.assigned_to,
        approvedByName: user.full_name || 'Management',
      });
    }
    return updated;
  }

  async assignTeam(demoId: string, dto: AssignTeamDto, user: AuthUser) {
    await this.assertDemoAccess(demoId, user);
    dto.confirmed_date = toDay(dto.confirmed_date);
    dto.travel_date = toDay(dto.travel_date);
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

      const targetDate = dto.confirmed_date || calendarDay((demo.confirmed_date || demo.requested_date) as any);

      // §11: Prevent team member double-booking on overlapping active demos
      if (targetDate) {
        const conflict = await this.findTeamConflict(trx as any, dto.assigned_to, targetDate, demoId);

        if (conflict) {
          throw new ConflictException({
            code: 'TEAM_MEMBER_ALREADY_ASSIGNED',
            message: `Team member is already assigned to Demo ${conflict.demo_no || conflict.id} at ${conflict.location || 'Site'} on ${dmy(targetDate)}.`,
          });
        }
      }

      // A request stays 'requested' until management approves it; assigning early is just preparation
      const nextStatus = demo.status === 'under_planning' ? 'team_assigned' : demo.status;

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
    await this.assertDemoAccess(demoId, user);
    // §16: a salesperson *requests* a unit; the unit's responsible person / coordinator approves, rejects,
    // suggests an alternative or allocates another unit. Coordinators and management book directly.
    const isRequest = user.role === 'sales';
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

      const fromDate = toDay(dto.reserved_from) || '';
      const toDate = toDay(dto.reserved_to) || fromDate;

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

      // Product check: a demo of product A is run with a unit of product A. Sending a unit of another product
      // (a substitute) needs a recorded reason, so the trial is never silently set up with the wrong equipment.
      const substituteReason = (dto.product_mismatch_reason || '').trim();
      let productMismatch = false;
      let productNote: string | null = null;
      if (demo.product_id && equipment.product_id && equipment.product_id !== demo.product_id) {
        const names = await trx
          .selectFrom('products')
          .select(['id', 'name'])
          .where('id', 'in', [demo.product_id, equipment.product_id])
          .execute();
        const nameOf = (id: string) => names.find((p) => p.id === id)?.name || 'another product';
        const unitLabel = `${equipment.model || 'Unit'} (${equipment.serial_no || 'no serial'})`;
        if (substituteReason.length < 5) {
          throw new BadRequestException({
            code: 'PRODUCT_MISMATCH',
            message: `${unitLabel} is a ${nameOf(equipment.product_id)} unit, but this demo is for ${nameOf(demo.product_id)}. Reserve a ${nameOf(demo.product_id)} unit, or give a reason (at least 5 characters) for sending a substitute.`,
          });
        }
        productMismatch = true;
        productNote = `Substitute unit: ${nameOf(equipment.product_id)} sent for a ${nameOf(demo.product_id)} demo. Reason: ${substituteReason}`;
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
          this.conflictError(equipment, conflict, demoId, user.id); // notifies the people involved (§46)
          throw new ConflictException({
            code: 'EQUIPMENT_ALREADY_RESERVED',
            message: `Equipment unit ${equipment.model} (${equipment.serial_no || 'Unit'}) is already reserved from ${dmy(confFrom)} to ${dmy(confTo)} for Demo ${conflict.demo_no || ''} (${conflict.organisation_name || 'Client'}).`,
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

      // (No blanket "reserved until" check: the overlap check above is exact, so a free window before a later booking stays bookable.)

      // 4. Create reservation
      const reservation = await trx
        .insertInto('demo_reservations')
        .values({
          demo_id: demoId,
          equipment_id: dto.equipment_id,
          reserved_from: fromDate,
          reserved_to: toDate,
          status: isRequest ? 'requested' : 'approved',
          approved_by: isRequest ? null : user.id,
          remarks: [dto.remarks?.trim(), productNote].filter(Boolean).join(' | ') || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 5. A booked unit shows as reserved; a request leaves it as is until approved.
      await this.syncEquipmentAvailability(trx as any, dto.equipment_id, user.id, `reserved for demo ${demo.demo_no}`);

      // 6. Update demo status
      // Only an approved request (under planning) advances; before management approval the booking is preparation
      const nextStatus = !isRequest && demo.status === 'under_planning'
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
        newValue: {
          ...reservation,
          location_mismatch: locationMismatch,
          product_mismatch: productMismatch,
          ...(productMismatch ? { product_mismatch_reason: substituteReason } : {}),
        },
      });

      // Notification
      if (isRequest) {
        this.eventEmitter.emit(AppEvents.DEMO_EQUIPMENT_REQUESTED, {
          demoId,
          demoNo: demo.demo_no,
          reservationId: reservation.id,
          equipmentLabel: `${equipment.model || 'Demo Unit'} (${equipment.serial_no || 'no serial'})`,
          responsiblePersonId: equipment.responsible_person || null,
          requestedById: user.id,
          from: fromDate,
          to: toDate,
        });
      } else {
        this.eventEmitter.emit(AppEvents.DEMO_EQUIPMENT_RESERVED, {
          demoId,
          demoNo: demo.demo_no,
          equipmentModel: equipment.model || 'Demo Unit',
          serialNo: equipment.serial_no,
          salespersonId: demo.requested_by,
          assignedToId: demo.assigned_to,
        });
      }

      return {
        ...reservation,
        location_mismatch: locationMismatch,
        product_mismatch: productMismatch,
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
    await this.assertReservationAccess(reservationId, user);
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
    await this.assertReservationAccess(reservationId, user);
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
      if (!['requested', 'alternative_suggested'].includes(reservation.status as string)) {
        throw new BadRequestException(`Only a pending request can be approved (this one is ${reservation.status}).`);
      }

      const equipment = await trx.selectFrom('demo_equipment').selectAll().where('id', '=', reservation.equipment_id).forUpdate().executeTakeFirstOrThrow();
      if (equipment.availability_status === 'maintenance') {
        throw new BadRequestException('Equipment is under maintenance — allocate another unit instead.');
      }
      const from = formatDateOnly(reservation.reserved_from);
      const clash = await this.findReservationConflict(trx as any, reservation.equipment_id, from, formatDateOnly(reservation.reserved_to, from), reservationId);
      if (clash) throw this.conflictError(equipment, clash, reservation.demo_id, user.id);

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

      await this.syncEquipmentAvailability(trx as any, reservation.equipment_id, user.id, 'reservation approved');

      // An approved kit advances only an approved demo (Under Planning). Before management approval the booking is
      // preparation and the demo stays Requested, as when the coordinator books a unit directly (reserveEquipment).
      await trx
        .updateTable('demos')
        .set({
          status: 'equipment_reserved',
          updated_at: new Date(),
          version: sql`version + 1`,
        })
        .where('id', '=', reservation.demo_id)
        .where('status', '=', 'under_planning')
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
    await this.assertReservationAccess(reservationId, user);
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

      await this.syncEquipmentAvailability(trx as any, reservation.equipment_id, user.id, 'reservation rejected');

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
    await this.assertReservationAccess(reservationId, user);
    dto.reserved_from = toDay(dto.reserved_from);
    dto.reserved_to = toDay(dto.reserved_to);
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
      if (['cancelled', 'rejected'].includes(reservation.status as string)) {
        throw new BadRequestException(`This reservation is ${reservation.status}; raise a new request instead.`);
      }
      if (newUnit.availability_status === 'maintenance') {
        throw new BadRequestException('The selected unit is under maintenance.');
      }

      const oldEquipId = reservation.equipment_id;
      const reservedFrom = dto.reserved_from || reservation.reserved_from;
      const reservedTo = dto.reserved_to || reservation.reserved_to;
      const fromStr = formatDateOnly(reservedFrom);
      const clash = await this.findReservationConflict(trx as any, dto.equipment_id, fromStr, formatDateOnly(reservedTo, fromStr), reservationId);
      if (clash) throw this.conflictError(newUnit, clash, reservation.demo_id, user.id);

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

      await this.syncEquipmentAvailability(trx as any, dto.equipment_id, user.id, 'unit allocated');
      if (oldEquipId !== dto.equipment_id) await this.syncEquipmentAvailability(trx as any, oldEquipId, user.id, 'replaced by another unit');

      // Same rule as approveReservation: only an approved demo (Under Planning) moves to Equipment Reserved
      await trx
        .updateTable('demos')
        .set({
          status: 'equipment_reserved',
          updated_at: new Date(),
          version: sql`version + 1`,
        })
        .where('id', '=', reservation.demo_id)
        .where('status', '=', 'under_planning')
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
    await this.assertDemoAccess(demoId, user);
    dto.confirmed_date = toDay(dto.confirmed_date);
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
      if (demo.status === 'requested') {
        throw new BadRequestException('Management has not approved this demo request yet. The date can be confirmed once it is approved.');
      }

      const confirmedDay = calendarDay(dto.confirmed_date) || '';
      assertNotPastDemoDate(confirmedDay, 'confirmed demo date');

      // The equipment held for this demo must be reserved on the demo day. If the confirmed date falls outside a
      // reservation, either block (default) or — when the coordinator asks — extend that reservation to cover it,
      // provided no other demo holds the unit on the added days.
      const activeReservations = await trx
        .selectFrom('demo_reservations')
        .innerJoin('demo_equipment', 'demo_reservations.equipment_id', 'demo_equipment.id')
        .select([
          'demo_reservations.id',
          'demo_reservations.equipment_id',
          'demo_reservations.reserved_from',
          'demo_reservations.reserved_to',
          'demo_equipment.model',
          'demo_equipment.serial_no',
        ])
        .where('demo_reservations.demo_id', '=', demoId)
        .where('demo_reservations.status', 'in', ['approved', 'requested'])
        .execute();

      const uncovered = activeReservations
        .map((r) => {
          const from = calendarDay(r.reserved_from as any) || '';
          const to = calendarDay((r.reserved_to || r.reserved_from) as any) || from;
          return { ...r, from, to };
        })
        .filter((r) => confirmedDay < r.from || confirmedDay > r.to);

      if (uncovered.length > 0 && !dto.extend_reservation) {
        const held = uncovered
          .map((r) => `${r.model || 'Unit'} (${r.serial_no || 'no serial'}) is reserved ${dmy(r.from)} – ${dmy(r.to)}`)
          .join('; ');
        throw new BadRequestException({
          code: 'DATE_OUTSIDE_RESERVATION',
          message: `${dmy(confirmedDay)} is outside the equipment reservation: ${held}. Pick a date inside the reservation, or extend the reservation to cover ${dmy(confirmedDay)}.`,
          reservations: uncovered.map((r) => ({
            id: r.id,
            equipment_id: r.equipment_id,
            model: r.model,
            serial_no: r.serial_no,
            reserved_from: r.from,
            reserved_to: r.to,
          })),
        });
      }

      for (const r of uncovered) {
        const newFrom = confirmedDay < r.from ? confirmedDay : r.from;
        const newTo = confirmedDay > r.to ? confirmedDay : r.to;
        const clash = await trx
          .selectFrom('demo_reservations')
          .innerJoin('demos', 'demo_reservations.demo_id', 'demos.id')
          .select(['demo_reservations.reserved_from', 'demo_reservations.reserved_to', 'demos.demo_no'])
          .where('demo_reservations.equipment_id', '=', r.equipment_id)
          .where('demo_reservations.demo_id', '!=', demoId)
          .where('demo_reservations.status', 'in', ['approved', 'requested'])
          .where(sql<boolean>`coalesce(demos.status, '') not in ('cancelled', 'completed')`)
          .where('demo_reservations.reserved_from', '<=', newTo)
          .where(sql<boolean>`coalesce(demo_reservations.reserved_to, demo_reservations.reserved_from) >= ${newFrom}`)
          .executeTakeFirst();
        if (clash) {
          throw new ConflictException({
            code: 'EQUIPMENT_ALREADY_RESERVED',
            message: `The reservation of ${r.model || 'Unit'} (${r.serial_no || 'no serial'}) cannot be extended to ${dmy(confirmedDay)}: Demo ${clash.demo_no || ''} holds the unit from ${dmy(clash.reserved_from)} to ${dmy(clash.reserved_to || clash.reserved_from)}. Reserve another unit or pick another date.`,
          });
        }
        await trx
          .updateTable('demo_reservations')
          .set({ reserved_from: newFrom, reserved_to: newTo, updated_at: new Date() })
          .where('id', '=', r.id)
          .execute();
        await trx
          .updateTable('demo_equipment')
          .set({ reserved_until: sql`greatest(coalesce(reserved_until, ${newTo}::date), ${newTo}::date)` as any })
          .where('id', '=', r.equipment_id)
          .execute();
        this.eventEmitter.emit('audit.log', {
          actorId: user.id,
          entityType: 'demo_reservation',
          entityId: r.id,
          action: 'RESERVATION_EXTENDED_FOR_CONFIRMED_DATE',
          previousValue: { reserved_from: r.from, reserved_to: r.to },
          newValue: { reserved_from: newFrom, reserved_to: newTo, demo_id: demoId },
        });
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
    await this.assertDemoAccess(demoId, user);
    dto.new_date = toDay(dto.new_date);
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
      // §14: a new request moves on only through management approval (Requested -> Under Planning). Rescheduling it
      // would put it in the date-confirmation queue without that approval.
      if (demo.status === 'requested') {
        throw new BadRequestException({
          code: 'DEMO_NOT_APPROVED',
          message: 'Management has not approved this demo request yet. It can be rescheduled once it is approved.',
        });
      }

      assertNotPastDemoDate(dto.new_date, 'new demo date');

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
            message: `Assigned team member has a conflicting demo (${teamConflict.demo_no || ''}) on ${dmy(dto.new_date)}. Please reassign or select an alternate date.`,
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

      // Each booking moves with the demo and keeps its length (a 3-day loan stays 3 days), anchored on its first day.
      const shiftDays = (iso: string, days: number) => {
        const d = new Date(`${iso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
      for (const res of reservations) {
        const from = formatDateOnly(res.reserved_from);
        const to = formatDateOnly(res.reserved_to, from);
        const newFrom = dto.new_date;
        const newTo = shiftDays(newFrom, Math.max(0, dayDiff(from, to)));

        const clash = await this.findReservationConflict(trx as any, res.equipment_id, newFrom, newTo, res.id);
        if (clash && clash.demo_id !== demoId) {
          const equipment = await trx.selectFrom('demo_equipment').select(['id', 'model', 'serial_no']).where('id', '=', res.equipment_id).executeTakeFirstOrThrow();
          this.conflictError(equipment, clash, demoId, user.id); // notifies (§46)
          throw new ConflictException({
            code: 'EQUIPMENT_CONFLICT_ON_RESCHEDULE',
            message: `Reserved equipment is already booked from ${dmy(newFrom)} to ${dmy(newTo)} by Demo ${clash.demo_no || ''}. Please release/replace unit before rescheduling.`,
          });
        }

        await trx
          .updateTable('demo_reservations')
          .set({
            reserved_from: newFrom,
            reserved_to: newTo,
            updated_at: new Date(),
          })
          .where('id', '=', res.id)
          .execute();

        await this.syncEquipmentAvailability(trx as any, res.equipment_id, user.id, `demo ${demo.demo_no} rescheduled`);
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
    await this.assertDemoAccess(demoId, user);
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
      // A second cancel would overwrite the recorded reason and log the cancellation twice
      if (demo.status === 'cancelled') {
        throw new BadRequestException('This demo is already cancelled.');
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

      // Units go back to available only if no other demo still holds them (and never out of maintenance).
      for (const equipmentId of new Set(reservations.map((r) => r.equipment_id))) {
        await this.syncEquipmentAvailability(trx as any, equipmentId, user.id, `demo ${demo.demo_no} cancelled`);
      }

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
    await this.assertDemoAccess(demoId, user);
    // A failure reason belongs to a failed trial only: never let it leak into a success / partial outcome's
    // customer timeline, activity log or events.
    if (dto.result !== 'fail') dto.failure_reason = undefined;
    // Failure reason is strictly REQUIRED if demo result is 'fail'
    if (dto.result === 'fail' && !dto.failure_reason) {
      throw new BadRequestException({
        code: 'MISSING_FAILURE_REASON',
        message: 'A structured failure reason is required when demo result is unsuccessful.',
      });
    }
    // ...and so is a description of what went wrong: it feeds the failure analysis and, for a technical failure,
    // becomes the complaint on the auto-created service ticket.
    const failureDescription = [dto.technical_performance?.trim(), dto.remarks?.trim()].filter(Boolean).join(' | ');
    if (dto.result === 'fail' && !failureDescription) {
      throw new BadRequestException({
        code: 'MISSING_FAILURE_DESCRIPTION',
        message: 'Describe what went wrong in the trial (technical performance or remarks) when the demo was unsuccessful.',
      });
    }

    let createdTicket: any = null;
    const outcomeResult = await this.db.transaction().execute(async (trx) => {
      const demo = await trx
        .selectFrom('demos')
        .innerJoin('organisations', 'demos.organisation_id', 'organisations.id')
        .selectAll('demos')
        .select([
          'organisations.name as organisation_name',
          'organisations.region_id as org_region_id',
          'organisations.zone_id as org_zone_id',
          'organisations.city as org_city',
        ])
        .where('demos.id', '=', demoId)
        .forUpdate()
        .executeTakeFirst();

      if (!demo) {
        throw new NotFoundException('Demo not found');
      }

      if (demo.status === 'cancelled') {
        throw new BadRequestException('Cannot submit outcome for a cancelled demo.');
      }

      // A completed demo's outcome is final: a second submission would rewrite the result behind the analytics
      if (demo.status === 'completed') {
        throw new ConflictException({
          code: 'OUTCOME_LOCKED',
          message: 'This demo is completed and its outcome is locked.',
        });
      }

      // An outcome follows the agreed trial: approved by management and its date confirmed with the client first.
      // (A "did not happen" outcome keeps the demo Confirmed, so it can be replaced once the trial takes place.)
      if (demo.status !== 'confirmed') {
        throw new BadRequestException({
          code: 'DEMO_NOT_CONFIRMED',
          message: `Confirm the demo date before recording its outcome (this demo is still "${demo.status.replace(/_/g, ' ')}").`,
        });
      }

      // An outcome describes a trial that has happened: only on or after the (confirmed) demo day, IST.
      const demoDay = calendarDay((demo.confirmed_date || demo.requested_date) as any) || '';
      if (demoDay && demoDay > todayInKolkata()) {
        throw new BadRequestException({
          code: 'OUTCOME_BEFORE_DEMO_DATE',
          message: `This demo is scheduled for ${dmy(demoDay)}. Its outcome can only be recorded on or after that date.`,
        });
      }

      // Check if outcome already exists (idempotent / prevent duplicate)
      const existingOutcome = await trx
        .selectFrom('demo_outcomes')
        .selectAll()
        .where('demo_id', '=', demoId)
        .executeTakeFirst();

      // Check if this demo outcome is a TECHNICAL_FAILURE
      let autoServiceTicket: any = null;
      if (dto.result === 'fail' && dto.failure_reason === 'TECHNICAL_FAILURE') {
        // Query reserved equipment to attach serial numbers & product info
        const reservedUnits = await trx
          .selectFrom('demo_reservations')
          .innerJoin('demo_equipment', 'demo_reservations.equipment_id', 'demo_equipment.id')
          .selectAll('demo_equipment')
          .where('demo_reservations.demo_id', '=', demoId)
          .where('demo_reservations.status', '=', 'approved')
          .execute();

        const primaryUnit = reservedUnits[0] || null;
        const productId = demo.product_id || primaryUnit?.product_id || null;
        const serialNo = primaryUnit?.serial_no || null;
        // The ticket carries what failed, as described by the demo team (never the outcome form's success text).
        const complaintText = `Live trial technical failure during demo ${demo.demo_no} at ${demo.organisation_name || 'customer site'}: ${failureDescription}`;

        // one shared ticket factory: collision-free numbering, SLA from sla_rules, repeat detection, history
        const created = await this.serviceService.createTicketCore(trx, {
          organisationId: demo.organisation_id,
          productId,
          serial: serialNo,
          location: demo.location || demo.org_city || null,
          complaint: complaintText,
          source: 'Demo Team',
          problemCategory: 'Breakdown',
          priority: 'high',
          warranty: 'in_warranty',
          isChargeable: false,
          assignedTo: demo.service_engineer_id || null,
          regionId: demo.org_region_id || null,
          actorId: user.id,
          initialReason: `Auto-created from failed demo ${demo.demo_no}`,
        });
        autoServiceTicket = created.ticket;
        const ticketNo = created.ticket.ticket_no || created.ticket.ticket_number;

        // Put the units used in this trial into MAINTENANCE status
        for (const unit of reservedUnits) {
          await trx
            .updateTable('demo_equipment')
            .set({
              availability_status: 'maintenance',
              condition: 'Field Breakdown (Demo Failure)',
              remarks: `Quarantined after live trial failure on demo ${demo.demo_no}. Service ticket ${ticketNo} logged.`,
              reserved_until: null,
            })
            .where('id', '=', unit.id)
            .execute();
          this.eventEmitter.emit('audit.log', {
            actorId: user.id,
            entityType: 'demo_equipment',
            entityId: unit.id,
            action: 'availability_changed',
            previousValue: { availability_status: unit.availability_status, reserved_until: unit.reserved_until },
            newValue: { availability_status: 'maintenance', reserved_until: null, cause: `technical failure on demo ${demo.demo_no} (ticket ${ticketNo})` },
          });
        }
      }

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
            service_ticket_id: autoServiceTicket?.id || (existingOutcome as any).service_ticket_id || null,
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
            service_ticket_id: autoServiceTicket?.id || null,
            remarks: dto.remarks || null,
            submitted_by: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      // 1. Mark demo completed (only when it actually took place) and link service ticket if created.
      // A "did not happen" outcome is recorded but leaves the demo open to be rescheduled or cancelled.
      const tookPlace = dto.completed !== false;
      await trx
        .updateTable('demos')
        .set({
          status: tookPlace ? 'completed' : demo.status,
          service_ticket_id: autoServiceTicket?.id || demo.service_ticket_id || null,
          updated_at: new Date(),
          version: demo.version + 1,
        })
        .where('id', '=', demoId)
        .execute();

      // 2. Free this demo's units once it is done (units quarantined above stay in maintenance).
      if (tookPlace) {
        const booked = await trx.selectFrom('demo_reservations').select('equipment_id').where('demo_id', '=', demoId).where('status', '=', 'approved').execute();
        for (const equipmentId of new Set(booked.map((r) => r.equipment_id))) {
          await this.syncEquipmentAvailability(trx as any, equipmentId, user.id, `demo ${demo.demo_no} completed`);
        }
      }

      // 3. Customer timeline interaction (§20: idempotent using demo_id unique constraint)
      const occurredDate = demo.confirmed_date || demo.requested_date || todayInKolkata();
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

      if (autoServiceTicket) {
        this.eventEmitter.emit(AppEvents.DEMO_TECHNICAL_FAILURE, {
          demoId,
          demoNo: demo.demo_no,
          organisationName: demo.organisation_name,
          location: demo.location,
          ticketId: autoServiceTicket.id,
          ticketNo: autoServiceTicket.ticket_no,
          failureReason: dto.failure_reason || 'TECHNICAL_FAILURE',
          actorId: user.id,
          actorName: user.full_name,
          requestedById: demo.requested_by,
          serviceEngineerId: demo.service_engineer_id,
          regionId: demo.org_region_id,
          zoneId: demo.org_zone_id,
        });
      }

      createdTicket = autoServiceTicket;
      return outcome;
    });

    // side effects only after the failure ticket is committed, so listeners can read it
    if (createdTicket) {
      await this.serviceService.afterCreate(createdTicket, user.id, { source: 'demo_failure' });
    }
    return outcomeResult;
  }

  // =========================================================================
  // 7. MANAGEMENT ANALYTICS (§19)
  // =========================================================================

  async getAnalytics(user: AuthUser, query: DemoQueryDto = {}) {
    // Same scope as the register: RBAC (a regional manager sees their zone or region plus demos they raised) and the
    // page's filters. Outcome breakdowns leave out the outcome filter (they are that dimension); the equipment fleet
    // is shared stock, so it stays company-wide.
    const inScope = (column: string, except?: DemoFilterDimension) =>
      sql<boolean>`${sql.ref(column)} in (${this.demoScope(query, user, except).select('demos.id')})`;

    // Status and outcome counts are the register's own summary, so these KPIs match the list and its menus.
    const summary = await this.getDemoSummary(query, user);
    const successful = summary.by_result.success || 0;
    const unsuccessful = summary.by_result.fail || 0;
    const partial = summary.by_result.partial || 0;
    const totalOutcomes = successful + unsuccessful + partial;
    const successRate = totalOutcomes > 0 ? Math.round((successful / totalOutcomes) * 100) : 0;

    // Structured failure reasons breakdown
    const failureBreakdownRows = await this.db
      .selectFrom('demo_outcomes')
      .where(inScope('demo_outcomes.demo_id', 'outcome'))
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
      .where(inScope('demo_outcomes.demo_id', 'outcome'))
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
      .where(inScope('demo_outcomes.demo_id', 'outcome'))
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
      .where(inScope('demo_outcomes.demo_id', 'outcome'))
      .groupBy(['products.name', 'demo_outcomes.failure_reason'])
      .orderBy('fail_count', 'desc')
      .limit(6)
      .execute();

    return {
      overview: {
        total_demos: summary.total,
        completed_demos: summary.by_status.completed || 0,
        cancelled_demos: summary.by_status.cancelled || 0,
        rescheduled_demos: summary.by_status.rescheduled || 0,
        active_pipeline: summary.active_pipeline,
        pending_requests: summary.pending_requests,
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

  async getAuditTrail(demoId: string, user: AuthUser) {
    await this.assertDemoAccess(demoId, user);
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
