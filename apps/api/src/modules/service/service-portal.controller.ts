import { Controller, Get, Post, Body, Query, Req, Header, HttpCode } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator.js';
import { ServicePortalService } from './service-portal.service.js';
import { PortalServiceRequestDto, PortalTrackQueryDto, PortalCommentDto, PortalFeedbackDto } from './service-portal.dto.js';

function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Customer-facing service desk. No login: the customer gets a reference + private tracking
 * code when they submit, and that pair is the only thing that unlocks their own request.
 */
@Controller('public/service-requests')
@Public()
export class ServicePortalController {
  constructor(private readonly portal: ServicePortalService) {}

  @Get('meta')
  async meta() {
    return this.portal.meta();
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async submit(@Body() dto: PortalServiceRequestDto, @Req() req: Request) {
    return this.portal.submit(dto, { ip: clientIp(req), userAgent: req.headers['user-agent'] as string });
  }

  @Get('track')
  @Header('Cache-Control', 'no-store')
  async track(@Query() q: PortalTrackQueryDto, @Req() req: Request) {
    return this.portal.track(q.ref || '', q.token || '', clientIp(req));
  }

  @Post('track/comment')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async comment(@Body() dto: PortalCommentDto, @Req() req: Request) {
    return this.portal.addComment(dto.ref, dto.token, dto.body, clientIp(req));
  }

  @Post('track/feedback')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async feedback(@Body() dto: PortalFeedbackDto, @Req() req: Request) {
    return this.portal.feedback(dto, clientIp(req));
  }
}
