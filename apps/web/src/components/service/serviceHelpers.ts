import { istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import { ApiError } from '@/lib/api';
import {
  SERVICE_SLA_PAUSE_STATUSES,
  SERVICE_STATUS_LABELS,
  normalizeServiceStatus,
  type ServiceStatus,
} from '@arihant/shared';

/** Turn any thrown value (ApiError with string|array message, Error, unknown) into one readable line. */
export function errMsg(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    const m: any = err.message;
    if (Array.isArray(m)) return m.join(' · ');
    if (typeof m === 'string' && m) return m;
    const dm = err.data?.message;
    if (Array.isArray(dm)) return dm.join(' · ');
    if (typeof dm === 'string' && dm) return dm;
    return fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const isConflict = (err: unknown) => err instanceof ApiError && err.status === 409;

/** A date/instant from the API as its IST calendar day (YYYY-MM-DD). */
export const dateOnly = (v: unknown): string => calendarDay(v);

/** Today's business date (YYYY-MM-DD) in IST — not the browser's zone, not UTC. */
export function todayLocal(): string {
  return istToday();
}

export function statusLabel(status: string | null | undefined): string {
  const s = normalizeServiceStatus(status);
  return SERVICE_STATUS_LABELS[s] || String(status || '').replace(/_/g, ' ');
}

export function statusBadgeVariant(status: string | null | undefined): 'default' | 'success' | 'info' | 'warning' | 'urgent' | 'danger' {
  const s = normalizeServiceStatus(status);
  if (['resolved', 'report_submitted', 'closed'].includes(s)) return 'success';
  if (s === 'cancelled') return 'default';
  if (s === 'in_progress' || s === 'visit_scheduled' || s === 'assigned') return 'info';
  if (['awaiting_part', 'awaiting_customer', 'on_hold', 'revisit_required', 'reopened'].includes(s)) return 'warning';
  if (s === 'escalated') return 'urgent';
  return 'default';
}

/** Warranty coverage in words; tickets store either a code (in_warranty / amc / out_of_warranty) or a label. */
export function warrantyLabel(value: string | null | undefined): string {
  const v = String(value || '').trim();
  const code = v.toLowerCase().replace(/[\s-]+/g, '_');
  if (code === 'in_warranty' || code === 'under_warranty') return 'In warranty';
  if (code === 'amc' || code === 'under_amc') return 'Under AMC';
  if (code === 'out_of_warranty' || code === 'billable') return 'Out of warranty (billable)';
  if (code === 'partial_coverage') return 'Partial coverage';
  return v ? v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Not recorded';
}

export const isSlaPaused = (ticket: any): boolean =>
  !!ticket?.sla_pause_started_at || SERVICE_SLA_PAUSE_STATUSES.includes(normalizeServiceStatus(ticket?.status));

export const isFinished = (status: string | null | undefined): boolean =>
  ['resolved', 'report_submitted', 'closed', 'cancelled'].includes(normalizeServiceStatus(status));

export const isPortalTicket = (t: any): boolean => t?.complaint_source === 'Customer Portal';
export const isUnverified = (t: any): boolean => !!t?.claimed_organisation_name;

/** Who may drive which part of the workflow (mirrors the API guards). */
export const STATUS_ROLES = ['service_team', 'regional_manager', 'management', 'admin'];
export const MANAGER_ROLES = ['management', 'regional_manager', 'admin'];
export const LINK_ROLES = ['management', 'regional_manager', 'service_team', 'admin'];

export function isAssignedEngineer(ticket: any, userId?: string): boolean {
  if (!userId) return false;
  const extra: string[] = Array.isArray(ticket?.additional_engineer_ids) ? ticket.additional_engineer_ids : [];
  return ticket?.assigned_to === userId || extra.includes(userId);
}

/** Parts on a report are stored as a JSON string (list of parts) or free text. */
export function parsePartsReplaced(raw: unknown): { text?: string; items?: { part_name: string; quantity: number; serial_new?: string; serial_old?: string }[] } {
  if (!raw) return {};
  if (Array.isArray(raw)) return { items: raw as any };
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) return { items: parsed };
      } catch {
        /* free text */
      }
    }
    return { text: raw };
  }
  return {};
}

export type { ServiceStatus };
