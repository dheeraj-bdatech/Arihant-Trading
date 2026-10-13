'use client';

/**
 * Expense Reports (§8.6): every filter lives in the URL, totals reflect the whole filtered set,
 * and the export uses exactly the same filters (server-side role scoping applies to all of it).
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronLeft, ChevronRight, Download, SlidersHorizontal, X } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  InfoCallout,
  Input,
  PageContainer,
  PageHeader,
  PageLoader,
  Select,
  StatCard,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@/components/ui';
import { api } from '@/lib/api';
import { EXPENSE_CLAIM_STATUSES, EXPENSE_STATUS_LABELS, formatExpenseAmount } from '@arihant/shared';
import { errorMessage, fieldErrors, saveBlob, useCategories } from '../_lib/expense-lib';
import type { ExpenseClaimStatus } from '@arihant/shared';
import { DateText, ExpensesNav, ItemStatusBadge, LateFlag, Money, StatusBadge, useToaster } from '../_lib/expense-ui';
import { MultiSelect } from '../_lib/MultiSelect';
import { useUrlFilters } from '../_lib/use-url-filters';

const KEYS = [
  'employee_ids', 'trip_id', 'customer_ids', 'project_ids', 'category_ids', 'region_ids', 'statuses',
  'date_from', 'date_to', 'date_field', 'amount_min', 'amount_max', 'search', 'page', 'sort_by', 'sort_dir',
] as const;

interface Group { key: string; label: string; total_claimed: number; total_approved: number; claims: number; items: number; pending_amount: number }
interface Summary { totals: Omit<Group, 'key' | 'label'>; by_category: Group[]; by_region: Group[]; by_status: Group[]; by_employee: Group[]; by_month: Group[] }

function Reports() {
  const { values, set, clear, list, activeCount, query } = useUrlFilters(KEYS);
  const { categories } = useCategories(true);
  const [rows, setRows] = useState<any>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<'by_category' | 'by_region' | 'by_employee' | 'by_status' | 'by_month'>('by_category');
  const [masters, setMasters] = useState<{ users: any[]; customers: any[]; projects: any[]; regions: any[]; trips: any[] }>({ users: [], customers: [], projects: [], regions: [], trips: [] });
  const { push, Toaster } = useToaster();

  useEffect(() => {
    const safe = (p: Promise<any>) => p.catch(() => null);
    Promise.all([
      safe(api.get('/users', { limit: 100 })),
      safe(api.get('/organisations', { limit: 100 })),
      safe(api.get('/projects', { include_inactive: true })),
      safe(api.get('/masters/regions')),
      safe(api.get('/expense-claims/linkable')),
    ]).then(([u, o, p, r, l]) =>
      setMasters({
        users: u?.data || u || [],
        customers: o?.data || [],
        projects: p || [],
        regions: r?.data || r || [],
        trips: l?.trips || [],
      }),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrors({});
    try {
      const q = { page_size: 25, ...query };
      const [r, s] = await Promise.all([api.get('/expense-reports', q), api.get<Summary>('/expense-reports/summary', query)]);
      setRows(r);
      setSummary(s);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const exportAs = async (format: 'xlsx' | 'csv') => {
    setExporting(format);
    try {
      const { page, sort_by, sort_dir, ...filters } = query;
      void page; void sort_by; void sort_dir;
      const { blob, fileName } = await api.blob('/expense-reports/export', { ...filters, format });
      saveBlob(blob, fileName || `expenses.${format}`);
    } catch (e) {
      push('error', errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  const sort = (col: string) => {
    const dir = values.sort_by === col && values.sort_dir !== 'asc' ? 'asc' : 'desc';
    set({ sort_by: col, sort_dir: dir }, { resetPage: false });
  };
  const SortHead: React.FC<{ col: string; children: React.ReactNode; right?: boolean }> = ({ col, children, right }) => (
    <TableHead className={right ? 'text-right' : undefined}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-[#0F5E63]" onClick={() => sort(col)}>
        {children}
        {(values.sort_by || 'expense_date') === col && <span aria-hidden>{values.sort_dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  );

  const groups = summary?.[breakdown] || [];
  const maxGroup = Math.max(1, ...groups.map((g) => g.total_claimed));
  const page = Number(values.page || 1);
  const opts = useMemo(
    () => ({
      employees: masters.users.map((u: any) => ({ value: u.id, label: u.full_name })),
      customers: masters.customers.map((c: any) => ({ value: c.id, label: c.name })),
      projects: masters.projects.map((p: any) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
      regions: masters.regions.map((r: any) => ({ value: r.id, label: r.name })),
      categories: categories.map((c) => ({ value: c.id, label: c.name + (c.is_active ? '' : ' (inactive)') })),
      statuses: EXPENSE_CLAIM_STATUSES.filter((s) => s !== 'draft' && s !== 'manager_approved').map((s) => ({ value: s, label: EXPENSE_STATUS_LABELS[s] })),
    }),
    [masters, categories],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Expense Reports"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" isLoading={exporting === 'csv'} onClick={() => exportAs('csv')}>CSV</Button>
            <Button size="sm" isLoading={exporting === 'xlsx'} leftIcon={<Download className="h-4 w-4" />} onClick={() => exportAs('xlsx')}>Export Excel</Button>
          </div>
        }
      />
      <ExpensesNav />

      <Button className="md:hidden" variant="secondary" fullWidth leftIcon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setFiltersOpen((o) => !o)}>
        {filtersOpen ? 'Hide filters' : `Filters${activeCount ? ` (${activeCount})` : ''}`}
      </Button>
      <Card className={`p-3.5 space-y-3 overflow-visible ${filtersOpen ? '' : 'hidden md:block'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MultiSelect label="Employee" options={opts.employees} value={list('employee_ids')} onChange={(v) => set({ employee_ids: v })} />
          <MultiSelect label="Category" options={opts.categories} value={list('category_ids')} onChange={(v) => set({ category_ids: v })} />
          <MultiSelect label="Approval status" options={opts.statuses} value={list('statuses')} onChange={(v) => set({ statuses: v })} />
          <MultiSelect label="Region" options={opts.regions} value={list('region_ids')} onChange={(v) => set({ region_ids: v })} />
          <MultiSelect label="Customer" options={opts.customers} value={list('customer_ids')} onChange={(v) => set({ customer_ids: v })} />
          <MultiSelect label="Project" options={opts.projects} value={list('project_ids')} onChange={(v) => set({ project_ids: v })} />
          <Select
            label="Trip"
            value={values.trip_id}
            onChange={(e) => set({ trip_id: e.target.value })}
            options={[{ value: '', label: 'Any trip' }, ...masters.trips.map((t: any) => ({ value: t.id, label: `${t.trip_date.split('-').reverse().join('-')} · ${t.base_location}` }))]}
          />
          <Input label="Search" placeholder="Claim no., title, employee" defaultValue={values.search} onKeyDown={(e) => e.key === 'Enter' && set({ search: (e.target as HTMLInputElement).value })} onBlur={(e) => e.target.value !== values.search && set({ search: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <Select
            label="Date applies to"
            value={values.date_field || 'expense_date'}
            onChange={(e) => set({ date_field: e.target.value === 'expense_date' ? null : e.target.value })}
            options={[{ value: 'expense_date', label: 'Expense date' }, { value: 'submitted_at', label: 'Submitted date' }]}
          />
          <Input label="From" type="date" value={values.date_from} onChange={(e) => set({ date_from: e.target.value })} error={errors.date_from} />
          <Input label="To" type="date" value={values.date_to} min={values.date_from || undefined} onChange={(e) => set({ date_to: e.target.value })} error={errors.date_to} />
          <Input label="Min amount (₹)" inputMode="decimal" defaultValue={values.amount_min} onBlur={(e) => e.target.value !== values.amount_min && set({ amount_min: e.target.value })} error={errors.amount_min} />
          <Input label="Max amount (₹)" inputMode="decimal" defaultValue={values.amount_max} onBlur={(e) => e.target.value !== values.amount_max && set({ amount_max: e.target.value })} error={errors.amount_max} />
          <Button variant="ghost" disabled={!activeCount} leftIcon={<X className="h-4 w-4" />} onClick={clear}>Clear filters</Button>
        </div>
      </Card>

      {error && !Object.keys(errors).length && <InfoCallout variant="danger" title="Could not load the report">{error}</InfoCallout>}

      <StatGrid cols={4}>
        <StatCard label="Total claimed" value={formatExpenseAmount(summary?.totals.total_claimed ?? 0)} subtext={`${summary?.totals.items ?? 0} expense lines`} variant="primary" />
        <StatCard label="Total approved" value={formatExpenseAmount(summary?.totals.total_approved ?? 0)} subtext="Manager / Accounts approved" variant="emerald" />
        <StatCard label="Pending amount" value={formatExpenseAmount(summary?.totals.pending_amount ?? 0)} subtext="Still in review or clarification" variant="amber" />
        <StatCard label="Claims" value={String(summary?.totals.claims ?? 0)} subtext="Distinct claims in this view" />
      </StatGrid>

      <Card className="p-4 space-y-3">
        <Tabs
          variant="pills"
          size="sm"
          activeTab={breakdown}
          onChange={(id) => setBreakdown(id as typeof breakdown)}
          tabs={[
            { id: 'by_category', label: 'By category' },
            { id: 'by_region', label: 'By region' },
            { id: 'by_employee', label: 'By employee' },
            { id: 'by_status', label: 'By status' },
            { id: 'by_month', label: 'By month' },
          ]}
        />
        {groups.length === 0 ? (
          <p className="text-sm text-[#4A5568] py-4 text-center">No data for these filters.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-[#14213D]" title={g.label}>{breakdown === 'by_month' ? g.label.split('-').reverse().join('-') : g.label}</span>
                <span className="h-2.5 rounded-full bg-[#ECE9E2] overflow-hidden" aria-hidden>
                  <span className="block h-full rounded-full bg-[#0F5E63]" style={{ width: `${(g.total_claimed / maxGroup) * 100}%` }} />
                </span>
                <span className="font-mono tabular-nums text-xs text-right whitespace-nowrap">
                  {formatExpenseAmount(g.total_claimed)}
                  <span className="hidden sm:inline text-[#4A5568]"> · {g.claims} claim(s)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {loading && !rows ? (
        <PageLoader rows={5} />
      ) : rows && rows.data.length === 0 ? (
        <EmptyState icon={BarChart3} title="No expenses match these filters" description="Widen the date range or clear some filters." action={activeCount ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined} />
      ) : (
        rows && (
          <>
            <Card className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead col="expense_date">Date</SortHead>
                    <SortHead col="claim_number">Claim</SortHead>
                    <SortHead col="employee_name">Employee</SortHead>
                    <SortHead col="category_name">Category</SortHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Customer / Project</TableHead>
                    <SortHead col="amount" right>Claimed</SortHead>
                    <SortHead col="approved_amount" right>Approved</SortHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.data.map((r: any) => (
                    <TableRow key={r.item_id}>
                      <TableCell className="text-xs whitespace-nowrap"><DateText value={r.expense_date} /></TableCell>
                      <TableCell><Link href={`/expenses/${r.claim_id}`} className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline">{r.claim_number}</Link></TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.employee_name}<div className="text-[11px] text-[#4A5568]">{r.region_name || ''}</div></TableCell>
                      <TableCell className="text-xs">{r.category_name}</TableCell>
                      <TableCell className="text-xs max-w-[220px]"><div className="truncate">{r.purpose}</div>{r.late_submission_reason && <LateFlag />}</TableCell>
                      <TableCell className="text-xs">{[r.customer_name, r.project_code].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell className="text-right"><Money value={r.amount} /></TableCell>
                      <TableCell className="text-right"><Money value={r.approved_amount} /></TableCell>
                      <TableCell><div className="flex flex-col gap-1 items-start"><StatusBadge status={r.status as ExpenseClaimStatus} />{r.item_status !== 'pending' && <ItemStatusBadge status={r.item_status} />}</div></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-[#FBFAF7] font-semibold">
                    <TableCell colSpan={6} className="text-xs uppercase tracking-wide text-[#4A5568]">Total (all {rows.totals.items} filtered lines)</TableCell>
                    <TableCell className="text-right"><Money value={rows.totals.total_claimed} /></TableCell>
                    <TableCell className="text-right"><Money value={rows.totals.total_approved} /></TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
            {rows.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-[#4A5568]">
                <span>Page {page} of {rows.totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, { resetPage: false })} leftIcon={<ChevronLeft className="h-4 w-4" />}>Prev</Button>
                  <Button size="sm" variant="secondary" disabled={page >= rows.totalPages} onClick={() => set({ page: String(page + 1) }, { resetPage: false })} rightIcon={<ChevronRight className="h-4 w-4" />}>Next</Button>
                </div>
              </div>
            )}
          </>
        )
      )}
      <Toaster />
    </PageContainer>
  );
}

export default function ExpenseReportsPage() {
  return (
    <Suspense fallback={<PageLoader rows={5} />}>
      <Reports />
    </Suspense>
  );
}
