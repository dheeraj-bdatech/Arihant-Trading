import { Injectable, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import type { AuthUser, TenderStatus } from '@arihant/shared';

/** The 13 tender stages of PRD §23 (frozen in SCOPE_FREEZE §2.1 and MODULE_4 §2). */
export type StandardTenderStatus =
  | 'IDENTIFIED'
  | 'AWAITING_INTERNAL_APPROVAL'
  | 'REJECTED_INTERNALLY'
  | 'UNDER_PREPARATION'
  | 'PQ_SUBMITTED'
  | 'PQ_QUALIFIED'
  | 'TENDER_SUBMITTED'
  | 'TECHNICAL_EVALUATION'
  | 'COMMERCIAL_EVALUATION'
  | 'WON'
  | 'LOST'
  | 'CANCELLED'
  | 'ON_HOLD';

/** Closed stages. Rejected Internally is not one: it can be re-submitted for approval (MODULE_4 §2). */
export const TERMINAL_STATUSES: StandardTenderStatus[] = ['WON', 'LOST', 'CANCELLED'];

@Injectable()
export class TendersWorkflowService {
  /**
   * Normalizes incoming status string (uppercase or lowercase) to UPPERCASE StandardTenderStatus.
   */
  normalizeStatus(status: string): StandardTenderStatus {
    const s = (status || '').toUpperCase().trim();
    const map: Record<string, StandardTenderStatus> = {
      IDENTIFIED: 'IDENTIFIED',
      AWAITING_APPROVAL: 'AWAITING_INTERNAL_APPROVAL',
      AWAITING_INTERNAL_APPROVAL: 'AWAITING_INTERNAL_APPROVAL',
      REJECTED_INTERNALLY: 'REJECTED_INTERNALLY',
      UNDER_PREPARATION: 'UNDER_PREPARATION',
      PQ_SUBMITTED: 'PQ_SUBMITTED',
      PQ_QUALIFIED: 'PQ_QUALIFIED',
      SUBMITTED: 'TENDER_SUBMITTED',
      TENDER_SUBMITTED: 'TENDER_SUBMITTED',
      TECHNICAL_EVAL: 'TECHNICAL_EVALUATION',
      TECHNICAL_EVALUATION: 'TECHNICAL_EVALUATION',
      COMMERCIAL_EVAL: 'COMMERCIAL_EVALUATION',
      COMMERCIAL_EVALUATION: 'COMMERCIAL_EVALUATION',
      WON: 'WON',
      LOST: 'LOST',
      CANCELLED: 'CANCELLED',
      ON_HOLD: 'ON_HOLD',
      // Pre-PRD codes (PQ_NOT_QUALIFIED, REVERSE_AUCTION, PARTIALLY_WON …) are rejected: migration 036 folded stored
      // rows into PRD stages, and a retired code must never silently become another stage.
    };

    if (map[s]) return map[s];
    throw new BadRequestException(`Invalid tender status: "${status}"`);
  }

  /**
   * Maps to legacy/lowercase status for backward compatibility if needed.
   */
  toLegacyStatus(status: string): TenderStatus {
    const s = this.normalizeStatus(status);
    const map: Record<StandardTenderStatus, TenderStatus> = {
      IDENTIFIED: 'identified',
      AWAITING_INTERNAL_APPROVAL: 'awaiting_approval',
      REJECTED_INTERNALLY: 'rejected_internally',
      UNDER_PREPARATION: 'under_preparation',
      PQ_SUBMITTED: 'pq_submitted',
      PQ_QUALIFIED: 'pq_qualified',
      TENDER_SUBMITTED: 'submitted',
      TECHNICAL_EVALUATION: 'technical_eval',
      COMMERCIAL_EVALUATION: 'commercial_eval',
      WON: 'won',
      LOST: 'lost',
      CANCELLED: 'cancelled',
      ON_HOLD: 'on_hold',
    };
    return map[s] || 'identified';
  }

  /**
   * Returns executive label for a status.
   */
  getStatusLabel(status: string): string {
    const norm = this.normalizeStatus(status);
    const labels: Record<StandardTenderStatus, string> = {
      IDENTIFIED: 'Identified',
      AWAITING_INTERNAL_APPROVAL: 'Awaiting Internal Approval',
      REJECTED_INTERNALLY: 'Rejected Internally',
      UNDER_PREPARATION: 'Under Preparation',
      PQ_SUBMITTED: 'PQ Submitted',
      PQ_QUALIFIED: 'PQ Qualified',
      TENDER_SUBMITTED: 'Tender Submitted',
      TECHNICAL_EVALUATION: 'Technical Evaluation',
      COMMERCIAL_EVALUATION: 'Commercial Evaluation',
      WON: 'Won',
      LOST: 'Lost',
      CANCELLED: 'Cancelled',
      ON_HOLD: 'On Hold',
    };
    return labels[norm] || norm;
  }

  /**
   * Valid transition matrix (PRD §22–23, MODULE_4 §2): From -> Allowed Target Statuses.
   * Not qualifying at PQ or technical stage is recorded as Lost with an Eligibility / Technical reason; a bid Arihant
   * drops is Cancelled. On Hold is the `on_hold` flag set by hold/resume, never a target here.
   */
  private readonly allowedTransitions: Record<StandardTenderStatus, StandardTenderStatus[]> = {
    IDENTIFIED: ['AWAITING_INTERNAL_APPROVAL', 'UNDER_PREPARATION', 'REJECTED_INTERNALLY', 'CANCELLED'],
    AWAITING_INTERNAL_APPROVAL: ['UNDER_PREPARATION', 'REJECTED_INTERNALLY', 'IDENTIFIED', 'CANCELLED'],
    REJECTED_INTERNALLY: ['AWAITING_INTERNAL_APPROVAL', 'CANCELLED'], // Re-submit for approval opens a new round
    UNDER_PREPARATION: ['PQ_SUBMITTED', 'TENDER_SUBMITTED', 'CANCELLED'],
    PQ_SUBMITTED: ['PQ_QUALIFIED', 'LOST', 'CANCELLED'],
    PQ_QUALIFIED: ['UNDER_PREPARATION', 'TENDER_SUBMITTED', 'CANCELLED'],
    TENDER_SUBMITTED: ['TECHNICAL_EVALUATION', 'COMMERCIAL_EVALUATION', 'WON', 'LOST', 'CANCELLED'],
    TECHNICAL_EVALUATION: ['COMMERCIAL_EVALUATION', 'LOST', 'CANCELLED'],
    COMMERCIAL_EVALUATION: ['WON', 'LOST', 'CANCELLED'],
    WON: [],
    LOST: [],
    CANCELLED: [],
    ON_HOLD: [],
  };

  /**
   * Checks whether a status is terminal.
   */
  isTerminal(status: string): boolean {
    const s = this.normalizeStatus(status);
    return TERMINAL_STATUSES.includes(s);
  }

  /**
   * Validates whether a status transition is permitted.
   */
  canTransition(currentStatus: string, targetStatus: string): boolean {
    const from = this.normalizeStatus(currentStatus);
    const to = this.normalizeStatus(targetStatus);

    if (from === to) return true;
    const allowed = this.allowedTransitions[from] || [];
    return allowed.includes(to);
  }

  /**
   * Comprehensive transition assertion validating category, deadline, on_hold, and roles.
   */
  assertValidTransition(
    tender: {
      id: string;
      status: string;
      on_hold?: boolean | null;
      status_before_hold?: string | null;
      category?: string | null;
      category_requires_pq?: boolean | null;
      submission_deadline?: Date | string | null;
      assigned_to?: string | null;
      created_by?: string | null;
      tender_owner_id?: string | null;
      version?: number;
    },
    targetStatus: string,
    user: AuthUser,
    options?: {
      isApprovalAction?: boolean;
      isRecordResultAction?: boolean;
      expected_version?: number;
      rejection_reason?: string | null;
      loss_reasons?: string[] | null;
      loss_reason?: string | null;
      isApproverUser?: boolean;
      allowSelfApproval?: boolean;
      requestedBy?: string | null;
    },
  ): { from: StandardTenderStatus; to: StandardTenderStatus } {
    const from = this.normalizeStatus(tender.status);
    const to = this.normalizeStatus(targetStatus);

    // Optimistic locking check
    if (
      options?.expected_version !== undefined &&
      tender.version !== undefined &&
      tender.version !== options.expected_version
    ) {
      throw new ConflictException('This tender was updated by someone else – refresh');
    }

    // No-op transition
    if (from === to) {
      return { from, to };
    }

    // Rule: On hold blocks every transition except CANCELLED
    if (tender.on_hold) {
      if (to !== 'CANCELLED') {
        throw new BadRequestException(
          'Tender is currently ON HOLD. All status transitions are blocked except CANCELLED. Resume the tender first to continue.',
        );
      }
    }

    // Terminal statuses cannot transition normally (only reopen by admin)
    if (this.isTerminal(from)) {
      throw new BadRequestException(
        `Cannot change status from completed terminal stage "${this.getStatusLabel(from)}". Closed tenders are locked. Use reopen (admin only).`,
      );
    }

    // Check transition matrix
    if (!this.canTransition(from, to)) {
      if (options?.isRecordResultAction && (to === 'WON' || to === 'LOST')) {
        const evaluationStages: StandardTenderStatus[] = [
          'TENDER_SUBMITTED',
          'TECHNICAL_EVALUATION',
          'COMMERCIAL_EVALUATION',
        ];
        if (!evaluationStages.includes(from)) {
          throw new BadRequestException(
            `Cannot record outcome from stage "${this.getStatusLabel(from)}". Tenders must be in an evaluation or submission stage.`,
          );
        }
      } else {
        throw new BadRequestException(
          `Cannot move tender from "${this.getStatusLabel(from)}" directly to "${this.getStatusLabel(to)}". Valid next states: ${
            this.allowedTransitions[from]?.map((s) => `"${this.getStatusLabel(s)}"`).join(', ') || 'None'
          }`,
        );
      }
    }

    // Rule: Submit for approval requires assigned_to to be set
    if (to === 'AWAITING_INTERNAL_APPROVAL' && !tender.assigned_to) {
      throw new BadRequestException(
        'Cannot request internal approval: assigned salesperson/tender person must be set before submitting for approval.',
      );
    }

    // Rule: UNDER_PREPARATION and REJECTED_INTERNALLY can only be reached through the approval action by Management or Admin
    if (
      (to === 'UNDER_PREPARATION' || to === 'REJECTED_INTERNALLY') &&
      (from === 'AWAITING_INTERNAL_APPROVAL' || from === 'IDENTIFIED')
    ) {
      if (!options?.isApprovalAction) {
        throw new BadRequestException(
          `Transition to "${this.getStatusLabel(to)}" can only be performed through the official approval/rejection action by Management or Admin.`,
        );
      }

      // Check approver authorization: strictly Management and Admin only
      const isAuthorizedRole = user.role === 'management' || user.role === 'admin';
      if (!isAuthorizedRole) {
        throw new ForbiddenException(
          'Strict Governance: Only Management and Admin roles are authorized to approve or reject tender participation during internal review.',
        );
      }

      // Check self-approval (Dual-control rule)
      if (options?.allowSelfApproval === false && options?.requestedBy) {
        const isRequester = options.requestedBy === user.id;
        const isCreator = Boolean(tender.created_by && tender.created_by === user.id);
        const isAssignee = Boolean(tender.assigned_to && tender.assigned_to === user.id);
        const isOwner = Boolean(tender.tender_owner_id && tender.tender_owner_id === user.id);

        if (user.role === 'admin') {
          // Platform admin always permitted to approve
        } else if (user.role === 'management') {
          // Executive Management can approve any opportunity created/assigned to someone else.
          // Only block if management themselves specifically created AND is assigned to this opportunity alone
          if (isRequester && isCreator && isAssignee) {
            throw new ForbiddenException(
              'Self-approval is disallowed. You cannot approve or reject your own approval request.',
            );
          }
        } else {
          // For sales, tender_team, or regional_manager:
          // Disallow if they requested it AND it is their own opportunity (created, assigned, or owned)
          if (isRequester && (isCreator || isAssignee || isOwner)) {
            throw new ForbiddenException(
              'Self-approval is disallowed. You cannot approve or reject your own approval request.',
            );
          }
        }
      }

      // Rejection requires reason
      if (to === 'REJECTED_INTERNALLY' && !options?.rejection_reason?.trim()) {
        throw new BadRequestException(
          'A rejection reason is mandatory when rejecting tender participation.',
        );
      }
    }

    // Category-specific PQ vs General rules
    const isPQCategory = Boolean(
      options?.expected_version !== undefined
        ? tender.category_requires_pq
        : tender.category_requires_pq ??
            (tender.category === 'pq' || (tender.category || '').toLowerCase() === 'pq'),
    );

    // Rule: A PQ-category tender cannot go to TENDER_SUBMITTED directly from UNDER_PREPARATION
    if (from === 'UNDER_PREPARATION' && to === 'TENDER_SUBMITTED' && isPQCategory) {
      throw new BadRequestException(
        'A PQ-category tender cannot go directly to TENDER_SUBMITTED from UNDER_PREPARATION. Proceed to PQ Submitted first.',
      );
    }

    // Rule: A non-PQ tender can never enter PQ stages (PQ_SUBMITTED, PQ_QUALIFIED)
    if (!isPQCategory && (to === 'PQ_SUBMITTED' || to === 'PQ_QUALIFIED')) {
      throw new BadRequestException(
        'A non-PQ tender can never enter PQ stages. Advance directly to "Tender Submitted".',
      );
    }

    // Rule: PQ_SUBMITTED and TENDER_SUBMITTED are blocked if now > submission_deadline
    if (to === 'PQ_SUBMITTED' || to === 'TENDER_SUBMITTED') {
      if (tender.submission_deadline) {
        const deadlineDate = new Date(tender.submission_deadline);
        if (new Date() > deadlineDate) {
          throw new BadRequestException(
            'Deadline passed – record corrigendum extension or cancel',
          );
        }
      }
    }

    // Rule: WON and LOST can only be set through Record Result form (PRD §26 win/loss capture)
    if ((to === 'WON' || to === 'LOST') && !options?.isRecordResultAction) {
      throw new BadRequestException(
        `Setting status to "${this.getStatusLabel(to)}" is only permitted through the "Record Result" form.`,
      );
    }

    return { from, to };
  }
}
