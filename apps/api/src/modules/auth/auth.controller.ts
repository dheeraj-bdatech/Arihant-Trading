import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { DemoLoginDto, LoginDto } from './auth.dto.js';
import { Public } from '../../common/auth/public.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthUser, LoginResponseDto } from '@arihant/shared';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('demo-login')
  @HttpCode(HttpStatus.OK)
  async demoLogin(@Body() dto: DemoLoginDto): Promise<LoginResponseDto> {
    return this.authService.demoLogin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser): Promise<AuthUser> {
    return this.authService.getMe(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    return { success: true, message: 'Logged out successfully' };
  }
}

