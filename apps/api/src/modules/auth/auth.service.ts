import {
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database, AuthUser, LoginResponseDto } from '@arihant/shared';
import type { LoginDto } from './auth.dto.js';
import { getJwtSecret } from '../../common/auth/jwt-secret.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const email = loginDto.email.trim().toLowerCase();

    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account has been deactivated. Please contact administrator.');
    }

    // Only the stored bcrypt hash authenticates. There is no shared/master password: an account without a hash
    // (never provisioned through users.create / bulk-invite) cannot log in until an admin sets one.
    if (!user.password_hash || !(await bcrypt.compare(loginDto.password, user.password_hash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      region_id: user.region_id,
      zone_id: user.zone_id,
      reporting_manager_id: user.reporting_manager_id,
      is_active: user.is_active,
    };

    const jwtSecret = getJwtSecret(this.configService);

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        aud: 'authenticated',
      },
      jwtSecret,
      { expiresIn: '24h' },
    );

    return {
      token,
      accessToken: token,
      user: authUser,
    };
  }

  async getMe(userId: string): Promise<AuthUser> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      region_id: user.region_id,
      zone_id: user.zone_id,
      reporting_manager_id: user.reporting_manager_id,
      is_active: user.is_active,
    };
  }
}
