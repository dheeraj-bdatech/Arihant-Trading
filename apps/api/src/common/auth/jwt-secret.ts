import type { ConfigService } from '@nestjs/config';

const DEV_FALLBACK_SECRET = 'super-secret-supabase-jwt-token-key-32chars';

/**
 * HS256 signing/verification secret shared by login, the HTTP guard and the WebSocket gateway.
 * A missing secret in production is a misconfiguration (anyone knowing the dev fallback could mint tokens),
 * so it fails loudly there; development keeps the fallback for zero-config local runs.
 */
export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('SUPABASE_JWT_SECRET');
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_JWT_SECRET must be set in production');
  }
  return DEV_FALLBACK_SECRET;
}

