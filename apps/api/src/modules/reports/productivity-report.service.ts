import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { AuthUser, Database, ProductivityActivity, ProductivityReportDto, ProductivityRow, ProductivityTaskFigures } from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import {
  DEMO_DAY,
  PROPOSAL_OWNER,
  TENDER_OWNER,
  TENDER_ROW,
  TENDER_SUBMITTED,
  TENDER_SUBMITTED_DAY,
  istDay,
} from '../dashboard/dashboard-metrics.js';
import { TICKET_CLOSURE_SECONDS } from '../service/service.core.js';
import { TaskAccountabilityService } from '../tasks/task-accountability.service.js';
import { isNational, num, parseReportPeriod, pct, resolveTerritory } from './report-scope.js';

type Row = Record<string, any>;

const ACTIVITY_KEYS: (keyof ProductivityActivity)[] = [
  'visits_planned', 'visits_completed', 'interactions', 'followups_done', 'leads_created', 'proposals_sent',
  'tenders_submitted', 'demos_conducted', 'tickets_closed', 'expenses_claimed',
];

/**
 * Report 4 — Employee productivity indicators (GET /reports/productivity, Blueprint §42–43).
 *
 * Task evidence is the Module 8 accountability dashboard itself (TaskAccountabilityService.dashboard): the same
 * employees in scope (company-wide for management / admin / accounts, the manager's team otherwise), the same delay
 * classification and the same settings — so a number here equals Team Performance for the same period. Next to it,
 * each person's work in the other modules over the period, counted with the date rules those modules report on.
 * Factual attention flags only: the BOS supplies evidence, it never scores or recommends pay decisions.
 */
@Injectable()
export class ProductivityReportService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountability: TaskAccountabilityService,
  ) {}

  async report(user: AuthUser, q: Record<string, unknown>): Promise<ProductivityReportDto> {
    const period = parseReportPeriod(q.from, q.to);
    const { from, to } = period;
    const [{ filters }, evidence] = await Promise.all([
      resolveTerritory(this.db, user, q.zone_id, q.region_id),
      this.accountability.dashboard({ from, to }, user),
    ]);
    const employees = evidence.employees as Row[];
    const ids = employees.map((e) => String(e.employee_id));

    const inP = (day: unknown) => sql`${day} between ${from}::date and ${to}::date`;
    const activity = ids.length
      ? await sql<Row>`
          select u.id, u.zone_id, u.region_id, r.name as region_name, z.name as zone_name,
            (select count(*) from visits v where v.assigned_to = u.id and ${inP(sql`v.planned_date`)})::int as visits_planned,
            (select count(*) from visits v where v.assigned_to = u.id and v.status = 'completed' and ${inP(sql`v.planned_date`)})::int as visits_completed,
            (select count(*) from interactions i where i.employee_id = u.id
               and ${inP(sql`coalesce(i.occurred_on, ${istDay(sql`i.created_at`)})`)})::int as interactions,
            (select count(*) from follow_ups f where f.assigned_to = u.id and f.status = 'completed'
               and ${inP(sql`coalesce(${istDay(sql`f.completed_at`)}, f.due_date)`)})::int as followups_done,
            (select count(*) from leads l where l.assigned_to = u.id and ${inP(istDay(sql`l.created_at`))})::int as leads_created,
            (select count(*) from proposals p where coalesce(p.is_deleted, false) = false and ${PROPOSAL_OWNER} = u.id
               and p.sent_date is not null and ${inP(sql`p.sent_date`)})::int as proposals_sent,
            (select count(*) from tenders t where ${TENDER_ROW} and ${TENDER_OWNER} = u.id
               and t.status = any(${TENDER_SUBMITTED}::text[]) and ${inP(TENDER_SUBMITTED_DAY)})::int as tenders_submitted,
            (select count(*) from demos d where d.status = 'completed' and (d.assigned_to = u.id or d.coordinator_id = u.id)
               and ${inP(DEMO_DAY)})::int as demos_conducted,
            (select count(*) from service_tickets where service_tickets.deleted_at is null and service_tickets.assigned_to = u.id
               and service_tickets.status = 'closed' and ${inP(istDay(sql`service_tickets.closed_at`))})::int as tickets_closed,
            (select avg(${TICKET_CLOSURE_SECONDS}) / 86400 from service_tickets where service_tickets.deleted_at is null
               and service_tickets.assigned_to = u.id and service_tickets.status = 'closed'
               and ${inP(istDay(sql`service_tickets.closed_at`))}) as avg_closure_days,
            (select coalesce(sum(i.amount), 0) from expense_items i join expense_claims c on c.id = i.claim_id
               where c.employee_id = u.id and c.deleted_at is null and i.deleted_at is null and c.status <> 'draft'
               and ${inP(sql`i.expense_date`)})::float as expenses_claimed
          from users u left join regions r on r.id = u.region_id left join zones z on z.id = coalesce(u.zone_id, r.zone_id)
          where u.id::text = any(${ids}::text[])`.execute(this.db)
      : { rows: [] as Row[] };
    const byId = new Map(activity.rows.map((r) => [String(r.id), r]));

    // National viewers may narrow to a zone / region (the employee's home territory); a manager's team is already theirs.
    const inTerritory = (a: Row | undefined) => {
      if (filters.region_id) return a?.region_id === filters.region_id;
      if (isNational(user) && filters.zone_id) return a?.zone_id === filters.zone_id || (a?.region_id && filters.regions.some((r) => r.id === a.region_id));
      return true;
    };
    const roleQ = typeof q.role === 'string' && q.role ? q.role : null;

    const all: ProductivityRow[] = employees
      .filter((e) => inTerritory(byId.get(String(e.employee_id))))
      .map((e) => {
        const a = byId.get(String(e.employee_id)) ?? {};
        const tasks = this.taskFigures(e);
        const act = this.activity(a);
        return {
          employee_id: String(e.employee_id),
          name: String(e.name),
          role: String(e.role),
          is_active: e.is_active !== false,
          department: e.department ?? null,
          manager: e.manager ?? null,
          region_name: a.region_name ?? null,
          zone_name: a.zone_name ?? null,
          tasks,
          activity: act,
          attention: this.attention(tasks, evidence.settings),
        };
      });
    const roles = [...new Set(all.map((r) => r.role))].sort();
    const rows = all
      .filter((r) => !roleQ || r.role === roleQ)
      .sort((a, b) => b.attention.length - a.attention.length || a.name.localeCompare(b.name));

    return {
      period,
      scope: evidence.scope === 'all' ? 'all' : 'team',
      filters,
      roles,
      role: roleQ && roles.includes(roleQ) ? roleQ : null,
      totals: {
        employees: rows.length,
        needing_attention: rows.filter((r) => r.attention.length > 0).length,
        tasks: this.sumTasks(rows),
        activity: this.sumActivity(rows),
      },
      rows,
      settings: {
        repeated_delay_threshold: num(evidence.settings?.repeated_delay_threshold),
        repeated_delay_window_days: num(evidence.settings?.repeated_delay_window_days),
      },
      generated_at: new Date().toISOString(),
    };
  }

  private taskFigures(e: Row): ProductivityTaskFigures {
    return {
      assigned: num(e.assigned),
      completed: num(e.completed),
      on_time: num(e.on_time),
      late_excused: num(e.late_excused),
      late_unexcused: num(e.late_unexcused),
      on_time_pct: e.on_time_pct === null || e.on_time_pct === undefined ? null : num(e.on_time_pct),
      overdue_now: num(e.overdue),
      no_update: num(e.no_update),
      approved_blockers: num(e.approved_blockers),
      unapproved_delays: num(e.unapproved_delays),
      incomplete_work: num(e.incomplete_work),
      repeated_delay_flag: Boolean(e.repeated_delay_flag),
    };
  }

  private activity(a: Row): ProductivityActivity {
    const out = {} as ProductivityActivity;
    for (const k of ACTIVITY_KEYS) (out as any)[k] = k === 'expenses_claimed' ? Math.round(num(a[k]) * 100) / 100 : num(a[k]);
    out.avg_closure_days = a.avg_closure_days === null || a.avg_closure_days === undefined ? null : Math.round(num(a.avg_closure_days) * 10) / 10;
    return out;
  }

  /** Plain statements of fact a manager can act on. */
  private attention(t: ProductivityTaskFigures, s: Row): string[] {
    const out: string[] = [];
    const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
    if (t.overdue_now > 0) out.push(n(t.overdue_now, 'task overdue', 'tasks overdue'));
    if (t.repeated_delay_flag) out.push(`Repeated delays (${num(s?.repeated_delay_threshold)}+ in ${num(s?.repeated_delay_window_days)} days)`);
    if (t.unapproved_delays > 0) out.push(n(t.unapproved_delays, 'unapproved delay', 'unapproved delays'));
    if (t.no_update > 0) out.push(n(t.no_update, 'task without updates', 'tasks without updates'));
    return out;
  }

  private sumTasks(rows: ProductivityRow[]): ProductivityTaskFigures {
    const sum = (k: keyof ProductivityTaskFigures) => rows.reduce((a, r) => a + num(r.tasks[k]), 0);
    const completed = sum('completed');
    const onTime = sum('on_time');
    return {
      assigned: sum('assigned'),
      completed,
      on_time: onTime,
      late_excused: sum('late_excused'),
      late_unexcused: sum('late_unexcused'),
      on_time_pct: pct(onTime, completed),
      overdue_now: sum('overdue_now'),
      no_update: sum('no_update'),
      approved_blockers: sum('approved_blockers'),
      unapproved_delays: sum('unapproved_delays'),
      incomplete_work: sum('incomplete_work'),
      repeated_delay_flag: rows.some((r) => r.tasks.repeated_delay_flag),
    };
  }

  private sumActivity(rows: ProductivityRow[]): ProductivityActivity {
    const out = {} as ProductivityActivity;
    for (const k of ACTIVITY_KEYS) (out as any)[k] = rows.reduce((a, r) => a + num(r.activity[k]), 0);
    out.expenses_claimed = Math.round(out.expenses_claimed * 100) / 100;
    // closure time across everyone: weighted by tickets closed
    const closed = rows.reduce((a, r) => a + r.activity.tickets_closed, 0);
    const weighted = rows.reduce((a, r) => a + (r.activity.avg_closure_days ?? 0) * r.activity.tickets_closed, 0);
    out.avg_closure_days = closed ? Math.round((weighted / closed) * 10) / 10 : null;
    return out;
  }
}
