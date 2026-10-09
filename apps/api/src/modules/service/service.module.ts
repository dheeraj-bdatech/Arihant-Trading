import { Module } from '@nestjs/common';
import { ServiceService } from './service.service.js';
import { ServiceController } from './service.controller.js';
import { ServicePortalService } from './service-portal.service.js';
import { ServicePortalController } from './service-portal.controller.js';
import { ServiceScheduler } from './service.scheduler.js';

@Module({
  controllers: [ServiceController, ServicePortalController],
  providers: [ServiceService, ServicePortalService, ServiceScheduler],
  exports: [ServiceService],
})
export class ServiceModule {}
