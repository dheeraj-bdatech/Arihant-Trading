import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../database/database.module.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { verifyAccessToken } from './verify-token.js';
import type { Database, AuthUser } from '@arihant/shared';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const payload: any = await verifyAccessToken(token, this.configService);

    const userId = payload.sub || payload.id;
    if (!userId) {
      throw new UnauthorizedException('Token payload does not contain user ID');
    }

    // Always query the database to verify active status and fetch current role
    // (Addresses edge cases: deactivated users blocked immediately, mid-session role changes applied)
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw new UnauthorizedException('User account does not exist');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('User account has been deactivated');
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

    request.user = authUser;
    return true;
  }
}

// CurrentUserGuard export alias for architectural compliance (§5)
export { JwtAuthGuard as CurrentUserGuard };

