import { istToday } from '@/lib/ist-date';

/**
 * Business labels for tender codes, shared by the tender register and the dossier so both show the same words
 * (never a raw code such as "GENERAL_MHA").
 */
const CATEGORY_LABELS: Record<string, string> = {
  pq: 'PQ',
  general_mha: 'General / MHA',
  general: 'General',
  mha: 'MHA',
};

/** 'general_mha' / 'GENERAL_MHA' → 'General / MHA'; 'pq' → 'PQ'; anything else title-cased. */
export function tenderCategoryLabel(category?: string | null, categoryName?: string | null): string {
  const code = String(category || '').trim().toLowerCase();
  if (!code) return categoryName || '';
  return (
    CATEGORY_LABELS[code] ||
    categoryName ||
    code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Rupee value of a tender's estimate (estimated_value is stored in ₹; legacy rows may carry estimated_value_lakh). */
export function tenderEstimatedRupees(tender: { estimated_value?: unknown; estimated_value_lakh?: unknown; tender_value?: unknown }): number | null {
  const rupees = Number(tender.estimated_value);
  if (Number.isFinite(rupees) && rupees > 0) return rupees;
  const lakh = Number(tender.estimated_value_lakh);
  if (Number.isFinite(lakh) && lakh > 0) return lakh * 100000;
  const value = Number(tender.tender_value);
  if (Number.isFinite(value) && value > 0) return value;
  return null;
}

/** Stages a submitted bid reaches only once its bids are opened, i.e. after the bid closing time (Module 4). */
export const BID_OPENING_STAGES = ['technical_eval', 'commercial_eval', 'won', 'lost', 'partially_won'];

/**
 * True while the bid has not closed yet (mirrors the API's transition gate). A legacy date-only deadline (UTC
 * midnight) counts as closed from that IST day.
 */
export function bidStillOpen(tender: { submission_deadline?: string | Date | null; bid_closing_date?: string | Date | null }, now: number = Date.now()): boolean {
  const raw = tender.submission_deadline || tender.bid_closing_date;
  if (!raw) return false;
  const closing = new Date(raw);
  if (Number.isNaN(closing.getTime())) return false;
  const dateOnly = closing.getUTCHours() === 0 && closing.getUTCMinutes() === 0 && closing.getUTCSeconds() === 0;
  if (dateOnly) {
    return istToday(new Date(now)) < closing.toISOString().slice(0, 10);
  }
  return now < closing.getTime();
}
