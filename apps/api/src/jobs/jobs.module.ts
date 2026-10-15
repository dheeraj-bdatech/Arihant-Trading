import { Module } from '@nestjs/common';
import { DeadlineRemindersJob } from './deadline-reminders.job.js';

// Module 8 task jobs (recurring generation, overdue, reminders, SLA, digest) live in TasksModule (task-jobs.service.ts).
@Module({
  providers: [DeadlineRemindersJob],
  exports: [DeadlineRemindersJob],
})
export class JobsModule {}
