/**
 * Task & blocker regressions found in QA (31-10-2026), plus the permission / state guards that held up.
 * Each test asserts the correct behaviour: data scoping on the dashboard, blocker attribution after reassignment,
 * date bounds, pause credit on admin correction, cancel / reassign never double-counting an accepted blocker,
 * managers deciding (not silently closing) pending blockers, escalation going upward only, and approved-leave
 * blockers crediting only the leave itself (at leave end, or when the leave is cancelled).
 * Uses an isolated temporary team; everything it creates is removed afterwards.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { TASK_DB } from '../src/modules/tasks/task-db';
import { loadTaskConfig } from '../src/modules/tasks/task.config';
import { TaskJobsService } from '../src/modules/tasks/task-jobs.service';
import { TaskMastersService } from '../src/modules/tasks/task-masters.service';
import { todayInKolkata, type Database } from '@arihant/shared';
import { configureApp } from '../src/common/app-setup';

jest.setTimeout(120000);

const today = todayInKolkata();
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('Task & blocker regressions (e2e)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let jobs: TaskJobsService;
  let masters: TaskMastersService;
  type Who = { token: string; id: string };
  const u: Record<string, Who> = {};
  const tempUserIds: string[] = [];
  let tag = '';
  let general = '';
  let deptId = '';

  const http = () => request(app.getHttpServer());
  const bearer = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
  async function login(email: string): Promise<Who> {
    const res = await http().post('/api/auth/login').send({ email, password: 'password123' });
    if (res.status !== 200) throw new Error(`login ${email} → ${res.status}`);
    return { token: res.body.accessToken || res.body.token, id: res.body.user.id };
  }
  const get = (w: Who, id: string) => http().get(`/api/tasks/${id}`).set(bearer(w));
  const version = async (id: string) => (await get(u.admin, id)).body.version;
  const act = async (w: Who, id: string, action: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/tasks/${id}/${action}`).set(bearer(w)).send({ version: await version(id), ...body });
  async function one(by: Who, assignee: Who, body: Record<string, unknown> = {}) {
    const res = await http().post('/api/tasks').set(bearer(by)).send({ title: 'Regression task', category_id: general, deadline: day(3), assignee_ids: [assignee.id], ...body });
    if (res.status !== 201) throw new Error(`create → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data[0].id as string;
  }
  const raise = async (w: Who, taskId: string, body: Record<string, unknown>) =>
    http().post(`/api/tasks/${taskId}/blockers`).set(bearer(w)).send({ version: await version(taskId), ...body });
  const openBlockerId = async (taskId: string) => (await get(u.admin, taskId)).body.blockers.find((x: any) => x.open)?.id as string;
  const decideById = async (w: Who, blockerId: string, taskId: string, decision: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/task-blockers/${blockerId}/${decision}`).set(bearer(w)).send({ version: await version(taskId), ...body });
  const decide = async (w: Who, taskId: string, decision: string, body: Record<string, unknown> = {}) => decideById(w, await openBlockerId(taskId), taskId, decision, body);
  /** Moves history the API never lets us set (an older raise, past leave dates), bypassing the history triggers. */
  const rewrite = (table: 'task_blockers' | 'employee_leaves', id: string, set: Record<string, unknown>) =>
    db.connection().execute(async (c) => {
      await sql`set session_replication_role = replica`.execute(c);
      await c.updateTable(table).set(set as any).where('id', '=', id).execute();
      await sql`set session_replication_role = default`.execute(c);
    });
  const backdateBlocker = (blockerId: string, days: number) => rewrite('task_blockers', blockerId, { created_at: sql`now() - make_interval(days => ${days})` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleFixture.get<Kysely<Database>>(TASK_DB);
    jobs = moduleFixture.get(TaskJobsService);
    masters = moduleFixture.get(TaskMastersService);

    for (const [k, e] of Object.entries({ mgmt: 'mgmt@arihant.com', admin: 'admin@arihant.com', accounts: 'accounts@arihant.com' })) u[k] = await login(e);
    const hash = await bcrypt.hash('password123', 10);
    const names = ['mgr', 'mgr2', 'head', 'e1', 'e2', 'e3', 'ra', 'rb', 'out', 'lv1', 'lv2', 'lv3'] as const;
    const ids = Object.fromEntries(names.map((n) => [n, randomUUID()])) as Record<(typeof names)[number], string>;
    tempUserIds.push(...Object.values(ids));
    tag = ids.mgr.slice(0, 6);
    const people: [keyof typeof ids, string, string | null][] = [
      ['mgr', 'regional_manager', u.mgmt.id],
      ['mgr2', 'regional_manager', u.mgmt.id],
      ['head', 'regional_manager', u.mgmt.id],
      ['e1', 'sales', ids.mgr],
      ['e2', 'sales', ids.mgr],
      ['e3', 'sales', ids.mgr],
      ['ra', 'sales', ids.mgr],
      ['rb', 'sales', ids.mgr],
      ['out', 'sales', ids.mgr2],
      ['lv1', 'sales', ids.mgr],
      ['lv2', 'sales', ids.mgr],
      ['lv3', 'sales', ids.mgr],
    ];
    for (const [k, role, manager] of people) {
      await db.insertInto('users').values({ id: ids[k], full_name: `BlkQa ${k}`, email: `blkqa.${k}.${tag}@test.local`, role, reporting_manager_id: manager, password_hash: hash } as any).execute();
    }
    for (const [k] of people) u[k] = await login(`blkqa.${k}.${tag}@test.local`);
    // The manager sits in a department whose head is above them but has no line authority over the team's work.
    deptId = randomUUID();
    await db.insertInto('departments').values({ id: deptId, code: `BLKQA-${tag}`, name: `BlkQa dept ${tag}`, head_user_id: ids.head } as any).execute();
    await db.updateTable('users').set({ department_id: deptId } as any).where('id', '=', ids.mgr).execute();
    general = (await http().get('/api/task-categories').set(bearer(u.e1))).body.find((c: any) => c.code === 'GENERAL').id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (db && tempUserIds.length) {
      const storage = loadTaskConfig().storageDir;
      await db.connection().execute(async (conn) => {
        await sql`set session_replication_role = replica`.execute(conn);
        const tasks = (await conn.selectFrom('tasks').select('id').where((eb) => eb.or([eb('assigned_to', 'in', tempUserIds), eb('created_by', 'in', tempUserIds), eb('assigned_by', 'in', tempUserIds)])).execute()).map((t) => t.id);
        const historical = (await conn.selectFrom('task_assignment_history').select('task_id').where('from_user_id', 'in', tempUserIds).execute()).map((r) => r.task_id);
        const all = Array.from(new Set([...tasks, ...historical]));
        if (all.length) {
          const files = await conn.selectFrom('task_attachments').select('storage_key').where('task_id', 'in', all).execute();
          for (const f of files) fs.rmSync(path.join(storage, f.storage_key), { force: true });
          for (const t of ['task_attachments', 'task_updates', 'task_deadline_changes', 'task_assignment_history', 'task_escalations', 'task_blockers'] as const) {
            await conn.deleteFrom(t).where('task_id', 'in', all).execute();
          }
          await conn.deleteFrom('task_notification_log').where('task_id', 'in', all).execute();
          await conn.deleteFrom('notifications').where('entity_id', 'in', all).execute();
          await conn.deleteFrom('tasks').where('id', 'in', all).execute();
        }
        await conn.deleteFrom('employee_leaves').where('employee_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('task_notification_log').where('user_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('notifications').where('user_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('audit_log').where('actor_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('users').where('id', 'in', tempUserIds).execute();
        if (deptId) await conn.deleteFrom('departments').where('id', '=', deptId).execute();
        await sql`set session_replication_role = default`.execute(conn);
      });
    }
    await app?.close();
  });

  // ------------------------------------------------------------------ data scoping
  it('the dashboard never shows another team’s blocker text', async () => {
    const secret = `LEAKCHECK-${tag} customer drawing not shared`;
    const id = await one(u.mgr, u.e1);
    expect((await raise(u.e1, id, { blocker_type: 'missing_information', description: secret })).status).toBe(201);
    expect((await get(u.out, id)).status).toBe(404);
    const leaked = async (w: Who) => {
      const m = await http().get('/api/dashboard/metrics').set(bearer(w));
      expect(m.status).toBe(200);
      return (m.body.recentExceptions || []).some((e: any) => JSON.stringify(e).includes(`LEAKCHECK-${tag}`));
    };
    expect(await leaked(u.out)).toBe(false);
    expect(await leaked(u.mgr)).toBe(true); // the manager still sees their own team's blocker
  });

  // ------------------------------------------------------------------ attribution
  it('a blocker counts against whoever raised it, not the person the task is reassigned to', async () => {
    const id = await one(u.mgr, u.ra, { deadline: day(5) });
    await act(u.ra, id, 'start');
    expect((await raise(u.ra, id, { blocker_type: 'technical_issue', description: 'Laptop was slow for a couple of hours today' })).status).toBe(201);
    expect((await decide(u.mgr, id, 'reject', { comment: 'Not a blocker, use the office desktop' })).status).toBe(200);
    expect((await act(u.mgr, id, 'reassign', { to_user_id: u.rb.id, reason: 'Workload balancing across the team', reason_type: 'workload' })).status).toBe(200);
    const range = { from: day(-30), to: day(30) };
    const dash = (await http().get('/api/accountability/dashboard').query(range).set(bearer(u.mgr))).body;
    const row = (who: Who) => dash.employees.find((e: any) => e.employee_id === who.id);
    expect({ rejected: row(u.ra).rejected_blockers, unapproved: row(u.ra).unapproved_delays }).toEqual({ rejected: 1, unapproved: 1 });
    expect({ rejected: row(u.rb).rejected_blockers, unapproved: row(u.rb).unapproved_delays }).toEqual({ rejected: 0, unapproved: 0 });
    const flags = (await http().get('/api/accountability/flags').query({ type: 'rejected_blocker' }).set(bearer(u.mgr))).body;
    expect(flags.rejected_blocker.filter((b: any) => b.task_id === id).map((b: any) => b.assigned_to)).toEqual([u.ra.id]);
    const ev = async (who: Who) => (await http().get('/api/performance/evidence').query({ employee_id: who.id, ...range }).set(bearer(u.mgr))).body.blockers;
    expect(await ev(u.ra)).toMatchObject({ raised: 1, rejected: 1 });
    expect(await ev(u.rb)).toMatchObject({ raised: 0, rejected: 0 });
  });

  // ------------------------------------------------------------------ input bounds
  it('a far-future deadline is a validation error, never a 500', async () => {
    const id = await one(u.mgr, u.e1);
    await raise(u.e1, id, { blocker_type: 'vendor_dependency', vendor_name: 'Acme', description: 'Vendor has not confirmed the delivery slot' });
    const acc = await decide(u.mgr, id, 'accept', { mode: 'extend', new_deadline: '9999-12-31', comment: 'Vendor shutdown indefinite' });
    expect(acc.status).toBe(400);
    expect(acc.body.errors.new_deadline).toMatch(/within the next 10 years/);
    const id2 = await one(u.mgr, u.e1);
    expect((await act(u.mgr, id2, 'extend-deadline', { new_deadline: '9999-12-31', reason: 'Project postponed indefinitely' })).status).toBe(400);
    expect((await http().post('/api/tasks').set(bearer(u.mgr)).send({ title: 'x', category_id: general, deadline: '9999-12-31', assignee_ids: [u.e1.id] })).status).toBe(400);
  });

  it('malformed ids and odd payloads are 4xx, never 500; version must be a number', async () => {
    const id = await one(u.mgr, u.e1);
    const r: Record<string, number> = {};
    r.blk_bad = (await http().post('/api/task-blockers/not-a-uuid/accept').set(bearer(u.mgr)).send({ version: 1 })).status;
    r.blk_unknown = (await http().post(`/api/task-blockers/${randomUUID()}/accept`).set(bearer(u.mgr)).send({ version: 1 })).status;
    r.task_bad_raise = (await http().post('/api/tasks/xyz/blockers').set(bearer(u.e1)).send({ version: 1 })).status;
    r.esc_bad = (await http().post('/api/task-escalations/xyz/close').set(bearer(u.mgr)).send({ comment: 'whatever text' })).status;
    r.version_obj = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: { a: 1 }, blocker_type: 'technical_issue', description: 'Printer is jammed for the whole day' })).status;
    r.desc_obj = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: 1, blocker_type: 'technical_issue', description: { x: 'Printer is jammed for the whole day' } })).status;
    r.dep_bad_uuid = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: 1, blocker_type: 'another_employee', dependency_user_id: 'abc', description: 'Waiting for someone to send it' })).status;
    r.leave_unknown = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: 1, blocker_type: 'approved_leave', leave_id: randomUUID(), description: 'On leave for the next two days' })).status;
    r.expected_bad_date = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: 1, blocker_type: 'technical_issue', expected_resolution_date: '2026-02-30', description: 'Printer is jammed for the whole day' })).status;
    r.req_deadline_far = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: 1, blocker_type: 'technical_issue', requested_new_deadline: '275760-09-13', description: 'Printer is jammed for the whole day' })).status;
    r.huge_desc = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: 1, blocker_type: 'technical_issue', description: 'x'.repeat(5000) })).status;
    r.version_true = (await http().post(`/api/tasks/${id}/blockers`).set(bearer(u.e1)).send({ version: true, blocker_type: 'technical_issue', description: 'Printer jammed for the whole day' })).status;
    expect(Object.entries(r).filter(([, s]) => s < 400 || s >= 500)).toEqual([]);
  });

  // ------------------------------------------------------------------ closing an open blocker
  it('admin correction credits an accepted PAUSE blocker’s blocked time exactly like a resolve', async () => {
    const mk = async () => {
      const id = await one(u.mgr, u.e2, { deadline: day(3) });
      await act(u.e2, id, 'start');
      await raise(u.e2, id, { blocker_type: 'missing_information', description: 'Site drawings not shared by the customer yet' });
      expect((await decide(u.mgr, id, 'accept', { mode: 'pause', comment: 'Customer confirmed the delay' })).status).toBe(200);
      await backdateBlocker(await openBlockerId(id), 2);
      return { id, before: new Date((await get(u.admin, id)).body.deadline).getTime() };
    };
    const shift = (before: number, after: string) => (new Date(after).getTime() - before) / 60000;
    const control = await mk();
    const resolved = await decide(u.e2, control.id, 'resolve', { note: 'Drawings received this morning' });
    expect(shift(control.before, resolved.body.deadline)).toBeGreaterThanOrEqual(2880);

    const corr = await mk();
    const fixed = await act(u.admin, corr.id, 'correction', { status: 'in_progress', reason: 'Fixing a stuck blocked status' });
    expect(fixed.status).toBe(200);
    expect(shift(corr.before, fixed.body.deadline)).toBeGreaterThanOrEqual(2880);
    expect(fixed.body.blockers[0]).toMatchObject({ status: 'resolved', excused_minutes: expect.any(Number) });
    expect(fixed.body.blockers[0].excused_minutes).toBeGreaterThanOrEqual(2880);
    expect(fixed.body.deadline_changes.map((c: any) => c.source)).toContain('pause_resume');
  });

  it('cancelling a task closes an ACCEPTED blocker as resolved (counted once), a pending one as withdrawn', async () => {
    const id = await one(u.mgr, u.e3, { deadline: day(4) });
    await raise(u.e3, id, { blocker_type: 'external_portal_issue', portal_name: 'GeM', description: 'GeM portal is down for scheduled maintenance' });
    expect((await decide(u.mgr, id, 'accept', { mode: 'pause', comment: 'Portal outage confirmed' })).status).toBe(200);
    const c = await act(u.mgr, id, 'cancel', { reason: 'Customer dropped the requirement' });
    expect(c.body.blockers[0]).toMatchObject({ status: 'resolved', decision: 'accept_pause' });
    const pending = await one(u.mgr, u.e3, { deadline: day(4) });
    await raise(u.e3, pending, { blocker_type: 'technical_issue', description: 'Printer is jammed for the whole day' });
    expect((await act(u.mgr, pending, 'cancel', { reason: 'Customer dropped the requirement' })).body.blockers[0].status).toBe('withdrawn');
    const ev = (await http().get('/api/performance/evidence').query({ employee_id: u.e3.id, from: day(-30), to: day(30) }).set(bearer(u.mgr))).body.blockers;
    expect(ev).toMatchObject({ raised: 2, accepted: 1, withdrawn: 1 });
  });

  it('a manager accepts or rejects a pending blocker — they cannot close it undecided', async () => {
    const id = await one(u.mgr, u.e1);
    await raise(u.e1, id, { blocker_type: 'technical_issue', description: 'CRM export keeps timing out on the BOQ' });
    const bid = await openBlockerId(id);
    expect((await decideById(u.mgr, bid, id, 'withdraw', {})).status).toBe(403);
    expect((await decideById(u.mgr, bid, id, 'resolve', { note: 'Closing this myself without a decision' })).status).toBe(403);
    expect((await get(u.mgr, id)).body.allowed_actions).not.toContain('resolve_blocker');
    // the employee may still drop their own pending blocker
    expect((await decideById(u.e1, bid, id, 'resolve', { note: 'Export worked after a restart' })).body.blockers[0].status).toBe('withdrawn');
  });

  // ------------------------------------------------------------------ guards that held
  it('escalation goes upward only; its powers end when it is closed; the line manager keeps theirs', async () => {
    const id = await one(u.mgr, u.e1);
    await raise(u.e1, id, { blocker_type: 'another_employee', dependency_user_id: u.e2.id, description: 'Waiting for E2 to share the pricing sheet' });
    const bid = await openBlockerId(id);
    const escalateTo = async (to: Who) => act(u.mgr, id, 'escalate', { to_user_id: to.id, reason: 'Above my approval limit' });
    // A peer manager, the colleague the blocker waits on, and a junior are all refused.
    expect({ peer: (await escalateTo(u.mgr2)).status, dependency: (await escalateTo(u.e2)).status, junior: (await escalateTo(u.e3)).status }).toEqual({ peer: 400, dependency: 400, junior: 400 });
    const targets = (await http().get(`/api/tasks/${id}/escalation-targets`).set(bearer(u.mgr))).body.map((t: any) => t.id);
    expect(targets).toEqual(expect.arrayContaining([u.head.id, u.mgmt.id]));
    expect(targets.filter((t: string) => [u.mgr2.id, u.e2.id, u.e3.id, u.e1.id].includes(t))).toEqual([]);
    // The head of the manager's department has no say over this task until it is escalated to them.
    expect((await decideById(u.head, bid, id, 'accept', { mode: 'pause', comment: 'before escalation' })).status).toBe(404);
    const e = await escalateTo(u.head);
    expect(e.status).toBe(200);
    const inQueue = async (w: Who) => (await http().get('/api/task-blockers/pending').set(bearer(w))).body.some((b: any) => b.id === bid);
    expect(await inQueue(u.head)).toBe(true);
    expect((await http().post(`/api/task-escalations/${e.body.escalations[0].id}/close`).set(bearer(u.head)).send({ comment: 'Handing back to the line manager' })).status).toBe(200);
    expect(await inQueue(u.head)).toBe(false);
    expect((await decideById(u.head, bid, id, 'accept', { mode: 'pause', comment: 'Late decision after close' })).status).toBe(403);
    expect(await inQueue(u.mgr)).toBe(true);
  });

  it('only the reviewing manager decides; queues are never widened', async () => {
    const id = await one(u.mgr, u.e1);
    await raise(u.e1, id, { blocker_type: 'another_employee', dependency_user_id: u.e2.id, description: 'Waiting for E2 to share the pricing sheet' });
    const bid = await openBlockerId(id);
    const res: Record<string, number> = {};
    res.accounts_accept = (await decideById(u.accounts, bid, id, 'accept', { mode: 'pause', comment: 'accounts tries' })).status;
    res.dep_accept = (await decideById(u.e2, bid, id, 'accept', { mode: 'pause', comment: 'dependency tries' })).status;
    res.dep_resolve = (await decideById(u.e2, bid, id, 'resolve', { note: 'dependency resolves' })).status;
    res.dep_withdraw = (await decideById(u.e2, bid, id, 'withdraw', {})).status;
    res.out_accept = (await decideById(u.out, bid, id, 'accept', { mode: 'pause', comment: 'outsider tries' })).status;
    res.peer_accept = (await decideById(u.e3, bid, id, 'accept', { mode: 'pause', comment: 'peer tries' })).status;
    res.other_mgr_accept = (await decideById(u.mgr2, bid, id, 'accept', { mode: 'pause', comment: 'other manager tries' })).status;
    res.self_accept = (await decideById(u.e1, bid, id, 'accept', { mode: 'pause', comment: 'self tries' })).status;
    expect(res).toEqual({ accounts_accept: 403, dep_accept: 403, dep_resolve: 403, dep_withdraw: 403, out_accept: 404, peer_accept: 404, other_mgr_accept: 404, self_accept: 403 });
    const pending = async (w: Who) => (await http().get('/api/task-blockers/pending').query({ scope: 'all' }).set(bearer(w))).body.some((b: any) => b.id === bid);
    expect({ employee: await pending(u.e1), otherManager: await pending(u.mgr2) }).toEqual({ employee: false, otherManager: false });
    expect((await http().get('/api/task-blockers/waiting-on-me').set(bearer(u.out))).body).toEqual([]);
  });

  it('state edges: raise on awaiting approval / cancelled, a decision race, deciding after cancel', async () => {
    const aw = await one(u.mgr, u.e1, { approval_required: true });
    await act(u.e1, aw, 'complete', { remarks: 'Work handed in for review' });
    expect((await raise(u.e1, aw, { blocker_type: 'technical_issue', description: 'Printer is jammed for the whole day' })).status).toBe(409);
    const race = await one(u.mgr, u.e1);
    await raise(u.e1, race, { blocker_type: 'technical_issue', description: 'Printer is jammed for the whole day' });
    const bid = await openBlockerId(race);
    const v = await version(race);
    const [a1, a2] = await Promise.all([
      http().post(`/api/task-blockers/${bid}/accept`).set(bearer(u.mgr)).send({ version: v, mode: 'pause', comment: 'first accept' }),
      http().post(`/api/task-blockers/${bid}/reject`).set(bearer(u.mgmt)).send({ version: v, comment: 'second decision' }),
    ]);
    expect([a1.status, a2.status].sort()).toEqual([200, 409]);
    const cx = await one(u.mgr, u.e1);
    await raise(u.e1, cx, { blocker_type: 'technical_issue', description: 'Printer is jammed for the whole day' });
    const cbid = await openBlockerId(cx);
    await act(u.mgr, cx, 'cancel', { reason: 'Requirement dropped by customer' });
    expect((await decideById(u.mgr, cbid, cx, 'accept', { mode: 'pause', comment: 'late accept' })).status).toBe(409);
    expect((await decideById(u.e1, cbid, cx, 'withdraw', {})).status).toBe(409);
    expect((await raise(u.e1, cx, { blocker_type: 'technical_issue', description: 'Printer is jammed for the whole day' })).status).toBe(409);
  });

  // ------------------------------------------------------------------ approved leave + end-of-leave job
  it('cancelling a leave closes its blocker at once, crediting only leave already taken', async () => {
    const l1 = await http().post('/api/task-calendar/leaves').set(bearer(u.mgr)).send({ employee_id: u.lv1.id, from_date: day(0), to_date: day(2), leave_type: 'casual' });
    expect(l1.status).toBe(201);
    const t1 = await one(u.mgr, u.lv1, { deadline: day(5) });
    await act(u.lv1, t1, 'start');
    const raised = await raise(u.lv1, t1, { blocker_type: 'approved_leave', description: 'On approved casual leave for the next three days' });
    expect(raised.body.open_blocker.status).toBe('accepted');
    expect({ from: raised.body.blockers[0].leave_from, to: raised.body.blockers[0].leave_to }).toEqual({ from: day(0), to: day(2) });
    // The leave actually began yesterday and the blocker was raised the day before; today the employee is back.
    await rewrite('employee_leaves', l1.body.id, { from_date: day(-1) });
    await backdateBlocker(await openBlockerId(t1), 2);
    const before = new Date((await get(u.admin, t1)).body.deadline).getTime();
    expect((await http().post(`/api/task-calendar/leaves/${l1.body.id}/cancel`).set(bearer(u.mgr)).send({ reason: 'Employee came back to work early' })).status).toBe(200);
    const after = (await get(u.admin, t1)).body;
    expect(after).toMatchObject({ status: 'in_progress', open_blocker: null });
    const credit = after.blockers[0].excused_minutes;
    expect(after.blockers[0].status).toBe('resolved');
    expect(credit).toBeGreaterThanOrEqual(1440); // yesterday's leave day and today so far — not the day before the leave
    expect(credit).toBeLessThan(2880);
    expect(Math.round((new Date(after.deadline).getTime() - before) / 60000)).toBe(credit);
  });

  it('end of leave: a future leave credits only the leave days; an EXTEND decision is not credited again', async () => {
    // Raised two days before a two-day leave.
    const l2 = await http().post('/api/task-calendar/leaves').set(bearer(u.mgr)).send({ employee_id: u.lv2.id, from_date: day(2), to_date: day(3), leave_type: 'casual' });
    expect(l2.status).toBe(201);
    const t2 = await one(u.mgr, u.lv2, { deadline: day(6) });
    await act(u.lv2, t2, 'start');
    expect((await raise(u.lv2, t2, { blocker_type: 'approved_leave', description: 'Going on approved leave the day after tomorrow' })).body.open_blocker.status).toBe('accepted');

    // Auto-accept off for this one (in-process only): the manager accepts with a new deadline instead.
    const orig = masters.settings.bind(masters);
    const spy = jest.spyOn(masters, 'settings').mockImplementation(async (fresh?: boolean) => ({ ...(await orig(fresh)), auto_accept_leave_blockers: false }));
    const l3 = await http().post('/api/task-calendar/leaves').set(bearer(u.mgr)).send({ employee_id: u.lv3.id, from_date: day(0), to_date: day(1), leave_type: 'casual' });
    expect(l3.status).toBe(201);
    const t3 = await one(u.mgr, u.lv3, { deadline: day(3) });
    await act(u.lv3, t3, 'start');
    await raise(u.lv3, t3, { blocker_type: 'approved_leave', description: 'On approved casual leave today and tomorrow' });
    expect((await decide(u.mgr, t3, 'accept', { mode: 'extend', new_deadline: day(10), comment: 'Leave plus buffer, new deadline set' })).status).toBe(200);
    spy.mockRestore();

    // Time passes: both leaves are over (t2's blocker was raised two days before its leave began).
    await backdateBlocker(await openBlockerId(t2), 4);
    await rewrite('employee_leaves', l2.body.id, { from_date: day(-2), to_date: day(-1) });
    await backdateBlocker(await openBlockerId(t3), 2);
    await rewrite('employee_leaves', l3.body.id, { from_date: day(-2), to_date: day(-1) });
    const before = { t2: (await get(u.admin, t2)).body, t3: (await get(u.admin, t3)).body };
    await (jobs as any).closeEndedLeaveBlockers();
    const after = { t2: (await get(u.admin, t2)).body, t3: (await get(u.admin, t3)).body };
    const shift = (k: 't2' | 't3') => Math.round((new Date(after[k].deadline).getTime() - new Date(before[k].deadline).getTime()) / 60000);
    expect(shift('t2')).toBeGreaterThanOrEqual(2879); // the two leave days (to 23:59:59 IST), not the four days since the raise
    expect(shift('t2')).toBeLessThanOrEqual(2880);
    expect(shift('t3')).toBe(0);
    expect(after.t3.excused_delay_minutes).toBe(before.t3.excused_delay_minutes);
    expect({ t2: after.t2.blockers[0].status, t3: after.t3.blockers[0].status }).toEqual({ t2: 'resolved', t3: 'resolved' });
  });
});
