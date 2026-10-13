'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Receipt, SlidersHorizontal, Upload, X } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  InfoCallout,
  Input,
  Modal,
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
} from '@/components/ui';
import { api } from '@/lib/api';
import { EXPENSE_CLAIM_STATUSES, EXPENSE_STATUS_LABELS } from '@arihant/shared';
import { errorMessage, fieldErrors, notifyExpensesChanged, saveBlob, type ExpenseClaim, type Paged } from './_lib/expense-lib';
import { DateText, ExpensesNav, Money, StatusBadge, useToaster } from './_lib/expense-ui';
import { useUrlFilters } from './_lib/use-url-filters';

const FILTER_KEYS = ['statuses', 'date_from', 'date_to', 'trip_id', 'search', 'page'] as const;

function MyExpenses() {
  const router = useRouter();
  const params = useSearchParams();
  const { values, set, clear, activeCount } = useUrlFilters(FILTER_KEYS);
  const [result, setResult] = useState<Paged<ExpenseClaim> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trips, setTrips] = useState<{ id: string; trip_date: string; base_location: string }[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { push, Toaster } = useToaster();

  // Legacy deep link from the visit planner: /expenses?visit_id=… → start a claim for that visit.
  useEffect(() => {
    const visitId = params.get('visit_id');
    if (visitId) router.replace(`/expenses/new?visit_id=${visitId}`);
  }, [params, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get<Paged<ExpenseClaim>>('/expense-claims', { mine: true, page_size: 20, ...values }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [values]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/expense-claims/linkable').then((r: any) => setTrips(r.trips || [])).catch(() => setTrips([]));
  }, []);

  const totals = result?.totals;
  const page = Number(values.page || 1);

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
            <Link href="/expenses/new">
              <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>
                New Expense Claim
              </Button>
            </Link>
          </div>
        }
      />
      <ExpensesNav />

      <StatGrid cols={4}>
        <StatCard label="Claims (filtered)" value={String(totals?.count ?? 0)} subtext="Matching the filters below" icon={<Receipt className="h-5 w-5 text-[#0F5E63]" />} />
        <StatCard label="Total claimed" value={formatShort(totals?.total_claimed)} subtext="Sum of claim totals" variant="primary" />
        <StatCard label="Total approved" value={formatShort(totals?.total_approved)} subtext="After manager / Accounts review" variant="emerald" />
        <StatCard label="Needs your action" value={String(result?.data.filter((c) => c.status === 'clarification_required' || c.status === 'draft').length ?? 0)} subtext="Drafts & clarifications on this page" variant="amber" />
      </StatGrid>

      <Button className="md:hidden" variant="secondary" fullWidth leftIcon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setFiltersOpen((o) => !o)}>
        {filtersOpen ? 'Hide filters' : `Filters${activeCount ? ` (${activeCount})` : ''}`}
      </Button>
      <Card className={`p-3.5 overflow-visible ${filtersOpen ? '' : 'hidden md:block'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input label="Search" placeholder="Claim no. or title" defaultValue={values.search} onKeyDown={(e) => e.key === 'Enter' && set({ search: (e.target as HTMLInputElement).value })} onBlur={(e) => e.target.value !== values.search && set({ search: e.target.value })} />
          <Select
            label="Status"
            value={values.statuses}
            onChange={(e) => set({ statuses: e.target.value })}
            options={[{ value: '', label: 'All statuses' }, ...EXPENSE_CLAIM_STATUSES.filter((s) => s !== 'manager_approved').map((s) => ({ value: s, label: EXPENSE_STATUS_LABELS[s] }))]}
          />
          <Input label="Expense date from" type="date" value={values.date_from} onChange={(e) => set({ date_from: e.target.value })} />
          <Input label="Expense date to" type="date" value={values.date_to} min={values.date_from || undefined} onChange={(e) => set({ date_to: e.target.value })} />
          <Select
            label="Trip"
            value={values.trip_id}
            onChange={(e) => set({ trip_id: e.target.value })}
            options={[{ value: '', label: 'Any trip' }, ...trips.map((t) => ({ value: t.id, label: `${t.trip_date.split('-').reverse().join('-')} · ${t.base_location}` }))]}
          />
        </div>
        {activeCount > 0 && (
          <div className="mt-3 flex justify-end">
            <Button size="xs" variant="ghost" leftIcon={<X className="h-3 w-3" />} onClick={clear}>
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {error && <InfoCallout variant="danger" title="Could not load claims">{error}</InfoCallout>}

      {loading && !result ? (
        <PageLoader rows={5} />
      ) : result && result.data.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={activeCount ? 'No claims match these filters' : 'No expense claims yet'}
          description={activeCount ? 'Try widening the date range or clearing filters.' : 'Raise one claim per trip or visit. Add each expense line, attach receipts and submit for approval.'}
          action={
            activeCount ? (
              <Button variant="secondary" onClick={clear}>Clear filters</Button>
            ) : (
              <Link href="/expenses/new"><Button leftIcon={<Plus className="h-4 w-4" />}>New Expense Claim</Button></Link>
            )
          }
        />
      ) : (
        result && (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block overflow-hidden p-0">
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
                  {result.data.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/expenses/${c.id}`)}>
                      <TableCell className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="truncate font-medium text-[#14213D]">{c.title}</div>
                        <div className="text-[11px] text-[#4A5568]">{c.item_count ?? 0} line(s)</div>
                      </TableCell>
                      <TableCell className="text-xs">{c.trip_id ? `${(c.trip_date || '').split('-').reverse().join('-')} ${c.trip_location || ''}` : '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {c.period_from ? <><DateText value={c.period_from} /> – <DateText value={c.period_to} /></> : '—'}
                      </TableCell>
                      <TableCell className="text-right"><Money value={c.total_claimed} /></TableCell>
                      <TableCell className="text-right"><Money value={c.total_approved} /></TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-xs"><DateText value={c.updated_at} /></TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {c.allowed_actions.includes('edit') ? (
                          <Link href={`/expenses/${c.id}/edit`}><Button size="xs" variant="secondary">{c.status === 'clarification_required' ? 'Respond' : 'Edit'}</Button></Link>
                        ) : (
                          <Link href={`/expenses/${c.id}`}><Button size="xs" variant="ghost">View</Button></Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {result.data.map((c) => (
                <Link key={c.id} href={c.allowed_actions.includes('edit') ? `/expenses/${c.id}/edit` : `/expenses/${c.id}`} className="block">
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
                    {c.status === 'clarification_required' && c.last_reviewer_comment && (
                      <p className="text-xs text-[#9A3412] bg-[#FBEBDD] rounded-lg px-2 py-1.5">“{c.last_reviewer_comment}”</p>
                    )}
                  </Card>
                </Link>
              ))}
            </div>

            {result.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-[#4A5568]">
                <span>Page {page} of {result.totalPages} · {result.total} claims</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, { resetPage: false })} leftIcon={<ChevronLeft className="h-4 w-4" />}>Prev</Button>
                  <Button size="sm" variant="secondary" disabled={page >= result.totalPages} onClick={() => set({ page: String(page + 1) }, { resetPage: false })} rightIcon={<ChevronRight className="h-4 w-4" />}>Next</Button>
                </div>
              </div>
            )}
          </>
        )
      )}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          setImportOpen(false);
          notifyExpensesChanged();
          push('success', 'Imported as a draft. Attach receipts and submit when ready.');
          router.push(`/expenses/${id}/edit`);
        }}
      />
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
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} leftIcon={<Upload className="h-4 w-4" />}>
            {file ? file.name : 'Choose .xlsx file'}
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" isLoading={busy}>Import as draft</Button>
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
