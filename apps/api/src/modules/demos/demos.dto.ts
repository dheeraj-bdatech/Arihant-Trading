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

  @IsString()
  @IsOptional()
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
  @IsString()
  @IsOptional()
  model?: string;

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
