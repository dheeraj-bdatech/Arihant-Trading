import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsArray,
  IsEmail,
  IsPositive,
  Matches,
  IsIn,
  Min,
} from 'class-validator';
import type {
  LeadCategory,
  LeadProbability,
  ChannelType,
  LeadStatus,
  LeadType,
  LeadLossReason,
} from '@arihant/shared';
import { INDIAN_MOBILE_PATTERN, INTERACTION_TYPES } from '@arihant/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Any non-whitespace character — one decorator that rejects missing, empty and whitespace-only text with one message. */
const NOT_BLANK = /\S/;
const DATE_MESSAGE = (field: string) => `${field} must be a valid date (YYYY-MM-DD)`;

export class CreateLeadDto {
  @Matches(UUID_PATTERN, { message: 'Organisation ID must be a valid UUID' })
  @IsOptional()
  organisation_id?: string;

  @IsString()
  @IsOptional()
  organisation_name?: string;

  @Matches(UUID_PATTERN, { message: 'Contact ID must be a valid UUID' })
  @IsOptional()
  primary_contact_id?: string;

  // Optional for API callers linking an existing contact, but never blank when sent (QA DEF-056)
  @Matches(NOT_BLANK, { message: 'Contact person name is required' })
  @IsOptional()
  contact_name?: string;

  @Matches(NOT_BLANK, { message: 'Designation / rank is required for the contact officer' })
  @IsOptional()
  contact_designation?: string;

  // QA DEF-010: a real 10-digit Indian mobile number, not free text
  @Matches(INDIAN_MOBILE_PATTERN, { message: 'Enter a valid 10-digit mobile number (e.g. 98110 00000)' })
  @IsOptional()
  contact_mobile?: string;

  @IsEmail({}, { message: 'Enter a valid email address' })
  @IsOptional()
  contact_email?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @Matches(UUID_PATTERN, { message: 'Zone ID must be a valid UUID' })
  @IsOptional()
  zone_id?: string;

  @Matches(UUID_PATTERN, { message: 'Region ID must be a valid UUID' })
  @IsOptional()
  region_id?: string;

  @IsString()
  @IsOptional()
  sector?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @Matches(UUID_PATTERN, { message: 'Product ID must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsArray()
  @IsOptional()
  product_ids?: string[];

  @IsString()
  @IsOptional()
  source?: string;

  @IsEnum(['new_lead', 'active', 'expected', 'follow_up'] as const)
  @IsOptional()
  category?: LeadCategory;

  @IsEnum(['high', 'medium', 'low'] as const)
  @IsOptional()
  probability?: LeadProbability;

  @IsEnum(['direct', 'partner'] as const)
  @IsOptional()
  channel?: ChannelType;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  lead_status?: LeadStatus;

  @IsString()
  @IsOptional()
  lead_type?: LeadType;

  @IsString()
  @IsOptional()
  loss_reason?: LeadLossReason;

  @Matches(UUID_PATTERN, { message: 'Assigned salesperson must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @Matches(UUID_PATTERN, { message: 'Regional manager must be a valid UUID' })
  @IsOptional()
  regional_manager_id?: string;

  @IsString()
  @IsOptional()
  bill_qtr?: string;

  @IsDateString({}, { message: DATE_MESSAGE('Last interaction date') })
  @IsOptional()
  last_interaction_date?: string;

  @IsString()
  @IsIn(INTERACTION_TYPES, { message: `Last interaction type must be one of: ${INTERACTION_TYPES.join(', ')}` })
  @IsOptional()
  last_interaction_type?: string;

  @IsString()
  @IsOptional()
  last_interaction_notes?: string;

  @IsDateString({}, { message: DATE_MESSAGE('Next follow-up date') })
  @IsOptional()
  next_followup_date?: string;

  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0, { message: 'Quantity cannot be negative' })
  @IsOptional()
  qty?: number;

  @IsNumber({}, { message: 'Quoted price must be a number' })
  @Min(0, { message: 'Quoted price cannot be negative' })
  @IsOptional()
  quot_price?: number;

  @IsNumber({}, { message: 'Order price must be a number' })
  @Min(0, { message: 'Order price cannot be negative' })
  @IsOptional()
  order_price?: number;

  // QA DEF-011: the estimated deal value must be a positive amount
  @IsNumber({}, { message: 'Estimated deal value must be a number' })
  @IsPositive({ message: 'Estimated deal value must be greater than zero' })
  @IsOptional()
  value_lakh?: number;

  // QA DEF-011: the estimated deal value must be a positive amount
  @IsNumber({}, { message: 'Estimated deal value must be a number' })
  @IsPositive({ message: 'Estimated deal value must be greater than zero' })
  @IsOptional()
  estimated_value_lakh?: number;

  // QA DEF-011: the estimated deal value must be a positive amount
  @IsNumber({}, { message: 'Estimated deal value must be a number' })
  @IsPositive({ message: 'Estimated deal value must be greater than zero' })
  @IsOptional()
  estimated_value?: number;

  @IsString()
  @IsOptional()
  booking_month?: string;

  @IsString()
  @IsOptional()
  billing_month?: string;

  @IsString()
  @IsOptional()
  order_status?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class UpdateLeadDto {
  @Matches(UUID_PATTERN, { message: 'Contact ID must be a valid UUID' })
  @IsOptional()
  primary_contact_id?: string;

  @Matches(UUID_PATTERN, { message: 'Product ID must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsEnum(['new_lead', 'active', 'expected', 'follow_up'] as const)
  @IsOptional()
  category?: LeadCategory;

  @IsEnum(['high', 'medium', 'low'] as const)
  @IsOptional()
  probability?: LeadProbability;

  @IsEnum(['direct', 'partner'] as const)
  @IsOptional()
  channel?: ChannelType;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  lead_status?: LeadStatus;

  @IsString()
  @IsOptional()
  lead_type?: LeadType;

  @IsString()
  @IsOptional()
  loss_reason?: LeadLossReason;

  @Matches(UUID_PATTERN, { message: 'Assigned salesperson must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @Matches(UUID_PATTERN, { message: 'Regional manager must be a valid UUID' })
  @IsOptional()
  regional_manager_id?: string;

  @IsString()
  @IsOptional()
  bill_qtr?: string;

  @IsDateString({}, { message: DATE_MESSAGE('Next follow-up date') })
  @IsOptional()
  next_followup_date?: string;

  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0, { message: 'Quantity cannot be negative' })
  @IsOptional()
  qty?: number;

  @IsNumber({}, { message: 'Quoted price must be a number' })
  @Min(0, { message: 'Quoted price cannot be negative' })
  @IsOptional()
  quot_price?: number;

  @IsNumber({}, { message: 'Order price must be a number' })
  @Min(0, { message: 'Order price cannot be negative' })
  @IsOptional()
  order_price?: number;

  // QA DEF-011: the estimated deal value must be a positive amount
  @IsNumber({}, { message: 'Estimated deal value must be a number' })
  @IsPositive({ message: 'Estimated deal value must be greater than zero' })
  @IsOptional()
  value_lakh?: number;

  // QA DEF-011: the estimated deal value must be a positive amount
  @IsNumber({}, { message: 'Estimated deal value must be a number' })
  @IsPositive({ message: 'Estimated deal value must be greater than zero' })
  @IsOptional()
  estimated_value_lakh?: number;

  // QA DEF-011: the estimated deal value must be a positive amount
  @IsNumber({}, { message: 'Estimated deal value must be a number' })
  @IsPositive({ message: 'Estimated deal value must be greater than zero' })
  @IsOptional()
  estimated_value?: number;

  @IsString()
  @IsOptional()
  booking_month?: string;

  @IsString()
  @IsOptional()
  billing_month?: string;

  @IsString()
  @IsOptional()
  order_status?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ChangeLeadStatusDto {
  @Matches(NOT_BLANK, { message: 'Status is required' })
  status!: string;

  @IsString()
  @IsOptional()
  loss_reason?: string;

  @IsString()
  @IsOptional()
  loss_remarks?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  // Win details — required when the lead is marked CONVERTED (QA DEF-054; Module 1 §6: "PO number, contract value")
  @IsString()
  @IsOptional()
  po_reference?: string;

  @IsNumber({}, { message: 'Order value must be a number' })
  @IsPositive({ message: 'Order value must be greater than zero' })
  @IsOptional()
  order_value_lakh?: number;

  @IsDateString({}, { message: DATE_MESSAGE('Order date') })
  @IsOptional()
  order_date?: string;
}

export class AssignLeadDto {
  @Matches(UUID_PATTERN, { message: 'Assigned salesperson must be a valid UUID' })
  @IsNotEmpty({ message: 'Assigned salesperson is required' })
  assigned_to!: string;

  @Matches(UUID_PATTERN, { message: 'Regional manager must be a valid UUID' })
  @IsOptional()
  regional_manager_id?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class AddProductInterestDto {
  @Matches(UUID_PATTERN, { message: 'Product ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Product ID is required' })
  product_id!: string;
}
