import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'crypto';
import { todayInKolkata } from '@arihant/shared';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';

/**
 * Role desks (GET /api/dashboard/workspace): every Tasks / Expenses figure equals the list its tile opens, with the
 * filters the page sends (apps/web dashboard `LINK`). Records are seeded so each figure has something behind it,
 * including the cases that used to diverge: a report's claim another manager approves, a rep who approves a team
 * claim, a task waiting for sign-off.
 */
describe('Role dashboards — Tasks & Expenses figures equal the lists they open', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());
  const q = async (text: string) => (await sql.raw(text).execute(db)).rows as any[];
  const STAMP = `zzrd${Date.now()}`;
  const ids: Record<string, string[]> = {};
  const s = (v: string) => `'${v}'`;
  const ins = async (table: string, cols: Record<string, string | null>) => {
    const id = randomUUID();
    (ids[table] ||= []).push(id);
    const keys = ['id', ...Object.keys(cols)];
    const vals = [`'${id}'`, ...Object.values(cols).map((v) => (v === null ? 'null' : v))];
    await q(`insert into ${table} (${keys.join(', ')}) values (${vals.join(', ')})`);
    return id;
  };
  const LIVE = 'submitted,manager_approved,accounts_review,accounts_approved,clarification_required';
  const BOARD_OPEN = 'not_started,in_progress,blocked,awaiting_approval';
  const monthStart = `${todayInKolkata().slice(0, 8)}01`;
  const seeded: Record<string, string> = {};

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken || r.body.token;
    uid[key] = r.body.user.id;
  }
  const desk = async (who: string) => {
    const r = await api().get('/api/dashboard/workspace').set(auth(who));
    expect(r.status).toBe(200);
    return r.body;
  };
  /** A list as the caller, with the query a dashboard link carries. */
  const list = async (path: string, query: Record<string, any>, who: string) => {
    const r = await api().get(`/api/${path}`).query({ ...query, page_size: 100 }).set(auth(who));
    expect(r.status).toBe(200);
    return { total: r.body.total as number, ids: (r.body.data as any[]).map((x) => x.id as string), rows: r.body.data as any[] };
  };
  const claim = (key: string, employee: string, status: string, cols: Record<string, string | null> = {}) =>
    ins('expense_claims', {
      claim_number: s(`${STAMP}-${key}`),
      employee_id: s(employee),
      title: s(`${STAMP} ${key}`),
      status: s(status),
      total_claimed: '1000',
      submitted_at: status === 'draft' ? null : 'now()',
      ...cols,
    }).then((id) => (seeded[key] = id));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(KYSELY_DB);
    for (const [k, email] of Object.entries({
      mgmt: 'mgmt@arihant.com', rmN: 'regmgr.north@arihant.com', sales: 'sales.delhi@arihant.com',
      accounts: 'accounts@arihant.com', tender: 'tender@arihant.com',
    })) await login(k, email);

    // the rep reports to the North manager; the seed relies on that reporting line
    expect((await q(`select reporting_manager_id from users where id = '${uid.sales}'`))[0].reporting_manager_id).toBe(uid.rmN);

    await claim('toRm', uid.sales, 'submitted', { manager_id: s(uid.rmN) });
    await claim('toMgmt', uid.sales, 'submitted', { manager_id: s(uid.mgmt) }); // reporting line, but another approver
    await claim('clarify', uid.sales, 'clarification_required', { manager_id: s(uid.rmN) });
    await claim('draft', uid.sales, 'draft');
    await claim('review', uid.sales, 'accounts_review', { manager_id: s(uid.rmN), manager_actioned_at: 'now()' });
    await claim('toPay', uid.sales, 'accounts_approved', { manager_id: s(uid.rmN), accounts_actioned_at: 'now()' });
    await claim('paid', uid.sales, 'processed', {
      manager_id: s(uid.rmN), accounts_actioned_at: 'now()', processed_at: 'now()', tally_voucher_ref: s(`${STAMP}-TALLY`),
    });
    await claim('team', uid.tender, 'submitted', { manager_id: s(uid.sales) }); // the rep approves this one

    const category = (await q(`select id from task_categories limit 1`))[0].id;
    const task = (key: string, status: string) =>
      ins('tasks', { title: s(`${STAMP} ${key}`), category_id: s(category), status: s(status), assigned_to: s(uid.sales), assigned_by: s(uid.rmN) }).then(
        (id) => (seeded[key] = id),
      );
    await task('signoff', 'awaiting_approval');
    await task('stuck', 'in_progress');
    seeded.blocker = await ins('task_blockers', {
      task_id: s(seeded.stuck),
      blocker_type: s('customer_dependency'),
      description: s(`${STAMP} waiting on the customer`),
      status: s('pending_review'),
      raised_by: s(uid.sales),
    });
  });

  afterAll(async () => {
    const del = async (table: string) => ids[table]?.length && (await q(`delete from ${table} where id in (${ids[table].map((i) => `'${i}'`).join(',')})`));
    for (const t of ['task_blockers', 'tasks', 'expense_claims']) await del(t);
    await app.close();
  });

  it('regional manager: stage-1 approvals are the claims they approve (approver=me)', async () => {
    const n = (await desk('rmN')).numbers;
    // as the Expenses page sends it for this role: its links stay inside the claims that concern the user
    const l = await list('expense-claims', { approver: 'me', statuses: 'submitted', relevant_only: 'true' }, 'rmN');
    expect(n.stage1Pending).toBe(l.total);
    expect(l.ids).toContain(seeded.toRm);
    expect(l.ids).not.toContain(seeded.toMgmt); // their report's claim, but the management approver decides it
  });

  it('regional manager: blockers to review are the Blocker reviews queue', async () => {
    const body = await desk('rmN');
    const queue = await api().get('/api/task-blockers/pending').query({ page_size: 100 }).set(auth('rmN'));
    expect(queue.status).toBe(200);
    expect(body.numbers.blockersToReview).toBe(queue.body.total);
    const queued = queue.body.data.map((b: any) => b.id);
    expect(queued).toContain(seeded.blocker);
    for (const it of body.lists.blockers) expect(queued).toContain(it.id);
  });

  it('sales: open tasks are the My tasks "All open" tab, sign-off included', async () => {
    const n = (await desk('sales')).numbers;
    const l = await list('tasks', { view: 'mine', statuses: BOARD_OPEN }, 'sales');
    expect(n.tasksOpen).toBe(l.total);
    expect(l.ids).toEqual(expect.arrayContaining([seeded.signoff, seeded.stuck]));
  });

  it('sales: expense claims in approval are their own live claims (mine=true), not the team claim they approve', async () => {
    const n = (await desk('sales')).numbers;
    const l = await list('expense-claims', { mine: 'true', statuses: LIVE, relevant_only: 'true' }, 'sales');
    expect(n.claimsLive).toBe(l.total);
    expect(l.ids).toEqual(expect.arrayContaining([seeded.toRm, seeded.toMgmt, seeded.clarify, seeded.review, seeded.toPay]));
    for (const k of ['team', 'draft', 'paid']) expect(l.ids).not.toContain(seeded[k]);
  });

  // Accounts' links list every claim Accounts may read (no relevant_only): another accountant's paid claims count too
  it('accounts: stage 2, to pay and paid this month are the exact-status lists', async () => {
    const n = (await desk('accounts')).numbers;
    const stage2 = await list('expense-claims', { statuses: 'manager_approved,accounts_review' }, 'accounts');
    expect(n.stage2Pending).toBe(stage2.total);
    expect(stage2.ids).toContain(seeded.review);
    const toPay = await list('expense-claims', { statuses: 'accounts_approved' }, 'accounts');
    expect(n.awaitingPayment).toBe(toPay.total);
    expect(toPay.ids).toContain(seeded.toPay);
    const paid = await list('expense-claims', { statuses: 'processed', date_field: 'processed_at', date_from: monthStart }, 'accounts');
    expect(n.settledThisMonth).toBe(paid.total);
    expect(paid.ids).toContain(seeded.paid);
  });

  it('an exact-status list (no relevant_only) never reaches past the caller’s read scope', async () => {
    // the rep sees their own claims, the ones they approve and their direct reports' — never anyone else's
    const reports = new Set((await q(`select id from users where reporting_manager_id = '${uid.sales}'`)).map((r) => r.id));
    const l = await list('expense-claims', { statuses: LIVE }, 'sales');
    for (const c of l.rows) expect(c.employee_id === uid.sales || c.manager_id === uid.sales || reports.has(c.employee_id)).toBe(true);
    expect(l.ids).toContain(seeded.team);
    const mine = await list('expense-claims', { approver: 'me', statuses: 'submitted' }, 'sales');
    expect(mine.ids).toContain(seeded.team);
    for (const c of mine.rows) expect(c.manager_id).toBe(uid.sales);
  });

  it('rejects an unknown date field and a bad idle-days value', async () => {
    for (const query of [{ date_field: 'paid_on' }, { draft_idle_days: 'abc' }, { draft_idle_days: '0' }]) {
      expect((await api().get('/api/expense-claims').query(query).set(auth('mgmt'))).status).toBe(400);
    }
  });
});
