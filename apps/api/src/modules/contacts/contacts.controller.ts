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
import { ContactsService } from './contacts.service.js';
import { CreateContactDto, UpdateContactDto } from './contacts.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
// Customer contacts are Customer Register data — every role but accounts (RBAC Module 1)
@Roles('management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  async findByOrganisation(@Query('organisation_id') orgId: string, @CurrentUser() user: AuthUser) {
    return this.contactsService.findByOrganisation(orgId, user);
  }

  @Post()
  async create(@Body() dto: CreateContactDto, @CurrentUser() user: AuthUser) {
    return this.contactsService.create(dto, user);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user: AuthUser) {
    return this.contactsService.update(id, dto, user);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.contactsService.delete(id, user);
  }
}
