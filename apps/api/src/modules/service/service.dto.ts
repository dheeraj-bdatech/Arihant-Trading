import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsArray,
  Min,
  Max,
  Matches,
} from 'class-validator';
import type {
  ServicePriority,
  WarrantyStatus,
  ServiceTicketStatus,
  ProblemCategory,
  ComplaintSource,
  VisitOutcome,
  CustomerConfirmationType,
  ReportStatus,
  PartRequestStatus,
} from '@arihant/shared';

export const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class CreateTicketDto {
  @Matches(UUID_REGEX, { message: 'Organisation must be a valid UUID' })
  @IsOptional()
  organisation_id?: string;

  @Matches(UUID_REGEX, { message: 'Customer must be a valid UUID' })
  @IsOptional()
  customer_id?: string;

  @Matches(UUID_REGEX, { message: 'Contact must be a valid UUID' })
  @IsOptional()
  contact_id?: string;

  @Matches(UUID_REGEX, { message: 'Product must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @Matches(UUID_REGEX, { message: 'Equipment must be a valid UUID' })
  @IsOptional()
  equipment_id?: string;

  @IsString()
  @IsOptional()
  equipment_serial?: string;

  @IsString()
  @IsOptional()
  serial_number?: string;

  @IsBoolean()
  @IsOptional()
  equipment_unverified?: boolean;

  @IsString()
  @IsOptional()
  location?: string;

  @Matches(UUID_REGEX, { message: 'Site location must be a valid UUID' })
  @IsOptional()
  site_location_id?: string;

  @IsString()
  @IsOptional()
  complaint?: string;

  @IsString()
  @IsOptional()
  complaint_description?: string;

  @IsString()
  @IsOptional()
  problem_category?: ProblemCategory;

  @IsString()
  @IsOptional()
  complaint_source?: ComplaintSource;

  @IsEnum(['low', 'medium', 'high', 'critical'] as const)
  @IsOptional()
  priority?: ServicePriority;

  @IsOptional()
  warranty_status?: WarrantyStatus;

  @IsString()
  @IsOptional()
  warranty_status_snapshot?: string;

  @IsBoolean()
  @IsOptional()
  warranty_override?: boolean;

  @IsString()
  @IsOptional()
  override_reason?: string;

  @IsOptional()
  coverage_details?: Record<string, boolean>;

  @IsBoolean()
  @IsOptional()
  is_chargeable?: boolean;

  @IsString()
  @IsOptional()
  ticket_no?: string;

  @IsString()
  @IsOptional()
  ticket_number?: string;

  @IsDateString()
  @IsOptional()
  received_date?: string;

  @IsDateString()
  @IsOptional()
  date_received?: string;

  @Matches(UUID_REGEX, { message: 'assigned_to must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @Matches(UUID_REGEX, { message: 'assigned_engineer_id must be a valid UUID' })
  @IsOptional()
  assigned_engineer_id?: string;

  @IsArray()
  @IsOptional()
  additional_engineer_ids?: string[];

  @IsDateString()
  @IsOptional()
  planned_visit_date?: string;

  @Matches(UUID_REGEX, { message: 'Parent ticket must be a valid UUID' })
  @IsOptional()
  parent_ticket_id?: string;

  @Matches(UUID_REGEX, { message: 'Region must be a valid UUID' })
  @IsOptional()
  region_id?: string;
}

export class UpdateTicketStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: ServiceTicketStatus;

  @Matches(UUID_REGEX, { message: 'assigned_to must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @Matches(UUID_REGEX, { message: 'assigned_engineer_id must be a valid UUID' })
  @IsOptional()
  assigned_engineer_id?: string;

  @IsDateString()
  @IsOptional()
  planned_visit_date?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  status_reason?: string;

  @IsNumber()
  @IsOptional()
  version?: number;

  @IsBoolean()
  @IsOptional()
  billing_waived?: boolean;

  @IsString()
  @IsOptional()
  billing_waived_reason?: string;
}

export class SubmitServiceReportDto {
  @Matches(UUID_REGEX, { message: 'Visit ID must be a valid UUID' })
  @IsOptional()
  visit_id?: string;

  @IsString()
  @IsNotEmpty({ message: 'Problem identified is required' })
  problem_identified!: string;

  @IsString()
  @IsOptional()
  root_cause?: string;

  @IsString()
  @IsNotEmpty({ message: 'Action taken is required' })
  action_taken!: string;

  @IsOptional()
  parts_replaced?: any;

  @IsString()
  @IsOptional()
  warranty_status?: string;

  @IsString()
  @IsOptional()
  warranty_status_confirmed?: string;

  @IsBoolean()
  @IsOptional()
  customer_confirmation?: boolean;

  @IsString()
  @IsOptional()
  customer_confirmation_type?: CustomerConfirmationType;

  @IsString()
  @IsOptional()
  customer_signature?: string;

  @IsString()
  @IsOptional()
  customer_name_signed?: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  customer_feedback_rating?: number;

  @IsString()
  @IsOptional()
  customer_remarks?: string;

  @IsString()
  @IsOptional()
  confirmation_not_obtained_reason?: string;

  @IsBoolean()
  @IsOptional()
  further_work_required?: boolean;

  @IsString()
  @IsOptional()
  further_work_description?: string;

  @IsDateString()
  @IsOptional()
  next_visit_date?: string;

  @IsString()
  @IsOptional()
  report_url?: string;

  @IsArray()
  @IsOptional()
  attachments?: any[];
}

export class CreateVisitDto {
  @IsNumber()
  @IsOptional()
  visit_number?: number;

  @IsArray()
  @IsOptional()
  engineer_ids?: string[];

  @IsDateString()
  @IsOptional()
  scheduled_start?: string;

  @IsDateString()
  @IsOptional()
  scheduled_end?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CheckInVisitDto {
  @IsNumber()
  @IsOptional()
  check_in_lat?: number;

  @IsNumber()
  @IsOptional()
  check_in_lng?: number;

  @IsDateString()
  @IsOptional()
  actual_check_in?: string;
}

export class CheckOutVisitDto {
  @IsString()
  @IsOptional()
  visit_outcome?: VisitOutcome;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  actual_check_out?: string;
}

export class CreatePartRequestDto {
  @Matches(UUID_REGEX, { message: 'Part ID must be a valid UUID' })
  @IsOptional()
  part_id?: string;

  @IsString()
  @IsNotEmpty({ message: 'Part name is required' })
  part_name!: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsDateString()
  @IsOptional()
  expected_date?: string;

  @IsString()
  @IsOptional()
  store_remarks?: string;
}

export class UpdatePartRequestStatusDto {
  @IsString()
  @IsNotEmpty({ message: 'Status is required' })
  status!: PartRequestStatus;

  @IsString()
  @IsOptional()
  store_remarks?: string;

  @IsString()
  @IsOptional()
  serial_issued?: string;

  @IsString()
  @IsOptional()
  serial_returned?: string;
}

export class CreateTicketCommentDto {
  @IsString()
  @IsNotEmpty({ message: 'Comment body is required' })
  body!: string;

  @IsBoolean()
  @IsOptional()
  is_internal?: boolean;
}

export class ReviewServiceReportDto {
  @IsBoolean()
  @IsNotEmpty({ message: 'Approval status is required' })
  approved!: boolean;

  @IsString()
  @IsOptional()
  return_reason?: string;
}
