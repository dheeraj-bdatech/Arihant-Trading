import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import type { Database, PaginatedResult } from '@arihant/shared';
import type { CreateUserDto, UpdateUserDto, BulkInviteUsersDto } from './users.dto.js';

/** Columns safe to return to clients — never password_hash. */
const PUBLIC_USER_COLUMNS = [
  'id',
  'full_name',
  'email',
  'phone',
  'role',
  'region_id',
  'zone_id',
  'reporting_manager_id',
  'is_active',
  'employee_code',
  'department_id',
  'deactivated_at',
  'created_at',
  'updated_at',
] as const;

function generateTemporaryPassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    zone_id?: string;
    is_active?: string;
  }): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);

    let baseQuery = this.db
      .selectFrom('users')
      .leftJoin('regions', 'users.region_id', 'regions.id')
      .leftJoin('zones', 'users.zone_id', 'zones.id')
      .leftJoin('users as manager', 'users.reporting_manager_id', 'manager.id');

    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          sql<boolean>`lower(users.full_name) like ${s}`,
          sql<boolean>`lower(users.email) like ${s}`,
          sql<boolean>`users.phone like ${s}`,
        ]),
      );
    }

    if (query.role) {
      baseQuery = baseQuery.where('users.role', '=', query.role as any);
    }

    if (query.zone_id) {
      baseQuery = baseQuery.where('users.zone_id', '=', query.zone_id);
    }

    if (query.is_active !== undefined) {
      const active = query.is_active === 'true';
      baseQuery = baseQuery.where('users.is_active', '=', active);
    }

    const countRes = await baseQuery
      .select(sql<number>`count(users.id)::int`.as('total'))
      .executeTakeFirst();
    const total = countRes?.total || 0;

    const users = await baseQuery
      .select([
        'users.id',
        'users.full_name',
        'users.email',
        'users.phone',
        'users.role',
        'users.region_id',
        'users.zone_id',
        'users.reporting_manager_id',
        'users.is_active',
        'users.department_id',
        'users.employee_code',
        'users.deactivated_at',
        'users.created_at',
        'users.updated_at',
        'regions.name as region_name',
        'zones.name as zone_name',
        'zones.code as zone_code',
        'manager.full_name as reporting_manager_name',
      ])
      .orderBy('users.full_name', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(users, total, page, limit);
  }

  async findOne(id: string) {
    const user = await this.db
      .selectFrom('users')
      .leftJoin('regions', 'users.region_id', 'regions.id')
      .leftJoin('zones', 'users.zone_id', 'zones.id')
      .leftJoin('users as manager', 'users.reporting_manager_id', 'manager.id')
      .select([
        'users.id',
        'users.full_name',
        'users.email',
        'users.phone',
        'users.role',
        'users.region_id',
        'users.zone_id',
        'users.reporting_manager_id',
        'users.is_active',
        'users.created_at',
        'users.updated_at',
        'regions.name as region_name',
        'zones.name as zone_name',
        'manager.full_name as reporting_manager_name',
      ])
      .where('users.id', '=', id)
      .executeTakeFirst();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto, actorId?: string) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    if (dto.reporting_manager_id) await this.assertActiveUser(dto.reporting_manager_id, 'Reporting manager');
    const zoneId = await this.resolveZone(dto.region_id, dto.zone_id);

    // No shared default password: an admin-supplied password is used as-is, otherwise a one-time random
    // password is generated and returned once in this response for the admin to hand over.
    const temporaryPassword = dto.password ? null : generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(dto.password || temporaryPassword!, 10);

    const user = await this.db
      .insertInto('users')
      .values({
        id: crypto.randomUUID(),
        email,
        full_name: dto.full_name.trim(),
        phone: dto.phone || null,
        role: dto.role,
        region_id: dto.region_id || null,
        zone_id: zoneId,
        reporting_manager_id: dto.reporting_manager_id || null,
        password_hash: passwordHash,
        is_active: true,
      })
      .returning(PUBLIC_USER_COLUMNS)
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: actorId || null,
      entityType: 'user',
      entityId: user.id,
      action: 'create',
      newValue: { email: user.email, role: user.role, name: user.full_name },
    });

    return temporaryPassword ? { ...user, temporary_password: temporaryPassword } : user;
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string) {
    const existing = await this.findOne(id);

    const updatePayload: Record<string, unknown> = { ...dto, updated_at: new Date() };
    if (typeof dto.full_name === 'string') {
      const name = dto.full_name.trim();
      if (!name) throw new BadRequestException('Full name cannot be blank');
      updatePayload.full_name = name;
    }

    if (actorId && actorId === id) {
      // An admin locking themselves out (or demoting themselves) leaves nobody able to undo it.
      if (dto.is_active === false) throw new BadRequestException('You cannot deactivate your own account');
      if (dto.role && dto.role !== existing.role) throw new BadRequestException('You cannot change your own role');
    }

    // Never leave the platform without an active administrator.
    const losesAdmin =
      existing.role === 'admin' && existing.is_active && (dto.is_active === false || (dto.role !== undefined && dto.role !== 'admin'));
    if (losesAdmin) {
      const admins = await this.db
        .selectFrom('users')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('role', '=', 'admin')
        .where('is_active', '=', true)
        .where('id', '<>', id)
        .executeTakeFirst();
      if ((admins?.n ?? 0) === 0) throw new BadRequestException('This is the last active System Administrator account');
    }

    if (dto.reporting_manager_id) {
      if (dto.reporting_manager_id === id) throw new BadRequestException('A user cannot report to themselves');
      await this.assertActiveUser(dto.reporting_manager_id, 'Reporting manager');
      await this.assertNoReportingCycle(id, dto.reporting_manager_id);
    }

    if (dto.region_id !== undefined || dto.zone_id !== undefined) {
      updatePayload.zone_id = await this.resolveZone(
        dto.region_id === undefined ? existing.region_id : dto.region_id,
        dto.zone_id === undefined ? (dto.region_id !== undefined ? undefined : existing.zone_id) : dto.zone_id,
      );
    }

    if (dto.is_active === false && existing.is_active) updatePayload.deactivated_at = new Date();
    if (dto.is_active === true && !existing.is_active) updatePayload.deactivated_at = null;

    if (dto.is_active === false && existing.is_active) {
      const reports = await this.db
        .selectFrom('users')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('reporting_manager_id', '=', id)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if ((reports?.n ?? 0) > 0) {
        throw new BadRequestException(
          `This user is the reporting manager of ${reports!.n} active employee(s). Reassign them before deactivating.`,
        );
      }
    }

    const updated = await this.db
      .updateTable('users')
      .set(updatePayload as any)
      .where('id', '=', id)
      .returning(PUBLIC_USER_COLUMNS)
      .executeTakeFirstOrThrow();

    this.eventEmitter.emit('audit.log', {
      actorId: actorId || null,
      entityType: 'user',
      entityId: id,
      action: dto.is_active === false && existing.is_active ? 'deactivate' : 'update',
      previousValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async bulkInvite(dto: BulkInviteUsersDto, actorId?: string) {
    const results = {
      created: 0,
      skipped: 0,
      invited: [] as { email: string; temporary_password: string }[],
      errors: [] as { email: string; reason: string }[],
    };
    const seen = new Set<string>();

    for (const item of dto.users) {
      const email = item.email.trim().toLowerCase();
      if (seen.has(email)) {
        results.skipped++;
        continue;
      }
      seen.add(email);

      const exists = await this.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();

      if (exists) {
        results.skipped++;
        continue;
      }

      let region: { id: string; zone_id: string | null } | undefined;
      if (item.region_name?.trim()) {
        region = await this.db
          .selectFrom('regions')
          .select(['id', 'zone_id'])
          .where(sql<boolean>`lower(name) = ${item.region_name.trim().toLowerCase()}`)
          .executeTakeFirst();
        if (!region) {
          results.errors.push({ email, reason: `Unknown region "${item.region_name}"` });
          continue;
        }
      }

      let managerId: string | null = null;
      if (item.manager_email?.trim()) {
        const manager = await this.db
          .selectFrom('users')
          .select(['id', 'is_active'])
          .where('email', '=', item.manager_email.trim().toLowerCase())
          .executeTakeFirst();
        if (!manager || !manager.is_active) {
          results.errors.push({ email, reason: `Unknown or inactive manager "${item.manager_email}"` });
          continue;
        }
        managerId = manager.id;
      }

      const temporaryPassword = generateTemporaryPassword();
      await this.db
        .insertInto('users')
        .values({
          id: crypto.randomUUID(),
          email,
          full_name: item.full_name.trim(),
          role: item.role,
          region_id: region?.id ?? null,
          zone_id: region?.zone_id ?? null,
          reporting_manager_id: managerId,
          password_hash: await bcrypt.hash(temporaryPassword, 10),
          is_active: true,
        })
        .execute();

      results.created++;
      results.invited.push({ email, temporary_password: temporaryPassword });
    }

    this.eventEmitter.emit('audit.log', {
      actorId: actorId || null,
      entityType: 'user',
      entityId: 'bulk',
      action: 'bulk_invite',
      newValue: { created: results.created, skipped: results.skipped, errors: results.errors.length },
    });

    return results;
  }

  private async assertActiveUser(id: string, label: string) {
    const row = await this.db.selectFrom('users').select(['id', 'is_active']).where('id', '=', id).executeTakeFirst();
    if (!row) throw new BadRequestException(`${label} does not exist`);
    if (!row.is_active) throw new BadRequestException(`${label} is deactivated`);
  }

  /** Walks up the proposed manager's chain; if it reaches `userId` the assignment would create a loop. */
  private async assertNoReportingCycle(userId: string, managerId: string) {
    let cursor: string | null = managerId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === userId) {
        throw new BadRequestException('This reporting manager assignment would create a reporting loop');
      }
      const row = await this.db
        .selectFrom('users')
        .select('reporting_manager_id')
        .where('id', '=', cursor)
        .executeTakeFirst();
      cursor = row?.reporting_manager_id ?? null;
    }
  }

  /** Keeps users.zone_id consistent with the chosen region (the region row owns its zone). */
  private async resolveZone(regionId?: string | null, zoneId?: string | null): Promise<string | null> {
    if (!regionId) return zoneId || null;
    const region = await this.db
      .selectFrom('regions')
      .select(['id', 'zone_id'])
      .where('id', '=', regionId)
      .executeTakeFirst();
    if (!region) throw new BadRequestException('Region does not exist');
    if (zoneId && region.zone_id && zoneId !== region.zone_id) {
      throw new BadRequestException('The selected region does not belong to the selected zone');
    }
    return region.zone_id ?? zoneId ?? null;
  }
}
