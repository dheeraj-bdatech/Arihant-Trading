'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Search, Layers, User as UserIcon, ChevronDown, ChevronRight, ExternalLink, Download } from 'lucide-react';
import {
  PageContainer,
  PageHeader,
  Card,
  FilterMenu,
  Button,
  InfoCallout,
  EmptyState,
  Badge,
  PageLoader,
  SectionHeader,
  BarList,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { roleLabel } from '@/lib/role-label';
import { formatINR, TENDER_STATUS_LABELS, PROPOSAL_STATUS_LABELS } from '@arihant/shared';

/**
 * Audit Logs (Blueprint §47 / PRD "important changes should be logged"): only the important changes — deadline
 * changed, tender approved / rejected, visit cancelled, lead reassigned, equipment availability changed, proposal
 * status changed, service ticket reassigned, expense approved / rejected — each with the user, the action, the
 * previous and the new value, and the date / time. The kinds are defined once in the API (IMPORTANT_KINDS); three
 * charts above the trail (by type, per day, by person) follow the same filters.
 */

const PAGE_SIZE = 50;

/** The PRD's important changes, in the PRD's order (keys = IMPORTANT_KINDS in audit.service.ts). */
const KINDS: { key: string; label: string }[] = [
  { key: 'deadline_changed', label: 'Deadline changed' },
  { key: 'tender_decision', label: 'Tender approved / rejected' },
  { key: 'visit_cancelled', label: 'Visit cancelled' },
  { key: 'lead_reassigned', label: 'Lead reassigned' },
  { key: 'equipment_availability', label: 'Equipment availability changed' },
  { key: 'proposal_status', label: 'Proposal status changed' },
  { key: 'ticket_reassigned', label: 'Service ticket reassigned' },
  { key: 'expense_decision', label: 'Expense approved / rejected' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label || 'Change';

const MODULE_OF: Record<string, string> = {
  tender: 'Tender',
  proposal: 'Proposal',
  lead: 'Lead',
  visit: 'Visit',
  demo_equipment: 'Demo equipment',
  service_ticket: 'Service ticket',
  expense: 'Expense',
  expense_claim: 'Expense claim',
  task: 'Task',
};

/** Records that open from a link (pages that support ?open=<id>). */
const RECORD_LINK: Record<string, string> = {
  proposal: '/proposals',
  lead: '/leads',
  visit: '/visits',
  service_ticket: '/service',
  expense_claim: '/expenses',
};

const humanize = (code: string) => {
  const words = String(code || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What happened, in words: the kind, made specific where the action code says more (approved vs rejected …). */
function actionOf(log: any): string {
  const a = String(log.action || '');
  switch (log.kind) {
    case 'tender_decision':
      return /reject/i.test(a) ? 'Tender rejected' : 'Tender approved';
    case 'expense_decision':
      return /reject/i.test(a) ? 'Expense rejected' : 'Expense approved';
    case 'proposal_status':
      if (/approv/i.test(a)) return 'Proposal approved';
      if (/reject/i.test(a)) return 'Proposal rejected';
      if (/lost/i.test(a)) return 'Proposal lost';
      if (/sent/i.test(a)) return 'Proposal sent';
      return 'Proposal status changed';
    default:
      return kindLabel(log.kind);
  }
}

/** Bookkeeping fields that never mean anything to a reader of the trail. */
const HIDDEN_KEYS = new Set([
  'id', 'created_at', 'updated_at', 'last_activity_at', 'updated_by', 'created_by', 'version', 'row_version',
  'actorId', '_actorId', 'actor_id', 'tenderId', 'tenderNo', 'proposalId', 'proposalNo', 'orgName', 'decisionEvent',
  'tenderOwnerId', 'aggregate_sequence', 'eventId', 'tender_id', 'proposal_id', 'organisation_id', 'demo_id',
  'approverId', 'approvedById', 'assignedPersonId', 'estimatedValue', 'is_deleted', 'deleted_at', 'deleted_by', 'search_vector',
]);
/** The fields a change is about come first; notes and reasons follow. */
const PRIMARY = ['status', 'decision', 'assigned_to', 'submission_deadline', 'deadline', 'availability_status', 'reserved_until'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?(Z|\+00:?00)?)?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MONEY_KEY_RE = /(amount|value|price|fee|total|emd|pbg|threshold)/i;

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

type Change = { field: string; before: unknown; after: unknown };

/** Field-level changes of an audit row, whatever shape the module wrote it in. */
function changesOf(log: any): Change[] {
  let prev = log.previous_value && typeof log.previous_value === 'object' ? { ...log.previous_value } : null;
  let next = log.new_value && typeof log.new_value === 'object' ? { ...log.new_value } : null;
  // Proposal consumer rows: { changes: { before, after } }
  if (next?.changes?.after && typeof next.changes.after === 'object') {
    prev = next.changes.before || prev;
    next = { ...next.changes.after };
  }
  // Lifecycle events carry the move as fromStatus / toStatus inside the new value.
  if (next && 'toStatus' in next) {
    next.status = next.toStatus;
    delete next.toStatus;
  }
  if (next && 'fromStatus' in next) {
    if (next.fromStatus != null && !(prev && 'status' in prev)) prev = { ...(prev || {}), status: next.fromStatus };
    delete next.fromStatus;
  }
  // An approval decision stored without a "before" was, by definition, waiting for that decision.
  if (!prev && next && /approv|reject/i.test(log.action) && !/request/i.test(log.action)) {
    prev = { decision: 'awaiting_decision' };
    if (!('decision' in next) && !('status' in next)) next.decision = /reject/i.test(log.action) ? 'rejected' : 'approved';
  }
  if (!next && !prev) return [];
  const visible = (k: string) => !HIDDEN_KEYS.has(k);
  const rank = (k: string) => (PRIMARY.includes(k) ? PRIMARY.indexOf(k) : PRIMARY.length);
  let changes: Change[];
  if (prev && next) {
    const keys = Array.from(new Set([...Object.keys(next), ...Object.keys(prev)])).filter(visible);
    changes = keys
      .filter((k) => k in next! && JSON.stringify(prev![k] ?? null) !== JSON.stringify(next![k] ?? null))
      .map((k) => ({ field: k, before: prev![k], after: next![k] }));
  } else {
    const snap = (next || prev)!;
    changes = Object.keys(snap)
      .filter((k) => visible(k) && snap[k] !== null && snap[k] !== '' && typeof snap[k] !== 'object')
      .map((k) => ({ field: k, before: next ? undefined : snap[k], after: next ? snap[k] : undefined }));
  }
  return changes.sort((a, b) => rank(a.field) - rank(b.field));
}

/** Last 30 IST days, or the picked range (at most 92 days, the most a strip of columns can show). */
function daysOf(from: string, to: string): string[] {
  const end = to || istToday();
  let start = from || addIsoDays(end, -29);
  if (addIsoDays(start, 91) < end) start = addIsoDays(end, -91);
  const out: string[] = [];
  for (let d = start; d <= end; d = addIsoDays(d, 1)) out.push(d);
  return out;
}
const shortDay = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });

/** One column per day (single series, brand teal), with a tooltip per column and the first / last dates under it. */
const DayColumns: React.FC<{ days: string[]; counts: Record<string, number> }> = ({ days, counts }) => {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...days.map((d) => counts[d] || 0));
  const total = days.reduce((n, d) => n + (counts[d] || 0), 0);
  if (!total) return <p className="py-10 text-center text-xs text-[#6B7280]">No important changes on these days.</p>;
  return (
    <figure className="space-y-1.5">
      <div role="img" aria-label={`Important changes per day: ${days.map((d) => `${shortDay(d)} ${counts[d] || 0}`).join(', ')}`} className="relative flex h-32 items-end gap-[2px] border-b border-[#ECE9E2]">
        {days.map((d) => {
          const n = counts[d] || 0;
          return (
            <div key={d} className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
              {n > 0 && <span className={`block w-full rounded-t-[4px] ${hover === d ? 'bg-[#0B4A4E]' : 'bg-[#0F5E63]'}`} style={{ height: `max(3px, ${(n / max) * 100}%)` }} />}
              {hover === d && (
                <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[#DCD8CE] bg-white px-2 py-1 text-[11px] text-[#14213D] shadow-sm">
                  {shortDay(d)} · <span className="font-mono font-semibold">{n}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <figcaption className="flex justify-between font-mono text-[10px] text-[#4A5568]">
        <span>{shortDay(days[0])}</span>
        <span>{shortDay(days[days.length - 1])}</span>
      </figcaption>
    </figure>
  );
};

export default function AuditLogsPage() {
  const [kind, setKind] = useState('all');
  const [actorId, setActorId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actors, setActors] = useState<any[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<{ by_kind: any[]; by_day: any[]; by_actor: any[] } | null>(null);

  // Debounce typing in the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get<any>('/audit/facets').then((f) => setActors(f?.actors || [])).catch(() => undefined);
    api
      .get<any>('/users', { limit: 500 })
      .then((res) => {
        const rows: any[] = Array.isArray(res) ? res : res?.data || [];
        setUserNames(Object.fromEntries(rows.map((u) => [u.id, u.full_name])));
      })
      .catch(() => undefined);
  }, []);

  const params = useMemo(() => {
    const p: Record<string, string> = { kind: kind === 'all' ? 'important' : kind };
    if (actorId !== 'all') p.actor_id = actorId;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (search) p.search = search;
    return p;
  }, [kind, actorId, dateFrom, dateTo, search]);

  const fetchPage = useCallback((page: number) => api.get<any>('/audit', { ...params, page, limit: PAGE_SIZE }), [params]);
  const list = useInfiniteList<any>(fetchPage);

  // The charts count exactly the rows the list shows; the day strip draws the picked range (else the last 30 days).
  const days = useMemo(() => daysOf(dateFrom, dateTo), [dateFrom, dateTo]);
  useEffect(() => {
    let live = true;
    api
      .get<any>('/audit/summary', params)
      .then((r) => live && setSummary(r))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [params]);
  const kindCounts = useMemo<Record<string, number>>(() => Object.fromEntries((summary?.by_kind || []).map((k) => [k.kind, Number(k.count)])), [summary]);
  const dayCounts = useMemo<Record<string, number>>(() => Object.fromEntries((summary?.by_day || []).map((d) => [d.day, Number(d.count)])), [summary]);

  // CSV of what the filters show (the API caps it at 10,000 rows and records the export in the trail)
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.get<string>('/audit/export', params);
      // Reading the response as text drops the API's byte-order mark; put it back so Excel opens the file as UTF-8
      const url = URL.createObjectURL(new Blob(['﻿', String(csv).replace(/^﻿/, '')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${istToday()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err?.message || 'Could not export the audit log.');
    } finally {
      setExporting(false);
    }
  };

  const nameOf = (id: string) => userNames[id] || actors.find((a) => a.id === id)?.full_name;
  const formatValue = (field: string, v: unknown, entityType?: string): string => {
    if (v === undefined) return '';
    if (v === null || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? '…' : String(x))).join(', ') : '—';
    if (typeof v === 'object') return '…';
    const str = String(v);
    if (UUID_RE.test(str)) return nameOf(str) || `${str.slice(0, 8)}…`;
    if (DATE_ONLY_RE.test(str)) {
      return new Date(`${str.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    }
    if (ISO_RE.test(str)) return `${fmtStamp(str)} IST`;
    // Status names come from the record's own module ("submitted" is a different thing for a tender and an expense).
    if (/status|stage|decision/i.test(field)) return (entityType === 'tender' ? TENDER_STATUS_LABELS[str] : entityType === 'proposal' ? PROPOSAL_STATUS_LABELS[str] : undefined) || humanize(str);
    if (MONEY_KEY_RE.test(field) && /^-?\d+(\.\d+)?$/.test(str)) return formatINR(Number(str));
    return str.length > 120 ? `${str.slice(0, 117)}…` : str;
  };
  const fieldLabel = (k: string) => humanize(k.replace(/_id$/, '').replace(/^assigned_to$/, 'assigned to'));

  const hasFilters = kind !== 'all' || actorId !== 'all' || !!dateFrom || !!dateTo || !!search;
  const clearAll = () => {
    setKind('all');
    setActorId('all');
    setDateFrom('');
    setDateTo('');
    setSearchInput('');
  };

  const renderSide = (changes: Change[], side: 'before' | 'after', entityType: string) => {
    const lines = changes.filter((c) => (side === 'before' ? c.before !== undefined : c.after !== undefined)).slice(0, 3);
    if (!lines.length) return <span className="text-[11px] text-[#6B7280]">—</span>;
    return (
      <ul className="space-y-0.5">
        {lines.map((c) => (
          <li key={c.field} className="line-clamp-2 text-[11px] leading-snug" title={`${fieldLabel(c.field)}: ${formatValue(c.field, c[side], entityType)}`}>
            <span className="text-[#4A5568]">{fieldLabel(c.field)}: </span>
            <span className={side === 'before' ? 'text-[#881337]' : 'font-medium text-[#0F5E63]'}>{formatValue(c.field, c[side], entityType)}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Audit Logs"
        icon={<History />}
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            isLoading={exporting}
            disabled={list.total === 0}
            onClick={exportCsv}
            title="Download the entries matching the filters (up to 10,000)"
          >
            Export CSV
          </Button>
        }
      />
      {exportError && (
        <InfoCallout variant="danger" title="Export failed" onClose={() => setExportError(null)}>
          {exportError}
        </InfoCallout>
      )}

      {/* One filter row; relative + z-20 + overflow-visible so its menus open over the charts below. */}
      <Card className="relative z-20 overflow-visible p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search audit logs"
              placeholder="Search record no., person or action…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu
              label="Change"
              icon={<Layers />}
              className="[&_.filter-menu-panel]:max-h-[360px] [&_.filter-menu-panel]:overflow-y-auto"
              options={[{ key: 'all', label: 'All important changes' }, ...KINDS].map((k) => ({
                key: k.key,
                label: k.label,
                count: k.key === 'all' ? Object.values(kindCounts).reduce((a, b) => a + b, 0) : kindCounts[k.key] || 0,
                active: kind === k.key,
                onSelect: () => setKind(k.key),
              }))}
            />
            <FilterMenu
              label="User"
              icon={<UserIcon />}
              className="[&_.filter-menu-panel]:max-h-[360px] [&_.filter-menu-panel]:overflow-y-auto"
              options={[
                { key: 'all', label: 'Everyone', count: undefined as number | undefined },
                ...actors.map((a) => ({ key: a.id as string, label: `${a.full_name} · ${roleLabel(a.role)}`, count: undefined as number | undefined })),
              ].map((o) => ({ ...o, active: actorId === o.key, onSelect: () => setActorId(o.key) }))}
            />
            <label className="flex items-center gap-1.5 text-xs text-[#4A5568]">
              <span>From</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || istToday()}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 rounded-lg border border-[#C9C4B8] bg-white px-2 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[#4A5568]">
              <span>To</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                max={istToday()}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 rounded-lg border border-[#C9C4B8] bg-white px-2 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
              />
            </label>
            {hasFilters && (
              <Button variant="ghost" size="xs" onClick={clearAll} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padding="md" className="space-y-2">
          <SectionHeader title="Changes by type" description="Pick a type to filter the trail." />
          <BarList
            labelWidth="58%"
            label="Important changes by type"
            emptyText="No important changes match."
            items={KINDS.map((k) => ({ key: k.key, label: k.label, value: kindCounts[k.key] || 0, active: kind === k.key, onSelect: () => setKind(kind === k.key ? 'all' : k.key) }))}
          />
        </Card>
        <Card padding="md" className="space-y-2">
          <SectionHeader
            title="Changes per day"
            description={`${days.reduce((n, d) => n + (dayCounts[d] || 0), 0)} between ${shortDay(days[0])} and ${shortDay(days[days.length - 1])} (IST)`}
          />
          <DayColumns days={days} counts={dayCounts} />
        </Card>
        <Card padding="md" className="space-y-2">
          <SectionHeader title="Who made them" description="Top 8 people. Pick one to filter." />
          <BarList
            label="Important changes by person"
            emptyText="Nobody made an important change here."
            items={(summary?.by_actor || []).map((a) => ({
              key: a.id,
              label: a.name || 'Unknown user',
              value: Number(a.count),
              detail: roleLabel(a.role),
              active: actorId === a.id,
              onSelect: () => setActorId(actorId === a.id ? 'all' : a.id),
            }))}
          />
        </Card>
      </div>

      {list.loading ? (
        <PageLoader label="Loading audit trail" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="No important changes match"
          description="Try another change type, person or date range."
          action={hasFilters ? <Button variant="secondary" onClick={clearAll}>Clear filters</Button> : undefined}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[#ECE9E2] bg-[#FBFAF7] px-4 py-2.5 text-xs text-[#4A5568]">
            <span>
              {list.rows.length < list.total ? `${list.rows.length} of ${list.total}` : list.total} important change{list.total === 1 ? '' : 's'} · newest first
            </span>
            <span className="hidden sm:inline">Times are IST · click a row for every changed field</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-2" />
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Previous value</TableHead>
                  <TableHead>New value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((log: any) => {
                  const changes = changesOf(log);
                  const isOpen = expanded === log.id;
                  const href = RECORD_LINK[log.entity_type] ? `${RECORD_LINK[log.entity_type]}?open=${log.entity_id}` : null;
                  return (
                    <React.Fragment key={log.id}>
                      <TableRow className="cursor-pointer align-top hover:bg-[#FBFAF7]" onClick={() => setExpanded(isOpen ? null : log.id)} aria-expanded={isOpen}>
                        <TableCell className="px-2 pt-3 text-[#6B7280]">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono">
                          <div className="text-[11px] text-[#14213D]">{fmtDay(log.created_at)}</div>
                          <div className="text-[10px] text-[#6B7280]">{fmtTime(log.created_at)}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="text-xs font-semibold text-[#14213D]">{log.actor_name || 'System'}</div>
                          {log.actor_role && <div className="text-[10px] text-[#6B7280]">{roleLabel(log.actor_role)}</div>}
                        </TableCell>
                        <TableCell className="min-w-[120px] max-w-[160px]">
                          <Badge variant={/reject|cancel/i.test(actionOf(log)) ? 'warning' : 'outline'} size="sm" className="whitespace-normal text-left">
                            {actionOf(log)}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[150px] max-w-[200px] whitespace-normal break-words">
                          <div className="text-[10px] uppercase tracking-wide text-[#6B7280]">{MODULE_OF[log.entity_type] || humanize(log.entity_type)}</div>
                          {href ? (
                            <Link href={href} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-[#0F5E63] hover:underline">
                              {log.entity_label || humanize(log.entity_type)}
                            </Link>
                          ) : (
                            <div className="text-xs font-medium text-[#14213D]">{log.entity_label || humanize(log.entity_type)}</div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[150px] max-w-[210px] whitespace-normal break-words">{renderSide(changes, 'before', log.entity_type)}</TableCell>
                        <TableCell className="min-w-[160px] max-w-[228px] whitespace-normal break-words">{renderSide(changes, 'after', log.entity_type)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-[#FBFAF7]">
                          <TableCell />
                          <TableCell colSpan={6} className="py-3">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4A5568]">
                              <span>
                                <strong className="text-[#14213D]">{actionOf(log)}</strong> · code <span className="font-mono">{log.action}</span>
                              </span>
                              {log.actor_email && <span>By {log.actor_email}</span>}
                              {href && (
                                <Link href={href} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-[#0F5E63] hover:underline">
                                  Open record <ExternalLink className="h-3 w-3" />
                                </Link>
                              )}
                            </div>
                            {changes.length > 0 ? (
                              <table className="mt-2 w-full max-w-3xl text-[11px]">
                                <thead>
                                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                                    <th className="py-1 pr-3 font-semibold">Field</th>
                                    <th className="py-1 pr-3 font-semibold">Previous</th>
                                    <th className="py-1 font-semibold">New</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {changes.map((c) => (
                                    <tr key={c.field} className="border-t border-[#ECE9E2]">
                                      <td className="py-1 pr-3 text-[#4A5568]">{fieldLabel(c.field)}</td>
                                      <td className="py-1 pr-3 text-[#881337]">{c.before === undefined ? '—' : formatValue(c.field, c.before, log.entity_type)}</td>
                                      <td className="py-1 text-[#0F5E63]">{c.after === undefined ? '—' : formatValue(c.field, c.after, log.entity_type)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="mt-2 text-[11px] italic text-[#6B7280]">No business field was recorded for this change.</p>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {list.hasMore && (
            <div className="flex justify-center border-t border-[#ECE9E2] p-3">
              <Button variant="secondary" size="sm" isLoading={list.loadingMore} onClick={() => list.loadMore()}>
                Load older entries
              </Button>
            </div>
          )}
        </Card>
      )}
    </PageContainer>
  );
}
