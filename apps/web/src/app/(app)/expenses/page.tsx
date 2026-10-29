'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  ChevronRight,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  Layers,
  List,
  MapPin,
  Plus,
  Receipt,
  Search,
  Upload,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FilterMenu,
  InfoCallout,
  Input,
  Modal,
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
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { useOpenParam } from '@/lib/use-open-param';
import type { ExpenseStageBucket } from '@arihant/shared';
import { MANAGEMENT_ROLES, errorMessage, fieldErrors, notifyExpensesChanged, saveBlob, useBadgeCounts, type ExpenseClaim, type Paged } from './_lib/expense-lib';
import { AnomalyChips, DateText, Money, PaymentInfo, StatusBadge, useToaster } from './_lib/expense-ui';
import { useUrlFilters } from './_lib/use-url-filters';
import { ClaimFormModal } from './_lib/ClaimFormModal';
import { ClaimDetail } from './_lib/ClaimDetail';

/**
 * Expenses (§35–37): one list. Management / admin see every member's claims; everyone else sees the claims that
 * concern them — their own, the ones waiting on them (Stage-1 approval, or Accounts at Stage 2) and the ones they
 * have already acted on. A click on any claim opens it in a popup with its lines, receipts, history and the actions
 * this user may take (approve, pay, edit, respond…).
 */
const FILTER_KEYS = ['stage', 'date_from', 'date_to', 'region_ids', 'search'] as const;
// The status filter in plain stages (the same groups as the KPI cards) instead of every workflow state
const STAGES: { key: string; label: string; statuses: string[] }[] = [
  { key: 'draft', label: 'Draft', statuses: ['draft'] },
  { key: 'approval', label: 'Awaiting approval', statuses: ['submitted', 'clarification_required'] },
  { key: 'accounts', label: 'With Accounts', statuses: ['manager_approved', 'accounts_review', 'accounts_approved'] },
  { key: 'paid', label: 'Paid', statuses: ['processed'] },
  { key: 'closed', label: 'Rejected / withdrawn', statuses: ['rejected', 'withdrawn'] },
];
// Actions that mean the claim is waiting on this user
const REVIEW_ACTIONS = ['manager_approve', 'accounts_approve', 'process'];
const PAGE_SIZE = 20;

const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);
const tripLabel = (c: ExpenseClaim) => (c.trip_id ? `${(c.trip_date || '').split('-').reverse().join('-')} ${c.trip_location || ''}`.trim() : null);
const initials = (name?: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
// Phones: a full-width 40px picker under its label; from sm the compact inline control.
const DATE_INPUT = 'h-10 w-full min-w-0 sm:h-8 sm:w-auto rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none';

function ExpensesHub() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const role = user?.role || '';
  const counts = useBadgeCounts(Boolean(user));
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const [totals, setTotals] = useState<Paged<ExpenseClaim>['totals']>();
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);
  const { push, Toaster } = useToaster();
  // The claim open in the popup, and the new / edit claim form
  const [openId, setOpenId] = useState<string | null>(null);
  // List or Cards, remembered in this browser
  const [layout, setLayout] = useState<'list' | 'cards'>('list');
  useEffect(() => {
    try {
      if (localStorage.getItem('expenses-layout') === 'cards') setLayout('cards');
    } catch {
      /* storage blocked: default to the list */
    }
  }, []);
  const chooseLayout = (l: 'list' | 'cards') => {
    setLayout(l);
    try {
      localStorage.setItem('expenses-layout', l);
    } catch {
      /* private mode: keep it for this visit only */
    }
  };
  const [claimModal, setClaimModal] = useState<{ claimId?: string; visitId?: string } | null>(null);

  // Field staff only ever see their own claims: their list needs no employee column; only management lists every
  // member's claims, so only they get the region filter
  const isManagement = MANAGEMENT_ROLES.includes(role);
  const mine = !(isManagement || ['regional_manager', 'accounts'].includes(role) || Boolean(counts?.has_team));
  // Tally export: Accounts ticks verified claims once the list is filtered to "With Accounts"
  const bulkExport = (role === 'accounts' || isManagement) && values.stage === 'accounts';
  const yourAction = (c: ExpenseClaim) =>
    c.allowed_actions.some((a) => REVIEW_ACTIONS.includes(a)) || (c.status === 'clarification_required' && c.allowed_actions.includes('edit'));

  // Legacy deep link from the visit planner: /expenses?visit_id=… → start a claim for that visit.
  useEffect(() => {
    const visitId = params.get('visit_id');
    if (visitId) {
      setClaimModal({ visitId });
      router.replace('/expenses');
    }
  }, [params, router]);
  // /expenses?open=<id> (old /expenses/:id links, notifications) opens that claim in the popup
  useOpenParam(setOpenId);

  useEffect(() => {
    if (!isManagement || regions.length) return;
    api
      .get('/masters/regions')
      .then((r: any) => setRegions(r?.data || r || []))
      .catch(() => setRegions([]));
  }, [isManagement, regions.length]);

  // The claims that concern this user (every member's for management / admin), with the filters
  const request = useMemo(() => {
    const { stage, ...filters } = values;
    return { ...filters, statuses: STAGES.find((s) => s.key === stage)?.statuses.join(','), relevant_only: true };
  }, [values]);

  // Infinite scroll: page 1 also carries the filter totals for the stat cards. The hook swallows fetch
  // errors, so page 1 reports its own here.
  const fetchPage = useCallback(
    async (page: number) => {
      try {
        const res = await api.get<Paged<ExpenseClaim>>('/expense-claims', { ...request, page_size: PAGE_SIZE, page });
        if (page === 1) {
          setTotals(res.totals);
          setError(null);
        }
        return res;
      } catch (e) {
        if (page === 1) setError(errorMessage(e));
        throw e;
      }
    },
    [request],
  );
  const { rows, total, loading, loadingMore, hasMore, loadMore, refresh } = useInfiniteList<ExpenseClaim>(fetchPage);
  useEffect(() => setSelected(new Set()), [request]);

  // A claim changed in the popup (or anywhere else) re-reads the pages already loaded.
  useEffect(() => {
    window.addEventListener('expenses:changed', refresh);
    return () => window.removeEventListener('expenses:changed', refresh);
  }, [refresh]);

  // Read the next page when the end of the list scrolls into view
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, rows.length]);

  const exportSelected = async (format: 'xlsx' | 'csv') => {
    if (!selected.size) return;
    setExporting(format);
    try {
      const { blob, fileName } = await api.blob('/expense-reports/export', { format, approved_only: true, claim_ids: Array.from(selected) });
      saveBlob(blob, fileName || `expenses.${format}`);
      push('success', `Exported ${selected.size} claim(s) for Tally.`);
    } catch (e) {
      push('error', errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  const bucket = (b: ExpenseStageBucket) => totals?.buckets?.[b] ?? { count: 0, amount: 0 };
  const stage1 = bucket('manager').amount + bucket('clarification').amount;
  const narrowed = FILTER_KEYS.some((k) => values[k]);
  const clearFilters = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // What the status column says under the badge
  const statusNote = (c: ExpenseClaim) => {
    if (c.status === 'processed') return <PaymentInfo claim={c} className="mt-0.5" />;
    if (c.status === 'clarification_required' && c.last_reviewer_comment)
      return <p className="mt-1 line-clamp-2 text-[11px] text-[#9A3412]">“{c.last_reviewer_comment}”</p>;
    if (c.status === 'rejected' && c.last_reviewer_comment)
      return <p className="mt-1 line-clamp-2 text-[11px] text-[#881337]">“{c.last_reviewer_comment}”</p>;
    if (['rejected', 'withdrawn', 'draft'].includes(c.status))
      return <div className="mt-0.5 text-[11px] text-[#6B7280]">Updated <DateText value={c.updated_at} /></div>;
    const age = ageDays(c.updated_at);
    return (
      <div className={`mt-0.5 font-mono text-[11px] ${age >= 3 ? 'font-semibold text-[#9A3412]' : 'text-[#4A5568]'}`}>
        waiting {age === 0 ? 'since today' : `${age}d`}
      </div>
    );
  };
  const actionChip = (c: ExpenseClaim) =>
    yourAction(c) && (
      <Badge variant="urgent" size="sm" className="whitespace-nowrap">
        Your action
      </Badge>
    );
  const visitLabel = (c: ExpenseClaim) =>
    c.visit_id ? (
      <>
        <DateText value={c.visit_date} /> {c.visit_organisation_name}
      </>
    ) : null;
  const linesLabel = (c: ExpenseClaim) => `${c.item_count ?? 0} line${c.item_count === 1 ? '' : 's'}`;
  const approvedShare = (c: ExpenseClaim) =>
    c.total_approved != null && c.total_claimed > 0 && c.total_approved !== c.total_claimed
      ? `${Math.round((c.total_approved / c.total_claimed) * 100)}% of claimed`
      : null;
  const selectBox = (c: ExpenseClaim) => (
    <Checkbox aria-label={`Select ${c.claim_number}`} checked={selected.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
  );
  const bulkBar = bulkExport && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2">
      <label className="flex items-center gap-2 text-xs text-[#4A5568]">
        <Checkbox aria-label="Select all" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
        <span>
          <span className="font-mono font-semibold text-[#14213D]">{selected.size}</span> selected · tick claims to export them in the Tally format
        </span>
      </label>
      <div className="flex items-center gap-2">
        <Button size="xs" variant="secondary" disabled={!selected.size} isLoading={exporting === 'csv'} onClick={() => exportSelected('csv')}>CSV</Button>
        <Button size="xs" disabled={!selected.size} isLoading={exporting === 'xlsx'} leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => exportSelected('xlsx')}>
          Export for Tally
        </Button>
      </div>
    </div>
  );
  const sub = 'text-[11px] text-[#4A5568]';

  // List: every field of the claim in one row (the table scrolls sideways when the screen is narrow)
  const table = (
    <Card className="overflow-hidden p-0">
      <Table className="[&_td]:px-3 [&_td]:align-top [&_th]:px-3 [&_th]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            {bulkExport && <TableHead className="w-10" aria-label="Select" />}
            <TableHead>Claim</TableHead>
            {!mine && <TableHead>Employee</TableHead>}
            <TableHead>Trip / visit</TableHead>
            <TableHead>Expenses</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Claimed</TableHead>
            <TableHead className="text-right">Approved</TableHead>
            <TableHead>Approver</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} onOpen={() => setOpenId(c.id)} openLabel={`Open ${c.claim_number}`}>
              {bulkExport && <TableCell>{selectBox(c)}</TableCell>}
              <TableCell className="min-w-[200px] max-w-[280px]">
                <div className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</div>
                <div className="truncate text-sm font-medium text-[#14213D]" title={c.title}>{c.title}</div>
                {c.remarks && <div className={`truncate italic ${sub}`} title={c.remarks}>“{c.remarks}”</div>}
                <AnomalyChips futureDated={c.future_dated_lines} receiptMissing={c.receipt_missing_lines} className="mt-1" />
              </TableCell>
              {!mine && (
                <TableCell className="min-w-[170px]">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] text-[10px] font-bold text-[#0F5E63]">{initials(c.employee_name)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-[#14213D]">{c.employee_name}</div>
                      <div className={`truncate ${sub}`}>{[c.employee_code, c.region_name].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                  </div>
                </TableCell>
              )}
              <TableCell className="min-w-[150px] max-w-[220px] text-xs">
                {tripLabel(c) || c.visit_id ? (
                  <>
                    {tripLabel(c) && <div className="truncate text-[#14213D]">{tripLabel(c)}</div>}
                    {c.visit_id && <div className={`truncate ${sub}`}>Visit: {visitLabel(c)}</div>}
                  </>
                ) : (
                  <span className="text-[#6B7280]">—</span>
                )}
              </TableCell>
              <TableCell className="min-w-[140px] max-w-[200px] text-xs">
                <div className="font-medium text-[#14213D]">{linesLabel(c)}</div>
                {c.categories && <div className={`truncate ${sub}`} title={c.categories}>{c.categories}</div>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {c.period_from ? (
                  <>
                    <DateText value={c.period_from} />
                    <div className={sub}>to <DateText value={c.period_to} /></div>
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <Money value={c.total_claimed} className="text-sm font-semibold text-[#14213D]" />
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <Money value={c.total_approved} className="text-sm font-semibold text-[#0F5E63]" />
                {approvedShare(c) && <div className={sub}>{approvedShare(c)}</div>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {c.manager_name || '—'}
                {c.manager_active === false && <div className="text-[11px] font-semibold text-[#9A3412]">inactive</div>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">{c.submitted_at ? <DateText value={c.submitted_at} /> : <span className="text-[#6B7280]">Not yet</span>}</TableCell>
              <TableCell className="min-w-[150px] max-w-[220px]">
                <div className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={c.status} />
                  {actionChip(c)}
                </div>
                {statusNote(c)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );

  // Cards: the same fields as a card per claim
  const fact = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</dt>
      <dd className="truncate text-xs text-[#14213D]">{value || '—'}</dd>
    </div>
  );
  const cards = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {rows.map((c) => (
        <article
          key={c.id}
          role="button"
          tabIndex={0}
          aria-label={`Open ${c.claim_number}`}
          onClick={(e) => !(e.target as HTMLElement).closest('input, label, button, a') && setOpenId(c.id)}
          onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && setOpenId(c.id)}
          className="group flex cursor-pointer flex-col gap-3 rounded-[14px] border border-[#DCD8CE] bg-white p-4 shadow-2xs transition-colors hover:border-[#0F5E63] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30 active:scale-[0.995]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {bulkExport && selectBox(c)}
              <span className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {actionChip(c)}
              <StatusBadge status={c.status} />
            </div>
          </div>

          <div className="min-w-0 space-y-0.5">
            <h3 className="line-clamp-2 font-serif text-base font-semibold leading-snug text-[#14213D]">{c.title}</h3>
            {c.remarks && <p className="line-clamp-2 text-xs italic text-[#4A5568]">“{c.remarks}”</p>}
          </div>

          {!mine && (
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] text-[11px] font-bold text-[#0F5E63]">{initials(c.employee_name)}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[#14213D]">{c.employee_name}</div>
                <div className={`truncate ${sub}`}>{[c.employee_code, c.region_name].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 divide-x divide-[#ECE9E2] rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7]">
            <div className="min-w-0 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]">Claimed</div>
              <Money value={c.total_claimed} className="text-base font-semibold text-[#14213D]" />
            </div>
            <div className="min-w-0 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]">Approved</div>
              <Money value={c.total_approved} className="text-base font-semibold text-[#0F5E63]" />
              {approvedShare(c) && <div className="text-[10px] text-[#4A5568]">{approvedShare(c)}</div>}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {fact('Period', c.period_from ? <><DateText value={c.period_from} /> – <DateText value={c.period_to} /></> : null)}
            {fact('Expenses', [linesLabel(c), c.categories].filter(Boolean).join(' · '))}
            {fact('Trip', tripLabel(c))}
            {fact('Visit', visitLabel(c))}
            {fact('Approver', c.manager_name ? `${c.manager_name}${c.manager_active === false ? ' (inactive)' : ''}` : null)}
            {fact('Submitted', c.submitted_at ? <DateText value={c.submitted_at} /> : 'Not yet')}
          </dl>

          <AnomalyChips futureDated={c.future_dated_lines} receiptMissing={c.receipt_missing_lines} />

          <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#ECE9E2] pt-2.5">
            <div className="min-w-0 flex-1">{statusNote(c)}</div>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#C9C4B8] transition-colors group-hover:text-[#0F5E63]" aria-hidden />
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Expenses"
        icon={<Receipt className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
              <span className="hidden sm:inline">Import Excel</span>
            </Button>
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setClaimModal({})}>
              New claim
            </Button>
          </div>
        }
      />

      {/* KPIs from the server's buckets: every status sits in exactly one, so the claimed amounts add up to Total claimed. */}
      <StatGrid cols={4} className="gap-3">
        <StatCard label="Total Claimed" value={formatShort(totals?.total_claimed)} subtext={claimsText(totals?.count ?? 0)} variant="primary" icon={<Receipt className="h-5 w-5 text-[#0F5E63]" />} />
        <StatCard
          label="Awaiting Approval"
          value={formatShort(stage1)}
          subtext={`${claimsText(bucket('manager').count + bucket('clarification').count)}${bucket('clarification').count ? ` · ${bucket('clarification').count} sent back` : ''}`}
          variant="amber"
        />
        {/* Approved amounts, not claimed: a ₹4,700 claim approved at ₹2,500 is paid ₹2,500 (QA BUG-007). */}
        <StatCard label="With Accounts" value={formatShort(bucket('accounts').approved_amount ?? bucket('accounts').amount)} subtext={`${claimsText(bucket('accounts').count)} approved by manager`} />
        <StatCard label="Paid" value={formatShort(bucket('settled').approved_amount ?? bucket('settled').amount)} subtext={`${claimsText(bucket('settled').count)} settled`} variant="emerald" />
      </StatGrid>

      {/* One filter row: search, status, region (for people who see others' claims) and dates. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              key={values.search}
              type="search"
              aria-label="Search claims"
              placeholder={mine ? 'Search claim no. or title…' : 'Search claim no., title or employee…'}
              defaultValue={values.search}
              onKeyDown={(e) => e.key === 'Enter' && set({ search: (e.target as HTMLInputElement).value.trim() })}
              onBlur={(e) => e.target.value.trim() !== values.search && set({ search: e.target.value.trim() })}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu
              label="Status"
              icon={<Layers />}
              options={[{ key: 'all', label: 'All claims' }, ...STAGES].map((o) => ({
                key: o.key,
                label: o.label,
                active: (values.stage || 'all') === o.key,
                onSelect: () => set({ stage: o.key === 'all' ? null : o.key }),
              }))}
            />
            {isManagement && (
              <FilterMenu
                label="Region"
                icon={<MapPin />}
                className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                options={[{ id: 'all', name: 'All regions' }, ...regions].map((r) => ({
                  key: r.id,
                  label: r.name,
                  active: (values.region_ids || 'all') === r.id,
                  onSelect: () => set({ region_ids: r.id === 'all' ? null : r.id }),
                }))}
              />
            )}
            <button
              type="button"
              onClick={() => setDatesOpen((o) => !o)}
              aria-expanded={datesOpen}
              className={`filter-menu-btn ${datesOpen || values.date_from || values.date_to ? 'filter-menu-btn--on' : ''}`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Dates</span>
              {(values.date_from || values.date_to) && <span className="filter-menu-chip">On</span>}
            </button>
            {narrowed && (
              <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Phones: heading, then From / To as two equal columns (labels above the pickers); from sm one row. */}
        {datesOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-[#ECE9E2] pt-2.5 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <span className="col-span-2 font-semibold text-[#4A5568]">Expense date</span>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              From
              <input type="date" value={values.date_from} onChange={(e) => set({ date_from: e.target.value })} className={DATE_INPUT} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              To
              <input type="date" value={values.date_to} min={values.date_from || undefined} onChange={(e) => set({ date_to: e.target.value })} className={DATE_INPUT} />
            </label>
            {(values.date_from || values.date_to) && (
              <Button variant="ghost" size="xs" onClick={() => set({ date_from: null, date_to: null })} className="col-span-2 justify-self-start text-xs text-[#4A5568] hover:text-[#881337]">
                Reset dates
              </Button>
            )}
          </div>
        )}
      </Card>

      {error && <InfoCallout variant="danger" title="Could not load claims">{error}</InfoCallout>}

      {loading && rows.length === 0 && !error ? (
        <PageLoader rows={5} />
      ) : rows.length === 0 ? (
        !error && (
          <EmptyState
            icon={Receipt}
            title={narrowed ? 'No claims match these filters' : 'No expense claims yet'}
            description={narrowed ? 'Try widening the date range or clearing filters.' : 'Raise one claim per trip or visit. Add each expense line, attach receipts and submit for approval.'}
            action={
              narrowed ? (
                <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
              ) : (
                <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setClaimModal({})}>New claim</Button>
              )
            }
          />
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-xs text-[#4A5568]">
              {rows.length < total ? `${rows.length} of ${total} claims` : `${total} ${total === 1 ? 'claim' : 'claims'}`} · click a claim to open it
            </span>
            {/* phones always get the cards */}
            <div role="radiogroup" aria-label="Layout" className="hidden rounded-[10px] border border-[#C9C4B8] bg-white p-0.5 md:inline-flex">
              {(
                [
                  { key: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
                  { key: 'cards', label: 'Cards', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={layout === o.key}
                  onClick={() => chooseLayout(o.key)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors ${
                    layout === o.key ? 'bg-[#0F5E63] text-white' : 'text-[#4A5568] hover:text-[#14213D]'
                  }`}
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {bulkBar}
          {layout === 'list' && <div className="hidden md:block">{table}</div>}
          <div className={layout === 'list' ? 'md:hidden' : ''}>{cards}</div>
          <div ref={sentinel} />
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" isLoading={loadingMore} onClick={loadMore}>Load more</Button>
            </div>
          )}
        </div>
      )}

      {/* The claim: everything about it and what this user can do with it */}
      <Modal isOpen={Boolean(openId)} onClose={() => setOpenId(null)} title="Expense claim" maxWidth="4xl">
        {openId && <ClaimDetail key={openId} claimId={openId} inModal />}
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          setImportOpen(false);
          notifyExpensesChanged();
          push('success', 'Imported as a draft. Attach receipts and submit when ready.');
          setClaimModal({ claimId: id });
        }}
      />
      {claimModal && (
        <ClaimFormModal
          isOpen
          claimId={claimModal.claimId}
          initialVisitId={claimModal.visitId}
          onClose={() => setClaimModal(null)}
          onDone={(m) => push('success', m)}
        />
      )}
      <Toaster />
    </PageContainer>
  );
}

// KPI figures in whole rupees so lakh amounts fit the card; the list and the claim keep the paise
function formatShort(v: number | undefined) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0).replace(/^₹\s?/, '₹');
}
const claimsText = (n: number) => `${n} ${n === 1 ? 'claim' : 'claims'}`;

const ImportModal: React.FC<{ open: boolean; onClose: () => void; onImported: (id: string) => void }> = ({ open, onClose, onImported }) => {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; message: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setFile(null);
      setErrors({});
      setRowErrors([]);
      setMessage(null);
    }
  }, [open]);

  const downloadTemplate = async () => {
    try {
      const { blob } = await api.blob('/expense-claims/import/template');
      saveBlob(blob, 'arihant-expense-template.xlsx');
    } catch (e) {
      setMessage(errorMessage(e));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Give the claim a title.';
    if (!file) errs.file = 'Choose the filled-in template.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setRowErrors([]);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('title', title.trim());
      form.append('file', file!);
      const claim = await api.upload<ExpenseClaim>('/expense-claims/import', form);
      onImported(claim.id);
    } catch (err: any) {
      setErrors(fieldErrors(err));
      setRowErrors(err?.data?.row_errors || []);
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Import expenses from Excel" description="Use the standard template. The import creates a draft — nothing is submitted automatically." maxWidth="lg">
      <form onSubmit={submit} className="space-y-4">
        <Button type="button" variant="secondary" size="sm" leftIcon={<FileSpreadsheet className="h-4 w-4" />} onClick={downloadTemplate}>
          Download standard template
        </Button>
        <Input label="Claim title *" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Lucknow trip, 3–5 Oct" error={errors.title} />
        <div>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {/* full width on phones; a long file name truncates instead of overflowing the button */}
          <Button type="button" variant="outline" className="w-full max-w-full sm:w-auto" onClick={() => inputRef.current?.click()} leftIcon={<Upload className="h-4 w-4" />}>
            <span className="min-w-0 truncate">{file ? file.name : 'Choose .xlsx file'}</span>
          </Button>
          {errors.file && <p className="text-xs text-[#881337] mt-1">{errors.file}</p>}
        </div>
        {message && !rowErrors.length && !Object.keys(errors).length && <InfoCallout variant="danger">{message}</InfoCallout>}
        {rowErrors.length > 0 && (
          <InfoCallout variant="danger" title={message || 'Some rows have problems'}>
            <ul className="max-h-48 overflow-y-auto text-xs space-y-1 mt-1">
              {rowErrors.map((r, i) => (
                <li key={i}><span className="font-mono font-semibold">Row {r.row}</span> · {r.field}: {r.message}</li>
              ))}
            </ul>
          </InfoCallout>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" className="w-full sm:w-auto" isLoading={busy}>Import as draft</Button>
        </div>
      </form>
    </Modal>
  );
};

export default function ExpensesPage() {
  return (
    <Suspense fallback={<PageLoader rows={5} />}>
      <ExpensesHub />
    </Suspense>
  );
}
