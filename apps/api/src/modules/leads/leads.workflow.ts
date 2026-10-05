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
  private readonly ALLOWED_TRANSITIONS: Record<string, string[]> = {
    new: ['contacted', 'qualified', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'lost', 'on_hold'],
    contacted: ['qualified', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'lost', 'on_hold'],
    qualified: ['contacted', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'lost', 'on_hold'],
    follow_up: ['contacted', 'qualified', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold'],
    demo: ['follow_up', 'qualified', 'proposal', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold'],
    proposal: ['follow_up', 'demo', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold'],
    tender_discussion: ['follow_up', 'proposal', 'negotiation', 'converted', 'lost', 'on_hold'],
    negotiation: ['follow_up', 'proposal', 'converted', 'lost', 'on_hold'],
    on_hold: ['new', 'contacted', 'qualified', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'lost'],
    lost: ['new', 'contacted', 'qualified', 'follow_up', 'on_hold'], // Allowed to re-activate/re-approach
    converted: ['negotiation', 'follow_up'], // Reactivation restricted
    // Backward compatibility with legacy statuses in database
    open: ['contacted', 'qualified', 'follow_up', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'converted', 'lost', 'on_hold', 'quoted', 'won', 'dropped'],
    quoted: ['negotiation', 'converted', 'lost', 'on_hold', 'won', 'dropped'],
    won: ['negotiation'],
    dropped: ['contacted', 'qualified', 'follow_up'],
  };

  /**
   * Get valid next statuses from current status
   */
  getAllowedTransitions(currentStatus: string): string[] {
    const norm = currentStatus.toLowerCase();
    return this.ALLOWED_TRANSITIONS[norm] || [];
  }

  /**
   * Validate state transition and business rules
   */
  validateTransition(
    currentStatus: string,
    nextStatus: string,
    userRole: UserRole,
    lossReason?: string,
  ): void {
    const from = currentStatus.toLowerCase();
    const to = nextStatus.toLowerCase();

    if (from === to) {
      return;
    }

    const allowed = this.ALLOWED_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid status transition from '${currentStatus}' to '${nextStatus}'. Allowed transitions: ${allowed ? allowed.join(', ') : 'none'}`,
      );
    }

    // Role-based restrictions: Only management, regional_manager, sales, admin can change status
    const allowedRoles: UserRole[] = ['management', 'admin', 'regional_manager', 'sales'];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException(`Role '${userRole}' is not permitted to change lead status.`);
    }

    // If changing from converted, only management or admin can do so
    if (from === 'converted' && !['management', 'admin'].includes(userRole)) {
      throw new ForbiddenException('Only management can reopen a converted lead.');
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
