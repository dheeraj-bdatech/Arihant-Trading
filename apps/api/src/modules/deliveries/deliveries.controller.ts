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
import { DeliveriesService } from './deliveries.service.js';
import {
  CreateDeliveryDto,
  UpdateDeliveryStatusDto,
  DeliveryQueryDto,
} from './deliveries.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('deliveries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  /** KPI counts for the register: takes the list's filters and role scope (anyone who can list can count). */
  @Get('metrics')
  async getMetrics(@Query() query: DeliveryQueryDto, @CurrentUser() user: AuthUser) {
    return this.deliveriesService.getDeliveryMetrics(user, query);
  }

  @Get()
  async findAll(@Query() query: DeliveryQueryDto, @CurrentUser() user: AuthUser) {
    return this.deliveriesService.findAll(query, user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.deliveriesService.findOne(id, user);
  }

  @Post()
  @Roles('management', 'regional_manager', 'admin', 'sales', 'tender_team')
  async create(@Body() dto: CreateDeliveryDto, @CurrentUser() user: AuthUser) {
    return this.deliveriesService.create(dto, user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.deliveriesService.updateStatus(id, dto, user);
  }

  @Delete(':id')
  @Roles('management', 'admin')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.deliveriesService.delete(id, user);
  }
}
