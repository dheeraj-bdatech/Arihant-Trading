import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { REPORT_ROLES, type AuthUser, type SalesPipelineReportDto, type ServiceReportDto, type ExpenseReportDto, type ProductivityReportDto } from '@arihant/shared';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { PipelineReportService } from './pipeline-report.service.js';
import { ServiceReportService } from './service-report.service.js';
import { ExpenseReportService } from './expense-report.service.js';
import { ProductivityReportService } from './productivity-report.service.js';

/**
 * Cross-module management reports. Each report is computed from the records the modules already hold and scoped to
 * the caller's territory (REPORT_ROLES decides who may open which report).
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly pipeline: PipelineReportService,
    private readonly service: ServiceReportService,
    private readonly expenses: ExpenseReportService,
    private readonly productivity: ProductivityReportService,
  ) {}

  /** Report 1 — lead / visit / demo / proposal / tender pipeline, conversion, win rate, zone / region / salesperson. */
  @Get('sales-pipeline')
  @Roles(...REPORT_ROLES.pipeline)
  salesPipeline(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>): Promise<SalesPipelineReportDto> {
    return this.pipeline.report(user, query);
  }

  /** Report 2 — service closure time, SLA, repeat complaints and engineer / territory breakdown (§34). */
  @Get('service')
  @Roles(...REPORT_ROLES.service)
  serviceReport(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>): Promise<ServiceReportDto> {
    return this.service.report(user, query);
  }

  /** Report 3 — expenses by employee / trip / customer / date / category / region / approval status (§40). */
  @Get('expenses')
  @Roles(...REPORT_ROLES.expenses)
  expenseReport(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>): Promise<ExpenseReportDto> {
    return this.expenses.report(user, query);
  }

  /** Report 4 — per-employee task evidence (Module 8) with their visits, follow-ups, sales, demo, service and expense activity. */
  @Get('productivity')
  @Roles(...REPORT_ROLES.productivity)
  productivityReport(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>): Promise<ProductivityReportDto> {
    return this.productivity.report(user, query);
  }
}
