/**
 * Module 9 — Expense Management demo seed.
 *
 * Masters (employee codes, a trip with visits, a project) go straight into Postgres; every claim is
 * then driven through the running API so it carries a real approval history, receipts and
 * notifications. Re-running is safe: claims titled "[Seed] …" are created only once.
 *
 *   pnpm --filter @arihant/api seed:module9          (API must be running on API_URL, default http://localhost:4000/api)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../apps/api/.env') });

const API = process.env.API_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD || 'password123';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres' });

// A real 1×1 PNG; a random trailer after IEND keeps every receipt's hash unique while still rendering.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const receiptPng = () => Buffer.concat([PNG, Buffer.from(`seed-${Math.random()}`)]);
const receiptPdf = (text: string) => {
  const body = `BT /F1 18 Tf 40 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n% ${Math.random()}`;
  return Buffer.from(pdf);
};

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

type Session = { token: string; id: string; name: string };

async function call<T = any>(s: Session, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(data.errors || data.message)}`);
  return data as T;
}

async function login(email: string): Promise<Session> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${email}: ${data.message}`);
  return { token: data.accessToken || data.token, id: data.user.id, name: data.user.full_name };
}

async function attach(s: Session, itemId: string, file: Buffer, name: string, mime: string) {
  const form = new FormData();
  form.append('file', new Blob([file], { type: mime }), name);
  const res = await fetch(`${API}/expense-items/${itemId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: form });
  if (!res.ok) throw new Error(`upload → ${res.status}: ${await res.text()}`);
}

async function act(s: Session, claimId: string, action: string, body: Record<string, unknown> = {}) {
  const c = await call(s, 'GET', `/expense-claims/${claimId}`);
  return call(s, 'POST', `/expense-claims/${claimId}/${action}`, { version: c.version, ...body });
}

async function main() {
  console.log(`💸 Module 9 seed → ${API}`);
  const health = await fetch(`${API}/expense-categories`).catch(() => null);
  if (!health) throw new Error(`The API is not reachable at ${API}. Start it first (pnpm --filter @arihant/api dev).`);

  // ---------------------------------------------------------------- masters (direct SQL)
  const db = await pool.connect();
  try {
    await db.query(`
      UPDATE users u SET employee_code = 'ATC-' || upper(left(u.role::text, 3)) || '-' || lpad(r.n::text, 3, '0')
      FROM (SELECT id, row_number() OVER (ORDER BY role, email) AS n FROM users) r
      WHERE r.id = u.id AND u.employee_code IS NULL`);
    await db.query(`INSERT INTO projects (code, name, organisation_id)
      SELECT 'PRJ-CRPF-XBIS', 'CRPF Lucknow XBIS roll-out', (SELECT id FROM organisations ORDER BY created_at LIMIT 1)
      ON CONFLICT (code) DO NOTHING`);
    await db.query(`INSERT INTO projects (code, name) VALUES ('PRJ-AMC-2026', 'Annual maintenance contracts 2026') ON CONFLICT (code) DO NOTHING`);
  } finally {
    db.release();
  }

  const amit = await login('sales.delhi@arihant.com');
  const pooja = await login('sales.jaipur@arihant.com');
  const ramesh = await login('demo@arihant.com');
  const anil = await login('service@arihant.com');
  const vikram = await login('regmgr.north@arihant.com');
  const accounts = await login('accounts@arihant.com');

  const existing = await call(amit, 'GET', '/expense-claims?mine=true&search=[Seed]&page_size=50');
  if (existing.total > 0) {
    console.log(`   ⏩ Seed claims already exist (${existing.total} for ${amit.name}). Nothing to do.`);
    return;
  }

  const cats: Record<string, string> = {};
  for (const c of await call<any[]>(amit, 'GET', '/expense-categories')) cats[c.code] = c.id;
  const orgs = (await call(amit, 'GET', '/organisations?limit=5')).data as { id: string; name: string }[];
  const projects = await call<any[]>(amit, 'GET', '/projects');
  const customer = orgs[0];

  // A trip with two visits for Amit (so trip-linked claims and date windows are realistic).
  const tripClient = await pool.connect();
  let tripId: string;
  try {
    const t = await tripClient.query(
      `INSERT INTO trips (employee_id, trip_date, base_location, status, notes, created_by) VALUES ($1, $2, 'Lucknow', 'completed', '[Seed] CRPF demo trip', $1) RETURNING id`,
      [amit.id, daysAgo(12)],
    );
    tripId = t.rows[0].id;
    for (const [i, org] of orgs.slice(0, 2).entries()) {
      await tripClient.query(
        `INSERT INTO visits (organisation_id, planned_by, assigned_to, planned_date, purpose, status, trip_id, location) VALUES ($1, $2, $2, $3, $4, 'completed', $5, 'Lucknow')`,
        [org.id, amit.id, daysAgo(12 - i), `[Seed] Demo & follow-up at ${org.name}`, tripId],
      );
    }
  } finally {
    tripClient.release();
  }

  type Line = Record<string, unknown> & { receipt?: 'png' | 'pdf' };
  const make = async (s: Session, title: string, lines: Line[], header: Record<string, unknown> = {}) => {
    const claim = await call(s, 'POST', '/expense-claims', { title: `[Seed] ${title}`, ...header });
    for (const { receipt, ...line } of lines) {
      const r = await call(s, 'POST', `/expense-claims/${claim.id}/items`, line);
      if (receipt) await attach(s, r.item.id, receipt === 'pdf' ? receiptPdf(String(line.purpose)) : receiptPng(), receipt === 'pdf' ? 'bill.pdf' : 'receipt.png', receipt === 'pdf' ? 'application/pdf' : 'image/png');
    }
    return claim.id as string;
  };

  const trip = (n: number) => daysAgo(n);
  const travel = (date: string, amount: string, from: string, to: string, mode: string, purpose: string): Line => ({
    expense_date: date, category_id: cats.TRAVEL, amount, purpose, category_details: { from, to, mode }, receipt: 'pdf',
  });

  // 1. Draft (trip-linked, still being filled in)
  await make(amit, 'Lucknow CRPF demo trip — draft', [
    travel(trip(12), '1845.00', 'New Delhi', 'Lucknow', 'train', 'Shatabdi to Lucknow for CRPF demo'),
    { expense_date: trip(12), category_id: cats.LOCAL_CONVEYANCE, amount: '0', purpose: 'Station to CRPF campus', category_details: { from: 'Charbagh', to: 'CRPF Bijnor Road', km: 18, rate_per_km: 12 } },
  ], { trip_id: tripId });

  // 2. Submitted, waiting on the manager
  const submitted = await make(amit, 'Jaipur police HQ follow-up', [
    travel(daysAgo(4), '2350.50', 'Delhi', 'Jaipur', 'bus', 'Volvo to Jaipur for PHQ meeting'),
    { expense_date: daysAgo(4), category_id: cats.FOOD, amount: '640', purpose: 'Lunch with PHQ procurement team', customer_id: customer.id, category_details: { meal_type: 'lunch', persons: 3 }, receipt: 'png' },
  ]);
  await act(amit, submitted, 'submit');

  // 3. Manager approved with a partial reduction → Accounts review
  const inAccounts = await make(ramesh, 'Demo unit freight to Kanpur', [
    { expense_date: daysAgo(9), category_id: cats.DEMO, amount: '7800', purpose: 'Freight for XBIS demo unit', project_id: projects[0]?.id, receipt: 'pdf' },
    { expense_date: daysAgo(9), category_id: cats.HOTEL, amount: '9200', purpose: 'Hotel during demo', remarks: 'Only hotel near the venue', category_details: { hotel_name: 'Hotel Landmark', check_in: daysAgo(10), check_out: daysAgo(9) }, receipt: 'pdf' },
  ]);
  await act(ramesh, inAccounts, 'submit');
  const ia = await call(vikram, 'GET', `/expense-claims/${inAccounts}`);
  const hotelLine = ia.items.find((i: any) => i.category_code === 'HOTEL');
  await act(vikram, inAccounts, 'manager-approve', {
    comment: 'Approved; hotel limited to grade entitlement',
    items: [{ id: hotelLine.id, item_status: 'partially_approved', approved_amount: '8000', reviewer_comment: 'Grade entitlement is ₹8,000 per night' }],
  });

  // 4. Verified by Accounts, ready for Tally
  const ready = await make(anil, 'Service visit — Rajasthan police', [
    { expense_date: daysAgo(7), category_id: cats.SERVICE, amount: '3150', purpose: 'Spare fuse kit for DFMD', customer_id: customer.id, receipt: 'png' },
    travel(daysAgo(7), '1460', 'Delhi', 'Jaipur', 'train', 'Train to site'),
  ]);
  await act(anil, ready, 'submit');
  const anilClaim = await call(anil, 'GET', `/expense-claims/${ready}`);
  const anilApprover = anilClaim.manager_id === vikram.id ? vikram : await login('mgmt@arihant.com');
  await act(anilApprover, ready, 'manager-approve');
  await act(accounts, ready, 'accounts-approve');

  // 5. Processed in Tally
  const processed = await make(amit, 'Gurgaon client site visits', [
    travel(daysAgo(20), '980', 'Connaught Place', 'Gurgaon', 'cab', 'Cab to Gurgaon client site'),
  ]);
  await act(amit, processed, 'submit');
  await act(vikram, processed, 'manager-approve');
  await act(accounts, processed, 'process', { tally_voucher_ref: 'JV/2026/0412', payment_reference: 'NEFT-UTR-77812', payment_date: daysAgo(2) });

  // 6. Clarification requested by the manager
  const clarify = await make(pooja, 'Ajmer BSF demo — taxi and meals', [
    { expense_date: daysAgo(5), category_id: cats.LOCAL_CONVEYANCE, amount: '1650', purpose: 'Taxi for full day at BSF camp', category_details: { from: 'Ajmer', to: 'BSF camp' }, receipt: 'png' },
    { expense_date: daysAgo(5), category_id: cats.FOOD, amount: '2600', purpose: 'Dinner with BSF officers', remarks: 'Six officers hosted', category_details: { meal_type: 'dinner', persons: 6 }, receipt: 'png' },
  ]);
  await act(pooja, clarify, 'submit');
  await act(vikram, clarify, 'request-clarification', { comment: 'Please attach the taxi log sheet and list the officers hosted at dinner.' });

  // 7. Rejected (can be copied into a new draft)
  const rejected = await make(pooja, 'Personal travel booked by mistake', [
    travel(daysAgo(15), '5400', 'Jaipur', 'Mumbai', 'flight', 'Flight to Mumbai'),
  ]);
  await act(pooja, rejected, 'submit');
  await act(vikram, rejected, 'manager-reject', { comment: 'No customer meeting on record for this trip.' });

  // 8. Withdrawn by the employee
  const withdrawn = await make(amit, 'Duplicate of Jaipur claim', [
    { expense_date: daysAgo(4), category_id: cats.OTHER, amount: '300', purpose: 'Parking charges', remarks: 'PHQ visitor parking', receipt: 'png' },
  ]);
  await act(amit, withdrawn, 'submit');
  await act(amit, withdrawn, 'withdraw');

  // 9. Late submission (older than 90 days) waiting on the manager
  const late = await make(amit, 'June expo travel (late)', [
    { ...travel(daysAgo(110), '4200', 'Delhi', 'Kolkata', 'train', 'Rajdhani to Kolkata for expo'), late_submission_reason: 'Original bills were with the travel desk until last week' },
  ]);
  await act(amit, late, 'submit');

  console.log('   ✓ Seeded 9 claims covering draft, submitted, accounts review, ready for Tally, processed, clarification, rejected, withdrawn and late.');
}

main()
  .catch((err) => {
    console.error('❌ Module 9 seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

