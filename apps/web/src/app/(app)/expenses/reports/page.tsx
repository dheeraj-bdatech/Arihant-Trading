'use client';

/**
 * Expense Reports (§8.6): every filter lives in the URL, totals reflect the whole filtered set,
 * and the export uses exactly the same filters (server-side role scoping applies to all of it).
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Building, ChevronLeft, ChevronRight, Download, FolderKanban, Layers, MapPin, Search, SlidersHorizontal, Tag, User } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  FilterMenu,
  InfoCallout,
  PageContainer,
  PageHeader,
  PageLoader,
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
import { DateText, ExpenseViewMenu, ItemStatusBadge, LateFlag, Money, StatusBadge, useToaster } from '../_lib/expense-ui';
import { useUrlFilters } from '../_lib/use-url-filters';

const KEYS = [
  'employee_ids', 'trip_id', 'customer_ids', 'project_ids', 'category_ids', 'region_ids', 'statuses',
  'date_from', 'date_to', 'date_field', 'amount_min', 'amount_max', 'search', 'page', 'sort_by', 'sort_dir',
] as const;
/** Filters folded into the "More" panel so the main filter row stays on one line. */
const MORE_KEYS = ['date_field', 'date_from', 'date_to', 'amount_min', 'amount_max', 'trip_id', 'customer_ids', 'project_ids'] as const;
const CONTROL = 'h-8 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none';

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
  const [moreOpen, setMoreOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<'by_category' | 'by_region' | 'by_employee' | 'by_status' | 'by_month'>('by_category');
  const [masters, setMasters] = useState<{ users: any[]; customers: any[]; projects: any[]; regions: any[]; trips: any[] }>({ users: [], customers: [], projects: [], regions: [], trips: [] });
  const { push, Toaster } = useToaster();

  useEffect(() => {
    const safe = (p: Promise<any>) => p.catch(() => null);
    Promise.all([
      safe(api.get('/users', { limit: 100 })),
      safe(api.get('/expense-reports/customers')),
      safe(api.get('/projects', { include_inactive: true })),
      safe(api.get('/masters/regions')),
      safe(api.get('/expense-claims/linkable')),
    ]).then(([u, o, p, r, l]) =>
      setMasters({
        users: u?.data || u || [],
        customers: Array.isArray(o) ? o : [],
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
  const SortButton: React.FC<{ col: string; children: React.ReactNode }> = ({ col, children }) => (
    <button type="button" className="inline-flex items-center gap-1 hover:text-[#0F5E63]" onClick={() => sort(col)}>
      {children}
      {(values.sort_by || 'expense_date') === col && <span aria-hidden>{values.sort_dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
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

  const moreActive = MORE_KEYS.filter((k) => values[k]).length;
  const statusCounts: Record<string, number> = Object.fromEntries((summary?.by_status || []).map((g) => [g.key, g.claims]));
  /** Multi-value URL filter as a FilterMenu: picking an option toggles it; the first row clears. */
  const multiMenu = (label: string, icon: React.ReactNode, key: (typeof KEYS)[number], allLabel: string, options: { value: string; label: string }[]) => {
    const selected = list(key);
    return (
      <FilterMenu
        label={label}
        icon={icon}
        className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
        options={[
          { key: 'all', label: allLabel, active: selected.length === 0, onSelect: () => set({ [key]: null }) },
          ...options.map((o) => ({
            key: o.value,
            label: o.label,
            count: key === 'statuses' ? statusCounts[o.value] : undefined,
            active: selected.includes(o.value),
            onSelect: () => set({ [key]: selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value] }),
          })),
        ]}
      />
    );
  };

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

      {/* Key metrics — totals for the whole filtered set. */}
      <StatGrid cols={4} className="gap-3">
        <StatCard label="Total claimed" value={formatExpenseAmount(summary?.totals.total_claimed ?? 0)} subtext={`${summary?.totals.items ?? 0} expense lines`} variant="primary" />
        <StatCard label="Total approved" value={formatExpenseAmount(summary?.totals.total_approved ?? 0)} subtext="Manager / Accounts approved" variant="emerald" />
        <StatCard label="Pending amount" value={formatExpenseAmount(summary?.totals.pending_amount ?? 0)} subtext="Still in review or clarification" variant="amber" />
        <StatCard label="Claims" value={String(summary?.totals.claims ?? 0)} subtext="Distinct claims in this view" />
      </StatGrid>

      {/* One filter row: View, search, then compact dropdowns (multi-value: pick again to add or remove).
          Dates, amount, trip, customer and project sit in the "More" panel underneath. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <ExpenseViewMenu />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              key={values.search}
              type="search"
              aria-label="Search expenses"
              placeholder="Search claim no., title, employee…"
              defaultValue={values.search}
              onKeyDown={(e) => e.key === 'Enter' && set({ search: (e.target as HTMLInputElement).value })}
              onBlur={(e) => e.target.value !== values.search && set({ search: e.target.value })}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            {multiMenu('Employee', <User />, 'employee_ids', 'Any employee', opts.employees)}
            {multiMenu('Region', <MapPin />, 'region_ids', 'All regions', opts.regions)}
            {multiMenu('Category', <Tag />, 'category_ids', 'All categories', opts.categories)}
            {multiMenu('Status', <Layers />, 'statuses', 'All statuses', opts.statuses)}
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={`filter-menu-btn ${moreOpen || moreActive ? 'filter-menu-btn--on' : ''}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>More</span>
              {moreActive > 0 && <span className="filter-menu-chip">{moreActive}</span>}
            </button>
            {activeCount > 0 && (
              <Button variant="ghost" size="xs" onClick={clear} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>

        {(moreOpen || Object.keys(errors).length > 0) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-[#ECE9E2] pt-2.5 text-xs">
            <span className="font-semibold text-[#4A5568]">Date</span>
            <select
              aria-label="Date applies to"
              value={values.date_field || 'expense_date'}
              onChange={(e) => set({ date_field: e.target.value === 'expense_date' ? null : e.target.value })}
              className={CONTROL}
            >
              <option value="expense_date">Expense date</option>
              <option value="submitted_at">Submitted date</option>
            </select>
            <label className="flex items-center gap-1.5 text-[#4A5568]">
              From
              <input type="date" value={values.date_from} onChange={(e) => set({ date_from: e.target.value })} className={`${CONTROL} ${errors.date_from ? 'border-[#881337]' : ''}`} title={errors.date_from} />
            </label>
            <label className="flex items-center gap-1.5 text-[#4A5568]">
              To
              <input type="date" value={values.date_to} min={values.date_from || undefined} onChange={(e) => set({ date_to: e.target.value })} className={`${CONTROL} ${errors.date_to ? 'border-[#881337]' : ''}`} title={errors.date_to} />
            </label>
            <span className="font-semibold text-[#4A5568] lg:ml-2">Amount ₹</span>
            <input
              key={`min-${values.amount_min}`}
              aria-label="Min amount (₹)"
              placeholder="Min"
              inputMode="decimal"
              defaultValue={values.amount_min}
              onBlur={(e) => e.target.value !== values.amount_min && set({ amount_min: e.target.value })}
              className={`${CONTROL} w-24 ${errors.amount_min ? 'border-[#881337]' : ''}`}
              title={errors.amount_min}
            />
            <span className="text-[#4A5568]">–</span>
            <input
              key={`max-${values.amount_max}`}
              aria-label="Max amount (₹)"
              placeholder="Max"
              inputMode="decimal"
              defaultValue={values.amount_max}
              onBlur={(e) => e.target.value !== values.amount_max && set({ amount_max: e.target.value })}
              className={`${CONTROL} w-24 ${errors.amount_max ? 'border-[#881337]' : ''}`}
              title={errors.amount_max}
            />
            <span className="font-semibold text-[#4A5568] lg:ml-2">Trip</span>
            <select aria-label="Trip" value={values.trip_id} onChange={(e) => set({ trip_id: e.target.value })} className={`${CONTROL} max-w-[220px]`}>
              <option value="">Any trip</option>
              {masters.trips.map((t: any) => (
                <option key={t.id} value={t.id}>{`${t.trip_date.split('-').reverse().join('-')} · ${t.base_location}`}</option>
              ))}
            </select>
            {multiMenu('Customer', <Building />, 'customer_ids', 'Any customer', opts.customers)}
            {multiMenu('Project', <FolderKanban />, 'project_ids', 'Any project', opts.projects)}
            {moreActive > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => set({ date_field: null, date_from: null, date_to: null, amount_min: null, amount_max: null, trip_id: null, customer_ids: null, project_ids: null })}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset
              </Button>
            )}
          </div>
        )}
        {Object.keys(errors).length > 0 && (
          <p className="text-xs text-[#881337]">{Object.values(errors).join(' ')}</p>
        )}
      </Card>

      {error && !Object.keys(errors).length && <InfoCallout variant="danger" title="Could not load the report">{error}</InfoCallout>}

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
            <Card className="p-0 overflow-x-auto [&_td]:px-3 [&_th]:px-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        <SortButton col="claim_number">Claim</SortButton>
                        <span aria-hidden>/</span>
                        <SortButton col="expense_date">Date</SortButton>
                      </span>
                    </TableHead>
                    <SortHead col="employee_name">Employee</SortHead>
                    <SortHead col="category_name">Category / Purpose</SortHead>
                    <TableHead>Customer / Project</TableHead>
                    <SortHead col="amount" right>Claimed</SortHead>
                    <SortHead col="approved_amount" right>Approved</SortHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.data.map((r: any) => (
                    <TableRow key={r.item_id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/expenses/${r.claim_id}`} className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline">{r.claim_number}</Link>
                        <div className="text-[11px] text-[#4A5568]"><DateText value={r.expense_date} /></div>
                      </TableCell>
                      <TableCell className="text-sm max-w-[150px]">
                        <div className="truncate" title={r.employee_name}>{r.employee_name}</div>
                        <div className="truncate text-[11px] text-[#4A5568]" title={r.region_name || undefined}>{r.region_name || ''}</div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px]">
                        <div className="truncate font-medium text-[#14213D]" title={r.category_name}>{r.category_name}</div>
                        <div className="truncate text-[11px] text-[#4A5568]" title={r.purpose}>{r.purpose}</div>
                        {r.late_submission_reason && <LateFlag />}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        <div className="truncate" title={r.customer_name || undefined}>{r.customer_name || (r.project_code ? '' : '—')}</div>
                        {r.project_code && <div className="truncate font-mono text-[11px] text-[#4A5568]" title={r.project_code}>{r.project_code}</div>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap"><Money value={r.amount} /></TableCell>
                      <TableCell className="text-right whitespace-nowrap"><Money value={r.approved_amount} /></TableCell>
                      <TableCell><div className="flex flex-col gap-1 items-start"><StatusBadge status={r.status as ExpenseClaimStatus} />{r.item_status !== 'pending' && <ItemStatusBadge status={r.item_status} />}</div></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-[#FBFAF7] font-semibold">
                    <TableCell colSpan={4} className="text-xs uppercase tracking-wide text-[#4A5568]">Total (all {rows.totals.items} filtered lines)</TableCell>
                    <TableCell className="text-right whitespace-nowrap"><Money value={rows.totals.total_claimed} /></TableCell>
                    <TableCell className="text-right whitespace-nowrap"><Money value={rows.totals.total_approved} /></TableCell>
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
