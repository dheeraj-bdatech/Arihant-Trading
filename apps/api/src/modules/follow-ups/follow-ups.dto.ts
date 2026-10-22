import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  Matches,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Any non-whitespace character — one decorator, one friendly message for missing / empty / blank text. */
const NOT_BLANK = /\S/;

export class CreateFollowUpDto {
  @Matches(UUID_PATTERN, { message: 'Organisation ID must be a valid UUID' })
  @IsNotEmpty()
  organisation_id!: string;

  @Matches(UUID_PATTERN, { message: 'Contact ID must be a valid UUID' })
  @IsOptional()
  contact_id?: string;

  @Matches(UUID_PATTERN, { message: 'Lead ID must be a valid UUID' })
  @IsOptional()
  lead_id?: string;

  @Matches(UUID_PATTERN, { message: 'Interaction ID must be a valid UUID' })
  @IsOptional()
  interaction_id?: string;

  @Matches(UUID_PATTERN, { message: 'Assigned user must be a valid UUID' })
  @IsNotEmpty()
  assigned_to!: string;

  @IsDateString({}, { message: 'Due date must be a valid date (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'Due date is required' })
  due_date!: string;

  @Matches(TIME_PATTERN, { message: 'Due time must be in HH:mm format' })
  @IsOptional()
  due_time?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CompleteFollowUpDto {
  // A single check so a missing outcome reads as one friendly message, not raw validator text (QA DEF-094)
  @Matches(NOT_BLANK, { message: 'Enter the touchpoint outcome to complete this follow-up' })
  outcome!: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsDateString({}, { message: 'Next follow-up date must be a valid date (YYYY-MM-DD)' })
  @IsOptional()
  next_followup_date?: string;

  @Matches(TIME_PATTERN, { message: 'Due time must be in HH:mm format' })
  @IsOptional()
  next_followup_time?: string;
}

export class RescheduleFollowUpDto {
  @IsDateString({}, { message: 'Enter a valid new due date' })
  new_due_date!: string;

  @Matches(TIME_PATTERN, { message: 'Due time must be in HH:mm format' })
  @IsOptional()
  new_due_time?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CancelFollowUpDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
