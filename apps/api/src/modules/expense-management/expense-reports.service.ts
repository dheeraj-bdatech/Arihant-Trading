/**
 * Item-level reporting, grouped summaries and the fixed-format Accounts/Tally export (§5.29–34, §6).
 * Every query goes through the same role scope as the claim list, so query params cannot widen access.
 * Exports are streamed in batches straight to the response (CSV or XLSX).
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import ExcelJS from 'exceljs';
import type { Writable } from 'stream';
import {
  EXPENSE_STAGE_BUCKETS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_TALLY_EXPORT_COLUMNS,
  formatExpenseDate,
  type AuthUser,
  type ExpenseClaimStatus,
  type ExpenseStageBucket,
} from '@arihant/shared';
import { ExpenseClaimsService, money } from './expense-claims.service.js';
import {
  claimFilterExpressions,
  itemFilterExpressions,
  parseExpenseFilters,
  type ExpenseFilters,
} from './expense-filters.js';

const REPORT_SORT: Record<string, string> = {
  expense_date: 'i.expense_date',
  amount: 'i.amount',
  approved_amount: 'i.approved_amount',
  claim_number: 'c.claim_number',
  employee_name: 'emp.full_name',
  category_name: 'i.category_name',
  submitted_at: 'c.submitted_at',
};

@Injectable()
export class ExpenseReportsService {
  constructor(private readonly claims: ExpenseClaimsService) {}

  parse(query: Record<string, unknown>, maxPageSize = 200): ExpenseFilters {
    return parseExpenseFilters(query, { sortable: Object.keys(REPORT_SORT), defaultSort: 'expense_date', maxPageSize });
  }

  /** Items joined to their (visible, non-draft) claims with all filters applied. */
  baseItems(f: ExpenseFilters, user: AuthUser) {
    return this.claims
      .scopedClaims(user)
      .innerJoin('expense_items as i', 'i.claim_id', 'c.id')
      .where('i.deleted_at', 'is', null)
      .where('c.status', '<>', 'draft')
      .where((eb) => eb.and([...claimFilterExpressions(f, eb, true), ...itemFilterExpressions(f, eb)]));
  }

  private rowSelect(q: ReturnType<ExpenseReportsService['baseItems']>) {
    return q
      .leftJoin('users as mgr', 'mgr.id', 'c.manager_id')
      .leftJoin('regions as r', 'r.id', 'c.region_id')
      .leftJoin('trips as t', 't.id', 'c.trip_id')
      .leftJoin('organisations as o', 'o.id', 'i.customer_id')
      .leftJoin('projects as p', 'p.id', 'i.project_id')
      .select([
        'i.id as item_id',
        'i.expense_date',
        'i.category_id',
        'i.category_name',
        'i.amount',
        'i.approved_amount',
        'i.item_status',
        'i.purpose',
        'i.remarks',
        'i.reviewer_comment',
        'i.late_submission_reason',
        'i.duplicate_confirmed_at',
        'c.id as claim_id',
        'c.claim_number',
        'c.status',
        'c.submitted_at',
        'c.manager_actioned_at',
        'c.accounts_actioned_at',
        'c.tally_voucher_ref',
        'c.trip_id',
        'emp.id as employee_id',
        'emp.full_name as employee_name',
        'emp.employee_code',
        'mgr.full_name as manager_name',
        'r.name as region_name',
        't.trip_date',
        't.base_location as trip_location',
        'o.name as customer_name',
        'p.code as project_code',
        'p.name as project_name',
      ]);
  }

  async rows(query: Record<string, unknown>, user: AuthUser) {
    const f = this.parse(query);
    const base = this.baseItems(f, user);
    const totals = await base
      .select([
        sql<number>`count(i.id)::int`.as('items'),
        sql<number>`count(distinct c.id)::int`.as('claims'),
        sql<string>`coalesce(sum(i.amount), 0)`.as('claimed'),
        sql<string>`coalesce(sum(i.approved_amount), 0)`.as('approved'),
      ])
      .executeTakeFirst();
    const data = await this.rowSelect(base)
      .orderBy(sql.raw(REPORT_SORT[f.sort_by]), f.sort_dir)
      .orderBy('i.id')
      .limit(f.page_size)
      .offset((f.page - 1) * f.page_size)
      .execute();
    const total = Number(totals?.items || 0);
    return {
      data: data.map((d) => ({
        ...d,
        amount: money(d.amount),
        approved_amount: money(d.approved_amount),
        status_label: EXPENSE_STATUS_LABELS[d.status as ExpenseClaimStatus] || d.status,
      })),
      total,
      page: f.page,
      limit: f.page_size,
      totalPages: Math.max(1, Math.ceil(total / f.page_size)),
      totals: {
        items: total,
        claims: Number(totals?.claims || 0),
        total_claimed: Number(totals?.claimed || 0),
        total_approved: Number(totals?.approved || 0),
      },
    };
  }

  /**
   * Customers that appear on expense lines the caller can see — the report's customer filter options.
   * Lets Accounts filter by customer without read access to the organisations module.
   */
  async customers(user: AuthUser) {
    return this.claims
      .scopedClaims(user)
      .innerJoin('expense_items as i', 'i.claim_id', 'c.id')
      .innerJoin('organisations as o', 'o.id', 'i.customer_id')
      .where('i.deleted_at', 'is', null)
      .where('c.status', '<>', 'draft')
      .select(['o.id', 'o.name'])
      .distinct()
      .orderBy('o.name')
      .limit(500)
      .execute();
  }

  async summary(query: Record<string, unknown>, user: AuthUser) {
    const f = this.parse(query);
    const pendingStatuses = ['submitted', 'manager_approved', 'accounts_review', 'accounts_approved', 'clarification_required'];
    const agg = [
      sql<number>`count(i.id)::int`.as('items'),
      sql<number>`count(distinct c.id)::int`.as('claims'),
      sql<string>`coalesce(sum(i.amount), 0)`.as('claimed'),
      sql<string>`coalesce(sum(i.approved_amount), 0)`.as('approved'),
      sql<string>`coalesce(sum(case when c.status in (${sql.join(pendingStatuses)}) then i.amount else 0 end), 0)`.as('pending'),
    ] as const;
    const num = (r: any) => ({
      items: Number(r?.items || 0),
      claims: Number(r?.claims || 0),
      total_claimed: Number(r?.claimed || 0),
      total_approved: Number(r?.approved || 0),
      pending_amount: Number(r?.pending || 0),
    });

    // KPI buckets for the totals row: every non-draft status falls in exactly one, so
    // Stage 1 + Clarification + Stage 2 + Settled + Rejected/withdrawn = total claimed, always.
    const bucketKeys = (Object.keys(EXPENSE_STAGE_BUCKETS) as ExpenseStageBucket[]).filter((b) => b !== 'draft');
    const bucketAgg = bucketKeys.flatMap((b) => [
      sql<number>`(count(distinct c.id) filter (where c.status in (${sql.join(EXPENSE_STAGE_BUCKETS[b])})))::int`.as(`${b}_claims`),
      sql<string>`coalesce(sum(i.amount) filter (where c.status in (${sql.join(EXPENSE_STAGE_BUCKETS[b])})), 0)`.as(`${b}_amount`),
    ]);
    const paidAgg = sql<string>`coalesce(sum(i.approved_amount) filter (where c.status = 'processed'), 0)`.as('paid');

    const [totals, byCategory, byEmployee, byRegion, byStatus, byMonth] = await Promise.all([
      this.baseItems(f, user).select([...agg, ...bucketAgg, paidAgg]).executeTakeFirst(),
      this.baseItems(f, user).select(['i.category_name as key', ...agg]).groupBy('i.category_name').orderBy('claimed', 'desc').execute(),
      this.baseItems(f, user).select(['emp.full_name as key', 'emp.id as id', ...agg]).groupBy(['emp.id', 'emp.full_name']).orderBy('claimed', 'desc').limit(25).execute(),
      this.baseItems(f, user)
        .leftJoin('regions as r', 'r.id', 'c.region_id')
        .select([sql<string>`coalesce(r.name, 'Unassigned')`.as('key'), ...agg])
        .groupBy('r.name')
        .orderBy('claimed', 'desc')
        .execute(),
      this.baseItems(f, user).select(['c.status as key', ...agg]).groupBy('c.status').orderBy('claimed', 'desc').execute(),
      this.baseItems(f, user)
        .select([sql<string>`to_char(i.expense_date, 'YYYY-MM')`.as('key'), ...agg])
        .groupBy(sql`to_char(i.expense_date, 'YYYY-MM')`)
        .orderBy('key')
        .execute(),
    ]);
    const group = (rows: any[], label?: (k: string) => string) =>
      rows.map((r) => ({ key: r.key, id: r.id, label: label ? label(r.key) : r.key, ...num(r) }));
    const t = (totals || {}) as Record<string, unknown>;
    return {
      totals: {
        ...num(totals),
        /** Approved amount on processed (paid) claims. */
        paid_amount: Number(t.paid || 0),
        /** Claimed amount and distinct claims per stage; the amounts add up to total_claimed. */
        buckets: Object.fromEntries(bucketKeys.map((b) => [b, { claims: Number(t[`${b}_claims`] || 0), amount: Number(t[`${b}_amount`] || 0) }])),
      },
      by_category: group(byCategory),
      by_employee: group(byEmployee),
      by_region: group(byRegion),
      by_status: group(byStatus, (k) => EXPENSE_STATUS_LABELS[k as ExpenseClaimStatus] || k),
      by_month: group(byMonth),
    };
  }

  /** One export row in the documented Tally column order. */
  private exportRow(r: any): (string | number | null)[] {
    return [
      r.claim_number,
      r.employee_code || '',
      r.employee_name,
      r.region_name || '',
      r.trip_id ? `${formatExpenseDate(r.trip_date)} ${r.trip_location || ''}`.trim() : '',
      formatExpenseDate(r.expense_date),
      r.category_name,
      r.customer_name || '',
      r.project_code ? `${r.project_code} ${r.project_name || ''}`.trim() : '',
      r.purpose,
      Number(r.amount),
      r.approved_amount === null ? null : Number(r.approved_amount),
      r.manager_name || '',
      r.manager_actioned_at ? formatExpenseDate(r.manager_actioned_at) : '',
      r.accounts_actioned_at ? formatExpenseDate(r.accounts_actioned_at) : '',
      EXPENSE_STATUS_LABELS[r.status as ExpenseClaimStatus] || r.status,
      r.tally_voucher_ref || '',
      [r.remarks, r.reviewer_comment ? `Reviewer: ${r.reviewer_comment}` : null, r.late_submission_reason ? `Late: ${r.late_submission_reason}` : null]
        .filter(Boolean)
        .join(' | '),
    ];
  }

  /** Streams every matching row in batches so large exports never sit in memory. */
  private async *batches(f: ExpenseFilters, user: AuthUser) {
    const size = this.claims.config.exportBatchSize;
    let offset = 0;
    for (;;) {
      const rows = await this.rowSelect(this.baseItems(f, user))
        .orderBy('c.claim_number')
        .orderBy('i.expense_date')
        .orderBy('i.id')
        .limit(size)
        .offset(offset)
        .execute();
      if (!rows.length) return;
      yield rows;
      if (rows.length < size) return;
      offset += size;
    }
  }

  async exportTo(out: Writable, format: 'csv' | 'xlsx', query: Record<string, unknown>, user: AuthUser) {
    const f = this.parse(query, 200);
    if (format === 'csv') {
      const esc = (v: unknown) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        // Neutralise spreadsheet formula injection, then quote.
        const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      out.write('﻿' + EXPENSE_TALLY_EXPORT_COLUMNS.map(esc).join(',') + '\r\n');
      for await (const rows of this.batches(f, user)) {
        out.write(rows.map((r) => this.exportRow(r).map(esc).join(',')).join('\r\n') + '\r\n');
      }
      out.end();
      return;
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
    const sheet = workbook.addWorksheet('Expenses');
    sheet.columns = EXPENSE_TALLY_EXPORT_COLUMNS.map((h) => ({
      header: h,
      width: ['Purpose', 'Remarks', 'Customer'].includes(h) ? 36 : h.includes('Amount') ? 16 : 18,
      style: h.includes('Amount') ? { numFmt: '0.00' } : {},
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();
    for await (const rows of this.batches(f, user)) {
      for (const r of rows) sheet.addRow(this.exportRow(r)).commit();
    }
    sheet.commit();
    await workbook.commit();
  }
}
