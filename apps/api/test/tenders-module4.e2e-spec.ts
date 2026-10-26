import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely } from 'kysely';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/app-setup';

jest.setTimeout(60000);

/** Today's calendar date in IST (YYYY-MM-DD) — result dates are IST calendar days and cannot be in the future. */
const istToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
/**
 * A bid that closes later today (23:59 IST): still open for submission now, and its result can be recorded today
 * (a result can never be dated before the bid closing day — QA DEF-090).
 */
const closesTodayIST = () => `${istToday()}T23:59:00+05:30`;

describe('Module 4: Tender Management E2E Test Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let salesUserId: string;

  let testOrgId: string;
  let testProductId: string;
  let testZoneId: string;
  let testRegionId: string;

  let createdTenderId: string;
  let db: Kysely<any>;
  const uniqueTenderNo = `GEM/2026/B/${Date.now().toString().slice(-6)}`;

  /**
   * Submission gate (QA DEF-006): a bid / PQ can only be submitted once the mandatory document checklist is
   * initialised and every mandatory document is Ready.
   */
  async function readyChecklist(tenderId: string) {
    const init = await request(app.getHttpServer())
      .post(`/api/tenders/${tenderId}/documents/init-checklist`)
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(init.status).toBe(201);
    for (const doc of init.body.documents.filter((d: any) => d.is_mandatory)) {
      const patch = await request(app.getHttpServer())
        .patch(`/api/tenders/${tenderId}/documents/${doc.id}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ status: 'Ready', file_name: `${doc.document_type}.pdf` });
      expect(patch.status).toBe(200);
    }
  }

  /**
   * Bids are opened only after the bid closes: evaluation stages and results are blocked before the closing time.
   * Simulate the closing having passed (yesterday) so the bid can be evaluated and its result recorded today.
   */
  async function closeBid(tenderId: string) {
    const closedAt = new Date(Date.now() - 86400000);
    await db
      .updateTable('tenders')
      .set({ submission_deadline: closedAt, bid_closing_date: closedAt })
      .where('id', '=', tenderId)
      .execute();
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    db = moduleFixture.get<Kysely<any>>('KYSELY_DB');
    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();

    // 1. Authenticate users across roles
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

    // 2. Fetch master data references
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

    const tendersList = await request(app.getHttpServer())
      .get('/api/tenders?limit=5')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(tendersList.status).toBe(200);
    if (tendersList.body.data && tendersList.body.data.length > 0) {
      const withZone = tendersList.body.data.find((t: any) => t.zone_id && t.region_id);
      if (withZone) {
        testZoneId = withZone.zone_id;
        testRegionId = withZone.region_id;
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. Categories Master Data Lookup
  // =========================================================================
  describe('Tender Categories Lookup', () => {
    it('✓ Retrieves active tender categories lookup table', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/categories')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      const codes = res.body.map((c: any) => c.code.toLowerCase());
      expect(codes).toContain('pq');
      expect(codes).toContain('general_mha');
      expect(codes).toContain('other');
    });
  });

  // =========================================================================
  // 2. Tender Creation & Validation Tests
  // =========================================================================
  describe('Tender Registration & Validation', () => {
    it('✕ Rejects tender registration when required fields are missing (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          // Missing tender_no, organisation_id
          product_id: testProductId,
          category: 'pq',
        });

      expect(res.status).toBe(400);
    });

    it('✕ Rejects tender when submission deadline is earlier than publication date (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_no: `INV/2026/${Date.now().toString().slice(-4)}`,
          organisation_id: testOrgId,
          product_id: testProductId,
          publication_date: '2026-10-15',
          submission_deadline: '2026-10-01T10:00:00Z', // Earlier!
          category: 'pq',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/submission deadline cannot be earlier/i);
    });

    it('✓ Successfully creates a valid tender with transactional outbox event (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_no: uniqueTenderNo,
          organisation_id: testOrgId,
          product_id: testProductId,
          city: 'New Delhi',
          state: 'Delhi',
          zone_id: testZoneId,
          region_id: testRegionId,
          category: 'pq',
          publication_date: '2026-09-20',
          submission_deadline: closesTodayIST(),
          estimated_value: 12500000,
          assigned_person_id: salesUserId,
          remarks: 'High priority defence tender registration',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.tender_no).toBe(uniqueTenderNo);
      expect(res.body.status).toBe('identified');
      expect(res.body.category).toBe('pq');
      createdTenderId = res.body.id;
    });

    it('✕ Strictly prevents duplicate tender registration with same tender number (409)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_no: uniqueTenderNo, // Same number!
          organisation_id: testOrgId,
          product_id: testProductId,
          category: 'pq',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already registered/i);
    });
  });

  // =========================================================================
  // 3. Tender Register & Search/Filtering
  // =========================================================================
  describe('Tender Register & Server-Side Filtering', () => {
    it('✓ Retrieves tender by ID with full relations, activity, and outbox history', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenders/${createdTenderId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdTenderId);
      expect(res.body.tender_no).toBe(uniqueTenderNo);
      expect(res.body.organisation_name).toBeDefined();
      expect(res.body.activities).toBeDefined();
      expect(Array.isArray(res.body.activities)).toBe(true);
      expect(res.body.activities.length).toBeGreaterThanOrEqual(1);
    });

    it('✓ Searches tenders by tender number substring', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenders?search=${encodeURIComponent(uniqueTenderNo)}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(createdTenderId);
    });

    it('✓ Filters tenders by category (pq)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders?category=pq')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      const allPq = res.body.data.every((t: any) => t.category.toLowerCase() === 'pq');
      expect(allPq).toBe(true);
    });
  });

  // =========================================================================
  // 4. Internal Approval Workflow & Rejection Reason Mandate
  // =========================================================================
  describe('Internal Approval Workflow', () => {
    it('✓ Requests participation approval and moves to awaiting_approval stage', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/approval-request`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          remarks: 'Requesting management review for high-value bid participation',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('awaiting_approval');
    });

    it('✕ Denies regular sales executive from approving tender participation (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/approve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          decision: 'approved',
          remarks: 'Self endorsement attempt',
        });

      expect(res.status).toBe(403);
    });

    it('✕ Rejects management rejection when rejection reason is missing (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          decision: 'rejected',
          // Missing remarks/reason!
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reason is mandatory/i);
    });

    it('✓ Allows management to approve tender participation and transitions to under_preparation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          decision: 'approved',
          remarks: 'Commercial potential validated by Vikram Arihant',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('under_preparation');
      expect(res.body.internal_approval_by).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Workflow State Machine Transitions
  // =========================================================================
  describe('Workflow State Machine Transitions', () => {
    it('✕ Blocks invalid state skip from under_preparation directly to won (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          target_status: 'won',
          remarks: 'Attempting illegal jump',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot move tender|invalid transition/i);
    });

    it('rejects PQ submission while mandatory documents are not Ready (DEF-006)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'pq_submitted', remarks: 'No documents ready yet' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/mandatory documents are Ready|checklist has not been initialised/i);
    });

    it('✓ Transitions under_preparation → pq_submitted for PQ category tender', async () => {
      await readyChecklist(createdTenderId);

      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          target_status: 'pq_submitted',
          remarks: 'PQ qualification documents submitted on portal',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pq_submitted');
    });

    it('✓ Transitions pq_submitted → pq_qualified', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          target_status: 'pq_qualified',
          remarks: 'Arihant successfully passed pre-qualification screening',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pq_qualified');
    });

    it('✓ Transitions pq_qualified → submitted with submission date recording', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          target_status: 'submitted',
          submission_date: '2026-09-21',
          remarks: 'Final commercial and technical envelope submitted',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('submitted');
      expect(res.body.submission_date).toBeTruthy();
      expect(new Date(res.body.submission_date).getTime()).not.toBeNaN();
    });

    it('✕ Blocks submitted → technical_eval before the bid closing time (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'technical_eval', remarks: 'Too early' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/bids are opened only after the bid closes/i);
    });

    it('✓ Transitions submitted → technical_eval', async () => {
      await closeBid(createdTenderId);
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          target_status: 'technical_eval',
          remarks: 'Technical bid evaluation opened by customer',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('technical_eval');
    });
  });

  // =========================================================================
  // 6. External Portal Issue Tracking
  // =========================================================================
  describe('External Portal Issue Tracking', () => {
    let testIssueId: string;

    it('✓ Logs an external portal glitch / technical issue on GeM (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/portal-issues`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          issue: 'GeM portal server 504 gateway timeout while uploading compliance matrix',
          responsible_person_id: salesUserId,
          remarks: 'Document upload failed at 98%',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.resolution_status).toBe('OPEN');
      testIssueId = res.body.id;
    });

    it('✓ Escalates portal issue to executive management', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/tenders/${createdTenderId}/portal-issues/${testIssueId}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          resolution_status: 'ESCALATED',
          escalated_to: 'Management & GeM Helpdesk Ticket #88412',
          remarks: 'Urgent ticket raised with GeM support team',
        });

      expect(res.status).toBe(200);
      expect(res.body.resolution_status).toBe('ESCALATED');
      expect(res.body.escalated_to).toBeDefined();
    });

    it('✓ Resolves portal issue with structured resolution remarks', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/tenders/${createdTenderId}/portal-issues/${testIssueId}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          resolution_status: 'RESOLVED',
          resolution: 'Portal restored by GeM sysadmin; documents re-uploaded and verified',
        });

      expect(res.status).toBe(200);
      expect(res.body.resolution_status).toBe('RESOLVED');
      expect(res.body.resolution).toBeDefined();
      expect(res.body.resolved_at).toBeDefined();
    });

    it('✓ Retrieves all portal issues for the tender', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenders/${createdTenderId}/portal-issues`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('✓ Logs a global portal issue via POST /api/tenders/portal-issues (§25)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders/portal-issues')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_id: createdTenderId,
          issue: 'Required equipment does not appear on GeM portal category catalog',
          responsible_person_id: salesUserId,
          escalated_to: 'GeM Category Team & Ministry Nodal Officer',
          remarks: 'Raised formal representation with procurement officer',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.issue).toContain('Required equipment does not appear');
    });

    it('✓ Retrieves global portal issues list via GET /api/tenders/portal-issues (§25)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/portal-issues')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const found = res.body.find((i: any) => i.tender_id === createdTenderId);
      expect(found).toBeDefined();
      expect(found.tender_no).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Win / Loss Outcome Recording & Mandatory Reasons (§26)
  // =========================================================================
  describe('Win / Loss Outcome Recording', () => {
    let lostTenderId: string;
    const lostTenderNo = `GEM/LOST/${Date.now().toString().slice(-6)}`;

    beforeAll(async () => {
      // Create a second tender to test LOST outcome analysis
      const createRes = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_no: lostTenderNo,
          organisation_id: testOrgId,
          product_id: testProductId,
          zone_id: testZoneId,
          region_id: testRegionId,
          category: 'general_mha',
          publication_date: '2026-09-01',
          submission_deadline: closesTodayIST(),
          estimated_value: 8500000,
          assigned_person_id: salesUserId,
          remarks: 'Second tender for post-mortem loss verification',
        });
      expect(createRes.status).toBe(201);
      lostTenderId = createRes.body.id;

      // Move through approval
      await request(app.getHttpServer())
        .post(`/api/tenders/${lostTenderId}/approval-request`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ remarks: 'Participation request' });

      await request(app.getHttpServer())
        .post(`/api/tenders/${lostTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved', remarks: 'Approved' });

      await readyChecklist(lostTenderId);
      const submitRes = await request(app.getHttpServer())
        .post(`/api/tenders/${lostTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', remarks: 'Bid submitted' });
      expect(submitRes.status).toBe(201);
      await closeBid(lostTenderId);
    });

    it('✕ Fails when recording LOST outcome without loss reason (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${lostTenderId}/outcome`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          result: 'lost',
          // Missing loss reason!
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/loss reason is mandatory/i);
    });

    it('✓ Records structured LOST outcome with all §26 post-mortem fields (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${lostTenderId}/outcome`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          result: 'lost',
          reason: 'pricing',
          competitor: 'Zen Technologies Ltd',
          technical_issue: 'Thermal refresh rate 50Hz required, offered 30Hz',
          pricing_issue: 'Competitor quoted 15% below our bottom threshold',
          eligibility_issue: 'Required 5-year past supply credentials in border states',
          documentation_issue: 'Missing notarized OEM compliance matrix page 4',
          other_reason: 'Preference clause exercised for local assembly unit',
          // Results are declared after the bid closes (closing day = today), never before (DEF-090).
          result_date: istToday(),
          remarks: 'Detailed post-mortem reviewed with sales and engineering',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('lost');
      expect(res.body.result).toBe('lost');
      expect(res.body.loss_reason).toBe('pricing');
    });

    it('✓ Successfully records WON tender outcome with value, product, region, and result date (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${createdTenderId}/outcome`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          result: 'won',
          value_lakh: 145.5,
          product_id: testProductId,
          region_id: testRegionId,
          responsible_person_id: salesUserId,
          category: 'pq',
          result_date: istToday(),
          remarks: 'Arihant ranked L1 in commercial bid opening',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('won');
      expect(res.body.result).toBe('won');
      expect(res.body.result_date).toBeTruthy();
      expect(new Date(res.body.result_date).getTime()).not.toBeNaN();
    });

    it('✓ Confirms activity timeline logged the complete audit sequence', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenders/${createdTenderId}/activities`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);

      const descriptions = res.body.map((a: any) => a.description);
      expect(descriptions.some((d: string) => d.includes('registered') || d.includes('identified'))).toBe(true);
      expect(descriptions.some((d: string) => d.includes('WON') || d.includes('won'))).toBe(true);
    });
  });

  // =========================================================================
  // 8. Multi-Dimensional Reporting & Executive Dashboard (§24 & §27)
  // =========================================================================
  describe('Executive Dashboard & Multi-Dimensional Reports', () => {
    it('✓ Retrieves executive dashboard metrics with accurate win rate calculation & deadline tracking', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/dashboard')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total_tenders).toBeGreaterThanOrEqual(1);
      expect(res.body.pq_tenders).toBeDefined();
      expect(res.body.general_mha_tenders).toBeDefined();
      expect(res.body.tenders_won).toBeGreaterThanOrEqual(1);
      expect(res.body.tenders_lost).toBeGreaterThanOrEqual(1);
      expect(res.body.incomplete_preparation).toBeDefined();
      expect(res.body.win_rate).toBeDefined();
      expect(typeof res.body.win_rate).toBe('number');
      expect(res.body.win_rate).toBeGreaterThanOrEqual(0);
      expect(res.body.win_rate).toBeLessThanOrEqual(100);
    });

    it('✓ Retrieves pipeline distribution report across all lifecycle stages', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/pipeline')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.stages).toBeDefined();
      expect(res.body.categories).toBeDefined();
    });

    it('✓ Retrieves win/loss analysis report with deep post-mortem intelligence (§26)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/win-loss')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.won).toBeGreaterThanOrEqual(1);
      expect(res.body.lost).toBeGreaterThanOrEqual(1);
      expect(res.body.win_rate).toBeDefined();
      expect(res.body.reasons).toBeDefined();

      // §26 Won & Lost Breakdowns
      expect(res.body.won_breakdown).toBeDefined();
      expect(res.body.won_breakdown.by_product).toBeDefined();
      expect(res.body.won_breakdown.by_region).toBeDefined();
      expect(res.body.won_breakdown.by_category).toBeDefined();
      expect(res.body.won_breakdown.by_salesperson).toBeDefined();

      expect(res.body.lost_breakdown).toBeDefined();
      expect(res.body.lost_breakdown.reasons).toBeDefined();
      expect(res.body.lost_breakdown.competitors).toBeDefined();
      expect(res.body.lost_breakdown.factors).toBeDefined();
      expect(res.body.lost_breakdown.factors.technical).toBeGreaterThanOrEqual(1);
      expect(res.body.lost_breakdown.factors.pricing).toBeGreaterThanOrEqual(1);

      expect(res.body.recent_completed).toBeDefined();
      expect(Array.isArray(res.body.recent_completed)).toBe(true);
      expect(res.body.recent_completed.length).toBeGreaterThanOrEqual(2);
    });

    it('✓ Retrieves zone-level tender performance report with Vikas PQ & General/MHA counts (§27)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/by-zone')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].zone_name).toBeDefined();
      expect(res.body[0].total).toBeGreaterThanOrEqual(0);
      expect(res.body[0].pq_count).toBeDefined();
      expect(res.body[0].general_mha_count).toBeDefined();
    });

    it('✓ Retrieves region-level tender performance report with Vikas PQ & General/MHA counts (§27)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/by-region')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].region_name).toBeDefined();
      expect(res.body[0].pq_count).toBeDefined();
      expect(res.body[0].general_mha_count).toBeDefined();
    });

    it('✓ Retrieves salesperson tender performance report with Vikas PQ & General/MHA counts (§27)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/by-salesperson')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].salesperson_name).toBeDefined();
      expect(res.body[0].pq_count).toBeDefined();
      expect(res.body[0].general_mha_count).toBeDefined();
    });

    it('✓ Retrieves organisation-level tender performance report with Vikas PQ & General/MHA counts (§27)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/by-organisation')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0].organisation_name).toBeDefined();
        expect(res.body[0].total).toBeGreaterThanOrEqual(0);
        expect(res.body[0].pq_count).toBeDefined();
        expect(res.body[0].general_mha_count).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Regional manager scope (R3) and one audit row per decision (R9)
  // =========================================================================
  describe('Regional manager team scope & audit trail', () => {
    let rmId: string;
    let teamBidId: string;
    let foreignBidId: string;

    beforeAll(async () => {
      const rm = await db.selectFrom('users').select(['id', 'zone_id']).where('email', '=', 'regmgr.north@arihant.com').executeTakeFirstOrThrow();
      rmId = rm.id;
      // A zone (with a region) that is not the RM's own zone.
      const other = await db
        .selectFrom('regions')
        .select(['regions.id as region_id', 'regions.zone_id'])
        .where('regions.zone_id', 'is not', null)
        .where('regions.zone_id', '!=', rm.zone_id)
        .executeTakeFirstOrThrow();
      // A field rep on the RM's team (dashboard teamScope: reports to the RM or based in the RM's zone).
      const teamRep = await db
        .selectFrom('users')
        .select('id')
        .where('is_active', '=', true)
        .where('role', '=', 'sales')
        .where((eb: any) => eb.or([eb('reporting_manager_id', '=', rm.id), eb('zone_id', '=', rm.zone_id)]))
        .executeTakeFirstOrThrow();
      // An active user who is nowhere near the RM's team (national tender desk).
      const outsider = await db
        .selectFrom('users')
        .select('id')
        .where('is_active', '=', true)
        .where('role', '=', 'tender_team')
        .executeTakeFirstOrThrow();

      const mk = async (no: string, assignee: string) => {
        const res = await request(app.getHttpServer())
          .post('/api/tenders')
          .set('Authorization', `Bearer ${mgmtToken}`)
          .send({
            tender_no: no,
            organisation_id: testOrgId,
            product_id: testProductId,
            zone_id: other.zone_id,
            region_id: other.region_id,
            category: 'general_mha',
            publication_date: '2026-09-01',
            submission_deadline: closesTodayIST(),
            estimated_value: 5000000,
            assigned_person_id: assignee,
            tender_owner_id: assignee,
          });
        expect(res.status).toBe(201);
        return res.body.id as string;
      };
      const stamp = Date.now().toString().slice(-6);
      teamBidId = await mk(`GEM/RMTEAM/${stamp}`, teamRep.id);
      foreignBidId = await mk(`GEM/RMOUT/${stamp}`, outsider.id);
    });

    it("✓ RM can inspect a team member's bid tagged to another zone (list, detail and dossier tabs agree)", async () => {
      const list = await request(app.getHttpServer())
        .get('/api/tenders')
        .query({ search: 'GEM/RMTEAM/', limit: 100 })
        .set('Authorization', `Bearer ${rmToken}`);
      expect(list.status).toBe(200);
      expect(list.body.data.map((t: any) => t.id)).toContain(teamBidId);

      for (const path of ['', '/line-items', '/documents', '/financial-instruments', '/comments']) {
        const res = await request(app.getHttpServer()).get(`/api/tenders/${teamBidId}${path}`).set('Authorization', `Bearer ${rmToken}`);
        expect([path, res.status]).toEqual([path, 200]);
      }
    });

    it('✕ RM cannot open a bid outside their zone and team (403), and it is not in their list', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/tenders')
        .query({ search: 'GEM/RMOUT/', limit: 100 })
        .set('Authorization', `Bearer ${rmToken}`);
      expect(list.status).toBe(200);
      expect(list.body.data.map((t: any) => t.id)).not.toContain(foreignBidId);

      const detail = await request(app.getHttpServer()).get(`/api/tenders/${foreignBidId}`).set('Authorization', `Bearer ${rmToken}`);
      expect(detail.status).toBe(403);
      const items = await request(app.getHttpServer()).get(`/api/tenders/${foreignBidId}/line-items`).set('Authorization', `Bearer ${rmToken}`);
      expect(items.status).toBe(403);
      expect(rmId).toBeTruthy();
    });

    it('✓ A decision move writes one audit row (the decision), a plain stage move keeps its stage-changed row', async () => {
      await request(app.getHttpServer())
        .post(`/api/tenders/${teamBidId}/approval-request`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ remarks: 'Participation request' });
      const auditRows = async () =>
        db.selectFrom('audit_log').select(['action']).where('entity_type', '=', 'tender').where('entity_id', '=', teamBidId).execute();
      let rows: { action: string }[] = [];
      for (let i = 0; i < 40; i++) {
        rows = await auditRows();
        if (rows.some((r) => r.action === 'tender_approval_requested')) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(rows.filter((r) => r.action === 'tender_approval_requested')).toHaveLength(1);
      // Give any (wrongly) queued generic row time to land before asserting it is absent.
      await new Promise((r) => setTimeout(r, 750));
      rows = await auditRows();
      expect(rows.filter((r) => r.action === 'tender_stage_changed')).toHaveLength(0);
    });
  });
});
