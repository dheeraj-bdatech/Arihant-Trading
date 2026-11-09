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
import { UsersService } from './users.service.js';
import { CreateUserDto, UpdateUserDto, BulkInviteUsersDto } from './users.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { AdminOnly, Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('management', 'regional_manager', 'admin', 'tender_team', 'demo_team', 'service_team', 'accounts', 'sales')
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('zone_id') zone_id?: string,
    @Query('is_active') is_active?: string,
  ) {
    return this.usersService.findAll({ page, limit, search, role, zone_id, is_active });
  }

  @Get(':id')
  @Roles('management', 'regional_manager', 'admin')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @AdminOnly()
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.usersService.create(dto, user.id);
  }

  @Patch(':id')
  @AdminOnly()
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.update(id, dto, user.id);
  }

  @Post(':id/reset-password')
  @AdminOnly()
  async resetPassword(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.usersService.resetPassword(id, user.id);
  }

  @Post('bulk-invite')
  @AdminOnly()
  async bulkInvite(
    @Body() dto: BulkInviteUsersDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.bulkInvite(dto, user.id);
  }
}
