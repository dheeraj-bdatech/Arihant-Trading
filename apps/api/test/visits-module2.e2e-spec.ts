import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';

describe('Module 2: Visit & Field Planning E2E Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let otherSalesToken: string;
  let salesUserId: string;
  let otherSalesUserId: string;

  let testOrg1Id: string;
  let testOrg1Name: string;
  let testOrg2Id: string;
  let testOrg2Name: string;

  let normalVisitId: string;
  let tripId: string;
  let managerAddedVisitId: string;

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

    // Clean up test data for deterministic test runs
    const db = app.get(KYSELY_DB);
    await db.deleteFrom('employee_activities').execute();
    await db.deleteFrom('visit_updates').execute();
    await db.deleteFrom('expenses').execute();
    await db.deleteFrom('interactions').where('visit_id', 'is not', null).execute();
    await db.deleteFrom('visits').execute();
    await db.deleteFrom('trips').execute();

    // 1. Authenticate roles
    const mgmtRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'mgmt@arihant.com', password: 'password123' });
    mgmtToken = mgmtRes.body.accessToken;

    const rmRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'regmgr.north@arihant.com', password: 'password123' });
    rmToken = rmRes.body.accessToken;

    const salesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    salesToken = salesRes.body.accessToken;
    salesUserId = salesRes.body.user.id;

    const otherSalesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'demo@arihant.com', password: 'password123' });
    otherSalesToken = otherSalesRes.body.accessToken;
    otherSalesUserId = otherSalesRes.body.user.id;

    // 2. Fetch test organisations
    const orgs = await request(app.getHttpServer())
      .get('/api/organisations?limit=5')
      .set('Authorization', `Bearer ${salesToken}`);
    expect(orgs.body.data.length).toBeGreaterThanOrEqual(2);
    testOrg1Id = orgs.body.data[0].id;
    testOrg1Name = orgs.body.data[0].name;
    testOrg2Id = orgs.body.data[1].id;
    testOrg2Name = orgs.body.data[1].name;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // SCENARIO A: Normal Visit Lifecycle (Plan -> Manager View -> Post-Visit -> History & Activity)
  // =========================================================================
  describe('Scenario A: Normal Visit Lifecycle', () => {
    const plannedDate = new Date().toISOString().split('T')[0];

    it('sales executive plans a client field visit with full details', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          planned_date: plannedDate,
          start_time: '10:00',
          end_time: '11:30',
          location: 'New Delhi Police HQ',
          purpose: 'Quarterly review with procurement IG for explosive detectors',
          demo_required: true,
          travel_required: true,
          expected_outcome: 'Approval for MHA trial demonstration',
          remarks: 'Pre-meeting file sent to SP Provisioning',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('planned');
      expect(res.body.version).toBe(1);
      normalVisitId = res.body.id;
    });

    it('manager views upcoming field activity grouped by Today, Tomorrow, Next 7 Days, Later', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/visits/manager/field-activity')
        .set('Authorization', `Bearer ${rmToken}`);

      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.grouped).toBeDefined();
      expect(Array.isArray(res.body.grouped.today)).toBe(true);
      expect(Array.isArray(res.body.grouped.tomorrow)).toBe(true);
      expect(Array.isArray(res.body.grouped.next_7_days)).toBe(true);
      expect(Array.isArray(res.body.grouped.later)).toBe(true);

      const allFound = [
        ...res.body.grouped.today,
        ...res.body.grouped.tomorrow,
        ...res.body.grouped.next_7_days,
        ...res.body.grouped.later,
        ...res.body.grouped.past,
      ];
      const match = allFound.find((v: any) => v.id === normalVisitId);
      expect(match).toBeDefined();
      expect(match.organisation_id).toBe(testOrg1Id);
    });

    it('sales executive completes the visit and submits post-visit update', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${normalVisitId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: true,
          person_met: 'Dr. A.K. Sharma, DIG Procurement',
          discussion: 'Demonstrated HHMD specifications; reviewed technical tender requirements.',
          product_discussed: 'Hand Held Metal Detector as per MHA QR',
          outcome: 'Client satisfied with sensitivity parameters; requested field trial next week.',
          opportunity: 'High probability upcoming tender for 150 units',
          next_action: 'Coordinate depot demo unit dispatch',
          followup_date: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0],
          demo_required: true,
          tender_opportunity: 'Tender closing in October 2026',
        });

      expect(res.status).toBe(201);
      expect(res.body.met_completed).toBe(true);
      expect(res.body.person_met).toContain('Sharma');

      // Check visit status is now completed
      const checkVisit = await request(app.getHttpServer())
        .get(`/api/visits/${normalVisitId}`)
        .set('Authorization', `Bearer ${salesToken}`);
      expect(checkVisit.body.status).toBe('completed');
    });

    it('automatically updates Customer History with the completed visit', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/organisations/${testOrg1Id}/history`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const match = res.body.find((v: any) => v.id === normalVisitId);
      expect(match).toBeDefined();
      expect(match.status).toBe('completed');
      expect(match.person_met).toContain('Sharma');
    });

    it('automatically updates Employee Activity Dossier with the completed visit', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/employees/${salesUserId}/activities`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const match = res.body.find((a: any) => a.entity_id === normalVisitId);
      expect(match).toBeDefined();
      expect(match.status).toBe('completed');
      expect(match.title).toContain('Field Visit');
      expect(match.next_action).toContain('demo');
    });

    it('guarantees idempotency: duplicate post-visit submission does not create duplicate customer or activity rows', async () => {
      // Submit post-visit a second time
      const res2 = await request(app.getHttpServer())
        .post(`/api/visits/${normalVisitId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: true,
          person_met: 'Dr. A.K. Sharma, DIG Procurement',
          discussion: 'Updated notes from second submission',
          outcome: 'Trial confirmed',
        });
      expect(res2.status).toBe(201);

      // Verify customer timeline count for this visit is still exactly 1
      const histRes = await request(app.getHttpServer())
        .get(`/api/visits/organisations/${testOrg1Id}/history`)
        .set('Authorization', `Bearer ${salesToken}`);
      const matches = histRes.body.filter((v: any) => v.id === normalVisitId);
      expect(matches.length).toBe(1);

      // Verify employee activity count for this visit is still exactly 1
      const actRes = await request(app.getHttpServer())
        .get(`/api/visits/employees/${salesUserId}/activities`)
        .set('Authorization', `Bearer ${salesToken}`);
      const actMatches = actRes.body.filter((a: any) => a.entity_id === normalVisitId);
      expect(actMatches.length).toBe(1);
    });
  });

  // =========================================================================
  // SCENARIO B: Trips & Manager Optimization (Trip ├── Visit 1, Visit 2)
  // =========================================================================
  describe('Scenario B: Trips & Manager Optimization', () => {
    const tripDate = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];

    it('sales executive creates a new planned trip', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits/trips')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          trip_date: tripDate,
          base_location: 'Chandigarh Security Enclave',
          notes: 'Tour program for Punjab Police Headquarters & Wireless HQ',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.base_location).toBe('Chandigarh Security Enclave');
      tripId = res.body.id;
    });

    it('sales executive plans Visit 1 attached to the trip', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          trip_id: tripId,
          planned_date: tripDate,
          start_time: '10:00',
          end_time: '11:30',
          location: 'Chandigarh Security Enclave Sector 9',
          purpose: 'Wireless communications review',
        });

      expect(res.status).toBe(201);
      expect(res.body.trip_id).toBe(tripId);
    });

    it('Regional Manager adds Visit 2 to the same trip (optimising travel in same area)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/trips/${tripId}/visits`)
        .set('Authorization', `Bearer ${rmToken}`)
        .send({
          organisation_id: testOrg2Id,
          location: 'Chandigarh Sector 17 Procurement Cell',
          start_time: '14:00',
          end_time: '15:30',
          purpose: 'Introduce Crash-Rated Bollards before upcoming tender',
          instructions: 'While in Chandigarh, also meet SP Logistics regarding perimeter security requirement.',
          reason: 'Customer is in the same Chandigarh operational area',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.trip_id).toBe(tripId);
      expect(res.body.manager_assigned).toBe(true);
      expect(res.body.remarks).toContain('Manager Directive');
      expect(res.body.proximity).toBeDefined();
      managerAddedVisitId = res.body.id;
    });

    it('trip details show both visits (Trip ├── Visit 1, Visit 2)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/trips/${tripId}`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(200);
      expect(res.body.visits).toBeDefined();
      expect(res.body.visits.length).toBe(2);

      const managerVisit = res.body.visits.find((v: any) => v.id === managerAddedVisitId);
      expect(managerVisit).toBeDefined();
      expect(managerVisit.manager_assigned).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO C: Conflict & Proximity Detection
  // =========================================================================
  describe('Scenario C: Conflict & Proximity Detection', () => {
    const conflictDate = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];

    it('creates an initial visit from 10:00 to 11:30', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          planned_date: conflictDate,
          start_time: '10:00',
          end_time: '11:30',
          location: 'Delhi Central',
          purpose: 'Morning inspection',
        });
      expect(res.status).toBe(201);
    });

    it('strictly rejects overlapping visit on same date & time (409 Conflict)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg2Id,
          planned_date: conflictDate,
          start_time: '10:30',
          end_time: '12:00',
          location: 'Delhi North',
          purpose: 'Overlapping meeting attempt',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Time conflict');
    });

    it('strictly rejects duplicate organization scheduled on same day', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          planned_date: conflictDate,
          start_time: '15:00',
          end_time: '16:00',
          location: 'Delhi Central',
          purpose: 'Duplicate customer meeting on same date',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already has a visit scheduled');
    });
  });

  // =========================================================================
  // SCENARIO D: Rescheduling Workflow
  // =========================================================================
  describe('Scenario D: Rescheduling Workflow', () => {
    let visitToRescheduleId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          planned_date: new Date(Date.now() + 86400000 * 6).toISOString().split('T')[0],
          purpose: 'Pre-demonstration site readiness check',
        });
      visitToRescheduleId = res.body.id;
    });

    it('rejects reschedule without mandatory reason (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitToRescheduleId}/reschedule`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          new_date: new Date(Date.now() + 86400000 * 8).toISOString().split('T')[0],
          reason: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it('successfully reschedules visit with reason, records old date & updates status', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitToRescheduleId}/reschedule`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          new_date: new Date(Date.now() + 86400000 * 8).toISOString().split('T')[0],
          reason: 'Customer requested another date due to VIP visit.',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('rescheduled');
      expect(res.body.rescheduled_from).toBeDefined();
      expect(new Date(res.body.rescheduled_from).getFullYear()).toBe(2026);
      expect(res.body.change_reason).toContain('VIP visit');
    });

    it('strictly prevents rescheduling an already completed visit (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${normalVisitId}/reschedule`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          new_date: '2026-10-10',
          reason: 'Attempting to reschedule completed visit',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('completed visit cannot be rescheduled');
    });
  });

  // =========================================================================
  // SCENARIO E: Cancellation Workflow
  // =========================================================================
  describe('Scenario E: Cancellation Workflow', () => {
    let visitToCancelId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg2Id,
          planned_date: new Date().toISOString().split('T')[0],
          purpose: 'Demonstration of Passive Night Vision',
        });
      visitToCancelId = res.body.id;
    });

    it('rejects cancellation without mandatory reason (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitToCancelId}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          reason: '',
        });

      expect(res.status).toBe(400);
    });

    it('successfully cancels visit with reason and records status', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitToCancelId}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          reason: 'Field trial cancelled by Ministry due to inclement weather at firing range.',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.change_reason).toContain('inclement weather');
    });

    it('strictly prevents cancelling an already completed visit (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${normalVisitId}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          reason: 'Attempting to cancel completed visit',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('completed visit cannot be cancelled');
    });
  });

  // =========================================================================
  // SCENARIO F: Destination Change & Significant Modifications
  // =========================================================================
  describe('Scenario F: Destination Change & Modifications', () => {
    let visitToModifyId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          planned_date: new Date(Date.now() + 86400000 * 14).toISOString().split('T')[0],
          location: 'Delhi Central Base',
          purpose: 'Service review',
        });
      expect(res.status).toBe(201);
      visitToModifyId = res.body.id;
    });

    it('requires reason when changing destination', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitToModifyId}/destination`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          new_location: 'Delhi Frontier Testing Grounds',
          reason: 'Venue changed to live testing range by DIG Technical.',
        });

      expect(res.status).toBe(201);
      expect(res.body.location).toBe('Delhi Frontier Testing Grounds');
      expect(res.body.status).toBe('modified');
      expect(res.body.change_reason).toContain('live testing range');
    });
  });

  // =========================================================================
  // SCENARIO G: Post-Visit Negative Validations
  // =========================================================================
  describe('Scenario G: Post-Visit Negative Validations', () => {
    let visitForValidationId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg2Id,
          planned_date: new Date(Date.now() + 86400000 * 10).toISOString().split('T')[0],
          purpose: 'Validation test meeting',
        });
      visitForValidationId = res.body.id;
    });

    it('rejects completed visit update if person_met is missing', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitForValidationId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: true,
          person_met: '',
          discussion: 'Valid discussion notes',
          outcome: 'Valid outcome',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Person met is required');
    });

    it('rejects completed visit update if discussion is missing', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitForValidationId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: true,
          person_met: 'Shri Rajesh',
          discussion: '',
          outcome: 'Valid outcome',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Discussion summary is required');
    });

    it('rejects follow-up date earlier than visit date', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitForValidationId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: true,
          person_met: 'Shri Rajesh',
          discussion: 'Valid discussion',
          outcome: 'Valid outcome',
          next_action: 'Follow-up meeting',
          followup_date: '2026-09-20', // Earlier than visit date 2026-09-26
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Follow-up date cannot be earlier');
    });

    it('records meeting as not_completed when reason is provided', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${visitForValidationId}/update`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          met_completed: false,
          remarks: 'Customer officer was urgently summoned for border patrol duty.',
        });

      expect(res.status).toBe(201);
      expect(res.body.met_completed).toBe(false);

      const check = await request(app.getHttpServer())
        .get(`/api/visits/${visitForValidationId}`)
        .set('Authorization', `Bearer ${salesToken}`);
      expect(check.body.status).toBe('not_completed');
    });
  });

  // =========================================================================
  // SCENARIO H: RBAC & Optimistic Concurrency
  // =========================================================================
  describe('Scenario H: RBAC & Optimistic Concurrency', () => {
    let rbacVisitId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrg1Id,
          planned_date: new Date(Date.now() + 86400000 * 12).toISOString().split('T')[0],
          purpose: 'RBAC boundary validation',
        });
      rbacVisitId = res.body.id;
    });

    it('denies other sales executive from modifying another employee visit (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/visits/${rbacVisitId}/cancel`)
        .set('Authorization', `Bearer ${otherSalesToken}`)
        .send({
          reason: 'Malicious cancellation attempt',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not authorized to modify');
    });

    it('denies sales executive from viewing another employee private activity dossier (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/employees/${otherSalesUserId}/activities`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('cannot access other employees');
    });

    it('detects concurrent modification when version is stale (409 Conflict)', async () => {
      // Current version is 1
      const res = await request(app.getHttpServer())
        .patch(`/api/visits/${rbacVisitId}`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          version: 999, // Stale version
          location: 'New Location Attempt',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('concurrently');
    });
  });

  // =========================================================================
  // SCENARIO I: Immutable Visit Audit Trail
  // =========================================================================
  describe('Scenario I: Immutable Visit Audit Trail', () => {
    it('retrieves complete audit trail for a visit', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/${normalVisitId}/audit`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const actions = res.body.map((a: any) => a.action);
      expect(actions).toContain('CREATE_VISIT');
    });
  });
});
