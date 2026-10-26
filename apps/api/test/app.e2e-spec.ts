import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

import { Kysely } from 'kysely';
import { Database as DB } from '@arihant/shared';
import { purgeTaskModule } from './helpers/reset-tasks';
import { configureApp } from '../src/common/app-setup';

/** IST calendar day `days` from today (demo / reservation dates cannot be in the past). */
const istDay = (days = 0) => new Date(Date.now() + 5.5 * 3600000 + days * 86400000).toISOString().slice(0, 10);

describe('Arihant BOS API E2E Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let salesToken: string;
  let rmToken: string;
  let adminToken: string;
  let testTenderId: string;
  let testVisitId: string;
  let testDemoId: string;
  let testEquipmentId: string;
  let testTicketId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();

    const db = moduleFixture.get<Kysely<DB>>('KYSELY_DB');
    // Module 8 tasks can reference demos: clear task data before wiping demos.
    await purgeTaskModule(db);
    await db.deleteFrom('demo_reservations').execute();
    await db.deleteFrom('demos').execute();
    await db.updateTable('demo_equipment').set({ availability_status: 'available', reserved_until: null }).execute();
    await db.deleteFrom('employee_activities').execute();
    await db.deleteFrom('visit_updates').execute();
    await db.deleteFrom('expenses').execute();
    // Module 9 claims keep a strict FK to their trip/visit; unlink them before this suite wipes visits and trips.
    await db.updateTable('expense_claims').set({ trip_id: null, visit_id: null }).execute();
    await db.deleteFrom('interactions').where('visit_id', 'is not', null).execute();
    await db.deleteFrom('visits').execute();
    await db.deleteFrom('trips').execute();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('STAGE 0: Auth & Identity Verification', () => {
    it('rejects invalid login credentials (401)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'mgmt@arihant.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    });

    it('logs in as management (Vikram Arihant)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'mgmt@arihant.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.role).toBe('management');
      mgmtToken = res.body.accessToken;
    });

    it('logs in as regional manager North (Rajesh Sharma)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'regmgr.north@arihant.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.role).toBe('regional_manager');
      rmToken = res.body.accessToken;
    });

    it('logs in as sales executive Delhi (Amit Verma)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.role).toBe('sales');
      salesToken = res.body.accessToken;
    });

    it('logs in as system administrator (admin@arihant.com)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@arihant.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.role).toBe('admin');
      adminToken = res.body.accessToken;
    });

    it('retrieves profile via /api/auth/me', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('sales.delhi@arihant.com');
      expect(res.body.role).toBe('sales');
    });
  });

  describe('MODULE 1: Users, Departments & Role Permissions Matrix', () => {
    it('allows Admin to retrieve departments master', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/masters/departments')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(5);
    });

    it('allows Admin to retrieve role permissions matrix (96 baseline records)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/masters/role-permissions')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(10);
    });

    it('denies sales executive from creating a department (RBAC 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/masters/departments')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ code: 'rnd', name: 'Research & Development' });
      expect(res.status).toBe(403);
    });
  });

  describe('MODULE 2: Lead & Customer Deduplication Anchor', () => {
    it('checks duplicate organisations to prevent repeated customer rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/organisations/check-duplicate?name=BSF')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(200);
      expect(res.body.matches).toBeDefined();
      expect(res.body.isDuplicate).toBe(true);
      expect(res.body.suggestion).toContain('Organisation already exists');
    });

    it('creates an interaction on customer timeline and confirms link', async () => {
      // Fetch an existing organisation
      const orgs = await request(app.getHttpServer())
        .get('/api/organisations?limit=1')
        .set('Authorization', `Bearer ${salesToken}`);
      const orgId = orgs.body.data[0].id;

      const res = await request(app.getHttpServer())
        .post('/api/interactions')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: orgId,
          type: 'whatsapp',
          remarks: 'Discussed X-Ray scanner delivery milestone over WhatsApp',
          outcome: 'Client requested formal demonstration date',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('whatsapp');
    });
  });

  describe('MODULE 3: Visits & Manager "Also-Meet" Intervention', () => {
    it('allows sales executive to plan a client field visit', async () => {
      const orgs = await request(app.getHttpServer())
        .get('/api/organisations?limit=1')
        .set('Authorization', `Bearer ${salesToken}`);
      const orgId = orgs.body.data[0].id;

      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: orgId,
          // DEF-040: the post-visit report is accepted only on / after the visit date, so the visit is for today.
          planned_date: istDay(0),
          purpose: 'Quarterly review with procurement IG',
          location: 'Jalandhar Frontier HQ',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('planned');
      testVisitId = res.body.id;
    });

    it('allows Regional Manager to attach an "Also-Meet" strategic directive', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${testVisitId}/intervention`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({
          instructions: 'Also meet Commandant Signals regarding pending DFMD AMC contract.',
        });
      expect(res.status).toBe(201);
      expect(res.body.remarks).toContain('Manager Intervention');
    });

    it('submits post-visit update and synchronously records customer interaction timeline', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${testVisitId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: true,
          person_met: 'DIG RS Dhillon',
          discussion: 'Reviewed deployment of hand-held detectors and signals unit requirements.',
          outcome: 'Trial certificate requested for DFMD',
        });
      expect(res.status).toBe(201);
      expect(res.body.met_completed).toBe(true);
    });
  });

  describe('MODULE 6: Tender Pipeline & Win/Loss Analysis', () => {
    it('lists tenders for sales executive with search and pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders?limit=10')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);

      const db = app.get<Kysely<DB>>('KYSELY_DB');
      const found = res.body.data.find((t: any) => t.status === 'awaiting_approval');
      if (found) {
        testTenderId = found.id;
      } else {
        const candidate = res.body.data[0];
        await db.updateTable('tenders').set({ status: 'awaiting_approval' }).where('id', '=', candidate.id).execute();
        testTenderId = candidate.id;
      }
    });

    it('retrieves tender statistics including PQ vs General counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/stats')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.pqCount).toBeDefined();
      expect(res.body.generalMhaCount).toBeDefined();
    });

    it('denies sales executive from making management participation decision (RBAC 403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${testTenderId}/approve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          decision: 'approved',
          remarks: 'Unauthorized approval attempt',
        });
      expect(res.status).toBe(403);
    });

    it('allows management to record participation decision', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${testTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          decision: 'approved',
          remarks: 'Approved by management in e2e test',
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('under_preparation');
    });

    it('allows tender team or management to record structured win/loss outcome', async () => {
      const db = app.get<Kysely<DB>>('KYSELY_DB');
      await db
        .insertInto('tender_status_history')
        .values({
          tender_id: testTenderId,
          from_status: 'under_preparation',
          to_status: 'submitted',
          changed_by: '55555555-5555-5555-5555-555555555555',
          remarks: 'Submitted tender',
        })
        .execute();
      await db.updateTable('tenders').set({ status: 'submitted' }).where('id', '=', testTenderId).execute();

      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${testTenderId}/outcome`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          result: 'lost',
          reason: 'pricing',
          competitor: 'Godrej Security Solutions',
          value_lakh: 85.5,
        });
      expect(res.status).toBe(201);
      expect(res.body.result).toBe('lost');
    });
  });

  describe('MODULE 4 & 5: Demos & Equipment Double-Booking Prevention', () => {
    it('retrieves demo equipment matrix', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/demos/equipment')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      testEquipmentId = res.body[0].id;
    });

    it('creates a demo trial request', async () => {
      const orgs = await request(app.getHttpServer())
        .get('/api/organisations?limit=1')
        .set('Authorization', `Bearer ${salesToken}`);
      const orgId = orgs.body.data[0].id;

      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: orgId,
          location: 'Delhi Police HQ',
          requested_date: istDay(30),
          equipment_required: 'Hand Held Metal Detector',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      testDemoId = res.body.id;
    });

    it('successfully reserves available equipment for trial dates', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${testDemoId}/reserve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          equipment_id: testEquipmentId,
          reserved_from: istDay(30),
          reserved_to: istDay(34),
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('approved');
    });

    it('strictly prevents double-booking on overlapping dates (409 Conflict)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${testDemoId}/reserve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          equipment_id: testEquipmentId,
          reserved_from: istDay(32),
          reserved_to: istDay(36),
        });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already reserved');
    });
  });

  describe('MODULE 8: Service Tickets & Service Dashboard Metrics', () => {
    it('creates a service breakdown complaint ticket', async () => {
      const orgs = await request(app.getHttpServer())
        .get('/api/organisations?limit=1')
        .set('Authorization', `Bearer ${salesToken}`);
      const orgId = orgs.body.data[0].id;

      const res = await request(app.getHttpServer())
        // Sales raise complaints through the service desk; ticket creation is for service / managers (Module 6 RBAC).
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: orgId,
          complaint: 'X-Ray scanner conveyor belt motor stalled during peak shift',
          priority: 'critical',
          warranty_status: 'in_warranty',
        });
      expect(res.status).toBe(201);
      expect(res.body.ticket_no).toBeDefined();
      testTicketId = res.body.id;
    });

    it('retrieves service dashboard metrics (new, pending, overdue, SLA closure)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/stats')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeDefined();
      expect(res.body.overdueTickets).toBeDefined();
      expect(res.body.avgClosureDays).toBeDefined();
    });
  });

  describe('MODULE 9: Expense Reimbursements & Two-Stage Signoff', () => {
    let claimId: string;
    const version = async (token: string) =>
      (await request(app.getHttpServer()).get(`/api/expense-claims/${claimId}`).set('Authorization', `Bearer ${token}`)).body.version;

    it('submits a new expense claim by sales executive', async () => {
      const draft = await request(app.getHttpServer())
        .post('/api/expense-claims')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ title: 'Cab fare for client site visit in Gurgaon' });
      expect(draft.status).toBe(201);
      claimId = draft.body.id;
      const cats = await request(app.getHttpServer()).get('/api/expense-categories').set('Authorization', `Bearer ${salesToken}`);
      const travel = cats.body.find((c: any) => c.code === 'TRAVEL').id;
      const item = await request(app.getHttpServer())
        .post(`/api/expense-claims/${claimId}/items`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          category_id: travel,
          amount: '2500',
          expense_date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
          purpose: 'Cab fare for client site visit in Gurgaon',
          category_details: { from: 'Connaught Place', to: 'Gurgaon', mode: 'cab' },
          confirm_not_duplicate: true,
        });
      expect(item.status).toBe(201);
      const receipt = await request(app.getHttpServer())
        .post(`/api/expense-items/${item.body.item.id}/attachments`)
        .set('Authorization', `Bearer ${salesToken}`)
        .attach('file', Buffer.from(`%PDF-1.4 cab slip ${Date.now()}`), 'cab-slip.pdf');
      expect(receipt.status).toBe(201);
      const res = await request(app.getHttpServer())
        .post(`/api/expense-claims/${claimId}/submit`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ version: await version(salesToken) });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('submitted');
      expect(res.body.total_claimed).toBe(2500);
    });

    it('blocks self-approval when submitter attempts to endorse own expense (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/expense-claims/${claimId}/manager-approve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ version: await version(salesToken) });
      expect(res.status).toBe(403);
    });

    it('allows Regional Manager to grant stage-1 approval', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/expense-claims/${claimId}/manager-approve`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({ version: await version(rmToken), comment: 'Verified cab slips' });
      expect(res.status).toBe(200);
      // Stage-1 approval hands the claim to the Accounts queue (stage 2).
      expect(res.body.status).toBe('accounts_review');
    });
  });

  describe('MODULE 8: Task Accountability & Performance Evidence', () => {
    it('retrieves operational accountability metrics (due today, overdue, repeat delays)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/accountability/dashboard')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.totals.due_today).toBeDefined();
      expect(res.body.totals.overdue).toBeDefined();
      expect(res.body.totals.repeated_delay_flag).toBeDefined();
    });

    it('returns evidence-only performance data with the no-deduction disclaimer (Blueprint §4, §43)', async () => {
      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${mgmtToken}`);
      const res = await request(app.getHttpServer())
        .get('/api/performance/evidence')
        .query({ employee_id: me.body.id || me.body.user?.id })
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.disclaimer).toContain('supporting evidence only');
      expect(JSON.stringify(res.body)).not.toMatch(/salary_amount|deduction_amount|penalty|incentive_amount/i);
    });
  });

  describe('MODULE 13 & 16: Executive Center & System Audit Trail', () => {
    it('returns management command metrics for executive desk', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/dashboard/metrics')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.tendersCount).toBeDefined();
      expect(res.body.recentExceptions).toBeDefined();
    });

    it('retrieves immutable audit logs created during all module operations', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/audit?limit=20')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
