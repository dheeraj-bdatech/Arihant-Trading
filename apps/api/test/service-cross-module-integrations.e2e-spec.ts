import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

describe('Module 6: Cross-Module Integrations & SLA Configurations E2E Test Suite', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let adminToken: string;
  let testOrgId: string;
  let testProductId: string;
  const testSerial = `SN-INTEG-${Date.now().toString().slice(-6)}`;

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

    const mgmtRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'mgmt@arihant.com', password: 'password123' });
    mgmtToken = mgmtRes.body.accessToken;

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

    // Create a test ticket for this customer & equipment
    await request(app.getHttpServer())
      .post('/api/service/tickets')
      .set('Authorization', `Bearer ${mgmtToken}`)
      .send({
        organisation_id: testOrgId,
        product_id: testProductId,
        equipment_serial: testSerial,
        complaint: 'Integration test ticket for customer & equipment history',
      });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Customer Profile Service History Integration (Section 4)', () => {
    it('retrieves complete service history for a customer profile', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/customer/${testOrgId}/history`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.customerId).toBe(testOrgId);
      expect(typeof res.body.totalTickets).toBe('number');
      expect(res.body.totalTickets).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.tickets)).toBe(true);
    });
  });

  describe('2. Equipment Profile Service History Integration (Section 4)', () => {
    it('retrieves complete breakdown history by equipment serial number', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/equipment/${testSerial}/history`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.equipmentIdentifier).toBe(testSerial);
      expect(res.body.totalBreakdowns).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.tickets)).toBe(true);
      expect(res.body.tickets[0].equipment_serial).toBe(testSerial);
    });

    it('retrieves breakdown history by product UUID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/service/equipment/${testProductId}/history`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.equipmentIdentifier).toBe(testProductId);
      expect(Array.isArray(res.body.tickets)).toBe(true);
    });
  });

  describe('3. Configuration Tables & SLA Management (Section 1.8)', () => {
    let ruleId: string;

    it('retrieves admin-editable SLA rules', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/settings/sla-rules')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      ruleId = res.body[0].id;
    });

    it('allows admin to adjust SLA resolution hours for a rule', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/service/settings/sla-rules/${ruleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          resolution_hours: 12,
        });

      expect(res.status).toBe(200);
      expect(res.body.resolution_hours).toBe(12);
    });

    it('retrieves system service settings', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/service/settings/config')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('allows admin to update repeat complaint window days', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/service/settings/config/repeat_complaint_window_days')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          value: 45,
        });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('repeat_complaint_window_days');
    });
  });
});
