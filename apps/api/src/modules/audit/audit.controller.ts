import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService, type AuditQuery } from './audit.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

type AuditParams = Partial<Record<keyof AuditQuery, string>>;

/** The list and the export take the same filters. */
const toAuditQuery = (p: AuditParams): AuditQuery => ({
  page: p.page as unknown as number,
  limit: p.limit as unknown as number,
  entity_type: p.entity_type,
  entity_id: p.entity_id,
  actor_id: p.actor_id,
  action: p.action,
  date_from: p.date_from,
  date_to: p.date_to,
  search: p.search,
  key_changes: p.key_changes,
  include_reminders: p.include_reminders,
  kind: p.kind,
});

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

  /** Chart data for the important changes matching the filters (see AuditService.summary). */
  @Get('summary')
  @Roles('admin', 'management')
  async summary(@Query() params: AuditParams) {
    return this.auditService.summary(toAuditQuery(params));
  }

    /** The filtered trail as a CSV download (see AuditService.exportCsv). */
  @Get('export')
  @Roles('admin', 'management')
  async exportCsv(@Query() params: AuditParams, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { csv, rows, truncated, filename } = await this.auditService.exportCsv(toAuditQuery(params), user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Rows', String(rows));
    res.setHeader('X-Export-Truncated', String(truncated));
    res.setHeader('Cache-Control', 'no-store');
    return res.send(csv);
  }

  @Get()
  @Roles('admin', 'management')
  async findAll(@Query() params: AuditParams) {
    return this.auditService.findAll(toAuditQuery(params));
  }
}
