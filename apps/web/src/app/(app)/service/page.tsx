'use client';

import Link from 'next/link';
import { istToday } from '@/lib/ist-date';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Wrench,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building,
  User,
  ShieldAlert,
  FileCheck,
  RefreshCw,
  Calendar,
  UserCheck,
  FileText,
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
import { useOpenParam } from '@/lib/use-open-param';
import { canOpen } from '@/lib/route-access';
import { RelatedRecords } from '@/components/links/RelatedRecords';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  Textarea,
  PageContainer,
  FormSteps,
  PageHeader,
  EmptyState,
  StatCard,
  StatGrid,
  InfoCallout,
  PageLoader,
  FilterMenu,
  RecordViews,
  toneFor,
  type RecordItem,
  ScrollStrip,
} from '@/components/ui';
import type { ServicePriority, WarrantyStatus, ComplaintSource } from '@arihant/shared';
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
import { VisitsTab } from '@/components/service/VisitsTab';
import { PartsTab } from '@/components/service/PartsTab';
import { ReportsTab } from '@/components/service/ReportsTab';
import { NotesTab, AuditTab } from '@/components/service/NotesAuditTabs';

/** One thing a user can do to a ticket right now (derived from allowed_next_statuses + role). */
type TicketAction =
  | { kind: 'status'; target: ServiceStatus; label: string; tone: 'primary' | 'secondary' | 'exception' }
  | { kind: 'report'; label: string; tone: 'primary' }
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
const ACTION_ORDER = ['assigned', 'visit_scheduled', 'in_progress', 'report', 'resolved', 'closed', 'reopened', 'created', 'received'];

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
};
const actionKey = (a: TicketAction) => (a.kind === 'status' ? a.target : a.kind === 'report' ? 'report' : 'closed');
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

type ActionCtx = { kind: 'status' | 'close' | 'report' | 'link'; ticket: any; target?: ServiceStatus };

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
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [serviceEngineers, setServiceEngineers] = useState<any[]>([]);

  // Modals
  const [isLogTicketOpen, setIsLogTicketOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isWorkloadModalOpen, setIsWorkloadModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [actionCtx, setActionCtx] = useState<ActionCtx | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // New ticket form (§31)
  const emptyTicket = () => ({
    organisation_id: '',
    organisation_name: '',
    city: '',
    ticket_no: '',
    equipment_type: 'XBIS (X-Ray Baggage Inspection System)',
    serial_no: '',
    location: '',
    complaint: '',
    complaint_source: 'Phone' as ComplaintSource,
    received_date: istToday(),
    priority: 'high' as ServicePriority,
    warranty_status: 'in_warranty' as WarrantyStatus,
    assigned_to: '',
    planned_visit_date: '',
  });
  const [newTicket, setNewTicket] = useState(emptyTicket);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'visits' | 'reports' | 'parts' | 'comments' | 'history' | 'linked'>('overview');

  // Engineers the current user may pick: everyone for managers, only themselves for an engineer
  const engineers: Engineer[] = useMemo(() => {
    const list = serviceEngineers.map((u: any) => ({ id: u.id as string, name: (u.full_name || u.email) as string }));
    return role === 'service_team' ? list.filter((e) => e.id === userId) : list;
  }, [serviceEngineers, role, userId]);
  const engineerNames = useMemo(() => Object.fromEntries(serviceEngineers.map((u: any) => [u.id, u.full_name || u.email])), [serviceEngineers]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fetch tickets & stats
  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const [ticketsRes, statsRes] = await Promise.all([
        api.get('/service/tickets', {
          priority: priorityFilter !== 'all' ? priorityFilter : undefined,
          complaint_source: sourceFilter !== 'all' ? sourceFilter : undefined,
          unassigned: unassignedFilter ? 'true' : undefined,
          overdue: overdueFilter ? 'true' : undefined,
          repeat: repeatFilter ? 'true' : undefined,
          unverified: unverifiedFilter ? 'true' : undefined,
          search: debouncedSearch || undefined,
          limit: 100,
        }),
        api.get('/service/stats').catch(() => null),
      ]);
      setTickets(ticketsRes.data || []);
      if (statsRes) setStats(statsRes);
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

  // Load auxiliary reference data
  useEffect(() => {
    api
      .get('/organisations', { limit: 100 })
      .then((res) => setOrganisations(res.data || []))
      .catch(() => {});

    api
      .get('/users', { role: 'service_team', limit: 100 })
      .then((res) => setServiceEngineers((res.data || []).filter((u: any) => u.is_active !== false)))
      .catch(() => {});
  }, []);

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
        if (target === 'assigned' && role === 'service_team' && t.assigned_to) continue; // engineers can only self-assign an unassigned ticket
        if (target === 'cancelled' && role === 'service_team' && t.assigned_to && t.assigned_to !== userId) continue;
        let label = ACTION_LABEL[target] || statusLabel(target);
        if (status === 'escalated' && target !== 'cancelled') label = `De-escalate: ${statusLabel(target)}`;
        else if (target === 'assigned' && t.assigned_to) label = 'Reassign engineer';
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
      return out.sort((a, b) => actionRank(a) - actionRank(b));
    },
    [role, userId],
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

  // 1. Log New Incident (§31)
  const handleLogTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      let orgId = newTicket.organisation_id;
      if (!orgId) {
        if (!newTicket.organisation_name.trim()) {
          throw new Error('Please enter or select a customer organisation.');
        }
        const orgRes = await api.post('/organisations', {
          name: newTicket.organisation_name.trim(),
          city: newTicket.city.trim() || 'New Delhi',
          state: 'North Zone',
        });
        orgId = orgRes.id;
      }

      await api.post('/service/tickets', {
        organisation_id: orgId,
        ticket_no: newTicket.ticket_no.trim() || undefined,
        equipment_serial: newTicket.serial_no || undefined,
        location: newTicket.location || newTicket.city || undefined,
        complaint: `[${newTicket.equipment_type}] ${newTicket.complaint}`,
        complaint_source: newTicket.complaint_source,
        received_date: newTicket.received_date || undefined,
        priority: newTicket.priority,
        warranty_status: newTicket.warranty_status,
        assigned_to: newTicket.assigned_to || undefined,
        planned_visit_date: newTicket.planned_visit_date || undefined,
      });

      setIsLogTicketOpen(false);
      setNewTicket(emptyTicket());
      await fetchData();
    } catch (err) {
      setActionError(errMsg(err, 'Failed to register breakdown incident.'));
    } finally {
      setIsSubmitting(false);
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

  const renderAction = (t: any, a: TicketAction, size: 'xs' | 'sm' = 'sm') => (
    <Button
      key={actionKey(a)}
      size={size}
      variant={a.tone === 'primary' ? 'primary' : a.tone === 'exception' ? 'outline' : 'secondary'}
      className={a.tone === 'exception' ? 'border-[#9A3412]/40 text-[#7C2D12] hover:bg-[#FBEBDD]' : undefined}
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
  const fmtDay = (v: unknown) => (v ? new Date(v as string).toLocaleDateString('en-IN') : '—');

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

  return (
    <PageContainer>
      {/* Page Header */}
      <PageHeader
        title="Service Desk & Installed Base Maintenance"
        icon={<Wrench className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={() => setIsWorkloadModalOpen(true)} variant="outline" size="sm" className="border-[#DCD8CE] text-[#14213D] shadow-xs">
              <Users className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
              <span>Engineer Workload ({workload.length || serviceEngineers.length})</span>
            </Button>
            {role !== 'accounts' && (
              <Button onClick={() => setIsLogTicketOpen(true)} variant="primary" className="shadow-xs">
                <Plus className="h-4 w-4 mr-1.5" />
                <span>Log Breakdown Incident</span>
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
          className={activeRing(activeTab === 'closed')}
        />
      </StatGrid>

      {/* One filter row: search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              type="search"
              aria-label="Search service tickets"
              placeholder="Search ticket ref, customer, complaint, serial…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Stage"
              icon={<Layers />}
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
              className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
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
        <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
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
          defaultView="board"
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
      <Modal
        isOpen={isLogTicketOpen}
        onClose={() => setIsLogTicketOpen(false)}
        title="Log Equipment Breakdown Incident"
        description="Register a defense/PSU customer maintenance incident under warranty or AMC contract."
        maxWidth="lg"
      >
        <form onSubmit={handleLogTicket}>
          <FormSteps
            onCancel={() => setIsLogTicketOpen(false)}
            banner={
              actionError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {actionError}
                </div>
              )
            }
            submit={
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Register Incident & Dispatch
              </Button>
            }
            steps={[
              {
                title: 'Intake',
                icon: <FileText />,
                description: 'When and how the complaint reached us, and how urgent it is.',
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Ticket Ref"
                        placeholder="Auto: TCK-YYYY-NNNNNN"
                        helperText="Leave blank to use the next number"
                        value={newTicket.ticket_no}
                        onChange={(e) => setNewTicket({ ...newTicket, ticket_no: e.target.value })}
                      />
                      <Input
                        label="Date Received"
                        type="date"
                        required
                        value={newTicket.received_date}
                        onChange={(e) => setNewTicket({ ...newTicket, received_date: e.target.value })}
                      />
                      <Select
                        label="Complaint Origin / Source"
                        value={newTicket.complaint_source}
                        onChange={(e) => setNewTicket({ ...newTicket, complaint_source: e.target.value as ComplaintSource })}
                        options={[
                          { value: 'Phone', label: 'Direct Client Call / Phone Helpline' },
                          { value: 'Email', label: 'Official Client Email / Notice' },
                          { value: 'Official Letter', label: 'Government Written Dispatch / Letter' },
                          { value: 'Customer Portal', label: 'Client Direct / Web Portal' },
                          { value: 'Demo Team', label: 'Demo Team (Trial Incident / Client Discovery)' },
                          { value: 'Sales Rep', label: 'Sales Rep (Field Visit / On-site Contact)' },
                          { value: 'Field Visit', label: 'Routine Inspection / Field Visit' },
                          { value: 'Walk-in', label: 'Client Walk-in / Depot Visit' },
                          { value: 'WhatsApp', label: 'WhatsApp Helpline' },
                        ]}
                      />
                      <Select
                        label="SLA Priority Level"
                        value={newTicket.priority}
                        onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value as ServicePriority })}
                        options={[
                          { value: 'critical', label: 'CRITICAL — Liquidated Damages (LD) Risk' },
                          { value: 'high', label: 'HIGH — Station Interruption' },
                          { value: 'medium', label: 'MEDIUM — Partial Functionality' },
                          { value: 'low', label: 'LOW — Routine Preventative' },
                        ]}
                      />
                    </div>

                    {/* Dynamic Source Origin Guidance Note */}
                    {newTicket.complaint_source === 'Demo Team' && (
                      <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-900 flex items-center gap-2">
                        <Flame className="h-4 w-4 shrink-0 text-purple-600" />
                        <span>
                          <strong>Demo Team Field Intake:</strong> Tagged for demo trials. Use this if demo equipment broke down during a client demonstration trial, or if an on-site customer requested servicing for an existing machine during your demo visit.
                        </span>
                      </div>
                    )}
                    {newTicket.complaint_source === 'Official Letter' && (
                      <div className="p-2.5 rounded-lg bg-[#FBEBDD] border border-[#9A3412]/30 text-xs text-[#7C2D12] flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-[#9A3412]" />
                        <span>
                          <strong>Formal B2G Government Notice:</strong> Registered under official client letter dispatch. Ensure the letter dispatch number and contract terms are noted in the complaint field.
                        </span>
                      </div>
                    )}
                    {newTicket.complaint_source === 'Customer Portal' && (
                      <div className="p-2.5 rounded-lg bg-[#E3EFEE] border border-[#0F5E63]/30 text-xs text-[#0F5E63] flex items-center gap-2">
                        <Building className="h-4 w-4 shrink-0 text-[#0F5E63]" />
                        <span>
                          <strong>Direct Client Web Intake:</strong> Incident logged directly by client authority or nodal checkpoint officer.
                        </span>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: 'Customer',
                icon: <Building />,
                description: 'Which client agency raised it and where the machine is deployed.',
                content: (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Client Agency / Organisation <span className="text-red-500">*</span>
                      </label>
                      <input
                        list="org-list"
                        value={newTicket.organisation_name}
                        onChange={(e) => {
                          const val = e.target.value;
                          const match = organisations.find((o) => o.name === val);
                          setNewTicket({
                            ...newTicket,
                            organisation_name: val,
                            organisation_id: match ? match.id : '',
                            city: match?.city || newTicket.city,
                          });
                        }}
                        placeholder="e.g. Delhi Police Traffic HQ / BSF Sector"
                        className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        required
                      />
                      <datalist id="org-list">
                        {organisations.map((org) => (
                          <option key={org.id} value={org.name}>
                            {org.city ? `${org.name} (${org.city})` : org.name}
                          </option>
                        ))}
                      </datalist>
                    </div>

                    <Input
                      label="Deployment Station / City"
                      value={newTicket.city}
                      onChange={(e) => setNewTicket({ ...newTicket, city: e.target.value })}
                      placeholder="e.g. New Delhi / Patna / Kolkata"
                    />
                  </div>
                ),
              },
              {
                title: 'Equipment',
                icon: <Wrench />,
                description: 'The machine that broke down, its coverage and what went wrong.',
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Equipment Category"
                        value={newTicket.equipment_type}
                        onChange={(e) => setNewTicket({ ...newTicket, equipment_type: e.target.value })}
                        options={[
                          { value: 'XBIS (X-Ray Baggage Inspection System)', label: 'XBIS (Dual Energy X-Ray)' },
                          { value: 'DFMD (Door Frame Metal Detector)', label: 'DFMD (Multi-Zone Walk-through)' },
                          { value: 'HHMD (Hand Held Metal Detector)', label: 'HHMD (MHA QR Compliant)' },
                          { value: 'UVSS (Under Vehicle Surveillance System)', label: 'UVSS Embedded Array' },
                          { value: 'Thermal Imaging Monocular', label: 'Thermal / Night Vision' },
                          { value: 'Other Homeland Security Device', label: 'Other Security Hardware' },
                        ]}
                      />
                      <Input
                        label="Machine Serial Number"
                        value={newTicket.serial_no}
                        onChange={(e) => setNewTicket({ ...newTicket, serial_no: e.target.value })}
                        placeholder="e.g. SN-XBIS-2025-081"
                      />
                      <Select
                        label="Warranty / AMC Status"
                        value={newTicket.warranty_status}
                        onChange={(e) => setNewTicket({ ...newTicket, warranty_status: e.target.value as WarrantyStatus })}
                        options={[
                          { value: 'in_warranty', label: 'Under OEM Warranty' },
                          { value: 'amc', label: 'Comprehensive AMC Active' },
                          { value: 'out_of_warranty', label: 'Out of Warranty (Billable)' },
                        ]}
                      />
                    </div>

                    <Textarea
                      label="Breakdown Complaint / Symptom"
                      required
                      rows={3}
                      value={newTicket.complaint}
                      onChange={(e) => setNewTicket({ ...newTicket, complaint: e.target.value })}
                      placeholder="Describe the failure, error codes on display, or physical damage observed..."
                    />
                  </div>
                ),
              },
              {
                title: 'Dispatch',
                icon: <UserCheck />,
                description: 'Optionally send an engineer now and plan the first visit.',
                content: (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select
                      label="Initial Field Engineer Dispatch (Optional)"
                      value={newTicket.assigned_to}
                      onChange={(e) => setNewTicket({ ...newTicket, assigned_to: e.target.value })}
                      options={[
                        { value: '', label: '-- Unassigned (Assign Later) --' },
                        ...engineers.map((eng) => ({ value: eng.id, label: eng.name })),
                      ]}
                    />
                    <Input
                      label="Planned Visit Date"
                      type="date"
                      value={newTicket.planned_visit_date}
                      onChange={(e) => setNewTicket({ ...newTicket, planned_visit_date: e.target.value })}
                    />
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>


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
              <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-bold text-[#0F5E63]">{st.ticket_no || st.ticket_number}</span>
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
                    <span className="font-semibold text-[#14213D]">{st.planned_visit_date ? new Date(st.planned_visit_date).toLocaleDateString('en-IN') : 'Not Scheduled'}</span>
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
                    className={`py-2 px-3 border-b-2 transition-all whitespace-nowrap ${
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
                        {progress.length > 0 && <div className="flex flex-wrap gap-2">{progress.map((a) => renderAction(st, a))}</div>}
                        {exceptions.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4A5568]">Exceptions (reason required)</span>
                            <div className="flex flex-wrap gap-2">{exceptions.map((a) => renderAction(st, a))}</div>
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
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#14213D] block">Intake origin & channel</span>
                        <Badge variant={isPortalTicket(st) ? 'info' : 'outline'} size="sm">
                          {st.complaint_source || 'Phone'}
                        </Badge>
                      </div>
                      <div className="text-[#4A5568] space-y-1">
                        <p><strong>Category:</strong> {st.problem_category || 'Breakdown'}</p>
                        <p><strong>Location:</strong> {st.location || st.city || 'Standard Facility'}</p>
                        <p><strong>Received:</strong> {st.received_date ? new Date(st.received_date).toLocaleDateString('en-IN') : '—'}</p>
                        <p><strong>Customer:</strong> {unverified ? `${st.claimed_organisation_name} (unverified)` : st.organisation_name}</p>
                        {st.contact_name && <p><strong>Contact:</strong> {st.contact_name}{st.contact_mobile ? ` · ${st.contact_mobile}` : ''}</p>}
                        {st.complaint_source === 'Demo Team' && (
                          <p className="text-[11px] font-semibold text-purple-700 bg-purple-50 p-1.5 rounded mt-1 border border-purple-200">Flagged by Demo Team during a field trial or live demonstration</p>
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
                        <p><strong>Resolved:</strong> {st.resolved_at ? new Date(st.resolved_at).toLocaleString('en-IN') : '—'}</p>
                        <p><strong>Closed:</strong> {st.closed_at ? new Date(st.closed_at).toLocaleString('en-IN') : '—'}</p>
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
                <Button size="sm" variant="secondary" onClick={closeDetail}>
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
          <div className="overflow-x-auto rounded-[14px] border border-[#DCD8CE]">
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
            <Button size="sm" variant="secondary" onClick={() => setIsWorkloadModalOpen(false)}>
              Close Workload HUD
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
