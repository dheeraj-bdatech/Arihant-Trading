'use client';

import Link from 'next/link';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { twMerge } from 'tailwind-merge';
import {
  Wrench,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  ShieldAlert,
  FileCheck,
  RefreshCw,
  Calendar,
  UserCheck,
  Package,
  Phone,
  Flame,
  Users,
  Repeat,
  Globe2,
  Link2,
  ShieldQuestion,
  PauseCircle,
  Play,
  RotateCcw,
  Ban,
  Search,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { dropUrlParams } from '@/lib/url-filters';
import { useOpenParam } from '@/lib/use-open-param';
import { canOpen } from '@/lib/route-access';
import { RelatedRecords } from '@/components/links/RelatedRecords';
import {
  Button,
  Badge,
  Card,
  Modal,
  PageContainer,
  PageHeader,
  EmptyState,
  StatCard,
  StatGrid,
  InfoCallout,
  PageLoader,
  FilterMenu,
  RecordViews,
  RecordTable,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  formatDateIN,
  daysFromToday,
  toneFor,
  type BadgeProps,
  type RecordItem,
  ScrollStrip, formatDateTimeIN,
  BarList,
  SectionHeader,
  type BarListItem } from '@/components/ui';
import { allowedNextServiceStatuses, normalizeServiceStatus, serviceResolveBlocker, type ServiceStatus } from '@arihant/shared';
import {
  errMsg,
  warrantyLabel,
  statusLabel,
  statusBadgeVariant,
  isFinished,
  isPortalTicket,
  isUnverified,
  isSlaPaused,
  isAssignedEngineer,
  STATUS_ROLES,
  MANAGER_ROLES,
  LINK_ROLES,
} from '@/components/service/serviceHelpers';
import { SlaPanel, SlaPausedPill } from '@/components/service/ServiceSla';
import { UnverifiedBanner } from '@/components/service/UnverifiedBanner';
import { StatusActionModal, type Engineer } from '@/components/service/StatusActionModal';
import { CloseTicketModal } from '@/components/service/CloseTicketModal';
import { LinkOrganisationModal } from '@/components/service/LinkOrganisationModal';
import { ReportFormModal } from '@/components/service/ReportFormModal';
import { TicketDetailsModal } from '@/components/service/TicketDetailsModal';
import { ReassignEngineerModal } from './_lib/ReassignEngineerModal';
import { CreateServiceTicketModal } from './_lib/CreateServiceTicketModal';
import { VisitsTab } from '@/components/service/VisitsTab';
import { PartsTab } from '@/components/service/PartsTab';
import { ReportsTab } from '@/components/service/ReportsTab';
import { NotesTab, AuditTab } from '@/components/service/NotesAuditTabs';

/** One thing a user can do to a ticket right now (derived from allowed_next_statuses + role). */
type TicketAction =
  | { kind: 'status'; target: ServiceStatus; label: string; tone: 'primary' | 'secondary' | 'exception' }
  | { kind: 'report'; label: string; tone: 'primary' }
  | { kind: 'reassign'; label: string; tone: 'secondary' }
  | { kind: 'close'; label: string; tone: 'primary' };

const ACTION_LABEL: Partial<Record<ServiceStatus, string>> = {
  created: 'Register ticket',
  assigned: 'Assign engineer',
  visit_scheduled: 'Schedule visit',
  in_progress: 'Start / resume work',
  resolved: 'Mark resolved',
  awaiting_part: 'Awaiting spare part',
  awaiting_customer: 'Awaiting customer',
  escalated: 'Escalate',
  on_hold: 'Put on hold',
  revisit_required: 'Revisit required',
  cancelled: 'Cancel ticket',
  reopened: 'Reopen ticket',
  received: 'Back to intake (unassign)',
};
const EXCEPTION_TARGETS: ServiceStatus[] = ['awaiting_part', 'awaiting_customer', 'escalated', 'on_hold', 'revisit_required', 'cancelled'];
const ACTION_ORDER = ['assigned', 'visit_scheduled', 'in_progress', 'report', 'resolved', 'closed', 'reassign', 'reopened', 'created', 'received'];

const ACTION_ICON: Record<string, React.ReactNode> = {
  assigned: <UserCheck className="h-3.5 w-3.5 mr-1" />,
  visit_scheduled: <Calendar className="h-3.5 w-3.5 mr-1" />,
  in_progress: <Play className="h-3.5 w-3.5 mr-1" />,
  resolved: <CheckCircle2 className="h-3.5 w-3.5 mr-1" />,
  awaiting_part: <Package className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />,
  awaiting_customer: <Clock className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />,
  on_hold: <PauseCircle className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />,
  escalated: <ShieldAlert className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />,
  revisit_required: <RotateCcw className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />,
  cancelled: <Ban className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />,
  reopened: <Repeat className="h-3.5 w-3.5 mr-1" />,
  report: <FileCheck className="h-3.5 w-3.5 mr-1" />,
  closed: <CheckCircle2 className="h-3.5 w-3.5 mr-1" />,
  reassign: <Users className="h-3.5 w-3.5 mr-1" />,
};
/** Bare glyphs for the record cards' icon buttons (the Quick button sizes them). */
const ACTION_GLYPH: Record<string, LucideIcon> = {
  assigned: UserCheck,
  visit_scheduled: Calendar,
  in_progress: Play,
  resolved: CheckCircle2,
  awaiting_part: Package,
  awaiting_customer: Clock,
  on_hold: PauseCircle,
  escalated: ShieldAlert,
  revisit_required: RotateCcw,
  cancelled: Ban,
  reopened: Repeat,
  report: FileCheck,
  closed: CheckCircle2,
  reassign: Users,
};
const actionKey = (a: TicketAction) => (a.kind === 'status' ? a.target : a.kind === 'report' ? 'report' : a.kind === 'reassign' ? 'reassign' : 'closed');
const actionRank = (a: TicketAction) => {
  const i = ACTION_ORDER.indexOf(actionKey(a));
  return i === -1 ? 99 : i;
};

const WORKLOAD_BADGE: Record<string, 'success' | 'info' | 'warning' | 'urgent' | 'default'> = {
  AVAILABLE: 'success',
  'OPTIMAL LOAD': 'info',
  'HEAVY QUEUE': 'warning',
  'OVERDUE RISK': 'urgent',
};

/* Register table (list view) badge tones */
type BadgeVariant = NonNullable<BadgeProps['variant']>;
const ticketStatusBadge = (status?: string | null): BadgeVariant => {
  const s = normalizeServiceStatus(status);
  if (['resolved', 'report_submitted', 'closed'].includes(s)) return 'success';
  if (['awaiting_part', 'awaiting_customer', 'on_hold', 'revisit_required', 'reopened'].includes(s)) return 'warning';
  if (['received', 'created', 'assigned', 'visit_scheduled', 'in_progress'].includes(s)) return 'default';
  if (s === 'escalated') return 'danger';
  return 'outline';
};
const priorityBadge = (p?: string | null): BadgeVariant => (p === 'critical' || p === 'high' ? 'danger' : p === 'medium' ? 'warning' : 'default');
const upperLabel = (s?: string | null) => String(s || '—').replace(/_/g, ' ');

type ActionCtx = { kind: 'status' | 'close' | 'report' | 'link' | 'reassign' | 'details'; ticket: any; target?: ServiceStatus };
/** "Flags" dropdown: single-select; each key is a server-side list filter of the same name. */
const FLAG_KEYS = ['all', 'portal', 'assigned', 'unassigned', 'no_machine', 'sla_breached', 'overdue', 'repeat', 'unverified'] as const;
type FlagKey = (typeof FLAG_KEYS)[number];

export default function ServicePage() {
  const { user } = useAuth();
  const role = (user?.role as string) || '';
  const userId = user?.id || '';

  // Data states
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [stats, setStats] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

  // Filters (all applied server-side, the pipeline stage included)
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [activeFlag, setActiveFlag] = useState<FlagKey>('all');
  // ?stage= / ?flag= deep links are read once mounted (below); the first fetch waits for them
  const [urlFiltersRead, setUrlFiltersRead] = useState(false);

  // Reference data
  const [serviceEngineers, setServiceEngineers] = useState<any[]>([]);

  // Modals
  const [isLogTicketOpen, setIsLogTicketOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isWorkloadModalOpen, setIsWorkloadModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [actionCtx, setActionCtx] = useState<ActionCtx | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const [detailTab, setDetailTab] = useState<'overview' | 'visits' | 'reports' | 'parts' | 'comments' | 'history' | 'linked'>('overview');

  // Engineers the current user may dispatch, as the API decides (GET /service/engineers): managers everyone in
  // scope, a chief service engineer his depot team, a field engineer only himself.
  const engineers: Engineer[] = useMemo(
    () => serviceEngineers.map((u: any) => ({ id: u.id as string, name: (u.full_name || u.email) as string })),
    [serviceEngineers],
  );
  const engineerNames = useMemo(() => Object.fromEntries(serviceEngineers.map((u: any) => [u.id, u.full_name || u.email])), [serviceEngineers]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fetch tickets & stats — both with the same filters. The API counts each tile/stage without its own
  // dimension, so a tile's number is exactly what the list totals once that tile is clicked.
  const fetchSeq = useRef(0);
  const fetchData = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      setLoadError(null);
      const filters = {
        stage: activeTab !== 'all' ? activeTab : undefined,
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        complaint_source: sourceFilter !== 'all' ? sourceFilter : undefined,
        ...(activeFlag !== 'all' ? { [activeFlag]: 'true' } : {}),
        search: debouncedSearch || undefined,
      };
      const [ticketsRes, statsRes] = await Promise.all([
        api.get('/service/tickets', { ...filters, limit: 100 }),
        api.get('/service/stats', filters).catch(() => null),
      ]);
      if (seq !== fetchSeq.current) return; // filters changed meanwhile: a newer response owns the screen
      setTickets(ticketsRes.data || []);
      setTicketTotal(ticketsRes.total ?? (ticketsRes.data || []).length);
      // No stats (endpoint failed): drop stale numbers so the tiles fall back to counts over the loaded list.
      setStats(statsRes || null);
    } catch (err) {
      if (seq !== fetchSeq.current) return; // a newer request owns the screen: its result (or error) is what counts
      console.error('Failed to load service tickets:', err);
      setLoadError(errMsg(err, 'Failed to load service tickets.'));
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false);
    }
  }, [activeTab, priorityFilter, sourceFilter, activeFlag, debouncedSearch]);

  useEffect(() => {
    if (urlFiltersRead) fetchData();
  }, [fetchData, urlFiltersRead]);

  // Load auxiliary reference data (the new-ticket popup loads its own)
  useEffect(() => {
    if (['management', 'regional_manager', 'service_team', 'admin'].includes(role)) {
      api
        .get('/service/engineers')
        .then((res: any) => setServiceEngineers(Array.isArray(res) ? res : res?.data || []))
        .catch(() => setServiceEngineers([]));
    }
  }, [role]);

  // Pipeline stages (§32): the API filters by `stage` and counts each one (stats.stageCounts). This mirror of
  // its stage map only places loaded tickets into board lanes, and backs the counts if stats failed to load.
  const matchesTab = useCallback((tab: string, status: string) => {
    const s = normalizeServiceStatus(status);
    if (tab === 'all') return true;
    if (tab === 'open') return ['received', 'created'].includes(s);
    if (tab === 'assigned') return ['assigned', 'visit_scheduled'].includes(s);
    if (tab === 'in_progress') return s === 'in_progress';
    if (tab === 'awaiting') return ['awaiting_part', 'awaiting_customer', 'on_hold'].includes(s);
    if (tab === 'escalated') return ['escalated', 'revisit_required', 'reopened'].includes(s);
    if (tab === 'reports') return ['report_submitted', 'resolved'].includes(s);
    if (tab === 'closed') return ['closed', 'cancelled'].includes(s);
    if (tab === 'completed') return ['report_submitted', 'closed'].includes(s);
    if (tab === 'pending') return !isFinished(s);
    return s === tab; // awaiting_part included
  }, []);
  // the API already applied every filter, the stage included
  const displayedTickets = tickets;

  const tabCount = (tab: string): number =>
    stats?.stageCounts?.[tab] ?? (tab === 'all' ? tickets.length : tickets.filter((t) => matchesTab(tab, t.status)).length);

  const anyFilter = sourceFilter !== 'all' || priorityFilter !== 'all' || activeFlag !== 'all' || activeTab !== 'all' || !!searchQuery;
  const clearFilters = () => {
    setSourceFilter('all');
    setPriorityFilter('all');
    setActiveFlag('all');
    setSearchQuery('');
    setActiveTab('all');
  };
  // Phones: the list sits below the KPI tiles and the summary cards, so a tile that turns a filter on
  // brings the filter row (and the list under it) up; otherwise the tap looks like it did nothing.
  const filterRowRef = useRef<HTMLDivElement>(null);
  const revealList = () => {
    const el = filterRowRef.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /** Flag tiles / "Flags" menu: single-select, click the active one again to clear. Other filters stay. */
  /** Same rule as PATCH /service/tickets/:id/details: managers, the chief service engineer, or the ticket's own engineer. */
  const canEditDetails = (t: any) =>
    ['management', 'admin', 'regional_manager'].includes(role) ||
    (role === 'service_team' &&
      (t.assigned_to === userId || (Array.isArray(t.additional_engineer_ids) && t.additional_engineer_ids.includes(userId)) || !!t.can_supervise));

  const pickFlag = (key: FlagKey) => {
    if (activeFlag !== key) revealList();
    setActiveFlag((cur) => (cur === key ? 'all' : key));
  };
  /** KPI tile that switches the stage filter (click again to clear). */
  const toggleStage = (tab: string) => {
    if (activeTab !== tab) revealList();
    setActiveTab((cur) => (cur === tab ? 'all' : tab));
  };

  const STAGES: { id: string; label: string; tile?: true }[] = [
    { id: 'all', label: 'All stages' },
    { id: 'open', label: 'New intake' },
    { id: 'assigned', label: 'Assigned & scheduled' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'awaiting', label: 'Awaiting / on hold' },
    { id: 'escalated', label: 'Escalated, revisit & reopened' },
    { id: 'reports', label: 'Reports filed' },
    { id: 'closed', label: 'Closed / cancelled' },
    // KPI tile stages, each overlapping the pipeline stages above (so none is a board lane):
    // "Pending Queue" = every unfinished ticket; "Awaiting Parts / Spares" = a slice of awaiting;
    // "Completed & Signed" = signed-off report filed (awaiting close) + closed
    { id: 'pending', label: 'Pending queue', tile: true },
    { id: 'awaiting_part', label: 'Awaiting parts', tile: true },
    { id: 'completed', label: 'Completed & signed', tile: true },
  ];
  const SOURCES: { key: string; label: string }[] = [
    { key: 'all', label: 'All channels' },
    { key: 'Phone', label: 'Client helpline call' },
    { key: 'Email', label: 'Official client email' },
    { key: 'Official Letter', label: 'Govt written dispatch' },
    { key: 'Customer Portal', label: 'Customer portal' },
    { key: 'Demo Team', label: 'Demo team (trials/demos)' },
    { key: 'Sales Rep', label: 'Sales field rep' },
    { key: 'Field Visit', label: 'Field inspection discovery' },
    { key: 'Walk-in', label: 'Depot walk-in' },
    { key: 'WhatsApp', label: 'WhatsApp hotline' },
    { key: 'Auto-PM', label: 'Auto preventive maintenance' },
  ];
  const PRIORITIES: { key: string; label: string }[] = [
    { key: 'all', label: 'All priorities' },
    { key: 'critical', label: 'Critical (LD risk)' },
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Routine / preventative' },
  ];

  /* ------------------------------- helpers ------------------------------- */
  const fetchDetail = useCallback(async (id: string) => api.get(`/service/tickets/${id}`), []);

  /** Reload list + stats and, when open, the dossier. */
  const refreshAll = useCallback(async () => {
    await fetchData();
    const id = selectedIdRef.current;
    if (id) {
      try {
        const fresh = await fetchDetail(id);
        if (selectedIdRef.current === id) setSelectedTicket(fresh);
      } catch {
        /* ticket may have left this user's scope */
      }
    }
  }, [fetchData, fetchDetail]);

  const actionCtxRef = useRef<ActionCtx | null>(null);
  useEffect(() => {
    actionCtxRef.current = actionCtx;
  }, [actionCtx]);
  const refreshActionTicket = useCallback(async () => {
    const id = actionCtxRef.current?.ticket?.id;
    if (!id) return;
    try {
      const fresh = await fetchDetail(id);
      setActionCtx((ctx) => (ctx ? { ...ctx, ticket: fresh } : ctx));
    } catch {
      /* ignore */
    }
    await refreshAll();
  }, [fetchDetail, refreshAll]);

  /** What this user may do to this ticket right now. */
  const getActions = useCallback(
    (t: any): TicketAction[] => {
      if (!STATUS_ROLES.includes(role)) return [];
      const status = normalizeServiceStatus(t.status);
      const allowed: ServiceStatus[] = (t.allowed_next_statuses as ServiceStatus[]) || allowedNextServiceStatuses(status);
      const isManager = MANAGER_ROLES.includes(role);
      // the API lets a service engineer take a ticket off its engineer only if it is theirs or held by one they dispatch
      const mayTakeFrom = role !== 'service_team' || !t.assigned_to || t.assigned_to === userId || engineers.some((e) => e.id === t.assigned_to);
      // a chief service engineer (team > 1) dispatches; a field engineer only works their own tickets
      const isChief = role === 'service_team' && engineers.length > 1;
      // signs off this ticket's work (de-escalate, close on an unapproved report): managers, and the territory chief
      const supervises = t.can_supervise ?? isManager;
      // detail rows carry every report, list rows only the newest one
      const reports: any[] = t.reports || (t.latest_report ? [t.latest_report] : []);
      const out: TicketAction[] = [];
      for (const target of allowed) {
        if (target === 'report_submitted') continue; // set by filing a report
        if (target === 'closed') {
          // an engineer closes only once the report is approved (a supervisor's close approves it, never his own report)
          const ownReport = role === 'service_team' && reports[0]?.submitted_by === userId;
          if ((!supervises || ownReport) && reports[0]?.report_status !== 'Approved') continue;
          out.push({ kind: 'close', label: 'Sign off & close', tone: 'primary' });
          continue;
        }
        if (target === 'resolved' && serviceResolveBlocker({ reports, reopened_at: t.reopened_at })) continue; // the report resolves it
        if (target === 'reopened' && !['management', 'admin'].includes(role)) continue;
        if (status === 'escalated' && !supervises) continue; // managers and the territory chief de-escalate
        // a field engineer can only self-assign an unassigned ticket; a chief service engineer (team > 1) can reassign
        if (target === 'assigned' && role === 'service_team' && t.assigned_to && (engineers.length <= 1 || !mayTakeFrom)) continue;
        if (target === 'received' && !mayTakeFrom) continue;
        // cancelling is final: own ticket, or as chief the intake queue and the team's tickets (the API's rule)
        if (target === 'cancelled' && role === 'service_team' && t.assigned_to !== userId && (!isChief || !mayTakeFrom)) continue;
        let label = ACTION_LABEL[target] || statusLabel(target);
        if (status === 'escalated' && target !== 'cancelled') label = `De-escalate: ${statusLabel(target)}`;
        else if (target === 'assigned' && t.assigned_to) label = 'Back to assigned';
        out.push({
          kind: 'status',
          target,
          label,
          tone: EXCEPTION_TARGETS.includes(target) ? 'exception' : ['assigned', 'visit_scheduled', 'in_progress', 'resolved'].includes(target) ? 'primary' : 'secondary',
        });
      }
      // the API takes a report only from the assigned (or an additional) engineer, or admin
      if ((role === 'admin' || (role === 'service_team' && isAssignedEngineer(t, userId))) && ['in_progress', 'resolved'].includes(status)) {
        out.push({ kind: 'report', label: 'File service report', tone: 'primary' });
      }
      // §47: hand an open ticket to another engineer without a status change (a field engineer cannot; a chief can)
      if (t.assigned_to && !isFinished(t.status) && mayTakeFrom && (role !== 'service_team' || engineers.length > 1)) {
        out.push({ kind: 'reassign', label: 'Reassign engineer', tone: 'secondary' });
      }
      return out.sort((a, b) => actionRank(a) - actionRank(b));
    },
    [role, userId, engineers],
  );

  const runAction = async (t: any, a: TicketAction) => {
    setCardError(null);
    try {
      // the list row has no reports / extra engineers; the modals need the full record
      const full = t.reports ? t : await fetchDetail(t.id);
      setActionCtx({ kind: a.kind, ticket: full, target: a.kind === 'status' ? a.target : undefined });
    } catch (err) {
      setCardError(errMsg(err, 'Could not load the ticket.'));
    }
  };

  const openLink = async (t: any) => {
    try {
      const full = t.intake !== undefined ? t : await fetchDetail(t.id);
      setActionCtx({ kind: 'link', ticket: full });
    } catch (err) {
      setCardError(errMsg(err, 'Could not load the ticket.'));
    }
  };

  // Open Ticket Detail. Two quick clicks: only the last ticket asked for may open (an older reply is dropped).
  const handleOpenDetail = async (ticket: any) => {
    setCardError(null);
    setDetailTab('overview');
    selectedIdRef.current = ticket.id;
    try {
      const full = await fetchDetail(ticket.id);
      if (selectedIdRef.current !== ticket.id) return;
      setSelectedTicket(full);
      setIsDetailModalOpen(true);
    } catch (err) {
      if (selectedIdRef.current !== ticket.id) return;
      selectedIdRef.current = null;
      setCardError(errMsg(err, 'Could not open this ticket.'));
    }
  };
  // Deep link from demos, tasks and notifications: /service?open=<ticket id>
  useOpenParam((id) => handleOpenDetail({ id }));
  // Deep link from the Management Command dashboard: /service?stage=<stage>&flag=<flag> sets the opening filters.
  // Read after mount, not during render: on a client-side navigation the address bar changes only once this page
  // has rendered. Unknown values are ignored; the consumed keys leave the address bar.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const stage = q.get('stage');
    const flag = q.get('flag');
    if (stage && STAGES.some((s) => s.id === stage)) setActiveTab(stage);
    if (flag && (FLAG_KEYS as readonly string[]).includes(flag)) setActiveFlag(flag as FlagKey);
    dropUrlParams(['stage', 'flag']);
    setUrlFiltersRead(true);
  }, []);
  const closeDetail = () => {
    setIsDetailModalOpen(false);
    selectedIdRef.current = null;
  };

  const canLinkRole = LINK_ROLES.includes(role);
  const workload: any[] = stats?.employeeWorkload || [];
  // Closure time per priority comes in hours (a same-day closure must not round to 0 days); shown as h or d.
  const fmtDuration = (h: number) => (h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
  const closureRows = (['critical', 'high', 'medium', 'low'] as const)
    .map((p) => ({ p, row: (stats?.avgClosureByPriority || []).find((r: any) => r.priority === p) }))
    .filter((x): x is { p: 'critical' | 'high' | 'medium' | 'low'; row: any } => Boolean(x.row));
  const closedTotal = closureRows.reduce((n, x) => n + Number(x.row.closed), 0);
  const closureOverall = closedTotal ? fmtDuration(closureRows.reduce((n, x) => n + Number(x.row.avgHours) * Number(x.row.closed), 0) / closedTotal) : '—';

  /** `phoneCls`: phone-only sizing (full-width, 40px targets); the desktop look is restored behind `sm:`. */
  const renderAction = (t: any, a: TicketAction, size: 'xs' | 'sm' = 'sm', phoneCls?: string) => (
    <Button
      key={actionKey(a)}
      size={size}
      variant={a.tone === 'primary' ? 'primary' : a.tone === 'exception' ? 'outline' : 'secondary'}
      className={twMerge(a.tone === 'exception' && 'border-[#9A3412]/40 text-[#7C2D12] hover:bg-[#FBEBDD]', phoneCls)}
      onClick={() => runAction(t, a)}
    >
      {ACTION_ICON[actionKey(a)]}
      <span>{a.label}</span>
    </Button>
  );

  const activeRing = (on: boolean) => `cursor-pointer transition-shadow hover:shadow-md ${on ? 'ring-2 ring-[#0F5E63]' : ''}`;

  /* --------------------------- record views mapping --------------------------- */
  const lanes = STAGES.filter((s) => s.id !== 'all' && !s.tile).map((s) => ({ key: s.id, label: s.label, tone: toneFor(s.label) }));
  const stageOf = (status: string) => lanes.find((l) => matchesTab(l.key, status))?.key ?? 'open';
  const laneByKey = new Map<string, string>(displayedTickets.map((t) => [String(t.id), stageOf(t.status)]));
  const laneOf = (item: RecordItem) => laneByKey.get(item.key) ?? 'open';
  /** Same rule as the dossier: open, clock running, resolution deadline passed. */
  const slaBreached = (t: any) => !isFinished(t.status) && !isSlaPaused(t) && !!t.sla_resolution_due_at && new Date(t.sla_resolution_due_at).getTime() < Date.now();
  // exact server count when the list's filters are the tile's (no other flag, or overdue, which holds every
  // breached ticket); else over the loaded rows
  const breachedCount: number =
    stats && (activeFlag === 'all' || activeFlag === 'sla_breached' || activeFlag === 'overdue') ? stats.slaBreached : displayedTickets.filter(slaBreached).length;
  const fmtDay = (v: unknown) => (v ? formatDateIN(v as string) : '—');

  const recordItems: RecordItem[] = displayedTickets.map((t) => {
    const done = isFinished(t.status);
    const unverified = isUnverified(t);
    const actions = getActions(t);
    const [next, ...more] = actions.filter((a) => a.kind !== 'status' || a.tone !== 'exception');
    const badges: NonNullable<RecordItem['badges']> = [];
    if (t.priority === 'critical') badges.push({ label: 'Critical · LD risk', tone: 'danger' });
    else if (t.priority === 'high') badges.push({ label: 'High', tone: 'warning' });
    if (slaBreached(t)) badges.push({ label: 'SLA breached', tone: 'danger' });
    else if (!done && isSlaPaused(t)) badges.push({ label: 'SLA paused', tone: 'neutral' });
    if (isPortalTicket(t)) badges.push({ label: 'Portal', tone: 'info' });
    if (unverified) badges.push({ label: 'Unverified', tone: 'warning' });
    if (t.is_repeat_complaint) badges.push({ label: 'Repeat', tone: 'warning' });
    if (t.reopened_count > 0) badges.push({ label: `Reopened ×${t.reopened_count}`, tone: 'warning' });

    const quick: NonNullable<RecordItem['quick']> = more.slice(0, 2).map((a) => {
      const Glyph = ACTION_GLYPH[actionKey(a)];
      return { label: a.label, icon: Glyph ? <Glyph /> : undefined, onClick: () => runAction(t, a) };
    });
    if (unverified && canLinkRole) quick.push({ label: 'Link to customer', icon: <Link2 />, onClick: () => openLink(t) });

    const customer = unverified ? t.claimed_organisation_name : t.organisation_name || 'Client Agency / Command Station';
    return {
      key: String(t.id),
      code: t.customer_reference ? `${t.ticket_no} · Ref ${t.customer_reference}` : t.ticket_no,
      title: t.complaint || 'No complaint text',
      subtitle: [customer, t.location || t.city].filter(Boolean).join(' · '),
      status: { label: statusLabel(t.status), tone: toneFor(statusLabel(t.status)) },
      badges,
      due: { date: t.sla_resolution_due_at, label: 'SLA due', done },
      owner: t.assignee_name || 'Unassigned',
      facts: [
        { label: 'Warranty', value: warrantyLabel(t.warranty_status_snapshot || t.warranty_status) },
        { label: 'Machine S/N', value: t.equipment_serial || '—' },
        { label: 'Received', value: fmtDay(t.received_date || t.created_at) },
        { label: 'Source', value: t.complaint_source || 'Phone' },
      ],
      primary: next ? { label: next.label, onClick: () => runAction(t, next) } : undefined,
      quick: quick.slice(0, 3),
      onOpen: () => handleOpenDetail(t),
    };
  });

  // recordItems is displayedTickets mapped 1:1, so row i and recordItems[i] are the same ticket.
  // A row opens the ticket (click or Enter); priority sits under the number and the equipment under the customer,
  // so the table fits a laptop-width card without scrolling sideways.
  const ticketList = displayedTickets.length ? (
    <RecordTable items={recordItems}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticket</TableHead>
            <TableHead>Customer & equipment</TableHead>
            <TableHead>Complaint</TableHead>
            <TableHead>Engineer</TableHead>
            <TableHead>SLA due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Next step</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayedTickets.map((t, i) => {
            const primary = recordItems[i]?.primary;
            const open = !isFinished(t.status);
            const breached = slaBreached(t);
            const paused = open && isSlaPaused(t);
            const daysLeft = open && !breached && !paused ? daysFromToday(t.sla_resolution_due_at) : null;
            const unverified = isUnverified(t);
            const customer = unverified ? t.claimed_organisation_name : t.organisation_name || 'Client Agency / Command Station';
            const site = [unverified && 'Unverified customer', t.product_name, t.location || t.city, t.equipment_serial && `S/N ${t.equipment_serial}`].filter(Boolean).join(' · ');
            return (
              <TableRow
                key={t.id}
                tabIndex={0}
                aria-label={`Open ticket ${t.ticket_no || ''}`}
                onClick={() => handleOpenDetail(t)}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenDetail(t)}
                className="cursor-pointer hover:bg-[#FBFAF7] focus:outline-none focus-visible:bg-[#E3EFEE]/60"
              >
                <TableCell className="whitespace-nowrap">
                  <span className="font-mono font-bold text-[#0F5E63]">{t.ticket_no || '-'}</span>
                  {t.customer_reference && <div className="font-mono text-[11px] text-[#4A5568]">Ref {t.customer_reference}</div>}
                  {t.priority && (
                    <div className="mt-1">
                      <Badge variant={priorityBadge(t.priority)} size="sm" className="uppercase font-bold">
                        {upperLabel(t.priority)}
                      </Badge>
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[210px] whitespace-normal">
                  <div className="font-bold text-[#14213D] break-words">{customer}</div>
                  {site && <div className="text-[10px] text-[#4A5568] break-words">{site}</div>}
                </TableCell>
                <TableCell className="text-[#4A5568] max-w-[170px] truncate" title={t.complaint || undefined}>
                  {t.complaint || 'No complaint text'}
                </TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{t.assignee_name || 'Unassigned'}</TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(t.sla_resolution_due_at)}
                  {breached ? (
                    <div className="text-[10px] font-bold text-[#881337]">SLA BREACHED</div>
                  ) : paused ? (
                    <div className="text-[10px] font-bold text-[#4A5568]">SLA PAUSED</div>
                  ) : (
                    daysLeft !== null &&
                    daysLeft >= 0 &&
                    daysLeft <= 7 && <div className="text-[10px] font-bold text-[#881337]">{daysLeft === 0 ? 'DUE TODAY' : `${daysLeft} DAYS LEFT`}</div>
                  )}
                </TableCell>
                <TableCell className="max-w-[150px] whitespace-normal">
                  <Badge variant={ticketStatusBadge(t.status)} size="sm" className="whitespace-normal text-left font-semibold">
                    {statusLabel(t.status)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[160px] text-right" onClick={(e) => e.stopPropagation()}>
                  {primary ? (
                    <Button size="xs" variant="primary" className="h-auto min-h-7 whitespace-normal py-1 text-left text-xs leading-tight shadow-xs" disabled={primary.disabled} onClick={primary.onClick}>
                      {primary.label}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-[#6B7280]">—</span>
                  )}
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
      {/* Page Header */}
      <PageHeader
        title="Service Desk & Installed Base Maintenance"
        icon={<Wrench className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          // phones: short labels so both actions fit on one row, at the same 40px height
          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={() => setIsWorkloadModalOpen(true)} variant="outline" size="sm" className="h-10 border-[#DCD8CE] text-[#14213D] shadow-xs sm:h-8">
              <Users className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
              <span className="sm:hidden">Workload ({workload.length || serviceEngineers.length})</span>
              <span className="hidden sm:inline">Engineer Workload ({workload.length || serviceEngineers.length})</span>
            </Button>
            {role !== 'accounts' && (
              <Button onClick={() => setIsLogTicketOpen(true)} variant="primary" className="shadow-xs">
                <Plus className="h-4 w-4 mr-1.5" />
                <span className="sm:hidden">Log incident</span>
                <span className="hidden sm:inline">Log Breakdown Incident</span>
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Metrics HUD (§34) — five tiles, each filters the queue (click again to clear). Assigned, repeat complaints,
          closure time and engineer workload are the cards below. */}
      <StatGrid cols={5} className="gap-3">
        <StatCard
          label="New Tickets"
          value={stats?.newTickets ?? tabCount('open')}
          subtext={`Fresh intake · ${stats?.portalNew ?? 0} from portal`}
          icon={<Clock className="h-5 w-5 text-[#0F5E63]" />}
          role="button"
          tabIndex={0}
          onClick={() => toggleStage('open')}
          onKeyDown={(e) => e.key === 'Enter' && toggleStage('open')}
          className={activeRing(activeTab === 'open')}
        />
        <StatCard
          label="Pending Queue"
          value={stats?.pendingTickets ?? tickets.filter((t) => !isFinished(t.status)).length}
          subtext={`${stats?.assignedTickets ?? tickets.filter((t) => t.assigned_to && !isFinished(t.status)).length} assigned to engineers`}
          icon={<Wrench className="h-5 w-5 text-[#0F5E63]" />}
          role="button"
          tabIndex={0}
          onClick={() => toggleStage('pending')}
          onKeyDown={(e) => e.key === 'Enter' && toggleStage('pending')}
          className={activeRing(activeTab === 'pending')}
        />
        <StatCard
          label="Overdue Tickets"
          value={stats?.overdueTickets ?? 0}
          subtext={`${stats?.slaBreached ?? 0} past SLA · ${Math.max(0, (stats?.overdueTickets ?? 0) - (stats?.slaBreached ?? 0))} missed visit date`}
          icon={<AlertTriangle className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
          role="button"
          tabIndex={0}
          onClick={() => pickFlag('overdue')}
          onKeyDown={(e) => e.key === 'Enter' && pickFlag('overdue')}
          className={activeRing(activeFlag === 'overdue')}
        />
        <StatCard
          label="Awaiting Parts"
          value={stats?.awaitingParts ?? tickets.filter((t) => normalizeServiceStatus(t.status) === 'awaiting_part').length}
          subtext="Depot spares logistics pending"
          icon={<Package className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
          role="button"
          tabIndex={0}
          onClick={() => toggleStage('awaiting_part')}
          onKeyDown={(e) => e.key === 'Enter' && toggleStage('awaiting_part')}
          className={activeRing(activeTab === 'awaiting_part')}
        />
        <StatCard
          label="Completed & Signed"
          value={stats?.completedTickets ?? 0}
          subtext={`Avg closure ${closureOverall} from intake`}
          icon={<CheckCircle2 className="h-5 w-5 text-[#0F5E63]" />}
          variant="emerald"
          role="button"
          tabIndex={0}
          onClick={() => toggleStage('completed')}
          onKeyDown={(e) => e.key === 'Enter' && toggleStage('completed')}
          // phones (2-column grid): the fifth tile spans the row instead of sitting alone at half width
          className={`col-span-2 sm:col-span-1 ${activeRing(activeTab === 'completed')}`}
        />
      </StatGrid>

      {/* §34 at a glance: who holds the open work, how long closing takes, and the repeat complaints. */}
      {stats && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card padding="md" className="space-y-2">
            <SectionHeader title="Open queue" description={`${stats.pendingTickets ?? 0} open tickets. Pick a bar to filter the list.`} />
            <BarList
              label="Open queue"
              labelWidth="50%"
              emptyText="No open tickets."
              items={[
                { key: 'assigned', label: 'Assigned to an engineer', value: stats.assignedTickets ?? 0, active: activeFlag === 'assigned', onSelect: () => pickFlag('assigned') },
                { key: 'unassigned', label: 'Not yet assigned', value: stats.unassignedTickets ?? 0, active: activeFlag === 'unassigned', onSelect: () => pickFlag('unassigned') },
                { key: 'repeat', label: 'Repeat complaints', value: stats.repeatComplaints ?? 0, detail: 'Same machine reported again', active: activeFlag === 'repeat', onSelect: () => pickFlag('repeat') },
              ]}
            />
          </Card>
          <Card padding="md" className="space-y-2">
            <SectionHeader title="Average closure time" description={`${closureOverall} overall · complaint received to closed, by priority`} />
            <BarList
              label="Average closure time by priority"
              emptyText="No ticket has been closed yet."
              items={closureRows.map(({ p, row }): BarListItem => ({
                key: p,
                label: p.charAt(0).toUpperCase() + p.slice(1),
                value: Number(row.avgHours),
                display: fmtDuration(Number(row.avgHours)),
                detail: `${row.closed} closed`,
              }))}
            />
          </Card>
          <Card padding="md" className="space-y-2">
            <SectionHeader
              title="Engineer workload"
              description="Open tickets per engineer, busiest first."
              actions={
                workload.length > 0 && (
                  <Button size="xs" variant="ghost" onClick={() => setIsWorkloadModalOpen(true)}>
                    All engineers
                  </Button>
                )
              }
            />
            <BarList
              label="Open tickets per engineer"
              emptyText="No engineer has an open ticket."
              items={workload.slice(0, 6).map((ew: any) => ({
                key: ew.id,
                label: ew.name,
                value: ew.activeTickets,
                display: `${ew.activeTickets} open`,
                detail: `${ew.overdueTickets} overdue · ${ew.completedTickets} completed`,
              }))}
            />
          </Card>
        </div>
      )}

      {/* One filter row: search, then compact dropdowns. */}
      <Card ref={filterRowRef} padding="sm" className="relative z-20 scroll-mt-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search service tickets"
              placeholder="Search ticket ref, customer, complaint, serial…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          {/* phones: the menus wrap onto two lines, so each menu's list opens under the whole row
              (left- or right-aligned to it) instead of hanging off the screen edge */}
          <div className="relative flex flex-wrap items-center gap-2 sm:static lg:flex-nowrap">
            <FilterMenu
              label="Stage"
              icon={<Layers />}
              className="static sm:relative"
              options={STAGES.map((s) => ({
                key: s.id,
                label: s.label,
                count: tabCount(s.id),
                active: activeTab === s.id,
                onSelect: () => setActiveTab(s.id),
              }))}
            />
            <FilterMenu
              label="Priority"
              icon={<Flame />}
              className="static sm:relative"
              options={PRIORITIES.map((p) => ({
                ...p,
                urgent: p.key === 'critical',
                active: priorityFilter === p.key,
                onSelect: () => setPriorityFilter(p.key),
              }))}
            />
            <FilterMenu
              label="Source"
              icon={<Phone />}
              className="static sm:relative [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
              options={SOURCES.map((s) => ({
                ...s,
                active: sourceFilter === s.key,
                onSelect: () => setSourceFilter(s.key),
              }))}
            />
            <FilterMenu
              label="Flags"
              icon={<ShieldAlert />}
              align="right"
              className="static sm:relative"
              options={[
                { key: 'all', label: 'No flag filter', icon: undefined, count: undefined },
                { key: 'portal', label: 'Portal requests to triage', icon: <Globe2 />, count: stats?.portalNew ?? undefined },
                { key: 'assigned', label: 'Assigned to an engineer', icon: <User />, count: stats?.assignedTickets ?? undefined },
                { key: 'unassigned', label: 'Not yet assigned', icon: <User />, count: stats?.unassignedTickets ?? undefined },
                { key: 'no_machine', label: 'Machine not identified', icon: <Package />, count: stats?.noMachineTickets ?? undefined },
                { key: 'sla_breached', label: 'SLA breached', icon: <AlertTriangle />, count: stats?.slaBreached ?? undefined },
                { key: 'overdue', label: 'Overdue (past SLA or missed visit)', icon: <Calendar />, count: stats?.overdueTickets ?? undefined },
                { key: 'repeat', label: 'Repeat complaints', icon: <Repeat />, count: stats?.repeatComplaints ?? undefined },
                { key: 'unverified', label: 'Unverified customer', icon: <ShieldQuestion />, count: stats?.unverifiedCustomers ?? undefined },
              ].map((f) => ({
                ...f,
                urgent: f.key === 'sla_breached' || f.key === 'overdue',
                active: activeFlag === f.key,
                onSelect: () => setActiveFlag(f.key as FlagKey),
              }))}
            />
            {anyFilter && (
              <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {(loadError || cardError) && (
        <div role="alert" className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
          {loadError || cardError}
        </div>
      )}

      {/* Service ticket register: priority cards or a stage board */}
      {isLoading ? (
        <PageLoader label="Loading service queue" />
      ) : displayedTickets.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No service tickets in this pipeline view"
          description={anyFilter ? 'No tickets match the current filters.' : 'All client equipment and defense units in this filter are currently operating normally.'}
        />
      ) : (
        <RecordViews
          items={recordItems}
          lanes={lanes}
          laneOf={laneOf}
          storageKey="service"
          defaultView="list"
          list={ticketList}
          hideEmptyLanes={activeTab !== 'all'}
          empty="No tickets match the current filters."
          summary={
            <>
              {ticketTotal > tickets.length ? `Showing ${tickets.length} of ${ticketTotal} tickets` : `${ticketTotal} ticket${ticketTotal === 1 ? '' : 's'}`}
              {breachedCount > 0 && <span className="font-semibold text-[#881337]"> · {breachedCount} SLA breached</span>}
            </>
          }
        />
      )}

      {/* 1. Log Breakdown Ticket Modal */}
      <CreateServiceTicketModal
        isOpen={isLogTicketOpen}
        onClose={() => setIsLogTicketOpen(false)}
        onCreated={() => {
          fetchData();
        }}
      />


      {/* Workflow action modals (status moves / report / close / link) */}
      {actionCtx?.kind === 'status' && (
        <StatusActionModal
          ticket={actionCtx.ticket}
          target={actionCtx.target || null}
          role={role}
          userId={userId}
          engineers={engineers}
          onClose={() => setActionCtx(null)}
          onDone={refreshAll}
          onStale={refreshActionTicket}
        />
      )}
      {actionCtx?.kind === 'close' && (
        <CloseTicketModal ticket={actionCtx.ticket} role={role} onClose={() => setActionCtx(null)} onDone={refreshAll} onStale={refreshActionTicket} />
      )}
      {actionCtx?.kind === 'report' && (
        <ReportFormModal ticket={actionCtx.ticket} onClose={() => setActionCtx(null)} onDone={refreshAll} onStale={refreshActionTicket} />
      )}
      {actionCtx?.kind === 'reassign' && (
        <ReassignEngineerModal ticket={actionCtx.ticket} engineers={engineers} onClose={() => setActionCtx(null)} onDone={refreshAll} onStale={refreshActionTicket} />
      )}
      {actionCtx?.kind === 'details' && (
        <TicketDetailsModal ticket={actionCtx.ticket} onClose={() => setActionCtx(null)} onDone={refreshAll} onStale={refreshActionTicket} />
      )}
      {actionCtx?.kind === 'link' && (
        <LinkOrganisationModal ticket={actionCtx.ticket} onClose={() => setActionCtx(null)} onDone={refreshAll} onStale={refreshActionTicket} />
      )}

      {/* Ticket Dossier (§32, §33, §34) */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={closeDetail}
        title="Service Ticket Dossier & Operations Center"
        description="Technical record, field visits, spares, SLA and audit timeline."
        maxWidth="xl"
      >
        {selectedTicket && (() => {
          const st = selectedTicket;
          const unverified = isUnverified(st);
          const actions = getActions(st);
          const progress = actions.filter((a) => a.kind !== 'status' || a.tone !== 'exception');
          const exceptions = actions.filter((a) => a.kind === 'status' && a.tone === 'exception');
          const readOnly = !STATUS_ROLES.includes(role);
          const tabs: { id: typeof detailTab; label: string }[] = [
            { id: 'overview', label: 'Overview & Workflow' },
            { id: 'visits', label: `Visits & GPS (${st.visits?.length || 0})` },
            { id: 'reports', label: `Service Reports (${st.reports?.length || 0})` },
            { id: 'parts', label: `Spare Parts (${st.part_requests?.length || 0})` },
            { id: 'comments', label: `Notes (${st.comments?.length || 0})` },
            { id: 'history', label: `Audit Timeline (${(st.status_history?.length || 0) + (st.assignment_history?.length || 0)})` },
            { id: 'linked', label: 'Linked Records' },
          ];
          return (
            <div className="space-y-4">
              {unverified && <UnverifiedBanner ticket={st} canLink={canLinkRole} onLink={() => setActionCtx({ kind: 'link', ticket: st })} />}

              {/* Top Identity Strip */}
              <div className="p-3 sm:p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-base font-bold text-[#0F5E63]">{st.ticket_no || st.ticket_number}</span>
                    {st.customer_reference && <span className="break-all font-mono text-xs text-[#4A5568]">Customer ref {st.customer_reference}</span>}
                    <Badge variant={statusBadgeVariant(st.status)}>{statusLabel(st.status).toUpperCase()}</Badge>
                    {isPortalTicket(st) && (
                      <Badge variant="info" size="sm" className="font-bold">
                        <Globe2 className="h-3 w-3 mr-1" /> PORTAL
                      </Badge>
                    )}
                    {st.is_repeat_complaint && (
                      <Badge variant="urgent" size="sm" className="flex items-center gap-1 font-bold">
                        <Repeat className="h-3 w-3" />
                        <span>REPEAT COMPLAINT ({st.repeat_count || 1} prior)</span>
                      </Badge>
                    )}
                    {st.reopened_count > 0 && (
                      <Badge variant="warning" size="sm" className="font-bold">
                        <RotateCcw className="h-3 w-3 mr-1" /> REOPENED ×{st.reopened_count}
                      </Badge>
                    )}
                    {st.sla_breached && (
                      <Badge variant="urgent" size="sm">
                        SLA BREACHED
                      </Badge>
                    )}
                    {!isFinished(st.status) && st.sla_pause_started_at && <SlaPausedPill />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                      {st.priority?.toUpperCase()} PRIORITY
                    </Badge>
                    <Badge variant="outline" size="sm" className="text-[10px]">
                      {warrantyLabel(st.warranty_status_snapshot || st.warranty_status)}
                    </Badge>
                    {st.is_chargeable && (
                      <Badge variant="urgent" size="sm">
                        CHARGEABLE (BILLABLE)
                      </Badge>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-serif text-base font-bold text-[#14213D]">
                    {unverified ? (
                      `${st.claimed_organisation_name} (unverified)`
                    ) : canOpen(role, '/leads') ? (
                      <Link href={`/leads?customer=${st.organisation_id}`} className="hover:underline hover:text-[#0F5E63]" title="Open Customer 360">
                        {st.organisation_name}
                      </Link>
                    ) : (
                      st.organisation_name
                    )}
                  </h4>
                  <p className="text-xs text-[#14213D] font-medium mt-1 break-words">{st.complaint || st.complaint_description}</p>
                </div>

                {(() => {
                  // §31: what an open ticket still lacks — the machine, who to meet and where; engineer and visit
                  // date have their own actions (Assign, Schedule visit) once the ticket is dispatched
                  if (isFinished(st.status) || unverified) return null;
                  const missing = [
                    !st.product_id && !st.equipment_id && 'equipment',
                    !String(st.equipment_serial || st.serial_number || '').trim() && 'serial number',
                    !st.contact_id && 'contact person',
                    !String(st.location || '').trim() && 'location',
                  ].filter(Boolean) as string[];
                  if (!missing.length) return null;
                  const noMachine = !st.product_id && !st.equipment_id && !String(st.equipment_serial || st.serial_number || '').trim();
                  return (
                    <InfoCallout variant={noMachine ? 'warning' : 'neutral'} title={`Details missing: ${missing.join(', ')}`}>
                      <p className="text-xs">
                        {noMachine
                          ? 'The engineer needs to know which machine to service, and the service history is kept against it. A service report cannot be filed until the machine is known (the engineer can also enter its serial number in the report).'
                          : 'Add them so the engineer knows who to meet and where.'}
                      </p>
                      {canEditDetails(st) && (
                        <Button size="xs" variant="secondary" className="mt-2" onClick={() => setActionCtx({ kind: 'details', ticket: st })}>
                          Complete details
                        </Button>
                      )}
                    </InfoCallout>
                  );
                })()}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs pt-2 border-t border-[#ECE9E2]">
                  <div className="min-w-0">
                    <span className="text-[#4A5568] block text-[10px]">Equipment</span>
                    <span className="font-semibold text-[#14213D] break-words">{st.product_name || 'Not linked to a product'}</span>
                  </div>
                  <div>
                    <span className="text-[#4A5568] block text-[10px]">Machine S/N</span>
                    <span className="font-mono font-bold text-[#14213D]">{st.equipment_serial || st.serial_number || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[#4A5568] block text-[10px]">Assigned Engineer</span>
                    <span className="font-semibold text-[#14213D]">{st.assignee_name || 'Unassigned'}</span>
                  </div>
                  <div>
                    <span className="text-[#4A5568] block text-[10px]">Planned Visit</span>
                    <span className="font-semibold text-[#14213D]">{st.planned_visit_date ? formatDateIN(st.planned_visit_date) : 'Not Scheduled'}</span>
                  </div>
                  <div>
                    <span className="text-[#4A5568] block text-[10px]">Status reason</span>
                    <span className="font-semibold text-[#14213D] break-words">{st.status_reason || '—'}</span>
                  </div>
                </div>
                {!isFinished(st.status) && !unverified && canEditDetails(st) && (
                  <div className="flex justify-end">
                    <Button size="xs" variant="ghost" onClick={() => setActionCtx({ kind: 'details', ticket: st })}>
                      Edit details
                    </Button>
                  </div>
                )}
              </div>

              <SlaPanel ticket={st} />

              {/* Dossier Tabs */}
              <ScrollStrip role="tablist" aria-label="Ticket sections" activeKey={detailTab} wrapperClassName="border-b border-[#DCD8CE]" className="gap-1 text-xs font-semibold">
                {tabs.map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === tb.id}
                    onClick={() => setDetailTab(tb.id)}
                    className={`shrink-0 py-2.5 sm:py-2 px-3 border-b-2 transition-all whitespace-nowrap ${
                      detailTab === tb.id ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg' : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                    }`}
                  >
                    {tb.label}
                  </button>
                ))}
              </ScrollStrip>

              {/* Tab 1: Overview & legal next steps */}
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
                    <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Workflow — next steps</h5>
                    <p className="text-xs text-[#4A5568]">
                      Only moves the state machine allows from <strong>{statusLabel(st.status)}</strong> are offered. Some steps ask for a reason or details first.
                    </p>
                    {readOnly ? (
                      <InfoCallout variant="neutral">Your role has read-only access to service tickets.</InfoCallout>
                    ) : actions.length === 0 ? (
                      <InfoCallout variant="neutral">
                        {normalizeServiceStatus(st.status) === 'cancelled'
                          ? 'This ticket is cancelled and cannot be changed.'
                          : normalizeServiceStatus(st.status) === 'escalated'
                          ? 'Escalated tickets can only be handled by a regional manager, management or admin.'
                          : normalizeServiceStatus(st.status) === 'closed'
                          ? 'This ticket is closed. Only management or admin can reopen it (within the reopen window).'
                          : 'No further steps are available to you for this ticket.'}
                      </InfoCallout>
                    ) : (
                      <div className="space-y-2 pt-1">
                        {/* phones: next steps stack full width; exceptions sit two per row (labels may wrap) */}
                        {progress.length > 0 && (
                          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                            {progress.map((a) => renderAction(st, a, 'sm', 'h-10 w-full sm:h-8 sm:w-auto'))}
                          </div>
                        )}
                        {exceptions.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4A5568]">Exceptions (reason required)</span>
                            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                              {exceptions.map((a) =>
                                renderAction(st, a, 'sm', 'h-auto min-h-10 w-full py-1.5 text-center sm:h-8 sm:min-h-0 sm:w-auto sm:py-0'),
                              )}
                            </div>
                          </div>
                        )}
                        {normalizeServiceStatus(st.status) === 'resolved' && (
                          <p className="text-[11px] text-[#4A5568]">“Service report submitted” is set by filing the report, and “Closed” by signing off from that state.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#14213D] block">Intake origin & channel</span>
                        <Badge variant={isPortalTicket(st) ? 'info' : 'outline'} size="sm">
                          {st.complaint_source || 'Phone'}
                        </Badge>
                      </div>
                      <div className="text-[#4A5568] space-y-1">
                        <p><strong>Category:</strong> {st.problem_category || 'Breakdown'}</p>
                        <p><strong>Location:</strong> {st.location || st.city || 'Standard Facility'}</p>
                        <p><strong>Received:</strong> {st.received_date ? formatDateIN(st.received_date) : '—'}</p>
                        <p><strong>Customer:</strong> {unverified ? `${st.claimed_organisation_name} (unverified)` : st.organisation_name}</p>
                        {st.contact_name && <p><strong>Contact:</strong> {st.contact_name}{st.contact_mobile ? ` · ${st.contact_mobile}` : ''}</p>}
                        {st.complaint_source === 'Demo Team' && (
                          <p className="text-[11px] font-semibold text-[#14213D] bg-[#EEF1F5] p-1.5 rounded mt-1 border border-[#DCD8CE]">Flagged by Demo Team during a field trial or live demonstration</p>
                        )}
                        {st.complaint_source === 'Official Letter' && (
                          <p className="text-[11px] font-semibold text-[#7C2D12] bg-[#FBEBDD] p-1.5 rounded mt-1 border border-[#9A3412]/20">Official government written notice on record</p>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
                      <span className="font-bold text-[#14213D] block">Billing & coverage</span>
                      <div className="text-[#4A5568] space-y-1">
                        <p><strong>Coverage:</strong> {warrantyLabel(st.warranty_status_snapshot || st.warranty_status)}</p>
                        <p><strong>Is chargeable:</strong> {st.is_chargeable ? 'Yes (billable spares / labour)' : 'No (covered FOC)'}</p>
                        <p><strong>Billing status:</strong> {st.billing_status || 'Not chargeable'}</p>
                        <p><strong>Resolved:</strong> {st.resolved_at ? formatDateTimeIN(st.resolved_at) : '—'}</p>
                        <p><strong>Closed:</strong> {st.closed_at ? formatDateTimeIN(st.closed_at) : '—'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {detailTab === 'visits' && <VisitsTab ticket={st} role={role} userId={userId} onChanged={refreshAll} />}
              {detailTab === 'reports' && (
                <ReportsTab ticket={st} role={role} userId={userId} onNewReport={() => setActionCtx({ kind: 'report', ticket: st })} onChanged={refreshAll} />
              )}
              {detailTab === 'parts' && <PartsTab ticket={st} role={role} onChanged={refreshAll} />}
              {detailTab === 'comments' && <NotesTab ticket={st} role={role} onChanged={refreshAll} />}
              {detailTab === 'history' && <AuditTab ticket={st} engineerNames={engineerNames} />}
              {detailTab === 'linked' && (
                <RelatedRecords
                  // Unverified tickets sit on a shared placeholder customer, so skip the customer-wide sections for them.
                  to={{ kind: 'ticket', id: st.id, organisationId: unverified ? null : st.organisation_id, serial: st.equipment_serial || st.serial_number || null }}
                  sections={['demos', 'equipment', 'service', 'tasks', 'deliveries']}
                  description="The demo this ticket came from, earlier tickets on the same machine and customer, its tasks, and the customer's deliveries."
                />
              )}

              <div className="pt-2 flex justify-end">
                <Button size="sm" variant="secondary" onClick={closeDetail} className="h-10 w-full sm:h-8 sm:w-auto">
                  Close Dossier
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Employee Workload Modal (§34) */}
      <Modal
        isOpen={isWorkloadModalOpen}
        onClose={() => setIsWorkloadModalOpen(false)}
        title="Service Team Workload & Allocation HUD"
        description="Engineer queue depth, active assignments, overdue risks and completed tickets."
        maxWidth="lg"
      >
        <div className="space-y-4">
          {/* Phones: one card per engineer (the five-column table would only scroll sideways) */}
          <div className="sm:hidden">
            {workload.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#DCD8CE] p-4 text-center text-xs text-[#4A5568]">No engineer workload data available.</div>
            ) : (
              <ul className="space-y-2">
                {workload.map((ew: any) => (
                  <li key={ew.id} className="space-y-2.5 rounded-xl border border-[#DCD8CE] bg-white p-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block text-[#14213D]">{ew.name}</strong>
                        <span className="block truncate text-[10px] text-[#4A5568]">{ew.email}</span>
                      </div>
                      <Badge variant={WORKLOAD_BADGE[ew.workloadStatus] || 'default'} size="sm" className="shrink-0">
                        {ew.workloadStatus || '—'}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-3 gap-2 border-t border-[#ECE9E2] pt-2.5">
                      <div>
                        <dt className="text-[10px] text-[#4A5568]">Active</dt>
                        <dd className="font-mono font-bold text-[#0F5E63]">{ew.activeTickets}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-[#4A5568]">Overdue</dt>
                        <dd className="font-mono font-bold text-[#9A3412]">{ew.overdueTickets}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-[#4A5568]">Completed</dt>
                        <dd className="font-mono text-[#14213D]">{ew.completedTickets}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="hidden overflow-x-auto rounded-[14px] border border-[#DCD8CE] sm:block">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#FBFAF7] text-[#14213D] border-b border-[#ECE9E2] font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Field Engineer</th>
                  <th className="py-2.5 px-3">Active</th>
                  <th className="py-2.5 px-3">Overdue</th>
                  <th className="py-2.5 px-3">Completed</th>
                  <th className="py-2.5 px-3">Workload Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE9E2] bg-white">
                {workload.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-3 text-center text-[#4A5568]">
                      No engineer workload data available.
                    </td>
                  </tr>
                ) : (
                  workload.map((ew: any) => (
                    <tr key={ew.id} className="hover:bg-[#FBFAF7]">
                      <td className="py-2 px-3">
                        <strong className="text-[#14213D] block">{ew.name}</strong>
                        <span className="text-[#4A5568] text-[10px]">{ew.email}</span>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-[#0F5E63]">{ew.activeTickets}</td>
                      <td className="py-2 px-3 font-mono font-bold text-[#9A3412]">{ew.overdueTickets}</td>
                      <td className="py-2 px-3 font-mono text-[#14213D]">{ew.completedTickets}</td>
                      <td className="py-2 px-3">
                        <Badge variant={WORKLOAD_BADGE[ew.workloadStatus] || 'default'} size="sm">
                          {ew.workloadStatus || '—'}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pt-2 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setIsWorkloadModalOpen(false)} className="h-10 w-full sm:h-8 sm:w-auto">
              Close Workload HUD
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
