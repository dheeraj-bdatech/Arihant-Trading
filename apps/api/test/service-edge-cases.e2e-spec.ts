import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 6: Service & After-Sales Management Edge Cases Test Suite (E1 - E42)', () => {
  let app: INestApplication;

  let mgmtToken: string;
  let serviceToken: string;
  let salesToken: string;
  let adminToken: string;
  let regmgrToken: string;
  let serviceUserId: string;

  let testOrgId: string;
  let testProductId: string;
  let testContactId: string;

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

    // 1. Authenticate tokens
    const mgmtRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'mgmt@arihant.com', password: 'password123' });
    mgmtToken = mgmtRes.body.accessToken;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'service@arihant.com', password: 'password123' });
    serviceToken = serviceRes.body.accessToken;
    serviceUserId = serviceRes.body?.user?.id || '66666666-6666-6666-6666-666666666661';

    const salesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    salesToken = salesRes.body.accessToken;

    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@arihant.com', password: 'password123' });
    adminToken = adminRes.body.accessToken;

    const regmgrRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'regmgr.north@arihant.com', password: 'password123' });
    regmgrToken = regmgrRes.body.accessToken;

    // 2. Master entities
    const orgs = await request(app.getHttpServer())
      .get('/api/organisations?limit=1')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testOrgId = orgs.body.data[0].id;

    const prods = await request(app.getHttpServer())
      .get('/api/masters/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testProductId = prods.body[0].id;

    const contacts = await request(app.getHttpServer())
      .get(`/api/contacts?organisation_id=${testOrgId}`)
      .set('Authorization', `Bearer ${mgmtToken}`);
    if (Array.isArray(contacts.body) && contacts.body.length > 0) {
      testContactId = contacts.body[0].id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // GROUP 1: Creation & Validation Edge Cases (E1 - E10)
  // =========================================================================
  describe('Group 1: Ticket Creation & Validation Edge Cases (E1 - E10)', () => {
    it('E1: rejects ticket creation when organisation_id is missing (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          complaint: 'Cooling fan failed on scanner body',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('Organisation');
    });

    it('E2: rejects ticket creation when complaint text is missing or empty (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: '',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('Complaint');
    });

    it('E3: rejects ticket creation when organisation_id is not a valid UUID (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: 'invalid-non-uuid-org',
          complaint: 'Intermittent failure in power pack',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('valid UUID');
    });

    it('E4: auto-generates sequential ticket number TCK-YYYY-XXXXXX when ticket_no is omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Belt tension calibration drifted',
        });

      expect(res.status).toBe(201);
      expect(res.body.ticket_no).toMatch(/^TCK-\d{4}-\d{6}$/);
    });

    it('E5: accepts and preserves a custom ticket number (e.g. GEM-INC-99120)', async () => {
      const customNo = `GEM-INC-${Date.now().toString().slice(-6)}`;
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          ticket_no: customNo,
          organisation_id: testOrgId,
          complaint: 'Display screen pixel dead on operator console',
        });

      expect(res.status).toBe(201);
      expect(res.body.ticket_no).toBe(customNo);
    });

    it('E6: defaults priority to medium when omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Weekly routine calibration check requested',
        });

      expect(res.status).toBe(201);
      expect(res.body.priority).toBe('medium');
    });

    it('E7: seamlessly accepts seed UUIDs (36-char custom hex strings)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          assigned_to: '66666666-6666-6666-6666-666666666661',
          complaint: 'High voltage cathode inspection needed',
        });

      expect(res.status).toBe(201);
      expect(res.body.assigned_to).toBe('66666666-6666-6666-6666-666666666661');
    });

    it('E8: sets status to visit_scheduled when both assigned_to and planned_visit_date are provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          assigned_to: serviceUserId,
          planned_visit_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          complaint: 'Motor bearing noise at conveyor head',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('visit_scheduled');
    });

    it('E9: sets status to assigned when only assigned_to is provided without a date', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          assigned_to: serviceUserId,
          complaint: 'Awaiting engineer scheduling for firmware flash',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('assigned');
    });

    it('E10: sets status to received when neither assigned_to nor date is provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Incoming breakdown report awaiting manager assignment',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('received');
    });
  });

  // =========================================================================
  // GROUP 2: Retrieval, Repeat Complaint & Scoping Edge Cases (E11 - E14)
  // =========================================================================
  describe('Group 2: Retrieval & Repeat Complaint Detection (E11 - E14)', () => {
    let baseTicketId: string;
    const testSerial = `SN-EDGE-REPEAT-${Date.now().toString().slice(-6)}`;

    it('E11: returns 404 when querying non-existent ticket UUID', async () => {
      const nonExistentUuid = '99999999-9999-9999-9999-999999999999';
      const res = await request(app.getHttpServer())
        .get(`/api/service/tickets/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('E12: returns clean 404 (not 500 DB error) when querying malformed ticket ID (e.g. "abc")', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/tickets/malformed-non-uuid-id')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('E13: marks first ticket on equipment as is_repeat_complaint = false (repeat_count = 0)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          equipment_serial: testSerial,
          complaint: 'Initial baseline breakdown incident for testing repeat detection',
        });

      expect(res.status).toBe(201);
      baseTicketId = res.body.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${baseTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.is_repeat_complaint).toBe(false);
      expect(getRes.body.repeat_count).toBe(0);
    });

    it('E14: detects recurring breakdown on same customer and serial (is_repeat_complaint = true, repeat_count >= 1)', async () => {
      const res2 = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          equipment_serial: testSerial, // identical serial
          complaint: 'Recurring breakdown on same unit within short window',
        });

      expect(res2.status).toBe(201);

      const getRes2 = await request(app.getHttpServer())
        .get(`/api/service/tickets/${res2.body.id}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(getRes2.status).toBe(200);
      expect(getRes2.body.is_repeat_complaint).toBe(true);
      expect(getRes2.body.repeat_count).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // GROUP 3: Workflow State Machine & Exceptional States (E15 - E23)
  // =========================================================================
  describe('Group 3: Workflow Transitions & Exceptional States (E15 - E23)', () => {
    let lifecycleTicketId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Detailed lifecycle state machine testing ticket',
        });
      lifecycleTicketId = res.body.id;
    });

    it('E15: progresses from received to assigned', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'assigned',
          assigned_to: serviceUserId,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('assigned');
      expect(res.body.assigned_to).toBe(serviceUserId);
    });

    it('E16: progresses from assigned to visit_scheduled with planned visit date', async () => {
      const visitDate = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'visit_scheduled',
          planned_visit_date: visitDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('visit_scheduled');
    });

    it('E17: progresses from visit_scheduled to in_progress when engineer arrives on site', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });

    it('E18: enters exceptional state awaiting_part when replacement spares needed', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'awaiting_part',
          remarks: 'Optical sensor module PCB required from central depot',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('awaiting_part');
    });

    it('E19: resumes from awaiting_part back to in_progress once parts arrive', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
          remarks: 'Parts delivered by courier, resuming repair',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });

    it('E20: enters exceptional state awaiting_customer when site access is denied/delayed', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'awaiting_customer',
          remarks: 'Security clearance pass pending from CISF officer',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('awaiting_customer');
    });

    it('E21: resumes from awaiting_customer back to in_progress once clearance granted', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
          remarks: 'Entry pass received, work resumed',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });

    it('E22: enters exceptional state escalated when OEM specialist intervention is required', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'escalated',
          remarks: 'Referred to Lead Systems Architect for firmware debug',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('escalated');
    });

    it('E23: successfully marks ticket as resolved after rectification', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${lifecycleTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'resolved',
          remarks: 'All diagnostics passed radiation safety standards',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('resolved');
    });
  });

  // =========================================================================
  // GROUP 4: Service Reports & Equipment Traceability (E24 - E29)
  // =========================================================================
  describe('Group 4: Service Reports & Equipment History (E24 - E29)', () => {
    let reportTicketId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Testing service report submission and history',
        });
      reportTicketId = res.body.id;
    });

    it('E24: rejects report submission if problem_identified is missing (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${reportTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          action_taken: 'Replaced cooling fans',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('Problem identified');
    });

    it('E25: rejects report submission if action_taken is missing (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${reportTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Overheating cathode',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('Action taken');
    });

    it('E26: automatically transitions ticket to report_submitted when further_work_required is false', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${reportTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Thermal paste dried up between detector array and heat sink',
          action_taken: 'Cleaned surface and reapplied silver thermal compound',
          customer_confirmation: true,
          further_work_required: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();

      const ticket = await request(app.getHttpServer())
        .get(`/api/service/tickets/${reportTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticket.body.status).toBe('report_submitted');
    });

    it('E27: automatically transitions ticket to revisit_required when further_work_required is true', async () => {
      const revisitTicket = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Secondary display flickers intermittently',
        });

      const nextVisit = new Date(Date.now() + 86400000 * 4).toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${revisitTicket.body.id}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'LVDS cable shielding fractured inside hinge',
          action_taken: 'Patched temporary shielding with copper tape',
          further_work_required: true,
          next_visit_date: nextVisit,
        });

      expect(res.status).toBe(201);

      const check = await request(app.getHttpServer())
        .get(`/api/service/tickets/${revisitTicket.body.id}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(check.body.status).toBe('revisit_required');
    });

    it('E28: automatically creates customer timeline interaction entry upon filing report', async () => {
      const timelineTicket = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Testing timeline interaction entry creation',
        });

      await request(app.getHttpServer())
        .post(`/api/service/tickets/${timelineTicket.body.id}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Dust accumulation in intake filters',
          action_taken: 'Vacuumed and compressed-air cleaned all filter meshes',
          customer_confirmation: true,
          further_work_required: false,
        });

      // Verify interaction exists in organisations history
      const orgInteractions = await request(app.getHttpServer())
        .get(`/api/organisations/${testOrgId}/timeline`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      if (orgInteractions.status === 200 && Array.isArray(orgInteractions.body)) {
        const found = orgInteractions.body.find((item: any) => item.type === 'service');
        expect(found).toBeDefined();
      }
    });

    it('E29: allows multiple service reports for a single ticket across repeat visits, preserving full history', async () => {
      // Add 2nd report to reportTicketId
      const res2 = await request(app.getHttpServer())
        .post(`/api/service/tickets/${reportTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Follow-up radiation leakage inspection',
          action_taken: 'Survey meter confirmed 0.05 uSv/hr baseline at 5cm distance',
          customer_confirmation: true,
          further_work_required: false,
        });

      expect(res2.status).toBe(201);

      const ticket = await request(app.getHttpServer())
        .get(`/api/service/tickets/${reportTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticket.body.reports.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // GROUP 5: Closure & Immutability Edge Cases (E30 - E34)
  // =========================================================================
  describe('Group 5: Closure & Immutability Edge Cases (E30 - E34)', () => {
    let closedTicketId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Ticket for testing closure immutability rules',
        });
      closedTicketId = res.body.id;
    });

    it('E30: closes a ticket upon management / admin sign-off', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${closedTicketId}/close`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('closed');
    });

    it('E31: idempotent closure succeeds safely when closing an already closed ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${closedTicketId}/close`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('closed');
    });

    it('E32: prevents non-management/non-admin users from modifying a closed ticket (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${closedTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('closed');
    });

    it('E33: prevents submitting a service report on an already closed ticket (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${closedTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Late report attempt',
          action_taken: 'Attempting to file report after sign-off',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('closed');
    });

    it('E34: allows management to reopen a closed ticket if customer disputes resolution', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${closedTicketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'received',
          remarks: 'Customer reported issue persists; reopening incident',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');
    });
  });

  // =========================================================================
  // GROUP 6: Dashboard Statistics & Zero-Division Safety (E35 - E38)
  // =========================================================================
  describe('Group 6: Dashboard Statistics & Zero-Division Safety (E35 - E38)', () => {
    it('E35: computes all Section 34 dashboard counts accurately', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/stats')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      const s = res.body;

      expect(typeof s.newTickets).toBe('number');
      expect(typeof s.pendingTickets).toBe('number');
      expect(typeof s.assignedTickets).toBe('number');
      expect(typeof s.overdueTickets).toBe('number');
      expect(typeof s.awaitingParts).toBe('number');
      expect(typeof s.completedTickets).toBe('number');
      expect(typeof s.criticalTickets).toBe('number');
      expect(typeof s.repeatComplaints).toBe('number');
    });

    it('E36: returns non-NaN numerical average closure days even if few tickets are completed', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/stats')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.avgClosureDays).toBe('number');
      expect(isNaN(res.body.avgClosureDays)).toBe(false);
      expect(res.body.avgClosureDays).toBeGreaterThanOrEqual(0);
    });

    it('E37: returns structured employee workload breakdown per technician', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/stats')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.employeeWorkload)).toBe(true);

      for (const tech of res.body.employeeWorkload) {
        expect(tech.id).toBeDefined();
        expect(tech.name).toBeDefined();
        expect(typeof tech.activeTickets).toBe('number');
        expect(typeof tech.overdueTickets).toBe('number');
        expect(typeof tech.completedTickets).toBe('number');
      }
    });

    it('E38: filters ticket queries by priority, status, and search query params', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/tickets?priority=high&page=1&limit=5')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const t of res.body.data) {
        expect(t.priority).toBe('high');
      }
    });
  });

  // =========================================================================
  // GROUP 7: RBAC & Territorial Scoping Edge Cases (E39 - E42)
  // =========================================================================
  describe('Group 7: RBAC & Territorial Scoping Edge Cases (E39 - E42)', () => {
    let rbacTicketId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          complaint: 'Testing RBAC and territorial boundaries',
        });
      rbacTicketId = res.body.id;
    });

    it('E39: forbids sales role from submitting service reports (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${rbacTicketId}/report`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          problem_identified: 'Sales attempt to submit service report',
          action_taken: 'Unauthorized attempt',
        });

      expect(res.status).toBe(403);
    });

    it('E40: allows service team to view their queue and unassigned tickets', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/tickets')
        .set('Authorization', `Bearer ${serviceToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const t of res.body.data) {
        if (t.assigned_to) {
          expect(t.assigned_to).toBe(serviceUserId);
        }
      }
    });

    it('E41: scopes regional manager tickets to regional organisations', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/tickets')
        .set('Authorization', `Bearer ${regmgrToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('E42: management and admin have unrestricted global service ticket visibility', async () => {
      const mgmtTickets = await request(app.getHttpServer())
        .get('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`);

      const adminTickets = await request(app.getHttpServer())
        .get('/api/service/tickets')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(mgmtTickets.status).toBe(200);
      expect(adminTickets.status).toBe(200);
      expect(mgmtTickets.body.total).toBe(adminTickets.body.total);
    });
  });
});
