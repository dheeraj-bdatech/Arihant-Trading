import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardWorkspaceService } from './dashboard-workspace.service.js';
import { DashboardMetricsService } from './dashboard-metrics.js';
import { DashboardPerformanceService } from './dashboard-performance.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardWorkspaceService, DashboardMetricsService, DashboardPerformanceService],
  exports: [DashboardService, DashboardMetricsService],
})
export class DashboardModule {}
