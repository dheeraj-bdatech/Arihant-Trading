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
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
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
  ScrollStrip, formatDateTimeIN } from '@/components/ui';
import { allowedNextServiceStatuses, normalizeServiceStatus, type ServiceStatus } from '@arihant/shared';
import {
  errMsg,
  statusLabel,
  statusBadgeVariant,
  isFinished,
  isPortalTicket,
  isUnverified,
  isSlaPaused,
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
  received: 'Back to received',
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

type ActionCtx = { kind: 'status' | 'close' | 'report' | 'link' | 'reassign'; ticket: any; target?: ServiceStatus };

export default function ServicePage() {
  const { user } = useAuth();
  const role = (user?.role as string) || '';
  const userId = user?.id || '';

  // Data states
  const [tickets, setTickets] = useState<any[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

  // Filters (all applied server-side except the pipeline tabs)
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [unassignedFilter, setUnassignedFilter] = useState(false);
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [repeatFilter, setRepeatFilter] = useState(false);
  const [unverifiedFilter, setUnverifiedFilter] = useState(false);

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

  // Fetch tickets & stats — both with the same filters, so the KPI tiles count exactly what the list shows.
  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const filters = {
        priority: priorityFilter !== 'all' ? priorityFilter : undefined,
        complaint_source: sourceFilter !== 'all' ? sourceFilter : undefined,
        unassigned: unassignedFilter ? 'true' : undefined,
        overdue: overdueFilter ? 'true' : undefined,
        repeat: repeatFilter ? 'true' : undefined,
        unverified: unverifiedFilter ? 'true' : undefined,
        search: debouncedSearch || undefined,
      };
      const [ticketsRes, statsRes] = await Promise.all([
        api.get('/service/tickets', { ...filters, limit: 100 }),
        api.get('/service/stats', filters).catch(() => null),
      ]);
      setTickets(ticketsRes.data || []);
      // No stats (endpoint failed): drop stale numbers so the tiles fall back to counts over the loaded list.
      setStats(statsRes || null);
    } catch (err) {
      console.error('Failed to load service tickets:', err);
      setLoadError(errMsg(err, 'Failed to load service tickets.'));
    } finally {
      setIsLoading(false);
    }
  }, [priorityFilter, sourceFilter, unassignedFilter, overdueFilter, repeatFilter, unverifiedFilter, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load auxiliary reference data (the new-ticket popup loads its own)
  useEffect(() => {
    if (['management', 'regional_manager', 'service_team', 'admin'].includes(role)) {
      api
        .get('/service/engineers')
        .then((res: any) => setServiceEngineers(Array.isArray(res) ? res : res?.data || []))
        .catch(() => setServiceEngineers([]));
    }
  }, [role]);

  // Pipeline tabs (§32) are client-side over the filtered list
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
    return s === tab;
  }, []);
  const displayedTickets = useMemo(() => tickets.filter((t) => matchesTab(activeTab, t.status)), [tickets, activeTab, matchesTab]);

  const tabCount = (tab: string) => tickets.filter((t) => matchesTab(tab, t.status)).length;

  const anyFilter = sourceFilter !== 'all' || priorityFilter !== 'all' || unassignedFilter || overdueFilter || repeatFilter || unverifiedFilter || activeTab !== 'all' || !!searchQuery;
  const clearFilters = () => {
    setSourceFilter('all');
    setPriorityFilter('all');
    setUnassignedFilter(false);
    setOverdueFilter(false);
    setRepeatFilter(false);
    setUnverifiedFilter(false);
    setSearchQuery('');
    setActiveTab('all');
  };
  const applyStatFilter = (kind: 'portal' | 'breached' | 'unverified') => {
    clearFilters();
    if (kind === 'portal') {
      setSourceFilter('Customer Portal');
      setActiveTab('open');
    } else if (kind === 'breached') setOverdueFilter(true);
    else setUnverifiedFilter(true);
  };

  // "Flags" dropdown: single-select over the quick toggles (and the old portal-triage tile)
  type FlagKey = 'all' | 'portal' | 'unassigned' | 'overdue' | 'repeat' | 'unverified';
  const activeFlag: FlagKey =
    sourceFilter === 'Customer Portal' && activeTab === 'open'
      ? 'portal'
      : unassignedFilter
      ? 'unassigned'
      : overdueFilter
      ? 'overdue'
      : repeatFilter
      ? 'repeat'
      : unverifiedFilter
      ? 'unverified'
      : 'all';
  const pickFlag = (key: FlagKey) => {
    if (activeFlag === 'portal' && key !== 'portal') {
      setSourceFilter('all');
      setActiveTab('all');
    }
    setUnassignedFilter(key === 'unassigned');
    setOverdueFilter(key === 'overdue');
    setRepeatFilter(key === 'repeat');
    setUnverifiedFilter(key === 'unverified');
    if (key === 'portal') {
      setSourceFilter('Customer Portal');
      setActiveTab('open');
    }
  };
  /** KPI tile that switches the stage filter (click again to clear). */
  const toggleStage = (tab: string) => setActiveTab((cur) => (cur === tab ? 'all' : tab));

  const STAGES: { id: string; label: string }[] = [
    { id: 'all', label: 'All stages' },
    { id: 'open', label: 'New intake' },
    { id: 'assigned', label: 'Assigned & scheduled' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'awaiting', label: 'Awaiting / on hold' },
    { id: 'escalated', label: 'Escalated / revisit' },
    { id: 'reports', label: 'Reports filed' },
    { id: 'closed', label: 'Closed / cancelled' },
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
        setSelectedTicket(await fetchDetail(id));
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
      const out: TicketAction[] = [];
      for (const target of allowed) {
        if (target === 'report_submitted') continue; // set by filing a report
        if (target === 'closed') {
          out.push({ kind: 'close', label: 'Sign off & close', tone: 'primary' });
          continue;
        }
        if (target === 'reopened' && !['management', 'admin'].includes(role)) continue;
        if (status === 'escalated' && !isManager) continue; // only managers de-escalate
        // a field engineer can only self-assign an unassigned ticket; a chief service engineer (team > 1) can reassign
        if (target === 'assigned' && role === 'service_team' && t.assigned_to && engineers.length <= 1) continue;
        if (target === 'cancelled' && role === 'service_team' && t.assigned_to && t.assigned_to !== userId) continue;
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
      if (['service_team', 'admin'].includes(role) && ['in_progress', 'resolved'].includes(status)) {
        out.push({ kind: 'report', label: 'File service report', tone: 'primary' });
      }
      // §47: hand an open ticket to another engineer without a status change (a field engineer cannot; a chief can)
      if (t.assigned_to && !isFinished(t.status) && (role !== 'service_team' || engineers.length > 1)) {
        out.push({ kind: 'reassign', label: 'Reassign engineer', tone: 'secondary' });
      }
      return out.sort((a, b) => actionRank(a) - actionRank(b));
    },
    [role, userId, engineers.length],
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

  // Open Ticket Detail
  const handleOpenDetail = async (ticket: any) => {
    setCardError(null);
    setDetailTab('overview');
    selectedIdRef.current = ticket.id;
    try {
      setSelectedTicket(await fetchDetail(ticket.id));
      setIsDetailModalOpen(true);
    } catch (err) {
      selectedIdRef.current = null;
      setCardError(errMsg(err, 'Could not open this ticket.'));
    }
  };
  // Deep link from demos, tasks and notifications: /service?open=<ticket id>
  useOpenParam((id) => handleOpenDetail({ id }));
  const closeDetail = () => {
    setIsDetailModalOpen(false);
    selectedIdRef.current = null;
  };

  const canLinkRole = LINK_ROLES.includes(role);
  const workload: any[] = stats?.employeeWorkload || [];

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
  const lanes = STAGES.filter((s) => s.id !== 'all').map((s) => ({ key: s.id, label: s.label, tone: toneFor(s.label) }));
  const stageOf = (status: string) => lanes.find((l) => matchesTab(l.key, status))?.key ?? 'open';
  const laneByKey = new Map<string, string>(displayedTickets.map((t) => [String(t.id), stageOf(t.status)]));
  const laneOf = (item: RecordItem) => laneByKey.get(item.key) ?? 'open';
  /** Same rule as the dossier: open, clock running, resolution deadline passed. */
  const slaBreached = (t: any) => !isFinished(t.status) && !isSlaPaused(t) && !!t.sla_resolution_due_at && new Date(t.sla_resolution_due_at).getTime() < Date.now();
  const breachedCount = displayedTickets.filter(slaBreached).length;
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
      code: t.ticket_no,
      title: t.complaint || 'No complaint text',
      subtitle: [customer, t.location || t.city].filter(Boolean).join(' · '),
      status: { label: statusLabel(t.status), tone: toneFor(statusLabel(t.status)) },
      badges,
      due: { date: t.sla_resolution_due_at, label: 'SLA due', done },
      owner: t.assignee_name || 'Unassigned',
      facts: [
        { label: 'Warranty', value: t.warranty_status === 'in_warranty' ? 'In Warranty' : t.warranty_status === 'amc' ? 'Under AMC' : 'Billable / Out of Warranty' },
        { label: 'Machine S/N', value: t.equipment_serial || '—' },
        { label: 'Received', value: fmtDay(t.received_date || t.created_at) },
        { label: 'Source', value: t.complaint_source || 'Phone' },
      ],
      primary: next ? { label: next.label, onClick: () => runAction(t, next) } : undefined,
      quick: quick.slice(0, 3),
      onOpen: () => handleOpenDetail(t),
    };
  });

  // recordItems is displayedTickets mapped 1:1, so row i and recordItems[i] are the same ticket
  const ticketList = displayedTickets.length ? (
    <RecordTable items={recordItems}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticket Ref</TableHead>
            <TableHead>Customer & Site</TableHead>
            <TableHead>Complaint</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Engineer</TableHead>
            <TableHead>SLA Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
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
            const site = [unverified && 'Unverified customer', t.location || t.city, t.equipment_serial && `S/N ${t.equipment_serial}`].filter(Boolean).join(' · ');
            return (
              <TableRow key={t.id}>
                <TableCell className="font-bold whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{t.ticket_no || '-'}</span>
                </TableCell>
                <TableCell className="font-bold text-[#14213D]">
                  {customer}
                  {site && <div className="text-[10px] text-[#4A5568] font-normal">{site}</div>}
                </TableCell>
                <TableCell className="text-[#4A5568] max-w-[240px] truncate" title={t.complaint || undefined}>
                  {t.complaint || 'No complaint text'}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {t.priority ? (
                    <Badge variant={priorityBadge(t.priority)} size="sm" className="uppercase font-bold">
                      {upperLabel(t.priority)}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
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
                <TableCell className="whitespace-nowrap">
                  <Badge variant={ticketStatusBadge(t.status)} size="sm" className="uppercase font-bold">
                    {upperLabel(statusLabel(t.status))}
                  </Badge>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-2">
                    {primary && (
                      <Button size="sm" variant="primary" className="shadow-xs text-xs" disabled={primary.disabled} onClick={primary.onClick}>
                        {primary.label}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" className="shadow-xs text-xs" onClick={() => handleOpenDetail(t)}>
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

      {/* KPI Metrics HUD (§34) — five tiles; clickable ones filter the queue (click again to clear). */}
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
          className={activeRing(activeTab === 'open' && activeFlag !== 'portal')}
        />
        <StatCard
          label="Pending Queue"
          value={stats?.pendingTickets ?? tickets.filter((t) => !isFinished(t.status)).length}
          subtext={`${stats?.assignedTickets ?? tickets.filter((t) => t.assigned_to && !isFinished(t.status)).length} assigned to engineers`}
          icon={<Wrench className="h-5 w-5 text-[#0F5E63]" />}
        />
        <StatCard
          label="SLA Breached"
          value={stats?.slaBreached ?? 0}
          subtext={`${stats?.overdueTickets ?? 0} past planned visit date`}
          icon={<AlertTriangle className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
          role="button"
          tabIndex={0}
          onClick={() => (overdueFilter ? setOverdueFilter(false) : applyStatFilter('breached'))}
          onKeyDown={(e) => e.key === 'Enter' && (overdueFilter ? setOverdueFilter(false) : applyStatFilter('breached'))}
          className={activeRing(overdueFilter)}
        />
        <StatCard
          label="Awaiting Parts / Spares"
          value={stats?.awaitingParts ?? tickets.filter((t) => normalizeServiceStatus(t.status) === 'awaiting_part').length}
          subtext="Depot spares logistics pending"
          icon={<Package className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
        />
        <StatCard
          label="Completed & Signed"
          value={stats?.completedTickets ?? 0}
          subtext={`Avg closure ${stats?.avgClosureDays ?? 0}d from intake`}
          icon={<CheckCircle2 className="h-5 w-5 text-[#0F5E63]" />}
          variant="emerald"
          role="button"
          tabIndex={0}
          onClick={() => toggleStage('closed')}
          onKeyDown={(e) => e.key === 'Enter' && toggleStage('closed')}
          // phones (2-column grid): the fifth tile spans the row instead of sitting alone at half width
          className={`col-span-2 md:col-span-1 ${activeRing(activeTab === 'closed')}`}
        />
      </StatGrid>

      {/* One filter row: search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
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
                count: s.id === 'all' ? tickets.length : tabCount(s.id),
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
                onSelect: () => {
                  if (activeFlag === 'portal') setActiveTab('all');
                  setSourceFilter(s.key);
                },
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
                { key: 'unassigned', label: 'Unassigned', icon: <User />, count: undefined },
                { key: 'overdue', label: 'Overdue / SLA breached', icon: <AlertTriangle />, count: stats?.slaBreached ?? undefined },
                { key: 'repeat', label: 'Repeat complaints', icon: <Repeat />, count: stats?.repeatComplaints ?? undefined },
                { key: 'unverified', label: 'Unverified customer', icon: <ShieldQuestion />, count: stats?.unverifiedCustomers ?? undefined },
              ].map((f) => ({
                ...f,
                urgent: f.key === 'overdue',
                active: activeFlag === f.key,
                onSelect: () => pickFlag(f.key as FlagKey),
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
              {anyFilter ? `${displayedTickets.length} of ${tickets.length} tickets` : `${displayedTickets.length} ticket${displayedTickets.length === 1 ? '' : 's'}`}
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
                    <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                      {st.warranty_status_snapshot || st.warranty_status || 'Under Warranty'}
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2 border-t border-[#ECE9E2]">
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
                        <p><strong>Coverage:</strong> {st.warranty_status_snapshot || st.warranty_status || 'Under Warranty'}</p>
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
                <ReportsTab ticket={st} role={role} onNewReport={() => setActionCtx({ kind: 'report', ticket: st })} onChanged={refreshAll} />
              )}
              {detailTab === 'parts' && <PartsTab ticket={st} role={role} onChanged={refreshAll} />}
              {detailTab === 'comments' && <NotesTab ticket={st} onChanged={refreshAll} />}
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
