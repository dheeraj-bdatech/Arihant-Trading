import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardWorkspaceService } from './dashboard-workspace.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardWorkspaceService],
  exports: [DashboardService],
})
export class DashboardModule {}
