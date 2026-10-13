/**
 * Per-item approval decisions for the manager and accounts stages (§5.22–23).
 * Pure: takes the current items and the reviewer's decisions, returns the item updates,
 * the new claim total and field errors. No database access.
 */
import { roundMoney, EXPENSE_MIN_COMMENT_LENGTH, type ExpenseItemStatus } from '@arihant/shared';
import { sanitizeText, TEXT_LIMITS, type FieldErrors } from './expense-validation.js';

export interface DecisionItem {
  id: string;
  amount: number;
  /** Amount approved at the previous stage (null before any review). */
  approved_amount: number | null;
  item_status: ExpenseItemStatus;
}

export interface ItemUpdate {
  id: string;
  item_status: ExpenseItemStatus;
  approved_amount: number;
  reviewer_comment: string | null;
}

export interface DecisionResult {
  updates: ItemUpdate[];
  totalApproved: number;
  allRejected: boolean;
  errors: FieldErrors;
}

const DECISION_STATUSES = ['approved', 'partially_approved', 'rejected'];

function finalStatus(claimed: number, approved: number): ExpenseItemStatus {
  if (approved <= 0) return 'rejected';
  return approved >= claimed ? 'approved' : 'partially_approved';
}

/**
 * Manager stage: the ceiling for each item is the claimed amount.
 * Accounts stage: the ceiling is what the manager approved — Accounts may reduce (with a
 * comment) but never raise it.
 * Items without an explicit decision are approved at their ceiling.
 */
export function applyItemDecisions(
  items: DecisionItem[],
  rawDecisions: unknown,
  stage: 'manager' | 'accounts',
): DecisionResult {
  const errors: FieldErrors = {};
  const decisions = rawDecisions === undefined || rawDecisions === null ? [] : rawDecisions;
  if (!Array.isArray(decisions)) {
    return { updates: [], totalApproved: 0, allRejected: false, errors: { items: 'items must be a list of item decisions.' } };
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const decided = new Map<string, ItemUpdate>();

  decisions.forEach((d: any, idx: number) => {
    const key = `items.${idx}`;
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !byId.has(d.id)) {
      errors[`${key}.id`] = 'Item does not belong to this claim.';
      return;
    }
    if (seen.has(d.id)) {
      errors[`${key}.id`] = 'Each item can only be decided once.';
      return;
    }
    seen.add(d.id);
    const item = byId.get(d.id)!;
    const ceiling = stage === 'manager' ? item.amount : item.approved_amount ?? item.amount;
    const field = `items.${d.id}`;
    const comment = sanitizeText(d.reviewer_comment, TEXT_LIMITS.comment);
    const needComment = () => {
      if (!comment || comment.length < EXPENSE_MIN_COMMENT_LENGTH) {
        errors[`${field}.reviewer_comment`] = `A comment of at least ${EXPENSE_MIN_COMMENT_LENGTH} characters is required when reducing or rejecting an item.`;
        return false;
      }
      return true;
    };

    if (!DECISION_STATUSES.includes(d.item_status)) {
      errors[`${field}.item_status`] = 'Decision must be approved, partially_approved or rejected.';
      return;
    }

    let approved: number;
    if (d.item_status === 'rejected') {
      approved = 0;
      needComment();
    } else if (d.item_status === 'approved') {
      approved = ceiling;
      if (stage === 'accounts' && ceiling <= 0) {
        errors[`${field}.item_status`] = 'This item was rejected by the manager and cannot be approved by Accounts.';
        return;
      }
    } else {
      const raw = d.approved_amount;
      const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) {
        errors[`${field}.approved_amount`] = 'Enter the approved amount (max 2 decimals).';
        return;
      }
      approved = roundMoney(Number(text));
      if (approved <= 0) {
        errors[`${field}.approved_amount`] = 'Use "Reject" for a zero amount.';
        return;
      }
      if (approved > ceiling) {
        errors[`${field}.approved_amount`] =
          stage === 'manager'
            ? 'Approved amount cannot exceed the claimed amount.'
            : 'Accounts cannot approve more than the manager approved.';
        return;
      }
      if (approved < ceiling) needComment();
    }

    decided.set(d.id, {
      id: d.id,
      approved_amount: approved,
      item_status: finalStatus(item.amount, approved),
      reviewer_comment: comment,
    });
  });

  const updates: ItemUpdate[] = items.map((item) => {
    const explicit = decided.get(item.id);
    if (explicit) return explicit;
    const ceiling = stage === 'manager' ? item.amount : item.approved_amount ?? item.amount;
    return {
      id: item.id,
      approved_amount: ceiling,
      item_status: finalStatus(item.amount, ceiling),
      reviewer_comment: null,
    };
  });

  const totalApproved = roundMoney(updates.reduce((s, u) => s + u.approved_amount, 0));
  return {
    updates,
    totalApproved,
    allRejected: updates.length > 0 && updates.every((u) => u.item_status === 'rejected'),
    errors,
  };
}
