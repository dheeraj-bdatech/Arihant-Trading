import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ACCESS_MODULES, type AuthUser } from '@arihant/shared';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { ModuleAccessService } from './module-access.service.js';

export class SetModuleAccessDto {
  @IsBoolean()
  blocked!: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

/** Admin → Role Permissions: which modules are switched off for which role. */
@Controller('admin/access')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccessController {
  constructor(private readonly access: ModuleAccessService) {}

  @Get()
  @Roles('admin', 'management')
  async matrix() {
    return {
      modules: ACCESS_MODULES.map(({ key, label, paths }) => ({ key, label, paths })),
      blocks: await this.access.listBlocks(),
    };
  }

  @Put(':role/:module')
  @Roles('admin', 'management')
  async set(@Param('role') role: string, @Param('module') module: string, @Body() dto: SetModuleAccessDto, @CurrentUser() user: AuthUser) {
    return this.access.setBlocked(role, module, dto.blocked, dto.reason, user.id);
  }
}
