'use client';

/**
 * Report 3 — Expense breakdown (GET /reports/expenses, Blueprint §40): claimed / approved / pending / paid by employee,
 * trip, customer, date, month, category, region or approval status, with the approval-stage position and category mix.
 * Line-level detail and the Tally export stay on Expense Reports (same scope and filters).
 */
import React, { Suspense } from 'react';
import Link from 'next/link';
import { BadgeCheck, CalendarDays, Clock, Download, IndianRupee, ListChecks, RefreshCw, TableProperties, XCircle } from 'lucide-react';
import { EXPENSE_CLAIM_STATUSES, EXPENSE_STATUS_LABELS, formatINR, type ExpenseBreakdownRow, type ExpenseReportDto, type ExpenseReportGroupBy } from '@arihant/shared';
import { useAuth } from '@/lib/auth-context';
import {
  BarList,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InfoCallout,
  PageContainer,
  PageHeader,
  PageLoader,
  Select,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@/components/ui';
import { ReportFilterBar, ReportsDenied, ReportsNav, canOpen, downloadCsv, fmtDay, money, pctText, useReport, useReportFilters } from '../_lib/report-ui';

const GROUPS: { id: ExpenseReportGroupBy; label: string; head: string }[] = [
  { id: 'category', label: 'Category', head: 'Category' },
  { id: 'employee', label: 'Employee', head: 'Employee' },
  { id: 'trip', label: 'Trip', head: 'Trip' },
  { id: 'customer', label: 'Customer', head: 'Customer' },
  { id: 'region', label: 'Region', head: 'Region' },
  { id: 'status', label: 'Approval status', head: 'Approval status' },
  { id: 'date', label: 'Date', head: 'Expense date' },
  { id: 'month', label: 'Month', head: 'Month' },
];
/** Statuses a report can filter on (drafts are never reported). */
const STATUS_OPTIONS = EXPENSE_CLAIM_STATUSES.filter((s) => s !== 'draft');

type Col = { label: string; title: string; get: (r: ExpenseBreakdownRow) => number; money?: boolean };
const COLUMNS: Col[] = [
  { label: 'Lines', title: 'Expense lines', get: (r) => r.items },
  { label: 'Claims', title: 'Distinct claims', get: (r) => r.claims },
  { label: 'Employees', title: 'Distinct employees', get: (r) => r.employees },
  { label: 'Claimed', title: 'Amount claimed', get: (r) => r.claimed, money: true },
  { label: 'Approved', title: 'Amount approved by the manager / Accounts so far', get: (r) => r.approved, money: true },
  { label: 'Pending', title: 'Claimed on claims still in review, clarification or awaiting payment', get: (r) => r.pending, money: true },
  { label: 'Paid', title: 'Approved on processed (paid) claims', get: (r) => r.paid, money: true },
  { label: 'Rejected', title: 'Claimed on rejected / withdrawn claims', get: (r) => r.rejected, money: true },
];

function ExpenseReport() {
  const { user } = useAuth();
  const allowed = canOpen(user?.role, 'expenses');
  const filters = useReportFilters(['group_by', 'statuses']);
  const groupBy = (GROUPS.some((g) => g.id === filters.values.group_by) ? filters.values.group_by : 'category') as ExpenseReportGroupBy;
  const { data, loading, error, reload } = useReport<ExpenseReportDto>('/reports/expenses', { ...filters.query, from: filters.from, to: filters.to }, allowed && !filters.invalid);

  if (!user) return <PageLoader rows={4} label="Loading report" />;
  if (!allowed) {
    return (
      <>
        <ReportsNav role={user.role} />
        <ReportsDenied />
      </>
    );
  }

  const head = GROUPS.find((g) => g.id === (data?.group_by ?? groupBy))!.head;
  const exportCsv = () => {
    if (!data) return;
    const total: ExpenseBreakdownRow = { key: 'total', label: 'Total', detail: null, ...data.totals };
    const line = (r: ExpenseBreakdownRow) => [r.key === 'total' ? 'Total' : data.group_by === 'date' ? r.key : r.label, r.detail ?? '', ...COLUMNS.map((c) => c.get(r))];
    downloadCsv(
      `Arihant_Expenses_by_${head.replace(/\s+/g, '_')}_${data.period.from}_to_${data.period.to}`,
      [head, 'Detail', ...COLUMNS.map((c) => (c.money ? `${c.label} (INR)` : c.label))],
      [...data.rows.map(line), line(total)],
    );
  };
  const t = data?.totals;
  const status = filters.values.statuses ?? '';

  return (
    <>
      <PageHeader
        title="Expense breakdown report"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/expenses/reports?date_from=${filters.from}&date_to=${filters.to}${status ? `&statuses=${status}` : ''}`}>
              <Button variant="secondary" size="sm" leftIcon={<TableProperties className="h-4 w-4" />}>
                Line register &amp; Tally export
              </Button>
            </Link>
            <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!data}>
              Export CSV
            </Button>
          </div>
        }
      />
      <ReportsNav role={user.role} />
      <ReportFilterBar filters={filters} territory={data?.filters}>
        <div className="lg:w-[220px]">
          <Select label="Approval status" value={STATUS_OPTIONS.includes(status as (typeof STATUS_OPTIONS)[number]) ? status : ''} onChange={(e) => filters.set({ statuses: e.target.value || null })}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {EXPENSE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </ReportFilterBar>

      {error && (
        <InfoCallout variant="danger" title="Could not load the expense report">
          <p>{error}</p>
          <Button variant="secondary" size="xs" className="mt-2" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={reload}>
            Try again
          </Button>
        </InfoCallout>
      )}

      {!data || !t ? (
        loading ? <PageLoader rows={5} label="Building the expense report" /> : null
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Claimed" value={money(t.claimed)} subtext={`${t.claims} claims · ${t.items} lines · ${t.employees} employees`} icon={<IndianRupee className="h-4 w-4" />} variant="primary" />
            <StatCard title="Approved" value={money(t.approved)} subtext={t.approval_rate === null ? 'No claims fully reviewed yet' : `${pctText(t.approval_rate)} of reviewed claims approved`} icon={<BadgeCheck className="h-4 w-4" />} variant="emerald" />
            <StatCard title="Pending" value={money(t.pending)} subtext="In review, clarification or awaiting payment" icon={<Clock className="h-4 w-4" />} variant={t.pending > 0 ? 'amber' : 'default'} />
            <StatCard title="Paid" value={money(t.paid)} subtext="Processed claims (approved amount)" icon={<ListChecks className="h-4 w-4" />} />
            <StatCard title="Rejected / withdrawn" value={money(t.rejected)} subtext={t.avg_per_claim === null ? '—' : `Average claim ${formatINR(t.avg_per_claim)}`} icon={<XCircle className="h-4 w-4" />} variant={t.rejected > 0 ? 'rose' : 'default'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Where the money sits</CardTitle>
                <CardDescription>Claimed amount by approval stage — the stages add up to the total claimed.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  label="Claimed amount by approval stage"
                  labelWidth="45%"
                  items={data.stages.map((s) => ({ key: s.key, label: s.label, value: s.amount, display: `${money(s.amount)} · ${s.claims}`, detail: `${s.claims} claims` }))}
                  emptyText="No claims in this period."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Category mix</CardTitle>
                <CardDescription>Claimed amount per expense category.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  label="Claimed amount by category"
                  labelWidth="45%"
                  items={data.categories.map((c) => ({ key: c.key, label: c.label, value: c.amount, display: money(c.amount) }))}
                  emptyText="No expenses in this period."
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="gap-3">
              <div>
                <CardTitle>By {head.toLowerCase()}</CardTitle>
                <CardDescription>Pick how to break the expenses down. Every view adds up to the same total.</CardDescription>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <Tabs
                  variant="segmented"
                  size="sm"
                  className="min-w-max"
                  activeTab={groupBy}
                  onChange={(id) => filters.set({ group_by: id === 'category' ? null : id })}
                  tabs={GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.id === 'date' || g.id === 'month' ? <CalendarDays className="h-3.5 w-3.5" /> : undefined }))}
                />
              </div>
            </CardHeader>
            <CardContent>
              {data.rows.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#6B7280]">No expenses match this period and filter.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-[170px] bg-[#FBFAF7]">{head}</TableHead>
                      {COLUMNS.map((c) => (
                        <TableHead key={c.label} title={c.title} className="px-2 text-right normal-case tracking-normal whitespace-nowrap">
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="sticky left-0 z-[1] bg-white">
                          <div className={`font-semibold ${r.key === 'none' ? 'text-[#4A5568]' : 'text-[#14213D]'}`}>{r.label}</div>
                          {r.detail && <div className="text-[10px] text-[#4A5568]">{r.detail}</div>}
                        </TableCell>
                        {COLUMNS.map((c) => (
                          <TableCell key={c.label} className={`px-2 text-right font-mono whitespace-nowrap ${c.label === 'Claimed' ? 'font-semibold text-[#14213D]' : ''}`}>
                            {c.money ? formatINR(c.get(r)) : c.get(r)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-[#DCD8CE] bg-[#FBFAF7] hover:bg-[#FBFAF7]">
                      <TableCell className="sticky left-0 z-[1] bg-[#FBFAF7] font-bold text-[#14213D]">Total</TableCell>
                      {COLUMNS.map((c) => {
                        const v = c.get({ key: 'total', label: 'Total', detail: null, ...t });
                        return (
                          <TableCell key={c.label} className="px-2 text-right font-mono font-bold whitespace-nowrap">
                            {c.money ? formatINR(v) : v}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] text-[#6B7280]">
            Period {fmtDay(data.period.from)} → {fmtDay(data.period.to)} (IST), by expense date; draft claims are never included. The same claim visibility
            as Expense Reports applies, so these totals match that register and its Tally export for the same dates and filters. Lines and claims are
            counted once each in the total even when a claim spans several groups.
          </p>
        </div>
      )}
    </>
  );
}

export default function ExpenseReportPage() {
  return (
    <PageContainer>
      <Suspense fallback={<PageLoader rows={5} label="Loading report" />}>
        <ExpenseReport />
      </Suspense>
    </PageContainer>
  );
}
