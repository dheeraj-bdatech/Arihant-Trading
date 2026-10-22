'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, FileSpreadsheet, Layers, MapPin, Pencil, Plus, Receipt, Search, Upload } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  FilterMenu,
  InfoCallout,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  PageLoader,
  RecordViews,
  StatCard,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type BoardLane,
  type RecordItem,
  type RecordTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { EXPENSE_CLAIM_STATUSES, EXPENSE_STATUS_LABELS, formatExpenseAmount, formatExpenseDate, type ExpenseClaimStatus, type ExpenseStageBucket } from '@arihant/shared';
import { STATUS_BADGE, errorMessage, fieldErrors, notifyExpensesChanged, saveBlob, type ExpenseClaim, type Paged } from './_lib/expense-lib';
import { DateText, ExpenseViewMenu, Money, PaymentInfo, StatusBadge, useToaster } from './_lib/expense-ui';
import { useUrlFilters } from './_lib/use-url-filters';
import { ClaimFormModal } from './_lib/ClaimFormModal';

const FILTER_KEYS = ['statuses', 'date_from', 'date_to', 'trip_id', 'search'] as const;
const PAGE_SIZE = 20;

// Board columns and card chips use the same colours as the status badge.
const BADGE_TONE: Record<string, RecordTone> = { outline: 'neutral', default: 'neutral', warning: 'warning', info: 'info', cyber: 'info', urgent: 'danger', danger: 'danger', success: 'success' };
const toneOf = (s: ExpenseClaimStatus): RecordTone => BADGE_TONE[STATUS_BADGE[s]] ?? 'neutral';
const LANES: BoardLane[] = EXPENSE_CLAIM_STATUSES.map((s) => ({ key: s, label: EXPENSE_STATUS_LABELS[s], tone: toneOf(s) }));
const tripLabel = (c: ExpenseClaim) => (c.trip_id ? `${(c.trip_date || '').split('-').reverse().join('-')} ${c.trip_location || ''}`.trim() : null);
// Phones: a full-width 40px picker under its label; from sm the compact inline control.
const DATE_INPUT = 'h-10 w-full min-w-0 sm:h-8 sm:w-auto rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none';

function MyExpenses() {
  const router = useRouter();
  const params = useSearchParams();
  const { values, set, clear, activeCount } = useUrlFilters(FILTER_KEYS);
  const [totals, setTotals] = useState<Paged<ExpenseClaim>['totals']>();
  const [error, setError] = useState<string | null>(null);
  const [trips, setTrips] = useState<{ id: string; trip_date: string; base_location: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const { push, Toaster } = useToaster();
  // New / edit claim popup (instead of /expenses/new and /expenses/:id/edit).
  const [claimModal, setClaimModal] = useState<{ claimId?: string; visitId?: string } | null>(null);

  // Legacy deep link from the visit planner: /expenses?visit_id=… → start a claim for that visit.
  useEffect(() => {
    const visitId = params.get('visit_id');
    if (visitId) {
      setClaimModal({ visitId });
      router.replace('/expenses');
    }
  }, [params, router]);

  // Infinite scroll: page 1 also carries the filter totals for the stat cards. The hook swallows fetch
  // errors, so page 1 reports its own here.
  const fetchPage = useCallback(
    async (page: number) => {
      try {
        const res = await api.get<Paged<ExpenseClaim>>('/expense-claims', { mine: true, page_size: PAGE_SIZE, ...values, page });
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
    [values],
  );
  const { rows, total, loading, loadingMore, hasMore, loadMore, refresh } = useInfiniteList<ExpenseClaim>(fetchPage);

  // A claim saved in the pop-up (or anywhere else) re-reads the pages already loaded.
  useEffect(() => {
    window.addEventListener('expenses:changed', refresh);
    return () => window.removeEventListener('expenses:changed', refresh);
  }, [refresh]);

  useEffect(() => {
    api.get('/expense-claims/linkable').then((r: any) => setTrips(r.trips || [])).catch(() => setTrips([]));
  }, []);

  const bucket = (b: ExpenseStageBucket) => totals?.buckets?.[b] ?? { count: 0, amount: 0 };
  const stage1 = bucket('manager').amount + bucket('clarification').amount;

  const statusById = new Map(rows.map((c) => [c.id, c.status]));
  const laneOf = (item: RecordItem) => statusById.get(item.key) ?? 'draft';
  // No `due`: claims keep the server's order (latest first) in cards and board columns.
  const items: RecordItem[] = rows.map((c) => ({
    key: c.id,
    code: c.claim_number,
    title: c.title,
    subtitle: tripLabel(c) ?? `${c.item_count ?? 0} line(s)`,
    status: { label: EXPENSE_STATUS_LABELS[c.status] || c.status, tone: toneOf(c.status) },
    value: formatExpenseAmount(c.total_claimed),
    facts: [
      { label: 'Period', value: c.period_from ? `${formatExpenseDate(c.period_from)} – ${formatExpenseDate(c.period_to)}` : '—' },
      { label: 'Approved', value: c.total_approved == null ? '—' : formatExpenseAmount(c.total_approved) },
      { label: 'Lines', value: c.item_count ?? 0 },
      { label: 'Updated', value: formatExpenseDate(c.updated_at) },
    ],
    extra:
      c.status === 'clarification_required' && c.last_reviewer_comment ? (
        <p className="rounded-lg bg-[#FBEBDD] px-2 py-1.5 text-xs text-[#9A3412]">“{c.last_reviewer_comment}”</p>
      ) : (
        <PaymentInfo claim={c} />
      ),
    primary: c.allowed_actions.includes('edit')
      ? { label: c.status === 'clarification_required' ? 'Respond' : 'Edit claim', icon: <Pencil />, onClick: () => setClaimModal({ claimId: c.id }) }
      : undefined,
    onOpen: () => router.push(`/expenses/${c.id}`),
  }));

  // List view: the table on tablet / desktop, compact rows on phones.
  const list = (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim No</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Trip</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Claimed</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/expenses/${c.id}`)}>
                <TableCell className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</TableCell>
                <TableCell className="max-w-[240px]">
                  <div className="truncate font-medium text-[#14213D]">{c.title}</div>
                  <div className="text-[11px] text-[#4A5568]">{c.item_count ?? 0} line(s)</div>
                </TableCell>
                <TableCell className="text-xs">{tripLabel(c) ?? '—'}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {c.period_from ? <><DateText value={c.period_from} /> – <DateText value={c.period_to} /></> : '—'}
                </TableCell>
                <TableCell className="text-right"><Money value={c.total_claimed} /></TableCell>
                <TableCell className="text-right"><Money value={c.total_approved} /></TableCell>
                <TableCell><StatusBadge status={c.status} /><PaymentInfo claim={c} className="mt-0.5" /></TableCell>
                <TableCell className="text-xs"><DateText value={c.updated_at} /></TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {c.allowed_actions.includes('edit') ? (
                    <Button size="xs" variant="secondary" onClick={() => setClaimModal({ claimId: c.id })}>{c.status === 'clarification_required' ? 'Respond' : 'Edit'}</Button>
                  ) : (
                    <Link href={`/expenses/${c.id}`}><Button size="xs" variant="ghost">View</Button></Link>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden space-y-3">
        {rows.map((c) => (
          <Link
            key={c.id}
            href={`/expenses/${c.id}`}
            onClick={(e) => {
              if (!c.allowed_actions.includes('edit')) return;
              e.preventDefault();
              setClaimModal({ claimId: c.id });
            }}
            className="block"
          >
            <Card className="p-4 space-y-2 active:scale-[0.99] transition-transform">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</div>
                  <div className="font-medium text-[#14213D] truncate">{c.title}</div>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="flex items-end justify-between text-xs text-[#4A5568]">
                <span>{c.period_from ? <><DateText value={c.period_from} /> – <DateText value={c.period_to} /></> : `${c.item_count ?? 0} line(s)`}</span>
                <Money value={c.total_claimed} className="text-sm font-semibold text-[#14213D]" />
              </div>
              <PaymentInfo claim={c} />
              {c.status === 'clarification_required' && c.last_reviewer_comment && (
                <p className="text-xs text-[#9A3412] bg-[#FBEBDD] rounded-lg px-2 py-1.5">“{c.last_reviewer_comment}”</p>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        title="My Expenses"
        icon={<Receipt className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
              <span className="hidden sm:inline">Import Excel</span>
            </Button>
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setClaimModal({})}>
              New Expense Claim
            </Button>
          </div>
        }
      />

      {/* Stage KPIs from the server's buckets: every status sits in exactly one, so the stage amounts always add up to Total claimed. */}
      <StatGrid cols={4} className="gap-3">
        <StatCard label="Total claimed" value={formatShort(totals?.total_claimed)} subtext={`${totals?.count ?? 0} ${totals?.count === 1 ? 'claim' : 'claims'} matching the filters`} variant="primary" icon={<Receipt className="h-5 w-5 text-[#0F5E63]" />} />
        <StatCard label="Stage 1 · Manager" value={formatShort(stage1)} subtext={`${bucket('manager').count + bucket('clarification').count} claims · incl. ${bucket('clarification').count} in clarification`} variant="amber" />
        <StatCard label="Stage 2 · Accounts" value={formatShort(bucket('accounts').amount)} subtext={`${bucket('accounts').count} claims manager-approved`} />
        <StatCard label="Settled (paid)" value={formatShort(bucket('settled').amount)} subtext={`${bucket('settled').count} claims · ${formatShort(totals?.paid_amount)} paid out`} variant="emerald" />
      </StatGrid>
      {totals?.buckets && (bucket('draft').count > 0 || bucket('closed').count > 0) && (
        <p className="-mt-3 text-[11px] text-[#4A5568]">
          Total also includes drafts <span className="font-mono">{formatShort(bucket('draft').amount)}</span> ({bucket('draft').count}) and rejected / withdrawn{' '}
          <span className="font-mono">{formatShort(bucket('closed').amount)}</span> ({bucket('closed').count}).
        </p>
      )}

      {/* One filter row: View (module navigation), search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <ExpenseViewMenu />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              key={values.search}
              type="search"
              aria-label="Search claims"
              placeholder="Search claim no. or title…"
              defaultValue={values.search}
              onKeyDown={(e) => e.key === 'Enter' && set({ search: (e.target as HTMLInputElement).value })}
              onBlur={(e) => e.target.value !== values.search && set({ search: e.target.value })}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Status"
              icon={<Layers />}
              options={[
                { key: 'all', label: 'All statuses' },
                ...EXPENSE_CLAIM_STATUSES.filter((s) => s !== 'manager_approved').map((s) => ({ key: s, label: EXPENSE_STATUS_LABELS[s] })),
              ].map((o) => ({
                ...o,
                urgent: o.key === 'clarification_required',
                active: (values.statuses || 'all') === o.key,
                onSelect: () => set({ statuses: o.key === 'all' ? null : o.key }),
              }))}
            />
            <FilterMenu
              label="Trip"
              icon={<MapPin />}
              className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
              options={[
                { key: 'all', label: 'Any trip' },
                ...trips.map((t) => ({ key: t.id, label: `${t.trip_date.split('-').reverse().join('-')} · ${t.base_location}` })),
              ].map((o) => ({
                ...o,
                active: (values.trip_id || 'all') === o.key,
                onSelect: () => set({ trip_id: o.key === 'all' ? null : o.key }),
              }))}
            />
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
            {activeCount > 0 && (
              <Button variant="ghost" size="xs" onClick={clear} className="text-xs text-[#4A5568] hover:text-[#881337]">
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
            title={activeCount ? 'No claims match these filters' : 'No expense claims yet'}
            description={activeCount ? 'Try widening the date range or clearing filters.' : 'Raise one claim per trip or visit. Add each expense line, attach receipts and submit for approval.'}
            action={
              activeCount ? (
                <Button variant="secondary" onClick={clear}>Clear filters</Button>
              ) : (
                <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setClaimModal({})}>New Expense Claim</Button>
              )
            }
          />
        )
      ) : (
        <RecordViews
          storageKey="expenses-mine"
          defaultView="list"
          title="My claims"
          summary={rows.length < total ? `${rows.length} of ${total} claims` : `${total} ${total === 1 ? 'claim' : 'claims'}`}
          items={items}
          lanes={LANES}
          laneOf={laneOf}
          hideEmptyLanes
          list={list}
          onLoadMore={loadMore}
          hasMore={hasMore}
          loadingMore={loadingMore}
        />
      )}

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

function formatShort(v: number | undefined) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v || 0).replace(/^₹\s?/, '₹');
}

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

export default function MyExpensesPage() {
  return (
    <Suspense fallback={<PageLoader rows={5} />}>
      <MyExpenses />
    </Suspense>
  );
}
