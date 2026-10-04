import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { Kysely } from 'kysely';
import { DB } from '@arihant/shared';

describe('Arihant BOS — Strict Meeting & Blueprint Verification Suite', () => {
  let app: INestApplication;
  let db: Kysely<DB>;

  // Role Tokens
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let tenderToken: string;
  let demoToken: string;
  let serviceToken: string;
  let accountsToken: string;
  let adminToken: string;

  // Shared Entities
  let orgId: string;
  let xbisProductId: string;
  let dfmdEquipmentId: string;
  let visitId: string;
  let demo1Id: string;
  let demo2Id: string;
  let tenderId: string;
  let ticketId: string;
  let expenseId: string;
  let taskId: string;
  let salesUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    db = moduleFixture.get<Kysely<DB>>('KYSELY_DB');

    // Clean test state for isolation
    await db.deleteFrom('demo_reservations').execute();
    await db.deleteFrom('demo_outcomes').execute();
    await db.deleteFrom('demos').execute();
    await db.updateTable('demo_equipment').set({ availability_status: 'available', reserved_until: null }).execute();
    await db.deleteFrom('task_blockers').execute();
    await db.deleteFrom('tasks').execute();
    await db.deleteFrom('service_reports').execute();
    await db.deleteFrom('service_tickets').execute();
    await db.deleteFrom('expenses').execute();
    await db.deleteFrom('visit_updates').execute();
    await db.deleteFrom('interactions').where('visit_id', 'is not', null).execute();
    await db.deleteFrom('visits').execute();
    await db.deleteFrom('trips').execute();
    await db.deleteFrom('tender_results').execute();
    await db.deleteFrom('tenders').where('tender_no', 'like', 'BIHAR-POL-%').execute();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // GATE 1 & ROLE AUTHENTICATION: 8-Role Matrix Verification (§5)
  // =========================================================================
  describe('1. 8-Role Authentication & Token Retrieval', () => {
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      return { token: res.body.accessToken, user: res.body.user };
    };

    it('authenticates Top Management (mgmt@arihant.com)', async () => {
      mgmtToken = (await login('mgmt@arihant.com')).token;
    });

    it('authenticates Regional Manager North (regmgr.north@arihant.com)', async () => {
      rmToken = (await login('regmgr.north@arihant.com')).token;
    });

    it('authenticates Sales Executive Delhi (sales.delhi@arihant.com)', async () => {
      const res = await login('sales.delhi@arihant.com');
      salesToken = res.token;
      salesUserId = res.user.id;
    });

    it('authenticates Tender Specialist (tender@arihant.com)', async () => {
      tenderToken = (await login('tender@arihant.com')).token;
    });

    it('authenticates Demo Engineer (demo@arihant.com)', async () => {
      demoToken = (await login('demo@arihant.com')).token;
    });

    it('authenticates Service Engineer (service@arihant.com)', async () => {
      serviceToken = (await login('service@arihant.com')).token;
    });

    it('authenticates Corporate Accounts (accounts@arihant.com)', async () => {
      accountsToken = (await login('accounts@arihant.com')).token;
    });

    it('authenticates System Administrator (admin@arihant.com)', async () => {
      adminToken = (await login('admin@arihant.com')).token;
    });
  });

  // =========================================================================
  // MODULE 1: B2G Organisation Deduplication & Contact Capture (§6, §7)
  // =========================================================================
  describe('2. B2G Organisation Anchor & Deduplication (§6, §7)', () => {
    it('creates a central government department organisation (Bihar Police HQ - Patna)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/organisations')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          name: 'Bihar Police Headquarter - Patna Depot',
          city: 'Patna',
          state: 'Bihar',
        });
      expect([200, 201]).toContain(res.status);
      orgId = res.body.id;
      expect(orgId).toBeDefined();
    });

    it('enforces deduplication: existing department returns the same organisation entity', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/organisations')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          name: 'Bihar Police Headquarter - Patna Depot',
          city: 'Patna',
          state: 'Bihar',
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.id).toBe(orgId);
    });

    it('retrieves scanning products (XBIS X-Ray machines)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/masters/products')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(200);
      const xbis = res.body.find((p: any) => p.name.includes('XBIS') || p.name.includes('X-Ray') || p.name.includes('Baggage'));
      xbisProductId = xbis ? xbis.id : res.body[0].id;
      expect(xbisProductId).toBeDefined();
    });
  });

  // =========================================================================
  // MODULE 2: Field Visits, "Also-Meet" Directives & "Contact Unavailable" Outcome
  // =========================================================================
  describe('3. Field Visit Planning, Also-Meet Directives & Contact Unavailable (§9 – §12)', () => {
    const plannedDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    it('plans a field visit to Patna 1 week in advance', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: orgId,
          location: 'Patna Police HQ, Secretariate Road, Patna',
          planned_date: plannedDate,
          purpose: 'XBIS dual-energy scanner introduction and QR compliance review',
          travel_required: true,
          demo_required: true,
        });
      expect([200, 201]).toContain(res.status);
      visitId = res.body.id;
      expect(visitId).toBeDefined();
      expect(res.body.status).toBe('planned');
    });

    it('allows Regional Manager to attach an "Also-Meet" strategic directive to save travel costs (§10)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitId}/manager-intervention`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({
          instructions: 'While in Patna, also visit CISF Patna Airport Unit to inspect baggage scanner readiness.',
          location: 'CISF Unit, Jai Prakash Narayan International Airport, Patna',
        });
      expect([200, 201]).toContain(res.status);
    });

    it('submits post-visit update when contact is UNAVAILABLE (VIP Convoy Duty) (§12)', async () => {
      const followupDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: false,
          remarks: 'Officer on emergency VIP convoy movement. Meeting rescheduled on-site with Store Inspector.',
          next_action: 'Return for formal committee trial demonstration',
          followup_date: followupDate,
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.met_completed).toBe(false);
    });

    it('verifies that visit status is NOT_COMPLETED and recorded on customer timeline', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/${visitId}`)
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('not_completed');
    });
  });

  // =========================================================================
  // MODULE 3: Heavy Demo Fleet & Conflict Resolution by Tender Value (§13 – §17)
  // =========================================================================
  describe('4. Demo Fleet Depots & Conflict Resolution by Tender Value (§13 – §17)', () => {
    const trialDate1 = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
    const trialDate2 = new Date(Date.now() + 12 * 86400000).toISOString().split('T')[0];

    it('retrieves demo equipment stationed at depots (Delhi, Patna, Kolkata)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/demos/equipment')
        .set('Authorization', `Bearer ${demoToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      dfmdEquipmentId = res.body[0].id;
      expect(dfmdEquipmentId).toBeDefined();
    });

    it('creates Demo 1 for Sales Rep Gulshan (Lower Tender Value: ₹40 Lakhs)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: orgId,
          requested_date: trialDate1,
          location: 'Patna Regional Office',
          purpose: 'DFMD trial for gate screening',
          deal_value: 4000000, // ₹40 Lakhs
        });
      expect([200, 201]).toContain(res.status);
      demo1Id = res.body.id;
      expect(demo1Id).toBeDefined();
    });

    it('reserves the equipment unit for Demo 1', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demo1Id}/reserve-equipment`)
        .set('Authorization', `Bearer ${demoToken}`)
        .send({
          equipment_id: dfmdEquipmentId,
          reserved_from: trialDate1,
          reserved_to: trialDate2,
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('approved');
    });

    it('creates Demo 2 for Sales Rep Sahil (Higher Tender Value: ₹2.50 Crores)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${rmToken}`)
        .send({
          organisation_id: orgId,
          requested_date: trialDate1,
          location: 'Patna Police HQ Main Depot',
          purpose: 'High-value Multi-zone trial for tender bid',
          deal_value: 25000000, // ₹2.50 Crores
        });
      expect([200, 201]).toContain(res.status);
      demo2Id = res.body.id;
      expect(demo2Id).toBeDefined();
      expect(demo2Id).not.toBe(demo1Id);
    });

    it('detects equipment conflict and returns 409 with priority recommendation (§16)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demo2Id}/reserve-equipment`)
        .set('Authorization', `Bearer ${demoToken}`)
        .send({
          equipment_id: dfmdEquipmentId,
          reserved_from: trialDate1,
          reserved_to: trialDate2,
        });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already reserved');
      expect(res.body.priority_analysis).toBeDefined();
      expect(res.body.priority_analysis.recommendation).toContain('Current demo has higher tender value');
    });

    it('allows Management Strategic Override to prioritize higher tender value (§16)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demo2Id}/reserve-equipment`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          equipment_id: dfmdEquipmentId,
          reserved_from: trialDate1,
          reserved_to: trialDate2,
          override_conflict: true,
          override_reason: 'Management Decision: Prioritized Demo 2 due to higher tender value ₹2.50 Cr vs ₹40 L.',
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('approved');
    });
  });

  // =========================================================================
  // MODULE 4: Tender Management on Bihar Portal & Win/Loss Analysis (§18 – §27)
  // =========================================================================
  describe('5. Tender Management & Win/Loss Post-Mortem (§18 – §27)', () => {
    const submissionDeadline = new Date(Date.now() + 5 * 86400000).toISOString();

    it('records a new tender on Bihar e-Procurement Portal', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${tenderToken}`)
        .send({
          tender_no: `BIHAR-POL-2026-XBIS-${Math.floor(1000 + Math.random() * 9000)}`,
          requirement_text: 'Procurement of Dual-Energy X-Ray Baggage Scanners for Bihar Police',
          department: 'Bihar Police State Procurement Cell',
          organisation_id: orgId,
          assigned_to: salesUserId,
          category: 'pq',
          submission_deadline: submissionDeadline,
          estimated_value: 25000000, // ₹2.50 Crores
          city: 'Patna',
          state: 'Bihar',
          portal: 'Bihar e-Procurement Portal',
        });
      expect([200, 201]).toContain(res.status);
      tenderId = res.body.id;
      expect(tenderId).toBeDefined();
      expect(res.body.status).toBe('identified');
    });

    it('submits tender for management participation review', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${tenderId}/request-approval`)
        .set('Authorization', `Bearer ${tenderToken}`)
        .send({
          remarks: 'Submitted for management margin review and technical qualification signoff.',
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('awaiting_approval');
    });

    it('allows management to approve tender participation (§22)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${tenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          decision: 'approved',
          remarks: 'Approved. Ensure dual-energy generator certificates are included.',
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('under_preparation');
    });

    it('advances through PQ submission, technical evaluation to submitted', async () => {
      // 1. Move to pq_submitted
      const pqRes = await request(app.getHttpServer())
        .patch(`/api/tenders/${tenderId}/status`)
        .set('Authorization', `Bearer ${tenderToken}`)
        .send({ status: 'pq_submitted', remarks: 'PQ envelopes submitted to Bihar portal' });
      expect(pqRes.status).toBe(200);
      expect(pqRes.body.status).toBe('pq_submitted');

      // 2. Move to pq_qualified
      const qualRes = await request(app.getHttpServer())
        .patch(`/api/tenders/${tenderId}/status`)
        .set('Authorization', `Bearer ${tenderToken}`)
        .send({ status: 'pq_qualified', remarks: 'Technical committee qualified PQ' });
      expect(qualRes.status).toBe(200);
      expect(qualRes.body.status).toBe('pq_qualified');

      // 3. Move to submitted
      const res = await request(app.getHttpServer())
        .patch(`/api/tenders/${tenderId}/status`)
        .set('Authorization', `Bearer ${tenderToken}`)
        .send({ status: 'submitted', remarks: 'Commercial envelopes uploaded to Bihar portal.' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('submitted');
    });

    it('records structured Win/Loss post-mortem analysis (§26)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${tenderId}/outcome`)
        .set('Authorization', `Bearer ${tenderToken}`)
        .send({
          result: 'lost',
          loss_reason: 'PRICING',
          competitor: 'Smiths Detection India Ltd',
          value_lakh: 235,
          result_date: new Date().toISOString().split('T')[0],
          pricing_issue: 'L1 price threshold missed by 6.3%. Competitor offered aggressive bundled AMC.',
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.status).toBe('lost');
    });
  });

  // =========================================================================
  // MODULE 6: Service & After-Sales Management Ticketing (§31 – §34)
  // =========================================================================
  describe('6. Service Ticketing & Mandatory Service Report (§31 – §34)', () => {
    it('creates a service breakdown complaint ticket', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          organisation_id: orgId,
          complaint: 'XBIS Conveyor belt motor intermittent stalling during baggage screening.',
          priority: 'high',
          equipment_serial: 'XBIS-PAT-004',
          warranty_status: 'in_warranty',
          location: 'Patna Police HQ Main Depot',
        });
      expect([200, 201]).toContain(res.status);
      ticketId = res.body.id;
      expect(ticketId).toBeDefined();
    });

    it('assigns service engineer and moves status to in_progress', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });

    it('submits mandatory service report with parts replaced and customer signoff (§33)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Drive motor DC voltage regulator unstable causing intermittent belt stall.',
          action_taken: 'Inspected drive assembly, replaced faulty DC driver board, aligned conveyor belt tension.',
          parts_replaced: 'DC Drive Motor Board 24V (Part #DRV-2401)',
          customer_confirmation: true,
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.action_taken).toBeDefined();

      const ticketRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${serviceToken}`);
      expect(ticketRes.status).toBe(200);
      expect(['resolved', 'report_submitted']).toContain(ticketRes.body.status);
    });
  });

  // =========================================================================
  // MODULE 7: Expense 2-Stage Approval & Tally Excel/CSV Export (§35 – §37)
  // =========================================================================
  describe('7. Field Expense 2-Stage Approval & Tally Export (§35 – §37)', () => {
    it('submits a travel expense claim by sales executive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/expenses')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          category: 'travel',
          amount: 8500,
          purpose: 'Rajdhani Express train travel to Patna for Bihar Police visit',
          expense_date: new Date().toISOString().split('T')[0],
          organisation_id: orgId,
          visit_id: visitId,
        });
      expect([200, 201]).toContain(res.status);
      expenseId = res.body.id;
      expect(expenseId).toBeDefined();
      expect(res.body.status).toBe('submitted');
    });

    it('strictly blocks self-approval when submitter attempts Stage-1 signoff (403/400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/expenses/${expenseId}/manager-approve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          decision: 'manager_approved',
          manager_remarks: 'Self approval attempt.',
        });
      expect([400, 403]).toContain(res.status);
    });

    it('allows Regional Manager to grant Stage-1 approval (§36)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/expenses/${expenseId}/manager-approve`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({
          decision: 'manager_approved',
          manager_remarks: 'Verified against Patna itinerary.',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('manager_approved');
    });

    it('allows Corporate Accounts to process Stage-2 reimbursement (§36)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/expenses/${expenseId}/accounts-process`)
        .set('Authorization', `Bearer ${accountsToken}`)
        .send({
          decision: 'accounts_processed',
          remarks: 'Voucher settled via NEFT.',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accounts_processed');
    });

    it('retrieves financial summary reporting for accounts & management (§37)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/expenses/summary')
        .set('Authorization', `Bearer ${accountsToken}`);
      expect(res.status).toBe(200);
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.total_amount).toBeGreaterThanOrEqual(8500);
      expect(res.body.category_breakdown).toBeDefined();
    });

    it('exports expenses spreadsheet in CSV format ready for Tally ERP import (§37)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/expenses/export/csv')
        .set('Authorization', `Bearer ${accountsToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Expense ID');
      expect(res.text).toContain('Amount (INR)');
      expect(res.text).toContain('accounts_processed');
      expect(res.text).toContain('8500.00');
    });
  });

  // =========================================================================
  // MODULE 8: Task Blocker Workflow & Performance Evidence (§38 – §43)
  // =========================================================================
  describe('8. Task Blocker Workflow & Performance Evidence (§38 – §43)', () => {
    it('creates an operational task for sales executive', async () => {
      const deadline = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .post('/api/tasks')
        .set('Authorization', `Bearer ${rmToken}`)
        .send({
          title: 'Submit compliance matrix for Bihar Police tender',
          assigned_to: salesUserId,
          deadline: deadline,
          priority: 'high',
        });
      expect([200, 201]).toContain(res.status);
      taskId = res.body.id;
      expect(taskId).toBeDefined();
    });

    it('raises an external dependency blocker (Customer / Committee Delay) (§41)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tasks/${taskId}/blockers`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          blocker_type: 'customer',
          description: 'Awaiting revised Annexure B technical specifications from Bihar Police Purchase Committee.',
        });
      expect([200, 201]).toContain(res.status);
    });

    it('retrieves employee performance evidence dossier (Strictly NO Auto Salary Deduction) (§4, §43)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tasks/salary-evidence')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(res.status).toBe(200);
      expect(res.body.disclaimer).toContain('automated salary or payroll deductions are strictly prohibited');
      expect(res.body.dossiers).toBeDefined();
    });
  });
});
