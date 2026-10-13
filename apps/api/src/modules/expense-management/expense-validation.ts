/**
 * Pure validation rules for expense line items (§5 of the Module 9 brief).
 * No database access here, so every rule is unit-testable; the service supplies the
 * looked-up context (category row, trip window, today's date) and runs the DB-backed
 * checks (duplicates, overlaps, inactive masters) itself.
 */
import { BadRequestException } from '@nestjs/common';
import {
  CATEGORY_DETAIL_KIND,
  MEAL_TYPES,
  TRAVEL_MODES,
  hotelNights,
  roundMoney,
  formatExpenseAmount,
} from '@arihant/shared';
import type { ExpenseConfig } from './expense.config.js';

export const TEXT_LIMITS = {
  title: 200,
  purpose: 500,
  remarks: 1000,
  comment: 1000,
  short: 120,
  reference: 100,
} as const;

export type FieldErrors = Record<string, string>;

/** 400 with field-level errors the web form can show under each input. */
export class ExpenseValidationException extends BadRequestException {
  constructor(errors: FieldErrors, message = 'Please correct the highlighted fields.', code = 'VALIDATION_FAILED') {
    super({ message, code, errors });
  }
}

export function throwIfErrors(errors: FieldErrors, message?: string) {
  if (Object.keys(errors).length > 0) throw new ExpenseValidationException(errors, message);
}

/** Strips HTML tags and control characters, trims, and returns null for empty input. */
export function sanitizeText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (!s) return null;
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

/** Like sanitizeText but reports an error instead of silently truncating. */
export function readText(
  errors: FieldErrors,
  field: string,
  value: unknown,
  maxLength: number,
  opts: { required?: boolean; label?: string; minLength?: number } = {},
): string | null {
  const label = opts.label || field;
  if (value !== null && value !== undefined && typeof value !== 'string') {
    errors[field] = `${label} must be text.`;
    return null;
  }
  const raw = value === null || value === undefined ? '' : String(value).replace(/<[^>]*>/g, '').trim();
  if (raw.length > maxLength) {
    errors[field] = `${label} must be at most ${maxLength} characters.`;
    return null;
  }
  const clean = sanitizeText(value, maxLength);
  if (opts.required && !clean) {
    errors[field] = `${label} is required.`;
    return null;
  }
  if (clean && opts.minLength && clean.length < opts.minLength) {
    errors[field] = `${label} must be at least ${opts.minLength} characters.`;
    return null;
  }
  return clean;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Accepts a JSON number or numeric string. Rejects zero/negative values, NaN, non-numeric
 * strings, scientific notation and more than two decimals.
 */
export function parseAmount(
  value: unknown,
  maxAmount: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: false, error: 'Amount is required.' };
  if (typeof value !== 'number' && typeof value !== 'string') return { ok: false, error: 'Amount must be a number.' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, error: 'Amount must be a number.' };
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (/e/i.test(text)) return { ok: false, error: 'Amount must be a plain number (no scientific notation).' };
  if (text.startsWith('-')) return { ok: false, error: 'Amount must be greater than zero.' };
  if (!AMOUNT_PATTERN.test(text)) {
    return /^\d+\.\d{3,}$/.test(text)
      ? { ok: false, error: 'Amount can have at most 2 decimal places.' }
      : { ok: false, error: 'Amount must be a number.' };
  }
  const n = Number(text);
  if (n <= 0) return { ok: false, error: 'Amount must be greater than zero.' };
  if (n > maxAmount) return { ok: false, error: `Amount cannot exceed ${formatExpenseAmount(maxAmount)} per item.` };
  return { ok: true, value: roundMoney(n) };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface CategoryRule {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  receipt_required_above: number | null;
  max_amount_per_item: number | null;
  cap_is_hard: boolean;
  requires_customer_or_project: boolean;
  requires_remark: boolean;
}

export interface ItemInput {
  expense_date?: unknown;
  category_id?: unknown;
  amount?: unknown;
  purpose?: unknown;
  customer_id?: unknown;
  project_id?: unknown;
  remarks?: unknown;
  late_submission_reason?: unknown;
  category_details?: unknown;
}

export interface ItemContext {
  category: CategoryRule | null;
  today: string;
  config: Pick<ExpenseConfig, 'maxItemAmount' | 'lateSubmissionDays'>;
  /** Inclusive window the item date must fall in (trip/visit dates ± tolerance), if linked. */
  window?: { from: string; to: string; label: string } | null;
  /** True when the category is unchanged on an edit of an existing item (historic inactive category allowed). */
  categoryUnchanged?: boolean;
}

export interface NormalizedItem {
  expense_date: string;
  category_id: string;
  amount: number;
  purpose: string;
  customer_id: string | null;
  project_id: string | null;
  remarks: string | null;
  late_submission_reason: string | null;
  category_details: Record<string, unknown>;
  is_late: boolean;
  /** True when the server replaced the client amount (e.g. km × rate). */
  amount_recomputed: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalUuid = (errors: FieldErrors, field: string, v: unknown, label: string): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) {
    errors[field] = `${label} is not valid.`;
    return null;
  }
  return v;
};

function positiveNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Validates and whitelists category-specific fields; returns the cleaned details object. */
export function validateCategoryDetails(
  code: string,
  raw: unknown,
  errors: FieldErrors,
): { details: Record<string, unknown>; computedAmount: number | null } {
  const kind = CATEGORY_DETAIL_KIND[code];
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const err = (f: string, m: string) => (errors[`category_details.${f}`] = m);
  const text = (f: string, label: string) => {
    const v = sanitizeText(d[f], TEXT_LIMITS.short);
    if (!v) err(f, `${label} is required.`);
    return v;
  };

  switch (kind) {
    case 'travel': {
      const from = text('from', 'From');
      const to = text('to', 'To');
      const mode = typeof d.mode === 'string' ? d.mode : '';
      if (!(TRAVEL_MODES as readonly string[]).includes(mode)) err('mode', 'Choose a travel mode.');
      return { details: { from, to, mode }, computedAmount: null };
    }
    case 'hotel': {
      const hotel_name = text('hotel_name', 'Hotel name');
      const check_in = isIsoDate(d.check_in) ? d.check_in : null;
      const check_out = isIsoDate(d.check_out) ? d.check_out : null;
      if (!check_in) err('check_in', 'Check-in date is required.');
      if (!check_out) err('check_out', 'Check-out date is required.');
      let nights = 0;
      if (check_in && check_out) {
        nights = hotelNights(check_in, check_out);
        if (nights <= 0) err('check_out', 'Check-out must be after check-in.');
        else if (nights > 60) err('check_out', 'A single hotel stay cannot exceed 60 nights.');
      }
      return { details: { hotel_name, check_in, check_out, nights }, computedAmount: null };
    }
    case 'conveyance': {
      const from = text('from', 'From');
      const to = text('to', 'To');
      const km = positiveNumber(d.km);
      const rate = positiveNumber(d.rate_per_km);
      if (d.km !== undefined && d.km !== null && d.km !== '' && km === null) err('km', 'Distance must be greater than zero.');
      if (km !== null && km > 2000) err('km', 'Distance cannot exceed 2,000 km for local conveyance.');
      if (d.rate_per_km !== undefined && d.rate_per_km !== null && d.rate_per_km !== '' && rate === null) {
        err('rate_per_km', 'Rate per km must be greater than zero.');
      }
      if (rate !== null && rate > 100) err('rate_per_km', 'Rate per km cannot exceed ₹100.');
      if ((km === null) !== (rate === null) && !errors['category_details.km'] && !errors['category_details.rate_per_km']) {
        err(km === null ? 'km' : 'rate_per_km', 'Enter both distance and rate per km, or neither.');
      }
      const computed = km !== null && rate !== null ? roundMoney(km * rate) : null;
      return {
        details: { from, to, ...(km !== null ? { km } : {}), ...(rate !== null ? { rate_per_km: rate } : {}) },
        computedAmount: computed,
      };
    }
    case 'food': {
      const meal_type = typeof d.meal_type === 'string' ? d.meal_type : '';
      if (!(MEAL_TYPES as readonly string[]).includes(meal_type)) err('meal_type', 'Choose a meal type.');
      const persons = Number(d.persons);
      if (!Number.isInteger(persons) || persons < 1 || persons > 50) err('persons', 'Persons must be a whole number between 1 and 50.');
      return { details: { meal_type, persons: Number.isInteger(persons) ? persons : null }, computedAmount: null };
    }
    default:
      return { details: {}, computedAmount: null };
  }
}

/**
 * Validates a line item against the brief's rules 2–4, 6 (dates), 7, 8, 9, 10 (category) and 14.
 * Throws ExpenseValidationException with every field error at once.
 */
export function validateItem(input: ItemInput, ctx: ItemContext): NormalizedItem {
  const errors: FieldErrors = {};

  // Date — DATE semantics, compared in the business timezone.
  let expense_date = '';
  if (!isIsoDate(input.expense_date)) {
    errors.expense_date = 'Expense date is required (YYYY-MM-DD).';
  } else {
    expense_date = input.expense_date;
    if (expense_date > ctx.today) errors.expense_date = 'Expense date cannot be in the future.';
    if (ctx.window && !errors.expense_date && (expense_date < ctx.window.from || expense_date > ctx.window.to)) {
      errors.expense_date = `Date must fall within the ${ctx.window.label} (${ctx.window.from} to ${ctx.window.to}).`;
    }
  }
  const lateCutoff = ctx.today ? addDays(ctx.today, -ctx.config.lateSubmissionDays) : '';
  const is_late = Boolean(expense_date && expense_date < lateCutoff);
  const late_submission_reason = readText(errors, 'late_submission_reason', input.late_submission_reason, TEXT_LIMITS.remarks, {
    label: 'Late submission reason',
  });
  if (is_late && (!late_submission_reason || late_submission_reason.length < 5) && !errors.late_submission_reason) {
    errors.late_submission_reason = `This expense is older than ${ctx.config.lateSubmissionDays} days — explain the late submission (min 5 characters).`;
  }

  // Category
  const cat = ctx.category;
  if (!cat) errors.category_id = 'Choose a valid category.';
  else if (!cat.is_active && !ctx.categoryUnchanged) errors.category_id = `Category "${cat.name}" is no longer active.`;

  const purpose = readText(errors, 'purpose', input.purpose, TEXT_LIMITS.purpose, { required: true, label: 'Purpose' });
  const remarks = readText(errors, 'remarks', input.remarks, TEXT_LIMITS.remarks, { label: 'Remarks' });
  const customer_id = optionalUuid(errors, 'customer_id', input.customer_id, 'Customer');
  const project_id = optionalUuid(errors, 'project_id', input.project_id, 'Project');

  // Category-specific details (may override the amount).
  const { details, computedAmount } = cat
    ? validateCategoryDetails(cat.code, input.category_details, errors)
    : { details: {}, computedAmount: null };

  let amount = 0;
  let amount_recomputed = false;
  if (computedAmount !== null) {
    if (computedAmount <= 0 || computedAmount > ctx.config.maxItemAmount) {
      errors.amount = `Distance × rate must be between ₹0.01 and ${formatExpenseAmount(ctx.config.maxItemAmount)}.`;
    } else {
      amount = computedAmount;
      const clientAmount = parseAmount(input.amount, Number.MAX_SAFE_INTEGER);
      amount_recomputed = !clientAmount.ok || clientAmount.value !== computedAmount;
    }
  } else {
    const parsed = parseAmount(input.amount, ctx.config.maxItemAmount);
    if ('error' in parsed) errors.amount = parsed.error;
    else amount = parsed.value;
  }

  if (cat) {
    if (cat.requires_customer_or_project && !customer_id && !project_id && !errors.customer_id && !errors.project_id) {
      errors.customer_id = `${cat.name} must be linked to a customer or a project.`;
    }
    if (cat.requires_remark && !remarks && !errors.remarks) {
      errors.remarks = `Remarks are mandatory for ${cat.name}.`;
    }
    if (amount > 0 && cat.max_amount_per_item !== null && amount > cat.max_amount_per_item) {
      const cap = formatExpenseAmount(cat.max_amount_per_item);
      if (cat.cap_is_hard) errors.amount = `${cat.name} is capped at ${cap} per item.`;
      else if (!remarks && !errors.remarks) errors.remarks = `Amount exceeds the ${cap} limit for ${cat.name} — add a remark explaining why.`;
    }
  }

  throwIfErrors(errors);
  return {
    expense_date,
    category_id: cat!.id,
    amount,
    purpose: purpose!,
    customer_id,
    project_id,
    remarks,
    late_submission_reason: is_late ? late_submission_reason : null,
    category_details: details,
    is_late,
    amount_recomputed,
  };
}

/** True when the category demands a receipt at this amount (0 = always, null = never). */
export function receiptRequired(category: Pick<CategoryRule, 'receipt_required_above'>, amount: number): boolean {
  if (category.receipt_required_above === null || category.receipt_required_above === undefined) return false;
  return amount >= Number(category.receipt_required_above);
}

/** Magic-byte sniffing so a renamed .exe cannot pass as a receipt. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'image/heic';
  }
  return null;
}

/** Keeps a safe, readable file name (no paths, no control or shell characters). */
export function sanitizeFileName(name: string): string {
  const base = String(name || 'receipt').split(/[\\/]/).pop() || 'receipt';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'receipt').slice(0, 150);
}

export const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
};
