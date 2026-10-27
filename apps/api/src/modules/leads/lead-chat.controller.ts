import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator.js';
import { LeadChatService } from './lead-chat.service.js';
import { LeadChatPostDto, LeadChatQueryDto } from './leads.dto.js';

function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Customer side of a lead's live chat. No login: the private link's token is the only thing that opens the lead's
 * customer-facing messages.
 */
@Controller('public/lead-chat')
@Public()
export class LeadChatController {
  constructor(private readonly chat: LeadChatService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async view(@Query() q: LeadChatQueryDto, @Req() req: Request) {
    return this.chat.view(q.token, clientIp(req));
  }

  @Post('messages')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async post(@Body() dto: LeadChatPostDto, @Req() req: Request) {
    return this.chat.post(dto.token, dto.body, clientIp(req));
  }
}
