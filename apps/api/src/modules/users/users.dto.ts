import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  IsArray,
  ValidateNested,
  MaxLength,
  MinLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { UserRole } from '@arihant/shared';
import { USER_ROLES } from '@arihant/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** '' from a cleared form field means "no value" (null), so optional relations can be unset. */
const emptyToNull = ({ value }: { value: unknown }) => (value === '' ? null : typeof value === 'string' ? value.trim() : value);

/** Indian or international phone: digits with optional +, spaces and dashes, 8–15 digits in total. */
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,18}[0-9]$/;
const ROLE_MESSAGE = `Role must be one of: ${USER_ROLES.join(', ')}`;

export class CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email is too long' })
  email!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(120, { message: 'Full name must be at most 120 characters' })
  full_name!: string;

  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @Matches(PHONE_RE, { message: 'Enter a valid phone number (digits, optional +, 8–15 digits)' })
  phone?: string | null;

  @IsEnum(USER_ROLES, { message: ROLE_MESSAGE })
  role!: UserRole;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid department' })
  department_id?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid region' })
  region_id?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid zone' })
  zone_id?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid reporting manager' })
  reporting_manager_id?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Active must be true or false' })
  is_active?: boolean;

  /** Optional admin-chosen initial password; otherwise a one-time temporary password is generated. */
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Initial password must be at least 8 characters' })
  @MaxLength(72, { message: 'Initial password must be at most 72 characters' })
  password?: string | null;
}

export class UpdateUserDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(120, { message: 'Full name must be at most 120 characters' })
  full_name?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254, { message: 'Email is too long' })
  email?: string;

  @Transform(emptyToNull)
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(PHONE_RE, { message: 'Enter a valid phone number (digits, optional +, 8–15 digits)' })
  phone?: string | null;

  @IsOptional()
  @IsEnum(USER_ROLES, { message: ROLE_MESSAGE })
  role?: UserRole;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid department' })
  department_id?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid region' })
  region_id?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid zone' })
  zone_id?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid reporting manager' })
  reporting_manager_id?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Active must be true or false' })
  is_active?: boolean;
}

export class BulkInviteUserItemDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  full_name!: string;

  @IsEnum(USER_ROLES, { message: ROLE_MESSAGE })
  role!: UserRole;

  @IsOptional()
  @IsString()
  region_name?: string;

  @IsOptional()
  @IsString()
  manager_email?: string;
}

export class BulkInviteUsersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkInviteUserItemDto)
  users!: BulkInviteUserItemDto[];
}
