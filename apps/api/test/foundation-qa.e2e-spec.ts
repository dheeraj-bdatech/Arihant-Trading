/**
 * QA batch 1 — HTTP behaviour of the foundation: auth, sessions, user admin, notifications, uploads,
 * request validation and error mapping. The app uses configureApp — the same global setup as main.ts (same ValidationPipe
 * options and global filter) so status codes match production. A failing test is a defect.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/app-setup';

describe('QA batch 1 — foundation over HTTP', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const login = async (email: string, password = 'password123') => {
    const r = await http().post('/api/auth/login').send({ email, password });
    expect(r.status).toBe(200);
    return { token: r.body.accessToken as string, id: r.body.user.id as string };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();

    for (const [key, email] of [['mgmt', 'mgmt@arihant.com'], ['admin', 'admin@arihant.com'], ['sales', 'sales.delhi@arihant.com'], ['sales2', 'sales.kolkata@arihant.com'], ['accounts', 'accounts@arihant.com']] as const) {
      const s = await login(email);
      tokens[key] = s.token;
      ids[key] = s.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (k: string) => ({ Authorization: `Bearer ${tokens[k]}` });

  // ------------------------------------------------------------ login
  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials and returns a token + user without password hash', async () => {
      const r = await http().post('/api/auth/login').send({ email: 'sales.delhi@arihant.com', password: 'password123' });
      expect(r.status).toBe(200);
      expect(r.body.accessToken).toEqual(r.body.token);
      expect(r.body.user.role).toBe('sales');
      expect(JSON.stringify(r.body)).not.toMatch(/password_hash/);
    });
    // Known defect M6 (not fixed yet): the DTO rejects surrounding spaces before the service trims them.
    it.failing('normalises email case and whitespace', async () => {
      const r = await http().post('/api/auth/login').send({ email: '  SALES.Delhi@Arihant.com ', password: 'password123' });
      expect(r.status).toBe(200);
    });
    it('rejects a wrong password with 401', async () => {
      expect((await http().post('/api/auth/login').send({ email: 'sales.delhi@arihant.com', password: 'wrong-pass-1' })).status).toBe(401);
    });
    it('gives the same 401 message for unknown email and wrong password (no account enumeration)', async () => {
      const a = await http().post('/api/auth/login').send({ email: 'ghost@arihant.com', password: 'wrong-pass-1' });
      const b = await http().post('/api/auth/login').send({ email: 'sales.delhi@arihant.com', password: 'wrong-pass-1' });
      expect(a.status).toBe(401);
      expect(a.body.message).toBe(b.body.message);
    });
    it.each([
      ['empty body', {}],
      ['missing password', { email: 'sales.delhi@arihant.com' }],
      ['email as number', { email: 12345, password: 'x' }],
      ['password as object', { email: 'sales.delhi@arihant.com', password: { $ne: '' } }],
    ])('rejects %s with 400, not 500', async (_label, body) => {
      expect((await http().post('/api/auth/login').send(body)).status).toBe(400);
    });
    it('treats SQL-injection text as a plain (failed) login', async () => {
      const r = await http().post('/api/auth/login').send({ email: "' OR 1=1 --", password: "' OR '1'='1" });
      expect([400, 401]).toContain(r.status);
    });
    it('does not crash on a 10 kB unicode password', async () => {
      const r = await http().post('/api/auth/login').send({ email: 'sales.delhi@arihant.com', password: '密码🔐'.repeat(2500) });
      expect([400, 401]).toContain(r.status);
    });
    it('rejects GET (wrong method) with 404', async () => {
      expect((await http().get('/api/auth/login')).status).toBe(404);
    });
    it('rejects a non-JSON content type cleanly (4xx)', async () => {
      const r = await http().post('/api/auth/login').set('Content-Type', 'text/plain').send('email=a&password=b');
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    });
    // Known defect H1 (not fixed yet): no login rate limiting.
    it.failing('throttles repeated failed logins (brute-force protection → 429)', async () => {
      let last = 0;
      for (let i = 0; i < 30; i++) last = (await http().post('/api/auth/login').send({ email: 'admin@arihant.com', password: `guess-${i}` })).status;
      expect(last).toBe(429);
    });
  });

  // ------------------------------------------------------------ demo login
  describe('POST /api/auth/demo-login', () => {
    // Known defect C1 (not fixed yet): demo login issues an admin token without a password.
    it.failing('does not hand out an admin session without a password', async () => {
      const r = await http().post('/api/auth/demo-login').send({ role: 'admin' });
      expect(r.status).not.toBe(200);
    });
    it('rejects an unknown role with 400/401', async () => {
      expect([400, 401, 404]).toContain((await http().post('/api/auth/demo-login').send({ role: 'superuser' })).status);
    });
  });

  // ------------------------------------------------------------ sessions
  describe('GET /api/auth/me — token handling', () => {
    const secret = process.env.SUPABASE_JWT_SECRET || 'super-secret-supabase-jwt-token-key-32chars';
    it('returns the current user for a valid token', async () => {
      const r = await http().get('/api/auth/me').set(bearer('sales'));
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(ids.sales);
    });
    it.each([
      ['no header', undefined],
      ['garbage token', 'Bearer not.a.jwt'],
      ['wrong scheme', `Token abc`],
    ])('401 for %s', async (_l, h) => {
      const req = http().get('/api/auth/me');
      if (h) req.set('Authorization', h);
      expect((await req).status).toBe(401);
    });
    it('401 for an expired token', async () => {
      const t = jwt.sign({ sub: ids.sales }, secret, { expiresIn: -60 });
      expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    });
    it('401 for a forged token signed with another secret', async () => {
      const t = jwt.sign({ sub: ids.admin, role: 'admin' }, 'attacker-secret');
      expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    });
    it('a token for a deactivated user stops working immediately', async () => {
      const email = `qa.deact.${randomUUID().slice(0, 8)}@arihant.com`;
      const created = await http().post('/api/users').set(bearer('admin')).send({ email, full_name: 'QA Deactivate', role: 'sales', password: 'Qa!pass12345' });
      expect(created.status).toBe(201);
      const s = await login(email, 'Qa!pass12345');
      expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${s.token}`)).status).toBe(200);
      expect((await http().patch(`/api/users/${created.body.id}`).set(bearer('admin')).send({ is_active: false })).status).toBe(200);
      expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${s.token}`)).status).toBe(401);
    });
    // Known defect M2 (not fixed yet): tokens stay valid after logout.
    it.failing('logout invalidates the token', async () => {
      const s = await login('sales.kolkata@arihant.com');
      expect((await http().post('/api/auth/logout').set('Authorization', `Bearer ${s.token}`)).status).toBe(200);
      expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${s.token}`)).status).toBe(401);
    });
  });

  // ------------------------------------------------------------ users admin
  describe('/api/users', () => {
    it('sales cannot create users (403)', async () => {
      expect((await http().post('/api/users').set(bearer('sales')).send({ email: 'x@y.com', full_name: 'X', role: 'admin' })).status).toBe(403);
    });
    it('rejects a duplicate email with 409', async () => {
      expect((await http().post('/api/users').set(bearer('admin')).send({ email: 'sales.delhi@arihant.com', full_name: 'Dup', role: 'sales' })).status).toBe(409);
    });
    it('rejects an invalid role with 400', async () => {
      expect((await http().post('/api/users').set(bearer('admin')).send({ email: `qa.${randomUUID().slice(0, 6)}@x.com`, full_name: 'X', role: 'god' })).status).toBe(400);
    });
    it('GET /users/:id with a non-uuid returns 400, not 500', async () => {
      expect((await http().get('/api/users/not-a-uuid').set(bearer('mgmt'))).status).toBe(400);
    });
    it('the user list never exposes password hashes', async () => {
      const r = await http().get('/api/users').set(bearer('sales'));
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/password_hash|\$2[aby]\$/);
    });
    // Known defect M1 (not fixed yet): there is no change-password endpoint.
    it.failing('a user can change their own password', async () => {
      const r = await http().post('/api/auth/change-password').set(bearer('sales2')).send({ current_password: 'password123', new_password: 'password123' });
      expect(r.status).not.toBe(404);
    });
  });

  // ------------------------------------------------------------ pagination / query edge cases (via a real list)
  describe('list query edge cases (GET /api/users)', () => {
    it.each([
      ['limit=2.5', { limit: '2.5' }],
      ['page=1e309', { page: '1e309' }],
      ['limit=-1', { limit: '-1' }],
      ['page=abc', { page: 'abc' }],
    ])('%s does not cause a 500', async (_l, q) => {
      const r = await http().get('/api/users').query(q).set(bearer('mgmt'));
      expect(r.status).toBeLessThan(500);
    });
    it('search with quotes / unicode / SQL text is treated as text', async () => {
      const r = await http().get('/api/users').query({ search: "'; DROP TABLE users; -- 🙂 Ñandú" }).set(bearer('mgmt'));
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual([]);
    });
  });

  // ------------------------------------------------------------ notifications
  describe('/api/notifications', () => {
    it('a user cannot create a notification in someone else’s inbox', async () => {
      const r = await http()
        .post('/api/notifications')
        .set(bearer('sales'))
        .send({ user_id: ids.mgmt, title: 'Urgent: re-enter your password', body: 'Click http://evil.example' });
      expect([400, 403]).toContain(r.status);
    });
    it('missing title returns 400, not 500', async () => {
      expect((await http().post('/api/notifications').set(bearer('sales')).send({ body: 'x' })).status).toBe(400);
    });
    it('cannot mark another user’s notification as read', async () => {
      const mine = await http().get('/api/notifications').set(bearer('mgmt'));
      const id = mine.body.data?.[0]?.id;
      if (!id) return;
      const r = await http().patch(`/api/notifications/${id}/read`).set(bearer('sales'));
      expect([403, 404]).toContain(r.status);
    });
  });

  // ------------------------------------------------------------ uploads
  describe('/api/uploads', () => {
    const entityId = randomUUID();
    it('management attaches a receipt to an expense claim', async () => {
      const r = await http().post('/api/uploads/attach').set(bearer('mgmt')).send({ entity_type: 'expense_claim', entity_id: entityId, file_url: 'https://res.cloudinary.com/x/receipt.pdf', file_name: 'receipt.pdf' });
      expect(r.status).toBe(201);
    });
    it('another sales user cannot list attachments of a record they cannot see', async () => {
      const r = await http().get('/api/uploads/attachments').query({ entity_type: 'expense_claim', entity_id: entityId }).set(bearer('sales2'));
      expect(r.status === 403 || (r.status === 200 && r.body.length === 0)).toBe(true);
    });
    it('rejects a javascript: URL as an attachment (stored XSS)', async () => {
      const r = await http().post('/api/uploads/attach').set(bearer('sales')).send({ entity_type: 'lead', entity_id: randomUUID(), file_url: 'javascript:alert(document.cookie)' });
      expect(r.status).toBe(400);
    });
    it('missing query params return 400, not 500', async () => {
      expect((await http().get('/api/uploads/attachments').set(bearer('sales'))).status).toBe(400);
    });
  });

  // ------------------------------------------------------------ generic HTTP
  describe('generic HTTP behaviour', () => {
    it('unknown route → 404 JSON', async () => {
      const r = await http().get('/api/does-not-exist').set(bearer('sales'));
      expect(r.status).toBe(404);
      expect(r.body.statusCode).toBe(404);
    });
    it('malformed JSON body → 400, not 500', async () => {
      const r = await http().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
      expect(r.status).toBe(400);
    });
    it('body over the size limit → 413', async () => {
      const r = await http().post('/api/auth/login').send({ email: 'a@b.com', password: 'x'.repeat(2_000_000) });
      expect(r.status).toBe(413);
    });
  });
});
