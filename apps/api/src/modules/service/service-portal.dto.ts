import { IsString, IsOptional, IsBoolean, IsNumber, IsIn, IsNotEmpty, IsInt, Min, Max, MaxLength } from 'class-validator';

/**
 * Public, unauthenticated customer service request. Every field is optional at the decorator
 * level on purpose: the service validates and returns one readable list of problems instead
 * of Nest's first-error-only behaviour, which is much friendlier on a public form.
 */
export class PortalServiceRequestDto {
  @IsString() @IsOptional() @MaxLength(400) organisation_name?: string;
  @IsString() @IsOptional() @MaxLength(200) department?: string;
  @IsString() @IsOptional() @MaxLength(120) city?: string;
  @IsString() @IsOptional() @MaxLength(80) state?: string;
  @IsString() @IsOptional() @MaxLength(600) location?: string;

  @IsString() @IsOptional() @MaxLength(200) contact_name?: string;
  @IsString() @IsOptional() @MaxLength(200) contact_designation?: string;
  @IsString() @IsOptional() @MaxLength(40) contact_phone?: string;
  @IsString() @IsOptional() @MaxLength(200) contact_email?: string;

  @IsString() @IsOptional() @MaxLength(60) product_id?: string;
  @IsString() @IsOptional() @MaxLength(200) product_text?: string;
  @IsString() @IsOptional() @MaxLength(200) equipment_serial?: string;

  @IsString() @IsOptional() @MaxLength(60) problem_category?: string;
  @IsString() @IsOptional() @MaxLength(8000) complaint?: string;
  @IsString() @IsOptional() @MaxLength(40) urgency?: string;
  @IsString() @IsOptional() @MaxLength(40) preferred_visit_date?: string;
  @IsString() @IsOptional() @MaxLength(1000) site_access_notes?: string;

  @IsBoolean() @IsOptional() consent?: boolean;

  /** honeypot: real people never see or fill this field */
  @IsString() @IsOptional() @MaxLength(400) website?: string;
  /** epoch ms when the form was opened; used to spot instant bot submissions */
  @IsNumber() @IsOptional() form_started_at?: number;
}

export class PortalTrackQueryDto {
  @IsString() @IsOptional() @MaxLength(60) ref?: string;
  @IsString() @IsOptional() @MaxLength(100) token?: string;
}

export class PortalCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(60) ref!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) token!: string;
  @IsString() @IsOptional() @MaxLength(8000) body?: string;
}

export class PortalFeedbackDto {
  @IsString() @IsNotEmpty() @MaxLength(60) ref!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) token!: string;
  @IsString() @IsIn(['confirm_resolved', 'not_resolved']) action!: 'confirm_resolved' | 'not_resolved';
  @IsInt() @Min(1) @Max(5) @IsOptional() rating?: number;
  @IsString() @IsOptional() @MaxLength(4000) remarks?: string;
}
