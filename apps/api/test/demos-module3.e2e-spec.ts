import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { purgeTaskModule } from './helpers/reset-tasks';
import { istDay } from './helpers/ist-date';
import { configureApp } from '../src/common/app-setup';

describe('Module 3: Demo Management E2E Test Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let rmToken: string;
  let salesToken: string;
  let demoTeamToken: string;
  let otherSalesToken: string;

  let salesUserId: string;
  let demoTeamUserId: string;

  let testOrgId: string;
  let testOrgId2: string;
  let testProductId: string;
  let testEquipId1: string;
  let testEquipId2: string;
  let otherProductEquipId: string | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();

    // 1. Authenticate users with different RBAC roles
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

    const demoTeamRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'demo@arihant.com', password: 'password123' });
    expect(demoTeamRes.status).toBe(200);
    demoTeamToken = demoTeamRes.body.accessToken;
    demoTeamUserId = demoTeamRes.body.user?.id;
    console.log('LOGGED IN DEMO USER ID:', demoTeamUserId, 'STATUS:', demoTeamRes.status);

    // 2. Database cleanup to make test completely idempotent across runs
    const db = app.get(KYSELY_DB);
    await db.deleteFrom('demo_reschedule_history').execute();
    await db.deleteFrom('demo_outcomes').execute();
    // Module 8 tasks can reference demos: clear task data before wiping demos.
    await purgeTaskModule(db);
    await db.deleteFrom('demo_reservations').execute();
    await db.deleteFrom('demos').execute();
    await db.deleteFrom('interactions').where('type', '=', 'demo').execute();
    await db.deleteFrom('visits').where('planned_date', '>=', '2026-11-01').execute();
    await db.updateTable('demo_equipment').set({ availability_status: 'available' }).execute();

    // 3. Fetch test master data
    const orgs = await request(app.getHttpServer())
      .get('/api/organisations?limit=5')
      .set('Authorization', `Bearer ${salesToken}`);
    testOrgId = orgs.body.data[0].id;
    testOrgId2 = orgs.body.data[1]?.id || testOrgId;

    const prods = await request(app.getHttpServer())
      .get('/api/masters/products')
      .set('Authorization', `Bearer ${salesToken}`);
    testProductId = prods.body[0].id;

    const equip = await request(app.getHttpServer())
      .get('/api/demos/equipment')
      .set('Authorization', `Bearer ${demoTeamToken}`);
    expect(equip.body.length).toBeGreaterThanOrEqual(2);
    testEquipId1 = equip.body[0].id;
    testEquipId2 = equip.body[1].id;
    // The Scenario 1 demo is for the product of the unit it reserves: a unit of another product needs a
    // substitute reason (QA DEF-022).
    testProductId = equip.body[0].product_id || testProductId;
    otherProductEquipId = equip.body.find((e: any) => e.product_id && e.product_id !== testProductId)?.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // SCENARIO 1: Full Normal Demo Lifecycle (§1, §4, §5, §9, §14, §17, §20)
  // =========================================================================
  describe('Scenario 1: Normal Demo Lifecycle', () => {
    let demoId: string;
    let demoNo: string;
    // The trial runs today (IST): its outcome may only be recorded on/after the demo day (QA DEF-024), and
    // requested / confirmed dates may not be in the past (DEF-046).
    const requestedDate = istDay(0);
    const confirmedDate = istDay(0);

    it('Salesperson creates a demo request (§1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          location: 'CRPF Group Centre, Delhi',
          requested_date: requestedDate,
          purpose: 'Technical trial of multi-zone door frame metal detector',
          expected_audience: 'IG Technical & Board of Officers',
          equipment_required: '1x DFMD unit with test targets',
          special_requirements: 'Outdoor weather testing setup',
          remarks: 'High value tender requirement',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      demoId = res.body.id;
      demoNo = res.body.demo_no;

      expect(res.body.demo_no).toMatch(/^DEM-/);
      expect(res.body.status).toBe('requested');
      expect(res.body.requested_date).toBeDefined();
    });

    it('Coordinator reviews demo request (§4)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/demos/${demoId}`)
        .set('Authorization', `Bearer ${demoTeamToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(demoId);
      expect(res.body.demo_no).toBe(demoNo);
      expect(res.body.organisation_id).toBe(testOrgId);
      expect(res.body.requested_by).toBe(salesUserId);
    });

    it('Only management approves a new demo request', async () => {
      const denied = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/start-planning`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({});
      expect(denied.status).toBe(403);

      const early = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/confirm`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ confirmed_date: confirmedDate });
      expect(early.status).toBe(400);

      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/start-planning`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('under_planning');
    });

    it('Coordinator checks team availability on requested date (§5)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/demos/team/availability?date=${requestedDate}`)
        .set('Authorization', `Bearer ${demoTeamToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const specialist = res.body.find((m: any) => m.id === demoTeamUserId);
      expect(specialist).toBeDefined();
      expect(specialist.is_available).toBe(true);
    });

    it('Coordinator assigns demo team member with travel requirements (§5 & §12)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/assign-team`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          assigned_to: demoTeamUserId,
          confirmed_date: confirmedDate,
          travel_required: true,
          travel_from: 'Delhi HQ',
          travel_to: 'CRPF Group Centre, Delhi',
          travel_date: confirmedDate,
          travel_remarks: 'Local conveyance vehicle arranged',
          remarks: 'Briefing scheduled at 09:30 AM',
        });

      if (res.status !== 201) {
        console.log('SCENARIO 1 ASSIGN TEAM ERR:', JSON.stringify(res.body, null, 2));
      }
      expect(res.status).toBe(201);
      expect(res.body.assigned_to).toBe(demoTeamUserId);
      expect(res.body.travel_required).toBe(true);
      expect(res.body.confirmed_date).toBeDefined();
    });

    it('Coordinator checks live equipment availability across depots (§8)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/demos/equipment/availability?from_date=${confirmedDate}&to_date=${confirmedDate}`)
        .set('Authorization', `Bearer ${demoTeamToken}`);

      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.total).toBeGreaterThanOrEqual(2);
      expect(res.body.summary.available).toBeGreaterThanOrEqual(1);
    });

    it('Coordinator reserves physical equipment unit (§9 & §10)', async () => {
      if (otherProductEquipId) {
        // a unit of a different product is refused unless a substitute reason is given
        const wrong = await request(app.getHttpServer())
          .post(`/api/demos/${demoId}/reserve`)
          .set('Authorization', `Bearer ${demoTeamToken}`)
          .send({ equipment_id: otherProductEquipId, reserved_from: confirmedDate, reserved_to: confirmedDate });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe('PRODUCT_MISMATCH');
      }

      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/reserve`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          equipment_id: testEquipId1,
          reserved_from: confirmedDate,
          reserved_to: confirmedDate,
          remarks: 'Pre-calibrated unit reserved',
        });

      expect(res.status).toBe(201);
      expect(res.body.equipment_id).toBe(testEquipId1);
      expect(res.body.status).toBe('approved');
    });

    it('Coordinator confirms trial date (§14)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/confirm`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          confirmed_date: confirmedDate,
          remarks: 'Formal confirmation issued to client',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.confirmed_date).toBeDefined();
    });

    it('Demo Specialist records successful trial outcome (§17 & §20)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          completed: true,
          result: 'success',
          customer_response: 'Excellent feedback; committee satisfied',
          technical_performance: 'Zero false alarms on 100 test runs',
          product_suitability: 'Fully compliant with tender specs',
          decision_maker_present: true,
          competitor_involved: 'Smiths Detection',
          next_step: 'Commercial quotation submission',
          opportunity_stage: 'Proposal',
          remarks: 'Trial certificate signed by DIG Technical',
        });

      expect(res.status).toBe(201);
      expect(res.body.result).toBe('success');
      expect(res.body.completed).toBe(true);

      // Verify demo status is now completed
      const checkDemo = await request(app.getHttpServer())
        .get(`/api/demos/${demoId}`)
        .set('Authorization', `Bearer ${salesToken}`);
      expect(checkDemo.body.status).toBe('completed');

      // Verify reserved equipment availability returned to 'available'
      const checkEquip = await request(app.getHttpServer())
        .get(`/api/demos/equipment/${testEquipId1}`)
        .set('Authorization', `Bearer ${demoTeamToken}`);
      expect(checkEquip.body.availability_status).toBe('available');
    });

    it('Customer timeline contains interaction record with demo_id (§20)', async () => {
      const db = app.get(KYSELY_DB);
      const interaction = await db
        .selectFrom('interactions')
        .where('demo_id', '=', demoId)
        .selectAll()
        .executeTakeFirst();

      expect(interaction).toBeDefined();
      expect(interaction?.type).toBe('demo');
      expect(interaction?.organisation_id).toBe(testOrgId);
      expect(interaction?.outcome).toBe('Excellent feedback; committee satisfied');
    });

    it('Audit trail records all lifecycle transitions (§23)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/demos/${demoId}/audit`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audit_logs).toBeDefined();
      const actions = res.body.audit_logs.map((l: any) => l.action);
      expect(actions).toContain('DEMO_CREATED');
      expect(actions).toContain('TEAM_MEMBER_ASSIGNED');
      expect(actions).toContain('EQUIPMENT_RESERVED');
      expect(actions).toContain('DEMO_CONFIRMED');
      expect(actions).toContain('DEMO_COMPLETED');
    });
  });

  // =========================================================================
  // SCENARIO 2: Double Equipment Booking Prevention (§10)
  // =========================================================================
  describe('Scenario 2: Double Equipment Booking Prevention (§10)', () => {
    let demoAId: string;
    let demoBId: string;
    const overlapFrom = '2026-11-20';
    const overlapTo = '2026-11-22';

    beforeAll(async () => {
      // Create Demo A
      const resA = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          requested_date: overlapFrom,
          location: 'Delhi',
          purpose: 'Demo A booking',
        });
      demoAId = resA.body.id;

      // Create Demo B
      const resB = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          requested_date: '2026-11-21',
          location: 'Delhi',
          purpose: 'Demo B booking',
        });
      demoBId = resB.body.id;
    });

    it('Demo A successfully reserves test equipment unit', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoAId}/reserve`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          equipment_id: testEquipId2,
          reserved_from: overlapFrom,
          reserved_to: overlapTo,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('approved');
    });

    it('Demo B attempting to reserve same equipment for overlapping dates is REJECTED with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoBId}/reserve`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          equipment_id: testEquipId2,
          reserved_from: '2026-11-21',
          reserved_to: '2026-11-23',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already reserved');
    });

    it('Demo B can reserve the same equipment for non-overlapping dates', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoBId}/reserve`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          equipment_id: testEquipId2,
          reserved_from: '2026-11-25',
          reserved_to: '2026-11-26',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('approved');
    });
  });

  // =========================================================================
  // SCENARIO 3: Team Member Conflict Prevention (§11)
  // =========================================================================
  describe('Scenario 3: Team Member Conflict Prevention (§11)', () => {
    let demo1Id: string;
    let demo2Id: string;
    const testDate = '2026-12-05';

    beforeAll(async () => {
      const d1 = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          requested_date: '2026-12-05',
          location: 'Delhi Depot',
          purpose: 'First trial',
        });
      demo1Id = d1.body.id;

      const d2 = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId2,
          requested_date: '2026-12-06',
          location: 'Patna Depot',
          purpose: 'Conflicting trial',
        });
      demo2Id = d2.body.id;
    });

    it('Assigning Specialist to Demo 1 succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demo1Id}/assign-team`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          assigned_to: demoTeamUserId,
          confirmed_date: testDate,
        });

      if (res.status !== 201) {
        console.log('ASSIGN TEAM ERROR BODY:', JSON.stringify(res.body, null, 2));
      }
      expect(res.status).toBe(201);
      expect(res.body.assigned_to).toBe(demoTeamUserId);
    });

    it('Assigning same Specialist to Demo 2 on same date is REJECTED with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demo2Id}/assign-team`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          assigned_to: demoTeamUserId,
          confirmed_date: testDate,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already assigned');
    });
  });

  // =========================================================================
  // SCENARIO 4: Rescheduling & Cancellation Workflows (§15 & §16)
  // =========================================================================
  describe('Scenario 4: Rescheduling & Cancellation Workflows', () => {
    let demoId: string;
    const initialDate = '2026-12-15';
    const newDate = '2026-12-18';

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          requested_date: initialDate,
          location: 'Delhi',
          purpose: 'Reschedule test demo',
        });
      demoId = res.body.id;

      await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/assign-team`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ assigned_to: demoTeamUserId, confirmed_date: initialDate });

      await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/reserve`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          equipment_id: testEquipId1,
          reserved_from: initialDate,
          reserved_to: initialDate,
        });
    });

    it('Rescheduling requires reason and updates reservation dates (§16)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/reschedule`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          new_date: newDate,
          reason: 'Client requested postponement due to audit committee visit',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('rescheduled');
      expect(res.body.confirmed_date).toBeDefined();
      expect(res.body.rescheduled_from).toBeDefined();

      // Verify reschedule history
      const audit = await request(app.getHttpServer())
        .get(`/api/demos/${demoId}/audit`)
        .set('Authorization', `Bearer ${demoTeamToken}`);
      expect(audit.body.reschedule_events.length).toBeGreaterThanOrEqual(1);
      expect(audit.body.reschedule_events[0].new_date).toBeDefined();
    });

    it('Cancelling demo releases equipment reservation back to available (§15)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/cancel`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          cancellation_reason: 'customer_cancelled',
          remarks: 'Tender cancelled by department',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.cancellation_reason).toBe('customer_cancelled');

      // Check equipment unit returned to available
      const equip = await request(app.getHttpServer())
        .get(`/api/demos/equipment/${testEquipId1}`)
        .set('Authorization', `Bearer ${demoTeamToken}`);
      expect(equip.body.availability_status).toBe('available');
    });

    it('Submitting outcome for a cancelled demo is rejected', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          result: 'success',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cancelled');
    });
  });

  // =========================================================================
  // SCENARIO 5: Failed Demo & Structured Failure Analysis (§18)
  // =========================================================================
  describe('Scenario 5: Structured Failure Analysis (§18)', () => {
    let demoId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          requested_date: istDay(0), // the trial day has come: outcomes are recorded on/after it
          location: 'Delhi',
          purpose: 'Failure analysis test demo',
        });
      demoId = res.body.id;
      // An outcome needs a confirmed demo: management approves, the demo team confirms the date
      await request(app.getHttpServer()).post(`/api/demos/${demoId}/start-planning`).set('Authorization', `Bearer ${mgmtToken}`);
      await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/confirm`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ confirmed_date: istDay(0) });
    });

    it('Submitting failed demo without failure_reason is REJECTED with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          completed: true,
          result: 'fail',
          remarks: 'Failed without reason',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('failure reason is required');
    });

    it('Submitting failed demo with structured failure_reason succeeds and updates analytics', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({
          completed: true,
          result: 'fail',
          failure_reason: 'TECHNICAL_FAILURE',
          customer_response: 'Negative; target rod detection sensitivity degraded',
          technical_performance: 'Sub-optimal calibration under high EMI environment',
          product_suitability: 'Requires hardware filter update',
          decision_maker_present: true,
          remarks: 'Device repeatedly rebooted under heavy RF load',
        });

      expect(res.status).toBe(201);
      expect(res.body.result).toBe('fail');
      expect(res.body.failure_reason).toBe('TECHNICAL_FAILURE');

      // Verify analytics reflects the failure reason
      const analytics = await request(app.getHttpServer())
        .get('/api/demos/analytics')
        .set('Authorization', `Bearer ${mgmtToken}`);
      expect(analytics.status).toBe(200);
      expect(analytics.body.overview.unsuccessful).toBeGreaterThanOrEqual(1);
      const techFail = analytics.body.failure_analysis.find(
        (f: any) => f.reason === 'TECHNICAL_FAILURE',
      );
      expect(techFail).toBeDefined();
      expect(techFail.count).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // SCENARIO 6: Module 2 Visit Integration (§13)
  // =========================================================================
  describe('Scenario 6: Module 2 Visit Integration (§13)', () => {
    let visitId: string;
    let demoId: string;
    let demoNo: string;

    it('Salesperson plans a field visit with demo_required = true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          planned_date: '2026-12-28',
          start_time: '10:00',
          end_time: '11:30',
          location: 'Delhi Police HQ',
          purpose: 'Procurement demonstration discussion',
          demo_required: true,
          expected_outcome: 'Schedule field trial',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.demo_required).toBe(true);
      visitId = res.body.id;
    });

    it('Salesperson creates demo request linked to the visit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          visit_id: visitId,
          requested_date: '2026-12-28',
          location: 'Delhi Police HQ',
          purpose: 'Live DFMD trial linked to field visit',
        });

      expect(res.status).toBe(201);
      expect(res.body.visit_id).toBe(visitId);
      demoId = res.body.id;
      demoNo = res.body.demo_no;
    });

    it('Querying visit findOne returns linked_demo details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/visits/${visitId}`)
        .set('Authorization', `Bearer ${salesToken}`);

      expect(res.status).toBe(200);
      expect(res.body.linked_demo).toBeDefined();
      expect(res.body.linked_demo.id).toBe(demoId);
      expect(res.body.linked_demo.demo_no).toBe(demoNo);
    });
  });

  // =========================================================================
  // SCENARIO 7: RBAC Security Testing (§24 & §31)
  // =========================================================================
  describe('Scenario 7: RBAC Security Testing (§24)', () => {
    let demoId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/demos')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          organisation_id: testOrgId,
          requested_date: '2026-12-30',
          location: 'Delhi',
          purpose: 'RBAC test demo',
        });
      demoId = res.body.id;
    });

    it('Salesperson is FORBIDDEN from assigning team member directly (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/assign-team`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          assigned_to: demoTeamUserId,
        });

      expect(res.status).toBe(403);
    });

    // §16: a salesperson *requests* a unit; it is not booked until the custodian / coordinator approves it.
    it('Salesperson can only REQUEST equipment — the reservation is pending, not approved', async () => {
      const avail = await request(app.getHttpServer())
        .get('/api/demos/equipment/availability')
        .query({ from_date: '2026-12-30', to_date: '2026-12-30' })
        .set('Authorization', `Bearer ${salesToken}`);
      const unit = avail.body.units.find((u: any) => u.is_available_for_dates);
      expect(unit).toBeDefined();

      const res = await request(app.getHttpServer())
        .post(`/api/demos/${demoId}/reserve`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          equipment_id: unit.id,
          reserved_from: '2026-12-30',
          reserved_to: '2026-12-30',
          product_mismatch_reason: 'RBAC test: any available unit',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('requested');
      expect(res.body.approved_by).toBeNull();

      const unitAfter = await request(app.getHttpServer())
        .get(`/api/demos/equipment/${unit.id}`)
        .set('Authorization', `Bearer ${salesToken}`);
      expect(unitAfter.body.availability_status).not.toBe('reserved');
    });

    it('Unauthenticated requests are rejected with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer()).get('/api/demos');
      expect(res.status).toBe(401);
    });
  });
  describe('Malformed ids', () => {
    it('a non-UUID demo / reservation / equipment id is a clean 404, never a 500', async () => {
      const auth = { Authorization: `Bearer ${demoTeamToken}` };
      const api = () => request(app.getHttpServer());
      const calls = [
        () => api().post('/api/demos/undefined/reserve').set(auth).send({ equipment_id: testEquipId1 }),
        () => api().get('/api/demos/not-a-uuid').set(auth),
        () => api().post('/api/demos/123/outcome').set(auth).send({ result: 'success' }),
        () => api().post('/api/demos/reservations/undefined/approve').set(auth).send({}),
        () => api().get('/api/demos/equipment/undefined').set(auth),
      ];
      for (const call of calls) {
        const res = await call();
        expect(res.status).toBe(404);
      }
    });
  });
});
