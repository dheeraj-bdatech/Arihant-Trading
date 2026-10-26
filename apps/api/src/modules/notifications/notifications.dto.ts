import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Notification types a user may send to a colleague (assignments raised from a lead). Anything else goes to self only. */
export const PEER_NOTIFICATION_TYPES = ['demo_assigned', 'proposal_assigned', 'meeting_scheduled'] as const;

/**
 * POST /notifications. Both camelCase and snake_case keys are accepted (the web sends camelCase).
 * Text is length-capped; who may be notified is decided in NotificationsService.createFromUser.
 */
export class CreateNotificationDto {
  @IsOptional()
  @IsUUID('all', { message: 'userId must be a valid user id' })
  userId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'user_id must be a valid user id' })
  user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty({ message: 'Body is required' })
  @MaxLength(1000)
  body!: string;

  @IsOptional()
  @IsIn(['lead'], { message: 'Only lead-linked notifications can be sent' })
  entityType?: string;

  @IsOptional()
  @IsIn(['lead'], { message: 'Only lead-linked notifications can be sent' })
  entity_type?: string;

  @IsOptional()
  @IsUUID('all')
  entityId?: string;

  @IsOptional()
  @IsUUID('all')
  entity_id?: string;
}
