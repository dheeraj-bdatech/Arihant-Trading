import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { addIsoDays, todayInKolkata } from '../../common/utils/ist-date.util.js';
import {
  COMMAND_SECTIONS,
  type AuthUser,
  type CommandLayout,
  type CommandListItem,
  type CommandRecordsDto,
  type CommandSectionKey,
  type CommandTone,
  type Database,
} from '@arihant/shared';
import { PROPOSAL_ORG, PROPOSAL_OUTCOME_DAY, PROPOSAL_OWNER, TASK_OVERDUE, TENDER_AWAITING_APPROVAL, TENDER_RESULT_DAY, TENDER_ROW, istDay, tenderClosingWithin } from './dashboard-metrics.js';
import {
  DEMO_REGISTER_DATE,
  DRAFT_STALE_DAYS,
  EXPENSE_ACCOUNTS,
  EXPENSE_REJECTED_DAY,
  EXPENSE_STAGE1,
  FAILURE_LABEL,
  NOT_HELD,
  PROPOSAL_DISPATCHED,
  PROPOSAL_NEXT_FOLLOW_UP,
  SERVICE_DONE,
  TENDER_LIVE_STAGES,
  TENDER_LIVE_STATUSES,
  VISIT_IS_OPEN,
  day,
  demoClash,
  href,
  human,
  iso,
  leadFollowup,
  num,
  plural,
  rupees,
  serviceOverdue,
  shortDay,
  tenderInCategory,
  visitClusters,
} from './dashboard-command.service.js';
import { DashboardPerformanceService } from './dashboard-performance.service.js';
import { ProductivityReportService } from '../reports/productivity-report.service.js';
import { ModuleAccessService } from '../access/module-access.service.js';
import { DEMO_ACTIVE_STATUSES, DEMO_PENDING_STATUSES } from '../demos/demos.service.js';

/**
 * Module 10 — the records behind one Management Command figure, a page at a time (GET /dashboard/command/records).
 * Each list is filtered with the same rule (most with the very same SQL fragment) as the figure it opens from, over the
 * same results period, so its total is the figure's count. For a rate it lists the records the rate is worked out
 * from (the leads created, the demos with an outcome…); for a figure about people, regions or cities, one row each.
 */
type Row = Record<string, any>;
type Cond = RawBuilder<unknown>;
interface Ctx {
  user: AuthUser;
  today: string;
  from: string;
  to: string;
}
interface Page {
  offset: number;
  limit: number;
}
interface Paged {
  items: CommandListItem[];
  total: number;
}
interface Lister {
  dates: CommandRecordsDto['dates'];
  list: (c: Ctx, p: Page) => Promise<Paged>;
}

const PAGE = 20;
const MAX_PAGE = 50;
const intOr = (v: unknown, fallback: number) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};
/** One page of a list worked out in memory (people, regions, cities). */
const slice = <T>(p: Page, all: T[], map: (r: T) => CommandListItem): Paged => ({
  total: all.length,
  items: all.slice(p.offset, p.offset + p.limit).map(map),
});
const joined = (...parts: unknown[]) => parts.filter(Boolean).join(' · ') || null;

const PROPOSAL_PENDING: Record<string, string> = {
  REQUESTED: 'Requested',
  PROPOSAL_REQUESTED: 'Requested',
  UNDER_PREPARATION: 'Being prepared',
  READY_FOR_REVIEW: 'Ready for review',
  APPROVED: 'Approved, not sent',
};
const PROPOSAL_OUTCOME: Record<string, { label: string; tone: CommandTone }> = {
  CONVERTED: { label: 'Converted', tone: 'ok' },
  LOST: { label: 'Lost', tone: 'warning' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};
const DEMO_RESULT: Record<string, { label: string; tone: CommandTone }> = {
  success: { label: 'Success', tone: 'ok' },
  fail: { label: 'Failed', tone: 'warning' },
  partial: { label: 'Partial', tone: 'neutral' },
};
const EXPENSE_STAGE: Record<string, string> = {
  submitted: 'With manager',
  manager_approved: 'Manager approved',
  accounts_review: 'Accounts review',
  accounts_approved: 'Accounts approved',
};
const TENDER_STAGE = new Map(TENDER_LIVE_STAGES.flatMap((s) => s.statuses.map((st) => [st, s.label] as const)));

@Injectable()
export class DashboardCommandRecordsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly performance: DashboardPerformanceService,
    private readonly productivity: ProductivityReportService,
    private readonly access: ModuleAccessService,
  ) {}

  async records(user: AuthUser, layout: CommandLayout, q: { section?: string; metric?: string; offset?: string; limit?: string }): Promise<CommandRecordsDto> {
    const def = COMMAND_SECTIONS.find((s) => s.key === q.section);
    const lister = def && q.metric ? this.listers[def.key][q.metric] : undefined;
    if (!def || !lister) throw new BadRequestException('Name a section and one of its figures.');
    if (new Set(await this.access.blockedFor(user.role)).has(def.module)) {
      throw new ForbiddenException(`${def.label} is switched off for your role.`);
    }
    const today = todayInKolkata();
    const c: Ctx = { user, today, from: addIsoDays(today, -(layout.period - 1)), to: today };
    const p: Page = { offset: Math.max(0, intOr(q.offset, 0)), limit: Math.min(MAX_PAGE, Math.max(1, intOr(q.limit, PAGE))) };
    const { items, total } = await lister.list(c, p);
    const end = p.offset + items.length;
    return { section: def.key, metric: q.metric!, total, items, next: items.length && end < total ? end : null, dates: lister.dates };
  }

  /** `select … from … where …` one page, newest-first or as `order` says, plus the count over the same `from`. */
  private async page(p: Page, from: Cond, select: Cond, order: Cond, map: (r: Row) => CommandListItem): Promise<Paged> {
    const [rows, count] = await Promise.all([
      sql<Row>`select ${select} ${from} order by ${order} limit ${p.limit} offset ${p.offset}`.execute(this.db),
      sql<Row>`select count(*)::int as c ${from}`.execute(this.db),
    ]);
    return { items: rows.rows.map(map), total: num(count.rows[0]?.c) };
  }

  private readonly listers: Record<CommandSectionKey, Record<string, Lister>> = {
    /* ----------------------------------------------------------------- sales -- */
    sales: {
      followups_overdue: {
        dates: 'due',
        list: (c, p) =>
          this.page(
            p,
            sql`from leads join organisations o on o.id = leads.organisation_id
                left join products pr on pr.id = leads.product_id left join users u on u.id = leads.assigned_to
                where ${leadFollowup('<', c.today)}`,
            sql`leads.id, o.name as org, pr.name as product, u.full_name as owner, coalesce(leads.lead_status, leads.status, 'new') as status,
                (select min(fu.due_date) from follow_ups fu where fu.lead_id = leads.id and fu.status = 'pending')::text as due`,
            sql`due asc, o.name asc, leads.id`,
            (r) => ({ id: r.id, title: r.org, subtitle: joined(r.product, r.owner), date: day(r.due), status: human(r.status), tone: 'warning', href: href('/leads', { open: r.id }) }),
          ),
      },
      new_opportunities: { dates: 'past', list: (c, p) => this.leadsCreated(c, p, false) },
      conversion: { dates: 'past', list: (c, p) => this.leadsCreated(c, p, true) },
      region_performance: {
        dates: 'none',
        list: async (c, p) => {
          const perf = await this.performance.getSalesPerformance(c.user, { from: c.from, to: c.to, group_by: 'region' });
          const active = perf.rows
            .map((r) => ({ r, leads: r.lead.new + r.lead.reapproached, decided: r.tender.won + r.tender.lost }))
            .filter((x) => x.leads > 0 || x.decided > 0 || x.r.visit.planned > 0)
            .sort((a, b) => b.leads - a.leads || a.r.label.localeCompare(b.r.label));
          const link = href('/regional/performance', { from: c.from, to: c.to, group_by: 'region' });
          return slice(p, active, ({ r, leads }) => ({
            id: r.key,
            title: r.label,
            subtitle: r.zone_name,
            status: r.lead.conversion_rate == null ? 'No conversions' : `${r.lead.conversion_rate}% converted`,
            meta: joined(plural(leads, 'new lead'), r.tender.win_rate == null ? null : `tender win ${r.tender.win_rate}%`),
            tone: 'neutral',
            href: link,
          }));
        },
      },
    },

    /* ---------------------------------------------------------------- visits -- */
    visits: {
      upcoming: {
        dates: 'due',
        list: (c, p) => this.visitList(p, sql`${VISIT_IS_OPEN} and v.planned_date between ${c.today}::date and ${addIsoDays(c.today, 6)}::date`, sql`v.planned_date asc, v.start_time asc nulls last, v.id`),
      },
      travelling: {
        dates: 'none',
        list: async (c, p) => {
          const people = (
            await sql<Row>`
              select u.id, u.full_name, count(*)::int as n, bool_or(coalesce(v.travel_required, false)) as travel,
                     string_agg(distinct coalesce(nullif(trim(o.city), ''), o.name), ', ') as places
              from visits v join organisations o on o.id = v.organisation_id join users u on u.id = v.assigned_to
              where ${VISIT_IS_OPEN} and v.planned_date = ${c.today}::date
              group by u.id, u.full_name order by n desc, u.full_name asc`.execute(this.db)
          ).rows;
          return slice(p, people, (r) => ({
            id: r.id,
            title: r.full_name,
            subtitle: r.places,
            meta: plural(num(r.n), 'visit'),
            status: r.travel ? 'Travelling' : 'Local',
            tone: 'neutral',
            href: href('/visits', { status: 'open', from: c.today, to: c.today }),
          }));
        },
      },
      cancelled_rescheduled: {
        dates: 'past',
        list: (c, p) =>
          this.visitList(p, sql`((v.status = 'cancelled' and v.planned_date between ${c.from}::date and ${c.to}::date) or v.status = 'rescheduled')`, sql`v.planned_date desc, v.id`),
      },
      combine: {
        dates: 'none',
        list: async (c, p) => {
          const clusters = (await visitClusters(c.today, addIsoDays(c.today, 13)).execute(this.db)).rows as Row[];
          return slice(p, clusters, (r) => ({
            id: r.city,
            title: r.city,
            subtitle: `${plural(num(r.visits), 'visit')} by ${plural(num(r.people), 'person', 'people')}`,
            meta: r.first_day === r.last_day ? shortDay(r.first_day) : `${shortDay(r.first_day)} – ${shortDay(r.last_day)}`,
            status: 'Can share a trip',
            tone: 'warning',
            href: href('/visits', { status: 'open', from: r.first_day, to: r.last_day }),
          }));
        },
      },
    },

    /* ----------------------------------------------------------------- demos -- */
    demos: {
      upcoming: {
        dates: 'due',
        list: (c, p) => {
          const pending = [...DEMO_PENDING_STATUSES] as string[];
          return this.page(
            p,
            sql`from demos join organisations o on o.id = demos.organisation_id left join products pr on pr.id = demos.product_id
                where demos.status = any(${[...DEMO_ACTIVE_STATUSES] as string[]}::text[])
                  and ${DEMO_REGISTER_DATE} between ${c.today}::date and ${addIsoDays(c.today, 6)}::date`,
            sql`demos.id, demos.demo_no, demos.status, ${DEMO_REGISTER_DATE}::text as day, o.name as org, pr.name as product`,
            sql`day asc, demos.demo_no asc, demos.id`,
            (r) => ({
              id: r.id,
              title: r.org,
              subtitle: joined(r.demo_no, r.product),
              date: r.day,
              status: human(r.status),
              tone: pending.includes(r.status) ? 'warning' : 'neutral',
              href: href('/demos', { open: r.id }),
            }),
          );
        },
      },
      equipment_conflicts: {
        dates: 'due',
        list: (c, p) =>
          this.page(
            p,
            demoClash(c.today),
            sql`a.id::text || ':' || b.id::text as id, coalesce(e.model, e.serial_no, 'Demo unit') as unit, da.id as demo_a, da.demo_no as no_a, db.demo_no as no_b,
                greatest(a.reserved_from, b.reserved_from)::text as clash_from`,
            sql`clash_from asc, id`,
            (r) => ({ id: r.id, title: r.unit, subtitle: `${r.no_a} and ${r.no_b} overlap`, date: r.clash_from, status: 'Double-booked', tone: 'critical', href: href('/demos', { open: r.demo_a }) }),
          ),
      },
      results: {
        dates: 'past',
        list: (c, p) =>
          this.page(
            p,
            sql`from demos join organisations o on o.id = demos.organisation_id left join products pr on pr.id = demos.product_id
                join lateral (select x.result from demo_outcomes x where x.demo_id = demos.id and x.result in ('success', 'fail', 'partial')
                              order by x.created_at desc limit 1) oc on true
                where ${DEMO_REGISTER_DATE} between ${c.from}::date and ${c.to}::date`,
            sql`demos.id, demos.demo_no, ${DEMO_REGISTER_DATE}::text as day, o.name as org, pr.name as product, oc.result`,
            sql`day desc, demos.demo_no asc, demos.id`,
            (r) => ({
              id: r.id,
              title: r.org,
              subtitle: joined(r.demo_no, r.product),
              date: r.day,
              status: DEMO_RESULT[r.result]?.label ?? human(r.result),
              tone: DEMO_RESULT[r.result]?.tone ?? 'neutral',
              href: href('/demos', { open: r.id }),
            }),
          ),
      },
      failure_reasons: {
        dates: 'past',
        list: (c, p) =>
          this.page(
            p,
            sql`from demos join organisations o on o.id = demos.organisation_id left join products pr on pr.id = demos.product_id
                join demo_outcomes x on x.demo_id = demos.id
                where ${DEMO_REGISTER_DATE} between ${c.from}::date and ${c.to}::date and x.result = 'fail' and x.failure_reason is not null`,
            sql`x.id, demos.id as demo_id, demos.demo_no, ${DEMO_REGISTER_DATE}::text as day, o.name as org, pr.name as product,
                x.failure_reason as reason, count(*) over (partition by x.failure_reason)::int as times`,
            sql`times desc, reason asc, day desc, x.id`,
            (r) => ({
              id: r.id,
              title: r.org,
              subtitle: joined(r.demo_no, r.product),
              date: r.day,
              status: FAILURE_LABEL[r.reason] ?? human(r.reason),
              meta: num(r.times) >= 2 ? `Seen ${r.times}× in the period` : null,
              tone: num(r.times) >= 2 ? 'warning' : 'neutral',
              href: href('/demos', { open: r.demo_id }),
            }),
          ),
      },
    },

    /* --------------------------------------------------------------- tenders -- */
    tenders: {
      deadlines: {
        dates: 'deadline',
        list: (c, p) =>
          this.tenderList(p, tenderClosingWithin(7 * 24), sql`t.submission_deadline asc, t.id`, (r) => ({
            status: human(r.status),
            tone: new Date(r.deadline).getTime() - Date.now() <= 48 * 3600e3 ? 'critical' : 'warning',
          })),
      },
      approvals: {
        dates: 'deadline',
        list: (c, p) =>
          this.tenderList(p, TENDER_AWAITING_APPROVAL, sql`(t.submission_deadline < now()) asc, t.submission_deadline asc nulls last, t.id`, (r) => {
            const missed = r.deadline != null && new Date(r.deadline).getTime() < Date.now();
            return { status: missed ? 'Deadline passed' : 'Awaiting approval', tone: missed ? 'critical' : 'warning' };
          }),
      },
      pq_pipeline: { dates: 'none', list: (c, p) => this.pipeline(p, 'pq') },
      general_pipeline: { dates: 'none', list: (c, p) => this.pipeline(p, 'general_mha') },
      won_lost: {
        dates: 'past',
        list: (c, p) =>
          this.tenderList(
            p,
            sql`t.status::text in ('won', 'lost') and ${TENDER_RESULT_DAY} between ${c.from}::date and ${c.to}::date`,
            sql`${TENDER_RESULT_DAY} desc, t.id`,
            (r) => ({ status: r.status === 'won' ? 'Won' : 'Lost', tone: r.status === 'won' ? 'ok' : 'warning', date: day(r.result_day) }),
          ),
      },
    },

    /* ------------------------------------------------------------- proposals -- */
    proposals: {
      pending: {
        dates: 'due',
        list: (c, p) =>
          this.proposalList(p, sql`upper(p.status) = any(${Object.keys(PROPOSAL_PENDING)}::text[])`, PROPOSAL_OWNER, sql`p.required_date::text`, sql`(p.required_date is null), p.required_date asc, p.created_at asc, p.id`, (r) => ({
            status: PROPOSAL_PENDING[String(r.status).toUpperCase()] ?? human(r.status),
            tone: r.day && r.day < c.today ? 'critical' : 'warning',
          })),
      },
      followups_overdue: {
        dates: 'due',
        list: (c, p) =>
          this.proposalList(
            p,
            sql`upper(p.status) = any(${PROPOSAL_DISPATCHED}::text[]) and ${PROPOSAL_NEXT_FOLLOW_UP} < ${c.today}::date`,
            sql`coalesce(p.follow_up_owner_id, p.followup_owner_id, p.responsible_person_id)`,
            sql`${PROPOSAL_NEXT_FOLLOW_UP}::text`,
            sql`${PROPOSAL_NEXT_FOLLOW_UP} asc, p.id`,
            (r) => ({ status: human(r.status), tone: 'warning' }),
          ),
      },
      outcomes: {
        dates: 'past',
        list: (c, p) =>
          this.proposalList(
            p,
            sql`upper(p.status) in ('CONVERTED', 'LOST', 'CLOSED') and ${PROPOSAL_OUTCOME_DAY} between ${c.from}::date and ${c.to}::date`,
            PROPOSAL_OWNER,
            sql`${PROPOSAL_OUTCOME_DAY}::text`,
            sql`${PROPOSAL_OUTCOME_DAY} desc, p.id`,
            (r) => {
              const o = PROPOSAL_OUTCOME[String(r.status).toUpperCase()];
              return { status: o?.label ?? human(r.status), tone: o?.tone ?? 'neutral' };
            },
          ),
      },
    },

    /* --------------------------------------------------------------- service -- */
    service: {
      open: {
        dates: 'due',
        list: (c, p) => this.ticketList(p, sql`s.status <> all(${SERVICE_DONE}::text[])`, (r) => (r.priority === 'critical' ? 'critical' : 'neutral')),
      },
      overdue: { dates: 'due', list: (c, p) => this.ticketList(p, serviceOverdue(c.today), () => 'critical') },
      repeat: {
        dates: 'due',
        list: (c, p) => this.ticketList(p, sql`s.is_repeat_complaint = true and s.status <> all(${SERVICE_DONE}::text[])`, () => 'warning'),
      },
      awaiting_parts: {
        dates: 'past',
        list: (c, p) => this.ticketList(p, sql`s.status = 'awaiting_part'`, () => 'warning', true),
      },
    },

    /* ------------------------------------------------------------------ team -- */
    team: {
      tasks_overdue: {
        dates: 'due',
        list: (c, p) =>
          this.page(
            p,
            sql`from tasks k left join users u on u.id = k.assigned_to where ${TASK_OVERDUE}`,
            sql`k.id, k.task_number, k.title, k.status, u.full_name as owner, ${istDay(sql`k.deadline`)}::text as due`,
            sql`k.deadline asc, k.id`,
            (r) => ({ id: r.id, title: r.title || r.task_number || 'Task', subtitle: joined(r.task_number, r.owner), date: r.due, status: human(r.status), tone: 'warning', href: `/tasks/${r.id}` }),
          ),
      },
      blockers: {
        dates: 'past',
        list: (c, p) =>
          this.page(
            p,
            sql`from task_blockers b join tasks k on k.id = b.task_id left join users u on u.id = b.raised_by where b.status = 'pending_review'`,
            sql`b.id, k.id as task_id, k.title, k.task_number, u.full_name as raised_by, b.blocker_type, b.created_at`,
            sql`b.created_at asc, b.id`,
            (r) => ({
              id: r.id,
              title: r.title || r.task_number || 'Task',
              subtitle: joined(r.task_number, r.raised_by && `raised by ${r.raised_by}`),
              date: iso(r.created_at),
              status: human(r.blocker_type) || 'Blocker',
              meta: 'Waiting for a decision',
              tone: 'warning',
              href: href('/tasks/blockers', { scope: 'all' }),
            }),
          ),
      },
      attention: {
        dates: 'none',
        list: async (c, p) => {
          const report = await this.productivity.report(c.user, { from: c.from, to: c.to });
          const link = href('/reports/productivity', { from: c.from, to: c.to });
          return slice(p, report.rows.filter((r) => r.attention.length > 0), (r) => ({
            id: r.employee_id,
            title: r.name,
            subtitle: r.attention.join(' · '),
            status: human(r.role),
            tone: 'warning',
            href: link,
          }));
        },
      },
      productivity: {
        dates: 'none',
        list: async (c, p) => {
          const report = await this.productivity.report(c.user, { from: c.from, to: c.to });
          const link = href('/reports/productivity', { from: c.from, to: c.to });
          // people who finished tasks due in the period, least on time first
          const done = report.rows.filter((r) => r.tasks.completed > 0).sort((a, b) => (a.tasks.on_time_pct ?? 0) - (b.tasks.on_time_pct ?? 0) || a.name.localeCompare(b.name));
          return slice(p, done, (r) => ({
            id: r.employee_id,
            title: r.name,
            subtitle: joined(`${r.tasks.on_time} of ${r.tasks.completed} on time`, r.tasks.late_unexcused ? `${r.tasks.late_unexcused} late without reason` : null),
            status: r.tasks.on_time_pct == null ? '—' : `${r.tasks.on_time_pct}% on time`,
            tone: r.tasks.late_unexcused > 0 ? 'warning' : 'ok',
            href: link,
          }));
        },
      },
    },

    /* -------------------------------------------------------------- expenses -- */
    expenses: {
      pending_approvals: {
        dates: 'past',
        list: (c, p) =>
          this.claimList(p, sql`c.status = any(${[...EXPENSE_STAGE1, ...EXPENSE_ACCOUNTS]}::text[])`, sql`c.submitted_at`, sql`c.submitted_at asc nulls last, c.id`, (r) => ({
            status: EXPENSE_STAGE[r.status] ?? human(r.status),
            tone: 'warning',
          })),
      },
      rejected: {
        dates: 'past',
        list: (c, p) =>
          this.claimList(
            p,
            sql`c.status = 'rejected' and ${EXPENSE_REJECTED_DAY} between ${c.from}::date and ${c.to}::date`,
            sql`coalesce(c.accounts_actioned_at, c.manager_actioned_at, c.updated_at)`,
            sql`coalesce(c.accounts_actioned_at, c.manager_actioned_at, c.updated_at) desc, c.id`,
            (r) => ({ status: r.accounts_actioned_at ? 'Rejected by accounts' : 'Rejected by manager', tone: 'neutral' }),
          ),
      },
      outstanding: {
        dates: 'past',
        list: (c, p) =>
          this.claimList(
            p,
            sql`(c.status = 'clarification_required' or (c.status = 'draft' and c.updated_at < now() - make_interval(days => ${DRAFT_STALE_DAYS})))`,
            sql`c.updated_at`,
            sql`(c.status = 'clarification_required') desc, c.updated_at asc, c.id`,
            (r) => ({ status: r.status === 'draft' ? 'Draft untouched' : 'Sent back', tone: 'warning' }),
          ),
      },
    },
  };

  /* ------------------------------------------------------------- list shapes -- */
  /** Leads created in the period (Module 9's rule); `byConversion` puts the converted ones first. */
  private leadsCreated(c: Ctx, p: Page, byConversion: boolean) {
    const converted = sql`lower(coalesce(leads.lead_status, leads.status, '')) in ('converted', 'won')`;
    return this.page(
      p,
      sql`from leads left join organisations o on o.id = leads.organisation_id
          left join products pr on pr.id = leads.product_id left join users u on u.id = leads.assigned_to
          where ${istDay(sql`leads.created_at`)} between ${c.from}::date and ${c.to}::date`,
      sql`leads.id, o.name as org, pr.name as product, u.full_name as owner, leads.created_at,
          coalesce(leads.lead_status, leads.status, 'new') as status, coalesce(leads.lead_type, 'fresh') as lead_type, ${converted} as converted`,
      byConversion ? sql`converted desc, leads.created_at desc, leads.id` : sql`leads.created_at desc, leads.id`,
      (r) => ({
        id: r.id,
        title: r.org || 'Lead',
        subtitle: joined(r.product, r.owner),
        date: iso(r.created_at),
        meta: r.lead_type === 're_approached' ? 'Re-approached' : 'Fresh',
        status: human(r.status),
        tone: r.converted ? 'ok' : 'neutral',
        href: href('/leads', { open: r.id }),
      }),
    );
  }

  private visitList(p: Page, where: Cond, order: Cond) {
    return this.page(
      p,
      sql`from visits v join organisations o on o.id = v.organisation_id left join users u on u.id = v.assigned_to where ${where}`,
      sql`v.id, v.organisation_id, v.planned_date::text as day, v.purpose, v.status, v.change_reason, o.name as org, u.full_name as rep`,
      order,
      (r) => ({
        id: r.id,
        title: r.org,
        subtitle: joined(r.rep, r.status === 'cancelled' || r.status === 'rescheduled' ? r.change_reason || r.purpose : r.purpose),
        date: r.day,
        status: human(r.status),
        tone: r.status === 'cancelled' ? 'warning' : 'neutral',
        href: href('/visits', { customer: r.organisation_id }),
      }),
    );
  }

  private tenderList(p: Page, where: Cond, order: Cond, look: (r: Row) => Partial<CommandListItem>) {
    return this.page(
      p,
      sql`from tenders t left join organisations o on o.id = t.organisation_id left join tender_categories tc on tc.id = t.category_id
          where ${TENDER_ROW} and ${where}`,
      sql`t.id, t.tender_no, t.tender_title, t.status::text as status, coalesce(o.name, t.department) as buyer, t.submission_deadline as deadline,
          t.estimated_value, ${TENDER_RESULT_DAY}::text as result_day`,
      order,
      (r) => ({
        id: r.id,
        title: r.tender_no || r.tender_title || 'Tender',
        subtitle: joined(r.buyer, r.tender_no ? r.tender_title : null),
        date: iso(r.deadline),
        meta: r.estimated_value == null ? null : rupees(num(r.estimated_value)),
        tone: 'neutral',
        href: href('/tenders', { highlight: r.id }),
        ...look(r),
      }),
    );
  }

  /** A category's bids still in play, by register stage (held bids are left out, as the figure leaves them out). */
  private pipeline(p: Page, category: string) {
    return this.tenderList(
      p,
      sql`${tenderInCategory(category)} and t.status::text = any(${TENDER_LIVE_STATUSES}::text[]) and ${NOT_HELD}`,
      sql`array_position(${TENDER_LIVE_STATUSES}::text[], t.status::text), t.submission_deadline asc nulls last, t.id`,
      (r) => ({ status: TENDER_STAGE.get(r.status) ?? human(r.status), date: null }),
    );
  }

  /** `when` is the date column shown (as `day`), `owner` the person column. */
  private proposalList(p: Page, where: Cond, owner: Cond, when: Cond, order: Cond, look: (r: Row) => Partial<CommandListItem>) {
    return this.page(
      p,
      sql`from proposals p left join organisations o on o.id = ${PROPOSAL_ORG} left join users u on u.id = ${owner}
          where p.is_deleted = false and ${where}`,
      sql`p.id, coalesce(p.proposal_number, p.proposal_no) as no, o.name as org, u.full_name as owner, p.status, p.quoted_value, ${when} as day`,
      order,
      (r) => ({
        id: r.id,
        title: r.org || r.no || 'Proposal',
        subtitle: joined(r.org ? r.no : null, r.owner),
        date: day(r.day),
        meta: r.quoted_value == null ? null : rupees(num(r.quoted_value)),
        tone: 'neutral',
        href: href('/proposals', { open: r.id }),
        ...look(r),
      }),
    );
  }

  /** Tickets with their SLA day (else planned visit) as the date; `sinceUpdate` shows when they last moved instead. */
  private ticketList(p: Page, where: Cond, tone: (r: Row) => CommandTone, sinceUpdate = false) {
    return this.page(
      p,
      sql`from service_tickets s left join organisations o on o.id = s.organisation_id where s.deleted_at is null and ${where}`,
      sql`s.id, coalesce(s.ticket_no, s.ticket_number) as no, s.status, s.priority, s.problem_category, s.updated_at,
          coalesce(o.name, s.claimed_organisation_name) as org,
          coalesce((s.sla_resolution_due_at at time zone 'Asia/Kolkata')::date, s.planned_visit_date)::text as due`,
      sinceUpdate ? sql`s.updated_at asc, s.id` : sql`(s.priority = 'critical') desc, due asc nulls last, no asc, s.id`,
      (r) => ({
        id: r.id,
        title: r.no || 'Ticket',
        subtitle: joined(r.org, r.problem_category),
        date: sinceUpdate ? iso(r.updated_at) : r.due,
        meta: human(r.priority) || null,
        status: human(r.status),
        tone: tone(r),
        href: href('/service', { open: r.id }),
      }),
    );
  }

  /** `when` is the date column shown. */
  private claimList(p: Page, where: Cond, when: Cond, order: Cond, look: (r: Row) => Partial<CommandListItem>) {
    return this.page(
      p,
      sql`from expense_claims c left join users u on u.id = c.employee_id where c.deleted_at is null and ${where}`,
      sql`c.id, c.claim_number, c.title, c.status, c.total_claimed, c.accounts_actioned_at, u.full_name as employee, ${when} as at`,
      order,
      (r) => ({
        id: r.id,
        title: r.employee || r.claim_number || 'Claim',
        subtitle: joined(r.claim_number, r.title),
        date: iso(r.at),
        meta: rupees(num(r.total_claimed)),
        tone: 'neutral',
        href: `/expenses/${r.id}`,
        ...look(r),
      }),
    );
  }
}
