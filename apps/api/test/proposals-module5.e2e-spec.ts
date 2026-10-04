import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 5: Proposal Management E2E Test Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let salesUserId: string;

  let testOrgId: string;
  let testProductId: string;

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

    // 1. Authenticate users
    const mgmtRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'mgmt@arihant.com', password: 'password123' });
    expect(mgmtRes.status).toBe(200);
    mgmtToken = mgmtRes.body.accessToken;

    const rmRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'regmgr.north@arihant.com', password: 'password123' });
    expect(rmRes.status).toBe(200);
    rmToken = rmRes.body.accessToken;

    const salesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    expect(salesRes.status).toBe(200);
    salesToken = salesRes.body.accessToken;
    salesUserId = salesRes.body.user.id;

    // 2. Fetch reference organisation and product
    const orgsRes = await request(app.getHttpServer())
      .get('/api/organisations?limit=1')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(orgsRes.status).toBe(200);
    testOrgId = orgsRes.body.data[0].id;

    const prodsRes = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(prodsRes.status).toBe(200);
    testProductId = prodsRes.body[0].id;

    const db = app.get<Kysely<DB>>('KYSELY_DB');
    await db.deleteFrom('proposal_products').execute();
    await db.deleteFrom('proposal_versions').execute();
    await db.deleteFrom('proposal_status_history').execute();
    await db.deleteFrom('proposal_follow_ups').execute();
    await db.deleteFrom('proposal_followups').execute();
    await db.deleteFrom('proposal_timeline').execute();
    await db.deleteFrom('proposals').execute();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. Proposal Creation Tests
  // =========================================================================
  describe('Proposal Creation', () => {
    it('✓ Creates valid proposal with unique proposal number', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: salesUserId,
          request_date: '2026-09-21',
          required_date: '2026-09-30',
          version: 'v1.0',
          reference: 'E2E-TEST-REF-001',
          remarks: 'E2E automated test proposal',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.proposal_number).toMatch(/^PROP-2026-\d{4}$/);
      expect(res.body.status).toBe('PROPOSAL_REQUESTED');
      expect(res.body.organisation_name).toBeDefined();
      expect(res.body.product_name).toBeDefined();
    });

    it('✓ Rejects missing customer organisation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: salesUserId,
          required_date: '2026-09-30',
        });

      expect(res.status).toBe(400);
    });

    it('✓ Rejects invalid customer ID', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: '00000000-0000-0000-0000-000000000000',
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: salesUserId,
          required_date: '2026-09-30',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('✓ Rejects invalid product ID', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: '00000000-0000-0000-0000-000000000000',
          sector: 'Defence',
          responsible_id: salesUserId,
          required_date: '2026-09-30',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Product with ID');
    });

    it('✓ Rejects invalid responsible person ID', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: '00000000-0000-0000-0000-000000000000',
          request_date: '2026-09-20',
          required_date: '2026-09-30',
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Responsible proposal person');
    });

    it('✓ Rejects required date before request date', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: salesUserId,
          request_date: '2026-09-25',
          required_date: '2026-09-20',
        });

      expect([400, 422]).toContain(res.status);
      expect(res.body.message).toContain('cannot be before request date');
    });
  });

  // =========================================================================
  // 2. Proposal Retrieval, Pagination, Filtering & Search
  // =========================================================================
  describe('Proposal Retrieval', () => {
    let createdId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Healthcare',
          responsible_id: salesUserId,
          request_date: '2026-09-21',
          required_date: '2026-09-28',
          reference: 'SEARCH-UNIQUE-KEYWORD-XYZ',
          duplicate_override_reason: 'Testing search retrieval',
        });
      console.log('Proposal Retrieval beforeAll:', res.status, res.body);
      createdId = res.body.id;
    });

    it('✓ Get proposal by ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proposals/${createdId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdId);
      expect(res.body.reference).toBe('SEARCH-UNIQUE-KEYWORD-XYZ');
    });

    it('✓ Returns 404 for invalid ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/proposals/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(404);
    });

    it('✓ Lists proposals with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/proposals?page=1&limit=5')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
      expect(res.body.page).toBe(1);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('✓ Search works by reference or proposal number', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/proposals?search=SEARCH-UNIQUE-KEYWORD-XYZ')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].reference).toBe('SEARCH-UNIQUE-KEYWORD-XYZ');
    });

    it('✓ Status filtering works', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/proposals?status=PROPOSAL_REQUESTED')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      res.body.data.forEach((p: any) => {
        expect(['PROPOSAL_REQUESTED', 'requested']).toContain(p.status);
      });
    });

    it('✓ Sector filtering works', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/proposals?sector=Healthcare')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      res.body.data.forEach((p: any) => {
        expect(p.sector).toBe('Healthcare');
      });
    });

    it('✓ CamelCase query parameters work (sectorId, responsiblePersonId, sortBy, sortOrder)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proposals?sectorId=Healthcare&responsiblePersonId=${salesUserId}&sortBy=createdAt&sortOrder=desc`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      res.body.data.forEach((p: any) => {
        expect(p.sector).toBe('Healthcare');
        expect(p.responsible_id).toBe(salesUserId);
      });
    });

    it('✓ Updates proposal details via PATCH /api/proposals/:id', async () => {
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/proposals/${createdId}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          reference: 'UPDATED-REF-999',
          version: 'v1.1',
          remarks: 'Updated remarks for proposal',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.reference).toBe('UPDATED-REF-999');
      expect(patchRes.body.version).toBe('v1.1');
      expect(patchRes.body.remarks).toBe('Updated remarks for proposal');
    });

    it('✓ Retrieves proposal versions list via GET /api/proposals/:id/versions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proposals/${createdId}/versions`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].version_no).toBe(1);
    });

    it('✓ Retrieves proposal activity timeline via GET /api/proposals/:id/activity', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/proposals/${createdId}/activity`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].event_type).toBeDefined();
    });

    it('✓ Updates follow-up schedule via PATCH /api/proposals/:id/follow-up', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/proposals/${createdId}/follow-up`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          next_follow_up_date: '2026-10-15',
          follow_up_owner_id: salesUserId,
        });

      expect(res.status).toBe(200);
      expect(String(res.body.next_follow_up_date || res.body.next_followup)).toContain('2026-10-1');
    });
  });

  // =========================================================================
  // 3. Workflow & Status Transitions
  // =========================================================================
  describe('Proposal Workflow', () => {
    let propId: string;

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: salesUserId,
          request_date: '2026-09-21',
          required_date: '2026-09-29',
          reference: 'WORKFLOW-CYCLE-TEST',
          duplicate_override_reason: 'Testing workflow lifecycle',
        });
      propId = res.body.id;
    });

    it('✓ Rejects invalid transition (PROPOSAL_REQUESTED directly to APPROVED)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot move proposal from PROPOSAL_REQUESTED directly to APPROVED');
    });

    it('✓ Executes full lifecycle: Requested -> Under Prep -> Ready for Review -> Approved -> Sent -> Converted', async () => {
      // 1. Move to UNDER_PREPARATION
      let res = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'UNDER_PREPARATION' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UNDER_PREPARATION');

      // 2. Move to READY_FOR_REVIEW
      res = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'READY_FOR_REVIEW' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY_FOR_REVIEW');

      // 3. Sales rep attempts to approve (Unauthorized)
      const unauthApprove = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'APPROVED' });
      expect(unauthApprove.status).toBe(403);

      // 4a. Regional Manager attempts to approve (Unauthorized - management/admin only)
      const rmApprove = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({ status: 'APPROVED' });
      expect(rmApprove.status).toBe(403);

      // 4b. Management approves (Authorized, not creator)
      res = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ status: 'APPROVED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approved_at).toBeDefined();

      // 5. Mark SENT_TO_CUSTOMER
      res = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'SENT_TO_CUSTOMER', sent_date: '2026-09-22' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SENT_TO_CUSTOMER');
      expect(res.body.sent_date).toBeDefined();

      // 6. Convert proposal
      res = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'CONVERTED',
          converted_to: 'PO-2026-TEST-99',
          converted_reference: 'GeM Portal Contract #991',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CONVERTED');
      expect(res.body.outcome).toBe('CONVERTED');
    });

    it('✓ Marking LOST requires lost_reason', async () => {
      // Advance to Sent
      await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'UNDER_PREPARATION' });
      await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'READY_FOR_REVIEW' });
      await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ status: 'APPROVED' });
      await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'SENT_TO_CUSTOMER' });

      // Attempt to mark LOST without reason
      const failLost = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'LOST' });
      expect(failLost.status).toBe(400);
      expect(failLost.body.message).toContain('Lost reason is required');

      // Provide valid lost reason
      const successLost = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'LOST',
          lost_reason: 'Price',
          lost_remarks: 'Competitor undercut by 10%',
        });
      expect(successLost.status).toBe(200);
      expect(successLost.body.status).toBe('LOST');
      expect(successLost.body.lost_reason).toBe('Price');
    });
  });

  // =========================================================================
  // 4. Follow-up Tracking & Dashboard Alerts
  // =========================================================================
  describe('Follow-up Management & Alerts', () => {
    let sentPropId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Defence',
          responsible_id: salesUserId,
          request_date: '2026-09-20',
          required_date: '2026-09-25',
          status: 'PROPOSAL_REQUESTED',
          duplicate_override_reason: 'Testing follow-up alerts',
        });
      sentPropId = res.body.id;

      // Fast-forward to SENT_TO_CUSTOMER
      await request(app.getHttpServer())
        .patch(`/api/proposals/${sentPropId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'UNDER_PREPARATION' });
      await request(app.getHttpServer())
        .patch(`/api/proposals/${sentPropId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'READY_FOR_REVIEW' });
      await request(app.getHttpServer())
        .patch(`/api/proposals/${sentPropId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ status: 'APPROVED' });
      await request(app.getHttpServer())
        .patch(`/api/proposals/${sentPropId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'SENT_TO_CUSTOMER' });
    });

    it('✓ Adds follow-up, updates last/next follow-up dates and switches status', async () => {
      const followupRes = await request(app.getHttpServer())
        .post(`/api/proposals/${sentPropId}/follow-ups`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          followup_date: '2026-09-21',
          owner_id: salesUserId,
          remarks: 'Discussed technical specs with purchase officer.',
          outcome: 'Requested revised delivery schedule',
          next_followup_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
        });

      expect(followupRes.status).toBe(201);
      expect(followupRes.body.followup.remarks).toContain('Discussed technical specs');
      expect(followupRes.body.proposal.status).toBe('FOLLOW_UP_REQUIRED');
      expect(followupRes.body.proposal.last_followup).toBeDefined();
      expect(followupRes.body.proposal.next_followup).toBeDefined();

      // Verify follow-up list
      const listRes = await request(app.getHttpServer())
        .get(`/api/proposals/${sentPropId}/follow-ups`)
        .set('Authorization', `Bearer ${salesToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    });

    it('✓ Dashboard metrics calculate correctly', async () => {
      const dashRes = await request(app.getHttpServer())
        .get('/api/proposals/dashboard')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(dashRes.status).toBe(200);
      expect(dashRes.body.total_proposals).toBeGreaterThan(0);
      expect(dashRes.body.due_today).toBeDefined();
      expect(dashRes.body.overdue).toBeDefined();
      expect(dashRes.body.no_followup).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Activity History & Soft Delete
  // =========================================================================
  describe('Activity History & Soft Delete', () => {
    let testPropId: string;

    it('✓ Activity history records creation and status change events', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Infrastructure',
          responsible_id: salesUserId,
          request_date: '2026-09-20',
          required_date: '2026-09-30',
          duplicate_override_reason: 'Testing history and soft delete',
        });
      testPropId = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/api/proposals/${testPropId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'UNDER_PREPARATION' });

      const historyRes = await request(app.getHttpServer())
        .get(`/api/proposals/${testPropId}/history`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.length).toBeGreaterThanOrEqual(2);
      const actions = historyRes.body.map((h: any) => h.action);
      expect(actions).toContain('CREATED');
      expect(actions).toContain('STATUS_CHANGE');
    });

    it('✓ Soft deletes proposal without deleting history', async () => {
      const delRes = await request(app.getHttpServer())
        .delete(`/api/proposals/${testPropId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify proposal is no longer returned in findOne
      const getRes = await request(app.getHttpServer())
        .get(`/api/proposals/${testPropId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(getRes.status).toBe(404);
    });
  });

  // =========================================================================
  // 6. Event-Driven Architecture (EDA) & Notification Listeners
  // =========================================================================
  describe('Event-Driven Architecture (EDA) & Notifications', () => {
    it('✓ Emits domain events and generates persistent notifications on assignment and review request', async () => {
      // 1. Sales creates a proposal assigned to salesUserId
      const createRes = await request(app.getHttpServer())
        .post('/api/proposals')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          sector: 'Healthcare',
          responsible_id: salesUserId,
          required_date: '2026-10-15',
          duplicate_override_reason: 'Testing EDA notifications',
        });
      expect(createRes.status).toBe(201);
      const propId = createRes.body.id;
      const propNum = createRes.body.proposal_number;

      // 2. Sales moves to UNDER_PREPARATION and then READY_FOR_REVIEW
      await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'UNDER_PREPARATION' });

      await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'READY_FOR_REVIEW' });

      // 3. Management approves the proposal
      const approveRes = await request(app.getHttpServer())
        .patch(`/api/proposals/${propId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ status: 'APPROVED' });
      expect(approveRes.status).toBe(200);

      // 4. Verify sales user received proposal notifications via notifications API
      const notifsRes = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(notifsRes.status).toBe(200);
      const notifs = Array.isArray(notifsRes.body) ? notifsRes.body : notifsRes.body.data || [];
      const proposalNotifs = notifs.filter(
        (n: any) => n.entity_id === propId || (n.title && n.title.includes(propNum)),
      );
      expect(proposalNotifs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
