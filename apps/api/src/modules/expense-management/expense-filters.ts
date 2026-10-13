/**
 * Shared filter parsing for claim lists, item reports and exports (§5.29–33, §6).
 * Multi-value params accept repeated keys or comma-separated values.
 */
import { sql, type ExpressionBuilder } from 'kysely';
import { EXPENSE_CLAIM_STATUSES } from '@arihant/shared';
import { ExpenseValidationException, isIsoDate, type FieldErrors } from './expense-validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExpenseFilters {
  employee_ids: string[];
  trip_id: string | null;
  visit_id: string | null;
  customer_ids: string[];
  project_ids: string[];
  category_ids: string[];
  region_ids: string[];
  statuses: string[];
  claim_ids: string[];
  date_from: string | null;
  date_to: string | null;
  date_field: 'expense_date' | 'submitted_at';
  amount_min: number | null;
  amount_max: number | null;
  search: string | null;
  approved_only: boolean;
  approver_inactive: boolean;
  page: number;
  page_size: number;
  sort_by: string;
  sort_dir: 'asc' | 'desc';
}

function list(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .flatMap((x) => String(x).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

function uuidList(errors: FieldErrors, field: string, v: unknown): string[] {
  const ids = list(v);
  if (ids.some((id) => !UUID.test(id))) errors[field] = `${field} must contain valid ids.`;
  return ids.filter((id) => UUID.test(id));
}

function amount(errors: FieldErrors, field: string, v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    errors[field] = `${field} must be a non-negative amount.`;
    return null;
  }
  return Number(s);
}

export function parseExpenseFilters(
  q: Record<string, unknown>,
  opts: { sortable: string[]; defaultSort: string; maxPageSize?: number },
): ExpenseFilters {
  const errors: FieldErrors = {};
  const date_from = q.date_from ? String(q.date_from) : null;
  const date_to = q.date_to ? String(q.date_to) : null;
  if (date_from && !isIsoDate(date_from)) errors.date_from = 'date_from must be YYYY-MM-DD.';
  if (date_to && !isIsoDate(date_to)) errors.date_to = 'date_to must be YYYY-MM-DD.';
  if (date_from && date_to && !errors.date_from && !errors.date_to && date_from > date_to) {
    errors.date_to = '"To" date must be on or after the "From" date.';
  }
  const date_field = q.date_field === 'submitted_at' ? 'submitted_at' : 'expense_date';
  if (q.date_field && q.date_field !== 'submitted_at' && q.date_field !== 'expense_date') {
    errors.date_field = 'date_field must be expense_date or submitted_at.';
  }

  const statuses = list(q.statuses ?? q.status);
  const bad = statuses.filter((s) => !(EXPENSE_CLAIM_STATUSES as string[]).includes(s));
  if (bad.length) errors.statuses = `Unknown status: ${bad.join(', ')}.`;

  const amount_min = amount(errors, 'amount_min', q.amount_min);
  const amount_max = amount(errors, 'amount_max', q.amount_max);
  if (amount_min !== null && amount_max !== null && amount_min > amount_max) {
    errors.amount_max = 'Maximum amount must be greater than or equal to the minimum.';
  }

  const trip_id = q.trip_id ? String(q.trip_id) : null;
  if (trip_id && !UUID.test(trip_id)) errors.trip_id = 'trip_id must be a valid id.';
  const visit_id = q.visit_id ? String(q.visit_id) : null;
  if (visit_id && !UUID.test(visit_id)) errors.visit_id = 'visit_id must be a valid id.';

  const sort_by = opts.sortable.includes(String(q.sort_by)) ? String(q.sort_by) : opts.defaultSort;
  const sort_dir = String(q.sort_dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const maxPage = opts.maxPageSize ?? 100;

  const filters: ExpenseFilters = {
    employee_ids: uuidList(errors, 'employee_ids', q.employee_ids ?? q.employee_id),
    trip_id: errors.trip_id ? null : trip_id,
    visit_id: errors.visit_id ? null : visit_id,
    customer_ids: uuidList(errors, 'customer_ids', q.customer_ids ?? q.customer_id),
    project_ids: uuidList(errors, 'project_ids', q.project_ids ?? q.project_id),
    category_ids: uuidList(errors, 'category_ids', q.category_ids ?? q.category_id),
    region_ids: uuidList(errors, 'region_ids', q.region_ids ?? q.region_id),
    claim_ids: uuidList(errors, 'claim_ids', q.claim_ids),
    statuses,
    date_from,
    date_to,
    date_field,
    amount_min,
    amount_max,
    search: q.search ? String(q.search).trim().slice(0, 100) || null : null,
    approved_only: q.approved_only === 'true' || q.approved_only === true,
    approver_inactive: q.approver_inactive === 'true' || q.approver_inactive === true,
    page: Math.max(1, Math.floor(Number(q.page)) || 1),
    page_size: Math.min(maxPage, Math.max(1, Math.floor(Number(q.page_size ?? q.limit)) || 20)),
    sort_by,
    sort_dir,
  };
  if (Object.keys(errors).length) throw new ExpenseValidationException(errors, 'Invalid filters.');
  return filters;
}

/** Submitted date in the business timezone, for inclusive DATE comparisons. */
export const submittedDateIst = sql<string>`((c.submitted_at at time zone 'Asia/Kolkata')::date)`;

/** Claim-level conditions (alias `c`, owner `emp`). Item-level ones are applied via EXISTS. */
export function claimFilterExpressions(f: ExpenseFilters, eb: ExpressionBuilder<any, any>, itemLevel: boolean) {
  const conds: any[] = [];
  if (f.employee_ids.length) conds.push(eb('c.employee_id', 'in', f.employee_ids));
  if (f.trip_id) conds.push(eb('c.trip_id', '=', f.trip_id));
  if (f.visit_id) conds.push(eb('c.visit_id', '=', f.visit_id));
  if (f.region_ids.length) conds.push(eb('c.region_id', 'in', f.region_ids));
  if (f.statuses.length) conds.push(eb('c.status', 'in', f.statuses));
  if (f.claim_ids.length) conds.push(eb('c.id', 'in', f.claim_ids));
  if (f.approver_inactive) {
    conds.push(eb('c.status', '=', 'submitted'));
    conds.push(sql<boolean>`exists (select 1 from users mu where mu.id = c.manager_id and mu.is_active = false)`);
  }
  if (f.search) {
    const s = `%${f.search.toLowerCase()}%`;
    conds.push(
      sql<boolean>`(lower(c.claim_number) like ${s} or lower(c.title) like ${s} or lower(emp.full_name) like ${s})`,
    );
  }
  if (f.date_field === 'submitted_at') {
    if (f.date_from) conds.push(sql<boolean>`${submittedDateIst} >= ${f.date_from}::date`);
    if (f.date_to) conds.push(sql<boolean>`${submittedDateIst} <= ${f.date_to}::date`);
  }
  if (!itemLevel) {
    if (f.amount_min !== null) conds.push(eb('c.total_claimed', '>=', f.amount_min));
    if (f.amount_max !== null) conds.push(eb('c.total_claimed', '<=', f.amount_max));
  }
  return conds;
}

/** Item-level conditions (alias `i`). */
export function itemFilterExpressions(f: ExpenseFilters, eb: ExpressionBuilder<any, any>, includeAmount = true) {
  const conds: any[] = [];
  if (f.category_ids.length) conds.push(eb('i.category_id', 'in', f.category_ids));
  if (f.customer_ids.length) conds.push(eb('i.customer_id', 'in', f.customer_ids));
  if (f.project_ids.length) conds.push(eb('i.project_id', 'in', f.project_ids));
  if (f.date_field === 'expense_date') {
    if (f.date_from) conds.push(eb('i.expense_date', '>=', f.date_from));
    if (f.date_to) conds.push(eb('i.expense_date', '<=', f.date_to));
  }
  if (includeAmount && f.amount_min !== null) conds.push(eb('i.amount', '>=', f.amount_min));
  if (includeAmount && f.amount_max !== null) conds.push(eb('i.amount', '<=', f.amount_max));
  if (f.approved_only) conds.push(eb('i.item_status', 'in', ['approved', 'partially_approved']));
  return conds;
}

export function hasItemLevelFilter(f: ExpenseFilters): boolean {
  return (
    f.category_ids.length > 0 ||
    f.customer_ids.length > 0 ||
    f.project_ids.length > 0 ||
    (f.date_field === 'expense_date' && Boolean(f.date_from || f.date_to))
  );
}
