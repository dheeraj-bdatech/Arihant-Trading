import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { istDay } from './ist-date';

export { istDay };

/**
 * Walks a ticket along the legal spec path until it reaches `target`.
 * received → assigned → visit_scheduled → in_progress.
 *
 * The visit is scheduled for today (IST): work may only start on/after the scheduled visit day.
 * A ticket is resolved by filing the service report (`fileReport`), never by a status note alone.
 */
export async function advanceTicket(
  app: INestApplication,
  ticketId: string,
  mgmtToken: string,
  engineerId: string,
  target: 'assigned' | 'visit_scheduled' | 'in_progress',
) {
  const get = async () =>
    (await request(app.getHttpServer()).get(`/api/service/tickets/${ticketId}`).set('Authorization', `Bearer ${mgmtToken}`)).body;
  const patch = async (body: Record<string, any>) => {
    const r = await request(app.getHttpServer()).patch(`/api/service/tickets/${ticketId}/status`).set('Authorization', `Bearer ${mgmtToken}`).send(body);
    if (r.status !== 200) throw new Error(`advance ${body.status} failed: ${r.status} ${JSON.stringify(r.body)}`);
  };

  let t = await get();
  const order = ['received', 'assigned', 'visit_scheduled', 'in_progress'];
  const rank = (s: string) => order.indexOf(s === 'created' || s === 'new' ? 'received' : s);

  if (rank(t.status) < 1 && rank(target) >= 1) await patch({ status: 'assigned', assigned_to: engineerId });
  t = await get();
  if (rank(t.status) < 2 && rank(target) >= 2) await patch({ status: 'visit_scheduled', planned_visit_date: istDay(0) });
  t = await get();
  if (rank(t.status) < 3 && rank(target) >= 3) await patch({ status: 'in_progress' });
  return get();
}

/** Files a service report (engineer or admin token); a complete report moves the ticket to report_submitted. */
export async function fileReport(app: INestApplication, ticketId: string, token: string, over: Record<string, any> = {}) {
  const r = await request(app.getHttpServer())
    .post(`/api/service/tickets/${ticketId}/report`)
    .set('Authorization', `Bearer ${token}`)
    .send(validReport(over));
  if (r.status !== 201) throw new Error(`report failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** A fully valid report body; override fields per test. */
export const validReport = (over: Record<string, any> = {}) => ({
  problem_identified: 'Short-circuited diode array PCB',
  action_taken: 'Replaced PCB DA-200 and recalibrated the generator',
  parts_replaced: 'PCB DA-200 (1 unit)',
  customer_confirmation: true,
  customer_confirmation_type: 'Signature',
  customer_name_signed: 'ACP Rajiv Kumar, Station Security Head',
  ...over,
});
