/**
 * Request bodies for Module 9. Properties are whitelisted with @Allow() and validated by
 * expense-validation.ts so every failure comes back as a field-level error map
 * ({ code: 'VALIDATION_FAILED', errors: { field: message } }) the web form can render inline.
 */
import { Allow } from 'class-validator';

export class ClaimHeaderDto {
  @Allow() title?: unknown;
  @Allow() trip_id?: unknown;
  @Allow() visit_id?: unknown;
  @Allow() remarks?: unknown;
  @Allow() version?: unknown;
}

export class ExpenseItemDto {
  @Allow() expense_date?: unknown;
  @Allow() category_id?: unknown;
  @Allow() amount?: unknown;
  @Allow() purpose?: unknown;
  @Allow() customer_id?: unknown;
  @Allow() project_id?: unknown;
  @Allow() remarks?: unknown;
  @Allow() late_submission_reason?: unknown;
  @Allow() category_details?: unknown;
  @Allow() confirm_not_duplicate?: unknown;
  @Allow() version?: unknown;
}

export class ItemDecisionDto {
  @Allow() id?: unknown;
  @Allow() item_status?: unknown;
  @Allow() approved_amount?: unknown;
  @Allow() reviewer_comment?: unknown;
}

export class TransitionDto {
  @Allow() comment?: unknown;
  @Allow() version?: unknown;
  @Allow() items?: unknown;
  @Allow() tally_voucher_ref?: unknown;
  @Allow() payment_reference?: unknown;
  @Allow() payment_date?: unknown;
}

export class ReassignApproverDto {
  @Allow() approver_id?: unknown;
  @Allow() comment?: unknown;
  @Allow() version?: unknown;
}

export class ExpenseCategoryDto {
  @Allow() code?: unknown;
  @Allow() name?: unknown;
  @Allow() is_active?: unknown;
  @Allow() receipt_required_above?: unknown;
  @Allow() max_amount_per_item?: unknown;
  @Allow() cap_is_hard?: unknown;
  @Allow() requires_customer_or_project?: unknown;
  @Allow() requires_remark?: unknown;
  @Allow() display_order?: unknown;
}

export class ProjectDto {
  @Allow() code?: unknown;
  @Allow() name?: unknown;
  @Allow() organisation_id?: unknown;
  @Allow() is_active?: unknown;
}

export class ImportClaimDto {
  @Allow() title?: unknown;
  @Allow() trip_id?: unknown;
  @Allow() visit_id?: unknown;
}
