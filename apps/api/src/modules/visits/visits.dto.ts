import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  Matches,
  ValidationOptions,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { VisitStatus, TripStatus } from '@arihant/shared';

export const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const IsPostgresUUID = (validationOptions?: ValidationOptions) =>
  Matches(UUID_REGEX, { message: '$property must be a UUID', ...validationOptions });

export const sanitizeUuid = ({ value }: { value: any }) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : undefined;
};

export class CreateVisitDto {
  @IsPostgresUUID()
  @IsNotEmpty({ message: 'Organisation is required' })
  organisation_id!: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  contact_id?: string;

  @IsString()
  @IsOptional()
  contact_person?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  product_id?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  assigned_to?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  trip_id?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsDateString({}, { message: 'Planned date must be a valid date' })
  @IsNotEmpty({ message: 'Planned date is required' })
  planned_date!: string;

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;

  @IsString()
  @IsOptional()
  purpose?: string;

  @IsBoolean()
  @IsOptional()
  demo_required?: boolean;

  @IsBoolean()
  @IsOptional()
  travel_required?: boolean;

  @IsString()
  @IsOptional()
  expected_outcome?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateVisitDto {
  @IsNumber()
  @IsOptional()
  version?: number;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  organisation_id?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  contact_id?: string;

  @IsString()
  @IsOptional()
  contact_person?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsDateString()
  @IsOptional()
  planned_date?: string;

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;

  @IsString()
  @IsOptional()
  purpose?: string;

  @IsBoolean()
  @IsOptional()
  demo_required?: boolean;

  @IsBoolean()
  @IsOptional()
  travel_required?: boolean;

  @IsString()
  @IsOptional()
  expected_outcome?: string;

  @IsString()
  @IsOptional()
  change_reason?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ChangeVisitStatusDto {
  @IsEnum(['planned', 'modified', 'cancelled', 'completed', 'not_completed', 'rescheduled'] as const)
  @IsNotEmpty()
  status!: VisitStatus;

  @IsString()
  @IsOptional()
  change_reason?: string;

  @IsDateString()
  @IsOptional()
  rescheduled_to?: string;
}

export class RescheduleVisitDto {
  @IsDateString({}, { message: 'New planned date must be a valid date' })
  @IsNotEmpty({ message: 'New date is required when rescheduling' })
  new_date!: string;

  @IsString()
  @IsNotEmpty({ message: 'A reason is strictly required when rescheduling a visit.' })
  reason!: string;

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;
}

export class CancelVisitDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is strictly required when cancelling a visit.' })
  reason!: string;
}

export class ChangeDestinationDto {
  @IsString()
  @IsNotEmpty({ message: 'New location is required' })
  new_location!: string;

  @IsString()
  @IsNotEmpty({ message: 'A reason is strictly required when changing destination.' })
  reason!: string;
}

export class SubmitVisitUpdateDto {
  @IsBoolean()
  @IsOptional()
  met_completed?: boolean;

  @IsString()
  @IsOptional()
  person_met?: string;

  @IsString()
  @IsOptional()
  discussion?: string;

  @IsString()
  @IsOptional()
  product_discussed?: string;

  @IsString()
  @IsOptional()
  outcome?: string;

  @IsString()
  @IsOptional()
  opportunity?: string;

  @IsString()
  @IsOptional()
  tender_opportunity?: string;

  @IsBoolean()
  @IsOptional()
  demo_required?: boolean;

  @IsString()
  @IsOptional()
  next_action?: string;

  @IsDateString()
  @IsOptional()
  followup_date?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ManagerInterventionDto {
  @IsString()
  @IsNotEmpty({ message: 'Instructions for the employee are required' })
  instructions!: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  organisation_id?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  contact_id?: string;

  @IsString()
  @IsOptional()
  contact_person?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;

  @IsString()
  @IsOptional()
  purpose?: string;
}

export class CreateTripDto {
  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  employee_id?: string;

  @IsDateString({}, { message: 'Trip date must be a valid date' })
  @IsNotEmpty({ message: 'Trip date is required' })
  trip_date!: string;

  @IsString()
  @IsNotEmpty({ message: 'Base location is required' })
  base_location!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AddVisitToTripDto {
  @IsPostgresUUID()
  @IsNotEmpty({ message: 'Organisation is required' })
  organisation_id!: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  contact_id?: string;

  @IsString()
  @IsOptional()
  contact_person?: string;

  @Transform(sanitizeUuid)
  @IsPostgresUUID()
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;

  @IsString()
  @IsOptional()
  purpose?: string;

  @IsString()
  @IsOptional()
  instructions?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
