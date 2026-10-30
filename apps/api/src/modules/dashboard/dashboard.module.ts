import { Module } from '@nestjs/common';
import { ServiceModule } from '../service/service.module.js';
import { ProposalsModule } from '../proposals/proposals.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardWorkspaceService } from './dashboard-workspace.service.js';
import { DashboardMetricsService } from './dashboard-metrics.js';
import { DashboardPerformanceService } from './dashboard-performance.service.js';
import { DashboardCommandService } from './dashboard-command.service.js';
import { DashboardLayoutService } from './dashboard-layout.service.js';

@Module({
  // Module 10 counts service and proposal figures with those modules' own KPI methods
  imports: [ServiceModule, ProposalsModule, ReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardWorkspaceService, DashboardMetricsService, DashboardPerformanceService, DashboardCommandService, DashboardLayoutService],
  exports: [DashboardService, DashboardMetricsService],
})
export class DashboardModule {}
