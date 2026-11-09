import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { PipelineReportService } from './pipeline-report.service.js';
import { ServiceReportService } from './service-report.service.js';
import { ServiceModule } from '../service/service.module.js';
import { ExpenseReportService } from './expense-report.service.js';
import { ExpenseManagementModule } from '../expense-management/expense-management.module.js';
import { ProductivityReportService } from './productivity-report.service.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { MisReportService } from './mis-report.service.js';
import { SecurityRegisterService } from './security-register.service.js';

@Module({
  imports: [ServiceModule, ExpenseManagementModule, TasksModule],
  controllers: [ReportsController],
  providers: [PipelineReportService, ServiceReportService, ExpenseReportService, ProductivityReportService, MisReportService, SecurityRegisterService],
  // the Management Command dashboard reads "people needing attention" and on-time completion from Report 4
  exports: [ProductivityReportService],
})
export class ReportsModule {}
