/**
 * Module 8 shared helpers: field-level validation errors, 409s, input readers and file sniffing.
 * Text sanitising is reused from Module 9 (strip tags/control chars, report rather than truncate).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { isIsoDateString, istDateTime, istEndOfDay } from '@arihant/shared';
import { readText, sanitizeFileName } from '../expense-management/expense-validation.js';

export { readText, sanitizeFileName };
export type FieldErrors = Record<string, string>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 400 with field-level errors the forms render under each input. */
export class TaskValidationException extends BadRequestException {
  constructor(errors: FieldErrors, message = 'Please correct the highlighted fields.', code = 'VALIDATION_FAILED') {
    super({ message, code, errors });
  }
}

export function throwIfErrors(errors: FieldErrors, message?: string) {
  if (Object.keys(errors).length) throw new TaskValidationException(errors, message);
}

export function conflict(message: string, code = 'INVALID_TRANSITION'): ConflictException {
  return new ConflictException({ message, code });
}

export function staleVersion(): ConflictException {
  return new ConflictException({ message: 'Task updated by someone else, please refresh.', code: 'STALE_VERSION' });
}

/** Mandatory on every mutation of an existing task (optimistic locking). */
export function readVersion(v: unknown): number {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  if (v === '' || !Number.isInteger(n) || n < 1) {
    throw new TaskValidationException({ version: 'version is required — refresh and try again.' });
  }
  return n;
}

export function readUuid(errors: FieldErrors, field: string, value: unknown, opts: { required?: boolean; label?: string } = {}): string | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) errors[field] = `${opts.label || field} is required.`;
    return null;
  }
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors[field] = `${opts.label || field} is not valid.`;
    return null;
  }
  return value;
}

export function readUuidList(errors: FieldErrors, field: string, value: unknown, label: string): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',') : [];
  const out = Array.from(new Set(raw.map((v) => String(v).trim()).filter(Boolean)));
  if (out.some((v) => !UUID_RE.test(v))) errors[field] = `${label} contains an invalid id.`;
  return out.filter((v) => UUID_RE.test(v));
}

export function readBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function readInt(errors: FieldErrors, field: string, value: unknown, opts: { min: number; max: number; label: string; required?: boolean }): number | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) errors[field] = `${opts.label} is required.`;
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < opts.min || n > opts.max) {
    errors[field] = `${opts.label} must be a whole number between ${opts.min} and ${opts.max}.`;
    return null;
  }
  return n;
}

export function readDate(errors: FieldErrors, field: string, value: unknown, opts: { required?: boolean; label: string }): string | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) errors[field] = `${opts.label} is required.`;
    return null;
  }
  if (!isIsoDateString(value)) {
    errors[field] = `${opts.label} must be a valid date.`;
    return null;
  }
  return value;
}

/**
 * Deadlines arrive as a date ("2026-10-20" → 23:59:59 IST that day), an IST wall-clock time
 * ("2026-10-20T15:30") or a full ISO instant with offset.
 */
const MAX_FUTURE_YEARS = 10;

export function readDeadline(errors: FieldErrors, field: string, value: unknown, opts: { required?: boolean; label: string }): Date | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) errors[field] = `${opts.label} is required.`;
    return null;
  }
  if (typeof value !== 'string') {
    errors[field] = `${opts.label} must be a date or date-time.`;
    return null;
  }
  let d: Date | null = null;
  if (isIsoDateString(value)) d = istEndOfDay(value);
  else {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(value);
    if (m && isIsoDateString(m[1])) d = istDateTime(m[1], `${m[2]}${m[3] || ':00'}`);
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) {
    errors[field] = `${opts.label} must be a valid date or date-time.`;
    return null;
  }
  // Delay and excused time are stored in whole minutes; an absurd year would overflow them (and is never a real deadline).
  if (d.getTime() > Date.now() + MAX_FUTURE_YEARS * 365.25 * 86400000) {
    errors[field] = `${opts.label} must be within the next ${MAX_FUTURE_YEARS} years.`;
    return null;
  }
  return d;
}

export function readEnum<T extends string>(errors: FieldErrors, field: string, value: unknown, allowed: readonly T[], opts: { label: string; required?: boolean; fallback?: T }): T | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) errors[field] = `${opts.label} is required.`;
    return opts.fallback ?? null;
  }
  if (!allowed.includes(value as T)) {
    errors[field] = `${opts.label} is not valid.`;
    return null;
  }
  return value as T;
}

/** Mandatory comment for manager/workflow actions. */
export function readComment(value: unknown, opts: { required: boolean; min?: number; field?: string; label?: string; max?: number }): string | null {
  const errors: FieldErrors = {};
  const field = opts.field || 'comment';
  const out = readText(errors, field, value, opts.max ?? 2000, { required: opts.required, minLength: opts.required ? opts.min : undefined, label: opts.label || 'Comment' });
  throwIfErrors(errors);
  return out;
}

// ---------------------------------------------------------------- files
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Validates by file content, not the client's MIME header. ZIP (DOCX/XLSX) and OLE (DOC/XLS)
 * containers are confirmed by signature and then typed by extension.
 */
export function sniffTaskFile(buf: Buffer, fileName: string): { mime: string; ext: string } | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const is = (bytes: number[], offset = 0) => buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: EXT_MIME.pdf, ext: 'pdf' };
  if (is([0xff, 0xd8, 0xff])) return { mime: EXT_MIME.jpg, ext: 'jpg' };
  if (is([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: EXT_MIME.png, ext: 'png' };
  if (is([0x50, 0x4b, 0x03, 0x04]) && (ext === 'docx' || ext === 'xlsx')) return { mime: EXT_MIME[ext], ext };
  if (is([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && (ext === 'doc' || ext === 'xls')) return { mime: EXT_MIME[ext], ext };
  return null;
}
