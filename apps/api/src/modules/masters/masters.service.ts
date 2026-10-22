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

  // --- Departments CRUD (§5) ---
  async getDepartments() {
    return this.db.selectFrom('departments').selectAll().orderBy('name', 'asc').execute();
  }

  async createDepartment(data: { code: string; name: string; description?: string }) {
    return this.db
      .insertInto('departments')
      .values({
        code: data.code.trim().toLowerCase(),
        name: data.name.trim(),
        description: data.description || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDepartment(id: string, data: { name?: string; description?: string }) {
    return this.db
      .updateTable('departments')
      .set(data)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteDepartment(id: string) {
    await this.db.deleteFrom('departments').where('id', '=', id).execute();
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

  async deleteZone(id: string) {
    await this.db.deleteFrom('zones').where('id', '=', id).execute();
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

  async deleteRegion(id: string) {
    await this.db.deleteFrom('regions').where('id', '=', id).execute();
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
