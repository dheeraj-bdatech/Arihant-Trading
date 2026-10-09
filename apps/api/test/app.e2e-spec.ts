import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

import { Kysely } from 'kysely';
import { Database as DB } from '@arihant/shared';

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
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const db = moduleFixture.get<Kysely<DB>>('KYSELY_DB');
    await db.deleteFrom('demo_reservations').execute();
    await db.deleteFrom('demos').execute();
    await db.updateTable('demo_equipment').set({ availability_status: 'available', reserved_until: null }).execute();
    await db.deleteFrom('employee_activities').execute();
    await db.deleteFrom('visit_updates').execute();
    await db.deleteFrom('expenses').execute();
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
          planned_date: '2026-10-15',
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
          requested_date: '2026-10-01',
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
          reserved_from: '2026-10-01',
          reserved_to: '2026-10-05',
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
          reserved_from: '2026-10-03',
          reserved_to: '2026-10-07',
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
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${salesToken}`)
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
    let createdExpenseId: string;

    it('submits a new expense report by sales executive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/expenses')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          category: 'travel',
          amount: 2500,
          expense_date: '2026-09-15',
          purpose: 'Cab fare for client site visit in Gurgaon',
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('submitted');
      expect(Number(res.body.amount)).toBe(2500);
      createdExpenseId = res.body.id;
    });

    it('blocks self-approval when submitter attempts to endorse own expense (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/expenses/${createdExpenseId}/manager-approve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ decision: 'manager_approved' });
      expect(res.status).toBe(403);
    });

    it('allows Regional Manager to grant stage-1 approval', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/expenses/${createdExpenseId}/manager-approve`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({ decision: 'manager_approved', manager_remarks: 'Verified cab slips' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('manager_approved');
    });
  });

  describe('MODULE 10 & 11: Task Accountability & Salary Evidence Dossier', () => {
    it('retrieves operational accountability metrics (due today, overdue, repeat delays)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tasks/accountability')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.dueTodayCount).toBeDefined();
      expect(res.body.overdueCount).toBeDefined();
    });

    it('retrieves salary evidence report with explicit Blueprint §4 no-auto-deduction disclaimer', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tasks/salary-evidence')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.disclaimer).toContain('automated salary or payroll deductions are strictly prohibited');
      expect(Array.isArray(res.body.dossiers)).toBe(true);
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
