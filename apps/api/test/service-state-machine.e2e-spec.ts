import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { addBusinessHours } from '../src/modules/service/service.core';
import { SERVICE_TRANSITIONS, canTransitionService, allowedNextServiceStatuses, type ServiceStatus } from '@arihant/shared';
import { advanceTicket, validReport } from './helpers/service-flow';

/**
 * Module 6 hardening: every rule from the spec's state machine, SLA clock, scoping and
 * validation tables, including the unhappy paths. All test tickets carry the ZZTEST marker and
 * are removed at the end.
 */
describe('Module 6 — workflow hardening, SLA, scoping & validation (edge cases)', () => {
  let app: INestApplication;
  let db: Kysely<any>;

  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};

  let orgN: string; // an organisation in the North zone
  let orgE: string; // an organisation in the East zone
  let productId: string;
  let contactN: string;

  const tomorrow = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const yesterday = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken;
    uid[key] = r.body.user.id;
  }

  async function mk(body: Record<string, any> = {}, who = 'mgmt', org = orgN) {
    const r = await api()
      .post('/api/service/tickets')
      .set(auth(who))
      .send({ organisation_id: org, complaint: 'ZZTEST breakdown on conveyor drive unit', ...body });
    if (r.status !== 201) throw new Error(`mk failed ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  const get = async (id: string, who = 'mgmt') => (await api().get(`/api/service/tickets/${id}`).set(auth(who))).body;
  const patch = (id: string, body: Record<string, any>, who = 'mgmt') =>
    api().patch(`/api/service/tickets/${id}/status`).set(auth(who)).send(body);
  const sql1 = async (q: string) => (await sql.raw(q).execute(db)).rows as any[];

  async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v as T;
      if (Date.now() - start > ms) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    db = app.get(KYSELY_DB);

    await login('mgmt', 'mgmt@arihant.com');
    await login('admin', 'admin@arihant.com');
    await login('rmN', 'regmgr.north@arihant.com');
    await login('rmE', 'regmgr.east@arihant.com');
    await login('svc', 'service@arihant.com');
    await login('svc2', 'service.field@arihant.com');
    await login('sales', 'sales.delhi@arihant.com');
    await login('salesE', 'sales.kolkata@arihant.com');
    await login('accounts', 'accounts@arihant.com');
    await login('demo', 'demo@arihant.com');

    orgN = (await sql1(`select o.id from organisations o join zones z on z.id=o.zone_id where z.code='N' and o.id <> '00000000-0000-4000-8000-0000000000a1' limit 1`))[0].id;
    orgE = (await sql1(`select o.id from organisations o join zones z on z.id=o.zone_id where z.code='E' limit 1`))[0].id;
    productId = (await sql1(`select id from products limit 1`))[0].id;
    let c = (await sql1(`select id from contacts where organisation_id='${orgN}' limit 1`))[0];
    if (!c) c = (await sql1(`insert into contacts (organisation_id, full_name, mobile) values ('${orgN}','ZZTEST Contact','+919800000001') returning id`))[0];
    contactN = c.id;

    // deterministic settings for the whole suite
    for (const [k, v] of Object.entries({ repeat_complaint_window_days: 30, reopen_window_days: 7, auto_escalation_critical_unassigned_hours: 1 })) {
      await api().patch(`/api/service/settings/config/${k}`).set(auth('admin')).send({ value: v });
    }
  });

  afterAll(async () => {
    const ids = (await sql1(`select id from service_tickets where complaint like '%ZZTEST%'`)).map((r) => r.id);
    if (ids.length) {
      const list = ids.map((i) => `'${i}'`).join(',');
      await sql1(`delete from notifications where entity_id in (${list})`);
      await sql1(`delete from audit_log where entity_id in (${list})`);
      await sql1(`delete from outbox_events where aggregate_id in (${list})`);
      await sql1(`delete from service_tickets where id in (${list})`);
    }
    await sql1(`delete from interactions where remarks like '%ZZTEST%'`);
    await sql1(`delete from contacts where full_name like 'ZZTEST%'`);
    await app.close();
  });

  // ===========================================================================
  // 1. Exhaustive transition matrix: every (from → to) pair, allowed or not
  // ===========================================================================
  describe('1. State machine matrix (spec §3)', () => {
    const ALL = Object.keys(SERVICE_TRANSITIONS) as ServiceStatus[];

    it('shared rules: cancelled is terminal, closed only reopens, every status has an entry', () => {
      expect(SERVICE_TRANSITIONS.cancelled).toEqual([]);
      expect(SERVICE_TRANSITIONS.closed).toEqual(['reopened']);
      expect(allowedNextServiceStatuses('new')).toEqual(SERVICE_TRANSITIONS.received); // legacy alias
      expect(allowedNextServiceStatuses('revisit')).toEqual(SERVICE_TRANSITIONS.revisit_required);
      expect(canTransitionService('received', 'closed')).toBe(false);
      expect(canTransitionService('in_progress', 'closed')).toBe(false);
      for (const s of ALL) expect(Array.isArray(SERVICE_TRANSITIONS[s])).toBe(true);
    });

    it(`tries all ${ALL.length * (ALL.length - 1)} ordered status pairs against the API`, async () => {
      const t = await mk({ priority: 'high' });
      const mismatches: string[] = [];

      for (const from of ALL) {
        for (const to of ALL) {
          if (from === to) continue;
          if (to === 'closed') continue; // closing has its own rules (section 6)

          await sql1(
            `update service_tickets set status='${from}', assigned_to='${uid.svc}', assigned_engineer_id='${uid.svc}', planned_visit_date=current_date + 1,
              closed_at=${from === 'closed' ? 'now()' : 'null'}, sla_pause_started_at=null, version=version+1 where id='${t.id}'`,
          );
          const body: Record<string, any> = {
            status: to,
            remarks: `ZZTEST matrix move ${from} to ${to} with a proper reason`,
            assigned_to: uid.svc,
            planned_visit_date: tomorrow(),
          };
          const r = await patch(t.id, body);

          const expectOk = to !== 'report_submitted' && canTransitionService(from, to);
          const ok = r.status === 200;
          if (ok !== expectOk) mismatches.push(`${from} → ${to}: expected ${expectOk ? 200 : 400}, got ${r.status} ${JSON.stringify(r.body.message)}`);
          if (!ok && r.status !== 400) mismatches.push(`${from} → ${to}: expected a clean 400, got ${r.status}`);
          if (ok && r.body.status !== to) mismatches.push(`${from} → ${to}: status came back ${r.body.status}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('exposes allowed_next_statuses on every ticket so the UI offers only legal buttons', async () => {
      const t = await mk();
      const detail = await get(t.id);
      expect(detail.allowed_next_statuses).toEqual(SERVICE_TRANSITIONS.received);
      const list = await api().get(`/api/service/tickets?search=${t.ticket_no}`).set(auth('mgmt'));
      expect(list.body.data[0].allowed_next_statuses).toEqual(SERVICE_TRANSITIONS.received);
    });

    it('names the legal next steps in the error for an illegal jump', async () => {
      const t = await mk();
      const r = await patch(t.id, { status: 'resolved', remarks: 'Trying to skip the whole workflow' });
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('Cannot move a ticket from received to resolved');
      expect(r.body.message).toContain('assigned');
    });

    it('rejects an unknown status and a same-status no-op with a clear 400', async () => {
      const t = await mk();
      expect((await patch(t.id, { status: 'teleported' })).status).toBe(400);
      const same = await patch(t.id, { status: 'received' });
      expect(same.status).toBe(400);
      expect(same.body.message).toContain('already');
    });

    it('cannot reach report_submitted or closed through the status endpoint shortcut', async () => {
      const t = await mk();
      const a = await patch(t.id, { status: 'report_submitted' });
      expect(a.status).toBe(400);
      expect(a.body.message).toContain('report');
      const b = await patch(t.id, { status: 'closed' });
      expect(b.status).toBe(400); // delegated to the close rules: no report on file
    });
  });

  // ===========================================================================
  // 2. Guards on individual transitions
  // ===========================================================================
  describe('2. Transition guards', () => {
    it('assigned needs an engineer; the engineer must exist, be active and be a service engineer', async () => {
      const t = await mk();
      expect((await patch(t.id, { status: 'assigned' })).status).toBe(400);
      expect((await patch(t.id, { status: 'assigned', assigned_to: 'not-a-uuid' })).status).toBe(400);
      expect((await patch(t.id, { status: 'assigned', assigned_to: '99999999-9999-4999-8999-999999999999' })).status).toBe(400);
      const asSales = await patch(t.id, { status: 'assigned', assigned_to: uid.sales });
      expect(asSales.status).toBe(400);
      expect(asSales.body.message).toContain('Service Team');

      await sql1(`update users set is_active=false where id='${uid.svc2}'`);
      try {
        const inactive = await patch(t.id, { status: 'assigned', assigned_to: uid.svc2 });
        expect(inactive.status).toBe(400);
        expect(inactive.body.message).toContain('deactivated');
      } finally {
        await sql1(`update users set is_active=true where id='${uid.svc2}'`);
      }
      expect((await patch(t.id, { status: 'assigned', assigned_to: uid.svc })).status).toBe(200);
    });

    it('visit_scheduled needs an engineer and a real, non-past date unless a manager overrides', async () => {
      const t = await mk();
      expect((await patch(t.id, { status: 'visit_scheduled', planned_visit_date: tomorrow() })).status).toBe(400); // no engineer
      await patch(t.id, { status: 'assigned', assigned_to: uid.svc });
      expect((await patch(t.id, { status: 'visit_scheduled' })).status).toBe(400); // no date
      expect((await patch(t.id, { status: 'visit_scheduled', planned_visit_date: 'tomorrow' })).status).toBe(400);
      expect((await patch(t.id, { status: 'visit_scheduled', planned_visit_date: '2026-02-31' })).status).toBe(400);
      const past = await patch(t.id, { status: 'visit_scheduled', planned_visit_date: yesterday() });
      expect(past.status).toBe(400);
      expect(past.body.message).toContain('past');
      // a field engineer cannot override, a manager can
      expect((await patch(t.id, { status: 'visit_scheduled', planned_visit_date: yesterday(), manager_override: true }, 'svc')).status).toBe(400);
      const ok = await patch(t.id, { status: 'visit_scheduled', planned_visit_date: yesterday(), manager_override: true }, 'mgmt');
      expect(ok.status).toBe(200);
    });

    it('exception and pause states demand a written reason', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      for (const to of ['awaiting_part', 'awaiting_customer', 'escalated', 'on_hold', 'revisit_required']) {
        const none = await patch(t.id, { status: to });
        expect(none.status).toBe(400);
        const short = await patch(t.id, { status: to, remarks: 'no' });
        expect(short.status).toBe(400);
        expect(short.body.message).toContain('reason');
      }
    });

    it('resolved needs rectification details or an existing report', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      expect((await patch(t.id, { status: 'resolved' })).status).toBe(400);
      expect((await patch(t.id, { status: 'resolved', remarks: 'fixed' })).status).toBe(400);
      const ok = await patch(t.id, { status: 'resolved', remarks: 'Replaced the drive board and load-tested for an hour' });
      expect(ok.status).toBe(200);
      const after = await get(t.id);
      expect(after.resolved_at).toBeTruthy();
      // going back to work clears resolved_at
      expect((await patch(t.id, { status: 'in_progress' }, 'svc')).status).toBe(200);
      expect((await get(t.id)).resolved_at).toBeNull();
    });

    it('engineers may self-assign but not assign someone else; sales cannot change status at all', async () => {
      const t = await mk();
      const other = await patch(t.id, { status: 'assigned', assigned_to: uid.svc2 }, 'svc');
      expect(other.status).toBe(403);
      expect((await patch(t.id, { status: 'assigned', assigned_to: uid.svc }, 'svc')).status).toBe(200);
      expect((await patch(t.id, { status: 'cancelled', remarks: 'Sales trying to cancel' }, 'sales')).status).toBe(403);
      expect((await patch(t.id, { status: 'cancelled', remarks: 'Accounts trying to cancel' }, 'accounts')).status).toBe(403);
    });

    it('records every transition in status history with the actor and a reason', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const d = await get(t.id);
      const chain = d.status_history.map((h: any) => h.to_status).reverse();
      expect(chain).toEqual(['received', 'assigned', 'visit_scheduled', 'in_progress']);
      expect(d.status_history.every((h: any) => h.changed_by)).toBe(true);
      expect(d.assignment_history.length).toBe(1);
    });
  });

  // ===========================================================================
  // 3. Roles on specific transitions: escalate / reopen / cancel
  // ===========================================================================
  describe('3. Role-gated transitions', () => {
    it('only managers can de-escalate', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      expect((await patch(t.id, { status: 'escalated', remarks: 'Needs OEM firmware specialist' }, 'svc')).status).toBe(200);
      const engineer = await patch(t.id, { status: 'in_progress' }, 'svc');
      expect(engineer.status).toBe(403);
      expect(engineer.body.message).toContain('de-escalate');
      expect((await patch(t.id, { status: 'in_progress' }, 'rmN')).status).toBe(200);
    });

    async function closedTicket(ageDays = 0) {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      expect((await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport())).status).toBe(201);
      expect((await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({})).status).toBe(201);
      if (ageDays) await sql1(`update service_tickets set closed_at = now() - interval '${ageDays} days' where id='${t.id}'`);
      return t;
    }

    it('reopen: management/admin only, reason mandatory, inside the window, and it restarts the SLA', async () => {
      const t = await closedTicket();
      const body = { status: 'reopened', remarks: 'Customer says the stall is back' };
      expect((await patch(t.id, body, 'svc')).status).toBe(403);
      expect((await patch(t.id, body, 'rmN')).status).toBe(403);
      expect((await patch(t.id, { status: 'reopened' }, 'mgmt')).status).toBe(400); // reason missing
      const before = await get(t.id);
      const ok = await patch(t.id, body, 'mgmt');
      expect(ok.status).toBe(200);
      const after = await get(t.id);
      expect(after.status).toBe('reopened');
      expect(after.closed_at).toBeNull();
      expect(after.reopened_count).toBe(1);
      expect(new Date(after.sla_resolution_due_at).getTime()).toBeGreaterThan(new Date(before.sla_resolution_due_at).getTime() - 1000);
      // a reopened ticket continues through the normal path
      expect((await patch(t.id, { status: 'assigned', assigned_to: uid.svc })).status).toBe(200);
    });

    it('reopen window: refused once reopen_window_days have passed', async () => {
      const t = await closedTicket(10);
      const r = await patch(t.id, { status: 'reopened', remarks: 'Late complaint from the customer' }, 'admin');
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('window');
    });

    it('a closed ticket accepts nothing but a reopen', async () => {
      const t = await closedTicket();
      for (const to of ['in_progress', 'assigned', 'resolved', 'cancelled']) {
        const r = await patch(t.id, { status: to, remarks: 'Attempt to modify a closed ticket' }, 'mgmt');
        expect(r.status).toBe(400);
        expect(r.body.message).toContain('closed');
      }
      expect((await api().post(`/api/service/tickets/${t.id}/visits`).set(auth('mgmt')).send({})).status).toBe(400);
      expect((await api().post(`/api/service/tickets/${t.id}/part-requests`).set(auth('svc')).send({ part_name: 'Roller belt' })).status).toBe(400);
    });

    it('cancelled is terminal and releases reserved spares', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const pr = await api().post(`/api/service/tickets/${t.id}/part-requests`).set(auth('svc')).send({ part_name: 'Drive board DB-24', quantity: 2 });
      expect(pr.status).toBe(201);
      await api().patch(`/api/service/tickets/${t.id}/part-requests/${pr.body.id}/status`).set(auth('mgmt')).send({ status: 'Reserved' });

      // work in progress cannot simply be cancelled (spec); the ticket has to be parked first
      expect((await patch(t.id, { status: 'cancelled', remarks: 'Cancelling straight from in_progress' })).status).toBe(400);
      expect((await patch(t.id, { status: 'awaiting_part', remarks: 'Waiting for the drive board from depot' }, 'svc')).status).toBe(200);
      expect((await patch(t.id, { status: 'cancelled' })).status).toBe(400); // reason needed
      expect((await patch(t.id, { status: 'cancelled', remarks: 'Customer withdrew the complaint' })).status).toBe(200);
      const d = await get(t.id);
      expect(d.part_requests[0].status).toBe('Cancelled');
      expect(d.cancelled_at).toBeTruthy();
      for (const to of ['in_progress', 'assigned', 'reopened', 'closed']) {
        expect((await patch(t.id, { status: to, remarks: 'Trying to revive a cancelled ticket', assigned_to: uid.svc })).status).toBe(400);
      }
      expect((await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport())).status).toBe(400);
    });
  });

  // ===========================================================================
  // 4. Closure rules
  // ===========================================================================
  describe('4. Closure & report approval', () => {
    it('cannot close before work is reported; cancelled tickets cannot be closed', async () => {
      const t = await mk();
      for (const step of ['received', 'in_progress']) {
        if (step === 'in_progress') await advanceTicket(app, t.id, tok.mgmt, uid.svc, 'in_progress');
        const r = await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({});
        expect(r.status).toBe(400);
        expect(r.body.message).toContain('service report');
      }
      const c = await mk();
      await patch(c.id, { status: 'cancelled', remarks: 'Duplicate of another ticket' });
      expect((await api().post(`/api/service/tickets/${c.id}/close`).set(auth('mgmt')).send({})).status).toBe(400);
    });

    it('the engineer needs a manager-approved report to close; management auto-approves on close', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const rep = await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport());
      expect(rep.status).toBe(201);

      const byEngineer = await api().post(`/api/service/tickets/${t.id}/close`).set(auth('svc')).send({});
      expect(byEngineer.status).toBe(403);
      expect(byEngineer.body.message).toContain('approved');

      expect((await api().post(`/api/service/tickets/${t.id}/reports/${rep.body.id}/review`).set(auth('rmN')).send({ approved: true })).status).toBe(201);
      expect((await api().post(`/api/service/tickets/${t.id}/close`).set(auth('svc')).send({})).status).toBe(201);
      const d = await get(t.id);
      expect(d.status).toBe('closed');
      expect(d.closed_at).toBeTruthy();
      expect(d.reports[0].approved_by).toBeTruthy();
      // idempotent
      expect((await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({})).status).toBe(201);
    });

    it('a report returned for correction blocks closure until a new report is filed', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const rep = await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport());
      await api().post(`/api/service/tickets/${t.id}/reports/${rep.body.id}/review`).set(auth('mgmt')).send({ approved: false, return_reason: 'Voucher photo is unreadable' });
      const blocked = await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({});
      expect(blocked.status).toBe(400);
      const d = await get(t.id);
      expect(d.status).toBe('in_progress');
    });

    it('closing without customer confirmation needs an explicit remark', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const rep = await api()
        .post(`/api/service/tickets/${t.id}/report`)
        .set(auth('svc'))
        .send(validReport({ customer_confirmation: false, customer_confirmation_type: 'Not Obtained', customer_name_signed: undefined, confirmation_not_obtained_reason: 'Station officer was on leave' }));
      expect(rep.status).toBe(201);
      const noRemark = await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({});
      expect(noRemark.status).toBe(400);
      expect(noRemark.body.message).toContain('confirmation');
      expect((await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({ remarks: 'Closed after phone confirmation from the SHO' })).status).toBe(201);
    });

    it('review endpoint: only submitted reports, reason required to return, unknown ids are 404', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const rep = await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport());
      const url = `/api/service/tickets/${t.id}/reports/${rep.body.id}/review`;
      expect((await api().post(url).set(auth('mgmt')).send({ approved: false })).status).toBe(400);
      expect((await api().post(url).set(auth('mgmt')).send({ approved: false, return_reason: 'ok' })).status).toBe(400);
      expect((await api().post(url).set(auth('svc')).send({ approved: true })).status).toBe(403);
      expect((await api().post(url).set(auth('mgmt')).send({ approved: true })).status).toBe(201);
      expect((await api().post(url).set(auth('mgmt')).send({ approved: true })).status).toBe(400); // already approved
      expect((await api().post(`/api/service/tickets/${t.id}/reports/abc/review`).set(auth('mgmt')).send({ approved: true })).status).toBe(404);
      expect((await api().post(`/api/service/tickets/${t.id}/reports/99999999-9999-4999-8999-999999999999/review`).set(auth('mgmt')).send({ approved: true })).status).toBe(404);
    });
  });

  // ===========================================================================
  // 5. Optimistic locking & concurrency
  // ===========================================================================
  describe('5. Concurrency', () => {
    it('an outdated version is a 409; a fresh version succeeds', async () => {
      const t = await mk();
      const v = (await get(t.id)).version;
      expect((await patch(t.id, { status: 'assigned', assigned_to: uid.svc, version: v })).status).toBe(200);
      const stale = await patch(t.id, { status: 'escalated', remarks: 'Escalating with a stale version', version: v });
      expect(stale.status).toBe(409);
      expect(stale.body.message).toContain('version mismatch');
    });

    it('two simultaneous updates: exactly one wins, the loser gets 409/400, never a corrupted state', async () => {
      const t = await mk();
      const rs = await Promise.all([
        patch(t.id, { status: 'assigned', assigned_to: uid.svc }),
        patch(t.id, { status: 'escalated', remarks: 'Escalated at the very same moment' }, 'rmN'),
      ]);
      const codes = rs.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 200).length).toBe(1);
      expect(codes.every((c) => [200, 400, 409].includes(c))).toBe(true);
      const d = await get(t.id);
      expect(['assigned', 'escalated']).toContain(d.status);
      expect(d.status_history.length).toBe(2); // creation + exactly one transition
    });

    it('20 parallel ticket creations get 20 distinct, well-formed ticket numbers', async () => {
      const rs = await Promise.all(Array.from({ length: 20 }, () => api().post('/api/service/tickets').set(auth('mgmt')).send({ organisation_id: orgN, complaint: 'ZZTEST parallel creation stress ticket' })));
      expect(rs.every((r) => r.status === 201)).toBe(true);
      const nos = rs.map((r) => r.body.ticket_no);
      expect(new Set(nos).size).toBe(20);
      nos.forEach((n) => expect(n).toMatch(/^TCK-\d{4}-\d{6,}$/));
    });
  });

  // ===========================================================================
  // 6. SLA: rules table, business hours, pause/resume, timestamps
  // ===========================================================================
  describe('6. SLA clock', () => {
    const ist = (iso: string) => new Date(`${iso}+05:30`);
    const istStr = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16);

    it('addBusinessHours: Mon–Sat 09:00–18:00 IST, Sunday off', () => {
      // 2026-10-09 is a Friday, 2026-10-10 a Saturday, 2026-10-11 a Sunday
      expect(istStr(addBusinessHours(ist('2026-10-09T17:00:00'), 2))).toBe('2026-10-10T10:00'); // spills into Saturday
      expect(istStr(addBusinessHours(ist('2026-10-10T17:30:00'), 2))).toBe('2026-10-12T10:30'); // Sunday skipped
      expect(istStr(addBusinessHours(ist('2026-10-09T07:00:00'), 1))).toBe('2026-10-09T10:00'); // before opening
      expect(istStr(addBusinessHours(ist('2026-10-09T18:00:00'), 1))).toBe('2026-10-10T10:00'); // exactly at closing
      expect(istStr(addBusinessHours(ist('2026-10-11T12:00:00'), 1))).toBe('2026-10-12T10:00'); // started on a Sunday
      expect(istStr(addBusinessHours(ist('2026-10-09T10:00:00'), 0))).toBe('2026-10-09T10:00'); // zero hours
      expect(istStr(addBusinessHours(ist('2026-10-09T10:00:00'), 18))).toBe('2026-10-12T10:00'); // two full working days
    });

    it('critical tickets run 24x7; other priorities honour business hours', async () => {
      const crit = await mk({ priority: 'critical' });
      const c = await get(crit.id);
      const dResp = new Date(c.sla_response_due_at).getTime() - new Date(c.created_at).getTime();
      expect(dResp).toBeGreaterThan(2 * 3600000 - 90000);
      expect(dResp).toBeLessThan(2 * 3600000 + 90000);

      const low = await mk({ priority: 'low' });
      const l = await get(low.id);
      const due = new Date(l.sla_resolution_due_at);
      const dueIst = new Date(due.getTime() + 330 * 60000);
      expect(dueIst.getUTCDay()).not.toBe(0); // never lands on a Sunday
      expect(dueIst.getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(dueIst.getUTCHours() + dueIst.getUTCMinutes() / 60).toBeLessThanOrEqual(18);
      expect(due.getTime()).toBeGreaterThan(new Date(l.created_at).getTime() + 72 * 3600000 - 90000); // at least 72 wall-clock hours
    });

    it('SLA targets come from the configurable table, per coverage type', async () => {
      const rules = (await api().get('/api/service/settings/sla-rules').set(auth('mgmt'))).body;
      const combos = new Set(rules.map((r: any) => `${r.priority}/${r.warranty_type}`));
      for (const p of ['critical', 'high', 'medium', 'low']) for (const w of ['in_warranty', 'amc', 'out_of_warranty']) expect(combos.has(`${p}/${w}`)).toBe(true);

      const rule = rules.find((r: any) => r.priority === 'critical' && r.warranty_type === 'amc');
      const orig = rule.response_hours;
      try {
        const up = await api().patch(`/api/service/settings/sla-rules/${rule.id}`).set(auth('admin')).send({ response_hours: 3 });
        expect(up.status).toBe(200);
        const t = await mk({ priority: 'critical', warranty_status: 'amc' });
        const d = await get(t.id);
        const hrs = (new Date(d.sla_response_due_at).getTime() - new Date(d.created_at).getTime()) / 3600000;
        expect(hrs).toBeGreaterThan(2.95);
        expect(hrs).toBeLessThan(3.05);
      } finally {
        await api().patch(`/api/service/settings/sla-rules/${rule.id}`).set(auth('admin')).send({ response_hours: orig });
      }
    });

    it('SLA rule edits are validated and restricted to management/admin', async () => {
      const rules = (await api().get('/api/service/settings/sla-rules').set(auth('mgmt'))).body;
      const id = rules[0].id;
      expect((await api().patch(`/api/service/settings/sla-rules/${id}`).set(auth('svc')).send({ response_hours: 5 })).status).toBe(403);
      expect((await api().patch(`/api/service/settings/sla-rules/${id}`).set(auth('admin')).send({ response_hours: 0 })).status).toBe(400);
      expect((await api().patch(`/api/service/settings/sla-rules/${id}`).set(auth('admin')).send({ response_hours: 100000 })).status).toBe(400);
      expect((await api().patch(`/api/service/settings/sla-rules/${id}`).set(auth('admin')).send({ response_hours: 500, resolution_hours: 10 })).status).toBe(400);
      expect((await api().patch(`/api/service/settings/sla-rules/abc`).set(auth('admin')).send({ response_hours: 5 })).status).toBe(404);
    });

    it('waiting for a part / the customer pauses the clock and resuming slides the deadline', async () => {
      const t = await advanceTicket(app, (await mk({ priority: 'high' })).id, tok.mgmt, uid.svc, 'in_progress');
      const before = await get(t.id);
      expect(before.first_response_at).toBeTruthy(); // set when work began

      expect((await patch(t.id, { status: 'awaiting_part', remarks: 'Waiting for the drive board from depot' }, 'svc')).status).toBe(200);
      const paused = await get(t.id);
      expect(paused.sla_pause_started_at).toBeTruthy();
      expect(paused.status_history[0].sla_impact).toBe('paused');
      expect(paused.sla_breached).toBe(false);

      // move straight between two pause states: still one continuous pause
      expect((await patch(t.id, { status: 'escalated', remarks: 'Escalating while still waiting for the part' }, 'svc')).status).toBe(200);
      await sql1(`update service_tickets set status='awaiting_part', sla_pause_started_at = now() - interval '90 minutes', version=version+1 where id='${t.id}'`);
      expect((await patch(t.id, { status: 'in_progress' }, 'svc')).status).toBe(200);
      const resumed = await get(t.id);
      expect(resumed.sla_pause_started_at).toBeNull();
      expect(resumed.sla_paused_minutes).toBeGreaterThanOrEqual(90);
      expect(resumed.status_history[0].sla_impact).toBe('resumed');
      const slid = new Date(resumed.sla_resolution_due_at).getTime() - new Date(before.sla_resolution_due_at).getTime();
      expect(slid).toBeGreaterThanOrEqual(90 * 60000 - 5000);
    });

    it('a ticket paused past its deadline is not counted as breached or overdue', async () => {
      const t = await advanceTicket(app, (await mk({ priority: 'critical' })).id, tok.mgmt, uid.svc, 'in_progress');
      await patch(t.id, { status: 'awaiting_customer', remarks: 'Waiting for site access clearance' }, 'svc');
      await sql1(`update service_tickets set sla_resolution_due_at = now() - interval '2 hours' where id='${t.id}'`);
      expect((await get(t.id)).sla_breached).toBe(false);
      const sweep = await api().post('/api/service/maintenance/sweep').set(auth('mgmt'));
      expect(sweep.status).toBe(201);
      const flagged = await sql1(`select sla_resolution_breach_notified_at from service_tickets where id='${t.id}'`);
      expect(flagged[0].sla_resolution_breach_notified_at).toBeNull();
    });
  });

  // ===========================================================================
  // 7. Repeat complaints (configurable window)
  // ===========================================================================
  describe('7. Repeat complaint detection', () => {
    it('flags the second fault on the same serial inside the window and links it to the first', async () => {
      const serial = `ZZTEST-SER-${Date.now()}`;
      const first = await mk({ equipment_serial: serial });
      expect(first.is_repeat_complaint).toBe(false);
      const second = await mk({ equipment_serial: serial });
      expect(second.is_repeat_complaint).toBe(true);
      expect(second.parent_ticket_id).toBe(first.id);
      const detail = await get(second.id);
      expect(detail.repeat_count).toBe(1);
      expect(detail.repeat_window_days).toBe(30);
    });

    it('older than the window, cancelled, other serial or other customer: not a repeat', async () => {
      const serial = `ZZTEST-AGE-${Date.now()}`;
      const old = await mk({ equipment_serial: serial });
      await sql1(`update service_tickets set created_at = now() - interval '45 days' where id='${old.id}'`);
      expect((await mk({ equipment_serial: serial })).is_repeat_complaint).toBe(false);

      const serial2 = `ZZTEST-CAN-${Date.now()}`;
      const cancelled = await mk({ equipment_serial: serial2 });
      await patch(cancelled.id, { status: 'cancelled', remarks: 'Raised by mistake, ignore' });
      expect((await mk({ equipment_serial: serial2 })).is_repeat_complaint).toBe(false);

      const serial3 = `ZZTEST-ORG-${Date.now()}`;
      await mk({ equipment_serial: serial3 });
      expect((await mk({ equipment_serial: serial3 }, 'mgmt', orgE)).is_repeat_complaint).toBe(false);
      expect((await mk({ equipment_serial: `${serial3}-B` })).is_repeat_complaint).toBe(false);
    });

    it('widening the window via settings changes the verdict immediately', async () => {
      const serial = `ZZTEST-WIN-${Date.now()}`;
      const old = await mk({ equipment_serial: serial });
      await sql1(`update service_tickets set created_at = now() - interval '45 days' where id='${old.id}'`);
      await api().patch('/api/service/settings/config/repeat_complaint_window_days').set(auth('admin')).send({ value: 90 });
      try {
        expect((await mk({ equipment_serial: serial })).is_repeat_complaint).toBe(true);
      } finally {
        await api().patch('/api/service/settings/config/repeat_complaint_window_days').set(auth('admin')).send({ value: 30 });
      }
    });

    it('settings API validates keys and numeric ranges', async () => {
      expect((await api().patch('/api/service/settings/config/repeat_complaint_window_days').set(auth('admin')).send({ value: 'lots' })).status).toBe(400);
      expect((await api().patch('/api/service/settings/config/repeat_complaint_window_days').set(auth('admin')).send({ value: -5 })).status).toBe(400);
      expect((await api().patch('/api/service/settings/config/Bad-Key!').set(auth('admin')).send({ value: 1 })).status).toBe(400);
      expect((await api().patch('/api/service/settings/config/repeat_complaint_window_days').set(auth('svc')).send({ value: 30 })).status).toBe(403);
    });
  });

  // ===========================================================================
  // 8. Creation validation
  // ===========================================================================
  describe('8. Ticket creation validation', () => {
    const post = (body: Record<string, any>, who = 'mgmt') => api().post('/api/service/tickets').set(auth(who)).send(body);

    it('rejects bad inputs with 4xx, never a 500', async () => {
      const base = { organisation_id: orgN, complaint: 'ZZTEST valid base complaint text' };
      const cases: [string, Record<string, any>, number][] = [
        ['complaint under 10 chars', { complaint: 'too short' }, 400],
        ['whitespace-only complaint', { complaint: '          ' }, 400],
        ['complaint that is only HTML tags', { complaint: '<b></b><i></i><u></u>' }, 400],
        ['unknown organisation', { organisation_id: '99999999-9999-4999-8999-999999999999' }, 400],
        ['invalid problem category', { problem_category: 'Haunted' }, 400],
        ['invalid complaint source', { complaint_source: 'Carrier pigeon' }, 400],
        ['invalid warranty status', { warranty_status: 'lifetime' }, 400],
        ['invalid priority', { priority: 'apocalyptic' }, 400],
        ['product not found', { product_id: '99999999-9999-4999-8999-999999999999' }, 400],
        ['contact of another organisation', { contact_id: '99999999-9999-4999-8999-999999999999' }, 400],
        ['custom ticket number with spaces', { ticket_no: 'bad number!' }, 400],
        ['serial longer than 80 chars', { equipment_serial: 'S'.repeat(81) }, 400],
        ['visit date without an engineer', { planned_visit_date: tomorrow() }, 400],
        ['visit date in the past', { assigned_to: uid.svc, planned_visit_date: yesterday() }, 400],
        ['not a date', { assigned_to: uid.svc, planned_visit_date: 'soon' }, 400],
        ['assigning a sales user as engineer', { assigned_to: uid.sales }, 400],
        ['parent ticket not found', { parent_ticket_id: '99999999-9999-4999-8999-999999999999' }, 400],
      ];
      for (const [name, over, code] of cases) {
        const r = await post({ ...base, ...over });
        if (r.status !== code) throw new Error(`${name}: expected ${code}, got ${r.status} ${JSON.stringify(r.body)}`);
      }
    });

    it('contact must belong to the organisation; a contact of the right org is accepted', async () => {
      const wrongOrg = await post({ organisation_id: orgE, complaint: 'ZZTEST contact mismatch check', contact_id: contactN });
      expect(wrongOrg.status).toBe(400);
      expect(wrongOrg.body.message).toContain('does not belong');
      expect((await post({ organisation_id: orgN, complaint: 'ZZTEST contact match check', contact_id: contactN })).status).toBe(201);
    });

    it('custom ticket numbers are unique (409) and keep their value', async () => {
      const no = `ZZTEST-GEM-${Date.now()}`;
      expect((await post({ organisation_id: orgN, complaint: 'ZZTEST custom numbered ticket', ticket_no: no })).body.ticket_no).toBe(no);
      expect((await post({ organisation_id: orgN, complaint: 'ZZTEST custom numbered ticket 2', ticket_no: no })).status).toBe(409);
    });

    it('role rules: only managers set the chargeable flag / warranty override; sales cannot assign', async () => {
      const base = { organisation_id: orgN, complaint: 'ZZTEST role rules on creation' };
      expect((await post({ ...base, is_chargeable: true }, 'svc')).status).toBe(403);
      expect((await post({ ...base, warranty_override: true }, 'svc')).status).toBe(403);
      expect((await post({ ...base, assigned_to: uid.svc }, 'sales')).status).toBe(403);
      expect((await post({ ...base, assigned_to: uid.svc2 }, 'svc')).status).toBe(403);
      const self = await post({ ...base, assigned_to: uid.svc }, 'svc');
      expect(self.status).toBe(201);
      expect(self.body.status).toBe('assigned');
      expect(self.body.first_response_at).toBeTruthy();
      expect((await post({ ...base, is_chargeable: true }, 'rmN')).status).toBe(201);
      expect((await post(base, 'accounts')).status).toBe(403);
    });

    it('derives chargeability and billing status from the coverage type', async () => {
      const oow = await mk({ warranty_status: 'out_of_warranty' });
      expect(oow.is_chargeable).toBe(true);
      expect(oow.billing_status).toBe('invoice_pending');
      const wty = await mk({ warranty_status: 'in_warranty' });
      expect(wty.is_chargeable).toBe(false);
      expect(wty.billing_status).toBe('not_chargeable');
      expect(wty.warranty_status_snapshot).toBe('in_warranty');
    });

    it('cleans HTML/control characters from free text and keeps unicode intact', async () => {
      const r = await mk({ complaint: 'ZZTEST <script>alert(1)</script>XBIS belt jam \u0007 on गेट नंबर 3', location: '<img src=x onerror=1>Gate 3' });
      const d = await get(r.id);
      expect(d.complaint).not.toContain('<script>');
      expect(d.complaint).not.toContain('\u0007');
      expect(d.complaint).toContain('गेट नंबर 3');
      expect(d.location).toBe('Gate 3');
    });

    it('SQL-looking input is stored as inert text', async () => {
      const r = await mk({ complaint: "ZZTEST '; DROP TABLE service_tickets; -- scanner fault", equipment_serial: "X'; --" });
      expect(r.id).toBeDefined();
      expect((await api().get('/api/service/stats').set(auth('mgmt'))).status).toBe(200);
    });

    it('writes a customer-timeline interaction and an audit entry on creation', async () => {
      const t = await mk({ complaint: 'ZZTEST timeline on create for customer history' });
      const rows = await sql1(`select id from interactions where remarks like '%${t.ticket_no}%' and type='service'`);
      expect(rows.length).toBe(1);
      const audit = await waitFor(async () => (await sql1(`select id from audit_log where entity_id='${t.id}' and action='create'`))[0]);
      expect(audit).toBeTruthy();
    });
  });

  // ===========================================================================
  // 9. Visits
  // ===========================================================================
  describe('9. Visits: scheduling, check-in/out and their side effects', () => {
    async function scheduled() {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'visit_scheduled');
      const v = await api().post(`/api/service/tickets/${t.id}/visits`).set(auth('mgmt')).send({});
      expect(v.status).toBe(201);
      return { t, v: v.body };
    }
    const checkIn = (t: any, v: any, body: any = {}, who = 'svc') => api().patch(`/api/service/tickets/${t.id}/visits/${v.id}/check-in`).set(auth(who)).send(body);
    const checkOut = (t: any, v: any, body: any = {}, who = 'svc') => api().patch(`/api/service/tickets/${t.id}/visits/${v.id}/check-out`).set(auth(who)).send(body);

    it('scheduling rejects an end before the start, bad dates and non-engineers', async () => {
      const t = await mk();
      const url = `/api/service/tickets/${t.id}/visits`;
      const start = new Date(Date.now() + 7200000).toISOString();
      const end = new Date(Date.now() + 3600000).toISOString();
      expect((await api().post(url).set(auth('mgmt')).send({ scheduled_start: start, scheduled_end: end })).status).toBe(400);
      expect((await api().post(url).set(auth('mgmt')).send({ engineer_ids: [uid.sales] })).status).toBe(400);
      expect((await api().post(url).set(auth('svc')).send({})).status).toBe(201); // engineers may plan their own visit
      expect((await api().post(url).set(auth('sales')).send({})).status).toBe(403);
    });

    it('visit numbers increment per ticket', async () => {
      const t = await mk();
      const a = await api().post(`/api/service/tickets/${t.id}/visits`).set(auth('mgmt')).send({});
      const b = await api().post(`/api/service/tickets/${t.id}/visits`).set(auth('mgmt')).send({});
      expect([a.body.visit_number, b.body.visit_number]).toEqual([1, 2]);
    });

    it('check-in starts work, validates GPS and time, and cannot be repeated', async () => {
      const { t, v } = await scheduled();
      expect((await checkIn(t, v, { check_in_lat: 91, check_in_lng: 77 })).status).toBe(400);
      expect((await checkIn(t, v, { check_in_lat: 28, check_in_lng: 181 })).status).toBe(400);
      expect((await checkIn(t, v, { actual_check_in: new Date(Date.now() + 3600000).toISOString() })).status).toBe(400);
      expect((await checkIn(t, v, { actual_check_in: 'yesterday-ish' })).status).toBe(400);
      expect((await checkIn(t, v, {}, 'svc2')).status).toBe(403); // not the assigned engineer
      const ok = await checkIn(t, v, { check_in_lat: 28.5562, check_in_lng: 77.1 });
      expect(ok.status).toBe(200);
      expect((await get(t.id)).status).toBe('in_progress');
      const again = await checkIn(t, v);
      expect(again.status).toBe(400);
      expect(again.body.message).toContain('already');
    });

    it('check-out needs a prior check-in, a sane time and notes for non-clean outcomes', async () => {
      const { t, v } = await scheduled();
      expect((await checkOut(t, v)).status).toBe(400); // never checked in
      await checkIn(t, v);
      expect((await checkOut(t, v, { visit_outcome: 'Teleported' })).status).toBe(400);
      expect((await checkOut(t, v, { visit_outcome: 'Part Required' })).status).toBe(400); // notes missing
      expect((await checkOut(t, v, { actual_check_out: new Date(Date.now() - 86400000).toISOString() })).status).toBe(400);
      expect((await checkOut(t, v, { visit_outcome: 'Completed' })).status).toBe(200);
      expect((await checkOut(t, v)).status).toBe(400); // twice
    });

    it.each([
      ['Customer Not Available', 'awaiting_customer'],
      ['Part Required', 'awaiting_part'],
      ['Escalation Needed', 'escalated'],
      ['Revisit Required', 'revisit_required'],
      ['Partially Completed', 'in_progress'],
      ['Completed', 'in_progress'],
    ])('outcome "%s" moves the ticket to %s', async (outcome, expected) => {
      const { t, v } = await scheduled();
      await checkIn(t, v);
      const r = await checkOut(t, v, { visit_outcome: outcome, notes: 'ZZTEST detailed field notes for this visit' });
      expect(r.status).toBe(200);
      const d = await get(t.id);
      expect(d.status).toBe(expected);
      if (expected !== 'in_progress') expect(d.status_history[0].to_status).toBe(expected);
    });

    it('a visit cannot be checked in while the ticket is waiting on something else it cannot resume from', async () => {
      const { t, v } = await scheduled();
      await checkIn(t, v);
      await patch(t.id, { status: 'resolved', remarks: 'Fault rectified during the first visit' });
      const v2 = await api().post(`/api/service/tickets/${t.id}/visits`).set(auth('mgmt')).send({});
      const r = await checkIn(t, v2.body);
      expect(r.status).toBe(400);
    });
  });

  // ===========================================================================
  // 10. Service reports
  // ===========================================================================
  describe('10. Service report validation (§33)', () => {
    const file = (id: string, body: any, who = 'svc') => api().post(`/api/service/tickets/${id}/report`).set(auth(who)).send(body);
    let t: any;
    beforeEach(async () => {
      t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
    });

    it('is refused before work has started', async () => {
      const fresh = await mk();
      const r = await file(fresh.id, validReport(), 'admin');
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('work has started');
    });

    it('only the assigned engineer (or admin) files it; sales and accounts never do', async () => {
      expect((await file(t.id, validReport(), 'svc2')).status).toBe(403);
      expect((await file(t.id, validReport(), 'sales')).status).toBe(403);
      expect((await file(t.id, validReport(), 'accounts')).status).toBe(403);
      expect((await file(t.id, validReport(), 'admin')).status).toBe(201);
    });

    it.each([
      ['problem under 5 chars', { problem_identified: 'bad' }],
      ['action under 5 chars', { action_taken: 'ok' }],
      ['unknown confirmation type', { customer_confirmation_type: 'Smoke signal' }],
      ['signed without an officer name', { customer_name_signed: ' ' }],
      ['rating 0', { customer_feedback_rating: 0 }],
      ['rating 6', { customer_feedback_rating: 6 }],
      ['rating 3.5', { customer_feedback_rating: 3.5 }],
      ['not obtained without a reason', { customer_confirmation: false, customer_name_signed: undefined }],
      ['Not Obtained type without a reason', { customer_confirmation_type: 'Not Obtained', customer_name_signed: undefined }],
      ['further work without a date', { further_work_required: true, further_work_description: 'Replace the optic assembly' }],
      ['further work with a past date', { further_work_required: true, further_work_description: 'Replace the optic assembly', next_visit_date: yesterday() }],
      ['further work without a description', { further_work_required: true, next_visit_date: tomorrow() }],
      ['parts list item without a name', { parts_replaced: [{ quantity: 1 }] }],
      ['parts list with quantity 0', { parts_replaced: [{ part_name: 'Belt', quantity: 0 }] }],
      ['parts list with a fractional quantity', { parts_replaced: [{ part_name: 'Belt', quantity: 1.5 }] }],
      ['parts as a number', { parts_replaced: 42 }],
      ['visit of another ticket', { visit_id: '99999999-9999-4999-8999-999999999999' }],
    ])('rejects: %s', async (_name, over) => {
      const r = await file(t.id, validReport(over as any));
      expect(r.status).toBe(400);
    });

    it('accepts a structured parts list, cleans text and records two history rows (resolved → report_submitted)', async () => {
      const r = await file(
        t.id,
        validReport({
          problem_identified: '<b>Burnt</b> diode array',
          parts_replaced: [{ part_name: 'PCB DA-200', quantity: 1, serial_new: 'N-1', serial_old: 'O-9', returned_to_store: true }, { part_name: 'Roller belt RB-12', quantity: 2 }],
          customer_feedback_rating: 4,
        }),
      );
      expect(r.status).toBe(201);
      expect(r.body.problem_identified).toBe('Burnt diode array');
      expect(JSON.parse(r.body.parts_replaced)).toHaveLength(2);
      const d = await get(t.id);
      expect(d.status).toBe('report_submitted');
      expect(d.resolved_at).toBeTruthy();
      const chain = d.status_history.map((h: any) => h.to_status);
      expect(chain.slice(0, 2)).toEqual(['report_submitted', 'resolved']);
    });

    it('further work moves the ticket to revisit_required and sets the next visit date', async () => {
      const next = new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0];
      const r = await file(t.id, validReport({ further_work_required: true, further_work_description: 'Replace optic assembly when it arrives', next_visit_date: next }));
      expect(r.status).toBe(201);
      const d = await get(t.id);
      expect(d.status).toBe('revisit_required');
      // DATE columns come back as local-midnight timestamps; compare as days
      expect(Math.abs(new Date(d.planned_visit_date).getTime() - new Date(`${next}T00:00:00+05:30`).getTime())).toBeLessThan(36 * 3600000);
      // and from there it can be scheduled again
      expect((await patch(t.id, { status: 'visit_scheduled', planned_visit_date: next })).status).toBe(200);
    });

    it('a not-obtained confirmation records its reason instead of a name', async () => {
      const r = await file(t.id, validReport({ customer_confirmation: false, customer_confirmation_type: 'Not Obtained', customer_name_signed: undefined, confirmation_not_obtained_reason: 'Station officer unavailable on site' }));
      expect(r.status).toBe(201);
      expect(r.body.customer_confirmation).toBe(false);
      expect(r.body.confirmation_not_obtained_reason).toContain('unavailable');
    });
  });

  // ===========================================================================
  // 11. Spare-part requests
  // ===========================================================================
  describe('11. Part requests', () => {
    const create = (id: string, body: any, who = 'svc') => api().post(`/api/service/tickets/${id}/part-requests`).set(auth(who)).send(body);
    const setStatus = (id: string, pid: string, body: any, who = 'mgmt') => api().patch(`/api/service/tickets/${id}/part-requests/${pid}/status`).set(auth(who)).send(body);

    it('validates name, quantity, dates and part references', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      expect((await create(t.id, { part_name: 'x' })).status).toBe(400);
      expect((await create(t.id, { part_name: 'Roller belt', quantity: 0 })).status).toBe(400);
      expect((await create(t.id, { part_name: 'Roller belt', quantity: 1.5 })).status).toBe(400);
      expect((await create(t.id, { part_name: 'Roller belt', quantity: 100000 })).status).toBe(400);
      expect((await create(t.id, { part_name: 'Roller belt', expected_date: yesterday() })).status).toBe(400);
      expect((await create(t.id, { part_name: 'Roller belt', part_id: '99999999-9999-4999-8999-999999999999' })).status).toBe(400);
      expect((await create(t.id, { part_name: 'Roller belt' }, 'sales')).status).toBe(403);
      expect((await create(t.id, { part_name: 'Roller belt', part_id: productId })).status).toBe(201);
    });

    it('part status follows a legal path only', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const p = (await create(t.id, { part_name: 'Cooling pump impeller' })).body;
      expect((await setStatus(t.id, p.id, { status: 'Returned' })).status).toBe(400); // not issued yet
      expect((await setStatus(t.id, p.id, { status: 'Requested' })).status).toBe(400); // same state
      expect((await setStatus(t.id, p.id, { status: 'Bogus' })).status).toBe(400);
      expect((await setStatus(t.id, p.id, { status: 'Reserved' })).status).toBe(200);
      expect((await setStatus(t.id, p.id, { status: 'Issued', serial_issued: 'SN-1' })).status).toBe(200);
      expect((await setStatus(t.id, p.id, { status: 'Reserved' })).status).toBe(400); // can't un-issue
      expect((await setStatus(t.id, p.id, { status: 'Returned', serial_returned: 'SN-1' })).status).toBe(200);
      expect((await setStatus(t.id, p.id, { status: 'Cancelled' })).status).toBe(400); // terminal
      expect((await setStatus(t.id, 'abc', { status: 'Reserved' })).status).toBe(404);
      expect((await setStatus(t.id, p.id, { status: 'Reserved' }, 'sales')).status).toBe(403);
    });

    it('stock-out pauses the ticket; issuing every part resumes it (and notifies the engineer)', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const a = (await create(t.id, { part_name: 'Cooling pump impeller' })).body;
      const b = (await create(t.id, { part_name: 'Pump gasket set' })).body;

      await setStatus(t.id, a.id, { status: 'Unavailable – Ordered', store_remarks: 'Ordered from OEM' });
      let d = await get(t.id);
      expect(d.status).toBe('awaiting_part');
      expect(d.sla_pause_started_at).toBeTruthy();

      await setStatus(t.id, a.id, { status: 'Issued' });
      d = await get(t.id);
      expect(d.status).toBe('awaiting_part'); // gasket request still open

      await setStatus(t.id, b.id, { status: 'Issued' });
      d = await get(t.id);
      expect(['in_progress', 'visit_scheduled']).toContain(d.status);
      expect(d.sla_pause_started_at).toBeNull();

      const note = await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_part_issued' and user_id='${uid.svc}'`))[0]);
      expect(note).toBeTruthy();
    });

    it('a partially issued request does not resume the ticket', async () => {
      const t = await advanceTicket(app, (await mk()).id, tok.mgmt, uid.svc, 'in_progress');
      const a = (await create(t.id, { part_name: 'Cooling pump impeller', quantity: 4 })).body;
      await setStatus(t.id, a.id, { status: 'Unavailable – Ordered' });
      await setStatus(t.id, a.id, { status: 'Reserved' });
      await setStatus(t.id, a.id, { status: 'Partially Issued' });
      expect((await get(t.id)).status).toBe('awaiting_part');
    });
  });

  // ===========================================================================
  // 12. Access control & territory scoping
  // ===========================================================================
  describe('12. RBAC & territorial scoping', () => {
    let nTicket: any;
    let eTicket: any;
    beforeAll(async () => {
      nTicket = await mk({}, 'mgmt', orgN);
      eTicket = await mk({}, 'mgmt', orgE);
    });

    it('roles outside the service module are refused everywhere', async () => {
      for (const path of ['/api/service/tickets', '/api/service/stats', `/api/service/tickets/${nTicket.id}`, `/api/service/tickets/${nTicket.id}/comments`, `/api/service/customer/${orgN}/history`, '/api/service/equipment/SN-1/history']) {
        const r = await api().get(path).set(auth('accounts'));
        expect([403]).toContain(r.status);
      }
    });

    it('unauthenticated requests are 401', async () => {
      expect((await api().get('/api/service/tickets')).status).toBe(401);
      expect((await api().post('/api/service/tickets').send({})).status).toBe(401);
    });

    it('a regional manager sees and opens only tickets in their own zone', async () => {
      const own = await api().get(`/api/service/tickets/${nTicket.id}`).set(auth('rmN'));
      expect(own.status).toBe(200);
      const foreign = await api().get(`/api/service/tickets/${eTicket.id}`).set(auth('rmN'));
      expect(foreign.status).toBe(403);
      expect(foreign.body.message).toContain('territory');

      const list = await api().get(`/api/service/tickets?limit=100&search=ZZTEST`).set(auth('rmN'));
      const ids = list.body.data.map((x: any) => x.id);
      expect(ids).toContain(nTicket.id);
      expect(ids).not.toContain(eTicket.id);
      const listE = await api().get(`/api/service/tickets?limit=100&search=ZZTEST`).set(auth('rmE'));
      expect(listE.body.data.map((x: any) => x.id)).toContain(eTicket.id);
      expect(listE.body.data.map((x: any) => x.id)).not.toContain(nTicket.id);
    });

    it('a regional manager cannot act on another zone’s ticket', async () => {
      const r = await patch(eTicket.id, { status: 'escalated', remarks: 'Trying across the zone boundary' }, 'rmN');
      expect(r.status).toBe(403);
      expect((await api().post(`/api/service/tickets/${eTicket.id}/comments`).set(auth('rmN')).send({ body: 'cross-zone note' })).status).toBe(403);
    });

    it('sales see their territory (and tickets they raised), not other regions', async () => {
      expect((await api().get(`/api/service/tickets/${eTicket.id}`).set(auth('sales'))).status).toBe(403);
      const mine = await mk({}, 'sales', orgN);
      expect((await api().get(`/api/service/tickets/${mine.id}`).set(auth('sales'))).status).toBe(200);
      expect((await api().get(`/api/service/tickets/${mine.id}`).set(auth('salesE'))).status).toBe(403);
    });

    it('an engineer opens only their own or unassigned tickets', async () => {
      const t = await mk({ assigned_to: uid.svc });
      expect((await api().get(`/api/service/tickets/${t.id}`).set(auth('svc'))).status).toBe(200);
      expect((await api().get(`/api/service/tickets/${t.id}`).set(auth('svc2'))).status).toBe(403);
      const list = await api().get('/api/service/tickets?limit=100').set(auth('svc2'));
      expect(list.body.data.every((x: any) => !x.assigned_to || x.assigned_to === uid.svc2)).toBe(true);
    });

    it('customer and equipment history respect the caller’s territory', async () => {
      const serial = `ZZTEST-HIST-${Date.now()}`;
      await mk({ equipment_serial: serial });
      const mgmt = await api().get(`/api/service/equipment/${serial}/history`).set(auth('mgmt'));
      expect(mgmt.body.totalBreakdowns).toBe(1);
      const foreign = await api().get(`/api/service/equipment/${serial}/history`).set(auth('rmE'));
      expect(foreign.body.totalBreakdowns).toBe(0);
      const cust = await api().get(`/api/service/customer/${orgN}/history`).set(auth('rmE'));
      expect(cust.body.totalTickets).toBe(0);
      expect((await api().get('/api/service/customer/not-a-uuid/history').set(auth('mgmt'))).status).toBe(404);
      expect((await api().get(`/api/service/equipment/${'X'.repeat(81)}/history`).set(auth('mgmt'))).status).toBe(400);
    });

    it('malformed ids are 404, never 500', async () => {
      for (const id of ['abc', '123', 'null', "1'; drop table x;--", '%00']) {
        expect((await api().get(`/api/service/tickets/${encodeURIComponent(id)}`).set(auth('mgmt'))).status).toBe(404);
      }
    });

    it('list filters: status aliases, priority, unassigned, overdue, repeat; bad values are 400', async () => {
      const crit = await mk({ priority: 'critical' });
      expect((await api().get('/api/service/tickets?status=new&limit=100').set(auth('mgmt'))).status).toBe(200);
      const f = await api().get('/api/service/tickets?priority=critical&unassigned=true&limit=100').set(auth('mgmt'));
      expect(f.body.data.map((x: any) => x.id)).toContain(crit.id);
      expect(f.body.data.every((x: any) => x.priority === 'critical' && !x.assigned_to)).toBe(true);
      expect((await api().get('/api/service/tickets?assigned_to=oops').set(auth('mgmt'))).status).toBe(400);
      expect((await api().get('/api/service/tickets?overdue=true').set(auth('mgmt'))).status).toBe(200);
      expect((await api().get('/api/service/tickets?repeat=true').set(auth('mgmt'))).status).toBe(200);
      const s = await api().get(`/api/service/tickets?search=${encodeURIComponent("100%_\\")}`).set(auth('mgmt'));
      expect(s.status).toBe(200); // LIKE wildcards are escaped
      const page = await api().get('/api/service/tickets?page=-3&limit=100000').set(auth('mgmt'));
      expect(page.body.page).toBe(1);
      expect(page.body.limit).toBe(100);
    });
  });

  // ===========================================================================
  // 13. Dashboard
  // ===========================================================================
  describe('13. Dashboard KPIs (§34)', () => {
    it('returns every KPI as a finite number, plus the new portal/SLA counters', async () => {
      const s = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      for (const k of ['total', 'newTickets', 'pendingTickets', 'assignedTickets', 'overdueTickets', 'awaitingParts', 'completedTickets', 'repeatComplaints', 'avgClosureDays', 'criticalTickets', 'slaBreached', 'portalNew', 'unverifiedCustomers']) {
        expect(Number.isFinite(s[k])).toBe(true);
        expect(s[k]).toBeGreaterThanOrEqual(0);
      }
    });

    it('lists idle engineers as AVAILABLE and badges workload per the spec', async () => {
      const s = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      expect(s.employeeWorkload.length).toBeGreaterThanOrEqual(5);
      for (const e of s.employeeWorkload) {
        expect(['AVAILABLE', 'OPTIMAL LOAD', 'HEAVY QUEUE', 'OVERDUE RISK']).toContain(e.workloadStatus);
        if (e.overdueTickets > 0) expect(e.workloadStatus).toBe('OVERDUE RISK');
        else if (e.activeTickets >= 4) expect(e.workloadStatus).toBe('HEAVY QUEUE');
        else if (e.activeTickets >= 1) expect(e.workloadStatus).toBe('OPTIMAL LOAD');
        else expect(e.workloadStatus).toBe('AVAILABLE');
      }
    });

    it('regional managers get zone-scoped numbers; engineers only see themselves', async () => {
      const all = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      const rm = (await api().get('/api/service/stats').set(auth('rmE'))).body;
      expect(rm.total).toBeLessThanOrEqual(all.total);
      const eng = (await api().get('/api/service/stats').set(auth('svc'))).body;
      expect(eng.employeeWorkload.every((e: any) => e.id === uid.svc)).toBe(true);
    });

    it('average closure time is measured on closed_at, never negative', async () => {
      const s = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      expect(s.avgClosureDays).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // 14. Background sweep: auto-escalation and SLA breach alerts
  // ===========================================================================
  describe('14. SLA sweep', () => {
    it('only management/admin can trigger it', async () => {
      expect((await api().post('/api/service/maintenance/sweep').set(auth('svc'))).status).toBe(403);
      expect((await api().post('/api/service/maintenance/sweep').set(auth('rmN'))).status).toBe(403);
      expect((await api().post('/api/service/maintenance/sweep').set(auth('admin'))).status).toBe(201);
    });

    it('auto-escalates a critical unassigned ticket after the configured hours — once', async () => {
      const crit = await mk({ priority: 'critical' });
      const high = await mk({ priority: 'high' });
      const assigned = await mk({ priority: 'critical', assigned_to: uid.svc });
      for (const id of [crit.id, high.id, assigned.id]) await sql1(`update service_tickets set created_at = now() - interval '3 hours' where id='${id}'`);

      const r1 = (await api().post('/api/service/maintenance/sweep').set(auth('mgmt'))).body;
      expect(r1.escalated).toBeGreaterThanOrEqual(1);
      const c = await get(crit.id);
      expect(c.status).toBe('escalated');
      expect(c.status_reason).toContain('Auto-escalated');
      expect(c.status_history[0].reason).toContain('unassigned');
      expect((await get(high.id)).status).toBe('received'); // not critical
      expect((await get(assigned.id)).status).toBe('assigned'); // somebody owns it

      const again = await sql1(`select auto_escalated_at from service_tickets where id='${crit.id}'`);
      expect(again[0].auto_escalated_at).toBeTruthy();
      await api().post('/api/service/maintenance/sweep').set(auth('mgmt'));
      expect((await get(crit.id)).status_history.length).toBe(2); // not escalated a second time

      // management is told
      const note = await waitFor(async () => (await sql1(`select id from notifications where entity_id='${crit.id}' and type='service_escalated'`))[0]);
      expect(note).toBeTruthy();
    });

    it('flags a missed resolution SLA exactly once and alerts the owners', async () => {
      const t = await advanceTicket(app, (await mk({ priority: 'high' })).id, tok.mgmt, uid.svc, 'in_progress');
      await sql1(`update service_tickets set sla_resolution_due_at = now() - interval '30 minutes' where id='${t.id}'`);
      expect((await get(t.id)).sla_breached).toBe(true);

      const r1 = (await api().post('/api/service/maintenance/sweep').set(auth('mgmt'))).body;
      expect(r1.resolutionBreaches).toBeGreaterThanOrEqual(1);
      const r2 = (await api().post('/api/service/maintenance/sweep').set(auth('mgmt'))).body;
      expect(r2.resolutionBreaches).toBe(0);

      const mine = await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_sla_breached' and user_id='${uid.svc}'`))[0]);
      expect(mine).toBeTruthy();
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_sla_breached' and user_id='${uid.mgmt}'`))[0]);
      const mgr = (await sql1(`select count(*)::int n from notifications where entity_id='${t.id}' and type='service_sla_breached' and user_id='${uid.mgmt}'`))[0].n;
      expect(mgr).toBe(1); // alerted once, not once per sweep
    });

    it('flags a missed response SLA for a ticket nobody has picked up', async () => {
      const t = await mk({ priority: 'medium' });
      await sql1(`update service_tickets set sla_response_due_at = now() - interval '5 minutes' where id='${t.id}'`);
      const r = (await api().post('/api/service/maintenance/sweep').set(auth('mgmt'))).body;
      expect(r.responseBreaches).toBeGreaterThanOrEqual(1);
      const row = await sql1(`select sla_response_breach_notified_at from service_tickets where id='${t.id}'`);
      expect(row[0].sla_response_breach_notified_at).toBeTruthy();
    });
  });

  // ===========================================================================
  // 15. Notifications triggered by the workflow
  // ===========================================================================
  describe('15. Notifications', () => {
    it('a critical ticket alerts management, the zone regional manager and engineers', async () => {
      const t = await mk({ priority: 'critical' }, 'sales', orgN);
      const types = async (user: string) => (await sql1(`select type from notifications where entity_id='${t.id}' and user_id='${uid[user]}'`)).map((r) => r.type);
      await waitFor(async () => (await types('mgmt')).includes('service_ticket_created'));
      expect(await types('rmN')).toContain('service_ticket_created');
      expect(await types('svc')).toContain('service_ticket_created');
      expect(await types('rmE')).not.toContain('service_ticket_created'); // other zone is not spammed
      expect(await types('sales')).not.toContain('service_ticket_created'); // never notify the actor
    });

    it('assigning an engineer notifies exactly that engineer; reassigning tells the previous one', async () => {
      const t = await mk();
      await patch(t.id, { status: 'assigned', assigned_to: uid.svc });
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_ticket_assigned' and user_id='${uid.svc}'`))[0]);
      await patch(t.id, { status: 'visit_scheduled', planned_visit_date: tomorrow(), assigned_to: uid.svc2 });
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_ticket_assigned' and user_id='${uid.svc2}'`))[0]);
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_ticket_reassigned' and user_id='${uid.svc}'`))[0]);
    });

    it('report filed → regional manager is asked to approve; closure → creator is told', async () => {
      const t = await advanceTicket(app, (await mk({}, 'sales', orgN)).id, tok.mgmt, uid.svc, 'in_progress');
      await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport());
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_report_submitted' and user_id='${uid.rmN}'`))[0]);
      await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({});
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_closed' and user_id='${uid.sales}'`))[0]);
    });
  });
});
