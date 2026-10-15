import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { TASK_DB, createTaskDb } from './task-db.js';
import { TASK_CONFIG, loadTaskConfig } from './task.config.js';
import { TaskMastersService } from './task-masters.service.js';
import { TaskAccessService } from './task-access.service.js';
import { TaskStore } from './task-store.service.js';
import { TaskInputService } from './task-input.service.js';
import { TasksService } from './tasks.service.js';
import { TaskWorkflowService } from './task-workflow.service.js';
import { TaskBlockersService } from './task-blockers.service.js';
import { TaskGeneratorService } from './task-generator.service.js';
import { TaskTemplatesService } from './task-templates.service.js';
import { TaskAttachmentsService } from './task-attachments.service.js';
import { TaskAccountabilityService } from './task-accountability.service.js';
import { PerformanceEvidenceService } from './performance-evidence.service.js';
import { PerformanceReviewsService } from './performance-reviews.service.js';
import { TaskNotificationsListener } from './task-notifications.listener.js';
import { TaskJobsService } from './task-jobs.service.js';
import {
  AccountabilityController,
  PerformanceEvidenceController,
  PerformanceReviewsController,
  TaskAttachmentsController,
  TaskBlockersController,
  TaskCalendarController,
  TaskCategoriesController,
  TaskEscalationsController,
  TaskSettingsController,
  TaskTemplatesController,
  TasksController,
} from './tasks.controller.js';

/** Module 8 — Task & Productivity Management (tasks, blockers, recurrence, accountability, performance evidence). */
@Module({
  controllers: [
    TaskCategoriesController,
    TaskSettingsController,
    TaskCalendarController,
    TasksController,
    TaskAttachmentsController,
    TaskBlockersController,
    TaskEscalationsController,
    TaskTemplatesController,
    AccountabilityController,
    PerformanceEvidenceController,
    PerformanceReviewsController,
  ],
  providers: [
    { provide: TASK_CONFIG, useFactory: () => loadTaskConfig() },
    { provide: TASK_DB, inject: [KYSELY_DB], useFactory: (db: Kysely<Database>) => createTaskDb(db) },
    TaskMastersService,
    TaskAccessService,
    TaskStore,
    TaskInputService,
    TasksService,
    TaskWorkflowService,
    TaskBlockersService,
    TaskGeneratorService,
    TaskTemplatesService,
    TaskAttachmentsService,
    TaskAccountabilityService,
    PerformanceEvidenceService,
    PerformanceReviewsService,
    TaskNotificationsListener,
    TaskJobsService,
  ],
  exports: [TasksService, TaskStore, TaskGeneratorService, TaskJobsService],
})
export class TasksModule {}
