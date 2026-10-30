import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database } from '@arihant/shared';

@Injectable()
export class MastersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Every master-data change lands in the security audit trail with the actor. */
  private audit(actorId: string | undefined, entityType: string, entityId: string, action: string, previousValue: unknown, newValue: unknown) {
    this.eventEmitter.emit('audit.log', { actorId: actorId || null, entityType, entityId, action, previousValue, newValue });
  }

  private required(value: unknown, label: string, max = 160): string {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) throw new BadRequestException(`${label} is required`);
    if (v.length > max) throw new BadRequestException(`${label} must be at most ${max} characters`);
    return v;
  }

  private optional(value: unknown, max = 500): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new BadRequestException('Expected text');
    const v = value.trim();
    if (v.length > max) throw new BadRequestException(`Value must be at most ${max} characters`);
    return v || null;
  }

  async getZones() {
    return this.db.selectFrom('zones').selectAll().orderBy('code', 'asc').execute();
  }

  async getRegions(zoneId?: string) {
    let q = this.db
      .selectFrom('regions')
      .leftJoin('zones', 'regions.zone_id', 'zones.id')
      .select([
        'regions.id',
        'regions.name',
        'regions.zone_id',
        'zones.name as zone_name',
        'zones.code as zone_code',
      ]);

    if (zoneId) {
      q = q.where('regions.zone_id', '=', zoneId);
    }

    return q.orderBy('regions.name', 'asc').execute();
  }

  async getProducts() {
    return this.db
      .selectFrom('products')
      .selectAll()
      .orderBy('name', 'asc')
      .execute();
  }

  async createProduct(
    data: { name?: string; category?: string | null; make?: string | null; is_mha_qr?: boolean; spec_ref?: string | null; gem_listed?: boolean },
    actorId?: string,
  ) {
    const name = this.required(data.name, 'Product name');
    const dup = await this.db
      .selectFrom('products')
      .select('id')
      .where(sql<boolean>`lower(name) = ${name.toLowerCase()}`)
      .executeTakeFirst();
    if (dup) throw new ConflictException(`A product named "${name}" already exists`);
    const row = await this.db
      .insertInto('products')
      .values({
        name,
        category: this.optional(data.category, 120),
        make: this.optional(data.make, 120),
        is_mha_qr: Boolean(data.is_mha_qr),
        spec_ref: this.optional(data.spec_ref, 200),
        ...(data.gem_listed !== undefined ? { gem_listed: Boolean(data.gem_listed) } : {}),
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit(actorId, 'product', row.id, 'master_product_created', null, row);
    return row;
  }

  async updateProduct(
    id: string,
    data: { name?: string; category?: string | null; make?: string | null; is_mha_qr?: boolean; spec_ref?: string | null; gem_listed?: boolean },
    actorId?: string,
  ) {
    const existing = await this.db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Product not found');
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const name = this.required(data.name, 'Product name');
      const dup = await this.db
        .selectFrom('products')
        .select('id')
        .where(sql<boolean>`lower(name) = ${name.toLowerCase()}`)
        .where('id', '<>', id)
        .executeTakeFirst();
      if (dup) throw new ConflictException(`A product named "${name}" already exists`);
      patch.name = name;
    }
    if (data.category !== undefined) patch.category = this.optional(data.category, 120);
    if (data.make !== undefined) patch.make = this.optional(data.make, 120);
    if (data.spec_ref !== undefined) patch.spec_ref = this.optional(data.spec_ref, 200);
    if (data.is_mha_qr !== undefined) patch.is_mha_qr = Boolean(data.is_mha_qr);
    if (data.gem_listed !== undefined) patch.gem_listed = Boolean(data.gem_listed);
    if (Object.keys(patch).length === 0) return existing;
    const row = await this.db
      .updateTable('products')
      .set(patch as any)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit(actorId, 'product', id, 'master_product_updated', existing, row);
    return row;
  }

  /** Deletes a master row, or refuses with a 409 while other records still point at it (never a bare FK 500). */
  private async deleteInUse(table: 'zones' | 'regions' | 'departments', id: string, label: string) {
    try {
      const gone = await this.db.deleteFrom(table).where('id', '=', id).executeTakeFirst();
      if (!Number(gone.numDeletedRows)) throw new NotFoundException(`${label} not found`);
    } catch (err: any) {
      if (err?.code === '23503') throw new ConflictException(`${label} is still in use — move its people and records elsewhere first`);
      throw err;
    }
  }

  // --- Departments CRUD (§5) ---
  /** Departments with their head and how many active people belong to them. */
  async getDepartments() {
    return this.db
      .selectFrom('departments')
      .leftJoin('users as head', 'head.id', 'departments.head_user_id')
      .selectAll('departments')
      .select('head.full_name as head_name')
      .select(
        sql<number>`(select count(*)::int from users u where u.department_id = departments.id and u.is_active)`.as('member_count'),
      )
      .orderBy('departments.name', 'asc')
      .execute();
  }

  /** The department head must be an active user (or none). */
  private async headId(value: unknown): Promise<string | null> {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('Choose the department head from the user list');
    const u = await this.db.selectFrom('users').select(['id', 'is_active']).where('id', '=', value).executeTakeFirst();
    if (!u) throw new BadRequestException('Department head does not exist');
    if (!u.is_active) throw new BadRequestException('Department head is deactivated');
    return u.id;
  }

  async createDepartment(data: { code?: string; name?: string; description?: string; head_user_id?: string | null }, actorId?: string) {
    const code = this.required(data.code, 'Department code', 30).toLowerCase();
    if (!/^[a-z0-9_]+$/.test(code)) throw new BadRequestException('Department code may contain letters, digits and _ only');
    const name = this.required(data.name, 'Department name', 80);
    const dup = await this.db
      .selectFrom('departments')
      .select('id')
      .where((eb) => eb.or([eb('code', '=', code), eb(sql`lower(name)`, '=', name.toLowerCase())]))
      .executeTakeFirst();
    if (dup) throw new ConflictException(`A department with this code or name already exists`);
    const row = await this.db
      .insertInto('departments')
      .values({ code, name, description: this.optional(data.description), head_user_id: await this.headId(data.head_user_id) })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit(actorId, 'department', row.id, 'master_department_created', null, { code, name, head_user_id: row.head_user_id });
    return row;
  }

  async updateDepartment(id: string, data: { name?: string; description?: string; head_user_id?: string | null }, actorId?: string) {
    const existing = await this.db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Department not found');
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) {
      const name = this.required(data.name, 'Department name', 80);
      const dup = await this.db
        .selectFrom('departments')
        .select('id')
        .where(sql<boolean>`lower(name) = ${name.toLowerCase()}`)
        .where('id', '<>', id)
        .executeTakeFirst();
      if (dup) throw new ConflictException(`A department named "${name}" already exists`);
      set.name = name;
    }
    if (data.description !== undefined) set.description = this.optional(data.description);
    if (data.head_user_id !== undefined) set.head_user_id = await this.headId(data.head_user_id);
    const row = await this.db.updateTable('departments').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    this.audit(actorId, 'department', id, 'master_department_updated', { name: existing.name, description: existing.description, head_user_id: existing.head_user_id }, { name: row.name, description: row.description, head_user_id: row.head_user_id });
    return row;
  }

  async deleteDepartment(id: string, actorId?: string) {
    const existing = await this.db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Department not found');
    const members = await this.db.selectFrom('users').select(sql<number>`count(*)::int`.as('n')).where('department_id', '=', id).executeTakeFirst();
    if ((members?.n || 0) > 0) {
      throw new ConflictException(`${members!.n} ${members!.n === 1 ? 'person belongs' : 'people belong'} to ${existing.name} — move them to another department first`);
    }
    await this.deleteInUse('departments', id, existing.name);
    this.audit(actorId, 'department', id, 'master_department_deleted', { code: existing.code, name: existing.name }, null);
    return { success: true };
  }

  // --- Zones CRUD (§5) ---
  async createZone(data: { code?: string; name?: string }, actorId?: string) {
    const code = this.required(data.code, 'Zone code', 12).toUpperCase();
    const name = this.required(data.name, 'Zone name', 80);
    const dup = await this.db
      .selectFrom('zones')
      .select('id')
      .where((eb) => eb.or([eb('code', '=', code), sql<boolean>`lower(name) = ${name.toLowerCase()}`]))
      .executeTakeFirst();
    if (dup) throw new ConflictException('A zone with this code or name already exists');
    const row = await this.db.insertInto('zones').values({ code, name }).returningAll().executeTakeFirstOrThrow();
    this.audit(actorId, 'zone', row.id, 'master_zone_created', null, row);
    return row;
  }

  async updateZone(id: string, data: { code?: string; name?: string }, actorId?: string) {
    const existing = await this.db.selectFrom('zones').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Zone not found');
    const payload: Record<string, string> = {};
    if (data.code !== undefined) payload.code = this.required(data.code, 'Zone code', 12).toUpperCase();
    if (data.name !== undefined) payload.name = this.required(data.name, 'Zone name', 80);
    if (Object.keys(payload).length === 0) return existing;
    const dup = await this.db
      .selectFrom('zones')
      .select('id')
      .where('id', '<>', id)
      .where((eb) =>
        eb.or([
          eb('code', '=', payload.code ?? existing.code),
          sql<boolean>`lower(name) = ${(payload.name ?? existing.name).toLowerCase()}`,
        ]),
      )
      .executeTakeFirst();
    if (dup) throw new ConflictException('A zone with this code or name already exists');
    const row = await this.db
      .updateTable('zones')
      .set(payload)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit(actorId, 'zone', id, 'master_zone_updated', existing, row);
    return row;
  }

  async deleteZone(id: string, actorId?: string) {
    const existing = await this.db.selectFrom('zones').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Zone not found');
    await this.deleteInUse('zones', id, `Zone ${existing.name}`);
    this.audit(actorId, 'zone', id, 'master_zone_deleted', { name: existing.name }, null);
    return { success: true };
  }

  // --- Regions CRUD (§5) ---
  private async assertZone(zoneId: unknown): Promise<string> {
    if (typeof zoneId !== 'string' || !zoneId) throw new BadRequestException('Choose the zone this region belongs to');
    const z = await this.db.selectFrom('zones').select('id').where('id', '=', zoneId).executeTakeFirst();
    if (!z) throw new BadRequestException('Zone does not exist');
    return z.id;
  }

  async createRegion(data: { name?: string; zone_id?: string }, actorId?: string) {
    const name = this.required(data.name, 'Region name', 80);
    const zoneId = await this.assertZone(data.zone_id);
    const dup = await this.db
      .selectFrom('regions')
      .select('id')
      .where('zone_id', '=', zoneId)
      .where(sql<boolean>`lower(name) = ${name.toLowerCase()}`)
      .executeTakeFirst();
    if (dup) throw new ConflictException(`Region "${name}" already exists in this zone`);
    const row = await this.db.insertInto('regions').values({ name, zone_id: zoneId }).returningAll().executeTakeFirstOrThrow();
    this.audit(actorId, 'region', row.id, 'master_region_created', null, row);
    return row;
  }

  async updateRegion(id: string, data: { name?: string; zone_id?: string; active?: boolean }, actorId?: string) {
    const existing = await this.db.selectFrom('regions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Region not found');
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = this.required(data.name, 'Region name', 80);
    if (data.zone_id !== undefined) patch.zone_id = await this.assertZone(data.zone_id);
    if (data.active !== undefined) patch.active = Boolean(data.active);
    if (Object.keys(patch).length === 0) return existing;
    const name = (patch.name as string | undefined) ?? existing.name;
    const zoneId = (patch.zone_id as string | undefined) ?? existing.zone_id;
    const dup = await this.db
      .selectFrom('regions')
      .select('id')
      .where('id', '<>', id)
      .where('zone_id', zoneId ? '=' : 'is', zoneId as any)
      .where(sql<boolean>`lower(name) = ${name.toLowerCase()}`)
      .executeTakeFirst();
    if (dup) throw new ConflictException(`Region "${name}" already exists in this zone`);
    const row = await this.db
      .updateTable('regions')
      .set(patch as any)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // users and customers in this region follow it to its new zone (users.zone_id is derived from the region)
    if (patch.zone_id && patch.zone_id !== existing.zone_id) {
      await this.db.updateTable('users').set({ zone_id: patch.zone_id as string } as any).where('region_id', '=', id).execute();
    }
    this.audit(actorId, 'region', id, 'master_region_updated', existing, row);
    return row;
  }

  async deleteRegion(id: string, actorId?: string) {
    const existing = await this.db.selectFrom('regions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Region not found');
    await this.deleteInUse('regions', id, `Region ${existing.name}`);
    this.audit(actorId, 'region', id, 'master_region_deleted', { name: existing.name }, null);
    return { success: true };
  }

  // --- Role Permissions Matrix (§5) ---
  async getRolePermissions(role?: string) {
    let q = this.db.selectFrom('role_permissions').selectAll();
    if (role) {
      q = q.where('role', '=', role as any);
    }
    return q.orderBy('role', 'asc').orderBy('module', 'asc').execute();
  }

  async updateRolePermission(
    id: string,
    data: {
      can_view?: boolean;
      can_create?: boolean;
      can_edit?: boolean;
      can_delete?: boolean;
      can_approve?: boolean;
    },
  ) {
    return this.db
      .updateTable('role_permissions')
      .set(data)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
