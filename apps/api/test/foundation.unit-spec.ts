/**
 * QA batch 1 — foundation units: pagination, IST calendar days, region scope, JWT secret,
 * roles guard, auth guard, global exception filter and Cloudinary signing. No database or HTTP.
 * Tests describe the behaviour the code should have; a failure here is a defect, not a flaky test.
 */
import { ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '@arihant/shared';
import { buildPaginatedResult, getPaginationParams } from '../src/common/utils/pagination';
import { calendarDay } from '../src/common/utils/ist-date.util';
import { assertNotSelfApproval, assertRegionScope, checkRegionScope } from '../src/common/utils/scope.util';
import { getJwtSecret } from '../src/common/auth/jwt-secret';
import { RolesGuard } from '../src/common/auth/roles.guard';
import { JwtAuthGuard } from '../src/common/auth/jwt.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { CloudinaryService } from '../src/common/cloudinary/cloudinary.service';

const config = (vals: Record<string, string | undefined>) => ({ get: (k: string) => vals[k] }) as any;

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  email: 'u1@x.com',
  full_name: 'U One',
  role: 'sales',
  region_id: 'r1',
  zone_id: 'z1',
  reporting_manager_id: null,
  is_active: true,
  ...over,
});

const httpCtx = (req: any, res?: any) =>
  ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  }) as any;

// ---------------------------------------------------------------- pagination
describe('getPaginationParams / buildPaginatedResult', () => {
  it('defaults to page 1, limit 20', () => {
    expect(getPaginationParams()).toEqual({ page: 1, limit: 20, offset: 0 });
  });
  it('computes offset for page 3', () => {
    expect(getPaginationParams({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10, offset: 20 });
  });
  it('clamps page 0 / negative to 1', () => {
    expect(getPaginationParams({ page: 0 }).page).toBe(1);
    expect(getPaginationParams({ page: -5 }).page).toBe(1);
  });
  it('caps limit at 100', () => {
    expect(getPaginationParams({ limit: 100000 }).limit).toBe(100);
  });
  it('treats non-numeric strings as defaults', () => {
    expect(getPaginationParams({ page: 'abc' as any, limit: 'xyz' as any })).toEqual({ page: 1, limit: 20, offset: 0 });
  });
  it('returns whole numbers for fractional input (LIMIT 2.5 is invalid SQL)', () => {
    const p = getPaginationParams({ page: 1.5 as any, limit: 2.5 as any });
    expect(Number.isInteger(p.limit)).toBe(true);
    expect(Number.isInteger(p.offset)).toBe(true);
  });
  it('returns a finite offset for an absurd page ("1e309" → Infinity)', () => {
    expect(Number.isFinite(getPaginationParams({ page: '1e309' as any }).offset)).toBe(true);
  });
  it('reports at least one page for an empty result', () => {
    expect(buildPaginatedResult([], 0, 1, 20).totalPages).toBe(1);
  });
  it('rounds pages up', () => {
    expect(buildPaginatedResult([], 41, 1, 20).totalPages).toBe(3);
  });
});

// ---------------------------------------------------------------- IST calendar day
describe('calendarDay', () => {
  it.each([null, undefined, ''])('returns null for %p', (v) => expect(calendarDay(v as any)).toBeNull());
  it('passes a YYYY-MM-DD string through', () => expect(calendarDay('2026-10-24')).toBe('2026-10-24'));
  it('trims whitespace', () => expect(calendarDay(' 2026-10-24 ')).toBe('2026-10-24'));
  it('maps a UTC instant after 18:30 to the next IST day', () => expect(calendarDay('2026-10-23T20:00:00Z')).toBe('2026-10-24'));
  it('returns null for garbage', () => expect(calendarDay('not-a-date')).toBeNull());
  it('returns null for an Invalid Date', () => expect(calendarDay(new Date('x'))).toBeNull());
  it('rejects an impossible calendar date (30 Feb)', () => expect(calendarDay('2026-02-30')).toBeNull());
});

// ---------------------------------------------------------------- region scope
describe('checkRegionScope / assertRegionScope / assertNotSelfApproval', () => {
  it.each(['management', 'admin', 'accounts', 'tender_team'] as const)('%s has all-India scope', (role) => {
    expect(checkRegionScope(user({ role, region_id: null, zone_id: null }), 'other-region', 'other-zone')).toBe(true);
  });
  it('allows same region', () => expect(checkRegionScope(user(), 'r1', 'z9')).toBe(true));
  it('allows same zone', () => expect(checkRegionScope(user({ region_id: 'r2' }), 'r9', 'z1')).toBe(true));
  it('denies other region and zone', () => expect(checkRegionScope(user(), 'r9', 'z9')).toBe(false));
  it('allows the assignee across regions', () => expect(checkRegionScope(user(), 'r9', 'z9', 'u1')).toBe(true));
  it('allows the owner via options object', () => expect(checkRegionScope(user(), 'r9', { entityZoneId: 'z9', entityOwnerId: 'u1' })).toBe(true));
  it('allows unscoped (national) records', () => expect(checkRegionScope(user(), null, null)).toBe(true));
  it('denies a user with no territory on a scoped record', () => {
    expect(checkRegionScope(user({ region_id: null, zone_id: null }), 'r1', 'z1')).toBe(false);
  });
  it('assertRegionScope throws 403 when denied', () => {
    expect(() => assertRegionScope(user(), 'r9', 'z9')).toThrow(ForbiddenException);
  });
  it('assertNotSelfApproval blocks self, allows others', () => {
    expect(() => assertNotSelfApproval('a', 'a')).toThrow(ForbiddenException);
    expect(() => assertNotSelfApproval('a', 'b')).not.toThrow();
  });
});

// ---------------------------------------------------------------- JWT secret
describe('getJwtSecret', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => (process.env.NODE_ENV = env));
  it('uses SUPABASE_JWT_SECRET when set', () => expect(getJwtSecret(config({ SUPABASE_JWT_SECRET: 's3cret' }))).toBe('s3cret'));
  it('throws in production when unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getJwtSecret(config({}))).toThrow();
  });
  it('falls back to the dev secret outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(getJwtSecret(config({}))).toHaveLength(43);
  });
});

// ---------------------------------------------------------------- roles guard
describe('RolesGuard', () => {
  const guard = (roles?: string[]) => new RolesGuard({ getAllAndOverride: () => roles } as any);
  it('allows when no roles are declared', () => expect(guard(undefined).canActivate(httpCtx({ user: user() }))).toBe(true));
  it('allows a listed role', () => expect(guard(['sales']).canActivate(httpCtx({ user: user() }))).toBe(true));
  it('rejects an unlisted role with 403', () => {
    expect(() => guard(['accounts']).canActivate(httpCtx({ user: user() }))).toThrow(ForbiddenException);
  });
  it('rejects a request with no user', () => {
    expect(() => guard(['sales']).canActivate(httpCtx({}))).toThrow(ForbiddenException);
  });
  it.each(['admin', 'management'] as const)('%s passes any role list', (role) => {
    expect(guard(['accounts']).canActivate(httpCtx({ user: user({ role }) }))).toBe(true);
  });
});

// ---------------------------------------------------------------- auth guard
describe('JwtAuthGuard', () => {
  const SECRET = 'unit-test-secret';
  const dbUser = { id: 'u1', email: 'u1@x.com', full_name: 'U', role: 'sales', region_id: 'r1', zone_id: null, reporting_manager_id: null, is_active: true };
  const makeGuard = (row: any = dbUser, isPublic = false) => {
    const db: any = { selectFrom: () => db, selectAll: () => db, where: () => db, executeTakeFirst: async () => row };
    return new JwtAuthGuard({ getAllAndOverride: () => isPublic } as any, config({ SUPABASE_JWT_SECRET: SECRET }), db);
  };
  const run = (guard: JwtAuthGuard, authorization?: string) => {
    const req: any = { headers: authorization === undefined ? {} : { authorization } };
    return guard.canActivate(httpCtx(req)).then((ok) => ({ ok, req }));
  };
  const sign = (payload: object, opts: jwt.SignOptions = {}, secret = SECRET) => jwt.sign(payload, secret, opts);

  it('lets @Public routes through without a token', async () => expect((await run(makeGuard(dbUser, true))).ok).toBe(true));
  it('accepts a valid HS256 token and attaches the DB user', async () => {
    const { ok, req } = await run(makeGuard(), `Bearer ${sign({ sub: 'u1' })}`);
    expect(ok).toBe(true);
    expect(req.user).toMatchObject({ id: 'u1', role: 'sales' });
  });
  it('rejects a missing header', async () => await expect(run(makeGuard())).rejects.toThrow(UnauthorizedException));
  it('rejects a non-Bearer scheme', async () => await expect(run(makeGuard(), `Basic abc`)).rejects.toThrow(UnauthorizedException));
  it('rejects "Bearer " with an empty token', async () => await expect(run(makeGuard(), 'Bearer ')).rejects.toThrow(UnauthorizedException));
  it('rejects an expired token', async () => {
    await expect(run(makeGuard(), `Bearer ${sign({ sub: 'u1' }, { expiresIn: -10 })}`)).rejects.toThrow(UnauthorizedException);
  });
  it('rejects a token signed with another secret', async () => {
    await expect(run(makeGuard(), `Bearer ${sign({ sub: 'u1' }, {}, 'attacker')}`)).rejects.toThrow(UnauthorizedException);
  });
  it('rejects an unsigned alg=none token', async () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"u1"}').toString('base64url')}.`;
    await expect(run(makeGuard(), `Bearer ${none}`)).rejects.toThrow(UnauthorizedException);
  });
  it('rejects a token without a subject', async () => {
    await expect(run(makeGuard(), `Bearer ${sign({ email: 'x' })}`)).rejects.toThrow(UnauthorizedException);
  });
  it('rejects a user that no longer exists', async () => {
    await expect(run(makeGuard(null), `Bearer ${sign({ sub: 'u1' })}`)).rejects.toThrow(UnauthorizedException);
  });
  it('rejects a deactivated user even with a valid token', async () => {
    await expect(run(makeGuard({ ...dbUser, is_active: false }), `Bearer ${sign({ sub: 'u1' })}`)).rejects.toThrow(UnauthorizedException);
  });
  it('uses the DB role, not the role claimed in the token', async () => {
    const { req } = await run(makeGuard(), `Bearer ${sign({ sub: 'u1', role: 'admin' })}`);
    expect(req.user.role).toBe('sales');
  });
});

// ---------------------------------------------------------------- exception filter
describe('HttpExceptionFilter', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => (process.env.NODE_ENV = env));
  const catchIt = (err: unknown) => {
    let status = 0;
    let body: any;
    const res = { status: (s: number) => ((status = s), { json: (b: any) => (body = b) }) };
    new HttpExceptionFilter().catch(err, { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/api/x' }) }) } as any);
    return { status, body };
  };
  const pg = (code: string, extra: object = {}) => Object.assign(new Error('pg'), { code, ...extra });

  it('keeps an HttpException status and message', () => {
    expect(catchIt(new HttpException('nope', HttpStatus.BAD_REQUEST))).toMatchObject({ status: 400, body: { message: 'nope', path: '/api/x' } });
  });
  it('maps 22P02 (bad uuid) to 400', () => expect(catchIt(pg('22P02')).status).toBe(400));
  it('maps 23505 (duplicate) to 409', () => expect(catchIt(pg('23505')).status).toBe(409));
  it('maps 23503 (missing FK) to 400', () => expect(catchIt(pg('23503')).status).toBe(400));
  it('maps 23514 (check) to 422', () => expect(catchIt(pg('23514')).status).toBe(422));
  it('maps 22001 (too long) to 400', () => expect(catchIt(pg('22001')).status).toBe(400));
  it('hides internal error text in production', () => {
    process.env.NODE_ENV = 'production';
    const { status, body } = catchIt(new Error('relation "secret_table" does not exist'));
    expect(status).toBe(500);
    expect(body.message).toBe('An unexpected error occurred');
  });
  it('does not echo raw database values in a duplicate-key error', () => {
    const { body } = catchIt(pg('23505', { detail: 'Key (email)=(ceo@arihant.com) already exists.' }));
    expect(String(body.message)).not.toContain('ceo@arihant.com');
  });
});

// ---------------------------------------------------------------- cloudinary signing
describe('CloudinaryService.generateSignedUploadParameters', () => {
  it('signs folder + timestamp with the configured secret (Cloudinary sha1 scheme)', () => {
    const p = new CloudinaryService(config({ CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 'sec' })).generateSignedUploadParameters('f');
    expect(p.folder).toBe('arihant-bos/f');
    expect(p.signature).toBe(crypto.createHash('sha1').update(`allowed_formats=${p.allowedFormats}&folder=${p.folder}&timestamp=${p.timestamp}sec`).digest('hex'));
  });
  it('refuses to sign when credentials are not configured (no placeholder secret)', () => {
    expect(() => new CloudinaryService(config({})).generateSignedUploadParameters()).toThrow();
  });
  it('does not let callers sign uploads into an arbitrary folder', () => {
    const p = new CloudinaryService(config({ CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's', CLOUDINARY_UPLOAD_FOLDER: 'arihant-bos' })).generateSignedUploadParameters('../../other-tenant');
    expect(p.folder.startsWith('arihant-bos')).toBe(true);
  });
  it('signs with the secret as meant, not the whitespace or quotes pasted around it', () => {
    const p = new CloudinaryService(config({ CLOUDINARY_CLOUD_NAME: ' c ', CLOUDINARY_API_KEY: '"k"', CLOUDINARY_API_SECRET: ' "sec"\n' })).generateSignedUploadParameters('f');
    expect(p.apiKey).toBe('k');
    expect(p.cloudName).toBe('c');
    expect(p.signature).toBe(crypto.createHash('sha1').update(`allowed_formats=${p.allowedFormats}&folder=${p.folder}&timestamp=${p.timestamp}sec`).digest('hex'));
  });
});

describe('CloudinaryService credential check', () => {
  const realFetch = global.fetch;
  const svc = () => new CloudinaryService(config({ CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 'wrong' }));
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('refuses to sign with a clear message when Cloudinary rejects the key / secret pair', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'api_secret mismatch' } }) }) as any;
    await expect(svc().assertCredentialsAccepted()).rejects.toThrow(/CLOUDINARY_API_SECRET/);
  });
  it('allows signing when Cloudinary accepts the credentials, and caches the answer', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
    global.fetch = fetchMock as any;
    const s = svc();
    await expect(s.assertCredentialsAccepted()).resolves.toBeUndefined();
    await s.assertCredentialsAccepted();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not block uploads when Cloudinary cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
    await expect(svc().checkCredentials()).resolves.toBe('unknown');
    await expect(svc().assertCredentialsAccepted()).resolves.toBeUndefined();
  });
});
