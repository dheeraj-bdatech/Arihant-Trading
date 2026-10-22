import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser, ProposalStatus, UserRole } from '@arihant/shared';
import { calendarDay, isoDaysBetween, todayInKolkata } from '../../common/utils/ist-date.util.js';

export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = ['CONVERTED', 'LOST', 'CLOSED'];

/** The proposal number every screen, notification and task shows (PROP-2026-1076); PRP-… is the internal canonical id. */
export function proposalDisplayNo(p: { proposal_number?: string | null; proposal_no?: string | null } | null | undefined): string {
  return p?.proposal_number || p?.proposal_no || '';
}

/** True when the proposal carries a commercial value (₹ quoted amount above zero). */
export function hasQuotedValue(p: { quoted_value?: unknown } | null | undefined): boolean {
  const n = Number(p?.quoted_value);
  return Number.isFinite(n) && n > 0;
}

export interface TransitionContext {
  comment?: string;
  reason?: string;
  sent_date?: string;
  email_references?: string[];
  follow_up_owner_id?: string;
  next_follow_up_date?: string;
  outcome_date?: string;
  conversion_reference?: string;
  lost_reason_code?: string;
  lost_reason_text?: string;
  lost_to_competitor?: string;
  closure_reason_code?: string;
  closure_reason_text?: string;
  reopen_reason?: string;
  is_fast_track?: boolean;
}

export interface ProposalSettingsConfig {
  allow_self_approval?: boolean;
  allow_fast_track?: boolean;
  reopen_window_days?: number;
  default_follow_up_days?: number;
  business_timezone?: string;
}

@Injectable()
export class ProposalsWorkflowService {
  /**
   * Normalizes any raw status string (lowercase, legacy, or alias) to canonical uppercase enum
   */
  normalizeStatus(status: string | null | undefined): ProposalStatus {
    if (!status) return 'REQUESTED';
    const s = status.trim().toUpperCase();

    const map: Record<string, ProposalStatus> = {
      REQUESTED: 'REQUESTED',
      PROPOSAL_REQUESTED: 'REQUESTED',
      UNDER_PREPARATION: 'UNDER_PREPARATION',
      READY_FOR_REVIEW: 'READY_FOR_REVIEW',
      APPROVED: 'APPROVED',
      SENT_TO_CUSTOMER: 'SENT_TO_CUSTOMER',
      SENT: 'SENT_TO_CUSTOMER',
      FOLLOW_UP_REQUIRED: 'FOLLOW_UP_REQUIRED',
      FOLLOWUP_REQUIRED: 'FOLLOW_UP_REQUIRED',
      CONVERTED: 'CONVERTED',
      LOST: 'LOST',
      CLOSED: 'CLOSED',
    };

    if (map[s]) return map[s];
    throw new BadRequestException(`Invalid proposal status: "${status}"`);
  }

  /**
   * Determines if a status is terminal
   */
  isTerminal(status: string): boolean {
    const norm = this.normalizeStatus(status);
    return TERMINAL_PROPOSAL_STATUSES.includes(norm);
  }

  /**
   * Single source of truth for allowed state transitions
   */
  private readonly transitionsMap: Record<ProposalStatus, ProposalStatus[]> = {
    REQUESTED: ['UNDER_PREPARATION', 'CLOSED'],
    PROPOSAL_REQUESTED: ['UNDER_PREPARATION', 'CLOSED'],
    UNDER_PREPARATION: ['READY_FOR_REVIEW', 'SENT_TO_CUSTOMER', 'CLOSED'],
    READY_FOR_REVIEW: ['APPROVED', 'UNDER_PREPARATION', 'SENT_TO_CUSTOMER', 'CLOSED'],
    APPROVED: ['SENT_TO_CUSTOMER', 'UNDER_PREPARATION', 'CLOSED'],
    SENT_TO_CUSTOMER: ['FOLLOW_UP_REQUIRED', 'UNDER_PREPARATION', 'CONVERTED', 'LOST', 'CLOSED'],
    FOLLOW_UP_REQUIRED: ['UNDER_PREPARATION', 'CONVERTED', 'LOST', 'CLOSED'],
    CONVERTED: ['REQUESTED'],
    LOST: ['REQUESTED'],
    CLOSED: ['REQUESTED'],
    // legacy support
    requested: ['UNDER_PREPARATION', 'CLOSED'],
    under_preparation: ['READY_FOR_REVIEW', 'SENT_TO_CUSTOMER', 'CLOSED'],
    ready_for_review: ['APPROVED', 'UNDER_PREPARATION', 'SENT_TO_CUSTOMER', 'CLOSED'],
    approved: ['SENT_TO_CUSTOMER', 'UNDER_PREPARATION', 'CLOSED'],
    sent: ['FOLLOW_UP_REQUIRED', 'UNDER_PREPARATION', 'CONVERTED', 'LOST', 'CLOSED'],
    followup_required: ['UNDER_PREPARATION', 'CONVERTED', 'LOST', 'CLOSED'],
    converted: ['REQUESTED'],
    lost: ['REQUESTED'],
    closed: ['REQUESTED'],
  };

  /**
   * True when the user is a party to the proposal: the person who requested or created it, the responsible
   * proposal person, or the follow-up owner.
   */
  isParty(proposal: any, user: AuthUser): boolean {
    const uid = user?.id;
    if (!uid) return false;
    return [
      proposal.requested_by_id,
      proposal.requested_by,
      proposal.created_by_id,
      proposal.created_by,
      proposal.responsible_person_id,
      proposal.responsible_id,
      proposal.follow_up_owner_id,
      proposal.followup_owner_id,
    ].includes(uid);
  }

  /**
   * Who may edit or progress a proposal (RBAC):
   *  - management / admin: every proposal;
   *  - regional manager: every proposal in their scope (row visibility is enforced when the proposal is loaded);
   *  - sales / tender team and everyone else: only proposals they requested, created, are responsible for or own
   *    the follow-up of. Seeing a colleague's proposal in the region does not make it theirs to change.
   */
  canActOn(proposal: any, user: AuthUser): boolean {
    const role = (user?.role || '').toLowerCase();
    if (role === 'admin' || role === 'management' || role === 'regional_manager') return true;
    return this.isParty(proposal, user);
  }

  /** Throws 403 with a human explanation when `canActOn` is false. */
  assertCanAct(proposal: any, user: AuthUser): void {
    if (this.canActOn(proposal, user)) return;
    const no = proposalDisplayNo(proposal) || 'this proposal';
    const owner = proposal.responsible_name || proposal.requested_by_name;
    throw new ForbiddenException({
      message:
        `You can only change proposals you requested or are responsible for. ${no} belongs to ` +
        `${owner || 'another salesperson'}; ask them, your regional manager or management to make this change.`,
    });
  }

  /** Days since the proposal reached its terminal outcome, on IST calendar days. */
  private daysSinceOutcome(proposal: any, now: Date): number | null {
    const outcomeDay = calendarDay(proposal.outcome_date) || calendarDay(proposal.updated_at);
    if (!outcomeDay) return null;
    return isoDaysBetween(outcomeDay, todayInKolkata(now));
  }

  /**
   * Calculates allowed target transitions for a proposal tailored to the given user and settings
   */
  getAllowedTransitions(
    proposal: any,
    user: AuthUser,
    settings?: ProposalSettingsConfig,
  ): ProposalStatus[] {
    const current = this.normalizeStatus(proposal.status);
    const role = (user.role || '').toLowerCase();
    const isAdminOrMgmt = role === 'admin' || role === 'management';
    const isRegionalMgr = role === 'regional_manager';
    const isSales = role === 'sales';
    const isTender = role === 'tender_team';
    const userId = user.id;

    const responsibleId = proposal.responsible_person_id || proposal.responsible_id;
    const isResponsible = userId === responsibleId;
    const isRequester = userId === (proposal.requested_by_id || proposal.requested_by);
    const isFollowUpOwner = userId === (proposal.follow_up_owner_id || proposal.followup_owner_id);

    // Terminal statuses can only be reopened by manager or admin within reopen window
    if (this.isTerminal(current)) {
      if (!isAdminOrMgmt) return [];
      const windowDays = settings?.reopen_window_days ?? 30;
      const diffDays = this.daysSinceOutcome(proposal, new Date());
      if (diffDays !== null && diffDays <= windowDays) {
        return ['REQUESTED'];
      }
      return [];
    }

    // Sales / tender users only progress proposals they are a party to (DEF-008)
    if (!this.canActOn(proposal, user)) return [];

    const potential = this.transitionsMap[current] || [];
    const allowed: ProposalStatus[] = [];

    for (const target of potential) {
      if (target === 'UNDER_PREPARATION') {
        if (current === 'REQUESTED') {
          // Guard: responsible person must be set to start preparation
          if (responsibleId && (isResponsible || isAdminOrMgmt || isRegionalMgr || isSales || isTender)) {
            allowed.push('UNDER_PREPARATION');
          }
        } else if (current === 'READY_FOR_REVIEW') {
          // Reviewer requesting changes - management and admin only
          if (isAdminOrMgmt) {
            allowed.push('UNDER_PREPARATION');
          }
        } else if (current === 'APPROVED') {
          // Internal revision before sending
          if (isResponsible || isAdminOrMgmt || isRegionalMgr) {
            allowed.push('UNDER_PREPARATION');
          }
        } else if (current === 'SENT_TO_CUSTOMER' || current === 'FOLLOW_UP_REQUIRED') {
          // Customer revision requested
          if (isFollowUpOwner || isResponsible || isAdminOrMgmt || isRegionalMgr || isSales) {
            allowed.push('UNDER_PREPARATION');
          }
        }
      } else if (target === 'READY_FOR_REVIEW') {
        if (isResponsible || isAdminOrMgmt || isRegionalMgr) {
          allowed.push('READY_FOR_REVIEW');
        }
      } else if (target === 'APPROVED') {
        // Approver check: management and admin only (anti-self-approval: not the one who created/requested/authored it)
        if (isAdminOrMgmt) {
          const isCreator =
            userId === proposal.created_by_id ||
            userId === proposal.created_by ||
            isRequester ||
            isResponsible;
          if (!isCreator) {
            allowed.push('APPROVED');
          }
        }
      } else if (target === 'SENT_TO_CUSTOMER') {
        if (current === 'APPROVED') {
          if (isResponsible || isSales || isAdminOrMgmt || isRegionalMgr || isTender) {
            allowed.push('SENT_TO_CUSTOMER');
          }
        } else if (current === 'UNDER_PREPARATION' || current === 'READY_FOR_REVIEW') {
          // Fast-track send
          if (settings?.allow_fast_track && (isAdminOrMgmt || role === 'regional_manager')) {
            allowed.push('SENT_TO_CUSTOMER');
          }
        }
      } else if (target === 'FOLLOW_UP_REQUIRED') {
        if (isFollowUpOwner || isSales || isAdminOrMgmt || isRegionalMgr) {
          allowed.push('FOLLOW_UP_REQUIRED');
        }
      } else if (target === 'CONVERTED' || target === 'LOST') {
        if (isFollowUpOwner || isResponsible || isAdminOrMgmt || isRegionalMgr || isSales) {
          allowed.push(target);
        }
      } else if (target === 'CLOSED') {
        if (isRequester || isResponsible || isFollowUpOwner || isAdminOrMgmt || isRegionalMgr) {
          allowed.push('CLOSED');
        }
      }
    }

    return Array.from(new Set(allowed));
  }

  /**
   * Strictly validates a requested transition and context against state machine rules and guards.
   * Throws 409 Conflict if invalid, 403 Forbidden if unauthorized.
   */
  validateTransition(
    proposal: any,
    targetStatusRaw: string,
    user: AuthUser,
    context?: TransitionContext,
    settings?: ProposalSettingsConfig,
    now: Date = new Date(),
  ): { targetStatus: ProposalStatus } {
    // All calendar-date guards compare IST calendar days ('YYYY-MM-DD'), never UTC instants: between 00:00 and 05:30
    // IST the UTC clock is still on yesterday, which used to refuse today's date as "in the future".
    const today = todayInKolkata(now);
    const current = this.normalizeStatus(proposal.status);
    const target = this.normalizeStatus(targetStatusRaw);
    const allowed = this.getAllowedTransitions(proposal, user, settings);

    const responsibleId = proposal.responsible_person_id || proposal.responsible_id;
    const role = (user.role || '').toLowerCase();
    const isAdminOrMgmt = role === 'admin' || role === 'management';
    const proposalNo = proposalDisplayNo(proposal) || 'This proposal';

    // E19: Action on terminal status
    if (this.isTerminal(current)) {
      if (target === 'REQUESTED') {
        if (!isAdminOrMgmt) {
          throw new ForbiddenException({
            message: 'Only management or admin can reopen a closed or resolved proposal',
            allowed_transitions: allowed,
          });
        }
        if (!context?.reopen_reason?.trim()) {
          throw new BadRequestException('A reason is mandatory when reopening a proposal');
        }
        const windowDays = settings?.reopen_window_days ?? 30;
        const diffDays = this.daysSinceOutcome(proposal, now);
        if (diffDays !== null && diffDays > windowDays) {
          throw new ConflictException({
            message: `Cannot reopen proposal outside the ${windowDays}-day reopen window. Create a new linked proposal instead.`,
            allowed_transitions: [],
          });
        }
        return { targetStatus: 'REQUESTED' };
      }

      throw new ConflictException({
        message: `${proposalNo} is ${current} and read-only; it cannot move to ${target}. Management or admin can reopen it.`,
        allowed_transitions: allowed,
      });
    }

    // DEF-008: sales / tender users may only progress proposals they requested or are responsible for (403).
    this.assertCanAct(proposal, user);

    // Check transition allowed list
    if (!allowed.includes(target)) {
      if (target === 'APPROVED') {
        if (role !== 'admin' && role !== 'management') {
          throw new ForbiddenException({
            message: 'Only Top Management and System Administrator can approve proposals.',
            allowed_transitions: allowed,
          });
        }
        const isCreator =
          user.id === proposal.created_by_id ||
          user.id === proposal.created_by ||
          user.id === (proposal.requested_by_id || proposal.requested_by) ||
          user.id === (proposal.responsible_person_id || proposal.responsible_id);
        if (isCreator) {
          // Self-approval blocked
          throw new ForbiddenException({
            message: 'Self-approval is blocked. The person who created, requested, or authored this proposal cannot approve it.',
            allowed_transitions: allowed,
          });
        }
      }

      if (target === 'UNDER_PREPARATION' && current === 'REQUESTED' && !responsibleId) {
        // E13: Responsible person missing
        throw new ConflictException({
          message: 'Proposal cannot move to UNDER_PREPARATION without a responsible person assigned.',
          allowed_transitions: allowed,
        });
      }

      if (target === 'SENT_TO_CUSTOMER' && (current === 'UNDER_PREPARATION' || current === 'READY_FOR_REVIEW')) {
        // E24: Fast-track without setting enabled
        if (!settings?.allow_fast_track) {
          throw new ForbiddenException({
            message: 'Fast-track sending is disabled in system settings.',
            allowed_transitions: allowed,
          });
        }
      }

      throw new ConflictException({
        message: `Cannot transition proposal from ${current} to ${target}`,
        allowed_transitions: allowed,
      });
    }

    // DEF-029: a proposal cannot go to review, be approved or be fast-tracked to the customer without a quoted value.
    const needsCommercialValue =
      target === 'READY_FOR_REVIEW' ||
      target === 'APPROVED' ||
      (target === 'SENT_TO_CUSTOMER' && (current === 'UNDER_PREPARATION' || current === 'READY_FOR_REVIEW'));
    if (needsCommercialValue && !hasQuotedValue(proposal)) {
      throw new BadRequestException(
        target === 'APPROVED'
          ? `${proposalNo} has no quoted value. Pricing must be entered (Edit → Commercial terms) before it can be approved.`
          : `Enter the quoted value (₹) for ${proposalNo} (Edit → Commercial terms) before submitting it for review.`,
      );
    }

    // Validate transition specific required data (E28, E29, etc.)
    if (target === 'CLOSED') {
      if (!context?.closure_reason_code?.trim() || !context?.closure_reason_text?.trim()) {
        throw new BadRequestException('Closure reason code and closure remarks are mandatory when closing a proposal');
      }
    } else if (target === 'LOST') {
      if (!context?.lost_reason_code?.trim() || !context?.lost_reason_text?.trim()) {
        throw new BadRequestException('Lost reason code and lost explanation are mandatory when marking a proposal as lost');
      }
      const lostDay = calendarDay(context?.outcome_date);
      if (lostDay && lostDay > today) {
        throw new BadRequestException(`Outcome date cannot be in the future (today is ${today} IST)`);
      }
    } else if (target === 'CONVERTED') {
      if (!context?.outcome_date) {
        throw new BadRequestException('Outcome date is mandatory when marking a proposal as converted');
      }
      const outcomeDay = calendarDay(context.outcome_date);
      if (!outcomeDay) {
        throw new BadRequestException('Outcome date must be a valid date');
      }
      if (outcomeDay > today) {
        throw new BadRequestException(`Outcome date cannot be in the future (today is ${today} IST)`);
      }
      const sentDay = calendarDay(proposal.sent_date);
      if (sentDay && outcomeDay < sentDay) {
        throw new BadRequestException(`Outcome date cannot be earlier than the sent date (${sentDay})`);
      }
    } else if (target === 'UNDER_PREPARATION' && current === 'READY_FOR_REVIEW') {
      // E22: Reviewer requests changes requires comment
      if (!context?.comment?.trim()) {
        throw new BadRequestException('A comment explaining requested changes is mandatory');
      }
    } else if (target === 'SENT_TO_CUSTOMER') {
      // E7, E26: Sent date, email reference, follow up owner, next follow up date
      if (!context?.sent_date) {
        throw new BadRequestException('Sent date is required when dispatching proposal to customer');
      }
      const sentDay = calendarDay(context.sent_date);
      if (!sentDay) {
        throw new BadRequestException('Sent date must be a valid date');
      }
      if (sentDay > today) {
        throw new BadRequestException(`Sent date cannot be in the future (today is ${today} IST)`);
      }
      const requestDay = calendarDay(proposal.request_date);
      if (requestDay && sentDay < requestDay) {
        throw new BadRequestException(`Sent date cannot be earlier than the proposal request date (${requestDay})`);
      }
      if (!context.email_references || context.email_references.length === 0 || !context.email_references[0]?.trim()) {
        throw new BadRequestException('Enter the email or dispatch reference the quote was sent under.');
      }
      if (!context.follow_up_owner_id) {
        throw new BadRequestException('A follow-up owner must be assigned when sending to customer');
      }
      if (!context.next_follow_up_date) {
        throw new BadRequestException('Next follow-up date is required when dispatching to customer');
      }
      const nextDay = calendarDay(context.next_follow_up_date);
      if (!nextDay) {
        throw new BadRequestException('Next follow-up date must be a valid date');
      }
      if (nextDay < sentDay) {
        throw new BadRequestException(`Next follow-up date cannot be earlier than the sent date (${sentDay})`);
      }
    }

    return { targetStatus: target };
  }
}
