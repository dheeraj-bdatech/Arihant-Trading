'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Eye, Inbox } from 'lucide-react';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
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
import { DateText, Money, StatusBadge, useToaster } from './expense-ui';

const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);

/** Approval queue table: oldest first by default, quick view in a dialog, optional bulk export. */
export const ClaimQueue: React.FC<{
  endpoint: string;
  query?: Record<string, string>;
  emptyTitle: string;
  emptyDescription: string;
  bulkExport?: boolean;
}> = ({ endpoint, query, emptyTitle, emptyDescription, bulkExport }) => {
  const [result, setResult] = useState<Paged<ExpenseClaim> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [oldestFirst, setOldestFirst] = useState(true);
  const [quick, setQuick] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);
  const { push, Toaster } = useToaster();
  const queryKey = JSON.stringify(query || {});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get(endpoint, { ...JSON.parse(queryKey), page, page_size: 20, sort_by: 'submitted_at', sort_dir: oldestFirst ? 'asc' : 'desc' }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [endpoint, queryKey, page, oldestFirst]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [queryKey]);
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('expenses:changed', onChange);
    return () => window.removeEventListener('expenses:changed', onChange);
  }, [load]);

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

  const rows = result?.data || [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" leftIcon={<ArrowDownUp className="h-4 w-4" />} onClick={() => setOldestFirst((v) => !v)}>
          {oldestFirst ? 'Oldest first' : 'Newest first'}
        </Button>
        {bulkExport && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#4A5568]">{selected.size} selected</span>
            <Button size="sm" variant="secondary" disabled={!selected.size} isLoading={exporting === 'csv'} onClick={() => exportSelected('csv')}>CSV</Button>
            <Button size="sm" disabled={!selected.size} isLoading={exporting === 'xlsx'} leftIcon={<Download className="h-4 w-4" />} onClick={() => exportSelected('xlsx')}>Export for Tally</Button>
          </div>
        )}
      </div>

      {error && <InfoCallout variant="danger" title="Could not load the queue">{error}</InfoCallout>}

      {loading && !result ? (
        <PageLoader rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <Card className="hidden md:block p-0 overflow-x-auto">
            <Table>
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
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const age = ageDays(c.updated_at);
                  return (
                    <TableRow key={c.id}>
                      {bulkExport && (
                        <TableCell>
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
                      <TableCell>
                        <div className="font-mono text-xs font-semibold text-[#0F5E63]">{c.claim_number}</div>
                        <div className="text-xs text-[#14213D] max-w-[220px] truncate">{c.title}</div>
                      </TableCell>
                      <TableCell className="text-sm">{c.employee_name}<div className="text-[11px] text-[#4A5568]">{c.region_name || ''}</div></TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{c.period_from ? <><DateText value={c.period_from} /> – <DateText value={c.period_to} /></> : '—'}</TableCell>
                      <TableCell className="text-right"><Money value={c.total_claimed} /></TableCell>
                      <TableCell className="text-right"><Money value={c.total_approved} /></TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell>
                        <span className={`font-mono text-xs ${age >= 3 ? 'text-[#9A3412] font-semibold' : 'text-[#4A5568]'}`}>{age === 0 ? 'today' : `${age}d`}</span>
                      </TableCell>
                      <TableCell className="text-right">
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
                  <div className="flex justify-between text-xs text-[#4A5568]">
                    <span>waiting {ageDays(c.updated_at)}d</span>
                    <Money value={c.total_claimed} className="text-sm font-semibold text-[#14213D]" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {result && result.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-[#4A5568]">
              <span>Page {page} of {result.totalPages}</span>
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
