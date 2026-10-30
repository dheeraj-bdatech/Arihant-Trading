import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type RawBuilder } from 'kysely';
import {
  EXPENSE_STAGE_BUCKETS,
  EXPENSE_STAGE_BUCKET_LABELS,
  EXPENSE_STATUS_LABELS,
  type AuthUser,
  type Database,
  type ExpenseAmounts,
  type ExpenseClaimStatus,
  type ExpenseReportDto,
  type ExpenseReportGroupBy,
  type ExpenseStageBucket,
} from '@arihant/shared';
import { KYSELY_DB } from '../../common/database/database.module.js';
import { ExpenseReportsService } from '../expense-management/expense-reports.service.js';
import { isNational, num, parseReportPeriod, pct, resolveTerritory } from './report-scope.js';

type Row = Record<string, any>;

const NONE = 'none';
const GROUPS: ExpenseReportGroupBy[] = ['employee', 'trip', 'customer', 'date', 'month', 'category', 'region', 'status'];
/** Same "pending amount" statuses as the Expense Reports summary: still in review, clarification or awaiting payment. */
const PENDING = ['submitted', 'manager_approved', 'accounts_review', 'accounts_approved', 'clarification_required'];
const CLOSED = ['rejected', 'withdrawn'];
/** Claims whose review has finished — the approval-rate base. */
const REVIEWED = ['accounts_approved', 'processed', 'rejected'];
const money = (v: unknown) => Math.round(num(v) * 100) / 100;

/**
 * Report 3 — Expense breakdown (GET /reports/expenses, Blueprint §40).
 *
 * Built on ExpenseReportsService.baseItems, so the claim role scope (own / team / region / Accounts queue / all) and
 * the expense filters are exactly those of the Expense Reports register and its Tally export: line items of non-draft
 * claims, by expense date. National roles may narrow to a zone (claims tagged to its regions) or a region; a regional
 * manager's claim scope already limits them, and they may narrow to a region.
 */
@Injectable()
export class ExpenseReportService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly expenses: ExpenseReportsService,
  ) {}

  async report(user: AuthUser, q: Record<string, unknown>): Promise<ExpenseReportDto> {
    const period = parseReportPeriod(q.from, q.to);
    const groupBy = (GROUPS.includes(q.group_by as ExpenseReportGroupBy) ? q.group_by : 'category') as ExpenseReportGroupBy;
    const { filters } = await resolveTerritory(this.db, user, q.zone_id, q.region_id);

    let regionIds: string[] | undefined;
    if (filters.region_id) regionIds = [filters.region_id];
    else if (isNational(user) && filters.zone_id) {
      regionIds = filters.regions.map((r) => r.id);
      if (!regionIds.length) regionIds = ['00000000-0000-0000-0000-000000000000'];
    }
    const f = this.expenses.parse({
      date_from: period.from,
      date_to: period.to,
      date_field: 'expense_date',
      statuses: q.statuses,
      region_ids: regionIds,
    });
    const base = () => this.expenses.baseItems(f, user);

    const inList = (list: string[]) => sql`c.status::text = any(${list}::text[])`;
    const aggs = [
      sql<number>`count(i.id)::int`.as('items'),
      sql<number>`count(distinct c.id)::int`.as('claims'),
      sql<number>`count(distinct c.employee_id)::int`.as('employees'),
      sql<string>`coalesce(sum(i.amount), 0)`.as('claimed'),
      sql<string>`coalesce(sum(i.approved_amount), 0)`.as('approved'),
      sql<string>`coalesce(sum(i.amount) filter (where ${inList(PENDING)}), 0)`.as('pending'),
      sql<string>`coalesce(sum(i.amount) filter (where ${inList(CLOSED)}), 0)`.as('rejected'),
      sql<string>`coalesce(sum(i.approved_amount) filter (where c.status = 'processed'), 0)`.as('paid'),
      sql<string>`coalesce(sum(i.approved_amount) filter (where ${inList(REVIEWED)}), 0)`.as('rev_approved'),
      sql<string>`coalesce(sum(i.amount) filter (where ${inList(REVIEWED)}), 0)`.as('rev_claimed'),
    ] as const;

    const { key, label, detail } = this.dimension(groupBy);
    const bucketKeys = (Object.keys(EXPENSE_STAGE_BUCKETS) as ExpenseStageBucket[]).filter((b) => b !== 'draft');

    const [totals, grouped, stages, categories] = await Promise.all([
      base().select([...aggs]).executeTakeFirst(),
      base()
        .leftJoin('trips as t', 't.id', 'c.trip_id')
        .leftJoin('organisations as o', 'o.id', 'i.customer_id')
        .leftJoin('regions as r', 'r.id', 'c.region_id')
        .select([sql<string>`${key}`.as('key'), sql<string>`max(${label})`.as('label'), sql<string | null>`max(${detail})`.as('detail'), ...aggs])
        .groupBy(key)
        .execute(),
      base()
        .select([sql<string>`c.status::text`.as('status'), sql<number>`count(distinct c.id)::int`.as('claims'), sql<string>`coalesce(sum(i.amount), 0)`.as('amount')])
        .groupBy('c.status')
        .execute(),
      base()
        .select([sql<string>`i.category_id::text`.as('key'), sql<string>`max(i.category_name)`.as('label'), sql<string>`coalesce(sum(i.amount), 0)`.as('amount')])
        .groupBy('i.category_id')
        .execute(),
    ]);

    const amounts = (r: Row | undefined): ExpenseAmounts => ({
      items: num(r?.items),
      claims: num(r?.claims),
      claimed: money(r?.claimed),
      approved: money(r?.approved),
      pending: money(r?.pending),
      rejected: money(r?.rejected),
      paid: money(r?.paid),
    });

    const chronological = groupBy === 'date' || groupBy === 'month';
    const rows = (grouped as Row[])
      .map((r) => ({
        key: String(r.key),
        label: groupBy === 'status' ? (EXPENSE_STATUS_LABELS[r.key as ExpenseClaimStatus] ?? String(r.key)) : String(r.label ?? '—'),
        detail: r.detail ? String(r.detail) : null,
        employees: num(r.employees),
        ...amounts(r),
      }))
      .sort((a, b) =>
        chronological ? b.key.localeCompare(a.key) : a.key === NONE ? 1 : b.key === NONE ? -1 : b.claimed - a.claimed || a.label.localeCompare(b.label),
      );

    const byStatus = new Map((stages as Row[]).map((s) => [String(s.status), s]));
    const t = (totals ?? {}) as Row;
    const claimed = money(t.claimed);
    const claims = num(t.claims);
    return {
      period,
      group_by: groupBy,
      filters,
      statuses: f.statuses,
      totals: {
        ...amounts(t),
        employees: num(t.employees),
        avg_per_claim: claims ? money(claimed / claims) : null,
        approval_rate: pct(money(t.rev_approved), money(t.rev_claimed)),
      },
      stages: bucketKeys.map((b) => {
        const list = EXPENSE_STAGE_BUCKETS[b].map((s) => byStatus.get(s)).filter(Boolean) as Row[];
        return { key: b, label: EXPENSE_STAGE_BUCKET_LABELS[b], claims: list.reduce((a, s) => a + num(s.claims), 0), amount: money(list.reduce((a, s) => a + num(s.amount), 0)) };
      }),
      categories: (categories as Row[])
        .map((c) => ({ key: String(c.key), label: String(c.label), amount: money(c.amount) }))
        .sort((a, b) => b.amount - a.amount),
      rows,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Group key, label and detail of a line (aliases: i item, c claim, emp employee, t trip, o customer, r region).
   * The 'none' fallback is a literal, not a bound parameter, so the key in SELECT and GROUP BY is the same expression.
   */
  private dimension(groupBy: ExpenseReportGroupBy): { key: RawBuilder<string>; label: RawBuilder<unknown>; detail: RawBuilder<unknown> } {
    switch (groupBy) {
      case 'employee':
        return { key: sql`emp.id::text`, label: sql`emp.full_name`, detail: sql`emp.employee_code` };
      case 'trip':
        return {
          key: sql`coalesce(c.trip_id::text, 'none')`,
          label: sql`case when t.id is null then 'No trip linked' else to_char(t.trip_date, 'DD Mon YYYY') || ' · ' || t.base_location end`,
          detail: sql`case when t.id is null then null else emp.full_name end`,
        };
      case 'customer':
        return { key: sql`coalesce(i.customer_id::text, 'none')`, label: sql`coalesce(o.name, 'No customer reference')`, detail: sql`o.city` };
      case 'date':
        return { key: sql`i.expense_date::text`, label: sql`to_char(i.expense_date, 'DD Mon YYYY')`, detail: sql`trim(to_char(i.expense_date, 'Day'))` };
      case 'month':
        return { key: sql`to_char(i.expense_date, 'YYYY-MM')`, label: sql`to_char(i.expense_date, 'Mon YYYY')`, detail: sql`null::text` };
      case 'region':
        return { key: sql`coalesce(c.region_id::text, 'none')`, label: sql`coalesce(r.name, 'No region')`, detail: sql`null::text` };
      case 'status':
        return { key: sql`c.status::text`, label: sql`c.status::text`, detail: sql`null::text` };
      case 'category':
      default:
        return { key: sql`i.category_id::text`, label: sql`i.category_name`, detail: sql`null::text` };
    }
  }
}
