import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';

/**
 * Admin panel: module switches per role (enforced in the API and reported by /auth/me), departments with heads,
 * inviting many people at once, and refusing to delete masters that are still in use.
 */
describe('Admin — module access, departments, invitations', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());
  const sql1 = async (q: string) => (await sql.raw(q).execute(db)).rows as any[];
  const STAMP = `zzadm${Date.now()}`;

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken || r.body.token;
    uid[key] = r.body.user.id;
  }
  async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v as T;
      if (Date.now() - start > ms) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  const setModule = (role: string, module: string, body: Record<string, any>, who = 'admin') =>
    api().patch(`/api/admin/access/${role}/${module}`).set(auth(who)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(KYSELY_DB);
    await sql1(`delete from role_module_blocks`);
    await login('admin', 'admin@arihant.com');
    await login('mgmt', 'mgmt@arihant.com');
    await login('sales', 'sales.delhi@arihant.com');
    await login('rmN', 'regmgr.north@arihant.com');
  });

  afterAll(async () => {
    await sql1(`delete from role_module_blocks`); // never leave a role locked out for the other suites
    const users = (await sql1(`select id from users where email like '${STAMP}%'`)).map((r) => `'${r.id}'`);
    if (users.length) {
      await sql1(`delete from audit_log where entity_id in (${users.join(',')})`);
      await sql1(`delete from users where id in (${users.join(',')})`);
    }
    await sql1(`update users set department_id = null where department_id in (select id from departments where code like '${STAMP}%')`);
    await sql1(`delete from departments where code like '${STAMP}%'`);
    await sql1(`delete from regions where name like '${STAMP}%'`);
    await sql1(`delete from zones where code like 'ZQ%' and name like '${STAMP}%'`);
    await sql1(`delete from organisations where name like '${STAMP}%'`);
    await sql1(`delete from client_categories where name like '${STAMP}%'`);
    await app.close();
  });

  describe('module switches', () => {
    it('switching Leads off for sales refuses its API at once, shows in /auth/me, and switching it on restores it', async () => {
      expect((await api().get('/api/leads').set(auth('sales'))).status).toBe(200);
      const noReason = await setModule('sales', 'leads', { blocked: true });
      expect(noReason.status).toBe(400);
      expect(noReason.body.message).toContain('reason');

      expect((await setModule('sales', 'leads', { blocked: true, reason: 'Lead data frozen for the quarterly audit' })).status).toBe(200);
      const refused = await api().get('/api/leads').set(auth('sales'));
      expect(refused.status).toBe(403);
      expect(refused.body.message).toContain('switched off');
      expect((await api().get('/api/auth/me').set(auth('sales'))).body.blocked_modules).toEqual(['leads']);
      // other roles and other modules are untouched
      expect((await api().get('/api/leads').set(auth('rmN'))).status).toBe(200);
      expect((await api().get('/api/visits').set(auth('sales'))).status).not.toBe(403);

      const matrix = await api().get('/api/admin/access').set(auth('mgmt'));
      expect(matrix.status).toBe(200);
      expect(matrix.body.blocks).toEqual([expect.objectContaining({ role: 'sales', module: 'leads', reason: 'Lead data frozen for the quarterly audit' })]);

      expect((await setModule('sales', 'leads', { blocked: false })).status).toBe(200);
      expect((await api().get('/api/leads').set(auth('sales'))).status).toBe(200);
      expect((await api().get('/api/auth/me').set(auth('sales'))).body.blocked_modules).toEqual([]);

      const trail = await waitFor(async () => {
        const r = await sql1(`select action from audit_log where entity_type='role_access' and new_value->>'role'='sales' and new_value->>'module'='leads' order by created_at`);
        return r.length >= 2 && r;
      });
      expect(trail.slice(-2).map((r: any) => r.action)).toEqual(['module_switched_off', 'module_switched_on']);
    });

    it('administration writes are a module too: switched off for management, users and masters stay readable but not editable', async () => {
      expect((await setModule('management', 'admin', { blocked: true, reason: 'Only IT administers accounts from now on' })).status).toBe(200);
      expect((await api().get('/api/users').set(auth('mgmt'))).status).toBe(200); // reads feed every page
      expect((await api().post('/api/masters/zones').set(auth('mgmt')).send({ code: 'ZQ1', name: `${STAMP} zone` })).status).toBe(403);
      expect((await api().get('/api/admin/access').set(auth('mgmt'))).status).toBe(403);
      expect((await setModule('management', 'admin', { blocked: false })).status).toBe(200);
    });

    it('nobody can lock the administrator out, and only management and the administrator change switches', async () => {
      const lock = await setModule('admin', 'admin', { blocked: true, reason: 'Trying to lock everyone out' });
      expect(lock.status).toBe(400);
      expect((await setModule('sales', 'nope', { blocked: true, reason: 'Unknown module here' })).status).toBe(400);
      expect((await setModule('wizard', 'leads', { blocked: true, reason: 'Unknown role here' })).status).toBe(400);
      expect((await setModule('sales', 'tenders', { blocked: true, reason: 'Sales asking for itself' }, 'sales')).status).toBe(403);
      expect((await setModule('sales', 'tenders', { blocked: true, reason: 'Regional manager trying' }, 'rmN')).status).toBe(403);
      // management governs module access (RBAC spec §6): it can switch a module off for a role and back on
      expect((await setModule('sales', 'tenders', { blocked: true, reason: 'Tender data frozen by the MD' }, 'mgmt')).status).toBe(200);
      expect((await setModule('sales', 'tenders', { blocked: false }, 'mgmt')).status).toBe(200);
      expect((await setModule('admin', 'admin', { blocked: true, reason: 'Management trying to lock IT out' }, 'mgmt')).status).toBe(400);
    });
  });

  describe('departments', () => {
    let deptId: string;

    it('creates a department with a head, refuses duplicates, and lists the head and active people', async () => {
      const bad = await api().post('/api/masters/departments').set(auth('admin')).send({ code: 'Bad Code!', name: 'X' });
      expect(bad.status).toBe(400);
      const created = await api().post('/api/masters/departments').set(auth('admin')).send({ code: `${STAMP}_ops`, name: `${STAMP} Operations`, head_user_id: uid.rmN });
      expect(created.status).toBe(201);
      deptId = created.body.id;
      expect((await api().post('/api/masters/departments').set(auth('admin')).send({ code: `${STAMP}_ops`, name: 'Another' })).status).toBe(409);

      await sql1(`update users set department_id='${deptId}' where id='${uid.sales}'`);
      const list = (await api().get('/api/masters/departments').set(auth('admin'))).body;
      const row = list.find((d: any) => d.id === deptId);
      expect(row.head_name).toBeTruthy();
      expect(row.member_count).toBe(1);
    });

    it('a department with people in it cannot be deleted; an empty one can', async () => {
      const busy = await api().delete(`/api/masters/departments/${deptId}`).set(auth('admin'));
      expect(busy.status).toBe(409);
      expect(busy.body.message).toContain('move them');
      await sql1(`update users set department_id=null where id='${uid.sales}'`);
      expect((await api().patch(`/api/masters/departments/${deptId}`).set(auth('admin')).send({ head_user_id: null })).status).toBe(200);
      expect((await api().delete(`/api/masters/departments/${deptId}`).set(auth('admin'))).status).toBe(200);
      const trail = await waitFor(async () => (await sql1(`select action from audit_log where entity_id='${deptId}' order by created_at`)).length >= 3 && true);
      expect(trail).toBe(true);
    });

    it('a user can be put in a department from the user form', async () => {
      const d = await api().post('/api/masters/departments').set(auth('admin')).send({ code: `${STAMP}_fin`, name: `${STAMP} Finance` });
      const u = await api().post('/api/users').set(auth('admin')).send({ full_name: 'ZZ Department Person', email: `${STAMP}.dept@arihant.com`, role: 'accounts', department_id: d.body.id, reporting_manager_id: uid.mgmt });
      expect(u.body.message).toBeUndefined();
      expect(u.status).toBe(201);
      expect(u.body.department_id).toBe(d.body.id);
    });
  });

  describe('inviting many people', () => {
    it('creates the valid rows with one-time passwords, refuses incomplete ones, skips existing accounts, and audits each person', async () => {
      const res = await api()
        .post('/api/users/bulk-invite')
        .set(auth('admin'))
        .send({
          users: [
            { full_name: 'ZZ Invite Sales', email: `${STAMP}.one@arihant.com`, role: 'sales', region_name: 'Delhi NCR', manager_email: 'regmgr.north@arihant.com' },
            { full_name: 'ZZ Invite Accounts', email: `${STAMP}.two@arihant.com`, role: 'accounts', manager_email: 'accounts@arihant.com' },
            { full_name: 'ZZ No Region', email: `${STAMP}.three@arihant.com`, role: 'sales', manager_email: 'regmgr.north@arihant.com' },
            { full_name: 'ZZ No Manager', email: `${STAMP}.four@arihant.com`, role: 'accounts' },
            { full_name: 'Already Here', email: 'sales.delhi@arihant.com', role: 'sales', region_name: 'Delhi NCR', manager_email: 'regmgr.north@arihant.com' },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(2);
      expect(res.body.skipped).toBe(1);
      expect(res.body.errors.map((e: any) => e.email).sort()).toEqual([`${STAMP}.four@arihant.com`, `${STAMP}.three@arihant.com`]);
      expect(res.body.invited).toHaveLength(2);
      for (const i of res.body.invited) expect(i.temporary_password.length).toBeGreaterThanOrEqual(10);

      // the one-time password signs in
      const first = res.body.invited.find((i: any) => i.email === `${STAMP}.one@arihant.com`);
      expect([200, 201]).toContain((await api().post('/api/auth/login').send({ email: first.email, password: first.temporary_password })).status);

      const ids = (await sql1(`select id from users where email in ('${STAMP}.one@arihant.com','${STAMP}.two@arihant.com')`)).map((r) => `'${r.id}'`);
      await waitFor(async () => (await sql1(`select count(*)::int n from audit_log where action='bulk_invite' and entity_id in (${ids.join(',')})`))[0].n === 2);
    });

    it('refuses an empty list, and invitations are admin-only', async () => {
      expect((await api().post('/api/users/bulk-invite').set(auth('admin')).send({ users: [] })).status).toBe(400);
      expect((await api().post('/api/users/bulk-invite').set(auth('rmN')).send({ users: [{ full_name: 'X Y', email: `${STAMP}.x@arihant.com`, role: 'sales' }] })).status).toBe(403);
    });

    it('management reads the admin panel but every account and master change is admin-only (403)', async () => {
      const invite = { users: [{ full_name: 'X Y', email: `${STAMP}.m@arihant.com`, role: 'accounts', manager_email: 'accounts@arihant.com' }] };
      expect((await api().post('/api/users/bulk-invite').set(auth('mgmt')).send(invite)).status).toBe(403);
      expect((await api().post('/api/users').set(auth('mgmt')).send({ full_name: 'X Y', email: `${STAMP}.m@arihant.com`, role: 'accounts' })).status).toBe(403);
      expect((await api().patch(`/api/users/${uid.sales}`).set(auth('mgmt')).send({ is_active: false })).status).toBe(403);
      expect((await api().post('/api/masters/zones').set(auth('mgmt')).send({ code: 'ZQ2', name: `${STAMP} zone` })).status).toBe(403);
      expect((await api().post('/api/masters/departments').set(auth('mgmt')).send({ code: `${STAMP}_m`, name: 'X' })).status).toBe(403);
      expect((await api().get('/api/users').set(auth('mgmt'))).status).toBe(200);
      expect((await api().get('/api/masters/departments').set(auth('mgmt'))).status).toBe(200);
    });
  });

  describe('password reset', () => {
    it('the administrator resets a forgotten password: the old one stops working, the one-time one signs in, and it is audited', async () => {
      const email = `${STAMP}.reset@arihant.com`;
      const created = await api().post('/api/users').set(auth('admin')).send({ full_name: 'Reset Tester', email, role: 'accounts' });
      expect(created.status).toBe(201);
      const firstPassword = created.body.temporary_password;

      expect((await api().post(`/api/users/${created.body.id}/reset-password`).set(auth('mgmt'))).status).toBe(403);
      const reset = await api().post(`/api/users/${created.body.id}/reset-password`).set(auth('admin'));
      expect(reset.status).toBe(201);
      expect(reset.body.email).toBe(email);
      expect(reset.body.temporary_password).toBeTruthy();
      expect(reset.body.temporary_password).not.toBe(firstPassword);

      expect((await api().post('/api/auth/login').send({ email, password: firstPassword })).status).toBe(401);
      expect((await api().post('/api/auth/login').send({ email, password: reset.body.temporary_password })).status).toBe(200);

      const entry = await waitFor(async () => (await sql1(`select new_value from audit_log where entity_id = '${created.body.id}' and action = 'password_reset'`))[0]);
      expect(JSON.stringify(entry)).not.toContain(reset.body.temporary_password);
      expect((await api().post('/api/users/00000000-0000-4000-8000-000000000000/reset-password').set(auth('admin'))).status).toBe(404);
    });
  });

  describe('client categories', () => {
    it('the administrator keeps the list: pickers see active ones, a rename follows its customers, one in use cannot be deleted', async () => {
      const name = `${STAMP} Coast Guard`;
      const path = '/api/masters/client-categories';
      expect((await api().post(path).set(auth('mgmt')).send({ name })).status).toBe(403);
      const created = await api().post(path).set(auth('admin')).send({ name, label: 'Coast Guard & Maritime Security', sort_order: 5 });
      expect(created.status).toBe(201);
      expect((await api().post(path).set(auth('admin')).send({ name: name.toUpperCase() })).status).toBe(409);
      expect((await api().get(path).set(auth('sales'))).body.map((c: any) => c.name)).toContain(name);

      const [org] = await sql1(`insert into organisations (name, sector) values ('${STAMP} Org', '${name}') returning id`);
      const renamed = `${name} HQ`;
      expect((await api().patch(`${path}/${created.body.id}`).set(auth('admin')).send({ name: renamed })).status).toBe(200);
      expect((await sql1(`select sector from organisations where id = '${org.id}'`))[0].sector).toBe(renamed);
      expect((await api().delete(`${path}/${created.body.id}`).set(auth('admin'))).status).toBe(409);

      expect((await api().patch(`${path}/${created.body.id}`).set(auth('admin')).send({ is_active: false })).status).toBe(200);
      expect((await api().get(path).set(auth('sales'))).body.map((c: any) => c.name)).not.toContain(renamed);
      const all = (await api().get(path).query({ include_inactive: 'true' }).set(auth('admin'))).body;
      expect(all.find((c: any) => c.name === renamed)).toEqual(expect.objectContaining({ is_active: false, customer_count: 1 }));

      await sql1(`delete from organisations where id = '${org.id}'`);
      expect((await api().delete(`${path}/${created.body.id}`).set(auth('admin'))).status).toBe(200);
    });
  });

  describe('paged master lists', () => {
    it('answer the whole array without page, and one page with its total when asked', async () => {
      const all = (await api().get('/api/masters/regions').set(auth('admin'))).body;
      expect(Array.isArray(all)).toBe(true);
      const paged = (await api().get('/api/masters/regions').query({ page: 1, limit: 2 }).set(auth('admin'))).body;
      expect(paged).toEqual(expect.objectContaining({ page: 1, limit: 2, total: all.length }));
      expect(paged.data).toHaveLength(Math.min(2, all.length));
      const found = (await api().get('/api/masters/regions').query({ page: 1, search: all[0].name }).set(auth('admin'))).body;
      expect(found.data.map((r: any) => r.id)).toContain(all[0].id);
    });
  });

  it('a zone or region still in use cannot be deleted (409, not a database error)', async () => {
    const zone = await sql1(`select z.id from zones z where exists (select 1 from regions r where r.zone_id = z.id) limit 1`);
    const res = await api().delete(`/api/masters/zones/${zone[0].id}`).set(auth('admin'));
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('still in use');
  });
});
