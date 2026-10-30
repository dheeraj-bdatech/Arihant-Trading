import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AccessController } from './access.controller.js';
import { ModuleAccessInterceptor } from './module-access.interceptor.js';
import { ModuleAccessService } from './module-access.service.js';

/** Administrator-controlled module switches per role, enforced on every authenticated API call. */
@Global()
@Module({
  controllers: [AccessController],
  providers: [ModuleAccessService, { provide: APP_INTERCEPTOR, useClass: ModuleAccessInterceptor }],
  exports: [ModuleAccessService],
})
export class AccessModule {}
