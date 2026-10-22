import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganisationsService } from './organisations.service.js';
import { CreateOrganisationDto, UpdateOrganisationDto } from './organisations.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('organisations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganisationsController {
  constructor(private readonly orgsService: OrganisationsService) {}

  @Get()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('sector') sector?: string,
    @Query('zone_id') zone_id?: string,
    @Query('region_id') region_id?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.orgsService.findAll({ page, limit, search, sector, zone_id, region_id }, user);
  }

  @Get('check-duplicate')
  async checkDuplicate(
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
  ) {
    return this.orgsService.checkDuplicate({ name, email, phone });
  }

  @Get(':id/timeline')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
  async getTimeline(@Param('id') id: string) {
    return this.orgsService.getTimeline(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.orgsService.findOne(id);
  }

  @Post()
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async create(@Body() dto: CreateOrganisationDto, @CurrentUser() user: AuthUser) {
    return this.orgsService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('management', 'regional_manager', 'sales', 'tender_team', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganisationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgsService.update(id, dto, user.id);
  }
}
