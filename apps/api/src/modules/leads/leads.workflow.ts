import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  LeadStatus,
  LEAD_STATUSES,
  LeadLossReason,
  LEAD_LOSS_REASONS,
  type UserRole,
} from '@arihant/shared';

@Injectable()
export class LeadWorkflowService {
  /**
   * Allowed state transitions for Arihant BOS Lead Lifecycle
   */
  // Forward-only pipeline: stages never offer a move back to an earlier stage (prevents Contacted <-> Qualified loops).
  // Negotiation / conversion come only after a proposal or tender discussion (Module 1 §6, QA DEF-097): NEW and
  // CONTACTED cannot jump to PROPOSAL / TENDER DISCUSSION / NEGOTIATION, and side stages (follow-up, demo, on hold)
  // reach NEGOTIATION / CONVERTED only once the lead has been through a commercial stage (see COMMERCIAL_GATED).
  private readonly ALLOWED_TRANSITIONS: Record<string, string[]> = {
    new: ['contacted', 'qualified', 'follow_up', 'lost', 'on_hold'],
    contacted: ['qualified', 'follow_up', 'demo', 'lost', 'on_hold'],
    qualified: ['follow_up', 'demo', 'proposal', 'tender_discussion', 'lost', 'on_hold'],
    follow_up: ['demo', 'proposal', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold'],
    demo: ['follow_up', 'proposal', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold'],
    proposal: ['follow_up', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold'],
    tender_discussion: ['follow_up', 'negotiation', 'converted', 'lost', 'on_hold'],
    negotiation: ['follow_up', 'converted', 'lost', 'on_hold'],
    on_hold: ['new', 'contacted', 'qualified', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'lost'],
    lost: ['new', 'contacted', 'qualified', 'follow_up', 'on_hold'], // Allowed to re-activate/re-approach
    // CONVERTED (won) is terminal for the field team; only management / admin may reopen it (QA DEF-055)
    converted: ['negotiation', 'follow_up'],
    // Backward compatibility with legacy statuses in database
    open: ['contacted', 'qualified', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold', 'quoted', 'won', 'dropped'],
    quoted: ['negotiation', 'converted', 'lost', 'on_hold', 'won', 'dropped'],
    won: ['negotiation'],
    dropped: ['contacted', 'qualified', 'follow_up'],
  };

  /** Stages that reopen a closed-won lead — management / admin only. */
  private readonly REOPEN_ROLES: UserRole[] = ['management', 'admin'];

  /** Targets that need the lead to have passed a proposal / tender discussion / negotiation stage first. */
  private readonly COMMERCIAL_GATED: Record<string, string[]> = {
    follow_up: ['negotiation', 'converted'],
    demo: ['negotiation', 'converted'],
    on_hold: ['negotiation'],
  };

  /** A status that records the lead as won: CONVERTED, or the legacy WON. */
  isWinStatus(status: string): boolean {
    const norm = status.toLowerCase();
    return norm === 'converted' || norm === 'won';
  }

  /** Stages a brand-new lead may be registered in — everything later goes through the lifecycle (QA DEF-059). */
  readonly INITIAL_STATUSES = ['new', 'contacted', 'qualified'];

  /**
   * Get valid next statuses from current status.
   * `role` hides the management-only reopen of a won lead; `commercialStageReached` (the lead has been through a
   * proposal / tender discussion / negotiation) unlocks negotiation and conversion from the side stages.
   */
  getAllowedTransitions(currentStatus: string, role?: UserRole, commercialStageReached = false): string[] {
    const norm = currentStatus.toLowerCase();
    if ((norm === 'converted' || norm === 'won') && (!role || !this.REOPEN_ROLES.includes(role))) {
      return [];
    }
    const gated = commercialStageReached ? [] : this.COMMERCIAL_GATED[norm] || [];
    return (this.ALLOWED_TRANSITIONS[norm] || []).filter((st) => !gated.includes(st));
  }

  /**
   * Validate state transition and business rules
   */
  validateTransition(
    currentStatus: string,
    nextStatus: string,
    userRole: UserRole,
    lossReason?: string,
    options: { commercialStageReached?: boolean; poReference?: string } = {},
  ): void {
    const from = currentStatus.toLowerCase();
    const to = nextStatus.toLowerCase();
    const label = (st: string) => st.replace(/_/g, ' ').toUpperCase();

    if (from === to) {
      return;
    }

    // If changing from converted, only management or admin can do so
    if ((from === 'converted' || from === 'won') && !this.REOPEN_ROLES.includes(userRole)) {
      throw new ForbiddenException('This lead is already CONVERTED (won). Only management can reopen a converted lead.');
    }

    const allowed = this.getAllowedTransitions(from, userRole, options.commercialStageReached);
    if (!allowed.includes(to)) {
      if ((this.ALLOWED_TRANSITIONS[from] || []).includes(to)) {
        throw new BadRequestException(
          `A lead can move to ${label(to)} only after a proposal or tender discussion. Allowed next stages: ${allowed.map(label).join(', ') || 'none'}`,
        );
      }
      throw new BadRequestException(
        `A lead cannot move from ${label(from)} to ${label(to)}. Allowed next stages: ${allowed.map(label).join(', ') || 'none'}`,
      );
    }

    // Role-based restrictions: Only management, regional_manager, sales, admin can change status
    const allowedRoles: UserRole[] = ['management', 'admin', 'regional_manager', 'sales'];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException(`Role '${userRole}' is not permitted to change lead status.`);
    }

    // Marking a lead won records the purchase / supply order it was won on — CONVERTED, and legacy WON (reachable
    // from legacy OPEN / QUOTED leads), alike
    if (this.isWinStatus(to) && !options.poReference?.trim()) {
      throw new BadRequestException(`Enter the purchase / supply order reference to mark this lead as ${label(to)}.`);
    }

    // If changing to 'lost', loss reason must be provided
    if (to === 'lost') {
      if (!lossReason) {
        throw new BadRequestException(
          `A valid loss reason is required when marking a lead as LOST. Permitted: ${LEAD_LOSS_REASONS.join(', ')}`,
        );
      }
      const normReason = lossReason.toLowerCase();
      if (!LEAD_LOSS_REASONS.includes(normReason as LeadLossReason)) {
        throw new BadRequestException(
          `Invalid loss reason '${lossReason}'. Must be one of: ${LEAD_LOSS_REASONS.join(', ')}`,
        );
      }
    }
  }
}
