/**
 * Module 9 — Expense Management: single source of truth for the claim state machine,
 * labels and formatting. The API enforces it; the web app reads it to decide which
 * actions to offer, so the two cannot drift apart.
 */

export type ExpenseClaimStatus =
  | 'draft'
  | 'submitted'
  | 'manager_approved'
  | 'accounts_review'
  | 'accounts_approved'
  | 'clarification_required'
  | 'rejected'
  | 'processed'
  | 'withdrawn';

export const EXPENSE_CLAIM_STATUSES: ExpenseClaimStatus[] = [
  'draft',
  'submitted',
  'manager_approved',
  'accounts_review',
  'accounts_approved',
  'clarification_required',
  'rejected',
  'processed',
  'withdrawn',
];

export type ExpenseItemStatus = 'pending' | 'approved' | 'partially_approved' | 'rejected';

export type ExpenseClaimAction =
  | 'submit'
  | 'withdraw'
  | 'manager_approve'
  | 'manager_reject'
  | 'request_clarification'
  | 'accounts_approve'
  | 'accounts_reject'
  | 'process';

/** Who may perform an action, relative to the claim. */
export type ExpenseActorKind = 'owner' | 'approver' | 'accounts';

export interface ExpenseTransitionRule {
  from: ExpenseClaimStatus;
  action: ExpenseClaimAction;
  to: ExpenseClaimStatus;
  actor: ExpenseActorKind;
}

/**
 * Explicit allowed-transitions map. Anything not listed here is rejected with 409.
 * `manager_approve` lands in `manager_approved`; the service immediately (same transaction)
 * hands it to the Accounts queue (`accounts_review`) with a second, system-authored history row.
 * `process` from `accounts_review` is "approve & process" in one step.
 */
export const EXPENSE_TRANSITIONS: ExpenseTransitionRule[] = [
  { from: 'draft', action: 'submit', to: 'submitted', actor: 'owner' },
  { from: 'clarification_required', action: 'submit', to: 'submitted', actor: 'owner' },
  { from: 'draft', action: 'withdraw', to: 'withdrawn', actor: 'owner' },
  { from: 'submitted', action: 'withdraw', to: 'withdrawn', actor: 'owner' },

  { from: 'submitted', action: 'manager_approve', to: 'manager_approved', actor: 'approver' },
  { from: 'submitted', action: 'manager_reject', to: 'rejected', actor: 'approver' },
  { from: 'submitted', action: 'request_clarification', to: 'clarification_required', actor: 'approver' },

  { from: 'accounts_review', action: 'accounts_approve', to: 'accounts_approved', actor: 'accounts' },
  { from: 'accounts_review', action: 'accounts_reject', to: 'rejected', actor: 'accounts' },
  { from: 'accounts_review', action: 'request_clarification', to: 'clarification_required', actor: 'accounts' },
  { from: 'accounts_review', action: 'process', to: 'processed', actor: 'accounts' },
  { from: 'accounts_approved', action: 'process', to: 'processed', actor: 'accounts' },
  { from: 'accounts_approved', action: 'accounts_reject', to: 'rejected', actor: 'accounts' },
];

export function findExpenseTransition(
  from: string,
  action: ExpenseClaimAction,
): ExpenseTransitionRule | undefined {
  return EXPENSE_TRANSITIONS.find((t) => t.from === from && t.action === action);
}

export function allowedExpenseActions(from: string): ExpenseClaimAction[] {
  return EXPENSE_TRANSITIONS.filter((t) => t.from === from).map((t) => t.action);
}

export const EXPENSE_TERMINAL_STATUSES: ExpenseClaimStatus[] = ['rejected', 'processed', 'withdrawn'];
/** Statuses in which the employee may edit the header and items. */
export const EXPENSE_EDITABLE_STATUSES: ExpenseClaimStatus[] = ['draft', 'clarification_required'];
/** Claims in these statuses do not count for duplicate detection. */
export const EXPENSE_INACTIVE_FOR_DUPLICATES: ExpenseClaimStatus[] = ['rejected', 'withdrawn'];
/** Actions that require a reviewer comment of at least EXPENSE_MIN_COMMENT_LENGTH characters. */
export const EXPENSE_COMMENT_REQUIRED_ACTIONS: ExpenseClaimAction[] = [
  'manager_reject',
  'accounts_reject',
  'request_clarification',
];
export const EXPENSE_MIN_COMMENT_LENGTH = 5;

export const EXPENSE_STATUS_LABELS: Record<ExpenseClaimStatus, string> = {
  draft: 'Draft',
  submitted: 'Manager Review',
  manager_approved: 'Manager Approved',
  accounts_review: 'Accounts Review',
  accounts_approved: 'Ready for Tally',
  clarification_required: 'Clarification Required',
  rejected: 'Rejected',
  processed: 'Processed',
  withdrawn: 'Withdrawn',
};

export const EXPENSE_ITEM_STATUS_LABELS: Record<ExpenseItemStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  partially_approved: 'Partially approved',
  rejected: 'Rejected',
};

export const EXPENSE_ACTION_LABELS: Record<string, string> = {
  create: 'Draft created',
  submit: 'Submitted',
  resubmit: 'Resubmitted',
  withdraw: 'Withdrawn',
  manager_approve: 'Approved by manager',
  manager_reject: 'Rejected by manager',
  request_clarification: 'Clarification requested',
  forward_to_accounts: 'Forwarded to Accounts',
  accounts_approve: 'Approved by Accounts',
  accounts_reject: 'Rejected by Accounts',
  process: 'Processed in Tally',
  auto_reject: 'Auto-rejected (all items rejected)',
  reassign_approver: 'Approver reassigned',
  clarification_edit: 'Edited during clarification',
  duplicate_confirmed: 'Duplicate warning confirmed',
  copy: 'Copied to new draft',
  delete: 'Draft deleted',
  duplicate_receipt: 'Duplicate receipt flagged',
  legacy_import: 'Imported from legacy register',
  import: 'Imported from Excel',
};

/** Category-specific detail fields captured in `expense_items.category_details`. */
export const TRAVEL_MODES = ['flight', 'train', 'bus', 'cab', 'own_vehicle'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'daily_allowance'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export interface TravelDetails { from: string; to: string; mode: TravelMode }
export interface HotelDetails { hotel_name: string; check_in: string; check_out: string; nights?: number }
export interface ConveyanceDetails { from: string; to: string; km: number; rate_per_km: number }
export interface FoodDetails { meal_type: MealType; persons: number }

/** Which category code drives which detail schema. */
export const CATEGORY_DETAIL_KIND: Record<string, 'travel' | 'hotel' | 'conveyance' | 'food' | undefined> = {
  TRAVEL: 'travel',
  HOTEL: 'hotel',
  LOCAL_CONVEYANCE: 'conveyance',
  FOOD: 'food',
};

/** Whole nights between two YYYY-MM-DD dates (check-out exclusive). */
export function hotelNights(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Rupees to paise-safe 2dp number (avoids float drift such as 0.1 + 0.2). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** ₹1,23,456.00 — always two decimals, Indian digit grouping. */
export function formatExpenseAmount(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const negative = n < 0;
  const [intPart, dec] = Math.abs(n).toFixed(2).split('.');
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `${negative ? '-' : ''}₹${grouped}.${dec}`;
}

/** DD-MM-YYYY for a YYYY-MM-DD date or a timestamp (rendered in Asia/Kolkata). */
export function formatExpenseDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}-${m}-${y}`;
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('day')}-${get('month')}-${get('year')}`;
}

/** Today's date (YYYY-MM-DD) in the business timezone, Asia/Kolkata. */
export function todayInKolkata(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA renders YYYY-MM-DD
}

/** Fixed, documented column order of the Accounts → Tally export. Do not reorder. */
export const EXPENSE_TALLY_EXPORT_COLUMNS = [
  'Claim No',
  'Employee Code',
  'Employee Name',
  'Region',
  'Trip',
  'Expense Date',
  'Category',
  'Customer',
  'Project',
  'Purpose',
  'Claimed Amount',
  'Approved Amount',
  'Manager',
  'Manager Approved On',
  'Accounts Approved On',
  'Status',
  'Tally Voucher Ref',
  'Remarks',
] as const;

/** Columns of the standard Excel import template (one row per expense line). */
export const EXPENSE_IMPORT_TEMPLATE_COLUMNS = [
  'Expense Date (DD-MM-YYYY)',
  'Category Code',
  'Amount',
  'Purpose',
  'Customer Name',
  'Project Code',
  'Remarks',
  'Travel From / Conveyance From',
  'Travel To / Conveyance To',
  'Travel Mode',
  'Hotel Name',
  'Check-in (DD-MM-YYYY)',
  'Check-out (DD-MM-YYYY)',
  'Distance (km)',
  'Rate per km',
  'Meal Type',
  'Persons',
] as const;
