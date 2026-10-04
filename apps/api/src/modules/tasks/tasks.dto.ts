import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
  Matches,
} from 'class-validator';
import type { TaskStatus, TaskBlockerType, TaskBlockerDecision } from '@arihant/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty({ message: 'Task title is required' })
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Matches(UUID_PATTERN, { message: 'assigned_to must be a valid UUID' })
  @IsOptional()
  assigned_to?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  priority?: string;

  @IsString()
  @IsOptional()
  task_type?: string;

  @IsString()
  @IsOptional()
  related_entity_type?: string;

  @Matches(UUID_PATTERN, { message: 'related_entity_id must be a valid UUID' })
  @IsOptional()
  related_entity_id?: string;

  @IsDateString()
  @IsOptional()
  start_date?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsString()
  @IsOptional()
  expected_outcome?: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  priority?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsEnum(['not_started', 'in_progress', 'completed', 'blocked', 'awaiting_approval', 'overdue'] as const)
  @IsOptional()
  status?: TaskStatus;

  @IsString()
  @IsOptional()
  evidence_url?: string;
}

export class RaiseBlockerDto {
  @IsEnum(
    ['mgmt_approval', 'customer', 'vendor', 'other_employee', 'missing_info', 'portal', 'technical', 'leave'] as const,
    { message: 'Invalid blocker category' },
  )
  @IsNotEmpty()
  blocker_type!: TaskBlockerType;

  @IsString()
  @IsNotEmpty({ message: 'Description of the bottleneck/blocker is required' })
  description!: string;
}

export class ResolveBlockerDto {
  @IsEnum(['accepted', 'rejected', 'extended', 'reassigned', 'escalated'] as const)
  @IsNotEmpty()
  decision!: TaskBlockerDecision;

  @IsDateString()
  @IsOptional()
  new_deadline?: string;

  @Matches(UUID_PATTERN, { message: 'reassigned_to must be a valid UUID' })
  @IsOptional()
  reassigned_to?: string;
}
