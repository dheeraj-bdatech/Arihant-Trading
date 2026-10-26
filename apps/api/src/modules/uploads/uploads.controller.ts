import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service.js';
import { AttachFileDto, ListAttachmentsQueryDto, SignUploadDto } from './uploads.dto.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser } from '@arihant/shared';

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('sign')
  getSignParameters(@Body() dto?: SignUploadDto) {
    return this.uploadsService.getSignParameters(dto?.folder);
  }

  @Post('attach')
  async attachFile(@Body() dto: AttachFileDto, @CurrentUser() user: AuthUser) {
    return this.uploadsService.attachFile(dto, user);
  }

  @Get('attachments')
  async getAttachments(@Query() query: ListAttachmentsQueryDto, @CurrentUser() user: AuthUser) {
    return this.uploadsService.getAttachments(query.entity_type, query.entity_id, user);
  }
}
