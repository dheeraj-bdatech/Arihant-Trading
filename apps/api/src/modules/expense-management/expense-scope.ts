/**
 * Role scoping for every Module 9 read path (lists, detail, queues, reports, exports).
 * Queries alias claims as `c` and the claim owner as `emp`.
 *
 * - admin / management: everything
 * - accounts: own claims + everything that has reached the Accounts stage
 * - regional_manager: own claims + team (approver or reporting line) + own region
 * - everyone else: own claims + claims they approve / their direct reports' claims
 * Other people's drafts are never visible (except to admin / management).
 */
import { sql, type ExpressionBuilder } from 'kysely';
import type { AuthUser } from '@arihant/shared';

export const ACCOUNTS_VISIBLE_STATUSES = ['manager_approved', 'accounts_review', 'accounts_approved', 'processed'] as const;

export function isAdminLike(user: { role: string }): boolean {
  return user.role === 'admin' || user.role === 'management';
}

export function claimScopeFilter(user: AuthUser) {
  return (eb: ExpressionBuilder<any, any>) => {
    if (isAdminLike(user)) return sql<boolean>`true`;
    const own = eb('c.employee_id', '=', user.id);
    const notDraft = eb('c.status', '<>', 'draft');
    const team = eb.and([
      notDraft,
      eb.or([eb('c.manager_id', '=', user.id), eb('emp.reporting_manager_id', '=', user.id)]),
    ]);
    const ors = [own, team];
    if (user.role === 'accounts') {
      ors.push(
        eb.or([
          eb('c.status', 'in', [...ACCOUNTS_VISIBLE_STATUSES]),
          eb('c.accounts_actioned_at', 'is not', null),
        ]),
      );
    }
    if (user.role === 'regional_manager' && user.region_id) {
      ors.push(eb.and([notDraft, eb('c.region_id', '=', user.region_id)]));
    }
    return eb.or(ors);
  };
}

/** Claims waiting on the Accounts team (Stage 2): to verify, or verified and waiting for Tally / payment. */
export const ACCOUNTS_WORK_STATUSES = ['accounts_review', 'accounts_approved'] as const;

/**
 * The Expenses list (narrower than the read scope above): only management / admin see every member's claims.
 * Everyone else sees the claims that concern them — their own, the ones waiting on them (Stage-1 approver, or
 * Accounts at Stage 2) and the ones they have already acted on. Other people's drafts are never listed.
 */
export function relevantClaimsFilter(user: AuthUser) {
  return (eb: ExpressionBuilder<any, any>) => {
    const own = eb('c.employee_id', '=', user.id);
    if (isAdminLike(user)) return eb.or([own, eb('c.status', '<>', 'draft')]);
    const ors = [
      own,
      eb.and([eb('c.status', '=', 'submitted'), eb('c.manager_id', '=', user.id)]),
      eb.exists(
        eb
          .selectFrom('expense_approval_history as h')
          .select('h.id')
          .whereRef('h.claim_id', '=', 'c.id')
          .where('h.actor_id', '=', user.id),
      ),
    ];
    if (user.role === 'accounts') ors.push(eb('c.status', 'in', [...ACCOUNTS_WORK_STATUSES]));
    return eb.or(ors);
  };
}
