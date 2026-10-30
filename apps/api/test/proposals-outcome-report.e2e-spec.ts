import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';

/**
 * Proposal Outcome Report (GET /api/proposals/reports/outcome) and CSV export (GET /api/proposals/export) count every
 * proposal in scope. Both used to read rows through the register's paged list, whose page is capped at 100, so with
 * more than 100 proposals the win rate, lost reasons and the export silently covered only the latest 100.
 */
describe('Proposals — outcome report and export beyond one page', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());
  const q = async (text: string) => (await sql.raw(text).execute(db)).rows as any[];
  const STAMP = `zzpor${Date.now()}`;
  let org: string;

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken || r.body.token;
    uid[key] = r.body.user.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(KYSELY_DB);
    await login('mgmt', 'mgmt@arihant.com');
    await login('rmN', 'regmgr.north@arihant.com');
    await login('sales', 'sales.delhi@arihant.com');

    const [region] = await q(`select id, zone_id from regions where name = 'Delhi NCR'`);
    [{ id: org }] = await q(`insert into organisations (name, region_id, zone_id, created_by)
      values ('${STAMP} Outcome Org', '${region.id}', '${region.zone_id}', '${uid.sales}') returning id`);
    // 130 decided proposals: 70 converted, 50 lost (30 PRICE, 10 with only a free-text reason, 10 with none), 10 closed
    // unsent. Requested 1 May, sent 4 May (every 4th one late), decided 14 May.
    await q(`
      insert into proposals (organisation_id, responsible_person_id, follow_up_owner_id, status, request_date, sent_date,
                             outcome_date, lost_reason_code, lost_reason, sent_late)
      select '${org}', '${uid.sales}', '${uid.sales}',
             case when g <= 70 then 'CONVERTED' when g <= 120 then 'LOST' else 'CLOSED' end,
             date '2001-05-01',
             case when g <= 120 then date '2001-05-04' end,
             date '2001-05-14',
             case when g between 71 and 100 then 'PRICE' end,
             case when g between 101 and 110 then 'Budget cut' end,
             g <= 120 and g % 4 = 0
      from generate_series(1, 130) g`);
  });

  afterAll(async () => {
    await q(`delete from proposals where organisation_id = '${org}'`);
    await q(`delete from organisations where id = '${org}'`);
    await app.close();
  });

  const report = async (who: string) => {
    const r = await api().get('/api/proposals/reports/outcome').query({ organisation_id: org }).set(auth(who));
    expect(r.status).toBe(200);
    return r.body;
  };
  const registerTotal = async (who: string, status: string) =>
    (await api().get('/api/proposals').query({ organisation_id: org, status, limit: 1 }).set(auth(who))).body.total as number;

  it('counts all 130 proposals, not the latest 100', async () => {
    const r = await report('mgmt');
    expect(r.converted_count).toBe(70);
    expect(r.lost_count).toBe(50);
    expect(r.closed_count).toBe(10);
    expect(r.win_rate_denominator).toBe(120);
    expect(r.win_rate).toBe('58.3%');
    expect(r.lost_reasons_breakdown).toEqual({ PRICE: 30, 'Budget cut': 10, Other: 10 });
    expect(r.average_turnaround_days).toBe(3);
    expect(r.average_sent_to_outcome_days).toBe(10);
    expect(r.sent_late_percentage).toBe('25.0%');
  });

  it('matches the register for every role that can open it', async () => {
    for (const who of ['mgmt', 'rmN', 'sales']) {
      const r = await report(who);
      expect(r.converted_count).toBe(await registerTotal(who, 'CONVERTED'));
      expect(r.lost_count).toBe(await registerTotal(who, 'LOST'));
      expect(r.closed_count).toBe(await registerTotal(who, 'CLOSED'));
    }
  });

  it('the CSV export holds every proposal (up to its 5,000-row limit)', async () => {
    const r = await api().get('/api/proposals/export').query({ organisation_id: org }).set(auth('mgmt'));
    expect(r.status).toBe(200);
    const lines = r.text.trim().split('\n').filter((l: string) => l.includes(`${STAMP} Outcome Org`));
    expect(lines).toHaveLength(130);
  });

  it('a client page is still capped at 100 rows', async () => {
    const r = await api().get('/api/proposals').query({ organisation_id: org, limit: 500 }).set(auth('mgmt'));
    expect(r.body.limit).toBe(100);
    expect(r.body.data).toHaveLength(100);
    expect(r.body.total).toBe(130);
  });
});
