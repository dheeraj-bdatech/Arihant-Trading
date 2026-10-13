/**
 * Module 9 — Expense Management, end to end over HTTP against the local database.
 * Covers the happy path, clarification loop, rejection + copy, partial and all-rejected
 * approvals, withdraw, self-approval, fallback/inactive approvers, optimistic locking,
 * role scoping on lists/reports/exports, receipts, duplicates, trips, import and history.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { EXPENSE_DB } from '../src/modules/expense-management/expense-db';
import { loadExpenseConfig } from '../src/modules/expense-management/expense.config';
import { EXPENSE_IMPORT_TEMPLATE_COLUMNS, todayInKolkata, type Database } from '@arihant/shared';

jest.setTimeout(60000);

const today = todayInKolkata();
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
let seq = Math.floor(Math.random() * 400);
/** Unique amounts so duplicate detection never trips across tests or runs. */
const amt = () => `${1000 + ++seq}.${String(seq % 100).padStart(2, '0')}`;
/** A minimal PNG (valid signature) with unique bytes so hashes differ per call. */
const png = (seed: string = randomUUID()) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed)]);

describe('Module 9 — Expense Management (e2e)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  const claimIds = new Set<string>();
  const tempUserIds: string[] = [];
  const tripIds: string[] = [];
  const visitIds: string[] = [];
  let tempCategoryId: string | null = null;
  let tempProjectId: string | null = null;

  type Who = { token: string; id: string };
  const users: Record<string, Who> = {};
  const cat: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const bearer = (w: Who) => ({ Authorization: `Bearer ${w.token}` });

  async function login(email: string): Promise<Who> {
    const res = await http().post('/api/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    return { token: res.body.accessToken || res.body.token, id: res.body.user.id };
  }

  async function draft(w: Who, body: Record<string, unknown> = {}) {
    const res = await http().post('/api/expense-claims').set(bearer(w)).send({ title: 'Field visit — test claim', ...body });
    if (res.status !== 201) throw new Error(`draft failed ${res.status} ${JSON.stringify(res.body)}`);
    claimIds.add(res.body.id);
    return res.body;
  }

  const travelItem = (over: Record<string, unknown> = {}) => ({
    expense_date: daysAgo(2),
    category_id: cat.TRAVEL,
    amount: amt(),
    purpose: 'Train to client site',
    category_details: { from: 'Delhi', to: 'Lucknow', mode: 'train' },
    ...over,
  });

  async function addItem(w: Who, claimId: string, body: Record<string, unknown>) {
    return http().post(`/api/expense-claims/${claimId}/items`).set(bearer(w)).send(body);
  }

  async function attach(w: Who, itemId: string, buf = png(), name = 'receipt.png') {
    return http().post(`/api/expense-items/${itemId}/attachments`).set(bearer(w)).attach('file', buf, name);
  }

  async function detail(w: Who, claimId: string) {
    return http().get(`/api/expense-claims/${claimId}`).set(bearer(w));
  }

  async function act(w: Who, claimId: string, action: string, body: Record<string, unknown> = {}, versionFrom: Who = w) {
    const d = await detail(versionFrom, claimId);
    return http().post(`/api/expense-claims/${claimId}/${action}`).set(bearer(w)).send({ version: d.body.version, ...body });
  }

  /** Draft + one receipted travel line + submit. */
  async function submittedClaim(w: Who, itemOver: Record<string, unknown> = {}) {
    const c = await draft(w);
    const item = await addItem(w, c.id, travelItem(itemOver));
    expect(item.status).toBe(201);
    expect((await attach(w, item.body.item.id)).status).toBe(201);
    const sub = await act(w, c.id, 'submit');
    expect(sub.status).toBe(200);
    return { claim: sub.body, itemId: item.body.item.id as string };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    db = moduleFixture.get<Kysely<Database>>(EXPENSE_DB);

    const emails: Record<string, string> = {
      amit: 'sales.delhi@arihant.com', // reports to vikram
      pooja: 'sales.jaipur@arihant.com', // reports to vikram
      vikram: 'regmgr.north@arihant.com', // reports to mgmt
      sneha: 'sales.kolkata@arihant.com', // reports to pradeep (other team)
      pradeep: 'regmgr.east@arihant.com',
      accounts: 'accounts@arihant.com',
      accounts2: 'accounts.exec@arihant.com', // reports to accounts@
      admin: 'admin@arihant.com',
      mgmt: 'mgmt@arihant.com',
    };
    for (const [k, e] of Object.entries(emails)) users[k] = await login(e);

    const cats = await http().get('/api/expense-categories').set(bearer(users.amit));
    for (const c of cats.body) cat[c.code] = c.id;
  });

  afterAll(async () => {
    if (db) {
      const ids = Array.from(claimIds);
      const extra = ids.length
        ? await db.selectFrom('expense_claims').select('id').where('copied_from_claim_id', 'in', ids).execute()
        : [];
      extra.forEach((r) => claimIds.add(r.id));
      if (tempUserIds.length) {
        const own = await db.selectFrom('expense_claims').select('id').where('employee_id', 'in', tempUserIds).execute();
        own.forEach((r) => claimIds.add(r.id));
      }
      const all = Array.from(claimIds);
      const storage = loadExpenseConfig().storageDir;
      await db.connection().execute(async (conn) => {
        await sql`set session_replication_role = replica`.execute(conn);
        if (all.length) {
          const items = await conn.selectFrom('expense_items').select('id').where('claim_id', 'in', all).execute();
          const itemIds = items.map((i) => i.id);
          if (itemIds.length) {
            const atts = await conn.selectFrom('expense_attachments').select('storage_key').where('item_id', 'in', itemIds).execute();
            for (const a of atts) fs.rmSync(path.join(storage, a.storage_key), { force: true });
            await conn.deleteFrom('expense_attachments').where('item_id', 'in', itemIds).execute();
          }
          await conn.deleteFrom('expense_approval_history').where('claim_id', 'in', all).execute();
          await conn.deleteFrom('expense_items').where('claim_id', 'in', all).execute();
          await conn.deleteFrom('notifications').where('entity_id', 'in', all).execute();
          await conn.deleteFrom('expense_claims').where('id', 'in', all).execute();
        }
        if (tempCategoryId) await conn.deleteFrom('expense_categories').where('id', '=', tempCategoryId).execute();
        if (tempProjectId) await conn.deleteFrom('projects').where('id', '=', tempProjectId).execute();
        if (visitIds.length) await conn.deleteFrom('visits').where('id', 'in', visitIds).execute();
        if (tripIds.length) await conn.deleteFrom('trips').where('id', 'in', tripIds).execute();
        if (tempUserIds.length) {
          await conn.deleteFrom('notifications').where('user_id', 'in', tempUserIds).execute();
          await conn.deleteFrom('audit_log').where('actor_id', 'in', tempUserIds).execute();
          await conn.deleteFrom('users').where('id', 'in', tempUserIds).execute();
        }
        await sql`set session_replication_role = default`.execute(conn);
      });
    }
    await app?.close();
  });

  // ------------------------------------------------------------------ masters
  describe('categories & projects', () => {
    it('lists the seeded active categories in display order', async () => {
      const res = await http().get('/api/expense-categories').set(bearer(users.amit));
      expect(res.status).toBe(200);
      expect(res.body.map((c: any) => c.code).slice(0, 7)).toEqual(['TRAVEL', 'HOTEL', 'LOCAL_CONVEYANCE', 'FOOD', 'DEMO', 'SERVICE', 'OTHER']);
      expect(res.body.find((c: any) => c.code === 'DEMO').requires_customer_or_project).toBe(true);
      expect(res.body.find((c: any) => c.code === 'OTHER').requires_remark).toBe(true);
    });

    it('only admin/management can manage categories; codes are immutable', async () => {
      expect((await http().post('/api/expense-categories').set(bearer(users.amit)).send({ code: 'NOPE', name: 'Nope' })).status).toBe(403);
      const created = await http()
        .post('/api/expense-categories')
        .set(bearer(users.admin))
        .send({ code: `TCAP_${seq}`, name: 'Test capped', max_amount_per_item: 100, cap_is_hard: true, receipt_required_above: null, display_order: 99 });
      expect(created.status).toBe(201);
      tempCategoryId = created.body.id;
      expect((await http().patch(`/api/expense-categories/${tempCategoryId}`).set(bearer(users.admin)).send({ code: 'OTHERCODE' })).status).toBe(400);
      const bad = await http().post('/api/expense-categories').set(bearer(users.admin)).send({ code: 'x', name: '', max_amount_per_item: -1 });
      expect(bad.status).toBe(400);
      expect(Object.keys(bad.body.errors).sort()).toEqual(['code', 'max_amount_per_item', 'name']);
    });

    it('hard cap blocks; deactivated categories cannot be picked but old lines keep their name', async () => {
      const c = await draft(users.amit);
      const over = await addItem(users.amit, c.id, { expense_date: daysAgo(1), category_id: tempCategoryId, amount: '150', purpose: 'Capped spend' });
      expect(over.status).toBe(400);
      expect(over.body.errors.amount).toMatch(/capped/);
      const ok = await addItem(users.amit, c.id, { expense_date: daysAgo(1), category_id: tempCategoryId, amount: '90.50', purpose: 'Capped spend' });
      expect(ok.status).toBe(201);
      expect((await http().patch(`/api/expense-categories/${tempCategoryId}`).set(bearer(users.admin)).send({ is_active: false, name: 'Renamed later' })).status).toBe(200);
      const again = await addItem(users.amit, c.id, { expense_date: daysAgo(1), category_id: tempCategoryId, amount: '20', purpose: 'Capped spend 2' });
      expect(again.status).toBe(400);
      expect(again.body.errors.category_id).toMatch(/no longer active/);
      const d = await detail(users.amit, c.id);
      expect(d.body.items[0].category_name).toBe('Test capped');
      const list = await http().get('/api/expense-categories').set(bearer(users.amit));
      expect(list.body.some((x: any) => x.id === tempCategoryId)).toBe(false);
      const withInactive = await http().get('/api/expense-categories?include_inactive=true').set(bearer(users.admin));
      expect(withInactive.body.some((x: any) => x.id === tempCategoryId)).toBe(true);
    });

    it('admin manages projects; inactive projects cannot be linked', async () => {
      const p = await http().post('/api/projects').set(bearer(users.admin)).send({ code: `PRJ-T${seq}`, name: 'Test Project' });
      expect(p.status).toBe(201);
      tempProjectId = p.body.id;
      const c = await draft(users.amit);
      const ok = await addItem(users.amit, c.id, { expense_date: daysAgo(1), category_id: cat.DEMO, amount: amt(), purpose: 'Demo freight', project_id: tempProjectId });
      expect(ok.status).toBe(201);
      await http().patch(`/api/projects/${tempProjectId}`).set(bearer(users.admin)).send({ is_active: false });
      const bad = await addItem(users.amit, c.id, { expense_date: daysAgo(1), category_id: cat.DEMO, amount: amt(), purpose: 'Demo freight', project_id: tempProjectId });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.project_id).toMatch(/no longer active/);
    });
  });

  // ------------------------------------------------------------------ happy path
  describe('happy path: draft → submit → manager → accounts → processed', () => {
    let claimId: string;
    let itemA: string;
    let itemB: string;

    it('creates a draft with a server-generated claim number; client cannot set employee or status', async () => {
      const res = await http()
        .post('/api/expense-claims')
        .set(bearer(users.amit))
        .send({ title: '  <b>Lucknow</b> CRPF demo trip  ', remarks: 'Two-day trip' });
      expect(res.status).toBe(201);
      claimIds.add(res.body.id);
      claimId = res.body.id;
      expect(res.body.claim_number).toMatch(/^EXP-\d{4}-\d{6}$/);
      expect(res.body.title).toBe('Lucknow CRPF demo trip');
      expect(res.body.employee_id).toBe(users.amit.id);
      expect(res.body.status).toBe('draft');
      const smuggle = await http().post('/api/expense-claims').set(bearer(users.amit)).send({ title: 'x', status: 'processed', employee_id: users.pooja.id });
      expect(smuggle.status).toBe(400); // forbidNonWhitelisted in this suite; ignored in production
    });

    it('cannot submit an empty claim', async () => {
      const res = await act(users.amit, claimId, 'submit');
      expect(res.status).toBe(400);
      expect(res.body.errors.items).toMatch(/at least one/);
    });

    it('adds lines; totals and period are computed server-side', async () => {
      const a = await addItem(users.amit, claimId, travelItem({ amount: '1500', expense_date: daysAgo(3), category_details: { from: 'Delhi', to: 'Lucknow', mode: 'train' } }));
      expect(a.status).toBe(201);
      itemA = a.body.item.id;
      const b = await addItem(users.amit, claimId, {
        expense_date: daysAgo(2),
        category_id: cat.HOTEL,
        amount: '3200.50',
        purpose: 'Hotel near CRPF campus',
        category_details: { hotel_name: 'Hotel Clarks', check_in: daysAgo(3), check_out: daysAgo(2) },
      });
      expect(b.status).toBe(201);
      itemB = b.body.item.id;
      expect(b.body.item.category_details.nights).toBe(1);
      const d = await detail(users.amit, claimId);
      expect(d.body.total_claimed).toBe(4700.5);
      expect(d.body.period_from).toBe(daysAgo(3));
      expect(d.body.period_to).toBe(daysAgo(2));
      expect(d.body.items[0].expense_date).toBe(daysAgo(3)); // DATE never shifts by timezone
    });

    it('blocks submit until required receipts are attached', async () => {
      const res = await act(users.amit, claimId, 'submit');
      expect(res.status).toBe(400);
      expect(res.body.errors[`items.${itemA}.receipt`]).toBeDefined();
      expect(res.body.errors[`items.${itemB}.receipt`]).toBeDefined();
      expect((await attach(users.amit, itemA)).status).toBe(201);
      expect((await attach(users.amit, itemB, Buffer.from('%PDF-1.4 hotel bill ' + randomUUID()), 'hotel.pdf')).status).toBe(201);
    });

    it('rejects a stale version with 409', async () => {
      const res = await http().post(`/api/expense-claims/${claimId}/submit`).set(bearer(users.amit)).send({ version: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_VERSION');
    });

    it('submits: approver and region are snapshotted and the manager is notified', async () => {
      const res = await act(users.amit, claimId, 'submit');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('submitted');
      expect(res.body.manager_id).toBe(users.vikram.id);
      expect(res.body.region_id).toBeTruthy();
      expect(res.body.submitted_at).toBeTruthy();
      expect(res.body.allowed_actions).toEqual(expect.arrayContaining(['withdraw']));
      expect(res.body.allowed_actions).not.toContain('edit');
      await new Promise((r) => setTimeout(r, 300));
      const n = await db.selectFrom('notifications').select('title').where('user_id', '=', users.vikram.id).where('entity_id', '=', claimId).execute();
      expect(n.length).toBeGreaterThan(0);
    });

    it('locks editing after submission and makes re-submission a 409', async () => {
      expect((await addItem(users.amit, claimId, travelItem())).status).toBe(409);
      expect((await http().patch(`/api/expense-claims/${claimId}`).set(bearer(users.amit)).send({ title: 'Changed' })).status).toBe(409);
      expect((await http().delete(`/api/expense-claims/${claimId}`).set(bearer(users.amit))).status).toBe(409);
      const again = await act(users.amit, claimId, 'submit');
      expect(again.status).toBe(409);
      const hist = await db.selectFrom('expense_approval_history').select('action').where('claim_id', '=', claimId).where('action', '=', 'submit').execute();
      expect(hist.length).toBe(1);
    });

    it('shows in the manager queue and badge counts', async () => {
      const q = await http().get('/api/expense-claims/pending/manager').set(bearer(users.vikram));
      expect(q.status).toBe(200);
      expect(q.body.data.some((c: any) => c.id === claimId)).toBe(true);
      const badges = await http().get('/api/expense-claims/badge-counts').set(bearer(users.vikram));
      expect(badges.body.manager_pending).toBeGreaterThan(0);
      const other = await http().get('/api/expense-claims/pending/manager').set(bearer(users.pradeep));
      expect(other.body.data.some((c: any) => c.id === claimId)).toBe(false);
    });

    it('only the snapshotted approver can act; accounts cannot act yet', async () => {
      expect((await act(users.pradeep, claimId, 'manager-approve', {}, users.amit)).status).toBe(404);
      // Accounts cannot even see a claim before the manager stage is done (404, not 403 — no existence leak).
      expect((await act(users.accounts, claimId, 'accounts-approve', {}, users.amit)).status).toBe(404);
      expect((await act(users.amit, claimId, 'manager-approve')).status).toBe(403);
    });

    it('partial approval needs a reviewer comment', async () => {
      const bad = await act(users.vikram, claimId, 'manager-approve', { items: [{ id: itemB, item_status: 'partially_approved', approved_amount: 2500 }] });
      expect(bad.status).toBe(400);
      expect(bad.body.errors[`items.${itemB}.reviewer_comment`]).toBeDefined();
    });

    it('manager approval moves the claim straight into Accounts review', async () => {
      const res = await act(users.vikram, claimId, 'manager-approve', {
        comment: 'OK',
        items: [{ id: itemB, item_status: 'partially_approved', approved_amount: '2500', reviewer_comment: 'Hotel above grade entitlement' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accounts_review');
      expect(res.body.total_approved).toBe(4000);
      const b = res.body.items.find((i: any) => i.id === itemB);
      expect(b).toMatchObject({ item_status: 'partially_approved', approved_amount: 2500, manager_approved_amount: 2500 });
      const actions = res.body.history.map((h: any) => h.action);
      expect(actions).toEqual(expect.arrayContaining(['create', 'submit', 'manager_approve', 'forward_to_accounts']));
      const fwd = res.body.history.find((h: any) => h.action === 'forward_to_accounts');
      expect(fwd).toMatchObject({ from_status: 'manager_approved', to_status: 'accounts_review', actor_role: 'system' });
    });

    it('accounts cannot raise above the manager and must comment when reducing', async () => {
      const up = await act(users.accounts, claimId, 'accounts-approve', { items: [{ id: itemB, item_status: 'partially_approved', approved_amount: 3000, reviewer_comment: 'Restore' }] });
      expect(up.status).toBe(400);
      const noComment = await act(users.accounts, claimId, 'accounts-approve', { items: [{ id: itemA, item_status: 'partially_approved', approved_amount: 1400 }] });
      expect(noComment.status).toBe(400);
    });

    it('accounts approves (ready for Tally) and sees it in the accounts queue', async () => {
      const res = await act(users.accounts, claimId, 'accounts-approve', {
        items: [{ id: itemA, item_status: 'partially_approved', approved_amount: 1400, reviewer_comment: 'Tatkal charges not reimbursable' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accounts_approved');
      expect(res.body.total_approved).toBe(3900);
      const q = await http().get('/api/expense-claims/pending/accounts').set(bearer(users.accounts));
      expect(q.body.data.some((c: any) => c.id === claimId)).toBe(true);
      expect((await http().get('/api/expense-claims/pending/accounts').set(bearer(users.amit))).status).toBe(403);
    });

    it('exports the approved lines in the fixed Tally column order (CSV and XLSX)', async () => {
      const csv = await http().get(`/api/expense-reports/export?format=csv&approved_only=true&claim_ids=${claimId}`).set(bearer(users.accounts));
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
      expect(lines[0]).toBe(
        '"Claim No","Employee Code","Employee Name","Region","Trip","Expense Date","Category","Customer","Project","Purpose","Claimed Amount","Approved Amount","Manager","Manager Approved On","Accounts Approved On","Status","Tally Voucher Ref","Remarks"',
      );
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain(`"${daysAgo(3).split('-').reverse().join('-')}"`); // DD-MM-YYYY
      expect(lines[1]).toContain('"1500"');
      expect(lines[1]).toContain('"1400"');

      const xlsx = await http()
        .get(`/api/expense-reports/export?format=xlsx&claim_ids=${claimId}`)
        .set(bearer(users.accounts))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(xlsx.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.body);
      const sheet = wb.getWorksheet('Expenses')!;
      expect(sheet.getRow(1).getCell(1).value).toBe('Claim No');
      expect(sheet.rowCount).toBe(3);
      expect(typeof sheet.getRow(2).getCell(11).value).toBe('number');
    });

    it('processing requires the Tally voucher reference; payment date cannot be in the future', async () => {
      expect((await act(users.accounts, claimId, 'process', {})).body.errors.tally_voucher_ref).toBeDefined();
      expect((await act(users.accounts, claimId, 'process', { tally_voucher_ref: 'JV-1', payment_date: '2999-01-01' })).status).toBe(400);
      const res = await act(users.accounts, claimId, 'process', { tally_voucher_ref: 'JV/2026/0451', payment_reference: 'NEFT-998877', payment_date: today });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'processed', tally_voucher_ref: 'JV/2026/0451', payment_reference: 'NEFT-998877', payment_date: today });
      expect(res.body.allowed_actions).toEqual([]);
    });

    it('a processed claim is read-only for everyone', async () => {
      expect((await act(users.accounts, claimId, 'accounts-reject', { comment: 'Too late now' })).status).toBe(409);
      expect((await act(users.amit, claimId, 'withdraw')).status).toBe(409);
      expect((await addItem(users.amit, claimId, travelItem())).status).toBe(409);
      expect((await http().delete(`/api/expense-attachments/${(await detail(users.amit, claimId)).body.items[0].attachments[0].id}`).set(bearer(users.amit))).status).toBe(409);
    });

    it('history is append-only at the database level', async () => {
      await expect(sql`update expense_approval_history set comment = 'tampered' where claim_id = ${claimId}`.execute(db)).rejects.toThrow(/append-only/);
      await expect(sql`delete from expense_approval_history where claim_id = ${claimId}`.execute(db)).rejects.toThrow(/append-only/);
    });
  });

  // ------------------------------------------------------------------ alternate flows
  describe('clarification, rejection, withdraw', () => {
    it('clarification needs a comment, unlocks editing, logs edits and resubmits to the manager', async () => {
      const { claim, itemId } = await submittedClaim(users.amit);
      expect((await act(users.vikram, claim.id, 'request-clarification', { comment: 'abc' })).status).toBe(400);
      const req = await act(users.vikram, claim.id, 'request-clarification', { comment: 'Please attach the boarding pass' });
      expect(req.status).toBe(200);
      expect(req.body.status).toBe('clarification_required');
      expect(req.body.last_reviewer_comment).toBe('Please attach the boarding pass');

      const edit = await http().patch(`/api/expense-claims/${claim.id}/items/${itemId}`).set(bearer(users.amit)).send({ purpose: 'Train to Lucknow (boarding pass attached)' });
      expect(edit.status).toBe(200);
      expect((await attach(users.amit, itemId)).status).toBe(201);
      const resub = await act(users.amit, claim.id, 'submit');
      expect(resub.status).toBe(200);
      expect(resub.body.status).toBe('submitted');
      const edits = resub.body.history.filter((h: any) => h.action === 'clarification_edit');
      expect(edits.length).toBeGreaterThanOrEqual(2);
      expect(edits[0].metadata.before.purpose).toBe('Train to client site');
      expect(edits[0].metadata.after.purpose).toBe('Train to Lucknow (boarding pass attached)');
      expect(resub.body.history.some((h: any) => h.action === 'resubmit')).toBe(true);
    });

    it('accounts can send a claim back for clarification; it then returns to the manager', async () => {
      const { claim } = await submittedClaim(users.amit);
      await act(users.vikram, claim.id, 'manager-approve');
      const back = await act(users.accounts, claim.id, 'request-clarification', { comment: 'GST invoice missing' });
      expect(back.body.status).toBe('clarification_required');
      const resub = await act(users.amit, claim.id, 'submit');
      expect(resub.body.status).toBe('submitted');
      expect(resub.body.manager_id).toBe(users.vikram.id);
      expect(resub.body.items.every((i: any) => i.item_status === 'pending' && i.approved_amount === null)).toBe(true);
    });

    it('rejection is terminal and can be copied into a new draft with lines and receipts', async () => {
      const { claim } = await submittedClaim(users.amit);
      expect((await act(users.vikram, claim.id, 'manager-reject', {})).status).toBe(400);
      const rej = await act(users.vikram, claim.id, 'manager-reject', { comment: 'Trip not pre-approved' });
      expect(rej.body.status).toBe('rejected');
      expect(rej.body.total_approved).toBe(0);
      expect((await act(users.amit, claim.id, 'submit')).status).toBe(409);
      expect(rej.body.allowed_actions).toEqual([]);
      const mine = await detail(users.amit, claim.id);
      expect(mine.body.allowed_actions).toEqual(['copy']);
      const copy = await http().post(`/api/expense-claims/${claim.id}/copy`).set(bearer(users.amit));
      expect(copy.status).toBe(201);
      claimIds.add(copy.body.id);
      expect(copy.body).toMatchObject({ status: 'draft', copied_from_claim_id: claim.id, total_claimed: claim.total_claimed });
      expect(copy.body.items[0].attachments.length).toBe(1);
      expect(copy.body.items[0].item_status).toBe('pending');
      expect((await http().post(`/api/expense-claims/${claim.id}/copy`).set(bearer(users.vikram))).status).toBe(403);
    });

    it('rejecting every line auto-rejects the claim', async () => {
      const { claim, itemId } = await submittedClaim(users.amit);
      const res = await act(users.vikram, claim.id, 'manager-approve', { items: [{ id: itemId, item_status: 'rejected', reviewer_comment: 'Personal travel' }] });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
      expect(res.body.history.some((h: any) => h.action === 'auto_reject')).toBe(true);
    });

    it('withdraw only before the manager acts', async () => {
      const { claim } = await submittedClaim(users.amit);
      expect((await act(users.vikram, claim.id, 'withdraw')).status).toBe(403);
      const w = await act(users.amit, claim.id, 'withdraw');
      expect(w.body.status).toBe('withdrawn');
      expect((await act(users.vikram, claim.id, 'manager-approve')).status).toBe(409);

      const { claim: c2 } = await submittedClaim(users.amit);
      await act(users.vikram, c2.id, 'manager-approve');
      expect((await act(users.amit, c2.id, 'withdraw')).status).toBe(409);
    });

    it('drafts can be deleted (soft) — submitted claims cannot', async () => {
      const c = await draft(users.amit);
      const del = await http().delete(`/api/expense-claims/${c.id}`).set(bearer(users.amit));
      expect(del.status).toBe(200);
      expect((await detail(users.amit, c.id)).status).toBe(404);
      const row = await db.selectFrom('expense_claims').select('deleted_at').where('id', '=', c.id).executeTakeFirst();
      expect(row?.deleted_at).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ approvers
  describe('approver resolution & self-approval', () => {
    it("a manager's own claim goes to their manager and they cannot approve it", async () => {
      const { claim } = await submittedClaim(users.vikram);
      const mgmtUser = await db.selectFrom('users').select('id').where('email', '=', 'mgmt@arihant.com').executeTakeFirstOrThrow();
      expect(claim.manager_id).toBe(mgmtUser.id);
      expect((await act(users.vikram, claim.id, 'manager-approve')).status).toBe(403);
      expect((await act(users.mgmt, claim.id, 'manager-approve', {}, users.vikram)).status).toBe(200);
    });

    it("accounts staff cannot process their own claim", async () => {
      const { claim } = await submittedClaim(users.accounts2);
      expect(claim.manager_id).toBe(users.accounts.id);
      await act(users.accounts, claim.id, 'manager-approve');
      expect((await act(users.accounts2, claim.id, 'accounts-approve')).status).toBe(403);
      expect((await act(users.accounts2, claim.id, 'process', { tally_voucher_ref: 'JV-SELF' })).status).toBe(403);
    });

    it('an employee without a manager falls back to management, never to themselves', async () => {
      const { claim } = await submittedClaim(users.admin);
      expect(claim.manager_id).not.toBe(users.admin.id);
      const role = await db.selectFrom('users').select('role').where('id', '=', claim.manager_id).executeTakeFirstOrThrow();
      expect(role.role).toBe('management');
      expect(claim.history.find((h: any) => h.action === 'submit').metadata.via_fallback).toBe(true);
    });

    it('inactive managers: fallback on submit, admin sees the stuck queue and reassigns', async () => {
      const hash = await bcrypt.hash('password123', 10);
      const region = await db.selectFrom('users').select('region_id').where('id', '=', users.amit.id).executeTakeFirstOrThrow();
      const mgrId = randomUUID();
      const empId = randomUUID();
      tempUserIds.push(empId, mgrId);
      await db.insertInto('users').values({ id: mgrId, full_name: 'Temp Manager M9', email: `m9.mgr.${mgrId.slice(0, 8)}@test.local`, role: 'regional_manager', region_id: region.region_id, password_hash: hash } as any).execute();
      await db.insertInto('users').values({ id: empId, full_name: 'Temp Employee M9', email: `m9.emp.${empId.slice(0, 8)}@test.local`, role: 'sales', region_id: region.region_id, reporting_manager_id: mgrId, password_hash: hash } as any).execute();
      const emp = await login(`m9.emp.${empId.slice(0, 8)}@test.local`);

      const { claim } = await submittedClaim(emp);
      expect(claim.manager_id).toBe(mgrId);
      await db.updateTable('users').set({ is_active: false }).where('id', '=', mgrId).execute();

      const stuck = await http().get('/api/expense-claims?approver_inactive=true').set(bearer(users.admin));
      expect(stuck.body.data.some((c: any) => c.id === claim.id)).toBe(true);
      expect((await http().get('/api/expense-claims/badge-counts').set(bearer(users.admin))).body.approver_inactive).toBeGreaterThan(0);

      const v = (await detail(users.admin, claim.id)).body.version;
      expect((await http().post(`/api/expense-claims/${claim.id}/reassign-approver`).set(bearer(users.amit)).send({ approver_id: users.vikram.id, version: v })).status).toBe(403);
      expect((await http().post(`/api/expense-claims/${claim.id}/reassign-approver`).set(bearer(users.admin)).send({ approver_id: empId, version: v })).status).toBe(400);
      const re = await http().post(`/api/expense-claims/${claim.id}/reassign-approver`).set(bearer(users.admin)).send({ approver_id: users.vikram.id, version: v, comment: 'Manager left the company' });
      expect(re.status).toBe(200);
      expect(re.body.manager_id).toBe(users.vikram.id);
      expect(re.body.history.find((h: any) => h.action === 'reassign_approver').metadata).toMatchObject({ from_approver_id: mgrId, to_approver_id: users.vikram.id });
      expect((await act(users.vikram, claim.id, 'manager-approve', {}, users.admin)).status).toBe(200);

      // New submission while the manager is inactive → fallback approver.
      const second = await submittedClaim(emp);
      expect(second.claim.manager_id).not.toBe(mgrId);

      // Deactivated employees cannot raise new claims (and cannot log in at all).
      await db.updateTable('users').set({ is_active: false }).where('id', '=', empId).execute();
      expect((await http().post('/api/expense-claims').set(bearer(emp)).send({ title: 'x' })).status).toBe(401);
    });
  });

  // ------------------------------------------------------------------ concurrency
  describe('optimistic locking', () => {
    it('two approvers acting on the same version: one wins, the other gets 409', async () => {
      const { claim } = await submittedClaim(users.amit);
      const v = (await detail(users.vikram, claim.id)).body.version;
      const [a, b] = await Promise.all([
        http().post(`/api/expense-claims/${claim.id}/manager-approve`).set(bearer(users.vikram)).send({ version: v }),
        http().post(`/api/expense-claims/${claim.id}/request-clarification`).set(bearer(users.vikram)).send({ version: v, comment: 'Need more detail' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(['STALE_VERSION', 'INVALID_TRANSITION']).toContain(loser.body.code);
      const hist = await db.selectFrom('expense_approval_history').select('action').where('claim_id', '=', claim.id).execute();
      expect(hist.filter((h) => ['manager_approve', 'request_clarification'].includes(h.action)).length).toBe(1);
    });
  });

  // ------------------------------------------------------------------ validation
  describe('line validation over HTTP', () => {
    let claimId: string;
    beforeAll(async () => {
      claimId = (await draft(users.amit)).id;
    });

    it.each([
      ['0', /greater than zero/],
      ['-50', /greater than zero/],
      ['abc', /must be a number/],
      ['1e3', /scientific/],
      ['10.999', /2 decimal/],
      ['1000001', /cannot exceed/],
    ])('rejects amount %p', async (amount, msg) => {
      const res = await addItem(users.amit, claimId, travelItem({ amount }));
      expect(res.status).toBe(400);
      expect(res.body.errors.amount).toMatch(msg);
    });

    it('rejects future dates and needs a reason for late items (then flags them)', async () => {
      expect((await addItem(users.amit, claimId, travelItem({ expense_date: '2999-12-31' }))).body.errors.expense_date).toMatch(/future/);
      const late = await addItem(users.amit, claimId, travelItem({ expense_date: daysAgo(100) }));
      expect(late.body.errors.late_submission_reason).toBeDefined();
      const ok = await addItem(users.amit, claimId, travelItem({ expense_date: daysAgo(100), late_submission_reason: 'Bills received late from agent' }));
      expect(ok.status).toBe(201);
      expect(ok.body.warnings.join(' ')).toMatch(/Late submission/);
      const d = await detail(users.amit, claimId);
      expect(d.body.items.find((i: any) => i.id === ok.body.item.id).is_late).toBe(true);
    });

    it('enforces customer/project for DEMO and remarks for OTHER', async () => {
      expect((await addItem(users.amit, claimId, { expense_date: daysAgo(1), category_id: cat.DEMO, amount: amt(), purpose: 'Freight' })).body.errors.customer_id).toBeDefined();
      expect((await addItem(users.amit, claimId, { expense_date: daysAgo(1), category_id: cat.OTHER, amount: amt(), purpose: 'Misc' })).body.errors.remarks).toBeDefined();
    });

    it('soft cap: FOOD above ₹2,000 needs a remark', async () => {
      const body = { expense_date: daysAgo(1), category_id: cat.FOOD, amount: '2400', purpose: 'Team dinner with CRPF officers', category_details: { meal_type: 'dinner', persons: 6 } };
      expect((await addItem(users.amit, claimId, body)).body.errors.remarks).toMatch(/limit/);
      expect((await addItem(users.amit, claimId, { ...body, remarks: 'Dinner for 6 incl. 4 client officers' })).status).toBe(201);
    });

    it('recomputes local conveyance on the server', async () => {
      const res = await addItem(users.amit, claimId, {
        expense_date: daysAgo(1),
        category_id: cat.LOCAL_CONVEYANCE,
        amount: '1',
        purpose: 'Own vehicle to depot',
        category_details: { from: 'Okhla', to: 'Delhi Depot', km: 23.5, rate_per_km: 9 },
      });
      expect(res.status).toBe(201);
      expect(res.body.item.amount).toBe(211.5);
      expect(res.body.warnings.join(' ')).toMatch(/recalculated/);
    });

    it('rejects hotel stays with check-out before check-in and warns on overlapping stays', async () => {
      const bad = await addItem(users.amit, claimId, { expense_date: daysAgo(2), category_id: cat.HOTEL, amount: amt(), purpose: 'Hotel', category_details: { hotel_name: 'X', check_in: daysAgo(2), check_out: daysAgo(3) } });
      expect(bad.body.errors['category_details.check_out']).toBeDefined();
      const stay = { category_id: cat.HOTEL, purpose: 'Hotel stay', category_details: { hotel_name: 'Hotel Overlap', check_in: daysAgo(6), check_out: daysAgo(4) } };
      expect((await addItem(users.amit, claimId, { ...stay, expense_date: daysAgo(4), amount: amt() })).status).toBe(201);
      const second = await addItem(users.amit, claimId, { ...stay, expense_date: daysAgo(5), amount: amt(), category_details: { hotel_name: 'Other Hotel', check_in: daysAgo(5), check_out: daysAgo(4) } });
      expect(second.status).toBe(201);
      expect(second.body.warnings.join(' ')).toMatch(/overlaps/);
    });

    it('duplicate lines need explicit confirmation, which is logged', async () => {
      const a = amt();
      const other = await draft(users.amit);
      expect((await addItem(users.amit, other.id, travelItem({ amount: a }))).status).toBe(201);
      const dup = await addItem(users.amit, claimId, travelItem({ amount: a }));
      expect(dup.status).toBe(400);
      expect(dup.body.code).toBe('DUPLICATE_CONFIRMATION_REQUIRED');
      expect(dup.body.duplicates[0].claim_number).toBe(other.claim_number);
      const ok = await addItem(users.amit, claimId, travelItem({ amount: a, confirm_not_duplicate: true }));
      expect(ok.status).toBe(201);
      const hist = await db.selectFrom('expense_approval_history').selectAll().where('claim_id', '=', claimId).where('action', '=', 'duplicate_confirmed').execute();
      expect(hist.length).toBe(1);
    });

    it('strips HTML from text fields', async () => {
      const res = await addItem(users.amit, claimId, travelItem({ purpose: '<img src=x onerror=alert(1)>Cab <b>fare</b>' }));
      expect(res.status).toBe(201);
      expect(res.body.item.purpose).toBe('Cab fare');
    });
  });

  // ------------------------------------------------------------------ receipts
  describe('receipts', () => {
    let claimId: string;
    let itemId: string;
    beforeAll(async () => {
      claimId = (await draft(users.amit)).id;
      itemId = (await addItem(users.amit, claimId, travelItem())).body.item.id;
    });

    it('validates file content, not the extension', async () => {
      const fake = await attach(users.amit, itemId, Buffer.from('MZ this is an exe'), 'invoice.pdf');
      expect(fake.status).toBe(400);
      expect(fake.body.errors.file).toMatch(/PDF, JPG, PNG or HEIC/);
    });

    it('sanitises names, serves files only to people who can see the claim', async () => {
      const up = await attach(users.amit, itemId, Buffer.from('%PDF-1.4 ' + randomUUID()), '../../etc/<bill>.pdf');
      expect(up.status).toBe(201);
      expect(up.body.attachment.file_name).toBe('_bill_.pdf');
      const id = up.body.attachment.id;
      const own = await http().get(`/api/expense-attachments/${id}`).set(bearer(users.amit));
      expect(own.status).toBe(200);
      expect(own.headers['content-type']).toBe('application/pdf');
      expect(own.headers['x-content-type-options']).toBe('nosniff');
      // The draft is not visible to the manager or anyone else yet.
      expect((await http().get(`/api/expense-attachments/${id}`).set(bearer(users.vikram))).status).toBe(404);
      expect((await http().get(`/api/expense-attachments/${id}`).set(bearer(users.sneha))).status).toBe(404);
      expect((await http().get(`/api/expense-attachments/${id}`)).status).toBe(401);
    });

    it('caps files per item and warns on a receipt already used elsewhere', async () => {
      const shared = png('same-receipt-' + seq);
      const otherClaim = await draft(users.amit);
      const otherItem = (await addItem(users.amit, otherClaim.id, travelItem())).body.item.id;
      expect((await attach(users.amit, otherItem, shared)).body.warnings).toEqual([]);
      const dup = await attach(users.amit, itemId, shared);
      expect(dup.status).toBe(201);
      expect(dup.body.warnings[0]).toMatch(/already attached/);
      const d = await detail(users.amit, claimId);
      expect(d.body.items[0].duplicate_flag).toBe(true);
      for (let i = 0; i < 5; i++) await attach(users.amit, itemId);
      const over = await attach(users.amit, itemId);
      expect(over.status).toBe(400);
      expect(over.body.errors.file).toMatch(/at most 5/);
    });
  });

  // ------------------------------------------------------------------ trips
  describe('trip links', () => {
    let tripId: string;
    it('only own, non-cancelled trips; item dates must fall in the trip window', async () => {
      const mine = await db.insertInto('trips').values({ employee_id: users.amit.id, trip_date: daysAgo(10), base_location: 'Lucknow', status: 'completed' }).returning('id').executeTakeFirstOrThrow();
      const cancelled = await db.insertInto('trips').values({ employee_id: users.amit.id, trip_date: daysAgo(5), base_location: 'Agra', status: 'cancelled' }).returning('id').executeTakeFirstOrThrow();
      const theirs = await db.insertInto('trips').values({ employee_id: users.sneha.id, trip_date: daysAgo(5), base_location: 'Kolkata', status: 'planned' }).returning('id').executeTakeFirstOrThrow();
      tripIds.push(mine.id, cancelled.id, theirs.id);
      tripId = mine.id;

      expect((await http().post('/api/expense-claims').set(bearer(users.amit)).send({ title: 'Agra', trip_id: cancelled.id })).body.errors.trip_id).toMatch(/Cancelled/);
      expect((await http().post('/api/expense-claims').set(bearer(users.amit)).send({ title: 'Kolkata', trip_id: theirs.id })).body.errors.trip_id).toMatch(/part of/);

      const c = await draft(users.amit, { trip_id: tripId });
      expect(c.trip_id).toBe(tripId);
      const outside = await addItem(users.amit, c.id, travelItem({ expense_date: daysAgo(5) }));
      expect(outside.status).toBe(400);
      expect(outside.body.errors.expense_date).toMatch(/trip dates/);
      expect((await addItem(users.amit, c.id, travelItem({ expense_date: daysAgo(11) }))).status).toBe(201); // within ±1 day
      const linkable = await http().get('/api/expense-claims/linkable').set(bearer(users.amit));
      expect(linkable.body.trips.some((t: any) => t.id === tripId)).toBe(true);
      expect(linkable.body.trips.some((t: any) => t.id === cancelled.id)).toBe(false);
    });
  });

  // ------------------------------------------------------------------ scoping & reports
  describe('role scoping on lists, reports and exports', () => {
    let amitClaim: string;
    beforeAll(async () => {
      amitClaim = (await submittedClaim(users.amit)).claim.id;
    });

    it('other teams cannot see the claim by id, list, report or export', async () => {
      expect((await detail(users.sneha, amitClaim)).status).toBe(404);
      expect((await detail(users.pradeep, amitClaim)).status).toBe(404);
      const list = await http().get(`/api/expense-claims?employee_ids=${users.amit.id}`).set(bearer(users.pradeep));
      expect(list.body.data.length).toBe(0);
      const rep = await http().get(`/api/expense-reports?employee_ids=${users.amit.id}`).set(bearer(users.pradeep));
      expect(rep.body.totals.items).toBe(0);
      const csv = await http().get(`/api/expense-reports/export?format=csv&employee_ids=${users.amit.id}`).set(bearer(users.pradeep));
      expect(csv.text.replace(/^﻿/, '').trim().split('\r\n').length).toBe(1);
      const sneha = await http().get('/api/expense-reports').set(bearer(users.sneha));
      expect(sneha.body.data.every((r: any) => r.employee_id === users.sneha.id)).toBe(true);
    });

    it("a manager sees the team's submitted claims but never their drafts", async () => {
      const d = await draft(users.amit);
      expect((await detail(users.vikram, d.id)).status).toBe(404);
      expect((await detail(users.vikram, amitClaim)).status).toBe(200);
      const team = await http().get(`/api/expense-reports?employee_ids=${users.amit.id}`).set(bearer(users.vikram));
      expect(team.body.totals.items).toBeGreaterThan(0);
    });

    it('accounts only sees claims from the Accounts stage onwards', async () => {
      expect((await detail(users.accounts, amitClaim)).status).toBe(404);
      await act(users.vikram, amitClaim, 'manager-approve');
      expect((await detail(users.accounts, amitClaim)).status).toBe(200);
    });

    it('filters combine; totals reflect the filtered set, not the page', async () => {
      const all = await http().get(`/api/expense-reports?employee_ids=${users.amit.id}&page_size=1`).set(bearer(users.mgmt));
      expect(all.status).toBe(200);
      expect(all.body.data.length).toBe(1);
      expect(all.body.totals.items).toBeGreaterThan(1);
      const travel = await http().get(`/api/expense-reports?employee_ids=${users.amit.id}&category_ids=${cat.TRAVEL}&statuses=accounts_review,processed`).set(bearer(users.mgmt));
      expect(travel.body.data.every((r: any) => r.category_id === cat.TRAVEL && ['accounts_review', 'processed'].includes(r.status))).toBe(true);
      const sum = travel.body.data.reduce((s: number, r: any) => s + r.amount, 0);
      if (travel.body.total <= travel.body.limit) expect(travel.body.totals.total_claimed).toBeCloseTo(sum, 2);
      const bad = await http().get('/api/expense-reports?date_from=2026-06-10&date_to=2026-06-01').set(bearer(users.mgmt));
      expect(bad.status).toBe(400);
      expect(bad.body.errors.date_to).toBeDefined();
      const empty = await http().get('/api/expense-reports?date_from=1990-01-01&date_to=1990-01-02').set(bearer(users.mgmt));
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({ data: [], total: 0 });
      const bySubmitted = await http().get(`/api/expense-claims?date_field=submitted_at&date_from=${today}&date_to=${today}&mine=true`).set(bearer(users.amit));
      expect(bySubmitted.body.data.length).toBeGreaterThan(0);
    });

    it('summary groups by category, employee, region, status and month', async () => {
      const s = await http().get(`/api/expense-reports/summary?employee_ids=${users.amit.id}`).set(bearer(users.mgmt));
      expect(s.status).toBe(200);
      expect(s.body.totals.total_claimed).toBeGreaterThan(0);
      for (const k of ['by_category', 'by_employee', 'by_region', 'by_status', 'by_month']) expect(Array.isArray(s.body[k])).toBe(true);
      const byCat = s.body.by_category.reduce((n: number, g: any) => n + g.total_claimed, 0);
      expect(byCat).toBeCloseTo(s.body.totals.total_claimed, 2);
    });
  });

  // ------------------------------------------------------------------ import
  describe('Excel template & import', () => {
    const buildSheet = async (rows: (string | number)[][]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Expenses');
      ws.addRow([...EXPENSE_IMPORT_TEMPLATE_COLUMNS]);
      rows.forEach((r) => ws.addRow(r));
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');

    it('serves the template', async () => {
      const res = await http().get('/api/expense-claims/import/template').set(bearer(users.amit)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      expect(wb.getWorksheet('Expenses')!.getRow(1).getCell(1).value).toBe(EXPENSE_IMPORT_TEMPLATE_COLUMNS[0]);
      expect(wb.getWorksheet('Categories')!.rowCount).toBeGreaterThanOrEqual(8);
    });

    it('reports every bad row and creates nothing', async () => {
      const before = await db.selectFrom('expense_claims').select(sql<number>`count(*)::int`.as('n')).where('employee_id', '=', users.amit.id).executeTakeFirst();
      const file = await buildSheet([
        [ddmmyyyy(daysAgo(2)), 'TRAVEL', amt(), 'Bus to Kanpur', '', '', '', 'Lucknow', 'Kanpur', 'bus'],
        [ddmmyyyy(daysAgo(2)), 'NOPE', '100', 'x'],
        ['31-31-2026', 'FOOD', '-5', 'Lunch', '', '', '', '', '', '', '', '', '', '', '', 'lunch', 2],
      ]);
      const res = await http().post('/api/expense-claims/import').set(bearer(users.amit)).field('title', 'Imported trip').attach('file', file, 'old-format.xlsx');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IMPORT_FAILED');
      const rows = res.body.row_errors.map((e: any) => e.row);
      expect(rows).toEqual(expect.arrayContaining([3, 4]));
      expect(rows).not.toContain(2);
      const after = await db.selectFrom('expense_claims').select(sql<number>`count(*)::int`.as('n')).where('employee_id', '=', users.amit.id).executeTakeFirst();
      expect(after?.n).toBe(before?.n);
    });

    it('imports a clean sheet as a DRAFT (never submitted)', async () => {
      const file = await buildSheet([
        [ddmmyyyy(daysAgo(2)), 'TRAVEL', amt(), 'Bus to Kanpur', '', '', '', 'Lucknow', 'Kanpur', 'bus'],
        [ddmmyyyy(daysAgo(2)), 'LOCAL_CONVEYANCE', '0', 'Auto to depot', '', '', '', 'Station', 'Depot', '', '', '', '', 12, 10],
        [ddmmyyyy(daysAgo(1)), 'FOOD', amt(), 'Lunch with officers', '', '', '', '', '', '', '', '', '', '', '', 'lunch', 3],
      ]);
      const res = await http().post('/api/expense-claims/import').set(bearer(users.amit)).field('title', 'Imported trip').attach('file', file, 'trip.xlsx');
      expect(res.status).toBe(201);
      claimIds.add(res.body.id);
      expect(res.body.status).toBe('draft');
      expect(res.body.items.length).toBe(3);
      expect(res.body.items.find((i: any) => i.category_code === 'LOCAL_CONVEYANCE').amount).toBe(120);
      expect(res.body.history[0].action).toBe('import');
    });
  });
});
