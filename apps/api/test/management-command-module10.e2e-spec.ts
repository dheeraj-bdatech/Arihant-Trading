import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'crypto';
import { addIsoDays, todayInKolkata } from '@arihant/shared';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';

/**
 * Module 10 — Management Command dashboard (GET /api/dashboard/command).
 *
 * The contract: every figure equals the list it opens (same rule as the module screen), results match Module 9 for the
 * same period, a new exception shows up at once, and each manager's own layout decides what is shown.
 */
describe('Module 10 — Management Command dashboard', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const api = () => request(app.getHttpServer());
  const q = async (text: string) => (await sql.raw(text).execute(db)).rows as any[];
  const STAMP = `zzm10${Date.now()}`;
  const CITY = `Zz${STAMP}pur`;
  const today = todayInKolkata();
  const ids: Record<string, string[]> = {};
  const s = (v: string) => `'${v}'`;
  const ins = async (table: string, cols: Record<string, string | null>) => {
    const id = randomUUID();
    (ids[table] ||= []).push(id);
    const keys = ['id', ...Object.keys(cols)];
    const vals = [`'${id}'`, ...Object.values(cols).map((v) => (v === null ? 'null' : v))];
    await q(`insert into ${table} (${keys.join(', ')}) values (${vals.join(', ')})`);
    return id;
  };

  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken || r.body.token;
    uid[key] = r.body.user.id;
  }
  const command = async (who = 'mgmt') => {
    const r = await api().get('/api/dashboard/command').set(auth(who));
    expect(r.status).toBe(200);
    return r.body;
  };
  /** One figure of the dashboard. */
  const fig = (body: any, section: string, key: string) => {
    const m = body.sections.find((x: any) => x.key === section)?.metrics.find((x: any) => x.key === key);
    if (!m) throw new Error(`no figure ${section}.${key}`);
    return m;
  };
  const chip = (m: any, label: string) => m.breakdown.find((b: any) => b.label === label);
  /** Rows a module list returns for these filters (as the caller). */
  const total = async (path: string, query: Record<string, any> = {}, who = 'mgmt') => {
    const r = await api().get(`/api/${path}`).query({ ...query, limit: 1 }).set(auth(who));
    expect(r.status).toBe(200);
    return r.body.total as number;
  };
  const setLayout = (body: any, who = 'mgmt') => api().patch('/api/dashboard/command/layout').set(auth(who)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(KYSELY_DB);
    await q(`delete from role_module_blocks`);
    for (const [k, email] of Object.entries({
      mgmt: 'mgmt@arihant.com', admin: 'admin@arihant.com', rmN: 'regmgr.north@arihant.com', sales: 'sales.delhi@arihant.com',
      svc: 'service@arihant.com', accounts: 'accounts@arihant.com', tender: 'tender@arihant.com', demo: 'demo@arihant.com',
    })) await login(k, email);
    await q(`delete from dashboard_layouts where user_id in ('${uid.mgmt}', '${uid.admin}')`);
  });

  afterAll(async () => {
    await q(`delete from role_module_blocks`);
    await q(`delete from dashboard_layouts where user_id in ('${uid.mgmt}', '${uid.admin}')`);
    const del = async (table: string) => ids[table]?.length && (await q(`delete from ${table} where id in (${ids[table].map((i) => `'${i}'`).join(',')})`));
    for (const t of ['demo_reservations', 'demo_equipment', 'demos', 'visits', 'follow_ups', 'leads', 'organisations']) await del(t);
    await app.close();
  });

  it('opens for management and admin only', async () => {
    await command('mgmt');
    await command('admin');
    for (const who of ['rmN', 'sales', 'svc', 'accounts', 'tender', 'demo']) {
      expect((await api().get('/api/dashboard/command').set(auth(who))).status).toBe(403);
      expect((await setLayout({ period: 7 }, who)).status).toBe(403);
    }
  });

  it('shows every section of the blueprint by default, results over the last 30 days', async () => {
    const body = await command();
    expect(body.sections.map((x: any) => x.key)).toEqual(['sales', 'visits', 'demos', 'tenders', 'proposals', 'service', 'team', 'expenses']);
    expect(body.period).toEqual({ days: 30, from: addIsoDays(today, -29), to: today });
    expect(body.unavailable).toEqual([]);
    const keys = Object.fromEntries(body.sections.map((x: any) => [x.key, x.metrics.map((m: any) => m.key)]));
    expect(keys.sales).toEqual(['followups_overdue', 'new_opportunities', 'conversion', 'region_performance']);
    expect(keys.tenders).toEqual(['deadlines', 'approvals', 'pq_pipeline', 'general_pipeline', 'won_lost']);
    expect(keys.service).toEqual(['open', 'overdue', 'repeat', 'awaiting_parts']);
  });

  describe('every figure equals the list it opens', () => {
    let body: any;
    const P = { from: addIsoDays(today, -29), to: today };
    beforeAll(async () => {
      body = await command();
    });

    it('sales: follow-ups as the Leads page, new leads as the register', async () => {
      const overdue = fig(body, 'sales', 'followups_overdue');
      expect(overdue.href).toBe('/leads?followup=overdue');
      expect(overdue.value).toBe(await total('leads', { followup: 'overdue' }));
      expect(overdue.value).toBe((await api().get('/api/leads/dashboard').set(auth('mgmt'))).body.followups_overdue);

      const created = fig(body, 'sales', 'new_opportunities');
      expect(created.value).toBe(await total('leads', { created_from: P.from, created_to: P.to }));
      expect(chip(created, 'Fresh').value).toBe(await total('leads', { created_from: P.from, created_to: P.to, lead_type: 'fresh' }));
      expect(chip(created, 'Re-approached').value).toBe(await total('leads', { created_from: P.from, created_to: P.to, lead_type: 're_approached' }));
    });

    it('field visits: the Visits register, its open statuses and dates', async () => {
      const week = fig(body, 'visits', 'upcoming');
      expect(week.value).toBe(await total('visits', { status: 'open', dateFrom: today, dateTo: addIsoDays(today, 6) }));

      const todays = await api().get('/api/visits').query({ status: 'open', dateFrom: today, dateTo: today, limit: 100 }).set(auth('mgmt'));
      const people = new Set(todays.body.data.map((v: any) => v.assigned_to).filter(Boolean));
      expect(fig(body, 'visits', 'travelling').value).toBe(people.size);

      const moved = fig(body, 'visits', 'cancelled_rescheduled');
      expect(chip(moved, 'Cancelled').value).toBe(await total('visits', { status: 'cancelled', dateFrom: P.from, dateTo: P.to }));
      expect(chip(moved, 'Rescheduled').value).toBe(await total('visits', { status: 'rescheduled' }));
    });

    it('demos: the register’s date and outcome filters', async () => {
      const week = fig(body, 'demos', 'upcoming');
      const statuses = 'requested,under_planning,team_assigned,equipment_reserved,rescheduled,confirmed';
      expect(week.href).toContain(`status=${encodeURIComponent(statuses)}`);
      expect(week.value).toBe(await total('demos', { status: statuses, date_from: today, date_to: addIsoDays(today, 6) }));

      const results = fig(body, 'demos', 'results');
      for (const [label, result] of [['Success', 'success'], ['Failed', 'fail'], ['Partial', 'partial']]) {
        expect(chip(results, label).value).toBe(await total('demos', { result, date_from: P.from, date_to: P.to }));
      }
      for (const b of fig(body, 'demos', 'failure_reasons').breakdown) {
        const reason = new URLSearchParams(b.href.split('?')[1]).get('failure_reason');
        expect(b.value).toBe(await total('demos', { result: 'fail', failure_reason: reason, date_from: P.from, date_to: P.to }));
      }
    });

    it('tenders: the register’s deadline, approval, stage and category filters', async () => {
      expect(fig(body, 'tenders', 'deadlines').value).toBe(await total('tenders', { deadline: 'upcoming_7d' }));
      expect(fig(body, 'tenders', 'approvals').value).toBe(await total('tenders', { status: 'awaiting_approval' }));
      for (const [key, category] of [['pq_pipeline', 'pq'], ['general_pipeline', 'general_mha']]) {
        const m = fig(body, 'tenders', key);
        const linked = new URLSearchParams(m.href.split('?')[1]);
        expect(m.value).toBe(await total('tenders', { category, status: linked.get('status') }));
        for (const b of m.breakdown) {
          expect(b.value).toBe(await total('tenders', { category, status: new URLSearchParams(b.href.split('?')[1]).get('status') }));
        }
      }
    });

    it('proposals: the register’s status and follow-up filters', async () => {
      for (const b of fig(body, 'proposals', 'pending').breakdown) {
        expect(b.value).toBe(await total('proposals', { status: new URLSearchParams(b.href.split('?')[1]).get('status') }));
      }
      expect(fig(body, 'proposals', 'followups_overdue').value).toBe(await total('proposals', { overdue: 'true' }));
    });

    it('service: the Service desk tiles and flags', async () => {
      expect(fig(body, 'service', 'open').value).toBe(await total('service/tickets', { stage: 'pending' }));
      expect(fig(body, 'service', 'overdue').value).toBe(await total('service/tickets', { overdue: 'true' }));
      expect(fig(body, 'service', 'repeat').value).toBe(await total('service/tickets', { repeat: 'true' }));
      expect(fig(body, 'service', 'awaiting_parts').value).toBe(await total('service/tickets', { stage: 'awaiting_part' }));
    });

    it('team: overdue tasks per person, attention and on-time from the Productivity report', async () => {
      const overdue = fig(body, 'team', 'tasks_overdue');
      expect(overdue.value).toBe(await total('tasks', { view: 'all', statuses: 'overdue' }));
      for (const b of overdue.breakdown) {
        const assignee = new URLSearchParams(b.href.split('?')[1]).get('assignee_ids');
        expect(b.value).toBe(await total('tasks', { view: 'all', statuses: 'overdue', assignee_ids: assignee }));
      }
      const report = (await api().get('/api/reports/productivity').query(P).set(auth('mgmt'))).body;
      expect(fig(body, 'team', 'attention').value).toBe(report.totals.needing_attention);
      expect(fig(body, 'team', 'productivity').value).toBe(report.totals.tasks.on_time_pct);
    });

    it('expenses: the Expenses page stage groups', async () => {
      const pending = fig(body, 'expenses', 'pending_approvals');
      expect(chip(pending, 'With managers').value).toBe(await total('expense-claims', { statuses: 'submitted', relevant_only: 'true' }));
      expect(chip(pending, 'With accounts').value).toBe(
        await total('expense-claims', { statuses: 'manager_approved,accounts_review,accounts_approved', relevant_only: 'true' }),
      );
      expect(chip(pending, 'With accounts').href).toBe('/expenses?stage=accounts');
    });

    it('results match Module 9 for the same period', async () => {
      const m9 = (await api().get('/api/dashboard/sales-performance').query({ ...P, group_by: 'region' }).set(auth('mgmt'))).body;
      expect(fig(body, 'sales', 'new_opportunities').value).toBe(m9.totals.lead.new + m9.totals.lead.reapproached);
      expect(fig(body, 'sales', 'conversion').value).toBe(m9.totals.lead.conversion_rate);
      expect(fig(body, 'tenders', 'won_lost').value).toBe(m9.totals.tender.won + m9.totals.tender.lost);
      expect(fig(body, 'tenders', 'won_lost').href).toBe(`/regional/performance?from=${P.from}&to=${P.to}&group_by=region`);
    });
  });

  it('every home screen and badge counts closing bids with the register’s rule', async () => {
    for (const who of ['mgmt', 'rmN', 'tender']) {
      const register = await total('tenders', { deadline: 'upcoming_7d' }, who);
      expect((await api().get('/api/dashboard/nav-counts').set(auth(who))).body.tendersClosing7d).toBe(register);
    }
    const rmHome = (await api().get('/api/dashboard/workspace').set(auth('rmN'))).body;
    expect(rmHome.numbers.tendersClosing7d).toBe(await total('tenders', { deadline: 'upcoming_7d' }, 'rmN'));
  });

  describe('a new exception shows up at once, in the figure and in its list', () => {
    let org: string;
    beforeAll(async () => {
      org = await ins('organisations', { name: s(`${STAMP} Command Org`), city: s(CITY), created_by: s(uid.sales) });
    });

    it('an overdue lead follow-up', async () => {
      const before = fig(await command(), 'sales', 'followups_overdue').value;
      const lead = await ins('leads', { organisation_id: s(org), assigned_to: s(uid.sales), lead_type: s('fresh'), lead_status: s('contacted') });
      await ins('follow_ups', { lead_id: s(lead), organisation_id: s(org), assigned_to: s(uid.sales), status: s('pending'), due_date: s(addIsoDays(today, -2)) });
      const m = fig(await command(), 'sales', 'followups_overdue');
      expect(m.value).toBe(before + 1);
      expect(m.tone).toBe('warning');
      expect(await total('leads', { followup: 'overdue' })).toBe(m.value);
    });

    it('two visits in one city a couple of days apart are a trip to combine', async () => {
      const before = fig(await command(), 'visits', 'combine').value;
      await ins('visits', { organisation_id: s(org), assigned_to: s(uid.sales), planned_date: s(addIsoDays(today, 2)), status: s('planned') });
      await ins('visits', { organisation_id: s(org), assigned_to: s(uid.rmN), planned_date: s(addIsoDays(today, 4)), status: s('planned') });
      // a visit already done does not count
      await ins('visits', { organisation_id: s(org), assigned_to: s(uid.rmN), planned_date: s(addIsoDays(today, 3)), status: s('completed') });
      const m = fig(await command(), 'visits', 'combine');
      expect(m.value).toBe(before + 1);
      const mine = (await q(`select 1 from visits v join organisations o on o.id = v.organisation_id where o.city = '${CITY}' and v.status = 'planned'`)).length;
      expect(mine).toBe(2);
      if (m.items.length < 5) expect(m.items.map((i: any) => i.title)).toContain(CITY);
    });

    it('the same demo unit booked twice for overlapping days is a critical conflict', async () => {
      const before = fig(await command(), 'demos', 'equipment_conflicts').value;
      const unit = await ins('demo_equipment', { model: s(`${STAMP} XBIS`), serial_no: s(`${STAMP}-SN`) });
      const demo = (day: string) => ins('demos', { organisation_id: s(org), requested_by: s(uid.sales), status: s('confirmed'), confirmed_date: s(day) });
      const a = await demo(addIsoDays(today, 3));
      const b = await demo(addIsoDays(today, 4));
      await ins('demo_reservations', { demo_id: s(a), equipment_id: s(unit), reserved_from: s(addIsoDays(today, 3)), reserved_to: s(addIsoDays(today, 5)), status: s('approved') });
      await ins('demo_reservations', { demo_id: s(b), equipment_id: s(unit), reserved_from: s(addIsoDays(today, 4)), reserved_to: s(addIsoDays(today, 6)), status: s('approved') });
      const m = fig(await command(), 'demos', 'equipment_conflicts');
      expect(m.value).toBe(before + 1);
      expect(m.tone).toBe('critical');
      expect(m.items.map((i: any) => i.title)).toContain(`${STAMP} XBIS`);
    });
  });

  describe('each manager chooses what the dashboard shows', () => {
    afterAll(async () => {
      await api().delete('/api/dashboard/command/layout').set(auth('mgmt'));
    });

    it('order, hidden sections and figures, period and "only what needs action" are saved and applied', async () => {
      const res = await setLayout({
        sections: [
          { key: 'service', hidden: false, hidden_items: ['repeat'] },
          { key: 'tenders', hidden: false, hidden_items: [] },
          { key: 'sales', hidden: true, hidden_items: [] },
        ],
        period: 7,
        only_exceptions: true,
      });
      expect(res.status).toBe(200);
      // sections left out are appended (shown) in catalogue order
      expect(res.body.sections.map((x: any) => x.key)).toEqual(['service', 'tenders', 'sales', 'visits', 'demos', 'proposals', 'team', 'expenses']);

      const body = await command();
      expect(body.layout.only_exceptions).toBe(true);
      expect(body.period).toEqual({ days: 7, from: addIsoDays(today, -6), to: today });
      expect(body.sections.map((x: any) => x.key)).toEqual(['service', 'tenders', 'visits', 'demos', 'proposals', 'team', 'expenses']);
      expect(body.sections[0].metrics.map((m: any) => m.key)).toEqual(['open', 'overdue', 'awaiting_parts']);
    });

    it('a layout is personal: the administrator still sees the default', async () => {
      const body = await command('admin');
      expect(body.sections).toHaveLength(8);
      expect(body.period.days).toBe(30);
    });

    it('junk is cleaned, not saved: unknown sections and figures, repeats, a period that is not offered', async () => {
      const res = await setLayout({
        sections: [
          { key: 'payroll', hidden: false, hidden_items: [] },
          { key: 'team', hidden: 'yes', hidden_items: ['tasks_overdue', 'salary', 42, 'tasks_overdue'] },
          { key: 'team', hidden: true, hidden_items: [] },
        ],
        period: 45,
        only_exceptions: 'sometimes',
      });
      expect(res.status).toBe(200);
      expect(res.body.period).toBe(30);
      expect(res.body.only_exceptions).toBe(false);
      expect(res.body.sections[0]).toEqual({ key: 'team', hidden: false, hidden_items: ['tasks_overdue'] });
      expect(res.body.sections).toHaveLength(8);
      expect((await setLayout('not a layout' as any)).status).toBe(400);
      expect((await setLayout({ colour: 'blue' })).status).toBe(400);
    });

    it('a partial layout changes only that part', async () => {
      await setLayout({ sections: [{ key: 'demos', hidden: true, hidden_items: [] }] });
      const res = await setLayout({ period: 90 });
      expect(res.body.period).toBe(90);
      expect(res.body.sections.find((x: any) => x.key === 'demos').hidden).toBe(true);
    });

    it('hiding every figure of a section hides the section; reset brings the default back', async () => {
      await setLayout({ sections: [{ key: 'expenses', hidden: false, hidden_items: ['pending_approvals', 'rejected', 'outstanding'] }], period: 30 });
      expect((await command()).sections.map((x: any) => x.key)).not.toContain('expenses');
      const reset = await api().delete('/api/dashboard/command/layout').set(auth('mgmt'));
      expect(reset.status).toBe(200);
      expect((await command()).sections).toHaveLength(8);
    });
  });

  it('a module the administrator switched off for management drops out of its dashboard', async () => {
    const off = await api().patch('/api/admin/access/management/service').set(auth('admin')).send({ blocked: true, reason: 'Service desk moving to a new system' });
    expect(off.status).toBe(200);
    const body = await command('mgmt');
    expect(body.unavailable).toEqual(['service']);
    expect(body.sections.map((x: any) => x.key)).not.toContain('service');
    // the administrator keeps it
    expect((await command('admin')).sections.map((x: any) => x.key)).toContain('service');
    expect((await api().patch('/api/admin/access/management/service').set(auth('admin')).send({ blocked: false })).status).toBe(200);
    expect((await command('mgmt')).sections.map((x: any) => x.key)).toContain('service');
  });
});
