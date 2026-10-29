import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './filters/http-exception.filter.js';

/**
 * Global request handling shared by main.ts and the e2e suites, so tests exercise exactly what production runs:
 * the /api prefix, DTO validation (unknown fields are stripped, not rejected) and the database-aware error filter.
 */
/**
 * Express `trust proxy` from TRUST_PROXY (default `loopback`: the Next.js /api rewrite on the same host). Only hops
 * we trust may set X-Forwarded-For, so `req.ip` is the real client and a visitor cannot pick their own address to
 * dodge per-IP rate limits. Accepts true/false, a hop count, or Express's address / subnet list
 * (e.g. `loopback, 10.0.0.0/8`).
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): boolean | number | string {
  const v = String(raw ?? '').trim();
  if (!v) return 'loopback';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function configureApp(app: INestApplication): INestApplication {
  const http = app.getHttpAdapter()?.getInstance?.();
  if (http && typeof http.set === 'function') http.set('trust proxy', trustProxySetting());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
