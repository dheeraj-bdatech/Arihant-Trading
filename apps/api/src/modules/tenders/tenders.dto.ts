import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsUUID,
  IsDateString,
  IsEnum,
  ValidateIf,
  Matches,
  IsBoolean,
} from 'class-validator';
import type { TenderCategory, TenderStatus } from '@arihant/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateTenderDto {
  @IsString()
  @IsOptional()
  tender_no?: string;

  @IsString()
  @IsOptional()
  tender_number?: string; // alias from Arihant tender sheet

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  organisation_id?: string;

  @IsString()
  @IsOptional()
  organisation?: string; // alias

  @IsString()
  @IsOptional()
  department?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  product_id?: string;

  @IsString()
  @IsOptional()
  product?: string; // alias

  @IsString()
  @IsOptional()
  requirement_text?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  zone_id?: string;

  @IsString()
  @IsOptional()
  zone?: string; // zone name or code

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  region_id?: string;

  @IsString()
  @IsOptional()
  region?: string; // region name

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  category_id?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  tender_category?: string; // alias (PQ / General-MHA / Other)

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  owner?: string;

  @IsString()
  @IsOptional()
  tender_url?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  parent_tender_id?: string;

  @IsOptional()
  prep_checklist_done?: boolean;

  @IsOptional()
  extra_fields?: any;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  bidder_turnover?: string;

  @IsString()
  @IsOptional()
  oem_turnover?: string;

  @IsNumber()
  @IsOptional()
  emd_fee?: number;

  @IsString()
  @IsOptional()
  portal?: string;

  @IsString()
  @IsOptional()
  reference_number?: string;

  @IsString()
  @IsOptional()
  tender_title?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  portal_id?: string;

  @IsString()
  @IsOptional()
  tender_portal_url?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  buyer_contact_id?: string;

  @IsString()
  @IsOptional()
  tender_type?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  salesperson_id?: string;

  @IsString()
  @IsOptional()
  salesperson?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  linked_pq_tender_id?: string;

  @IsOptional()
  pre_bid_meeting_date?: string;

  @IsOptional()
  query_submission_deadline?: string;

  @IsOptional()
  technical_opening_date?: string;

  @IsOptional()
  commercial_opening_date?: string;

  @IsNumber()
  @IsOptional()
  bid_validity_days?: number;

  @IsOptional()
  emd_required?: boolean;

  @IsNumber()
  @IsOptional()
  emd_amount?: number;

  @IsString()
  @IsOptional()
  emd_mode?: string;

  @IsString()
  @IsOptional()
  emd_exemption_reason?: string;

  @IsNumber()
  @IsOptional()
  tender_fee_amount?: number;

  @IsString()
  @IsOptional()
  priority?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsOptional()
  custom_fields?: any;

  @IsOptional()
  line_items?: any[];

  @IsNumber()
  @IsOptional()
  estimated_value?: number;

  @IsNumber()
  @IsOptional()
  estimated_value_lakh?: number; // alias in Lakhs

  @IsNumber()
  @IsOptional()
  tender_value?: number;

  @IsDateString()
  @IsOptional()
  publish_date?: string;

  @IsDateString()
  @IsOptional()
  publication_date?: string; // alias

  @IsDateString()
  @IsOptional()
  bid_start_date?: string;

  @IsDateString()
  @IsOptional()
  bid_closing_date?: string;

  @IsDateString()
  @IsOptional()
  submission_deadline?: string; // alias

  @IsDateString()
  @IsOptional()
  prebid_date?: string;

  @IsString()
  @IsOptional()
  corrigendum_date?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  assigned_to?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  assigned_person_id?: string; // alias

  @IsString()
  @IsOptional()
  assigned_person?: string; // alias

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  tender_owner_id?: string;

  @IsString()
  @IsOptional()
  tender_owner?: string; // alias

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  current_stage?: string; // alias

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateTenderDto {
  @IsString()
  @IsOptional()
  tender_no?: string;

  @IsString()
  @IsOptional()
  tender_number?: string; // alias

  @Matches(UUID_PATTERN)
  @IsOptional()
  organisation_id?: string;

  @IsString()
  @IsOptional()
  organisation?: string; // alias

  @IsString()
  @IsOptional()
  department?: string;

  @Matches(UUID_PATTERN)
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  product?: string; // alias

  @IsString()
  @IsOptional()
  requirement_text?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @Matches(UUID_PATTERN)
  @IsOptional()
  zone_id?: string;

  @IsString()
  @IsOptional()
  zone?: string; // zone name or code

  @Matches(UUID_PATTERN)
  @IsOptional()
  region_id?: string;

  @IsString()
  @IsOptional()
  region?: string; // region name

  @Matches(UUID_PATTERN)
  @IsOptional()
  category_id?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  tender_category?: string; // alias

  @Matches(UUID_PATTERN)
  @IsOptional()
  owner?: string;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsString()
  tender_url?: string | null;

  @Matches(UUID_PATTERN)
  @IsOptional()
  parent_tender_id?: string;

  @IsOptional()
  prep_checklist_done?: boolean;

  @IsOptional()
  extra_fields?: any;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  bidder_turnover?: string;

  @IsString()
  @IsOptional()
  oem_turnover?: string;

  @IsNumber()
  @IsOptional()
  emd_fee?: number;

  @IsString()
  @IsOptional()
  portal?: string;

  @IsString()
  @IsOptional()
  reference_number?: string;

  @IsString()
  @IsOptional()
  tender_title?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  portal_id?: string;

  @IsString()
  @IsOptional()
  tender_portal_url?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  buyer_contact_id?: string;

  @IsString()
  @IsOptional()
  tender_type?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  salesperson_id?: string;

  @IsString()
  @IsOptional()
  salesperson?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  linked_pq_tender_id?: string;

  @IsOptional()
  pre_bid_meeting_date?: string;

  @IsOptional()
  query_submission_deadline?: string;

  @IsOptional()
  technical_opening_date?: string;

  @IsOptional()
  commercial_opening_date?: string;

  @IsNumber()
  @IsOptional()
  bid_validity_days?: number;

  @IsOptional()
  emd_required?: boolean;

  @IsNumber()
  @IsOptional()
  emd_amount?: number;

  @IsString()
  @IsOptional()
  emd_mode?: string;

  @IsString()
  @IsOptional()
  emd_exemption_reason?: string;

  @IsNumber()
  @IsOptional()
  tender_fee_amount?: number;

  @IsString()
  @IsOptional()
  priority?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsOptional()
  custom_fields?: any;

  @IsNumber()
  @IsOptional()
  estimated_value?: number;

  @IsNumber()
  @IsOptional()
  estimated_value_lakh?: number; // alias

  @IsNumber()
  @IsOptional()
  tender_value?: number;

  @IsDateString()
  @IsOptional()
  publish_date?: string;

  @IsDateString()
  @IsOptional()
  publication_date?: string;

  @IsDateString()
  @IsOptional()
  bid_start_date?: string;

  @IsDateString()
  @IsOptional()
  bid_closing_date?: string;

  @IsDateString()
  @IsOptional()
  submission_deadline?: string;

  @IsDateString()
  @IsOptional()
  submission_date?: string;

  @IsDateString()
  @IsOptional()
  result_date?: string;

  @IsDateString()
  @IsOptional()
  prebid_date?: string;

  @IsString()
  @IsOptional()
  corrigendum_date?: string;

  @Matches(UUID_PATTERN)
  @IsOptional()
  assigned_to?: string;

  @Matches(UUID_PATTERN)
  @IsOptional()
  assigned_person_id?: string;

  @IsString()
  @IsOptional()
  assigned_person?: string; // alias

  @Matches(UUID_PATTERN)
  @IsOptional()
  tender_owner_id?: string;

  @IsString()
  @IsOptional()
  tender_owner?: string; // alias

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  current_stage?: string; // alias

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  rejection_reason?: string;
}

export class ChangeTenderStatusDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  target_status?: string; // alias

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  rejection_reason?: string;

  @IsString()
  @IsOptional()
  loss_reason?: string;

  @IsString()
  @IsOptional()
  competitor?: string;

  @IsNumber()
  @IsOptional()
  value_lakh?: number;

  @IsDateString()
  @IsOptional()
  result_date?: string;

  @IsDateString()
  @IsOptional()
  submission_date?: string;
}

export class ApproveTenderDto {
  @IsString()
  @IsNotEmpty({ message: 'Decision is required (approved / rejected)' })
  decision!: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  rejection_reason?: string;
}

export class RecordTenderOutcomeDto {
  @IsString()
  @IsNotEmpty({ message: 'Outcome result is required (won / lost)' })
  result!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  loss_reason?: string;

  @IsString()
  @IsOptional()
  competitor?: string;

  @IsNumber()
  @IsOptional()
  value_lakh?: number;

  @IsDateString()
  @IsOptional()
  result_date?: string;

  @IsString()
  @IsOptional()
  technical_issue?: string;

  @IsString()
  @IsOptional()
  pricing_issue?: string;

  @IsString()
  @IsOptional()
  eligibility_issue?: string;

  @IsString()
  @IsOptional()
  documentation_issue?: string;

  @IsString()
  @IsOptional()
  other_reason?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  product_id?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  region_id?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  responsible_person_id?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  tender_category?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateTenderPortalIssueDto {
  @IsString()
  @IsOptional()
  issue?: string;

  @IsString()
  @IsOptional()
  issue_description?: string;

  @IsString()
  @IsOptional()
  portal?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  tender_id?: string;

  @IsDateString()
  @IsOptional()
  reported_date?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  responsible_person_id?: string;

  @IsString()
  @IsOptional()
  escalated_to?: string;

  @IsString()
  @IsOptional()
  resolution_status?: string;

  @IsString()
  @IsOptional()
  resolution?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateTenderPortalIssueDto {
  @IsString()
  @IsOptional()
  issue?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  responsible_person_id?: string;

  @IsString()
  @IsOptional()
  escalated_to?: string;

  @IsString()
  @IsOptional()
  resolution_status?: string;

  @IsString()
  @IsOptional()
  resolution?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class TenderQueryDto {
  @IsOptional()
  page?: number | string;

  @IsOptional()
  limit?: number | string;

  @IsOptional()
  search?: string;

  @IsOptional()
  status?: string;

  @IsOptional()
  category?: string;

  @IsOptional()
  organisation_id?: string;

  @IsOptional()
  organisation?: string;

  @IsOptional()
  department?: string;

  @IsOptional()
  product_id?: string;

  @IsOptional()
  city?: string;

  @IsOptional()
  state?: string;

  @IsOptional()
  zone_id?: string;

  @IsOptional()
  zone?: string;

  @IsOptional()
  region_id?: string;

  @IsOptional()
  region?: string;

  @IsOptional()
  assigned_to?: string;

  @IsOptional()
  assignedPerson?: string;

  @IsOptional()
  tender_owner_id?: string;

  @IsOptional()
  tenderOwner?: string;

  @IsOptional()
  deadline?: string; // due_today, urgent_48h, upcoming_7d, overdue

  @IsOptional()
  closingSoonOnly?: string | boolean;

  @IsOptional()
  sortBy?: string;

  @IsOptional()
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  from_date?: string;

  @IsOptional()
  to_date?: string;

  @IsOptional()
  date_field?: string;
}

export class TransitionTenderDto {
  @IsString()
  @IsOptional()
  to_status?: string;

  @IsString()
  @IsOptional()
  target_status?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  submission_date?: string;

  @IsNumber()
  @IsOptional()
  expected_version?: number;

  @IsString()
  @IsOptional()
  rejection_reason?: string;

  @IsString()
  @IsOptional()
  loss_reason?: string;

  @IsOptional()
  loss_reasons?: string[];

  @IsString()
  @IsOptional()
  other_reason_text?: string;

  @IsNumber()
  @IsOptional()
  value?: number;

  @IsString()
  @IsOptional()
  result_date?: string;
}

export class HoldTenderDto {
  @IsString()
  @IsOptional()
  reason?: string;

  @IsNumber()
  @IsOptional()
  expected_version?: number;
}

export class ResumeTenderDto {
  @IsNumber()
  @IsOptional()
  expected_version?: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ChangeDeadlineDto {
  @IsString()
  @IsNotEmpty({ message: 'New submission deadline is required' })
  new_deadline!: string;

  @IsString()
  @IsNotEmpty({ message: 'Reason for deadline change is required (e.g. Corrigendum No.)' })
  reason!: string;

  @IsNumber()
  @IsOptional()
  expected_version?: number;
}

export class RecordTenderResultDto {
  @IsString()
  @IsNotEmpty({ message: 'Outcome is required ("won" or "lost")' })
  outcome!: string;

  @IsString()
  @IsNotEmpty({ message: 'Result date is required' })
  result_date!: string;

  @IsNumber()
  @IsOptional()
  value?: number;

  @IsNumber()
  @IsOptional()
  awarded_value?: number;

  @IsOptional()
  awarded_line_items?: any[];

  @IsString()
  @IsOptional()
  order_number?: string;

  @IsString()
  @IsOptional()
  loa_number?: string;

  @IsString()
  @IsOptional()
  po_number?: string;

  @IsString()
  @IsOptional()
  loa_date?: string;

  @IsBoolean()
  @IsOptional()
  pbg_required?: boolean;

  @IsNumber()
  @IsOptional()
  pbg_amount?: number;

  @IsString()
  @IsOptional()
  pbg_due_date?: string;

  @IsOptional()
  loss_reasons?: string[];

  @IsString()
  @IsOptional()
  loss_reason?: string;

  @IsString()
  @IsOptional()
  loss_reason_detail?: string;

  @IsString()
  @IsOptional()
  other_reason_text?: string;

  @IsString()
  @IsOptional()
  competitor?: string;

  @IsNumber()
  @IsOptional()
  winning_price?: number;

  @IsNumber()
  @IsOptional()
  our_price?: number;

  @IsString()
  @IsOptional()
  our_rank?: string;

  @IsString()
  @IsOptional()
  lessons_learned?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @IsOptional()
  expected_version?: number;
}

export class ReopenTenderDto {
  @IsString()
  @IsNotEmpty({ message: 'Reason for reopening terminal tender is required' })
  reason!: string;

  @IsNumber()
  @IsOptional()
  expected_version?: number;
}

export class UpdateTenderSettingsDto {
  @IsNumber()
  @IsOptional()
  upcoming_days?: number;

  @IsNumber()
  @IsOptional()
  approaching_days?: number;

  @IsNumber()
  @IsOptional()
  approval_sla_hours?: number;

  @IsNumber()
  @IsOptional()
  result_followup_days?: number;

  @IsOptional()
  allow_self_approval?: boolean;

  @IsOptional()
  require_won_value?: boolean;

  @IsOptional()
  escalation_user_ids?: string[];
}

export class AddApproverDto {
  @IsString()
  @IsNotEmpty()
  @Matches(UUID_PATTERN)
  user_id!: string;
}

export class CreateLossReasonDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  sort_order?: number;
}

export class UpdateLossReasonDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  sort_order?: number;
}

export class UpdateTenderStatusLabelDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsOptional()
  sort_order?: number;
}

export class CreateTenderCategoryDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  requires_pq?: boolean;

  @IsOptional()
  description?: string;

  @IsOptional()
  sort_order?: number;
}

export class UpdateTenderCategoryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  requires_pq?: boolean;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  is_active?: boolean;

  @IsOptional()
  description?: string;

  @IsOptional()
  sort_order?: number;
}

export class ImportTenderSheetDto {
  @IsNotEmpty()
  rows!: any[];

  @IsString()
  @IsOptional()
  duplicate_mode?: 'skip' | 'update';

  @IsOptional()
  commit?: boolean;

  @IsOptional()
  column_mapping?: Record<string, string>;
}

export class CreateTenderLineItemDto {
  @IsOptional()
  @Matches(UUID_PATTERN)
  product_id?: string;

  @IsString()
  @IsOptional()
  product_description?: string;

  @IsNumber()
  @IsNotEmpty()
  quantity!: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  specification_summary?: string;

  @IsString()
  @IsOptional()
  is_compliant?: string;

  @IsString()
  @IsOptional()
  compliance_remarks?: string;

  @IsNumber()
  @IsOptional()
  quoted_unit_price?: number;

  @IsNumber()
  @IsOptional()
  quoted_total?: number;

  @IsOptional()
  awarded?: boolean;

  @IsNumber()
  @IsOptional()
  awarded_quantity?: number;

  @IsNumber()
  @IsOptional()
  awarded_unit_price?: number;
}

export class UpdateTenderLineItemDto {
  @IsOptional()
  @Matches(UUID_PATTERN)
  product_id?: string;

  @IsString()
  @IsOptional()
  product_description?: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  specification_summary?: string;

  @IsString()
  @IsOptional()
  is_compliant?: string;

  @IsString()
  @IsOptional()
  compliance_remarks?: string;

  @IsNumber()
  @IsOptional()
  quoted_unit_price?: number;

  @IsNumber()
  @IsOptional()
  quoted_total?: number;

  @IsOptional()
  awarded?: boolean;

  @IsNumber()
  @IsOptional()
  awarded_quantity?: number;

  @IsNumber()
  @IsOptional()
  awarded_unit_price?: number;
}

export class CreateTenderDocumentDto {
  @IsString()
  @IsNotEmpty()
  document_type!: string;

  @IsOptional()
  is_mandatory?: boolean;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  file_url?: string;

  @IsString()
  @IsOptional()
  file_name?: string;

  @IsNumber()
  @IsOptional()
  file_size?: number;

  @IsString()
  @IsOptional()
  mime_type?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  owner_id?: string;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateTenderDocumentDto {
  @IsString()
  @IsOptional()
  document_type?: string;

  @IsOptional()
  is_mandatory?: boolean;

  @IsString()
  @IsOptional()
  status?: string;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsString()
  file_url?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsString()
  file_name?: string | null;

  @IsNumber()
  @IsOptional()
  file_size?: number;

  @IsString()
  @IsOptional()
  mime_type?: string;

  @IsOptional()
  @ValidateIf((o, v) => Boolean(v))
  @Matches(UUID_PATTERN)
  owner_id?: string | null;

  @IsDateString()
  @IsOptional()
  due_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateTenderCorrigendumDto {
  @IsString()
  @IsNotEmpty({ message: 'Corrigendum number is required' })
  corrigendum_number!: string;

  @IsDateString()
  @IsOptional()
  issued_date?: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsNotEmpty({ message: 'New deadline is required' })
  new_deadline!: string;

  @IsString()
  @IsOptional()
  attachment_url?: string;
}

export class CreateTenderFinancialInstrumentDto {
  @IsString()
  @IsNotEmpty()
  instrument_type!: string;

  @IsNumber()
  @IsNotEmpty()
  amount!: number;

  @IsString()
  @IsOptional()
  mode?: string;

  @IsString()
  @IsOptional()
  reference_number?: string;

  @IsString()
  @IsOptional()
  bank?: string;

  @IsDateString()
  @IsOptional()
  issue_date?: string;

  @IsDateString()
  @IsOptional()
  expiry_date?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  finance_owner_id?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateTenderFinancialInstrumentDto {
  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  mode?: string;

  @IsString()
  @IsOptional()
  reference_number?: string;

  @IsString()
  @IsOptional()
  bank?: string;

  @IsDateString()
  @IsOptional()
  issue_date?: string;

  @IsDateString()
  @IsOptional()
  expiry_date?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  finance_owner_id?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateTenderCommentDto {
  @IsString()
  @IsNotEmpty({ message: 'Comment text cannot be empty' })
  body!: string;

  @IsOptional()
  mentions?: string[];

  @IsOptional()
  is_internal?: boolean;
}

export class CreateTenderDelegationDto {
  @IsNotEmpty()
  @Matches(UUID_PATTERN)
  delegatee_id!: string;

  @IsDateString()
  @IsNotEmpty()
  start_date!: string;

  @IsDateString()
  @IsNotEmpty()
  end_date!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateApprovalRuleDto {
  @IsOptional()
  @Matches(UUID_PATTERN)
  category_id?: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  zone_id?: string;

  @IsNumber()
  @IsOptional()
  min_value?: number;

  @IsNumber()
  @IsOptional()
  max_value?: number;

  @IsString()
  @IsNotEmpty()
  approver_role!: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  approver_id?: string;

  @IsNumber()
  @IsOptional()
  level?: number;
}

export class CreateLinkedTenderDto {
  @IsString()
  @IsNotEmpty({ message: 'Tender number is required for the new linked tender' })
  tender_number!: string;

  @IsString()
  @IsNotEmpty({ message: 'Tender title is required' })
  tender_title!: string;

  @IsDateString()
  @IsNotEmpty({ message: 'Submission deadline is required' })
  submission_deadline!: string;

  @IsOptional()
  @Matches(UUID_PATTERN)
  category_id?: string;

  @IsString()
  @IsOptional()
  tender_type?: string;

  @IsOptional()
  estimated_value?: number;

  @IsOptional()
  remarks?: string;
}

export class CreateSalesOrderFromTenderDto {
  @IsString()
  @IsNotEmpty({ message: 'Order / PO reference number is required' })
  order_number!: string;

  @IsDateString()
  @IsOptional()
  order_date?: string;

  @IsNumber()
  @IsOptional()
  total_value?: number;

  @IsString()
  @IsOptional()
  delivery_location?: string;

  @IsString()
  @IsOptional()
  delivery_terms?: string;

  @IsOptional()
  awarded_line_items?: any[];
}

export class CreateCompetitorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateTenderPortalDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsOptional()
  base_url?: string;
}

export class CreateRegionMappingDto {
  @IsString()
  @IsNotEmpty()
  state!: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsNotEmpty()
  @Matches(UUID_PATTERN)
  region_id!: string;

  @IsNotEmpty()
  @Matches(UUID_PATTERN)
  zone_id!: string;
}

