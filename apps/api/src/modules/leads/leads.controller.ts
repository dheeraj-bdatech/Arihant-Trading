import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LeadsService } from './leads.service.js';
import {
  CreateLeadDto,
  UpdateLeadDto,
  ChangeLeadStatusDto,
  AssignLeadDto,
  AddProductInterestDto,
} from './leads.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('dashboard')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getDashboard(@CurrentUser() user: AuthUser) {
    return this.leadsService.getDashboard(user);
  }

  @Get('reports/salesperson')
  @Roles('management', 'regional_manager', 'admin')
  async getSalespersonReport(@CurrentUser() user: AuthUser) {
    return this.leadsService.getSalespersonReport(user);
  }

  @Get('reports/zones')
  @Roles('management', 'regional_manager', 'admin')
  async getZoneReport(@CurrentUser() user: AuthUser) {
    return this.leadsService.getZoneReport(user);
  }

  @Get('reports/products')
  @Roles('management', 'regional_manager', 'admin')
  async getProductReport(@CurrentUser() user: AuthUser) {
    return this.leadsService.getProductReport(user);
  }

  @Get('reports/interactions')
  @Roles('management', 'regional_manager', 'admin')
  async getInteractionReport(
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('employee_id') employeeId?: string,
    @Query('organisation_id') orgId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.leadsService.getInteractionReport(
      {
        from_date: fromDate,
        to_date: toDate,
        employee_id: employeeId,
        organisation_id: orgId,
      },
      user!,
    );
  }

  @Get()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('lead_status') leadStatus?: string,
    @Query('lead_type') leadType?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('probability') probability?: string,
    @Query('assigned_to') assignedTo?: string,
    @Query('regional_manager_id') regionalManagerId?: string,
    @Query('organisation_id') orgId?: string,
    @Query('sector') sector?: string,
    @Query('zone_id') zoneId?: string,
    @Query('region_id') regionId?: string,
    @Query('followup') followup?: 'due_today' | 'overdue' | 'upcoming' | 'no_followup',
    @Query('sort_by') sortBy?: 'next_followup' | 'last_interaction' | 'created_at' | 'organisation',
    @Query('sort_dir') sortDir?: 'asc' | 'desc',
    @CurrentUser() user?: AuthUser,
  ) {
    return this.leadsService.findAll(
      {
        page,
        limit,
        search,
        lead_status: leadStatus,
        lead_type: leadType,
        status,
        category,
        probability,
        assigned_to: assignedTo,
        regional_manager_id: regionalManagerId,
        organisation_id: orgId,
        sector,
        zone_id: zoneId,
        region_id: regionId,
        followup,
        sort_by: sortBy,
        sort_dir: sortDir,
      },
      user!,
    );
  }

  @Get(':id')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leadsService.findOne(id, user);
  }

  @Post()
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.leadsService.create(dto, user);
  }

  @Patch(':id')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeLeadStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.changeStatus(id, dto, user);
  }

  @Patch(':id/assign')
  @Roles('management', 'regional_manager', 'admin')
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignLeadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.assign(id, dto, user);
  }

  @Post([':id/product-interests', ':id/products'])
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async addProductInterest(
    @Param('id') id: string,
    @Body() dto: AddProductInterestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.addProductInterest(id, dto.product_id, user);
  }

  @Delete([':id/product-interests/:productId', ':id/products/:productId'])
  @Roles('management', 'regional_manager', 'sales', 'admin')
  async removeProductInterest(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadsService.removeProductInterest(id, productId, user);
  }
}
