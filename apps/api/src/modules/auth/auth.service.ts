import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database, AuthUser, LoginResponseDto } from '@arihant/shared';
import type { DemoLoginDto, LoginDto } from './auth.dto.js';
import { getJwtSecret } from '../../common/auth/jwt-secret.js';

/**
 * Seeded demo personas, one per role (the login page's quick profiles). Demo sign-in issues a token for these
 * accounts on the server, so no shared password is ever shipped to the browser (QA DEF-013 / review R2).
 */
const DEMO_PERSONA_EMAILS: Record<string, string> = {
  management: 'mgmt@arihant.com',
  regional_manager: 'regmgr.north@arihant.com',
  sales: 'sales.delhi@arihant.com',
  tender_team: 'tender@arihant.com',
  demo_team: 'demo@arihant.com',
  service_team: 'service@arihant.com',
  accounts: 'accounts@arihant.com',
  admin: 'admin@arihant.com',
};

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

    return this.issueSession(user);
  }

  /**
   * Demo persona sign-in. Off in production unless DEMO_LOGIN_ENABLED=true (a hosted QA build that opts in);
   * on in development unless DEMO_LOGIN_ENABLED=false. When off the route answers 404 like it does not exist.
   */
  async demoLogin(dto: DemoLoginDto): Promise<LoginResponseDto> {
    const flag = this.configService.get<string>('DEMO_LOGIN_ENABLED');
    const enabled = flag === 'true' || (process.env.NODE_ENV !== 'production' && flag !== 'false');
    if (!enabled) throw new NotFoundException();
    const email = DEMO_PERSONA_EMAILS[dto.role];
    const user = email
      ? await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
      : undefined;
    if (!user || !user.is_active) throw new UnauthorizedException('This demo profile is not available');
    return this.issueSession(user);
  }

  private issueSession(user: { id: string; email: string; full_name: string; role: any; region_id: string | null; zone_id: string | null; reporting_manager_id: string | null; is_active: boolean }): LoginResponseDto {
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
