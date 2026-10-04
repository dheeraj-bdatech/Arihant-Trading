import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  Matches,
} from 'class-validator';
import type { DeliveryStatus } from '@arihant/shared';

export const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class CreateDeliveryDto {
  @Matches(UUID_REGEX, { message: 'organisation_id must be a valid UUID' })
  @IsNotEmpty({ message: 'Customer organization is required' })
  organisation_id!: string;

  @Matches(UUID_REGEX, { message: 'product_id must be a valid UUID' })
  @IsOptional()
  product_id?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  equipment_serial?: string;

  @IsDateString({}, { message: 'delivery_date must be a valid date' })
  @IsNotEmpty({ message: 'Delivery date is required' })
  delivery_date!: string;

  @IsString()
  @IsNotEmpty({ message: 'Delivery location is required' })
  delivery_location!: string;

  @Matches(UUID_REGEX, { message: 'assigned_to must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @Matches(UUID_REGEX, { message: 'tender_id must be a valid UUID' })
  @IsOptional()
  tender_id?: string;

  @IsString()
  @IsOptional()
  order_reference?: string;

  @IsBoolean()
  @IsOptional()
  installation_required?: boolean;

  @IsDateString({}, { message: 'installation_date must be a valid date' })
  @IsOptional()
  installation_date?: string;

  @Matches(UUID_REGEX, { message: 'installed_by must be a valid UUID' })
  @IsOptional()
  installed_by?: string;

  @IsString()
  @IsOptional()
  installation_notes?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  document_url?: string;
}

export class UpdateDeliveryStatusDto {
  @IsEnum(
    ['scheduled', 'dispatched', 'in_transit', 'delivered', 'installed', 'handover_completed', 'cancelled'],
    { message: 'Invalid delivery status' },
  )
  @IsNotEmpty({ message: 'Status is required' })
  status!: DeliveryStatus;

  @IsDateString({}, { message: 'installation_date must be a valid date' })
  @IsOptional()
  installation_date?: string;

  @Matches(UUID_REGEX, { message: 'installed_by must be a valid UUID' })
  @IsOptional()
  installed_by?: string;

  @IsString()
  @IsOptional()
  installation_notes?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  document_url?: string;
}

export class DeliveryQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  organisation_id?: string;

  @IsString()
  @IsOptional()
  assigned_to?: string;

  @IsString()
  @IsOptional()
  dateFrom?: string;

  @IsString()
  @IsOptional()
  dateTo?: string;
}
