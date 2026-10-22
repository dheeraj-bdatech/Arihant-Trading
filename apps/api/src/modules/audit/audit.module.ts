import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditTrailListener } from './audit-trail.listener.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditTrailListener],
  exports: [AuditService],
})
export class AuditModule {}
