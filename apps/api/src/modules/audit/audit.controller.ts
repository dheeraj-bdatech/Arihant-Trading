import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';

/** Immutable audit trail (Blueprint §47): Management (global audit logs) and Admin (audit trail review) only. */
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('facets')
  @Roles('admin', 'management')
  async facets() {
    return this.auditService.facets();
  }

  @Get()
  @Roles('admin', 'management')
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('entity_type') entity_type?: string,
    @Query('entity_id') entity_id?: string,
    @Query('actor_id') actor_id?: string,
    @Query('action') action?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
    @Query('search') search?: string,
    @Query('key_changes') key_changes?: string,
  ) {
    return this.auditService.findAll({ page, limit, entity_type, entity_id, actor_id, action, date_from, date_to, search, key_changes });
  }
}
