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
import { MastersService } from './masters.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('masters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MastersController {
  constructor(private readonly mastersService: MastersService) {}

  @Get('zones')
  async getZones() {
    return this.mastersService.getZones();
  }

  @Post('zones')
  @Roles('admin')
  async createZone(@Body() body: { code?: string; name?: string }, @CurrentUser() user: AuthUser) {
    return this.mastersService.createZone(body, user.id);
  }

  @Patch('zones/:id')
  @Roles('admin')
  async updateZone(@Param('id') id: string, @Body() body: { code?: string; name?: string }, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateZone(id, body, user.id);
  }

  @Delete('zones/:id')
  @Roles('admin')
  async deleteZone(@Param('id') id: string) {
    return this.mastersService.deleteZone(id);
  }

  @Get('regions')
  async getRegions(@Query('zone_id') zoneId?: string) {
    return this.mastersService.getRegions(zoneId);
  }

  @Post('regions')
  @Roles('admin')
  async createRegion(@Body() body: { name?: string; zone_id?: string }, @CurrentUser() user: AuthUser) {
    return this.mastersService.createRegion(body, user.id);
  }

  @Patch('regions/:id')
  @Roles('admin')
  async updateRegion(@Param('id') id: string, @Body() body: { name?: string; zone_id?: string; active?: boolean }, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateRegion(id, body, user.id);
  }

  @Delete('regions/:id')
  @Roles('admin')
  async deleteRegion(@Param('id') id: string) {
    return this.mastersService.deleteRegion(id);
  }

  @Get('departments')
  async getDepartments() {
    return this.mastersService.getDepartments();
  }

  @Post('departments')
  @Roles('admin')
  async createDepartment(@Body() body: { code: string; name: string; description?: string }) {
    return this.mastersService.createDepartment(body);
  }

  @Patch('departments/:id')
  @Roles('admin')
  async updateDepartment(@Param('id') id: string, @Body() body: { name?: string; description?: string }) {
    return this.mastersService.updateDepartment(id, body);
  }

  @Delete('departments/:id')
  @Roles('admin')
  async deleteDepartment(@Param('id') id: string) {
    return this.mastersService.deleteDepartment(id);
  }

  @Get('products')
  async getProducts() {
    return this.mastersService.getProducts();
  }

  @Post('products')
  @Roles('admin')
  async createProduct(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.mastersService.createProduct(body ?? {}, user.id);
  }

  @Patch('products/:id')
  @Roles('admin')
  async updateProduct(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateProduct(id, body ?? {}, user.id);
  }

  // --- Role Permissions Matrix ---
  @Get('role-permissions')
  async getRolePermissions(@Query('role') role?: string) {
    return this.mastersService.getRolePermissions(role);
  }

  @Patch('role-permissions/:id')
  @Roles('admin')
  async updateRolePermission(
    @Param('id') id: string,
    @Body()
    body: {
      can_view?: boolean;
      can_create?: boolean;
      can_edit?: boolean;
      can_delete?: boolean;
      can_approve?: boolean;
    },
  ) {
    return this.mastersService.updateRolePermission(id, body);
  }
}

