import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Kysely, sql } from 'kysely';
import { createHash, randomInt } from 'crypto';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { nameSimilarity, normalizePhone } from '../src/modules/service/service-portal.service';
import { advanceTicket, validReport } from './helpers/service-flow';

/**
 * The public customer service-request form and everything it triggers. No customer login:
 * the reference + private tracking code are the only credentials. Test data carries ZZTEST and
 * is removed afterwards. Each test uses its own X-Forwarded-For so per-IP limits don't interfere.
 */
describe('Module 6 — public customer portal: intake, triggers, tracking, feedback', () => {
  let app: INestApplication;
  let db: Kysely<any>;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};

  // a customer we already serve, with a lead owner, in a known zone
  let known: { id: string; name: string; city: string; zone_id: string; region_id: string | null; owner: string };
  let rmOfKnown: string;

  let ipSeq = 0;
  const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  const nextPhone = () => `9${randomInt(100000000, 999999999)}`;
  const uniq = () => `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
  const tomorrow = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const api = () => request(app.getHttpServer());
  const auth = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const sql1 = async (q: string) => (await sql.raw(q).execute(db)).rows as any[];
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');

  const valid = (over: Record<string, any> = {}) => ({
    organisation_name: 'ZZTEST Frontier Unit',
    city: 'Patna',
    state: 'Bihar',
    contact_name: 'ZZTEST Ramesh Kumar',
    contact_phone: nextPhone(),
    complaint: `ZZTEST The baggage scanner conveyor stopped during the morning shift ${uniq()}`,
    urgency: 'major_impairment',
    problem_category: 'Breakdown',
    consent: true,
    ...over,
  });
  const submit = (body: Record<string, any>, ip = nextIp()) => api().post('/api/public/service-requests').set('X-Forwarded-For', ip).send(body);
  const track = (ref: string, token: string, ip = nextIp()) => api().get(`/api/public/service-requests/track`).query({ ref, token }).set('X-Forwarded-For', ip);

  async function mkTicket(over: Record<string, any> = {}, ip = nextIp()) {
    const r = await submit(valid(over), ip);
    if (r.status !== 201 || !r.body.tracking_token) throw new Error(`submit failed ${r.status} ${JSON.stringify(r.body)}`);
    const t = (await sql1(`select * from service_tickets where ticket_no='${r.body.reference}'`))[0];
    return { ref: r.body.reference as string, token: r.body.tracking_token as string, id: t.id as string, ip, body: r.body };
  }
  async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v as T;
      if (Date.now() - start > ms) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  async function login(key: string, email: string) {
    const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
    expect([200, 201]).toContain(r.status);
    tok[key] = r.body.accessToken;
    uid[key] = r.body.user.id;
  }
  const patch = (id: string, body: Record<string, any>, who = 'mgmt') => api().patch(`/api/service/tickets/${id}/status`).set(auth(who)).send(body);
  const staffGet = async (id: string, who = 'mgmt') => (await api().get(`/api/service/tickets/${id}`).set(auth(who))).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    db = app.get(KYSELY_DB);

    for (const [k, e] of Object.entries({
      mgmt: 'mgmt@arihant.com', admin: 'admin@arihant.com', rmN: 'regmgr.north@arihant.com', rmE: 'regmgr.east@arihant.com',
      svc: 'service@arihant.com', svc2: 'service.field@arihant.com', sales: 'sales.delhi@arihant.com', accounts: 'accounts@arihant.com',
    })) await login(k, e);

    const k0 = (
      await sql1(
        `select o.id, o.name, o.city, o.zone_id, o.region_id, l.assigned_to as owner
           from organisations o join leads l on l.organisation_id = o.id
          where l.assigned_to is not null and o.city is not null and o.zone_id is not null and o.name not like 'Test Enterprise%'
            and o.id <> '00000000-0000-4000-8000-0000000000a1'
          order by o.created_at asc limit 1`,
      )
    )[0];
    known = k0 || (await sql1(`select o.id, o.name, o.city, o.zone_id, o.region_id, null as owner from organisations o where o.city is not null and o.zone_id is not null limit 1`))[0];
    rmOfKnown = (await sql1(`select id from users where role='regional_manager' and zone_id='${known.zone_id}' limit 1`))[0]?.id;
  });

  afterAll(async () => {
    const ids = (await sql1(`select id from service_tickets where complaint like '%ZZTEST%'`)).map((r) => r.id);
    if (ids.length) {
      const list = ids.map((i) => `'${i}'`).join(',');
      await sql1(`delete from notifications where entity_id in (${list})`);
      await sql1(`delete from audit_log where entity_id in (${list})`);
      await sql1(`delete from outbox_events where aggregate_id in (${list})`);
      await sql1(`delete from service_tickets where id in (${list})`);
    }
    await sql1(`delete from service_intake_requests where complaint like '%ZZTEST%'`);
    await sql1(`delete from interactions where remarks like '%ZZTEST%'`);
    await sql1(`delete from contacts where full_name like 'ZZTEST%'`);
    await sql1(`update service_settings set value='false'::jsonb where key='auto_assign_portal_tickets'`);
    await sql1(`update service_settings set value='true'::jsonb where key='portal_enabled'`);
    await app.close();
  });

  // ===========================================================================
  // 1. Helpers that decide who a customer is
  // ===========================================================================
  describe('1. Matching & parsing helpers', () => {
    it('normalizePhone accepts Indian mobiles in common formats and rejects junk', () => {
      expect(normalizePhone('9811003301')).toBe('+919811003301');
      expect(normalizePhone('+91 98110 03301')).toBe('+919811003301');
      expect(normalizePhone('09811003301')).toBe('+919811003301');
      expect(normalizePhone('91-9811003301')).toBe('+919811003301');
      expect(normalizePhone('011 2345 6789')).toBe('1123456789'); // landline with STD (leading 0 dropped)
      expect(normalizePhone('0522-2345678')).toBe('5222345678'); // Lucknow STD 0522: starts with 5 and is valid
      for (const bad of ['', 'abcdefghij', '12345', '0000000000', '98110033011234', null, undefined, '1234567']) {
        expect(normalizePhone(bad as any)).toBeNull();
      }
    });

    it('nameSimilarity ignores filler words and is symmetric', () => {
      expect(nameSimilarity('Force Headquarters BSF New Delhi', 'BSF Force Head Quarter New Delhi')).toBeGreaterThan(0.6);
      expect(nameSimilarity('CRPF Group Centre Jodhpur', 'CRPF Group Centre Jodhpur')).toBe(1);
      expect(nameSimilarity('The Office of the', 'of the')).toBe(0); // nothing meaningful left
      expect(nameSimilarity('Delhi Police', 'Kolkata Police')).toBe(0);
      expect(nameSimilarity('Airports Authority Patna', 'Patna Airports Authority')).toBe(nameSimilarity('Patna Airports Authority', 'Airports Authority Patna'));
    });
  });

  // ===========================================================================
  // 2. Form metadata & the master switch
  // ===========================================================================
  describe('2. Public metadata & kill switch', () => {
    it('serves the form options without any login and never leaks the customer list', async () => {
      const r = await api().get('/api/public/service-requests/meta');
      expect(r.status).toBe(200);
      expect(r.body.products.length).toBeGreaterThan(0);
      expect(r.body.states).toContain('Bihar');
      expect(r.body.urgencies.map((u: any) => u.value)).toEqual(['equipment_down', 'major_impairment', 'minor_issue', 'general_query']);
      expect(r.body.limits.complaint.min).toBe(20);
      expect(JSON.stringify(r.body)).not.toContain(known.name);
      expect(r.body.organisations).toBeUndefined();
    });

    it('the master switch turns both the form and its options off with a 503', async () => {
      await sql1(`update service_settings set value='false'::jsonb where key='portal_enabled'`);
      try {
        expect((await api().get('/api/public/service-requests/meta')).status).toBe(503);
        const r = await submit(valid());
        expect(r.status).toBe(503);
        expect(r.body.message).toContain('service desk');
      } finally {
        await sql1(`update service_settings set value='true'::jsonb where key='portal_enabled'`);
      }
      expect((await api().get('/api/public/service-requests/meta')).status).toBe(200);
    });
  });

  // ===========================================================================
  // 3. Happy path
  // ===========================================================================
  describe('3. Submitting a request', () => {
    it('a minimal valid request becomes a ticket with a reference, private token and SLA targets', async () => {
      const r = await submit(valid());
      expect(r.status).toBe(201);
      expect(r.body.accepted).toBe(true);
      expect(r.body.reference).toMatch(/^TCK-\d{4}-\d{6,}$/);
      expect(r.body.tracking_token.length).toBeGreaterThanOrEqual(20);
      expect(r.body.track_path).toContain(`ref=${r.body.reference}`);
      expect(r.body.status).toBe('received');
      expect(r.body.response_target_hours).toBeGreaterThan(0);
      expect(new Date(r.body.response_due_at).getTime()).toBeGreaterThan(Date.now());

      const t = (await sql1(`select * from service_tickets where ticket_no='${r.body.reference}'`))[0];
      expect(t.status).toBe('received');
      expect(t.complaint_source).toBe('Customer Portal');
      expect(t.created_by).toBeNull();
      expect(t.priority).toBe('high');
      expect(t.sla_response_due_at).toBeTruthy();
      expect(t.sla_resolution_due_at).toBeTruthy();
      expect(t.intake_request_id).toBeTruthy();
      expect(t.is_chargeable).toBe(false);

      const intake = (await sql1(`select * from service_intake_requests where id='${t.intake_request_id}'`))[0];
      expect(intake.status).toBe('converted');
      expect(intake.ticket_id).toBe(t.id);
      expect(intake.reference).toBe(r.body.reference);
      expect(intake.contact_phone).toMatch(/^\+91[6-9]\d{9}$/);
      // only a hash of the code is stored
      expect(intake.tracking_token_hash).toBe(sha(r.body.tracking_token));
      expect(JSON.stringify(intake)).not.toContain(r.body.tracking_token);
    });

    it.each([
      ['equipment_down', 'critical'],
      ['major_impairment', 'high'],
      ['minor_issue', 'medium'],
      ['general_query', 'low'],
    ])('customer urgency %s maps to %s priority with the matching SLA', async (urgency, priority) => {
      const r = await submit(valid({ urgency }));
      expect(r.status).toBe(201);
      const t = (await sql1(`select priority, sla_response_due_at, created_at from service_tickets where ticket_no='${r.body.reference}'`))[0];
      expect(t.priority).toBe(priority);
      const hours = (new Date(t.sla_response_due_at).getTime() - new Date(t.created_at).getTime()) / 3600000;
      expect(hours).toBeGreaterThan(0);
      if (priority === 'critical') expect(hours).toBeLessThan(2.1);
      if (urgency === 'equipment_down') expect(r.body.customer_message).toContain('CRITICAL');
    });

    it('accepts every optional field, the listed product, and a preferred visit date', async () => {
      const product = (await sql1(`select id from products limit 1`))[0].id;
      const r = await submit(
        valid({
          department: 'Signals Wing',
          location: 'Gate 3 baggage bay, Terminal 1',
          contact_designation: 'Station Security Officer',
          contact_email: 'Officer.Test@Example.COM',
          product_id: product,
          equipment_serial: `ZZ-SER/${uniq()}`,
          site_access_notes: 'Visitors need a gate pass; ask for the duty officer',
          preferred_visit_date: tomorrow(),
        }),
      );
      expect(r.status).toBe(201);
      const t = (await sql1(`select * from service_tickets where ticket_no='${r.body.reference}'`))[0];
      expect(t.product_id).toBe(product);
      expect(t.location).toBe('Gate 3 baggage bay, Terminal 1');
      expect(t.complaint).toContain(`Customer's preferred visit date: ${tomorrow()}`);
      expect(t.complaint).toContain('Site access notes');
      const intake = (await sql1(`select contact_email, contact_designation from service_intake_requests where id='${t.intake_request_id}'`))[0];
      expect(intake.contact_email).toBe('officer.test@example.com'); // normalised
      expect(intake.contact_designation).toBe('Station Security Officer');
    });

    it('a stated but unlisted product is recorded in the complaint, not guessed', async () => {
      const r = await submit(valid({ product_text: 'Old Smiths X-ray (model unknown)' }));
      expect(r.status).toBe(201);
      const t = (await sql1(`select complaint, product_id from service_tickets where ticket_no='${r.body.reference}'`))[0];
      expect(t.product_id).toBeNull();
      expect(t.complaint).toContain('Equipment stated by customer: Old Smiths X-ray (model unknown)');
    });

    it('maps the customer’s state to a zone/region so the right regional manager sees it', async () => {
      const bihar = await mkTicket({ state: 'Bihar' });
      const delhi = await mkTicket({ state: 'Delhi' });
      const zone = async (id: string) => (await sql1(`select z.code from service_tickets t join regions r on r.id=t.region_id join zones z on z.id=r.zone_id where t.id='${id}'`))[0]?.code;
      expect(await zone(bihar.id)).toBe('E');
      expect(await zone(delhi.id)).toBe('N');
      expect((await api().get(`/api/service/tickets/${bihar.id}`).set(auth('rmE'))).status).toBe(200);
      expect((await api().get(`/api/service/tickets/${bihar.id}`).set(auth('rmN'))).status).toBe(403);
      expect((await api().get(`/api/service/tickets/${delhi.id}`).set(auth('rmN'))).status).toBe(200);
      expect((await api().get(`/api/service/tickets/${delhi.id}`).set(auth('rmE'))).status).toBe(403);
    });

    it('does not reveal whether the organisation exists in the response', async () => {
      const a = await submit(valid({ organisation_name: known.name, city: known.city }));
      const b = await submit(valid({ organisation_name: 'ZZTEST Nobody Has Heard Of This Unit' }));
      expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
      for (const body of [a.body, b.body]) {
        expect(JSON.stringify(body)).not.toMatch(/organisation|matched|verified|zone/i);
      }
    });

    it('10 simultaneous submissions from different people all succeed with unique references', async () => {
      const rs = await Promise.all(Array.from({ length: 10 }, () => submit(valid())));
      expect(rs.every((r) => r.status === 201)).toBe(true);
      expect(new Set(rs.map((r) => r.body.reference)).size).toBe(10);
      expect(new Set(rs.map((r) => r.body.tracking_token)).size).toBe(10);
    });
  });

  // ===========================================================================
  // 4. Validation
  // ===========================================================================
  describe('4. Validation: every bad input is a readable 400, never a 500', () => {
    const past = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const far = new Date(Date.now() + 120 * 86400000).toISOString().split('T')[0];

    it.each([
      ['missing organisation', { organisation_name: undefined }, 'Organisation'],
      ['organisation too short', { organisation_name: 'ab' }, 'Organisation'],
      ['organisation only HTML', { organisation_name: '<b></b>' }, 'Organisation'],
      ['missing city', { city: undefined }, 'City'],
      ['one-letter city', { city: 'P' }, 'City'],
      ['state not in the list', { state: 'Atlantis' }, 'state'],
      ['missing state', { state: undefined }, 'state'],
      ['missing contact name', { contact_name: undefined }, 'name'],
      ['numeric contact name', { contact_name: '12345' }, 'name'],
      ['contact name with symbols', { contact_name: 'Ra@#$%' }, 'name'],
      ['missing phone', { contact_phone: undefined }, 'mobile'],
      ['short phone', { contact_phone: '98110' }, 'mobile'],
      ['phone with letters', { contact_phone: 'call me maybe' }, 'mobile'],
      ['phone that is only zeros', { contact_phone: '0000000000' }, 'mobile'],
      ['invalid email', { contact_email: 'not-an-email' }, 'e-mail'],
      ['email with spaces', { contact_email: 'a b@c.com' }, 'e-mail'],
      ['serial with bad characters', { equipment_serial: 'SN;DROP TABLE' }, 'Serial'],
      ['serial too long', { equipment_serial: 'S'.repeat(81) }, 'Serial'],
      ['product id not a uuid', { product_id: 'abc' }, 'equipment'],
      ['unknown product id', { product_id: '99999999-9999-4999-8999-999999999999' }, 'equipment'],
      ['invalid problem type', { problem_category: 'Haunted' }, 'problem type'],
      ['complaint too short', { complaint: 'It broke' }, 'at least 20'],
      ['complaint is one repeated word', { complaint: 'brokenbrokenbrokenbrokenbrokenbroken' }, 'few words'],
      ['complaint missing', { complaint: undefined }, 'at least 20'],
      ['complaint only tags', { complaint: '<p></p><p></p><p></p><p></p><p></p>' }, 'at least 20'],
      ['complaint over 8000 chars', { complaint: 'word '.repeat(2000) }, 'shorter than'],
      ['missing urgency', { urgency: undefined }, 'urgent'],
      ['unknown urgency', { urgency: 'whenever' }, 'urgent'],
      ['visit date in the past', { preferred_visit_date: past }, 'past'],
      ['visit date beyond 90 days', { preferred_visit_date: far }, '90 days'],
      ['visit date not a date', { preferred_visit_date: 'next week' }, 'valid date'],
      ['impossible calendar date', { preferred_visit_date: '2026-02-31' }, 'valid date'],
      ['consent false', { consent: false }, 'confirm'],
      ['consent missing', { consent: undefined }, 'confirm'],
    ])('rejects: %s', async (_n, over, snippet) => {
      const r = await submit(valid(over as any));
      expect(r.status).toBe(400);
      const msgs = Array.isArray(r.body.message) ? r.body.message : [r.body.message];
      expect(msgs.join(' | ').toLowerCase()).toContain(String(snippet).toLowerCase());
    });

    it('a name that is only markup is rejected, markup around a real name is stripped', async () => {
      expect((await submit(valid({ contact_name: '<script></script>' }))).status).toBe(400);
      // the script body is left behind as text, which is not a valid name either
      expect((await submit(valid({ contact_name: 'Ramesh<script>alert(1)</script> Kumar' }))).status).toBe(400);
      const ok = await submit(valid({ contact_name: 'ZZTEST Ramesh<b>X</b> Kumar' }));
      expect(ok.status).toBe(201);
      const intake = (await sql1(`select contact_name from service_intake_requests where reference='${ok.body.reference}'`))[0];
      expect(intake.contact_name).not.toContain('<');
    });

    it('reports every problem at once, not just the first', async () => {
      const r = await submit({ organisation_name: 'x', city: '', state: 'Nowhere', contact_name: '1', contact_phone: '1', complaint: 'x', urgency: 'x', consent: false });
      expect(r.status).toBe(400);
      expect(r.body.message.length).toBeGreaterThanOrEqual(7);
    });

    it('an empty body, a wrong content type and non-string types are handled cleanly', async () => {
      expect((await api().post('/api/public/service-requests').set('X-Forwarded-For', nextIp()).send({})).status).toBe(400);
      expect((await api().post('/api/public/service-requests').set('X-Forwarded-For', nextIp()).send({ ...valid(), organisation_name: 12345 })).status).toBe(400);
      expect((await api().post('/api/public/service-requests').set('X-Forwarded-For', nextIp()).send({ ...valid(), consent: 'true' })).status).toBe(400);
      const text = await api().post('/api/public/service-requests').set('X-Forwarded-For', nextIp()).set('Content-Type', 'text/plain').send('not json');
      expect(text.status).toBeLessThan(500);
    });

    it('fields at their exact limits are accepted', async () => {
      const r = await submit(valid({ organisation_name: 'ZZTEST ' + 'U'.repeat(153), complaint: ('ZZTEST ' + 'word '.repeat(790)).slice(0, 3900), location: 'L'.repeat(300), equipment_serial: 'A'.repeat(80) }));
      expect(r.status).toBe(201);
    });

    it('accepts Hindi / unicode names and text', async () => {
      const r = await submit(valid({ contact_name: 'ZZTEST राजेश कुमार', complaint: 'ZZTEST बैगेज स्कैनर की कन्वेयर बेल्ट सुबह की शिफ्ट में रुक गई है' }));
      expect(r.status).toBe(201);
      const t = (await sql1(`select complaint from service_tickets where ticket_no='${r.body.reference}'`))[0];
      expect(t.complaint).toContain('कन्वेयर बेल्ट');
    });
  });

  // ===========================================================================
  // 5. Sanitisation & injection
  // ===========================================================================
  describe('5. Hostile input is stored as inert text', () => {
    it('strips HTML and control characters from everything stored', async () => {
      const r = await submit(
        valid({
          organisation_name: 'ZZTEST <img src=x onerror=alert(1)>Border Unit',
          complaint: 'ZZTEST <script>alert(document.cookie)</script>Scanner belt jams \u0007\u0000 at gate three repeatedly',
          location: '<iframe src=//evil></iframe>Gate 3',
          site_access_notes: '<b>Ask</b> for the duty officer',
        }),
      );
      expect(r.status).toBe(201);
      const t = (await sql1(`select complaint, location from service_tickets where ticket_no='${r.body.reference}'`))[0];
      const intake = (await sql1(`select claimed_organisation, complaint, site_access_notes from service_intake_requests where reference='${r.body.reference}'`))[0];
      for (const text of [t.complaint, t.location, intake.claimed_organisation, intake.complaint, intake.site_access_notes]) {
        expect(text).not.toMatch(/<[a-z!/]/i);
        expect(text).not.toMatch(/[\u0000-\u0008]/);
      }
      expect(intake.claimed_organisation).toContain('Border Unit');
    });

    it.each([
      "ZZTEST '; DROP TABLE service_tickets; -- the scanner stopped on the belt",
      'ZZTEST " OR 1=1 -- the scanner stopped working on the main belt',
      'ZZTEST ${process.env.DATABASE_URL} the scanner stopped on the belt today',
      'ZZTEST {{7*7}} %s %n the scanner stopped on the belt today at noon',
    ])('SQL / template injection strings do nothing: %s', async (complaint) => {
      const before = (await sql1(`select count(*)::int n from service_tickets`))[0].n;
      const r = await submit(valid({ complaint, organisation_name: `ZZTEST ${complaint.slice(7, 30)}` }));
      expect(r.status).toBe(201);
      expect((await sql1(`select count(*)::int n from service_tickets`))[0].n).toBe(before + 1);
      const t = (await sql1(`select complaint from service_tickets where ticket_no='${r.body.reference}'`))[0];
      expect(t.complaint).toContain(complaint.slice(0, 30));
    });
  });

  // ===========================================================================
  // 6. Anti-abuse
  // ===========================================================================
  describe('6. Bots, duplicates and rate limits', () => {
    it('a filled honeypot looks like success but creates nothing', async () => {
      const before = (await sql1(`select count(*)::int n from service_tickets`))[0].n;
      const r = await submit(valid({ website: 'http://spam.example', complaint: 'ZZTEST honeypot bot filled the hidden field in this form' }));
      expect(r.status).toBe(201);
      expect(r.body.accepted).toBe(true);
      expect(r.body.tracking_token).toBeUndefined();
      expect((await sql1(`select count(*)::int n from service_tickets`))[0].n).toBe(before);
      expect((await sql1(`select count(*)::int n from service_intake_requests where complaint like '%honeypot bot%'`))[0].n).toBe(0);
    });

    it('a form submitted faster than a human can type creates nothing; a normal fill time works', async () => {
      const before = (await sql1(`select count(*)::int n from service_tickets`))[0].n;
      const fast = await submit(valid({ form_started_at: Date.now() - 300 }));
      expect(fast.status).toBe(201);
      expect(fast.body.tracking_token).toBeUndefined();
      expect((await sql1(`select count(*)::int n from service_tickets`))[0].n).toBe(before);
      const slow = await submit(valid({ form_started_at: Date.now() - 45000 }));
      expect(slow.body.tracking_token).toBeDefined();
    });

    it('the same person re-sending the same text (double click) gets the original reference, not a second ticket', async () => {
      const phone = nextPhone();
      const body = valid({ contact_phone: phone });
      const first = await submit(body);
      const again = await submit(body);
      expect(again.status).toBe(201);
      expect(again.body.duplicate).toBe(true);
      expect(again.body.reference).toBe(first.body.reference);
      expect(again.body.tracking_token).toBeUndefined(); // the original code is never re-issued
      expect((await sql1(`select count(*)::int n from service_tickets where ticket_no='${first.body.reference}'`))[0].n).toBe(1);
      const dupRows = (await sql1(`select count(*)::int n from service_intake_requests where contact_phone='${normalizePhone(phone)}'`))[0].n;
      expect(dupRows).toBe(1);
      // different text from the same number is a new request
      const other = await submit(valid({ contact_phone: phone, complaint: `ZZTEST a completely different DFMD alarm fault ${uniq()}` }));
      expect(other.body.reference).not.toBe(first.body.reference);
    });

    it('9th request from one address in an hour is throttled with a Retry-After hint; other addresses are unaffected', async () => {
      const ip = nextIp();
      const codes: number[] = [];
      for (let i = 0; i < 9; i++) codes.push((await submit(valid(), ip)).status);
      expect(codes.slice(0, 8).every((c) => c === 201)).toBe(true);
      const blocked = await submit(valid(), ip);
      expect(codes[8]).toBe(429);
      expect(blocked.status).toBe(429);
      expect(blocked.body.retry_after_seconds).toBeGreaterThan(0);
      expect((await submit(valid(), nextIp())).status).toBe(201);
    });

    it('a single phone number is capped per day even when the address keeps changing', async () => {
      const phone = nextPhone();
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) codes.push((await submit(valid({ contact_phone: phone, complaint: `ZZTEST fault number ${i} on the DFMD gate ${uniq()}` }), nextIp())).status);
      expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
      expect(codes[10]).toBe(429);
    });
  });

  // ===========================================================================
  // 7. Which customer is it?
  // ===========================================================================
  describe('7. Customer matching', () => {
    it('an unknown customer lands on the holding organisation, clearly flagged for triage', async () => {
      const t = await mkTicket({ organisation_name: 'ZZTEST Quartermaster Stores Unknownpur' });
      const row = (await sql1(`select * from service_tickets where id='${t.id}'`))[0];
      expect(row.organisation_id).toBe('00000000-0000-4000-8000-0000000000a1');
      expect(row.claimed_organisation_name).toBe('ZZTEST Quartermaster Stores Unknownpur');
      expect(row.equipment_unverified).toBe(true);
      expect(row.complaint).toContain('UNVERIFIED CUSTOMER');
      // no CRM contact is created for an unverified customer
      expect((await sql1(`select count(*)::int n from contacts where mobile = (select contact_phone from service_intake_requests where reference='${t.ref}')`))[0].n).toBe(0);
      const intake = (await sql1(`select match_method from service_intake_requests where reference='${t.ref}'`))[0];
      expect(intake.match_method).toBe('none');
    });

    it('an exact customer name + city links to the real organisation and adds a CRM contact and timeline entry', async () => {
      const t = await mkTicket({ organisation_name: known.name, city: known.city });
      const row = (await sql1(`select * from service_tickets where id='${t.id}'`))[0];
      expect(row.organisation_id).toBe(known.id);
      expect(row.claimed_organisation_name).toBeNull();
      expect(row.contact_id).toBeTruthy();
      const contact = (await sql1(`select * from contacts where id='${row.contact_id}'`))[0];
      expect(contact.organisation_id).toBe(known.id);
      expect(contact.full_name).toBe('ZZTEST Ramesh Kumar');
      const intake = (await sql1(`select match_method, match_confidence from service_intake_requests where reference='${t.ref}'`))[0];
      expect(['name_city', 'name']).toContain(intake.match_method);
      expect(Number(intake.match_confidence)).toBeGreaterThan(0.6);
      const tl = await sql1(`select id from interactions where organisation_id='${known.id}' and remarks like '%${t.ref}%'`);
      expect(tl.length).toBe(1);
    });

    it('re-using a customer’s contact number does not create a duplicate contact', async () => {
      const phone = nextPhone();
      const a = await mkTicket({ organisation_name: known.name, city: known.city, contact_phone: phone });
      const b = await mkTicket({ organisation_name: known.name, city: known.city, contact_phone: phone, complaint: `ZZTEST second separate fault on a different unit ${uniq()}` });
      const ca = (await sql1(`select contact_id from service_tickets where id='${a.id}'`))[0].contact_id;
      const cb = (await sql1(`select contact_id from service_tickets where id='${b.id}'`))[0].contact_id;
      expect(ca).toBe(cb);
    });

    it('a known serial number links the machine to its owner even when the typed name is sloppy', async () => {
      const serial = `ZZTESTPSER${uniq()}`;
      const staff = await api().post('/api/service/tickets').set(auth('mgmt')).send({ organisation_id: known.id, complaint: 'ZZTEST earlier breakdown for serial match', equipment_serial: serial });
      expect(staff.status).toBe(201);
      const nameTokens = known.name.split(/\s+/).slice(0, 2).join(' ');
      const t = await mkTicket({ organisation_name: nameTokens, equipment_serial: serial, city: 'Somewhereelse' });
      const row = (await sql1(`select * from service_tickets where id='${t.id}'`))[0];
      expect(row.organisation_id).toBe(known.id);
      expect((await sql1(`select match_method from service_intake_requests where reference='${t.ref}'`))[0].match_method).toBe('serial');
      expect(row.is_repeat_complaint).toBe(true); // same machine, inside the window
      expect(row.parent_ticket_id).toBe(staff.body.id);
    });

    it('a serial that belongs to someone else is NOT trusted when the claimed name has nothing in common', async () => {
      const serial = `ZZTESTCLASH${uniq()}`;
      await api().post('/api/service/tickets').set(auth('mgmt')).send({ organisation_id: known.id, complaint: 'ZZTEST earlier breakdown for clash check', equipment_serial: serial });
      const t = await mkTicket({ organisation_name: 'ZZTEST Totally Different Entity', equipment_serial: serial });
      const row = (await sql1(`select organisation_id, claimed_organisation_name from service_tickets where id='${t.id}'`))[0];
      expect(row.organisation_id).toBe('00000000-0000-4000-8000-0000000000a1');
      expect(row.claimed_organisation_name).toBe('ZZTEST Totally Different Entity');
    });

    it('units that differ only by number are different customers ("Unit 280007" ≠ "Unit 280008")', async () => {
      const numbered = (await sql1(`select id, name, city from organisations where name ~ '[0-9]{4,}' and city is not null limit 1`))[0];
      if (!numbered) return;
      const claimed = numbered.name.replace(/(\d)(?!.*\d)/, (d: string) => String((Number(d) + 1) % 10));
      const t = await mkTicket({ organisation_name: claimed, city: numbered.city });
      const row = (await sql1(`select organisation_id from service_tickets where id='${t.id}'`))[0];
      expect(row.organisation_id).not.toBe(numbered.id);
    });
  });

  // ===========================================================================
  // 8. Everything that triggers after a submission
  // ===========================================================================
  describe('8. Triggers: history, audit, timeline, notifications, outbox, auto-assign', () => {
    it('writes status history, an audit entry and queues the customer acknowledgement', async () => {
      const t = await mkTicket({ organisation_name: known.name, city: known.city });
      const hist = await sql1(`select to_status, reason from ticket_status_history where ticket_id='${t.id}'`);
      expect(hist.length).toBe(1);
      expect(hist[0].to_status).toBe('received');
      expect(hist[0].reason).toContain('customer portal');
      await waitFor(async () => (await sql1(`select id from audit_log where entity_id='${t.id}' and action='create'`))[0]);
      const ack = (await sql1(`select * from outbox_events where aggregate_id='${t.id}' and event_type='service.portal_acknowledgement'`))[0];
      expect(ack).toBeTruthy();
      expect(ack.payload.reference).toBe(t.ref);
      expect(ack.payload.phone).toMatch(/^\+91/);
    });

    it('alerts the service team, the zone’s regional manager and the account owner', async () => {
      const t = await mkTicket({ organisation_name: known.name, city: known.city, urgency: 'minor_issue' });
      const types = async (userId: string) => (await sql1(`select type from notifications where entity_id='${t.id}' and user_id='${userId}'`)).map((r) => r.type);
      await waitFor(async () => (await types(uid.svc)).includes('service_portal_request'));
      if (rmOfKnown) await waitFor(async () => (await types(rmOfKnown)).includes('service_portal_request'));
      if (known.owner) await waitFor(async () => (await types(known.owner)).includes('service_portal_request'));
      const svcIds = (await sql1(`select id from users where role='service_team' and is_active and (zone_id is null or zone_id='${known.zone_id}')`)).map((r) => r.id);
      for (const id of svcIds) expect(await types(id)).toContain('service_portal_request');
      // a routine fault from a verified customer does not bother top management
      const mgmtCount = (await sql1(`select count(*)::int n from notifications where entity_id='${t.id}' and user_id='${uid.mgmt}'`))[0].n;
      expect(mgmtCount).toBe(0);
    });

    it('critical, repeat or unverified requests also reach management', async () => {
      const crit = await mkTicket({ organisation_name: known.name, city: known.city, urgency: 'equipment_down' });
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${crit.id}' and user_id='${uid.mgmt}'`))[0]);
      const unv = await mkTicket({ organisation_name: 'ZZTEST Unverified Outpost Alpha', urgency: 'minor_issue' });
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${unv.id}' and user_id='${uid.mgmt}'`))[0]);
      const msg = (await sql1(`select body from notifications where entity_id='${unv.id}' and user_id='${uid.mgmt}'`))[0].body;
      expect(msg).toContain('NOT verified');
    });

    it('a critical request is marked as such in the alert and visible on the live dashboard counters', async () => {
      const before = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      const t = await mkTicket({ organisation_name: 'ZZTEST Unverified Outpost Beta', urgency: 'equipment_down' });
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_portal_request'`))[0]);
      const note = (await sql1(`select title from notifications where entity_id='${t.id}' and type='service_portal_request' limit 1`))[0];
      expect(note.title).toContain('CRITICAL');
      const after = (await api().get('/api/service/stats').set(auth('mgmt'))).body;
      expect(after.portalNew).toBe(before.portalNew + 1);
      expect(after.unverifiedCustomers).toBe(before.unverifiedCustomers + 1);
      expect(after.criticalTickets).toBe(before.criticalTickets + 1);
    });

    it('staff see it in the queue, filterable as a portal request, with the customer’s contact details', async () => {
      const t = await mkTicket({ organisation_name: 'ZZTEST Unverified Outpost Gamma', contact_designation: 'Duty Officer' });
      const list = await api().get('/api/service/tickets?complaint_source=Customer%20Portal&unverified=true&limit=100').set(auth('mgmt'));
      const row = list.body.data.find((x: any) => x.id === t.id);
      expect(row).toBeTruthy();
      expect(row.claimed_organisation_name).toBe('ZZTEST Unverified Outpost Gamma');
      expect(row.complaint_source).toBe('Customer Portal');
      const detail = await staffGet(t.id);
      expect(detail.intake.contact_name).toBe('ZZTEST Ramesh Kumar');
      expect(detail.intake.contact_designation).toBe('Duty Officer');
      expect(detail.intake.contact_phone).toMatch(/^\+91/);
      expect(detail.intake.reference).toBe(t.ref);
    });

    it('auto-assignment (when switched on) gives the ticket to an active engineer, starts the SLA response clock and notifies them', async () => {
      await sql1(`update service_settings set value='true'::jsonb where key='auto_assign_portal_tickets'`);
      try {
        const t = await mkTicket({ organisation_name: known.name, city: known.city });
        const row = (await sql1(`select status, assigned_to, first_response_at from service_tickets where id='${t.id}'`))[0];
        expect(row.status).toBe('assigned');
        expect(row.first_response_at).toBeTruthy();
        const eng = (await sql1(`select role, is_active from users where id='${row.assigned_to}'`))[0];
        expect(eng).toMatchObject({ role: 'service_team', is_active: true });
        await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_ticket_assigned' and user_id='${row.assigned_to}'`))[0]);
      } finally {
        await sql1(`update service_settings set value='false'::jsonb where key='auto_assign_portal_tickets'`);
      }
      const manual = await mkTicket();
      expect((await sql1(`select status, assigned_to from service_tickets where id='${manual.id}'`))[0]).toMatchObject({ status: 'received', assigned_to: null });
    });
  });

  // ===========================================================================
  // 9. Tracking
  // ===========================================================================
  describe('9. Tracking a request', () => {
    it('shows status, the customer’s own text and the expected deadlines — and nothing internal', async () => {
      const t = await mkTicket({ organisation_name: known.name, city: known.city });
      const r = await track(t.ref, t.token);
      expect(r.status).toBe(200);
      expect(r.body.reference).toBe(t.ref);
      expect(r.body.status).toBe('received');
      expect(r.body.status_label).toBe('Request received');
      expect(r.body.complaint).toContain('ZZTEST');
      expect(r.body.sla.response_due_at).toBeTruthy();
      expect(r.body.timeline.map((x: any) => x.status)).toEqual(['received']);
      expect(r.body.can_comment).toBe(true);
      expect(r.body.can_give_feedback).toBe(false);
      const text = JSON.stringify(r.body);
      for (const forbidden of ['organisation_id', 'assigned_to', 'created_by', 'tracking_token_hash', 'contact_phone', 'ip_hash', known.id, t.id, uid.svc]) {
        expect(text).not.toContain(forbidden);
      }
    });

    it('an unverified customer sees exactly the text they typed, never the staff triage banner', async () => {
      const typed = `ZZTEST The scanner trips the breaker every hour ${uniq()}`;
      const t = await mkTicket({ organisation_name: 'ZZTEST Unverified Outpost Delta', complaint: typed, product_text: 'Unlisted legacy scanner' });
      expect((await sql1(`select complaint from service_tickets where id='${t.id}'`))[0].complaint).toContain('UNVERIFIED CUSTOMER'); // staff view keeps it
      const r = await track(t.ref, t.token);
      expect(r.body.complaint).toBe(typed);
      expect(JSON.stringify(r.body)).not.toMatch(/UNVERIFIED/i);
      expect(r.body.product).toBe('Unlisted legacy scanner');
    });

    it('says when the response target counts working hours only', async () => {
      const biz = await mkTicket({ urgency: 'major_impairment' });
      const crit = await mkTicket({ urgency: 'equipment_down' });
      expect(biz.body.response_in_business_hours).toBe(true);
      expect(crit.body.response_in_business_hours).toBe(false);
      expect((await track(biz.ref, biz.token)).body.sla.business_hours).toBe(true);
      expect((await track(crit.ref, crit.token)).body.sla.business_hours).toBe(false);
    });

    it('reference lookup is case-insensitive; wrong, missing, swapped or foreign codes are all the same 404', async () => {
      const a = await mkTicket();
      const b = await mkTicket();
      expect((await track(a.ref.toLowerCase(), a.token)).status).toBe(200);
      const wrongToken = await track(a.ref, 'x'.repeat(24));
      const unknownRef = await track('TCK-2026-999999', a.token);
      const crossed = await track(a.ref, b.token); // another customer's valid code
      const missing = await api().get('/api/public/service-requests/track').set('X-Forwarded-For', nextIp());
      const emptyToken = await track(a.ref, '');
      for (const r of [wrongToken, unknownRef, crossed, missing, emptyToken]) {
        expect(r.status).toBe(404);
        expect(r.body.message).toBe('Request not found, or the tracking code is incorrect');
      }
    });

    it('hostile reference/token values are a clean 404, never a 500', async () => {
      for (const ref of ["TCK' OR '1'='1", 'TCK-2026-1;DROP TABLE x', '%00', 'é'.repeat(50), 'R'.repeat(5000), '../../etc/passwd']) {
        const r = await track(ref, 'whatever-token-value');
        expect([404, 400, 414]).toContain(r.status);
      }
      expect((await track('x', 't'.repeat(5000))).status).toBeLessThan(500);
    });

    it('lookups are rate limited per address (40 per 10 minutes)', async () => {
      const ip = nextIp();
      const codes: number[] = [];
      for (let i = 0; i < 42; i++) codes.push((await track('TCK-2026-000000', 'nope', ip)).status);
      expect(codes.slice(0, 40).every((c) => c === 404)).toBe(true);
      expect(codes[40]).toBe(429);
    });

    it('follows the work: customer-friendly timeline, engineer first name only, internal reasons never exposed', async () => {
      const t = await mkTicket({ organisation_name: known.name, city: known.city });
      const engineer = (await sql1(`select full_name from users where id='${uid.svc}'`))[0].full_name as string;
      await patch(t.id, { status: 'assigned', assigned_to: uid.svc });
      await patch(t.id, { status: 'visit_scheduled', planned_visit_date: tomorrow() });
      await patch(t.id, { status: 'in_progress' }, 'svc');
      await patch(t.id, { status: 'awaiting_part', remarks: 'INTERNAL-ONLY supplier delay: vendor ABC cannot ship until the 20th' }, 'svc');
      await api().post(`/api/service/tickets/${t.id}/comments`).set(auth('svc')).send({ body: 'SECRET internal engineer note about the customer', is_internal: true });
      await api().post(`/api/service/tickets/${t.id}/comments`).set(auth('svc')).send({ body: 'Spare part ordered; we will revisit once it arrives.', is_internal: false });

      const r = await track(t.ref, t.token);
      expect(r.body.status).toBe('awaiting_part');
      expect(r.body.status_label).toBe('Waiting for a spare part');
      expect(r.body.timeline.map((x: any) => x.status)).toEqual(['received', 'assigned', 'visit_scheduled', 'in_progress', 'awaiting_part']);
      expect(r.body.engineer_first_name).toBe(engineer.split(/\s+/)[0]);
      expect(r.body.sla.paused).toBe(true);
      const text = JSON.stringify(r.body);
      expect(text).not.toContain('INTERNAL-ONLY');
      expect(text).not.toContain('SECRET');
      if (engineer.split(/\s+/).length > 1) expect(text).not.toContain(engineer);
      expect(r.body.messages.map((m: any) => m.body)).toEqual(['Spare part ordered; we will revisit once it arrives.']);
      expect(r.body.messages[0].from).toBe('Arihant service desk');
      expect(r.body.planned_visit_date).toBeTruthy();
    });

    it('shows the work summary only once the engineer has finished', async () => {
      const t = await mkTicket();
      await advanceTicket(app, t.id, tok.mgmt, uid.svc, 'in_progress');
      expect((await track(t.ref, t.token)).body.work_summary).toBeNull();
      await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport({ action_taken: 'Replaced the drive board and recalibrated the belt sensor' }));
      const r = await track(t.ref, t.token);
      expect(r.body.status).toBe('report_submitted');
      expect(r.body.work_summary.action).toContain('Replaced the drive board');
      expect(r.body.can_give_feedback).toBe(true);
    });
  });

  // ===========================================================================
  // 10. Customer messages
  // ===========================================================================
  describe('10. Customer messages', () => {
    const say = (t: any, body: any, over: Record<string, any> = {}, ip = nextIp()) =>
      api().post('/api/public/service-requests/track/comment').set('X-Forwarded-For', ip).send({ ref: t.ref, token: t.token, body, ...over });

    it('stores a customer message as a non-internal comment, notifies the team and shows it to the customer', async () => {
      const t = await mkTicket();
      await advanceTicket(app, t.id, tok.mgmt, uid.svc, 'assigned');
      const r = await say(t, 'ZZTEST Please come after 2 pm, the duty officer is away in the morning.');
      expect(r.status).toBe(201);
      const c = (await sql1(`select * from ticket_comments where ticket_id='${t.id}'`))[0];
      expect(c.author_id).toBeNull();
      expect(c.is_internal).toBe(false);
      expect(c.mentions[0].customer).toBe(true);
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${t.id}' and type='service_customer_comment' and user_id='${uid.svc}'`))[0]);
      const seen = await track(t.ref, t.token);
      expect(seen.body.messages.map((m: any) => ({ from: m.from, body: m.body }))[0]).toEqual({ from: 'You', body: 'ZZTEST Please come after 2 pm, the duty officer is away in the morning.' });
      // staff see it too, labelled by an empty author
      const staff = await staffGet(t.id);
      expect(staff.comments[0].author_id).toBeNull();
    });

    it('rejects empty, too-short and oversized messages; strips HTML', async () => {
      const t = await mkTicket();
      expect((await say(t, '')).status).toBe(400);
      expect((await say(t, 'hi')).status).toBe(400);
      expect((await say(t, '<b></b>')).status).toBe(400);
      expect((await say(t, 'x'.repeat(8001))).status).toBe(400);
      expect((await say(t, 'ZZTEST <script>alert(1)</script>please call me back soon')).status).toBe(201);
      expect((await sql1(`select body from ticket_comments where ticket_id='${t.id}'`))[0].body).not.toContain('<script>');
    });

    it('needs the right code; a wrong one is the same 404 and writes nothing', async () => {
      const t = await mkTicket();
      const r = await say(t, 'ZZTEST message with a wrong code', { token: 'wrong-code-wrong-code-12' });
      expect(r.status).toBe(404);
      expect((await sql1(`select count(*)::int n from ticket_comments where ticket_id='${t.id}'`))[0].n).toBe(0);
    });

    it('closed long ago or cancelled: no more messages', async () => {
      const closed = await mkTicket();
      await advanceTicket(app, closed.id, tok.mgmt, uid.svc, 'in_progress');
      await api().post(`/api/service/tickets/${closed.id}/report`).set(auth('svc')).send(validReport());
      await api().post(`/api/service/tickets/${closed.id}/close`).set(auth('mgmt')).send({});
      expect((await say(closed, 'ZZTEST thank you for the quick fix')).status).toBe(201); // fresh closure: allowed
      await sql1(`update service_tickets set closed_at = now() - interval '20 days' where id='${closed.id}'`);
      const late = await say(closed, 'ZZTEST one more thing about this old ticket');
      expect(late.status).toBe(400);
      expect(late.body.message).toContain('14 days');
      expect((await track(closed.ref, closed.token)).body.can_comment).toBe(false);

      const cancelled = await mkTicket();
      await patch(cancelled.id, { status: 'cancelled', remarks: 'Duplicate request, merged elsewhere' });
      expect((await say(cancelled, 'ZZTEST anyone there?')).status).toBe(400);
    });

    it('a customer cannot post more than 10 messages an hour on one request', async () => {
      const t = await mkTicket();
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) codes.push((await say(t, `ZZTEST follow up message number ${i} please reply`)).status);
      expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
      expect(codes[10]).toBe(429);
    });
  });

  // ===========================================================================
  // 11. Customer feedback on the fix
  // ===========================================================================
  describe('11. Confirming or disputing the fix', () => {
    const fb = (t: any, body: Record<string, any>, ip = nextIp()) =>
      api().post('/api/public/service-requests/track/feedback').set('X-Forwarded-For', ip).send({ ref: t.ref, token: t.token, ...body });

    async function reported(over: Record<string, any> = {}) {
      const t = await mkTicket(over);
      await advanceTicket(app, t.id, tok.mgmt, uid.svc, 'in_progress');
      const rep = await api().post(`/api/service/tickets/${t.id}/report`).set(auth('svc')).send(validReport());
      expect(rep.status).toBe(201);
      return { ...t, reportId: rep.body.id as string };
    }

    it('cannot give feedback before the work is done; invalid ratings and actions are 400', async () => {
      const t = await mkTicket();
      const early = await fb(t, { action: 'confirm_resolved' });
      expect(early.status).toBe(400);
      expect(early.body.message).toContain('finished the work');
      const r = await reported();
      expect((await fb(r, { action: 'confirm_resolved', rating: 0 })).status).toBe(400);
      expect((await fb(r, { action: 'confirm_resolved', rating: 6 })).status).toBe(400);
      expect((await fb(r, { action: 'confirm_resolved', rating: 2.5 })).status).toBe(400);
      expect((await fb(r, { action: 'maybe' })).status).toBe(400);
      expect((await fb(r, { action: 'not_resolved' })).status).toBe(400); // remarks required
      expect((await fb(r, { action: 'not_resolved', remarks: 'no' })).status).toBe(400);
      expect((await fb({ ...r, token: 'bad-code-bad-code-bad-1' }, { action: 'confirm_resolved' })).status).toBe(404);
    });

    it('"it is fixed" records the rating and remarks and asks the manager to close — it never closes by itself', async () => {
      const r = await reported();
      const ok = await fb(r, { action: 'confirm_resolved', rating: 5, remarks: 'ZZTEST Quick and professional' });
      expect(ok.status).toBe(201);
      const rep = (await sql1(`select * from service_reports where id='${r.reportId}'`))[0];
      expect(rep.customer_feedback_rating).toBe(5);
      expect(rep.customer_remarks).toContain('Quick and professional');
      expect((await sql1(`select status from service_tickets where id='${r.id}'`))[0].status).toBe('report_submitted');
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${r.id}' and type='service_customer_confirmed'`))[0]);
    });

    it('a portal confirmation stands in for a missing on-site sign-off', async () => {
      const t = await mkTicket();
      await advanceTicket(app, t.id, tok.mgmt, uid.svc, 'in_progress');
      const rep = await api()
        .post(`/api/service/tickets/${t.id}/report`)
        .set(auth('svc'))
        .send(validReport({ customer_confirmation: false, customer_confirmation_type: 'Not Obtained', customer_name_signed: undefined, confirmation_not_obtained_reason: 'Officer was off site' }));
      expect(rep.status).toBe(201);
      await fb(t, { action: 'confirm_resolved', rating: 4 });
      const row = (await sql1(`select customer_confirmation, customer_confirmation_type, customer_name_signed from service_reports where id='${rep.body.id}'`))[0];
      expect(row.customer_confirmation).toBe(true);
      expect(row.customer_confirmation_type).toBe('Email Confirmation');
      expect(row.customer_name_signed).toBe('ZZTEST Ramesh Kumar');
      // now a manager can close without the "no confirmation" remark
      expect((await api().post(`/api/service/tickets/${t.id}/close`).set(auth('mgmt')).send({})).status).toBe(201);
    });

    it('"still broken" sends the ticket back to the engineer, returns the report and alerts the owners', async () => {
      const r = await reported();
      const res = await fb(r, { action: 'not_resolved', remarks: 'ZZTEST The belt stalls again after ten minutes of use' });
      expect(res.status).toBe(201);
      expect(res.body.reopened).toBe(true);
      const t = (await sql1(`select status from service_tickets where id='${r.id}'`))[0];
      expect(t.status).toBe('in_progress');
      const rep = (await sql1(`select report_status, return_reason from service_reports where id='${r.reportId}'`))[0];
      expect(rep.report_status).toBe('Returned for Correction');
      expect(rep.return_reason).toContain('belt stalls');
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${r.id}' and type='service_customer_unresolved' and user_id='${uid.svc}'`))[0]);
      const hist = await sql1(`select to_status from ticket_status_history where ticket_id='${r.id}' order by changed_at desc limit 1`);
      expect(hist[0].to_status).toBe('in_progress');
      const seen = await track(r.ref, r.token);
      expect(seen.body.messages.some((m: any) => m.body.includes('problem persists'))).toBe(true);
    });

    it('after closure, "still broken" cannot reopen by itself — it escalates to management instead', async () => {
      const r = await reported();
      await api().post(`/api/service/tickets/${r.id}/close`).set(auth('mgmt')).send({});
      const res = await fb(r, { action: 'not_resolved', remarks: 'ZZTEST It stopped again two days after the visit' });
      expect(res.status).toBe(201);
      expect(res.body.escalated).toBe(true);
      expect((await sql1(`select status from service_tickets where id='${r.id}'`))[0].status).toBe('closed');
      await waitFor(async () => (await sql1(`select id from notifications where entity_id='${r.id}' and type='service_customer_unresolved' and user_id='${uid.mgmt}'`))[0]);
    });

    it('feedback after closure is accepted once; a second confirmation is refused', async () => {
      const r = await reported();
      await api().post(`/api/service/tickets/${r.id}/close`).set(auth('mgmt')).send({});
      expect((await track(r.ref, r.token)).body.can_give_feedback).toBe(true);
      expect((await fb(r, { action: 'confirm_resolved', rating: 5 })).status).toBe(201);
      expect((await fb(r, { action: 'confirm_resolved', rating: 1 })).status).toBe(400);
      expect((await track(r.ref, r.token)).body.can_give_feedback).toBe(false);
    });

    it('a cancelled request takes no feedback', async () => {
      const t = await mkTicket();
      await patch(t.id, { status: 'cancelled', remarks: 'Customer withdrew; resolved by phone' });
      expect((await fb(t, { action: 'confirm_resolved' })).status).toBe(400);
    });
  });

  // ===========================================================================
  // 12. Staff triage of unverified customers
  // ===========================================================================
  describe('12. Linking an unverified customer', () => {
    const link = (id: string, body: Record<string, any>, who = 'mgmt') => api().patch(`/api/service/tickets/${id}/link-organisation`).set(auth(who)).send(body);

    it('verifies the customer: re-points the ticket, clears the flag, logs it and refreshes repeat detection', async () => {
      const serial = `ZZTESTLINK${uniq()}`;
      const earlier = await api().post('/api/service/tickets').set(auth('mgmt')).send({ organisation_id: known.id, complaint: 'ZZTEST earlier fault on this machine', equipment_serial: serial });
      const t = await mkTicket({ organisation_name: 'ZZTEST Soon To Be Verified Unit', equipment_serial: serial, state: 'Delhi' });
      expect((await sql1(`select is_repeat_complaint from service_tickets where id='${t.id}'`))[0].is_repeat_complaint).toBe(false);

      const r = await link(t.id, { organisation_id: known.id, remarks: 'Confirmed by phone with the unit commander' }, 'rmN');
      expect(r.status).toBe(200);
      const row = (await sql1(`select * from service_tickets where id='${t.id}'`))[0];
      expect(row.organisation_id).toBe(known.id);
      expect(row.claimed_organisation_name).toBeNull();
      expect(row.equipment_unverified).toBe(false);
      expect(row.is_repeat_complaint).toBe(true);
      expect(row.parent_ticket_id).toBe(earlier.body.id);
      expect((await sql1(`select match_method from service_intake_requests where id='${row.intake_request_id}'`))[0].match_method).toBe('manual');
      expect((await staffGet(t.id)).status_history[0].reason).toContain('verified and linked');
      expect((await sql1(`select count(*)::int n from interactions where organisation_id='${known.id}' and remarks like '%${t.ref}%'`))[0].n).toBe(1);
    });

    it('is refused for a verified ticket, the holding record, unknown orgs and foreign contacts', async () => {
      const t = await mkTicket({ organisation_name: 'ZZTEST Another Unverified Unit', state: 'Delhi' });
      expect((await link(t.id, { organisation_id: '00000000-0000-4000-8000-0000000000a1' })).status).toBe(400);
      expect((await link(t.id, { organisation_id: '99999999-9999-4999-8999-999999999999' })).status).toBe(400);
      expect((await link(t.id, { organisation_id: 'nope' })).status).toBe(400);
      expect((await link(t.id, { organisation_id: known.id, contact_id: '99999999-9999-4999-8999-999999999999' })).status).toBe(400);
      expect((await link(t.id, { organisation_id: known.id })).status).toBe(200);
      const again = await link(t.id, { organisation_id: known.id });
      expect(again.status).toBe(400);
      expect(again.body.message).toContain('already linked');
    });

    it('is a triage action for service/management only and respects territory', async () => {
      const t = await mkTicket({ organisation_name: 'ZZTEST Territory Check Unit', state: 'Bihar' });
      expect((await link(t.id, { organisation_id: known.id }, 'sales')).status).toBe(403);
      expect((await link(t.id, { organisation_id: known.id }, 'accounts')).status).toBe(403);
      expect((await link(t.id, { organisation_id: known.id }, 'rmN')).status).toBe(403); // Bihar belongs to the East zone
      expect((await link(t.id, { organisation_id: known.id }, 'rmE')).status).toBe(200);
    });
  });

  // ===========================================================================
  // 13. Boundary between public and private
  // ===========================================================================
  describe('13. Public endpoints never open the staff API', () => {
    it('staff endpoints still demand a login while the public ones do not', async () => {
      expect((await api().get('/api/service/tickets')).status).toBe(401);
      expect((await api().get('/api/service/stats')).status).toBe(401);
      expect((await api().patch('/api/service/tickets/abc/link-organisation').send({})).status).toBe(401);
      expect((await api().post('/api/service/maintenance/sweep')).status).toBe(401);
      expect((await api().get('/api/public/service-requests/meta')).status).toBe(200);
    });

    it('a customer tracking code is useless on staff endpoints', async () => {
      const t = await mkTicket();
      const asBearer = await api().get(`/api/service/tickets/${t.id}`).set('Authorization', `Bearer ${t.token}`);
      expect(asBearer.status).toBe(401);
    });

    it('the holding organisation never shows up in the CRM customer list', async () => {
      await mkTicket({ organisation_name: 'ZZTEST Holding Visibility Check Unit' });
      const orgs = await api().get('/api/organisations?limit=100&search=Unverified').set(auth('mgmt'));
      const names = (orgs.body.data || []).map((o: any) => o.name);
      expect(names.join('|')).not.toContain('Unverified Portal Customer');
    });
  });
});
