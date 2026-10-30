import { Body, Controller, Delete, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardWorkspaceService } from './dashboard-workspace.service.js';
import { DashboardPerformanceService } from './dashboard-performance.service.js';
import { DashboardCommandService } from './dashboard-command.service.js';
import { DashboardLayoutService } from './dashboard-layout.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser, CommandDashboardDto, CommandLayout, DashboardMetricsDto, DashboardWorkspaceDto, SalesPerformanceDto } from '@arihant/shared';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly workspaceService: DashboardWorkspaceService,
    private readonly performanceService: DashboardPerformanceService,
    private readonly commandService: DashboardCommandService,
    private readonly layoutService: DashboardLayoutService,
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

  /**
   * Module 9 — Salesperson & Regional Performance. Sales see only their own row; a regional manager their zone's reps
   * and regions; management / admin everything, optionally narrowed to a zone / region.
   */
  @Get('sales-performance')
  @UseGuards(RolesGuard)
  @Roles('sales', 'regional_manager', 'management', 'admin')
  async getSalesPerformance(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('group_by') groupBy?: string,
    @Query('zone_id') zoneId?: string,
    @Query('region_id') regionId?: string,
  ): Promise<SalesPerformanceDto> {
    return this.performanceService.getSalesPerformance(user, { from, to, group_by: groupBy, zone_id: zoneId, region_id: regionId });
  }

  /**
   * Module 10 — Management Command dashboard: the exceptions across every module, all India, in the caller's own
   * layout. Each figure uses the rule of the module screen it links to.
   */
  @Get('command')
  @UseGuards(RolesGuard)
  @Roles('management', 'admin')
  async getCommand(@CurrentUser() user: AuthUser): Promise<CommandDashboardDto> {
    return this.commandService.getCommand(user, await this.layoutService.get(user.id));
  }

  /** The caller's saved layout of the command dashboard (sections, figures, order, period). */
  @Patch('command/layout')
  @UseGuards(RolesGuard)
  @Roles('management', 'admin')
  async saveCommandLayout(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<CommandLayout> {
    return this.layoutService.save(user.id, body);
  }

  @Delete('command/layout')
  @UseGuards(RolesGuard)
  @Roles('management', 'admin')
  async resetCommandLayout(@CurrentUser() user: AuthUser): Promise<CommandLayout> {
    return this.layoutService.reset(user.id);
  }
}
