/**
 * Module 9 — pure rule tests: state machine, permission resolution, item decisions and
 * line-item validation. No database or HTTP.
 */
import {
  EXPENSE_CLAIM_STATUSES,
  EXPENSE_TRANSITIONS,
  allowedExpenseActions,
  formatExpenseAmount,
  formatExpenseDate,
  hotelNights,
  todayInKolkata,
  type ExpenseClaimAction,
} from '@arihant/shared';
import { resolveTransition } from '../src/modules/expense-management/expense-workflow.service';
import { applyItemDecisions } from '../src/modules/expense-management/expense-decisions';
import {
  ExpenseValidationException,
  parseAmount,
  receiptRequired,
  sanitizeFileName,
  sanitizeText,
  sniffMime,
  validateItem,
  type CategoryRule,
} from '../src/modules/expense-management/expense-validation';
import { parseExpenseFilters } from '../src/modules/expense-management/expense-filters';

const EMP = 'emp-1';
const MGR = 'mgr-1';
const ACC = 'acc-1';
const claim = (status: string) => ({ employee_id: EMP, manager_id: MGR, status });
const owner = { id: EMP, role: 'sales' };
const manager = { id: MGR, role: 'regional_manager' };
const accounts = { id: ACC, role: 'accounts' };
const outsider = { id: 'x', role: 'sales' };

const errorsOf = (fn: () => unknown): Record<string, string> => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ExpenseValidationException) return (e.getResponse() as any).errors;
    throw e;
  }
  throw new Error('expected a validation error');
};
const statusOf = (fn: () => unknown): number => {
  try {
    fn();
  } catch (e: any) {
    return e.getStatus();
  }
  return 200;
};

describe('state machine', () => {
  const ALL_ACTIONS: ExpenseClaimAction[] = [
    'submit', 'withdraw', 'manager_approve', 'manager_reject', 'request_clarification', 'accounts_approve', 'accounts_reject', 'process',
  ];
  const actorFor = (a: ExpenseClaimAction, status: string) =>
    a === 'submit' || a === 'withdraw' ? owner : a.startsWith('manager') || (a === 'request_clarification' && status === 'submitted') ? manager : accounts;

  it('allows exactly the transitions in the map, for the right actor', () => {
    for (const status of EXPENSE_CLAIM_STATUSES) {
      for (const action of ALL_ACTIONS) {
        const expected = EXPENSE_TRANSITIONS.find((t) => t.from === status && t.action === action);
        const code = statusOf(() => resolveTransition(claim(status), actorFor(action, status), action));
        if (expected) expect({ status, action, code }).toEqual({ status, action, code: 200 });
        else expect({ status, action, code }).toEqual({ status, action, code: 409 });
      }
    }
  });

  it('manager approval lands in manager_approved and terminal states offer nothing', () => {
    expect(resolveTransition(claim('submitted'), manager, 'manager_approve').to).toBe('manager_approved');
    for (const s of ['rejected', 'processed', 'withdrawn']) expect(allowedExpenseActions(s)).toEqual([]);
  });

  it('withdraw only from draft or submitted (before the manager acts)', () => {
    expect(resolveTransition(claim('draft'), owner, 'withdraw').to).toBe('withdrawn');
    expect(resolveTransition(claim('submitted'), owner, 'withdraw').to).toBe('withdrawn');
    expect(statusOf(() => resolveTransition(claim('accounts_review'), owner, 'withdraw'))).toBe(409);
  });

  it('clarification goes back to the employee and resubmission returns to the manager', () => {
    expect(resolveTransition(claim('submitted'), manager, 'request_clarification').to).toBe('clarification_required');
    expect(resolveTransition(claim('accounts_review'), accounts, 'request_clarification').to).toBe('clarification_required');
    expect(resolveTransition(claim('clarification_required'), owner, 'submit').to).toBe('submitted');
  });

  it('forbids self-approval at both stages', () => {
    const selfManaged = { employee_id: MGR, manager_id: MGR, status: 'submitted' };
    expect(statusOf(() => resolveTransition(selfManaged, manager, 'manager_approve'))).toBe(403);
    const accountsOwn = { employee_id: ACC, manager_id: MGR, status: 'accounts_review' };
    expect(statusOf(() => resolveTransition(accountsOwn, accounts, 'accounts_approve'))).toBe(403);
    expect(statusOf(() => resolveTransition(accountsOwn, accounts, 'process'))).toBe(403);
  });

  it('checks permission before status (403 beats 409)', () => {
    expect(statusOf(() => resolveTransition(claim('processed'), outsider, 'manager_approve'))).toBe(403);
    expect(statusOf(() => resolveTransition(claim('draft'), manager, 'submit'))).toBe(403);
    expect(statusOf(() => resolveTransition(claim('submitted'), accounts, 'manager_approve'))).toBe(403);
    expect(statusOf(() => resolveTransition(claim('accounts_review'), manager, 'accounts_approve'))).toBe(403);
  });

  it('a re-submit of an already submitted claim is a 409, not a second history row', () => {
    expect(statusOf(() => resolveTransition(claim('submitted'), owner, 'submit'))).toBe(409);
  });
});

describe('item decisions (partial approval)', () => {
  const items = [
    { id: 'a', amount: 1000, approved_amount: null, item_status: 'pending' as const },
    { id: 'b', amount: 500, approved_amount: null, item_status: 'pending' as const },
  ];

  it('approves everything at the claimed amount by default', () => {
    const r = applyItemDecisions(items, undefined, 'manager');
    expect(r.errors).toEqual({});
    expect(r.totalApproved).toBe(1500);
    expect(r.updates.map((u) => u.item_status)).toEqual(['approved', 'approved']);
  });

  it('requires a comment when reducing or rejecting', () => {
    const r = applyItemDecisions(items, [{ id: 'a', item_status: 'partially_approved', approved_amount: 600 }, { id: 'b', item_status: 'rejected' }], 'manager');
    expect(Object.keys(r.errors).sort()).toEqual(['items.a.reviewer_comment', 'items.b.reviewer_comment']);
  });

  it('computes partial totals and statuses', () => {
    const r = applyItemDecisions(items, [{ id: 'a', item_status: 'partially_approved', approved_amount: '600.50', reviewer_comment: 'Only one night eligible' }], 'manager');
    expect(r.errors).toEqual({});
    expect(r.totalApproved).toBe(1100.5);
    expect(r.updates[0]).toMatchObject({ item_status: 'partially_approved', approved_amount: 600.5 });
  });

  it('never approves more than claimed, and accounts never more than the manager', () => {
    expect(applyItemDecisions(items, [{ id: 'a', item_status: 'partially_approved', approved_amount: 1200, reviewer_comment: 'too much' }], 'manager').errors).toHaveProperty(['items.a.approved_amount']);
    const afterManager = [{ id: 'a', amount: 1000, approved_amount: 800, item_status: 'partially_approved' as const }];
    expect(applyItemDecisions(afterManager, [{ id: 'a', item_status: 'partially_approved', approved_amount: 900, reviewer_comment: 'raise it' }], 'accounts').errors).toHaveProperty(['items.a.approved_amount']);
    const keep = applyItemDecisions(afterManager, undefined, 'accounts');
    expect(keep.totalApproved).toBe(800);
    expect(keep.updates[0].item_status).toBe('partially_approved');
  });

  it('flags all-rejected claims and rejects foreign or repeated ids', () => {
    const all = applyItemDecisions(items, [
      { id: 'a', item_status: 'rejected', reviewer_comment: 'No receipt' },
      { id: 'b', item_status: 'rejected', reviewer_comment: 'Personal' },
    ], 'manager');
    expect(all.allRejected).toBe(true);
    expect(all.totalApproved).toBe(0);
    expect(applyItemDecisions(items, [{ id: 'zzz', item_status: 'approved' }], 'manager').errors).toHaveProperty(['items.0.id']);
    expect(applyItemDecisions(items, [{ id: 'a', item_status: 'approved' }, { id: 'a', item_status: 'approved' }], 'manager').errors).toHaveProperty(['items.1.id']);
  });
});

describe('amount parsing', () => {
  it.each([
    [0, 'greater than zero'],
    ['0', 'greater than zero'],
    [-5, 'greater than zero'],
    ['-5', 'greater than zero'],
    ['abc', 'must be a number'],
    ['1e3', 'scientific'],
    [NaN, 'must be a number'],
    ['12.345', '2 decimal'],
    [1000001, 'cannot exceed'],
    [null, 'required'],
    [{}, 'must be a number'],
  ])('rejects %p', (value, message) => {
    const r = parseAmount(value as any, 1_000_000);
    expect(r.ok).toBe(false);
    expect((r as any).error.toLowerCase()).toContain(message.toLowerCase());
  });

  it.each([[1, 1], ['99.5', 99.5], ['1000000', 1_000_000], [0.1 + 0.2, 0.3]])('accepts %p', (value, expected) => {
    const r = parseAmount(value as any, 1_000_000);
    if (value === 0.1 + 0.2) {
      // 0.30000000000000004 has more than 2 decimals and is rejected — clients must send rounded values.
      expect(r.ok).toBe(false);
      return;
    }
    expect(r).toEqual({ ok: true, value: expected });
  });
});

describe('line-item validation', () => {
  const today = todayInKolkata();
  const daysAgo = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const cat = (over: Partial<CategoryRule> = {}): CategoryRule => ({
    id: '11111111-1111-1111-1111-111111111111',
    code: 'OTHER',
    name: 'Other',
    is_active: true,
    receipt_required_above: 0,
    max_amount_per_item: null,
    cap_is_hard: false,
    requires_customer_or_project: false,
    requires_remark: false,
    ...over,
  });
  const ctx = (category: CategoryRule, extra: any = {}) => ({ category, today, config: { maxItemAmount: 1_000_000, lateSubmissionDays: 90 }, ...extra });
  const base = { expense_date: daysAgo(1), amount: '250', purpose: 'Auto to client office' };

  it('blocks future dates and enforces the trip window', () => {
    expect(errorsOf(() => validateItem({ ...base, expense_date: '2999-01-01' }, ctx(cat())))).toHaveProperty(['expense_date']);
    const window = { from: daysAgo(10), to: daysAgo(8), label: 'trip dates' };
    expect(errorsOf(() => validateItem(base, ctx(cat(), { window })))).toHaveProperty(['expense_date']);
    expect(validateItem({ ...base, expense_date: daysAgo(9) }, ctx(cat(), { window })).expense_date).toBe(daysAgo(9));
  });

  it('needs a late-submission reason after 90 days, then flags it', () => {
    expect(errorsOf(() => validateItem({ ...base, expense_date: daysAgo(120) }, ctx(cat())))).toHaveProperty(['late_submission_reason']);
    const ok = validateItem({ ...base, expense_date: daysAgo(120), late_submission_reason: 'Was on long deployment' }, ctx(cat()));
    expect(ok.is_late).toBe(true);
  });

  it('enforces customer/project, remarks and caps from the category', () => {
    expect(errorsOf(() => validateItem(base, ctx(cat({ requires_customer_or_project: true }))))).toHaveProperty(['customer_id']);
    expect(errorsOf(() => validateItem(base, ctx(cat({ requires_remark: true }))))).toHaveProperty(['remarks']);
    expect(errorsOf(() => validateItem(base, ctx(cat({ max_amount_per_item: 100, cap_is_hard: true }))))).toHaveProperty(['amount']);
    expect(errorsOf(() => validateItem(base, ctx(cat({ max_amount_per_item: 100 }))))).toHaveProperty(['remarks']);
    expect(validateItem({ ...base, remarks: 'Late night, surge pricing' }, ctx(cat({ max_amount_per_item: 100 }))).amount).toBe(250);
  });

  it('rejects inactive categories on new items but keeps them on unchanged edits', () => {
    expect(errorsOf(() => validateItem(base, ctx(cat({ is_active: false }))))).toHaveProperty(['category_id']);
    expect(validateItem(base, ctx(cat({ is_active: false }), { categoryUnchanged: true })).amount).toBe(250);
  });

  it('validates hotel dates and computes nights', () => {
    const hotel = cat({ code: 'HOTEL' });
    expect(errorsOf(() => validateItem({ ...base, category_details: { hotel_name: 'Taj', check_in: daysAgo(1), check_out: daysAgo(2) } }, ctx(hotel)))).toHaveProperty(['category_details.check_out']);
    const ok = validateItem({ ...base, category_details: { hotel_name: 'Taj', check_in: daysAgo(3), check_out: daysAgo(1) } }, ctx(hotel));
    expect(ok.category_details.nights).toBe(2);
    expect(hotelNights('2026-01-30', '2026-02-02')).toBe(3);
  });

  it('recomputes local conveyance from km × rate and ignores a mismatching client amount', () => {
    const conv = cat({ code: 'LOCAL_CONVEYANCE' });
    const r = validateItem({ ...base, amount: '9999', category_details: { from: 'Office', to: 'CRPF Camp', km: 42.5, rate_per_km: 12 } }, ctx(conv));
    expect(r.amount).toBe(510);
    expect(r.amount_recomputed).toBe(true);
  });

  it('validates travel and food details', () => {
    expect(errorsOf(() => validateItem({ ...base, category_details: { from: 'Delhi', to: '', mode: 'rocket' } }, ctx(cat({ code: 'TRAVEL' }))))).toEqual(
      expect.objectContaining({ 'category_details.to': expect.any(String), 'category_details.mode': expect.any(String) }),
    );
    expect(errorsOf(() => validateItem({ ...base, category_details: { meal_type: 'lunch', persons: 0 } }, ctx(cat({ code: 'FOOD' }))))).toHaveProperty(['category_details.persons']);
  });

  it('strips HTML and enforces lengths', () => {
    expect(sanitizeText('  <script>alert(1)</script>Taxi <b>fare</b> ', 100)).toBe('alert(1)Taxi fare');
    expect(errorsOf(() => validateItem({ ...base, purpose: 'x'.repeat(501) }, ctx(cat())))).toHaveProperty(['purpose']);
    expect(errorsOf(() => validateItem({ ...base, purpose: '<b></b>' }, ctx(cat())))).toHaveProperty(['purpose']);
  });

  it('receipt thresholds: 0 = always, null = never', () => {
    expect(receiptRequired({ receipt_required_above: 0 }, 1)).toBe(true);
    expect(receiptRequired({ receipt_required_above: null }, 99999)).toBe(false);
    expect(receiptRequired({ receipt_required_above: 500 }, 499.99)).toBe(false);
    expect(receiptRequired({ receipt_required_above: 500 }, 500)).toBe(true);
  });
});

describe('files, filters and formatting', () => {
  it('sniffs real file types and sanitises names', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffMime(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]))).toBe('image/heic');
    expect(sniffMime(Buffer.from('MZ\x90\x00 not a receipt'))).toBeNull();
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('bill <1>;rm -rf.pdf')).toBe('bill _1_rm -rf.pdf');
  });

  it('validates filter combinations', () => {
    const parse = (q: any) => parseExpenseFilters(q, { sortable: ['expense_date'], defaultSort: 'expense_date' });
    expect(errorsOf(() => parse({ date_from: '2026-05-10', date_to: '2026-05-01' }))).toHaveProperty(['date_to']);
    expect(errorsOf(() => parse({ statuses: 'submitted,bogus' }))).toHaveProperty(['statuses']);
    expect(errorsOf(() => parse({ employee_ids: 'not-a-uuid' }))).toHaveProperty(['employee_ids']);
    const f = parse({ statuses: ['submitted', 'processed'], page_size: '5000', sort_by: 'drop table' });
    expect(f.statuses).toEqual(['submitted', 'processed']);
    expect(f.page_size).toBe(100);
    expect(f.sort_by).toBe('expense_date');
  });

  it('formats currency and dates the Indian way', () => {
    expect(formatExpenseAmount(123456)).toBe('₹1,23,456.00');
    expect(formatExpenseAmount('1234567.5')).toBe('₹12,34,567.50');
    expect(formatExpenseDate('2026-03-07')).toBe('07-03-2026');
    expect(formatExpenseDate(new Date('2026-03-06T20:00:00Z'))).toBe('07-03-2026');
  });
});
