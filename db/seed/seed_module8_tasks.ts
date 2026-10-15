/**
 * Module 8 — Task & Productivity Management demo seed.
 *
 * Masters (holidays, department heads) and every task go through the running API so each one carries a real
 * activity history, blockers, deadline changes, notifications and audit rows. Only the back-dating needed for
 * overdue / late / no-update examples is done directly in Postgres afterwards.
 * Re-running is safe: work items titled "[Seed] …" are created only once.
 *
 *   pnpm --filter @arihant/api seed:module8      (API must be running on API_URL, default http://localhost:4000/api)
 *
 * Covers: every status, blockers in every state (pending, accepted-pause, accepted-extend, rejected, resolved,
 * withdrawn, approved leave), overdue + no-update, on-time / late-excused / late-unexcused, rework, reassignment,
 * escalation, recurring weekly + monthly series, a cancelled task, "waiting on me", leave, and a submitted
 * performance review with the employee's response.
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const day = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
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

async function attach(s: Session, taskId: string, purpose: string, name = 'site-photo.png') {
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', new Blob([Buffer.concat([PNG, Buffer.from(`seed-${Math.random()}`)])], { type: 'image/png' }), name);
  const res = await fetch(`${API}/tasks/${taskId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: form });
  if (!res.ok) throw new Error(`upload → ${res.status}: ${await res.text()}`);
}

const detail = (s: Session, id: string) => call(s, 'GET', `/tasks/${id}`);
const act = async (s: Session, id: string, action: string, body: Record<string, unknown> = {}) => call(s, 'POST', `/tasks/${id}/${action}`, { version: (await detail(s, id)).version, ...body });
const blocker = async (s: Session, id: string, body: Record<string, unknown>) => call(s, 'POST', `/tasks/${id}/blockers`, { version: (await detail(s, id)).version, ...body });
const decide = async (s: Session, taskId: string, decision: string, body: Record<string, unknown>) => {
  const d = await detail(s, taskId);
  const b = d.blockers.find((x: any) => x.open);
  return call(s, 'POST', `/task-blockers/${b.id}/${decision}`, { version: d.version, ...body });
};

/**
 * Back-dates a task's whole history by `shiftDays` (task, updates, blockers, deadline changes, reassignments,
 * escalations, files) so overdue / late / no-update examples exist. Seed only: triggers are bypassed.
 * `completedDaysAgo` then moves just the hand-in moment to create a late completion.
 */
async function backdate(taskId: string, shiftDays: number, opts: { completedDaysAgo?: number } = {}) {
  const client = await pool.connect();
  const iv = `${shiftDays} days`;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `UPDATE tasks SET created_at = created_at - $2::interval, start_date = start_date - $3::int, deadline = deadline - $2::interval,
         original_deadline = original_deadline - $2::interval, started_at = started_at - $2::interval, completed_at = completed_at - $2::interval,
         approved_at = approved_at - $2::interval, last_update_at = last_update_at - $2::interval, first_overdue_at = NULL
       WHERE id = $1`,
      [taskId, iv, shiftDays],
    );
    await client.query('UPDATE task_updates SET created_at = created_at - $2::interval WHERE task_id = $1', [taskId, iv]);
    await client.query(
      `UPDATE task_blockers SET created_at = created_at - $2::interval, decided_at = decided_at - $2::interval, resolved_at = resolved_at - $2::interval,
         deadline_at_raise = deadline_at_raise - $2::interval, requested_new_deadline = requested_new_deadline - $2::interval WHERE task_id = $1`,
      [taskId, iv],
    );
    await client.query('UPDATE task_deadline_changes SET created_at = created_at - $2::interval, old_deadline = old_deadline - $2::interval, new_deadline = new_deadline - $2::interval WHERE task_id = $1', [taskId, iv]);
    await client.query('UPDATE task_assignment_history SET created_at = created_at - $2::interval WHERE task_id = $1', [taskId, iv]);
    await client.query('UPDATE task_escalations SET created_at = created_at - $2::interval WHERE task_id = $1', [taskId, iv]);
    await client.query('UPDATE task_attachments SET uploaded_at = uploaded_at - $2::interval WHERE task_id = $1', [taskId, iv]);
    if (opts.completedDaysAgo !== undefined) {
      const at = `${opts.completedDaysAgo} days`;
      await client.query("UPDATE tasks SET completed_at = now() - $2::interval WHERE id = $1", [taskId, at]);
      await client.query("UPDATE task_updates SET created_at = now() - $2::interval WHERE task_id = $1 AND kind IN ('complete', 'submit_for_approval')", [taskId, at]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`Seeding Module 8 through ${API}`);
  const [admin, mgmt, vikram, amit, pooja, anil, suresh, tenderExec] = await Promise.all([
    login('admin@arihant.com'),
    login('mgmt@arihant.com'),
    login('regmgr.north@arihant.com'),
    login('sales.delhi@arihant.com'),
    login('sales.jaipur@arihant.com'),
    login('service@arihant.com'),
    login('tender@arihant.com'),
    login('tender.exec@arihant.com'),
  ]);

  const seeded = await call(mgmt, 'GET', `/tasks?search=${encodeURIComponent('[Seed]')}&include_cancelled=true&page_size=100`);
  const have = new Set<string>(seeded.data.map((t: any) => t.title));
  const templates = await call(mgmt, 'GET', `/task-templates?search=${encodeURIComponent('[Seed]')}`);
  const haveTpl = new Set<string>(templates.map((t: any) => t.title));

  // ---------------------------------------------------------------- masters
  const holidays: [string, string][] = [
    ['2026-10-02', 'Gandhi Jayanti'],
    ['2026-10-20', 'Dussehra'],
    ['2026-11-08', 'Diwali'],
    ['2026-11-24', 'Guru Nanak Jayanti'],
    ['2026-12-25', 'Christmas'],
    ['2027-01-26', 'Republic Day'],
  ];
  for (const [d, name] of holidays) await call(admin, 'POST', '/task-calendar/holidays', { holiday_date: d, name });
  const depts = await call(admin, 'GET', '/task-calendar/departments');
  const deptId = (code: string) => depts.find((d: any) => d.code === code)?.id;
  if (deptId('tenders')) await call(admin, 'PATCH', `/task-calendar/departments/${deptId('tenders')}`, { head_user_id: suresh.id });
  if (deptId('service')) await call(admin, 'PATCH', `/task-calendar/departments/${deptId('service')}`, { head_user_id: anil.id });

  const leaves = await call(vikram, 'GET', `/task-calendar/leaves?employee_id=${pooja.id}`);
  if (!leaves.some((l: any) => l.from_date === day(6))) {
    await call(vikram, 'POST', '/task-calendar/leaves', { employee_id: pooja.id, from_date: day(6), to_date: day(8), leave_type: 'casual', reason: 'Family wedding (approved)' });
  }

  // ---------------------------------------------------------------- links
  const cats: any[] = await call(vikram, 'GET', '/task-categories');
  const cat = (code: string) => cats.find((c) => c.code === code).id;
  const [customer] = await call(vikram, 'GET', '/tasks/lookups/links?type=customer&search=bsf');
  const [anyCustomer] = await call(vikram, 'GET', '/tasks/lookups/links?type=customer');
  const [tender] = await call(vikram, 'GET', '/tasks/lookups/links?type=tender');
  const [demo] = await call(vikram, 'GET', '/tasks/lookups/links?type=demo');
  const [ticket] = await call(vikram, 'GET', '/tasks/lookups/links?type=service');
  const custId = (customer || anyCustomer)?.id;

  const make = async (s: Session, title: string, body: Record<string, unknown>) => {
    if (have.has(title)) {
      console.log(`  ⏩ ${title}`);
      return null;
    }
    const r = await call(s, 'POST', '/tasks', { title, category_id: cat('GENERAL'), priority: 'medium', ...body });
    console.log(`  ✓ ${r.data[0].task_number} ${title}`);
    return r.data[0].id as string;
  };

  // 1. In progress with a progress note (customer task)
  let id = await make(vikram, '[Seed] Submit EMD refund request to BSF procurement', {
    category_id: cat('CUSTOMER'), customer_id: custId, assignee_ids: [amit.id], deadline: day(2), priority: 'high',
    description: 'Formal request for refund of EMD against the closed BSF tender.', expected_outcome: 'Acknowledged request letter from BSF accounts',
  });
  if (id) {
    await act(amit, id, 'start');
    await act(amit, id, 'progress', { progress_percent: 40, comment: 'Drafted the request letter; waiting for the tender reference from accounts.' });
  }

  // 2. Tender task, evidence + approval → awaiting approval
  if (tender) {
    id = await make(vikram, '[Seed] Upload PQ documents on the tender portal', {
      category_id: cat('TENDER'), tender_id: tender.id, assignee_ids: [amit.id], deadline: day(4), priority: 'critical', evidence_required: true, approval_required: true,
      expected_outcome: 'PQ envelope uploaded and acknowledgement saved',
    });
    if (id) {
      await act(amit, id, 'start');
      await attach(amit, id, 'evidence', 'portal-acknowledgement.png');
      await act(amit, id, 'complete', { remarks: 'All PQ documents uploaded; acknowledgement screenshot attached.', confirm_full_completion: true });
    }
  }

  // 3. Demo task blocked — pending review (customer dependency)
  if (demo) {
    id = await make(vikram, '[Seed] Confirm demo slot with the procurement committee', { category_id: cat('DEMO'), demo_id: demo.id, assignee_ids: [pooja.id], deadline: day(3), priority: 'high' });
    if (id) {
      await act(pooja, id, 'start');
      await blocker(pooja, id, { blocker_type: 'customer_dependency', description: 'Committee chairman is on tour; secretary will confirm the slot after his return.', expected_resolution_date: day(2) });
    }
  }

  // 4. Service task — blocker accepted (pause)
  if (ticket) {
    id = await make(vikram, '[Seed] Collect signed service report from the station master', { category_id: cat('SERVICE'), service_ticket_id: ticket.id, assignee_ids: [anil.id], deadline: day(2), evidence_required: true });
    if (id) {
      await act(anil, id, 'start');
      await blocker(anil, id, { blocker_type: 'management_approval', approval_pending_from: 'Divisional Security Commissioner', description: 'Station master needs written approval from the DSC before signing the report.' });
      await decide(vikram, id, 'accept', { mode: 'pause', comment: 'Genuine dependency — DSC approval is outside our control.' });
    }
  }

  // 5. Overdue + no update
  id = await make(vikram, '[Seed] Update the regional sales funnel sheet', { assignee_ids: [amit.id], deadline: day(1) });
  if (id) {
    await act(amit, id, 'start');
    await backdate(id, 8); // deadline 7 days ago, last update 8 days ago
  }

  // 6. Completed on time
  id = await make(vikram, '[Seed] Visit Delhi Police HQ for X-ray AMC renewal', { category_id: cat('CUSTOMER'), customer_id: anyCustomer?.id, assignee_ids: [amit.id], deadline: day(1) });
  if (id) {
    await act(amit, id, 'start');
    await act(amit, id, 'complete', { remarks: 'Met the ACP; renewal note submitted.', confirm_full_completion: true });
  }

  // 7. Completed late — unexcused
  id = await make(vikram, '[Seed] Share revised quotation with RPF', { category_id: cat('CUSTOMER'), customer_id: anyCustomer?.id, assignee_ids: [amit.id], deadline: day(1) });
  if (id) {
    await act(amit, id, 'start');
    await act(amit, id, 'complete', { remarks: 'Quotation shared by email.', confirm_full_completion: true });
    await backdate(id, 10, { completedDaysAgo: 2 }); // deadline 9 days ago, handed in 2 days ago
  }

  // 8. Blocker rejected → back in progress, overdue
  id = await make(vikram, '[Seed] Coordinate OEM delivery schedule', { assignee_ids: [pooja.id], deadline: day(2) });
  if (id) {
    await act(pooja, id, 'start');
    await blocker(pooja, id, { blocker_type: 'vendor_dependency', vendor_name: 'OEM logistics desk', description: 'OEM has not shared the dispatch plan yet despite two reminders.' });
    await decide(vikram, id, 'reject', { comment: 'Call the OEM country manager directly — this is routine follow-up, not a blocker.' });
    await backdate(id, 4); // deadline 2 days ago, blocker rejected → unexcused
  }

  // 9. Extension granted before the deadline → late but excused
  id = await make(vikram, '[Seed] Draft tender clarification letter', { assignee_ids: [pooja.id], deadline: day(1) });
  if (id) {
    await act(pooja, id, 'start');
    await act(vikram, id, 'extend-deadline', { new_deadline: day(5), reason: 'Customer moved the pre-bid meeting.' });
    await act(pooja, id, 'complete', { remarks: 'Clarification letter sent to the tender inviting authority.', confirm_full_completion: true });
    await backdate(id, 12, { completedDaysAgo: 9 }); // original -11, extended to -7, handed in -9 → late but excused
  }

  // 10. Cancelled
  id = await make(vikram, '[Seed] Duplicate customer survey (created twice)', { assignee_ids: [pooja.id], deadline: day(5) });
  if (id) await act(vikram, id, 'cancel', { reason: 'Duplicate of an existing task.' });

  // 11. Another employee — Amit waits on Pooja ("Waiting on me" for Pooja)
  id = await make(vikram, '[Seed] Consolidate Rajasthan police requirement matrix', { assignee_ids: [amit.id], deadline: day(4) });
  if (id) {
    await act(amit, id, 'start');
    await blocker(amit, id, { blocker_type: 'another_employee', dependency_user_id: pooja.id, description: 'Need the Jaipur range requirement list from Pooja before consolidating.' });
  }

  // 12. Blocker withdrawn, 13. blocker resolved after extend
  id = await make(vikram, '[Seed] Book venue for the product seminar', { assignee_ids: [pooja.id], deadline: day(6) });
  if (id) {
    await blocker(pooja, id, { blocker_type: 'missing_information', description: 'Waiting for the final attendee count from marketing.' });
    await decide(pooja, id, 'withdraw', { comment: 'Got the count on a call.' });
  }
  id = await make(vikram, '[Seed] Renew GeM seller registration documents', { assignee_ids: [amit.id], deadline: day(2) });
  if (id) {
    await act(amit, id, 'start');
    await blocker(amit, id, { blocker_type: 'external_portal_issue', portal_name: 'GeM', description: 'GeM document upload fails with a server error since this morning.' });
    await decide(vikram, id, 'accept', { mode: 'extend', new_deadline: day(5), comment: 'Portal outage confirmed by other vendors.' });
    await decide(amit, id, 'resolve', { note: 'Portal is back; documents uploaded.' });
  }

  // 14. Reassigned, 15. escalated, 16. sent back for rework
  id = await make(vikram, '[Seed] Prepare compliance statement for CISF bid', { assignee_ids: [amit.id], deadline: day(5) });
  if (id) await act(vikram, id, 'reassign', { to_user_id: pooja.id, reason_type: 'workload', reason: 'Amit is handling the BSF closure this week.' });
  id = await make(vikram, '[Seed] Resolve pricing approval for Army bid', { assignee_ids: [pooja.id], deadline: day(3), priority: 'critical' });
  if (id) await act(vikram, id, 'escalate', { reason: 'Needs MD sign-off on the discount before submission.' });
  id = await make(vikram, '[Seed] Compile customer feedback forms', { assignee_ids: [amit.id], deadline: day(3), approval_required: true });
  if (id) {
    await act(amit, id, 'complete', { remarks: 'Collected 12 feedback forms.', confirm_full_completion: true });
    await act(vikram, id, 'send-back', { reason: 'Forms from the Ghaziabad unit are missing.' });
  }

  // 17. Department head (tender cell) and a self-task
  await make(suresh, '[Seed] Verify EMD instrument validity for open bids', { assignee_ids: [tenderExec.id], deadline: day(3), priority: 'high' });
  await make(amit, '[Seed] Follow up with CISF stores on sample return', { assignee_ids: [amit.id], deadline: day(2) });

  // 18. Recurring series
  if (!haveTpl.has('[Seed] Weekly funnel review call')) {
    await call(vikram, 'POST', '/tasks', {
      title: '[Seed] Weekly funnel review call', category_id: cat('GENERAL'), assignee_ids: [amit.id, pooja.id], priority: 'medium',
      recurrence_type: 'weekly', recurrence_rule: { weekdays: [1, 4] }, start_date: day(0), due_time: '18:00', holiday_policy: 'shift_after', leave_policy: 'skip',
    });
    console.log('  ✓ recurring weekly series (Amit, Pooja)');
  }
  if (!haveTpl.has('[Seed] Monthly AMC compliance checklist')) {
    await call(vikram, 'POST', '/tasks', {
      title: '[Seed] Monthly AMC compliance checklist', category_id: cat('GENERAL'), assignee_ids: [anil.id], priority: 'high', evidence_required: true,
      recurrence_type: 'monthly', recurrence_rule: { month_last_working_day: true }, start_date: day(0), due_time: '17:00',
    });
    console.log('  ✓ recurring monthly series (Anil, last working day)');
  }

  // 19. Performance review, submitted with the employee's response
  const reviews = await call(vikram, 'GET', `/performance-reviews?employee_id=${amit.id}`);
  if (!reviews.length) {
    const r = await call(vikram, 'POST', '/performance-reviews', {
      employee_id: amit.id, period_from: day(-30), period_to: day(0), rating: 4,
      strengths: 'Strong customer relationships in Delhi NCR; proactive on follow-ups.',
      improvement_areas: 'Turnaround on documentation and quotation revisions.',
      comments: 'Consistent field coverage this month. One quotation went out late without a recorded blocker.',
    });
    await call(vikram, 'POST', `/performance-reviews/${r.id}/submit`, { version: r.version });
    await call(amit, 'POST', `/performance-reviews/${r.id}/respond`, { response: 'The RPF quotation was late because pricing approval came late; I will raise a blocker next time.' });
    console.log('  ✓ performance review (submitted + response)');
  }

  console.log('Done. Log in as regmgr.north@arihant.com (manager) or sales.delhi@arihant.com (employee), password password123.');
}

main()
  .catch((err) => {
    console.error('❌ Module 8 seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
