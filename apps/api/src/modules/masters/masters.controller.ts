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
import { MastersService, type MasterListQuery } from './masters.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { AdminOnly } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('masters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MastersController {
  constructor(private readonly mastersService: MastersService) {}

  /** Master lists answer a plain array (every dropdown reads them whole) unless `page` asks for one page. */
  @Get('client-categories')
  async getClientCategories(@Query() q: MasterListQuery) {
    return this.mastersService.getClientCategories(q);
  }

  @Post('client-categories')
  @AdminOnly()
  async createClientCategory(@Body() body: { name?: string; label?: string; sort_order?: number }, @CurrentUser() user: AuthUser) {
    return this.mastersService.createClientCategory(body, user.id);
  }

  @Patch('client-categories/:id')
  @AdminOnly()
  async updateClientCategory(
    @Param('id') id: string,
    @Body() body: { name?: string; label?: string; sort_order?: number; is_active?: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.mastersService.updateClientCategory(id, body, user.id);
  }

  @Delete('client-categories/:id')
  @AdminOnly()
  async deleteClientCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mastersService.deleteClientCategory(id, user.id);
  }

  @Get('zones')
  async getZones(@Query() q: MasterListQuery) {
    return this.mastersService.getZones(q);
  }

  @Post('zones')
  @AdminOnly()
  async createZone(@Body() body: { code?: string; name?: string }, @CurrentUser() user: AuthUser) {
    return this.mastersService.createZone(body, user.id);
  }

  @Patch('zones/:id')
  @AdminOnly()
  async updateZone(@Param('id') id: string, @Body() body: { code?: string; name?: string }, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateZone(id, body, user.id);
  }

  @Delete('zones/:id')
  @AdminOnly()
  async deleteZone(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mastersService.deleteZone(id, user.id);
  }

  @Get('regions')
  async getRegions(@Query() q: MasterListQuery & { zone_id?: string }) {
    return this.mastersService.getRegions(q.zone_id, q);
  }

  @Post('regions')
  @AdminOnly()
  async createRegion(@Body() body: { name?: string; zone_id?: string }, @CurrentUser() user: AuthUser) {
    return this.mastersService.createRegion(body, user.id);
  }

  @Patch('regions/:id')
  @AdminOnly()
  async updateRegion(@Param('id') id: string, @Body() body: { name?: string; zone_id?: string; active?: boolean }, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateRegion(id, body, user.id);
  }

  @Delete('regions/:id')
  @AdminOnly()
  async deleteRegion(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mastersService.deleteRegion(id, user.id);
  }

  @Get('departments')
  async getDepartments(@Query() q: MasterListQuery) {
    return this.mastersService.getDepartments(q);
  }

  @Post('departments')
  @AdminOnly()
  async createDepartment(@Body() body: { code?: string; name?: string; description?: string; head_user_id?: string | null }, @CurrentUser() user: AuthUser) {
    return this.mastersService.createDepartment(body, user.id);
  }

  @Patch('departments/:id')
  @AdminOnly()
  async updateDepartment(@Param('id') id: string, @Body() body: { name?: string; description?: string; head_user_id?: string | null }, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateDepartment(id, body, user.id);
  }

  @Delete('departments/:id')
  @AdminOnly()
  async deleteDepartment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mastersService.deleteDepartment(id, user.id);
  }

  @Get('products')
  async getProducts(@Query() q: MasterListQuery) {
    return this.mastersService.getProducts(q);
  }

  @Post('products')
  @AdminOnly()
  async createProduct(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.mastersService.createProduct(body ?? {}, user.id);
  }

  @Patch('products/:id')
  @AdminOnly()
  async updateProduct(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.mastersService.updateProduct(id, body ?? {}, user.id);
  }

  // --- Role Permissions Matrix ---
  @Get('role-permissions')
  async getRolePermissions(@Query('role') role?: string) {
    return this.mastersService.getRolePermissions(role);
  }

  @Patch('role-permissions/:id')
  @AdminOnly()
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

