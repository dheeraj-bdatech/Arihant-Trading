import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser, ProposalStatus, UserRole } from '@arihant/shared';

export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = ['CONVERTED', 'LOST', 'CLOSED'];

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
      const outcomeDateStr = proposal.outcome_date || proposal.updated_at;
      if (outcomeDateStr) {
        const outcomeDate = new Date(outcomeDateStr);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - outcomeDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= windowDays) {
          return ['REQUESTED'];
        }
      }
      return [];
    }

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
  ): { targetStatus: ProposalStatus } {
    const current = this.normalizeStatus(proposal.status);
    const target = this.normalizeStatus(targetStatusRaw);
    const allowed = this.getAllowedTransitions(proposal, user, settings);

    const responsibleId = proposal.responsible_person_id || proposal.responsible_id;
    const role = (user.role || '').toLowerCase();
    const isAdminOrMgmt = role === 'admin' || role === 'management';

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
        const outcomeDateStr = proposal.outcome_date || proposal.updated_at;
        if (outcomeDateStr) {
          const outcomeDate = new Date(outcomeDateStr);
          const now = new Date();
          const diffDays = Math.floor((now.getTime() - outcomeDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > windowDays) {
            throw new ConflictException({
              message: `Cannot reopen proposal outside the ${windowDays}-day reopen window. Create a new linked proposal instead.`,
              allowed_transitions: [],
            });
          }
        }
        return { targetStatus: 'REQUESTED' };
      }

      throw new ConflictException({
        message: `Proposal is in terminal status ${current} and cannot transition to ${target}`,
        allowed_transitions: allowed,
      });
    }

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

    // Validate transition specific required data (E28, E29, etc.)
    if (target === 'CLOSED') {
      if (!context?.closure_reason_code?.trim() || !context?.closure_reason_text?.trim()) {
        throw new BadRequestException('Closure reason code and closure remarks are mandatory when closing a proposal');
      }
    } else if (target === 'LOST') {
      if (!context?.lost_reason_code?.trim() || !context?.lost_reason_text?.trim()) {
        throw new BadRequestException('Lost reason code and lost explanation are mandatory when marking a proposal as lost');
      }
    } else if (target === 'CONVERTED') {
      if (!context?.outcome_date) {
        throw new BadRequestException('Outcome date is mandatory when marking a proposal as converted');
      }
      const outcomeDate = new Date(context.outcome_date);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (outcomeDate > today) {
        throw new BadRequestException('Outcome date cannot be in the future');
      }
      if (proposal.sent_date) {
        const sentDate = new Date(proposal.sent_date);
        if (outcomeDate < sentDate) {
          throw new BadRequestException('Outcome date cannot be earlier than sent date');
        }
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
      const sentDate = new Date(context.sent_date);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (sentDate > today) {
        throw new BadRequestException('Sent date cannot be in the future');
      }
      if (proposal.request_date) {
        const reqDate = new Date(proposal.request_date);
        if (sentDate < reqDate) {
          throw new BadRequestException('Sent date cannot be earlier than request date');
        }
      }
      if (!context.email_references || context.email_references.length === 0 || !context.email_references[0]?.trim()) {
        throw new BadRequestException('At least one email reference or dispatched communication reference is required');
      }
      if (!context.follow_up_owner_id) {
        throw new BadRequestException('A follow-up owner must be assigned when sending to customer');
      }
      if (!context.next_follow_up_date) {
        throw new BadRequestException('Next follow-up date is required when dispatching to customer');
      }
      const nextDate = new Date(context.next_follow_up_date);
      if (nextDate < sentDate) {
        throw new BadRequestException('Next follow-up date cannot be earlier than sent date');
      }
    }

    return { targetStatus: target };
  }
}
