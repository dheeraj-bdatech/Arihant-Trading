import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];

/**
 * Walks a ticket along the legal spec path until it reaches `target`.
 * received → assigned → visit_scheduled → in_progress → resolved (resolved needs rectification text).
 */
export async function advanceTicket(
  app: INestApplication,
  ticketId: string,
  mgmtToken: string,
  engineerId: string,
  target: 'assigned' | 'visit_scheduled' | 'in_progress' | 'resolved',
) {
  const get = async () =>
    (await request(app.getHttpServer()).get(`/api/service/tickets/${ticketId}`).set('Authorization', `Bearer ${mgmtToken}`)).body;
  const patch = async (body: Record<string, any>) => {
    const r = await request(app.getHttpServer()).patch(`/api/service/tickets/${ticketId}/status`).set('Authorization', `Bearer ${mgmtToken}`).send(body);
    if (r.status !== 200) throw new Error(`advance ${body.status} failed: ${r.status} ${JSON.stringify(r.body)}`);
  };

  let t = await get();
  const order = ['received', 'assigned', 'visit_scheduled', 'in_progress', 'resolved'];
  const rank = (s: string) => order.indexOf(s === 'created' || s === 'new' ? 'received' : s);

  if (rank(t.status) < 1 && rank(target) >= 1) await patch({ status: 'assigned', assigned_to: engineerId });
  t = await get();
  if (rank(t.status) < 2 && rank(target) >= 2) await patch({ status: 'visit_scheduled', planned_visit_date: tomorrow() });
  t = await get();
  if (rank(t.status) < 3 && rank(target) >= 3) await patch({ status: 'in_progress' });
  t = await get();
  if (rank(t.status) < 4 && rank(target) >= 4) await patch({ status: 'resolved', remarks: 'Rectified the fault and verified on site' });
  return get();
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
