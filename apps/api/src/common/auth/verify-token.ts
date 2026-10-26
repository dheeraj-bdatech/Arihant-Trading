import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getJwtSecret } from './jwt-secret.js';

/**
 * One access-token check for every entry point (HTTP guard and WebSocket gateway):
 * ES256 tokens (Supabase) are verified against the project's JWKS, everything else as HS256 with the shared secret.
 * Returns the verified payload or throws 401.
 */
const logger = new Logger('VerifyToken');
const jwksCache = new Map<string, string>(); // kid -> PEM
let lastJwksFetch = 0;

async function getJwksKey(config: ConfigService, kid?: string): Promise<string | null> {
  const supabaseUrl = config.get<string>('SUPABASE_URL');
  if (!supabaseUrl) return null;
  const now = Date.now();
  // Refresh hourly, or when an unknown kid shows up.
  if (jwksCache.size === 0 || (kid && !jwksCache.has(kid)) || now - lastJwksFetch > 3_600_000) {
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.keys)) {
          for (const key of data.keys) {
            try {
              const pem = crypto.createPublicKey({ key, format: 'jwk' }).export({ type: 'spki', format: 'pem' }) as string;
              if (key.kid) jwksCache.set(key.kid, pem);
              jwksCache.set('default', pem);
            } catch (e: any) {
              logger.warn(`Failed to convert JWK key: ${e.message}`);
            }
          }
          lastJwksFetch = now;
        }
      }
    } catch (err: any) {
      logger.warn(`Could not reach Supabase JWKS endpoint: ${err.message}.`);
    }
  }
  if (kid && jwksCache.has(kid)) return jwksCache.get(kid)!;
  return jwksCache.get('default') || null;
}

export async function verifyAccessToken(token: string, config: ConfigService): Promise<any> {
  if (!token) throw new UnauthorizedException('Missing token');
  let header: any = null;
  try {
    header = (jwt.decode(token, { complete: true }) as any)?.header;
  } catch {
    // fall through: verify below rejects it
  }
  try {
    if (header?.alg === 'ES256') {
      const pem = await getJwksKey(config, header.kid);
      if (!pem) throw new Error('signing key unavailable');
      return jwt.verify(token, pem, { algorithms: ['ES256'] });
    }
    return jwt.verify(token, getJwtSecret(config), { algorithms: ['HS256'] });
  } catch (err: any) {
    throw new UnauthorizedException(`Invalid or expired token: ${err.message}`);
  }
}
