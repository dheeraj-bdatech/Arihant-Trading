import { Controller, Post, Get, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type SignInContext } from './auth.service.js';
import { DemoLoginDto, LoginDto } from './auth.dto.js';
import { Public } from '../../common/auth/public.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser, LoginResponseDto } from '@arihant/shared';

/** Where the request came from, for the sign-in audit trail (first X-Forwarded-For hop behind a proxy). */
function signInContext(req: Request): SignInContext {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return { ip: forwarded || req.ip || req.socket?.remoteAddress, userAgent: req.headers['user-agent'] as string | undefined };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request): Promise<LoginResponseDto> {
    return this.authService.login(loginDto, signInContext(req));
  }

  @Public()
  @Post('demo-login')
  @HttpCode(HttpStatus.OK)
  async demoLogin(@Body() dto: DemoLoginDto, @Req() req: Request): Promise<LoginResponseDto> {
    return this.authService.demoLogin(dto, signInContext(req));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser): Promise<AuthUser> {
    return this.authService.getMe(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.authService.logout(user, signInContext(req));
  }
}

