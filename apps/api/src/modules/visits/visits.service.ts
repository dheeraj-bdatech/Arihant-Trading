import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { assertRegionScope } from '../../common/utils/scope.util.js';
import { AppEvents } from '../../common/events/event-names.js';
import type { Database, AuthUser, PaginatedResult, VisitStatus } from '@arihant/shared';
import type {
  CreateVisitDto,
  UpdateVisitDto,
  ChangeVisitStatusDto,
  RescheduleVisitDto,
  CancelVisitDto,
  ChangeDestinationDto,
  SubmitVisitUpdateDto,
  ManagerInterventionDto,
  CreateTripDto,
  AddVisitToTripDto,
} from './visits.dto.js';

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // -------------------------------------------------------------
  // HELPER: Calculate Proximity between two locations
  // -------------------------------------------------------------
  calculateProximity(
    loc1: { location?: string; lat?: number | null; lon?: number | null },
    loc2: { location?: string; lat?: number | null; lon?: number | null },
  ): { isNearby: boolean; distanceKm?: number; proximityNote: string } {
    // 1. If GPS coordinates exist for both, use Haversine distance
    if (loc1.lat != null && loc1.lon != null && loc2.lat != null && loc2.lon != null) {
      const R = 6371; // Earth's radius in km
      const dLat = ((loc2.lat - loc1.lat) * Math.PI) / 180;
      const dLon = ((loc2.lon - loc1.lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((loc1.lat * Math.PI) / 180) *
          Math.cos((loc2.lat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = Math.round(R * c * 10) / 10;

      const isNearby = distanceKm <= 35; // Within 35 km is reasonably close
      return {
        isNearby,
        distanceKm,
        proximityNote: isNearby
          ? `Nearby: ${distanceKm} km apart (calculated via GPS coordinates)`
          : `Distant: ${distanceKm} km apart (>35 km threshold)`,
      };
    }

    // 2. Fallback to location string matching
    const s1 = (loc1.location || '').toLowerCase().trim();
    const s2 = (loc2.location || '').toLowerCase().trim();

    if (!s1 || !s2) {
      return {
        isNearby: true,
        proximityNote: 'Proximity could not be precisely calculated (missing location details).',
      };
    }

    // Extract notable words (length >= 3)
    const words1 = s1.split(/[\s,/-]+/).filter((w) => w.length >= 3);
    const words2 = s2.split(/[\s,/-]+/).filter((w) => w.length >= 3);

    const common = words1.filter((w) => words2.includes(w));
    if (common.length > 0) {
      return {
        isNearby: true,
        proximityNote: `Proximity match on "${common.join(', ')}"; exact GPS coordinates not specified.`,
      };
    }

    return {
      isNearby: false,
      proximityNote: `Locations "${loc1.location}" and "${loc2.location}" do not appear in the same area. Proximity could not be precisely calculated without GPS coordinates.`,
    };
  }

  // -------------------------------------------------------------
  // HELPER: Convert "HH:MM" to minutes from midnight
  // -------------------------------------------------------------
  private timeToMinutes(timeStr?: string): number | null {
    if (!timeStr) return null;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) return null;
    return hours * 60 + mins;
  }

  // -------------------------------------------------------------
  // HELPER: Conflict Detection (Time Overlap, Travel Buffer, Duplicate)
  // -------------------------------------------------------------
  async checkConflicts(params: {
    employeeId: string;
    plannedDate: string;
    startTime?: string;
    endTime?: string;
    organisationId?: string;
    excludeVisitId?: string;
  }): Promise<{ hasConflict: boolean; conflicts: string[] }> {
    const conflicts: string[] = [];

    let query = this.db
      .selectFrom('visits')
      .innerJoin('organisations', 'visits.organisation_id', 'organisations.id')
      .leftJoin('users as emp', 'visits.assigned_to', 'emp.id')
      .selectAll('visits')
      .select([
        'organisations.name as organisation_name',
        'emp.full_name as employee_name',
      ])
      .where('visits.assigned_to', '=', params.employeeId)
      .where('visits.planned_date', '=', params.plannedDate)
      .where('visits.status', 'not in', ['cancelled']);

    if (params.excludeVisitId) {
      query = query.where('visits.id', '!=', params.excludeVisitId);
    }

    const dayVisits = await query.execute();

    const newStart = this.timeToMinutes(params.startTime);
    const newEnd = this.timeToMinutes(params.endTime);
    const newHasTimes = newStart != null && newEnd != null;

    for (const v of dayVisits) {
      const vHasTimes = Boolean(v.start_time && v.end_time);
      const staffLabel = (v as any).employee_name ? `Officer ${(v as any).employee_name}` : 'Selected officer';

      // 1. Same organization: strictly reject duplicate visit to same organization on same date
      if (params.organisationId && v.organisation_id === params.organisationId) {
        conflicts.push(`${staffLabel} already has a visit scheduled for ${v.organisation_name} on ${params.plannedDate}.`);
      }

      // 2. Direct Time Overlap Check for the same staff member
      if (newHasTimes && vHasTimes) {
        const vStart = this.timeToMinutes(v.start_time!);
        const vEnd = this.timeToMinutes(v.end_time!);

        if (vStart != null && vEnd != null) {
          // Direct overlap
          if (newStart < vEnd && vStart < newEnd) {
            conflicts.push(
              `Time conflict: ${staffLabel} is already booked for ${v.organisation_name} (${v.start_time} - ${v.end_time}). Please assign another team member or choose an open time slot.`,
            );
          } else if (v.organisation_id !== params.organisationId) {
            // Travel buffer check: minimum 30 minutes buffer between appointments at different locations
            const buffer = 30;
            if (newEnd <= vStart && vStart - newEnd < buffer) {
              conflicts.push(
                `Travel buffer warning: ${staffLabel} has only ${vStart - newEnd} minutes between end of this visit and start of ${v.organisation_name} (${v.start_time}). Minimum ${buffer} mins recommended.`,
              );
            } else if (vEnd <= newStart && newStart - vEnd < buffer) {
              conflicts.push(
                `Travel buffer warning: ${staffLabel} has only ${newStart - vEnd} minutes between end of ${v.organisation_name} (${v.end_time}) and this visit (${params.startTime}). Minimum ${buffer} mins recommended.`,
              );
            }
          }
        }
      }
    }

    return {
      hasConflict: conflicts.some((c) => c.includes('conflict') || c.includes('already has a visit')),
      conflicts,
    };
  }

  // -------------------------------------------------------------
  // HELPER: Permission / Scope Guard
  // -------------------------------------------------------------
  private assertEmployeeAccess(visit: { assigned_to: string | null; region_id?: string | null }, user: AuthUser) {
    if (user.role === 'sales' || user.role === 'demo_team' || user.role === 'service_team') {
      if (visit.assigned_to !== user.id) {
        throw new ForbiddenException('You are not authorized to modify another employee’s field visit.');
      }
    } else if (user.role === 'regional_manager' && visit.region_id) {
      assertRegionScope(user, visit.region_id);
    }
  }

  // -------------------------------------------------------------
  // FIND ALL VISITS (Paginated, Filtered, Role Scoped)
  // -------------------------------------------------------------
  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      assigned_to?: string;
      organisation_id?: string;
      trip_id?: string;
      dateFrom?: string;
      dateTo?: string;
      travel_required?: boolean | string;
      demo_required?: boolean | string;
    },
    user: AuthUser,
  ): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('visits')
      .innerJoin('organisations', 'visits.organisation_id', 'organisations.id')
      .leftJoin('products', 'visits.product_id', 'products.id')
      .leftJoin('contacts', 'visits.contact_id', 'contacts.id')
      .leftJoin('trips', 'visits.trip_id', 'trips.id')
      .leftJoin('users as assignee', 'visits.assigned_to', 'assignee.id')
      .leftJoin('users as planner', 'visits.planned_by', 'planner.id')
      .leftJoin('users as manager', 'visits.assigned_by_manager', 'manager.id')
      .leftJoin('users as serviceEngineer', 'visits.service_engineer_id', 'serviceEngineer.id')
      .leftJoin('demos', 'demos.visit_id', 'visits.id');

    if (user.role === 'sales' || user.role === 'demo_team') {
      baseQuery = baseQuery.where('visits.assigned_to', '=', user.id);
    } else if (user.role === 'service_team') {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb('visits.assigned_to', '=', user.id),
          eb('visits.service_engineer_id', '=', user.id),
        ]),
      );
    } else if (user.role === 'regional_manager') {
      if (user.zone_id) {
        baseQuery = baseQuery.where('organisations.zone_id', '=', user.zone_id);
      } else if (user.region_id) {
        baseQuery = baseQuery.where('organisations.region_id', '=', user.region_id);
      }
    }

    if (query.status) {
      baseQuery = baseQuery.where('visits.status', '=', query.status as any);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('visits.assigned_to', '=', query.assigned_to);
    }

    if (query.organisation_id) {
      baseQuery = baseQuery.where('visits.organisation_id', '=', query.organisation_id);
    }

    if (query.trip_id) {
      baseQuery = baseQuery.where('visits.trip_id', '=', query.trip_id);
    }

    if (query.dateFrom) {
      baseQuery = baseQuery.where('visits.planned_date', '>=', query.dateFrom);
    }

    if (query.dateTo) {
      baseQuery = baseQuery.where('visits.planned_date', '<=', query.dateTo);
    }

    if (query.travel_required !== undefined) {
      const travelVal = String(query.travel_required) === 'true';
      baseQuery = baseQuery.where('visits.travel_required', '=', travelVal);
    }

    if (query.demo_required !== undefined) {
      const demoVal = String(query.demo_required) === 'true';
      baseQuery = baseQuery.where('visits.demo_required', '=', demoVal);
    }

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(organisations.name) like ${s}`,
          sql<boolean>`lower(visits.location) like ${s}`,
          sql<boolean>`lower(visits.purpose) like ${s}`,
          sql<boolean>`lower(assignee.full_name) like ${s}`,
        ]),
      );
    }

    const countRes = await baseQuery
      .select(sql<number>`count(visits.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const visits = await baseQuery
      .select([
        'visits.id',
        'visits.trip_id',
        'visits.organisation_id',
        'visits.contact_id',
        'visits.product_id',
        'visits.planned_by',
        'visits.assigned_to',
        'visits.assigned_by_manager',
        'visits.manager_assigned',
        'visits.location',
        'visits.latitude',
        'visits.longitude',
        'visits.planned_date',
        'visits.start_time',
        'visits.end_time',
        'visits.purpose',
        'visits.demo_required',
        'visits.service_escort_required',
        'visits.service_engineer_id',
        'visits.travel_required',
        'visits.expected_outcome',
        'visits.status',
        'visits.change_reason',
        'visits.rescheduled_from',
        'visits.remarks',
        'visits.version',
        'visits.created_at',
        'visits.updated_at',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'organisations.state as state',
        'organisations.zone_id as zone_id',
        'organisations.region_id',
        'products.name as product_name',
        sql<string | null>`coalesce(contacts.full_name, visits.contact_person)`.as('contact_name'),
        'visits.contact_person',
        'contacts.designation as contact_designation',
        'contacts.mobile as contact_mobile',
        'contacts.email as contact_email',
        'assignee.full_name as assignee_name',
        'serviceEngineer.full_name as service_engineer_name',
        'planner.full_name as planner_name',
        'manager.full_name as manager_name',
        'trips.base_location as trip_base_location',
        'trips.status as trip_status',
        'demos.id as linked_demo_id',
        'demos.demo_no as linked_demo_no',
        'demos.status as linked_demo_status',
      ])
      .orderBy('visits.planned_date', 'desc')
      .orderBy('visits.start_time', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(visits, total, page, limit);
  }

  // -------------------------------------------------------------
  // FIND ONE VISIT
  // -------------------------------------------------------------
  async findOne(id: string, user: AuthUser) {
    if (!id || id === 'undefined' || id === 'null') {
      throw new NotFoundException('Visit not found');
    }

    const visit = await this.db
      .selectFrom('visits')
      .innerJoin('organisations', 'visits.organisation_id', 'organisations.id')
      .leftJoin('products', 'visits.product_id', 'products.id')
      .leftJoin('contacts', 'visits.contact_id', 'contacts.id')
      .leftJoin('trips', 'visits.trip_id', 'trips.id')
      .leftJoin('users as assignee', 'visits.assigned_to', 'assignee.id')
      .leftJoin('users as planner', 'visits.planned_by', 'planner.id')
      .leftJoin('users as manager', 'visits.assigned_by_manager', 'manager.id')
      .leftJoin('users as serviceEngineer', 'visits.service_engineer_id', 'serviceEngineer.id')
      .selectAll('visits')
      .select([
        'organisations.name as organisation_name',
        'organisations.city as city',
        'organisations.state as state',
        'organisations.zone_id as zone_id',
        'organisations.region_id',
        'products.name as product_name',
        sql<string | null>`coalesce(contacts.full_name, visits.contact_person)`.as('contact_name'),
        'visits.contact_person',
        'contacts.designation as contact_designation',
        'contacts.mobile as contact_mobile',
        'contacts.email as contact_email',
        'assignee.full_name as assignee_name',
        'serviceEngineer.full_name as service_engineer_name',
        'planner.full_name as planner_name',
        'manager.full_name as manager_name',
        'trips.base_location as trip_base_location',
        'trips.status as trip_status',
      ])
      .where('visits.id', '=', id)
      .executeTakeFirst();

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (user.role === 'regional_manager' && visit.region_id) {
      assertRegionScope(user, visit.region_id);
    }

    const updates = await this.db
      .selectFrom('visit_updates')
      .leftJoin('users', 'visit_updates.updated_by', 'users.id')
      .selectAll('visit_updates')
      .select('users.full_name as updated_by_name')
      .where('visit_updates.visit_id', '=', id)
      .orderBy('visit_updates.created_at', 'desc')
      .execute();

    const linkedDemo = await this.db
      .selectFrom('demos')
      .select(['id', 'demo_no', 'status', 'requested_date', 'confirmed_date', 'product_id'])
      .where('visit_id', '=', id)
      .executeTakeFirst();

    return {
      ...visit,
      updates,
      linked_demo: linkedDemo || null,
    };
  }

  // -------------------------------------------------------------
  // CREATE VISIT (1-week advance validation, conflict check)
  // -------------------------------------------------------------
  async create(dto: CreateVisitDto, user: AuthUser) {
    // 1. Date validation: do not allow normal visits in the past
    const today = new Date().toISOString().split('T')[0];
    if (dto.planned_date < today) {
      throw new BadRequestException({
        code: 'PAST_DATE_NOT_ALLOWED',
        message: 'Cannot schedule a field visit for a past date.',
      });
    }

    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const assignedTo = dto.assigned_to && UUID_REGEX.test(dto.assigned_to) ? dto.assigned_to : user.id;

    // 2. Conflict check
    const conflictResult = await this.checkConflicts({
      employeeId: assignedTo,
      plannedDate: dto.planned_date,
      startTime: dto.start_time,
      endTime: dto.end_time,
      organisationId: dto.organisation_id,
    });

    if (conflictResult.hasConflict) {
      throw new ConflictException({
        code: 'VISIT_TIME_CONFLICT',
        message: conflictResult.conflicts.join(' '),
      });
    }

    // 3. Organization check (soft/active reference check)
    const org = await this.db
      .selectFrom('organisations')
      .select(['id', 'name', 'city'])
      .where('id', '=', dto.organisation_id)
      .executeTakeFirst();

    if (!org) {
      throw new BadRequestException({
        code: 'INVALID_ORGANISATION',
        message: 'The selected organisation does not exist.',
      });
    }

    // 4. Auto-attach trip if employee has a trip planned for that date and location
    let tripId = dto.trip_id || null;
    if (!tripId) {
      const existingTrip = await this.db
        .selectFrom('trips')
        .select('id')
        .where('employee_id', '=', assignedTo)
        .where('trip_date', '=', dto.planned_date)
        .where('status', 'not in', ['cancelled'])
        .executeTakeFirst();
      if (existingTrip) {
        tripId = existingTrip.id;
      }
    }

    const visit = await this.db
      .insertInto('visits')
      .values({
        organisation_id: dto.organisation_id,
        contact_id: dto.contact_id || null,
        contact_person: dto.contact_person || null,
        product_id: dto.product_id || null,
        planned_by: user.id,
        assigned_to: assignedTo,
        trip_id: tripId,
        location: dto.location || org.city || null,
        latitude: dto.latitude != null ? String(dto.latitude) as any : null,
        longitude: dto.longitude != null ? String(dto.longitude) as any : null,
        planned_date: dto.planned_date,
        start_time: dto.start_time || null,
        end_time: dto.end_time || null,
        purpose: dto.purpose || null,
        demo_required: dto.demo_required || false,
        service_escort_required: dto.service_escort_required || false,
        service_engineer_id: dto.service_engineer_id || null,
        travel_required: dto.travel_required || false,
        expected_outcome: dto.expected_outcome || null,
        status: 'planned',
        manager_assigned: false,
        remarks: dto.remarks || null,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: visit.id,
      action: 'CREATE_VISIT',
      newValue: visit,
    });

    // Auto-create linked demo requisition in Demo Fleet Matrix (Module 3)
    if (dto.demo_required) {
      const demoAssignedTo = dto.demo_assigned_to || assignedTo;
      const demoRecord = await this.db
        .insertInto('demos')
        .values({
          organisation_id: dto.organisation_id,
          product_id: dto.product_id || null,
          visit_id: visit.id,
          requested_by: user.id,
          assigned_to: demoAssignedTo,
          service_escort_required: dto.service_escort_required || false,
          service_engineer_id: dto.service_engineer_id || null,
          location: dto.location || org.city || null,
          requested_date: dto.planned_date,
          purpose: dto.purpose ? `Live demo for: ${dto.purpose}` : 'Field visit live demonstration',
          equipment_required: dto.remarks || null,
          status: 'requested',
          travel_required: dto.travel_required || false,
          travel_to: dto.location || org.city || null,
          travel_date: dto.planned_date,
          version: 1,
        })
        .returning(['id', 'demo_no'])
        .executeTakeFirst()
        .catch((err: any) => {
          this.logger.warn(`Could not auto-create linked demo for visit ${visit.id}: ${err.message}`);
          return null;
        });

      if (demoRecord) {
        this.eventEmitter.emit(AppEvents.DEMO_REQUESTED, {
          demoId: demoRecord.id,
          demoNo: demoRecord.demo_no,
          organisationName: org.name,
          location: dto.location || org.city,
          requestedByName: user.full_name,
        });

        if (dto.service_escort_required) {
          this.eventEmitter.emit(AppEvents.DEMO_SERVICE_ESCORT_REQUESTED, {
            demoId: demoRecord.id,
            demoNo: demoRecord.demo_no,
            organisationName: org.name,
            location: dto.location || org.city,
            requestedDate: dto.planned_date,
            requestedById: user.id,
            requestedByName: user.full_name || 'Salesperson',
            serviceEngineerId: dto.service_engineer_id,
            regionId: (org as any).region_id,
            zoneId: (org as any).zone_id,
          });
        }

        if (demoAssignedTo) {
          this.eventEmitter.emit(AppEvents.DEMO_TEAM_ASSIGNED, {
            demoId: demoRecord.id,
            demoNo: demoRecord.demo_no,
            assignedToId: demoAssignedTo,
            organisationName: org.name,
            demoDate: dto.planned_date,
            location: dto.location || org.city,
          });
        }
      }
    }

    // Auto-create linked outstation tour program in trips if none assigned
    if (dto.travel_required && !tripId) {
      const newTrip = await this.db
        .insertInto('trips')
        .values({
          employee_id: assignedTo,
          trip_date: dto.planned_date,
          base_location: dto.location || org.city || 'Outstation',
          notes: `Outstation field visit to ${org.name} (${dto.location || org.city || ''})`,
          created_by: user.id,
          status: 'planned',
        })
        .returning('id')
        .executeTakeFirst()
        .catch(() => null);

      if (newTrip?.id) {
        await this.db
          .updateTable('visits')
          .set({ trip_id: newTrip.id })
          .where('id', '=', visit.id)
          .execute();
        visit.trip_id = newTrip.id;
      }
    }

    return visit;
  }

  // -------------------------------------------------------------
  // UPDATE VISIT (Optimistic Concurrency via version)
  // -------------------------------------------------------------
  async update(id: string, dto: UpdateVisitDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    this.assertEmployeeAccess(existing, user);

    if (existing.status === 'completed') {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_COMPLETED_VISIT',
        message: 'Completed visits are immutable and cannot be updated.',
      });
    }

    if (dto.version !== undefined && dto.version !== existing.version) {
      throw new ConflictException({
        code: 'CONCURRENT_MODIFICATION',
        message: 'This visit has been modified concurrently by another user. Please refresh and retry.',
      });
    }

    const updatePayload: any = {
      version: existing.version + 1,
    };

    if (dto.organisation_id) updatePayload.organisation_id = dto.organisation_id;
    if (dto.contact_id !== undefined) updatePayload.contact_id = dto.contact_id || null;
    if (dto.contact_person !== undefined) updatePayload.contact_person = dto.contact_person || null;
    if (dto.product_id !== undefined) updatePayload.product_id = dto.product_id || null;
    if (dto.location) updatePayload.location = dto.location;
    if (dto.planned_date) updatePayload.planned_date = dto.planned_date;
    if (dto.start_time !== undefined) updatePayload.start_time = dto.start_time || null;
    if (dto.end_time !== undefined) updatePayload.end_time = dto.end_time || null;
    if (dto.purpose !== undefined) updatePayload.purpose = dto.purpose || null;
    if (dto.demo_required !== undefined) updatePayload.demo_required = dto.demo_required;
    if (dto.travel_required !== undefined) updatePayload.travel_required = dto.travel_required;
    if (dto.expected_outcome !== undefined) updatePayload.expected_outcome = dto.expected_outcome || null;
    if (dto.remarks !== undefined) updatePayload.remarks = dto.remarks || null;
    if (dto.change_reason) {
      updatePayload.change_reason = dto.change_reason;
      updatePayload.status = 'modified';
    }

    const updated = await this.db
      .updateTable('visits')
      .set(updatePayload)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: 'UPDATE_VISIT',
      previousValue: existing,
      newValue: updated,
      reason: dto.change_reason,
    });

    // Notify manager if employee modified significant information
    const userOrg = await this.db.selectFrom('users').select('reporting_manager_id').where('id', '=', existing.assigned_to).executeTakeFirst();
    this.eventEmitter.emit(AppEvents.VISIT_MODIFIED, {
      visitId: id,
      employeeId: existing.assigned_to,
      employeeName: existing.assignee_name,
      organisationName: existing.organisation_name,
      changeDetails: `Updated details (location: ${updated.location}, date: ${updated.planned_date})`,
      reason: dto.change_reason,
      managerId: userOrg?.reporting_manager_id || existing.assigned_by_manager,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // RESCHEDULE VISIT (Requires new date and reason)
  // -------------------------------------------------------------
  async reschedule(id: string, dto: RescheduleVisitDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    this.assertEmployeeAccess(existing, user);

    if (existing.status === 'completed') {
      throw new BadRequestException({
        code: 'CANNOT_RESCHEDULE_COMPLETED_VISIT',
        message: 'A completed visit cannot be rescheduled.',
      });
    }

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException({
        code: 'MISSING_RESCHEDULE_REASON',
        message: 'A reason is strictly required when rescheduling a visit.',
      });
    }

    const today = new Date().toISOString().split('T')[0];
    if (dto.new_date < today) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Rescheduled date must be today or a future date.',
      });
    }

    // Check conflict on new date
    const conflictResult = await this.checkConflicts({
      employeeId: existing.assigned_to,
      plannedDate: dto.new_date,
      startTime: dto.start_time || existing.start_time || undefined,
      endTime: dto.end_time || existing.end_time || undefined,
      organisationId: existing.organisation_id,
      excludeVisitId: id,
    });

    if (conflictResult.hasConflict) {
      throw new ConflictException({
        code: 'VISIT_TIME_CONFLICT',
        message: conflictResult.conflicts.join(' '),
      });
    }

    const existingDateStr = (existing.planned_date as any) instanceof Date
      ? (existing.planned_date as any).toISOString().split('T')[0]
      : String(existing.planned_date).split('T')[0];

    const updated = await this.db
      .updateTable('visits')
      .set({
        status: 'rescheduled',
        rescheduled_from: existingDateStr,
        planned_date: dto.new_date,
        start_time: dto.start_time || existing.start_time || null,
        end_time: dto.end_time || existing.end_time || null,
        change_reason: dto.reason,
        version: existing.version + 1,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: 'RESCHEDULE_VISIT',
      previousValue: { planned_date: existing.planned_date, status: existing.status },
      newValue: { planned_date: updated.planned_date, status: updated.status },
      reason: dto.reason,
    });

    const userRecord = await this.db.selectFrom('users').select('reporting_manager_id').where('id', '=', existing.assigned_to).executeTakeFirst();
    this.eventEmitter.emit(AppEvents.VISIT_RESCHEDULED, {
      visitId: id,
      employeeId: existing.assigned_to,
      employeeName: existing.assignee_name,
      organisationName: existing.organisation_name,
      oldDate: existing.planned_date,
      newDate: dto.new_date,
      reason: dto.reason,
      managerId: userRecord?.reporting_manager_id || existing.assigned_by_manager,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // CANCEL VISIT (Requires reason, prevents completed visit)
  // -------------------------------------------------------------
  async cancel(id: string, dto: CancelVisitDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    this.assertEmployeeAccess(existing, user);

    if (existing.status === 'completed') {
      throw new BadRequestException({
        code: 'CANNOT_CANCEL_COMPLETED_VISIT',
        message: 'A completed visit cannot be cancelled.',
      });
    }

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException({
        code: 'MISSING_CANCELLATION_REASON',
        message: 'A reason is strictly required when cancelling a visit.',
      });
    }

    const updated = await this.db
      .updateTable('visits')
      .set({
        status: 'cancelled',
        change_reason: dto.reason,
        version: existing.version + 1,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: 'CANCEL_VISIT',
      previousValue: { status: existing.status },
      newValue: { status: updated.status },
      reason: dto.reason,
    });

    const userRecord = await this.db.selectFrom('users').select('reporting_manager_id').where('id', '=', existing.assigned_to).executeTakeFirst();
    this.eventEmitter.emit(AppEvents.VISIT_CANCELLED, {
      visitId: id,
      employeeId: existing.assigned_to,
      employeeName: existing.assignee_name,
      organisationName: existing.organisation_name,
      plannedDate: existing.planned_date,
      reason: dto.reason,
      managerId: userRecord?.reporting_manager_id || existing.assigned_by_manager,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // CHANGE DESTINATION (Requires new location + reason)
  // -------------------------------------------------------------
  async changeDestination(id: string, dto: ChangeDestinationDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    this.assertEmployeeAccess(existing, user);

    if (existing.status === 'completed') {
      throw new BadRequestException({
        code: 'CANNOT_MODIFY_COMPLETED_VISIT',
        message: 'A completed visit cannot have its destination changed.',
      });
    }

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException({
        code: 'MISSING_REASON',
        message: 'A reason is strictly required when changing destination.',
      });
    }

    const updated = await this.db
      .updateTable('visits')
      .set({
        location: dto.new_location,
        status: 'modified',
        change_reason: dto.reason,
        version: existing.version + 1,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: 'CHANGE_DESTINATION',
      previousValue: { location: existing.location },
      newValue: { location: updated.location },
      reason: dto.reason,
    });

    const userRecord = await this.db.selectFrom('users').select('reporting_manager_id').where('id', '=', existing.assigned_to).executeTakeFirst();
    this.eventEmitter.emit(AppEvents.VISIT_MODIFIED, {
      visitId: id,
      employeeId: existing.assigned_to,
      employeeName: existing.assignee_name,
      organisationName: existing.organisation_name,
      changeDetails: `Destination changed from "${existing.location}" to "${dto.new_location}"`,
      reason: dto.reason,
      managerId: userRecord?.reporting_manager_id || existing.assigned_by_manager,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // STATUS CHANGE (Legacy endpoint compatibility)
  // -------------------------------------------------------------
  async changeStatus(id: string, dto: ChangeVisitStatusDto, user: AuthUser) {
    if (dto.status === 'rescheduled') {
      return this.reschedule(
        id,
        {
          new_date: dto.rescheduled_to || new Date().toISOString().split('T')[0],
          reason: dto.change_reason || 'Rescheduled by user',
        },
        user,
      );
    }
    if (dto.status === 'cancelled') {
      return this.cancel(id, { reason: dto.change_reason || 'Cancelled by user' }, user);
    }

    const existing = await this.findOne(id, user);
    this.assertEmployeeAccess(existing, user);

    const updated = await this.db
      .updateTable('visits')
      .set({
        status: dto.status,
        change_reason: dto.change_reason || null,
        version: existing.version + 1,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: `STATUS_${dto.status.toUpperCase()}`,
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  // -------------------------------------------------------------
  // MANAGER ALSO-MEET DIRECTIVE (Intervention on existing visit)
  // -------------------------------------------------------------
  async addManagerIntervention(id: string, dto: ManagerInterventionDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    let createdAlsoMeetVisit: any = null;

    if (dto.organisation_id) {
      // Manager is assigning an additional prospect/customer in the same area
      const org = await this.db
        .selectFrom('organisations')
        .select(['id', 'name', 'city'])
        .where('id', '=', dto.organisation_id)
        .executeTakeFirst();

      if (!org) {
        throw new BadRequestException({
          code: 'INVALID_ORGANISATION',
          message: 'Selected additional organisation not found.',
        });
      }

      const targetLocation = dto.location || org.city || existing.location || 'HQ Station';

      await this.db.transaction().execute(async (trx) => {
        let activeTripId = existing.trip_id;

        // If no trip currently exists for this visit, establish one
        if (!activeTripId) {
          const newTrip = await trx
            .insertInto('trips')
            .values({
              employee_id: existing.assigned_to,
              trip_date: existing.planned_date,
              base_location: existing.location || org.city || 'Regional Base',
              status: 'planned',
              notes: `Multi-stop trip initiated by manager intervention: ${existing.organisation_name} + ${org.name}`,
              created_by: user.id,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          activeTripId = newTrip.id;

          // Attach initial visit to this trip
          await trx
            .updateTable('visits')
            .set({
              trip_id: activeTripId,
              remarks: existing.remarks
                ? `${existing.remarks} | Trip Plan Formed with ${org.name}`
                : `Part of multi-stop trip with ${org.name}`,
              version: existing.version + 1,
            })
            .where('id', '=', id)
            .execute();
        }

        // Insert the secondary also-meet visit
        createdAlsoMeetVisit = await trx
          .insertInto('visits')
          .values({
            trip_id: activeTripId,
            organisation_id: dto.organisation_id!,
            contact_id: dto.contact_id || null,
            contact_person: dto.contact_person || null,
            product_id: dto.product_id || null,
            planned_by: user.id,
            assigned_to: existing.assigned_to,
            assigned_by_manager: user.id,
            manager_assigned: true,
            location: targetLocation,
            planned_date: existing.planned_date,
            start_time: dto.start_time || '14:30',
            end_time: dto.end_time || '16:00',
            purpose: dto.purpose || `Manager assigned also-meet visit with ${org.name}`,
            demo_required: false,
            travel_required: false,
            expected_outcome: 'Engage adjacent prospect in same area',
            status: 'planned',
            remarks: `Manager Directive: ${dto.instructions}`,
            version: 1,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      });
    }

    // Update the base visit notes with the manager's directive
    const directiveDetail = dto.contact_person
      ? `Also Meet: ${dto.contact_person} — ${dto.instructions}`
      : dto.instructions;

    const directiveRemarks = `Manager Intervention / Directive: ${directiveDetail}`;

    const updatePayload: any = {
      assigned_by_manager: user.id,
      manager_assigned: true,
      remarks: existing.remarks
        ? `${existing.remarks} | ${directiveRemarks}`
        : directiveRemarks,
      version: existing.version + 1,
    };

    if (dto.contact_person && !existing.contact_person) {
      updatePayload.contact_person = dto.contact_person;
    }

    const updated = await this.db
      .updateTable('visits')
      .set(updatePayload)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit(AppEvents.VISIT_ALSO_MEET, {
      visitId: id,
      employeeId: existing.assigned_to,
      managerName: user.full_name,
      instructions: dto.instructions,
      additionalVisitId: createdAlsoMeetVisit?.id,
    });

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: 'MANAGER_MODIFY_VISIT',
      previousValue: { remarks: existing.remarks },
      newValue: {
        remarks: updated.remarks,
        assigned_by_manager: user.id,
        additionalVisitId: createdAlsoMeetVisit?.id,
      },
      reason: dto.instructions,
    });

    return {
      ...updated,
      additional_visit: createdAlsoMeetVisit,
    };
  }

  // -------------------------------------------------------------
  // POST-VISIT UPDATE (Transaction Safe & Strictly Idempotent)
  // -------------------------------------------------------------
  async submitUpdate(id: string, dto: SubmitVisitUpdateDto, user: AuthUser) {
    const existing = await this.findOne(id, user);

    const isMeetingCompleted = dto.met_completed !== false; // default true

    // 1. Validation rules
    if (isMeetingCompleted) {
      if (!dto.person_met || dto.person_met.trim().length === 0) {
        throw new BadRequestException({
          code: 'MISSING_PERSON_MET',
          message: 'Person met is required for completed visits.',
        });
      }
      if (!dto.discussion || dto.discussion.trim().length === 0) {
        throw new BadRequestException({
          code: 'MISSING_DISCUSSION',
          message: 'Discussion summary is required for completed visits.',
        });
      }
      if (!dto.outcome || dto.outcome.trim().length === 0) {
        throw new BadRequestException({
          code: 'MISSING_OUTCOME',
          message: 'Meeting outcome is required for completed visits.',
        });
      }
    } else {
      // Meeting not completed requires reason
      if (!dto.remarks && !dto.discussion) {
        throw new BadRequestException({
          code: 'MISSING_NOT_COMPLETED_REASON',
          message: 'A reason or remarks is required when a visit was not completed.',
        });
      }
    }

    // Follow-up date validation
    if (dto.followup_date) {
      const visitDateStr = (existing.planned_date as any) instanceof Date
        ? (existing.planned_date as any).toISOString().split('T')[0]
        : String(existing.planned_date).split('T')[0];
      const followupDateStr = dto.followup_date.split('T')[0];

      if (followupDateStr < visitDateStr) {
        throw new BadRequestException({
          code: 'INVALID_FOLLOWUP_DATE',
          message: 'Follow-up date cannot be earlier than the visit date.',
        });
      }
      if (!dto.next_action) {
        throw new BadRequestException({
          code: 'MISSING_NEXT_ACTION',
          message: 'Next action is required when a follow-up date is scheduled.',
        });
      }
    }

    const finalStatus: VisitStatus = isMeetingCompleted ? 'completed' : 'not_completed';

    // 2. Transactional execution: update visit, upsert visit_updates, upsert interaction, upsert employee_activity
    const result = await this.db.transaction().execute(async (trx) => {
      // A. Upsert visit_updates (idempotency key: visit_id)
      const existingUpdate = await trx
        .selectFrom('visit_updates')
        .select('id')
        .where('visit_id', '=', id)
        .executeTakeFirst();

      let updateRecord;
      if (existingUpdate) {
        updateRecord = await trx
          .updateTable('visit_updates')
          .set({
            met_completed: isMeetingCompleted,
            person_met: dto.person_met || null,
            discussion: dto.discussion || dto.remarks || null,
            product_discussed: dto.product_discussed || null,
            outcome: dto.outcome || null,
            opportunity: dto.opportunity || null,
            tender_opportunity: dto.tender_opportunity || null,
            demo_required: dto.demo_required || false,
            next_action: dto.next_action || null,
            followup_date: dto.followup_date || null,
            remarks: dto.remarks || null,
            updated_by: user.id,
          })
          .where('id', '=', existingUpdate.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        updateRecord = await trx
          .insertInto('visit_updates')
          .values({
            visit_id: id,
            met_completed: isMeetingCompleted,
            person_met: dto.person_met || null,
            discussion: dto.discussion || dto.remarks || null,
            product_discussed: dto.product_discussed || null,
            outcome: dto.outcome || null,
            opportunity: dto.opportunity || null,
            tender_opportunity: dto.tender_opportunity || null,
            demo_required: dto.demo_required || false,
            next_action: dto.next_action || null,
            followup_date: dto.followup_date || null,
            remarks: dto.remarks || null,
            updated_by: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      // B. Update visit status
      await trx
        .updateTable('visits')
        .set({
          status: finalStatus,
          version: existing.version + 1,
        })
        .where('id', '=', id)
        .execute();

      // C. Upsert Customer Timeline (interactions) with visit_id idempotency
      const existingInteraction = await trx
        .selectFrom('interactions')
        .select('id')
        .where('visit_id', '=', id)
        .executeTakeFirst();

      if (existingInteraction) {
        await trx
          .updateTable('interactions')
          .set({
            remarks: dto.discussion || dto.remarks || 'Field visit updated',
            outcome: dto.outcome || (isMeetingCompleted ? 'Meeting held' : 'Meeting not completed'),
            next_action: dto.next_action || null,
            followup_date: dto.followup_date || null,
          })
          .where('id', '=', existingInteraction.id)
          .execute();
      } else {
        await trx
          .insertInto('interactions')
          .values({
            organisation_id: existing.organisation_id,
            contact_id: existing.contact_id,
            visit_id: id,
            type: 'visit',
            employee_id: existing.assigned_to,
            occurred_on: existing.planned_date,
            remarks: dto.discussion || dto.remarks || (isMeetingCompleted ? 'Field visit completed' : 'Meeting not completed'),
            outcome: dto.outcome || (isMeetingCompleted ? 'Meeting held' : 'Customer unavailable / deferred'),
            next_action: dto.next_action || null,
            followup_date: dto.followup_date || null,
          })
          .execute();
      }

      // D. Upsert Employee Activity Dossier (employee_activities) with unique constraint
      const existingActivity = await trx
        .selectFrom('employee_activities')
        .select('id')
        .where('employee_id', '=', existing.assigned_to)
        .where('entity_type', '=', 'visit')
        .where('entity_id', '=', id)
        .executeTakeFirst();

      const activityTitle = `Field Visit — ${existing.organisation_name} (${existing.location || 'Site'})`;
      const activityDetails = {
        organisation: existing.organisation_name,
        location: existing.location,
        personMet: dto.person_met,
        productDiscussed: dto.product_discussed,
        discussion: dto.discussion,
        tenderOpportunity: dto.tender_opportunity,
      };

      if (existingActivity) {
        await trx
          .updateTable('employee_activities')
          .set({
            status: finalStatus,
            outcome: dto.outcome || (isMeetingCompleted ? 'Completed' : 'Not completed'),
            next_action: dto.next_action || null,
            followup_date: dto.followup_date || null,
            details: JSON.stringify(activityDetails) as any,
          })
          .where('id', '=', existingActivity.id)
          .execute();
      } else {
        await trx
          .insertInto('employee_activities')
          .values({
            employee_id: existing.assigned_to,
            activity_type: 'field_visit',
            entity_type: 'visit',
            entity_id: id,
            activity_date: existing.planned_date,
            title: activityTitle,
            status: finalStatus,
            outcome: dto.outcome || (isMeetingCompleted ? 'Interested' : 'Deferred'),
            next_action: dto.next_action || null,
            followup_date: dto.followup_date || null,
            details: JSON.stringify(activityDetails) as any,
          })
          .execute();
      }

      return updateRecord;
    });

    // 3. Emit audit log & notification
    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: id,
      action: isMeetingCompleted ? 'COMPLETE_VISIT' : 'MARK_NOT_COMPLETED',
      newValue: result,
      reason: dto.remarks || dto.outcome,
    });

    const userRecord = await this.db.selectFrom('users').select('reporting_manager_id').where('id', '=', existing.assigned_to).executeTakeFirst();
    this.eventEmitter.emit(AppEvents.VISIT_COMPLETED, {
      visitId: id,
      employeeId: existing.assigned_to,
      employeeName: existing.assignee_name,
      organisationName: existing.organisation_name,
      outcome: dto.outcome,
      personMet: dto.person_met,
      managerId: userRecord?.reporting_manager_id || existing.assigned_by_manager,
    });

    return result;
  }

  // -------------------------------------------------------------
  // MANAGER DASHBOARD: Upcoming Field Activity with Groupings
  // (Today, Tomorrow, Next 7 Days, Later)
  // -------------------------------------------------------------
  async getManagerFieldActivity(
    query: {
      assigned_to?: string;
      organisation_id?: string;
      location?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      travel_required?: boolean | string;
      demo_required?: boolean | string;
    },
    user: AuthUser,
  ) {
    const today = new Date().toISOString().split('T')[0];
    const tomorrowDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const next7DaysDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    // Fetch team visits within scope
    let baseQuery = this.db
      .selectFrom('visits')
      .innerJoin('organisations', 'visits.organisation_id', 'organisations.id')
      .leftJoin('products', 'visits.product_id', 'products.id')
      .leftJoin('contacts', 'visits.contact_id', 'contacts.id')
      .leftJoin('trips', 'visits.trip_id', 'trips.id')
      .leftJoin('users as assignee', 'visits.assigned_to', 'assignee.id')
      .leftJoin('users as manager', 'visits.assigned_by_manager', 'manager.id');

    if (user.role === 'regional_manager') {
      if (user.zone_id) {
        baseQuery = baseQuery.where('organisations.zone_id', '=', user.zone_id);
      } else if (user.region_id) {
        baseQuery = baseQuery.where('organisations.region_id', '=', user.region_id);
      }
    } else if (user.role === 'sales') {
      baseQuery = baseQuery.where('visits.assigned_to', '=', user.id);
    }

    if (query.assigned_to) {
      baseQuery = baseQuery.where('visits.assigned_to', '=', query.assigned_to);
    }
    if (query.organisation_id) {
      baseQuery = baseQuery.where('visits.organisation_id', '=', query.organisation_id);
    }
    if (query.location) {
      const loc = `%${query.location.toLowerCase()}%`;
      baseQuery = baseQuery.where(sql<boolean>`lower(visits.location) like ${loc}`);
    }
    if (query.status) {
      baseQuery = baseQuery.where('visits.status', '=', query.status as any);
    }
    if (query.dateFrom) {
      baseQuery = baseQuery.where('visits.planned_date', '>=', query.dateFrom);
    }
    if (query.dateTo) {
      baseQuery = baseQuery.where('visits.planned_date', '<=', query.dateTo);
    }
    if (query.travel_required !== undefined) {
      baseQuery = baseQuery.where('visits.travel_required', '=', String(query.travel_required) === 'true');
    }
    if (query.demo_required !== undefined) {
      baseQuery = baseQuery.where('visits.demo_required', '=', String(query.demo_required) === 'true');
    }

    const allVisits = await baseQuery
      .select([
        'visits.id',
        'visits.trip_id',
        'visits.organisation_id',
        'visits.contact_id',
        'visits.product_id',
        'visits.assigned_to',
        'visits.assigned_by_manager',
        'visits.manager_assigned',
        'visits.location',
        'visits.latitude',
        'visits.longitude',
        'visits.planned_date',
        'visits.start_time',
        'visits.end_time',
        'visits.purpose',
        'visits.demo_required',
        'visits.travel_required',
        'visits.expected_outcome',
        'visits.status',
        'visits.change_reason',
        'visits.remarks',
        'organisations.name as organisation_name',
        'organisations.city as city',
        'products.name as product_name',
        sql<string | null>`coalesce(contacts.full_name, visits.contact_person)`.as('contact_name'),
        'visits.contact_person',
        'assignee.full_name as assignee_name',
        'manager.full_name as manager_name',
        'trips.base_location as trip_base_location',
      ])
      .orderBy('visits.planned_date', 'asc')
      .orderBy('visits.start_time', 'asc')
      .execute();

    // Group visits into Today, Tomorrow, Next 7 Days, Later
    const grouped = {
      today: [] as any[],
      tomorrow: [] as any[],
      next_7_days: [] as any[],
      later: [] as any[],
      past: [] as any[],
    };

    for (const v of allVisits) {
      const vDate = v.planned_date;
      if (vDate === today) {
        grouped.today.push(v);
      } else if (vDate === tomorrowDate) {
        grouped.tomorrow.push(v);
      } else if (vDate > tomorrowDate && vDate <= next7DaysDate) {
        grouped.next_7_days.push(v);
      } else if (vDate > next7DaysDate) {
        grouped.later.push(v);
      } else {
        grouped.past.push(v);
      }
    }

    return {
      summary: {
        total: allVisits.length,
        todayCount: grouped.today.length,
        tomorrowCount: grouped.tomorrow.length,
        next7DaysCount: grouped.next_7_days.length,
        laterCount: grouped.later.length,
      },
      grouped,
    };
  }

  // -------------------------------------------------------------
  // TRIPS: Create Trip
  // -------------------------------------------------------------
  async createTrip(dto: CreateTripDto, user: AuthUser) {
    const employeeId = dto.employee_id || user.id;

    const trip = await this.db
      .insertInto('trips')
      .values({
        employee_id: employeeId,
        trip_date: dto.trip_date,
        base_location: dto.base_location,
        status: 'planned',
        notes: dto.notes || null,
        created_by: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'trip',
      entityId: trip.id,
      action: 'TRIP_CREATED',
      newValue: trip,
    });

    return trip;
  }

  // -------------------------------------------------------------
  // TRIPS: Find All Trips with Nested Visits
  // -------------------------------------------------------------
  async findAllTrips(query: { employee_id?: string; dateFrom?: string; dateTo?: string }, user: AuthUser) {
    let baseQuery = this.db
      .selectFrom('trips')
      .innerJoin('users as emp', 'trips.employee_id', 'emp.id')
      .leftJoin('users as creator', 'trips.created_by', 'creator.id');

    if (user.role === 'sales' || user.role === 'demo_team' || user.role === 'service_team') {
      baseQuery = baseQuery.where('trips.employee_id', '=', user.id);
    } else if (query.employee_id) {
      baseQuery = baseQuery.where('trips.employee_id', '=', query.employee_id);
    }

    if (query.dateFrom) {
      baseQuery = baseQuery.where('trips.trip_date', '>=', query.dateFrom);
    }
    if (query.dateTo) {
      baseQuery = baseQuery.where('trips.trip_date', '<=', query.dateTo);
    }

    const trips = await baseQuery
      .select([
        'trips.id',
        'trips.employee_id',
        'trips.trip_date',
        'trips.base_location',
        'trips.status',
        'trips.notes',
        'trips.created_by',
        'trips.created_at',
        'trips.updated_at',
        'emp.full_name as employee_name',
        'creator.full_name as creator_name',
      ])
      .orderBy('trips.trip_date', 'desc')
      .execute();

    // Fetch visits for each trip
    const tripsWithVisits = await Promise.all(
      trips.map(async (trip) => {
        const visits = await this.db
          .selectFrom('visits')
          .innerJoin('organisations', 'visits.organisation_id', 'organisations.id')
          .leftJoin('products', 'visits.product_id', 'products.id')
          .selectAll('visits')
          .select([
            'organisations.name as organisation_name',
            'products.name as product_name',
          ])
          .where('visits.trip_id', '=', trip.id)
          .orderBy('visits.start_time', 'asc')
          .execute();

        return {
          ...trip,
          visits,
        };
      }),
    );

    return tripsWithVisits;
  }

  // -------------------------------------------------------------
  // TRIPS: Find Single Trip with Visits
  // -------------------------------------------------------------
  async findTripById(id: string, user: AuthUser) {
    const trip = await this.db
      .selectFrom('trips')
      .innerJoin('users as emp', 'trips.employee_id', 'emp.id')
      .leftJoin('users as creator', 'trips.created_by', 'creator.id')
      .selectAll('trips')
      .select([
        'emp.full_name as employee_name',
        'creator.full_name as creator_name',
      ])
      .where('trips.id', '=', id)
      .executeTakeFirst();

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    const visits = await this.db
      .selectFrom('visits')
      .innerJoin('organisations', 'visits.organisation_id', 'organisations.id')
      .leftJoin('products', 'visits.product_id', 'products.id')
      .leftJoin('contacts', 'visits.contact_id', 'contacts.id')
      .selectAll('visits')
      .select([
        'organisations.name as organisation_name',
        'products.name as product_name',
        sql<string | null>`coalesce(contacts.full_name, visits.contact_person)`.as('contact_name'),
        'visits.contact_person',
      ])
      .where('visits.trip_id', '=', id)
      .orderBy('visits.start_time', 'asc')
      .execute();

    return {
      ...trip,
      visits,
    };
  }

  // -------------------------------------------------------------
  // MANAGER INTERVENTION / TRIP OPTIMIZATION:
  // Add another customer visit to an employee's existing trip
  // -------------------------------------------------------------
  async addVisitToTrip(tripId: string, dto: AddVisitToTripDto, user: AuthUser) {
    const trip = await this.db
      .selectFrom('trips')
      .selectAll('trips')
      .where('id', '=', tripId)
      .executeTakeFirst();

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    if (trip.status === 'cancelled') {
      throw new BadRequestException({
        code: 'CANCELLED_TRIP',
        message: 'Cannot add activities to an already cancelled trip.',
      });
    }

    // 1. Check Organisation
    const org = await this.db
      .selectFrom('organisations')
      .select(['id', 'name', 'city'])
      .where('id', '=', dto.organisation_id)
      .executeTakeFirst();

    if (!org) {
      throw new BadRequestException({
        code: 'INVALID_ORGANISATION',
        message: 'Organisation not found.',
      });
    }

    const targetLocation = dto.location || org.city || trip.base_location;

    // 2. Validate Proximity against Trip's base location
    const proximity = this.calculateProximity(
      { location: trip.base_location },
      { location: targetLocation, lat: dto.latitude, lon: dto.longitude },
    );

    // 3. Time Conflict & Travel Buffer check
    const conflictResult = await this.checkConflicts({
      employeeId: trip.employee_id,
      plannedDate: trip.trip_date,
      startTime: dto.start_time,
      endTime: dto.end_time,
      organisationId: dto.organisation_id,
    });

    if (conflictResult.hasConflict) {
      throw new ConflictException({
        code: 'VISIT_TIME_CONFLICT',
        message: conflictResult.conflicts.join(' '),
      });
    }

    // 4. Create the visit attached to this trip with manager attribution
    const remarks = dto.instructions
      ? `Manager Directive: ${dto.instructions}`
      : dto.reason
      ? `Manager Intervention: ${dto.reason}`
      : 'Manager added customer to trip';

    const visit = await this.db
      .insertInto('visits')
      .values({
        trip_id: trip.id,
        organisation_id: dto.organisation_id,
        contact_id: dto.contact_id || null,
        contact_person: dto.contact_person || null,
        product_id: dto.product_id || null,
        planned_by: user.id,
        assigned_to: trip.employee_id,
        assigned_by_manager: user.id,
        manager_assigned: true,
        location: targetLocation,
        latitude: dto.latitude != null ? String(dto.latitude) as any : null,
        longitude: dto.longitude != null ? String(dto.longitude) as any : null,
        planned_date: trip.trip_date,
        start_time: dto.start_time || null,
        end_time: dto.end_time || null,
        purpose: dto.purpose || `Strategic field meeting with ${org.name}`,
        demo_required: false,
        travel_required: true,
        expected_outcome: 'Explore procurement & GeM alignment',
        status: 'planned',
        remarks,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // 5. Audit log
    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'visit',
      entityId: visit.id,
      action: 'MANAGER_ADD_VISIT',
      newValue: {
        tripId: trip.id,
        employeeId: trip.employee_id,
        organisation: org.name,
        instructions: dto.instructions,
        proximity: proximity.proximityNote,
      },
      reason: dto.reason || 'Manager Trip Optimization',
    });

    // 6. Notify Employee
    this.eventEmitter.emit(AppEvents.TRIP_VISIT_ADDED, {
      tripId: trip.id,
      visitId: visit.id,
      employeeId: trip.employee_id,
      managerName: user.full_name,
      organisationName: org.name,
      location: targetLocation,
      instructions: dto.instructions,
    });

    return {
      ...visit,
      proximity,
      warnings: conflictResult.conflicts,
    };
  }

  // -------------------------------------------------------------
  // CUSTOMER HISTORY (Chronological visits & interactions)
  // -------------------------------------------------------------
  async getCustomerVisitHistory(organisationId: string) {
    const visits = await this.db
      .selectFrom('visits')
      .leftJoin('products', 'visits.product_id', 'products.id')
      .leftJoin('contacts', 'visits.contact_id', 'contacts.id')
      .leftJoin('users as emp', 'visits.assigned_to', 'emp.id')
      .leftJoin('visit_updates as vu', 'visits.id', 'vu.visit_id')
      .selectAll('visits')
      .select([
        'products.name as product_name',
        'contacts.full_name as contact_name',
        'emp.full_name as employee_name',
        'vu.person_met',
        'vu.discussion',
        'vu.outcome as post_visit_outcome',
        'vu.next_action',
        'vu.followup_date',
      ])
      .where('visits.organisation_id', '=', organisationId)
      .orderBy('visits.planned_date', 'desc')
      .execute();

    return visits;
  }

  // -------------------------------------------------------------
  // EMPLOYEE ACTIVITY DOSSIER (Chronological activity log)
  // -------------------------------------------------------------
  async getEmployeeActivities(employeeId: string, user: AuthUser) {
    if (user.role === 'sales' && user.id !== employeeId) {
      throw new ForbiddenException('You cannot access other employees’ private activity logs.');
    }

    const activities = await this.db
      .selectFrom('employee_activities')
      .selectAll('employee_activities')
      .where('employee_id', '=', employeeId)
      .orderBy('activity_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();

    return activities;
  }

  // -------------------------------------------------------------
  // VISIT AUDIT TRAIL (Append-only history of changes)
  // -------------------------------------------------------------
  async getVisitAudit(visitId: string) {
    const logs = await this.db
      .selectFrom('audit_log')
      .leftJoin('users as actor', 'audit_log.actor_id', 'actor.id')
      .selectAll('audit_log')
      .select([
        'actor.full_name as actor_name',
        'actor.email as actor_email',
        'actor.role as actor_role',
      ])
      .where('audit_log.entity_type', '=', 'visit')
      .where('audit_log.entity_id', '=', visitId)
      .orderBy('audit_log.created_at', 'desc')
      .execute();

    return logs;
  }
}
