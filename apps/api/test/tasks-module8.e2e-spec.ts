/**
 * Module 8 — Task & Productivity Management, end to end over HTTP against the local database.
 * Uses an isolated temporary team (manager + two employees, plus a second manager) so seed data is untouched.
 * Covers the happy path, approval/rework loop, blockers (accept extend/pause, reject, resolve, withdraw,
 * approved leave), escalation, reassignment, recurring generation run twice + catch-up, manager change
 * re-routing, deactivation, role scoping (no leakage via query params), optimistic locking, validation,
 * jobs idempotency, evidence snapshot immutability and the 15-minute delete window.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { TASK_DB } from '../src/modules/tasks/task-db';
import { TaskJobsService } from '../src/modules/tasks/task-jobs.service';
import { TaskGeneratorService } from '../src/modules/tasks/task-generator.service';
import { loadTaskConfig } from '../src/modules/tasks/task.config';
import { todayInKolkata, type Database } from '@arihant/shared';

jest.setTimeout(90000);

const today = todayInKolkata();
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]);

describe('Module 8 — Task & Productivity Management (e2e)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let jobs: TaskJobsService;
  let generator: TaskGeneratorService;
  type Who = { token: string; id: string };
  const u: Record<string, Who> = {};
  const tempUserIds: string[] = [];
  let general = '';
  let customerCat = '';
  let tenderCat = '';
  let customerId = '';

  const http = () => request(app.getHttpServer());
  const bearer = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
  async function login(email: string): Promise<Who> {
    const res = await http().post('/api/auth/login').send({ email, password: 'password123' });
    if (res.status !== 200) throw new Error(`login ${email} → ${res.status}`);
    return { token: res.body.accessToken || res.body.token, id: res.body.user.id };
  }
  const get = (w: Who, id: string) => http().get(`/api/tasks/${id}`).set(bearer(w));
  const version = async (w: Who, id: string) => (await get(w, id)).body.version;
  const act = async (w: Who, id: string, action: string, body: Record<string, unknown> = {}, as: Who = w) =>
    http().post(`/api/tasks/${id}/${action}`).set(bearer(w)).send({ version: await version(as, id), ...body });
  async function create(w: Who, body: Record<string, unknown>) {
    const res = await http().post('/api/tasks').set(bearer(w)).send({ title: 'E2E task', category_id: general, deadline: day(3), ...body });
    if (res.status !== 201) throw new Error(`create → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
  const one = async (w: Who, body: Record<string, unknown> = {}) => (await create(w, { assignee_ids: [u.e1.id], ...body })).data[0].id as string;
  async function blocker(w: Who, taskId: string, body: Record<string, unknown>) {
    return http().post(`/api/tasks/${taskId}/blockers`).set(bearer(w)).send({ version: await version(w, taskId), ...body });
  }
  async function decide(w: Who, taskId: string, decision: string, body: Record<string, unknown> = {}) {
    const d = (await get(w, taskId)).body;
    const b = d.blockers.find((x: any) => x.open);
    return http().post(`/api/task-blockers/${b.id}/${decision}`).set(bearer(w)).send({ version: d.version, ...body });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    db = moduleFixture.get<Kysely<Database>>(TASK_DB);
    jobs = moduleFixture.get(TaskJobsService);
    generator = moduleFixture.get(TaskGeneratorService);

    for (const [k, e] of Object.entries({ mgmt: 'mgmt@arihant.com', admin: 'admin@arihant.com', outsider: 'sales.kolkata@arihant.com', accounts: 'accounts@arihant.com' })) u[k] = await login(e);
    const hash = await bcrypt.hash('password123', 10);
    const ids = { mgr: randomUUID(), mgr2: randomUUID(), e1: randomUUID(), e2: randomUUID() };
    tempUserIds.push(...Object.values(ids));
    const tag = ids.mgr.slice(0, 6);
    const add = (id: string, name: string, role: string, manager: string | null) =>
      db.insertInto('users').values({ id, full_name: name, email: `m8.${name.toLowerCase().replace(/\s+/g, '')}.${tag}@test.local`, role, reporting_manager_id: manager, password_hash: hash } as any).execute();
    await add(ids.mgr, 'Temp Manager', 'regional_manager', u.mgmt.id);
    await add(ids.mgr2, 'Temp Manager Two', 'regional_manager', u.mgmt.id);
    await add(ids.e1, 'Temp Emp One', 'sales', ids.mgr);
    await add(ids.e2, 'Temp Emp Two', 'sales', ids.mgr);
    for (const k of ['mgr', 'mgr2', 'e1', 'e2'] as const) {
      const name = { mgr: 'tempmanager', mgr2: 'tempmanagertwo', e1: 'tempempone', e2: 'tempemptwo' }[k];
      u[k] = await login(`m8.${name}.${tag}@test.local`);
    }
    const cats = (await http().get('/api/task-categories').set(bearer(u.e1))).body;
    general = cats.find((c: any) => c.code === 'GENERAL').id;
    customerCat = cats.find((c: any) => c.code === 'CUSTOMER').id;
    tenderCat = cats.find((c: any) => c.code === 'TENDER').id;
    customerId = (await db.selectFrom('organisations').select('id').limit(1).executeTakeFirstOrThrow()).id;
  });

  afterAll(async () => {
    if (db && tempUserIds.length) {
      const storage = loadTaskConfig().storageDir;
      await db.connection().execute(async (conn) => {
        await sql`set session_replication_role = replica`.execute(conn);
        const tasks = (await conn.selectFrom('tasks').select('id').where((eb) => eb.or([eb('assigned_to', 'in', tempUserIds), eb('created_by', 'in', tempUserIds), eb('assigned_by', 'in', tempUserIds)])).execute()).map((t) => t.id);
        const historical = (await conn.selectFrom('task_assignment_history').select('task_id').where('from_user_id', 'in', tempUserIds).execute()).map((r) => r.task_id);
        const all = Array.from(new Set([...tasks, ...historical]));
        const templates = (await conn.selectFrom('task_templates').select('id').where('assigned_to', 'in', tempUserIds).execute()).map((t) => t.id);
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
        if (templates.length) {
          await conn.deleteFrom('task_template_skips').where('template_id', 'in', templates).execute();
          await conn.deleteFrom('task_templates').where('id', 'in', templates).execute();
        }
        const snaps = await conn.selectFrom('performance_evidence_snapshots').select(['pdf_storage_key', 'xlsx_storage_key']).where('employee_id', 'in', tempUserIds).execute();
        for (const s of snaps) for (const k of [s.pdf_storage_key, s.xlsx_storage_key]) if (k) fs.rmSync(path.join(storage, k), { force: true });
        await conn.deleteFrom('performance_evidence_snapshots').where('employee_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('performance_reviews').where('employee_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('employee_leaves').where('employee_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('task_notification_log').where('user_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('notifications').where('user_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('audit_log').where('actor_id', 'in', tempUserIds).execute();
        await conn.deleteFrom('users').where('id', 'in', tempUserIds).execute();
        await sql`set session_replication_role = default`.execute(conn);
      });
    }
    await app?.close();
  });

  // ------------------------------------------------------------------ creation & validation
  describe('creation, assignment and validation', () => {
    it('bulk assignment creates one independent task per person with a shared group id', async () => {
      const r = await create(u.mgr, { assignee_ids: [u.e1.id, u.e2.id], title: 'Bulk follow-up' });
      expect(r.data).toHaveLength(2);
      expect(r.group_id).toBeTruthy();
      expect(new Set(r.data.map((t: any) => t.assigned_to))).toEqual(new Set([u.e1.id, u.e2.id]));
      expect(r.data[0].task_number).toMatch(/^TSK-\d{4}-\d{6}$/);
      const d = (await get(u.e1, r.data.find((t: any) => t.assigned_to === u.e1.id).id)).body;
      expect(d.reporting_manager_name).toBe('Temp Manager');
      expect(new Date(d.deadline).toISOString()).toBe(new Date(`${day(3)}T23:59:59+05:30`).toISOString()); // date-only = 23:59:59 IST
    });

    it('rejects past deadlines, deadline before start, out-of-scope and inactive assignees, missing category links', async () => {
      const bad = await http().post('/api/tasks').set(bearer(u.mgr)).send({ title: 'x', category_id: general, assignee_ids: [u.e1.id], deadline: day(-1) });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.deadline).toMatch(/past/);
      const order = await http().post('/api/tasks').set(bearer(u.mgr)).send({ title: 'x', category_id: general, assignee_ids: [u.e1.id], start_date: day(5), deadline: day(3) });
      expect(order.body.errors.deadline).toMatch(/start date/);
      const scope = await http().post('/api/tasks').set(bearer(u.mgr)).send({ title: 'x', category_id: general, assignee_ids: [u.outsider.id], deadline: day(3) });
      expect(scope.body.errors.assignee_ids).toMatch(/own team/);
      const link = await http().post('/api/tasks').set(bearer(u.mgr)).send({ title: 'x', category_id: customerCat, assignee_ids: [u.e1.id], deadline: day(3) });
      expect(link.body.errors.customer_id).toMatch(/needs a customer/);
      const tender = await http().post('/api/tasks').set(bearer(u.mgr)).send({ title: 'x', category_id: tenderCat, assignee_ids: [u.e1.id], deadline: day(3) });
      expect(tender.body.errors.tender_id).toBeDefined();
      const xss = await create(u.mgr, { assignee_ids: [u.e1.id], title: '<script>alert(1)</script>Check BSF stock', category_id: customerCat, customer_id: customerId });
      expect(xss.data[0].title).toBe('alert(1)Check BSF stock');
    });

    it('backlog entries may have a past deadline and are flagged', async () => {
      const r = await create(u.mgr, { assignee_ids: [u.e1.id], deadline: day(-2), is_backlog: true });
      expect((await get(u.mgr, r.data[0].id)).body.is_backlog).toBe(true);
    });

    it('employees may create self-tasks; peers only for linked work', async () => {
      expect((await create(u.e1, { assignee_ids: [u.e1.id] })).data).toHaveLength(1);
      const general_ = await http().post('/api/tasks').set(bearer(u.e1)).send({ title: 'x', category_id: general, assignee_ids: [u.e2.id], deadline: day(3) });
      expect(general_.status).toBe(400);
      const linked = await create(u.e1, { assignee_ids: [u.e2.id], category_id: customerCat, customer_id: customerId });
      expect(linked.data).toHaveLength(1);
    });

    it('warns (does not block) when the assignee is on approved leave over the deadline', async () => {
      expect((await http().post('/api/task-calendar/leaves').set(bearer(u.e1)).send({ employee_id: u.e1.id, from_date: day(20), to_date: day(21) })).status).toBe(403);
      const leave = await http().post('/api/task-calendar/leaves').set(bearer(u.mgr)).send({ employee_id: u.e2.id, from_date: day(20), to_date: day(22), leave_type: 'casual' });
      expect(leave.status).toBe(201);
      const r = await create(u.mgr, { assignee_ids: [u.e2.id], deadline: day(21) });
      expect(r.warnings.some((w: any) => /approved casual leave/.test(w.message))).toBe(true);
    });
  });

  // ------------------------------------------------------------------ workflow
  describe('workflow', () => {
    it('happy path with approval: start → progress → complete → approve, every step in the timeline', async () => {
      const id = await one(u.mgr, { approval_required: true });
      expect((await act(u.e1, id, 'start')).body.status).toBe('in_progress');
      const p = await act(u.e1, id, 'progress', { progress_percent: 60, comment: 'Half way' });
      expect(p.body.progress_percent).toBe(60);
      const noConfirm = await act(u.e1, id, 'complete', { remarks: 'Done' });
      expect(noConfirm.body.errors.confirm_full_completion).toBeDefined();
      const done = await act(u.e1, id, 'complete', { remarks: 'Done', confirm_full_completion: true });
      expect(done.body.status).toBe('awaiting_approval');
      expect(done.body.progress_percent).toBe(100);
      expect((await act(u.e1, id, 'approve')).status).toBe(403); // nobody approves their own work
      const queue = (await http().get('/api/tasks/approvals/pending').set(bearer(u.mgr))).body;
      expect(queue.some((t: any) => t.id === id)).toBe(true);
      const approved = await act(u.mgr, id, 'approve');
      expect(approved.body.status).toBe('completed');
      expect(approved.body.delay_class).toBe('on_time');
      expect(approved.body.updates.map((x: any) => x.kind).reverse()).toEqual(['created', 'start', 'progress', 'submit_for_approval', 'approve']);
      const audit = await db.selectFrom('audit_log').select('action').where('entity_id', '=', id).execute();
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['task_create', 'task_start', 'task_complete', 'task_approve']));
    });

    it('rework loop counts, and evidence-required completion needs remarks + an evidence file', async () => {
      const id = await one(u.mgr, { approval_required: true, evidence_required: true });
      const missing = await act(u.e1, id, 'complete', { remarks: 'short', confirm_full_completion: true });
      expect(Object.keys(missing.body.errors)).toEqual(expect.arrayContaining(['remarks', 'evidence']));
      const fake = await http().post(`/api/tasks/${id}/attachments`).set(bearer(u.e1)).field('purpose', 'evidence').attach('file', Buffer.from('not an image'), 'photo.png');
      expect(fake.status).toBe(400);
      const up = await http().post(`/api/tasks/${id}/attachments`).set(bearer(u.e1)).field('purpose', 'evidence').attach('file', PNG, 'site.png');
      expect(up.status).toBe(201);
      expect((await http().get(`/api/task-attachments/${up.body.id}`).set(bearer(u.outsider))).status).toBe(404);
      expect((await act(u.e1, id, 'complete', { remarks: 'Installed and verified at site, photo attached', confirm_full_completion: true })).body.status).toBe('awaiting_approval');
      const back = await act(u.mgr, id, 'send-back', { reason: 'Photo of serial plate missing' });
      expect(back.body).toMatchObject({ status: 'in_progress', rework_count: 1 });
      expect((await act(u.e1, id, 'complete', { remarks: 'Serial plate photo added to the evidence', confirm_full_completion: true })).body.status).toBe('awaiting_approval');
      expect((await act(u.mgr, id, 'approve')).body.status).toBe('completed');
      const reopen = await act(u.mgr, id, 'reopen', { reason: 'Customer reported a fault the next day' });
      expect(reopen.body).toMatchObject({ status: 'in_progress', reopen_count: 1 });
    });

    it('optimistic locking: the second action with the same version gets 409', async () => {
      const id = await one(u.mgr);
      const v = await version(u.e1, id);
      const first = await http().post(`/api/tasks/${id}/progress`).set(bearer(u.e1)).send({ version: v, comment: 'one' });
      const second = await http().post(`/api/tasks/${id}/progress`).set(bearer(u.e1)).send({ version: v, comment: 'two' });
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('STALE_VERSION');
    });

    it('invalid transitions are 409; employees cannot cancel; managers must give a reason', async () => {
      const id = await one(u.mgr);
      expect((await act(u.e1, id, 'reopen', { reason: 'nope nope' })).status).toBe(403);
      expect((await act(u.mgr, id, 'approve')).status).toBe(409);
      expect((await act(u.e1, id, 'cancel', { reason: 'do not want it' })).status).toBe(403);
      expect((await act(u.mgr, id, 'cancel', {})).body.errors.reason).toBeDefined();
      const c = await act(u.mgr, id, 'cancel', { reason: 'Customer withdrew the requirement' });
      expect(c.body.status).toBe('cancelled');
      expect((await blocker(u.e1, id, { blocker_type: 'technical_issue', description: 'Laptop broke down completely' })).status).toBe(409);
    });

    it('extension must be later and in the future; original deadline never changes', async () => {
      const id = await one(u.mgr, { deadline: day(2) });
      expect((await act(u.mgr, id, 'extend-deadline', { new_deadline: day(1), reason: 'shorter' })).status).toBe(400);
      const ok = await act(u.mgr, id, 'extend-deadline', { new_deadline: `${day(6)}T15:30`, reason: 'Customer moved the meeting' });
      expect(ok.body.extension_count).toBe(1);
      expect(new Date(ok.body.original_deadline).toISOString()).toBe(new Date(`${day(2)}T23:59:59+05:30`).toISOString());
      expect(ok.body.deadline_changes[0]).toMatchObject({ source: 'manager_extension', locked_unexcused_minutes: 0 });
      await expect(db.updateTable('tasks').set({ original_deadline: new Date() }).where('id', '=', id).execute()).rejects.toThrow(/cannot be changed/);
    });

    it('reassign: not to the same person, old assignee keeps a read-only record, history is written', async () => {
      const id = await one(u.mgr);
      expect((await act(u.mgr, id, 'reassign', { to_user_id: u.e1.id, reason: 'same person' })).status).toBe(400);
      const r = await act(u.mgr, id, 'reassign', { to_user_id: u.e2.id, reason: 'Workload balancing', reason_type: 'workload' });
      expect(r.body.assigned_to).toBe(u.e2.id);
      const old = await get(u.e1, id);
      expect(old.status).toBe(200);
      expect(old.body.allowed_actions).toEqual([]);
      expect(old.body.assignment_history[0]).toMatchObject({ reason_type: 'workload' });
    });

    it('escalation target gains manager powers on that task', async () => {
      const id = await one(u.mgr);
      const e = await act(u.mgr, id, 'escalate', { to_user_id: u.mgr2.id, reason: 'Needs a second opinion on pricing' });
      expect(e.status).toBe(200);
      const seen = await get(u.mgr2, id);
      expect(seen.status).toBe(200);
      expect(seen.body.allowed_actions).toEqual(expect.arrayContaining(['extend_deadline', 'reassign']));
      const esc = seen.body.escalations[0];
      expect((await http().post(`/api/task-escalations/${esc.id}/close`).set(bearer(u.mgr2)).send({})).status).toBe(400);
      expect((await http().post(`/api/task-escalations/${esc.id}/close`).set(bearer(u.mgr2)).send({ comment: 'Approved the discount' })).status).toBe(200);
    });

    it('a task created by mistake can be deleted by its creator only before anyone touches it', async () => {
      const id = await one(u.mgr);
      expect((await http().delete(`/api/tasks/${id}`).set(bearer(u.e1))).status).toBe(403);
      expect((await http().delete(`/api/tasks/${id}`).set(bearer(u.mgr))).status).toBe(200);
      const touched = await one(u.mgr);
      await act(u.e1, touched, 'start');
      expect((await http().delete(`/api/tasks/${touched}`).set(bearer(u.mgr))).status).toBe(409);
    });
  });

  // ------------------------------------------------------------------ blockers
  describe('blockers', () => {
    it('type-specific validation, one open blocker, no self-review', async () => {
      const id = await one(u.mgr);
      expect((await blocker(u.e1, id, { blocker_type: 'another_employee', dependency_user_id: u.e1.id, description: 'Waiting on myself somehow' })).body.errors.dependency_user_id).toBeDefined();
      expect((await blocker(u.e1, id, { blocker_type: 'vendor_dependency', description: 'short' })).body.errors).toMatchObject({ vendor_name: expect.any(String), description: expect.any(String) });
      const ok = await blocker(u.e1, id, { blocker_type: 'another_employee', dependency_user_id: u.e2.id, description: 'Need the requirement list from colleague' });
      expect(ok.body.status).toBe('blocked');
      const waiting = (await http().get('/api/task-blockers/waiting-on-me').set(bearer(u.e2))).body;
      expect(waiting.some((b: any) => b.task_id === id)).toBe(true);
      expect((await decide(u.e1, id, 'accept', { mode: 'pause', comment: 'self accept' })).status).toBe(403);
      const rej = await decide(u.mgr, id, 'reject', { comment: 'Ask them directly, this is routine' });
      expect(rej.body.status).toBe('not_started'); // back to previous status
    });

    it('accept with PAUSE moves the deadline by the blocked time when resolved; overdue is suspended meanwhile', async () => {
      const id = await one(u.mgr, { deadline: day(2) });
      await act(u.e1, id, 'start');
      await blocker(u.e1, id, { blocker_type: 'missing_information', description: 'Specifications not received from the customer' });
      await decide(u.mgr, id, 'accept', { mode: 'pause', comment: 'Genuine dependency' });
      // Make the blocker look 2 days old and the deadline already passed.
      await db.connection().execute(async (c) => {
        await sql`set session_replication_role = replica`.execute(c);
        await c.updateTable('task_blockers').set({ created_at: sql`now() - interval '2 days'` }).where('task_id', '=', id).execute();
        await c.updateTable('tasks').set({ deadline: sql`now() - interval '1 day'` }).where('id', '=', id).execute();
        await sql`set session_replication_role = default`.execute(c);
      });
      const blocked = (await get(u.mgr, id)).body;
      expect(blocked.is_overdue).toBe(false);
      const resolved = await decide(u.e1, id, 'resolve', { note: 'Specs received today' });
      expect(resolved.body.status).toBe('in_progress');
      const change = resolved.body.deadline_changes.find((c: any) => c.source === 'pause_resume');
      expect(change.excused_minutes).toBeGreaterThanOrEqual(2 * 1440 - 1);
      expect(new Date(resolved.body.deadline).getTime()).toBeGreaterThan(Date.now());
    });

    it('accept with EXTEND after the deadline excuses only time from the raise (never retroactive)', async () => {
      const id = await one(u.mgr, { deadline: day(1) });
      await act(u.e1, id, 'start');
      await db.connection().execute(async (c) => {
        await sql`set session_replication_role = replica`.execute(c);
        await c.updateTable('tasks').set({ deadline: sql`now() - interval '2 days'`, original_deadline: sql`now() - interval '2 days'` }).where('id', '=', id).execute();
        await sql`set session_replication_role = default`.execute(c);
      });
      const raised = await blocker(u.e1, id, { blocker_type: 'external_portal_issue', portal_name: 'GeM', description: 'GeM upload failing since yesterday' });
      expect(raised.body.blockers[0].raised_after_deadline).toBe(true);
      const acc = await decide(u.mgr, id, 'accept', { mode: 'extend', new_deadline: day(3), comment: 'Outage confirmed' });
      expect(acc.body.unexcused_locked_minutes).toBeGreaterThanOrEqual(2 * 1440 - 1);
      await decide(u.e1, id, 'resolve', { note: 'Portal back up' });
      const done = await act(u.e1, id, 'complete', { remarks: 'Uploaded', delay_reason: 'GeM portal outage', confirm_full_completion: true });
      expect(done.body.delay_class).toBe('late_unexcused');
      expect(done.body.unexcused_delay_days).toBeGreaterThanOrEqual(1.9);
    });

    it('approved leave blocker is auto-accepted when the leave register matches; withdraw works while pending', async () => {
      await http().post('/api/task-calendar/leaves').set(bearer(u.mgr)).send({ employee_id: u.e1.id, from_date: day(0), to_date: day(1) });
      const id = await one(u.mgr, { deadline: day(1) });
      const r = await blocker(u.e1, id, { blocker_type: 'approved_leave', description: 'On approved casual leave today and tomorrow' });
      expect(r.body.open_blocker.status).toBe('accepted');
      const id2 = await one(u.mgr);
      await blocker(u.e1, id2, { blocker_type: 'technical_issue', description: 'Laptop will not boot after update' });
      expect((await decide(u.e1, id2, 'withdraw', {})).body.status).toBe('not_started');
    });
  });

  // ------------------------------------------------------------------ routing & scope
  describe('routing, scope and deactivation', () => {
    it('approvals follow the CURRENT manager when the reporting line changes', async () => {
      const id = await one(u.mgr, { approval_required: true, assignee_ids: [u.e2.id] });
      await act(u.e2, id, 'complete', { remarks: 'done', confirm_full_completion: true });
      await db.updateTable('users').set({ reporting_manager_id: u.mgr2.id }).where('id', '=', u.e2.id).execute();
      const mine = (await http().get('/api/tasks/approvals/pending').set(bearer(u.mgr2))).body;
      expect(mine.some((t: any) => t.id === id)).toBe(true);
      expect((await http().get('/api/tasks/approvals/pending').set(bearer(u.mgr))).body.some((t: any) => t.id === id)).toBe(false);
      expect((await act(u.mgr2, id, 'approve')).status).toBe(200);
      await db.updateTable('users').set({ reporting_manager_id: u.mgr.id }).where('id', '=', u.e2.id).execute();
    });

    it('no data leakage through query params, dashboards or evidence', async () => {
      const id = await one(u.mgr);
      expect((await get(u.outsider, id)).status).toBe(404);
      const list = await http().get('/api/tasks').query({ assignee_ids: u.e1.id }).set(bearer(u.outsider));
      expect(list.body.total).toBe(0);
      expect((await http().get('/api/accountability/dashboard?scope=all').set(bearer(u.e1))).status).toBe(403);
      expect((await http().get(`/api/performance/evidence?employee_id=${u.e2.id}`).set(bearer(u.e1))).status).toBe(403);
      expect((await http().get(`/api/performance/evidence?employee_id=${u.e1.id}`).set(bearer(u.e1))).status).toBe(200);
      expect((await http().get(`/api/performance/evidence/export?employee_id=${u.e1.id}&format=pdf`).set(bearer(u.mgr))).status).toBe(403);
      const team = (await http().get('/api/accountability/dashboard').set(bearer(u.mgr))).body;
      expect(team.employees.map((e: any) => e.employee_id).sort()).toEqual([u.e1.id, u.e2.id].sort());
      expect((await http().get('/api/accountability/dashboard?scope=all').set(bearer(u.accounts))).status).toBe(200);
    });

    it('deactivated employee: open tasks need reassignment and their series pause', async () => {
      const id = await one(u.mgr, { assignee_ids: [u.e2.id] });
      const tpl = (await create(u.mgr, { assignee_ids: [u.e2.id], title: 'E2E daily check', recurrence_type: 'daily', recurrence_rule: {}, start_date: day(0) })).data[0];
      await db.updateTable('users').set({ is_active: false }).where('id', '=', u.e2.id).execute();
      const needs = (await http().get('/api/tasks/needs-reassignment').set(bearer(u.mgr))).body;
      expect(needs.tasks.some((t: any) => t.id === id)).toBe(true);
      await generator.generateAll();
      const t = await db.selectFrom('task_templates').select(['status', 'needs_reassignment']).where('id', '=', tpl.id).executeTakeFirstOrThrow();
      expect(t).toEqual({ status: 'paused', needs_reassignment: true });
      const deact = await db.selectFrom('users').select('deactivated_at').where('id', '=', u.e2.id).executeTakeFirstOrThrow();
      expect(deact.deactivated_at).not.toBeNull();
      await db.updateTable('users').set({ is_active: true }).where('id', '=', u.e2.id).execute();
    });
  });

  // ------------------------------------------------------------------ recurrence & jobs
  describe('recurring generation and jobs', () => {
    it('generation is idempotent and catches up missed days (flagged generated_late)', async () => {
      const r = await create(u.mgr, { assignee_ids: [u.e1.id], title: 'E2E weekly sync', recurrence_type: 'custom', recurrence_rule: { freq: 'daily', interval: 1 }, start_date: day(0), due_time: '00:30' });
      expect(r.kind).toBe('recurring');
      const tplId = r.data[0].id;
      const count = async () => Number((await db.selectFrom('tasks').select(sql<number>`count(*)::int`.as('n')).where('template_id', '=', tplId).executeTakeFirstOrThrow()).n);
      const before = await count();
      expect(before).toBeGreaterThan(0);
      await generator.generateAll();
      await generator.generateAll();
      expect(await count()).toBe(before);
      // Simulate downtime: back-date the series start and the generation watermark by 3 days.
      await db.updateTable('task_templates').set({ start_date: day(-5), last_generated_until: day(-4) }).where('id', '=', tplId).execute();
      await generator.generateAll();
      const late = await db.selectFrom('tasks').select(['occurrence_date', 'generated_late']).where('template_id', '=', tplId).where('occurrence_date', '<', day(0)).execute();
      const skipped = await db.selectFrom('task_template_skips').select('occurrence_date').where('template_id', '=', tplId).where('occurrence_date', '<', day(0)).execute();
      expect(late.length + skipped.length).toBe(3); // missed days are generated, or recorded as skipped (weekly off / holiday)
      expect(late.length).toBeGreaterThan(0);
      expect(late.every((t) => t.generated_late)).toBe(true);
      const preview = (await http().get(`/api/task-templates/${tplId}/preview?count=5`).set(bearer(u.mgr))).body;
      expect(preview).toHaveLength(5);
    });

    it('overdue job stamps first_overdue_at once and notifies once', async () => {
      const id = await one(u.mgr);
      await db.connection().execute(async (c) => {
        await sql`set session_replication_role = replica`.execute(c);
        await c.updateTable('tasks').set({ deadline: sql`now() - interval '1 hour'` }).where('id', '=', id).execute();
        await sql`set session_replication_role = default`.execute(c);
      });
      await jobs.overdue();
      await jobs.overdue();
      const t = await db.selectFrom('tasks').select('first_overdue_at').where('id', '=', id).executeTakeFirstOrThrow();
      expect(t.first_overdue_at).not.toBeNull();
      const n = await db.selectFrom('notifications').select(sql<number>`count(*)::int`.as('n')).where('entity_id', '=', id).where('type', '=', 'task_overdue').where('user_id', '=', u.e1.id).executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(1);
      expect((await http().get('/api/tasks').query({ view: 'mine', statuses: 'overdue' }).set(bearer(u.e1))).body.data.some((r: any) => r.id === id)).toBe(true);
    });

    it('reminder, no-update, SLA and digest jobs are safe to re-run', async () => {
      for (let i = 0; i < 2; i++) {
        await jobs.reminders();
        await jobs.noUpdate();
        await jobs.sla();
        await jobs.digest();
      }
      // Job-generated reminders/digests must never repeat (workflow notifications such as a second submission may).
      const dup = await sql<{ n: number }>`select count(*)::int as n from (select user_id, title, count(*) from notifications
        where user_id in (${sql.join(tempUserIds)}) and (type in ('task_due', 'task_overdue', 'task_no_update', 'task_digest') or title like 'Blocker waiting%' or title like 'Approval waiting%')
        group by 1, 2 having count(*) > 1) d`.execute(db);
      expect(Number(dup.rows[0].n)).toBe(0);
    });
  });

  // ------------------------------------------------------------------ evidence
  describe('performance evidence', () => {
    it('evidence report carries the disclaimer and no monetary fields; snapshots are immutable and versioned', async () => {
      const ev = await http().get(`/api/performance/evidence?employee_id=${u.e1.id}&from=${day(-30)}&to=${day(30)}`).set(bearer(u.mgr));
      expect(ev.status).toBe(200);
      expect(ev.body.disclaimer).toMatch(/supporting evidence only/);
      expect(JSON.stringify(ev.body)).not.toMatch(/salary_amount|deduction_amount|penalty_amount|incentive_amount/i);
      expect(ev.body.work_assigned.total).toBeGreaterThan(0);
      const s1 = await http().post('/api/performance/evidence/snapshots').set(bearer(u.mgmt)).send({ employee_id: u.e1.id, from: day(-30), to: day(30) });
      expect(s1.status).toBe(201);
      const s2 = await http().post('/api/performance/evidence/snapshots').set(bearer(u.mgmt)).send({ employee_id: u.e1.id, from: day(-30), to: day(30) });
      expect(s2.body.snapshot_no).toBe(s1.body.snapshot_no + 1);
      await expect(db.updateTable('performance_evidence_snapshots').set({ data_sha256: 'x' }).where('id', '=', s1.body.id).execute()).rejects.toThrow(/append-only/);
      const pdf = await http().get(`/api/performance/evidence/snapshots/${s1.body.id}/file?format=pdf`).set(bearer(u.mgmt)).buffer(true);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['x-evidence-integrity']).toBe('verified');
      const views = await db.selectFrom('audit_log').select('action').where('entity_id', '=', u.e1.id).where('entity_type', '=', 'performance_evidence').execute();
      expect(views.length).toBeGreaterThan(0);
    });

    it('manager review: no self review, locked after submit, employee responds and acknowledges, revision creates a new version', async () => {
      expect((await http().post('/api/performance-reviews').set(bearer(u.mgr)).send({ employee_id: u.mgr.id, period_from: day(-30), period_to: day(0) })).status).toBe(403);
      const r = await http().post('/api/performance-reviews').set(bearer(u.mgr)).send({ employee_id: u.e1.id, period_from: day(-30), period_to: day(0), rating: 4, comments: 'Consistent follow-ups; one late quotation.' });
      expect(r.status).toBe(201);
      expect((await http().get(`/api/performance-reviews/${r.body.id}`).set(bearer(u.e1))).status).toBe(404); // drafts are private
      const sub = await http().post(`/api/performance-reviews/${r.body.id}/submit`).set(bearer(u.mgr)).send({ version: r.body.version });
      expect(sub.body.status).toBe('submitted');
      expect((await http().patch(`/api/performance-reviews/${r.body.id}`).set(bearer(u.mgr)).send({ version: sub.body.version, rating: 5 })).status).toBe(409);
      await expect(db.updateTable('performance_reviews').set({ rating: 1 }).where('id', '=', r.body.id).execute()).rejects.toThrow(/locked/);
      expect((await http().post(`/api/performance-reviews/${r.body.id}/respond`).set(bearer(u.e1)).send({ response: 'The quotation was late because pricing approval came late.' })).status).toBe(200);
      expect((await http().post(`/api/performance-reviews/${r.body.id}/acknowledge`).set(bearer(u.e1)).send({})).body.status).toBe('acknowledged');
      const rev = await http().post(`/api/performance-reviews/${r.body.id}/revise`).set(bearer(u.mgr)).send({ reason: 'Rating calibrated with management' });
      expect(rev.body).toMatchObject({ status: 'draft', supersedes_id: r.body.id });
    });
  });
});
