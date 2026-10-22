import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardWorkspaceService } from './dashboard-workspace.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser, DashboardMetricsDto, DashboardWorkspaceDto } from '@arihant/shared';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly workspaceService: DashboardWorkspaceService,
  ) {}

  @Get('metrics')
  async getMetrics(@CurrentUser() user: AuthUser): Promise<DashboardMetricsDto> {
    return this.dashboardService.getMetrics(user);
  }

  /** The caller's own home screen: role-specific widgets, scoped to their territory. */
  @Get('workspace')
  async getWorkspace(@CurrentUser() user: AuthUser): Promise<DashboardWorkspaceDto> {
    return this.workspaceService.getWorkspace(user);
  }

  /** Sidebar badge figures (tender live / closing counts) in the caller's scope — same definitions as the dashboards. */
  @Get('nav-counts')
  async getNavCounts(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getNavCounts(user);
  }

  @Get('regional-performance')
  @UseGuards(RolesGuard)
  @Roles('regional_manager', 'management', 'admin')
  async getRegionalPerformance(
    @CurrentUser() user: AuthUser,
    @Query('zone_id') zoneId?: string,
    @Query('region_id') regionId?: string,
  ) {
    return this.dashboardService.getRegionalPerformance(user, { zone_id: zoneId, region_id: regionId });
  }
}

