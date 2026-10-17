'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Eye, Inbox, MapPin, Search } from 'lucide-react';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  FilterMenu,
  InfoCallout,
  Modal,
  PageLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, saveBlob, type ExpenseClaim, type Paged } from './expense-lib';
import { ClaimDetail } from './ClaimDetail';
import { DateText, ExpenseViewMenu, Money, PaymentInfo, StatusBadge, useToaster } from './expense-ui';

const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);

const SORT_FIELDS = [
  { key: 'submitted_at', label: 'Submitted date' },
  { key: 'total_claimed', label: 'Amount claimed' },
  { key: 'period_from', label: 'Expense period' },
  { key: 'claim_number', label: 'Claim no.' },
] as const;
type SortField = (typeof SORT_FIELDS)[number]['key'];

/**
 * Approval queue: one filter row (View menu, search, dropdowns), then the table — oldest submission first by
 * default, quick view in a dialog, optional bulk export for Tally.
 */
export const ClaimQueue: React.FC<{
  endpoint: string;
  query?: Record<string, string>;
  emptyTitle: string;
  emptyDescription: string;
  bulkExport?: boolean;
  /** Show a Region dropdown (Accounts sees every region; a manager's queue is just their team). */
  regionFilter?: boolean;
  /** Explains the current queue; rendered just below the filter row. */
  notice?: React.ReactNode;
  /** Page-specific FilterMenus rendered right after the search (e.g. the Accounts stage). */
  extraFilters?: React.ReactNode;
  /** Whether the page-specific filters are off their default, so "Clear" shows and resets them. */
  extraActive?: boolean;
  onClearExtra?: () => void;
}> = ({ endpoint, query, emptyTitle, emptyDescription, bulkExport, regionFilter, notice, extraFilters, extraActive, onClearExtra }) => {
  const router = useRouter();
  const [result, setResult] = useState<Paged<ExpenseClaim> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [regionId, setRegionId] = useState('');
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('submitted_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [quick, setQuick] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);
  const { push, Toaster } = useToaster();

  const filterKey = JSON.stringify({
    ...(query || {}),
    ...(search ? { search } : {}),
    ...(regionId ? { region_ids: regionId } : {}),
    sort_by: sortBy,
    sort_dir: sortDir,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get(endpoint, { ...JSON.parse(filterKey), page, page_size: 20 }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [endpoint, filterKey, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [filterKey]);
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('expenses:changed', onChange);
    return () => window.removeEventListener('expenses:changed', onChange);
  }, [load]);
  useEffect(() => {
    if (!regionFilter) return;
    api
      .get('/masters/regions')
      .then((r: any) => setRegions(r?.data || r || []))
      .catch(() => setRegions([]));
  }, [regionFilter]);

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

  const hasActiveFilters = Boolean(search || regionId || sortBy !== 'submitted_at' || sortDir !== 'asc' || extraActive);
  const clearAll = () => {
    setSearch('');
    setRegionId('');
    setSortBy('submitted_at');
    setSortDir('asc');
    onClearExtra?.();
  };

  const rows = result?.data || [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const filtered = Boolean(search || regionId);

  return (
    <div className="space-y-4">
      {/* One filter row: View (module navigation), search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <ExpenseViewMenu />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              key={search}
              type="search"
              aria-label="Search claims"
              placeholder="Search claim no., title or employee…"
              defaultValue={search}
              onKeyDown={(e) => e.key === 'Enter' && setSearch((e.target as HTMLInputElement).value.trim())}
              onBlur={(e) => e.target.value.trim() !== search && setSearch(e.target.value.trim())}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            {extraFilters}
            {regionFilter && (
              <FilterMenu
                label="Region"
                icon={<MapPin />}
                className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                options={[{ id: 'all', name: 'All regions' }, ...regions].map((r) => ({
                  key: r.id,
                  label: r.name,
                  active: (regionId || 'all') === r.id,
                  onSelect: () => setRegionId(r.id === 'all' ? '' : r.id),
                }))}
              />
            )}
            <FilterMenu
              label="Sort"
              icon={<ArrowDownUp />}
              align="right"
              neutralKeys={[...SORT_FIELDS.map((f) => f.key), 'desc', 'asc']}
              options={[
                ...SORT_FIELDS.map((f) => ({ key: f.key, label: f.label, active: sortBy === f.key, onSelect: () => setSortBy(f.key) })),
                { key: 'desc', label: 'Descending (newest / highest)', active: sortDir === 'desc', onSelect: () => setSortDir('desc') },
                { key: 'asc', label: 'Ascending (oldest / lowest)', active: sortDir === 'asc', onSelect: () => setSortDir('asc') },
              ]}
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="xs" onClick={clearAll} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {notice}
      {error && <InfoCallout variant="danger" title="Could not load the queue">{error}</InfoCallout>}

      {loading && !result ? (
        <PageLoader rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filtered ? 'No claims match these filters' : emptyTitle}
          description={filtered ? 'Try a different search or region.' : emptyDescription}
          action={filtered ? <Button variant="secondary" onClick={clearAll}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <Card className="hidden md:block overflow-hidden p-0">
            {bulkExport && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2">
                <span className="text-xs text-[#4A5568]">
                  <span className="font-mono font-semibold text-[#14213D]">{selected.size}</span> selected · tick claims to export them in the Tally format
                </span>
                <div className="flex items-center gap-2">
                  <Button size="xs" variant="secondary" disabled={!selected.size} isLoading={exporting === 'csv'} onClick={() => exportSelected('csv')}>CSV</Button>
                  <Button size="xs" disabled={!selected.size} isLoading={exporting === 'xlsx'} leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => exportSelected('xlsx')}>Export for Tally</Button>
                </div>
              </div>
            )}
            <Table className="[&_td]:px-3 [&_th]:px-3">
              <TableHeader>
                <TableRow>
                  {bulkExport && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all"
                        checked={allChecked}
                        onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      />
                    </TableHead>
                  )}
                  <TableHead>Claim</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Claimed / approved</TableHead>
                  <TableHead>Status · waiting</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const age = ageDays(c.updated_at);
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/expenses/${c.id}`)}>
                      {bulkExport && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${c.claim_number}`}
                            checked={selected.has(c.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              setSelected(next);
                            }}
                          />
                        </TableCell>
                      )}
                      <TableCell className="max-w-[240px]">
                        <div className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</div>
                        <div className="truncate text-[11px] text-[#4A5568]" title={c.title}>{c.title}</div>
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <div className="truncate text-sm text-[#14213D]" title={c.employee_name || undefined}>{c.employee_name}</div>
                        <div className="truncate text-[11px] text-[#4A5568]" title={c.region_name || undefined}>{c.region_name || ''}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {c.period_from ? (
                          <>
                            <DateText value={c.period_from} />
                            <div className="text-[11px] text-[#4A5568]">to <DateText value={c.period_to} /></div>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Money value={c.total_claimed} className="text-sm text-[#14213D]" />
                        <div className="text-[11px] text-[#4A5568]">appr. <Money value={c.total_approved} /></div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                        {c.status === 'processed' ? (
                          <PaymentInfo claim={c} className="mt-0.5" />
                        ) : (
                          <div className={`mt-0.5 font-mono text-[11px] ${age >= 3 ? 'font-semibold text-[#9A3412]' : 'text-[#4A5568]'}`}>
                            waiting {age === 0 ? 'since today' : `${age}d`}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="ghost" leftIcon={<Eye className="h-3 w-3" />} onClick={() => setQuick(c.id)}>Quick view</Button>
                          <Link href={`/expenses/${c.id}`}><Button size="xs" variant="secondary">Open</Button></Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="md:hidden space-y-3">
            {rows.map((c) => (
              <Link key={c.id} href={`/expenses/${c.id}`} className="block">
                <Card className="p-4 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</div>
                      <div className="text-sm font-medium text-[#14213D] truncate">{c.employee_name}</div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <PaymentInfo claim={c} />
                  <div className="flex justify-between text-xs text-[#4A5568]">
                    <span>{c.status === 'processed' ? '' : `waiting ${ageDays(c.updated_at)}d`}</span>
                    <Money value={c.total_claimed} className="text-sm font-semibold text-[#14213D]" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {result && result.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-[#4A5568]">
              <span>Page {page} of {result.totalPages} · {result.total} claims</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} leftIcon={<ChevronLeft className="h-4 w-4" />}>Prev</Button>
                <Button size="sm" variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)} rightIcon={<ChevronRight className="h-4 w-4" />}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal isOpen={Boolean(quick)} onClose={() => setQuick(null)} title="Quick view" maxWidth="4xl">
        {quick && <ClaimDetail key={quick} claimId={quick} />}
      </Modal>
      <Toaster />
    </div>
  );
};
