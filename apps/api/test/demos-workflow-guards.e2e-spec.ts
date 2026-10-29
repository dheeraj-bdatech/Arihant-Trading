import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { istDay } from './helpers/ist-date';
import { configureApp } from '../src/common/app-setup';
import { sql } from 'kysely';

const DEMO_PURPOSE = 'Workflow guard e2e';

/**
 * Module 3 workflow guards (QA 27 Oct 2026): each scenario is a hole found in a QA walk-through.
 *  1. approving a kit request must not skip management approval
 *  2. an outcome needs a confirmed demo
 *  3. a completed demo's outcome is locked
 *  4. the duplicate-submit guard matches the product and never returns a cancelled demo
 *  5. a cancelled demo cannot be cancelled again
 * Self-contained: two dedicated kit units, and "today" demos raised by Management so the 60 s duplicate window
 * never meets demos the other suites raise as Sales.
 */
describe('Module 3: Demo workflow guards (E2E)', () => {
  let app: INestApplication;
  let db: any;
  let mgmtToken: string;
  let salesToken: string;
  let demoTeamToken: string;

  let orgId: string;
  let productId: string;
  let otherProductId: string;
  let unitA: string;
  let unitB: string;

  const api = () => request(app.getHttpServer());
  const status = async (id: string) =>
    (await db.selectFrom('demos').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

  async function login(email: string) {
    const res = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  async function newDemo(token: string, body: Record<string, unknown>) {
    const res = await api()
      .post('/api/demos')
      .set('Authorization', `Bearer ${token}`)
      .send({ organisation_id: orgId, location: 'Delhi', purpose: DEMO_PURPOSE, ...body });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** A dedicated unit of the test product, free of earlier runs' bookings. */
  async function dedicatedUnit(serial: string) {
    const found = await db.selectFrom('demo_equipment').select('id').where('serial_no', '=', serial).executeTakeFirst();
    const id =
      found?.id ??
      (
        await db
          .insertInto('demo_equipment')
          .values({ product_id: productId, model: 'GUARD-E2E', serial_no: serial, current_location: 'Delhi', availability_status: 'available', condition: 'Operational' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    await db.deleteFrom('demo_reservations').where('equipment_id', '=', id).execute();
    await db.updateTable('demo_equipment').set({ product_id: productId, availability_status: 'available' }).where('id', '=', id).execute();
    return id as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();
    db = app.get(KYSELY_DB);

    mgmtToken = await login('mgmt@arihant.com');
    salesToken = await login('sales.delhi@arihant.com');
    demoTeamToken = await login('demo@arihant.com');

    // An earlier run of this suite within the last minute would answer the 60 s duplicate guard: age its demos out
    await db
      .updateTable('demos')
      .set({ created_at: sql`created_at - interval '2 minutes'` })
      .where('purpose', '=', DEMO_PURPOSE)
      .where('created_at', '>', sql`now() - interval '2 minutes'`)
      .execute();

    orgId = (await db.selectFrom('organisations').select('id').orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow()).id;
    const products = await db.selectFrom('products').select('id').orderBy('name').limit(2).execute();
    productId = products[0].id;
    otherProductId = products[1].id;
    unitA = await dedicatedUnit('SN-GUARDS-E2E-A');
    unitB = await dedicatedUnit('SN-GUARDS-E2E-B');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Approving a kit request does not skip management approval', () => {
    it('a Sales kit request approved by the custodian leaves an unapproved demo Requested, and it cannot be confirmed', async () => {
      const date = istDay(25);
      const demo = await newDemo(salesToken, { product_id: productId, requested_date: date });

      const req = await api()
        .post(`/api/demos/${demo.id}/reserve-equipment`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ equipment_id: unitA, reserved_from: date, reserved_to: date });
      expect(req.status).toBe(201);
      expect(req.body.status).toBe('requested');

      const approve = await api().post(`/api/demos/reservations/${req.body.id}/approve`).set('Authorization', `Bearer ${demoTeamToken}`).send({});
      expect(approve.status).toBe(201);
      expect(await status(demo.id)).toBe('requested');

      const confirm = await api().post(`/api/demos/${demo.id}/confirm`).set('Authorization', `Bearer ${demoTeamToken}`).send({ confirmed_date: date });
      expect(confirm.status).toBe(400);
      expect(await status(demo.id)).toBe('requested');
    });

    it('allocating another unit to a request also leaves an unapproved demo Requested', async () => {
      const date = istDay(26);
      const demo = await newDemo(salesToken, { product_id: productId, requested_date: date });
      const req = await api()
        .post(`/api/demos/${demo.id}/reserve-equipment`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ equipment_id: unitA, reserved_from: date, reserved_to: date });
      expect(req.status).toBe(201);

      const allocate = await api()
        .post(`/api/demos/reservations/${req.body.id}/allocate`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ equipment_id: unitB, reason: 'Unit A due for calibration' });
      expect(allocate.status).toBe(201);
      expect(await status(demo.id)).toBe('requested');
    });

    it('once management has approved, an approved kit request moves the demo to Equipment Reserved', async () => {
      const date = istDay(27);
      const demo = await newDemo(salesToken, { product_id: productId, requested_date: date });
      expect((await api().post(`/api/demos/${demo.id}/start-planning`).set('Authorization', `Bearer ${mgmtToken}`)).status).toBe(201);

      const req = await api()
        .post(`/api/demos/${demo.id}/reserve-equipment`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ equipment_id: unitA, reserved_from: date, reserved_to: date });
      expect(req.status).toBe(201);
      const approve = await api().post(`/api/demos/reservations/${req.body.id}/approve`).set('Authorization', `Bearer ${demoTeamToken}`).send({});
      expect(approve.status).toBe(201);
      expect(await status(demo.id)).toBe('equipment_reserved');
    });
  });

  describe('2. An outcome needs a confirmed demo', () => {
    let demoId: string;

    beforeAll(async () => {
      demoId = (await newDemo(mgmtToken, { requested_date: istDay(0) })).id;
    });

    it('is refused while the demo still waits for management approval', async () => {
      const res = await api()
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ result: 'success', customer_response: 'Liked it', technical_performance: 'Fine' });
      expect([400, 404]).toContain(res.status); // 404 when Sales may not see a demo Management raised
      const asTeam = await api()
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ result: 'success', customer_response: 'Liked it', technical_performance: 'Fine' });
      expect(asTeam.status).toBe(400);
      expect(asTeam.body.code).toBe('DEMO_NOT_CONFIRMED');
      expect(await status(demoId)).toBe('requested');
      const outcomes = await db.selectFrom('demo_outcomes').select('id').where('demo_id', '=', demoId).execute();
      expect(outcomes).toHaveLength(0);
    });

    it('is refused after approval until the date is confirmed', async () => {
      expect((await api().post(`/api/demos/${demoId}/start-planning`).set('Authorization', `Bearer ${mgmtToken}`)).status).toBe(201);
      const res = await api()
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ result: 'success', customer_response: 'Liked it', technical_performance: 'Fine' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('DEMO_NOT_CONFIRMED');
      expect(await status(demoId)).toBe('under_planning');
    });

    it('is recorded once the date is confirmed', async () => {
      const confirm = await api().post(`/api/demos/${demoId}/confirm`).set('Authorization', `Bearer ${demoTeamToken}`).send({ confirmed_date: istDay(0) });
      expect(confirm.status).toBe(201);
      const res = await api()
        .post(`/api/demos/${demoId}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ result: 'success', customer_response: 'Liked it', technical_performance: 'Fine' });
      expect(res.status).toBe(201);
      expect(await status(demoId)).toBe('completed');
    });
  });

  describe('3. A completed demo\'s outcome is locked', () => {
    it('a second outcome is refused and the first one stands', async () => {
      const demo = await newDemo(mgmtToken, { product_id: otherProductId, requested_date: istDay(0) });
      expect((await api().post(`/api/demos/${demo.id}/start-planning`).set('Authorization', `Bearer ${mgmtToken}`)).status).toBe(201);
      expect(
        (await api().post(`/api/demos/${demo.id}/confirm`).set('Authorization', `Bearer ${demoTeamToken}`).send({ confirmed_date: istDay(0) })).status,
      ).toBe(201);
      const first = await api()
        .post(`/api/demos/${demo.id}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ result: 'success', customer_response: 'Order likely', technical_performance: 'All readings in spec' });
      expect(first.status).toBe(201);

      const second = await api()
        .post(`/api/demos/${demo.id}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ result: 'fail', failure_reason: 'PRICING_CONCERN', remarks: 'Overwrite attempt' });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('OUTCOME_LOCKED');

      const outcome = await db.selectFrom('demo_outcomes').select(['result', 'failure_reason']).where('demo_id', '=', demo.id).executeTakeFirstOrThrow();
      expect(outcome).toEqual({ result: 'success', failure_reason: null });
    });
  });

  describe('4. The duplicate-submit guard', () => {
    const date = istDay(28);

    it('still returns the same demo for a genuine retry (same customer, day and product)', async () => {
      const a = await newDemo(salesToken, { product_id: productId, requested_date: date });
      const retry = await newDemo(salesToken, { product_id: productId, requested_date: date });
      expect(retry.id).toBe(a.id);
    });

    it('creates a second demo for another product on the same customer and day', async () => {
      const other = await newDemo(salesToken, { product_id: otherProductId, requested_date: date });
      const first = await db
        .selectFrom('demos')
        .select('id')
        .where('organisation_id', '=', orgId)
        .where('requested_date', '=', date)
        .where('product_id', '=', productId)
        .executeTakeFirstOrThrow();
      expect(other.id).not.toBe(first.id);
      expect(other.product_id).toBe(otherProductId);
    });

    it('never hands back a cancelled demo: a new request after a cancel is a new demo', async () => {
      const cancelDate = istDay(29);
      const original = await newDemo(salesToken, { product_id: productId, requested_date: cancelDate });
      const cancel = await api()
        .post(`/api/demos/${original.id}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ cancellation_reason: 'customer_cancelled', remarks: 'Wrong date' });
      expect(cancel.status).toBe(201);

      const again = await newDemo(salesToken, { product_id: productId, requested_date: cancelDate });
      expect(again.id).not.toBe(original.id);
      expect(again.status).toBe('requested');
    });
  });

  describe('5. A cancelled demo cannot be cancelled again', () => {
    it('the second cancel is refused and the first reason stands', async () => {
      const demo = await newDemo(salesToken, { product_id: productId, requested_date: istDay(30) });
      const first = await api()
        .post(`/api/demos/${demo.id}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ cancellation_reason: 'customer_cancelled', remarks: 'Customer postponed' });
      expect(first.status).toBe(201);

      const second = await api()
        .post(`/api/demos/${demo.id}/cancel`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ cancellation_reason: 'other', remarks: 'Second cancel' });
      expect(second.status).toBe(400);
      expect(second.body.message).toContain('already cancelled');

      const row = await db.selectFrom('demos').select(['status', 'cancellation_reason']).where('id', '=', demo.id).executeTakeFirstOrThrow();
      expect(row).toEqual({ status: 'cancelled', cancellation_reason: 'customer_cancelled' });
    });
  });

  describe('6. Dates, approval and outcome hygiene (QA 28 Oct 2026)', () => {
    it('a request still waiting for management approval cannot be rescheduled into the confirmation queue', async () => {
      const demo = await newDemo(salesToken, { product_id: otherProductId, requested_date: istDay(31) });
      const res = await api()
        .post(`/api/demos/${demo.id}/reschedule`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ new_date: istDay(32), reason: 'Client asked for another day' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('DEMO_NOT_APPROVED');
      expect(await status(demo.id)).toBe('requested');
    });

    it('a date sent back as a serialized instant is stored as its IST calendar day', async () => {
      const day = istDay(33);
      const demo = await newDemo(mgmtToken, { product_id: otherProductId, requested_date: day });
      expect((await api().post(`/api/demos/${demo.id}/start-planning`).set('Authorization', `Bearer ${mgmtToken}`)).status).toBe(201);
      // IST midnight of `day` as JSON serializes it: the previous UTC day at 18:30
      const instant = new Date(`${day}T00:00:00+05:30`).toISOString();
      const confirm = await api().post(`/api/demos/${demo.id}/confirm`).set('Authorization', `Bearer ${demoTeamToken}`).send({ confirmed_date: instant });
      expect(confirm.status).toBe(201);
      const row = await db.selectFrom('demos').select(sql<string>`confirmed_date::text`.as('d')).where('id', '=', demo.id).executeTakeFirstOrThrow();
      expect(row.d).toBe(day);
    });

    it('a successful outcome never carries a failure reason into the customer timeline', async () => {
      // productId: sections 2 and 3 already hold Management's "today" demos without a product / of otherProductId
      const demo = await newDemo(mgmtToken, { product_id: productId, requested_date: istDay(0) });
      expect((await api().post(`/api/demos/${demo.id}/start-planning`).set('Authorization', `Bearer ${mgmtToken}`)).status).toBe(201);
      expect((await api().post(`/api/demos/${demo.id}/confirm`).set('Authorization', `Bearer ${demoTeamToken}`).send({ confirmed_date: istDay(0) })).status).toBe(201);
      const res = await api()
        .post(`/api/demos/${demo.id}/outcome`)
        .set('Authorization', `Bearer ${demoTeamToken}`)
        .send({ result: 'success', failure_reason: 'TECHNICAL_FAILURE', customer_response: 'Order likely' });
      expect(res.status).toBe(201);
      expect(res.body.failure_reason).toBeNull();
      const interaction = await db.selectFrom('interactions').select('remarks').where('demo_id', '=', demo.id).executeTakeFirstOrThrow();
      expect(interaction.remarks).not.toContain('Failure');
    });
  });
});
