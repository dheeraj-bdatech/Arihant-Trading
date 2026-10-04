import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 4: Tender Management 25 Edge Cases Test Suite (§10)', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let adminUserId: string;
  let salesToken: string;
  let salesUserId: string;
  let rmToken: string;

  let testOrgId: string;
  let testOrg2Id: string;
  let testProductId: string;
  let testZoneId: string;
  let testRegionId: string;
  let otherZoneId: string;
  let pqCategoryId: string;
  let generalCategoryId: string;

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
    adminUserId = mgmtRes.body.user.id;

    const salesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    expect(salesRes.status).toBe(200);
    salesToken = salesRes.body.accessToken;
    salesUserId = salesRes.body.user.id;

    const rmRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'regmgr.north@arihant.com', password: 'password123' });
    expect(rmRes.status).toBe(200);
    rmToken = rmRes.body.accessToken;

    // Ensure self-approval is disabled in settings
    await request(app.getHttpServer())
      .put('/api/tenders/settings')
      .set('Authorization', `Bearer ${mgmtToken}`)
      .send({
        allow_self_approval: false,
        require_won_value: true,
      });

    // 2. Fetch master references
    const orgsRes = await request(app.getHttpServer())
      .get('/api/organisations?limit=2')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testOrgId = orgsRes.body.data[0].id;
    testOrg2Id = orgsRes.body.data[1]?.id || orgsRes.body.data[0].id;

    const prodsRes = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testProductId = prodsRes.body[0].id;

    const zonesRes = await request(app.getHttpServer())
      .get('/api/tenders/zones')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testZoneId = zonesRes.body[0].id;
    otherZoneId = zonesRes.body[1]?.id || zonesRes.body[0].id;

    const regionsRes = await request(app.getHttpServer())
      .get('/api/tenders/regions')
      .set('Authorization', `Bearer ${mgmtToken}`);
    const regInZone = regionsRes.body.find((r: any) => r.zone_id === testZoneId);
    testRegionId = regInZone?.id || regionsRes.body[0].id;

    const catsRes = await request(app.getHttpServer())
      .get('/api/tenders/categories')
      .set('Authorization', `Bearer ${mgmtToken}`);
    const pq = catsRes.body.find((c: any) => c.code.toLowerCase() === 'pq');
    const gen = catsRes.body.find((c: any) => c.code.toLowerCase() === 'general_mha');
    pqCategoryId = pq.id;
    generalCategoryId = gen.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // EDGE CASE 1 & 2: Duplicate detection, whitespace trimming, and empty fields
  // =========================================================================
  describe('Edge Case 1 & 2: Number uniqueness, case-insensitivity, whitespace', () => {
    const edge1Number = `EDGE1-${Date.now()}`;

    it('creates initial tender and trims leading/trailing spaces', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `  ${edge1Number}  `,
          organisation: '  Defence Research Lab  ',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-20T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });

      expect(res.status).toBe(201);
      expect(res.body.tender_number).toBe(edge1Number);
    });

    it('rejects duplicate tender number differing only in case or whitespace for same organisation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `  ${edge1Number.toLowerCase()} `,
          organisation: '  defence research lab  ',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-20T15:00:00+05:30',
        });

      expect(res.status).toBe(409);
    });

    it('allows the same tender number at a different organisation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: edge1Number,
          organisation: 'Ministry of Home Affairs New Delhi',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-20T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });

      expect(res.status).toBe(201);
    });

    it('Edge Case 2: rejects blank or whitespace-only tender number or organisation', async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: '    ',
          organisation: 'Ministry of Defence',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-20T15:00:00+05:30',
        });
      expect(res1.status).toBe(400);

      const res2 = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `TND-${Date.now()}`,
          organisation: '    ',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-20T15:00:00+05:30',
        });
      expect(res2.status).toBe(400);
    });
  });

  // =========================================================================
  // EDGE CASE 3 & 4: Deadline validation & IST timezone
  // =========================================================================
  describe('Edge Case 3 & 4: Dates, Deadline before publication, past deadline, IST parsing', () => {
    it('Edge Case 3: rejects deadline earlier than publication date', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `EARLY-DL-${Date.now()}`,
          organisation: 'Border Security Force',
          category_id: pqCategoryId,
          publication_date: '2026-09-20',
          submission_deadline: '2026-09-10T15:00:00+05:30',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/deadline|earlier/i);
    });

    it('Edge Case 3: normal create blocks past deadline; allowed in import mode', async () => {
      const resNormal = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `PAST-NORMAL-${Date.now()}`,
          organisation: 'CRPF Headquarters',
          category_id: pqCategoryId,
          publication_date: '2020-01-01',
          submission_deadline: '2020-01-15T15:00:00+05:30',
        });
      expect(resNormal.status).toBe(400);

      // Allowed via import (historical mode)
      const importNum = `PAST-IMPORT-${Date.now()}`;
      const resImport = await request(app.getHttpServer())
        .post('/api/tenders/import')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          commit: true,
          duplicate_mode: 'skip',
          rows: [
            {
              'Tender Number': importNum,
              Organisation: 'CRPF Headquarters Historical',
              'Publication Date': '01-01-2020',
              'Submission Deadline': '15-01-2020',
              Category: 'General / MHA',
            },
          ],
        });
      expect([200, 201]).toContain(resImport.status);
      expect(resImport.body.inserted).toBe(1);
    });

    it('Edge Case 4: deadline entered without timezone is interpreted as IST (+05:30)', async () => {
      const tenderNum = `IST-TEST-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: tenderNum,
          organisation: 'Delhi Police IT Cell',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-11-15T15:00:00', // No timezone given
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });

      expect(res.status).toBe(201);
      const dl = new Date(res.body.submission_deadline);
      // 15:00 IST is 09:30 UTC
      expect(dl.getUTCHours()).toBe(9);
      expect(dl.getUTCMinutes()).toBe(30);
    });
  });

  // =========================================================================
  // EDGE CASE 5: Zone & Region Integrity
  // =========================================================================
  describe('Edge Case 5: Zone & Region Integrity', () => {
    it('rejects region without zone', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `REG-NO-ZONE-${Date.now()}`,
          organisation: 'NSG Manesar',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-25T15:00:00+05:30',
          region_id: testRegionId, // No zone_id provided!
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/zone/i);
    });

    it('rejects region that does not belong to the selected zone', async () => {
      // Find a region that belongs to a different zone
      const allRegs = await request(app.getHttpServer())
        .get('/api/tenders/regions')
        .set('Authorization', `Bearer ${mgmtToken}`);
      const otherReg = allRegs.body.find((r: any) => r.zone_id !== testZoneId);

      if (otherReg) {
        const res = await request(app.getHttpServer())
          .post('/api/tenders')
          .set('Authorization', `Bearer ${mgmtToken}`)
          .send({
            tender_number: `MISMATCH-ZONE-${Date.now()}`,
            organisation: 'Assam Rifles',
            category_id: generalCategoryId,
            publication_date: '2026-09-01',
            submission_deadline: '2026-10-25T15:00:00+05:30',
            zone_id: testZoneId,
            region_id: otherReg.id, // Belongs to different zone
          });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/belong to the selected zone/i);
      }
    });
  });

  // =========================================================================
  // EDGE CASE 6, 7 & 8: Approvals, Authorizations, Self-Approval, Rejection Reason
  // =========================================================================
  describe('Edge Case 6, 7 & 8: Approvals Workflow Constraints', () => {
    let unassignedTenderId: string;
    let approverTenderId: string;

    beforeAll(async () => {
      const resUnassigned = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `NO-ASSIGNEE-${Date.now()}`,
          organisation: 'CISF CISF Unit',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-11-01T15:00:00+05:30',
        });
      unassignedTenderId = resUnassigned.body.id;

      const resApp = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          tender_number: `APPROVE-TEST-${Date.now()}`,
          organisation: 'DRDO HQ',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-11-01T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });
      approverTenderId = resApp.body.id;
    });

    it('Edge Case 6: approval requested with no assignee is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${unassignedTenderId}/approval-request`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ remarks: 'Request without assignee' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/assignee|assign a salesperson|assigned person/i);
    });

    it('submits approval request with assignee', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approval-request`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ remarks: 'Ready for review' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('awaiting_approval');
    });

    it('Edge Case 7: self-approval is blocked when allow_self_approval = false', async () => {
      // salesUser requested it and is trying to approve their own tender
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ decision: 'approved', remarks: 'Self approving' });

      expect(res.status).toBe(403);
    });

    it('Strict Governance: blocks regional manager from approving during internal review', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approve`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({ decision: 'approved', remarks: 'Regional manager attempting approval' });

      expect(res.status).toBe(403);
    });

    it('Strict Governance: blocks regional manager from rejecting during internal review', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approve`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({ decision: 'rejected', rejection_reason: 'Commercial risk too high' });

      expect(res.status).toBe(403);
    });

    it('Edge Case 8: reject without a reason is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'rejected', remarks: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/rejection reason is mandatory|reason/i);
    });

    it('approves tender by authorized manager', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved', remarks: 'Participation approved' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('under_preparation');
    });

    it('Edge Case 7: approving twice or when not awaiting approval is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${approverTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved', remarks: 'Double clicking approve' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/awaiting internal approval/i);
    });
  });

  // =========================================================================
  // EDGE CASE 9 & 10: State skipping & PQ vs General rules
  // =========================================================================
  describe('Edge Case 9 & 10: Skipping Approval & Category-specific stage constraints', () => {
    let generalTenderId: string;
    let pqTenderId: string;

    beforeAll(async () => {
      const resGen = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `GEN-SKIP-${Date.now()}`,
          organisation: 'General Motors India Defence',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-11-10T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });
      generalTenderId = resGen.body.id;

      const resPq = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `PQ-SKIP-${Date.now()}`,
          organisation: 'Heavy Vehicles Factory Avadi',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-11-10T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });
      pqTenderId = resPq.body.id;
    });

    it('Edge Case 9: skipping approval directly from IDENTIFIED to TENDER_SUBMITTED is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${generalTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', remarks: 'Trying to skip approval' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot move tender|valid next states/i);
    });

    it('prepares both tenders for transition checks', async () => {
      // General tender -> awaiting -> approve -> under_preparation
      await request(app.getHttpServer())
        .post(`/api/tenders/${generalTenderId}/approval-request`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ remarks: 'Review' });
      await request(app.getHttpServer())
        .post(`/api/tenders/${generalTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved', remarks: 'Approved' });

      // PQ tender -> awaiting -> approve -> under_preparation
      await request(app.getHttpServer())
        .post(`/api/tenders/${pqTenderId}/approval-request`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ remarks: 'Review' });
      await request(app.getHttpServer())
        .post(`/api/tenders/${pqTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved', remarks: 'Approved' });
    });

    it('Edge Case 10: non-PQ tender cannot enter PQ stages', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${generalTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'pq_submitted', remarks: 'General tender trying PQ' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/non-PQ tender can never enter PQ stages/i);
    });

    it('Edge Case 10: PQ tender cannot skip PQ directly to TENDER_SUBMITTED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${pqTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', remarks: 'PQ tender skipping to submitted' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/PQ-category tender cannot go directly to TENDER_SUBMITTED/i);
    });
  });

  // =========================================================================
  // EDGE CASE 11, 12 & 13: PQ Outcomes, Passed Deadline & Corrigendum Extension
  // =========================================================================
  describe('Edge Case 11, 12 & 13: Submission after deadline, Corrigendum, PQ Win', () => {
    let expiredTenderId: string;

    beforeAll(async () => {
      // Import an expired tender currently in under_preparation
      const expNum = `EXPIRED-SUB-${Date.now()}`;
      await request(app.getHttpServer())
        .post('/api/tenders/import')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          commit: true,
          rows: [
            {
              'Tender Number': expNum,
              Organisation: 'CRPF Signal Bn',
              'Publication Date': '01-01-2026',
              'Submission Deadline': '10-01-2026', // Expired
              Category: 'General / MHA',
            },
          ],
        });

      const listRes = await request(app.getHttpServer())
        .get(`/api/tenders?search=${expNum}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expiredTenderId = listRes.body.data[0].id;

      // Assign salesperson so approval can be requested
      await request(app.getHttpServer())
        .put(`/api/tenders/${expiredTenderId}`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ assigned_to: salesUserId });

      // Set to under_preparation directly via admin transition
      await request(app.getHttpServer())
        .post(`/api/tenders/${expiredTenderId}/approval-request`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ remarks: 'Approval' });
      await request(app.getHttpServer())
        .post(`/api/tenders/${expiredTenderId}/approve`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ decision: 'approved', remarks: 'Approved' });
    });

    it('Edge Case 12: submission after deadline is blocked with corrigendum message', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${expiredTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', remarks: 'Attempting submission after deadline' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Deadline passed – record corrigendum extension or cancel/i);
    });

    it('Edge Case 13: deadline change requires non-empty reason', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${expiredTenderId}/deadline-change`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          new_deadline: '2026-11-20T15:00:00+05:30',
          reason: '   ', // Blank reason!
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reason is mandatory|corrigendum/i);
    });

    it('Edge Case 12 & 13: corrigendum extension extends deadline and unblocks submission', async () => {
      const resChange = await request(app.getHttpServer())
        .post(`/api/tenders/${expiredTenderId}/deadline-change`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          new_deadline: '2026-11-20T15:00:00+05:30',
          reason: 'Corrigendum No. 1 issued by Department',
        });

      expect(resChange.status).toBe(201);
      expect(resChange.body.submission_deadline).toBeTruthy();

      // Now submission succeeds!
      const resSub = await request(app.getHttpServer())
        .post(`/api/tenders/${expiredTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', remarks: 'Submitted post-corrigendum' });

      expect(resSub.status).toBe(201);
      expect(resSub.body.status).toBe('submitted');
    });

    it('Edge Case 11: pure empanelment PQ can be WON directly from PQ_QUALIFIED', async () => {
      const empanelmentNum = `EMPANEL-${Date.now()}`;
      const resCreate = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: empanelmentNum,
          organisation: 'DRDO Standing Empanelment Committee',
          category_id: pqCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });

      const eId = resCreate.body.id;
      await request(app.getHttpServer()).post(`/api/tenders/${eId}/approval-request`).set('Authorization', `Bearer ${salesToken}`).send({ remarks: 'Approval' });
      await request(app.getHttpServer()).post(`/api/tenders/${eId}/approve`).set('Authorization', `Bearer ${mgmtToken}`).send({ decision: 'approved', remarks: 'Ok' });
      await request(app.getHttpServer()).post(`/api/tenders/${eId}/transitions`).set('Authorization', `Bearer ${mgmtToken}`).send({ target_status: 'pq_submitted', remarks: 'PQ Sub' });
      await request(app.getHttpServer()).post(`/api/tenders/${eId}/transitions`).set('Authorization', `Bearer ${mgmtToken}`).send({ target_status: 'pq_qualified', remarks: 'Qualified' });

      // Record WON directly from PQ_QUALIFIED (pure empanelment)
      const resWon = await request(app.getHttpServer())
        .post(`/api/tenders/${eId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'won',
          value: 5000000,
          result_date: '2026-09-24',
          notes: 'Empanelled successfully for 3 years',
        });

      expect(resWon.status).toBe(201);
      expect(resWon.body.status).toBe('won');
    });
  });

  // =========================================================================
  // EDGE CASE 14 & 15: On-Hold Constraints & Terminal Tender Reopen
  // =========================================================================
  describe('Edge Case 14 & 15: On Hold restrictions & Terminal Tender Reopen by Admin', () => {
    let holdTenderId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `HOLD-${Date.now()}`,
          organisation: 'Western Command Chandimandir',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });
      holdTenderId = res.body.id;

      // Move to under_preparation
      await request(app.getHttpServer()).post(`/api/tenders/${holdTenderId}/approval-request`).set('Authorization', `Bearer ${salesToken}`).send({ remarks: 'Approval' });
      await request(app.getHttpServer()).post(`/api/tenders/${holdTenderId}/approve`).set('Authorization', `Bearer ${mgmtToken}`).send({ decision: 'approved', remarks: 'Ok' });
    });

    it('Edge Case 14: puts tender on hold and verifies flag and status_before_hold', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/hold`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ reason: 'Client requested postponement of specifications' });

      expect(res.status).toBe(201);
      expect(res.body.on_hold).toBe(true);
      expect(res.body.status_before_hold).toBe('under_preparation');
    });

    it('Edge Case 14: putting an already held tender on hold again is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/hold`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ reason: 'Double holding' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already on hold/i);
    });

    it('Edge Case 14: while on hold, all status transitions are blocked except CANCELLED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'submitted', remarks: 'Move while on hold' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/all status transitions are blocked except CANCELLED/i);
    });

    it('Edge Case 14: resume restores exact previous stage', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/resume`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ reason: 'Client resolved specifications' });

      expect(res.status).toBe(201);
      expect(res.body.on_hold).toBe(false);
      expect(res.body.status).toBe('under_preparation');
    });

    it('Edge Case 15: terminal tenders are locked and can only be reopened by Admin with reason', async () => {
      // Cancel the tender
      await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ target_status: 'cancelled', remarks: 'Budget frozen' });

      // Regular sales user cannot reopen
      const resForbidden = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/reopen`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ reason: 'Sales trying to reopen' });
      expect(resForbidden.status).toBe(403);

      // Admin reopen without reason is blocked
      const resNoReason = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/reopen`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ reason: '   ' });
      expect(resNoReason.status).toBe(400);

      // Admin reopen succeeds and restores previous stage
      const resReopen = await request(app.getHttpServer())
        .post(`/api/tenders/${holdTenderId}/reopen`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ reason: 'Budget restored by client in Q3' });

      expect(resReopen.status).toBe(201);
      expect(resReopen.body.status).toBe('under_preparation');
    });
  });

  // =========================================================================
  // EDGE CASE 16 & 17: Result recording validations
  // =========================================================================
  describe('Edge Case 16 & 17: Result before submission, WON zero value, unknown loss reasons', () => {
    let unsubmittedTenderId: string;
    let validSubmittedTenderId: string;

    beforeAll(async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `UNSUB-${Date.now()}`,
          organisation: 'Ministry of Railways',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });
      unsubmittedTenderId = res1.body.id;

      const res2 = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `SUB-VALID-${Date.now()}`,
          organisation: 'Cabinet Secretariat',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });
      validSubmittedTenderId = res2.body.id;
      await request(app.getHttpServer()).post(`/api/tenders/${validSubmittedTenderId}/approval-request`).set('Authorization', `Bearer ${salesToken}`).send({ remarks: 'Ok' });
      await request(app.getHttpServer()).post(`/api/tenders/${validSubmittedTenderId}/approve`).set('Authorization', `Bearer ${mgmtToken}`).send({ decision: 'approved', remarks: 'Ok' });
      await request(app.getHttpServer()).post(`/api/tenders/${validSubmittedTenderId}/transitions`).set('Authorization', `Bearer ${mgmtToken}`).send({ target_status: 'submitted', remarks: 'Bid submitted' });
    });

    it('Edge Case 16: recording result before tender has reached submission stage is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${unsubmittedTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'won',
          value: 1000000,
          result_date: '2026-09-24',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/has not reached a submission stage/i);
    });

    it('Edge Case 16: result date in the future is blocked', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenders/${validSubmittedTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'won',
          value: 1000000,
          result_date: '2030-01-01', // Future date!
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/future/i);
    });

    it('Edge Case 16: WON outcome with missing, zero, or negative value is blocked', async () => {
      const resZero = await request(app.getHttpServer())
        .post(`/api/tenders/${validSubmittedTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'won',
          value: 0,
          result_date: '2026-09-24',
        });
      expect(resZero.status).toBe(400);

      const resNegative = await request(app.getHttpServer())
        .post(`/api/tenders/${validSubmittedTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'won',
          value: -50000,
          result_date: '2026-09-24',
        });
      expect(resNegative.status).toBe(400);
    });

    it('Edge Case 17: LOST without a reason, unknown reason, or OTHER without text is blocked', async () => {
      // 1. Unknown reason
      const resUnknown = await request(app.getHttpServer())
        .post(`/api/tenders/${validSubmittedTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'lost',
          result_date: '2026-09-24',
          loss_reasons: ['NON_EXISTENT_REASON_CODE'],
        });
      expect(resUnknown.status).toBe(400);
      expect(resUnknown.body.message).toMatch(/unknown loss reason/i);

      // 2. OTHER without explanation
      const resOtherNoText = await request(app.getHttpServer())
        .post(`/api/tenders/${validSubmittedTenderId}/result`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'lost',
          result_date: '2026-09-24',
          loss_reasons: ['OTHER'],
          other_reason_text: '   ',
        });
      expect(resOtherNoText.status).toBe(400);
      expect(resOtherNoText.body.message).toMatch(/text explanation is required/i);
    });
  });

  // =========================================================================
  // EDGE CASE 20: Portal Issue Edge Cases
  // =========================================================================
  describe('Edge Case 20: Portal Issues error handling', () => {
    it('rejects logging portal issue with empty description', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders/portal-issues')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          portal: 'GeM',
          issue_description: '   ',
        });

      expect(res.status).toBe(400);
    });

    it('rejects logging portal issue against non-existent or deleted tender', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenders/00000000-0000-0000-0000-000000000000/portal-issues')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          portal: 'CPPP',
          issue_description: 'Valid issue on missing tender',
        });

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // EDGE CASE 22: Optimistic Locking (409 Conflict)
  // =========================================================================
  describe('Edge Case 22: Optimistic Locking Conflict', () => {
    it('returns 409 conflict when expected_version does not match current version', async () => {
      const resCreate = await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `CONCURRENT-${Date.now()}`,
          organisation: 'SPG Special Protection Group',
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00+05:30',
          assigned_to: salesUserId,
          zone_id: testZoneId,
          region_id: testRegionId,
        });

      const tenderId = resCreate.body.id;
      const currentVersion = resCreate.body.version; // e.g. 1

      // Second user tries updating with stale expected_version: 999
      const resConflict = await request(app.getHttpServer())
        .post(`/api/tenders/${tenderId}/transitions`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          target_status: 'cancelled',
          expected_version: currentVersion + 5, // Stale!
          remarks: 'Stale write',
        });

      expect(resConflict.status).toBe(409);
      expect(resConflict.body.message).toMatch(/This tender was updated by someone else – refresh/i);
    });
  });

  // =========================================================================
  // EDGE CASE 21: Reports & Snapshot Attribution
  // =========================================================================
  describe('Edge Case 21: Historical Snapshots & Summary Reports', () => {
    it('confirms reporting dashboard returns "—" win rate when no tenders are decided', async () => {
      const blankOrg = `Undecided Org ${Date.now()}`;
      await request(app.getHttpServer())
        .post('/api/tenders')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          tender_number: `UNDECIDED-${Date.now()}`,
          organisation: blankOrg,
          category_id: generalCategoryId,
          publication_date: '2026-09-01',
          submission_deadline: '2026-10-30T15:00:00+05:30',
        });

      const res = await request(app.getHttpServer())
        .get('/api/tenders/reports/summary?group_by=organisation')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const row = res.body.find((r: any) => r.group === blankOrg);
      expect(row).toBeDefined();
      expect(row.win_rate).toBe('—');
    });
  });
});
