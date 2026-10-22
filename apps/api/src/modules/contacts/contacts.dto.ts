import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsBoolean,
  IsUUID,
  Matches,
} from 'class-validator';
import { INDIAN_MOBILE_PATTERN } from '@arihant/shared';

/** Any non-whitespace character — a blank name is rejected with one friendly message (QA DEF-056). */
const NOT_BLANK = /\S/;
const MOBILE_MESSAGE = 'Enter a valid 10-digit mobile number (e.g. 98110 00000)';

export class CreateContactDto {
  @IsUUID('all')
  @IsNotEmpty()
  organisation_id!: string;

  @Matches(NOT_BLANK, { message: 'Full name is required' })
  full_name!: string;

  @IsString()
  @IsOptional()
  designation?: string;

  // QA DEF-010: a real mobile number, not free text
  @Matches(INDIAN_MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  @IsOptional()
  mobile?: string;

  @IsEmail({}, { message: 'Enter a valid email address' })
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}

export class UpdateContactDto {
  @Matches(NOT_BLANK, { message: 'Full name is required' })
  @IsOptional()
  full_name?: string;

  @IsString()
  @IsOptional()
  designation?: string;

  // QA DEF-010: a real mobile number, not free text
  @Matches(INDIAN_MOBILE_PATTERN, { message: MOBILE_MESSAGE })
  @IsOptional()
  mobile?: string;

  @IsEmail({}, { message: 'Enter a valid email address' })
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}
