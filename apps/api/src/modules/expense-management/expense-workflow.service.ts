/**
 * The one place claim statuses change (§3). Every transition:
 * visibility (404) → permission (403) → current status (409) → version (409)
 * → mutation inside one DB transaction with a row lock → history row → notification event.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import {
  EXPENSE_COMMENT_REQUIRED_ACTIONS,
  EXPENSE_MIN_COMMENT_LENGTH,
  EXPENSE_STATUS_LABELS,
  EXPENSE_TRANSITIONS,
  todayInKolkata,
  type AuthUser,
  type Database,
  type ExpenseActorKind,
  type ExpenseClaimAction,
  type ExpenseClaimStatus,
  type ExpenseTransitionRule,
} from '@arihant/shared';
import {
  ExpenseClaimsService,
  conflict,
  money,
  readVersion,
  staleVersion,
} from './expense-claims.service.js';
import { applyItemDecisions } from './expense-decisions.js';
import {
  assertNoFutureDates,
  ExpenseValidationException,
  isIsoDate,
  lineAnomalies,
  readText,
  receiptRequired,
  TEXT_LIMITS,
  validateItem,
  type FieldErrors,
} from './expense-validation.js';
import { isAdminLike } from './expense-scope.js';
import type { ReassignApproverDto, TransitionDto } from './expense.dto.js';

export const EXPENSE_EVENTS = {
  SUBMITTED: 'expense_claim.submitted',
  MANAGER_APPROVED: 'expense_claim.manager_approved',
  ACCOUNTS_APPROVED: 'expense_claim.accounts_approved',
  REJECTED: 'expense_claim.rejected',
  CLARIFICATION: 'expense_claim.clarification_requested',
  PROCESSED: 'expense_claim.processed',
  WITHDRAWN: 'expense_claim.withdrawn',
  APPROVER_REASSIGNED: 'expense_claim.approver_reassigned',
} as const;

type ClaimRow = Awaited<ReturnType<ExpenseClaimsService['lockClaim']>>;

/** Pure permission/status resolution so it can be unit-tested without a database. */
export function resolveTransition(
  claim: { employee_id: string; manager_id: string | null; status: string },
  user: { id: string; role: string },
  action: ExpenseClaimAction,
): ExpenseTransitionRule {
  const candidates = EXPENSE_TRANSITIONS.filter((t) => t.action === action);
  if (!candidates.length) throw new BadRequestException(`Unknown action "${action}".`);
  const own = claim.employee_id === user.id;
  const kinds = new Set<ExpenseActorKind>();
  if (own) kinds.add('owner');
  if (!own && claim.manager_id === user.id) kinds.add('approver');
  if (!own && user.role === 'accounts') kinds.add('accounts');

  const permitted = candidates.filter((t) => kinds.has(t.actor));
  if (!permitted.length) {
    const needsReviewer = candidates.every((t) => t.actor !== 'owner');
    if (own && needsReviewer) throw new ForbiddenException('You cannot approve, reject or review your own expense claim.');
    if (candidates.some((t) => t.actor === 'owner')) throw new ForbiddenException('Only the employee who raised this claim can do this.');
    if (candidates.some((t) => t.actor === 'accounts') && !candidates.some((t) => t.actor === 'approver')) {
      throw new ForbiddenException('Only the Accounts team can do this.');
    }
    throw new ForbiddenException('Only the assigned approver can review this claim.');
  }
  const rule = permitted.find((t) => t.from === claim.status);
  if (!rule) {
    const label = EXPENSE_STATUS_LABELS[claim.status as ExpenseClaimStatus] || claim.status;
    throw conflict(`This action is not allowed while the claim is "${label}". Refresh to see its current state.`);
  }
  return rule;
}

/**
 * Validates the payment details captured when Accounts marks a claim processed (= paid): Tally voucher, bank
 * payment reference (NEFT/RTGS/UTR/cheque no.) and payment date are all required. The payment date cannot be in
 * the future (IST) nor before the last expense on the claim.
 */
export function readPaymentDetails(
  dto: Pick<TransitionDto, 'tally_voucher_ref' | 'payment_reference' | 'payment_date'>,
  today: string,
  items: { expense_date: unknown }[] = [],
): { errors: FieldErrors; tallyRef: string | null; paymentReference: string | null; paymentDate: string | null } {
  const errors: FieldErrors = {};
  const tallyRef = readText(errors, 'tally_voucher_ref', dto.tally_voucher_ref, TEXT_LIMITS.reference, { required: true, label: 'Tally voucher reference' });
  const paymentReference = readText(errors, 'payment_reference', dto.payment_reference, TEXT_LIMITS.reference, {
    required: true,
    label: 'Payment reference (UTR / NEFT / cheque no.)',
    minLength: 4,
  });
  let paymentDate: string | null = null;
  const lastExpense = items.map((i) => String(i.expense_date ?? '')).filter(isIsoDate).sort().pop();
  if (dto.payment_date === undefined || dto.payment_date === null || dto.payment_date === '') errors.payment_date = 'Payment date is required.';
  else if (!isIsoDate(dto.payment_date)) errors.payment_date = 'Payment date must be a valid date.';
  else if (dto.payment_date > today) errors.payment_date = 'Payment date cannot be in the future.';
  else if (lastExpense && dto.payment_date < lastExpense) errors.payment_date = `Payment date cannot be before the last expense on this claim (${lastExpense.split('-').reverse().join('-')}).`;
  else paymentDate = dto.payment_date;
  return { errors, tallyRef, paymentReference, paymentDate };
}

@Injectable()
export class ExpenseWorkflowService {
  constructor(private readonly claims: ExpenseClaimsService) {}

  private get db() {
    return this.claims.db;
  }

  /** Approver for an employee: their active manager, else the fallback role. Never the employee. */
  async resolveApprover(trx: Transaction<Database>, employeeId: string): Promise<{ approverId: string; viaFallback: boolean }> {
    const emp = await trx.selectFrom('users').select(['reporting_manager_id']).where('id', '=', employeeId).executeTakeFirst();
    if (emp?.reporting_manager_id && emp.reporting_manager_id !== employeeId) {
      const mgr = await trx.selectFrom('users').select(['id', 'is_active']).where('id', '=', emp.reporting_manager_id).executeTakeFirst();
      if (mgr?.is_active) return { approverId: mgr.id, viaFallback: false };
    }
    const roles = this.claims.config.fallbackApproverRole === 'admin' ? ['admin'] : ['management', 'admin'];
    for (const role of roles) {
      const fb = await trx
        .selectFrom('users')
        .select('id')
        .where('role', '=', role as any)
        .where('is_active', '=', true)
        .where('id', '<>', employeeId)
        .orderBy('created_at')
        .orderBy('id')
        .executeTakeFirst();
      if (fb) return { approverId: fb.id, viaFallback: true };
    }
    throw new BadRequestException({ message: 'No approver configured, contact admin.', code: 'NO_APPROVER' });
  }

  private readComment(action: ExpenseClaimAction, raw: unknown): string | null {
    const errors: FieldErrors = {};
    const required = EXPENSE_COMMENT_REQUIRED_ACTIONS.includes(action);
    const comment = readText(errors, 'comment', raw, TEXT_LIMITS.comment, {
      required,
      minLength: required ? EXPENSE_MIN_COMMENT_LENGTH : undefined,
      label: 'Comment',
    });
    if (errors.comment && required) errors.comment = `A comment of at least ${EXPENSE_MIN_COMMENT_LENGTH} characters is required.`;
    if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
    return comment;
  }

  private async liveItems(trx: Transaction<Database>, claimId: string) {
    return trx
      .selectFrom('expense_items as i')
      .innerJoin('expense_categories as cat', 'cat.id', 'i.category_id')
      .selectAll('i')
      .select(['cat.receipt_required_above', 'cat.code as category_code'])
      .where('i.claim_id', '=', claimId)
      .where('i.deleted_at', 'is', null)
      .orderBy('i.expense_date')
      .execute();
  }

  /**
   * Payable lines that lack a receipt their category requires. Submission refuses these, so they only reach an
   * approver on legacy imports or after a category threshold was raised; the approval is allowed but the gap is
   * written to the history row so the audit trail shows who approved / paid it without the bill.
   */
  private async receiptGaps(trx: Transaction<Database>, items: any[], payableIds: Set<string>, today: string) {
    const ids = items.filter((i) => payableIds.has(i.id)).map((i) => i.id);
    if (!ids.length) return [];
    const counts = await trx
      .selectFrom('expense_attachments')
      .select(['item_id', sql<number>`count(*)::int`.as('n')])
      .where('item_id', 'in', ids)
      .where('deleted_at', 'is', null)
      .groupBy('item_id')
      .execute();
    const n = new Map(counts.map((c) => [c.item_id, Number(c.n)]));
    return items
      .filter((i) => payableIds.has(i.id))
      .filter((i) => lineAnomalies({ ...i, attachment_count: n.get(i.id) ?? 0 }, today).includes('receipt_missing'))
      .map((i) => ({ item_id: i.id, purpose: i.purpose, category: i.category_name, amount: Number(i.amount) }));
  }

  private async writeItemDecisions(trx: Transaction<Database>, items: any[], updates: ReturnType<typeof applyItemDecisions>['updates'], stage: 'manager' | 'accounts', user: AuthUser) {
    for (const u of updates) {
      const before = items.find((i) => i.id === u.id);
      await trx
        .updateTable('expense_items')
        .set({
          item_status: u.item_status,
          approved_amount: u.approved_amount,
          reviewer_comment: u.reviewer_comment ?? before?.reviewer_comment ?? null,
          ...(stage === 'manager' ? { manager_approved_amount: u.approved_amount } : {}),
          updated_by: user.id,
        })
        .where('id', '=', u.id)
        .execute();
    }
  }

  async transition(id: string, action: ExpenseClaimAction, dto: TransitionDto, user: AuthUser) {
    await this.claims.getVisibleClaim(id, user);
    const outcome = await this.db.transaction().execute(async (trx) => {
      const claim = await this.claims.lockClaim(trx, id);
      const rule = resolveTransition(claim, user, action);
      const version = readVersion(dto.version, true);
      if (claim.version !== version) throw staleVersion();
      const comment = this.readComment(action, dto.comment);
      return this.apply(trx, claim, rule, comment, dto, user);
    });
    this.claims.events.emit(outcome.event, outcome.payload);
    this.claims.events.emit('audit.log', {
      actorId: user.id,
      entityType: 'expense_claim',
      entityId: id,
      action: `expense_${action}`,
      previousValue: { status: outcome.from },
      newValue: { status: outcome.to, comment: outcome.payload.comment ?? null },
    });
    return this.claims.getDetail(id, user);
  }

  private async apply(
    trx: Transaction<Database>,
    claim: ClaimRow,
    rule: ExpenseTransitionRule,
    comment: string | null,
    dto: TransitionDto,
    user: AuthUser,
  ): Promise<{ from: string; to: string; event: string; payload: Record<string, any> }> {
    const from = claim.status;
    let to: ExpenseClaimStatus = rule.to;
    const patch: Record<string, unknown> = {};
    const base = { claimId: claim.id, claimNumber: claim.claim_number, employeeId: claim.employee_id, comment };
    let event: string = EXPENSE_EVENTS.SUBMITTED;
    let payload: Record<string, any> = { ...base };
    const now = new Date();
    // Business date (IST). Using the UTC date here would treat 00:00–05:30 IST as yesterday.
    const today = todayInKolkata(now);

    switch (rule.action) {
      case 'submit': {
        const items = await this.liveItems(trx, claim.id);
        if (!items.length) throw new ExpenseValidationException({ items: 'Add at least one expense line before submitting.' });
        const employee = await trx.selectFrom('users').select(['is_active', 'region_id']).where('id', '=', claim.employee_id).executeTakeFirst();
        if (!employee?.is_active) throw new ForbiddenException('Your account is inactive and cannot submit expense claims.');

        // Re-check every line against today's rules (dates move, links change, receipts get removed).
        const errors: FieldErrors = {};
        const window = await this.claims.windowForClaim(trx, claim);
        const atts = await trx
          .selectFrom('expense_attachments')
          .select(['item_id', sql<number>`count(*)::int`.as('n')])
          .where('item_id', 'in', items.map((i) => i.id))
          .where('deleted_at', 'is', null)
          .groupBy('item_id')
          .execute();
        for (const it of items) {
          const category = await this.claims.loadCategory(trx, it.category_id);
          try {
            validateItem(
              {
                expense_date: it.expense_date,
                category_id: it.category_id,
                amount: Number(it.amount),
                purpose: it.purpose,
                customer_id: it.customer_id,
                project_id: it.project_id,
                remarks: it.remarks,
                late_submission_reason: it.late_submission_reason,
                category_details: it.category_details,
              },
              { category, today, config: this.claims.config, window, categoryUnchanged: true },
            );
          } catch (e: any) {
            const fieldErrors = e?.getResponse?.()?.errors || {};
            for (const [f, m] of Object.entries(fieldErrors)) errors[`items.${it.id}.${f}`] = String(m);
          }
          const needsReceipt = receiptRequired({ receipt_required_above: money(it.receipt_required_above) }, Number(it.amount));
          if (needsReceipt && !atts.find((a) => a.item_id === it.id)) {
            errors[`items.${it.id}.receipt`] = `A receipt is required for "${it.purpose}" (${it.category_name}).`;
          }
        }
        if (Object.keys(errors).length) {
          throw new ExpenseValidationException(errors, 'Some expense lines need attention before this claim can be submitted.');
        }

        // Approver snapshot: resolve on first submission, or again if the old approver is no longer usable.
        let approverId = claim.manager_id;
        let viaFallback = false;
        const current = approverId
          ? await trx.selectFrom('users').select(['is_active']).where('id', '=', approverId).executeTakeFirst()
          : null;
        if (from === 'draft' || !approverId || !current?.is_active || approverId === claim.employee_id) {
          const resolved = await this.resolveApprover(trx, claim.employee_id);
          approverId = resolved.approverId;
          viaFallback = resolved.viaFallback;
        }
        const resubmit = from === 'clarification_required';
        if (resubmit) {
          await trx
            .updateTable('expense_items')
            .set({ item_status: 'pending', approved_amount: null, manager_approved_amount: null, updated_by: user.id })
            .where('claim_id', '=', claim.id)
            .where('deleted_at', 'is', null)
            .execute();
        }
        Object.assign(patch, {
          manager_id: approverId,
          region_id: claim.region_id ?? employee.region_id,
          submitted_at: claim.submitted_at ?? now,
          total_approved: null,
          last_reviewer_comment: resubmit ? claim.last_reviewer_comment : null,
        });
        await this.claims.history(trx, claim.id, {
          from,
          to,
          action: resubmit ? 'resubmit' : 'submit',
          actor: user,
          comment,
          metadata: { item_count: items.length, total: Number(claim.total_claimed), approver_id: approverId, via_fallback: viaFallback },
        });
        event = EXPENSE_EVENTS.SUBMITTED;
        payload = { ...base, approverId, amount: Number(claim.total_claimed), employeeName: user.full_name, resubmitted: resubmit };
        break;
      }

      case 'withdraw': {
        await this.claims.history(trx, claim.id, { from, to, action: 'withdraw', actor: user, comment });
        event = EXPENSE_EVENTS.WITHDRAWN;
        payload = { ...base, approverId: from === 'submitted' ? claim.manager_id : null };
        break;
      }

      case 'manager_approve':
      case 'accounts_approve':
      case 'process': {
        const stage = rule.action === 'manager_approve' ? 'manager' : 'accounts';
        const items = await this.liveItems(trx, claim.id);
        // A future-dated expense must never be approved or paid, even if it got past submission earlier.
        assertNoFutureDates(
          items,
          today,
          rule.action === 'manager_approve' ? 'approved' : rule.action === 'accounts_approve' ? 'verified' : 'processed for payment',
          claim.period_to,
        );
        // Payment details are checked before any line decision is written so the dialog gets every field error at once.
        const payment = rule.action === 'process' ? readPaymentDetails(dto, today, items) : null;
        if (payment && Object.keys(payment.errors).length) {
          throw new ExpenseValidationException(payment.errors, 'Enter the payment details to mark this claim as paid.');
        }
        // `process` straight from accounts_approved: amounts are already settled; decisions are not accepted.
        const decide = !(rule.action === 'process' && from === 'accounts_approved');
        let totalApproved = money(claim.total_approved) ?? 0;
        let decisionMeta: unknown;
        // Lines that stay payable after this step (rejected lines need no receipt).
        const payableIds = new Set(items.filter((i) => i.item_status !== 'rejected').map((i) => i.id));
        if (decide) {
          const result = applyItemDecisions(
            items.map((i) => ({ id: i.id, amount: Number(i.amount), approved_amount: money(i.approved_amount), item_status: i.item_status as any })),
            dto.items,
            stage,
          );
          if (Object.keys(result.errors).length) throw new ExpenseValidationException(result.errors);
          if (result.allRejected && rule.action === 'process') {
            throw new ExpenseValidationException({ items: 'Nothing is approved on this claim — reject it instead of processing.' });
          }
          await this.writeItemDecisions(trx, items, result.updates, stage, user);
          for (const u of result.updates) {
            if (u.item_status === 'rejected') payableIds.delete(u.id);
            else payableIds.add(u.id);
          }
          totalApproved = result.totalApproved;
          if (result.allRejected) {
            // §5.22: rejecting every line rejects the claim.
            to = 'rejected';
            Object.assign(patch, { total_approved: 0, last_reviewer_comment: comment ?? 'All expense lines were rejected.' });
            if (stage === 'manager') patch.manager_actioned_at = now;
            else patch.accounts_actioned_at = now;
            await this.claims.history(trx, claim.id, {
              from,
              to,
              action: 'auto_reject',
              actor: user,
              comment: comment ?? 'All expense lines were rejected.',
              metadata: { decisions: result.updates },
            });
            event = EXPENSE_EVENTS.REJECTED;
            payload = { ...base, comment: comment ?? 'All expense lines were rejected.', stage };
            break;
          }
          patch.total_approved = totalApproved;
          if (rule.action !== 'process' || from === 'accounts_review') {
            if (stage === 'manager') patch.manager_actioned_at = now;
            else patch.accounts_actioned_at = now;
          }
          if (comment) patch.last_reviewer_comment = comment;
          decisionMeta = { decisions: result.updates, total_approved: totalApproved };
        }
        const gaps = await this.receiptGaps(trx, items, payableIds, today);
        if (gaps.length) decisionMeta = { ...((decisionMeta as object | undefined) ?? {}), anomalies: { receipt_missing: gaps } };

        if (rule.action === 'manager_approve') {
          await this.claims.history(trx, claim.id, { from, to: 'manager_approved', action: 'manager_approve', actor: user, comment, metadata: decisionMeta });
          // Manager approval hands the claim straight to the Accounts queue.
          to = 'accounts_review';
          await this.claims.history(trx, claim.id, { from: 'manager_approved', to, action: 'forward_to_accounts', actor: null });
          event = EXPENSE_EVENTS.MANAGER_APPROVED;
          payload = { ...base, amount: totalApproved };
        } else if (rule.action === 'accounts_approve') {
          await this.claims.history(trx, claim.id, { from, to, action: 'accounts_approve', actor: user, comment, metadata: decisionMeta });
          event = EXPENSE_EVENTS.ACCOUNTS_APPROVED;
          payload = { ...base, amount: totalApproved };
        } else {
          const { tallyRef: ref, paymentReference: payRef, paymentDate: payDate } = payment!;
          Object.assign(patch, {
            tally_voucher_ref: ref,
            payment_reference: payRef,
            payment_date: payDate,
            processed_at: now,
            accounts_actioned_at: claim.accounts_actioned_at ?? now,
          });
          await this.claims.history(trx, claim.id, {
            from,
            to,
            action: 'process',
            actor: user,
            comment,
            metadata: { tally_voucher_ref: ref, payment_reference: payRef, payment_date: payDate, ...((decisionMeta as object | undefined) ?? {}) },
          });
          event = EXPENSE_EVENTS.PROCESSED;
          payload = { ...base, amount: totalApproved, tallyRef: ref, paymentReference: payRef, paymentDate: payDate };
        }
        break;
      }

      case 'manager_reject':
      case 'accounts_reject': {
        await trx
          .updateTable('expense_items')
          .set({ item_status: 'rejected', approved_amount: 0, updated_by: user.id })
          .where('claim_id', '=', claim.id)
          .where('deleted_at', 'is', null)
          .execute();
        Object.assign(patch, {
          total_approved: 0,
          last_reviewer_comment: comment,
          ...(rule.action === 'manager_reject' ? { manager_actioned_at: now } : { accounts_actioned_at: now }),
        });
        await this.claims.history(trx, claim.id, { from, to, action: rule.action, actor: user, comment });
        event = EXPENSE_EVENTS.REJECTED;
        payload = { ...base, stage: rule.action === 'manager_reject' ? 'manager' : 'accounts' };
        break;
      }

      case 'request_clarification': {
        Object.assign(patch, {
          last_reviewer_comment: comment,
          ...(rule.actor === 'approver' ? { manager_actioned_at: now } : { accounts_actioned_at: now }),
        });
        await this.claims.history(trx, claim.id, { from, to, action: 'request_clarification', actor: user, comment });
        event = EXPENSE_EVENTS.CLARIFICATION;
        payload = { ...base, stage: rule.actor === 'approver' ? 'manager' : 'accounts' };
        break;
      }
    }

    const res = await trx
      .updateTable('expense_claims')
      .set({ ...(patch as any), status: to, version: sql`version + 1`, updated_by: user.id })
      .where('id', '=', claim.id)
      .where('version', '=', claim.version)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw staleVersion();
    return { from, to, event, payload: { ...payload, status: to } };
  }

  async reassignApprover(id: string, dto: ReassignApproverDto, user: AuthUser) {
    if (!isAdminLike(user)) throw new ForbiddenException('Only an administrator can reassign the approver.');
    await this.claims.getVisibleClaim(id, user);
    const result = await this.db.transaction().execute(async (trx) => {
      const claim = await this.claims.lockClaim(trx, id);
      if (claim.status !== 'submitted') throw conflict('The approver can only be changed while the claim is awaiting manager review.');
      const version = readVersion(dto.version, true);
      if (claim.version !== version) throw staleVersion();
      const errors: FieldErrors = {};
      const comment = readText(errors, 'comment', dto.comment, TEXT_LIMITS.comment, { label: 'Comment' });
      const approverId = typeof dto.approver_id === 'string' ? dto.approver_id : '';
      if (!/^[0-9a-f-]{36}$/i.test(approverId)) errors.approver_id = 'Choose a new approver.';
      if (Object.keys(errors).length) throw new ExpenseValidationException(errors);
      const approver = await trx.selectFrom('users').select(['id', 'is_active', 'full_name']).where('id', '=', approverId).executeTakeFirst();
      if (!approver) throw new ExpenseValidationException({ approver_id: 'Approver not found.' });
      if (!approver.is_active) throw new ExpenseValidationException({ approver_id: 'The new approver must be an active user.' });
      if (approver.id === claim.employee_id) throw new ExpenseValidationException({ approver_id: 'An employee cannot approve their own claim.' });
      if (approver.id === claim.manager_id) throw new ExpenseValidationException({ approver_id: 'This user is already the approver.' });
      await trx
        .updateTable('expense_claims')
        .set({ manager_id: approver.id, version: sql`version + 1`, updated_by: user.id })
        .where('id', '=', id)
        .execute();
      await this.claims.history(trx, id, {
        from: 'submitted',
        to: 'submitted',
        action: 'reassign_approver',
        actor: user,
        comment: comment ?? `Approver changed to ${approver.full_name}`,
        metadata: { from_approver_id: claim.manager_id, to_approver_id: approver.id },
      });
      return { claim, approver };
    });
    this.claims.events.emit(EXPENSE_EVENTS.APPROVER_REASSIGNED, {
      claimId: id,
      claimNumber: result.claim.claim_number,
      approverId: result.approver.id,
      employeeId: result.claim.employee_id,
      amount: Number(result.claim.total_claimed),
    });
    this.claims.events.emit('audit.log', {
      actorId: user.id,
      entityType: 'expense_claim',
      entityId: id,
      action: 'expense_reassign_approver',
      previousValue: { manager_id: result.claim.manager_id },
      newValue: { manager_id: result.approver.id },
    });
    return this.claims.getDetail(id, user);
  }
}
