import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import type { Database, AuthUser, LoginResponseDto } from '@arihant/shared';
import type { DemoLoginDto, LoginDto } from './auth.dto.js';
import { getJwtSecret } from '../../common/auth/jwt-secret.js';
import { NO_RECORD_ID } from '../../common/events/audit.listener.js';
import { ModuleAccessService } from '../access/module-access.service.js';

/** Where a sign-in came from, as the audit trail records it. */
export interface SignInContext {
  ip?: string;
  userAgent?: string;
}

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
    private readonly eventEmitter: EventEmitter2,
    private readonly access: ModuleAccessService,
  ) {}

  /**
   * Sign-ins in the security audit trail (entity type `session`, one row per attempt): who, how, from where.
   * A failed attempt has no actor (nobody is signed in) and records the email tried and why it failed, never the
   * password; an unknown email points at NO_RECORD_ID.
   */
  private auditSession(action: string, userId: string | null, details: Record<string, unknown>, ctx: SignInContext = {}) {
    this.eventEmitter.emit('audit.log', {
      actorId: action === 'sign_in_failed' ? null : userId,
      entityType: 'session',
      entityId: userId || NO_RECORD_ID,
      action,
      newValue: { ...details, ip: ctx.ip || null, user_agent: ctx.userAgent?.slice(0, 300) || null },
    });
  }

  async login(loginDto: LoginDto, ctx: SignInContext = {}): Promise<LoginResponseDto> {
    const email = loginDto.email.trim().toLowerCase();

    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();

    if (!user) {
      this.auditSession('sign_in_failed', null, { email, method: 'password', reason: 'unknown_account' }, ctx);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.is_active) {
      this.auditSession('sign_in_failed', user.id, { email, method: 'password', reason: 'account_deactivated' }, ctx);
      throw new UnauthorizedException('Account has been deactivated. Please contact administrator.');
    }

    // Only the stored bcrypt hash authenticates. There is no shared/master password: an account without a hash
    // (never provisioned through users.create / bulk-invite) cannot log in until an admin sets one.
    if (!user.password_hash || !(await bcrypt.compare(loginDto.password, user.password_hash))) {
      this.auditSession('sign_in_failed', user.id, { email, method: 'password', reason: user.password_hash ? 'wrong_password' : 'no_password_set' }, ctx);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.auditSession('sign_in', user.id, { email, method: 'password' }, ctx);
    return this.issueSession(user);
  }

  /** Sign-out (the token itself expires on its own; this records the moment the person left). */
  logout(user: AuthUser, ctx: SignInContext = {}) {
    this.auditSession('sign_out', user.id, { email: user.email }, ctx);
    return { success: true, message: 'Logged out successfully' };
  }

  /**
   * Demo persona sign-in. Active by default in all environments, production included.
   */
  async demoLogin(dto: DemoLoginDto, ctx: SignInContext = {}): Promise<LoginResponseDto> {
    if (this.configService.get<string>('DISABLE_DEMO_LOGIN') === 'true') throw new NotFoundException();
    const email = DEMO_PERSONA_EMAILS[dto.role];
    const user = email
      ? await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
      : undefined;
    if (!user || !user.is_active) {
      this.auditSession('sign_in_failed', user?.id ?? null, { email: email || null, method: 'demo_profile', role: dto.role, reason: 'profile_unavailable' }, ctx);
      throw new UnauthorizedException('This demo profile is not available');
    }
    this.auditSession('persona_sign_in', user.id, { email, method: 'demo_profile', role: dto.role }, ctx);
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
      // modules the administrator switched off for this role: the app hides them (the API refuses them anyway)
      blocked_modules: await this.access.blockedFor(user.role),
    };
  }
}
