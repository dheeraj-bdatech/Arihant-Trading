import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  IsIn,
  Matches,
} from 'class-validator';
import { INTERACTION_TYPES } from '@arihant/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InteractionAttachmentDto {
  @IsString()
  @IsNotEmpty()
  file_url!: string;

  @IsString()
  @IsNotEmpty()
  file_name!: string;

  @IsOptional()
  file_size?: number;

  @IsString()
  @IsOptional()
  mime_type?: string;
}

export class CreateInteractionDto {
  @Matches(UUID_PATTERN, { message: 'Organisation ID must be a valid UUID' })
  @IsNotEmpty()
  organisation_id!: string;

  @Matches(UUID_PATTERN, { message: 'Contact ID must be a valid UUID' })
  @IsOptional()
  contact_id?: string;

  @Matches(UUID_PATTERN, { message: 'Lead ID must be a valid UUID' })
  @IsOptional()
  lead_id?: string;

  @IsString()
  @IsNotEmpty({ message: 'Interaction type is required' })
  @IsIn(INTERACTION_TYPES, { message: `Interaction type must be one of: ${INTERACTION_TYPES.join(', ')}` })
  type!: string;

  @IsDateString()
  @IsOptional()
  occurred_on?: string;

  @IsDateString()
  @IsOptional()
  interaction_date?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  outcome?: string;

  @IsString()
  @IsOptional()
  next_action?: string;

  @IsDateString()
  @IsOptional()
  followup_date?: string;

  @IsDateString()
  @IsOptional()
  next_followup_date?: string;

  @IsArray()
  @IsOptional()
  attachments?: InteractionAttachmentDto[];
}
