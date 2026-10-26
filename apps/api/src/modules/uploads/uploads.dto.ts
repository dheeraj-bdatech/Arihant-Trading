import { IsString, IsNotEmpty, IsUUID, IsOptional, IsUrl, MaxLength, Matches } from 'class-validator';

export class SignUploadDto {
  /** Sub-folder under CLOUDINARY_UPLOAD_FOLDER (letters, digits, - and _ only). */
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,40}$/i, { message: 'folder may only contain letters, digits, - and _' })
  folder?: string;
}

export class AttachFileDto {
  @IsString()
  @IsNotEmpty({ message: 'Entity type is required' })
  @Matches(/^[a-z_]{2,40}$/, { message: 'Entity type must be a lower-case identifier' })
  entity_type!: string;

  @IsUUID('all')
  @IsNotEmpty({ message: 'Entity ID is required' })
  entity_id!: string;

  // Only real https links: a javascript:/data: URL would run in the browser of whoever opens the attachment.
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'File URL must be an https:// link' })
  @MaxLength(2000)
  file_url!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  file_name?: string;
}

export class ListAttachmentsQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'entity_type is required' })
  entity_type!: string;

  @IsUUID('all', { message: 'entity_id must be a valid id' })
  entity_id!: string;
}
