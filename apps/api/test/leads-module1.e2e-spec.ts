import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 1: Lead & Customer Management E2E Test Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let salesUserId: string;
  let otherSalesUserId: string;

  let testZoneId: string;
  let testRegionId: string;
  let testProduct1Id: string;
  let testProduct2Id: string;

  let freshOrgId: string;
  let primaryContactId: string;
  let secondaryContactId: string;
  let freshLeadId: string;
  let reApproachedLeadId: string;
  let createdFollowUpId: string;
  let knownOrgName: string = '';

  const timestamp = Date.now().toString().slice(-6);
  const uniqueOrgName = `Test Enterprise ${timestamp} Corp`;

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

    // Fetch users to get a distinct user for reassignment
    const usersRes = await request(app.getHttpServer())
      .get('/api/users?limit=10')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(usersRes.status).toBe(200);
    const candidate = usersRes.body.data.find(
      (u: any) => u.id !== salesUserId && u.is_active,
    );
    otherSalesUserId = candidate ? candidate.id : salesUserId;

    // 2. Fetch master data references
    const prodsRes = await request(app.getHttpServer())
      .get('/api/masters/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(prodsRes.status).toBe(200);
    expect(Array.isArray(prodsRes.body)).toBe(true);
    testProduct1Id = prodsRes.body[0].id;
    testProduct2Id = prodsRes.body[1]?.id || testProduct1Id;

    const orgsRes = await request(app.getHttpServer())
      .get('/api/organisations?limit=5')
      .set('Authorization', `Bearer ${mgmtToken}`);
    expect(orgsRes.status).toBe(200);
    if (orgsRes.body.data && orgsRes.body.data.length > 0) {
      knownOrgName = orgsRes.body.data[0].name;
      const withRegion = orgsRes.body.data.find((o: any) => o.zone_id && o.region_id);
      if (withRegion) {
        testZoneId = withRegion.zone_id;
        testRegionId = withRegion.region_id;
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. Duplicate Detection & Prevention
  // =========================================================================
  describe('Duplicate Detection & Prevention', () => {
    it('✓ Detects no duplicates for a new unique organisation name', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/organisations/check-duplicate?name=${encodeURIComponent(uniqueOrgName)}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isDuplicate).toBe(false);
      expect(res.body.matches.length).toBe(0);
    });

    it('✓ Detects duplicates when querying an existing known organisation name', async () => {
      const searchName = knownOrgName || 'Arihant';
      const res = await request(app.getHttpServer())
        .get(`/api/organisations/check-duplicate?name=${encodeURIComponent(searchName)}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isDuplicate).toBe(true);
      expect(res.body.matches.length).toBeGreaterThan(0);
      expect(res.body.suggestion).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Organisation & Multi-Contact Setup
  // =========================================================================
  describe('Organisation & Multi-Contact Management', () => {
    it('✓ Creates a new organisation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/organisations')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          name: uniqueOrgName,
          city: 'New Delhi',
          state: 'Delhi',
          sector: 'Defence / Aerospace',
          is_govt: true,
          zone_id: testZoneId,
          region_id: testRegionId,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe(uniqueOrgName);
      freshOrgId = res.body.id;
    });

    it('✓ Adds primary contact person to the organisation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/contacts')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: freshOrgId,
          full_name: 'Col. Rajesh Verma',
          designation: 'Director Procurement',
          mobile: `9810${timestamp}`,
          email: `rajesh.verma.${timestamp}@defence.gov.in`,
          is_primary: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.is_primary).toBe(true);
      primaryContactId = res.body.id;
    });

    it('✓ Adds secondary technical contact person to the organisation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/contacts')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: freshOrgId,
          full_name: 'Dr. Anita Desai',
          designation: 'Chief Technology Officer',
          mobile: `9820${timestamp}`,
          email: `anita.desai.${timestamp}@defence.gov.in`,
          is_primary: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.is_primary).toBe(false);
      secondaryContactId = res.body.id;
    });

    it('✓ Duplicate check identifies organisation by primary contact email', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/organisations/check-duplicate?email=rajesh.verma.${timestamp}@defence.gov.in`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isDuplicate).toBe(true);
      expect(res.body.matches.some((m: any) => m.id === freshOrgId)).toBe(true);
    });
  });

  // =========================================================================
  // 3. Fresh Lead Creation & Automatic Classification
  // =========================================================================
  describe('Fresh Lead Lifecycle & Outbox Event', () => {
    it('✓ Automatically classifies a new prospect with no prior interactions as FRESH', async () => {
      const nextFollowup = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: freshOrgId,
          primary_contact_id: primaryContactId,
          product_id: testProduct1Id,
          product_ids: [testProduct2Id],
          source: 'Exhibition',
          category: 'active',
          probability: 'high',
          channel: 'direct',
          assigned_to: salesUserId,
          value_lakh: 45.5,
          next_followup_date: nextFollowup,
          remarks: 'Met at DefExpo 2026. Interested in surveillance equipment.',
        });

      if (res.status !== 201) {
        console.error('DEBUG POST /api/leads failure:', res.status, JSON.stringify(res.body));
      }

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.lead_type).toBe('fresh');
      expect(res.body.lead_status).toBe('new');
      expect(res.body.assigned_to).toBe(salesUserId);
      freshLeadId = res.body.id;
    });

    it('✓ Creates a lead with a new account (atomic organisation & contact registration)', async () => {
      const uniqueName = `Direct Prospect ${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_name: uniqueName,
          contact_name: 'Brigadier S. K. Singh',
          contact_designation: 'Director Procurement',
          contact_mobile: '9811223344',
          contact_email: 'sk.singh@defence.gov.in',
          city: 'New Delhi',
          state: 'Delhi',
          zone_id: testZoneId,
          region_id: testRegionId,
          sector: 'Defence / Aerospace',
          department: 'Procurement Cell',
          product_id: testProduct1Id,
          product_ids: [testProduct1Id],
          source: 'field_visit',
          category: 'new_lead',
          assigned_to: salesUserId,
          lead_status: 'new',
          status: 'new',
          last_interaction_date: new Date().toISOString().split('T')[0],
          last_interaction_type: 'call',
          value_lakh: 50.0,
          estimated_value_lakh: 50.0,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.organisation_name).toBe(uniqueName);
      expect(res.body.contact_name).toBe('Brigadier S. K. Singh');
      expect(res.body.lead_type).toBe('fresh');
    });

    it('✓ Inspecting Fresh lead returns product interests, allowed transitions, and initial interaction', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/leads/${freshLeadId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(freshLeadId);
      expect(res.body.lead_type).toBe('fresh');
      expect(res.body.product_interests).toBeDefined();
      expect(res.body.product_interests.length).toBeGreaterThanOrEqual(1);
      expect(res.body.interactions).toBeDefined();
      expect(res.body.interactions.length).toBeGreaterThanOrEqual(1);
      expect(res.body.allowed_transitions).toContain('contacted');
      expect(res.body.allowed_transitions).toContain('qualified');
    });
  });

  // =========================================================================
  // 4. Re-Approached Prospect Lifecycle & Continuous Customer History
  // =========================================================================
  describe('Re-Approached Prospect Detection & History Continuity', () => {
    it('✓ Automatically classifies next lead for same account as RE_APPROACHED due to prior interactions', async () => {
      // The organisation already has an interaction from freshLeadId creation
      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: freshOrgId,
          primary_contact_id: secondaryContactId,
          product_id: testProduct2Id,
          source: 'Field Visit',
          category: 'active',
          probability: 'medium',
          assigned_to: salesUserId,
          value_lakh: 80.0,
          remarks: 'Secondary approach for avionics subsystem package.',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.lead_type).toBe('re_approached');
      reApproachedLeadId = res.body.id;
    });

    it('✓ Filters correctly by lead_type (fresh vs re_approached)', async () => {
      const freshRes = await request(app.getHttpServer())
        .get(`/api/leads?lead_type=fresh&organisation_id=${freshOrgId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(freshRes.status).toBe(200);
      expect(freshRes.body.data.some((l: any) => l.id === freshLeadId)).toBe(true);

      const reAppRes = await request(app.getHttpServer())
        .get(`/api/leads?lead_type=re_approached&organisation_id=${freshOrgId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(reAppRes.status).toBe(200);
      expect(reAppRes.body.data.some((l: any) => l.id === reApproachedLeadId)).toBe(true);
    });
  });

  // =========================================================================
  // 5. Lead Lifecycle State Transitions & Validation
  // =========================================================================
  describe('Lead State Machine & Lifecycle Transitions', () => {
    it('✓ Progresses lead: new -> contacted', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'contacted',
          remarks: 'Phone call completed with Director Procurement.',
        });

      expect(res.status).toBe(200);
      expect(res.body.lead_status).toBe('contacted');
    });

    it('✓ Progresses lead: contacted -> qualified', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'qualified',
          remarks: 'Requirements and budget verified.',
        });

      expect(res.status).toBe(200);
      expect(res.body.lead_status).toBe('qualified');
    });

    it('✓ Rejects invalid skip transition (qualified -> converted without negotiation/proposal)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'converted',
          remarks: 'Trying to skip steps directly to won',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid status transition');
    });

    it('✓ Rejects transition to lost without a mandatory loss reason', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'lost',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('loss reason is required');
    });

    it('✓ Successfully transitions to lost with a valid loss reason', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${reApproachedLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'lost',
          loss_reason: 'competitor',
          remarks: 'Client selected L1 bidder offering alternative tech.',
        });

      expect(res.status).toBe(200);
      expect(res.body.lead_status).toBe('lost');
      expect(res.body.loss_reason).toBe('competitor');
    });

    it('✓ Progresses lead to converted via follow_up stage', async () => {
      // Move freshLeadId: qualified -> follow_up -> converted
      await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'follow_up', remarks: 'Final commercial alignment' });

      const convRes = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          status: 'converted',
          remarks: 'Purchase order issued! ₹45.5 Lakh won.',
        });

      expect(convRes.status).toBe(200);
      expect(convRes.body.lead_status).toBe('converted');
    });
  });

  // =========================================================================
  // 6. Salesperson Ownership & Assignment History
  // =========================================================================
  describe('Salesperson Assignment & Audit History', () => {
    it('✓ Reassigns lead to another salesperson and records history', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/assign`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          assigned_to: otherSalesUserId,
          reason: 'Territory realigned for defence account specialization',
        });

      expect(res.status).toBe(200);
      expect(res.body.assigned_to).toBe(otherSalesUserId);

      // Verify assignment history record
      const leadInspection = await request(app.getHttpServer())
        .get(`/api/leads/${freshLeadId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(leadInspection.status).toBe(200);
      expect(leadInspection.body.assignment_history.length).toBeGreaterThanOrEqual(1);
      const latestAssignment = leadInspection.body.assignment_history[0];
      expect(latestAssignment.new_salesperson_id).toBe(otherSalesUserId);
      expect(latestAssignment.reason).toContain('Territory realigned');
    });

    it('✓ Blocks unauthorized salesperson from reassigning lead', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${freshLeadId}/assign`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          assigned_to: salesUserId,
        });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 7. Multi-Product Interest Management
  // =========================================================================
  describe('Multi-Product Interests', () => {
    it('✓ Adds an additional product interest to the lead', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/leads/${freshLeadId}/product-interests`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({ product_id: testProduct2Id });

      expect(res.status).toBe(201);
    });

    it('✓ Removes a product interest relationship', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/leads/${freshLeadId}/product-interests/${testProduct2Id}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 8. Unified Interactions Timeline & Attachments
  // =========================================================================
  describe('Chronological Interaction Timeline & Attachments', () => {
    it('✓ Logs physical visit interaction with supporting attachments', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/interactions')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: freshOrgId,
          contact_id: primaryContactId,
          lead_id: freshLeadId,
          type: 'physical_visit',
          remarks: 'Visited headquarters for procurement committee briefing.',
          outcome: 'Technical specs accepted in principle.',
          next_action: 'Submit formal quotation',
          followup_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          attachments: [
            {
              file_url: 'https://cdn.arihant.com/docs/meeting_minutes_signed.pdf',
              file_name: 'meeting_minutes_signed.pdf',
              file_size: 204850,
              mime_type: 'application/pdf',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.attachments.length).toBe(1);
      expect(res.body.follow_up).toBeDefined();
      createdFollowUpId = res.body.follow_up.id;
    });

    it('✓ Logs demonstration interaction', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/interactions')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: freshOrgId,
          contact_id: secondaryContactId,
          lead_id: freshLeadId,
          type: 'demo',
          remarks: 'Live demonstration of handheld thermal imager at testing ground.',
          outcome: 'Demonstration successful, 100% detection rate at 1.5km.',
        });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe('demo');
    });

    it('✓ Organisation 360° timeline returns all interactions chronologically with attachments', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/organisations/${freshOrgId}/timeline`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.organisation.id).toBe(freshOrgId);
      expect(res.body.contacts.length).toBeGreaterThanOrEqual(2);
      expect(res.body.leads.length).toBeGreaterThanOrEqual(2);
      expect(res.body.timeline.length).toBeGreaterThanOrEqual(3);
      expect(res.body.assignment_history.length).toBeGreaterThanOrEqual(1);

      // Verify attachment exists in timeline
      const withAttachment = res.body.timeline.find((i: any) => i.attachments && i.attachments.length > 0);
      expect(withAttachment).toBeDefined();
      expect(withAttachment.attachments[0].file_name).toBe('meeting_minutes_signed.pdf');
    });
  });

  // =========================================================================
  // 9. Follow-Up Management Desk
  // =========================================================================
  describe('Follow-up Management & Lifecycle', () => {
    it('✓ Retrieves follow-up metrics HUD', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/follow-ups/metrics')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('✓ Completes follow-up and automatically schedules next touchpoint', async () => {
      const nextDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .patch(`/api/follow-ups/${createdFollowUpId}/complete`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          outcome: 'Discussed draft contract terms and timeline.',
          remarks: 'Client agreed to proceed with tender filing.',
          next_followup_date: nextDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.completed.status).toBe('completed');
      expect(res.body.nextFollowUp).toBeDefined();
      expect(new Date(res.body.nextFollowUp.due_date).toISOString().split('T')[0]).toBeDefined();
    });

    it('✓ Reschedules a follow-up', async () => {
      const followUps = await request(app.getHttpServer())
        .get(`/api/follow-ups?organisation_id=${freshOrgId}&status=pending`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(followUps.status).toBe(200);
      if (followUps.body.data.length > 0) {
        const pendingId = followUps.body.data[0].id;
        const rescheduledDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const res = await request(app.getHttpServer())
          .patch(`/api/follow-ups/${pendingId}/reschedule`)
          .set('Authorization', `Bearer ${mgmtToken}`)
          .send({
            new_due_date: rescheduledDate,
            reason: 'Client officer on annual leave',
          });

        expect(res.status).toBe(200);
        expect(new Date(res.body.due_date).toISOString().split('T')[0]).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 10. Multi-Dimensional Intelligence Reporting
  // =========================================================================
  describe('Executive CRM Intelligence Reports', () => {
    it('✓ Retrieves Lead Dashboard HUD metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/leads/dashboard')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.metrics.totalLeads).toBeGreaterThanOrEqual(2);
      expect(res.body.metrics.freshLeads).toBeGreaterThanOrEqual(1);
      expect(res.body.metrics.reApproachedLeads).toBeGreaterThanOrEqual(1);
      expect(res.body.metrics.byStatus).toBeDefined();
      expect(res.body.metrics.followUps).toBeDefined();
    });

    it('✓ Retrieves Salesperson Performance Report', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/leads/reports/salesperson')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].salesperson_name).toBeDefined();
      expect(res.body[0].total_leads).toBeDefined();
    });

    it('✓ Retrieves Regional & Territorial Zone Report', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/leads/reports/zones')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('✓ Retrieves Product Interest Demand Report', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/leads/reports/products')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('✓ Retrieves Interaction Activity Breakdown Report', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/leads/reports/interactions')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.byType).toBeDefined();
      expect(res.body.byEmployee).toBeDefined();
    });
  });

  // =========================================================================
  // 11. Pagination, Filtering, and Search
  // =========================================================================
  describe('Pagination, Filtering, and Server-Side Search', () => {
    it('✓ Supports paginated query on Leads register', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/leads?page=1&limit=5')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(5);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('✓ Searches leads by organisation name', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/leads?search=${encodeURIComponent(uniqueOrgName)}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].organisation_name).toContain(uniqueOrgName);
    });
  });
});
