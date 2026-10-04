import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Module 5: Delivery Management E2E Test Suite (TEST 5)', () => {
  let app: INestApplication;
  let mgmtToken: string;
  let salesToken: string;
  let serviceToken: string;
  let testOrgId: string;
  let testProductId: string;
  let deliveryId: string;

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

    // 1. Authenticate tokens
    const mgmtRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'mgmt@arihant.com', password: 'password123' });
    mgmtToken = mgmtRes.body.accessToken;

    const salesRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    salesToken = salesRes.body.accessToken;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'service@arihant.com', password: 'password123' });
    serviceToken = serviceRes.body.accessToken;

    // 2. Fetch master customer and product
    const orgs = await request(app.getHttpServer())
      .get('/api/organisations?limit=1')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testOrgId = orgs.body.data[0].id;

    const prods = await request(app.getHttpServer())
      .get('/api/masters/products')
      .set('Authorization', `Bearer ${mgmtToken}`);
    testProductId = prods.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Delivery Lifecycle (TEST 5: Customer -> Product -> Delivery -> Status update)', () => {
    it('creates a new equipment delivery order', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/deliveries')
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          organisation_id: testOrgId,
          product_id: testProductId,
          model: 'XBIS-6040 Dual View Scanner',
          equipment_serial: 'SN-XBIS-2026-9901',
          delivery_date: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0],
          delivery_location: 'Central Ordnance Depot, Warehouse 4',
          order_reference: 'PO-MHA-2026-90812',
          installation_required: true,
          remarks: 'Ensure heavy hydraulic pallet jack is present on site.',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.delivery_no).toMatch(/^DEL-\d{4}-\d{4}$/);
      expect(res.body.status).toBe('scheduled');
      expect(res.body.installation_required).toBe(true);
      deliveryId = res.body.id;
    });

    it('retrieves delivery by ID with customer, product and details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/deliveries/${deliveryId}`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(deliveryId);
      expect(res.body.organisation_name).toBeDefined();
      expect(res.body.product_name).toBeDefined();
    });

    it('transitions delivery status through full fulfillment lifecycle: dispatched -> in_transit -> delivered -> installed -> handover_completed', async () => {
      // 1. Dispatched
      const dispatchRes = await request(app.getHttpServer())
        .patch(`/api/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'dispatched', remarks: 'Dispatched from Delhi depot via SafeX Logistics' });

      expect(dispatchRes.status).toBe(200);
      expect(dispatchRes.body.status).toBe('dispatched');

      // 2. In Transit
      const transitRes = await request(app.getHttpServer())
        .patch(`/api/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'in_transit' });

      expect(transitRes.status).toBe(200);
      expect(transitRes.body.status).toBe('in_transit');

      // 3. Delivered
      const deliveredRes = await request(app.getHttpServer())
        .patch(`/api/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'delivered', remarks: 'Unloaded and verified at client bay' });

      expect(deliveredRes.status).toBe(200);
      expect(deliveredRes.body.status).toBe('delivered');

      // 4. Installed with notes and technician
      const installedRes = await request(app.getHttpServer())
        .patch(`/api/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          status: 'installed',
          installation_date: new Date().toISOString().split('T')[0],
          installation_notes: 'Calibration complete. Both X-Ray generators passed radiation safety test.',
        });

      expect(installedRes.status).toBe(200);
      expect(installedRes.body.status).toBe('installed');
      expect(installedRes.body.installation_notes).toContain('Both X-Ray generators passed');

      // 5. Handover Completed
      const handoverRes = await request(app.getHttpServer())
        .patch(`/api/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${mgmtToken}`)
        .send({
          status: 'handover_completed',
          document_url: 'https://docs.arihant.com/handovers/HO-2026-9901.pdf',
          remarks: 'Signed handover certificate and warranty card received from Store Officer.',
        });

      expect(handoverRes.status).toBe(200);
      expect(handoverRes.body.status).toBe('handover_completed');
      expect(handoverRes.body.document_url).toBeDefined();
    });

    it('filters deliveries by status, search, and organisation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/deliveries?status=handover_completed&search=XBIS`)
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(deliveryId);
    });

    it('retrieves delivery dashboard metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/deliveries/metrics')
        .set('Authorization', `Bearer ${mgmtToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.handoverCompleted).toBeGreaterThanOrEqual(1);
    });
  });
});
