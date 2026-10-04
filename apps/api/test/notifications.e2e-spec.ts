import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Kysely } from 'kysely';
import type { Database } from '@arihant/shared';

describe('Notifications & Unread Badge E2E Suite', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let userToken: string;
  let userId: string;
  let testNotifId: string;

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

    db = moduleFixture.get<Kysely<Database>>('KYSELY_DB');

    // Login as a user (sales rep Amit Verma)
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'sales.delhi@arihant.com', password: 'password123' });

    expect(loginRes.status).toBe(200);
    userToken = loginRes.body.accessToken || loginRes.body.token;
    userId = loginRes.body.user.id;

    // Insert 2 fresh test notifications for this user
    const insertRes = await db
      .insertInto('notifications')
      .values([
        {
          user_id: userId,
          type: 'tender_alert',
          title: 'Test Tender Closes Soon',
          body: 'Tender GEM/2026/TEST/001 closes in 24 hours.',
          entity_type: 'tender',
          is_read: false,
        },
        {
          user_id: userId,
          type: 'proposal_alert',
          title: 'Test Proposal Approved',
          body: 'Proposal PRP-TEST-001 has been approved.',
          entity_type: 'proposal',
          is_read: false,
        },
      ])
      .returningAll()
      .execute();

    testNotifId = insertRes[0].id;
  });

  afterAll(async () => {
    if (db && userId) {
      await db
        .deleteFrom('notifications')
        .where('user_id', '=', userId)
        .where('title', 'like', 'Test %')
        .execute();
    }
    await app.close();
  });

  describe('Unread Count & Inbox Synchronization', () => {
    it('✓ GET /api/notifications/unread-count returns both count and unreadCount numeric values', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.count).toBe('number');
      expect(typeof res.body.unreadCount).toBe('number');
      expect(res.body.count).toBe(res.body.unreadCount);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
    });

    it('✓ GET /api/notifications returns PaginatedResult with data array and message mapping', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications?limit=10')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page', 1);

      // Verify each notification has both message and body populated
      const sample = res.body.data[0];
      expect(sample).toHaveProperty('title');
      expect(sample).toHaveProperty('body');
      expect(sample).toHaveProperty('message');
      expect(sample.message).toBeTruthy();
    });

    it('✓ PATCH /api/notifications/:id/read marks single notification as read and updates unread counts', async () => {
      const initialCountRes = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${userToken}`);
      const beforeCount = initialCountRes.body.count;

      const markRes = await request(app.getHttpServer())
        .patch(`/api/notifications/${testNotifId}/read`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(markRes.status).toBe(200);
      expect(markRes.body.is_read).toBe(true);
      expect(markRes.body.count).toBe(beforeCount - 1);

      // Verify unread-count endpoint reflects the decrement
      const afterCountRes = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${userToken}`);
      expect(afterCountRes.body.count).toBe(beforeCount - 1);
    });

    it('✓ PATCH /api/notifications/read-all marks all user notifications as read', async () => {
      const readAllRes = await request(app.getHttpServer())
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${userToken}`);

      expect(readAllRes.status).toBe(200);
      expect(readAllRes.body.success).toBe(true);
      expect(readAllRes.body.count).toBe(0);

      const unreadRes = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${userToken}`);

      expect(unreadRes.status).toBe(200);
      expect(unreadRes.body.count).toBe(0);
      expect(unreadRes.body.unreadCount).toBe(0);
    });

    it('✓ PATCH /api/notifications/mark-all-read alias endpoint is supported', async () => {
      const aliasRes = await request(app.getHttpServer())
        .patch('/api/notifications/mark-all-read')
        .set('Authorization', `Bearer ${userToken}`);

      expect(aliasRes.status).toBe(200);
      expect(aliasRes.body.success).toBe(true);
      expect(aliasRes.body.count).toBe(0);
    });
  });
});
