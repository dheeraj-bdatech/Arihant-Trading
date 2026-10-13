import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely } from 'kysely';
import { EXPENSE_DB } from './expense-db.js';
import type { AuthUser, Database } from '@arihant/shared';
import { isAdminLike } from './expense-scope.js';
import {
  ExpenseValidationException,
  readText,
  TEXT_LIMITS,
  type FieldErrors,
} from './expense-validation.js';
import type { ExpenseCategoryDto, ProjectDto } from './expense.dto.js';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toCategory(row: any) {
  if (!row) return row;
  return {
    ...row,
    receipt_required_above: row.receipt_required_above === null ? null : Number(row.receipt_required_above),
    max_amount_per_item: row.max_amount_per_item === null ? null : Number(row.max_amount_per_item),
  };
}

function optionalMoney(errors: FieldErrors, field: string, v: unknown, allowZero: boolean): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s) || (!allowZero && Number(s) === 0)) {
    errors[field] = allowZero ? 'Enter 0 or a positive amount (max 2 decimals).' : 'Enter a positive amount (max 2 decimals).';
    return undefined;
  }
  return Number(s);
}

function optionalBool(errors: FieldErrors, field: string, v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') {
    errors[field] = `${field} must be true or false.`;
    return undefined;
  }
  return v;
}

@Injectable()
export class ExpenseMastersService {
  constructor(
    @Inject(EXPENSE_DB) private readonly db: Kysely<Database>,
    private readonly events: EventEmitter2,
  ) {}

  // ----------------------------------------------------------------- categories
  async listCategories(user: AuthUser, includeInactive: boolean) {
    let q = this.db.selectFrom('expense_categories').selectAll().orderBy('display_order').orderBy('name');
    if (!(includeInactive && (isAdminLike(user) || user.role === 'accounts'))) q = q.where('is_active', '=', true);
    return (await q.execute()).map(toCategory);
  }

  private readCategory(dto: ExpenseCategoryDto, creating: boolean) {
    const errors: FieldErrors = {};
    const out: Record<string, unknown> = {};
    if (creating || dto.code !== undefined) {
      const code = typeof dto.code === 'string' ? dto.code.trim().toUpperCase() : '';
      if (!CODE_PATTERN.test(code)) errors.code = 'Code must be 2–40 characters: A–Z, 0–9 and underscores, starting with a letter.';
      out.code = code;
    }
    if (creating || dto.name !== undefined) {
      out.name = readText(errors, 'name', dto.name, TEXT_LIMITS.short, { required: true, label: 'Name' });
    }
    const receipt = optionalMoney(errors, 'receipt_required_above', dto.receipt_required_above, true);
    if (receipt !== undefined) out.receipt_required_above = receipt;
    const cap = optionalMoney(errors, 'max_amount_per_item', dto.max_amount_per_item, false);
    if (cap !== undefined) out.max_amount_per_item = cap;
    for (const f of ['is_active', 'cap_is_hard', 'requires_customer_or_project', 'requires_remark'] as const) {
      const b = optionalBool(errors, f, dto[f]);
      if (b !== undefined) out[f] = b;
    }
    if (dto.display_order !== undefined) {
      const n = Number(dto.display_order);
      if (!Number.isInteger(n) || n < 0 || n > 10000) errors.display_order = 'Display order must be a whole number 0–10000.';
      else out.display_order = n;
    }
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
    return out;
  }

  async createCategory(dto: ExpenseCategoryDto, user: AuthUser) {
    const values = this.readCategory(dto, true);
    const exists = await this.db
      .selectFrom('expense_categories')
      .select('id')
      .where('code', '=', values.code as string)
      .executeTakeFirst();
    if (exists) throw new ExpenseValidationException({ code: 'A category with this code already exists.' });
    const row = await this.db
      .insertInto('expense_categories')
      .values({ ...(values as any), created_by: user.id, updated_by: user.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'expense_category', entityId: row.id, action: 'create', newValue: row });
    return toCategory(row);
  }

  async updateCategory(id: string, dto: ExpenseCategoryDto, user: AuthUser) {
    if (!UUID.test(id)) throw new NotFoundException('Category not found');
    const existing = await this.db.selectFrom('expense_categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Category not found');
    if (dto.code !== undefined && String(dto.code).trim().toUpperCase() !== existing.code) {
      // Codes feed the Tally mapping and the import template; renaming the label is fine, the code is not.
      throw new ExpenseValidationException({ code: 'Category code cannot be changed once created.' });
    }
    const values = this.readCategory({ ...dto, code: undefined }, false);
    const row = await this.db
      .updateTable('expense_categories')
      .set({ ...(values as any), updated_by: user.id })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.events.emit('audit.log', {
      actorId: user.id,
      entityType: 'expense_category',
      entityId: id,
      action: 'update',
      previousValue: existing,
      newValue: row,
    });
    return toCategory(row);
  }

  // ------------------------------------------------------------------- projects
  async listProjects(includeInactive: boolean, search?: string) {
    let q = this.db
      .selectFrom('projects as p')
      .leftJoin('organisations as o', 'o.id', 'p.organisation_id')
      .select(['p.id', 'p.code', 'p.name', 'p.organisation_id', 'p.is_active', 'o.name as organisation_name'])
      .orderBy('p.code');
    if (!includeInactive) q = q.where('p.is_active', '=', true);
    if (search) {
      const s = `%${search.toLowerCase().slice(0, 100)}%`;
      q = q.where((eb) => eb.or([eb(eb.fn('lower', ['p.name']), 'like', s), eb(eb.fn('lower', ['p.code']), 'like', s)]));
    }
    return q.limit(500).execute();
  }

  private readProject(dto: ProjectDto, creating: boolean) {
    const errors: FieldErrors = {};
    const out: Record<string, unknown> = {};
    if (creating || dto.code !== undefined) {
      const code = typeof dto.code === 'string' ? dto.code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9][A-Z0-9_\-/]{1,39}$/.test(code)) errors.code = 'Code must be 2–40 characters: A–Z, 0–9, "-", "_" or "/".';
      out.code = code;
    }
    if (creating || dto.name !== undefined) {
      out.name = readText(errors, 'name', dto.name, TEXT_LIMITS.title, { required: true, label: 'Name' });
    }
    if (dto.organisation_id !== undefined) {
      if (dto.organisation_id === null || dto.organisation_id === '') out.organisation_id = null;
      else if (typeof dto.organisation_id !== 'string' || !UUID.test(dto.organisation_id)) errors.organisation_id = 'Customer is not valid.';
      else out.organisation_id = dto.organisation_id;
    }
    const active = optionalBool(errors, 'is_active', dto.is_active);
    if (active !== undefined) out.is_active = active;
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
    return out;
  }

  async createProject(dto: ProjectDto, user: AuthUser) {
    const values = this.readProject(dto, true);
    const exists = await this.db.selectFrom('projects').select('id').where('code', '=', values.code as string).executeTakeFirst();
    if (exists) throw new ExpenseValidationException({ code: 'A project with this code already exists.' });
    const row = await this.db
      .insertInto('projects')
      .values({ ...(values as any), created_by: user.id, updated_by: user.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'project', entityId: row.id, action: 'create', newValue: row });
    return row;
  }

  async updateProject(id: string, dto: ProjectDto, user: AuthUser) {
    if (!UUID.test(id)) throw new NotFoundException('Project not found');
    const existing = await this.db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Project not found');
    const values = this.readProject(dto, false);
    if (values.code && values.code !== existing.code) {
      const clash = await this.db.selectFrom('projects').select('id').where('code', '=', values.code as string).executeTakeFirst();
      if (clash) throw new ExpenseValidationException({ code: 'A project with this code already exists.' });
    }
    const row = await this.db
      .updateTable('projects')
      .set({ ...(values as any), updated_by: user.id })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.events.emit('audit.log', { actorId: user.id, entityType: 'project', entityId: id, action: 'update', previousValue: existing, newValue: row });
    return row;
  }
}
