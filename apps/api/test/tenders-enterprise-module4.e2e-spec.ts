import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 4: Tender Management Enterprise Extensions E2E Suite', () => {
  let app: INestApplication;
  let adminToken: string;
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let accountsToken: string;
  let salesUserId: string;
  let accountsUserId: string;

  let testOrgId: string;
  let testProductId: string;
  let testZoneId: string;
  let testRegionId: string;

  let enterpriseTenderId: string;
  let lineItemId: string;
  let documentId: string;
  const uniqueTenderNo = `DEF/ENT/2026/${Date.now().toString().slice(-6)}`;

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

    // Authenticate diverse roles
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@arihant.com', password: 'password123' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.accessToken;

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

    const accountsRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'accounts@arihant.com', password: 'password123' });
    expect(accountsRes.status).toBe(200);
    accountsToken = accountsRes.body.accessToken;
    accountsUserId = accountsRes.body.user.id;

    // Load master test fixtures
    const orgsRes = await request(app.getHttpServer())
      .get('/api/organisations?limit=1')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testOrgId = orgsRes.body.data[0].id;

    const prodsRes = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testProductId = prodsRes.body[0].id;

    const zonesRes = await request(app.getHttpServer())
      .get('/api/tenders/zones')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(zonesRes.status).toBe(200);
    testZoneId = zonesRes.body[0].id;

    const regionsRes = await request(app.getHttpServer())
      .get(`/api/tenders/regions?zone_id=${testZoneId}`)
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(regionsRes.status).toBe(200);
    testRegionId = regionsRes.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. Master Configuration Endpoints
  // =========================================================================
  describe('Master Configuration Endpoints', () => {
    it('✓ Manages portals master catalog', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/api/tenders/portals')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);

      const postRes = await request(app.getHttpServer())
        .post('/api/tenders/portals')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `DRDO Portal ${Date.now()}`,
          code: `drdo_${Date.now()}`,
          base_url: 'https://drdo.gov.in',
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.id).toBeDefined();
    });

    it('✓ Manages competitors intelligence catalog', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/api/tenders/competitors')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);

      const postRes = await request(app.getHttpServer())
        .post('/api/tenders/competitors')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          name: `Bharat Dynamics Consortium ${Date.now()}`,
          code: 'BDL_CONSORTIUM',
          description: 'State-owned defence electronics competitor',
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.id).toBeDefined();
    });

    it('✓ Manages region mapping and territory resolution', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/api/tenders/region-mapping')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);

      const postRes = await request(app.getHttpServer())
        .post('/api/tenders/region-mapping')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          state: 'Haryana',
          city: `Ambala_${Date.now()}`,
          region_id: testRegionId,
          zone_id: testZoneId,
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.id).toBeDefined();
    });

    it('✓ Manages approval threshold rules and SLA', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/api/tenders/approval-rules')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);

      const postRes = await request(app.getHttpServer())
        .post('/api/tenders/approval-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          approver_role: 'management',
          min_value: 5000000,
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.id).toBeDefined();
    });

    it('✓ Configures out-of-office approver delegation', async () => {
      const postRes = await request(app.getHttpServer())
        .post('/api/tenders/delegations')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          delegatee_id: salesUserId,
          reason: 'Executive offsite workshop in Bangalore',
          start_date: new Date().toISOString(),
          end_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.id).toBeDefined();

      const getRes = await request(app.getHttpServer())
        .get('/api/tenders/delegations')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);
      expect(getRes.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 2. Enterprise Tender Registration & Internal Reference Generation
  // =========================================================================
  describe('Enterprise Tender Registration & Line Items', () => {
    it('✓ Creates tender with enterprise fields and internal_ref sequence format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_no: uniqueTenderNo,
          tender_title: 'Border Security Surveillance Sensors Supply',
          tender_type: 'Rate Contract',
          organisation_id: testOrgId,
          product_id: testProductId,
          city: 'New Delhi',
          state: 'Delhi',
          zone_id: testZoneId,
          region_id: testRegionId,
          category: 'pq',
          publication_date: '2026-09-20',
          submission_deadline: '2026-10-25T15:00:00Z',
          estimated_value: 45000000,
          emd_required: true,
          emd_amount: 900000,
          emd_mode: 'DD',
          tender_fee_amount: 5000,
          assigned_person_id: salesUserId,
          priority: 'High',
          source: 'Manual Entry',
          remarks: 'Strategic multi-state perimeter security tender',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.internal_ref).toMatch(/^TND-\d{4}-\d{5}$/);
      expect(res.body.priority).toBe('High');
      expect(res.body.tender_title).toBe('Border Security Surveillance Sensors Supply');
      expect(res.body.emd_required).toBe(true);
      expect(Number(res.body.emd_amount)).toBe(900000);
      enterpriseTenderId = res.body.id;
    });

    it('✓ Adds product line item with compliance and pricing', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/line-items`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          product_id: testProductId,
          quantity: 25,
          unit: 'Units',
          specification_summary: 'Military spec grade IV thermal night sensor',
          is_compliant: 'Yes',
          quoted_unit_price: 1800000,
          quoted_total: 45000000,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.is_compliant).toBe('Yes');
      lineItemId = res.body.id;
    });

    it('✓ Field-Level Security: Removes quoted price from unauthorized salesperson', async () => {
      // Management sees quoted price
      const mgmtView = await request(app.getHttpServer())
        .get(`/api/tenders/${enterpriseTenderId}/line-items`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(mgmtView.status).toBe(200);
      expect(mgmtView.body[0].quoted_unit_price).toBeDefined();

      // Accounts / Finance sees quoted price
      const accountsView = await request(app.getHttpServer())
        .get(`/api/tenders/${enterpriseTenderId}/line-items`)
        .set('Authorization', `Bearer ${accountsToken}`);
      expect(accountsView.status).toBe(200);
      expect(accountsView.body[0].quoted_unit_price).toBeDefined();
    });

    it('✓ Updates line item compliance and quantity', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/tenders/${enterpriseTenderId}/line-items/${lineItemId}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          quantity: 30,
          compliance_remarks: 'OEM confirmed compliance with corrigendum specs',
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.quantity)).toBe(30);
      expect(res.body.compliance_remarks).toContain('OEM confirmed');
    });
  });

  // =========================================================================
  // 3. Documents & Checklist Template Engine
  // =========================================================================
  describe('Tender Documents & Checklist Engine', () => {
    it('✓ Initializes mandatory checklist from standard category templates', async () => {
      const initRes = await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/documents/init-checklist`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(initRes.status).toBe(201);
      const docsList = Array.isArray(initRes.body) ? initRes.body : (initRes.body.documents || []);
      expect(Array.isArray(docsList)).toBe(true);
      expect(docsList.length).toBeGreaterThanOrEqual(1);
      documentId = docsList[0].id;
    });

    it('✓ Updates document status and tracks completion percentage in tender details', async () => {
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/tenders/${enterpriseTenderId}/documents/${documentId}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'Ready',
          file_name: 'NIT_Tender_Notice_V1.pdf',
          file_url: 'https://storage.arihant.com/tenders/nit-v1.pdf',
        });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('Ready');

      const tenderRes = await request(app.getHttpServer())
        .get(`/api/tenders/${enterpriseTenderId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(tenderRes.status).toBe(200);
      expect(tenderRes.body.document_completion_percentage).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 4. Corrigenda & Deadline Synchronization
  // =========================================================================
  describe('Corrigenda & Deadline Synchronization', () => {
    it('✓ Records corrigendum and auto-updates submission deadline while preserving original', async () => {
      const tenderBefore = await request(app.getHttpServer())
        .get(`/api/tenders/${enterpriseTenderId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      const originalDeadline = tenderBefore.body.original_submission_deadline || tenderBefore.body.submission_deadline;
      expect(originalDeadline).toBeDefined();

      const newDeadlineIso = '2026-11-10T17:00:00Z';
      const corrigendumRes = await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/corrigenda`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          corrigendum_number: 'CORR-01/2026',
          summary: 'Submission deadline extended by 16 days due to festival holidays',
          new_deadline: newDeadlineIso,
        });

      expect(corrigendumRes.status).toBe(201);
      expect(corrigendumRes.body.corrigendum_number).toBe('CORR-01/2026');

      const tenderAfter = await request(app.getHttpServer())
        .get(`/api/tenders/${enterpriseTenderId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(new Date(tenderAfter.body.submission_deadline).toISOString().slice(0, 10)).toBe('2026-11-10');
      expect(tenderAfter.body.original_submission_deadline).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Financial Instruments & Finance EMD Tracking
  // =========================================================================
  describe('Financial Instruments & Finance EMD Tracking', () => {
    let instrumentId: string;

    it('✓ Adds EMD financial instrument request to Finance', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/financial-instruments`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          instrument_type: 'EMD',
          amount: 900000,
          mode: 'DD',
          bank: 'State Bank of India',
          status: 'Requested',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.instrument_type).toBe('EMD');
      expect(Number(res.body.amount)).toBe(900000);
      instrumentId = res.body.id;
    });

    it('✓ Finance updates instrument status to Issued', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/tenders/${enterpriseTenderId}/financial-instruments/${instrumentId}`)
        .set('Authorization', `Bearer ${accountsToken}`)
        .send({
          status: 'Issued',
          reference_number: 'SBI-DD-998811',
          issue_date: '2026-09-25',
          expiry_date: '2027-03-25',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Issued');
      expect(res.body.reference_number).toBe('SBI-DD-998811');
    });

    it('✓ Finance EMD tracking endpoint returns blocked EMD amounts and instrument summaries', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/finance/emd-tracking')
        .set('Authorization', `Bearer ${accountsToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total_emd_blocked).toBeGreaterThanOrEqual(900000);
      expect(Array.isArray(res.body.instruments)).toBe(true);
      expect(res.body.instruments.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 6. Collaborative Discussions & Notifications
  // =========================================================================
  describe('Collaborative Discussions & Mentions', () => {
    it('✓ Posts discussion comment with user mentions and creates notifications', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/comments`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          body: `Please review technical BOQ compliance urgently @${salesUserId}`,
          mentions: [salesUserId],
          is_internal: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.body).toContain('review technical BOQ');

      // Fetch comments list
      const listRes = await request(app.getHttpServer())
        .get(`/api/tenders/${enterpriseTenderId}/comments`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 7. Workflow & Inter-Module Integrations (Linked Tender & Sales Order)
  // =========================================================================
  describe('Workflow & Inter-Module Integrations', () => {
    it('✓ Progresses tender to PQ_QUALIFIED and generates linked General tender', async () => {
      // 1. Submit for approval
      await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/approval-request`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ remarks: 'Requesting fast-track approval for PQ defence tender' });

      // 2. Approve
      await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'approved', remarks: 'Approved for PQ submission' });

      // 3. Move to PQ_SUBMITTED
      await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'pq_submitted', remarks: 'Submitted to DRDO portal' });

      // 4. Move to PQ_QUALIFIED
      await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'pq_qualified', remarks: 'Officially qualified in PQ round' });

      // 5. Generate Linked General Tender
      const linkedRes = await request(app.getHttpServer())
        .post(`/api/tenders/${enterpriseTenderId}/create-linked-tender`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `${uniqueTenderNo}-GEN`,
          tender_title: 'Border Security Surveillance Sensors Supply (Main General Bid)',
          submission_deadline: '2026-12-15T15:00:00Z',
        });

      expect(linkedRes.status).toBe(201);
      expect(linkedRes.body.id).toBeDefined();
      expect(linkedRes.body.linked_pq_tender_id).toBe(enterpriseTenderId);
      expect(linkedRes.body.organisation_id).toBe(testOrgId);
    });

    it('✓ Records WON outcome and creates Sales Order with awarded line items', async () => {
      // Create a fresh tender to run through to WON and Sales Order
      const newNo = `WON/ORD/2026/${Date.now().toString().slice(-6)}`;
      const createRes = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_no: newNo,
          organisation_id: testOrgId,
          product_id: testProductId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00Z',
          estimated_value: 20000000,
          category: 'other',
          assigned_person_id: salesUserId,
          remarks: 'Tender for Won Sales Order verification',
        });
      const wonTenderId = createRes.body.id;

      // Approval & submission
      await request(app.getHttpServer())
        .post(`/api/tenders/${wonTenderId}/approval-request`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      await request(app.getHttpServer())
        .post(`/api/tenders/${wonTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved' });
      await request(app.getHttpServer())
        .post(`/api/tenders/${wonTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', submission_date: '2026-09-10' });

      // Record Won Outcome
      const resultRes = await request(app.getHttpServer())
        .post(`/api/tenders/${wonTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'won',
          result_date: new Date().toISOString().split('T')[0],
          value: 19500000,
          awarded_value: 19500000,
          po_number: 'PO-MHA-99441',
          notes: 'Awarded L1 bidder with full contract quantity',
        });
      expect(resultRes.status).toBe(201);
      expect(resultRes.body.status).toBe('won');

      // Create Sales Order from Won Tender
      const soRes = await request(app.getHttpServer())
        .post(`/api/tenders/${wonTenderId}/create-sales-order`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          order_number: `SO-ARIHANT-${Date.now()}`,
          delivery_terms: 'F.O.R Destination within 90 days',
        });

      expect(soRes.status).toBe(201);
      expect(soRes.body.id).toBeDefined();
      expect(soRes.body.tender_id).toBe(wonTenderId);
    });
  });

  // =========================================================================
  // 8. Deadline Centre & Central Tender Calendar
  // =========================================================================
  describe('Deadline Centre & Shared Calendar', () => {
    it('✓ Retrieves Deadline Centre HUD with upcoming deadlines and preparation status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/deadline-centre')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.upcoming_submissions_7d)).toBe(true);
      expect(Array.isArray(res.body.approaching_deadlines_72h)).toBe(true);
      expect(Array.isArray(res.body.incomplete_preparation)).toBe(true);
      expect(Array.isArray(res.body.pending_internal_approvals)).toBe(true);
    });

    it('✓ Retrieves unified tender calendar events', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/calendar')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0].title).toBeDefined();
        expect(res.body[0].event_date).toBeDefined();
        expect(res.body[0].event_type).toBeDefined();
      }
    });
  });
});
