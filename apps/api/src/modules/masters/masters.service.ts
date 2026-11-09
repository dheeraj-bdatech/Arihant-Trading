import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, type SelectQueryBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { buildPaginatedResult, getPaginationParams } from '../../common/utils/pagination.js';
import type { Database, PaginatedResult } from '@arihant/shared';

/** `page` turns a master list into one page of `limit` rows; `search` matches the row's name or code. */
export interface MasterListQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  /** client categories: 'true' lists deactivated ones too (the admin's list; pickers get active ones only) */
  include_inactive?: string;
}

const likeTerm = (q?: MasterListQuery) => {
  const s = typeof q?.search === 'string' ? q.search.trim().toLowerCase() : '';
  return s ? `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
};

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

  /** The whole list, or one page of it with the total when the caller asked for a page. */
  private async listOrPage<DB, TB extends keyof DB, O>(
    query: SelectQueryBuilder<DB, TB, O>,
    q?: MasterListQuery,
  ): Promise<O[] | PaginatedResult<O>> {
    if (q?.page === undefined || q.page === '') return query.execute();
    const { page, limit, offset } = getPaginationParams({ page: Number(q.page), limit: Number(q.limit) });
    const [rows, count] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      sql<{ total: number }>`select count(*)::int as total from (${query.clearOrderBy()}) as list`.execute(this.db),
    ]);
    return buildPaginatedResult(rows, Number(count.rows[0]?.total ?? 0), page, limit);
  }

  async getZones(q?: MasterListQuery) {
    let query = this.db.selectFrom('zones').selectAll();
    const term = likeTerm(q);
    if (term) query = query.where((eb) => eb.or([sql<boolean>`lower(zones.name) like ${term}`, sql<boolean>`lower(zones.code) like ${term}`]));
    return this.listOrPage(query.orderBy('code', 'asc'), q);
  }

  async getRegions(zoneId?: string, q?: MasterListQuery) {
    let query = this.db
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
      query = query.where('regions.zone_id', '=', zoneId);
    }
    const term = likeTerm(q);
    if (term) query = query.where((eb) => eb.or([sql<boolean>`lower(regions.name) like ${term}`, sql<boolean>`lower(zones.name) like ${term}`]));

    return this.listOrPage(query.orderBy('regions.name', 'asc'), q);
  }

  async getProducts(q?: MasterListQuery) {
    let query = this.db.selectFrom('products').selectAll();
    const term = likeTerm(q);
    if (term) {
      query = query.where((eb) =>
        eb.or([
          sql<boolean>`lower(products.name) like ${term}`,
          sql<boolean>`lower(coalesce(products.category, '')) like ${term}`,
          sql<boolean>`lower(coalesce(products.make, '')) like ${term}`,
        ]),
      );
    }
    return this.listOrPage(query.orderBy('name', 'asc'), q);
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
  async getDepartments(q?: MasterListQuery) {
    let query = this.db
      .selectFrom('departments')
      .leftJoin('users as head', 'head.id', 'departments.head_user_id')
      .selectAll('departments')
      .select('head.full_name as head_name')
      .select(
        sql<number>`(select count(*)::int from users u where u.department_id = departments.id and u.is_active)`.as('member_count'),
      );
    const term = likeTerm(q);
    if (term) {
      query = query.where((eb) => eb.or([sql<boolean>`lower(departments.name) like ${term}`, sql<boolean>`lower(departments.code) like ${term}`]));
    }
    return this.listOrPage(query.orderBy('departments.name', 'asc'), q);
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
  /* ------------------------------------------------------------ client categories -- */

  /** Client categories (the values of organisations.sector) with how many customers use each; active ones by default. */
  async getClientCategories(q?: MasterListQuery) {
    let query = this.db
      .selectFrom('client_categories')
      .selectAll('client_categories')
      .select(sql<number>`(select count(*)::int from organisations o where o.sector = client_categories.name)`.as('customer_count'));
    if (q?.include_inactive !== 'true') query = query.where('client_categories.is_active', '=', true);
    const term = likeTerm(q);
    if (term) {
      query = query.where((eb) =>
        eb.or([sql<boolean>`lower(client_categories.name) like ${term}`, sql<boolean>`lower(coalesce(client_categories.label, '')) like ${term}`]),
      );
    }
    return this.listOrPage(query.orderBy('client_categories.sort_order', 'asc').orderBy('client_categories.name', 'asc'), q);
  }

  private sortOrder(value: unknown): number {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new BadRequestException('Sort order must be a whole number from 0 to 10000');
    return n;
  }

  private async assertClientCategoryFree(name: string, exceptId?: string) {
    let q = this.db.selectFrom('client_categories').select('id').where(sql<boolean>`lower(name) = ${name.toLowerCase()}`);
    if (exceptId) q = q.where('id', '<>', exceptId);
    if (await q.executeTakeFirst()) throw new ConflictException(`A client category named "${name}" already exists`);
  }

  async createClientCategory(data: { name?: string; label?: string; sort_order?: number }, actorId?: string) {
    const name = this.required(data.name, 'Category name', 80);
    await this.assertClientCategoryFree(name);
    const row = await this.db
      .insertInto('client_categories')
      .values({ name, label: this.optional(data.label, 160), sort_order: this.sortOrder(data.sort_order) })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit(actorId, 'client_category', row.id, 'master_client_category_created', null, { name, label: row.label });
    return row;
  }

  /** Renaming a category renames it on every customer that has it, in the same transaction. */
  async updateClientCategory(id: string, data: { name?: string; label?: string; sort_order?: number; is_active?: boolean }, actorId?: string) {
    const existing = await this.db.selectFrom('client_categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Client category not found');
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) {
      const name = this.required(data.name, 'Category name', 80);
      if (name !== existing.name) await this.assertClientCategoryFree(name, id);
      set.name = name;
    }
    if (data.label !== undefined) set.label = this.optional(data.label, 160);
    if (data.sort_order !== undefined) set.sort_order = this.sortOrder(data.sort_order);
    if (data.is_active !== undefined) {
      if (typeof data.is_active !== 'boolean') throw new BadRequestException('Active must be true or false');
      set.is_active = data.is_active;
    }
    const row = await this.db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable('client_categories').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      if (updated.name !== existing.name) {
        await trx.updateTable('organisations').set({ sector: updated.name, updated_at: new Date() }).where('sector', '=', existing.name).execute();
      }
      return updated;
    });
    this.audit(
      actorId,
      'client_category',
      id,
      'master_client_category_updated',
      { name: existing.name, label: existing.label, is_active: existing.is_active },
      { name: row.name, label: row.label, is_active: row.is_active },
    );
    return row;
  }

  async deleteClientCategory(id: string, actorId?: string) {
    const existing = await this.db.selectFrom('client_categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Client category not found');
    const used = await this.db.selectFrom('organisations').select(sql<number>`count(*)::int`.as('n')).where('sector', '=', existing.name).executeTakeFirst();
    if ((used?.n || 0) > 0) {
      throw new ConflictException(
        `${used!.n} ${used!.n === 1 ? 'customer is' : 'customers are'} in ${existing.name} — deactivate it instead, or move them to another category first`,
      );
    }
    await this.db.deleteFrom('client_categories').where('id', '=', id).execute();
    this.audit(actorId, 'client_category', id, 'master_client_category_deleted', { name: existing.name, label: existing.label }, null);
    return { success: true };
  }

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
