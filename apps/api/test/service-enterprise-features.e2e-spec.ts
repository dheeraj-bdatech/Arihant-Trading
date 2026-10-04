import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 6: Enterprise Service & After-Sales Advanced Workflows (Visits, Parts, Reports Approval, Comments, Versioning)', () => {
  let app: INestApplication;

  let mgmtToken: string;
  let serviceToken: string;
  let adminToken: string;
  let serviceUserId: string;

  let testOrgId: string;
  let testProductId: string;
  let ticketId: string;
  let visitId: string;
  let reportId: string;
  let partRequestId: string;

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

    // Authenticate users
    const mgmtRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'mgmt@arihant.com', password: 'password123' });
    mgmtToken = mgmtRes.body.accessToken;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'service@arihant.com', password: 'password123' });
    serviceToken = serviceRes.body.accessToken;
    serviceUserId = serviceRes.body?.user?.id || '66666666-6666-6666-6666-666666666661';

    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@arihant.com', password: 'password123' });
    adminToken = adminRes.body.accessToken;

    const orgs = await request(app.getHttpServer())
      .get('/api/organisations?limit=1')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testOrgId = orgs.body.data[0].id;

    const prods = await request(app.getHttpServer())
      .get('/api/masters/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testProductId = prods.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Enterprise Ticket Initialization & Audit History', () => {
    it('creates an enterprise ticket with warranty snapshot and SLA calculation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/service/tickets')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          equipment_serial: 'SN-ENT-2026-X100',
          complaint: 'Cooling radiator pump thermal trip occurring during intensive scans',
          problem_category: 'Electrical',
          complaint_source: 'WhatsApp',
          priority: 'high',
          warranty_status: 'in_warranty',
          assigned_to: serviceUserId,
          planned_visit_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.problem_category).toBe('Electrical');
      expect(res.body.status).toBe('visit_scheduled');
      expect(res.body.sla_response_due_at).toBeDefined();
      expect(res.body.sla_resolution_due_at).toBeDefined();

      ticketId = res.body.id;
    });

    it('retrieves ticket details including status history timeline', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.status_history)).toBe(true);
      expect(res.body.status_history.length).toBeGreaterThanOrEqual(1);
      expect(res.body.status_history[0].to_status).toBe('visit_scheduled');
    });
  });

  describe('2. Service Visits Lifecycle & Geolocation Check-in', () => {
    it('creates a service visit for the ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/visits`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          visit_number: 1,
          scheduled_start: new Date(Date.now() + 3600000).toISOString(),
          scheduled_end: new Date(Date.now() + 7200000).toISOString(),
          notes: 'Engineer dispatched with multimeter and cooling pump spares',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.ticket_id).toBe(ticketId);
      expect(res.body.visit_number).toBe(1);
      visitId = res.body.id;
    });

    it('records engineer GPS check-in and auto-transitions ticket to in_progress', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/visits/${visitId}/check-in`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          check_in_lat: 28.5562,
          check_in_lng: 77.1000,
        });

      expect(res.status).toBe(200);
      expect(res.body.actual_check_in).toBeDefined();
      expect(Number(res.body.check_in_lat)).toBeCloseTo(28.5562);

      // Verify ticket transitioned to in_progress
      const ticketRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticketRes.body.status).toBe('in_progress');
    });

    it('records engineer visit check-out with Partially Completed outcome', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/visits/${visitId}/check-out`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          visit_outcome: 'Partially Completed',
          notes: 'Radiator flushed; primary pump rotor damaged, replacement required',
        });

      expect(res.status).toBe(200);
      expect(res.body.actual_check_out).toBeDefined();
      expect(res.body.visit_outcome).toBe('Partially Completed');
    });
  });

  describe('3. Part Requests Integration (Inventory Linkage)', () => {
    it('engineer raises a part request against the ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/part-requests`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          part_name: 'Cooling Pump Impeller Assembly (P/N: CP-8821)',
          quantity: 1,
          expected_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
          store_remarks: 'High priority spare required from central spares depot',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('Requested');
      expect(res.body.quantity).toBe(1);
      partRequestId = res.body.id;
    });

    it('updates part request status to Reserved by store', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/part-requests/${partRequestId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'Reserved',
          store_remarks: 'Part allocated from shelf B-14',
          serial_issued: 'SN-PART-9901',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Reserved');
      expect(res.body.serial_issued).toBe('SN-PART-9901');
    });

    it('transitions ticket to awaiting_part when part request is Unavailable - Ordered', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/part-requests/${partRequestId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'Unavailable – Ordered',
          store_remarks: 'Out of stock at depot; ordered from OEM Munich factory',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Unavailable – Ordered');

      // Verify ticket auto-moved to awaiting_part
      const ticketRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticketRes.body.status).toBe('awaiting_part');
    });
  });

  describe('4. Ticket Comments & Mentions', () => {
    it('allows service team and management to post ticket internal comments', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          body: 'Spares depot manager confirmed expedited shipment ETA tomorrow 11:00 AM',
          is_internal: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.body).toContain('Spares depot manager confirmed');
      expect(res.body.is_internal).toBe(true);
    });

    it('retrieves ticket comments list with author details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/tickets/${ticketId}/comments`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].author_name).toBeDefined();
    });
  });

  describe('5. Service Report Approval & Return Workflow', () => {
    it('submits service report with customer signature details', async () => {
      // Resume ticket to in_progress first
      await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'in_progress',
          remarks: 'New pump installed and pressure tested at 4.5 bar',
        });

      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/report`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          visit_id: visitId,
          problem_identified: 'Impeller rotor blades chipped due to cavitation',
          root_cause: 'Operating with low fluid reservoir level over 6 months',
          action_taken: 'Replaced impeller assembly and replenished synthetic coolant',
          parts_replaced: 'CP-8821 Impeller Assembly',
          customer_confirmation_type: 'Signature',
          customer_name_signed: 'Col. S. K. Roy (Chief Security Officer)',
          customer_feedback_rating: 5,
          customer_remarks: 'Fast turnaround and high professionalism',
          further_work_required: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.report_status).toBe('Submitted');
      reportId = res.body.id;
    });

    it('management returns report for correction when documentation is missing', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/reports/${reportId}/review`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          approved: false,
          return_reason: 'Please attach photo of hydraulic pressure gauge reading before sign-off',
        });

      expect(res.status).toBe(201);
      expect(res.body.report_status).toBe('Returned for Correction');
      expect(res.body.return_reason).toContain('attach photo');

      // Verify ticket moved back to in_progress per Section 2
      const ticketRes = await request(app.getHttpServer())
        .get(`/api/service/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(ticketRes.body.status).toBe('in_progress');
    });

    it('management approves corrected service report', async () => {
      // Re-submit
      await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'report_submitted',
          remarks: 'Pressure gauge photos uploaded to document archive',
        });

      const res = await request(app.getHttpServer())
        .post(`/api/service/tickets/${ticketId}/reports/${reportId}/review`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          approved: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.report_status).toBe('Approved');
      expect(res.body.approved_at).toBeDefined();
    });
  });

  describe('6. Optimistic Locking (Version Conflict Handling)', () => {
    it('rejects update with 409 Conflict if client sends outdated ticket version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'resolved',
          version: 1, // ticket version is now 4+
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('version mismatch');
    });
  });
});
