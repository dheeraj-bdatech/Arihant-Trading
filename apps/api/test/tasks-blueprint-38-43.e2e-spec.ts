/**
 * Scope Blueprint §38–43 (Task & Productivity Management), walked bullet by bullet over HTTP:
 * §38 task kinds, §39 assignment fields, §40 statuses + evidence/remarks, §41 blocker types and the five
 * manager outcomes, §42 the seven accountability signals, §43 evidence for performance reviews — and that
 * nothing computes or stores a salary, incentive or deduction.
 * Uses an isolated temporary team (manager, second manager, two employees and one employee whose numbers are
 * asserted exactly) so seed data is untouched; everything it creates is removed afterwards.
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
import { CLOSED_SERVICE_STATUSES, CLOSED_TENDER_STATUSES } from '../src/modules/tasks/task-input.service';
import { loadTaskConfig } from '../src/modules/tasks/task.config';
import { TASK_BLOCKER_TYPES, TASK_DISPLAY_STATUSES, istDateOf, todayInKolkata, type Database } from '@arihant/shared';
import { configureApp } from '../src/common/app-setup';

jest.setTimeout(90000);

const today = todayInKolkata();
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]);
/** Every key anywhere in a JSON value (array indices included). */
const keysOf = (v: unknown): string[] => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
const MONEY = /salary|deduct|incentive|penalt|payroll|bonus|amount/i;

describe('Blueprint §38–43 — Task & Productivity Management, spec walk-through (e2e)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  type Who = { token: string; id: string };
  const u: Record<string, Who> = {};
  const tempUserIds: string[] = [];
  const cat: Record<string, string> = {};
  let customerId = '';
  let dept = { id: '', name: '' };

  const http = () => request(app.getHttpServer());
  const bearer = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
  async function login(email: string): Promise<Who> {
    const res = await http().post('/api/auth/login').send({ email, password: 'password123' });
    if (res.status !== 200) throw new Error(`login ${email} → ${res.status}`);
    return { token: res.body.accessToken || res.body.token, id: res.body.user.id };
  }
  const get = (w: Who, id: string) => http().get(`/api/tasks/${id}`).set(bearer(w));
  const version = async (w: Who, id: string) => (await get(w, id)).body.version;
  const act = async (w: Who, id: string, action: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/tasks/${id}/${action}`).set(bearer(w)).send({ version: await version(w, id), ...body });
  const post = (w: Who, body: Record<string, unknown>) => http().post('/api/tasks').set(bearer(w)).send({ title: 'Blueprint task', category_id: cat.GENERAL, deadline: day(3), ...body });
  async function one(w: Who, assignee: Who, body: Record<string, unknown> = {}) {
    const res = await post(w, { assignee_ids: [assignee.id], ...body });
    if (res.status !== 201) throw new Error(`create → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data[0].id as string;
  }
  const blocker = async (w: Who, taskId: string, body: Record<string, unknown>) =>
    http().post(`/api/tasks/${taskId}/blockers`).set(bearer(w)).send({ version: await version(w, taskId), ...body });
  async function decide(w: Who, taskId: string, decision: string, body: Record<string, unknown> = {}) {
    const d = (await get(w, taskId)).body;
    const b = d.blockers.find((x: any) => x.open);
    return http().post(`/api/task-blockers/${b.id}/${decision}`).set(bearer(w)).send({ version: d.version, ...body });
  }
  /** Moves timestamps the API would never let us set (deadline in the past, stale updates), bypassing the history triggers. */
  const rewrite = (taskId: string, set: Record<string, unknown>) =>
    db.connection().execute(async (c) => {
      await sql`set session_replication_role = replica`.execute(c);
      await c.updateTable('tasks').set(set as any).where('id', '=', taskId).execute();
      await sql`set session_replication_role = default`.execute(c);
    });
  const complete = (w: Who, id: string, body: Record<string, unknown> = {}) => act(w, id, 'complete', { remarks: 'Work handed in', confirm_full_completion: true, ...body });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleFixture.get<Kysely<Database>>(TASK_DB);

    for (const [k, e] of Object.entries({ mgmt: 'mgmt@arihant.com', accounts: 'accounts@arihant.com' })) u[k] = await login(e);
    dept = await db.selectFrom('departments').select(['id', 'name']).orderBy('name').executeTakeFirstOrThrow();
    const hash = await bcrypt.hash('password123', 10);
    const ids = { mgr: randomUUID(), mgr2: randomUUID(), e1: randomUUID(), e2: randomUUID(), acc: randomUUID() };
    tempUserIds.push(...Object.values(ids));
    const tag = ids.mgr.slice(0, 6);
    const people: [keyof typeof ids, string, string, string | null][] = [
      ['mgr', 'BpManager', 'regional_manager', u.mgmt.id],
      ['mgr2', 'BpManagerTwo', 'regional_manager', u.mgmt.id],
      ['e1', 'BpEmpOne', 'sales', ids.mgr],
      ['e2', 'BpEmpTwo', 'sales', ids.mgr],
      ['acc', 'BpAccountable', 'sales', ids.mgr],
    ];
    for (const [k, name, role, manager] of people) {
      await db.insertInto('users').values({ id: ids[k], full_name: name, email: `bp.${name.toLowerCase()}.${tag}@test.local`, role, reporting_manager_id: manager, password_hash: hash } as any).execute();
    }
    await db.updateTable('users').set({ department_id: dept.id }).where('id', '=', ids.e1).execute();
    for (const [k, name] of people) u[k] = await login(`bp.${name.toLowerCase()}.${tag}@test.local`);
    for (const c of (await http().get('/api/task-categories').set(bearer(u.e1))).body) cat[c.code] = c.id;
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

  // ------------------------------------------------------------------ §38
  describe('§38 task kinds', () => {
    it('one-time, daily, weekly, monthly and other recurring tasks can all be set up', async () => {
      const once = await one(u.mgr, u.e1, { title: 'One-time: site survey' });
      expect((await get(u.mgr, once)).body).toMatchObject({ template_id: null, template: null });
      const series: [string, Record<string, unknown>][] = [
        ['daily', {}],
        ['weekly', { weekdays: [1, 4] }],
        ['monthly', { month_days: [1] }],
        ['custom', { freq: 'weekly', interval: 2, weekdays: [2] }],
      ];
      for (const [type, rule] of series) {
        const r = await post(u.mgr, { assignee_ids: [u.e1.id], title: `Recurring ${type}`, recurrence_type: type, recurrence_rule: rule, start_date: day(0) });
        expect({ type, status: r.status }).toEqual({ type, status: 201 });
        expect(r.body.kind).toBe('recurring');
        expect(r.body.data[0].recurrence_type).toBe(type);
      }
    });

    it('customer-, tender-, demo- and service-related tasks carry their link, and the category insists on one', async () => {
      for (const code of ['CUSTOMER', 'TENDER', 'DEMO', 'SERVICE']) {
        const bare = await post(u.mgr, { assignee_ids: [u.e1.id], category_id: cat[code] });
        expect({ code, status: bare.status }).toEqual({ code, status: 400 });
      }
      const tender = await db.selectFrom('tenders').select('id').where('is_deleted', '=', false).where('status', 'not in', CLOSED_TENDER_STATUSES as any).executeTakeFirst();
      const demo = await db.selectFrom('demos').select('id').where('status', '<>', 'cancelled').executeTakeFirst();
      const ticket = await db.selectFrom('service_tickets').select('id').where('deleted_at', 'is', null).where('status', 'not in', CLOSED_SERVICE_STATUSES as any).executeTakeFirst();
      // The blueprint accepts "a demo / ticket, or at least the customer"; link the real record when this database has one.
      const cases: [string, string, Record<string, unknown>][] = [
        ['CUSTOMER', 'customer_id', { customer_id: customerId }],
        ...(tender ? [['TENDER', 'tender_id', { tender_id: tender.id }] as [string, string, Record<string, unknown>]] : []),
        ['DEMO', demo ? 'demo_id' : 'customer_id', demo ? { demo_id: demo.id } : { customer_id: customerId }],
        ['SERVICE', ticket ? 'service_ticket_id' : 'customer_id', ticket ? { service_ticket_id: ticket.id } : { customer_id: customerId }],
      ];
      for (const [code, field, link] of cases) {
        const id = await one(u.mgr, u.e1, { category_id: cat[code], ...link });
        const d = (await get(u.mgr, id)).body;
        expect({ code, category: d.category_id, link: d[field] }).toEqual({ code, category: cat[code], link: Object.values(link)[0] });
        expect(d.customer_id).toBeTruthy(); // the customer is derived from the tender / demo / ticket
      }
    });
  });

  // ------------------------------------------------------------------ §39
  describe('§39 task assignment', () => {
    it('records every assignment field; reporting manager and department come from the employee record', async () => {
      const id = await one(u.mgr, u.e1, {
        title: 'Prepare BOQ for 14th Bn',
        description: 'Line items for the 14th Bn perimeter site',
        priority: 'high',
        start_date: day(0),
        deadline: day(4),
        expected_outcome: 'BOQ ready for pricing review',
      });
      const up = await http().post(`/api/tasks/${id}/attachments`).set(bearer(u.mgr)).field('purpose', 'supporting_doc').attach('file', PNG, 'site-plan.png');
      expect(up.status).toBe(201);
      const d = (await get(u.e1, id)).body;
      expect(d).toMatchObject({
        title: 'Prepare BOQ for 14th Bn',
        description: 'Line items for the 14th Bn perimeter site',
        assigned_to: u.e1.id,
        reporting_manager_id: u.mgr.id,
        reporting_manager_name: 'BpManager',
        department_id: dept.id,
        department_name: dept.name,
        priority: 'high',
        expected_outcome: 'BOQ ready for pricing review',
        status: 'not_started',
      });
      expect(istDateOf(d.start_date)).toBe(day(0));
      expect(istDateOf(d.deadline)).toBe(day(4));
      expect(d.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'supporting_doc' })]));
    });
  });

  // ------------------------------------------------------------------ §40
  describe('§40 task status', () => {
    it('every listed status is reachable; OVERDUE is derived, wins on display, and is suspended by an accepted blocker', async () => {
      expect(TASK_DISPLAY_STATUSES).toEqual(expect.arrayContaining(['not_started', 'in_progress', 'completed', 'blocked', 'awaiting_approval', 'overdue']));
      const id = await one(u.mgr, u.e1, { approval_required: true, deadline: day(2) });
      expect((await get(u.e1, id)).body.display_status).toBe('not_started');
      expect((await act(u.e1, id, 'start')).body.display_status).toBe('in_progress');
      await blocker(u.e1, id, { blocker_type: 'missing_information', description: 'Site drawings not shared by the customer yet' });
      await decide(u.mgr, id, 'accept', { mode: 'pause', comment: 'Customer confirmed the delay' });
      await rewrite(id, { deadline: sql`now() - interval '1 hour'` });
      expect((await get(u.e1, id)).body).toMatchObject({ status: 'blocked', display_status: 'blocked', is_overdue: false });
      await decide(u.e1, id, 'resolve', { note: 'Drawings received this morning' });
      expect((await get(u.e1, id)).body).toMatchObject({ status: 'in_progress', display_status: 'overdue', is_overdue: true });
      expect((await complete(u.e1, id)).body.errors.delay_reason).toBeDefined(); // late work needs a reason
      const handed = await complete(u.e1, id, { delay_reason: 'Drawings arrived late from the customer' });
      expect(handed.body.display_status).toBe('awaiting_approval');
      expect((await act(u.mgr, id, 'approve')).body.display_status).toBe('completed');
    });

    it('employees give evidence or remarks where the task requires them', async () => {
      const id = await one(u.mgr, u.e1, { evidence_required: true });
      const missing = await complete(u.e1, id, { remarks: 'short' });
      expect(missing.status).toBe(400);
      expect(Object.keys(missing.body.errors)).toEqual(expect.arrayContaining(['remarks', 'evidence']));
    });
  });

  // ------------------------------------------------------------------ §41
  describe('§41 blocker workflow', () => {
    it('offers exactly the eight blocker types, each validated for the detail it needs', async () => {
      expect([...TASK_BLOCKER_TYPES].sort()).toEqual(
        ['management_approval', 'customer_dependency', 'vendor_dependency', 'another_employee', 'missing_information', 'external_portal_issue', 'technical_issue', 'approved_leave'].sort(),
      );
      const needs: Record<string, [string | null, Record<string, unknown>]> = {
        management_approval: ['approval_pending_from', { approval_pending_from: 'National sales head' }],
        customer_dependency: ['dependency_customer_id', { dependency_customer_id: customerId }],
        vendor_dependency: ['vendor_name', { vendor_name: 'Bharat Electronics' }],
        another_employee: ['dependency_user_id', { dependency_user_id: u.e2.id }],
        missing_information: [null, {}],
        external_portal_issue: ['portal_name', { portal_name: 'GeM' }],
        technical_issue: [null, {}],
        approved_leave: ['leave_id', {}], // e1 has no approved leave on record
      };
      for (const [type, [field, detail]] of Object.entries(needs)) {
        const id = await one(u.mgr, u.e1);
        const description = `Blocked by ${type.replace(/_/g, ' ')} for this task`;
        if (field) {
          const bad = await blocker(u.e1, id, { blocker_type: type, description });
          expect({ type, field: bad.body.errors?.[field] }).toEqual({ type, field: expect.any(String) });
        }
        if (type === 'approved_leave') continue;
        const ok = await blocker(u.e1, id, { blocker_type: type, description, ...detail });
        expect({ type, status: ok.body.status, raised: ok.body.open_blocker?.blocker_type }).toEqual({ type, status: 'blocked', raised: type });
        expect((await decide(u.e1, id, 'withdraw')).body.status).toBe('not_started');
      }
      // Approved leave that matches the leave register is accepted without waiting for the manager.
      expect((await http().post('/api/task-calendar/leaves').set(bearer(u.mgr)).send({ employee_id: u.e2.id, from_date: day(0), to_date: day(2), leave_type: 'casual' })).status).toBe(201);
      const onLeave = await one(u.mgr, u.e2, { deadline: day(1) });
      const leave = await blocker(u.e2, onLeave, { blocker_type: 'approved_leave', description: 'On approved casual leave until the deadline' });
      expect(leave.body.open_blocker.status).toBe('accepted');
    });

    it('accept vs reject separates a genuine dependency (late, excused) from poor execution (late, unapproved)', async () => {
      const genuine = await one(u.mgr, u.e1, { deadline: day(2), approval_required: false });
      const poor = await one(u.mgr, u.e1, { deadline: day(2), approval_required: false });
      for (const id of [genuine, poor]) {
        await act(u.e1, id, 'start');
        await blocker(u.e1, id, { blocker_type: 'vendor_dependency', vendor_name: 'Tata Advanced Systems', description: 'Vendor has not confirmed the delivery slot' });
      }
      // Accept → extend deadline: the new deadline is set now and recorded against the blocker.
      const acc = await decide(u.mgr, genuine, 'accept', { mode: 'extend', new_deadline: day(6), comment: 'Vendor confirmed a factory shutdown' });
      expect(acc.body.deadline_changes[0]).toMatchObject({ source: 'blocker_accepted' });
      expect(acc.body.blockers[0].decision).toBe('accept_extend');
      expect(istDateOf(acc.body.deadline)).toBe(day(6));
      // Reject: the task goes back to its previous status and the clock never paused.
      const rej = await decide(u.mgr, poor, 'reject', { comment: 'Routine follow-up; call the vendor yourself' });
      expect(rej.body.status).toBe('in_progress');
      // An accepted blocker stays open until the dependency clears.
      expect(acc.body.status).toBe('blocked');
      expect((await decide(u.e1, genuine, 'resolve', { note: 'Vendor delivered after the shutdown' })).body.status).toBe('in_progress');
      // Both finish after the ORIGINAL deadline.
      await rewrite(genuine, { original_deadline: sql`now() - interval '1 hour'` });
      await rewrite(poor, { original_deadline: sql`now() - interval '1 hour'`, deadline: sql`now() - interval '1 hour'` });
      expect((await complete(u.e1, genuine, { delay_reason: 'Vendor shutdown, accepted by manager' })).body.delay_class).toBe('late_excused');
      expect((await complete(u.e1, poor, { delay_reason: 'Could not reach the vendor in time' })).body.delay_class).toBe('late_unexcused');
    });

    it('extend: once the new deadline passes the task is overdue and the delay unapproved, even if the blocker is never marked resolved', async () => {
      const id = await one(u.mgr, u.e1, { deadline: day(2) });
      await act(u.e1, id, 'start');
      await blocker(u.e1, id, { blocker_type: 'customer_dependency', dependency_customer_id: customerId, description: 'Customer has not signed the inspection slot' });
      await decide(u.mgr, id, 'accept', { mode: 'extend', new_deadline: day(4), comment: 'Customer committed to sign by then' });
      // Time passes: the original deadline and the manager's new one are both behind us; nobody resolved the blocker.
      await rewrite(id, { original_deadline: sql`now() - interval '2 days'`, deadline: sql`now() - interval '1 hour'` });
      const d = (await get(u.mgr, id)).body;
      expect(d).toMatchObject({ status: 'blocked', open_blocker: expect.objectContaining({ status: 'accepted', decision: 'accept_extend' }), is_overdue: true, display_status: 'overdue', delay_class: 'open_overdue' });
      expect(d.unexcused_delay_days).toBeGreaterThan(0);
      const listed = (await http().get('/api/tasks').query({ view: 'team', statuses: 'overdue' }).set(bearer(u.mgr))).body.data;
      expect(listed.some((t: any) => t.id === id)).toBe(true);
      const flags = (await http().get('/api/accountability/flags').query({ type: 'overdue' }).set(bearer(u.mgr))).body;
      expect(flags.overdue.some((t: any) => t.id === id)).toBe(true);
    });

    it('reassign: an undecided blocker is withdrawn, the task returns to its previous status and the new assignee owns it', async () => {
      const id = await one(u.mgr, u.e1);
      await act(u.e1, id, 'start');
      await blocker(u.e1, id, { blocker_type: 'technical_issue', description: 'CRM export keeps timing out on the BOQ' });
      const r = await act(u.mgr, id, 'reassign', { to_user_id: u.e2.id, reason: 'E2 has working access to the export', reason_type: 'skills' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ assigned_to: u.e2.id, status: 'in_progress', open_blocker: null });
      expect(r.body.blockers[0].status).toBe('withdrawn');
      expect((await get(u.e2, id)).body.allowed_actions).toEqual(expect.arrayContaining(['complete', 'raise_blocker']));
    });

    it('escalate: upward only; the blocker stays open, is routed to the person escalated to, and they can decide it', async () => {
      const id = await one(u.mgr, u.e1);
      await blocker(u.e1, id, { blocker_type: 'management_approval', approval_pending_from: 'National sales head', description: 'Discount above my limit needs sign-off' });
      const blockerId = (await get(u.e1, id)).body.open_blocker.id;
      // The dialog's list: the manager's own line and management — never a peer manager or a junior.
      const targets = (await http().get(`/api/tasks/${id}/escalation-targets`).set(bearer(u.mgr))).body.map((t: any) => t.id);
      expect(targets).toContain(u.mgmt.id);
      expect(targets).not.toEqual(expect.arrayContaining([u.mgr2.id]));
      expect(targets.filter((t: string) => [u.e1.id, u.e2.id, u.mgr.id].includes(t))).toEqual([]);
      expect((await http().get(`/api/tasks/${id}/escalation-targets`).set(bearer(u.e1))).status).toBe(403);
      expect((await act(u.mgr, id, 'escalate', { to_user_id: u.mgr2.id, reason: 'Discount is above my approval limit' })).status).toBe(400);
      // No target given: the manager's own manager.
      const e = await act(u.mgr, id, 'escalate', { reason: 'Discount is above my approval limit' });
      expect(e.status).toBe(200);
      expect(e.body).toMatchObject({ status: 'blocked', open_blocker: expect.objectContaining({ id: blockerId, status: 'pending_review' }) });
      expect(e.body.escalations[0]).toMatchObject({ blocker_id: blockerId, escalated_to: u.mgmt.id });
      const queue = (await http().get('/api/task-blockers/pending').set(bearer(u.mgmt))).body;
      expect(queue.some((b: any) => b.id === blockerId)).toBe(true);
      expect((await decide(u.mgmt, id, 'accept', { mode: 'pause', comment: 'Discount approved by national head' })).body.open_blocker.status).toBe('accepted');
    });
  });

  // ------------------------------------------------------------------ §42 + §43 (one employee, exact numbers)
  describe('§42 accountability and §43 performance evidence', () => {
    const range = { from: day(-30), to: day(30) };
    let threshold = 0;

    beforeAll(async () => {
      const a = u.acc;
      threshold = (await http().get('/api/accountability/dashboard').query(range).set(bearer(u.mgr))).body.settings.repeated_delay_threshold;
      await one(u.mgr, a, { title: 'Due today', deadline: day(0) });
      await one(u.mgr, a, { title: 'Due this week', deadline: day(3) });
      const overdue = await one(u.mgr, a, { title: 'Overdue', deadline: day(2) });
      await rewrite(overdue, { deadline: sql`now() - interval '1 day'`, original_deadline: sql`now() - interval '1 day'` });
      const stale = await one(u.mgr, a, { title: 'No update', deadline: day(10) });
      await rewrite(stale, { last_update_at: sql`now() - interval '400 days'` });
      for (let i = 0; i < threshold; i++) {
        const late = await one(u.mgr, a, { title: `Late ${i + 1}`, deadline: day(2), approval_required: false });
        await rewrite(late, { deadline: sql`now() - interval '2 hours'`, original_deadline: sql`now() - interval '2 hours'` });
        await complete(a, late, { delay_reason: 'Missed the deadline, no dependency' });
      }
      const rework = await one(u.mgr, a, { title: 'Rework', deadline: day(10), approval_required: true });
      await complete(a, rework);
      await act(u.mgr, rework, 'send-back', { reason: 'Quantities do not match the drawing' });
      const genuine = await one(u.mgr, a, { title: 'Genuine dependency', deadline: day(10) });
      await blocker(a, genuine, { blocker_type: 'missing_information', description: 'Customer has not shared the site drawings' });
      await decide(u.mgr, genuine, 'accept', { mode: 'pause', comment: 'Customer confirmed the delay' });
      const excuse = await one(u.mgr, a, { title: 'Weak excuse', deadline: day(10) });
      await blocker(a, excuse, { blocker_type: 'technical_issue', description: 'Laptop was slow for a couple of hours' });
      await decide(u.mgr, excuse, 'reject', { comment: 'Use the office desktop; this is not a blocker' });
    });

    it('§42 highlights all seven signals for the employee, exactly', async () => {
      expect(threshold).toBeGreaterThan(0);
      const dash = await http().get('/api/accountability/dashboard').query(range).set(bearer(u.mgr));
      expect(dash.status).toBe(200);
      const row = dash.body.employees.find((e: any) => e.employee_id === u.acc.id);
      expect(row).toMatchObject({
        due_today: 1,
        due_this_week: 2,
        overdue: 1,
        no_update: 1,
        late_unexcused_window: threshold,
        repeated_delay_flag: true,
        incomplete_work: 1,
        approved_blockers: 1,
        approved_blockers_by_type: { missing_information: 1 },
        rejected_blockers: 1,
        // late without excuse + still open and overdue + rejected blockers
        unapproved_delays: threshold + 2,
      });
      const flags = (await http().get('/api/accountability/flags').set(bearer(u.mgr))).body;
      const forAcc = (list: any[] | undefined) => (list || []).filter((r) => r.assigned_to === u.acc.id || r.employee_id === u.acc.id).length;
      expect({ overdue: forAcc(flags.overdue), no_update: forAcc(flags.no_update), rework: forAcc(flags.rework), rejected: forAcc(flags.rejected_blocker), repeated: forAcc(flags.repeated_delay) }).toEqual({
        overdue: 1,
        no_update: 1,
        rework: 1,
        rejected: 1,
        repeated: 1,
      });
      expect((await http().get('/api/accountability/dashboard').query(range).set(bearer(u.mgr2))).body.employees.some((e: any) => e.employee_id === u.acc.id)).toBe(false);
    });

    it('§43 evidence covers work assigned, completion, deadline compliance, approved blockers, repeated misses and the manager review', async () => {
      const review = await http().post('/api/performance-reviews').set(bearer(u.mgr)).send({ employee_id: u.acc.id, period_from: range.from, period_to: range.to, rating: 3, comments: 'Repeated late submissions; one genuine customer dependency.' });
      expect(review.status).toBe(201);
      expect((await http().post(`/api/performance-reviews/${review.body.id}/submit`).set(bearer(u.mgr)).send({ version: review.body.version })).status).toBe(200);

      const ev = await http().get('/api/performance/evidence').query({ employee_id: u.acc.id, ...range, basis: 'deadline' }).set(bearer(u.mgr));
      expect(ev.status).toBe(200);
      const r = ev.body;
      expect(r.work_assigned.total).toBe(threshold + 7);
      expect(r.completion).toMatchObject({ completed: threshold });
      expect(r.compliance).toMatchObject({ late_unexcused: threshold, open_overdue: 1, on_time: 0 });
      expect(r.blockers).toMatchObject({ accepted: 1, accepted_by_type: { missing_information: 1 }, rejected: 1 });
      expect(r.repeated_misses).toMatchObject({ tasks_reworked_or_reopened: 1, rework_count: 1 });
      expect(r.reviews).toEqual([expect.objectContaining({ rating: 3, reviewer_name: 'BpManager' })]);
      expect(r.disclaimer).toMatch(/supporting evidence only.*authorised management\/accounts/);
    });

    it('§43 the BOS never computes or stores a salary, incentive or deduction; the formal record is for management / accounts', async () => {
      const ev = (await http().get('/api/performance/evidence').query({ employee_id: u.acc.id, ...range }).set(bearer(u.mgr))).body;
      expect(keysOf(ev).filter((k) => MONEY.test(k))).toEqual([]);
      const cols = await sql<{ table_name: string; column_name: string }>`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and (table_name = 'tasks' or table_name like 'task\\_%' or table_name like 'performance\\_%')
          and column_name ~* '(salary|deduct|incentive|penalt|payroll|bonus)'`.execute(db);
      expect(cols.rows).toEqual([]);
      // The employee sees their own evidence; managers review it; only authorised management / accounts freeze a formal snapshot.
      expect((await http().get('/api/performance/evidence').query({ employee_id: u.acc.id, ...range }).set(bearer(u.acc))).status).toBe(200);
      expect((await http().post('/api/performance/evidence/snapshots').set(bearer(u.acc)).send({ employee_id: u.acc.id, ...range })).status).toBe(403);
      expect((await http().post('/api/performance/evidence/snapshots').set(bearer(u.mgr)).send({ employee_id: u.acc.id, ...range })).status).toBe(403);
      const snap = await http().post('/api/performance/evidence/snapshots').set(bearer(u.accounts)).send({ employee_id: u.acc.id, ...range });
      expect(snap.status).toBe(201);
      expect(keysOf(snap.body).filter((k) => MONEY.test(k))).toEqual([]);
    });
  });
});
