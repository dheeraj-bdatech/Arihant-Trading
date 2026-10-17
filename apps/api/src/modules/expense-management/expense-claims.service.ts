import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, type Transaction } from 'kysely';
import { EXPENSE_DB } from './expense-db.js';
import {
  EXPENSE_EDITABLE_STATUSES,
  EXPENSE_INACTIVE_FOR_DUPLICATES,
  EXPENSE_STATUS_LABELS,
  allowedExpenseActions,
  findExpenseTransition,
  formatExpenseAmount,
  todayInKolkata,
  type AuthUser,
  type Database,
  type ExpenseClaimAction,
  type ExpenseClaimStatus,
} from '@arihant/shared';
import { EXPENSE_CONFIG, type ExpenseConfig } from './expense.config.js';
import { claimScopeFilter, isAdminLike } from './expense-scope.js';
import {
  claimFilterExpressions,
  hasItemLevelFilter,
  itemFilterExpressions,
  parseExpenseFilters,
} from './expense-filters.js';
import {
  ExpenseValidationException,
  addDays,
  readText,
  receiptRequired,
  TEXT_LIMITS,
  validateItem,
  type CategoryRule,
  type FieldErrors,
  type ItemInput,
} from './expense-validation.js';
import type { ClaimHeaderDto, ExpenseItemDto } from './expense.dto.js';

type DB = Kysely<Database> | Transaction<Database>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const money = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface DateWindow {
  from: string;
  to: string;
  label: string;
}

export function serializeClaim(c: any) {
  if (!c) return c;
  return {
    ...c,
    total_claimed: money(c.total_claimed) ?? 0,
    total_approved: money(c.total_approved),
    status_label: EXPENSE_STATUS_LABELS[c.status as ExpenseClaimStatus] || c.status,
  };
}

export function serializeItem(i: any) {
  if (!i) return i;
  return {
    ...i,
    amount: money(i.amount) ?? 0,
    approved_amount: money(i.approved_amount),
    manager_approved_amount: money(i.manager_approved_amount),
    receipt_required_above: i.receipt_required_above === undefined ? undefined : money(i.receipt_required_above),
  };
}

export function conflict(message: string, code = 'INVALID_TRANSITION'): ConflictException {
  return new ConflictException({ message, code });
}

export function staleVersion(): ConflictException {
  return new ConflictException({
    message: 'This claim was updated by someone else, please refresh.',
    code: 'STALE_VERSION',
  });
}

/** Optional on edits, mandatory on workflow transitions. */
export function readVersion(v: unknown, required: boolean): number | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ExpenseValidationException({ version: 'version is required.' });
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ExpenseValidationException({ version: 'version must be a positive integer.' });
  return n;
}

@Injectable()
export class ExpenseClaimsService {
  constructor(
    @Inject(EXPENSE_DB) readonly db: Kysely<Database>,
    @Inject(EXPENSE_CONFIG) readonly config: ExpenseConfig,
    readonly events: EventEmitter2,
  ) {}

  // ========================================================================== helpers
  /** Base claim query with role scoping applied. Aliases: c (claim), emp (owner). */
  scopedClaims(user: AuthUser, db: DB = this.db) {
    return db
      .selectFrom('expense_claims as c')
      .innerJoin('users as emp', 'emp.id', 'c.employee_id')
      .where('c.deleted_at', 'is', null)
      .where(claimScopeFilter(user));
  }

  /** Visible claim or 404 (never 403 — do not leak existence). */
  async getVisibleClaim(id: string, user: AuthUser, db: DB = this.db) {
    if (!UUID.test(id)) throw new NotFoundException('Expense claim not found');
    const claim = await this.scopedClaims(user, db).selectAll('c').where('c.id', '=', id).executeTakeFirst();
    if (!claim) throw new NotFoundException('Expense claim not found');
    return claim;
  }

  /** Row lock for a mutation; re-read inside the transaction so status/version are current. */
  async lockClaim(trx: Transaction<Database>, id: string) {
    const claim = await trx
      .selectFrom('expense_claims')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!claim) throw new NotFoundException('Expense claim not found');
    return claim;
  }

  assertOwnerEditable(claim: { employee_id: string; status: string }, user: AuthUser) {
    if (claim.employee_id !== user.id) throw new ForbiddenException('Only the employee who raised this claim can edit it.');
    if (!EXPENSE_EDITABLE_STATUSES.includes(claim.status as ExpenseClaimStatus)) {
      throw conflict(
        `This claim is ${EXPENSE_STATUS_LABELS[claim.status as ExpenseClaimStatus] || claim.status} and can no longer be edited.`,
        'CLAIM_LOCKED',
      );
    }
  }

  async history(
    trx: DB,
    claimId: string,
    row: { from: string | null; to: string; action: string; actor: AuthUser | null; comment?: string | null; metadata?: unknown },
  ) {
    await trx
      .insertInto('expense_approval_history')
      .values({
        claim_id: claimId,
        from_status: row.from,
        to_status: row.to,
        action: row.action,
        actor_id: row.actor?.id ?? null,
        actor_role: row.actor?.role ?? 'system',
        comment: row.comment ?? null,
        metadata: row.metadata === undefined ? null : JSON.stringify(row.metadata),
      })
      .execute();
  }

  /** Recomputes totals and period from live items and bumps the version. */
  async recalc(trx: DB, claimId: string, user: AuthUser) {
    await trx
      .updateTable('expense_claims')
      .set({
        total_claimed: sql`coalesce((select sum(amount) from expense_items where claim_id = ${claimId} and deleted_at is null), 0)`,
        period_from: sql`(select min(expense_date) from expense_items where claim_id = ${claimId} and deleted_at is null)`,
        period_to: sql`(select max(expense_date) from expense_items where claim_id = ${claimId} and deleted_at is null)`,
        version: sql`version + 1`,
        updated_by: user.id,
      })
      .where('id', '=', claimId)
      .execute();
  }

  async loadCategory(db: DB, id: unknown): Promise<CategoryRule | null> {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const c = await db.selectFrom('expense_categories').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) return null;
    return {
      ...c,
      receipt_required_above: money(c.receipt_required_above),
      max_amount_per_item: money(c.max_amount_per_item),
    };
  }

  /** Validates trip/visit links for an employee and returns the date window items must fall in. */
  async resolveLink(
    db: DB,
    employeeId: string,
    tripId: unknown,
    visitId: unknown,
    opts: { linkingNew: boolean },
  ): Promise<{ trip_id: string | null; visit_id: string | null; window: DateWindow | null }> {
    const errors: FieldErrors = {};
    const tol = this.config.tripDateToleranceDays;
    let trip_id: string | null = null;
    let visit_id: string | null = null;
    let window: DateWindow | null = null;

    if (visitId !== undefined && visitId !== null && visitId !== '') {
      if (typeof visitId !== 'string' || !UUID.test(visitId)) errors.visit_id = 'Visit is not valid.';
      else {
        const v = await db.selectFrom('visits').selectAll().where('id', '=', visitId).executeTakeFirst();
        if (!v) errors.visit_id = 'Visit not found.';
        else if (![v.assigned_to, v.planned_by, v.service_engineer_id].includes(employeeId)) {
          errors.visit_id = 'You can only claim expenses for your own visits.';
        } else if (opts.linkingNew && String(v.status).toLowerCase() === 'cancelled') {
          errors.visit_id = 'Cancelled visits cannot get new expense claims.';
        } else {
          visit_id = v.id;
          window = { from: addDays(v.planned_date, -tol), to: addDays(v.planned_date, tol), label: 'visit dates' };
          if (v.trip_id && (tripId === undefined || tripId === null || tripId === '')) tripId = v.trip_id;
          if (v.trip_id && typeof tripId === 'string' && tripId !== v.trip_id) errors.visit_id = 'This visit belongs to a different trip.';
        }
      }
    }

    if (tripId !== undefined && tripId !== null && tripId !== '') {
      if (typeof tripId !== 'string' || !UUID.test(tripId)) errors.trip_id = 'Trip is not valid.';
      else {
        const t = await db.selectFrom('trips').selectAll().where('id', '=', tripId).executeTakeFirst();
        if (!t) errors.trip_id = 'Trip not found.';
        else {
          const participant =
            t.employee_id === employeeId ||
            Boolean(
              await db
                .selectFrom('visits')
                .select('id')
                .where('trip_id', '=', t.id)
                .where((eb) => eb.or([eb('assigned_to', '=', employeeId), eb('service_engineer_id', '=', employeeId)]))
                .executeTakeFirst(),
            );
          if (!participant) errors.trip_id = 'You can only claim expenses for trips you are part of.';
          else if (opts.linkingNew && String(t.status).toLowerCase() === 'cancelled') {
            errors.trip_id = 'Cancelled trips cannot get new expense claims.';
          } else {
            trip_id = t.id;
            const span = await db
              .selectFrom('visits')
              .select([sql<string>`min(planned_date)::text`.as('min'), sql<string>`max(planned_date)::text`.as('max')])
              .where('trip_id', '=', t.id)
              .executeTakeFirst();
            const dates = [t.trip_date, span?.min, span?.max].filter(Boolean).map(String).sort();
            window = { from: addDays(dates[0], -tol), to: addDays(dates[dates.length - 1], tol), label: 'trip dates' };
          }
        }
      }
    }
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
    return { trip_id, visit_id, window };
  }

  async windowForClaim(db: DB, claim: { employee_id: string; trip_id: string | null; visit_id: string | null }) {
    if (!claim.trip_id && !claim.visit_id) return null;
    return (await this.resolveLink(db, claim.employee_id, claim.trip_id, claim.visit_id, { linkingNew: false })).window;
  }

  async findDuplicates(db: DB, employeeId: string, date: string, categoryId: string, amount: number, excludeItemId?: string) {
    let q = db
      .selectFrom('expense_items as i')
      .innerJoin('expense_claims as c', 'c.id', 'i.claim_id')
      .select(['i.id as item_id', 'c.id as claim_id', 'c.claim_number', 'c.status'])
      .where('c.employee_id', '=', employeeId)
      .where('c.deleted_at', 'is', null)
      .where('i.deleted_at', 'is', null)
      .where('c.status', 'not in', [...EXPENSE_INACTIVE_FOR_DUPLICATES])
      .where('i.expense_date', '=', date)
      .where('i.category_id', '=', categoryId)
      .where('i.amount', '=', String(amount));
    if (excludeItemId) q = q.where('i.id', '<>', excludeItemId);
    return q.limit(5).execute();
  }

  async hotelOverlapWarnings(db: DB, employeeId: string, details: Record<string, unknown>, excludeItemId?: string) {
    const checkIn = details.check_in as string | undefined;
    const checkOut = details.check_out as string | undefined;
    if (!checkIn || !checkOut) return [];
    let q = db
      .selectFrom('expense_items as i')
      .innerJoin('expense_claims as c', 'c.id', 'i.claim_id')
      .innerJoin('expense_categories as cat', 'cat.id', 'i.category_id')
      .select(['c.claim_number', sql<string>`i.category_details->>'hotel_name'`.as('hotel_name'),
        sql<string>`i.category_details->>'check_in'`.as('check_in'), sql<string>`i.category_details->>'check_out'`.as('check_out')])
      .where('c.employee_id', '=', employeeId)
      .where('cat.code', '=', 'HOTEL')
      .where('c.deleted_at', 'is', null)
      .where('i.deleted_at', 'is', null)
      .where('c.status', 'not in', [...EXPENSE_INACTIVE_FOR_DUPLICATES])
      .where(sql<boolean>`(i.category_details->>'check_in')::date < ${checkOut}::date`)
      .where(sql<boolean>`(i.category_details->>'check_out')::date > ${checkIn}::date`);
    if (excludeItemId) q = q.where('i.id', '<>', excludeItemId);
    const rows = await q.limit(5).execute();
    return rows.map(
      (r) => `Hotel stay overlaps ${r.hotel_name || 'another stay'} (${r.check_in} → ${r.check_out}) on ${r.claim_number}.`,
    );
  }

  /** Which buttons the current user should see on this claim (UX only; every action is re-checked server-side). */
  allowedActions(claim: { employee_id: string; manager_id: string | null; status: string }, user: AuthUser) {
    const own = claim.employee_id === user.id;
    const out: string[] = [];
    const can = (a: ExpenseClaimAction) => allowedExpenseActions(claim.status).includes(a);
    if (own) {
      if (EXPENSE_EDITABLE_STATUSES.includes(claim.status as ExpenseClaimStatus)) out.push('edit');
      if (claim.status === 'draft') out.push('delete');
      if (can('submit')) out.push('submit');
      if (can('withdraw')) out.push('withdraw');
      if (['rejected', 'withdrawn'].includes(claim.status)) out.push('copy');
    }
    if (!own && claim.manager_id === user.id && claim.status === 'submitted') {
      out.push('manager_approve', 'manager_reject', 'request_clarification');
    }
    if (!own && user.role === 'accounts') {
      if (claim.status === 'accounts_review') out.push('accounts_approve', 'accounts_reject', 'request_clarification', 'process');
      if (claim.status === 'accounts_approved') out.push('process', 'accounts_reject');
    }
    if (isAdminLike(user) && claim.status === 'submitted') out.push('reassign_approver');
    return Array.from(new Set(out));
  }

  // ========================================================================== claims
  async createDraft(dto: ClaimHeaderDto, user: AuthUser) {
    const employee = await this.db.selectFrom('users').select(['is_active']).where('id', '=', user.id).executeTakeFirst();
    if (!employee?.is_active) throw new ForbiddenException('Your account is inactive and cannot raise new expense claims.');

    const errors: FieldErrors = {};
    const title = readText(errors, 'title', dto.title, TEXT_LIMITS.title, { required: true, label: 'Title / purpose' });
    const remarks = readText(errors, 'remarks', dto.remarks, TEXT_LIMITS.remarks, { label: 'Remarks' });
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
    const link = await this.resolveLink(this.db, user.id, dto.trip_id, dto.visit_id, { linkingNew: true });

    const claim = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('expense_claims')
        .values({
          claim_number: sql`'EXP-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('expense_claim_number_seq')::text, 6, '0')`,
          employee_id: user.id,
          trip_id: link.trip_id,
          visit_id: link.visit_id,
          title: title!,
          remarks,
          status: 'draft',
          created_by: user.id,
          updated_by: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.history(trx, row.id, { from: null, to: 'draft', action: 'create', actor: user });
      return row;
    });
    this.events.emit('audit.log', { actorId: user.id, entityType: 'expense_claim', entityId: claim.id, action: 'create', newValue: claim });
    return this.getDetail(claim.id, user);
  }

  async updateHeader(id: string, dto: ClaimHeaderDto, user: AuthUser) {
    const visible = await this.getVisibleClaim(id, user);
    this.assertOwnerEditable(visible, user);
    const expectedVersion = readVersion(dto.version, false);

    const errors: FieldErrors = {};
    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = readText(errors, 'title', dto.title, TEXT_LIMITS.title, { required: true, label: 'Title / purpose' });
    if (dto.remarks !== undefined) patch.remarks = readText(errors, 'remarks', dto.remarks, TEXT_LIMITS.remarks, { label: 'Remarks' });
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);

    const linkChanged =
      (dto.trip_id !== undefined && (dto.trip_id || null) !== visible.trip_id) ||
      (dto.visit_id !== undefined && (dto.visit_id || null) !== visible.visit_id);
    if (linkChanged) {
      const link = await this.resolveLink(
        this.db,
        visible.employee_id,
        dto.trip_id !== undefined ? dto.trip_id : visible.trip_id,
        dto.visit_id !== undefined ? dto.visit_id : visible.visit_id,
        { linkingNew: true },
      );
      patch.trip_id = link.trip_id;
      patch.visit_id = link.visit_id;
      if (link.window) {
        const outside = await this.db
          .selectFrom('expense_items')
          .select(['id', 'expense_date'])
          .where('claim_id', '=', id)
          .where('deleted_at', 'is', null)
          .where((eb) => eb.or([eb('expense_date', '<', link.window!.from), eb('expense_date', '>', link.window!.to)]))
          .execute();
        if (outside.length) {
          throw new ExpenseValidationException({
            trip_id: `${outside.length} existing line(s) fall outside the ${link.window.label} (${link.window.from} to ${link.window.to}). Fix their dates first.`,
          });
        }
      }
    }

    await this.db.transaction().execute(async (trx) => {
      const claim = await this.lockClaim(trx, id);
      this.assertOwnerEditable(claim, user);
      if (expectedVersion !== null && claim.version !== expectedVersion) throw staleVersion();
      await trx
        .updateTable('expense_claims')
        .set({ ...(patch as any), version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', id)
        .execute();
      if (claim.status === 'clarification_required') {
        await this.history(trx, id, {
          from: claim.status,
          to: claim.status,
          action: 'clarification_edit',
          actor: user,
          metadata: { header: { before: { title: claim.title, remarks: claim.remarks, trip_id: claim.trip_id, visit_id: claim.visit_id }, after: patch } },
        });
      }
    });
    return this.getDetail(id, user);
  }

  async softDeleteDraft(id: string, user: AuthUser) {
    await this.getVisibleClaim(id, user);
    await this.db.transaction().execute(async (trx) => {
      const claim = await this.lockClaim(trx, id);
      if (claim.employee_id !== user.id) throw new ForbiddenException('Only the employee who raised this claim can delete it.');
      if (claim.status !== 'draft') throw conflict('Only draft claims can be deleted. Withdraw a submitted claim instead.', 'CLAIM_LOCKED');
      await trx
        .updateTable('expense_claims')
        .set({ deleted_at: new Date(), version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', id)
        .execute();
      await this.history(trx, id, { from: 'draft', to: 'draft', action: 'delete', actor: user });
    });
    this.events.emit('audit.log', { actorId: user.id, entityType: 'expense_claim', entityId: id, action: 'soft_delete' });
    return { id, deleted: true };
  }

  async copyToDraft(id: string, user: AuthUser) {
    const source = await this.getVisibleClaim(id, user);
    if (source.employee_id !== user.id) throw new ForbiddenException('Only the employee who raised this claim can copy it.');
    if (!['rejected', 'withdrawn'].includes(source.status)) {
      throw conflict('Only rejected or withdrawn claims can be copied into a new draft.');
    }
    const employee = await this.db.selectFrom('users').select('is_active').where('id', '=', user.id).executeTakeFirst();
    if (!employee?.is_active) throw new ForbiddenException('Your account is inactive and cannot raise new expense claims.');

    const newId = await this.db.transaction().execute(async (trx) => {
      const draft = await trx
        .insertInto('expense_claims')
        .values({
          claim_number: sql`'EXP-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('expense_claim_number_seq')::text, 6, '0')`,
          employee_id: user.id,
          trip_id: source.trip_id,
          visit_id: source.visit_id,
          title: source.title,
          remarks: source.remarks,
          status: 'draft',
          copied_from_claim_id: source.id,
          created_by: user.id,
          updated_by: user.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const items = await trx.selectFrom('expense_items').selectAll().where('claim_id', '=', id).where('deleted_at', 'is', null).execute();
      for (const it of items) {
        const copy = await trx
          .insertInto('expense_items')
          .values({
            claim_id: draft.id,
            expense_date: it.expense_date,
            category_id: it.category_id,
            category_name: it.category_name,
            amount: it.amount,
            purpose: it.purpose,
            customer_id: it.customer_id,
            project_id: it.project_id,
            remarks: it.remarks,
            late_submission_reason: it.late_submission_reason,
            category_details: JSON.stringify(it.category_details ?? {}),
            created_by: user.id,
            updated_by: user.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const atts = await trx.selectFrom('expense_attachments').selectAll().where('item_id', '=', it.id).where('deleted_at', 'is', null).execute();
        for (const a of atts) {
          await trx
            .insertInto('expense_attachments')
            .values({
              item_id: copy.id,
              file_name: a.file_name,
              storage_key: a.storage_key,
              mime_type: a.mime_type,
              size_bytes: a.size_bytes,
              sha256: a.sha256,
              uploaded_by: user.id,
            })
            .execute();
        }
      }
      await this.recalc(trx, draft.id, user);
      await this.history(trx, draft.id, {
        from: null,
        to: 'draft',
        action: 'copy',
        actor: user,
        comment: `Copied from ${source.claim_number}`,
        metadata: { source_claim_id: source.id },
      });
      return draft.id;
    });
    return this.getDetail(newId, user);
  }

  async getDetail(id: string, user: AuthUser) {
    await this.getVisibleClaim(id, user);
    const claim = await this.db
      .selectFrom('expense_claims as c')
      .innerJoin('users as emp', 'emp.id', 'c.employee_id')
      .leftJoin('users as mgr', 'mgr.id', 'c.manager_id')
      .leftJoin('regions as r', 'r.id', 'c.region_id')
      .leftJoin('trips as t', 't.id', 'c.trip_id')
      .leftJoin('visits as v', 'v.id', 'c.visit_id')
      .leftJoin('organisations as vo', 'vo.id', 'v.organisation_id')
      .leftJoin('expense_claims as src', 'src.id', 'c.copied_from_claim_id')
      .selectAll('c')
      .select([
        'emp.full_name as employee_name',
        'emp.email as employee_email',
        'emp.employee_code',
        'emp.is_active as employee_active',
        'emp.region_id as employee_region_id',
        'mgr.full_name as manager_name',
        'mgr.is_active as manager_active',
        'r.name as region_name',
        't.trip_date',
        't.base_location as trip_location',
        't.status as trip_status',
        'v.planned_date as visit_date',
        'v.purpose as visit_purpose',
        'v.organisation_id as visit_organisation_id',
        'vo.name as visit_organisation_name',
        'src.claim_number as copied_from_claim_number',
      ])
      .where('c.id', '=', id)
      .executeTakeFirstOrThrow();

    const items = await this.db
      .selectFrom('expense_items as i')
      .innerJoin('expense_categories as cat', 'cat.id', 'i.category_id')
      .leftJoin('organisations as o', 'o.id', 'i.customer_id')
      .leftJoin('projects as p', 'p.id', 'i.project_id')
      .selectAll('i')
      .select([
        'cat.code as category_code',
        'cat.is_active as category_active',
        'cat.receipt_required_above',
        'o.name as customer_name',
        'p.code as project_code',
        'p.name as project_name',
      ])
      .where('i.claim_id', '=', id)
      .where('i.deleted_at', 'is', null)
      .orderBy('i.expense_date')
      .orderBy('i.created_at')
      .execute();

    const itemIds = items.map((i) => i.id);
    const attachments = itemIds.length
      ? await this.db
          .selectFrom('expense_attachments as a')
          .leftJoin('expense_attachments as dup', 'dup.id', 'a.duplicate_of_attachment_id')
          .leftJoin('expense_items as di', 'di.id', 'dup.item_id')
          .leftJoin('expense_claims as dc', 'dc.id', 'di.claim_id')
          .select([
            'a.id',
            'a.item_id',
            'a.file_name',
            'a.mime_type',
            'a.size_bytes',
            'a.uploaded_at',
            'a.duplicate_of_attachment_id',
            'dc.claim_number as duplicate_claim_number',
          ])
          .where('a.item_id', 'in', itemIds)
          .where('a.deleted_at', 'is', null)
          .orderBy('a.uploaded_at')
          .execute()
      : [];

    const history = await this.db
      .selectFrom('expense_approval_history as h')
      .leftJoin('users as u', 'u.id', 'h.actor_id')
      .select(['h.id', 'h.from_status', 'h.to_status', 'h.action', 'h.actor_role', 'h.comment', 'h.metadata', 'h.created_at', 'u.full_name as actor_name'])
      .where('h.claim_id', '=', id)
      .orderBy('h.created_at')
      .orderBy('h.id')
      .execute();

    const lateCutoff = addDays(todayInKolkata(), -this.config.lateSubmissionDays);
    return {
      ...serializeClaim(claim),
      allowed_actions: this.allowedActions(claim, user),
      items: items.map((i) => {
        const its = attachments.filter((a) => a.item_id === i.id);
        const needsReceipt = receiptRequired({ receipt_required_above: money(i.receipt_required_above) }, Number(i.amount));
        return {
          ...serializeItem(i),
          attachments: its,
          receipt_required: needsReceipt,
          receipt_missing: needsReceipt && its.length === 0,
          is_late: i.expense_date < lateCutoff || Boolean(i.late_submission_reason),
          duplicate_flag: (Boolean(i.duplicate_confirmed_at) || its.some((a) => a.duplicate_of_attachment_id)),
        };
      }),
      history,
    };
  }

  async list(query: Record<string, unknown>, user: AuthUser, opts: { mineOnly?: boolean; extra?: (eb: any) => any } = {}) {
    const f = parseExpenseFilters(query, {
      sortable: ['submitted_at', 'created_at', 'updated_at', 'total_claimed', 'claim_number', 'period_from'],
      defaultSort: 'updated_at',
    });
    let base = this.scopedClaims(user)
      .leftJoin('users as mgr', 'mgr.id', 'c.manager_id')
      .leftJoin('regions as r', 'r.id', 'c.region_id')
      .leftJoin('trips as t', 't.id', 'c.trip_id')
      .where((eb) => eb.and(claimFilterExpressions(f, eb, false)));
    if (opts.mineOnly) base = base.where('c.employee_id', '=', user.id);
    if (opts.extra) base = base.where(opts.extra);
    if (hasItemLevelFilter(f)) {
      base = base.where((eb) =>
        eb.exists(
          eb
            .selectFrom('expense_items as i')
            .select('i.id')
            .whereRef('i.claim_id', '=', 'c.id')
            .where('i.deleted_at', 'is', null)
            .where((ieb) => ieb.and(itemFilterExpressions(f, ieb, false))),
        ),
      );
    }

    const totals = await base
      .select([
        sql<number>`count(c.id)::int`.as('count'),
        sql<string>`coalesce(sum(c.total_claimed), 0)`.as('total_claimed'),
        sql<string>`coalesce(sum(c.total_approved), 0)`.as('total_approved'),
      ])
      .executeTakeFirst();

    const rows = await base
      .select([
        'c.id',
        'c.claim_number',
        'c.title',
        'c.status',
        'c.employee_id',
        'c.manager_id',
        'c.trip_id',
        'c.visit_id',
        'c.period_from',
        'c.period_to',
        'c.total_claimed',
        'c.total_approved',
        'c.submitted_at',
        'c.updated_at',
        'c.created_at',
        'c.version',
        'c.last_reviewer_comment',
        // Payment details so the queues and "My expenses" can show how/when a processed claim was paid.
        'c.processed_at',
        'c.tally_voucher_ref',
        'c.payment_reference',
        'c.payment_date',
        'emp.full_name as employee_name',
        'mgr.full_name as manager_name',
        'mgr.is_active as manager_active',
        'r.name as region_name',
        't.trip_date',
        't.base_location as trip_location',
        sql<number>`(select count(*)::int from expense_items i where i.claim_id = c.id and i.deleted_at is null)`.as('item_count'),
      ])
      .orderBy(`c.${f.sort_by}` as any, f.sort_dir)
      .orderBy('c.id')
      .limit(f.page_size)
      .offset((f.page - 1) * f.page_size)
      .execute();

    const total = Number(totals?.count || 0);
    return {
      data: rows.map((r) => ({ ...serializeClaim(r), allowed_actions: this.allowedActions(r, user) })),
      total,
      page: f.page,
      limit: f.page_size,
      totalPages: Math.max(1, Math.ceil(total / f.page_size)),
      totals: {
        count: total,
        total_claimed: Number(totals?.total_claimed || 0),
        total_approved: Number(totals?.total_approved || 0),
      },
    };
  }

  managerQueue(query: Record<string, unknown>, user: AuthUser) {
    return this.list({ sort_by: 'submitted_at', sort_dir: 'asc', ...query, statuses: 'submitted' }, user, {
      extra: (eb: any) => eb.and([eb('c.manager_id', '=', user.id), eb('c.employee_id', '<>', user.id)]),
    });
  }

  accountsQueue(query: Record<string, unknown>, user: AuthUser) {
    if (user.role !== 'accounts' && !isAdminLike(user)) throw new ForbiddenException('The Accounts queue is only available to the Accounts team.');
    const statuses = query.statuses || 'accounts_review,accounts_approved';
    // `processed` = paid: Accounts can look back at what they paid and with which bank reference.
    return this.list({ sort_by: 'submitted_at', sort_dir: 'asc', ...query, statuses }, user, {
      extra: (eb: any) => eb('c.status', 'in', ['accounts_review', 'accounts_approved', 'processed']),
    });
  }

  async badgeCounts(user: AuthUser) {
    const count = async (build: (q: any) => any) => {
      const r = await build(this.scopedClaims(user)).select(sql<number>`count(c.id)::int`.as('n')).executeTakeFirst();
      return Number(r?.n || 0);
    };
    const [manager_pending, accounts_pending, accounts_ready, my_clarifications, my_drafts, approver_inactive] = await Promise.all([
      count((q) => q.where('c.status', '=', 'submitted').where('c.manager_id', '=', user.id).where('c.employee_id', '<>', user.id)),
      user.role === 'accounts' ? count((q) => q.where('c.status', '=', 'accounts_review').where('c.employee_id', '<>', user.id)) : 0,
      user.role === 'accounts' ? count((q) => q.where('c.status', '=', 'accounts_approved').where('c.employee_id', '<>', user.id)) : 0,
      count((q) => q.where('c.status', '=', 'clarification_required').where('c.employee_id', '=', user.id)),
      count((q) => q.where('c.status', '=', 'draft').where('c.employee_id', '=', user.id)),
      isAdminLike(user)
        ? count((q) =>
            q.where('c.status', '=', 'submitted').where(sql<boolean>`exists (select 1 from users mu where mu.id = c.manager_id and mu.is_active = false)`),
          )
        : 0,
    ]);
    // "Manager" is a reporting relationship, not a role: anyone with active direct reports approves claims.
    const team = await this.db
      .selectFrom('users')
      .select('id')
      .where('reporting_manager_id', '=', user.id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return { manager_pending, accounts_pending, accounts_ready, my_clarifications, my_drafts, approver_inactive, has_team: Boolean(team) || manager_pending > 0 };
  }

  /** Employee's own trips/visits that can be linked to a claim (picker data). */
  async linkableTrips(user: AuthUser) {
    const trips = await this.db
      .selectFrom('trips as t')
      .select([
        't.id',
        't.trip_date',
        't.base_location',
        't.status',
        sql<string>`(select min(planned_date)::text from visits v where v.trip_id = t.id)`.as('first_visit'),
        sql<string>`(select max(planned_date)::text from visits v where v.trip_id = t.id)`.as('last_visit'),
        sql<string>`(select o.id from visits v join organisations o on o.id = v.organisation_id where v.trip_id = t.id order by v.planned_date limit 1)`.as('customer_id'),
        sql<string>`(select o.name from visits v join organisations o on o.id = v.organisation_id where v.trip_id = t.id order by v.planned_date limit 1)`.as('customer_name'),
      ])
      .where((eb) =>
        eb.or([
          eb('t.employee_id', '=', user.id),
          eb.exists(
            eb.selectFrom('visits as pv').select('pv.id').whereRef('pv.trip_id', '=', 't.id')
              .where((x) => x.or([x('pv.assigned_to', '=', user.id), x('pv.service_engineer_id', '=', user.id)])),
          ),
        ]),
      )
      .where('t.status', '<>', 'cancelled')
      .orderBy('t.trip_date', 'desc')
      .limit(100)
      .execute();
    const visits = await this.db
      .selectFrom('visits as v')
      .innerJoin('organisations as o', 'o.id', 'v.organisation_id')
      .select(['v.id', 'v.planned_date', 'v.purpose', 'v.status', 'v.trip_id', 'v.organisation_id', 'o.name as organisation_name'])
      .where((eb) => eb.or([eb('v.assigned_to', '=', user.id), eb('v.planned_by', '=', user.id), eb('v.service_engineer_id', '=', user.id)]))
      .where('v.status', '<>', 'cancelled')
      .orderBy('v.planned_date', 'desc')
      .limit(100)
      .execute();
    return { trips, visits };
  }

  // ========================================================================== items
  private async checkMasters(db: DB, errors: FieldErrors, item: { customer_id: string | null; project_id: string | null }, previous?: { customer_id: string | null; project_id: string | null }) {
    if (item.customer_id) {
      const o = await db.selectFrom('organisations').select('id').where('id', '=', item.customer_id).executeTakeFirst();
      if (!o) errors.customer_id = 'Customer not found.';
    }
    if (item.project_id) {
      const p = await db.selectFrom('projects').select(['id', 'is_active', 'name']).where('id', '=', item.project_id).executeTakeFirst();
      if (!p) errors.project_id = 'Project not found.';
      else if (!p.is_active && previous?.project_id !== item.project_id) errors.project_id = `Project "${p.name}" is no longer active.`;
    }
  }

  async saveItem(claimId: string, itemId: string | null, dto: ExpenseItemDto, user: AuthUser) {
    const claim = await this.getVisibleClaim(claimId, user);
    this.assertOwnerEditable(claim, user);
    const expectedVersion = readVersion(dto.version, false);

    let existing: any = null;
    if (itemId) {
      if (!UUID.test(itemId)) throw new NotFoundException('Expense item not found');
      existing = await this.db
        .selectFrom('expense_items')
        .selectAll()
        .where('id', '=', itemId)
        .where('claim_id', '=', claimId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!existing) throw new NotFoundException('Expense item not found');
    }

    // On edit, unspecified fields keep their current values.
    const input: ItemInput = existing
      ? {
          expense_date: dto.expense_date ?? existing.expense_date,
          category_id: dto.category_id ?? existing.category_id,
          amount: dto.amount ?? existing.amount,
          purpose: dto.purpose ?? existing.purpose,
          customer_id: dto.customer_id !== undefined ? dto.customer_id : existing.customer_id,
          project_id: dto.project_id !== undefined ? dto.project_id : existing.project_id,
          remarks: dto.remarks !== undefined ? dto.remarks : existing.remarks,
          late_submission_reason: dto.late_submission_reason !== undefined ? dto.late_submission_reason : existing.late_submission_reason,
          category_details: dto.category_details !== undefined ? dto.category_details : existing.category_details,
        }
      : dto;

    const category = await this.loadCategory(this.db, input.category_id);
    const window = await this.windowForClaim(this.db, claim);
    const item = validateItem(input, {
      category,
      today: todayInKolkata(),
      config: this.config,
      window,
      categoryUnchanged: Boolean(existing && existing.category_id === input.category_id),
    });
    const masterErrors: FieldErrors = {};
    await this.checkMasters(this.db, masterErrors, item, existing ?? undefined);
    if (Object.keys(masterErrors).length) throw new ExpenseValidationException(masterErrors);

    // Duplicate detection (§5.11): needs explicit confirmation, which is logged.
    const duplicates = await this.findDuplicates(this.db, claim.employee_id, item.expense_date, item.category_id, item.amount, itemId ?? undefined);
    const confirmed = dto.confirm_not_duplicate === true;
    const alreadyConfirmed =
      existing?.duplicate_confirmed_at &&
      existing.expense_date === item.expense_date &&
      existing.category_id === item.category_id &&
      Number(existing.amount) === item.amount;
    if (duplicates.length && !confirmed && !alreadyConfirmed) {
      throw new BadRequestException({
        message: `This looks like a duplicate of an expense already claimed on ${duplicates.map((d) => d.claim_number).join(', ')}.`,
        code: 'DUPLICATE_CONFIRMATION_REQUIRED',
        errors: { confirm_not_duplicate: 'Same date, category and amount already claimed. Confirm this is not a duplicate to continue.' },
        duplicates,
      });
    }

    const warnings: string[] = [];
    if (category?.code === 'HOTEL') warnings.push(...(await this.hotelOverlapWarnings(this.db, claim.employee_id, item.category_details, itemId ?? undefined)));
    if (item.amount_recomputed) warnings.push(`Amount recalculated from distance × rate: ${formatExpenseAmount(item.amount)}.`);
    if (item.is_late) warnings.push(`Late submission: older than ${this.config.lateSubmissionDays} days — it will be flagged to your approver.`);

    const values = {
      expense_date: item.expense_date,
      category_id: item.category_id,
      category_name: category!.name,
      amount: item.amount,
      purpose: item.purpose,
      customer_id: item.customer_id,
      project_id: item.project_id,
      remarks: item.remarks,
      late_submission_reason: item.late_submission_reason,
      category_details: JSON.stringify(item.category_details),
      duplicate_confirmed_at: duplicates.length ? (alreadyConfirmed ? existing.duplicate_confirmed_at : new Date()) : null,
      duplicate_of_item_id: duplicates.length ? duplicates[0].item_id : null,
      updated_by: user.id,
    };

    const saved = await this.db.transaction().execute(async (trx) => {
      const locked = await this.lockClaim(trx, claimId);
      this.assertOwnerEditable(locked, user);
      if (expectedVersion !== null && locked.version !== expectedVersion) throw staleVersion();
      const row = existing
        ? await trx.updateTable('expense_items').set(values).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow()
        : await trx.insertInto('expense_items').values({ ...values, claim_id: claimId, created_by: user.id }).returningAll().executeTakeFirstOrThrow();
      await this.recalc(trx, claimId, user);
      if (locked.status === 'clarification_required') {
        await this.history(trx, claimId, {
          from: locked.status,
          to: locked.status,
          action: 'clarification_edit',
          actor: user,
          comment: existing ? `Edited line "${row.purpose}"` : `Added line "${row.purpose}"`,
          metadata: { item_id: row.id, before: existing ? serializeItem(existing) : null, after: serializeItem(row) },
        });
      }
      if (duplicates.length && !alreadyConfirmed) {
        await this.history(trx, claimId, {
          from: locked.status,
          to: locked.status,
          action: 'duplicate_confirmed',
          actor: user,
          comment: `Employee confirmed "${row.purpose}" is not a duplicate of ${duplicates.map((d) => d.claim_number).join(', ')}.`,
          metadata: { item_id: row.id, duplicates },
        });
      }
      return row;
    });

    if (duplicates.length && !alreadyConfirmed) {
      this.events.emit('audit.log', {
        actorId: user.id,
        entityType: 'expense_item',
        entityId: saved.id,
        action: 'duplicate_confirmed',
        newValue: { duplicates },
      });
    }
    const fresh = await this.db.selectFrom('expense_claims').select(['version', 'total_claimed']).where('id', '=', claimId).executeTakeFirstOrThrow();
    return {
      item: serializeItem(saved),
      claim: { id: claimId, version: fresh.version, total_claimed: Number(fresh.total_claimed) },
      warnings,
    };
  }

  async deleteItem(claimId: string, itemId: string, user: AuthUser, version?: unknown) {
    const claim = await this.getVisibleClaim(claimId, user);
    this.assertOwnerEditable(claim, user);
    const expectedVersion = readVersion(version, false);
    if (!UUID.test(itemId)) throw new NotFoundException('Expense item not found');
    await this.db.transaction().execute(async (trx) => {
      const locked = await this.lockClaim(trx, claimId);
      this.assertOwnerEditable(locked, user);
      if (expectedVersion !== null && locked.version !== expectedVersion) throw staleVersion();
      const item = await trx
        .updateTable('expense_items')
        .set({ deleted_at: new Date(), updated_by: user.id })
        .where('id', '=', itemId)
        .where('claim_id', '=', claimId)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!item) throw new NotFoundException('Expense item not found');
      await trx.updateTable('expense_attachments').set({ deleted_at: new Date() }).where('item_id', '=', itemId).where('deleted_at', 'is', null).execute();
      await this.recalc(trx, claimId, user);
      if (locked.status === 'clarification_required') {
        await this.history(trx, claimId, {
          from: locked.status,
          to: locked.status,
          action: 'clarification_edit',
          actor: user,
          comment: `Removed line "${item.purpose}"`,
          metadata: { item_id: itemId, before: serializeItem(item), after: null },
        });
      }
    });
    const fresh = await this.db.selectFrom('expense_claims').select(['version', 'total_claimed']).where('id', '=', claimId).executeTakeFirstOrThrow();
    return { id: itemId, deleted: true, claim: { id: claimId, version: fresh.version, total_claimed: Number(fresh.total_claimed) } };
  }

  /** Used by the workflow service and tests; kept here so both share the same rule lookup. */
  ruleFor(status: string, action: ExpenseClaimAction) {
    return findExpenseTransition(status, action);
  }
}
