import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { advanceTicket } from './helpers/service-flow';

describe('Module 6: Service & After-Sales Management E2E Test Suite (Sections 31-34)', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let serviceToken: string;
  let salesToken: string;
  let adminToken: string;
  let regmgrToken: string;
  let serviceUserId: string;

  let testOrgId: string;
  let testContactId: string;
  let testProductId: string;

  let mainTicketId: string;
  let revisitTicketId: string;
  let customTicketNo: string;

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

    // 2. Fetch master customer, contact, and product
    const orgs = await request(app.getHttpServer())
      .get('/api/organisations?limit=1')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testOrgId = orgs.body.data[0].id;

    const contacts = await request(app.getHttpServer())
      .get(`/api/contacts?organisation_id=${testOrgId}&limit=1`)
      .set('Authorization', `Bearer ${mgmtToken}`);
    if (contacts.body.data && contacts.body.data.length > 0) {
      testContactId = contacts.body.data[0].id;
    }

    const prods = await request(app.getHttpServer())
      .get('/api/masters/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testProductId = prods.body[0].id;

    customTicketNo = `TCK-2026-${Math.floor(100000 + Math.random() * 900000)}`;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Section 31: Structured Ticket System
  // =========================================================================
  describe('Section 31: Structured Ticket System', () => {
    it('creates a service ticket with complete blueprint attributes', async () => {
      const payload = {
        ticket_no: customTicketNo,
        organisation_id: testOrgId,
        contact_id: testContactId || undefined,
        product_id: testProductId,
        equipment_serial: 'SN-XRAY-DELHI-4001',
        location: 'Terminal 3 Baggage Screening Bay A',
        complaint: 'Conveyor belt intermittently stopping during high load scanning',
        date_received: new Date().toISOString().split('T')[0],
        received_date: new Date().toISOString().split('T')[0],
        priority: 'high',
        warranty_status: 'in_warranty',
        assigned_to: serviceUserId,
        planned_visit_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      };

      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.ticket_no).toBe(customTicketNo);
      expect(res.body.equipment_serial).toBe('SN-XRAY-DELHI-4001');
      expect(res.body.location).toBe('Terminal 3 Baggage Screening Bay A');
      expect(res.body.priority).toBe('high');
      expect(res.body.warranty_status).toBe('in_warranty');
      expect(res.body.assigned_to).toBe(serviceUserId);
      expect(res.body.status).toBe('visit_scheduled');

      mainTicketId = res.body.id;
    });

    it('auto-generates standard ticket number format (TCK-YYYY-XXXXXX) when omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          equipment_serial: 'SN-XRAY-DELHI-4001', // intentionally same serial to test repeat complaints
          complaint: 'Sensor calibration drifting out of tolerance',
          priority: 'medium',
          warranty_status: 'amc',
        });

      expect(res.status).toBe(201);
      expect(res.body.ticket_no).toMatch(/^TCK-\d{4}-\d{6}$/);
      expect(res.body.status).toBe('received');
      revisitTicketId = res.body.id;
    });

    it('fetches single ticket with associated organisation, contact, product, assignee, and reports history', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/tickets/${mainTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mainTicketId);
      expect(res.body.organisation_name).toBeDefined();
      expect(res.body.product_name).toBeDefined();
      expect(res.body.assignee_name).toBeDefined();
      expect(Array.isArray(res.body.reports)).toBe(true);
      expect(res.body.reports.length).toBe(0);
    });
  });

  // =========================================================================
  // Section 32: Service Workflow State Machine
  // =========================================================================
  describe('Section 32: Service Workflow State Machine', () => {
    it('progresses ticket through workflow: received -> assigned -> visit_scheduled -> in_progress', async () => {
      // 1. Assign ticket
      const assignRes = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${revisitTicketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'assigned',
          assigned_to: serviceUserId,
        });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.status).toBe('assigned');
      expect(assignRes.body.assigned_to).toBe(serviceUserId);

      // 2. Schedule visit date
      const scheduleRes = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${revisitTicketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'visit_scheduled',
          planned_visit_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
        });

      expect(scheduleRes.status).toBe(200);
      expect(scheduleRes.body.status).toBe('visit_scheduled');

      // 3. Mark work in progress
      const wipRes = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${revisitTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
        });

      expect(wipRes.status).toBe(200);
      expect(wipRes.body.status).toBe('in_progress');
    });

    it('supports exceptional states: awaiting_part, awaiting_customer, escalated', async () => {
      await advanceTicket(app, mainTicketId, mgmtToken, serviceUserId, 'in_progress');
      // Transition to awaiting_part
      const partsRes = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${mainTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'awaiting_part',
          remarks: 'Optocoupler module needs replacement from central spares stock',
        });

      expect(partsRes.status).toBe(200);
      expect(partsRes.body.status).toBe('awaiting_part');

      // Resume back to in_progress
      const resumeRes = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${mainTicketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
        });

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.status).toBe('in_progress');
    });
  });

  // =========================================================================
  // Section 33: Service Report & Equipment History
  // =========================================================================
  describe('Section 33: Service Report & Equipment History', () => {
    it('submits service report and transitions ticket status to report_submitted when complete', async () => {
      const reportPayload = {
        problem_identified: 'Optocoupler isolation burnt due to line voltage spike',
        action_taken: 'Replaced optocoupler PCB and re-calibrated current threshold sensors',
        parts_replaced: 'Optocoupler PCB REV-2.1 (S/N: OC-9021)',
        warranty_status: 'in_warranty',
        customer_confirmation: true,
        customer_name_signed: 'ACP Rajiv Kumar, Station Security Head',
        further_work_required: false,
        report_url: 'https://docs.arihant.com/service/SR-2026-9001.pdf',
      };

      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${mainTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send(reportPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.ticket_id).toBe(mainTicketId);
      expect(res.body.problem_identified).toContain('Optocoupler isolation burnt');
      expect(res.body.parts_replaced).toContain('Optocoupler PCB');
      expect(res.body.customer_confirmation).toBe(true);

      // Verify ticket state updated to report_submitted
      const ticketRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${mainTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticketRes.body.status).toBe('report_submitted');
      expect(ticketRes.body.reports.length).toBe(1);
      expect(ticketRes.body.reports[0].problem_identified).toContain('Optocoupler isolation burnt');
    });

    it('submits service report with further_work_required=true and transitions ticket to revisit_required', async () => {
      const nextVisit = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${revisitTicketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          problem_identified: 'Primary optic sensor cracked; temporary bypass installed',
          action_taken: 'Temporary optical bypass configured for 48 hours operation',
          parts_replaced: 'None (awaiting delivery of optic assembly)',
          customer_confirmation: true,
          customer_name_signed: 'ACP Rajiv Kumar, Station Security Head',
          further_work_required: true,
          further_work_description: 'Install the replacement optic assembly',
          next_visit_date: nextVisit,
        });

      expect(res.status).toBe(201);
      expect(res.body.further_work_required).toBe(true);
      expect(res.body.next_visit_date).toBeDefined();
      expect(typeof res.body.next_visit_date).toBe('string');

      // Verify ticket state is revisit_required
      const ticketRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${revisitTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticketRes.body.status).toBe('revisit_required');
    });

    it('closes service ticket with management / admin sign-off', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${mainTicketId}/close`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(mainTicketId);
      expect(res.body.status).toBe('closed');

      // Verify closed status persisted
      const checkRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${mainTicketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(checkRes.body.status).toBe('closed');
    });
  });

  // =========================================================================
  // Section 34: Service Management Dashboard & Key Metrics
  // =========================================================================
  describe('Section 34: Service Management Dashboard & Key Metrics', () => {
    it('retrieves all Section 34 metrics including repeat complaints, avg closure days, and engineer workload', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/stats')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      const stats = res.body;

      // 1. New tickets
      expect(typeof stats.newTickets).toBe('number');
      // 2. Pending tickets
      expect(typeof stats.pendingTickets).toBe('number');
      // 3. Assigned tickets
      expect(typeof stats.assignedTickets).toBe('number');
      // 4. Overdue tickets
      expect(typeof stats.overdueTickets).toBe('number');
      // 5. Tickets awaiting parts
      expect(typeof stats.awaitingParts).toBe('number');
      // 6. Completed tickets
      expect(typeof stats.completedTickets).toBe('number');
      expect(stats.completedTickets).toBeGreaterThanOrEqual(1); // mainTicketId is closed
      // 7. Repeat complaints
      expect(typeof stats.repeatComplaints).toBe('number');
      expect(stats.repeatComplaints).toBeGreaterThanOrEqual(1); // we created 2 tickets for same serial/product!
      // 8. Average closure time
      expect(typeof stats.avgClosureDays).toBe('number');
      // 9. Employee workload breakdown
      expect(Array.isArray(stats.employeeWorkload)).toBe(true);
      const engineer = stats.employeeWorkload.find((e: any) => e.id === serviceUserId);
      if (engineer) {
        expect(engineer.name).toBeDefined();
        expect(typeof engineer.activeTickets).toBe('number');
        expect(typeof engineer.overdueTickets).toBe('number');
        expect(typeof engineer.completedTickets).toBe('number');
      }
    });

    it('filters ticket catalog by status, priority, and search terms', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/tickets?status=closed&search=${customTicketNo}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(mainTicketId);
      expect(res.body.data[0].status).toBe('closed');
    });
  });

  // =========================================================================
  // RBAC & Permission Verification
  // =========================================================================
  describe('RBAC & Permission Verification', () => {
    it('prevents sales role from submitting service reports (restricted to service_team and admin)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${revisitTicketId}/report`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          problem_identified: 'Unauthorized attempt',
          action_taken: 'Attempting to submit report',
        });

      expect(res.status).toBe(403);
    });

    it('allows service engineer to view assigned tickets', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/tickets')
        .set('Authorization', `Bearer ${serviceToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // All tickets returned must either be assigned to this service engineer or unassigned
      for (const t of res.body.data) {
        if (t.assigned_to) {
          expect(t.assigned_to).toBe(serviceUserId);
        }
      }
    });
  });
});
