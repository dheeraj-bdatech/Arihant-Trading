import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { SINGLETON_RECORD_ID } from '../../common/events/audit.listener.js';
import { todayInKolkata } from '../../common/utils/ist-date.util.js';
import { getPaginationParams, buildPaginatedResult } from '../../common/utils/pagination.js';
import { containsPattern } from '../../common/utils/like-pattern.js';
import type { AuthUser, Database, PaginatedResult } from '@arihant/shared';

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
  /** Also return the old daily proposal reminder rows (see REMINDER_ROW); hidden by default. */
  include_reminders?: boolean | string;
  /** One or more IMPORTANT_KINDS, comma-separated; `important` means any of them. */
  kind?: string;
}

/**
 * The PRD's "important changes should be logged" list as named kinds — what the audit page shows, filters by and
 * charts. Each is a predicate on the row's record type and action code. A proposal row that only records its
 * creation (fromStatus null, no previous value) is not a status change.
 */
export const IMPORTANT_KINDS = {
  deadline_changed: sql<boolean>`(audit_log.action ~* 'deadline')`,
  tender_decision: sql<boolean>`(audit_log.entity_type = 'tender' and audit_log.action ~* '^(tender|approval)_(approved|rejected)$')`,
  visit_cancelled: sql<boolean>`(audit_log.entity_type = 'visit' and audit_log.action ~* 'cancel')`,
  lead_reassigned: sql<boolean>`(audit_log.entity_type = 'lead' and audit_log.action ~* 'reassign')`,
  equipment_availability: sql<boolean>`(audit_log.action = 'availability_changed')`,
  proposal_status: sql<boolean>`(audit_log.entity_type = 'proposal'
    and audit_log.action ~* '^(status_change|approve|reject|proposal_(approved|rejected|lost|sent|converted|closed|reopened|won))$'
    and not (audit_log.previous_value is null and audit_log.new_value -> 'fromStatus' = 'null'::jsonb))`,
  ticket_reassigned: sql<boolean>`(audit_log.entity_type = 'service_ticket' and audit_log.action ~* 'reassign')`,
  expense_decision: sql<boolean>`(audit_log.entity_type in ('expense', 'expense_claim') and audit_log.action ~* 'approv|reject')`,
} as const;
export type ImportantKind = keyof typeof IMPORTANT_KINDS;
const KIND_KEYS = Object.keys(IMPORTANT_KINDS) as ImportantKind[];
const ANY_IMPORTANT = sql<boolean>`(${sql.join(KIND_KEYS.map((k) => IMPORTANT_KINDS[k]), sql` or `)})`;
/** The kind of a row (null for anything else). */
const KIND_OF = sql<ImportantKind | null>`case ${sql.join(KIND_KEYS.map((k) => sql`when ${IMPORTANT_KINDS[k]} then ${k}`), sql` `)} end`;

/** Action codes that are "important changes" in the PRD sense (see AuditQuery.key_changes). */
const KEY_CHANGE_PATTERN =
  'deadline|approv|reject|cancel|reassign|availability|status|stage|_won|_lost|converted|closed|reopen|hold|resum|delet|deactivat|outcome|submitted|reschedul|failed|setting|sla_rule|export';

/**
 * Daily proposal reminder snapshots (days late / inactive / overdue) that an older consumer wrote as actor-less
 * "update" rows until 26 Oct 2026. They record no change, so the trail, its filters and its export hide them.
 */
const REMINDER_ROW = sql<boolean>`(audit_log.entity_type = 'proposal' and audit_log.actor_id is null and (audit_log.new_value ->> 'businessDate') is not null)`;

/** The export holds at most this many rows (newest first); narrow the filters for more. */
export const AUDIT_EXPORT_LIMIT = 10000;

const EXPORT_HEADERS = ['Date & time (IST)', 'User', 'Role', 'Action', 'Record type', 'Record', 'Record ID', 'Previous value', 'New value'];

/** One CSV cell: quoted, with spreadsheet formula triggers (= + - @) defused. */
const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

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
  when 'session' then coalesce((select u.full_name from users u where u.id = audit_log.entity_id), audit_log.new_value ->> 'email')
  when 'interaction' then (select concat_ws(' · ', o.name, initcap(replace(i.type::text, '_', ' ')), to_char(i.occurred_on, 'DD Mon YYYY')) from interactions i left join organisations o on o.id = i.organisation_id where i.id = audit_log.entity_id)
  when 'follow_up' then (select concat_ws(' · ', o.name, concat('due ', to_char(f.due_date, 'DD Mon YYYY'))) from follow_ups f left join organisations o on o.id = f.organisation_id where f.id = audit_log.entity_id)
  when 'sla_rule' then (select concat('SLA · ', initcap(r.priority::text), ' · ', replace(r.warranty_type::text, '_', ' ')) from sla_rules r where r.id = audit_log.entity_id)
  when 'service_setting' then (select concat('Service setting · ', s.key) from service_settings s where s.id = audit_log.entity_id)
  when 'proposal_settings' then 'Proposal settings'
  when 'task_settings' then 'Task settings'
  when 'audit' then 'Audit log'
end`;

@Injectable()
export class AuditService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private filtered(query: AuditQuery) {
    let q = this.db.selectFrom('audit_log').leftJoin('users as actor', 'audit_log.actor_id', 'actor.id');
    if (!(query.include_reminders === true || query.include_reminders === 'true')) q = q.where(sql<boolean>`not ${REMINDER_ROW}`);

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
    const kinds = (query.kind || '').split(',').map((k) => k.trim()).filter(Boolean);
    if (kinds.length) {
      if (kinds.includes('important')) q = q.where(ANY_IMPORTANT);
      else {
        const unknown = kinds.filter((k) => !(k in IMPORTANT_KINDS));
        if (unknown.length) throw new BadRequestException(`Unknown kind: ${unknown.join(', ')}`);
        q = q.where(sql<boolean>`(${sql.join(kinds.map((k) => IMPORTANT_KINDS[k as ImportantKind]), sql` or `)})`);
      }
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
        KIND_OF.as('kind'),
      ])
      .orderBy('audit_log.created_at', 'desc')
      .orderBy('audit_log.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return buildPaginatedResult(logs, total, page, limit);
  }

  /**
   * Chart data for the important changes matching the filters: how many of each kind (ignoring the kind filter, so
   * every kind keeps its bar), per IST day, and the people who made the most.
   */
  async summary(query: AuditQuery) {
    const { kind: _kind, ...rest } = query;
    const [byKind, byDay, byActor] = await Promise.all([
      this.filtered(rest)
        .where(ANY_IMPORTANT)
        .select([KIND_OF.as('kind'), sql<number>`count(*)::int`.as('count')])
        .groupBy(sql`1`)
        .execute(),
      this.filtered({ ...query, kind: query.kind || 'important' })
        .select([sql<string>`to_char(audit_log.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`.as('day'), sql<number>`count(*)::int`.as('count')])
        .groupBy(sql`1`)
        .orderBy(sql`1`)
        .execute(),
      this.filtered({ ...query, kind: query.kind || 'important' })
        .where('audit_log.actor_id', 'is not', null)
        .select(['audit_log.actor_id as id', 'actor.full_name as name', 'actor.role as role', sql<number>`count(*)::int`.as('count')])
        .groupBy(['audit_log.actor_id', 'actor.full_name', 'actor.role'])
        .orderBy(sql`4`, 'desc')
        .limit(8)
        .execute(),
    ]);
    return { by_kind: byKind, by_day: byDay, by_actor: byActor };
  }

  /** Filter menus: record types and actions with counts, and the people who appear in the trail. */
  async facets() {
    const [entityTypes, actions, actors] = await Promise.all([
      this.db
        .selectFrom('audit_log')
        .where(sql<boolean>`not ${REMINDER_ROW}`)
        .select(['entity_type', sql<number>`count(*)::int`.as('count')])
        .groupBy('entity_type')
        .orderBy('entity_type')
        .execute(),
      this.db
        .selectFrom('audit_log')
        .where(sql<boolean>`not ${REMINDER_ROW}`)
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

  /**
   * The filtered trail as CSV (newest first, at most AUDIT_EXPORT_LIMIT rows). The export itself is recorded in the
   * trail, with its filters, so who took a copy of the log is on record too.
   */
  async exportCsv(query: AuditQuery, user: AuthUser): Promise<{ csv: string; rows: number; truncated: boolean; filename: string }> {
    const rows = await this.filtered(query)
      .select([
        'audit_log.entity_type',
        'audit_log.entity_id',
        'audit_log.action',
        'audit_log.previous_value',
        'audit_log.new_value',
        'actor.full_name as actor_name',
        'actor.role as actor_role',
        ENTITY_LABEL.as('entity_label'),
        sql<string>`to_char(audit_log.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS')`.as('at_ist'),
      ])
      .orderBy('audit_log.created_at', 'desc')
      .orderBy('audit_log.id', 'desc')
      .limit(AUDIT_EXPORT_LIMIT + 1)
      .execute();

    const truncated = rows.length > AUDIT_EXPORT_LIMIT;
    const kept = truncated ? rows.slice(0, AUDIT_EXPORT_LIMIT) : rows;
    const lines = [EXPORT_HEADERS.map(csvCell).join(',')];
    for (const r of kept) {
      lines.push(
        [
          r.at_ist,
          r.actor_name || 'System',
          r.actor_role,
          r.action,
          r.entity_type,
          r.entity_label,
          r.entity_id,
          r.previous_value,
          r.new_value,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    const filters = Object.fromEntries(Object.entries(query).filter(([k, v]) => v !== undefined && v !== '' && k !== 'page' && k !== 'limit'));
    this.eventEmitter.emit('audit.log', {
      actorId: user.id,
      entityType: 'audit',
      entityId: SINGLETON_RECORD_ID,
      action: 'audit_exported',
      newValue: { rows: kept.length, truncated, filters },
    });

    // BOM so Excel reads the file as UTF-8 (₹, ·, —)
    return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, rows: kept.length, truncated, filename: `audit-log-${todayInKolkata()}.csv` };
  }
}
