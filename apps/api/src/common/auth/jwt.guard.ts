import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../database/database.module.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { getJwtSecret } from './jwt-secret.js';
import type { Database, AuthUser } from '@arihant/shared';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private jwksCache: Map<string, string> = new Map(); // kid -> pem
  private lastJwksFetch = 0;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  private async getJwksKey(kid?: string): Promise<string | null> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    if (!supabaseUrl) return null;

    const now = Date.now();
    // Refresh JWKS cache every 1 hour or if kid not found
    if (this.jwksCache.size === 0 || (kid && !this.jwksCache.has(kid)) || now - this.lastJwksFetch > 3600000) {
      try {
        const jwksUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
        const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.keys)) {
            for (const key of data.keys) {
              try {
                const keyObject = crypto.createPublicKey({ key, format: 'jwk' });
                const pem = keyObject.export({ type: 'spki', format: 'pem' }) as string;
                if (key.kid) {
                  this.jwksCache.set(key.kid, pem);
                }
                this.jwksCache.set('default', pem);
              } catch (e: any) {
                this.logger.warn(`Failed to convert JWK key: ${e.message}`);
              }
            }
            this.lastJwksFetch = now;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not reach Supabase JWKS endpoint: ${err.message}. Falling back to secret.`);
      }
    }

    if (kid && this.jwksCache.has(kid)) {
      return this.jwksCache.get(kid)!;
    }
    return this.jwksCache.get('default') || null;
  }

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

    const token = authHeader.split(' ')[1];
    const jwtSecret = getJwtSecret(this.configService);

    let payload: any;
    let decodedToken: any = null;
    try {
      decodedToken = jwt.decode(token, { complete: true });
    } catch {
      // ignore decode error, will fail on verify
    }

    const alg = decodedToken?.header?.alg;
    const kid = decodedToken?.header?.kid;

    // Verify ES256 via JWKS if available
    if (alg === 'ES256') {
      try {
        const jwksPem = await this.getJwksKey(kid);
        if (jwksPem) {
          payload = jwt.verify(token, jwksPem, { algorithms: ['ES256'] });
        } else {
          payload = jwt.verify(token, jwtSecret);
        }
      } catch (err: any) {
        throw new UnauthorizedException(`Invalid ES256 Supabase token: ${err.message}`);
      }
    } else {
      // HS256 or default secret verification
      try {
        payload = jwt.verify(token, jwtSecret);
      } catch (err: any) {
        throw new UnauthorizedException(`Invalid or expired token: ${err.message}`);
      }
    }

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

