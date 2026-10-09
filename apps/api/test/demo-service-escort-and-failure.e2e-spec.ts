import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';

describe('Demo Service Escort and Technical Failure Auto-Ticket E2E Suite', () => {
  let app: INestApplication;
  let db: any;
  let salesToken: string;
  let demoTeamToken: string;
  let serviceEngineerToken: string;

  let salesUserId: string;
  let serviceEngineerUserId: string;
  let testOrgId: string;
  let testProductId: string;
  let testEquipId: string;

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

    db = app.get(KYSELY_DB);

    // Login Sales
    const salesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    expect(salesRes.status).toBe(200);
    salesToken = salesRes.body.accessToken;
    salesUserId = salesRes.body.user.id;

    // Login Demo Team
    const demoTeamRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'demo@arihant.com', password: 'password123' });
    expect(demoTeamRes.status).toBe(200);
    demoTeamToken = demoTeamRes.body.accessToken;

    // Login Service Team
    const serviceRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'service@arihant.com', password: 'password123' });
    expect(serviceRes.status).toBe(200);
    serviceEngineerToken = serviceRes.body.accessToken;
    serviceEngineerUserId = serviceRes.body.user.id;

    // Find or setup master records
    const org = await db.selectFrom('organisations').select(['id']).limit(1).executeTakeFirst();
    testOrgId = org.id;

    const prod = await db.selectFrom('products').select(['id']).limit(1).executeTakeFirst();
    testProductId = prod.id;

    const equip = await db
      .selectFrom('demo_equipment')
      .select(['id'])
      .where('availability_status', '=', 'available')
      .limit(1)
      .executeTakeFirst();
    testEquipId = equip?.id;

    if (!testEquipId) {
      const newEquip = await db
        .insertInto('demo_equipment')
        .values({
          product_id: testProductId,
          model: 'HHMD-SEC-TEST',
          serial_no: `SN-ESCORT-${Date.now()}`,
          current_location: 'Delhi',
          availability_status: 'available',
          condition: 'Operational',
        })
        .returning('id')
        .executeTakeFirst();
      testEquipId = newEquip.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Salesperson requests a demo with Service Team escort', async () => {
    const targetDate = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
    const res = await request(app.getHttpServer())
      .post('/api/demos')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        organisation_id: testOrgId,
        product_id: testProductId,
        requested_date: targetDate,
        location: 'Delhi Police Trial Ground',
        purpose: 'Technical trial with service engineer escort',
        service_escort_required: true,
        service_engineer_id: serviceEngineerUserId,
      });

    expect(res.status).toBe(201);
    expect(res.body.service_escort_required).toBe(true);
    expect(res.body.service_engineer_id).toBe(serviceEngineerUserId);

    // Give event listener a tick to insert async notification
    await new Promise((r) => setTimeout(r, 100));

    // Verify notifications table contains demo_service_escort_requested
    const notif = await db
      .selectFrom('notifications')
      .selectAll()
      .where('entity_id', '=', res.body.id)
      .where('type', '=', 'demo_service_escort_requested')
      .executeTakeFirst();

    expect(notif).toBeDefined();
    expect(notif.title).toContain('Service Escort Requested');
  });

  it('2. Salesperson plans a field visit with demo and Service Team escort', async () => {
    const randomDays = 100 + Math.floor(Math.random() * 1000);
    const plannedDate = new Date(Date.now() + 86400000 * randomDays).toISOString().split('T')[0];
    const res = await request(app.getHttpServer())
      .post('/api/visits')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        organisation_id: testOrgId,
        assigned_to: salesUserId,
        planned_date: plannedDate,
        purpose: 'Client field visit with trial demonstration and escort',
        demo_required: true,
        service_escort_required: true,
        service_engineer_id: serviceEngineerUserId,
        location: 'Delhi Station',
      });

    expect(res.status).toBe(201);
    expect(res.body.service_escort_required).toBe(true);
    expect(res.body.service_engineer_id).toBe(serviceEngineerUserId);

    // Verify linked demo record auto-created with escort details
    const linkedDemo = await db
      .selectFrom('demos')
      .selectAll()
      .where('visit_id', '=', res.body.id)
      .executeTakeFirst();

    expect(linkedDemo).toBeDefined();
    expect(linkedDemo.service_escort_required).toBe(true);
    expect(linkedDemo.service_engineer_id).toBe(serviceEngineerUserId);
  });

  it('3. When live demo suffers TECHNICAL_FAILURE, auto-create Module 6 Breakdown Ticket and quarantine equipment to maintenance', async () => {
    const randomOffset = 50 + Math.floor(Math.random() * 500);
    const targetDate = new Date(Date.now() + 86400000 * randomOffset).toISOString().split('T')[0];

    // Ensure test equipment is in available state prior to reservation
    await db
      .updateTable('demo_equipment')
      .set({ availability_status: 'available' })
      .where('id', '=', testEquipId)
      .execute();
    
    // Create fresh demo
    const demoRes = await request(app.getHttpServer())
      .post('/api/demos')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        organisation_id: testOrgId,
        product_id: testProductId,
        requested_date: targetDate,
        location: 'CRPF Proving Site',
        purpose: 'Range testing',
        service_escort_required: true,
        service_engineer_id: serviceEngineerUserId,
      });
    expect(demoRes.status).toBe(201);
    const demoId = demoRes.body.id;

    // Coordinator reserves equipment
    const reserveRes = await request(app.getHttpServer())
      .post(`/api/demos/${demoId}/reserve`)
      .set('Authorization', `Bearer ${demoTeamToken}`)
      .send({
        equipment_id: testEquipId,
        reserved_from: targetDate,
        reserved_to: targetDate,
      });
    expect(reserveRes.status).toBe(201);

    // Submit outcome with TECHNICAL_FAILURE
    const outcomeRes = await request(app.getHttpServer())
      .post(`/api/demos/${demoId}/outcome`)
      .set('Authorization', `Bearer ${demoTeamToken}`)
      .send({
        result: 'fail',
        failure_reason: 'TECHNICAL_FAILURE',
        technical_performance: 'Thermal sensor shut down during 45-degree field trial',
        customer_response: 'Customer noted sensor blackout',
        remarks: 'Unit suffered sudden board failure',
        completed: true,
      });

    expect(outcomeRes.status).toBe(201);
    expect(outcomeRes.body.result).toBe('fail');
    expect(outcomeRes.body.failure_reason).toBe('TECHNICAL_FAILURE');
    expect(outcomeRes.body.service_ticket_id).toBeDefined();

    // Verify demo equipment is quarantined into maintenance
    const updatedEquip = await db
      .selectFrom('demo_equipment')
      .selectAll()
      .where('id', '=', testEquipId)
      .executeTakeFirst();

    expect(updatedEquip.availability_status).toBe('maintenance');
    expect(updatedEquip.remarks).toContain('Quarantined after live trial failure');

    // Verify service ticket was inserted in service_tickets table
    const serviceTicket = await db
      .selectFrom('service_tickets')
      .selectAll()
      .where('id', '=', outcomeRes.body.service_ticket_id)
      .executeTakeFirst();

    expect(serviceTicket).toBeDefined();
    expect(serviceTicket.complaint_source).toBe('Demo Team');
    expect(serviceTicket.problem_category).toBe('Breakdown');
    expect(serviceTicket.priority).toBe('high');
    expect(serviceTicket.assigned_to).toBe(serviceEngineerUserId);

    // Verify demo record links to this service ticket
    const updatedDemo = await db
      .selectFrom('demos')
      .selectAll()
      .where('id', '=', demoId)
      .executeTakeFirst();

    expect(updatedDemo.service_ticket_id).toBe(serviceTicket.id);

    // Verify notifications table contains demo_technical_failure notification
    const failureNotif = await db
      .selectFrom('notifications')
      .selectAll()
      .where('entity_id', '=', serviceTicket.id)
      .where('type', '=', 'demo_technical_failure')
      .executeTakeFirst();

    expect(failureNotif).toBeDefined();
    expect(failureNotif.title).toContain('Live Demo Breakdown');
  });
});
