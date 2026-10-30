import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';
import { advanceTicket, fileReport } from './helpers/service-flow';

/**
 * Service & After-Sales (Scope Blueprint §31–34): the §34 dashboard figures each equal the ticket list they filter to,
 * for every role that sees the desk; the open queue splits exactly into assigned and not-yet-assigned work; and the
 * customer / machine history carries what each visit found, did and replaced (§33).
 */
describe('Service desk — §34 dashboard figures and §33 service history', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());
  const SERIAL = `ZZ-HIST-${Date.now()}`;
  let orgId: string;
  let productId: string;

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken || r.body.token;
    uid[key] = r.body.user.id;
  }
  const listTotal = async (who: string, query: Record<string, any>) => {
    const r = await api().get('/api/service/tickets').query({ ...query, limit: 1 }).set(auth(who));
    expect(r.status).toBe(200);
    return r.body.total as number;
  };
  const newTicket = async (over: Record<string, any> = {}) => {
    const r = await api()
      .post('/api/service/tickets')
      .set(auth('mgmt'))
      .send({ organisation_id: orgId, product_id: productId, equipment_serial: SERIAL, complaint: 'Belt motor stalls under load', priority: 'medium', warranty_status: 'amc', ...over });
    expect(r.status).toBe(201);
    return r.body;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(KYSELY_DB);
    await login('mgmt', 'mgmt@arihant.com');
    await login('chief', 'service@arihant.com');
    await login('field', 'service.field@arihant.com');
    await login('rmN', 'regmgr.north@arihant.com');
    await login('sales', 'sales.delhi@arihant.com');
    const [org] = (await sql<any>`select id from organisations order by created_at limit 1`.execute(db)).rows;
    const [product] = (await sql<any>`select id from products order by created_at limit 1`.execute(db)).rows;
    orgId = org.id;
    productId = product.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('§34: every dashboard figure equals the list it filters to, for each role that sees the desk', async () => {
    await newTicket(); // at least one open, unassigned ticket
    for (const who of ['mgmt', 'chief', 'field', 'rmN']) {
      const s = (await api().get('/api/service/stats').set(auth(who))).body;
      expect(s.newTickets).toBe(await listTotal(who, { stage: 'open' }));
      expect(s.pendingTickets).toBe(await listTotal(who, { stage: 'pending' }));
      expect(s.assignedTickets).toBe(await listTotal(who, { assigned: 'true' }));
      expect(s.unassignedTickets).toBe(await listTotal(who, { unassigned: 'true' }));
      // the open queue is exactly the assigned plus the not-yet-assigned work
      expect(s.assignedTickets + s.unassignedTickets).toBe(s.pendingTickets);
      expect(s.overdueTickets).toBe(await listTotal(who, { overdue: 'true' }));
      expect(s.slaBreached).toBe(await listTotal(who, { sla_breached: 'true' }));
      expect(s.awaitingParts).toBe(await listTotal(who, { stage: 'awaiting_part' }));
      expect(s.completedTickets).toBe(await listTotal(who, { stage: 'completed' }));
      expect(s.repeatComplaints).toBe(await listTotal(who, { repeat: 'true' }));
      expect(typeof s.avgClosureDays).toBe('number');
      expect(Array.isArray(s.employeeWorkload)).toBe(true);
    }
  });

  it('a closed or cancelled ticket is never counted as waiting for an engineer', async () => {
    const t = await newTicket();
    expect(await listTotal('mgmt', { unassigned: 'true', search: t.ticket_no })).toBe(1);
    expect(await listTotal('mgmt', { assigned: 'true', search: t.ticket_no })).toBe(0);
    const cancel = await api().patch(`/api/service/tickets/${t.id}/status`).set(auth('mgmt')).send({ status: 'cancelled', remarks: 'Logged twice by the customer' });
    expect(cancel.status).toBe(200);
    expect(await listTotal('mgmt', { unassigned: 'true', search: t.ticket_no })).toBe(0);
    expect(await listTotal('mgmt', { stage: 'closed', search: t.ticket_no })).toBe(1);
  });

  it('assigning moves a ticket from "not yet assigned" to "assigned", on the tiles and in the list', async () => {
    const before = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
    const t = await newTicket();
    const mid = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
    expect(mid.unassignedTickets).toBe(before.unassignedTickets + 1);
    await advanceTicket(app, t.id, tok.mgmt, uid.field, 'assigned');
    const after = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
    expect(after.unassignedTickets).toBe(before.unassignedTickets);
    expect(after.assignedTickets).toBe(mid.assignedTickets + 1);
    expect(await listTotal('mgmt', { assigned: 'true', search: t.ticket_no })).toBe(1);
  });

  it('§33: the machine and customer history carry what each visit found, did and replaced', async () => {
    const t = await newTicket({ complaint: 'Conveyor belt slipping at the entry roller' });
    await advanceTicket(app, t.id, tok.mgmt, uid.field, 'in_progress');
    await fileReport(app, t.id, tok.field, {
      problem_identified: 'Worn entry roller bearing',
      action_taken: 'Replaced the bearing and re-tensioned the belt',
      parts_replaced: [{ part_name: 'Roller bearing 6204', quantity: 2 }],
    });

    const machine = await api().get(`/api/service/equipment/${encodeURIComponent(SERIAL)}/history`).set(auth('mgmt'));
    expect(machine.status).toBe(200);
    const row = machine.body.tickets.find((x: any) => x.id === t.id);
    expect(row.latest_report).toEqual(
      expect.objectContaining({
        problem_identified: 'Worn entry roller bearing',
        action_taken: 'Replaced the bearing and re-tensioned the belt',
        further_work_required: false,
      }),
    );
    expect(JSON.stringify(row.latest_report.parts_replaced)).toContain('Roller bearing 6204');
    // a ticket with no report yet still shows in the history, with no report
    expect(machine.body.tickets.some((x: any) => x.id !== t.id && x.latest_report === null)).toBe(true);

    // a report sent back for correction is not part of the record until it is filed again
    const returned = await newTicket({ complaint: 'Display flickers on boot' });
    await sql`insert into service_reports (ticket_id, problem_identified, action_taken, parts_replaced, warranty_status, customer_confirmation, further_work_required, report_status, submitted_by)
      values (${returned.id}, 'Loose display cable', 'Not finished', null, 'amc', false, false, 'Returned for Correction', ${uid.field})`.execute(db);
    const again = await api().get(`/api/service/equipment/${encodeURIComponent(SERIAL)}/history`).set(auth('mgmt'));
    expect(again.body.tickets.find((x: any) => x.id === returned.id).latest_report).toBeNull();

    const customer = await api().get(`/api/service/customer/${orgId}/history`).set(auth('mgmt'));
    expect(customer.status).toBe(200);
    expect(customer.body.tickets.find((x: any) => x.id === t.id).latest_report.problem_identified).toBe('Worn entry roller bearing');
  });

  describe('§31: a ticket logged without its machine', () => {
    const bare = async () => {
      // a phone complaint: customer and problem known, the machine not yet
      const r = await api().post('/api/service/tickets').set(auth('mgmt')).send({ organisation_id: orgId, complaint: 'Scanner beeps and stops, model not known' });
      expect(r.status).toBe(201);
      return r.body;
    };
    const details = (id: string, body: Record<string, any>, who = 'mgmt') => api().patch(`/api/service/tickets/${id}/details`).set(auth(who)).send(body);

    it('is listed under "machine not identified" until its equipment or serial number is added', async () => {
      const t = await bare();
      expect(await listTotal('mgmt', { no_machine: 'true', search: t.ticket_no })).toBe(1);
      const s = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      expect(s.noMachineTickets).toBe(await listTotal('mgmt', { no_machine: 'true' }));

      const res = await details(t.id, { product_id: productId, equipment_serial: `${SERIAL}-B`, location: 'Gate 2 baggage hall' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ product_id: productId, equipment_serial: `${SERIAL}-B`, location: 'Gate 2 baggage hall' }));
      expect(await listTotal('mgmt', { no_machine: 'true', search: t.ticket_no })).toBe(0);
      // the change is in the ticket's own history and the audit trail
      const full = (await api().get(`/api/service/tickets/${t.id}`).set(auth('mgmt'))).body;
      expect(full.status_history.map((h: any) => h.reason)).toContain('Details completed: equipment, serial number, location');
      const audit = (await sql<any>`select action from audit_log where entity_id = ${t.id} and action = 'details_updated'`.execute(db)).rows;
      expect(audit).toHaveLength(1);
    });

    it('a serial added later is checked for repeat complaints on that machine', async () => {
      const t = await bare();
      const res = await details(t.id, { equipment_serial: SERIAL }); // the machine of the earlier tickets in this suite
      expect(res.status).toBe(200);
      expect(res.body.is_repeat_complaint).toBe(true);
      expect(res.body.parent_ticket_id).toBeTruthy();
    });

    it('refuses bad input, other engineers, and closed or cancelled tickets', async () => {
      const t = await bare();
      expect((await details(t.id, {})).status).toBe(400);
      expect((await details(t.id, { equipment_serial: ' ' })).status).toBe(400);
      expect((await details(t.id, { product_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      const [foreign] = (await sql<any>`select c.id from contacts c where c.organisation_id <> ${orgId} limit 1`.execute(db)).rows;
      if (foreign) expect((await details(t.id, { contact_id: foreign.id })).status).toBe(400);
      // a field engineer edits only their own tickets
      expect((await details(t.id, { equipment_serial: 'ZZ-NOT-MINE' }, 'field')).status).toBe(403);
      expect((await details(t.id, { equipment_serial: 'ZZ-NOT-MINE' }, 'sales' as any)).status).not.toBe(200);
      await api().patch(`/api/service/tickets/${t.id}/status`).set(auth('mgmt')).send({ status: 'cancelled', remarks: 'Duplicate complaint' });
      expect((await details(t.id, { equipment_serial: 'ZZ-LATE' })).status).toBe(400);
    });

    it('a report needs the machine: the engineer can read the serial on site and file it with the report', async () => {
      const t = await bare();
      await advanceTicket(app, t.id, tok.mgmt, uid.field, 'in_progress');
      const missing = await api().post(`/api/service/tickets/${t.id}/report`).set(auth('field')).send({
        problem_identified: 'Worn entry roller bearing', action_taken: 'Replaced the bearing', customer_confirmation: true,
        customer_confirmation_type: 'Signature', customer_name_signed: 'SI Mohan Lal',
        attachments: [{ name: 'Signed job sheet.pdf', url: 'https://files.example.com/sheet.pdf' }],
      });
      expect(missing.status).toBe(400);
      expect(missing.body.message).toContain('serial number');

      await fileReport(app, t.id, tok.field, { equipment_serial: `${SERIAL}-C` });
      const after = (await api().get(`/api/service/tickets/${t.id}`).set(auth('mgmt'))).body;
      expect(after.equipment_serial).toBe(`${SERIAL}-C`);
      expect(after.status).toBe('report_submitted');
    });

    it('a report cannot claim a different machine than the ticket', async () => {
      const t = await newTicket(); // logged with SERIAL
      await advanceTicket(app, t.id, tok.mgmt, uid.field, 'in_progress');
      await expect(fileReport(app, t.id, tok.field, { equipment_serial: 'ZZ-SOME-OTHER' })).rejects.toThrow('correct the ticket details first');
      // the same serial typed again (any case) is fine
      await fileReport(app, t.id, tok.field, { equipment_serial: SERIAL.toLowerCase() });
    });

    it('a filed report is never a draft', async () => {
      const t = await newTicket();
      await sql`insert into service_reports (ticket_id, problem_identified, action_taken, warranty_status, customer_confirmation, further_work_required, submitted_by)
        values (${t.id}, 'Legacy entry', 'Legacy entry', 'amc', true, false, ${uid.field})`.execute(db);
      const [row] = (await sql<any>`select report_status from service_reports where ticket_id = ${t.id}`.execute(db)).rows;
      expect(row.report_status).toBe('Submitted');
    });
  });
});
