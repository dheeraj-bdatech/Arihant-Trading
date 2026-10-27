import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { KYSELY_DB } from '../src/common/database/database.module';
import { configureApp } from '../src/common/app-setup';
import { NO_RECORD_ID } from '../src/common/events/audit.listener';
import { ProposalAuditLogConsumer } from '../src/modules/proposals/consumers/audit-log.consumer';
import { AuditTrailListener } from '../src/modules/audit/audit-trail.listener';
import { istDay } from './helpers/ist-date';

/**
 * Audit trail additions (27–28 Oct 2026): proposal reminders stay out of the trail, sign-ins, settings changes,
 * customer interactions and follow-ups are recorded, and the trail exports as CSV.
 * Rows are written by an async listener, so each check waits for its row.
 */
describe('Audit trail additions (E2E)', () => {
  let app: INestApplication;
  let db: any;
  let mgmtToken: string;
  let mgmtId: string;
  let salesToken: string;
  let orgId: string;
  const run = randomUUID().slice(0, 8);
  const agent = `audit-e2e-${run}`;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** The newest audit row matching `where`, once the listener has written it (or undefined after ~3 s). */
  async function auditRow(where: (q: any) => any) {
    for (let i = 0; i < 30; i++) {
      const row = await where(db.selectFrom('audit_log').selectAll()).orderBy('created_at', 'desc').executeTakeFirst();
      if (row) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    return undefined;
  }
  /** This run's sign-in rows, told apart by the browser name the requests send. */
  const byUserAgent = (action: string) => (q: any) =>
    q.where('entity_type', '=', 'session').where('action', '=', action).where(sql`new_value ->> 'user_agent'`, '=', agent);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app); // same global setup as main.ts
    await app.init();
    db = app.get(KYSELY_DB);

    const mgmt = await api().post('/api/auth/login').send({ email: 'mgmt@arihant.com', password: 'password123' });
    expect(mgmt.status).toBe(200);
    mgmtToken = mgmt.body.accessToken;
    mgmtId = mgmt.body.user.id;
    const sales = await api().post('/api/auth/login').send({ email: 'sales.delhi@arihant.com', password: 'password123' });
    salesToken = sales.body.accessToken;
    orgId = (await db.selectFrom('organisations').select('id').orderBy('created_at').limit(1).executeTakeFirstOrThrow()).id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('1. Proposal reminders stay out of the trail', () => {
    it('a scheduler reminder event writes no audit row', async () => {
      const proposalId = randomUUID();
      const envelope: any = {
        eventId: randomUUID(),
        eventType: 'proposal.followup_overdue',
        aggregateType: 'PROPOSAL',
        aggregateId: proposalId,
        actorId: null,
        occurredAt: new Date().toISOString(),
        payload: { proposalId, businessDate: istDay(0), daysOverdue: 3 },
      };
      await app.get(ProposalAuditLogConsumer).handleProposalEvent(envelope);
      await app.get(AuditTrailListener).onProposalEvent(envelope);
      const rows = await db.selectFrom('audit_log').select('id').where('entity_id', '=', proposalId).execute();
      expect(rows).toHaveLength(0);
    });

    it('old reminder rows are hidden from the list unless asked for', async () => {
      const proposalId = randomUUID();
      await db
        .insertInto('audit_log')
        .values({ actor_id: null, entity_type: 'proposal', entity_id: proposalId, action: 'update', new_value: JSON.stringify({ businessDate: istDay(0), daysInactive: 9 }) })
        .execute();
      const hidden = await api().get('/api/audit').query({ entity_id: proposalId }).set(auth(mgmtToken));
      expect(hidden.status).toBe(200);
      expect(hidden.body.total).toBe(0);
      const shown = await api().get('/api/audit').query({ entity_id: proposalId, include_reminders: 'true' }).set(auth(mgmtToken));
      expect(shown.body.total).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('2. Sign-ins', () => {
    it('a password sign-in is recorded with the user, IP and browser', async () => {
      const res = await api().post('/api/auth/login').set('User-Agent', agent).send({ email: 'mgmt@arihant.com', password: 'password123' });
      expect(res.status).toBe(200);
      const row = await auditRow(byUserAgent('sign_in'));
      expect(row).toBeDefined();
      expect(row.actor_id).toBe(mgmtId);
      expect(row.entity_id).toBe(mgmtId);
      expect(row.new_value).toMatchObject({ email: 'mgmt@arihant.com', method: 'password', user_agent: agent });
      expect(row.new_value.ip).toBeTruthy();
    });

    it('a wrong password is recorded as a failed sign-in, without the password', async () => {
      const secret = `Wrong-${run}-pass`;
      const res = await api().post('/api/auth/login').set('User-Agent', agent).send({ email: 'mgmt@arihant.com', password: secret });
      expect(res.status).toBe(401);
      const row = await auditRow(byUserAgent('sign_in_failed'));
      expect(row).toBeDefined();
      expect(row.actor_id).toBeNull();
      expect(row.entity_id).toBe(mgmtId);
      expect(row.new_value).toMatchObject({ email: 'mgmt@arihant.com', reason: 'wrong_password' });
      expect(JSON.stringify(row)).not.toContain(secret);
    });

    it('an unknown email is recorded against no account', async () => {
      const email = `nobody-${run}@example.com`;
      const res = await api().post('/api/auth/login').set('User-Agent', agent).send({ email, password: 'whatever123' });
      expect(res.status).toBe(401);
      const row = await auditRow((q) => byUserAgent('sign_in_failed')(q).where('entity_id', '=', NO_RECORD_ID));
      expect(row).toBeDefined();
      expect(row.new_value).toMatchObject({ email, reason: 'unknown_account' });
    });

    it('a demo profile switch is recorded as a persona sign-in', async () => {
      const res = await api().post('/api/auth/demo-login').set('User-Agent', agent).send({ role: 'sales' });
      expect(res.status).toBe(200);
      const row = await auditRow(byUserAgent('persona_sign_in'));
      expect(row).toBeDefined();
      expect(row.actor_id).toBe(res.body.user.id);
      expect(row.new_value).toMatchObject({ method: 'demo_profile', role: 'sales' });
    });

    it('a sign-out is recorded', async () => {
      const res = await api().post('/api/auth/logout').set('User-Agent', agent).set(auth(mgmtToken));
      expect(res.status).toBe(200);
      const row = await auditRow(byUserAgent('sign_out'));
      expect(row).toBeDefined();
      expect(row.actor_id).toBe(mgmtId);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('3. Settings changes', () => {
    it('changing the proposal approval threshold is recorded with the old and new value', async () => {
      const before = (await api().get('/api/proposals/settings').set(auth(mgmtToken))).body;
      const original = Number(before.management_approval_threshold);
      const since = new Date();
      const res = await api().put('/api/proposals/settings').set(auth(mgmtToken)).send({ management_approval_threshold: original + 12345 });
      expect(res.status).toBe(200);
      const row = await auditRow((q) => q.where('action', '=', 'proposal_settings_updated').where('created_at', '>=', since));
      expect(row).toBeDefined();
      expect(row.actor_id).toBe(mgmtId);
      expect(Number(row.previous_value.management_approval_threshold)).toBe(original);
      expect(Number(row.new_value.management_approval_threshold)).toBe(original + 12345);
      expect(Object.keys(row.new_value)).toEqual(['management_approval_threshold']);
      await api().put('/api/proposals/settings').set(auth(mgmtToken)).send({ management_approval_threshold: original });
    });

    it('saving the same settings again writes no row', async () => {
      const current = (await api().get('/api/proposals/settings').set(auth(mgmtToken))).body;
      const since = new Date();
      await api().put('/api/proposals/settings').set(auth(mgmtToken)).send({ management_approval_threshold: Number(current.management_approval_threshold) });
      await new Promise((r) => setTimeout(r, 500));
      const rows = await db.selectFrom('audit_log').select('id').where('action', '=', 'proposal_settings_updated').where('created_at', '>=', since).execute();
      expect(rows).toHaveLength(0);
    });

    it('changing an SLA rule is recorded', async () => {
      const rules = (await api().get('/api/service/settings/sla-rules').set(auth(mgmtToken))).body;
      const rule = rules.find((r: any) => r.response_hours + 1 <= r.resolution_hours);
      expect(rule).toBeDefined();
      const res = await api().patch(`/api/service/settings/sla-rules/${rule.id}`).set(auth(mgmtToken)).send({ response_hours: rule.response_hours + 1 });
      expect(res.status).toBe(200);
      const row = await auditRow((q) => q.where('action', '=', 'sla_rule_updated').where('entity_id', '=', rule.id));
      expect(row).toBeDefined();
      expect(row.previous_value).toMatchObject({ response_hours: rule.response_hours });
      expect(row.new_value).toMatchObject({ response_hours: rule.response_hours + 1 });
      await api().patch(`/api/service/settings/sla-rules/${rule.id}`).set(auth(mgmtToken)).send({ response_hours: rule.response_hours });
    });

    it('changing a service setting is recorded', async () => {
      const key = 'repeat_complaint_window_days';
      const settings = (await api().get('/api/service/settings/config').set(auth(mgmtToken))).body;
      const original = Number(settings.find((s: any) => s.key === key)?.value ?? 30);
      const since = new Date();
      const res = await api().patch(`/api/service/settings/config/${key}`).set(auth(mgmtToken)).send({ value: original + 1 });
      expect(res.status).toBe(200);
      const row = await auditRow((q) => q.where('action', '=', 'service_setting_updated').where('created_at', '>=', since));
      expect(row).toBeDefined();
      expect(row.new_value).toEqual({ [key]: original + 1 });
      await api().patch(`/api/service/settings/config/${key}`).set(auth(mgmtToken)).send({ value: original });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('4. Customer interactions and follow-ups', () => {
    let bookedFollowUpId: string;
    let followUpId: string;

    it('logging an interaction records it and the follow-up it booked', async () => {
      const res = await api()
        .post('/api/interactions')
        .set(auth(mgmtToken))
        .send({ organisation_id: orgId, type: 'call', remarks: `Audit e2e call ${run}`, outcome: 'Asked for a quote', followup_date: istDay(3) });
      expect(res.status).toBe(201);
      bookedFollowUpId = res.body.follow_up.id;

      const logged = await auditRow((q) => q.where('entity_type', '=', 'interaction').where('entity_id', '=', res.body.id));
      expect(logged).toMatchObject({ action: 'interaction_logged', actor_id: mgmtId });
      expect(logged.new_value).toMatchObject({ type: 'call', outcome: 'Asked for a quote' });
      const booked = await auditRow((q) => q.where('entity_type', '=', 'follow_up').where('entity_id', '=', bookedFollowUpId));
      expect(booked).toMatchObject({ action: 'follow_up_scheduled', actor_id: mgmtId });
    });

    it('scheduling a follow-up is recorded', async () => {
      const res = await api()
        .post('/api/follow-ups')
        .set(auth(mgmtToken))
        .send({ organisation_id: orgId, assigned_to: mgmtId, due_date: istDay(4), remarks: `Audit e2e ${run}` });
      expect(res.status).toBe(201);
      followUpId = res.body.id;
      const row = await auditRow((q) => q.where('entity_id', '=', followUpId).where('action', '=', 'follow_up_scheduled'));
      expect(row?.new_value).toMatchObject({ due_date: istDay(4) });
    });

    it('rescheduling a follow-up records the old and new date with the reason', async () => {
      const res = await api().patch(`/api/follow-ups/${followUpId}/reschedule`).set(auth(mgmtToken)).send({ new_due_date: istDay(5), reason: 'Buyer travelling' });
      expect(res.status).toBe(200);
      const row = await auditRow((q) => q.where('entity_id', '=', followUpId).where('action', '=', 'follow_up_rescheduled'));
      expect(row?.previous_value).toMatchObject({ due_date: istDay(4) });
      expect(row?.new_value).toMatchObject({ due_date: istDay(5), reason: 'Buyer travelling' });
    });

    it('completing a follow-up records the outcome', async () => {
      const res = await api().patch(`/api/follow-ups/${bookedFollowUpId}/complete`).set(auth(mgmtToken)).send({ outcome: 'Quote requested by email' });
      expect(res.status).toBe(200);
      const row = await auditRow((q) => q.where('entity_id', '=', bookedFollowUpId).where('action', '=', 'follow_up_completed'));
      expect(row?.previous_value).toEqual({ status: 'pending' });
      expect(row?.new_value).toMatchObject({ status: 'completed', outcome: 'Quote requested by email' });
    });

    it('cancelling a follow-up records the reason', async () => {
      const res = await api().patch(`/api/follow-ups/${followUpId}/cancel`).set(auth(mgmtToken)).send({ reason: 'Customer closed the requirement' });
      expect(res.status).toBe(200);
      const row = await auditRow((q) => q.where('entity_id', '=', followUpId).where('action', '=', 'follow_up_cancelled'));
      expect(row?.new_value).toEqual({ status: 'cancelled', reason: 'Customer closed the requirement' });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('5. CSV export', () => {
    it('downloads the filtered trail as CSV and records the export', async () => {
      const since = new Date();
      const res = await api().get('/api/audit/export').query({ entity_type: 'session' }).set(auth(mgmtToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
      const lines = res.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
      expect(lines[0]).toBe('"Date & time (IST)","User","Role","Action","Record type","Record","Record ID","Previous value","New value"');
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.slice(1).every((l) => l.includes('"session"'))).toBe(true);
      expect(Number(res.headers['x-export-rows'])).toBe(lines.length - 1);

      const row = await auditRow((q) => q.where('action', '=', 'audit_exported').where('created_at', '>=', since));
      expect(row).toMatchObject({ actor_id: mgmtId, entity_type: 'audit' });
      expect(row.new_value).toMatchObject({ rows: lines.length - 1, truncated: false, filters: { entity_type: 'session' } });
    });

    it('defuses spreadsheet formulas in cells', async () => {
      await db
        .insertInto('audit_log')
        .values({ actor_id: mgmtId, entity_type: `csv_e2e_${run}`, entity_id: randomUUID(), action: '=HYPERLINK("http://x")', new_value: JSON.stringify({ note: '+1 dial' }) })
        .execute();
      const res = await api().get('/api/audit/export').query({ entity_type: `csv_e2e_${run}` }).set(auth(mgmtToken));
      expect(res.status).toBe(200);
      expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    });

    it('is for Management and Admin only', async () => {
      const res = await api().get('/api/audit/export').set(auth(salesToken));
      expect(res.status).toBe(403);
    });
  });
});
