import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type {
  DemoStatus,
  DemoEquipmentAvailability,
  DemoResult,
  DemoFailureReason,
  DemoCancellationReason,
} from '@arihant/shared';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class CreateDemoDto {
  @Matches(UUID_PATTERN, { message: 'organisation_id must be a valid UUID' })
  @IsNotEmpty({ message: 'Organisation is required' })
  organisation_id!: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'lead_id must be a valid UUID' })
  @IsOptional()
  lead_id?: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'product_id must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'visit_id must be a valid UUID' })
  @IsOptional()
  visit_id?: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'tender_id must be a valid UUID' })
  @IsOptional()
  tender_id?: string;

  @IsNumber()
  @IsOptional()
  deal_value?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'assigned_to must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsDateString()
  @IsNotEmpty({ message: 'Requested date is required' })
  requested_date!: string;

  @IsDateString()
  @IsOptional()
  confirmed_date?: string;

  @IsString()
  @IsOptional()
  purpose?: string;

  @IsString()
  @IsOptional()
  expected_audience?: string;

  @IsString()
  @IsOptional()
  equipment_required?: string;

  @IsString()
  @IsOptional()
  special_requirements?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsBoolean()
  @IsOptional()
  travel_required?: boolean;

  @IsString()
  @IsOptional()
  travel_from?: string;

  @IsString()
  @IsOptional()
  travel_to?: string;

  @IsDateString()
  @IsOptional()
  travel_date?: string;

  @IsString()
  @IsOptional()
  travel_remarks?: string;

  @IsBoolean()
  @IsOptional()
  service_escort_required?: boolean;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'service_engineer_id must be a valid UUID' })
  @IsOptional()
  service_engineer_id?: string;
}

export class UpdateDemoDto {
  @IsString()
  @IsOptional()
  location?: string;

  @IsDateString()
  @IsOptional()
  requested_date?: string;

  @IsString()
  @IsOptional()
  purpose?: string;

  @IsString()
  @IsOptional()
  expected_audience?: string;

  @IsString()
  @IsOptional()
  equipment_required?: string;

  @IsString()
  @IsOptional()
  special_requirements?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsNumber()
  @IsOptional()
  version?: number;
}

export class AssignTeamDto {
  @Matches(UUID_PATTERN, { message: 'assigned_to must be a valid UUID' })
  @IsNotEmpty({ message: 'Team member selection is required' })
  assigned_to!: string;

  @IsDateString()
  @IsOptional()
  confirmed_date?: string;

  @IsBoolean()
  @IsOptional()
  travel_required?: boolean;

  @IsString()
  @IsOptional()
  travel_from?: string;

  @IsString()
  @IsOptional()
  travel_to?: string;

  @IsDateString()
  @IsOptional()
  travel_date?: string;

  @IsString()
  @IsOptional()
  travel_remarks?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ConfirmDemoDto {
  @IsDateString()
  @IsNotEmpty({ message: 'Confirmed date is required' })
  confirmed_date!: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  /** When the confirmed date falls outside this demo's equipment reservation, extend the reservation to cover it. */
  @IsBoolean()
  @IsOptional()
  extend_reservation?: boolean;
}

export class RescheduleDemoDto {
  @IsDateString()
  @IsNotEmpty({ message: 'New demo date is required' })
  new_date!: string;

  @IsString()
  @IsNotEmpty({ message: 'Rescheduling reason is required' })
  reason!: string;
}

export class CancelDemoDto {
  @IsString()
  @IsNotEmpty({ message: 'Cancellation reason is required' })
  @IsIn([
    'customer_cancelled',
    'equipment_unavailable',
    'team_unavailable',
    'date_conflict',
    'commercial_issue',
    'other',
  ], {
    message:
      'Cancellation reason must be one of: customer_cancelled, equipment_unavailable, team_unavailable, date_conflict, commercial_issue, other',
  })
  cancellation_reason!: DemoCancellationReason;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ReserveEquipmentDto {
  @Matches(UUID_PATTERN, { message: 'equipment_id must be a valid UUID' })
  @IsNotEmpty({ message: 'Equipment selection is required' })
  equipment_id!: string;

  @IsDateString()
  @IsNotEmpty({ message: 'Reservation start date is required' })
  reserved_from!: string;

  @IsDateString()
  @IsNotEmpty({ message: 'Reservation end date is required' })
  reserved_to!: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsBoolean()
  @IsOptional()
  override_conflict?: boolean;

  @IsString()
  @IsOptional()
  override_reason?: string;

  /** Required to reserve a unit of a different product than the demo requested (a substitute unit). */
  @IsString()
  @IsOptional()
  product_mismatch_reason?: string;
}

export class SuggestAlternativeDto {
  @Matches(UUID_PATTERN, { message: 'alternative_equipment_id must be a valid UUID' })
  @IsNotEmpty({ message: 'Alternative equipment ID is required' })
  alternative_equipment_id!: string;

  @IsString()
  @IsNotEmpty({ message: 'Reason for alternative suggestion is required' })
  alternative_reason!: string;
}

export class ApproveReservationDto {
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class RejectReservationDto {
  @IsString()
  @IsNotEmpty({ message: 'Reason for rejection is required' })
  rejection_reason!: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class AllocateAnotherUnitDto {
  @Matches(UUID_PATTERN, { message: 'equipment_id must be a valid UUID' })
  @IsNotEmpty({ message: 'Target equipment ID is required' })
  equipment_id!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsDateString()
  @IsOptional()
  reserved_from?: string;

  @IsDateString()
  @IsOptional()
  reserved_to?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class SubmitDemoOutcomeDto {
  @IsBoolean()
  @IsOptional()
  completed?: boolean;

  @IsString()
  @IsNotEmpty({ message: 'Result (success, fail, or partial) is required' })
  @IsIn(['success', 'fail', 'partial'], {
    message: 'Result must be success, fail, or partial',
  })
  result!: 'success' | 'fail' | 'partial';

  // §17: one of the nine structured reasons, so failure patterns can be analysed.
  @IsOptional()
  @IsIn(['PRODUCT_LIMITATION', 'EQUIPMENT_ISSUE', 'TECHNICAL_FAILURE', 'CUSTOMER_REQUIREMENT_MISMATCH', 'PRICING_CONCERN', 'DECISION_MAKER_UNAVAILABLE', 'COMPETITOR_PREFERENCE', 'DEMO_PREPARATION_ISSUE', 'OTHER'], {
    message: 'Failure reason must be one of the structured demo failure reasons',
  })
  failure_reason?: DemoFailureReason;

  @IsString()
  @IsOptional()
  customer_response?: string;

  @IsString()
  @IsOptional()
  technical_performance?: string;

  @IsString()
  @IsOptional()
  product_suitability?: string;

  @IsBoolean()
  @IsOptional()
  decision_maker_present?: boolean;

  @IsString()
  @IsOptional()
  competitor_involved?: string;

  @IsString()
  @IsOptional()
  next_step?: string;

  @IsString()
  @IsOptional()
  opportunity_stage?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateEquipmentDto {
  @Matches(UUID_PATTERN, { message: 'product_id must be a valid UUID' })
  @IsNotEmpty({ message: 'Product is required' })
  product_id!: string;

  @IsString()
  @IsNotEmpty({ message: 'Model is required' })
  model!: string;

  @IsString()
  @IsNotEmpty({ message: 'Serial number is required' })
  serial_no!: string;

  @IsString()
  @IsNotEmpty({ message: 'Location (Delhi/Patna/Kolkata/etc.) is required' })
  current_location!: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'responsible_person must be a valid UUID' })
  @IsOptional()
  responsible_person?: string;

  @IsString()
  @IsOptional()
  condition?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateEquipmentDto {
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'product_id must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsNotEmpty({ message: 'Serial number cannot be empty' })
  @IsOptional()
  serial_no?: string;

  @IsString()
  @IsOptional()
  current_location?: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((o, v) => v !== '' && v !== null && v !== undefined)
  @Matches(UUID_PATTERN, { message: 'responsible_person must be a valid UUID' })
  @IsOptional()
  responsible_person?: string;

  @IsString()
  @IsOptional()
  @IsIn(['available', 'reserved', 'in_use', 'maintenance'])
  availability_status?: DemoEquipmentAvailability;

  @IsString()
  @IsOptional()
  condition?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

/**
 * Filters of the demo register (GET /demos), its counts (GET /demos/summary) and analytics (GET /demos/analytics).
 * Every param must be declared here: the global ValidationPipe whitelists query DTOs, so an undeclared one is dropped.
 * Values are checked in DemosService (UUIDs, statuses, IST calendar days) so a bad one is a 400, never a Postgres 500.
 */
export class DemoQueryDto {
  @IsOptional()
  page?: number | string;

  @IsOptional()
  limit?: number | string;

  @IsOptional()
  @IsString()
  search?: string;

  /** One status, or several comma-separated (e.g. `requested,under_planning`). */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assigned_to?: string;

  @IsOptional()
  @IsString()
  requested_by?: string;

  @IsOptional()
  @IsString()
  organisation_id?: string;

  @IsOptional()
  @IsString()
  lead_id?: string;

  @IsOptional()
  @IsString()
  tender_id?: string;

  @IsOptional()
  @IsString()
  service_ticket_id?: string;

  @IsOptional()
  @IsString()
  product_id?: string;

  @IsOptional()
  @IsString()
  location?: string;

  /** Demo day (confirmed, else requested) from this IST calendar day, inclusive. */
  @IsOptional()
  @IsString()
  date_from?: string;

  /** Demo day (confirmed, else requested) up to this IST calendar day, inclusive. */
  @IsOptional()
  @IsString()
  date_to?: string;

  /** Recorded outcome: success / fail / partial. */
  @IsOptional()
  @IsIn(['success', 'fail', 'partial'])
  result?: DemoResult;

  @IsOptional()
  @IsString()
  failure_reason?: string;
}
