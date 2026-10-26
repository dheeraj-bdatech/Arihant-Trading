'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { ExpenseClaimStatus, ExpenseItemStatus, ExpenseStageBucket } from '@arihant/shared';

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  receipt_required_above: number | null;
  max_amount_per_item: number | null;
  cap_is_hard: boolean;
  requires_customer_or_project: boolean;
  requires_remark: boolean;
  display_order: number;
}

export interface ExpenseAttachment {
  id: string;
  item_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  duplicate_of_attachment_id: string | null;
  duplicate_claim_number: string | null;
}

export interface ExpenseItem {
  id: string;
  claim_id: string;
  expense_date: string;
  category_id: string;
  category_name: string;
  category_code: string;
  category_active: boolean;
  amount: number;
  approved_amount: number | null;
  manager_approved_amount: number | null;
  purpose: string;
  customer_id: string | null;
  customer_name: string | null;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  remarks: string | null;
  late_submission_reason: string | null;
  item_status: ExpenseItemStatus;
  reviewer_comment: string | null;
  category_details: Record<string, any>;
  duplicate_confirmed_at: string | null;
  attachments: ExpenseAttachment[];
  receipt_required: boolean;
  receipt_missing: boolean;
  /** Dated after today (IST) — the server refuses submission, approval and payment until it is corrected. */
  future_dated?: boolean;
  is_late: boolean;
  duplicate_flag: boolean;
}

export interface ExpenseHistory {
  id: string;
  from_status: string | null;
  to_status: string;
  action: string;
  actor_role: string | null;
  actor_name: string | null;
  comment: string | null;
  metadata: any;
  created_at: string;
}

export interface ExpenseClaim {
  id: string;
  claim_number: string;
  employee_id: string;
  employee_name: string;
  employee_code?: string | null;
  employee_active?: boolean;
  manager_id: string | null;
  manager_name: string | null;
  manager_active?: boolean | null;
  region_name?: string | null;
  trip_id: string | null;
  visit_id: string | null;
  trip_date?: string | null;
  trip_location?: string | null;
  visit_date?: string | null;
  visit_purpose?: string | null;
  visit_organisation_id?: string | null;
  visit_organisation_name?: string | null;
  title: string;
  remarks?: string | null;
  period_from: string | null;
  period_to: string | null;
  status: ExpenseClaimStatus;
  status_label: string;
  total_claimed: number;
  total_approved: number | null;
  submitted_at: string | null;
  updated_at: string;
  processed_at?: string | null;
  tally_voucher_ref?: string | null;
  payment_reference?: string | null;
  payment_date?: string | null;
  last_reviewer_comment: string | null;
  copied_from_claim_id?: string | null;
  copied_from_claim_number?: string | null;
  version: number;
  item_count?: number;
  /** Distinct expense categories on the claim's lines, e.g. "Hotel / Lodging, Travel" (list rows). */
  categories?: string | null;
  /** Reviewer flags computed by the server (list rows and detail). */
  future_dated_lines?: number;
  receipt_missing_lines?: number;
  allowed_actions: string[];
  items?: ExpenseItem[];
  history?: ExpenseHistory[];
}

/** Totals for the whole filtered claim list. Bucket amounts partition total_claimed (they always add up to it). */
export interface ClaimListTotals {
  count: number;
  total_claimed: number;
  total_approved: number;
  paid_amount?: number;
  buckets?: Record<ExpenseStageBucket, { count: number; amount: number }>;
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totals?: ClaimListTotals;
}

export interface BadgeCounts {
  manager_pending: number;
  accounts_pending: number;
  accounts_ready: number;
  my_clarifications: number;
  my_drafts: number;
  approver_inactive: number;
  has_team?: boolean;
}

/** Field-level errors from a 400 (`{ errors: { field: message } }`). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.data?.errors && typeof err.data.errors === 'object') return err.data.errors;
  return {};
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    const m = err.data?.message ?? err.message;
    return Array.isArray(m) ? m.join(', ') : String(m || fallback);
  }
  return err instanceof Error ? err.message : fallback;
}

export const isConflict = (err: unknown) => err instanceof ApiError && err.status === 409;

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Pages broadcast this after any mutation so badges and lists refresh. */
export const notifyExpensesChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('expenses:changed'));
};

export function useBadgeCounts(enabled = true) {
  const [counts, setCounts] = useState<BadgeCounts | null>(null);
  const load = useCallback(async () => {
    try {
      setCounts(await api.get<BadgeCounts>('/expense-claims/badge-counts'));
    } catch {
      /* badges are best-effort */
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const onChange = () => load();
    window.addEventListener('expenses:changed', onChange);
    const socket = getSocket();
    socket?.on('expense:badge_refresh', onChange);
    const timer = window.setInterval(load, 60000);
    return () => {
      window.removeEventListener('expenses:changed', onChange);
      socket?.off('expense:badge_refresh', onChange);
      window.clearInterval(timer);
    };
  }, [enabled, load]);
  return counts;
}

export function useCategories(includeInactive = false) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.get<ExpenseCategory[]>('/expense-categories', includeInactive ? { include_inactive: true } : undefined));
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => {
    load();
  }, [load]);
  return { categories, loading, reload: load };
}

export const STATUS_BADGE: Record<ExpenseClaimStatus, 'default' | 'outline' | 'success' | 'warning' | 'danger' | 'urgent' | 'info' | 'cyber'> = {
  draft: 'outline',
  submitted: 'warning',
  manager_approved: 'info',
  accounts_review: 'info',
  accounts_approved: 'cyber',
  clarification_required: 'urgent',
  rejected: 'danger',
  processed: 'success',
  withdrawn: 'default',
};

export const ITEM_BADGE: Record<ExpenseItemStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  pending: 'default',
  approved: 'success',
  partially_approved: 'warning',
  rejected: 'danger',
};

export const MANAGEMENT_ROLES = ['management', 'admin'];
