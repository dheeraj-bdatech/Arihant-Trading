import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { containsPattern } from '../../common/utils/like-pattern.js';
import type { Database, PaginatedResult } from '@arihant/shared';

export interface AuditQuery {
  page?: number;
  limit?: number;
  /** One entity type, or several comma-separated (a module filter sends its group). */
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  /** One action code, or several comma-separated. */
  action?: string;
  /** Only the important changes (PRD audit list): approvals / rejections, cancellations, reassignments, deadline and
   *  status changes, availability changes, outcomes, holds, reopen, delete, deactivation. Plain create / edit rows are left out. */
  key_changes?: boolean | string;
  /** IST calendar days, inclusive. */
  date_from?: string;
  date_to?: string;
  /** Matches the action, the actor's name and the record's label. */
  search?: string;
}

/** Action codes that are "important changes" in the PRD sense (see AuditQuery.key_changes). */
const KEY_CHANGE_PATTERN =
  'deadline|approv|reject|cancel|reassign|availability|status|stage|_won|_lost|converted|closed|reopen|hold|resum|delet|deactivat|outcome|submitted|reschedul';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Human label of the record an audit row is about (tender number, proposal number, ticket number, person …), so the
 * trail reads "TND QA-TEST/2026/FE-001" instead of a uuid. Resolved per row; a deleted record falls back to null.
 */
const ENTITY_LABEL: RawBuilder<string | null> = sql<string | null>`case audit_log.entity_type
  when 'tender' then (select coalesce(t.tender_number, t.tender_no) from tenders t where t.id = audit_log.entity_id)
  when 'proposal' then (select coalesce(p.proposal_number, p.proposal_no) from proposals p where p.id = audit_log.entity_id)
  when 'lead' then (select concat_ws(' · ', o.name, pr.name) from leads l left join organisations o on o.id = l.organisation_id left join products pr on pr.id = l.product_id where l.id = audit_log.entity_id)
  when 'service_ticket' then (select coalesce(s.ticket_no, s.ticket_number) from service_tickets s where s.id = audit_log.entity_id)
  when 'service_report' then (select concat('Report · ', coalesce(s.ticket_no, s.ticket_number)) from service_reports r join service_tickets s on s.id = r.ticket_id where r.id = audit_log.entity_id)
  when 'visit' then (select concat_ws(' · ', o.name, to_char(v.planned_date, 'DD Mon YYYY')) from visits v left join organisations o on o.id = v.organisation_id where v.id = audit_log.entity_id)
  when 'trip' then (select concat('Tour · ', u.full_name) from trips tr join users u on u.id = tr.employee_id where tr.id = audit_log.entity_id)
  when 'demo' then (select coalesce(d.demo_no, d.purpose) from demos d where d.id = audit_log.entity_id)
  when 'demo_equipment' then (select concat_ws(' · ', pr.name, e.serial_no) from demo_equipment e left join products pr on pr.id = e.product_id where e.id = audit_log.entity_id)
  when 'demo_reservation' then (select concat('Reservation · ', d.demo_no) from demo_reservations r join demos d on d.id = r.demo_id where r.id = audit_log.entity_id)
  when 'expense_claim' then (select coalesce(c.claim_number, c.title) from expense_claims c where c.id = audit_log.entity_id)
  when 'expense' then (select e.purpose from expenses e where e.id = audit_log.entity_id)
  when 'delivery' then (select dl.delivery_no from deliveries dl where dl.id = audit_log.entity_id)
  when 'user' then (select u.full_name from users u where u.id = audit_log.entity_id)
  when 'task' then (select concat_ws(' · ', tk.task_number, tk.title) from tasks tk where tk.id = audit_log.entity_id)
  when 'task_blocker' then (select concat('Blocker · ', tk.title) from task_blockers b join tasks tk on tk.id = b.task_id where b.id = audit_log.entity_id)
  when 'organisation' then (select o.name from organisations o where o.id = audit_log.entity_id)
end`;

@Injectable()
export class AuditService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private filtered(query: AuditQuery) {
    let q = this.db.selectFrom('audit_log').leftJoin('users as actor', 'audit_log.actor_id', 'actor.id');

    const types = (query.entity_type || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length) q = q.where('audit_log.entity_type', 'in', types);

    if (query.entity_id) {
      if (!UUID_RE.test(query.entity_id)) throw new BadRequestException('entity_id must be a uuid');
      q = q.where('audit_log.entity_id', '=', query.entity_id);
    }
    if (query.actor_id) {
      if (!UUID_RE.test(query.actor_id)) throw new BadRequestException('actor_id must be a uuid');
      q = q.where('audit_log.actor_id', '=', query.actor_id);
    }
    const actions = (query.action || '').split(',').map((a) => a.trim()).filter(Boolean);
    if (actions.length) q = q.where('audit_log.action', 'in', actions);
    if (query.key_changes === true || query.key_changes === 'true') {
      q = q.where(sql<boolean>`audit_log.action ~* ${KEY_CHANGE_PATTERN}`);
    }

    for (const [key, day] of [['date_from', query.date_from], ['date_to', query.date_to]] as const) {
      if (day && !DAY_RE.test(day)) throw new BadRequestException(`${key} must be YYYY-MM-DD`);
    }
    // IST calendar days, inclusive on both ends.
    if (query.date_from) {
      q = q.where(sql<boolean>`audit_log.created_at >= (${query.date_from}::date::timestamp at time zone 'Asia/Kolkata')`);
    }
    if (query.date_to) {
      q = q.where(sql<boolean>`audit_log.created_at < ((${query.date_to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`);
    }

    if (query.search?.trim()) {
      const s = containsPattern(query.search);
      q = q.where((eb) =>
        eb.or([
          sql<boolean>`lower(audit_log.action) like ${s}`,
          sql<boolean>`lower(replace(audit_log.entity_type, '_', ' ')) like ${s}`,
          sql<boolean>`lower(coalesce(actor.full_name, '')) like ${s}`,
          sql<boolean>`lower(coalesce(${ENTITY_LABEL}, '')) like ${s}`,
        ]),
      );
    }
    return q;
  }

  async findAll(query: AuditQuery): Promise<PaginatedResult<any>> {
    const { page, limit, offset } = getPaginationParams(query);
    const base = this.filtered(query);

    const countRes = await base.select(sql<number>`count(audit_log.id)::int`.as('total')).executeTakeFirst();
    const total = countRes?.total || 0;

    const logs = await base
      .select([
        'audit_log.id',
        'audit_log.actor_id',
        'audit_log.entity_type',
        'audit_log.entity_id',
        'audit_log.action',
        'audit_log.previous_value',
        'audit_log.new_value',
        'audit_log.created_at',
        'actor.full_name as actor_name',
        'actor.email as actor_email',
        'actor.role as actor_role',
        ENTITY_LABEL.as('entity_label'),
      ])
      .orderBy('audit_log.created_at', 'desc')
      .orderBy('audit_log.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(logs, total, page, limit);
  }

  /** Filter menus: record types and actions with counts, and the people who appear in the trail. */
  async facets() {
    const [entityTypes, actions, actors] = await Promise.all([
      this.db
        .selectFrom('audit_log')
        .select(['entity_type', sql<number>`count(*)::int`.as('count')])
        .groupBy('entity_type')
        .orderBy('entity_type')
        .execute(),
      this.db
        .selectFrom('audit_log')
        .select(['entity_type', 'action', sql<number>`count(*)::int`.as('count')])
        .groupBy(['entity_type', 'action'])
        .orderBy('action')
        .execute(),
      this.db
        .selectFrom('audit_log')
        .innerJoin('users', 'users.id', 'audit_log.actor_id')
        .select(['users.id', 'users.full_name', 'users.role', sql<number>`count(*)::int`.as('count')])
        .groupBy(['users.id', 'users.full_name', 'users.role'])
        .orderBy('users.full_name')
        .execute(),
    ]);
    return { entity_types: entityTypes, actions, actors };
  }
}
