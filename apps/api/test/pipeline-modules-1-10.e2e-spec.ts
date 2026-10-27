/**
 * Cross-module pipeline (Modules 1–10), end to end over HTTP against a scratch clone of the dev DB.
 *
 * One fresh customer is threaded through the whole business pipeline:
 *   lead (M1) → field visit + trip + auto demo (M2) → tender registered (M4) → demo with lead/tender + technical
 *   failure → service ticket (M3/M6) → proposal sent + follow-up task (M5/M8) → tender WON → sales order /
 *   delivery (M4/M5) → service ticket with serial (M6) → expense claim on the visit/trip (M9) → linked tasks (M8)
 *   → regional / management dashboards (M10) → Customer 360, notifications, audit and RBAC.
 *
 * Every `it` is one stage and states which cross-module link it proves. State is shared through closure
 * variables, so the stages must run in order (jest runs `it` blocks sequentially within a file).
 * Assertions are about the links between modules, not about unrelated fields.
 * All names carry a unique tag so nothing collides with seed data; nothing is deleted (the clone is dropped).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { istEndOfDay, todayInKolkata, type Database } from '@arihant/shared';
import { configureApp } from '../src/common/app-setup';

jest.setTimeout(120000);

const TAG = `PIPE${randomUUID().slice(0, 6).toUpperCase()}`;
const today = todayInKolkata();
/** Some server checks (proposal sent/contact dates, tender result date) compare against the UTC calendar date. */
const utcToday = new Date().toISOString().slice(0, 10);
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe(`Pipeline Modules 1–10 — one customer end to end (${TAG})`, () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let outbox: OutboxService;

  type Who = { token: string; id: string };
  const u: Record<string, Who> = {};

  // master data
  let productId = '';
  let zoneId = '';
  let regionId = '';
  let travelCatId = '';
  const cat: Record<string, string> = {};

  // pipeline entities
  const orgName = `${TAG} Directorate of Border Security`;
  let orgId = '';
  let lead1Id = '';
  let lead2Id = '';
  let contactId = '';
  let visitId = '';
  let tripId = '';
  let visitDemoId = '';
  let tenderId = '';
  let tenderNo = '';
  let cancelledTenderId = '';
  let demoId = '';
  let demoTicketId = '';
  let proposalId = '';
  let proposalTaskId = '';
  let deliveryId = '';
  let orderNumber = '';
  let ticketId = '';
  let cancelledTicketId = '';
  const serial = `${TAG}-SN-0001`;
  let claimId = '';
  let itemId = '';
  const taskIds: Record<'tender' | 'demo' | 'service', string> = { tender: '', demo: '', service: '' };

  // dashboard snapshots
  let metricsBefore: any;
  let rmMetricsBefore: any;
  let regionalBefore: any;
  let rmRegionalBefore: any;

  const http = () => request(app.getHttpServer());
  const bearer = (w: Who) => ({ Authorization: `Bearer ${w.token}` });
  async function login(email: string): Promise<Who> {
    const res = await http().post('/api/auth/login').send({ email, password: 'password123' });
    if (res.status !== 200) throw new Error(`login ${email} → ${res.status}`);
    return { token: res.body.accessToken || res.body.token, id: res.body.user.id };
  }
  /** Status assertion that prints the response body when it fails (makes link failures diagnosable). */
  function ok(res: request.Response, status: number | number[]) {
    const want = Array.isArray(status) ? status : [status];
    if (!want.includes(res.status)) {
      const req = (res as any).req;
      throw new Error(`${req?.method} ${req?.path} → ${res.status} (wanted ${want.join('/')}): ${JSON.stringify(res.body).slice(0, 1500)}`);
    }
    return res.body;
  }
  const rows = (body: any): any[] => (Array.isArray(body) ? body : body?.data ?? []);
  /** Polls until `fn` returns a truthy value, draining the outbox each round (its cron runs every 5 s). */
  async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 20000): Promise<T> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await outbox.processPendingEvents().catch(() => 0);
      const v = await fn();
      if (v) return v as T;
      if (Date.now() > end) throw new Error(`Timed out waiting for: ${label}`);
      await sleep(250);
    }
  }
  const metrics = async (w: Who) => ok(await http().get('/api/dashboard/metrics').set(bearer(w)), 200);
  const regional = async (w: Who) => ok(await http().get('/api/dashboard/regional-performance').query(w === u.mgmt ? { zone_id: zoneId } : {}).set(bearer(w)), 200);
  const empRow = (r: any) => r.teamPerformance.find((e: any) => e.id === u.sales.id);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();
    db = moduleFixture.get<Kysely<Database>>(KYSELY_DB);
    outbox = moduleFixture.get(OutboxService);

    const emails: Record<string, string> = {
      mgmt: 'mgmt@arihant.com',
      rm: 'regmgr.north@arihant.com',
      sales: 'sales.delhi@arihant.com',
      otherSales: 'sales.jaipur@arihant.com',
      outsider: 'sales.kolkata@arihant.com',
      tender: 'tender@arihant.com',
      demo: 'demo@arihant.com',
      service: 'service@arihant.com',
      accounts: 'accounts@arihant.com',
      admin: 'admin@arihant.com',
    };
    for (const [k, e] of Object.entries(emails)) u[k] = await login(e);

    const salesRow = await db.selectFrom('users').select(['zone_id', 'region_id', 'reporting_manager_id']).where('id', '=', u.sales.id).executeTakeFirstOrThrow();
    zoneId = salesRow.zone_id!;
    regionId = salesRow.region_id!;
    expect(salesRow.reporting_manager_id).toBe(u.rm.id); // the team line the dashboards and task scope rely on
    productId = (await db.selectFrom('products').select('id').orderBy('name').limit(1).executeTakeFirstOrThrow()).id;

    for (const c of ok(await http().get('/api/task-categories').set(bearer(u.rm)), 200)) cat[c.code] = c.id;
    travelCatId = ok(await http().get('/api/expense-categories').set(bearer(u.sales)), 200).find((c: any) => c.code === 'TRAVEL').id;
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------------------------- stage 0
  it('stage 0 — baseline dashboard snapshots (M10) before the pipeline starts', async () => {
    metricsBefore = await metrics(u.mgmt);
    rmMetricsBefore = await metrics(u.rm);
    regionalBefore = await regional(u.mgmt);
    rmRegionalBefore = await regional(u.rm);
    expect(regionalBefore.zone.id).toBe(zoneId);
    expect(empRow(regionalBefore)).toBeDefined();
    expect(empRow(rmRegionalBefore)).toBeDefined();
  });

  // ---------------------------------------------------------------------------------------------- stage 1
  it('stage 1 — Leads ↔ Organisations / Contacts / Interactions / Follow-ups (M1)', async () => {
    // Link: a lead with a NEW organisation name creates the organisation, the primary contact, an interaction and a follow-up.
    const l1 = ok(
      await http().post('/api/leads').set(bearer(u.sales)).send({
        organisation_name: orgName,
        contact_name: `${TAG} Col. R. Mehta`,
        contact_designation: 'Procurement Officer',
        contact_mobile: '9810000001',
        city: 'New Delhi',
        state: 'Delhi',
        zone_id: zoneId,
        region_id: regionId,
        sector: 'Defence',
        product_id: productId,
        value_lakh: 42.5,
        probability: 'high',
        next_followup_date: day(3),
        remarks: `${TAG} perimeter surveillance requirement`,
      }),
      201,
    );
    lead1Id = l1.id;
    orgId = l1.organisation_id;
    contactId = l1.primary_contact_id;
    expect(orgId).toBeTruthy();
    expect(contactId).toBeTruthy();
    expect(l1.lead_type).toBe('fresh');
    expect(l1.assigned_to).toBe(u.sales.id);
    expect(l1.regional_manager_id).toBe(u.rm.id); // derived from the salesperson's reporting line

    const org = await db.selectFrom('organisations').selectAll().where('id', '=', orgId).executeTakeFirstOrThrow();
    expect(org.name).toBe(orgName);
    expect(org.zone_id).toBe(zoneId);
    expect(org.region_id).toBe(regionId);
    const contact = await db.selectFrom('contacts').selectAll().where('id', '=', contactId).executeTakeFirstOrThrow();
    expect(contact.organisation_id).toBe(orgId);
    const firstTouch = await db.selectFrom('interactions').selectAll().where('lead_id', '=', lead1Id).execute();
    expect(firstTouch).toHaveLength(1);
    expect(firstTouch[0].organisation_id).toBe(orgId);
    const fu = await db.selectFrom('follow_ups').selectAll().where('lead_id', '=', lead1Id).execute();
    expect(fu).toHaveLength(1);
    expect(fu[0]).toMatchObject({ organisation_id: orgId, status: 'pending', assigned_to: u.sales.id, interaction_id: firstTouch[0].id });

    // Link: the same organisation (name + city) typed with different case / surrounding whitespace is reused, and the
    // lead is re-approached. (Units of the same name in another city are separate accounts — dedupe is name + city.)
    const l2 = ok(
      await http().post('/api/leads').set(bearer(u.sales)).send({
        organisation_name: `   ${orgName.toLowerCase().replace('directorate', 'DIRECTORATE')}  `,
        city: '  new delhi ',
        product_id: productId,
        value_lakh: 10,
        next_followup_date: day(6),
      }),
      201,
    );
    lead2Id = l2.id;
    expect(l2.organisation_id).toBe(orgId);
    expect(l2.lead_type).toBe('re_approached');
    const orgCount = await db.selectFrom('organisations').select('id').where('name', 'ilike', `%${TAG}%`).execute();
    expect(orgCount).toHaveLength(1);

    // Link: a status change writes an interaction; 'contacted' completes the pending follow-ups of that lead.
    const before = (await db.selectFrom('interactions').select('id').where('lead_id', '=', lead1Id).execute()).length;
    const contacted = ok(await http().patch(`/api/leads/${lead1Id}/status`).set(bearer(u.sales)).send({ status: 'contacted', remarks: 'Spoke to procurement cell' }), 200);
    expect((contacted.lead_status || contacted.status)).toBe('contacted');
    const after = await db.selectFrom('interactions').selectAll().where('lead_id', '=', lead1Id).orderBy('created_at', 'desc').execute();
    expect(after.length).toBe(before + 1);
    expect(after[0].outcome).toMatch(/new to contacted/);
    const fuAfter = await db.selectFrom('follow_ups').selectAll().where('lead_id', '=', lead1Id).executeTakeFirstOrThrow();
    expect(fuAfter.status).toBe('completed');
    const lead2Fu = await db.selectFrom('follow_ups').select('status').where('lead_id', '=', lead2Id).executeTakeFirstOrThrow();
    expect(lead2Fu.status).toBe('pending'); // only the contacted lead's follow-ups are closed
    ok(await http().patch(`/api/leads/${lead1Id}/status`).set(bearer(u.sales)).send({ status: 'qualified' }), 200);
  });

  // ---------------------------------------------------------------------------------------------- stage 2
  it('stage 2 — Visit → Trip + auto Demo (M2→M3); completion → Customer timeline + Employee activity', async () => {
    // Link: travel_required creates a trip and sets visits.trip_id; demo_required auto-creates a demos row with visit_id.
    const v = ok(
      await http().post('/api/visits').set(bearer(u.sales)).send({
        organisation_id: orgId,
        contact_id: contactId,
        product_id: productId,
        planned_date: today,
        location: `${TAG} Field HQ, New Delhi`,
        purpose: `${TAG} requirement walkthrough`,
        demo_required: true,
        demo_assigned_to: u.demo.id,
        travel_required: true,
      }),
      201,
    );
    visitId = v.id;
    tripId = v.trip_id;
    expect(tripId).toBeTruthy();
    const trip = await db.selectFrom('trips').select(['employee_id', sql<string>`trip_date::text`.as('trip_date')]).where('id', '=', tripId).executeTakeFirstOrThrow();
    expect(trip).toEqual({ employee_id: u.sales.id, trip_date: today }); // trip is the salesperson's, on the visit date

    const detail = ok(await http().get(`/api/visits/${visitId}`).set(bearer(u.sales)), 200);
    expect(detail.linked_demo).toBeTruthy();
    visitDemoId = detail.linked_demo.id;
    const autoDemo = await db.selectFrom('demos').selectAll().where('id', '=', visitDemoId).executeTakeFirstOrThrow();
    expect(autoDemo).toMatchObject({ visit_id: visitId, organisation_id: orgId, assigned_to: u.demo.id, status: 'requested' });

    // Link: completing the visit marks it completed, writes a 'visit' interaction for the org and an employee activity.
    ok(
      await http().post(`/api/visits/${visitId}/update`).set(bearer(u.sales)).send({
        met_completed: true,
        person_met: `${TAG} Col. R. Mehta`,
        discussion: 'Walked through the perimeter sensor requirement and tender timelines.',
        product_discussed: 'Perimeter intrusion detection',
        outcome: 'Customer wants a live trial and a formal proposal.',
      }),
      201,
    );
    expect(ok(await http().get(`/api/visits/${visitId}`).set(bearer(u.sales)), 200).status).toBe('completed');
    const vi = await db.selectFrom('interactions').selectAll().where('visit_id', '=', visitId).execute();
    expect(vi).toHaveLength(1);
    expect(vi[0]).toMatchObject({ organisation_id: orgId, type: 'physical_visit', employee_id: u.sales.id });
    // (known gap, not asserted: the visit interaction carries no lead_id)
    const act = await db.selectFrom('employee_activities').selectAll().where('entity_type', '=', 'visit').where('entity_id', '=', visitId).execute();
    expect(act).toHaveLength(1);
    expect(act[0]).toMatchObject({ employee_id: u.sales.id, status: 'completed' });
  });

  // ---------------------------------------------------------------------------------------------- stage 3
  it('stage 3 — Tender registered for the org (M4) → Customer 360 + tender_assigned notification', async () => {
    tenderNo = `${TAG}/BSF/PIDS/${utcToday.slice(0, 4)}`;
    const t = ok(
      await http().post('/api/tenders').set(bearer(u.tender)).send({
        tender_no: tenderNo,
        tender_title: `${TAG} Perimeter Intrusion Detection System`,
        organisation_id: orgId,
        product_id: productId,
        city: 'New Delhi',
        state: 'Delhi',
        zone_id: zoneId,
        region_id: regionId,
        category: 'other',
        publication_date: day(-5),
        submission_deadline: `${day(20)}T15:00:00+05:30`,
        estimated_value: 25000000,
        assigned_person_id: u.sales.id,
        remarks: `${TAG} pipeline tender`,
      }),
      201,
    );
    tenderId = t.id;
    expect(t.organisation_id).toBe(orgId);
    expect(t.assigned_to).toBe(u.sales.id);

    // Link: the tender shows on the organisation's Customer 360 timeline.
    const tl = ok(await http().get(`/api/organisations/${orgId}/timeline`).set(bearer(u.sales)), 200);
    expect(tl.tenders.map((x: any) => x.id)).toContain(tenderId);

    // Link: tender.created (outbox) notifies the assigned salesperson.
    const n = await waitFor('tender_assigned notification', () =>
      db.selectFrom('notifications').selectAll().where('user_id', '=', u.sales.id).where('type', '=', 'tender_assigned').where('entity_id', '=', tenderId).executeTakeFirst(),
    );
    expect(n.entity_type).toBe('tender');

    // A second tender for the same org, cancelled straight away — used later as a closed link target.
    const t2 = ok(
      await http().post('/api/tenders').set(bearer(u.tender)).send({
        tender_no: `${TAG}/CANCELLED/${utcToday.slice(0, 4)}`,
        organisation_id: orgId,
        zone_id: zoneId,
        region_id: regionId,
        category: 'other',
        publication_date: day(-5),
        submission_deadline: `${day(25)}T15:00:00+05:30`,
        assigned_person_id: u.sales.id,
      }),
      201,
    );
    cancelledTenderId = t2.id;
    ok(await http().post(`/api/tenders/${cancelledTenderId}/transitions`).set(bearer(u.mgmt)).send({ target_status: 'cancelled', remarks: 'Buyer withdrew the requirement' }), [200, 201]);
    const cancelled = await db.selectFrom('tenders').select('status').where('id', '=', cancelledTenderId).executeTakeFirstOrThrow();
    expect(cancelled.status).toBe('cancelled');
  });

  // ---------------------------------------------------------------------------------------------- stage 4
  it('stage 4 — Demo linked to org + lead + tender; TECHNICAL_FAILURE → Service ticket (M3→M6)', async () => {
    // Link: POST /demos stores organisation_id, lead_id and tender_id.
    const d = ok(
      await http().post('/api/demos').set(bearer(u.sales)).send({
        organisation_id: orgId,
        lead_id: lead1Id,
        tender_id: tenderId,
        product_id: productId,
        requested_date: day(2), // differs from the visit's auto-demo date (60 s idempotency window is per org+requester+date+product)
        location: `${TAG} Trial Ground`,
        purpose: `${TAG} live trial`,
        service_escort_required: true,
        service_engineer_id: u.service.id,
      }),
      201,
    );
    demoId = d.id;
    expect(demoId).not.toBe(visitDemoId);
    expect(d).toMatchObject({ organisation_id: orgId, lead_id: lead1Id, tender_id: tenderId });
    const fetched = ok(await http().get(`/api/demos/${demoId}`).set(bearer(u.sales)), 200);
    expect(fetched.lead_id ?? fetched.demo?.lead_id).toBe(lead1Id);

    // DEF-024: an outcome is recorded only on / after the demo day. The trial was requested for day(2); move its date to
    // today to stand for "the trial day has arrived" before the demo team records the result.
    await db.updateTable('demos').set({ requested_date: today, confirmed_date: today } as any).where('id', '=', demoId).execute();
    // An outcome needs a confirmed demo: management approves the request, the demo team confirms the date
    ok(await http().post(`/api/demos/${demoId}/start-planning`).set(bearer(u.mgmt)), [200, 201]);
    ok(await http().post(`/api/demos/${demoId}/confirm`).set(bearer(u.demo)).send({ confirmed_date: today }), [200, 201]);

    // Link: a failed outcome with TECHNICAL_FAILURE opens a service ticket for the same org and links it back.
    const out = ok(
      await http().post(`/api/demos/${demoId}/outcome`).set(bearer(u.demo)).send({
        result: 'fail',
        failure_reason: 'TECHNICAL_FAILURE',
        technical_performance: 'Sensor controller rebooted repeatedly during the range test',
        customer_response: 'Customer asked for a re-trial after repair',
        remarks: `${TAG} board failure`,
        completed: true,
      }),
      201,
    );
    demoTicketId = out.service_ticket_id;
    expect(demoTicketId).toBeTruthy();
    const ticket = await db.selectFrom('service_tickets').selectAll().where('id', '=', demoTicketId).executeTakeFirstOrThrow();
    expect(ticket).toMatchObject({ organisation_id: orgId, complaint_source: 'Demo Team', assigned_to: u.service.id });
    const demoRow = await db.selectFrom('demos').select(['status', 'service_ticket_id']).where('id', '=', demoId).executeTakeFirstOrThrow();
    expect(demoRow).toEqual({ status: 'completed', service_ticket_id: demoTicketId });
    const outcomeRow = await db.selectFrom('demo_outcomes').selectAll().where('demo_id', '=', demoId).executeTakeFirstOrThrow();
    expect(outcomeRow).toMatchObject({ result: 'fail', failure_reason: 'TECHNICAL_FAILURE', service_ticket_id: demoTicketId });
    const di = await db.selectFrom('interactions').selectAll().where('demo_id', '=', demoId).execute();
    expect(di).toHaveLength(1);
    expect(di[0]).toMatchObject({ organisation_id: orgId, lead_id: lead1Id, type: 'demo' });
    // Ticket creation also lands on the customer timeline as a 'service' interaction.
    const svc = await db.selectFrom('interactions').select('remarks').where('organisation_id', '=', orgId).where('type', '=', 'service').execute();
    expect(svc.some((s) => s.remarks?.includes(ticket.ticket_no!))).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------- stage 5
  it('stage 5 — Proposal for the lead; send → Module 8 follow-up task; follow-up log moves the same task (M5→M8)', async () => {
    // Link: proposal stores customer/org + lead.
    const p = ok(
      await http().post('/api/proposals').set(bearer(u.sales)).send({
        customer_id: orgId,
        lead_id: lead1Id,
        product_id: productId,
        sector: 'Defence',
        request_date: utcToday,
        required_date: day(10),
        responsible_person_id: u.sales.id,
        quoted_value: 23500000, // DEF-029: review / approval require a quoted value
        remarks: `${TAG} techno-commercial offer`,
      }),
      201,
    );
    proposalId = p.id;
    const prow = await db.selectFrom('proposals').select(['lead_id', 'customer_id', 'organisation_id']).where('id', '=', proposalId).executeTakeFirstOrThrow();
    expect(prow).toEqual({ lead_id: lead1Id, customer_id: orgId, organisation_id: orgId });

    ok(await http().post(`/api/proposals/${proposalId}/start-preparation`).set(bearer(u.sales)).send({}), [200, 201]);
    ok(await http().post(`/api/proposals/${proposalId}/submit-for-review`).set(bearer(u.sales)).send({ change_summary: 'Offer ready' }), [200, 201]);
    ok(await http().post(`/api/proposals/${proposalId}/approve`).set(bearer(u.mgmt)).send({ remarks: 'Approved' }), [200, 201]);
    const sent = ok(
      await http().post(`/api/proposals/${proposalId}/send`).set(bearer(u.sales)).send({
        sent_date: utcToday,
        email_references: [`${TAG}-DISPATCH-1`],
        follow_up_owner_id: u.sales.id,
        next_follow_up_date: day(5),
      }),
      [200, 201],
    );
    expect(sent.status).toBe('SENT_TO_CUSTOMER');

    // Link (outbox proposal.sent → TaskReminderConsumer): one task for the owner, linked to the proposal and the customer.
    const task = await waitFor('proposal follow-up task', () =>
      db.selectFrom('tasks').selectAll().where('related_entity_type', '=', 'proposal').where('related_entity_id', '=', proposalId).executeTakeFirst(),
    );
    proposalTaskId = task.id;
    expect(task).toMatchObject({ source: 'proposal_followup', assigned_to: u.sales.id, customer_id: orgId, status: 'not_started' });
    expect(new Date(task.deadline as any).getTime()).toBe(istEndOfDay(day(5)).getTime());
    const viaApi = ok(await http().get(`/api/tasks/${proposalTaskId}`).set(bearer(u.sales)), 200);
    expect(viaApi).toMatchObject({ related_entity_type: 'proposal', related_entity_id: proposalId, customer_id: orgId });

    // Link: logging a follow-up with a new date moves the SAME task's deadline (no duplicate task).
    ok(
      await http().post(`/api/proposals/${proposalId}/follow-ups`).set(bearer(u.sales)).send({
        contact_date: utcToday,
        mode: 'Call',
        summary: 'Customer reviewing the commercial terms with finance',
        response: 'Decision pending',
        next_follow_up_date: day(9),
      }),
      [200, 201],
    );
    await waitFor('proposal task deadline moved', async () => {
      const t = await db.selectFrom('tasks').select('deadline').where('id', '=', proposalTaskId).executeTakeFirstOrThrow();
      return new Date(t.deadline as any).getTime() === istEndOfDay(day(9)).getTime();
    });
    const all = await db.selectFrom('tasks').select('id').where('related_entity_type', '=', 'proposal').where('related_entity_id', '=', proposalId).execute();
    expect(all).toHaveLength(1);
    const changes = await db.selectFrom('task_deadline_changes').selectAll().where('task_id', '=', proposalTaskId).execute();
    expect(changes.some((c) => c.source === 'linked_reschedule')).toBe(true);
    const t2 = await db.selectFrom('tasks').select('original_deadline').where('id', '=', proposalTaskId).executeTakeFirstOrThrow();
    expect(new Date(t2.original_deadline as any).getTime()).toBe(istEndOfDay(day(5)).getTime()); // original never moves
  });

  // ---------------------------------------------------------------------------------------------- stage 6
  it('stage 6 — Tender → WON → Sales Order creates a delivery for the same org (M4→M5)', async () => {
    ok(await http().post(`/api/tenders/${tenderId}/approval-request`).set(bearer(u.tender)).send({ remarks: 'Participation approval' }), [200, 201]);
    ok(await http().post(`/api/tenders/${tenderId}/approve`).set(bearer(u.mgmt)).send({ decision: 'approved', remarks: 'Go' }), [200, 201]);
    // DEF-006: the bid is submitted only once every mandatory checklist document is Ready.
    const docs = ok(await http().get(`/api/tenders/${tenderId}/documents`).set(bearer(u.tender)), 200);
    const mandatory = (docs.documents || []).filter((d: any) => d.is_mandatory);
    expect(mandatory.length).toBeGreaterThan(0);
    for (const d of mandatory) {
      ok(await http().patch(`/api/tenders/${tenderId}/documents/${d.id}`).set(bearer(u.tender)).send({ status: 'Ready' }), 200);
    }
    ok(await http().post(`/api/tenders/${tenderId}/transitions`).set(bearer(u.tender)).send({ target_status: 'submitted', submission_date: today, remarks: 'Bid uploaded' }), [200, 201]);
    // DEF-090: a result is declared only after bids close — stand for the bid closing having passed (yesterday).
    const closedAt = new Date(Date.now() - 86400000);
    await db.updateTable('tenders').set({ submission_deadline: closedAt, bid_closing_date: closedAt } as any).where('id', '=', tenderId).execute();
    const won = ok(
      await http().post(`/api/tenders/${tenderId}/result`).set(bearer(u.mgmt)).send({
        outcome: 'won',
        result_date: today,
        value: 24000000,
        awarded_value: 24000000,
        po_number: `${TAG}-PO`,
        notes: 'L1',
      }),
      201,
    );
    expect(won.status).toBe('won');

    orderNumber = `SO-${TAG}-001`;
    const so = ok(await http().post(`/api/tenders/${tenderId}/create-sales-order`).set(bearer(u.mgmt)).send({ order_number: orderNumber, delivery_terms: 'FOR destination, 90 days' }), 201);
    deliveryId = so.id;
    expect(so.tender_id).toBe(tenderId);
    expect(so.sales_order).toMatchObject({ organisation_id: orgId, tender_id: tenderId, status: 'scheduled', assigned_to: u.sales.id });

    // Same PO/LoA reference again → 409, never a second delivery.
    const again = await http().post(`/api/tenders/${tenderId}/create-sales-order`).set(bearer(u.mgmt)).send({ order_number: orderNumber });
    ok(again, 409);

    // Link: the delivery is listed under the organisation.
    const list = rows(ok(await http().get('/api/deliveries').query({ organisation_id: orgId }).set(bearer(u.mgmt)), 200));
    expect(list.map((x: any) => x.id)).toEqual([deliveryId]);
    expect(list[0]).toMatchObject({ tender_id: tenderId, organisation_id: orgId, status: 'scheduled' });
  });

  // ---------------------------------------------------------------------------------------------- stage 7
  it('stage 7 — Service ticket with serial; customer service history spans demo-failure + manual tickets (M6)', async () => {
    const before = (await db.selectFrom('interactions').select('id').where('organisation_id', '=', orgId).where('type', '=', 'service').execute()).length;
    const t = ok(
      // Sales report the complaint; the ticket is logged by the regional manager (sales cannot create tickets, Module 6 RBAC).
      await http().post('/api/service/tickets').set(bearer(u.rm)).send({
        organisation_id: orgId,
        contact_id: contactId,
        product_id: productId,
        equipment_serial: serial,
        complaint: `${TAG} sensor zone 4 reporting false alarms after rain`,
        complaint_source: 'Sales Rep',
        priority: 'medium',
        location: 'Sector 4 fence line',
      }),
      201,
    );
    ticketId = t.id;
    expect(t.equipment_serial).toBe(serial);
    const after = await db.selectFrom('interactions').selectAll().where('organisation_id', '=', orgId).where('type', '=', 'service').execute();
    expect(after.length).toBe(before + 1);
    expect(after.some((i) => i.remarks?.includes(t.ticket_no))).toBe(true);

    const hist = ok(await http().get(`/api/service/customer/${orgId}/history`).set(bearer(u.mgmt)), 200);
    const ids = hist.tickets.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([ticketId, demoTicketId]));
    // the salesperson (territory scope) sees the same history
    const salesHist = ok(await http().get(`/api/service/customer/${orgId}/history`).set(bearer(u.sales)), 200);
    expect(salesHist.tickets.map((x: any) => x.id)).toEqual(expect.arrayContaining([ticketId, demoTicketId]));

    // A third ticket, cancelled — used later as a closed link target.
    const c = ok(
      await http().post('/api/service/tickets').set(bearer(u.mgmt)).send({ organisation_id: orgId, complaint: `${TAG} duplicate complaint raised by mistake`, complaint_source: 'Phone' }),
      201,
    );
    cancelledTicketId = c.id;
    ok(await http().patch(`/api/service/tickets/${cancelledTicketId}/status`).set(bearer(u.mgmt)).send({ status: 'cancelled', remarks: 'Duplicate of an existing ticket' }), 200);
  });

  // ---------------------------------------------------------------------------------------------- stage 8
  it('stage 8 — Expense claim on the visit inherits the trip; customer line reaches Accounts reports (M2→M9)', async () => {
    // Link: linking someone else's visit is rejected.
    const theirs = await http().post('/api/expense-claims').set(bearer(u.otherSales)).send({ title: `${TAG} not mine`, visit_id: visitId });
    ok(theirs, [400, 403]);
    expect(JSON.stringify(theirs.body)).toMatch(/own visits/);

    // Link: a claim on my visit inherits the visit's trip.
    const c = ok(await http().post('/api/expense-claims').set(bearer(u.sales)).send({ title: `${TAG} field visit expenses`, visit_id: visitId }), 201);
    claimId = c.id;
    expect(c.visit_id).toBe(visitId);
    expect(c.trip_id).toBe(tripId);

    const amount = `${1500 + Math.floor(Math.random() * 400)}.${String(Math.floor(Math.random() * 90) + 10)}`;
    const item = ok(
      await http().post(`/api/expense-claims/${claimId}/items`).set(bearer(u.sales)).send({
        expense_date: today,
        category_id: travelCatId,
        amount,
        purpose: `${TAG} cab to the customer site`,
        category_details: { from: 'Office', to: 'Customer HQ', mode: 'cab' },
        customer_id: orgId,
      }),
      201,
    );
    itemId = item.item.id;
    expect(item.item.customer_id).toBe(orgId);
    ok(await http().post(`/api/expense-items/${itemId}/attachments`).set(bearer(u.sales)).attach('file', PNG(), 'receipt.png'), 201);

    const byVisit = rows(ok(await http().get('/api/expense-claims').query({ visit_id: visitId }).set(bearer(u.sales)), 200));
    expect(byVisit.map((x: any) => x.id)).toEqual([claimId]);
    const byTrip = rows(ok(await http().get('/api/expense-claims').query({ trip_id: tripId }).set(bearer(u.sales)), 200));
    expect(byTrip.map((x: any) => x.id)).toContain(claimId);

    const v1 = ok(await http().get(`/api/expense-claims/${claimId}`).set(bearer(u.sales)), 200).version;
    expect(ok(await http().post(`/api/expense-claims/${claimId}/submit`).set(bearer(u.sales)).send({ version: v1 }), 200).status).toBe('submitted');

    // The manager sees the customer line once submitted.
    const rmRep = ok(await http().get('/api/expense-reports').query({ customer_ids: orgId }).set(bearer(u.rm)), 200);
    expect(rmRep.data.map((r: any) => r.item_id)).toContain(itemId);

    const v2 = ok(await http().get(`/api/expense-claims/${claimId}`).set(bearer(u.rm)), 200).version;
    ok(await http().post(`/api/expense-claims/${claimId}/manager-approve`).set(bearer(u.rm)).send({ version: v2 }), 200);

    // Link: Accounts (from the Accounts stage) filters the report by customer and sees the customer as a filter option.
    const rep = ok(await http().get('/api/expense-reports').query({ customer_ids: orgId }).set(bearer(u.accounts)), 200);
    const line = rep.data.find((r: any) => r.item_id === itemId);
    expect(line).toMatchObject({ claim_id: claimId, customer_name: orgName, trip_id: tripId });
    const customers = ok(await http().get('/api/expense-reports/customers').set(bearer(u.accounts)), 200);
    expect(customers).toEqual(expect.arrayContaining([{ id: orgId, name: orgName }]));
  });

  // ---------------------------------------------------------------------------------------------- stage 9
  it('stage 9 — Tasks linked to tender / demo / service ticket derive the customer; filters and link lookups (M8)', async () => {
    const create = (body: Record<string, unknown>) =>
      http().post('/api/tasks').set(bearer(u.rm)).send({ assignee_ids: [u.sales.id], deadline: day(4), ...body });

    const made = async (body: Record<string, unknown>) => {
      const id = ok(await create(body), 201).data[0].id as string;
      return ok(await http().get(`/api/tasks/${id}`).set(bearer(u.sales)), 200); // full detail as the assignee sees it
    };
    const t1 = await made({ title: `${TAG} prepare delivery schedule`, category_id: cat.TENDER, tender_id: tenderId });
    const t2 = await made({ title: `${TAG} plan re-trial`, category_id: cat.DEMO, demo_id: demoId });
    const t3 = await made({ title: `${TAG} follow up false alarms`, category_id: cat.SERVICE, service_ticket_id: ticketId });
    taskIds.tender = t1.id;
    taskIds.demo = t2.id;
    taskIds.service = t3.id;
    // Link: the customer is derived from the linked tender / demo / ticket.
    expect(t1).toMatchObject({ tender_id: tenderId, customer_id: orgId });
    expect(t2).toMatchObject({ demo_id: demoId, customer_id: orgId });
    expect(t3).toMatchObject({ service_ticket_id: ticketId, customer_id: orgId });

    // Closed link targets are rejected.
    const closedTender = await create({ title: `${TAG} x`, category_id: cat.TENDER, tender_id: cancelledTenderId });
    ok(closedTender, 400);
    expect(closedTender.body.errors.tender_id).toMatch(/closed/);
    const closedTicket = await create({ title: `${TAG} x`, category_id: cat.SERVICE, service_ticket_id: cancelledTicketId });
    ok(closedTicket, 400);
    expect(closedTicket.body.errors.service_ticket_id).toMatch(/cancelled/);

    // Filters by customer / tender / demo / ticket.
    const list = async (q: Record<string, string>, w: Who = u.rm) => rows(ok(await http().get('/api/tasks').query({ page_size: '100', ...q }).set(bearer(w)), 200)).map((x: any) => x.id);
    expect((await list({ customer_id: orgId })).sort()).toEqual([proposalTaskId, t1.id, t2.id, t3.id].sort());
    expect(await list({ tender_id: tenderId })).toEqual([t1.id]);
    expect(await list({ demo_id: demoId })).toEqual([t2.id]);
    expect(await list({ service_ticket_id: ticketId })).toEqual([t3.id]);

    // Link lookups (the picker the task form uses). The search parameter is `search` (a `q` param is ignored).
    const look = async (type: string) => ok(await http().get('/api/tasks/lookups/links').query({ type, search: TAG }).set(bearer(u.rm)), 200).map((x: any) => x.id);
    const tenders = await look('tender');
    expect(tenders).toContain(tenderId);
    expect(tenders).not.toContain(cancelledTenderId);
    expect(await look('demo')).toEqual(expect.arrayContaining([demoId, visitDemoId]));
    const tickets = await look('service');
    expect(tickets).toEqual(expect.arrayContaining([ticketId, demoTicketId]));
    expect(tickets).not.toContain(cancelledTicketId);

    // Link: the manually assigned task notifies the assignee.
    const n = await waitFor('task_assigned notification', () =>
      db.selectFrom('notifications').select('id').where('user_id', '=', u.sales.id).where('type', '=', 'task_assigned').where('entity_id', '=', t1.id).executeTakeFirst(),
    );
    expect(n).toBeTruthy();
  });

  // ---------------------------------------------------------------------------------------------- stage 9b
  it('stage 9b — Linked-records lookups behind the UI panels: lead / tender / ticket / proposal filters', async () => {
    const list = async (path: string, query: Record<string, string>) => rows(ok(await http().get(path).query(query).set(bearer(u.mgmt)), 200));
    const ids = (r: any[]) => r.map((x: any) => x.id);

    // Demos raised from the lead, run for the tender (with its number), and the demo a service ticket came from.
    expect(ids(await list('/api/demos', { lead_id: lead1Id }))).toEqual([demoId]);
    const forTender = await list('/api/demos', { tender_id: tenderId });
    expect(ids(forTender)).toEqual([demoId]);
    expect(forTender[0].tender_no).toBe(tenderNo);
    expect(ids(await list('/api/demos', { service_ticket_id: demoTicketId }))).toEqual([demoId]);
    ok(await http().get('/api/demos').query({ lead_id: 'not-a-uuid' }).set(bearer(u.mgmt)), 400);

    // Proposals raised from the lead, and the follow-up task the proposal created.
    expect(ids(await list('/api/proposals', { lead_id: lead1Id }))).toEqual([proposalId]);
    expect(ids(await list('/api/tasks', { related_entity_type: 'proposal', related_entity_id: proposalId }))).toEqual([proposalTaskId]);

    // Sales orders raised against the tender, carrying its number.
    const orders = await list('/api/deliveries', { tender_id: tenderId });
    expect(ids(orders)).toEqual([deliveryId]);
    expect(orders[0].tender_no).toBe(tenderNo);
    ok(await http().get('/api/deliveries').query({ tender_id: 'not-a-uuid' }).set(bearer(u.mgmt)), 400);
  });

  // ---------------------------------------------------------------------------------------------- stage 10
  it('stage 10 — Regional / salesperson performance reflects the new leads, visit and tasks (M10)', async () => {
    for (const [w, before] of [
      [u.mgmt, regionalBefore],
      [u.rm, rmRegionalBefore],
    ] as const) {
      const now = await regional(w);
      const b = empRow(before);
      const a = empRow(now);
      expect(a.leads.total).toBe(b.leads.total + 2);
      expect(a.leads.valueLakh).toBeCloseTo(b.leads.valueLakh + 52.5, 2);
      expect(a.visits.total).toBe(b.visits.total + 1);
      expect(a.visits.completed).toBe(b.visits.completed + 1);
      expect(a.tasks.total).toBeGreaterThanOrEqual(b.tasks.total + 4); // 3 manual + 1 proposal follow-up
      // zone-level pipeline (org is in the sales user's zone)
      expect(now.sales.totalLeads).toBe(before.sales.totalLeads + 2);
      expect(now.visits.total).toBe(before.visits.total + 1);
      expect(now.visits.completed).toBe(before.visits.completed + 1);
      expect(now.tenders.total).toBe(before.tenders.total + 2);
      expect(now.tenders.won).toBe(before.tenders.won + 1);
    }
  });

  // ---------------------------------------------------------------------------------------------- stage 11
  it('stage 11 — Management dashboard metrics move by the pipeline deltas (M10)', async () => {
    const a = await metrics(u.mgmt);
    const b = metricsBefore;
    expect(a.leadsCount.total).toBe(b.leadsCount.total + 2);
    expect(a.leadsCount.totalValueLakh).toBeCloseTo(b.leadsCount.totalValueLakh + 52.5, 1);
    expect(a.visitsCount.total).toBe(b.visitsCount.total + 1);
    expect(a.visitsCount.completed).toBe(b.visitsCount.completed + 1);
    expect(a.tasksCount.total).toBeGreaterThanOrEqual(b.tasksCount.total + 4);
    expect(a.tasksCount.pending).toBeGreaterThanOrEqual(b.tasksCount.pending + 4);
    // demo-failure ticket + equipment ticket + the cancelled one; cancelled tickets do not count as open
    expect(a.serviceTicketsCount.total).toBe(b.serviceTicketsCount.total + 3);
    expect(a.serviceTicketsCount.open).toBe(b.serviceTicketsCount.open + 2);
    expect(a.deliveriesCount.total).toBe(b.deliveriesCount.total + 1);
    expect(a.deliveriesCount.scheduled).toBe(b.deliveriesCount.scheduled + 1);
    expect(a.proposalsCount.total).toBe(b.proposalsCount.total + 1);
    // sent, then a follow-up logged (FOLLOW_UP_REQUIRED) — still with the customer, so still "submitted"
    expect(a.proposalsCount.submitted).toBe(b.proposalsCount.submitted + 1);
    expect(a.tendersCount.total).toBe(b.tendersCount.total + 2);
    expect(a.tendersCount.won).toBe(b.tendersCount.won + 1);
    expect(a.expensesCount.pendingAccounts).toBeGreaterThanOrEqual(b.expensesCount.pendingAccounts + 1);

    // Regional manager scope: leads by regional_manager_id, tasks where they are the reporting manager.
    const r = await metrics(u.rm);
    expect(r.leadsCount.total).toBe(rmMetricsBefore.leadsCount.total + 2);
    // 3 manual tasks + the proposal follow-up task (its reporting manager is snapshotted from the assignee)
    expect(r.tasksCount.total).toBe(rmMetricsBefore.tasksCount.total + 4);
  });

  // ---------------------------------------------------------------------------------------------- stage 12
  it('stage 12 — Customer 360: timeline aggregates leads, follow-ups, proposals, tenders and every interaction type', async () => {
    const tl = ok(await http().get(`/api/organisations/${orgId}/timeline`).set(bearer(u.mgmt)), 200);
    expect(tl.leads.map((l: any) => l.id).sort()).toEqual([lead1Id, lead2Id].sort());
    expect(tl.follow_ups.map((f: any) => f.lead_id).sort()).toEqual([lead1Id, lead2Id].sort());
    expect(tl.follow_ups.find((f: any) => f.lead_id === lead1Id).status).toBe('completed');
    expect(tl.proposals.map((p: any) => p.id)).toEqual([proposalId]);
    expect(tl.tenders.map((t: any) => t.id).sort()).toEqual([tenderId, cancelledTenderId].sort());
    const types = new Set(tl.timeline.map((i: any) => i.type));
    expect(tl.timeline.some((i: any) => i.lead_id === lead1Id)).toBe(true);
    expect(tl.timeline.some((i: any) => i.lead_id === lead2Id)).toBe(true);
    for (const t of ['physical_visit', 'demo', 'service']) expect(types.has(t)).toBe(true);
    expect(tl.timeline.filter((i: any) => i.type === 'service').length).toBeGreaterThanOrEqual(3);
    expect(tl.timeline.find((i: any) => i.type === 'demo').demo_id).toBe(demoId);
    // previous_meetings now carries completed field visits
    expect(tl.management_summary.previous_meetings.some((m: any) => m.visit_id === visitId && m.type === 'physical_visit')).toBe(true);
    expect(tl.management_summary.current_salesperson).toBeTruthy();
    expect(tl.management_summary.follow_up_history.total).toBe(2);

    const org = ok(await http().get(`/api/organisations/${orgId}`).set(bearer(u.mgmt)), 200);
    expect(org.totalLeads).toBe(2);
    expect(org.totalTenders).toBe(2);
    expect(org.contacts.map((c: any) => c.id)).toContain(contactId);
  });

  // ---------------------------------------------------------------------------------------------- stage 13
  it('stage 13 — Notifications and audit trail exist for the pipeline entities', async () => {
    const notif = async (entityId: string, type?: string) => {
      let q = db.selectFrom('notifications').select(['type', 'user_id', 'entity_type']).where('entity_id', '=', entityId);
      if (type) q = q.where('type', '=', type);
      return q.execute();
    };
    // demo technical failure → management, demo, service team, requester, regional managers
    const fail = await waitFor('demo_technical_failure notifications', async () => {
      const r = await notif(demoTicketId, 'demo_technical_failure');
      return r.length ? r : null;
    });
    expect(fail.map((n) => n.user_id)).toEqual(expect.arrayContaining([u.mgmt.id, u.service.id, u.sales.id, u.rm.id]));
    expect(fail.every((n) => n.entity_type === 'service_ticket')).toBe(true);
    // new service ticket raised by sales → service team / RMs
    const created = await waitFor('service_ticket_created notification', async () => {
      const r = await notif(ticketId, 'service_ticket_created');
      return r.length ? r : null;
    });
    expect(created.map((n) => n.user_id)).toContain(u.service.id);
    expect((await notif(taskIds.tender, 'task_assigned')).map((n) => n.user_id)).toEqual([u.sales.id]);
    expect((await notif(tenderId, 'tender_assigned')).map((n) => n.user_id)).toContain(u.sales.id);

    const audited = async (entityType: string, entityId: string) =>
      waitFor(`audit ${entityType} ${entityId}`, async () => {
        const r = await db.selectFrom('audit_log').select('action').where('entity_type', '=', entityType).where('entity_id', '=', entityId).execute();
        return r.length ? r.map((x) => x.action) : null;
      }, 10000);
    expect(await audited('lead', lead1Id)).toEqual(expect.arrayContaining(['create']));
    expect(await audited('lead', lead2Id)).toEqual(expect.arrayContaining(['create']));
    expect(await audited('visit', visitId)).toEqual(expect.arrayContaining(['CREATE_VISIT', 'COMPLETE_VISIT']));
    expect(await audited('demo', demoId)).toEqual(expect.arrayContaining(['DEMO_CREATED', 'DEMO_COMPLETED']));
    expect(await audited('service_ticket', ticketId)).toEqual(expect.arrayContaining(['create']));
    expect(await audited('service_ticket', demoTicketId)).toEqual(expect.arrayContaining(['create']));
    expect(await audited('proposal', proposalId)).toBeTruthy();
    expect(await audited('expense_claim', claimId)).toEqual(expect.arrayContaining(['create']));
    expect(await audited('task', taskIds.service)).toEqual(expect.arrayContaining(['task_create']));

    // Tenders keep their own history instead of audit_log: status moves and the sales order land in tender_activities.
    const tenderHistory = await db.selectFrom('tender_activities').select('event_type').where('tender_id', '=', tenderId).execute();
    expect(tenderHistory.map((h) => h.event_type)).toEqual(expect.arrayContaining(['STATUS_TENDER_SUBMITTED', 'STATUS_WON', 'SALES_ORDER_CREATED']));
    // Not asserted (known gap): tenders and the sales-order delivery write no audit_log rows.
  });

  // ---------------------------------------------------------------------------------------------- stage 14
  it('stage 14 — RBAC across modules; the salesperson sees their own pipeline items', async () => {
    ok(await http().get('/api/leads').set(bearer(u.accounts)), 403);
    ok(await http().get('/api/visits').set(bearer(u.tender)), 403);
    ok(await http().get('/api/demos/analytics').set(bearer(u.sales)), 403);
    ok(await http().get(`/api/leads/${lead1Id}`).set(bearer(u.outsider)), [403, 404]);
    ok(await http().get(`/api/tasks/${taskIds.tender}`).set(bearer(u.outsider)), 404);

    const leads = rows(ok(await http().get('/api/leads').query({ organisation_id: orgId }).set(bearer(u.sales)), 200)).map((l: any) => l.id);
    expect(leads.sort()).toEqual([lead1Id, lead2Id].sort());
    const visits = rows(ok(await http().get('/api/visits').query({ organisation_id: orgId }).set(bearer(u.sales)), 200)).map((v: any) => v.id);
    expect(visits).toEqual([visitId]);
    const proposals = rows(ok(await http().get('/api/proposals').query({ customer_id: orgId }).set(bearer(u.sales)), 200)).map((p: any) => p.id);
    expect(proposals).toEqual([proposalId]);
    const deliveries = rows(ok(await http().get('/api/deliveries').query({ organisation_id: orgId }).set(bearer(u.sales)), 200)).map((d: any) => d.id);
    expect(deliveries).toEqual([deliveryId]); // assigned to the tender's salesperson
    const mine = rows(ok(await http().get('/api/tasks').query({ view: 'mine', customer_id: orgId, page_size: '100' }).set(bearer(u.sales)), 200)).map((t: any) => t.id);
    expect(mine.sort()).toEqual([proposalTaskId, taskIds.tender, taskIds.demo, taskIds.service].sort());
    const claims = rows(ok(await http().get('/api/expense-claims').query({ visit_id: visitId }).set(bearer(u.sales)), 200)).map((c: any) => c.id);
    expect(claims).toEqual([claimId]);
    // accounts has no organisations access but still sees the claim from the Accounts stage
    ok(await http().get(`/api/expense-claims/${claimId}`).set(bearer(u.accounts)), 200);
  });
});
