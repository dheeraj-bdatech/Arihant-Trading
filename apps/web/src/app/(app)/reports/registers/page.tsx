'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { istToday, toIstLocalInput } from '@/lib/ist-date';
import {
  FileSpreadsheet,
  Download,
  Filter,
  Search,
  Target,
  FileText,
  Calendar,
  Receipt,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  RefreshCw,
  Layers,
  LayoutList,
  MapPin,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { canRead, type ReadableModule } from '@/lib/module-access';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { ReportsNav } from '../_lib/report-ui';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  PageContainer,
  PageHeader,
  StatGrid,
  StatCard,
  PageLoader,
  InfoCallout,
  FilterMenu,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  RecordTable,
  RecordViews,
  formatDateIN,
  daysFromToday,
  rowDetails,
  toneFor,
  type BadgeProps,
  type BoardLane,
  type RecordItem,
} from '@/components/ui';
import {
  isClosedLeadStatus,
  formatLakh,
  formatINR,
  TENDER_STATUSES,
  LEAD_STATUSES,
  EXPENSE_CLAIM_STATUSES,
  EXPENSE_STATUS_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_DONE_STATUSES,
  normalizeServiceStatus,
  type ServiceStatus,
} from '@arihant/shared';

/** Never let a missing field render as "undefined"/"null". */
const txt = (v: unknown, fallback = '—'): string =>
  v === undefined || v === null || v === '' || String(v) === 'undefined' || String(v) === 'null' ? fallback : String(v);
const pretty = (v: unknown, fallback = '—'): string => txt(v, fallback).replace(/_/g, ' ');
const fmtDate = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? txt(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
/** Maps rows to RecordItems and remembers each record's lane (unknown statuses go to "Other"). */
function register<T>(list: T[], toItem: (row: T) => RecordItem, laneKey: (row: T) => string) {
  const lanes = new Map<string, string>();
  const items = list.map((row) => {
    const item = toItem(row);
    lanes.set(item.key, laneKey(row));
    return item;
  });
  return { items, laneOf: (item: RecordItem) => lanes.get(item.key) ?? 'other' };
}
const cap = (v: unknown) => {
  const t = pretty(v);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** A stored code ('GENERAL_MHA', 'follow_up') as a business label ('General Mha', 'Follow Up'). */
const codeLabel = (v: unknown, fallback = '—'): string =>
  txt(v, '') ? pretty(v).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : fallback;
/** Tender category master labels (seeded in 007 / 019) for rows that carry only the code. */
const TENDER_CATEGORY_LABELS: Record<string, string> = {
  pq: 'PQ',
  general_mha: 'General / MHA',
  general: 'General Tender',
  mha: 'MHA Tender',
  other: 'Other',
};
/** Business label for a tender's category: the master name from the API, else the known label for its code. */
const tenderCategory = (t: any): string => {
  if (txt(t.category_name, '')) return String(t.category_name);
  const code = String(t.category_code || t.category || '').toLowerCase();
  return code ? TENDER_CATEGORY_LABELS[code] ?? codeLabel(code) : 'General';
};
const lanesFor = (keys: readonly string[], label: (k: string) => string = cap): BoardLane[] =>
  [...keys, 'other'].map((k) => ({ key: k, label: k === 'other' ? 'Other' : label(k), tone: toneFor(k === 'other' ? '' : label(k)) }));
const laneIn = (keys: readonly string[], v: unknown) => {
  const k = String(v || '').toLowerCase();
  return keys.includes(k) ? k : 'other';
};

const TENDER_LANES = lanesFor(TENDER_STATUSES);
/** Bid closing only drives urgency while the bid is still being prepared. */
const TENDER_PRE_SUBMISSION = ['identified', 'awaiting_approval', 'under_preparation', 'on_hold'];
const LEAD_LANES = lanesFor(LEAD_STATUSES);
const VISIT_STATUSES = ['planned', 'modified', 'rescheduled', 'completed', 'not_completed', 'cancelled'];
const VISIT_LANES = lanesFor(VISIT_STATUSES);
const VISIT_DONE = ['completed', 'not_completed', 'cancelled'];
// Expense report rows carry the claim's status label (see fetch below), so lanes key on the label.
const EXPENSE_LANES = lanesFor(EXPENSE_CLAIM_STATUSES.map((s) => EXPENSE_STATUS_LABELS[s].toLowerCase()), (k) => EXPENSE_CLAIM_STATUSES.map((s) => EXPENSE_STATUS_LABELS[s]).find((l) => l.toLowerCase() === k) ?? cap(k));
const EXPENSE_LANE_KEYS = EXPENSE_LANES.map((l) => l.key);
const SERVICE_STATUSES = Object.keys(SERVICE_STATUS_LABELS) as ServiceStatus[];
const SERVICE_LANES = lanesFor(SERVICE_STATUSES, (k) => SERVICE_STATUS_LABELS[k as ServiceStatus] ?? cap(k));

type BadgeVariant = NonNullable<BadgeProps['variant']>;
/** Register-table status badge: done → success, waiting → warning, in hand → default, failed → danger, rest → outline. */
const statusBadge = (status: unknown): BadgeVariant => {
  const s = String(status ?? '').toLowerCase().replace(/_/g, ' ');
  if (/\bnot\b/.test(s)) return 'outline'; // not completed / not submitted / pq not qualified
  if (/\b(lost|rejected|cancelled|breached)\b/.test(s)) return 'danger';
  if (/\b(won|completed|approved|paid|resolved)\b/.test(s)) return 'success';
  if (/\b(awaiting|pending|submitted)\b/.test(s)) return 'warning';
  if (/\b(in progress|planned|under preparation)\b/.test(s)) return 'default';
  return 'outline';
};
/** Expense rows carry the claim's status label; badge tone keys on the underlying status. */
const expenseStatusKey = (label: unknown): string => EXPENSE_CLAIM_STATUSES.find((s) => EXPENSE_STATUS_LABELS[s] === label) ?? String(label ?? '');
const probabilityBadge = (p: unknown): BadgeVariant => {
  const v = String(p ?? '').toLowerCase();
  return v === 'high' ? 'success' : v === 'medium' ? 'warning' : 'default';
};

const rows = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.items) ? res.items : []);

/** Rows per register page; the next page is read as the register scrolls (infinite scroll). */
const REGISTER_PAGE_SIZE = 25;
/** Rows per request when a CSV export reads a whole register (the API's page cap). */
const EXPORT_PAGE_SIZE = 100;

type StatusOption = { key: string; label: string };
const statusOptionsOf = (keys: readonly string[], label: (k: string) => string = (k) => k.replace(/_/g, ' ')): StatusOption[] =>
  keys.map((key) => ({ key, label: label(key) }));

// `access` = the module read permission the dataset needs; expense reports are scoped server-side for every role.
// `roles` narrows a dataset to the roles it is meant for (finance reports for Accounts / Management / Admin).
// `statusParam` / `statuses` = the API's status filter and its options (search is `search` on every one);
// `row` reshapes an API row for this view.
const FINANCE_ROLES: readonly string[] = ['accounts', 'management', 'admin'];
type Dataset = {
  key: string;
  label: string;
  url: string;
  access: ReadableModule | null;
  roles?: readonly string[];
  params?: Record<string, string | number>;
  statusParam?: string;
  statuses?: StatusOption[];
  row?: (r: any) => any;
};
const DATASETS: readonly Dataset[] = [
  { key: 'tenders', label: 'GeM Bids', url: '/tenders', access: 'tenders', statusParam: 'status', statuses: statusOptionsOf(TENDER_STATUSES) },
  {
    key: 'leads',
    label: 'Sales Pipeline',
    url: '/leads',
    access: 'leads',
    statusParam: 'status',
    // won / dropped are legacy names the API folds into converted / lost
    statuses: statusOptionsOf(LEAD_STATUSES.filter((s) => s !== 'won' && s !== 'dropped')),
  },
  { key: 'visits', label: 'Field Itineraries', url: '/visits', access: 'visits', statusParam: 'status', statuses: statusOptionsOf(VISIT_STATUSES) },
  {
    key: 'expenses',
    label: 'Expense Claims',
    url: '/expense-reports',
    access: null,
    statusParam: 'statuses',
    statuses: statusOptionsOf(EXPENSE_CLAIM_STATUSES, (k) => EXPENSE_STATUS_LABELS[k as keyof typeof EXPENSE_STATUS_LABELS] ?? k),
    // Module 9 report rows are per expense line; keep the field names this view already uses.
    row: (r) => ({ ...r, id: r.item_id, category: r.category_name, status: r.status_label || r.status, manager_remarks: r.reviewer_comment }),
  },
  // Paid claims with their bank reference (UTR), payment date and Tally voucher — the Accounts settlement register.
  { key: 'settlements', label: 'Settlements & Vouchers', url: '/expense-claims', access: 'expenses', roles: FINANCE_ROLES, params: { statuses: 'processed', sort_by: 'updated_at', sort_dir: 'desc' } },
  {
    key: 'service',
    label: 'Service Desk',
    url: '/service/tickets',
    access: 'service',
    statusParam: 'status',
    statuses: statusOptionsOf(SERVICE_STATUSES, (k) => SERVICE_STATUS_LABELS[k as ServiceStatus] ?? k),
  },
];

/** A register's request: its fixed params plus the search and status filter, both applied in SQL. */
const queryOf = (ds: Dataset, search: string, status: string): Record<string, unknown> => ({
  ...(ds.params || {}),
  search: search || undefined,
  ...(ds.statusParam && status !== 'all' ? { [ds.statusParam]: status } : {}),
});
const isRefusal = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 403);

/**
 * One register as a server-paged infinite list. Only the open tab reads: the others hold their first page
 * (never answered, so the loader shows when the tab opens, not an empty register for a frame). The hook
 * swallows fetch errors, so page 1 reports its own through `report`. Page 1's `totals` (expense claims
 * answer them for the whole filtered set) are kept for footers.
 */
function useRegister(ds: Dataset, active: boolean, search: string, status: string, report: (ds: Dataset, err: unknown) => void) {
  const [totals, setTotals] = useState<any>(null);
  const fetchPage = useCallback(
    async (page: number) => {
      if (!active) return new Promise<never>(() => {});
      try {
        const res = await api.get(ds.url, { ...queryOf(ds, search, status), page, limit: REGISTER_PAGE_SIZE });
        if (page === 1) {
          report(ds, null);
          setTotals(res?.totals ?? null);
        }
        return ds.row ? { ...res, data: rows(res).map(ds.row) } : res;
      } catch (err) {
        if (page === 1) report(ds, err);
        throw err;
      }
    },
    [ds, active, search, status, report],
  );
  return { ...useInfiniteList<any>(fetchPage), totals };
}

const KPI_CARDS: { key: string; title: string; icon: React.ReactNode; variant: 'primary' | 'amber' | 'emerald' }[] = [
  { key: 'tenders', title: 'Live GeM Bids', icon: <FileText className="h-4 w-4" />, variant: 'primary' },
  { key: 'leads', title: 'Active Leads', icon: <Target className="h-4 w-4" />, variant: 'primary' },
  { key: 'visits', title: 'Field Visits', icon: <Calendar className="h-4 w-4" />, variant: 'primary' },
  { key: 'expenses', title: 'Expense Claims', icon: <Receipt className="h-4 w-4" />, variant: 'amber' },
  { key: 'settlements', title: 'Settled Claims', icon: <CheckCircle2 className="h-4 w-4" />, variant: 'emerald' },
  { key: 'service', title: 'Service Tickets', icon: <Wrench className="h-4 w-4" />, variant: 'emerald' },
];

export default function ConsolidatedReportsPage() {
  const { user } = useAuth();
  // Datasets this role may read (fetched); a dataset the API still refuses (403) is hidden as well.
  const allowed = useMemo(
    () =>
      new Set<string>(
        DATASETS.filter((ds) => (!ds.access || canRead(user?.role, ds.access)) && (!ds.roles || (!!user?.role && ds.roles.includes(user.role)))).map((ds) => ds.key),
      ),
    [user?.role],
  );
  const [denied, setDenied] = useState<string[]>([]);
  const visible = useMemo(() => new Set<string>([...allowed].filter((k) => !denied.includes(k))), [allowed, denied]);
  const [tabChoice, setActiveTab] = useState('');
  // Never land on a tab the role cannot see (Accounts opens on Expense Claims, not an empty GeM Bids tab).
  const activeTab = visible.has(tabChoice) ? tabChoice : DATASETS.find((ds) => visible.has(ds.key))?.key || 'expenses';
  const [failed, setFailed] = useState<string[]>([]);

  // Search & filter (shared by every tab), both applied by the API; search 300 ms after typing stops
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  /** A register answered (err null) or failed: no permission hides it; anything else is a load failure the user can retry. */
  const report = useCallback((ds: Dataset, err: unknown) => {
    if (!err) {
      setFailed((f) => (f.includes(ds.label) ? f.filter((l) => l !== ds.label) : f));
      return;
    }
    console.error(`Reports: ${ds.url} failed`, err);
    if (isRefusal(err)) setDenied((d) => (d.includes(ds.key) ? d : [...d, ds.key]));
    else setFailed((f) => (f.includes(ds.label) ? f : [...f, ds.label]));
  }, []);

  // Each register pages in SQL; only the open tab reads.
  const dsOf = (key: string) => DATASETS.find((ds) => ds.key === key)!;
  const tendersList = useRegister(dsOf('tenders'), activeTab === 'tenders', debouncedSearch, statusFilter, report);
  const leadsList = useRegister(dsOf('leads'), activeTab === 'leads', debouncedSearch, statusFilter, report);
  const visitsList = useRegister(dsOf('visits'), activeTab === 'visits', debouncedSearch, statusFilter, report);
  const expensesList = useRegister(dsOf('expenses'), activeTab === 'expenses', debouncedSearch, statusFilter, report);
  const settlementsList = useRegister(dsOf('settlements'), activeTab === 'settlements', debouncedSearch, statusFilter, report);
  const ticketsList = useRegister(dsOf('service'), activeTab === 'service', debouncedSearch, statusFilter, report);
  const lists: Record<string, typeof tendersList> = {
    tenders: tendersList,
    leads: leadsList,
    visits: visitsList,
    expenses: expensesList,
    settlements: settlementsList,
    service: ticketsList,
  };
  const activeList = lists[activeTab] ?? expensesList;
  const { rows: tenders } = tendersList;
  const { rows: leads } = leadsList;
  const { rows: visits } = visitsList;
  const { rows: expenses } = expensesList;
  const { rows: tickets } = ticketsList;
  const { rows: settlements } = settlementsList;

  // KPI cards and the View menu: each register's total, read as one row per register (the rows themselves load
  // only on their tab). A register the API refuses (403) is hidden here already. Only failures are reported: a
  // register's own list clears its failure once it loads.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const fetchCounts = useCallback(async () => {
    const res = await Promise.all(
      DATASETS.map((ds) =>
        allowed.has(ds.key)
          ? api.get(ds.url, { ...(ds.params || {}), page: 1, limit: 1 }).catch((err: unknown) => {
              report(ds, err);
              return null;
            })
          : null,
      ),
    );
    setCounts(Object.fromEntries(DATASETS.flatMap((ds, i) => (res[i] ? [[ds.key, Number(res[i].total ?? rows(res[i]).length)]] : []))));
  }, [allowed, report]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const retry = () => {
    setFailed([]);
    fetchCounts();
    activeList.refresh();
  };

  const tenderRegister = register(
    tenders,
    (t): RecordItem => ({
      key: String(t.id),
      code: t.tender_no,
      title: txt(t.organisation_name || t.organisation || t.department),
      subtitle: t.city ? txt(t.city) : undefined,
      status: { label: cap(t.status), tone: toneFor(t.status) },
      badges: [{ label: tenderCategory(t), tone: String(t.category_code || t.category || '').toLowerCase() === 'pq' ? 'danger' : 'neutral' }],
      due: { date: t.bid_closing_date || t.submission_deadline, label: 'Closes', done: !TENDER_PRE_SUBMISSION.includes(String(t.status || '').toLowerCase()) },
      facts: [
        { label: 'EMD fee', value: t.emd_fee ? formatINR(t.emd_fee) : 'Exempt' },
        { label: 'Qty', value: t.quantity || '-' },
      ],
      details: rowDetails(t),
    }),
    (t) => laneIn(TENDER_STATUSES, t.status),
  );

  const tenderList = tenders.length ? (
    <RecordTable items={tenderRegister.items}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bid Number</TableHead>
            <TableHead>Department / Org</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">EMD Fee</TableHead>
            <TableHead>Bid Closing</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenders.map((t) => {
            const closes = t.bid_closing_date || t.submission_deadline;
            const daysLeft = TENDER_PRE_SUBMISSION.includes(String(t.status || '').toLowerCase()) ? daysFromToday(closes) : null;
            const place = [t.city, t.state].filter(Boolean).join(', ');
            return (
              <TableRow key={String(t.id)}>
                <TableCell className="font-bold whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{txt(t.tender_no)}</span>
                </TableCell>
                <TableCell className="font-bold text-[#14213D]">
                  {txt(t.organisation_name || t.organisation || t.department)}
                  {place && <div className="text-[10px] text-[#4A5568] font-normal">{place}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant="outline" size="sm" className="font-bold">
                    {tenderCategory(t)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-[#14213D] whitespace-nowrap">{t.quantity || '-'}</TableCell>
                <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">
                  {t.emd_fee ? formatINR(t.emd_fee) : <span className="font-normal text-[#4A5568]">Exempt</span>}
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(closes)}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && (
                    <div className="text-[10px] font-bold text-[#881337]">{daysLeft === 0 ? 'CLOSING TODAY' : `${daysLeft} DAYS LEFT`}</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={statusBadge(t.status)} size="sm" className="uppercase font-bold">
                    {pretty(t.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const leadRegister = register(
    leads,
    (l): RecordItem => ({
      key: String(l.id),
      title: txt(l.organisation_name),
      subtitle: txt(l.product_name),
      status: { label: cap(l.status), tone: toneFor(l.status) },
      badges: l.category ? [{ label: codeLabel(l.category), tone: 'neutral' }] : [],
      due: { date: l.next_followup_date, label: 'Follow-up', done: isClosedLeadStatus(l.status) },
      value: l.value_lakh || l.estimated_value_lakh ? `₹ ${l.value_lakh || l.estimated_value_lakh} L` : undefined,
      owner: l.assigned_to_name || 'Unassigned',
      facts: [
        { label: 'Probability', value: cap(l.probability) },
        { label: 'Classification', value: codeLabel(l.category) },
      ],
      details: rowDetails(l),
    }),
    (l) => laneIn(LEAD_STATUSES, l.status),
  );

  const leadList = leads.length ? (
    <RecordTable items={leadRegister.items}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer Organisation</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Classification</TableHead>
            <TableHead>Probability</TableHead>
            <TableHead className="text-right">Value (₹ Lakh)</TableHead>
            <TableHead>Assigned Rep</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((l) => {
            const value = l.value_lakh || l.estimated_value_lakh;
            const place = [l.city, l.state].filter(Boolean).join(', ');
            return (
              <TableRow key={String(l.id)}>
                <TableCell className="font-bold text-[#14213D]">
                  {txt(l.organisation_name)}
                  {place && <div className="text-[10px] text-[#4A5568] font-normal">{place}</div>}
                </TableCell>
                <TableCell className="text-[#14213D]">{txt(l.product_name)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {l.category ? (
                    <Badge variant="outline" size="sm" className="font-bold">
                      {codeLabel(l.category)}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {l.probability ? (
                    <Badge variant={probabilityBadge(l.probability)} size="sm" className="uppercase font-bold">
                      {pretty(l.probability)}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">{value ? formatLakh(Number(value)) : '-'}</TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{l.assigned_to_name || 'Unassigned'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={statusBadge(l.status)} size="sm" className="uppercase font-bold">
                    {pretty(l.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const visitRegister = register(
    visits,
    (v): RecordItem => ({
      key: String(v.id),
      title: txt(v.organisation_name),
      subtitle: txt(v.location || v.city),
      status: { label: cap(v.status), tone: toneFor(v.status) },
      badges: v.manager_name ? [{ label: `Directive by ${v.manager_name}`, tone: 'info' }] : [],
      due: { date: v.planned_date, label: 'Planned', done: VISIT_DONE.includes(String(v.status || '').toLowerCase()) },
      owner: txt(v.assignee_name || v.assigned_to_name || v.planned_by_name),
      facts: [
        { label: 'Purpose', value: v.purpose || 'Client meeting' },
        { label: 'Planned', value: fmtDate(v.planned_date) },
      ],
      details: rowDetails(v),
    }),
    (v) => laneIn(VISIT_STATUSES, v.status),
  );

  const visitList = visits.length ? (
    <RecordTable items={visitRegister.items}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client & Destination</TableHead>
            <TableHead>Planned Date</TableHead>
            <TableHead>Sales Engineer</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Manager Also-Meet Directive</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visits.map((v) => {
            const place = v.location || v.city;
            const directive = v.manager_name ? `Directive by ${v.manager_name}` : undefined;
            return (
              <TableRow key={String(v.id)}>
                <TableCell className="font-bold text-[#14213D]">
                  {txt(v.organisation_name)}
                  {place && (
                    <div className="text-[10px] text-[#4A5568] font-normal flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-[#0F5E63]" />
                      <span>{place}</span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">{formatDateIN(v.planned_date)}</TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{txt(v.assignee_name || v.assigned_to_name || v.planned_by_name)}</TableCell>
                <TableCell className="text-[#4A5568] max-w-[240px] truncate" title={v.purpose || undefined}>
                  {v.purpose || 'Client meeting'}
                </TableCell>
                <TableCell className="text-[#4A5568] max-w-[240px] truncate" title={directive}>
                  {directive ? <span className="text-[#14213D] font-medium">{directive}</span> : '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={statusBadge(v.status)} size="sm" className="uppercase font-bold">
                    {pretty(v.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const expenseRegister = register(
    expenses,
    (e): RecordItem => ({
      key: String(e.id),
      title: txt(e.employee_name),
      subtitle: e.purpose || 'Travel expense',
      status: { label: txt(e.status), tone: toneFor(e.status) },
      due: { date: e.expense_date, label: 'Spent', done: true },
      value: formatINR(e.amount),
      facts: [
        { label: 'Category', value: cap(e.category) },
        { label: 'Date', value: fmtDate(e.expense_date) },
      ],
      details: rowDetails(e),
    }),
    (e) => laneIn(EXPENSE_LANE_KEYS, EXPENSE_STATUS_LABELS[e.status as keyof typeof EXPENSE_STATUS_LABELS] || e.status),
  );

  const expenseList = expenses.length ? (
    <RecordTable items={expenseRegister.items}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim No.</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Stage Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.map((e) => (
            <TableRow key={String(e.id)}>
              <TableCell className="font-bold whitespace-nowrap">
                <span className="font-mono text-[#0F5E63]">{txt(e.claim_number)}</span>
              </TableCell>
              <TableCell className="font-bold text-[#14213D]">
                {txt(e.employee_name)}
                {e.employee_code && <div className="text-[10px] text-[#4A5568] font-normal">{e.employee_code}</div>}
              </TableCell>
              <TableCell className="font-mono whitespace-nowrap">{formatDateIN(e.expense_date)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {e.category ? (
                  <Badge variant="outline" size="sm" className="font-bold">
                    {txt(e.category)}
                  </Badge>
                ) : (
                  <span className="text-[#4A5568]">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">{formatINR(e.amount)}</TableCell>
              <TableCell className="text-[#4A5568] max-w-[240px] truncate" title={e.purpose || undefined}>
                {e.purpose || 'Travel expense'}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge variant={statusBadge(expenseStatusKey(e.status))} size="sm" className="uppercase font-bold">
                  {pretty(e.status)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const serviceRegister = register(
    tickets,
    (s): RecordItem => {
      const st = normalizeServiceStatus(s.status);
      return {
        key: String(s.id),
        code: txt(s.ticket_no || s.ticket_number),
        title: txt(s.organisation_name),
        subtitle: txt(s.complaint || s.complaint_description),
        status: { label: SERVICE_STATUS_LABELS[st] ?? cap(s.status), tone: toneFor(st) },
        badges: s.priority ? [{ label: txt(s.priority).toUpperCase(), tone: s.priority === 'critical' ? 'danger' : 'neutral' }] : [],
        due: { date: s.sla_resolution_due_at || s.planned_visit_date, label: 'SLA due', done: SERVICE_DONE_STATUSES.includes(st) },
        owner: s.assigned_to_name || 'Unassigned',
        facts: [
          { label: 'Asset S/N', value: s.equipment_serial || 'N/A' },
          { label: 'Warranty', value: cap(s.warranty_status) },
        ],
        details: rowDetails(s),
      };
    },
    (s) => laneIn(SERVICE_STATUSES, normalizeServiceStatus(s.status)),
  );

  const serviceList = tickets.length ? (
    <RecordTable items={serviceRegister.items}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticket No</TableHead>
            <TableHead>Customer & Asset</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Warranty SLA</TableHead>
            <TableHead>Assigned Engineer</TableHead>
            <TableHead>Complaint Summary</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((s) => {
            const st = normalizeServiceStatus(s.status);
            const complaint = txt(s.complaint || s.complaint_description);
            return (
              <TableRow key={String(s.id)}>
                <TableCell className="font-bold whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{txt(s.ticket_no || s.ticket_number)}</span>
                </TableCell>
                <TableCell className="font-bold text-[#14213D]">
                  {txt(s.organisation_name)}
                  <div className="text-[10px] text-[#4A5568] font-normal">S/N: {s.equipment_serial || 'N/A'}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {s.priority ? (
                    <Badge variant={s.priority === 'critical' ? 'danger' : 'outline'} size="sm" className="uppercase font-bold">
                      {pretty(s.priority)}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {s.warranty_status ? (
                    <Badge variant="outline" size="sm" className="uppercase font-bold">
                      {pretty(s.warranty_status)}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{s.assigned_to_name || 'Unassigned'}</TableCell>
                <TableCell className="text-[#4A5568] max-w-[240px] truncate" title={complaint}>
                  {complaint}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={statusBadge(st)} size="sm" className="uppercase font-bold">
                    {SERVICE_STATUS_LABELS[st] ?? pretty(s.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  // Settlement register: one row per paid claim with how it was paid (UTR, date) and its Tally voucher.
  const settlementRegister = register(
    settlements,
    (c): RecordItem => ({
      key: String(c.id),
      code: c.claim_number,
      title: txt(c.employee_name),
      subtitle: c.region_name ? txt(c.region_name) : undefined,
      status: { label: 'Paid', tone: 'success' },
      value: formatINR(c.total_approved ?? 0),
      facts: [
        { label: 'Paid on', value: formatDateIN(c.payment_date) },
        { label: 'UTR', value: txt(c.payment_reference, 'Not recorded') },
        { label: 'Tally voucher', value: txt(c.tally_voucher_ref) },
      ],
      details: rowDetails(c),
    }),
    () => 'paid',
  );
  // Whole filtered set from the API's totals (only some pages are loaded); the loaded rows' sum until they arrive.
  const settlementCount: number = settlementsList.totals?.count ?? settlementsList.total;
  const settlementTotal: number =
    settlementsList.totals?.total_approved ?? settlements.reduce((sum, c) => sum + Number(c.total_approved || 0), 0);
  const settlementList = settlements.length ? (
    <RecordTable items={settlementRegister.items}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim No.</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Region</TableHead>
            <TableHead className="text-right">Paid Amount</TableHead>
            <TableHead>Payment Date</TableHead>
            <TableHead>UTR / Bank Ref</TableHead>
            <TableHead>Tally Voucher</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {settlements.map((c) => (
            <TableRow key={String(c.id)}>
              <TableCell className="font-bold whitespace-nowrap">
                <span className="font-mono text-[#0F5E63]">{txt(c.claim_number)}</span>
              </TableCell>
              <TableCell className="font-bold text-[#14213D]">{txt(c.employee_name)}</TableCell>
              <TableCell className="text-[#4A5568] whitespace-nowrap">{txt(c.region_name)}</TableCell>
              <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">{formatINR(c.total_approved ?? 0)}</TableCell>
              <TableCell className="font-mono whitespace-nowrap">{formatDateIN(c.payment_date)}</TableCell>
              <TableCell className="font-mono whitespace-nowrap">
                {c.payment_reference ? txt(c.payment_reference) : <span className="font-sans text-[#9A3412]">Not recorded</span>}
              </TableCell>
              <TableCell className="font-mono whitespace-nowrap">{txt(c.tally_voucher_ref)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-[#FBFAF7]">
            <TableCell colSpan={3} className="text-xs uppercase tracking-wide text-[#4A5568]">Total paid ({settlementCount} claims)</TableCell>
            <TableCell className="text-right font-mono font-bold text-[#14213D] whitespace-nowrap">{formatINR(settlementTotal)}</TableCell>
            <TableCell colSpan={3} />
          </TableRow>
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const filtersOn = Boolean(searchTerm.trim()) || statusFilter !== 'all';
  const emptyText = filtersOn ? 'No records match this search or status.' : 'No records in this report yet.';
  const summaryOf = (list: { rows: unknown[]; total: number }, one: string, many: string) => (
    <span className="font-mono text-xs">
      {list.rows.length} of {list.total} {list.total === 1 ? one : many}
    </span>
  );
  /** Infinite scroll for a register: the next page as the reader nears the end. */
  const pagingOf = (list: typeof tendersList) => ({ onLoadMore: list.loadMore, hasMore: list.hasMore, loadingMore: list.loadingMore });

  const statusOptions = dsOf(activeTab)?.statuses ?? [];

  const switchTab = (id: string) => {
    setActiveTab(id);
    setStatusFilter('all');
  };

  /** An instant as IST "DD/MM/YYYY HH:mm" for a CSV cell; "N/A" when missing. */
  const istStamp = (value: string | null | undefined): string => {
    const local = toIstLocalInput(value);
    return local ? `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}` : 'N/A';
  };

  // Generic CSV Exporter
  const exportToCsv = (filename: string, rows: Record<string, any>[]) => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const val = row[header];
            if (val === null || val === undefined) return '""';
            const escaped = String(val).replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(','),
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${istToday()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV exports carry the whole register with the current search and status filter, read from the API page by
  // page (the screen holds only the pages scrolled to so far).
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const runExport = async (key: string, filename: string, toRow: (r: any) => Record<string, any>) => {
    const ds = dsOf(key);
    setExporting(true);
    setExportError(null);
    try {
      const all: any[] = [];
      for (let page = 1; ; page++) {
        const res = await api.get(ds.url, { ...queryOf(ds, debouncedSearch, statusFilter), page, limit: EXPORT_PAGE_SIZE });
        const batch = rows(res);
        all.push(...(ds.row ? batch.map(ds.row) : batch));
        if (!batch.length || page >= Number(res?.totalPages ?? 1)) break;
      }
      exportToCsv(filename, all.map(toRow));
    } catch (err) {
      console.error(`Reports: ${ds.url} export failed`, err);
      setExportError(`We couldn't export ${ds.label}. Please try again in a moment.`);
    } finally {
      setExporting(false);
    }
  };

  // The bids matching the search and status filter, with IST dates and the bid value (QA BUG-013).
  const handleExportTenders = () =>
    runExport('tenders', 'Arihant_GeM_Tenders_Report', (t) => ({
      'Tender No': t.tender_no,
      'Organisation': t.organisation_name || t.department || 'N/A',
      'Category': tenderCategory(t),
      'Quantity': t.quantity || 0,
      'Estimated Value (INR)': t.estimated_value || 0,
      'EMD Fee (INR)': t.emd_fee || 0,
      'Bid Closing (IST)': istStamp(t.bid_closing_date),
      'Status': t.status?.toUpperCase() || 'IDENTIFIED',
      'Zone': t.zone_name || t.zone_code || 'N/A',
      'City': t.city || 'N/A',
    }));

  const handleExportLeads = () =>
    runExport('leads', 'Arihant_Sales_Funnel_Report', (l) => ({
      'Organisation': l.organisation_name || 'N/A',
      'Product': l.product_name || 'N/A',
      'Category': codeLabel(l.category, 'Follow Up'),
      'Probability': l.probability?.toUpperCase() || 'MEDIUM',
      'Deal Value (Lakh)': l.value_lakh || 0,
      'Status': l.status?.toUpperCase() || 'OPEN',
      'Assigned To': l.assigned_to_name || 'N/A',
      'Next Follow-Up': l.next_followup_date || 'N/A',
    }));

  const handleExportVisits = () =>
    runExport('visits', 'Arihant_Field_Visits_Report', (v) => ({
      'Organisation': v.organisation_name || 'N/A',
      'Location': v.location || v.city || 'N/A',
      'Planned Date': v.planned_date,
      'Status': v.status?.toUpperCase() || 'PLANNED',
      'Representative': v.assignee_name || 'N/A',
      'Purpose': v.purpose || 'N/A',
      'Manager Intervention': v.manager_name ? `Directive by ${v.manager_name}` : 'None',
    }));

  const handleExportExpenses = () =>
    runExport('expenses', 'Arihant_Expenses_Audit_Report', (e) => ({
      'Employee': e.employee_name || 'N/A',
      'Date': e.expense_date,
      'Category': txt(e.category, 'Travel'),
      'Amount (INR)': e.amount,
      'Status': e.status?.toUpperCase(),
      'Purpose': e.purpose || 'N/A',
      'Manager': e.manager_name || 'N/A',
      'Manager Remarks': e.manager_remarks || 'N/A',
    }));

  const handleExportSettlements = () =>
    runExport('settlements', 'Arihant_Expense_Settlements_Report', (c) => ({
      'Claim No': c.claim_number,
      'Employee': c.employee_name || 'N/A',
      'Region': c.region_name || 'N/A',
      'Paid Amount (INR)': c.total_approved ?? 0,
      'Payment Date': c.payment_date || 'N/A',
      'UTR / Bank Reference': c.payment_reference || 'Not recorded',
      'Tally Voucher': c.tally_voucher_ref || 'N/A',
    }));

  const handleExportService = () =>
    runExport('service', 'Arihant_Service_Desk_Report', (s) => ({
      'Ticket No': s.ticket_no,
      'Customer': s.organisation_name || 'N/A',
      'Equipment Serial': s.equipment_serial || 'N/A',
      'Priority': s.priority?.toUpperCase(),
      'Warranty Status': s.warranty_status?.toUpperCase() || 'IN_WARRANTY',
      'Status': s.status?.toUpperCase(),
      'Engineer': s.assigned_to_name || 'N/A',
      'Complaint': s.complaint || 'N/A',
    }));

  return (
    <PageContainer>
      {/* Top Banner */}
      <PageHeader
        title="Consolidated Operational Reports"
        icon={<FileText className="w-5 h-5 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2.5">
            {activeTab === 'tenders' && (
              <Button variant="outline" isLoading={exporting} disabled={exporting} onClick={handleExportTenders}>
                <Download className="h-4 w-4 mr-2" />
                Export Tenders CSV
              </Button>
            )}
            {activeTab === 'leads' && (
              <Button variant="outline" isLoading={exporting} disabled={exporting} onClick={handleExportLeads}>
                <Download className="h-4 w-4 mr-2" />
                Export Funnel CSV
              </Button>
            )}
            {activeTab === 'visits' && (
              <Button variant="outline" isLoading={exporting} disabled={exporting} onClick={handleExportVisits}>
                <Download className="h-4 w-4 mr-2" />
                Export Visits CSV
              </Button>
            )}
            {activeTab === 'expenses' && (
              <Button variant="outline" isLoading={exporting} disabled={exporting} onClick={handleExportExpenses}>
                <Download className="h-4 w-4 mr-2" />
                Export Expenses CSV
              </Button>
            )}
            {activeTab === 'settlements' && (
              <Button variant="outline" isLoading={exporting} disabled={exporting} onClick={handleExportSettlements}>
                <Download className="h-4 w-4 mr-2" />
                Export Settlements CSV
              </Button>
            )}
            {activeTab === 'service' && (
              <Button variant="outline" isLoading={exporting} disabled={exporting} onClick={handleExportService}>
                <Download className="h-4 w-4 mr-2" />
                Export Service CSV
              </Button>
            )}
          </div>
        }
      />
      <ReportsNav role={user?.role} />

      {/* KPI Highlights — one row; each card opens its report (click again keeps it). */}
      <StatGrid cols={(visible.size > 5 ? 3 : Math.min(5, Math.max(2, visible.size))) as 2 | 3 | 4 | 5} className="gap-3">
        {KPI_CARDS.filter((c) => visible.has(c.key)).map((c) => (
          <StatCard
            key={c.key}
            title={c.title}
            value={counts[c.key] ?? '—'}
            icon={c.icon}
            variant={c.variant}
            className={activeTab === c.key ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
            onClick={() => switchTab(c.key)}
          />
        ))}
      </StatGrid>

      {/* One filter row: report View first, then search + status dropdown */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu
            label="View"
            icon={<LayoutList />}
            neutralKeys={[]}
            className="shrink-0"
            options={DATASETS.filter((ds) => visible.has(ds.key)).map((ds) => ({
              key: ds.key,
              label: ds.label,
              icon: KPI_CARDS.find((c) => c.key === ds.key)?.icon,
              count: counts[ds.key],
              active: activeTab === ds.key,
              onSelect: () => switchTab(ds.key),
            }))}
          />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search this report"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search this report — number, organisation, person, status…"
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            {statusOptions.length > 0 && (
              <FilterMenu
                label="Status"
                icon={<Layers />}
                align="right"
                // Below `lg` the row stacks and this menu sits at the left edge, where a right-anchored panel
                // would open off-screen; anchor it left there. From `lg` up it is at the row's right end.
                className="max-lg:[&_.filter-menu-panel]:left-0 max-lg:[&_.filter-menu-panel]:right-auto [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                options={[
                  { key: 'all', label: 'All statuses', active: statusFilter === 'all', onSelect: () => setStatusFilter('all') },
                  ...statusOptions.map((st) => ({
                    key: st.key,
                    label: st.label,
                    active: statusFilter === st.key,
                    onSelect: () => setStatusFilter(st.key),
                  })),
                ]}
              />
            )}
            {(searchTerm || statusFilter !== 'all') && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {failed.length > 0 && (
        <InfoCallout variant="warning" title="Some reports are unavailable right now">
          <p>
            We couldn&apos;t load {failed.join(', ')}. The other reports are up to date. Please try again in a moment — if it keeps happening, contact your
            administrator.
          </p>
          <Button variant="secondary" size="xs" className="mt-2" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={retry}>
            Try again
          </Button>
        </InfoCallout>
      )}
      {exportError && (
        <InfoCallout variant="danger" onClose={() => setExportError(null)}>
          {exportError}
        </InfoCallout>
      )}

      {/* Content Body */}
      {activeList.loading ? (
        <PageLoader label="Loading consolidated records" />
      ) : (
        <>
          {activeTab === 'tenders' && (
            <RecordViews
              storageKey="reports-tenders"
              defaultView="list"
              list={tenderList}
              items={tenderRegister.items}
              lanes={TENDER_LANES}
              laneOf={tenderRegister.laneOf}
              hideEmptyLanes
              summary={summaryOf(tendersList, 'bid', 'bids')}
              {...pagingOf(tendersList)}
              empty={emptyText}
            />
          )}
          {activeTab === 'leads' && (
            <RecordViews
              storageKey="reports-leads"
              defaultView="list"
              list={leadList}
              items={leadRegister.items}
              lanes={LEAD_LANES}
              laneOf={leadRegister.laneOf}
              hideEmptyLanes
              summary={summaryOf(leadsList, 'lead', 'leads')}
              {...pagingOf(leadsList)}
              empty={emptyText}
            />
          )}
          {activeTab === 'visits' && (
            <RecordViews
              storageKey="reports-visits"
              defaultView="list"
              list={visitList}
              items={visitRegister.items}
              lanes={VISIT_LANES}
              laneOf={visitRegister.laneOf}
              hideEmptyLanes
              summary={summaryOf(visitsList, 'visit', 'visits')}
              {...pagingOf(visitsList)}
              empty={emptyText}
            />
          )}
          {activeTab === 'expenses' && (
            <RecordViews
              storageKey="reports-expenses"
              defaultView="list"
              list={expenseList}
              items={expenseRegister.items}
              lanes={EXPENSE_LANES}
              laneOf={expenseRegister.laneOf}
              hideEmptyLanes
              summary={summaryOf(expensesList, 'expense line', 'expense lines')}
              {...pagingOf(expensesList)}
              empty={emptyText}
            />
          )}
          {activeTab === 'settlements' && (
            <RecordViews
              storageKey="reports-settlements"
              defaultView="list"
              list={settlementList}
              items={settlementRegister.items}
              lanes={[{ key: 'paid', label: 'Paid', tone: 'success' }]}
              laneOf={settlementRegister.laneOf}
              hideEmptyLanes
              summary={summaryOf(settlementsList, 'settled claim', 'settled claims')}
              {...pagingOf(settlementsList)}
              empty={filtersOn ? emptyText : 'No claims have been paid yet.'}
            />
          )}
          {activeTab === 'service' && (
            <RecordViews
              storageKey="reports-service"
              defaultView="list"
              list={serviceList}
              items={serviceRegister.items}
              lanes={SERVICE_LANES}
              laneOf={serviceRegister.laneOf}
              hideEmptyLanes
              summary={summaryOf(ticketsList, 'ticket', 'tickets')}
              {...pagingOf(ticketsList)}
              empty={emptyText}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
