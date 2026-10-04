import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsIn,
  Matches,
  IsBoolean,
  IsArray,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class ProposalProductItemDto {
  @Matches(UUID_PATTERN, { message: 'Product ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Product ID is required' })
  product_id!: string;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}

export class CreateProposalDto {
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Customer/Organisation ID must be a valid UUID' })
  @IsOptional()
  customer_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Customer/Organisation ID must be a valid UUID' })
  @IsOptional()
  organisation_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Primary Product ID must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposalProductItemDto)
  @IsOptional()
  products?: ProposalProductItemDto[];

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  sector?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Sector/Department ID must be a valid UUID' })
  @IsOptional()
  sector_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Requested by ID must be a valid UUID' })
  @IsOptional()
  requested_by?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Requested by ID must be a valid UUID' })
  @IsOptional()
  requested_by_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_person_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  followup_owner_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  follow_up_owner_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Lead ID must be a valid UUID' })
  @IsOptional()
  lead_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsDateString({}, { message: 'Request date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  request_date?: string;

  @IsDateString({}, { message: 'Required date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'Required completion date is required' })
  required_date!: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsDateString({}, { message: 'Sent date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  sent_date?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  version?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  reference?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  email_reference?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  status?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  next_followup?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  next_follow_up_date?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'Remarks cannot exceed 2000 characters' })
  remarks?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(UUID_PATTERN, { message: 'Related proposal ID must be a valid UUID' })
  @IsOptional()
  related_proposal_id?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  @IsOptional()
  duplicate_override_reason?: string;
}

export class UpdateProposalDto {
  @Matches(UUID_PATTERN, { message: 'Customer/Organisation ID must be a valid UUID' })
  @IsOptional()
  customer_id?: string;

  @Matches(UUID_PATTERN, { message: 'Customer/Organisation ID must be a valid UUID' })
  @IsOptional()
  organisation_id?: string;

  @Matches(UUID_PATTERN, { message: 'Product ID must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposalProductItemDto)
  @IsOptional()
  products?: ProposalProductItemDto[];

  @IsString()
  @IsOptional()
  sector?: string;

  @Matches(UUID_PATTERN, { message: 'Sector/Department ID must be a valid UUID' })
  @IsOptional()
  sector_id?: string;

  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_id?: string;

  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_person_id?: string;

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  followup_owner_id?: string;

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  follow_up_owner_id?: string;

  @IsDateString({}, { message: 'Required date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  required_date?: string;

  @IsString()
  @IsOptional()
  required_date_change_reason?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  version?: string;

  @IsString()
  @IsOptional()
  email_reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'Remarks cannot exceed 2000 characters' })
  remarks?: string;

  @IsInt()
  @IsOptional()
  row_version?: number;
}

export class StartPreparationDto {
  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_person_id?: string;
}

export class SubmitForReviewDto {
  @IsString()
  @IsOptional()
  change_summary?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  document_links?: string[];
}

export class ApproveProposalDto {
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class RequestChangesDto {
  @IsString()
  @IsNotEmpty({ message: 'Change explanation comment is mandatory' })
  comment!: string;
}

export class ReviseInternalDto {
  @IsString()
  @IsNotEmpty({ message: 'Revision reason is mandatory' })
  reason!: string;
}

export class SendProposalDto {
  @IsDateString({}, { message: 'Sent date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'Sent date is required' })
  sent_date!: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ message: 'At least one email reference is required' })
  email_references!: string[];

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Follow-up owner is required' })
  follow_up_owner_id!: string;

  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'Next follow-up date is required' })
  next_follow_up_date!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  document_links?: string[];

  @IsString()
  @IsOptional()
  change_summary?: string;
}

export class FastTrackSendDto {
  @IsString()
  @IsNotEmpty({ message: 'Fast-track justification reason is mandatory' })
  reason!: string;

  @IsDateString({}, { message: 'Sent date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'Sent date is required' })
  sent_date!: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ message: 'At least one email reference is required' })
  email_references!: string[];

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Follow-up owner is required' })
  follow_up_owner_id!: string;

  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'Next follow-up date is required' })
  next_follow_up_date!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  document_links?: string[];
}

export class RequestRevisionDto {
  @IsString()
  @IsNotEmpty({ message: 'Customer revision request reason is mandatory' })
  revision_reason!: string;

  @IsString()
  @IsOptional()
  change_summary?: string;
}

export class MarkConvertedDto {
  @IsDateString({}, { message: 'Outcome date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'Outcome date is required' })
  outcome_date!: string;

  @IsString()
  @IsOptional()
  conversion_reference?: string;

  @IsString()
  @IsOptional()
  converted_to?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class MarkLostDto {
  @IsString()
  @IsNotEmpty({ message: 'Lost reason code is required' })
  lost_reason_code!: string;

  @IsString()
  @IsNotEmpty({ message: 'Lost reason text explanation is required' })
  lost_reason_text!: string;

  @IsString()
  @IsOptional()
  lost_to_competitor?: string;

  @IsDateString({}, { message: 'Outcome date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  outcome_date?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CloseProposalDto {
  @IsString()
  @IsNotEmpty({ message: 'Closure reason code is required' })
  closure_reason_code!: string;

  @IsString()
  @IsNotEmpty({ message: 'Closure reason explanation text is required' })
  closure_reason_text!: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ReopenProposalDto {
  @IsString()
  @IsNotEmpty({ message: 'Reopen justification reason is required' })
  reopen_reason!: string;
}

export class CreateProposalFollowupDto {
  @IsDateString({}, { message: 'Contact date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  contact_date?: string;

  @IsDateString({}, { message: 'Followup date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  followup_date?: string;

  @Matches(UUID_PATTERN, { message: 'Owner ID must be a valid UUID' })
  @IsOptional()
  owner_id?: string;

  @IsIn(['Call', 'Email', 'Visit', 'Meeting', 'Message', 'Other', 'call', 'email', 'visit', 'meeting', 'message', 'other'], {
    message: 'Mode must be one of: Call, Email, Visit, Meeting, Message, Other',
  })
  @IsOptional()
  mode?: string;

  @IsString()
  @IsOptional()
  contact_person?: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsIn(['Positive', 'Neutral', 'Negative', 'No response', 'Revision requested', 'Decision pending'], {
    message: 'Response must be one of: Positive, Neutral, Negative, No response, Revision requested, Decision pending',
  })
  @IsOptional()
  response?: string;

  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  next_follow_up_date?: string;

  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  next_followup_date?: string;

  @IsBoolean()
  @IsOptional()
  is_postpone?: boolean;

  @IsString()
  @IsOptional()
  postpone_reason?: string;

  @IsString()
  @IsOptional()
  outcome?: string;

  @ValidateNested()
  @Type(() => MarkConvertedDto)
  @IsOptional()
  record_converted?: MarkConvertedDto;

  @ValidateNested()
  @Type(() => MarkLostDto)
  @IsOptional()
  record_lost?: MarkLostDto;

  @ValidateNested()
  @Type(() => CloseProposalDto)
  @IsOptional()
  record_closed?: CloseProposalDto;
}

export class PostponeFollowUpDto {
  @IsDateString({}, { message: 'New follow-up date must be a valid YYYY-MM-DD string' })
  @IsNotEmpty({ message: 'New follow-up date is required' })
  new_follow_up_date!: string;

  @IsString()
  @IsNotEmpty({ message: 'Reason for rescheduling without contact is mandatory' })
  postpone_reason!: string;
}

export class CreateProposalVersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Change summary is required for a new version' })
  change_summary!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  email_references?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  document_links?: string[];
}

export class ReassignProposalDto {
  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_person_id?: string;

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  follow_up_owner_id?: string;

  @IsString()
  @IsNotEmpty({ message: 'Reason for reassignment is mandatory' })
  reason!: string;
}

export class BulkReassignDto {
  @IsArray()
  @IsNotEmpty({ message: 'At least one proposal ID is required' })
  proposal_ids!: string[];

  @Matches(UUID_PATTERN, { message: 'Responsible person ID must be a valid UUID' })
  @IsOptional()
  responsible_person_id?: string;

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  follow_up_owner_id?: string;

  @IsString()
  @IsNotEmpty({ message: 'Reason for bulk reassignment is mandatory' })
  reason!: string;
}

export class ChangeProposalStatusDto {
  @IsString()
  @IsNotEmpty({ message: 'Target status is required' })
  status!: string;

  @IsDateString({}, { message: 'Sent date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  sent_date?: string;

  @IsString()
  @IsOptional()
  lost_reason?: string;

  @IsString()
  @IsOptional()
  lost_remarks?: string;

  @IsString()
  @IsOptional()
  converted_to?: string;

  @IsString()
  @IsOptional()
  converted_reference?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsDateString({}, { message: 'Next follow-up date must be a valid YYYY-MM-DD string' })
  @IsOptional()
  next_followup?: string;
}

export class ProposalQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @Matches(UUID_PATTERN, { message: 'Customer ID must be a valid UUID' })
  @IsOptional()
  customer_id?: string;

  @Matches(UUID_PATTERN, { message: 'Organisation ID must be a valid UUID' })
  @IsOptional()
  organisation_id?: string;

  @Matches(UUID_PATTERN, { message: 'Product ID must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  sector?: string;

  @IsString()
  @IsOptional()
  sectorId?: string;

  @Matches(UUID_PATTERN, { message: 'Sector ID must be a valid UUID' })
  @IsOptional()
  sector_id?: string;

  @Matches(UUID_PATTERN, { message: 'Requested by ID must be a valid UUID' })
  @IsOptional()
  requested_by?: string;

  @Matches(UUID_PATTERN, { message: 'Responsible ID must be a valid UUID' })
  @IsOptional()
  responsible_id?: string;

  @Matches(UUID_PATTERN, { message: 'Responsible ID must be a valid UUID' })
  @IsOptional()
  responsiblePersonId?: string;

  @IsString()
  @IsOptional()
  sortBy?: string;

  @IsString()
  @IsOptional()
  sortOrder?: string;

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  follow_up_owner_id?: string;

  @Matches(UUID_PATTERN, { message: 'Follow-up owner ID must be a valid UUID' })
  @IsOptional()
  followup_owner_id?: string;

  @IsString()
  @IsOptional()
  due_today?: string;

  @IsString()
  @IsOptional()
  overdue?: string;

  @IsString()
  @IsOptional()
  without_follow_up?: string;

  @IsString()
  @IsOptional()
  stale?: string;

  @IsString()
  @IsOptional()
  urgent?: string;

  @IsString()
  @IsOptional()
  sent_late?: string;

  @IsString()
  @IsOptional()
  owner_inactive?: string;

  @IsDateString()
  @IsOptional()
  from_request_date?: string;

  @IsDateString()
  @IsOptional()
  to_request_date?: string;

  @IsDateString()
  @IsOptional()
  from_required_date?: string;

  @IsDateString()
  @IsOptional()
  to_required_date?: string;

  @IsDateString()
  @IsOptional()
  from_sent_date?: string;

  @IsDateString()
  @IsOptional()
  to_sent_date?: string;

  @IsDateString()
  @IsOptional()
  from_next_follow_up?: string;

  @IsDateString()
  @IsOptional()
  to_next_follow_up?: string;

  @IsDateString()
  @IsOptional()
  from_outcome_date?: string;

  @IsDateString()
  @IsOptional()
  to_outcome_date?: string;

  @IsString()
  @IsOptional()
  sort_by?: string = 'last_activity_at';

  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  @IsOptional()
  sort_order?: 'asc' | 'desc' | 'ASC' | 'DESC' = 'desc';
}

export class ProposalSettingsDto {
  @IsString()
  @IsOptional()
  business_timezone?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  default_follow_up_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  no_follow_up_after_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  escalate_after_overdue_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  stale_requested_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  stale_preparation_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  stale_review_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  stale_approved_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  stale_followup_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  required_date_warning_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  urgent_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  max_follow_up_horizon_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  max_postpones_before_flag?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  suggest_closure_after_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  duplicate_window_days?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  reopen_window_days?: number;

  @IsBoolean()
  @IsOptional()
  allow_self_approval?: boolean;

  @IsBoolean()
  @IsOptional()
  allow_fast_track?: boolean;

  @IsString()
  @IsOptional()
  digest_time?: string;

  @IsString()
  @IsOptional()
  proposal_number_format?: string;

  @IsArray()
  @IsOptional()
  lost_reason_codes?: string[];

  @IsArray()
  @IsOptional()
  closure_reason_codes?: string[];
}

export class ImportProposalSheetDto {
  @IsArray()
  @IsNotEmpty({ message: 'Rows array is required for proposal import' })
  rows!: any[];

  @IsBoolean()
  @IsOptional()
  dry_run?: boolean;

  @IsBoolean()
  @IsOptional()
  commit?: boolean;

  @IsString()
  @IsOptional()
  duplicate_mode?: string;
}
