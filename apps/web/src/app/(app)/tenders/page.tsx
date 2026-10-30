'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FileText,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building,
  MapPin,
  Calendar,
  IndianRupee,
  ShieldCheck,
  Award,
  AlertCircle,
  User,
  TrendingUp,
  BarChart3,
  Layers,
  RefreshCw,
  Send,
  Check,
  Briefcase,
  AlertOctagon,
  Upload,
  Settings,
  UserCheck,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  LayoutList,
  SlidersHorizontal,
  ChevronRight,
} from 'lucide-react';
import { TenderDossierModal } from './components/TenderDossierModal';
import { tenderCategoryLabel, tenderEstimatedRupees, bidStillOpen } from '@/components/tender/labels';
import { roleLabel, userWithRole } from '@/lib/role-label';
import { ApprovalsInboxView } from './components/ApprovalsInboxView';
import { TenderCalendarView } from './components/TenderCalendarView';
import { FinanceEmdView } from './components/FinanceEmdView';
import { TenderSettingsModal } from './components/TenderSettingsModal';
import { BulkImportWizardModal } from './components/BulkImportWizardModal';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { type UrlParams, dropUrlParams, urlPicker } from '@/lib/url-filters';
import { canRead } from '@/lib/module-access';
import { getSocket } from '@/lib/socket';
import { useInfiniteList } from '@/lib/use-infinite-list';
import {
  PageContainer,
  PageHeader,
  SectionHeader,
  Card,
  Badge,
  Button,
  Input,
  Select,
  Textarea,
  Modal,
  StatCard,
  StatGrid,
  EmptyState,
  Spinner,
  FilterMenu,
  InfoCallout,
  FormSteps,
  FormSection,
  RecordViews,
  RecordTable,
  formatDateIN,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  toneFor,
  type RecordItem,
  type RecordAction,
  type BoardLane,
  type BadgeProps,
} from '@/components/ui';
import { formatINR, formatTaskDate, formatTaskDateTime } from '@arihant/shared';
import { istToday, istDateOf, addIsoDays, fromIstLocalInput, isIstToday } from '@/lib/ist-date';

/** Create-form default deadline: 14 IST days from today at 15:00 IST (a `datetime-local` value, IST wall clock). */
const defaultTenderDeadline = () => `${addIsoDays(istToday(), 14)}T15:00`;

// Lifecycle states and display labels
const STAGES = [
  { key: 'identified', label: 'Identified', color: 'default' as const },
  { key: 'awaiting_approval', label: 'Awaiting Approval', color: 'warning' as const },
  { key: 'rejected_internally', label: 'Rejected Internally', color: 'danger' as const },
  { key: 'under_preparation', label: 'Under Preparation', color: 'info' as const },
  { key: 'pq_submitted', label: 'PQ Submitted', color: 'info' as const },
  { key: 'pq_qualified', label: 'PQ Qualified', color: 'success' as const },
  { key: 'submitted', label: 'Tender Submitted', color: 'info' as const },
  { key: 'technical_eval', label: 'Technical Evaluation', color: 'cyber' as const },
  { key: 'commercial_eval', label: 'Commercial Evaluation', color: 'cyber' as const },
  { key: 'won', label: 'Won', color: 'success' as const },
  { key: 'lost', label: 'Lost', color: 'danger' as const },
  { key: 'cancelled', label: 'Cancelled', color: 'default' as const },
  { key: 'on_hold', label: 'On Hold', color: 'warning' as const },
] as const;

/** Display label of a stage code (an unknown code is shown de-underscored). */
const stageLabelOf = (status?: string | null) =>
  STAGES.find((s) => s.key === status)?.label || String(status || '').replace(/_/g, ' ');

const TENDER_SORT_FIELDS = [
  { key: 'created_at', label: 'Date added' },
  { key: 'submission_deadline', label: 'Submission deadline' },
  { key: 'estimated_value', label: 'Estimated value' },
  { key: 'publication_date', label: 'Publication date' },
];

type TenderView = 'pipeline' | 'approvals_inbox' | 'calendar' | 'finance_emd' | 'deadlines' | 'portal_issues' | 'analytics';

/** Tenders fetched per request while the register scrolls. */
const TENDERS_PAGE_SIZE = 25;

// Dashboard deep links (/tenders?deadline=urgent_48h&status=…&category=pq): the register's first filters, read from
// the URL before the first fetch. Unknown values (and every filter, for a role without the register) are ignored;
// the effect in the page then drops these keys from the address bar.
const TENDER_URL_KEYS = ['deadline', 'status', 'category'];
const tenderUrlFilters = (params: UrlParams, hasRegister: boolean) => {
  const q = new URLSearchParams(hasRegister ? params.toString() : '');
  const pick = urlPicker(q);
  return {
    deadline: pick('deadline', (v) => ['upcoming_7d', 'urgent_48h', 'due_today', 'overdue'].includes(v)),
    // one Stage option, or a set of raw statuses (comma list)
    status: pick('status', (v) => v.split(',').every((s) => STAGES.some((st) => st.key === s))),
    category: pick('category', (v) => ['pq', 'general_mha', 'other'].includes(v)),
  };
};

/** §21/§27 zone-wise and region-wise tender pipeline (rows from /tenders/reports/by-zone | by-region). */
function PipelineBreakdownTable({
  title,
  description,
  icon,
  rows,
  nameKey,
  idKey,
  secondaryKey,
  emptyText,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  rows: any[];
  nameKey: string;
  idKey: string;
  secondaryKey?: string;
  emptyText: string;
}) {
  return (
    <div className="bg-white rounded-[14px] border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
            {icon}
            <span>{title}</span>
          </h4>
          <p className="text-xs text-[#4A5568]">{description}</p>
        </div>
        <Badge variant="info" size="sm">
          <span className="font-mono">{rows.length}</span>
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
              <th className="p-2.5">Name</th>
              <th className="p-2.5 text-center">Total</th>
              <th className="p-2.5 text-center">PQ</th>
              <th className="p-2.5 text-center">General / MHA</th>
              <th className="p-2.5 text-center">Submitted</th>
              <th className="p-2.5 text-center">Won</th>
              <th className="p-2.5 text-center">Lost</th>
              <th className="p-2.5 text-center">Pending</th>
              <th className="p-2.5 text-right">Win Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ECE9E2]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-4 text-center text-xs text-[#4A5568]">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const won = Number(r.won ?? r.won_tenders ?? 0);
                const lost = Number(r.lost ?? r.lost_tenders ?? 0);
                const decided = won + lost;
                return (
                  <tr key={r[idKey] || r[nameKey]} className="hover:bg-[#FBFAF7]">
                    <td className="p-2.5">
                      <div className="font-bold text-[#14213D]">{r[nameKey] || 'Unmapped'}</div>
                      {secondaryKey && r[secondaryKey] ? <div className="text-[10px] text-[#6B7280]">{r[secondaryKey]}</div> : null}
                    </td>
                    <td className="p-2.5 text-center font-mono font-bold text-[#0F5E63]">{r.total ?? r.total_tenders ?? 0}</td>
                    <td className="p-2.5 text-center font-mono text-[#14213D]">{r.pq_count ?? 0}</td>
                    <td className="p-2.5 text-center font-mono text-[#14213D]">{r.general_mha_count ?? 0}</td>
                    <td className="p-2.5 text-center font-mono text-[#0B4A4E]">{r.submitted ?? r.submitted_tenders ?? 0}</td>
                    <td className="p-2.5 text-center font-mono font-bold text-[#0B4A4E]">{won}</td>
                    <td className="p-2.5 text-center font-mono text-[#881337]">{lost}</td>
                    <td className="p-2.5 text-center font-mono text-[#7C2D12]">{r.pending ?? r.pending_tenders ?? 0}</td>
                    <td className="p-2.5 text-right font-mono font-bold text-[#0B4A4E]">
                      {decided > 0 ? `${Math.round((won / decided) * 100)}%` : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TendersPage() {
  const { user, hasRole } = useAuth();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const highlightOpened = useRef<string | null>(null);

  // Finance, EMD & PBG view: same roles as GET /tenders/finance/emd-tracking. Accounts may read only that view
  // (not the register, dashboard or reports), so for Accounts the page is the Finance view alone and fires nothing else.
  const canSeeFinance = canRead(user?.role, 'tenderFinance');
  const isFinanceOnly = canSeeFinance && !canRead(user?.role, 'tenders');

  // Current view (switched from the View menu, the first control of the filter row)
  const [activeTab, setActiveTab] = useState<TenderView>(() => (isFinanceOnly ? 'finance_emd' : 'pipeline'));

  // Master lists
  // (the tenders register itself is useInfiniteList below, paged as the reader scrolls)

  // Master Lookups
  const [categories, setCategories] = useState<any[]>([]);
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Executive Dashboard Stats (14 Metrics + Win Rate %)
  const [dashboardStats, setDashboardStats] = useState<any>({
    total: 0,
    pq_count: 0,
    general_mha_count: 0,
    other_count: 0,
    under_preparation: 0,
    submitted: 0,
    won: 0,
    lost: 0,
    pending: 0,
    pending_approvals: 0,
    upcoming_deadlines: 0,
    urgent_deadlines: 0,
    overdue: 0,
    result_followups: 0,
    open_portal_issues: 0,
    win_rate: 0,
    win_rate_percentage: 0,
  });
  // The same metrics over the caller's whole scope (no register filter): the Analytics tiles and the Deadlines counts,
  // whose views never show the register filters.
  const [overallStats, setOverallStats] = useState<any>(null);

  // Executive Reports State (§21, §26, §27)
  const [organisationReport, setOrganisationReport] = useState<any[]>([]);
  const [zoneReport, setZoneReport] = useState<any[]>([]);
  const [regionReport, setRegionReport] = useState<any[]>([]);
  const [salespersonReport, setSalespersonReport] = useState<any[]>([]);
  const [pipelineReport, setPipelineReport] = useState<any>({ total: 0, stages: [], categories: [] });
  const [winLossReport, setWinLossReport] = useState<any>({ won: 0, lost: 0, win_rate: 0, loss_reasons: {}, competitors: {} });
  const [globalPortalIssues, setGlobalPortalIssues] = useState<any[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // Geographic Masters (§21 Zone & Region Structure)
  const [zonesMaster, setZonesMaster] = useState<any[]>([]);
  const [regionsMaster, setRegionsMaster] = useState<any[]>([]);

  // Filter Bar state
  const [urlFilters] = useState(() => tenderUrlFilters(searchParams, !isFinanceOnly));
  useEffect(() => {
    dropUrlParams(TENDER_URL_KEYS);
  }, []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(urlFilters.status);
  const [categoryFilter, setCategoryFilter] = useState(urlFilters.category);
  const [zoneFilter, setZoneFilter] = useState('');
  const [deadlineFilter, setDeadlineFilter] = useState(urlFilters.deadline);
  const [assignedFilter, setAssignedFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeHudFilter, setActiveHudFilter] = useState<string | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  // Phones: the filter chips fold behind one "Filters" button so the register starts near the top of the screen.
  const [isPhoneFiltersOpen, setIsPhoneFiltersOpen] = useState(false);

  // Detail Modal & Sub-panels
  const [selectedTender, setSelectedTender] = useState<any | null>(null);

  // Enterprise Blueprint Modals
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierTenderId, setDossierTenderId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Action Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);
  const [isNewIssueOpen, setIsNewIssueOpen] = useState(false);
  const [isTransitionOpen, setIsTransitionOpen] = useState(false);

  // 15+ North Tender Sheet Create Form State (§19-§21)
  const [newTender, setNewTender] = useState({
    tender_no: '',
    portal: 'GeM',
    organisation_id: '',
    department: '',
    product_id: '',
    city: '',
    state: '',
    zone_id: '',
    region_id: '',
    zone: 'North',
    region: 'Delhi NCR',
    category: 'general_mha',
    requirement_text: '',
    quantity: 1,
    emd_fee: 0,
    estimated_value_lakh: '',
    publication_date: istToday(),
    submission_deadline: defaultTenderDeadline(),
    assigned_person_id: '',
    tender_owner_id: '',
    remarks: '',
  });

  // Approval Form State
  const [approvalDecision, setApprovalDecision] = useState<'approved' | 'rejected'>('approved');
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Structured Win / Loss Outcome Form State (§26)
  const [outcomeResult, setOutcomeResult] = useState<'won' | 'lost'>('won');
  const [outcomeValueLakh, setOutcomeValueLakh] = useState('');
  const [outcomeProductId, setOutcomeProductId] = useState('');
  const [outcomeRegionId, setOutcomeRegionId] = useState('');
  const [outcomeResponsiblePersonId, setOutcomeResponsiblePersonId] = useState('');
  const [outcomeCategory, setOutcomeCategory] = useState('general_mha');
  const [outcomeLossReason, setOutcomeLossReason] = useState('price');
  const [outcomeCompetitor, setOutcomeCompetitor] = useState('');
  const [outcomeTechnicalIssue, setOutcomeTechnicalIssue] = useState('');
  const [outcomePricingIssue, setOutcomePricingIssue] = useState('');
  const [outcomeEligibilityIssue, setOutcomeEligibilityIssue] = useState('');
  const [outcomeDocumentationIssue, setOutcomeDocumentationIssue] = useState('');
  const [outcomeOtherReason, setOutcomeOtherReason] = useState('');
  const [outcomeRemarks, setOutcomeRemarks] = useState('');
  const [outcomeResultDate, setOutcomeResultDate] = useState(istToday());

  // Transition Form State
  const [targetTransitionStatus, setTargetTransitionStatus] = useState('');
  const [transitionRemarks, setTransitionRemarks] = useState('');
  const [transitionSubmissionDate, setTransitionSubmissionDate] = useState(istToday());

  // Portal Issue Form State (§25)
  const [issueTenderId, setIssueTenderId] = useState('');
  const [issueReportedDate, setIssueReportedDate] = useState(istToday());
  const [newIssueText, setNewIssueText] = useState('');
  const [issueResponsiblePerson, setIssueResponsiblePerson] = useState('');
  const [issueEscalatedTo, setIssueEscalatedTo] = useState('');
  const [issueResolutionStatus, setIssueResolutionStatus] = useState('OPEN');

  const [actionError, setActionError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<{ type: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The Approvals Inbox reports its total (same server rule as the KPI) so every count on screen agrees. The inbox is
  // never filtered, so its total only stands in for the KPI while no register filter narrows the KPIs.
  const registerFiltersActive = useRef(false);
  const handleInboxCount = useCallback((count: number) => {
    if (registerFiltersActive.current) return;
    setDashboardStats((prev: any) => (prev?.pending_approvals === count ? prev : { ...prev, pending_approvals: count }));
  }, []);

  // 1. Fetch Lookups (§21 Zone & Region Structure)
  const fetchMasters = async () => {
    try {
      const [catsRes, orgsRes, prodsRes, usersRes, zonesRes, regionsRes] = await Promise.all([
        api.get('/tenders/categories').catch(() => []),
        api.get('/organisations', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/products').catch(() => []),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/masters/zones').catch(() => []),
        api.get('/masters/regions').catch(() => []),
      ]);

      setCategories(Array.isArray(catsRes) ? catsRes : []);
      setOrganisations(orgsRes.data || []);
      setProducts(Array.isArray(prodsRes) ? prodsRes : prodsRes.data || []);
      setUsers(usersRes.data || []);
      setZonesMaster(Array.isArray(zonesRes) ? zonesRes : []);
      setRegionsMaster(Array.isArray(regionsRes) ? regionsRes : []);
    } catch (err) {
      console.error('Failed to load masters:', err);
    }
  };

  // 2. Fetch Executive Dashboard Metrics — over the register's active filters (see `filterParams`).
  const dashboardRequest = useRef(0);
  const fetchDashboardStats = async () => {
    if (isFinanceOnly) return;
    const request = ++dashboardRequest.current;
    const params = filterParams;
    try {
      const res = await api.get('/tenders/dashboard', params);
      if (res && request === dashboardRequest.current) {
        setDashboardStats(res);
        // An unfiltered answer is also the whole-scope picture (see `overallStats`); with a filter on, refresh that
        // picture too so the Deadlines badge and Analytics tiles never lag behind a change made on the Pipeline tab.
        if (Object.keys(params).length === 0) setOverallStats(res);
        else fetchOverallStats();
      }
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
    }
  };

  // Whole-scope metrics while a register filter is on (with no filter, fetchDashboardStats keeps them current).
  const fetchOverallStats = useCallback(async () => {
    try {
      const res = await api.get('/tenders/dashboard');
      if (res) setOverallStats(res);
    } catch (err) {
      console.error('Failed to load overall tender metrics:', err);
    }
  }, []);

  // 3. Fetch Executive Reports (§21 Organisation, Zone, Region, Salesperson)
  const fetchReports = async () => {
    setIsLoadingReports(true);
    try {
      if (user?.role === 'sales') {
        const portalIssuesRes = await api.get('/tenders/portal-issues').catch(() => []);
        setGlobalPortalIssues(Array.isArray(portalIssuesRes) ? portalIssuesRes : []);
        return;
      }

      // Zone/region/salesperson/organisation breakdowns are management-level reports.
      const breakdown = (url: string) => (canRead(user?.role, 'tenderReports') ? api.get(url).catch(() => []) : Promise.resolve([]));
      const [zonesRes, regionsRes, salesRes, orgsReportRes, pipelineRes, winLossRes, portalIssuesRes] = await Promise.all([
        breakdown('/tenders/reports/by-zone'),
        breakdown('/tenders/reports/by-region'),
        breakdown('/tenders/reports/by-salesperson'),
        breakdown('/tenders/reports/by-organisation'),
        api.get('/tenders/reports/pipeline').catch(() => ({ total: 0, stages: [], categories: [] })),
        api.get('/tenders/reports/win-loss').catch(() => ({ won: 0, lost: 0, win_rate: 0, loss_reasons: {}, competitors: {} })),
        api.get('/tenders/portal-issues').catch(() => []),
      ]);

      setZoneReport(Array.isArray(zonesRes) ? zonesRes : []);
      setRegionReport(Array.isArray(regionsRes) ? regionsRes : []);
      setSalespersonReport(Array.isArray(salesRes) ? salesRes : []);
      setOrganisationReport(Array.isArray(orgsReportRes) ? orgsReportRes : []);
      setPipelineReport(pipelineRes || { total: 0, stages: [], categories: [] });
      setWinLossReport(winLossRes || { won: 0, lost: 0, win_rate: 0, loss_reasons: {}, competitors: {} });
      setGlobalPortalIssues(Array.isArray(portalIssuesRes) ? portalIssuesRes : []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setIsLoadingReports(false);
    }
  };

  // View guard: a role only ever sits on a view it may use (deep links, tab selection, role switches).
  useEffect(() => {
    if (isFinanceOnly) {
      if (activeTab !== 'finance_emd') setActiveTab('finance_emd');
    } else if (activeTab === 'finance_emd' && !canSeeFinance) {
      setActiveTab('pipeline');
    } else if (user?.role === 'sales' && ['approvals_inbox', 'analytics'].includes(activeTab)) {
      setActiveTab('pipeline');
    }
  }, [user?.role, activeTab, isFinanceOnly, canSeeFinance]);

  // Sync searchParams with assignedFilter. Sales are not narrowed here: the API already limits them to the tenders
  // they are assigned, own or created ("my tenders"), and they have no Assignee filter to clear one with.
  useEffect(() => {
    if (user?.role === 'sales') return;
    const scopeParam = searchParams.get('scope');
    const assignedParam = searchParams.get('assigned_to');
    if (scopeParam === 'my_tenders' && user?.id) {
      setAssignedFilter(user.id);
    } else if (assignedParam) {
      setAssignedFilter(assignedParam);
    }
  }, [searchParams, user]);

  // 4. Tenders register (server-side search, filters and sort), one page per request, appended as
  // the register scrolls. `fetchTenders` re-reads the pages already loaded, in place.
  // The active filters go to both GET /tenders and GET /tenders/dashboard, so the KPI cards and menu counts follow them.
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (statusFilter) params.status = statusFilter;
    if (categoryFilter) params.category = categoryFilter;
    if (zoneFilter) params.zone_id = zoneFilter;
    if (deadlineFilter) params.deadline = deadlineFilter;
    if (assignedFilter) params.assigned_to = assignedFilter;
    return params;
  }, [search, statusFilter, categoryFilter, zoneFilter, deadlineFilter, assignedFilter]);
  registerFiltersActive.current = Object.keys(filterParams).length > 0;

  const fetchTendersPage = useCallback(
    (page: number) =>
      // Accounts may not read the register (GET /tenders): never ask.
      isFinanceOnly
        ? Promise.resolve([])
        : api.get('/tenders', { page, limit: TENDERS_PAGE_SIZE, sortBy, sortOrder, ...filterParams }),
    [filterParams, sortBy, sortOrder, isFinanceOnly],
  );
  const tendersList = useInfiniteList<any>(fetchTendersPage, { enabled: !isFinanceOnly });
  const { rows: tenders, total: totalCount, loading: isLoading, refresh: fetchTenders } = tendersList;

  // Auto-open highlight if specified in URL query — once, even when the tender is not in the loaded pages.
  useEffect(() => {
    if (isFinanceOnly || !highlightId || isLoading || highlightOpened.current === highlightId) return;
    highlightOpened.current = highlightId;
    const loaded = tenders.find((t: any) => t.id === highlightId);
    (loaded ? Promise.resolve(loaded) : api.get(`/tenders/${highlightId}`).catch(() => null)).then((found) => {
      if (found) openTenderDetails(found);
    });
  }, [highlightId, isLoading, tenders]);

  // Initial load (Accounts: none of these endpoints are open to it, and the Finance view loads its own data)
  useEffect(() => {
    if (isFinanceOnly) return;
    fetchMasters();
    fetchReports();
  }, []);

  // KPI cards and menu counts follow the filters: refetch (debounced, so typing a search is one request) on every change.
  useEffect(() => {
    const timer = setTimeout(fetchDashboardStats, 300);
    return () => clearTimeout(timer);
  }, [filterParams]);

  // Real-time Event-Driven Synchronization via Socket.IO
  useEffect(() => {
    const socket = getSocket();
    if (!socket || isFinanceOnly) return;

    const handleTenderRealtimeEvent = () => {
      fetchTenders();
      fetchDashboardStats();
      fetchReports();
    };

    socket.on('tender:created', handleTenderRealtimeEvent);
    socket.on('tender:updated', handleTenderRealtimeEvent);
    socket.on('tender:status_changed', handleTenderRealtimeEvent);
    socket.on('tender:approved', handleTenderRealtimeEvent);
    socket.on('tender:won', handleTenderRealtimeEvent);
    socket.on('tender:lost', handleTenderRealtimeEvent);
    socket.on('tender:portal_issue_created', handleTenderRealtimeEvent);
    socket.on('tender:portal_issue_resolved', handleTenderRealtimeEvent);

    return () => {
      socket.off('tender:created', handleTenderRealtimeEvent);
      socket.off('tender:updated', handleTenderRealtimeEvent);
      socket.off('tender:status_changed', handleTenderRealtimeEvent);
      socket.off('tender:approved', handleTenderRealtimeEvent);
      socket.off('tender:won', handleTenderRealtimeEvent);
      socket.off('tender:lost', handleTenderRealtimeEvent);
      socket.off('tender:portal_issue_created', handleTenderRealtimeEvent);
      socket.off('tender:portal_issue_resolved', handleTenderRealtimeEvent);
    };
  }, [fetchTenders]);

  // Open Tender Detail & Fetch History & Portal Issues
  const openTenderDetails = (tender: any) => {
    setSelectedTender(tender);
    setDossierTenderId(tender.id);
    setIsDossierOpen(true);
  };

  // Quick HUD card filter handler
  const handleHudClick = (filterType: string, val: string) => {
    setActiveTab('pipeline');
    if (activeHudFilter === filterType) {
      // Clear filter
      setActiveHudFilter(null);
      setStatusFilter('');
      setCategoryFilter('');
      setDeadlineFilter('');
    } else {
      setActiveHudFilter(filterType);
      if (filterType === 'pq') {
        setCategoryFilter('pq');
        setStatusFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'general_mha') {
        setCategoryFilter('general_mha');
        setStatusFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'awaiting_approval') {
        setStatusFilter('awaiting_approval');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'under_preparation') {
        setStatusFilter('under_preparation');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'submitted') {
        setStatusFilter('submitted');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'won') {
        setStatusFilter('won');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'lost') {
        setStatusFilter('lost');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'urgent_deadlines') {
        setDeadlineFilter('urgent_48h');
        setStatusFilter('');
        setCategoryFilter('');
      } else if (filterType === 'upcoming_deadlines') {
        setDeadlineFilter('upcoming_7d');
        setStatusFilter('');
        setCategoryFilter('');
      } else if (filterType === 'overdue') {
        setDeadlineFilter('overdue');
        setStatusFilter('');
        setCategoryFilter('');
      } else {
        setStatusFilter('');
        setCategoryFilter('');
        setDeadlineFilter('');
      }
    }
  };

  // Cascading Region helper based on selected Zone (§21)
  const availableRegions = useMemo(() => {
    if (!newTender.zone_id && !newTender.zone) return regionsMaster;
    const selectedZone = zonesMaster.find(
      (z) => z.id === newTender.zone_id || z.name?.toLowerCase() === newTender.zone?.toLowerCase(),
    );
    if (!selectedZone) return regionsMaster;
    return regionsMaster.filter((r) => r.zone_id === selectedZone.id);
  }, [newTender.zone_id, newTender.zone, zonesMaster, regionsMaster]);

  // Handle Organisation change with auto-population of geo mapping
  const handleOrgChange = (orgId: string) => {
    const selectedOrg = organisations.find((o) => o.id === orgId);
    if (!selectedOrg) {
      setNewTender((prev) => ({ ...prev, organisation_id: orgId }));
      return;
    }

    const matchedZone = zonesMaster.find((z) => z.id === selectedOrg.zone_id);
    const matchedRegion = regionsMaster.find((r) => r.id === selectedOrg.region_id);

    setNewTender((prev) => ({
      ...prev,
      organisation_id: orgId,
      department: prev.department || selectedOrg.name,
      city: prev.city || selectedOrg.city || '',
      state: prev.state || selectedOrg.state || '',
      zone_id: selectedOrg.zone_id || prev.zone_id,
      zone: matchedZone ? matchedZone.name : prev.zone,
      region_id: selectedOrg.region_id || prev.region_id,
      region: matchedRegion ? matchedRegion.name : prev.region,
    }));
  };

  // Handle Zone change with cascading Region update
  const handleZoneChange = (zoneVal: string) => {
    const matchedZone = zonesMaster.find((z) => z.id === zoneVal || z.name === zoneVal);
    const zId = matchedZone ? matchedZone.id : zoneVal;
    const zName = matchedZone ? matchedZone.name : zoneVal;
    const validRegions = regionsMaster.filter((r) => r.zone_id === zId);
    const firstRegion = validRegions[0];

    setNewTender((prev) => ({
      ...prev,
      zone_id: zId,
      zone: zName,
      region_id: firstRegion ? firstRegion.id : '',
      region: firstRegion ? firstRegion.name : '',
    }));
  };

  // Handle Region change
  const handleRegionChange = (regVal: string) => {
    const matchedRegion = regionsMaster.find((r) => r.id === regVal || r.name === regVal);
    setNewTender((prev) => ({
      ...prev,
      region_id: matchedRegion ? matchedRegion.id : regVal,
      region: matchedRegion ? matchedRegion.name : regVal,
    }));
  };

  // 4. Handle Create Tender (All 15+ Indicative Sheet Fields)
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    if (!newTender.tender_no.trim()) {
      setActionError('Tender number is mandatory.');
      return;
    }

    if (!newTender.organisation_id) {
      setActionError('Please select a mapped organisation for tender registration.');
      return;
    }

    // Same numeric rules as the API: quantity ≥ 1, money never negative.
    if (!(Number(newTender.quantity) >= 1)) {
      setActionError('Quantity must be at least 1.');
      return;
    }
    if (newTender.estimated_value_lakh !== '' && !(Number(newTender.estimated_value_lakh) >= 0)) {
      setActionError('Estimated value cannot be negative.');
      return;
    }
    if (!(Number(newTender.emd_fee) >= 0)) {
      setActionError('EMD fee cannot be negative.');
      return;
    }

    // The deadline box is an IST wall-clock `datetime-local`; convert it as IST (never as browser/UTC time).
    const deadlineIso = fromIstLocalInput(newTender.submission_deadline);
    if (!deadlineIso) {
      setActionError('Submission deadline (date and time, IST) is mandatory.');
      return;
    }
    if (newTender.publication_date) {
      if (istDateOf(deadlineIso) < newTender.publication_date) {
        setActionError('Submission deadline cannot be earlier than publication date.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await api.post('/tenders', {
        tender_no: newTender.tender_no.trim(),
        tender_number: newTender.tender_no.trim(),
        portal: newTender.portal,
        organisation_id: newTender.organisation_id || undefined,
        department: newTender.department.trim(),
        product_id: newTender.product_id || undefined,
        city: newTender.city.trim(),
        state: newTender.state.trim(),
        zone_id: newTender.zone_id || undefined,
        zone: newTender.zone,
        region_id: newTender.region_id || undefined,
        region: newTender.region,
        category: newTender.category,
        tender_category: newTender.category,
        // No stage is sent: every new bid starts at Identified and goes through internal approval (server rule).
        requirement_text: newTender.requirement_text.trim(),
        quantity: Number(newTender.quantity) || 1,
        emd_fee: Number(newTender.emd_fee) || 0,
        // An EMD fee means EMD is payable: the dossier shows it and an EMD instrument is opened for Finance.
        emd_required: Number(newTender.emd_fee) > 0,
        estimated_value_lakh: newTender.estimated_value_lakh ? Number(newTender.estimated_value_lakh) : undefined,
        publication_date: newTender.publication_date,
        submission_deadline: deadlineIso,
        assigned_person_id: newTender.assigned_person_id || undefined,
        tender_owner_id: newTender.tender_owner_id || undefined,
        remarks: newTender.remarks.trim() || undefined,
      });

      setIsCreateOpen(false);
      setNewTender({
        tender_no: '',
        portal: 'GeM',
        organisation_id: '',
        department: '',
        product_id: '',
        city: '',
        state: '',
        zone_id: '',
        region_id: '',
        zone: 'North',
        region: 'Delhi NCR',
        category: 'general_mha',
        requirement_text: '',
        quantity: 1,
        emd_fee: 0,
        estimated_value_lakh: '',
        publication_date: istToday(),
        submission_deadline: defaultTenderDeadline(),
        assigned_person_id: '',
        tender_owner_id: '',
        remarks: '',
      });

      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to register tender.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Action: Submit for Internal Review (§24)
  const handleQuickRequestApproval = async (tender: any) => {
    setPageNotice(null);
    // Same rule as the API: a tender cannot go for review without an assigned salesperson.
    if (!tender.assigned_to && !tender.assigned_person_id) {
      setPageNotice({
        type: 'danger',
        text: `${tender.tender_number || tender.tender_no}: assign a salesperson (Inspect → Overview → Reassign Team) before submitting for review.`,
      });
      return;
    }
    try {
      await api.post(`/tenders/${tender.id}/request-approval`, {
        remarks: 'Submitted for internal review by sales/tender team',
      });
      setPageNotice({
        type: 'success',
        text: `${tender.tender_number || tender.tender_no} submitted for review — it is now in Management's Approvals Inbox.`,
      });
      await Promise.all([fetchTenders(), fetchDashboardStats()]);
    } catch (err: any) {
      setPageNotice({
        type: 'danger',
        text: `${tender.tender_number || tender.tender_no}: ${err?.message || 'Could not submit the tender for review.'}`,
      });
    }
  };

  // Quick Action: Resume a held tender (POST /tenders/:id/resume restores the stage it was held at).
  const resumingTenderId = useRef<string | null>(null);
  const handleQuickResume = async (tender: any) => {
    // One resume per click: a second request would be refused (no longer on hold) and replace the success notice.
    if (resumingTenderId.current) return;
    resumingTenderId.current = tender.id;
    setPageNotice(null);
    const tenderNo = tender.tender_number || tender.tender_no;
    try {
      await api.post(`/tenders/${tender.id}/resume`, {
        expected_version: typeof tender.version === 'number' ? tender.version : undefined,
      });
      setPageNotice({ type: 'success', text: `${tenderNo} resumed at ${stageLabelOf(tender.status_before_hold || tender.status)}.` });
      await Promise.all([fetchTenders(), fetchDashboardStats()]);
    } catch (err: any) {
      setPageNotice({ type: 'danger', text: `${tenderNo}: ${err?.message || 'Could not resume the tender.'}` });
    } finally {
      resumingTenderId.current = null;
    }
  };

  // 5. Handle Approval Submit (Independent Dual-Control Signoff)
  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender) return;
    setActionError(null);

    if (approvalDecision === 'rejected' && !rejectionReason.trim()) {
      setActionError('A valid rejection reason is mandatory when declining participation.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/tenders/${selectedTender.id}/approve`, {
        decision: approvalDecision,
        remarks: approvalRemarks.trim() || undefined,
        rejection_reason: approvalDecision === 'rejected' ? rejectionReason : undefined,
      });

      setIsApproveOpen(false);
      setApprovalRemarks('');
      setRejectionReason('');
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit approval decision.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Handle Workflow Transitions
  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender || !targetTransitionStatus) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/tenders/${selectedTender.id}/transitions`, {
        target_status: targetTransitionStatus,
        remarks: transitionRemarks,
        submission_date: targetTransitionStatus === 'submitted' ? transitionSubmissionDate : undefined,
      });

      setIsTransitionOpen(false);
      setTargetTransitionStatus('');
      setTransitionRemarks('');
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to transition tender stage.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to open Win/Loss Outcome Modal with prefilled tender data (§26)
  const openOutcomeModal = (tender: any) => {
    setSelectedTender(tender);
    // The dossier's Lifecycle cards ("Result: Won" / "Result: Lost") open this form pre-set to their verdict.
    setOutcomeResult(tender?.preset_result === 'lost' ? 'lost' : 'won');
    setOutcomeValueLakh(
      tender.estimated_value_lakh || tender.estimated_value
        ? String(tender.estimated_value_lakh || tender.estimated_value / 100000)
        : ''
    );
    setOutcomeProductId(tender.product_id || '');
    setOutcomeRegionId(tender.region_id || '');
    setOutcomeResponsiblePersonId(tender.assigned_to || tender.assigned_person_id || tender.tender_owner_id || '');
    setOutcomeCategory(tender.category || 'general_mha');
    setOutcomeLossReason('price');
    setOutcomeCompetitor('');
    setOutcomeTechnicalIssue('');
    setOutcomePricingIssue('');
    setOutcomeEligibilityIssue('');
    setOutcomeDocumentationIssue('');
    setOutcomeOtherReason('');
    setOutcomeRemarks('');
    setOutcomeResultDate(istToday());
    setActionError(null);
    setIsOutcomeOpen(true);
  };

  // §25 affected-tender picker: a debounced lookup over every tender in scope (GET /tenders?search=…), not only the
  // register pages loaded so far. The picked tender stays listed while the search text changes.
  const [issueTenderQuery, setIssueTenderQuery] = useState('');
  const [issueTenderMatches, setIssueTenderMatches] = useState<any[]>([]);
  const [issueTenderPicked, setIssueTenderPicked] = useState<any | null>(null);
  const [isSearchingIssueTenders, setIsSearchingIssueTenders] = useState(false);
  useEffect(() => {
    if (!isNewIssueOpen) return;
    let alive = true;
    setIsSearchingIssueTenders(true);
    const timer = setTimeout(() => {
      const q = issueTenderQuery.trim();
      api
        .get('/tenders', { ...(q ? { search: q } : {}), limit: 20, sortBy: 'created_at', sortOrder: 'desc' })
        .then((res: any) => alive && setIssueTenderMatches(Array.isArray(res) ? res : res?.data || []))
        .catch(() => alive && setIssueTenderMatches([]))
        .finally(() => alive && setIsSearchingIssueTenders(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [isNewIssueOpen, issueTenderQuery]);
  const issueTenderOptions = useMemo(
    () =>
      issueTenderPicked && !issueTenderMatches.some((t) => t.id === issueTenderPicked.id)
        ? [issueTenderPicked, ...issueTenderMatches]
        : issueTenderMatches,
    [issueTenderMatches, issueTenderPicked],
  );

  // Helper to open GeM / Portal Issue Modal (§25)
  const openNewIssueModal = (tender?: any) => {
    setActionError(null);
    setIssueTenderQuery('');
    if (tender) {
      setSelectedTender(tender);
      setIssueTenderId(tender.id);
      setIssueTenderPicked(tender);
      setIssueResponsiblePerson(tender.assigned_to || tender.assigned_person_id || '');
    } else {
      // Logged from the hub: no tender is pre-selected (never silently the first one) — the user picks it.
      setSelectedTender(null);
      setIssueTenderId('');
      setIssueTenderPicked(null);
      setIssueResponsiblePerson('');
    }
    setNewIssueText('');
    setIssueEscalatedTo('');
    setIssueReportedDate(istToday());
    setIssueResolutionStatus('OPEN');
    setIsNewIssueOpen(true);
  };

  // 7. Handle Structured Win / Loss Outcome Submit (§26)
  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender) return;
    setActionError(null);

    if (outcomeResult === 'lost' && !outcomeLossReason) {
      setActionError('Structured loss reason is mandatory for post-mortem loss analysis.');
      return;
    }
    if (outcomeResult === 'lost' && outcomeLossReason === 'other' && !outcomeOtherReason.trim()) {
      setActionError('Describe the reason in "Other Reason Notes" when the loss reason is Other.');
      return;
    }
    if (outcomeResultDate && outcomeMinResultDate && outcomeResultDate < outcomeMinResultDate) {
      setActionError(`Result date cannot be earlier than the bid closing date (${formatTaskDate(outcomeMinResultDate)}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const fullReasonNote = [
        outcomeLossReason ? `Category: ${outcomeLossReason.toUpperCase()}` : null,
        outcomeTechnicalIssue ? `Technical: ${outcomeTechnicalIssue}` : null,
        outcomePricingIssue ? `Pricing: ${outcomePricingIssue}` : null,
        outcomeEligibilityIssue ? `Eligibility: ${outcomeEligibilityIssue}` : null,
        outcomeDocumentationIssue ? `Docs: ${outcomeDocumentationIssue}` : null,
        outcomeOtherReason ? `Other: ${outcomeOtherReason}` : null,
        outcomeRemarks ? `Remarks: ${outcomeRemarks}` : null,
      ].filter(Boolean).join(' | ');

      await api.post(`/tenders/${selectedTender.id}/outcome`, {
        result: outcomeResult,
        value_lakh: outcomeResult === 'won' && outcomeValueLakh ? Number(outcomeValueLakh) : undefined,
        product_id: outcomeProductId || undefined,
        region_id: outcomeRegionId || undefined,
        responsible_person_id: outcomeResponsiblePersonId || undefined,
        category: outcomeCategory || undefined,
        tender_category: outcomeCategory || undefined,
        reason: outcomeResult === 'lost' ? (fullReasonNote || outcomeLossReason) : (outcomeRemarks || 'Won commercial evaluation'),
        loss_reason: outcomeResult === 'lost' ? outcomeLossReason : undefined,
        competitor: outcomeCompetitor.trim() || undefined,
        technical_issue: outcomeTechnicalIssue.trim() || undefined,
        pricing_issue: outcomePricingIssue.trim() || undefined,
        eligibility_issue: outcomeEligibilityIssue.trim() || undefined,
        documentation_issue: outcomeDocumentationIssue.trim() || undefined,
        other_reason: outcomeOtherReason.trim() || undefined,
        remarks: outcomeRemarks.trim() || undefined,
        result_date: outcomeResultDate,
      });

      setIsOutcomeOpen(false);
      setOutcomeRemarks('');
      setOutcomeCompetitor('');
      setOutcomeTechnicalIssue('');
      setOutcomePricingIssue('');
      setOutcomeEligibilityIssue('');
      setOutcomeDocumentationIssue('');
      setOutcomeOtherReason('');
      setOutcomeValueLakh('');
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to record tender outcome.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 8. Handle Create Portal Issue (§25)
  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetTenderId = issueTenderId;
    if (!targetTenderId) {
      setActionError('Please select the affected tender.');
      return;
    }
    if (!newIssueText.trim()) {
      setActionError('Issue description is required.');
      return;
    }
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/tenders/${targetTenderId}/portal-issues`, {
        issue: newIssueText.trim(),
        reported_date: issueReportedDate || istToday(),
        responsible_person_id: issueResponsiblePerson || undefined,
        escalated_to: issueEscalatedTo.trim() || undefined,
        resolution_status: issueResolutionStatus || 'OPEN',
      });

      setIsNewIssueOpen(false);
      setNewIssueText('');
      setIssueResponsiblePerson('');
      setIssueEscalatedTo('');
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to log portal issue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 9. Handle Escalate / Resolve Portal Issue (§25)
  const handleUpdateIssueStatus = async (tenderId: string, issueId: string, status: string, resolution?: string): Promise<string | null> => {
    setPageNotice(null);
    try {
      await api.patch(`/tenders/${tenderId}/portal-issues/${issueId}`, {
        resolution_status: status.toUpperCase(),
        resolution: resolution || undefined,
        escalated_to: status.toUpperCase() === 'ESCALATED' ? 'Executive Management & GeM Desk' : undefined,
      });
      setPageNotice({ type: 'success', text: `Portal issue ${status.toUpperCase() === 'RESOLVED' ? 'resolved' : 'escalated'}.` });
      await Promise.all([fetchDashboardStats(), fetchReports()]);
      return null;
    } catch (err: any) {
      // The API's reason (e.g. "not permitted for your role") is shown, never swallowed.
      const message = err?.message || 'Could not update the portal issue.';
      setPageNotice({ type: 'danger', text: message });
      return message;
    }
  };

  // Resolve uses an in-app dialog for the resolution notes (never a blocking browser prompt).
  const [issueToResolve, setIssueToResolve] = useState<any | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const openResolveIssue = (issue: any) => {
    setIssueToResolve(issue);
    setResolutionNotes('');
    setResolveError(null);
  };
  const handleResolveIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueToResolve) return;
    if (!resolutionNotes.trim()) {
      setResolveError('Resolution notes are required.');
      return;
    }
    setIsResolving(true);
    const error = await handleUpdateIssueStatus(issueToResolve.tender_id, issueToResolve.id, 'RESOLVED', resolutionNotes.trim());
    setIsResolving(false);
    if (error) setResolveError(error);
    else setIssueToResolve(null);
  };

  // §24 Deadline Centre: groups come from the server (GET /tenders/deadline-centre) over every tender in scope,
  // not from the paginated list, and the endpoint takes no search or filters (so the view shows none).
  // Only pre-submission bids can be urgent / upcoming / overdue (B2/B3).
  const [deadlineCentre, setDeadlineCentre] = useState<any>(null);
  const fetchDeadlineCentre = useCallback(async () => {
    try {
      const res = await api.get('/tenders/deadline-centre');
      setDeadlineCentre(res || null);
    } catch (err) {
      console.error('Failed to load deadline centre:', err);
    }
  }, []);
  useEffect(() => {
    // Re-fetch when the tab opens and whenever the tender list reloads (mutations, realtime events).
    if (activeTab === 'deadlines') fetchDeadlineCentre();
  }, [activeTab, tenders, fetchDeadlineCentre]);
  useEffect(() => {
    // Analytics and Deadlines show whole-scope numbers: while a register filter is on, read them unfiltered.
    if ((activeTab === 'analytics' || activeTab === 'deadlines') && registerFiltersActive.current) fetchOverallStats();
  }, [activeTab, tenders, fetchOverallStats]);

  const categorizedDeadlines = useMemo(() => {
    const list = (v: any): any[] => (Array.isArray(v) ? v : []);
    const urgent = list(deadlineCentre?.approaching_48h);
    const urgentIds = new Set(urgent.map((t) => t.id));
    return {
      urgent,
      upcoming: list(deadlineCentre?.upcoming_7d).filter((t) => !urgentIds.has(t.id)),
      overdue: list(deadlineCentre?.overdue),
      incompletePrep: list(deadlineCentre?.incomplete_preparation),
      awaitingSignoff: list(deadlineCentre?.pending_approvals),
      resultFollowups: list(deadlineCentre?.result_follow_ups),
    };
  }, [deadlineCentre]);

  // Check if any filter is active
  const hasActiveFilters = Boolean(
    search ||
    statusFilter ||
    categoryFilter ||
    zoneFilter ||
    deadlineFilter ||
    (user?.role !== 'sales' && assignedFilter) ||
    activeHudFilter ||
    sortBy !== 'created_at' ||
    sortOrder !== 'desc'
  );

  const resetAllFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
    setZoneFilter('');
    setDeadlineFilter('');
    setAssignedFilter('');
    setActiveHudFilter(null);
    setSortBy('created_at');
    setSortOrder('desc');
  };

  const clearQuickFilters = () => {
    setActiveHudFilter(null);
    setStatusFilter('');
    setCategoryFilter('');
    setDeadlineFilter('');
  };

  // Stage counts available from the dashboard stats (shown inside the Stage dropdown)
  const stageCounts: Record<string, number | undefined> = {
    identified: dashboardStats.identified ?? 0,
    awaiting_approval: dashboardStats.awaiting_approval ?? 0,
    rejected_internally: dashboardStats.rejected_internally ?? 0,
    under_preparation: dashboardStats.under_preparation ?? 0,
    submitted: dashboardStats.submitted ?? 0,
    won: dashboardStats.won ?? dashboardStats.tenders_won ?? 0,
    lost: dashboardStats.lost ?? dashboardStats.tenders_lost ?? 0,
    on_hold: dashboardStats.on_hold_tenders ?? 0,
  };

  const winRate = Number(dashboardStats.win_rate !== undefined ? dashboardStats.win_rate : (dashboardStats.win_rate_percentage || 0)).toFixed(1);
  const headlineCards: {
    key: string;
    label: string;
    value: number;
    subtext: string;
    icon: React.ReactNode;
    badge?: React.ReactNode;
    color?: 'primary' | 'amber' | 'rose' | 'emerald';
    active: boolean;
    ring: string;
  }[] = [
    {
      key: 'total',
      label: 'Total Tracked Bids',
      value: dashboardStats.total || dashboardStats.total_tenders || 0,
      subtext: 'All-India bidding opportunities',
      icon: <Briefcase className="h-4 w-4 text-[#0F5E63]" />,
      active: !statusFilter && !categoryFilter && !deadlineFilter,
      ring: 'ring-[#0F5E63] border-[#0F5E63]',
    },
    {
      key: 'pq',
      label: 'PQ Tenders (§20)',
      value: dashboardStats.pq_count || dashboardStats.pq_tenders || 0,
      subtext: 'Pre-qualification criteria',
      icon: <Layers className="h-4 w-4 text-[#0F5E63]" />,
      badge: <Badge variant="cyber" size="sm">Pre-Qual</Badge>,
      color: 'primary',
      active: categoryFilter === 'pq',
      ring: 'ring-[#0F5E63] border-[#0F5E63] bg-[#E3EFEE]/30',
    },
    {
      key: 'general_mha',
      label: 'General / MHA (§20)',
      value: dashboardStats.general_mha_count || dashboardStats.general_mha_tenders || 0,
      subtext: 'Ministry & paramilitary RFPs',
      icon: <Building className="h-4 w-4 text-[#0F5E63]" />,
      badge: <Badge variant="info" size="sm">MHA QRs</Badge>,
      active: categoryFilter === 'general_mha',
      ring: 'ring-[#0F5E63] border-[#0F5E63] bg-[#E3EFEE]/30',
    },
    {
      key: 'awaiting_approval',
      label: 'Pending Approvals',
      value: dashboardStats.pending_approvals || 0,
      subtext: 'Awaiting executive signoff',
      icon: <ShieldCheck className="h-4 w-4 text-[#9A3412]" />,
      color: 'amber',
      badge:
        dashboardStats.pending_approvals > 0 ? (
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F2B872] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#9A3412]"></span>
          </span>
        ) : (
          <Badge variant="outline" size="sm">Dual-Control</Badge>
        ),
      active: statusFilter === 'awaiting_approval',
      ring: 'ring-[#9A3412] border-[#9A3412] bg-[#FBEBDD]/40',
    },
    {
      key: 'won',
      label: 'Won Awards & Rate',
      value: dashboardStats.won || dashboardStats.tenders_won || 0,
      subtext: `Conversion: ${winRate}%`,
      icon: <Award className="h-4 w-4 text-[#0F5E63]" />,
      badge: <Badge variant="success" size="sm">L1 Won</Badge>,
      color: 'emerald',
      active: statusFilter === 'won',
      ring: 'ring-[#0F5E63] border-[#0F5E63] bg-[#E3EFEE]/30',
    },
  ];

  // View menu — first control of the filter row; same views (and role gating) as the old tab bar.
  const isSales = user?.role === 'sales';
  // Same roles as POST /tenders/:id/outcome — regional managers follow up but do not declare the verdict.
  const canRecordOutcome = hasRole(['management', 'tender_team', 'sales', 'admin']);
  // "Record Result" on a register row or a Deadlines card: a bid awaiting its verdict, not on hold (a hold blocks
  // every stage move), and — for a submitted bid — closed already (bids open only after closing).
  const canRecordResultOn = (t: any) =>
    canRecordOutcome &&
    !t.on_hold &&
    ['submitted', 'technical_eval', 'commercial_eval'].includes(t.status) &&
    !(t.status === 'submitted' && bidStillOpen(t));
  // Same roles as POST /tenders/:id/hold and /resume.
  const canResumeTender = hasRole(['management', 'regional_manager', 'tender_team', 'admin']);
  // A result is declared after the bid closes: the earliest valid result date is the IST day of the deadline.
  const outcomeDeadline = selectedTender?.submission_deadline || selectedTender?.bid_closing_date;
  const outcomeMinResultDate = outcomeDeadline ? istDateOf(outcomeDeadline) : undefined;
  // Escalate / Resolve on portal issues: same roles as PATCH /tenders/:id/portal-issues/:issueId (not Sales).
  const canManagePortalIssues = hasRole(['management', 'regional_manager', 'tender_team', 'admin']);
  const isOpenIssue = (i: any) => !['RESOLVED', 'CLOSED'].includes(String(i?.resolution_status || 'OPEN').toUpperCase());
  const openPortalIssueCount = globalPortalIssues.filter(isOpenIssue).length;
  const nonZero = (v?: number) => (v && v > 0 ? v : undefined);
  // Analytics and Deadlines are whole-scope views (no register filter applies to them).
  const scopeStats = overallStats || dashboardStats;
  const urgentDeadlines = scopeStats.urgent_deadlines || 0;
  // (Accounts never sees this menu: its only view is Finance, pinned by the view guard, and the row is hidden.)
  const viewOptions: { id: TenderView; label: string; icon: React.ReactNode; count?: number | string; urgent?: boolean }[] = [
    { id: 'pipeline', label: isSales ? 'My bids' : 'Pipeline', icon: <FileText />, count: nonZero(totalCount || dashboardStats.total) },
    ...(!isSales
      ? [{ id: 'approvals_inbox' as const, label: 'Approvals & SLA', icon: <UserCheck />, count: nonZero(dashboardStats.pending_approvals), urgent: true }]
      : []),
    { id: 'calendar', label: isSales ? 'My calendar' : 'Tender calendar', icon: <Calendar /> },
    ...(canSeeFinance ? [{ id: 'finance_emd' as const, label: 'Finance, EMD & PBG', icon: <IndianRupee /> }] : []),
    {
      id: 'deadlines',
      label: isSales ? 'My deadlines' : 'Deadlines',
      icon: <Clock />,
      // Bids closing within 7 days — that window already contains the ≤ 48h ones, so they are not added again.
      count: nonZero(scopeStats.upcoming_deadlines),
      urgent: urgentDeadlines > 0,
    },
    {
      id: 'portal_issues',
      label: isSales ? 'My portal issues' : 'GeM & portal issues',
      icon: <AlertTriangle />,
      // Always the number of unresolved issues (same rule as the API's open_portal_issues and the Open Issues card).
      count: nonZero(globalPortalIssues.length ? openPortalIssueCount : dashboardStats.open_portal_issues),
    },
    ...(!isSales ? [{ id: 'analytics' as const, label: 'Win/loss analytics', icon: <BarChart3 />, count: `${winRate}% win` }] : []),
  ];
  const viewMenu = (
    <FilterMenu
      label="View"
      icon={<LayoutList />}
      neutralKeys={[]}
      compactOnPhone
      className="shrink-0"
      options={viewOptions.map((v) => ({
        key: v.id,
        label: v.label,
        icon: v.icon,
        count: v.count,
        urgent: v.urgent,
        active: activeTab === v.id,
        onSelect: () => {
          setActiveTab(v.id);
          if (v.id === 'analytics') fetchReports();
        },
      }))}
    />
  );

  // Only the Pipeline register reads the filtered tender list, so only it gets the search + filters (the Deadlines
  // view comes from GET /tenders/deadline-centre, which takes no query).
  const isListView = activeTab === 'pipeline';
  // Category, Zone and Assignee live in the "More" panel (Category is also on the PQ / MHA cards).
  const moreActiveCount = [categoryFilter, zoneFilter, !isSales ? assignedFilter : ''].filter(Boolean).length;
  const phoneFilterCount = [statusFilter, deadlineFilter].filter(Boolean).length + moreActiveCount;

  // Pipeline register: each tender as a RecordItem (priority cards + stage board).
  // On Hold is a flag over the stage the bid was held at (`status` is kept), so a held bid goes in the On Hold lane.
  const stageById = new Map<string, string>(tenders.map((t) => [t.id, t.on_hold ? 'on_hold' : t.status]));
  const tenderLaneOf = (item: RecordItem) => stageById.get(item.key) || 'identified';
  const tenderLanes: BoardLane[] = [
    ...STAGES.map((s) => ({ key: s.key as string, label: s.label as string, tone: toneFor(s.label) })),
    ...Array.from(new Set(tenders.map((t) => t.status).filter((s) => s && !STAGES.some((st) => st.key === s)))).map((s) => ({
      key: s as string,
      label: String(s).replace(/_/g, ' '),
      tone: toneFor(s),
    })),
  ];
  const tenderRecords: RecordItem[] = tenders.map((tender) => {
    const isHeld = Boolean(tender.on_hold);
    const stageLabel = isHeld ? 'On Hold' : stageLabelOf(tender.status);
    const isPqTender = (tender.category || '').toLowerCase().includes('pq');
    const isManagement = hasRole(['management', 'admin']);
    const open = () => openTenderDetails(tender);

    // The card itself opens the dossier (onOpen); a button only for a real next step in the lifecycle.
    let primary: RecordAction | undefined;
    if (isHeld) {
      // A hold blocks every stage move, so the only next step is Resume (back to the stage it was held at).
      primary = canResumeTender ? { label: 'Resume', icon: <RefreshCw />, onClick: () => handleQuickResume(tender) } : undefined;
    } else if (tender.status === 'identified') {
      primary = isManagement
        ? { label: 'Review', icon: <ShieldCheck />, onClick: open }
        : { label: 'Submit for Internal Review', icon: <Send />, onClick: () => handleQuickRequestApproval(tender) };
    } else if (tender.status === 'awaiting_approval' && isManagement) {
      primary = { label: 'Review', icon: <ShieldCheck />, onClick: open };
    } else if (tender.status === 'under_preparation') {
      primary = {
        label: isPqTender ? 'Mark PQ Submitted' : 'Mark Tender Submitted',
        icon: <CheckCircle2 />,
        onClick: () => {
          setSelectedTender(tender);
          setTargetTransitionStatus(isPqTender ? 'pq_submitted' : 'submitted');
          setTransitionSubmissionDate(istToday());
          setTransitionRemarks(isPqTender ? 'PQ submitted on the portal.' : 'Tender submitted on the portal.');
          setActionError(null);
          setIsTransitionOpen(true);
        },
      };
    } else if (canRecordResultOn(tender)) {
      primary = {
        label: 'Record Result',
        icon: <Award />,
        onClick: () => openOutcomeModal(tender),
      };
    }

    const badges: RecordItem['badges'] = [];
    const categoryCode = String(tender.category || '').toLowerCase();
    if (categoryCode === 'pq') badges.push({ label: 'PQ', tone: 'info' });
    else if (categoryCode === 'general_mha') badges.push({ label: tenderCategoryLabel(categoryCode), tone: 'neutral' });
    if (isHeld) badges.push({ label: `Held at ${stageLabelOf(tender.status_before_hold || tender.status)}`, tone: 'neutral' });
    else if (tender.status === 'awaiting_approval' && !isManagement) badges.push({ label: 'In review', tone: 'warning' });
    if (tender.assigned_to === user?.id || tender.assigned_person_id === user?.id) badges.push({ label: 'You', tone: 'info' });

    const location = [tender.city, tender.state].filter(Boolean).join(', ');
    return {
      key: tender.id,
      code: tender.tender_number || tender.tender_no,
      title: tender.requirement_text || tender.product_name || 'Defence Procurement Item',
      subtitle: [tender.department || tender.organisation_name || 'Government Buyer', location].filter(Boolean).join(' · '),
      status: { label: stageLabel, tone: toneFor(stageLabel) },
      badges,
      due: {
        date: tender.submission_deadline || tender.bid_closing_date,
        label: 'Bid closes',
        done: ['won', 'lost', 'cancelled', 'rejected_internally'].includes(tender.status),
      },
      value: (() => {
        const rupees = tenderEstimatedRupees(tender);
        return rupees ? `₹ ${Number((rupees / 100000).toFixed(2))} Lakh` : undefined;
      })(),
      owner: tender.tender_owner_name || tender.owner_name || 'Unassigned',
      facts: [
        { label: 'Portal', value: tender.portal || '—' },
        { label: 'EMD', value: Number(tender.emd_fee || tender.emd_amount) > 0 ? formatINR(Number(tender.emd_fee || tender.emd_amount)) : 'Exempt' },
        { label: 'Sales', value: tender.assigned_to_name || tender.assigned_person_name || 'Unassigned' },
        { label: 'Qty', value: Number(tender.line_items_quantity) > 0 ? Number(tender.line_items_quantity) : tender.quantity || 1 },
      ],
      primary,
      onOpen: open,
    };
  });

  // Pipeline register as a table (RecordViews' List view): the same rows, in the same order, as tenderRecords.
  type TenderBadgeVariant = NonNullable<BadgeProps['variant']>;
  const tenderStageBadge = (status?: string): TenderBadgeVariant =>
    status === 'won' || status === 'pq_qualified'
      ? 'success'
      : status === 'awaiting_approval'
        ? 'warning'
        : status === 'under_preparation'
          ? 'default'
          : status === 'lost' || status === 'rejected_internally' || status === 'cancelled'
            ? 'danger'
            : 'outline';
  /**
   * The submission deadline only drives urgency while the bid is still being prepared — the API's pre-submission
   * stages (a PQ-qualified bid still has its main bid to file). A held bid keeps its stage, so it is covered too.
   */
  const tenderPreSubmission = ['identified', 'awaiting_approval', 'under_preparation', 'pq_qualified'];
  const tenderList = tenders.length ? (
    <RecordTable items={tenderRecords}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tender / Bid No.</TableHead>
            <TableHead>Buyer & Location</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Requirement & Ownership</TableHead>
            <TableHead className="text-right">Qty & Value</TableHead>
            <TableHead>Submission Deadline</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenders.map((tender, idx) => {
            const record = tenderRecords[idx];
            const deadline = tender.submission_deadline || tender.bid_closing_date;
            // Deadline urgency (as on the reference register) only while the bid is still being prepared.
            const deadlineAt = deadline ? new Date(deadline).getTime() : NaN;
            const hoursLeft = tenderPreSubmission.includes(tender.status) && !Number.isNaN(deadlineAt) ? (deadlineAt - Date.now()) / 3600000 : null;
            const location = [tender.city, tender.state].filter(Boolean).join(', ') + (tender.zone_name ? ` (${tender.zone_name})` : '');
            const buyer = tender.department || tender.organisation_name || 'Government Buyer';
            const requirement = tender.requirement_text || tender.product_name || 'Defence Procurement Item';
            const owner = tender.tender_owner_name || tender.owner_name || 'Unassigned';
            const sales = tender.assigned_to_name || tender.assigned_person_name || 'Unassigned';
            const isMine = tender.assigned_to === user?.id || tender.assigned_person_id === user?.id;
            const categoryLabel = tenderCategoryLabel(tender.category, tender.category_name);
            const emd = Number(tender.emd_fee || tender.emd_amount);
            // Estimated value first (₹ Lakh); the EMD is shown under it, or alone when no estimate is recorded.
            const emdText = emd > 0 ? `EMD: ${formatINR(emd)}` : 'EMD: Exempt';
            const value = record.value || emdText;
            const qty = Number(tender.line_items_quantity) > 0 ? Number(tender.line_items_quantity) : Number(tender.quantity) || 1;
            // The row's next lifecycle step — the same button the phone card shows (`primary` is only ever a real step).
            const nextStep = record.primary;
            return (
              <TableRow key={tender.id}>
                <TableCell className="font-bold whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{tender.tender_number || tender.tender_no}</span>
                  {tender.portal && <div className="text-[10px] text-[#4A5568] font-normal">{tender.portal}</div>}
                </TableCell>
                <TableCell className="text-[#14213D] max-w-[220px]">
                  <div className="font-semibold text-[#14213D] truncate" title={buyer}>
                    {buyer}
                  </div>
                  {location && <div className="text-[10px] text-[#4A5568] truncate">{location}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {tender.category ? (
                    <Badge variant="outline" size="sm" className="uppercase font-bold">
                      {categoryLabel}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <div className="text-[#14213D] font-medium truncate" title={requirement}>
                    {requirement}
                  </div>
                  <div className="text-[10px] text-[#4A5568] font-normal truncate" title={`Owner: ${owner} · Sales: ${sales}`}>
                    Owner: {owner} · Sales: {sales}
                    {isMine && <span className="ml-1 font-bold text-[#0F5E63]">(You)</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">
                  {value}
                  <div className="text-[10px] text-[#4A5568] font-normal">
                    {record.value ? `${emdText} · ` : ''}Qty: {qty}
                  </div>
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(deadline)}
                  {hoursLeft !== null && hoursLeft < 0 ? (
                    <Badge variant="danger" size="sm" className="mt-1 flex w-fit" hasDot>
                      OVERDUE
                    </Badge>
                  ) : hoursLeft !== null && hoursLeft <= 48 ? (
                    <Badge variant="urgent" size="sm" className="mt-1 flex w-fit">
                      {/* "Today" only when it closes on today's IST calendar day, not merely within 24 hours. */}
                      {isIstToday(deadline) ? 'CLOSING TODAY' : `CLOSES IN ${Math.ceil(hoursLeft)}H`}
                    </Badge>
                  ) : hoursLeft !== null && hoursLeft <= 168 ? (
                    <Badge variant="info" size="sm" className="mt-1 flex w-fit">
                      {Math.ceil(hoursLeft / 24)} DAYS LEFT
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={tender.on_hold ? 'warning' : tenderStageBadge(tender.status)} size="sm" className="uppercase font-bold">
                    {record.status?.label || String(tender.status || '-').replace(/_/g, ' ')}
                  </Badge>
                  {tender.on_hold && (
                    <div className="mt-1 text-[10px] text-[#4A5568]">Held at {stageLabelOf(tender.status_before_hold || tender.status)}</div>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5">
                    {nextStep && (
                      <Button size="sm" variant="primary" className="shadow-xs text-xs" disabled={nextStep.disabled} onClick={nextStep.onClick}>
                        {nextStep.label}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" className="shadow-xs text-xs" onClick={record.onOpen}>
                      Inspect <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  return (
    <PageContainer>
      {/* 1. Page Header */}
      <PageHeader
        title={
          isFinanceOnly
            ? 'Tender EMD & PBG Accounting'
            : user?.role === 'sales'
              ? 'My Tenders & Bids'
              : 'Tender Pipeline & Bids Command'
        }
        icon={
          <div className="p-2.5 rounded-xl bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20 shadow-2xs">
            <FileText className="h-6 w-6 text-[#0F5E63]" />
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Tender masters & governance: same roles as the settings / categories / approvers / loss-reasons writes. */}
            {hasRole(['management', 'admin']) && (
              <Button
                variant="outline"
                size="sm"
                aria-label="Tender settings"
                onClick={() => setIsSettingsOpen(true)}
                leftIcon={<Settings className="h-3.5 w-3.5 text-[#4A5568]" />}
              >
                <span className="hidden sm:inline">Settings</span>
              </Button>
            )}
            {/* Same roles as POST /tenders/import. */}
            {hasRole(['management', 'admin']) && (
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setIsImportOpen(true)}
                leftIcon={<Upload className="h-3.5 w-3.5 text-[#4A5568]" />}
              >
                <span>Bulk Import</span>
              </Button>
            )}
            {/* Same roles as POST /tenders — identification is Tender Team and Sales (plus managers). */}
            {hasRole(['management', 'regional_manager', 'tender_team', 'sales', 'admin']) && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  // Fresh form: date defaults follow today's IST date (not the date the page was loaded).
                  setNewTender((prev) =>
                    prev.tender_no.trim()
                      ? prev
                      : { ...prev, publication_date: istToday(), submission_deadline: defaultTenderDeadline() },
                  );
                  setIsCreateOpen(true);
                }}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                <span className="sm:hidden">New</span>
                <span className="hidden sm:inline">Register New Tender</span>
              </Button>
            )}
          </div>
        }
      />

      {pageNotice && (
        <InfoCallout variant={pageNotice.type} onClose={() => setPageNotice(null)}>
          {pageNotice.text}
        </InfoCallout>
      )}

      {/* 2. Key metrics (only the views that have them). Pipeline: five cards, each filters the register (click again to clear). */}
      {activeTab === 'pipeline' && (
        <StatGrid cols={5} className="gap-3">
          {headlineCards.map((c) => (
            <StatCard
              key={c.key}
              label={c.label}
              value={c.value}
              valueColor={c.color}
              subtext={c.subtext}
              icon={c.icon}
              badge={c.badge}
              className={c.active ? `ring-2 ${c.ring}` : 'cursor-pointer'}
              onClick={() => (c.active || c.key === 'total' ? clearQuickFilters() : handleHudClick(c.key, c.key))}
            />
          ))}
        </StatGrid>
      )}
      {activeTab === 'portal_issues' && (
        <StatGrid cols={4} className="gap-3">
          <StatCard
            label="Total Portal Issues"
            value={globalPortalIssues.length}
            subtext="Logged on GeM & CPPP"
            icon={<AlertCircle className="h-4 w-4 text-[#0F5E63]" />}
          />
          <StatCard
            label="Open Issues"
            value={openPortalIssueCount}
            subtext="Unresolved (open, in progress or escalated)"
            icon={<AlertTriangle className="h-4 w-4 text-[#9A3412]" />}
            valueColor="amber"
          />
          <StatCard
            label="Escalated"
            value={globalPortalIssues.filter((i) => String(i.resolution_status || '').toUpperCase() === 'ESCALATED').length}
            subtext="Awaiting GeM Desk / Mgmt"
            icon={<AlertOctagon className="h-4 w-4 text-[#881337]" />}
            valueColor="rose"
          />
          <StatCard
            label="Resolved / Closed"
            value={globalPortalIssues.length - openPortalIssueCount}
            subtext="Workaround or fix applied"
            icon={<CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />}
            valueColor="emerald"
          />
        </StatGrid>
      )}

      {/* 3. One filter row on every view: View menu first, then that view's search, filters and actions.
          Accounts has a single view (Finance, EMD & PBG), so no row at all. */}
      {!isFinanceOnly && (
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          {viewMenu}
          {isListView && (
            <>
              <button
                type="button"
                onClick={() => {
                  // folding the chips away also folds the "More" filters that hang off them
                  if (isPhoneFiltersOpen) setIsMoreOpen(false);
                  setIsPhoneFiltersOpen(!isPhoneFiltersOpen);
                }}
                aria-expanded={isPhoneFiltersOpen}
                aria-controls="tender-filter-chips"
                className={`filter-menu-btn sm:!hidden ${isPhoneFiltersOpen || phoneFilterCount > 0 ? 'filter-menu-btn--on' : ''}`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Filters</span>
                {phoneFilterCount > 0 && <span className="filter-menu-chip">{phoneFilterCount}</span>}
              </button>
              <div className="relative order-last w-full min-w-0 sm:order-none sm:min-w-[200px] sm:flex-1 lg:w-auto">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search tenders"
                  placeholder="Search tender no., buyer, requirement, city, assignee…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                  className="h-10 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-sm text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15 sm:h-9 sm:text-xs"
                />
              </div>
              <div
                id="tender-filter-chips"
                className={`${isPhoneFiltersOpen ? 'flex' : 'hidden'} order-last w-full flex-wrap items-center gap-2 sm:order-none sm:flex sm:w-auto lg:flex-nowrap`}
              >
                <FilterMenu
                  label="Stage"
                  icon={<Layers />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  options={[
                    { key: '', label: 'All stages' },
                    ...STAGES,
                    // a status set from a dashboard link shows as one custom choice
                    ...(statusFilter.includes(',') ? [{ key: statusFilter, label: `Custom · ${statusFilter.split(',').length} stages` }] : []),
                  ].map((s) => ({
                    key: s.key || 'all',
                    label: s.label,
                    count: s.key ? stageCounts[s.key] : undefined,
                    active: statusFilter === s.key,
                    onSelect: () => {
                      setStatusFilter(s.key);
                      setActiveHudFilter(null);
                    },
                  }))}
                />
                <FilterMenu
                  label="Deadline"
                  icon={<Clock />}
                  options={[
                    { key: '', label: 'All deadlines', count: undefined },
                    { key: 'due_today', label: 'Due today', count: dashboardStats.due_today || 0 },
                    { key: 'urgent_48h', label: 'Closing ≤ 48h', count: dashboardStats.urgent_deadlines || 0 },
                    { key: 'upcoming_7d', label: 'Due ≤ 7 days', count: dashboardStats.upcoming_deadlines || 0 },
                    { key: 'overdue', label: 'Overdue submissions', count: dashboardStats.overdue_tenders || 0 },
                  ].map((o) => ({
                    ...o,
                    key: o.key || 'all',
                    urgent: o.key === 'due_today' || o.key === 'urgent_48h' || o.key === 'overdue',
                    active: deadlineFilter === o.key,
                    onSelect: () => {
                      setDeadlineFilter(o.key);
                      setActiveHudFilter(null);
                    },
                  }))}
                />
                <button
                  type="button"
                  onClick={() => setIsMoreOpen((o) => !o)}
                  aria-expanded={isMoreOpen}
                  className={`filter-menu-btn ${isMoreOpen || moreActiveCount > 0 ? 'filter-menu-btn--on' : ''}`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>More</span>
                  {moreActiveCount > 0 && <span className="filter-menu-chip">{moreActiveCount}</span>}
                </button>
                <FilterMenu
                  label="Sort"
                  icon={<ArrowUpDown />}
                  neutralKeys={[...TENDER_SORT_FIELDS.map((f) => f.key), 'dir_desc', 'dir_asc']}
                  align="right"
                  options={[
                    ...TENDER_SORT_FIELDS.map((f) => ({
                      key: f.key,
                      label: f.label,
                      active: sortBy === f.key,
                      onSelect: () => {
                        setSortBy(f.key);
                      },
                    })),
                    { key: 'dir_desc', label: 'Descending', icon: <ChevronDown />, active: sortOrder === 'desc', onSelect: () => { setSortOrder('desc'); } },
                    { key: 'dir_asc', label: 'Ascending', icon: <ChevronUp />, active: sortOrder === 'asc', onSelect: () => { setSortOrder('asc'); } },
                  ]}
                />
                {hasActiveFilters && (
                  <Button variant="ghost" size="xs" onClick={resetAllFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}
          {activeTab === 'portal_issues' && (
            <Button
              size="sm"
              variant="primary"
              className="self-start lg:ml-auto lg:self-auto"
              onClick={() => openNewIssueModal()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Log Portal Issue
            </Button>
          )}
        </div>

        {/* "More" panel: the less-used filters, inline under the row. */}
        {isListView && isMoreOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-2.5">
            <span className="text-xs font-semibold text-[#4A5568]">More filters</span>
            <FilterMenu
              label="Category"
              icon={<Briefcase />}
              options={[
                { key: '', label: 'All categories', count: undefined },
                { key: 'pq', label: 'PQ (Pre-Qualification)', count: dashboardStats.pq_count || dashboardStats.pq_tenders || 0 },
                { key: 'general_mha', label: 'General / MHA', count: dashboardStats.general_mha_count || dashboardStats.general_mha_tenders || 0 },
                { key: 'other', label: 'Other Defence / Govt', count: dashboardStats.other_count || dashboardStats.other_tenders || 0 },
              ].map((o) => ({
                ...o,
                key: o.key || 'all',
                active: categoryFilter === o.key,
                onSelect: () => {
                  setCategoryFilter(o.key);
                  setActiveHudFilter(null);
                },
              }))}
            />
            <FilterMenu
              label="Zone"
              icon={<MapPin />}
              options={[{ id: '', name: '' }, ...zonesMaster].map((z: any) => ({
                key: z.id || 'all',
                label: z.id ? `${z.name} Zone` : 'All zones',
                active: zoneFilter === z.id,
                onSelect: () => {
                  setZoneFilter(z.id);
                },
              }))}
            />
            {!isSales && (
              <FilterMenu
                label="Assignee"
                icon={<User />}
                className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                options={[
                  { id: '', label: 'Anyone' },
                  ...(user?.id ? [{ id: user.id, label: 'Assigned to me' }] : []),
                  ...users
                    .filter((u: any) => u.id !== user?.id)
                    .map((u: any) => ({ id: u.id, label: `${u.full_name}${u.role ? ` (${String(u.role).replace(/_/g, ' ')})` : ''}` })),
                ].map((o) => ({
                  key: o.id || 'all',
                  label: o.label,
                  active: assignedFilter === o.id,
                  onSelect: () => {
                    setAssignedFilter(o.id);
                    setActiveHudFilter(null);
                  },
                }))}
              />
            )}
          </div>
        )}
      </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: OPERATIONAL PIPELINE & BIDS */}
      {/* ========================================================================= */}
      {activeTab === 'pipeline' && (
        <div className="animate-in fade-in duration-150">
          {/* ========================================================================= */}
          {/* Tenders register: priority cards / stage board */}
          {/* ========================================================================= */}
          {isLoading ? (
            <div className="rounded-[14px] border border-[#DCD8CE] bg-white p-12 text-center text-xs text-[#4A5568]">
              <Spinner size="md" className="mx-auto mb-2" />
              <span className="font-medium text-[#14213D]">Loading bidding opportunities...</span>
            </div>
          ) : tenders.length === 0 ? (
            <div className="rounded-[14px] border border-[#DCD8CE] bg-white p-12">
              <EmptyState
                icon={<FileText className="h-10 w-10 text-[#4A5568]" />}
                title="No tenders match selected criteria"
                description="Adjust your search filters, clear active stage criteria, or register a new tender opportunity."
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={resetAllFilters}>
                      Reset Filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <RecordViews
              storageKey="tenders"
              defaultView="list"
              items={tenderRecords}
              list={tenderList}
              lanes={tenderLanes}
              laneOf={tenderLaneOf}
              summary={
                <>
                  <strong className="text-[#14213D]">{tenders.length}</strong> of{' '}
                  <strong className="text-[#14213D]">{totalCount}</strong> bids
                </>
              }
              empty="No tenders match selected criteria."
              onLoadMore={tendersList.loadMore}
              hasMore={tendersList.hasMore}
              loadingMore={tendersList.loadingMore}
            />
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB: APPROVALS INBOX & GOVERNANCE */}
      {/* ========================================================================= */}
      {activeTab === 'approvals_inbox' && user?.role !== 'sales' && (
        <ApprovalsInboxView
          currentUser={user}
          onOpenDossier={(id) => {
            setDossierTenderId(id);
            setIsDossierOpen(true);
          }}
          onCountChange={handleInboxCount}
          onChanged={() => {
            fetchTenders();
            fetchDashboardStats();
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB: SHARED TENDER CALENDAR & MILESTONES */}
      {/* ========================================================================= */}
      {activeTab === 'calendar' && (
        <TenderCalendarView
          currentUser={user}
          onOpenDossier={(id) => {
            setDossierTenderId(id);
            setIsDossierOpen(true);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB: FINANCE & EMD / PBG REPOSITORY */}
      {/* ========================================================================= */}
      {activeTab === 'finance_emd' && canSeeFinance && (
        <FinanceEmdView
          currentUser={user}
          onOpenDossier={
            // Accounts may not read a tender's dossier (GET /tenders/:id), so it is told why instead of seeing a 403.
            isFinanceOnly
              ? () =>
                  setPageNotice({
                    type: 'info',
                    text: 'The full tender dossier is open to the Tender Team and Management. EMD and PBG instruments are tracked and updated here.',
                  })
              : (id) => {
                  setDossierTenderId(id);
                  setIsDossierOpen(true);
                }
          }
        />
      )}

      {/* ========================================================================= */}
      {/* TAB 2: EXECUTIVE REPORTING & ANALYTICS (§21, §26, §27) */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' && user?.role !== 'sales' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SectionHeader
            title="Executive Management Reporting & Analytics Suite (§27)"
            description="Multi-tier pipeline intelligence across Classifications (PQ vs General / MHA), Territories, Salespeople, and Post-Mortem Win/Loss Analysis"
          />

          {/* Section 1: Executive KPI Command HUD (§27 Monitoring Requirements) — whole scope, like the tables below
              (this view has no filter row, so the register filters never narrow it). */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-[#4A5568] uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-[#0F5E63]" />
              <span>Executive Tender Pipeline HUD (§27 Management Metrics)</span>
            </h3>

            {/* Row 1: Pipeline & Classification Counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Total Identified</span>
                  <FileText className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#14213D] mt-1.5">
                  {scopeStats.total_tenders || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">All registered opportunities</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">PQ Tenders</span>
                  <Badge variant="cyber" size="sm">Pre-Qual</Badge>
                </div>
                <div className="text-2xl font-black text-[#0F5E63] mt-1.5">
                  {scopeStats.pq_tenders || scopeStats.pq_count || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Pre-qualification category</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">General / MHA</span>
                  <Badge variant="info" size="sm">MHA QR</Badge>
                </div>
                <div className="text-2xl font-black text-[#14213D] mt-1.5">
                  {scopeStats.general_mha_tenders || scopeStats.general_mha_count || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Paramilitary & central bids</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Other Tenders</span>
                  <Badge variant="default" size="sm">Institutional</Badge>
                </div>
                <div className="text-2xl font-black text-[#14213D] mt-1.5">
                  {scopeStats.other_tenders || scopeStats.other_count || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">State Police & PSUs</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Worked Upon</span>
                  <Clock className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#0F5E63] mt-1.5">
                  {scopeStats.worked_upon || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">In prep, eval, or bid stage</p>
              </Card>
            </div>

            {/* Row 2: Submissions, Outcomes & Win Rate */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Tenders Submitted</span>
                  <Send className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#0F5E63] mt-1.5">
                  {scopeStats.tenders_submitted || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Bids filed on GeM/CPPP</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Tenders Won</span>
                  <Award className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#0B4A4E] mt-1.5">
                  {scopeStats.tenders_won || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">L1 contracts secured</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Tenders Lost</span>
                  <XCircle className="h-4 w-4 text-[#881337]" />
                </div>
                <div className="text-2xl font-black text-[#881337] mt-1.5">
                  {scopeStats.tenders_lost || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Lost to competitor/disqualified</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Pending Tenders</span>
                  <Clock className="h-4 w-4 text-[#9A3412]" />
                </div>
                <div className="text-2xl font-black text-[#7C2D12] mt-1.5">
                  {scopeStats.pending_tenders || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">In flight across all stages</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Conversion Win Rate</span>
                  <TrendingUp className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#0B4A4E] mt-1.5">
                  {winLossReport.win_rate !== undefined ? `${winLossReport.win_rate}%` : `${scopeStats.win_rate || 0}%`}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Won / Decided bids</p>
              </Card>
            </div>
          </div>

          {/* Section 2: Organisation-Level Pipeline Report (§21 & §27) */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Building className="h-4 w-4 text-[#0F5E63]" />
                  <span>Organisation-Level Pipeline & Conversion (§21, §27)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Performance breakdown grouped by buyer organisation, sector, and classification</p>
              </div>
              <Badge variant="info" size="sm">{organisationReport.length} Buyer Organisations</Badge>
            </div>

            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-[#FBFAF7]">
                  <tr className="border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-2.5">Buyer Organisation</th>
                    <th className="p-2.5">Sector</th>
                    <th className="p-2.5">Location</th>
                    <th className="p-2.5 text-center">Total</th>
                    <th className="p-2.5 text-center">PQ Bids</th>
                    <th className="p-2.5 text-center">General / MHA</th>
                    <th className="p-2.5 text-center" title="Open bids: not yet won, lost, cancelled or rejected internally">Pending</th>
                    <th className="p-2.5 text-center">Submitted</th>
                    <th className="p-2.5 text-center">Won</th>
                    <th className="p-2.5 text-center">Lost</th>
                    <th className="p-2.5 text-right">Org Win Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {organisationReport.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-4 text-center text-xs text-[#4A5568]">
                        No organisation-level tender data available.
                      </td>
                    </tr>
                  ) : (
                    organisationReport.map((org) => {
                      const decided = (org.won || 0) + (org.lost || 0);
                      const rate = decided > 0 ? Math.round(((org.won || 0) / decided) * 100) : 0;
                      return (
                        <tr key={org.organisation_id} className="hover:bg-[#FBFAF7]">
                          <td className="p-2.5 font-bold text-[#14213D]">{org.organisation_name}</td>
                          <td className="p-2.5 text-[#4A5568]">{org.sector || 'Defence'}</td>
                          <td className="p-2.5 text-[#4A5568]">{org.state ? `${org.city ? `${org.city}, ` : ''}${org.state}` : 'National'}</td>
                          <td className="p-2.5 text-center font-bold text-[#0F5E63]">{org.total}</td>
                          <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{org.pq_count || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-[#14213D]">{org.general_mha_count || 0}</td>
                          <td className="p-2.5 text-center text-[#7C2D12] font-semibold">{org.pending ?? org.pending_tenders ?? 0}</td>
                          <td className="p-2.5 text-center text-[#0B4A4E] font-semibold">{org.submitted || 0}</td>
                          <td className="p-2.5 text-center text-[#0B4A4E] font-bold">{org.won || 0}</td>
                          <td className="p-2.5 text-center text-[#881337] font-semibold">{org.lost || 0}</td>
                          <td className="p-2.5 text-right font-black text-[#0B4A4E]">
                            {decided > 0 ? `${rate}%` : 'N/A'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: Salesperson Performance Report */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-[#0F5E63]" />
                  <span>Salesperson Bid Handling & Conversion Scorecard (§21, §27)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Individual bid handling, throughput, PQ count, and conversion metrics</p>
              </div>
              <Badge variant="info" size="sm">{salespersonReport.length} Executives</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-2.5">Executive</th>
                    <th className="p-2.5">Role</th>
                    <th className="p-2.5 text-center">Assigned Tenders</th>
                    <th className="p-2.5 text-center">PQ Bids</th>
                    <th className="p-2.5 text-center">General / MHA</th>
                    <th className="p-2.5 text-center">Pending</th>
                    <th className="p-2.5 text-center">Bids Submitted</th>
                    <th className="p-2.5 text-center">Won Awards</th>
                    <th className="p-2.5 text-center">Lost</th>
                    <th className="p-2.5 text-right">Personal Win Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {salespersonReport.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-4 text-center text-xs text-[#4A5568]">
                        No salesperson metrics recorded yet.
                      </td>
                    </tr>
                  ) : (
                    salespersonReport.map((s) => {
                      const dec = (s.won || 0) + (s.lost || 0);
                      const rate = dec > 0 ? Math.round(((s.won || 0) / dec) * 100) : 0;
                      return (
                        <tr key={s.user_id} className="hover:bg-[#FBFAF7]">
                          <td className="p-2.5 font-bold text-[#14213D]">{s.salesperson_name}</td>
                          <td className="p-2.5 text-[#4A5568]">{roleLabel(s.role)}</td>
                          <td className="p-2.5 text-center font-bold text-[#0F5E63]">{s.total || s.total_tenders || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{s.pq_count || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-[#14213D]">{s.general_mha_count || 0}</td>
                          <td className="p-2.5 text-center text-[#7C2D12] font-semibold">{s.pending || s.pending_tenders || 0}</td>
                          <td className="p-2.5 text-center text-[#0B4A4E] font-semibold">{s.submitted || s.submitted_tenders || 0}</td>
                          <td className="p-2.5 text-center text-[#0B4A4E] font-bold">{s.won || s.won_tenders || 0}</td>
                          <td className="p-2.5 text-center text-[#881337] font-semibold">{s.lost || s.lost_tenders || 0}</td>
                          <td className="p-2.5 text-right font-black text-[#0B4A4E]">
                            {dec > 0 ? `${rate}%` : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3b: Zone-wise & Region-wise pipeline (§21, §27) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PipelineBreakdownTable
              title="Zone-wise Pipeline (§21, §27)"
              description="Bids per zone: category mix, submissions, outcomes and pending work"
              icon={<MapPin className="h-4 w-4 text-[#0F5E63]" />}
              rows={zoneReport}
              nameKey="zone_name"
              idKey="zone_id"
              emptyText="No zone pipeline recorded yet."
            />
            <PipelineBreakdownTable
              title="Region-wise Pipeline (§21, §27)"
              description="Bids per region: category mix, submissions, outcomes and pending work"
              icon={<Building className="h-4 w-4 text-[#0F5E63]" />}
              rows={regionReport}
              nameKey="region_name"
              idKey="region_id"
              secondaryKey="zone_name"
              emptyText="No region pipeline recorded yet."
            />
          </div>

          {/* Section 4: Structured Win / Loss Post-Mortem Intelligence HUD (§26) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Award className="h-4 w-4 text-[#0F5E63]" />
                  <span>Tender Win / Loss Post-Mortem Intelligence (§26)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">
                  Comprehensive analysis of won orders (product, region, responsible person, value) and lost bids (root-cause factors, competitor advantages)
                </p>
              </div>
              <Badge variant="cyber" size="sm">
                Decided: {(winLossReport.won || 0) + (winLossReport.lost || 0)} Bids
              </Badge>
            </div>

            {/* Won Tenders Intelligence Grid */}
            <div className="bg-white rounded-xl border border-[#D0E5E3] p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[#0F5E63]" />
                  <h4 className="text-sm font-bold text-[#0B4A4E]">
                    Won Contracts Intelligence (§26 Product, Region, Person, Value Breakdown)
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success" size="sm">
                    {winLossReport.won || 0} Tenders Won
                  </Badge>
                  {winLossReport.total_won_value_lakh ? (
                    <Badge variant="cyber" size="sm">
                      ₹{winLossReport.total_won_value_lakh} Lakh Total Won
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* Won By Product */}
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Won by Product
                  </span>
                  {Object.keys(winLossReport.won_by_product || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No product award breakdown yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_product || {}).map(([prod, data]: [string, any]) => (
                      <div key={prod} className="flex items-center justify-between text-xs py-1 border-b border-[#ECE9E2] last:border-none">
                        <span className="font-medium text-[#14213D] truncate max-w-[150px]">{prod}</span>
                        <div className="text-right">
                          <span className="font-bold text-[#0B4A4E]">{data.count} Won</span>
                          {data.value_lakh > 0 && (
                            <span className="text-[10px] text-[#4A5568] block">₹{data.value_lakh}L</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Won By Region */}
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Won by Region
                  </span>
                  {Object.keys(winLossReport.won_by_region || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No regional awards logged yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_region || {}).map(([reg, data]: [string, any]) => (
                      <div key={reg} className="flex items-center justify-between text-xs py-1 border-b border-[#ECE9E2] last:border-none">
                        <span className="font-medium text-[#14213D]">{reg}</span>
                        <div className="text-right">
                          <span className="font-bold text-[#0B4A4E]">{data.count} Won</span>
                          {data.value_lakh > 0 && (
                            <span className="text-[10px] text-[#4A5568] block">₹{data.value_lakh}L</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Won By Salesperson / Tender Owner */}
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Top Winning Executives
                  </span>
                  {Object.keys(winLossReport.won_by_person || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No salesperson award ledger yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_person || {}).map(([person, data]: [string, any]) => (
                      <div key={person} className="flex items-center justify-between text-xs py-1 border-b border-[#ECE9E2] last:border-none">
                        <span className="font-medium text-[#14213D] truncate max-w-[140px]">{person}</span>
                        <div className="text-right">
                          <span className="font-bold text-[#0B4A4E]">{data.count} Won</span>
                          {data.value_lakh > 0 && (
                            <span className="text-[10px] text-[#4A5568] block">₹{data.value_lakh}L</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Lost Tenders & Root-Cause Factors Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Primary Loss Cause Breakdown */}
              <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-[#881337]" />
                  <span>Primary Loss Cause Breakdown (§26 Post-Mortem)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Structured primary loss categories on lost bids</p>

                <div className="space-y-2 pt-1">
                  {Object.keys(winLossReport.loss_reasons || {}).length === 0 ? (
                    <div className="p-4 rounded-lg bg-[#FBFAF7] text-center text-xs text-[#4A5568]">
                      No lost tender post-mortems logged yet.
                    </div>
                  ) : (
                    Object.entries(winLossReport.loss_reasons || {}).map(([reason, count]) => {
                      const totalLost = winLossReport.lost || 1;
                      const pct = Math.round(((count as number) / totalLost) * 100);
                      return (
                        <div key={reason} className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-xs text-[#14213D] uppercase tracking-wide">
                              {reason.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] text-[#4A5568] block">
                              {reason === 'pricing' || reason === 'price' ? 'Competitor lower quoted L1 / margin limitation' : reason === 'technical' ? 'QR deviation or proving ground performance gap' : reason === 'eligibility' ? 'Turnover or prior tender experience shortfall' : reason === 'documentation' ? 'OEM Authorization or technical annexure omission' : 'Commercial / procurement board decision'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-[#881337]">{count as number}</span>
                            <span className="text-[10px] text-[#4A5568] block">{pct}% of losses</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Winning Competitor Leaderboard */}
              <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-[#0F5E63]" />
                  <span>Competitor Win Intelligence (§26)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Winning competitors recorded during commercial bid evaluations</p>

                <div className="space-y-2 pt-1">
                  {Object.keys(winLossReport.competitors || {}).length === 0 ? (
                    <div className="p-4 rounded-lg bg-[#FBFAF7] text-center text-xs text-[#4A5568]">
                      No competitor awards recorded in system yet.
                    </div>
                  ) : (
                    Object.entries(winLossReport.competitors || {}).map(([comp, count]) => (
                      <div key={comp} className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4 text-[#0F5E63]" />
                          <span className="font-bold text-xs text-[#14213D]">{comp}</span>
                        </div>
                        <Badge variant="danger" size="sm">{count as number} Awards</Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: DEADLINE & ESCALATIONS COMMAND (§24) */}
      {/* ========================================================================= */}
      {activeTab === 'deadlines' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SectionHeader
            title="Tender Deadline & Urgency Command Center (§24)"
            description="Active countdown alerts, pending internal signoffs, incomplete preparations, and post-submission result follow-ups"
          />

          {/* Group 1: Urgent (≤ 48 Hours) */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] border-l-4 border-l-[#9A3412] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[#9A3412]" />
                <h4 className="text-sm font-bold text-[#9A3412]">
                  Imminent Closing Deadlines (≤ 48 Hours)
                </h4>
              </div>
              <Badge variant="urgent" size="sm">
                {categorizedDeadlines.urgent.length} Critical Tenders
              </Badge>
            </div>

            {categorizedDeadlines.urgent.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                Zero tenders closing within the next 48 hours.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {categorizedDeadlines.urgent.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-xl border border-[#E9C9B4] bg-[#FBEBDD]/40 flex items-start justify-between">
                    <div>
                      <div className="font-bold text-xs text-[#14213D] flex items-center gap-1.5 font-mono">
                        <span>{t.tender_number || t.tender_no}</span>
                        <Badge variant="urgent" size="sm">CLOSING SOON</Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1 font-medium">{t.department}</p>
                      <p className="text-[10px] text-[#4A5568] mt-0.5">Deadline: {formatTaskDateTime(t.submission_deadline || t.bid_closing_date)} IST</p>
                      <p className="text-[10px] text-[#0F5E63] font-semibold mt-1">Owner: {t.owner_name || t.assigned_person_name || 'Unassigned'}</p>
                    </div>
                    <Button size="xs" variant="primary" onClick={() => openTenderDetails(t)}>
                      Inspect & Act
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group 2: Upcoming Submissions (Next 3 to 7 Days) (§24) */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[#0F5E63]" />
                <h4 className="text-sm font-bold text-[#14213D]">
                  Upcoming Submissions (Next 3 to 7 Days)
                </h4>
              </div>
              <Badge variant="outline" size="sm">
                {categorizedDeadlines.upcoming.length} Upcoming
              </Badge>
            </div>

            {categorizedDeadlines.upcoming.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                Zero submissions scheduled between 3 to 7 days.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categorizedDeadlines.upcoming.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white flex flex-col justify-between hover:border-[#0F5E63] transition-all">
                    <div>
                      <div className="font-bold text-xs text-[#14213D] flex items-center justify-between font-mono">
                        <span className="truncate">{t.tender_number || t.tender_no}</span>
                        <Badge variant="outline" size="sm">{tenderCategoryLabel(t.tender_category || t.category, t.category_name) || 'Tender'}</Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1 font-medium truncate">{t.department}</p>
                      <p className="text-[10px] text-[#4A5568] mt-0.5">
                        Closing: {formatTaskDate(t.submission_deadline || t.bid_closing_date)}
                      </p>
                      <p className="text-[10px] text-[#0F5E63] font-semibold mt-0.5">
                        Owner: {t.owner_name || t.assigned_person_name || 'Assigned Team'}
                      </p>
                    </div>
                    <div className="pt-2 flex items-center justify-end gap-1.5 border-t border-[#ECE9E2] mt-2">
                      <Button size="xs" variant="secondary" onClick={() => openTenderDetails(t)}>
                        Inspect & Draft
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group 3: Pending Internal Approvals (§24) — from the Deadline Centre itself (same server rule as the
              Approvals Inbox), never the register-filtered KPI, so it agrees with the rest of this unfiltered view. */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#0F5E63]" />
                <h4 className="text-sm font-bold text-[#14213D]">Pending Internal Approvals</h4>
              </div>
              <Badge variant="warning" size="sm">
                <span className="font-mono">{categorizedDeadlines.awaitingSignoff.length}</span>&nbsp;Pending
              </Badge>
            </div>
            {categorizedDeadlines.awaitingSignoff.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                No tender is awaiting internal approval.
              </div>
            ) : (
              <div className="p-3.5 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] flex flex-wrap items-center justify-between gap-3 text-xs text-[#4A5568]">
                <span>
                  {categorizedDeadlines.awaitingSignoff.length} tender{categorizedDeadlines.awaitingSignoff.length === 1 ? ' is' : 's are'} waiting for a
                  Management decision.
                </span>
                {!isSales && (
                  <Button size="xs" variant="primary" onClick={() => setActiveTab('approvals_inbox')}>
                    Open Approvals Inbox
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Group 4: Post-Submission Result Follow-Ups (§24) — submitted bids still waiting for a verdict */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-[#0F5E63]" />
                <h4 className="text-sm font-bold text-[#14213D]">Result Follow-Ups (Awaiting Award)</h4>
              </div>
              <Badge variant="info" size="sm">
                <span className="font-mono">{categorizedDeadlines.resultFollowups.length}</span>&nbsp;Submitted
              </Badge>
            </div>
            {categorizedDeadlines.resultFollowups.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                No pending result follow-ups. Every submitted bid has its outcome recorded.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categorizedDeadlines.resultFollowups.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white flex flex-col justify-between hover:border-[#0F5E63] transition-all">
                    <div>
                      <div className="font-bold text-xs text-[#14213D] flex items-center justify-between gap-2 font-mono">
                        <span className="truncate">{t.tender_number || t.tender_no}</span>
                        <Badge variant="cyber" size="sm">{STAGES.find((s) => s.key === t.status)?.label || String(t.status).replace(/_/g, ' ')}</Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1 font-medium truncate">{t.department || t.organisation_name}</p>
                      <p className="text-[10px] text-[#4A5568] mt-0.5">
                        Closed: {formatTaskDate(t.submission_deadline || t.bid_closing_date)}
                      </p>
                    </div>
                    <div className="pt-2 flex items-center justify-end gap-1.5 border-t border-[#ECE9E2] mt-2">
                      <Button size="xs" variant="secondary" onClick={() => openTenderDetails(t)}>
                        Inspect
                      </Button>
                      {/* Same lock as the register: no result before a submitted bid closes, none while on hold. */}
                      {canRecordResultOn(t) && (
                        <Button size="xs" variant="primary" leftIcon={<Award className="h-3.5 w-3.5" />} onClick={() => openOutcomeModal(t)}>
                          Record Result
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: EXTERNAL PORTAL ISSUES HUB (§25) */}
      {/* ========================================================================= */}
      {activeTab === 'portal_issues' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SectionHeader
            title="GeM & External Portal Issues Hub (§25)"
            description="Tracking external portal glitches with escalation and resolution governance. Note: BOS records the issue only; portal functionality is outside BOS scope."
          />

          {/* Global Portal Issues Table */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-3.5">Issue Details</th>
                    <th className="p-3.5">Affected Tender & Buyer</th>
                    <th className="p-3.5">Portal</th>
                    <th className="p-3.5">Reported Date & Person</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Resolution Notes</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {globalPortalIssues.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-xs text-[#4A5568]">
                        <CheckCircle2 className="h-8 w-8 text-[#0F5E63] mx-auto mb-2" />
                        Zero external portal issues recorded. GeM & CPPP submissions operating normally.
                      </td>
                    </tr>
                  ) : (
                    globalPortalIssues.map((issue) => (
                      <tr key={issue.id} className="hover:bg-[#FBFAF7]">
                        <td className="p-3.5 max-w-[280px]">
                          <span className="font-bold text-xs text-[#14213D] block">{issue.issue}</span>
                          {issue.escalated_to && (
                            <span className="text-[10px] text-[#7C2D12] bg-[#FFF8EB] px-1.5 py-0.5 rounded border border-[#E9C9B4] mt-1 inline-block">
                              Escalated to: {issue.escalated_to}
                            </span>
                          )}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="font-semibold text-xs text-[#14213D] block font-mono">{issue.tender_no || 'Tender'}</span>
                          <span className="text-[10px] text-[#4A5568] truncate block max-w-[180px]" title={issue.tender_department || issue.organisation_name || issue.organisation || undefined}>
                            {issue.tender_department || issue.organisation_name || issue.organisation || '—'}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <Badge variant="outline" size="sm">{issue.tender_portal || 'GeM'}</Badge>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="text-[#14213D] block">
                            {issue.reported_date ? formatTaskDate(String(issue.reported_date).slice(0, 10)) : 'N/A'}
                          </span>
                          <span className="text-[10px] text-[#4A5568] block">
                            By {issue.reported_by_name || 'Tender Team'}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <Badge
                            variant={
                              ['resolved', 'closed'].includes(issue.resolution_status?.toLowerCase())
                                ? 'success'
                                : ['escalated'].includes(issue.resolution_status?.toLowerCase())
                                  ? 'danger'
                                  : 'warning'
                            }
                            size="sm"
                          >
                            {String(issue.resolution_status || 'OPEN').toUpperCase().replace(/_/g, ' ')}
                          </Badge>
                        </td>

                        <td className="p-3.5 max-w-[240px]">
                          <span className="text-xs text-[#14213D] block truncate" title={issue.resolution}>
                            {issue.resolution || 'Pending resolution from portal desk.'}
                          </span>
                        </td>

                        <td className="p-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {!canManagePortalIssues && isOpenIssue(issue) && (
                              <span className="text-[10px] text-[#4A5568]">Tender Team handles escalation</span>
                            )}
                            {canManagePortalIssues && isOpenIssue(issue) && (
                              <>
                                {!['escalated'].includes(issue.resolution_status?.toLowerCase()) && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => handleUpdateIssueStatus(issue.tender_id, issue.id, 'ESCALATED')}
                                  >
                                    Escalate
                                  </Button>
                                )}
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => openResolveIssue(issue)}
                                >
                                  Resolve
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. Register New Tender Modal (All 15+ North Tender Sheet Fields) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Register New Tender Opportunity"
        description="Add a tender requirement to the centralized operational pipeline with transactional event publishing."
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateSubmit}>
          <FormSteps
            onCancel={() => setIsCreateOpen(false)}
            banner={
              actionError && (
                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
                  {actionError}
                </div>
              )
            }
            submit={
              <Button type="submit" isLoading={isSubmitting}>
                Register Tender
              </Button>
            }
            steps={[
              {
                title: 'Tender',
                icon: <FileText />,
                description: 'The bid number, the portal it is published on, and how it is classified. Every new tender starts as Identified and goes for internal approval.',
                content: (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Tender / GeM Bid No."
                      required
                      value={newTender.tender_no}
                      onChange={(e) => setNewTender({ ...newTender, tender_no: e.target.value })}
                      placeholder="e.g. GEM/2026/B/88219"
                    />
                    <Select
                      label="Tender Portal"
                      value={newTender.portal}
                      onChange={(e) => setNewTender({ ...newTender, portal: e.target.value })}
                      options={[
                        { value: 'GeM', label: 'Government e-Marketplace (GeM)' },
                        { value: 'CPPP', label: 'Central Public Procurement Portal (CPPP)' },
                        { value: 'State Portal', label: 'State Procurement Portal' },
                        { value: 'Direct / Manual', label: 'Direct Ministry RFP' },
                      ]}
                    />
                    <Select
                      label="Classification (§20)"
                      value={newTender.category}
                      onChange={(e) => setNewTender({ ...newTender, category: e.target.value })}
                      options={[
                        { value: 'general_mha', label: 'General / MHA Tender' },
                        { value: 'pq', label: 'Pre-Qualification (PQ)' },
                        { value: 'other', label: 'Other Configured Tender' },
                      ]}
                    />
                  </div>
                ),
              },
              {
                title: 'Buyer',
                icon: <Building />,
                description: 'Who is buying and where they are — this decides the zone and region that own the tender.',
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Mapped Organisation"
                        required
                        value={newTender.organisation_id}
                        onChange={(e) => handleOrgChange(e.target.value)}
                      >
                        <option value="">-- Select Organisation --</option>
                        {organisations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        label="Buyer Department / Ministry"
                        required
                        value={newTender.department}
                        onChange={(e) => setNewTender({ ...newTender, department: e.target.value })}
                        placeholder="e.g. Directorate General Border Security Force (BSF)"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Territory Zone (§21)"
                        value={newTender.zone}
                        onChange={(e) => handleZoneChange(e.target.value)}
                        options={
                          zonesMaster.length > 0
                            ? zonesMaster.map((z) => ({ value: z.name, label: `${z.name} Zone (${z.code})` }))
                            : [
                              { value: 'North', label: 'North Zone (N)' },
                              { value: 'North East', label: 'North East Zone (NE)' },
                              { value: 'South', label: 'South Zone (S)' },
                              { value: 'East', label: 'East Zone (E)' },
                              { value: 'West', label: 'West Zone (W)' },
                            ]
                        }
                      />
                      <Select
                        label="Territory Region (§21)"
                        value={newTender.region}
                        onChange={(e) => handleRegionChange(e.target.value)}
                        options={
                          availableRegions.length > 0
                            ? availableRegions.map((r) => ({ value: r.name, label: r.name }))
                            : [
                              { value: 'Delhi NCR', label: 'Delhi NCR' },
                              { value: 'Punjab & Chandigarh', label: 'Punjab & Chandigarh' },
                              { value: 'Haryana', label: 'Haryana' },
                              { value: 'Rajasthan', label: 'Rajasthan' },
                              { value: 'Uttar Pradesh', label: 'Uttar Pradesh' },
                              { value: 'Jammu & Kashmir', label: 'Jammu & Kashmir' },
                            ]
                        }
                      />
                      <Input
                        label="City"
                        required
                        value={newTender.city}
                        onChange={(e) => setNewTender({ ...newTender, city: e.target.value })}
                        placeholder="e.g. New Delhi"
                      />
                      <Input
                        label="State"
                        required
                        value={newTender.state}
                        onChange={(e) => setNewTender({ ...newTender, state: e.target.value })}
                        placeholder="e.g. Delhi"
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Requirement',
                icon: <Layers />,
                description: 'What is being procured, how many, and the expected value and EMD.',
                content: (
                  <div className="space-y-3">
                    <Select
                      label="Product / Equipment Suite"
                      value={newTender.product_id}
                      onChange={(e) => setNewTender({ ...newTender, product_id: e.target.value })}
                    >
                      <option value="">-- Select Product / System --</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.category || 'Security/Defence'})
                        </option>
                      ))}
                    </Select>
                    <Textarea
                      label="Product Requirement & Scope"
                      required
                      rows={2}
                      value={newTender.requirement_text}
                      onChange={(e) => setNewTender({ ...newTender, requirement_text: e.target.value })}
                      placeholder="e.g. Passive Night Vision Monoculars as per MHA Qualitative Requirements with Belgian Photonis Tubes"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Quantity"
                        type="number"
                        min="1"
                        value={newTender.quantity}
                        onChange={(e) => setNewTender({ ...newTender, quantity: Number(e.target.value) })}
                      />
                      <Input
                        label="Est. Value (₹ Lakh)"
                        type="number"
                        step="0.01"
                        min="0"
                        value={newTender.estimated_value_lakh}
                        onChange={(e) => setNewTender({ ...newTender, estimated_value_lakh: e.target.value })}
                        placeholder="e.g. 150.00"
                      />
                      <Input
                        label="EMD Fee (₹)"
                        type="number"
                        min="0"
                        value={newTender.emd_fee}
                        onChange={(e) => setNewTender({ ...newTender, emd_fee: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Dates & Team',
                icon: <Calendar />,
                description: 'Key dates, who works the tender, and any internal notes.',
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Publication Date"
                        type="date"
                        required
                        value={newTender.publication_date}
                        onChange={(e) => setNewTender({ ...newTender, publication_date: e.target.value })}
                      />
                      <Input
                        label="Submission Deadline (IST)"
                        type="datetime-local"
                        required
                        min={newTender.publication_date ? `${newTender.publication_date}T00:00` : undefined}
                        value={newTender.submission_deadline}
                        onChange={(e) => setNewTender({ ...newTender, submission_deadline: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Assigned Salesperson"
                        placeholder="-- Select Assigned Salesperson --"
                        helperText="Ground executive managing client meetings, QRs, trials & depot demos."
                        value={newTender.assigned_person_id}
                        onChange={(e) => setNewTender({ ...newTender, assigned_person_id: e.target.value })}
                      >
                        <option value="">-- Unassigned (None) --</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {userWithRole(u)}
                          </option>
                        ))}
                      </Select>
                      <Select
                        label="Tender Owner (Responsible Executive)"
                        placeholder="-- Default (Same as Assigned) --"
                        helperText="Accountable executive for bid review, approvals & GeM submission."
                        value={newTender.tender_owner_id}
                        onChange={(e) => setNewTender({ ...newTender, tender_owner_id: e.target.value })}
                      >
                        <option value="">-- Same as Assigned Person --</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {userWithRole(u)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      label="Internal Notes / Remarks"
                      value={newTender.remarks}
                      onChange={(e) => setNewTender({ ...newTender, remarks: e.target.value })}
                      placeholder="e.g. Requires Belgian OEM authorization. Ensure 2% margin threshold."
                    />
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 6. Dual-Control Approval Modal */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isApproveOpen}
        onClose={() => setIsApproveOpen(false)}
        title="Commit Executive Endorsement"
        description={`Decision for ${selectedTender?.tender_number || selectedTender?.tender_no}`}
        maxWidth="md"
      >
        <form onSubmit={handleApproveSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          <Select
            label="Decision"
            value={approvalDecision}
            onChange={(e) => setApprovalDecision(e.target.value as any)}
            options={[
              { value: 'approved', label: 'Approve Participation & Mobilize Preparation' },
              { value: 'rejected', label: 'Decline / Reject Opportunity Internally' },
            ]}
          />

          {approvalDecision === 'rejected' && (
            <Select
              label="Rejection Justification"
              required
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              options={[
                { value: '', label: '-- Select Reason --' },
                { value: 'Insufficient eligibility', label: 'Insufficient eligibility (Turnover / Experience QR)' },
                { value: 'Commercial concern', label: 'Commercial concern (Unviable margin or high penalty)' },
                { value: 'Documentation unavailable', label: 'Documentation unavailable (OEM Authorization missing)' },
                { value: 'Management decision', label: 'Management decision' },
                { value: 'Other', label: 'Other operational reason' },
              ]}
            />
          )}

          <Input
            label="Directives / Remarks"
            value={approvalRemarks}
            onChange={(e) => setApprovalRemarks(e.target.value)}
            placeholder="e.g. Approved with Belgian OEM authorization. Ensure 2% margin."
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsApproveOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Commit Endorsement
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 7. Stage Transition Modal */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isTransitionOpen}
        onClose={() => setIsTransitionOpen(false)}
        title="Advance Tender Lifecycle Stage"
        description={`Transition from ${selectedTender?.status} to ${targetTransitionStatus}`}
        maxWidth="md"
      >
        <form onSubmit={handleTransitionSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          {targetTransitionStatus === 'submitted' && (
            <Input
              label="Portal Submission Date"
              type="date"
              required
              max={istToday()}
              value={transitionSubmissionDate}
              onChange={(e) => setTransitionSubmissionDate(e.target.value)}
            />
          )}

          <Input
            label="Transition Notes / Remarks"
            value={transitionRemarks}
            onChange={(e) => setTransitionRemarks(e.target.value)}
            placeholder="e.g. Technical documents successfully submitted on GeM portal."
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsTransitionOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Confirm Stage Advancement
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 8. Final Structured Outcome (Won / Lost) Modal (§26) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isOutcomeOpen}
        onClose={() => setIsOutcomeOpen(false)}
        title="Record Tender Outcome (§26)"
        description={
          selectedTender
            ? [selectedTender.tender_number || selectedTender.tender_no, selectedTender.department || selectedTender.organisation_name].filter(Boolean).join(' · ')
            : 'Won or lost, with the award or loss post-mortem, on one screen.'
        }
        maxWidth="2xl"
      >
        {/* One screen: the verdict picks which section shows (award when won, loss post-mortem when lost). */}
        <form onSubmit={handleOutcomeSubmit} className="space-y-5">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          <FormSection title="Verdict" icon={<Award />} description="Did we win or lose, and when was the result declared?">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Final Result"
                value={outcomeResult}
                onChange={(e) => setOutcomeResult(e.target.value as any)}
                options={[
                  { value: 'won', label: 'Won – order awarded to Arihant' },
                  { value: 'lost', label: 'Lost – awarded to a competitor, or not qualified at PQ / technical stage' },
                ]}
              />
              <Input
                label="Result Declaration Date"
                type="date"
                required
                min={outcomeMinResultDate && outcomeMinResultDate <= istToday() ? outcomeMinResultDate : undefined}
                max={istToday()}
                value={outcomeResultDate}
                onChange={(e) => setOutcomeResultDate(e.target.value)}
                helperText={outcomeMinResultDate ? `Bid closed ${formatTaskDate(outcomeMinResultDate)} — the result cannot be dated earlier.` : undefined}
              />
            </div>
          </FormSection>

          {outcomeResult === 'won' ? (
            <FormSection title="Award" icon={<CheckCircle2 />} description="What was awarded, where, to whose credit, and for how much.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Awarded Product (§26)"
                  value={outcomeProductId}
                  onChange={(e) => setOutcomeProductId(e.target.value)}
                  options={[
                    { value: '', label: 'Select or retain assigned product...' },
                    ...products.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
                <Select
                  label="Tender Category (§26)"
                  value={outcomeCategory}
                  onChange={(e) => setOutcomeCategory(e.target.value)}
                  options={[
                    { value: 'pq', label: 'PQ - Pre-Qualification' },
                    { value: 'general_mha', label: 'General / MHA' },
                    { value: 'other', label: 'Other Opportunity' },
                  ]}
                />
                <Select
                  label="Award Region (§26)"
                  value={outcomeRegionId}
                  onChange={(e) => setOutcomeRegionId(e.target.value)}
                  options={[
                    { value: '', label: 'Select region...' },
                    ...regionsMaster.map((r) => ({ value: r.id, label: `${r.name} (${r.zone_name || 'Zone'})` })),
                  ]}
                />
                <Select
                  label="Responsible Executive (§26)"
                  value={outcomeResponsiblePersonId}
                  onChange={(e) => setOutcomeResponsiblePersonId(e.target.value)}
                  options={[
                    { value: '', label: 'Select responsible person...' },
                    ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
                  ]}
                />
                <Input
                  label="Final Contract Award Value (₹ Lakh)"
                  type="number"
                  step="0.01"
                  value={outcomeValueLakh}
                  onChange={(e) => setOutcomeValueLakh(e.target.value)}
                  placeholder="e.g. 145.50"
                />
              </div>
            </FormSection>
          ) : (
            <FormSection title="Loss Post-Mortem" icon={<XCircle />} description="The main reason we lost, who won, and the factors that applied (§26).">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Primary Structured Loss Reason (§26)"
                  required
                  value={outcomeLossReason}
                  onChange={(e) => setOutcomeLossReason(e.target.value)}
                  options={[
                    { value: 'price', label: 'Price (Competitor underquoted L1)' },
                    { value: 'competitor', label: 'Competitor advantage / preference' },
                    { value: 'technical', label: 'Technical rejection / QR non-compliance' },
                    { value: 'eligibility', label: 'Eligibility / Past experience shortfall' },
                    { value: 'documentation', label: 'Documentation / Tender error / missed certificate' },
                    { value: 'customer_decision', label: 'Customer cancellation / retender' },
                    { value: 'other', label: 'Other reason' },
                  ]}
                />
                <Input
                  label="Winning Competitor Name (if known)"
                  value={outcomeCompetitor}
                  onChange={(e) => setOutcomeCompetitor(e.target.value)}
                  placeholder="e.g. Falcon Security / BEL / MKU / Zicom"
                />
                <Input
                  label="Technical Issue (if applicable)"
                  value={outcomeTechnicalIssue}
                  onChange={(e) => setOutcomeTechnicalIssue(e.target.value)}
                  placeholder="e.g. Lab trial QR shortfall"
                />
                <Input
                  label="Pricing Issue / L1 Gap (if applicable)"
                  value={outcomePricingIssue}
                  onChange={(e) => setOutcomePricingIssue(e.target.value)}
                  placeholder="e.g. Quoted ₹14.2L vs L1 ₹13.8L"
                />
                <Input
                  label="Eligibility Shortfall (if applicable)"
                  value={outcomeEligibilityIssue}
                  onChange={(e) => setOutcomeEligibilityIssue(e.target.value)}
                  placeholder="e.g. 3-yr turnover criteria"
                />
                <Input
                  label="Documentation Issue (if applicable)"
                  value={outcomeDocumentationIssue}
                  onChange={(e) => setOutcomeDocumentationIssue(e.target.value)}
                  placeholder="e.g. Missing OEM authorization"
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Other Reason Notes (if applicable)"
                    value={outcomeOtherReason}
                    onChange={(e) => setOutcomeOtherReason(e.target.value)}
                    placeholder="e.g. Buyer canceled tender due to budget re-allocation"
                  />
                </div>
              </div>
            </FormSection>
          )}

          <FormSection title="Debrief" icon={<FileText />} description="What we learned from this result, for win-rate and loss-pattern analysis.">
            <Input
              label="Outcome Intelligence Remarks"
              value={outcomeRemarks}
              onChange={(e) => setOutcomeRemarks(e.target.value)}
              placeholder="e.g. Debrief completed with DIG communication officer."
              required
            />
          </FormSection>

          {/* pinned to the bottom of the dialog so Save never sits below the fold on a phone */}
          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex justify-end gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsOutcomeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Save Outcome
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* Resolve Portal Issue Modal (§25): in-app resolution notes */}
      {/* ========================================================================= */}
      <Modal
        isOpen={Boolean(issueToResolve)}
        onClose={() => setIssueToResolve(null)}
        title="Resolve Portal Issue"
        description={
          issueToResolve
            ? [issueToResolve.tender_number || issueToResolve.tender_no, issueToResolve.issue].filter(Boolean).join(' · ')
            : undefined
        }
        maxWidth="md"
      >
        <form onSubmit={handleResolveIssue} className="space-y-4">
          {resolveError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">{resolveError}</div>
          )}
          <Textarea
            label="Resolution Notes"
            required
            rows={3}
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            placeholder="e.g. GeM desk added the category; bid uploaded successfully. Ticket #88412 closed."
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIssueToResolve(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="success" isLoading={isResolving}>
              Mark Resolved
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 9. Log External Portal Issue Modal (§25) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isNewIssueOpen}
        onClose={() => setIsNewIssueOpen(false)}
        title="Report GeM / External Portal Issue (§25)"
        description="Document an internal issue with the external tender portal for escalation and resolution tracking."
        maxWidth="md"
      >
        <form onSubmit={handleCreateIssue} className="space-y-5">
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-[#4A5568] flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#9A3412] mt-0.5" />
            <span><strong>Notice:</strong> BOS records the issue only; portal functionality is outside BOS scope.</span>
          </div>
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          <FormSection title="Issue" icon={<AlertOctagon />} description="Which tender, when it happened, and what went wrong.">
            <Input
              label="Find Tender"
              type="search"
              value={issueTenderQuery}
              onChange={(e) => setIssueTenderQuery(e.target.value)}
              placeholder="Type a tender no., buyer, requirement or city…"
              helperText={
                isSearchingIssueTenders
                  ? 'Searching tenders…'
                  : issueTenderMatches.length
                    ? `${issueTenderMatches.length} matching tender${issueTenderMatches.length === 1 ? '' : 's'} — pick one below.`
                    : 'No tender matches this search.'
              }
            />
            <Select
              label="Affected Tender (§25)"
              required
              value={issueTenderId}
              onChange={(e) => {
                setIssueTenderId(e.target.value);
                setIssueTenderPicked(issueTenderOptions.find((t) => t.id === e.target.value) || null);
              }}
              options={[
                { value: '', label: 'Select the affected tender...' },
                ...issueTenderOptions.map((t) => ({
                  value: t.id,
                  label: `${t.tender_number || t.tender_no} - ${t.department || t.organisation_name || 'Tender'}`,
                })),
              ]}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Date of Incident / Report (§25)"
                type="date"
                required
                max={istToday()}
                value={issueReportedDate}
                onChange={(e) => setIssueReportedDate(e.target.value)}
              />

              <Select
                label="Initial Status (§25)"
                value={issueResolutionStatus}
                onChange={(e) => setIssueResolutionStatus(e.target.value)}
                options={[
                  { value: 'OPEN', label: 'OPEN - Under investigation' },
                  { value: 'IN_PROGRESS', label: 'IN_PROGRESS - Workaround in flight' },
                  { value: 'ESCALATED', label: 'ESCALATED - Raised to GeM Desk' },
                ]}
              />
            </div>

            <Textarea
              label="Issue Description (§25)"
              required
              rows={3}
              value={newIssueText}
              onChange={(e) => setNewIssueText(e.target.value)}
              placeholder="e.g. Required equipment category does not appear on GeM portal dropdown."
            />
          </FormSection>

          <FormSection title="Follow-up" icon={<UserCheck />} description="Who owns the fix and where it has been escalated.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Responsible Person (§25)"
                value={issueResponsiblePerson}
                onChange={(e) => setIssueResponsiblePerson(e.target.value)}
                options={[
                  { value: '', label: 'Select responsible person...' },
                  ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
                ]}
              />

              <Input
                label="Escalation Target (§25)"
                value={issueEscalatedTo}
                onChange={(e) => setIssueEscalatedTo(e.target.value)}
                placeholder="e.g. Executive Management & GeM Desk Ticket #88412"
              />
            </div>
          </FormSection>

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsNewIssueOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Log Issue
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 10. Enterprise 11-Tab Tender Dossier Modal (Operational Blueprint) */}
      {/* ========================================================================= */}
      <TenderDossierModal
        isOpen={isDossierOpen}
        onClose={() => {
          setIsDossierOpen(false);
          setDossierTenderId(null);
        }}
        tenderId={dossierTenderId}
        currentUser={user}
        users={users}
        onTenderUpdated={() => {
          fetchTenders();
          fetchDashboardStats();
          fetchReports();
        }}
        // closes the dossier first so the outcome form is the only pop-up on screen
        onRecordOutcome={
          canRecordOutcome
            ? (t) => {
                setIsDossierOpen(false);
                setDossierTenderId(null);
                openOutcomeModal(t);
              }
            : undefined
        }
      />

      {/* ========================================================================= */}
      {/* 11. Master Configuration & Governance Modal */}
      {/* ========================================================================= */}
      <TenderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentUser={user}
      />

      {/* ========================================================================= */}
      {/* 12. Arihant Tender Sheet Bulk Import Wizard Modal */}
      {/* ========================================================================= */}
      <BulkImportWizardModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportComplete={() => {
          fetchTenders();
          fetchDashboardStats();
          fetchReports();
        }}
      />
    </PageContainer>
  );
}
