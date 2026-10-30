import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';

/**
 * Module 9 — Salesperson & Regional Performance (GET /api/dashboard/sales-performance).
 *
 * Every indicator of the blueprint is checked with exact numbers. Fixtures live in March 2001 (a period nothing else
 * touches) and belong to dedicated reps, so the counts are deterministic: repA (North, Delhi NCR) carries the full set,
 * repB (East) a little, repC is deactivated but worked in the period, repD is active with nothing, repE is deactivated
 * with only an old open lead.
 */
describe('Module 9 — Salesperson & Regional Performance', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());
  const q = async (text: string) => (await sql.raw(text).execute(db)).rows as any[];
  const STAMP = `zzm9${Date.now()}`;
  const P = { from: '2001-03-01', to: '2001-03-31' };
  const perf = (who: string, query: Record<string, any> = {}) => api().get('/api/dashboard/sales-performance').query({ ...P, ...query }).set(auth(who));
  const ids: Record<string, string[]> = {};
  const track = (table: string, id: string) => ((ids[table] ||= []).push(id), id);
  let region: Record<string, { id: string; zone_id: string }> = {};
  let orgA: string, orgB: string, orgN: string;

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken || r.body.token;
    uid[key] = r.body.user.id;
  }
  /** A dedicated rep that signs in with the seed password. */
  async function rep(key: string, regionName: string, managerKey: string, active = true) {
    const id = track('users', randomUUID());
    const email = `${STAMP}.${key}@arihant.com`.toLowerCase(); // sign-in looks emails up in lower case
    const r = region[regionName];
    await q(`insert into users (id, email, full_name, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
             values ('${id}', '${email}', 'ZZ M9 ${key}', 'sales', '${r.id}', '${r.zone_id}', '${uid[managerKey]}', true,
                     (select password_hash from users where email = 'sales.delhi@arihant.com'))`);
    uid[key] = id;
    if (active) await login(key, email);
    else await q(`update users set is_active = false where id = '${id}'`);
  }
  const ins = async (table: string, cols: Record<string, string | null>) => {
    const id = track(table, randomUUID());
    const keys = ['id', ...Object.keys(cols)];
    const vals = [`'${id}'`, ...Object.values(cols).map((v) => (v === null ? 'null' : v))];
    await q(`insert into ${table} (${keys.join(', ')}) values (${vals.join(', ')})`);
    return id;
  };
  const s = (v: string) => `'${v}'`;
  const ist = (day: string) => `'${day} 10:00:00+05:30'`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(KYSELY_DB);

    for (const [k, email] of Object.entries({
      mgmt: 'mgmt@arihant.com', admin: 'admin@arihant.com', rmN: 'regmgr.north@arihant.com', rmE: 'regmgr.east@arihant.com',
      tender: 'tender@arihant.com', demo: 'demo@arihant.com', svc: 'service@arihant.com', accounts: 'accounts@arihant.com',
    })) await login(k, email);
    region = Object.fromEntries((await q(`select id, name, zone_id from regions where name in ('Delhi NCR', 'West Bengal')`)).map((r) => [r.name, r]));

    await rep('repA', 'Delhi NCR', 'rmN');
    await rep('repB', 'West Bengal', 'rmE');
    await rep('repC', 'Delhi NCR', 'rmN', false);
    await rep('repD', 'Delhi NCR', 'rmN');
    await rep('repE', 'Delhi NCR', 'rmN', false);

    const dl = region['Delhi NCR'];
    const wb = region['West Bengal'];
    orgA = await ins('organisations', { name: s(`${STAMP} Org A`), region_id: s(dl.id), zone_id: s(dl.zone_id), created_by: s(uid.repA) });
    orgB = await ins('organisations', { name: s(`${STAMP} Org B`), region_id: s(wb.id), zone_id: s(wb.zone_id), created_by: s(uid.repB) });
    orgN = await ins('organisations', { name: s(`${STAMP} Org N`), region_id: null, zone_id: null, created_by: null });
    for (const n of ['one', 'two']) await ins('contacts', { organisation_id: s(orgA), full_name: s(`ZZ M9 contact ${n}`) });
    await ins('contacts', { organisation_id: s(orgB), full_name: s('ZZ M9 contact east') });

    // ── leads ──
    const lead = (owner: string | null, org: string, type: string, status: string, created: string) =>
      ins('leads', { organisation_id: s(org), assigned_to: owner ? s(uid[owner]) : null, lead_type: s(type), lead_status: s(status), created_at: created });
    await lead('repA', orgA, 'fresh', 'new', ist('2001-03-05'));
    await lead('repA', orgA, 'fresh', 'converted', ist('2001-03-10'));
    await lead('repA', orgA, 're_approached', 'contacted', ist('2001-03-12'));
    await lead('repA', orgA, 'fresh', 'new', `'2001-02-28 20:00:00+00'`); // 1 March 01:30 IST: in the period
    await lead('repA', orgA, 'fresh', 'new', `'2001-03-31 19:00:00+00'`); // 1 April 00:30 IST: outside
    await lead('repA', orgA, 'fresh', 'lost', ist('2001-03-15'));
    await lead('repB', orgB, 'fresh', 'new', ist('2001-03-05'));
    await lead('repC', orgA, 'fresh', 'new', ist('2001-03-06'));
    await lead('repE', orgA, 'fresh', 'new', ist('2000-06-01')); // open, but long before the period
    await lead(null, orgN, 'fresh', 'new', ist('2001-03-07')); // no owner, no region

    // ── follow-ups ──
    const fu = (status: string, due: string, completed: string | null) =>
      ins('follow_ups', { organisation_id: s(orgA), assigned_to: s(uid.repA), status: s(status), due_date: s(due), completed_at: completed });
    await fu('completed', '2001-03-01', ist('2001-03-06'));
    await fu('completed', '2001-03-20', null); // no completion stamp: its due date counts
    await fu('pending', '2001-03-25', null);
    await fu('pending', '2001-04-05', null); // due after the period
    await fu('cancelled', '2001-03-10', null);
    await fu('pending', '2001-02-10', null); // overdue from before the period: still pending by its end

    // ── visits & interactions ──
    const visit = (day: string, status: string) => ins('visits', { organisation_id: s(orgA), assigned_to: s(uid.repA), planned_date: s(day), status: s(status) });
    await visit('2001-03-02', 'completed');
    await visit('2001-03-03', 'cancelled');
    await visit('2001-03-04', 'planned');
    await visit('2001-04-02', 'completed');
    const touch = (on: string | null, created: string) => ins('interactions', { organisation_id: s(orgA), employee_id: s(uid.repA), type: s('service'), occurred_on: on, created_at: created });
    await touch(s('2001-03-05'), ist('2001-03-05'));
    await touch(s('2001-03-31'), ist('2001-03-31')); // last day of the period
    await touch(s('2001-02-27'), ist('2001-02-27'));

    // ── demos & outcomes (one outcome per demo) ──
    const demo = (status: string, confirmed: string | null, requested: string | null) =>
      ins('demos', { organisation_id: s(orgA), requested_by: s(uid.repA), status: s(status), confirmed_date: confirmed ? s(confirmed) : null, requested_date: requested ? s(requested) : null });
    const outcome = (d: string, result: string, reason: string | null, at: string) => ins('demo_outcomes', { demo_id: s(d), result: s(result), failure_reason: reason ? s(reason) : null, created_at: at });
    await outcome(await demo('completed', '2001-03-08', null), 'success', null, ist('2001-03-08'));
    await outcome(await demo('completed', null, '2001-03-09'), 'fail', 'PRICING_CONCERN', ist('2001-03-09'));
    await demo('cancelled', '2001-03-10', null);
    await demo('confirmed', '2001-03-20', null);
    await outcome(await demo('completed', '2001-03-22', null), 'partial', null, ist('2001-03-22')); // partial, reason not given
    await outcome(await demo('completed', '2001-04-02', null), 'fail', 'OTHER', ist('2001-04-02'));

    // ── proposals & their follow-ups ──
    const prop = (status: string, sent: string | null, outcomeDay: string | null, extra: Record<string, string | null> = {}) =>
      ins('proposals', {
        organisation_id: s(orgA), responsible_person_id: s(uid.repA), follow_up_owner_id: s(uid.repA), // a sent proposal needs its follow-up owner
        status: s(status), sent_date: sent ? s(sent) : null, outcome_date: outcomeDay ? s(outcomeDay) : null, ...extra,
      });
    const p1 = await prop('SENT_TO_CUSTOMER', '2001-03-11', null);
    const p2 = await prop('CONVERTED', '2001-03-12', '2001-03-25');
    await prop('CONVERTED', '2001-02-20', '2001-03-02'); // sent before, converted in the period
    const p4 = await prop('SENT_TO_CUSTOMER', '2001-03-13', null, { is_deleted: 'true' });
    await prop('SENT_TO_CUSTOMER', '2001-03-14', null, { responsible_person_id: null, requested_by: s(uid.repA) }); // legacy owner column
    const pfu = (p: string, on: string | null, created: string) => ins('proposal_follow_ups', { proposal_id: s(p), summary: s('ZZ M9 call'), contact_date: on ? s(on) : null, created_at: created });
    await pfu(p1, '2001-03-15', ist('2001-03-15'));
    await pfu(p2, '2001-03-31', ist('2001-03-31')); // last day of the period
    await pfu(p4, '2001-03-17', ist('2001-03-17')); // on a deleted proposal
    await pfu(p1, '2001-04-03', ist('2001-04-03'));

    // ── tenders ──
    const tender = (cat: string, status: string, created: string, extra: Record<string, string | null> = {}) =>
      ins('tenders', { tender_title: s(`${STAMP} tender`), category: s(cat), status: s(status), salesperson_id: s(uid.repA), created_by: s(uid.repA), region_id: s(dl.id), zone_id: s(dl.zone_id), created_at: created, ...extra });
    await tender('pq', 'identified', ist('2001-03-01'));
    await tender('general_mha', 'submitted', ist('2001-03-02'), { submission_date: s('2001-03-10') });
    await tender('general_mha', 'won', ist('2001-02-01'), { submission_date: s('2001-02-15'), result_date: s('2001-03-20') });
    await tender('pq', 'lost', ist('2001-03-03'), { submission_date: s('2001-03-05'), result_date: s('2001-03-21') });
    await tender('other', 'identified', ist('2001-03-04'));
    await tender('pq', 'identified', ist('2001-03-05'), { is_deleted: 'true' });
    await tender('general_mha', 'identified', ist('2001-03-06'), { salesperson_id: s(uid.repB), region_id: s(wb.id), zone_id: s(wb.zone_id) }); // two people: A created, B sells
  });

  afterAll(async () => {
    await q(`delete from role_module_blocks`);
    const del = async (table: string) => ids[table]?.length && (await q(`delete from ${table} where id in (${ids[table].map((i) => `'${i}'`).join(',')})`));
    for (const t of ['demo_outcomes', 'demos', 'proposal_follow_ups', 'proposals', 'tenders', 'interactions', 'visits', 'follow_ups', 'leads', 'contacts', 'organisations']) await del(t);
    await q(`delete from audit_log where actor_id in (${ids.users.map((i) => `'${i}'`).join(',')})`);
    await del('users');
    await app.close();
  });

  const row = (body: any, key: string) => body.rows.find((r: any) => r.key === uid[key]);

  describe('every indicator, exactly (sales rep, own row)', () => {
    let me: any;
    beforeAll(async () => {
      const res = await perf('repA');
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      me = res.body.rows[0];
    });

    it('lead performance: contacts, new, re-approached, active, follow-ups, conversion', () => {
      expect(me.key).toBe(uid.repA);
      expect(me.lead).toEqual({ contacts: 2, new: 4, active: 4, reapproached: 1, followups_done: 2, followups_pending: 2, converted: 1, conversion_rate: 20 });
    });

    it('visit performance: planned, completed, cancelled, customer interactions', () => {
      expect(me.visit).toEqual({ planned: 3, completed: 1, cancelled: 1, interactions: 2 });
    });

    it('demo performance: planned (not cancelled), completed, successful, failure reasons (partial and unstated included)', () => {
      expect(me.demo).toEqual({ planned: 4, completed: 3, successful: 1, failure_reasons: { PRICING_CONCERN: 1, UNSPECIFIED: 1 } });
    });

    it('proposal performance: sent, follow-ups, conversions (deleted proposals ignored, legacy owner counted)', () => {
      expect(me.proposal).toEqual({ sent: 3, followups: 2, converted: 2 });
    });

    it('tender performance: PQ, General/MHA, submissions, wins, losses, win rate (deleted and "other" ignored)', () => {
      expect(me.tender).toEqual({ pq: 2, general_mha: 2, submitted: 2, won: 1, lost: 1, win_rate: 50 });
    });

    it('the totals of a single-person view are that person', async () => {
      const res = await perf('repA');
      const { key, label, role, region_name, zone_name, inactive, ...figures } = res.body.rows[0];
      void key; void label; void role; void region_name; void zone_name;
      expect(inactive).toBe(false);
      expect(res.body.totals).toEqual(figures);
    });

    it('nothing to divide by shows null, not 0% or NaN', async () => {
      const b = (await perf('repB')).body.rows[0];
      expect(b.tender.win_rate).toBeNull();
      expect(b.lead.conversion_rate).toBe(0); // one lead created, none converted
      const empty = (await perf('repD')).body.rows[0];
      expect(empty.lead.conversion_rate).toBeNull();
      expect(empty.lead.new).toBe(0);
    });
  });

  describe('who sees what', () => {
    it('a sales rep sees only themself: no zone / region / by-region choices, and those parameters are ignored', async () => {
      const res = await perf('repA', { group_by: 'region', zone_id: region['West Bengal'].zone_id, region_id: region['West Bengal'].id });
      expect(res.body.group_by).toBe('rep');
      expect(res.body.rows.map((r: any) => r.key)).toEqual([uid.repA]);
      expect(res.body.filters).toEqual(expect.objectContaining({ can_pick_zone: false, can_pick_region: false, can_group_by_region: false, regions: [] }));
      const b = await perf('repB');
      expect(b.body.rows.map((r: any) => r.key)).toEqual([uid.repB]);
    });

    it('a regional manager sees their zone: its reps (deactivated ones only with figures), never another zone', async () => {
      const res = await perf('rmN');
      const keys = res.body.rows.map((r: any) => r.key);
      expect(keys).toEqual(expect.arrayContaining([uid.repA, uid.repC, uid.repD]));
      expect(keys).not.toContain(uid.repB);
      expect(keys).not.toContain(uid.repE); // deactivated, nothing in the period
      expect(row(res.body, 'repC')).toEqual(expect.objectContaining({ inactive: true }));
      expect(row(res.body, 'repC').lead.new).toBe(1);
      expect(row(res.body, 'repD').inactive).toBe(false);
      // another zone's filters are refused quietly: the manager stays in their own zone
      const sneaky = await perf('rmN', { zone_id: region['West Bengal'].zone_id, region_id: region['West Bengal'].id });
      expect(sneaky.body.filters.zone_id).toBe(region['Delhi NCR'].zone_id);
      expect(sneaky.body.filters.region_id).toBeNull();
      expect(sneaky.body.filters.can_pick_zone).toBe(false);
      const east = await perf('rmE');
      const eastKeys = east.body.rows.map((r: any) => r.key);
      expect(eastKeys).toContain(uid.repB);
      expect(eastKeys).not.toContain(uid.repA);
    });

    it('by region, records go to their own territory (customer / tender region)', async () => {
      const res = await perf('rmN', { group_by: 'region' });
      expect(res.body.group_by).toBe('region');
      const delhi = res.body.rows.find((r: any) => r.key === region['Delhi NCR'].id);
      expect(delhi.lead.new).toBe(5); // repA's 4 + repC's 1, all at a Delhi customer
      expect(delhi.tender.general_mha).toBe(1); // the East tender lands in West Bengal
      expect(res.body.rows.some((r: any) => r.key === region['West Bengal'].id)).toBe(false);
      expect(res.body.rows.some((r: any) => r.key === 'none')).toBe(false); // "No region" is management-only
    });

    it('management sees everyone, can narrow to a zone or region, and totals count each record once', async () => {
      const all = await perf('mgmt');
      const keys = all.body.rows.map((r: any) => r.key);
      expect(keys).toEqual(expect.arrayContaining([uid.repA, uid.repB, uid.repC, uid.repD]));
      expect(keys).not.toContain(uid.repE);
      expect(all.body.totals.lead.new).toBe(6); // A 4 + B 1 + C 1 (the ownerless lead has no rep)
      expect(all.body.totals.tender.general_mha).toBe(2); // the shared tender counts once
      expect(row(all.body, 'repB').tender.general_mha).toBe(1);

      const north = await perf('mgmt', { zone_id: region['Delhi NCR'].zone_id });
      expect(north.body.rows.map((r: any) => r.key)).not.toContain(uid.repB);
      expect(north.body.filters.can_pick_zone).toBe(true);

      const byRegion = await perf('mgmt', { group_by: 'region' });
      const none = byRegion.body.rows.find((r: any) => r.key === 'none');
      expect(none?.lead.new).toBe(1); // the ownerless lead at a customer with no region
      const onlyDelhi = await perf('mgmt', { group_by: 'region', region_id: region['Delhi NCR'].id });
      expect(onlyDelhi.body.rows.map((r: any) => r.key)).toEqual([region['Delhi NCR'].id]);

      expect((await perf('admin')).body.totals).toEqual(all.body.totals);
    });

    it('roles outside Module 9 are refused', async () => {
      for (const who of ['tender', 'demo', 'svc', 'accounts']) expect((await perf(who)).status).toBe(403);
      expect((await api().get('/api/dashboard/sales-performance').query(P)).status).toBe(401);
    });

    it('the administrator can switch the module off for a role; the API refuses it at once', async () => {
      const off = await api().patch('/api/admin/access/sales/regional').set(auth('admin')).send({ blocked: true, reason: 'Performance review cycle paused' });
      expect(off.status).toBe(200);
      expect((await perf('repA')).status).toBe(403);
      expect((await perf('rmN')).status).toBe(200); // other roles untouched
      expect((await api().patch('/api/admin/access/sales/regional').set(auth('admin')).send({ blocked: false })).status).toBe(200);
      expect((await perf('repA')).status).toBe(200);
    });
  });

  describe('period', () => {
    it('rejects malformed, impossible and reversed dates with a clean 400', async () => {
      for (const query of [{ from: 'yesterday' }, { from: '2001-02-30' }, { to: '2001-13-01' }, { from: '2001-03-31', to: '2001-03-01' }]) {
        const r = await perf('repA', query);
        expect(r.status).toBe(400);
      }
    });

    it('defaults to the current month; "to" alone starts at its month; one-day periods work', async () => {
      const def = await api().get('/api/dashboard/sales-performance').set(auth('repA'));
      expect(def.status).toBe(200);
      expect(def.body.period.from).toMatch(/^\d{4}-\d{2}-01$/);
      const toOnly = await api().get('/api/dashboard/sales-performance').query({ to: '2001-03-31' }).set(auth('repA'));
      expect(toOnly.body.period).toEqual({ from: '2001-03-01', to: '2001-03-31' });
      const day = await perf('repA', { from: '2001-03-01', to: '2001-03-01' });
      expect(day.body.rows[0].lead.new).toBe(1); // only the lead logged 01:30 IST on 1 March
      const nextDay = await perf('repA', { from: '2001-04-01', to: '2001-04-01' });
      expect(nextDay.body.rows[0].lead.new).toBe(1); // the 00:30 IST lead belongs to April
    });
  });
});
