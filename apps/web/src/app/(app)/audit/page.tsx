'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Search, Layers, User as UserIcon, Zap, ChevronDown, ChevronRight, ExternalLink, CalendarDays, Users } from 'lucide-react';
import {
  PageContainer,
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  FilterMenu,
  Button,
  EmptyState,
  Badge,
  PageLoader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { istToday } from '@/lib/ist-date';
import { roleLabel } from '@/lib/role-label';
import { formatINR, TENDER_STATUS_LABELS, PROPOSAL_STATUS_LABELS } from '@arihant/shared';

/**
 * Audit Logs (Blueprint §47 / PRD "important changes should be logged"): who did what, to which record, the previous
 * and the new value, and when. Reads the immutable audit_log trail written by every module.
 */

const PAGE_SIZE = 50;

/** Record types grouped by business module (types not listed here fall under "Users & System"). */
const MODULES: { key: string; label: string; types: string[] }[] = [
  { key: 'tenders', label: 'Tenders', types: ['tender'] },
  { key: 'proposals', label: 'Proposals', types: ['proposal'] },
  { key: 'leads', label: 'Leads & Customers', types: ['lead', 'organisation', 'contact'] },
  { key: 'visits', label: 'Visits & Tours', types: ['visit', 'trip'] },
  { key: 'demos', label: 'Demos & Equipment', types: ['demo', 'demo_equipment', 'demo_reservation'] },
  { key: 'service', label: 'Service', types: ['service_ticket', 'service_report'] },
  { key: 'expenses', label: 'Expenses', types: ['expense', 'expense_claim'] },
  { key: 'deliveries', label: 'Deliveries', types: ['delivery'] },
  { key: 'tasks', label: 'Tasks', types: ['task', 'task_blocker'] },
];
const SYSTEM_MODULE = { key: 'system', label: 'Users & System' };
const moduleOf = (entityType: string) => MODULES.find((m) => m.types.includes(entityType)) ?? { ...SYSTEM_MODULE, types: [] };

/** Records that open from a link (pages that support ?open=<id>). */
const RECORD_LINK: Record<string, string> = {
  proposal: '/proposals',
  lead: '/leads',
  visit: '/visits',
  demo: '/demos',
  service_ticket: '/service',
  expense_claim: '/expenses',
  delivery: '/deliveries',
};

/** Plain-language names for the PRD's key changes; every other code is turned into words. */
const ACTION_LABELS: Record<string, string> = {
  tender_deadline_changed: 'Deadline changed',
  tender_approved: 'Tender approved',
  tender_rejected: 'Tender rejected',
  approval_approved: 'Tender approved',
  tender_approval_requested: 'Submitted for internal review',
  tender_stage_changed: 'Tender stage changed',
  tender_reassigned: 'Tender reassigned',
  tender_updated: 'Tender details edited',
  tender_put_on_hold: 'Tender put on hold',
  tender_resumed: 'Tender resumed',
  tender_reopened: 'Tender reopened',
  tender_deleted: 'Tender deleted',
  tender_won: 'Tender won',
  tender_lost: 'Tender lost',
  tender_cancelled: 'Tender cancelled',
  record_outcome: 'Tender result recorded',
  financial_instrument_added: 'EMD / PBG added',
  financial_instrument_updated: 'EMD / PBG changed',
  CANCEL_VISIT: 'Visit cancelled',
  RESCHEDULE_VISIT: 'Visit rescheduled',
  CHANGE_DESTINATION: 'Visit destination changed',
  availability_changed: 'Equipment availability changed',
  reassign: 'Reassigned',
  status_change: 'Status changed',
  create: 'Created',
  update: 'Edited',
  delete: 'Deleted',
  soft_delete: 'Deleted',
  deactivate: 'Deactivated',
  proposal_lost: 'Proposal lost',
  proposal_converted: 'Proposal converted',
  proposal_closed: 'Proposal closed',
  proposal_sent: 'Proposal sent to customer',
  proposal_approved: 'Proposal approved',
  proposal_reopened: 'Proposal reopened',
  expense_reassign_approver: 'Expense approver reassigned',
};
const humanize = (code: string) => {
  const words = String(code || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const actionLabel = (code: string) => ACTION_LABELS[code] || humanize(code);
const KEY_CHANGE_RE = /deadline|approv|reject|cancel|reassign|availability|status|stage|_won|_lost|converted|closed|reopen|hold|resum|delet|deactivat|outcome|submitted|reschedul/i;

/** Bookkeeping fields that never mean anything to a reader of the trail. */
const HIDDEN_KEYS = new Set([
  'id', 'created_at', 'updated_at', 'last_activity_at', 'updated_by', 'created_by', 'version', 'row_version',
  'actorId', '_actorId', 'actor_id', 'tenderId', 'tenderNo', 'proposalId', 'proposalNo', 'orgName', 'decisionEvent',
  'tenderOwnerId', 'fromStatus', 'aggregate_sequence', 'eventId', 'tender_id', 'proposal_id', 'organisation_id',
  'is_deleted', 'deleted_at', 'deleted_by', 'search_vector',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?(Z|\+00:?00)?)?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MONEY_KEY_RE = /(amount|value|price|fee|total|emd|pbg)/i;

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });

type Change = { field: string; before: unknown; after: unknown };

/** Field-level changes of an audit row, whatever shape the module wrote it in. */
function changesOf(log: any): { changes: Change[]; kind: 'diff' | 'snapshot' | 'empty' } {
  let prev = log.previous_value && typeof log.previous_value === 'object' ? { ...log.previous_value } : null;
  let next = log.new_value && typeof log.new_value === 'object' ? { ...log.new_value } : null;
  // Proposal consumer rows: { changes: { before, after } }
  if (next?.changes?.after && typeof next.changes.after === 'object') {
    prev = next.changes.before || prev;
    next = next.changes.after;
  }
  // Lifecycle events carry the move as fromStatus / toStatus.
  if (next && 'toStatus' in next) {
    next.status = next.toStatus;
    delete next.toStatus;
  }
  if (!next && !prev) return { changes: [], kind: 'empty' };
  const visible = (k: string) => !HIDDEN_KEYS.has(k);

  if (prev && next) {
    const keys = Array.from(new Set([...Object.keys(next), ...Object.keys(prev)])).filter(visible);
    const changes = keys
      .filter((k) => k in next! && JSON.stringify(prev![k] ?? null) !== JSON.stringify(next![k] ?? null))
      .map((k) => ({ field: k, before: prev![k], after: next![k] }));
    return { changes, kind: changes.length ? 'diff' : 'empty' };
  }
  const snap = (next || prev)!;
  const changes = Object.keys(snap)
    .filter((k) => visible(k) && snap[k] !== null && snap[k] !== '' && typeof snap[k] !== 'object')
    .map((k) => ({ field: k, before: next ? undefined : snap[k], after: next ? snap[k] : undefined }));
  return { changes, kind: changes.length ? 'snapshot' : 'empty' };
}

export default function AuditLogsPage() {
  const [moduleKey, setModuleKey] = useState('all');
  const [action, setAction] = useState('all');
  const [actorId, setActorId] = useState('all');
  const [keyOnly, setKeyOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ entity_types: any[]; actions: any[]; actors: any[] }>({ entity_types: [], actions: [], actors: [] });
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [todayCount, setTodayCount] = useState<number | null>(null);

  // Debounce typing in the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get<any>('/audit/facets').then(setFacets).catch(() => undefined);
    api
      .get<any>('/users', { limit: 500 })
      .then((res) => {
        const rows: any[] = Array.isArray(res) ? res : res?.data || [];
        setUserNames(Object.fromEntries(rows.map((u) => [u.id, u.full_name])));
      })
      .catch(() => undefined);
  }, []);

  const knownTypes = useMemo(() => new Set(MODULES.flatMap((m) => m.types)), []);
  const systemTypes = useMemo(
    () => facets.entity_types.map((e) => e.entity_type).filter((t: string) => !knownTypes.has(t)),
    [facets.entity_types, knownTypes],
  );
  const typesForModule = useCallback(
    (key: string) => (key === SYSTEM_MODULE.key ? systemTypes : MODULES.find((m) => m.key === key)?.types || []),
    [systemTypes],
  );

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (moduleKey !== 'all') p.entity_type = typesForModule(moduleKey).join(',') || '__none__';
    if (action !== 'all') p.action = action;
    if (actorId !== 'all') p.actor_id = actorId;
    if (keyOnly) p.key_changes = 'true';
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (search) p.search = search;
    return p;
  }, [moduleKey, action, actorId, keyOnly, dateFrom, dateTo, search, typesForModule]);

  const fetchPage = useCallback((page: number) => api.get<any>('/audit', { ...params, page, limit: PAGE_SIZE }), [params]);
  const list = useInfiniteList<any>(fetchPage);

  // "Today" follows every filter except the date range.
  useEffect(() => {
    const { date_from, date_to, ...rest } = params;
    const today = istToday();
    let live = true;
    api
      .get<any>('/audit', { ...rest, date_from: today, date_to: today, limit: 1 })
      .then((res) => live && setTodayCount(Number(res?.total ?? res?.meta?.total ?? 0)))
      .catch(() => live && setTodayCount(null));
    return () => {
      live = false;
    };
  }, [params]);

  const moduleCounts = useMemo(() => {
    const byType = Object.fromEntries(facets.entity_types.map((e) => [e.entity_type, Number(e.count)]));
    const sum = (types: string[]) => types.reduce((n, t) => n + (byType[t] || 0), 0);
    return {
      all: facets.entity_types.reduce((n, e) => n + Number(e.count), 0),
      ...Object.fromEntries(MODULES.map((m) => [m.key, sum(m.types)])),
      [SYSTEM_MODULE.key]: sum(systemTypes),
    } as Record<string, number>;
  }, [facets.entity_types, systemTypes]);

  const actionOptions = useMemo(() => {
    const allowed = moduleKey === 'all' ? null : new Set(typesForModule(moduleKey));
    const totals = new Map<string, number>();
    for (const a of facets.actions) {
      if (allowed && !allowed.has(a.entity_type)) continue;
      if (keyOnly && !KEY_CHANGE_RE.test(a.action)) continue;
      totals.set(a.action, (totals.get(a.action) || 0) + Number(a.count));
    }
    return Array.from(totals.entries())
      .sort((a, b) => actionLabel(a[0]).localeCompare(actionLabel(b[0])))
      .map(([code, count]) => ({ code, count }));
  }, [facets.actions, moduleKey, keyOnly, typesForModule]);

  const nameOf = (id: string) => userNames[id] || facets.actors.find((a) => a.id === id)?.full_name;
  const formatValue = (field: string, v: unknown): string => {
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
    if (/status|stage/i.test(field)) return TENDER_STATUS_LABELS[str] || PROPOSAL_STATUS_LABELS[str] || humanize(str);
    if (MONEY_KEY_RE.test(field) && /^-?\d+(\.\d+)?$/.test(str)) return formatINR(Number(str));
    return str.length > 120 ? `${str.slice(0, 117)}…` : str;
  };
  const fieldLabel = (k: string) => humanize(k.replace(/_id$/, '').replace(/^assigned_to$/, 'assigned to'));

  const hasFilters = moduleKey !== 'all' || action !== 'all' || actorId !== 'all' || keyOnly || !!dateFrom || !!dateTo || !!search;
  const clearAll = () => {
    setModuleKey('all');
    setAction('all');
    setActorId('all');
    setKeyOnly(false);
    setDateFrom('');
    setDateTo('');
    setSearchInput('');
  };

  const renderSide = (changes: Change[], side: 'before' | 'after') => {
    const lines = changes.filter((c) => (side === 'before' ? c.before !== undefined : c.after !== undefined)).slice(0, 4);
    if (!lines.length) return <span className="text-[#6B7280]">—</span>;
    return (
      <ul className="space-y-0.5">
        {lines.map((c) => (
          <li key={c.field} className="text-[11px] leading-snug">
            <span className="text-[#4A5568]">{fieldLabel(c.field)}: </span>
            <span className={side === 'before' ? 'text-[#881337]' : 'text-[#0F5E63] font-medium'}>{formatValue(c.field, c[side])}</span>
          </li>
        ))}
        {changes.length > 4 && <li className="text-[10px] text-[#6B7280]">+{changes.length - 4} more</li>}
      </ul>
    );
  };

  return (
    <PageContainer>
      <PageHeader title="Audit Logs" icon={<History />} />

      <StatGrid cols={4} className="gap-3">
        <StatCard title="Matching Entries" value={list.total} icon={<History size={16} />} subtext={hasFilters ? 'With the filters below' : 'Whole audit trail'} />
        <StatCard title="Today" value={todayCount ?? '—'} icon={<CalendarDays size={16} />} variant="primary" subtext={`${istToday()} IST`} />
        <StatCard title="People in the Trail" value={facets.actors.length} icon={<Users size={16} />} subtext="Users who made logged changes" />
        <StatCard title="Record Types" value={facets.entity_types.length} icon={<Layers size={16} />} subtext="Tenders, proposals, visits, tickets…" />
      </StatGrid>

      <Card className="p-3">
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
              label="Module"
              icon={<Layers />}
              options={[{ key: 'all', label: 'All modules' }, ...MODULES, SYSTEM_MODULE].map((m) => ({
                key: m.key,
                label: m.label,
                count: moduleCounts[m.key] ?? 0,
                active: moduleKey === m.key,
                onSelect: () => {
                  setModuleKey(m.key);
                  setAction('all');
                },
              }))}
            />
            <FilterMenu
              label="Action"
              icon={<Zap />}
              className="[&_.filter-menu-panel]:max-h-[360px] [&_.filter-menu-panel]:overflow-y-auto"
              options={[
                { key: 'all', label: 'All actions', count: undefined as number | undefined },
                ...actionOptions.map((a) => ({ key: a.code, label: actionLabel(a.code), count: a.count })),
              ].map((o) => ({ ...o, active: action === o.key, onSelect: () => setAction(o.key) }))}
            />
            <FilterMenu
              label="User"
              icon={<UserIcon />}
              className="[&_.filter-menu-panel]:max-h-[360px] [&_.filter-menu-panel]:overflow-y-auto"
              options={[
                { key: 'all', label: 'Everyone', count: undefined as number | undefined },
                ...facets.actors.map((a) => ({ key: a.id, label: `${a.full_name} · ${roleLabel(a.role)}`, count: Number(a.count) })),
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
            <Button
              variant={keyOnly ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={keyOnly}
              onClick={() => {
                setKeyOnly((v) => !v);
                setAction('all');
              }}
            >
              Important changes only
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="xs" onClick={clearAll} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {list.loading ? (
        <PageLoader label="Loading audit trail" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="No audit entries match"
          description="Try another module, action, person or date range."
          action={hasFilters ? <Button variant="secondary" onClick={clearAll}>Clear filters</Button> : undefined}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#ECE9E2] bg-[#FBFAF7] px-4 py-2.5 text-xs text-[#4A5568]">
            <span>
              {list.rows.length < list.total ? `${list.rows.length} of ${list.total}` : list.total} entries · newest first
            </span>
            <span className="hidden sm:inline">Times are IST · click a row for every changed field</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Previous Value</TableHead>
                  <TableHead>New Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((log: any) => {
                  const { changes, kind } = changesOf(log);
                  const mod = moduleOf(log.entity_type);
                  const isOpen = expanded === log.id;
                  const href = RECORD_LINK[log.entity_type] ? `${RECORD_LINK[log.entity_type]}?open=${log.entity_id}` : null;
                  const important = KEY_CHANGE_RE.test(log.action);
                  return (
                    <React.Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer align-top hover:bg-[#FBFAF7]"
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                        aria-expanded={isOpen}
                      >
                        <TableCell className="pt-3 text-[#6B7280]">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-[#14213D]">{fmtStamp(log.created_at)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="text-xs font-semibold text-[#14213D]">{log.actor_name || 'System'}</div>
                          {log.actor_role && <div className="text-[10px] text-[#6B7280]">{roleLabel(log.actor_role)}</div>}
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          <Badge variant={important ? 'warning' : 'outline'} size="sm">
                            {actionLabel(log.action)}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[180px]">
                          <div className="text-[10px] uppercase tracking-wide text-[#6B7280]">{mod.label}</div>
                          <div className="text-xs font-medium text-[#0F5E63]">{log.entity_label || humanize(log.entity_type)}</div>
                        </TableCell>
                        <TableCell className="min-w-[200px]">
                          {kind === 'empty' ? <span className="text-[11px] text-[#6B7280]">—</span> : renderSide(changes, 'before')}
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          {kind === 'empty' ? (
                            <span className="text-[11px] italic text-[#6B7280]">No business field changed</span>
                          ) : (
                            renderSide(changes, 'after')
                          )}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-[#FBFAF7]">
                          <TableCell />
                          <TableCell colSpan={6} className="py-3">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4A5568]">
                              <span>
                                <strong className="text-[#14213D]">{actionLabel(log.action)}</strong> · code <span className="font-mono">{log.action}</span>
                              </span>
                              <span>
                                Record type <span className="font-mono">{log.entity_type}</span>
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
                                      <td className="py-1 pr-3 text-[#881337]">{c.before === undefined ? '—' : formatValue(c.field, c.before)}</td>
                                      <td className="py-1 text-[#0F5E63]">{c.after === undefined ? '—' : formatValue(c.field, c.after)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="mt-2 text-[11px] italic text-[#6B7280]">No business field changed in this entry.</p>
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
