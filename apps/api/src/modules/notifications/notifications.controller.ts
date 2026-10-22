import { Controller, Get, Patch, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifService: NotificationsService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.notifService.findAll(user.id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
      status,
      category,
      search,
    });
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: AuthUser) {
    return this.notifService.getSummary(user.id);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: AuthUser) {
    return this.notifService.getUnreadCount(user.id);
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notifService.markAllAsRead(user.id);
  }

  @Patch('mark-all-read')
  async markAllAsReadAlias(@CurrentUser() user: AuthUser) {
    return this.notifService.markAllAsRead(user.id);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.notifService.markAsRead(id, user.id);
  }

  @Post()
  async create(
    @Body()
    dto: {
      userId?: string;
      user_id?: string;
      type?: string;
      title: string;
      body: string;
      entityType?: string;
      entity_type?: string;
      entityId?: string;
      entity_id?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    const targetUserId = dto.userId || dto.user_id || user.id;
    return this.notifService.create({
      userId: targetUserId,
      type: dto.type || 'system',
      title: dto.title,
      body: dto.body,
      entityType: dto.entityType || dto.entity_type,
      entityId: dto.entityId || dto.entity_id,
    });
  }
}

