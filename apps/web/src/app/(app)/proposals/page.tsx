'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useState, useEffect, useTransition, useCallback, useMemo, useRef } from 'react';
import {
  Bell,
  FileSpreadsheet,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  Calendar,
  AlertCircle,
  AlertTriangle,
  User,
  ArrowRight,
  ExternalLink,
  Building,
  Package,
  Layers,
  FileCheck,
  Send,
  MessageSquare,
  History,
  X,
  Briefcase,
  Copy,
  Check,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  CalendarDays,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { userWithRole } from '@/lib/role-label';
import { useOpenParam } from '@/lib/use-open-param';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { canOpen } from '@/lib/route-access';
import { RelatedRecords } from '@/components/links/RelatedRecords';
import { getSocket } from '@/lib/socket';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  Textarea,
  PageContainer,
  PageHeader,
  StatGrid,
  StatCard,
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
  type BoardLane,
  Tabs, Spinner, FilterMenu, InfoCallout, FormSteps, FormSection, ScrollStrip } from '@/components/ui';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_LOST_REASONS,
  PROPOSAL_CLOSURE_REASONS,
  formatINR,
  type ProposalStatus,
  type ProposalLostReason,
  PROPOSAL_ORDER_TYPES,
} from '@arihant/shared';

/** A proposal DATE value from the API ('YYYY-MM-DD' or a serialized instant) as its IST calendar day. */
const proposalDay = calendarDay;

/** An instant as IST date-time for audit rows ('13/10/2026, 00:52'); '—' when missing or invalid. */
const istDateTimeText = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};
/** Status code → its label, whatever the casing ('REQUESTED', 'sent', 'SENT_TO_CUSTOMER'). */
const statusText = (s?: string | null) => (s ? PROPOSAL_STATUS_LABELS[s] || PROPOSAL_STATUS_LABELS[String(s).toUpperCase()] || String(s).replace(/_/g, ' ') : '');
/** Server-computed transitions the viewer may make right now (RBAC + lifecycle, DEF-008). */
const canMove = (p: any, target: string) => Array.isArray(p?.allowed_transitions) && p.allowed_transitions.includes(target);
/** Edit / follow-up rights: server-computed; terminal proposals are always read-only (DEF-080). */
const canEditProposal = (p: any) => Boolean(p?.can_edit);
const hasQuote = (p: any) => Number(p?.quoted_value) > 0;
/** "New Delhi, Delhi" — never a dangling comma when the state is missing (DEF-082). */
const placeText = (city?: string | null, state?: string | null) => [city, state].map((x) => (x || '').trim()).filter(Boolean).join(', ');
/** Form number field → API value: '' → null (clears), '1,25,000' → 125000. */
const numOrNull = (v: string) => {
  const t = String(v ?? '').replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
};
const numInput = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
const SENT_LANES = ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'];
/** Roles that can own proposal follow-ups (RBAC spec §2), and the all-India ones among them (server mirror). */
const PROPOSAL_OWNER_ROLES = ['management', 'regional_manager', 'sales', 'tender_team', 'admin'];
const NATIONAL_OWNER_ROLES = ['management', 'admin', 'tender_team'];
const currentOwnerOf = (p: any): string => p?.follow_up_owner_id || p?.followup_owner_id || '';
/** Users who may own this proposal's follow-ups: active proposals users covering the customer's region. */
const ownerChoicesFor = (p: any, users: any[]) => {
  const current = currentOwnerOf(p);
  const region = p?.organisation_region_id;
  const parties = [p?.requested_by_id, p?.requested_by, p?.created_by_id, p?.created_by, p?.responsible_person_id, p?.responsible_id];
  const options = users
    .filter(
      (u) =>
        u.id === current ||
        (u.is_active !== false &&
          PROPOSAL_OWNER_ROLES.includes(u.role) &&
          (NATIONAL_OWNER_ROLES.includes(u.role) || !region || u.region_id === region || parties.includes(u.id))),
    )
    .map((u) => ({ value: String(u.id), label: userWithRole(u) }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: p?.followup_owner_name || 'Current owner' });
  return options;
};

type CommercialForm = {
  quoted_value: string;
  quantity: string;
  margin_percent: string;
  validity_date: string;
  payment_terms: string;
  delivery_terms: string;
};
const EMPTY_COMMERCIAL: CommercialForm = { quoted_value: '', quantity: '', margin_percent: '', validity_date: '', payment_terms: '', delivery_terms: '' };
const commercialPayload = (c: CommercialForm) => ({
  quoted_value: numOrNull(c.quoted_value),
  quantity: numOrNull(c.quantity),
  margin_percent: numOrNull(c.margin_percent),
  validity_date: c.validity_date || null,
  payment_terms: c.payment_terms.trim() || null,
  delivery_terms: c.delivery_terms.trim() || null,
});
/** Client mirror of the server rules, so obvious mistakes are explained before the round trip. */
const commercialError = (c: CommercialForm): string | null => {
  const q = numOrNull(c.quoted_value);
  if (q !== null && (!Number.isFinite(q) || q < 0)) return 'Quoted value must be a positive amount in ₹';
  const qty = numOrNull(c.quantity);
  if (qty !== null && (!Number.isInteger(qty) || qty < 1)) return 'Quantity must be a whole number of at least 1';
  const m = numOrNull(c.margin_percent);
  if (m !== null && (!Number.isFinite(m) || m < -100 || m > 100)) return 'Margin must be a percentage between -100 and 100';
  return null;
};

/**
 * Dialog action rows. Phones (bottom sheet): a sticky footer docked to the sheet's bottom edge, the
 * buttons sharing the full width as 40px thumb targets. From `sm` up: the plain right-aligned row.
 */
const DIALOG_FOOTER =
  'sticky -bottom-4 z-10 -mx-4 -mb-4 flex gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 [&>*]:min-w-0 [&>*]:flex-1 sm:static sm:z-auto sm:mx-0 sm:mb-0 sm:justify-end sm:border-[#E3EFEE] sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-3 sm:[&>*]:flex-none';
const DIALOG_BTN = 'h-10 sm:h-8';
/** Workflow buttons in the proposal sheet: phones share the row as 40px targets; `sm` up keeps the compact xs button. */
const FLOW_BTN = 'h-10 grow basis-[8rem] text-xs sm:h-7 sm:grow-0 sm:basis-auto sm:text-[11px]';
/**
 * Filter-row dropdowns on phones: the menus wrap over several lines, so a panel anchored to its button
 * runs off the left or right screen edge. Below `sm` each panel opens full-width under the menu group
 * (the group is the positioning box); from `sm` up it stays anchored to its button.
 */
const PHONE_MENU = 'max-sm:static max-sm:[&_.filter-menu-panel]:inset-x-0 max-sm:[&_.filter-menu-panel]:max-w-none';

const PROPOSAL_STATUS_FILTERS = [
  { key: 'PROPOSAL_REQUESTED', label: 'Proposal requested' },
  { key: 'UNDER_PREPARATION', label: 'Under preparation' },
  { key: 'READY_FOR_REVIEW', label: 'Ready for review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'SENT_TO_CUSTOMER', label: 'Sent to customer' },
  { key: 'FOLLOW_UP_REQUIRED', label: 'Follow-up required' },
  { key: 'CONVERTED', label: 'Converted' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'LOST', label: 'Lost' },
];
/** Stage-board lanes in workflow order (same statuses as the Status filter). */
const PROPOSAL_LANES: BoardLane[] = PROPOSAL_STATUS_FILTERS.map((s) => ({ key: s.key, label: s.label, tone: toneFor(s.label) }));
/** Legacy lowercase / short status values fold into the canonical upper-case lanes. */
const LEGACY_PROPOSAL_LANE: Record<string, string> = { REQUESTED: 'PROPOSAL_REQUESTED', SENT: 'SENT_TO_CUSTOMER', FOLLOWUP_REQUIRED: 'FOLLOW_UP_REQUIRED' };
const proposalLaneOf = (status?: string | null) => {
  const s = String(status || '').toUpperCase();
  return LEGACY_PROPOSAL_LANE[s] || s || 'PROPOSAL_REQUESTED';
};

type BadgeVariant = NonNullable<BadgeProps['variant']>;
/** Register-table status badge, keyed on the canonical lane so legacy lowercase statuses colour the same. */
const proposalBadge = (status?: string | null): BadgeVariant => {
  const lane = proposalLaneOf(status);
  if (['APPROVED', 'SENT_TO_CUSTOMER', 'CONVERTED'].includes(lane)) return 'success';
  if (['READY_FOR_REVIEW', 'FOLLOW_UP_REQUIRED'].includes(lane)) return 'warning';
  if (['PROPOSAL_REQUESTED', 'UNDER_PREPARATION'].includes(lane)) return 'default';
  if (lane === 'LOST') return 'danger';
  return 'outline';
};
const upperLabel = (s?: string | null) => String(s || '—').replace(/_/g, ' ');
/** The needed-by date only drives urgency until the proposal goes out to the customer. */
const PROPOSAL_PRE_SEND = ['PROPOSAL_REQUESTED', 'UNDER_PREPARATION', 'READY_FOR_REVIEW', 'APPROVED'];
const SORT_FIELDS = [
  { key: 'updated_at', label: 'Recently updated' },
  { key: 'request_date', label: 'Request date' },
  { key: 'required_date', label: 'Required date' },
  { key: 'sent_date', label: 'Sent date' },
  { key: 'next_followup', label: 'Next follow-up' },
  { key: 'proposal_number', label: 'Proposal no.' },
];


/** Proposals fetched per request while the register scrolls. */
const PROPOSALS_PAGE_SIZE = 25;

// Follow-up menu key → the flag the API filters on (ProposalQueryDto).
const FOLLOWUP_FILTER_FLAGS: Record<string, string> = {
  overdue: 'overdue',
  due_today: 'due_today',
  upcoming: 'upcoming',
  no_followup: 'without_follow_up',
  old_inactivity: 'stale',
};
// Date-field choice → the API's `from_<x>` / `to_<x>` range params.
const DATE_RANGE_PARAMS: Record<string, string> = {
  request_date: 'request_date',
  required_date: 'required_date',
  sent_date: 'sent_date',
  next_followup: 'next_follow_up',
};

export default function ProposalsPage() {
  const { user } = useAuth();
  const router = useRouter();

  // (the proposals register itself is useInfiniteList below, paged as the reader scrolls)

  // Dashboard Stats
  const [stats, setStats] = useState<any>({
    total_proposals: 0,
    proposal_requested: 0,
    pending_preparation: 0,
    ready_for_review: 0,
    approved: 0,
    sent_to_customer: 0,
    followup_required: 0,
    converted: 0,
    closed: 0,
    lost: 0,
    due_today: 0,
    overdue: 0,
    no_followup: 0,
    old_no_movement: 0,
  });

  // Reference data
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  // Proposal settings (follow-up cadence and horizon, reopen window, closure reasons); defaults until loaded.
  const [proposalSettings, setProposalSettings] = useState<any>(null);
  const followUpHorizonDays = Number(proposalSettings?.max_follow_up_horizon_days) || 90;
  const defaultFollowUpDays = Number(proposalSettings?.default_follow_up_days) || 3;
  const reopenWindowDays = Number(proposalSettings?.reopen_window_days) || 30;
  const closureReasons: string[] =
    Array.isArray(proposalSettings?.closure_reason_codes) && proposalSettings.closure_reason_codes.length
      ? proposalSettings.closure_reason_codes
      : PROPOSAL_CLOSURE_REASONS;

  // Filter & Sort States
  const [search, setSearch] = useState('');
  // The register and KPI cards query the search text once typing pauses, not on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedFollowupCondition, setSelectedFollowupCondition] = useState<string>('all');
  const [selectedResponsibleId, setSelectedResponsibleId] = useState<string>('');
  const [selectedFollowupOwnerId, setSelectedFollowupOwnerId] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [dateField, setDateField] = useState<string>('request_date');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [activeHudCard, setActiveHudCard] = useState<string | null>(null);

  // Modals & Active Proposal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<any | null>(null);
  // Detail loads that finish after the reader moved on to another proposal are discarded.
  const detailRequest = useRef(0);
  const focusedProposalId = useRef<string | null>(null);
  const focusProposal = (p: any) => {
    focusedProposalId.current = p?.id ?? null;
    setSelectedProposal(p);
  };
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'followups' | 'history' | 'linked'>('overview');
  const [followups, setFollowups] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  // Edit & Delete Dialogs
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    required_date: '',
    reference: '',
    remarks: '',
    responsible_id: '',
    followup_owner_id: '',
    required_date_change_reason: '',
    lead_id: '',
    ...EMPTY_COMMERCIAL,
  });
  // The form as opened, so Save sends only what the user changed (never blanks for fields it did not touch).
  const editInitial = useRef<typeof editForm | null>(null);
  // Open leads of the customer, for the "Source lead" pickers (DEF-081)
  const [leadOptions, setLeadOptions] = useState<any[]>([]);
  const [leadOptionsFor, setLeadOptionsFor] = useState<string>('');
  const leadRequest = useRef(0);
  const [pageError, setPageError] = useState<string | null>(null);

  // Action dialogs
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [statusForm, setStatusForm] = useState({
    sent_date: istToday(),
    lost_reason: '' as ProposalLostReason | '',
    lost_remarks: '',
    converted_to: '',
    converted_reference: '',
    reference: '',
    remarks: '',
    next_followup: '',
    follow_up_owner_id: '',
    closure_reason_code: '',
  });

  // Moving a reviewed / approved / sent quote back to preparation needs a reason the preparer can act on.
  const currentLane = proposalLaneOf(selectedProposal?.status);
  const isRequestChanges = targetStatus === 'UNDER_PREPARATION' && currentLane === 'READY_FOR_REVIEW';
  const isBackToPreparation = targetStatus === 'UNDER_PREPARATION' && currentLane !== 'PROPOSAL_REQUESTED';
  const isInternalRevision = targetStatus === 'UNDER_PREPARATION' && currentLane === 'APPROVED';
  const isCustomerRevision = targetStatus === 'UNDER_PREPARATION' && SENT_LANES.includes(currentLane);
  // Reopening a concluded proposal (POST /:id/reopen — the server restores the stage it was in before).
  const isReopen = targetStatus === 'REQUESTED';
  const needsReason = isBackToPreparation || targetStatus === 'CLOSED' || isReopen;

  const [isFollowupDialogOpen, setIsFollowupDialogOpen] = useState(false);
  const [followupForm, setFollowupForm] = useState({
    followup_date: istToday(),
    owner_id: '',
    remarks: '',
    outcome: '',
    next_followup_date: '',
    postpone_reason: '',
  });
  // A next follow-up beyond the horizon (90 days by default) needs a documented reason (server E37).
  const needsPostponeReason = Boolean(
    followupForm.next_followup_date && followupForm.next_followup_date > addIsoDays(istToday(), followUpHorizonDays),
  );

  // Form Submission
  const [newProposal, setNewProposal] = useState({
    organisation_id: '',
    product_id: '',
    sector: 'Defence',
    responsible_id: '',
    request_date: istToday(),
    required_date: addIsoDays(istToday(), 7),
    reference: '',
    followup_owner_id: '',
    next_followup: '',
    remarks: '',
    lead_id: '',
    ...EMPTY_COMMERCIAL,
  });

  const [formError, setFormError] = useState<string | null>(null);
  // Server refusals are shown inside the open dialog (never alert() / silent failure).
  const [statusError, setStatusError] = useState<string | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ detected: boolean; message: string; proposalNo?: string } | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const resetCreateForm = () => {
    setNewProposal({
      organisation_id: '',
      product_id: '',
      sector: 'Defence',
      responsible_id: '',
      request_date: istToday(),
      required_date: addIsoDays(istToday(), 7),
      reference: '',
      followup_owner_id: '',
      next_followup: '',
      remarks: '',
      lead_id: '',
      ...EMPTY_COMMERCIAL,
    });
    setFormError(null);
    setDuplicateWarning(null);
    setDuplicateOverrideReason('');
  };

  // Auto-dismiss success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Fetch Reference Masters (Organisations, Products, Users)
  const fetchMasters = async () => {
    try {
      const [orgsRes, prodsRes, usersRes, settingsRes] = await Promise.all([
        api.get('/organisations', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/products').catch(() => []),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/proposals/settings').catch(() => null),
      ]);

      setOrganisations(orgsRes.data || []);
      setProducts(Array.isArray(prodsRes) ? prodsRes : prodsRes.data || []);
      setUsers(usersRes.data || []);
      setProposalSettings(settingsRes);
    } catch (err) {
      console.error('Failed to load masters:', err);
    }
  };

  // Active filters as API query params — shared by the register and the KPI cards so both count the same rows.
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (selectedStatus && selectedStatus !== 'all') params.status = selectedStatus;
    if (selectedSector && selectedSector !== 'all') params.sector = selectedSector;
    const followupFlag = FOLLOWUP_FILTER_FLAGS[selectedFollowupCondition];
    if (followupFlag) params[followupFlag] = 'true';
    if (selectedResponsibleId) params.responsible_id = selectedResponsibleId;
    if (selectedFollowupOwnerId) params.followup_owner_id = selectedFollowupOwnerId;
    const dateParam = DATE_RANGE_PARAMS[dateField] || 'request_date';
    if (fromDate) params[`from_${dateParam}`] = fromDate;
    if (toDate) params[`to_${dateParam}`] = toDate;
    return params;
  }, [
    debouncedSearch,
    selectedStatus,
    selectedSector,
    selectedFollowupCondition,
    selectedResponsibleId,
    selectedFollowupOwnerId,
    dateField,
    fromDate,
    toDate,
  ]);

  // Fetch Dashboard Stats for the active filters (answers to superseded filters are discarded)
  const statsRequest = useRef(0);
  const fetchStats = useCallback(async () => {
    const req = ++statsRequest.current;
    try {
      const res = await api.get('/proposals/dashboard', filterParams);
      if (res && req === statsRequest.current) setStats(res);
    } catch (err) {
      console.error('Failed to load proposal stats:', err);
    }
  }, [filterParams]);

  // Proposals register with complete multi-column filters and sorting, one page per request,
  // appended as the register scrolls. `fetchProposals` re-reads the pages already loaded, in place.
  const fetchProposalsPage = useCallback(
    (page: number) =>
      api.get('/proposals', {
        ...filterParams,
        page,
        limit: PROPOSALS_PAGE_SIZE,
        sort_by: sortBy,
        sort_order: sortOrder,
      }),
    [filterParams, sortBy, sortOrder],
  );
  const proposalsList = useInfiniteList<any>(fetchProposalsPage);
  const { rows: proposals, total, loading: isLoading, refresh: fetchProposals } = proposalsList;

  // Initial load
  useEffect(() => {
    fetchMasters();
  }, []);

  // Search text reaches the register and the KPI cards 300 ms after typing stops (one request, not one per keystroke).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // KPI cards follow the active filters; debounced so a burst of filter changes fires once.
  useEffect(() => {
    const timer = setTimeout(fetchStats, 300);
    return () => clearTimeout(timer);
  }, [fetchStats]);

  // Real-time Event-Driven Architecture (EDA) live synchronization via Socket.IO
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleRealtimeProposalEvent = () => {
      fetchProposals();
      fetchStats();
    };

    socket.on('proposal:created', handleRealtimeProposalEvent);
    socket.on('proposal:updated', handleRealtimeProposalEvent);
    socket.on('proposal:approved', handleRealtimeProposalEvent);
    socket.on('proposal:sent', handleRealtimeProposalEvent);
    socket.on('proposal:followup_added', handleRealtimeProposalEvent);
    socket.on('proposal:outcome', handleRealtimeProposalEvent);
    socket.on('proposal:overdue_alert', handleRealtimeProposalEvent);

    return () => {
      socket.off('proposal:created', handleRealtimeProposalEvent);
      socket.off('proposal:updated', handleRealtimeProposalEvent);
      socket.off('proposal:approved', handleRealtimeProposalEvent);
      socket.off('proposal:sent', handleRealtimeProposalEvent);
      socket.off('proposal:followup_added', handleRealtimeProposalEvent);
      socket.off('proposal:outcome', handleRealtimeProposalEvent);
      socket.off('proposal:overdue_alert', handleRealtimeProposalEvent);
    };
  }, [fetchProposals, fetchStats]);

  // Deep link from notifications: /proposals?open=<proposal id>
  useOpenParam(async (id) => {
    const req = ++detailRequest.current;
    try {
      const proposal = await api.get(`/proposals/${id}`);
      if (req !== detailRequest.current) return;
      focusedProposalId.current = proposal?.id ?? null;
      applyProposal(proposal);
      setDetailsTab('overview');
      setIsDetailsOpen(true);
    } catch (err: any) {
      if (req === detailRequest.current) setPageError(err?.message || 'That proposal could not be opened');
    }
  });

  // Deep link from dashboard cards: /proposals?status=<status code>
  useOpenParam((status) => pickStatus(status), true, 'status');

  /** The full record (findOne) carries its follow-ups and status history, so the tab counts are right at once. */
  const applyProposal = (full: any) => {
    if (!full) return;
    setSelectedProposal(full);
    if (Array.isArray(full.followups)) setFollowups(full.followups);
    if (Array.isArray(full.history)) setActivities(full.history);
  };

  // Fetch proposal details, follow-ups, and history. An answer for a proposal the reader has since left is dropped.
  const openProposalDetails = async (proposal: any) => {
    const req = ++detailRequest.current;
    focusProposal(proposal);
    setFollowups([]);
    setActivities([]);
    setIsDetailsOpen(true);
    setDetailsTab('overview');

    const current = () => req === detailRequest.current && focusedProposalId.current === proposal.id;
    try {
      const full = await api.get(`/proposals/${proposal.id}`);
      if (current()) applyProposal(full);
    } catch (err: any) {
      if (current()) setPageError(err?.message || 'Failed to load proposal details');
    }
  };

  const loadLeadOptions = useCallback(async (customerId: string): Promise<any[]> => {
    // Only the latest customer's answer fills the picker (a slower earlier lookup must not overwrite it).
    const req = ++leadRequest.current;
    setLeadOptionsFor(customerId);
    setLeadOptions([]);
    if (!customerId) return [];
    try {
      const rows = await api.get('/proposals/lookups/leads', { customer_id: customerId });
      const list = Array.isArray(rows) ? rows : [];
      if (req === leadRequest.current) setLeadOptions(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // Open Edit Proposal Dialog — always from the full record: register rows do not carry every field, and a form
  // filled from a partial row would save blanks over the stored values (payment / delivery terms).
  const openEditProposal = async (proposal: any) => {
    let full = proposal;
    if (!Array.isArray(proposal?.followups)) {
      const req = ++detailRequest.current;
      focusedProposalId.current = proposal.id;
      try {
        full = await api.get(`/proposals/${proposal.id}`);
      } catch (err: any) {
        if (req === detailRequest.current) setPageError(err?.message || 'That proposal could not be opened for editing');
        return;
      }
      if (req !== detailRequest.current || focusedProposalId.current !== proposal.id) return;
      applyProposal(full);
    } else {
      focusProposal(full);
    }
    const form = {
      required_date: full.required_date ? proposalDay(full.required_date) : '',
      reference: full.reference || '',
      remarks: full.remarks || '',
      responsible_id: full.responsible_id || full.responsible_person_id || '',
      followup_owner_id: full.followup_owner_id || full.follow_up_owner_id || '',
      required_date_change_reason: '',
      lead_id: full.lead_id || '',
      quoted_value: numInput(full.quoted_value),
      quantity: numInput(full.quantity),
      margin_percent: numInput(full.margin_percent),
      validity_date: full.validity_date ? proposalDay(full.validity_date) : '',
      payment_terms: full.payment_terms || '',
      delivery_terms: full.delivery_terms || '',
    };
    editInitial.current = form;
    setEditForm(form);
    setEditError(null);
    setIsEditOpen(true);
    loadLeadOptions(full.customer_id || full.organisation_id || '');
  };

  // Submit Edit Proposal
  const handleEditProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    setEditError(null);
    const termsError = commercialError(editForm);
    if (termsError) {
      setEditError(termsError);
      return;
    }
    try {
      setIsSubmitting(true);
      const initial = editInitial.current;
      const payload: any = {
        required_date: editForm.required_date,
        responsible_id: editForm.responsible_id || undefined,
        followup_owner_id: editForm.followup_owner_id || undefined,
        required_date_change_reason: editForm.required_date_change_reason.trim() || undefined,
        lead_id: editForm.lead_id || null,
      };
      // Text the user changed is sent as typed — '' clears the reference / remarks on the server.
      if (!initial || editForm.reference !== initial.reference) payload.reference = editForm.reference.trim();
      if (!initial || editForm.remarks !== initial.remarks) payload.remarks = editForm.remarks.trim();
      // Commercial terms: only the fields that changed, so an untouched term is never overwritten.
      const terms = commercialPayload(editForm);
      const termsBefore = initial ? commercialPayload(initial) : null;
      (Object.keys(terms) as (keyof typeof terms)[]).forEach((k) => {
        if (!termsBefore || terms[k] !== termsBefore[k]) payload[k] = terms[k];
      });
      const updated = await api.patch(`/proposals/${selectedProposal.id}`, payload);
      applyProposal(updated);
      setIsEditOpen(false);
      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      setEditError(err?.message || 'Failed to update proposal details');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Proposal (Soft Delete)
  const handleDeleteProposal = async () => {
    if (!selectedProposal) return;
    setDeleteError(null);
    try {
      setIsSubmitting(true);
      await api.delete(`/proposals/${selectedProposal.id}`);
      setIsDeleteConfirmOpen(false);
      setIsDetailsOpen(false);
      setSelectedProposal(null);
      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete proposal');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset Filters
  const handleClearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedStatus('all');
    setSelectedSector('all');
    setSelectedFollowupCondition('all');
    setSelectedResponsibleId('');
    setSelectedFollowupOwnerId('');
    setSortBy('updated_at');
    setSortOrder('desc');
    setFromDate('');
    setToDate('');
    setActiveHudCard(null);
  };

  // Create Proposal Submission
  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 1. Comprehensive Field Validations
    if (!newProposal.organisation_id?.trim()) {
      setFormError('Please select a customer organisation');
      return;
    }
    if (!newProposal.product_id?.trim()) {
      setFormError('Please select a product');
      return;
    }
    if (!newProposal.sector?.trim()) {
      setFormError('Please select a sector / department');
      return;
    }
    if (!newProposal.responsible_id?.trim()) {
      setFormError('Please assign a responsible proposal person');
      return;
    }
    if (!newProposal.request_date) {
      setFormError('Request date is required');
      return;
    }
    const todayStr = istToday();

    if (newProposal.request_date > todayStr) {
      setFormError('Request date cannot be in the future');
      return;
    }
    if (!newProposal.required_date) {
      setFormError('Required completion date is required');
      return;
    }
    if (newProposal.required_date < newProposal.request_date) {
      setFormError('Required completion date cannot be before request date');
      return;
    }
    if (newProposal.validity_date && newProposal.validity_date < newProposal.request_date) {
      setFormError('Quote valid-until date cannot be before the request date');
      return;
    }
    if (newProposal.next_followup && isNaN(Date.parse(newProposal.next_followup))) {
      setFormError('Initial follow-up date must be a valid date');
      return;
    }
    const termsError = commercialError(newProposal);
    if (termsError) {
      setFormError(termsError);
      return;
    }
    if (duplicateWarning && !duplicateOverrideReason?.trim()) {
      setFormError('Please provide a reason to override the duplicate proposal detection.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload: any = {
        organisation_id: newProposal.organisation_id.trim(),
        product_id: newProposal.product_id.trim(),
        sector: newProposal.sector.trim(),
        responsible_id: newProposal.responsible_id.trim(),
        followup_owner_id: (newProposal.followup_owner_id || newProposal.responsible_id).trim(),
        request_date: newProposal.request_date,
        required_date: newProposal.required_date,
        ...commercialPayload(newProposal),
      };
      // Source lead: an explicit choice, or "none" ('' → null). Untouched picker with no options lets the server
      // link the customer's only open lead.
      if (newProposal.lead_id) payload.lead_id = newProposal.lead_id;
      else if (leadOptionsFor === newProposal.organisation_id && leadOptions.length > 0) payload.lead_id = null;

      if (newProposal.reference?.trim()) payload.reference = newProposal.reference.trim();
      if (newProposal.next_followup?.trim()) payload.next_followup = newProposal.next_followup.trim();
      if (newProposal.remarks?.trim()) payload.remarks = newProposal.remarks.trim();
      if (duplicateOverrideReason?.trim()) payload.duplicate_override_reason = duplicateOverrideReason.trim();

      const created = await api.post('/proposals', payload);
      const quoteNo = created?.proposal_number || created?.proposal_no || 'New Quote';

      setIsCreateOpen(false);
      resetCreateForm();
      setSuccessMessage(`Proposal ${quoteNo} has been successfully registered and listed under Commercial Price Quotes.`);

      // Reset filters so the newly created proposal is immediately listed
      setSelectedStatus('all');
      setSelectedFollowupCondition('all');
      setSearch('');
      setDebouncedSearch('');

      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      const isDuplicate =
        err?.data?.duplicate_detected ||
        err?.status === 409 ||
        (typeof err?.message === 'string' && err.message.toLowerCase().includes('duplicate'));

      if (isDuplicate) {
        setDuplicateWarning({
          detected: true,
          message: err?.message || 'A similar proposal was already registered for this customer and product within the duplicate detection window.',
          proposalNo: err?.data?.existing_proposal_no,
        });
        setFormError(err?.message || 'Duplicate proposal detected. Provide an override reason below to proceed.');
      } else {
        setFormError(err.message || 'Failed to create proposal request');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Trigger Status Transition Dialog. The proposal is passed explicitly: a card / board action sets the selection in
  // the same tick, so reading `selectedProposal` here would prefill from the previously opened proposal.
  const initiateStatusChange = (nextStatus: string, proposal: any = selectedProposal) => {
    const today = istToday();
    // Mark Sent schedules the first follow-up: keep the date on record if it is still ahead, else the default cadence.
    const nextOnRecord = proposalDay(proposal?.next_follow_up_date || proposal?.next_followup);
    setTargetStatus(nextStatus);
    setStatusError(null);
    setStatusForm({
      sent_date: today,
      lost_reason: '' as ProposalLostReason | '',
      lost_remarks: '',
      converted_to: '',
      converted_reference: '',
      // Mark Sent needs the email / dispatch reference the quote went out under; start from the one on record.
      reference: proposal?.email_reference || proposal?.reference || '',
      remarks: '',
      next_followup: nextOnRecord && nextOnRecord >= today ? nextOnRecord : addIsoDays(today, defaultFollowUpDays),
      follow_up_owner_id: currentOwnerOf(proposal) || proposal?.responsible_person_id || proposal?.responsible_id || user?.id || '',
      closure_reason_code: '',
    });
    setIsStatusDialogOpen(true);
  };

  // Execute Status Transition
  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    setStatusError(null);

    if ((targetStatus === 'READY_FOR_REVIEW' || targetStatus === 'APPROVED') && !hasQuote(selectedProposal)) {
      setStatusError(
        targetStatus === 'APPROVED'
          ? 'This proposal has no quoted value. Pricing must be entered (Edit → Commercial terms) before it can be approved.'
          : 'Enter the quoted value (₹) under Edit → Commercial terms before submitting for review.',
      );
      return;
    }
    if (isBackToPreparation && !statusForm.remarks.trim()) {
      setStatusError(
        isRequestChanges
          ? 'Explain the changes you need — the comment is sent to the preparer.'
          : isCustomerRevision
            ? 'Describe the revision the customer asked for.'
            : 'Give the reason for sending this proposal back to preparation.',
      );
      return;
    }
    if (isReopen && !statusForm.remarks.trim()) {
      setStatusError('Give the reason for reopening this proposal.');
      return;
    }

    // The outcome must be recorded, never defaulted (E28 / E29, PRD §30 "proposal outcome").
    if (targetStatus === 'LOST' && (!statusForm.lost_reason || !statusForm.lost_remarks.trim())) {
      setStatusError('Choose the lost reason and explain what happened (competitor, price gap, customer decision).');
      return;
    }
    if (targetStatus === 'CLOSED' && (!statusForm.closure_reason_code || !statusForm.remarks.trim())) {
      setStatusError('Choose the closure reason and explain why this proposal is being closed.');
      return;
    }
    if (targetStatus === 'CONVERTED' && !statusForm.converted_reference.trim()) {
      setStatusError('Enter the PO / supply order / GeM contract number this proposal was won on.');
      return;
    }

    if (targetStatus === 'SENT_TO_CUSTOMER') {
      // Mirror the server guard on IST calendar days: today (IST) is always allowed, even just after midnight.
      const today = istToday();
      const requestDay = proposalDay(selectedProposal.request_date);
      if (!statusForm.sent_date) {
        setStatusError('Sent date is required');
        return;
      }
      if (statusForm.sent_date > today) {
        setStatusError(`Sent date cannot be in the future (today is ${today} IST)`);
        return;
      }
      if (requestDay && statusForm.sent_date < requestDay) {
        setStatusError(`Sent date cannot be earlier than the proposal request date (${requestDay})`);
        return;
      }
      if (!statusForm.reference.trim()) {
        setStatusError('Enter the email or dispatch reference the quote was sent under.');
        return;
      }
      if (!statusForm.follow_up_owner_id) {
        setStatusError('Choose who follows up with the customer.');
        return;
      }
      if (!statusForm.next_followup) {
        setStatusError('Set the next follow-up date.');
        return;
      }
      if (statusForm.next_followup < statusForm.sent_date) {
        setStatusError(`Next follow-up date cannot be earlier than the sent date (${statusForm.sent_date})`);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      let updated: any;
      if (isReopen) {
        // /status refuses REQUESTED; reopening has its own endpoint (management / admin, within the reopen window).
        updated = await api.post(`/proposals/${selectedProposal.id}/reopen`, { reopen_reason: statusForm.remarks.trim() });
      } else {
        const payload: any = { status: targetStatus };

        if (targetStatus === 'SENT_TO_CUSTOMER') {
          payload.sent_date = statusForm.sent_date;
          payload.reference = statusForm.reference.trim();
          payload.next_followup = statusForm.next_followup;
          payload.follow_up_owner_id = statusForm.follow_up_owner_id;
        } else if (targetStatus === 'LOST') {
          payload.lost_reason = statusForm.lost_reason;
          payload.lost_remarks = statusForm.lost_remarks;
        } else if (targetStatus === 'CONVERTED') {
          payload.converted_to = statusForm.converted_to || 'Purchase Order';
          payload.converted_reference = statusForm.converted_reference.trim();
        } else if (targetStatus === 'CLOSED') {
          payload.closure_reason_code = statusForm.closure_reason_code;
        }
        if (statusForm.remarks.trim()) payload.remarks = statusForm.remarks.trim();

        updated = await api.patch(`/proposals/${selectedProposal.id}/status`, payload);
      }
      applyProposal(updated);
      setIsStatusDialogOpen(false);

      // Refresh listings & details
      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      setStatusError(err?.message || 'Failed to update proposal status');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add Follow-up
  const handleAddFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    setFollowupError(null);
    if (!followupForm.owner_id) {
      setFollowupError('Choose the follow-up owner.');
      return;
    }
    if (needsPostponeReason && !followupForm.postpone_reason.trim()) {
      setFollowupError(`A follow-up more than ${followUpHorizonDays} days out needs a reason.`);
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await api.post(`/proposals/${selectedProposal.id}/follow-ups`, {
        followup_date: followupForm.followup_date,
        // The chosen owner takes over the proposal's follow-ups (the server validates and audits the change).
        owner_id: followupForm.owner_id,
        remarks: followupForm.remarks,
        outcome: followupForm.outcome || undefined,
        next_followup_date: followupForm.next_followup_date || undefined,
        postpone_reason: needsPostponeReason ? followupForm.postpone_reason.trim() : undefined,
      });

      applyProposal(res?.proposal || res);
      setIsFollowupDialogOpen(false);

      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      setFollowupError(err?.message || 'Failed to log follow-up');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Copy Proposal Number
  const copyProposalNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedId(num);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Status Badge Helper
  const renderStatusBadge = (status: string) => {
    const s = status?.toUpperCase();
    const label = PROPOSAL_STATUS_LABELS[status] || status;

    switch (s) {
      case 'PROPOSAL_REQUESTED':
        return <Badge variant="default" hasDot>{label}</Badge>;
      case 'UNDER_PREPARATION':
        return <Badge variant="info" hasDot>{label}</Badge>;
      case 'READY_FOR_REVIEW':
        return <Badge variant="warning" hasDot>{label}</Badge>;
      case 'APPROVED':
        return <Badge variant="success" hasDot>{label}</Badge>;
      case 'SENT_TO_CUSTOMER':
        return <Badge variant="cyber" hasDot>{label}</Badge>;
      case 'FOLLOW_UP_REQUIRED':
        return <Badge variant="warning" hasDot>{label}</Badge>;
      case 'CONVERTED':
        return <Badge variant="success" hasDot>{label}</Badge>;
      case 'CLOSED':
        return <Badge variant="outline">{label}</Badge>;
      case 'LOST':
        return <Badge variant="danger" hasDot>{label}</Badge>;
      default:
        return <Badge variant="default">{label}</Badge>;
    }
  };

  // Lifecycle Stages definition for the visual stepper
  // PRD §29 workflow, in order.
  const STAGES = [
    { key: 'PROPOSAL_REQUESTED', label: 'Proposal Requested', desc: 'Request logged with customer, product and required date' },
    { key: 'UNDER_PREPARATION', label: 'Under Preparation', desc: 'Responsible person preparing the proposal' },
    { key: 'READY_FOR_REVIEW', label: 'Ready for Review', desc: 'Submitted for internal review' },
    { key: 'APPROVED', label: 'Approved', desc: 'Cleared to send to the customer' },
    { key: 'SENT_TO_CUSTOMER', label: 'Sent to Customer', desc: 'Sent date, email / reference and follow-up owner recorded' },
    { key: 'FOLLOW_UP_REQUIRED', label: 'Follow-up Required', desc: 'Salesperson owns the follow-up' },
    { key: 'CONVERTED', label: 'Converted / Closed / Lost', desc: 'Proposal outcome recorded' },
  ];

  const getStageIndex = (status: string) => {
    const s = status?.toUpperCase();
    if (s === 'PROPOSAL_REQUESTED') return 0;
    if (s === 'UNDER_PREPARATION') return 1;
    if (s === 'READY_FOR_REVIEW') return 2;
    if (s === 'APPROVED') return 3;
    if (s === 'SENT_TO_CUSTOMER') return 4;
    if (s === 'FOLLOW_UP_REQUIRED') return 5;
    if (['CONVERTED', 'CLOSED', 'LOST'].includes(s)) return 6;
    return 0;
  };

  // Sectors list
  const SECTORS = [
    'Defence',
    'Police / Paramilitary',
    'Healthcare',
    'Infrastructure',
    'Private Security',
    'Government',
    'Aviation',
    'Corporate',
  ];

  // Pipeline strip + filter row helpers
  const headlineCards: { key: string; label: string; count: number; subtext: string; icon: React.ReactNode; kind: 'status' | 'followup'; value: string; color?: 'primary' | 'amber' | 'rose' | 'emerald' }[] = [
    // PRD §28 register + the four §30 follow-up highlights.
    { key: 'all', label: 'Proposal Register', count: stats.total_proposals || 0, subtext: 'All proposal requests', icon: <FileSpreadsheet className="h-4 w-4 text-[#0F5E63]" />, kind: 'status', value: 'all' },
    { key: 'no_followup', label: 'Without Follow-up', count: stats.no_followup || 0, subtext: 'Sent, no follow-up scheduled', icon: <Bell className="h-4 w-4 text-[#9A3412]" />, kind: 'followup', value: 'no_followup', color: 'amber' },
    { key: 'due_today', label: 'Follow-ups Due Today', count: stats.due_today || 0, subtext: `${stats.overdue || 0} overdue`, icon: <CalendarDays className="h-4 w-4 text-[#881337]" />, kind: 'followup', value: 'due_today', color: 'rose' },
    { key: 'old_inactivity', label: 'Old, No Movement', count: stats.old_no_movement || 0, subtext: 'Open, no activity for 7+ days', icon: <Clock className="h-4 w-4 text-[#9A3412]" />, kind: 'followup', value: 'old_inactivity', color: 'amber' },
    { key: 'outcome', label: 'Proposal Outcome', count: stats.converted || 0, subtext: `Converted · ${stats.lost || 0} lost · ${stats.closed || 0} closed`, icon: <CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />, kind: 'status', value: 'CONVERTED', color: 'emerald' },
  ];
  const pickStatus = (status: string) => {
    setSelectedStatus(status);
    setActiveHudCard(null);
  };
  const pickFollowup = (key: string) => {
    setSelectedFollowupCondition((cur: string) => (cur === key ? 'all' : key));
    setActiveHudCard(null);
  };
  const hasActiveFilters = Boolean(
    search || selectedStatus !== 'all' || selectedSector !== 'all' || selectedFollowupCondition !== 'all' || selectedResponsibleId || selectedFollowupOwnerId || fromDate || toDate,
  );

  // Register rows → RecordItems (cards / stage board). Actions mirror the detail modal's workflow buttons.
  const openFollowupFor = (p: any, keepNextDate = true) => {
    focusProposal(p);
    setFollowupForm({
      followup_date: istToday(),
      owner_id: currentOwnerOf(p) || user?.id || '',
      remarks: '',
      outcome: '',
      next_followup_date: keepNextDate && p.next_followup ? proposalDay(p.next_followup) : '',
      postpone_reason: '',
    });
    setFollowupError(null);
    setIsFollowupDialogOpen(true);
  };
  const statusActionFor = (p: any, nextStatus: string) => () => {
    focusProposal(p);
    initiateStatusChange(nextStatus, p);
  };
  // Actions follow the server's allowed_transitions / can_edit for this user (DEF-008): a colleague's proposal is
  // view-only for sales, terminal proposals are read-only for everyone.
  const primaryFor = (p: any): RecordItem['primary'] => {
    switch (proposalLaneOf(p.status)) {
      case 'PROPOSAL_REQUESTED':
        return canMove(p, 'UNDER_PREPARATION') ? { label: 'Start preparation', onClick: statusActionFor(p, 'UNDER_PREPARATION') } : undefined;
      case 'UNDER_PREPARATION':
        return canMove(p, 'READY_FOR_REVIEW') ? { label: 'Submit for review', onClick: statusActionFor(p, 'READY_FOR_REVIEW') } : undefined;
      case 'READY_FOR_REVIEW': {
        // The server decides the approver by value band: Management for major proposals, the region's RM otherwise.
        if (canMove(p, 'APPROVED')) return { label: 'Approve proposal', onClick: statusActionFor(p, 'APPROVED') };
        const approver = p.approval_band === 'regional' ? 'Regional Manager' : 'Management';
        const isParty = Boolean(
          user &&
            [p.created_by_id, p.created_by, p.requested_by_id, p.requested_by, p.responsible_person_id, p.responsible_id].includes(user.id),
        );
        const approverRole = p.approval_band === 'regional' ? 'regional_manager' : 'management';
        if (isParty && (user?.role === approverRole || user?.role === 'admin')) return { label: 'Self-approval not allowed', disabled: true };
        return { label: `Awaiting ${approver} approval`, disabled: true };
      }
      case 'APPROVED':
        return canMove(p, 'SENT_TO_CUSTOMER') ? { label: 'Send to Customer', onClick: statusActionFor(p, 'SENT_TO_CUSTOMER') } : undefined;
      case 'SENT_TO_CUSTOMER':
      case 'FOLLOW_UP_REQUIRED':
        return canEditProposal(p) ? { label: 'Log follow-up', onClick: () => openFollowupFor(p) } : undefined;
      case 'CONVERTED':
        // DEF-070: hand the converted quote to logistics (pre-filled dispatch form)
        return canOpen(user?.role, '/deliveries')
          ? { label: 'Create dispatch', onClick: () => router.push(`/deliveries?proposal=${p.id}`) }
          : undefined;
      default:
        return undefined;
    }
  };
  const todayIst = istToday();
  const laneByKey = new Map<string, string>();
  const recordItems: RecordItem[] = proposals.map((p) => {
    const upper = String(p.status || '').toUpperCase();
    const lane = proposalLaneOf(p.status);
    laneByKey.set(String(p.id), lane);
    const closed = ['CONVERTED', 'CLOSED', 'LOST'].includes(lane);
    const nextFollowupStr = p.next_followup ? proposalDay(p.next_followup) || null : null;
    const requiredStr = p.required_date ? proposalDay(p.required_date) || null : null;
    const isOverdue = Boolean(nextFollowupStr && nextFollowupStr < todayIst && !closed);
    const fmt = (d?: string | null) => (d ? formatDateIN(d) : '—');
    const badges: RecordItem['badges'] = [];
    if (p.is_urgent && !closed) badges.push({ label: 'Urgent', tone: 'danger' });
    if (isOverdue) badges.push({ label: 'Follow-up overdue', tone: 'danger' });
    if (!nextFollowupStr && ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'].includes(lane)) badges.push({ label: 'Follow-up not scheduled', tone: 'warning' });
    if (p.sent_late) badges.push({ label: 'Sent late', tone: 'warning' });
    if (lane === 'READY_FOR_REVIEW') badges.push({ label: p.approval_band === 'regional' ? 'RM approval' : 'Management approval', tone: 'info' });
    const primary = primaryFor(p);
    // Edit only where the viewer may change it; follow-ups only once the quote has gone out (DEF-079 / DEF-080).
    const quick: RecordItem['quick'] = canEditProposal(p) ? [{ label: `Edit ${p.proposal_number || 'proposal'}`, icon: <Edit2 />, onClick: () => openEditProposal(p) }] : [];
    return {
      key: String(p.id),
      code: p.proposal_number,
      title: p.organisation_name || 'Unknown customer',
      subtitle: [p.product_name, p.sector || 'General'].filter(Boolean).join(' · '),
      status: { label: PROPOSAL_STATUS_LABELS[p.status] || p.status, tone: toneFor(PROPOSAL_STATUS_LABELS[p.status] || p.status) },
      badges,
      due: nextFollowupStr ? { date: nextFollowupStr, label: 'Follow-up', done: closed } : { date: requiredStr, label: 'Needed by', done: closed },
      owner: p.responsible_name || 'Unassigned',
      facts: [
        { label: 'Needed by', value: <span className="font-mono">{fmt(p.required_date)}</span> },
        upper === 'LOST' && p.lost_reason
          ? { label: 'Lost reason', value: p.lost_reason }
          : p.sent_date
            ? { label: 'Sent', value: <span className="font-mono">{fmt(p.sent_date)}</span> }
            : { label: 'Version', value: <span className="font-mono">{p.version || 'v1.0'}</span> },
        { label: 'Follow-up by', value: p.followup_owner_name || p.responsible_name || '—' },
        ...(p.reference ? [{ label: 'Email ref.', value: p.reference }] : []),
      ],
      primary,
      quick,
      onOpen: () => openProposalDetails(p),
    };
  });

  // List view: the register's own table — same rows, same order as recordItems (recordItems[i] is proposals[i]).
  const proposalList = proposals.length ? (
    <RecordTable items={recordItems}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Proposal No.</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Sector</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Requested By</TableHead>
            <TableHead>Responsible</TableHead>
            <TableHead>Request Date</TableHead>
            <TableHead>Required Date</TableHead>
            <TableHead>Sent Date</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Follow-up Owner</TableHead>
            <TableHead>Next Follow-up</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.map((p: any, i: number) => {
            const primary = recordItems[i]?.primary;
            const lane = proposalLaneOf(p.status);
            const closed = ['CONVERTED', 'CLOSED', 'LOST'].includes(lane);
            const daysLeft = PROPOSAL_PRE_SEND.includes(lane) ? daysFromToday(p.required_date) : null;
            const followupDays = closed ? null : daysFromToday(p.next_followup);
            return (
              <TableRow key={p.id}>
                <TableCell className="font-bold text-[#14213D] whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{p.proposal_number}</span>
                  {p.reference && (
                    <div className="text-[10px] text-[#4A5568] font-normal max-w-[140px] truncate" title={p.reference}>
                      ref: {p.reference}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-bold text-[#14213D]">
                  {p.organisation_name || 'Unknown customer'}
                  {placeText(p.organisation_city, p.organisation_state) && (
                    <div className="text-[10px] text-[#4A5568] font-normal">{placeText(p.organisation_city, p.organisation_state)}</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant="outline" size="sm" className="uppercase font-bold">
                    {p.sector || 'General'}
                  </Badge>
                </TableCell>
                <TableCell className="text-[#14213D] max-w-[240px] truncate" title={p.product_name || undefined}>
                  {p.product_name || '-'}
                </TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{p.requested_by_name || '-'}</TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{p.responsible_name || 'Unassigned'}</TableCell>
                <TableCell className="font-mono whitespace-nowrap">{formatDateIN(p.request_date)}</TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(p.required_date)}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && (
                    <div className="text-[10px] font-bold text-[#881337]">{daysLeft === 0 ? 'DUE TODAY' : `${daysLeft} DAYS LEFT`}</div>
                  )}
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">{formatDateIN(p.sent_date)}</TableCell>
                <TableCell className="font-mono text-[#4A5568] whitespace-nowrap">{p.version || 'v1.0'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={proposalBadge(p.status)} size="sm" className="uppercase font-bold">
                    {upperLabel(PROPOSAL_STATUS_LABELS[p.status] || p.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{p.followup_owner_name || '-'}</TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(p.next_followup)}
                  {followupDays !== null && followupDays <= 0 && (
                    <div className="text-[10px] font-bold text-[#881337]">{followupDays === 0 ? 'DUE TODAY' : 'OVERDUE'}</div>
                  )}
                  {!p.next_followup && ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'].includes(lane) && (
                    <div className="text-[10px] font-bold text-[#9A3412]">NOT SCHEDULED</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {lane === 'CONVERTED' ? (
                    <Badge variant="success" size="sm" className="uppercase font-bold">
                      Converted
                    </Badge>
                  ) : lane === 'LOST' ? (
                    <>
                      <Badge variant="danger" size="sm" className="uppercase font-bold">
                        Lost
                      </Badge>
                      {p.lost_reason && (
                        <div
                          className="text-[10px] text-[#4A5568] max-w-[160px] truncate"
                          title={p.lost_remarks ? `${p.lost_reason}: ${p.lost_remarks}` : p.lost_reason}
                        >
                          {p.lost_reason}
                        </div>
                      )}
                    </>
                  ) : lane === 'CLOSED' ? (
                    <Badge variant="outline" size="sm" className="uppercase font-bold">
                      Closed
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {primary && (
                      <Button size="sm" variant="primary" disabled={primary.disabled} onClick={primary.onClick} className="shadow-xs text-xs">
                        {primary.label}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => openProposalDetails(p)} className="shadow-xs text-xs">
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
        title="Commercial Proposals"
        icon={<FileSpreadsheet className="h-6 w-6 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetCreateForm();
                setNewProposal((prev) => ({
                  ...prev,
                  responsible_id: user?.id || prev.responsible_id,
                  followup_owner_id: user?.id || prev.followup_owner_id,
                }));
                setIsCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span>New Proposal Request</span>
            </Button>
          </div>
        }
      />

      {pageError && (
        <InfoCallout variant="danger" title="Something went wrong" onClose={() => setPageError(null)}>
          {pageError}
        </InfoCallout>
      )}

      {/* Success Confirmation Banner */}
      {successMessage && (
        <div className="p-3 sm:p-4 bg-[#E3EFEE] border border-[#D0E5E3] rounded-[14px] text-[#0B4A4E] flex items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
          <div className="flex min-w-0 items-center gap-3">
            <div className="p-1.5 bg-[#0F5E63] text-white rounded-full shrink-0">
              <Check className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[#0B4A4E]">Quotation Registered</p>
              <p className="text-xs font-medium text-[#0B4A4E] [overflow-wrap:anywhere]">{successMessage}</p>
            </div>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="shrink-0 text-[#0B4A4E] hover:text-[#0B4A4E] p-2.5 sm:p-1.5 rounded-lg hover:bg-[#E3EFEE] transition-colors"
            title="Dismiss confirmation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 2. Key metrics — five cards, each filters the register (click again to clear). */}
      <StatGrid cols={5} className="gap-3">
        {headlineCards.map((c) => {
          const active = c.kind === 'status' ? selectedStatus === c.value && c.value !== 'all' : selectedFollowupCondition === c.value;
          return (
            <StatCard
              key={c.key}
              label={c.label}
              value={c.count}
              valueColor={c.color}
              subtext={c.subtext}
              icon={c.icon}
              className={active ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
              onClick={() => (c.kind === 'status' ? pickStatus(active ? 'all' : c.value) : pickFollowup(c.value))}
            />
          );
        })}
      </StatGrid>

      {/* 3. One filter row: search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search proposals"
              placeholder="Search proposal no., customer, product…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:relative lg:flex-nowrap">
            <FilterMenu
              label="Status"
              className={PHONE_MENU}
              icon={<Layers />}
              options={[{ key: 'all', label: 'All statuses' }, ...PROPOSAL_STATUS_FILTERS].map((o) => ({
                ...o,
                active: selectedStatus === o.key,
                onSelect: () => pickStatus(o.key),
              }))}
            />
            <FilterMenu
              label="Sector"
              className={PHONE_MENU}
              icon={<Building />}
              options={['all', ...SECTORS].map((s) => ({
                key: s,
                label: s === 'all' ? 'All sectors' : s,
                active: selectedSector === s,
                onSelect: () => {
                  setSelectedSector(s);
                },
              }))}
            />
            <FilterMenu
              label="Follow-ups"
              className={PHONE_MENU}
              icon={<Clock />}
              options={[
                { key: 'all', label: 'All proposals', count: undefined },
                { key: 'overdue', label: 'Overdue', count: stats.overdue || 0 },
                { key: 'due_today', label: 'Due today', count: stats.due_today || 0 },
                { key: 'upcoming', label: 'Upcoming', count: stats.upcoming || 0 },
                { key: 'no_followup', label: 'Not scheduled', count: stats.no_followup || 0 },
                { key: 'old_inactivity', label: 'Inactive 7d+', count: stats.old_no_movement || 0 },
              ].map((f) => ({
                ...f,
                urgent: f.key === 'overdue',
                active: selectedFollowupCondition === f.key,
                onSelect: () => {
                  setSelectedFollowupCondition(f.key);
                },
              }))}
            />
            <FilterMenu
              label="Owner"
              icon={<User />}
              className={`${PHONE_MENU} [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto`}
              options={[{ id: 'all', full_name: 'Anyone' }, ...users].map((u: any) => ({
                key: u.id,
                label: u.full_name,
                active: (selectedResponsibleId || 'all') === u.id,
                onSelect: () => {
                  setSelectedResponsibleId(u.id === 'all' ? '' : u.id);
                },
              }))}
            />
            <FilterMenu
              label="Follow-up by"
              icon={<Bell />}
              className={`${PHONE_MENU} [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto`}
              options={[{ id: 'all', full_name: 'Anyone' }, ...users].map((u: any) => ({
                key: u.id,
                label: u.full_name,
                active: (selectedFollowupOwnerId || 'all') === u.id,
                onSelect: () => {
                  setSelectedFollowupOwnerId(u.id === 'all' ? '' : u.id);
                },
              }))}
            />
            <button
              type="button"
              onClick={() => setIsDateFilterOpen((prev) => !prev)}
              aria-expanded={isDateFilterOpen}
              className={`filter-menu-btn ${isDateFilterOpen || fromDate || toDate ? 'filter-menu-btn--on' : ''}`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Dates</span>
              {(fromDate || toDate) && <span className="filter-menu-chip">On</span>}
            </button>
            <FilterMenu
              label="Sort"
              className={PHONE_MENU}
              icon={<ArrowUpDown />}
              neutralKeys={[...SORT_FIELDS.map((f) => f.key), 'dir_desc', 'dir_asc']}
              align="right"
              options={[
                ...SORT_FIELDS.map((f) => ({
                  key: f.key,
                  label: f.label,
                  active: sortBy === f.key,
                  onSelect: () => {
                    setSortBy(f.key);
                  },
                })),
                { key: 'dir_desc', label: 'Descending', icon: <ChevronDown />, active: sortOrder === 'desc', onSelect: () => setSortOrder('desc') },
                { key: 'dir_asc', label: 'Ascending', icon: <ChevronUp />, active: sortOrder === 'asc', onSelect: () => setSortOrder('asc') },
              ]}
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="xs" onClick={handleClearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>

        {isDateFilterOpen && (
          // phones: the date field on its own row, From / To side by side under it; from `sm` up: one row
          <div className="grid grid-cols-2 gap-2 border-t border-[#ECE9E2] pt-2.5 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <div className="col-span-2 flex min-w-0 items-center gap-3">
              <span className="font-semibold text-[#4A5568]">Date</span>
              <select
                value={dateField}
                onChange={(e) => {
                  setDateField(e.target.value);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:flex-none"
              >
                <option value="request_date">Request date</option>
                <option value="required_date">Required completion date</option>
                <option value="sent_date">Sent date</option>
                <option value="next_followup">Next follow-up</option>
              </select>
            </div>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                }}
                className="h-9 w-full min-w-0 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:w-auto"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                }}
                className="h-9 w-full min-w-0 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:w-auto"
              />
            </label>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="col-span-2 justify-self-start text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset dates
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* 4. Register — priority cards or a stage board (Cards | Board toggle), one scrolling card */}
      {isLoading ? (
        <Card padding="none" className="border-[#DCD8CE] py-12 text-center text-xs text-[#4A5568]">
          <Spinner size="md" className="mx-auto mb-2" />
          Loading proposals…
        </Card>
      ) : (
        <RecordViews
          title="Proposal register"
          items={recordItems}
          lanes={PROPOSAL_LANES}
          laneOf={(i) => laneByKey.get(i.key) ?? 'PROPOSAL_REQUESTED'}
          storageKey="proposals"
          defaultView="list"
          list={proposalList}
          hideEmptyLanes={selectedStatus !== 'all'}
          summary={
            <span className="font-mono text-xs">
              {proposals.length === total ? `${total} ${total === 1 ? 'proposal' : 'proposals'}` : `${proposals.length} of ${total} proposals`}
            </span>
          }
          empty={
            <div className="space-y-3">
              <p className="font-semibold text-[#14213D]">No proposals found</p>
              <p>{hasActiveFilters ? 'Try clearing the filters to see every proposal.' : 'Create your first proposal request to begin tracking.'}</p>
              {hasActiveFilters ? (
                <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  <span>New proposal request</span>
                </Button>
              )}
            </div>
          }
          onLoadMore={proposalsList.loadMore}
          hasMore={proposalsList.hasMore}
          loadingMore={proposalsList.loadingMore}
        />
      )}

      {/* 5. Create Proposal Request Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          resetCreateForm();
        }}
        title="Create Proposal Request"
        description="Register a new commercial price quote inquiry with customer, sector, product, and responsibility tracking."
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateProposal}>
          <FormSteps
            onCancel={() => {
              setIsCreateOpen(false);
              resetCreateForm();
            }}
            banner={
              (formError || duplicateWarning) && (
                <>
                  {formError && (
                    <div className="p-3 bg-[#FCE8EC] border border-[#F3C7CF] rounded-lg text-xs text-[#700F2D] flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 text-[#881337]" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {duplicateWarning && (
                    <div className="p-3.5 bg-[#FFF8EB] border border-[#E9C9B4] rounded-lg text-xs space-y-2">
                      <div className="flex items-start gap-2 text-[#7C2D12]">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#9A3412]" />
                        <div>
                          <span className="font-bold">Duplicate Proposal Detected: </span>
                          <span>{duplicateWarning.message}</span>
                        </div>
                      </div>
                      <div className="pt-1">
                        <label className="text-[11px] font-semibold text-[#7C2D12] block mb-1">
                          Duplicate Override Reason <span className="text-[#881337]">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. New fiscal budget inquiry or distinct delivery scope"
                          value={duplicateOverrideReason}
                          onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                          className="w-full text-xs py-1.5 px-3 bg-white border border-[#E9C9B4] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </>
              )
            }
            submit={
              <Button variant="primary" type="submit" isLoading={isSubmitting}>
                {/* phones: the footer buttons share the width, so the full label would wrap onto two lines */}
                <span className="sm:hidden">{duplicateWarning ? 'Create anyway' : 'Create request'}</span>
                <span className="hidden sm:inline">{duplicateWarning ? 'Override & Create Quote' : 'Create Proposal Request'}</span>
              </Button>
            }
            steps={[
              {
                title: 'Customer',
                icon: <Building />,
                description: 'Which customer is asking for this quote, and how did the request reach us?',
                content: (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[#14213D]">
                        Customer / Organisation <span className="text-[#881337]">*</span>
                      </label>
                      <select
                        required
                        value={newProposal.organisation_id}
                        onChange={(e) => {
                          const orgId = e.target.value;
                          setNewProposal({ ...newProposal, organisation_id: orgId, lead_id: '' });
                          // The override answered the old customer + product; a new combination is checked afresh.
                          setDuplicateWarning(null);
                          setDuplicateOverrideReason('');
                          // A customer with exactly one open lead: link it by default (the picker can still change it).
                          loadLeadOptions(orgId).then((rows) => {
                            if (rows.length === 1) setNewProposal((cur) => (cur.organisation_id === orgId && !cur.lead_id ? { ...cur, lead_id: rows[0].id } : cur));
                          });
                        }}
                        className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      >
                        <option value="">Select customer organisation...</option>
                        {organisations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name} {org.city ? `(${org.city})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {newProposal.organisation_id && (
                      <LeadSelect
                        value={newProposal.lead_id}
                        options={leadOptionsFor === newProposal.organisation_id ? leadOptions : []}
                        onChange={(lead_id) => setNewProposal({ ...newProposal, lead_id })}
                      />
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-[#14213D]">
                          Sector / Department <span className="text-[#881337]">*</span>
                        </label>
                        <select
                          required
                          value={newProposal.sector}
                          onChange={(e) => setNewProposal({ ...newProposal, sector: e.target.value })}
                          className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        >
                          {SECTORS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Input
                        label="Email / Tender Reference"
                        placeholder="e.g. ATC/BSF/2026/092"
                        value={newProposal.reference}
                        onChange={(e) => setNewProposal({ ...newProposal, reference: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Requirement',
                icon: <Package />,
                description: 'What product is being quoted, and any specifications to keep in mind.',
                content: (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-[#14213D]">
                          Product Required <span className="text-[#881337]">*</span>
                        </label>
                        <select
                          required
                          value={newProposal.product_id}
                          onChange={(e) => {
                            setNewProposal({ ...newProposal, product_id: e.target.value });
                            setDuplicateWarning(null);
                            setDuplicateOverrideReason('');
                          }}
                          className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        >
                          <option value="">Select product...</option>
                          {products.map((prod) => (
                            <option key={prod.id} value={prod.id}>
                              {prod.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Input label="Proposal Version" value="v1.0" readOnly disabled helperText="Set automatically" />
                    </div>

                    <CommercialFields
                      value={newProposal}
                      onChange={(patch) => setNewProposal({ ...newProposal, ...patch })}
                      minValidityDate={newProposal.request_date}
                    />

                    <Textarea
                      label="Internal Remarks / Tender Specifications"
                      rows={3}
                      placeholder="Key technical points, warranty expectations, delivery timelines requested by client..."
                      value={newProposal.remarks}
                      onChange={(e) => setNewProposal({ ...newProposal, remarks: e.target.value })}
                    />
                  </div>
                ),
              },
              {
                title: 'Owner',
                icon: <User />,
                description: 'Who prepares this quote, and by when it is needed.',
                content: (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[#14213D]">
                        Responsible Person (Owner) <span className="text-[#881337]">*</span>
                      </label>
                      <select
                        required
                        value={newProposal.responsible_id}
                        onChange={(e) =>
                          setNewProposal({
                            ...newProposal,
                            responsible_id: e.target.value,
                            followup_owner_id: newProposal.followup_owner_id || e.target.value,
                          })
                        }
                        className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      >
                        <option value="">Select responsible proposal owner...</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {userWithRole(u)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        type="date"
                        label="Request Date"
                        required
                        value={newProposal.request_date}
                        onChange={(e) => setNewProposal({ ...newProposal, request_date: e.target.value })}
                      />

                      <Input
                        type="date"
                        label="Required Completion Date"
                        required
                        value={newProposal.required_date}
                        onChange={(e) => setNewProposal({ ...newProposal, required_date: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Follow-up',
                icon: <CalendarDays />,
                description: 'Who chases the customer after the quote goes out, and when to start.',
                content: (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[#14213D]">Follow-up Owner</label>
                      <select
                        value={newProposal.followup_owner_id}
                        onChange={(e) => setNewProposal({ ...newProposal, followup_owner_id: e.target.value })}
                        className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      >
                        <option value="">Same as Responsible Person</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {userWithRole(u)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Input
                      type="date"
                      label="Initial Follow-up Date (Optional)"
                      value={newProposal.next_followup}
                      onChange={(e) => setNewProposal({ ...newProposal, next_followup: e.target.value })}
                    />
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* 6. Proposal Details Modal */}
      {selectedProposal && (
        <Modal
          isOpen={isDetailsOpen}
          onClose={() => setIsDetailsOpen(false)}
          title={`Proposal ${selectedProposal.proposal_number}`}
          description={`Registered on ${formatDateIN(selectedProposal.created_at)} by ${selectedProposal.requested_by_name || 'System'}`}
          maxWidth="4xl"
        >
          <div className="space-y-6">
            {/* Top Bar with Number, Badges, and Quick Actions */}
            <div className="p-3 sm:p-4 bg-[#FBFAF7] border border-[#DCD8CE] rounded-xl flex flex-wrap items-center justify-between gap-3">
              {/* wraps on phones: the number stays on one line and Edit/Delete drop below instead of off the card */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="whitespace-nowrap font-mono text-base font-black text-[#0F5E63]">
                  {selectedProposal.proposal_number}
                </span>
                <button
                  onClick={() => copyProposalNumber(selectedProposal.proposal_number)}
                  className="-m-1 p-2 text-[#4A5568] hover:text-[#0F5E63] transition-colors sm:m-0 sm:p-1"
                  title="Copy Proposal Number"
                >
                  {copiedId === selectedProposal.proposal_number ? (
                    <Check className="h-4 w-4 text-[#0F5E63]" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                <div className="mx-1 hidden h-4 w-px bg-[#DCD8CE] sm:block" />
                {renderStatusBadge(selectedProposal.status)}
                <span
                  className="font-mono text-xs font-semibold px-2 py-0.5 bg-white border border-[#DCD8CE] rounded-md text-[#4A5568]"
                  title="Set automatically: every saved change adds .1, a customer revision starts the next major version"
                >
                  Ver: {selectedProposal.version || 'v1.0'}
                </span>
                {canEditProposal(selectedProposal) && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => openEditProposal(selectedProposal)}
                    className="text-xs text-[#4A5568] hover:text-[#0F5E63]"
                    title="Edit Proposal Metadata"
                  >
                    <Edit2 className="h-3 w-3 mr-1" />
                    <span>Edit</span>
                  </Button>
                )}
                {/* Same rule as the API: only management / admin, and never once the quote went to the customer. */}
                {['admin', 'management'].includes(user?.role || '') && !selectedProposal.sent_date && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setDeleteError(null);
                      setIsDeleteConfirmOpen(true);
                    }}
                    className="text-xs text-[#881337] hover:text-[#700F2D] hover:bg-[#FCE8EC]"
                    title="Soft Delete Proposal"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    <span>Delete</span>
                  </Button>
                )}
              </div>

              {/* Workflow advancement actions — phones: their own full-width row of 40px buttons */}
              <div className="flex w-full flex-wrap items-center gap-2 empty:hidden sm:w-auto">
                {proposalLaneOf(selectedProposal.status) === 'PROPOSAL_REQUESTED' && canMove(selectedProposal, 'UNDER_PREPARATION') && (
                  <Button
                    variant="primary"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                  >
                    <span>Start Preparation</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                )}

                {proposalLaneOf(selectedProposal.status) === 'UNDER_PREPARATION' && canMove(selectedProposal, 'READY_FOR_REVIEW') && (
                  <Button
                    variant="primary"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('READY_FOR_REVIEW')}
                  >
                    <span>Submit for Review</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                )}

                {proposalLaneOf(selectedProposal.status) === 'READY_FOR_REVIEW' && (() => {
                  // The server decides who reviews (allowed_transitions): Management / Admin for major proposals, the
                  // Regional Manager of the customer's region below the threshold; the author never approves.
                  const canApprove = canMove(selectedProposal, 'APPROVED');
                  const canRequestChanges = canMove(selectedProposal, 'UNDER_PREPARATION');
                  const regionalBand = selectedProposal.approval_band === 'regional';
                  const isBandApprover = user?.role === 'admin' || user?.role === (regionalBand ? 'regional_manager' : 'management');
                  const isAuthor = Boolean(
                    user &&
                      [
                        selectedProposal.created_by_id,
                        selectedProposal.created_by,
                        selectedProposal.requested_by_id,
                        selectedProposal.requested_by,
                        selectedProposal.responsible_person_id,
                        selectedProposal.responsible_id,
                      ].includes(user.id),
                  );
                  const selfApprovalBlocked = !canApprove && isBandApprover && isAuthor;

                  if (!canApprove && !canRequestChanges && !selfApprovalBlocked) {
                    return (
                      <span className="text-[11px] text-[#4A5568] bg-[#FBFAF7] px-2.5 py-1 rounded border border-[#DCD8CE] italic">
                        {regionalBand
                          ? "Awaiting the Regional Manager's approval (below the threshold, the customer's region approves)"
                          : 'Awaiting Management approval (major proposals are approved by Management / Admin)'}
                      </span>
                    );
                  }
                  return (
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                      {selfApprovalBlocked && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] text-[10px] font-medium" title="Dual-control policy: You created/authored this proposal and cannot approve your own quotation.">
                          <AlertTriangle className="h-3 w-3 text-[#9A3412] shrink-0" />
                          <span>Self-Approval Prohibited (Created by you)</span>
                        </div>
                      )}
                      {canRequestChanges && (
                        <Button
                          variant="outline"
                          size="xs"
                          className={`${FLOW_BTN} text-[#700F2D] border-[#F3C7CF] hover:bg-[#FCE8EC]`}
                          onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          <span>Request Changes</span>
                        </Button>
                      )}
                      {canApprove && (
                        <Button
                          variant="success"
                          size="xs"
                          className={FLOW_BTN}
                          onClick={() => initiateStatusChange('APPROVED')}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          <span>Approve Proposal</span>
                        </Button>
                      )}
                    </div>
                  );
                })()}

                {proposalLaneOf(selectedProposal.status) === 'APPROVED' && canMove(selectedProposal, 'SENT_TO_CUSTOMER') && (
                  <Button
                    variant="primary"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('SENT_TO_CUSTOMER')}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    <span>Mark Sent to Customer</span>
                  </Button>
                )}

                {/* Internal revision before sending: withdraws the approval, back to preparation */}
                {proposalLaneOf(selectedProposal.status) === 'APPROVED' && canMove(selectedProposal, 'UNDER_PREPARATION') && (
                  <Button
                    variant="outline"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    <span>Revise Before Sending</span>
                  </Button>
                )}

                {SENT_LANES.includes(proposalLaneOf(selectedProposal.status)) && canEditProposal(selectedProposal) && (
                  <>
                    <Button
                      variant="primary"
                      size="xs"
                      className={`${FLOW_BTN} basis-full sm:basis-auto`}
                      onClick={() => openFollowupFor(selectedProposal)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      <span>Add Follow-up</span>
                    </Button>
                    {/* Customer asked for a revised quote: next major version, follow-ups paused until re-sent */}
                    {canMove(selectedProposal, 'UNDER_PREPARATION') && (
                      <Button
                        variant="outline"
                        size="xs"
                        className={FLOW_BTN}
                        onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                      >
                        <Edit2 className="h-3.5 w-3.5 mr-1" />
                        <span>Customer Revision</span>
                      </Button>
                    )}
                    {canMove(selectedProposal, 'CONVERTED') && (
                      <Button
                        variant="success"
                        size="xs"
                        className={FLOW_BTN}
                        onClick={() => initiateStatusChange('CONVERTED')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        <span>Mark Converted</span>
                      </Button>
                    )}
                    {canMove(selectedProposal, 'LOST') && (
                      <Button
                        variant="danger"
                        size="xs"
                        className={FLOW_BTN}
                        onClick={() => initiateStatusChange('LOST')}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        <span>Mark Lost</span>
                      </Button>
                    )}
                  </>
                )}

                {/* Cancel / close an open proposal (closure reason + remarks) */}
                {!selectedProposal.is_terminal && canMove(selectedProposal, 'CLOSED') && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className={`${FLOW_BTN} text-[#881337] hover:bg-[#FCE8EC] hover:text-[#700F2D]`}
                    onClick={() => initiateStatusChange('CLOSED')}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    <span>Close Proposal</span>
                  </Button>
                )}

                {/* DEF-070: a converted quote becomes a dispatch — opens the pre-filled delivery form */}
                {proposalLaneOf(selectedProposal.status) === 'CONVERTED' && canOpen(user?.role, '/deliveries') && (
                  <Link href={`/deliveries?proposal=${selectedProposal.id}`} className="grow basis-[8rem] sm:grow-0 sm:basis-auto">
                    <Button variant="primary" size="xs" className={`${FLOW_BTN} w-full`}>
                      <Package className="h-3.5 w-3.5 mr-1" />
                      <span>Create dispatch</span>
                    </Button>
                  </Link>
                )}

                {/* Reopen a concluded proposal: management / admin within the reopen window (server-computed) */}
                {selectedProposal.is_terminal && canMove(selectedProposal, 'REQUESTED') && (
                  <Button
                    variant="outline"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('REQUESTED')}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    <span>Reopen</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Why there is nothing to do here: read-only outcome, or a colleague's proposal (DEF-008 / DEF-080) */}
            {selectedProposal.is_terminal ? (
              <InfoCallout variant="neutral" title="Read-only">
                {selectedProposal.proposal_number} is {statusText(selectedProposal.status)}. Concluded proposals cannot be edited
                {canMove(selectedProposal, 'REQUESTED')
                  ? ` — use Reopen (within the ${reopenWindowDays}-day reopen window) to make changes.`
                  : ['management', 'admin'].includes(user?.role || '')
                    ? `. The ${reopenWindowDays}-day reopen window has passed; register a new proposal instead.`
                    : `; management can reopen it within ${reopenWindowDays} days if needed.`}
              </InfoCallout>
            ) : selectedProposal.can_edit === false ? (
              <InfoCallout variant="info" title="View only">
                This proposal belongs to {selectedProposal.responsible_name || selectedProposal.requested_by_name || 'another salesperson'}. Only the
                requester, the responsible person, the follow-up owner, regional managers and management can change it.
              </InfoCallout>
            ) : null}

            {/* Visual Lifecycle Stepper */}
            <div className="p-3 sm:p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] mb-3">
                Lifecycle Progression
              </h4>
              {/* phones: one sideways row of stage tiles that keeps the current stage in view; `sm` up: the grid.
                  The 2px pad (cancelled by the wrapper's -2px margin) keeps the current tile's ring unclipped. */}
              <ScrollStrip
                activeKey={getStageIndex(selectedProposal.status)}
                wrapperClassName="-m-0.5"
                className="gap-2 p-0.5 sm:grid sm:grid-cols-4 md:grid-cols-7"
              >
                {STAGES.map((st, i) => {
                  const currentIdx = getStageIndex(selectedProposal.status);
                  const isDone = i < currentIdx;
                  const isCurrent = i === currentIdx;

                  return (
                    <div
                      key={st.key}
                      data-active={isCurrent ? 'true' : undefined}
                      className={`w-[7.25rem] shrink-0 sm:w-auto p-2.5 rounded-lg border text-center relative flex flex-col justify-between transition-all ${
                        isCurrent
                          ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#0F5E63] ring-2 ring-[#0F5E63]/20 shadow-xs'
                          : isDone
                          ? 'bg-[#E3EFEE]/60 border-[#D0E5E3] text-[#0B4A4E]'
                          : 'bg-[#FBFAF7] border-[#DCD8CE] text-[#6B7280]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-center mb-1">
                          {isDone ? (
                            <CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />
                          ) : (
                            <span
                              className={`h-4 w-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                                isCurrent
                                  ? 'bg-[#0F5E63] text-white'
                                  : 'bg-[#DCD8CE] text-[#4A5568]'
                              }`}
                            >
                              {i + 1}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-bold tracking-tight leading-tight">
                          {st.label}
                        </div>
                      </div>
                      <div className="text-[9px] text-[#4A5568] mt-1 line-clamp-2" title={st.desc}>
                        {st.desc}
                      </div>
                    </div>
                  );
                })}
              </ScrollStrip>
            </div>

            {/* Tabs for Overview, Follow-ups, and History */}
            <Tabs
              tabs={[
                { id: 'overview', label: 'Overview & Details', icon: <Briefcase className="h-4 w-4" /> },
                { id: 'followups', label: `Follow-ups (${followups.length})`, icon: <MessageSquare className="h-4 w-4" /> },
                { id: 'history', label: `Activity History (${activities.length})`, icon: <History className="h-4 w-4" /> },
                { id: 'linked', label: 'Linked Records', icon: <Layers className="h-4 w-4" /> },
              ]}
              activeTab={detailsTab}
              onChange={(id) => setDetailsTab(id as any)}
              variant="segmented"
            />

            {/* Tab 1: Overview */}
            {detailsTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer & Product Card */}
                <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] flex items-center gap-1.5 border-b border-[#E3EFEE] pb-2">
                    <Building className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <span>Customer & Product Specs</span>
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Customer Organisation</span>
                      {canOpen(user?.role, '/leads') && (selectedProposal.customer_id || selectedProposal.organisation_id) ? (
                        <Link
                          href={`/leads?customer=${selectedProposal.customer_id || selectedProposal.organisation_id}`}
                          className="font-bold text-[#0F5E63] text-sm hover:underline"
                          title="Open Customer 360"
                        >
                          {selectedProposal.organisation_name}
                        </Link>
                      ) : (
                        <span className="font-bold text-[#14213D] text-sm">{selectedProposal.organisation_name}</span>
                      )}
                      {placeText(selectedProposal.organisation_city, selectedProposal.organisation_state) && (
                        <span className="text-[#4A5568] ml-2">({placeText(selectedProposal.organisation_city, selectedProposal.organisation_state)})</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Source Lead</span>
                      {selectedProposal.lead_id ? (
                        canOpen(user?.role, '/leads') ? (
                          <Link href={`/leads?open=${selectedProposal.lead_id}`} className="font-semibold text-[#0F5E63] hover:underline">
                            {selectedProposal.lead?.label || 'Open source lead'}
                          </Link>
                        ) : (
                          <span className="font-medium text-[#14213D]">{selectedProposal.lead?.label || 'Linked lead'}</span>
                        )
                      ) : (
                        <span className="text-[#4A5568]">Not linked to a lead</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Product Inquired</span>
                      <span className="font-semibold text-[#14213D]">{selectedProposal.product_name}</span>
                      {selectedProposal.product_category && (
                        <span className="text-[#4A5568] ml-2">[{selectedProposal.product_category}]</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Sector / Department</span>
                      <span className="font-medium text-[#14213D]">{selectedProposal.sector}</span>
                    </div>
                    {selectedProposal.reference && (
                      <div>
                        <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Email / Tender Reference</span>
                        <span className="font-mono text-[#0F5E63]">{selectedProposal.reference}</span>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Timeline Card */}
                <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] flex items-center gap-1.5 border-b border-[#E3EFEE] pb-2">
                    <Calendar className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <span>Milestones & Timeline</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Request Date</span>
                      <span className="font-medium text-[#14213D]">
                        {formatDateIN(selectedProposal.request_date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Required Completion</span>
                      <span className="font-medium text-[#14213D]">
                        {formatDateIN(selectedProposal.required_date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Approval Date</span>
                      <span className="font-medium text-[#14213D]">
                        {formatDateIN(selectedProposal.approved_at)}
                      </span>
                      {selectedProposal.approved_by_name && (
                        <span className="block text-[10px] text-[#4A5568]">by {selectedProposal.approved_by_name}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Sent to Customer</span>
                      <span className="font-medium text-[#14213D]">
                        {formatDateIN(selectedProposal.sent_date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Responsible Rep</span>
                      <span className="font-medium text-[#14213D]">{selectedProposal.responsible_name || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Follow-up Owner</span>
                      <span className="font-medium text-[#14213D]">{selectedProposal.followup_owner_name || '-'}</span>
                    </div>
                  </div>
                </Card>

                {/* Commercial terms of the quote (DEF-029) — recorded, not generated */}
                <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] md:col-span-2 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] flex items-center gap-1.5 border-b border-[#E3EFEE] pb-2">
                    <FileCheck className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <span>Commercial Terms</span>
                  </h4>
                  {!hasQuote(selectedProposal) && (
                    <InfoCallout variant="warning" title="No quoted value yet">
                      Enter the quoted value (₹) before this proposal is submitted for review — management cannot approve a quote without pricing.
                    </InfoCallout>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Quoted Value</span>
                      <span className="font-mono font-bold text-[#14213D] text-sm">
                        {hasQuote(selectedProposal) ? formatINR(Number(selectedProposal.quoted_value)) : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Quantity</span>
                      <span className="font-mono text-[#14213D]">{selectedProposal.quantity ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Margin</span>
                      <span className="font-mono text-[#14213D]">
                        {selectedProposal.margin_percent !== null && selectedProposal.margin_percent !== undefined ? `${Number(selectedProposal.margin_percent)}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Quote Valid Until</span>
                      <span className="font-mono text-[#14213D]">{formatDateIN(selectedProposal.validity_date)}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Payment Terms</span>
                      <span className="text-[#14213D] whitespace-pre-wrap">{selectedProposal.payment_terms || '—'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Delivery Terms</span>
                      <span className="text-[#14213D] whitespace-pre-wrap">{selectedProposal.delivery_terms || '—'}</span>
                    </div>
                  </div>
                </Card>

                {/* Outcome card if completed */}
                {['CONVERTED', 'LOST', 'CLOSED'].includes(selectedProposal.status) && (
                  <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] md:col-span-2 bg-[#FBFAF7]">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] mb-2">
                      Proposal Outcome Record
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Final Status</span>
                        <span className="font-black text-sm">{statusText(selectedProposal.status)}</span>
                      </div>
                      {selectedProposal.lost_reason && (
                        <div>
                          <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Lost Reason</span>
                          <span className="font-bold text-[#700F2D]">{selectedProposal.lost_reason}</span>
                          {selectedProposal.lost_remarks && (
                            <p className="text-[11px] text-[#4A5568] mt-1">{selectedProposal.lost_remarks}</p>
                          )}
                        </div>
                      )}
                      {(selectedProposal.converted_to || selectedProposal.conversion_reference) && (
                        <div>
                          <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Converted To</span>
                          <span className="font-bold text-[#0B4A4E]">{selectedProposal.converted_to || 'Order'}</span>
                          {(selectedProposal.conversion_reference || selectedProposal.converted_reference) && (
                            <p className="text-[11px] text-[#4A5568] mt-1 font-mono">
                              {selectedProposal.conversion_reference || selectedProposal.converted_reference}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )}

                {/* Remarks Card */}
                {selectedProposal.remarks && (
                  <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] md:col-span-2">
                    <span className="text-[#4A5568] block text-[10px] uppercase font-semibold mb-1">Remarks & Details</span>
                    <p className="text-xs text-[#14213D] whitespace-pre-wrap leading-relaxed">
                      {selectedProposal.remarks}
                    </p>
                  </Card>
                )}
              </div>
            )}

            {/* Tab 4: everything linked to this proposal across modules */}
            {detailsTab === 'linked' && (
              <RelatedRecords
                to={{ kind: 'proposal', id: selectedProposal.id, organisationId: selectedProposal.customer_id || selectedProposal.organisation_id }}
                sections={['tasks', 'demos', 'tenders', 'service']}
                description="Follow-up tasks created from this proposal, and the customer's demos, tenders and service tickets."
                addTask={{ title: `Proposal follow-up: ${selectedProposal.proposal_number || selectedProposal.proposal_no || ''}`.trim() }}
              />
            )}

            {/* Tab 2: Follow-up Tracking */}
            {detailsTab === 'followups' && (
              <div className="space-y-4">
                {/* Active Follow-up Banner */}
                <div className="p-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-xl flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-xs">
                    <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Current Follow-up Status</span>
                    <div className="font-semibold text-[#14213D] mt-0.5">
                      Next Contact: {selectedProposal.next_followup ? formatDateIN(selectedProposal.next_followup) : 'No date scheduled'}
                      {selectedProposal.followup_owner_name && (
                        <span className="text-[#4A5568] font-normal ml-2">(Owner: {selectedProposal.followup_owner_name})</span>
                      )}
                    </div>
                  </div>
                  {/* DEF-079: customer follow-ups exist only once the quote has been sent */}
                  {SENT_LANES.includes(proposalLaneOf(selectedProposal.status)) && canEditProposal(selectedProposal) ? (
                    <Button
                      variant="primary"
                      size="xs"
                      className="h-10 w-full text-xs sm:h-7 sm:w-auto sm:text-[11px]"
                      onClick={() => openFollowupFor(selectedProposal, false)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      <span>Log New Follow-up</span>
                    </Button>
                  ) : (
                    <span className="text-[11px] text-[#4A5568] italic">
                      {SENT_LANES.includes(proposalLaneOf(selectedProposal.status))
                        ? 'Only the follow-up owner, responsible person or a manager can log follow-ups.'
                        : ['CONVERTED', 'LOST', 'CLOSED'].includes(proposalLaneOf(selectedProposal.status))
                          ? 'Concluded — no further follow-ups.'
                          : 'Follow-ups start once the proposal is sent to the customer.'}
                    </span>
                  )}
                </div>

                {/* Follow-up Timeline Entries */}
                {followups.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
                    No follow-ups logged yet for this proposal.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {followups.map((f) => (
                      <div
                        key={f.id}
                        className="p-3 bg-white border border-[#DCD8CE] rounded-xl text-xs space-y-1 hover:border-[#0F5E63] transition-colors"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 font-semibold text-[#14213D]">
                          <span className="flex items-center gap-1.5 text-[#0F5E63]">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDateIN(f.followup_date || f.contact_date)}
                            {f.mode && <span className="text-[10px] font-normal text-[#4A5568]">· {f.mode}</span>}
                          </span>
                          <span className="text-[11px] font-normal text-[#4A5568]">
                            Logged by {f.owner_name || f.logged_by_name || '—'}
                          </span>
                        </div>
                        <p className="text-[#14213D] mt-1">{f.remarks || f.summary}</p>
                        {f.outcome && (
                          <div className="text-[11px] text-[#0B4A4E] font-medium">
                            Result / Outcome: {f.outcome}
                          </div>
                        )}
                        {f.next_followup_date && (
                          <div className="text-[10px] text-[#4A5568]">
                            Next Action Scheduled: {formatDateIN(f.next_followup_date)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Activity History */}
            {detailsTab === 'history' && (
              <div className="space-y-3">
                {activities.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
                    No historical events recorded yet.
                  </div>
                ) : (
                  activities.map((act) => (
                    <div
                      key={act.id}
                      className="p-3 bg-white border border-[#DCD8CE] rounded-xl text-xs flex items-start gap-3"
                    >
                      <div className="p-1.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-[#0F5E63] shrink-0 mt-0.5">
                        <History className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                          <span className="font-bold text-[#14213D]">
                            {act.action === 'CREATED' ? 'Proposal created' : 'Status changed'}
                          </span>
                          <span className="font-mono text-[10px] text-[#4A5568]">{istDateTimeText(act.occurred_at || act.created_at)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {act.action !== 'CREATED' && act.from_status && (
                            <>
                              <Badge variant={proposalBadge(act.from_status)} size="sm">{statusText(act.from_status)}</Badge>
                              <ArrowRight className="h-3 w-3 text-[#4A5568]" />
                            </>
                          )}
                          <Badge variant={proposalBadge(act.to_status)} size="sm">{statusText(act.to_status)}</Badge>
                        </div>
                        {act.reason && <div className="text-[#4A5568] mt-1 break-words">{act.reason}</div>}
                        <div className="text-[10px] text-[#4A5568] mt-0.5 font-medium">
                          by {act.performed_by_name || act.actor_name || 'System'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 7. Status Transition Dialog */}
      <Modal
        isOpen={isStatusDialogOpen}
        onClose={() => setIsStatusDialogOpen(false)}
        title={
          isRequestChanges
            ? 'Request Changes'
            : isInternalRevision
              ? 'Revise Before Sending'
              : isCustomerRevision
                ? 'Customer Revision'
                : isBackToPreparation
                  ? 'Send Back to Preparation'
                  : isReopen
                    ? 'Reopen Proposal'
                    : targetStatus === 'CLOSED'
                      ? 'Close Proposal'
                      : `Advance Status: ${PROPOSAL_STATUS_LABELS[targetStatus] || targetStatus}`
        }
        description={
          isRequestChanges
            ? 'Return the quote to the preparer with the changes you need.'
            : isInternalRevision
              ? 'Withdraws the approval: the quote goes back to preparation and must be reviewed again before it is sent.'
              : isCustomerRevision
                ? `Starts version v${(Number(selectedProposal?.current_version) || 1) + 1}.0 and pauses follow-ups until the revised quote is sent.`
                : isReopen
                  ? 'Returns the proposal to the stage it was in before it was concluded. The reason is kept in the activity history.'
                  : targetStatus === 'CLOSED'
                    ? `Cancels the proposal and makes it read-only. Management can reopen it within ${reopenWindowDays} days.`
                    : 'Verify milestone transition requirements.'
        }
        maxWidth="md"
      >
        <form onSubmit={handleStatusSubmit} className="space-y-4">
          {statusError && (
            <InfoCallout variant="danger" title="Could not save" onClose={() => setStatusError(null)}>
              {statusError}
            </InfoCallout>
          )}
          {(targetStatus === 'READY_FOR_REVIEW' || targetStatus === 'APPROVED') && selectedProposal && (
            hasQuote(selectedProposal) ? (
              <div className="rounded-lg border border-[#DCD8CE] bg-[#FBFAF7] p-3 text-xs text-[#14213D]">
                <span className="block text-[10px] font-semibold uppercase text-[#4A5568]">Quoted value</span>
                <span className="font-mono text-sm font-bold">{formatINR(Number(selectedProposal.quoted_value))}</span>
                {selectedProposal.quantity ? <span className="ml-2 text-[#4A5568]">· Qty {selectedProposal.quantity}</span> : null}
                {selectedProposal.margin_percent !== null && selectedProposal.margin_percent !== undefined ? (
                  <span className="ml-2 text-[#4A5568]">· Margin {Number(selectedProposal.margin_percent)}%</span>
                ) : null}
              </div>
            ) : (
              <InfoCallout variant="warning" title="Pricing missing">
                This proposal has no quoted value. {canEditProposal(selectedProposal) ? 'Use Edit → Commercial terms to enter it first.' : 'Ask the responsible person to enter it first.'}
              </InfoCallout>
            )
          )}
          {targetStatus === 'SENT_TO_CUSTOMER' && (
            <Input
              type="date"
              label="Proposal Sent Date"
              required
              max={istToday()}
              helperText="Defaults to today (IST). Cannot be in the future or before the request date."
              value={statusForm.sent_date}
              onChange={(e) => setStatusForm({ ...statusForm, sent_date: e.target.value })}
            />
          )}
          {targetStatus === 'SENT_TO_CUSTOMER' && (
            <Input
              label="Email / Dispatch Reference"
              required
              placeholder="e.g. Email to DIG Procurement, 20-10-2026 or GeM bid ref"
              helperText="How the quote reached the customer — kept on the proposal for follow-ups."
              value={statusForm.reference}
              onChange={(e) => setStatusForm({ ...statusForm, reference: e.target.value })}
            />
          )}
          {targetStatus === 'SENT_TO_CUSTOMER' && (
            // PROPOSAL_PIPELINE §2: dispatch records who chases the customer and when.
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Follow-up Owner"
                required
                value={statusForm.follow_up_owner_id}
                onChange={(e) => setStatusForm({ ...statusForm, follow_up_owner_id: e.target.value })}
                options={ownerChoicesFor(selectedProposal, users)}
                placeholder="Select owner..."
              />
              <Input
                type="date"
                label="Next Follow-up Date"
                required
                min={statusForm.sent_date || undefined}
                helperText="When to contact the customer first."
                value={statusForm.next_followup}
                onChange={(e) => setStatusForm({ ...statusForm, next_followup: e.target.value })}
              />
            </div>
          )}
          {targetStatus === 'CLOSED' && (
            <Select
              label="Closure Reason"
              required
              value={statusForm.closure_reason_code}
              onChange={(e) => setStatusForm({ ...statusForm, closure_reason_code: e.target.value })}
              options={closureReasons.map((r) => ({ value: r, label: r }))}
              placeholder="Select reason..."
            />
          )}

          {targetStatus === 'LOST' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#14213D]">
                  Lost Reason <span className="text-[#881337]">*</span>
                </label>
                <select
                  required
                  value={statusForm.lost_reason}
                  onChange={(e) => setStatusForm({ ...statusForm, lost_reason: e.target.value as any })}
                  className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                >
                  <option value="" disabled>
                    -- Select reason --
                  </option>
                  {PROPOSAL_LOST_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Textarea
                label="Lost Remarks / Competitor Details"
                required
                placeholder="Competitor price, client cancellation reasons..."
                value={statusForm.lost_remarks}
                onChange={(e) => setStatusForm({ ...statusForm, lost_remarks: e.target.value })}
              />
            </>
          )}

          {targetStatus === 'CONVERTED' && (
            <>
              {/* converted_to = what the quote became (order type); converted_reference = that order's number, which the
                  dispatch is raised against (QA retest: the two labels used to be swapped). */}
              <Select
                label="Order Type"
                value={statusForm.converted_to || 'Purchase Order'}
                onChange={(e) => setStatusForm({ ...statusForm, converted_to: e.target.value })}
                options={PROPOSAL_ORDER_TYPES.map((t) => ({ value: t, label: t }))}
              />
              <Input
                label="PO / Supply Order / GeM Contract No."
                placeholder="e.g. PO-2026-881 or GEMC-5116877"
                required
                value={statusForm.converted_reference}
                onChange={(e) => setStatusForm({ ...statusForm, converted_reference: e.target.value })}
              />
            </>
          )}

          <Textarea
            label={
              isRequestChanges
                ? 'Changes Requested'
                : isCustomerRevision
                  ? 'Revision Requested by the Customer'
                  : targetStatus === 'CLOSED'
                    ? 'Closure Remarks'
                    : needsReason
                      ? 'Reason'
                      : 'Transition Remarks'
            }
            required={needsReason}
            placeholder={
              isBackToPreparation
                ? 'What needs to change, and why…'
                : targetStatus === 'CLOSED'
                  ? 'Why the proposal is being closed…'
                  : isReopen
                    ? 'Why this proposal needs to be reopened…'
                    : 'Add optional notes for this status update...'
            }
            value={statusForm.remarks}
            onChange={(e) => setStatusForm({ ...statusForm, remarks: e.target.value })}
          />

          <div className={DIALOG_FOOTER}>
            <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" className={DIALOG_BTN} type="submit" isLoading={isSubmitting}>
              {isReopen ? 'Reopen Proposal' : targetStatus === 'CLOSED' ? 'Close Proposal' : 'Confirm Transition'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* 8. Add Follow-up Dialog */}
      <Modal
        isOpen={isFollowupDialogOpen}
        onClose={() => setIsFollowupDialogOpen(false)}
        title="Log Proposal Follow-up"
        description="Record customer interaction, discussions, and update pipeline schedules."
        maxWidth="md"
      >
        <form onSubmit={handleAddFollowup} className="space-y-4">
          {followupError && (
            <InfoCallout variant="danger" title="Could not save" onClose={() => setFollowupError(null)}>
              {followupError}
            </InfoCallout>
          )}
          <FormSection title="Interaction" icon={<Calendar />} description="When the customer was contacted, and who owns the follow-ups from here.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                type="date"
                label="Follow-up Date"
                required
                max={istToday()}
                value={followupForm.followup_date}
                onChange={(e) => setFollowupForm({ ...followupForm, followup_date: e.target.value })}
              />
              <Select
                label="Follow-up Owner"
                required
                value={followupForm.owner_id}
                onChange={(e) => setFollowupForm({ ...followupForm, owner_id: e.target.value })}
                options={ownerChoicesFor(selectedProposal, users)}
                placeholder="Select owner..."
                helperText={
                  followupForm.owner_id && followupForm.owner_id !== currentOwnerOf(selectedProposal)
                    ? 'Saving hands this proposal’s follow-ups to the selected person.'
                    : undefined
                }
              />
            </div>
          </FormSection>

          <FormSection title="Discussion" icon={<MessageSquare />} description="What was discussed, where it stands, and when to check in next.">
            <div className="space-y-3">
              <Textarea
                label="Meeting / Call Discussion Remarks"
                required
                rows={3}
                placeholder="Discussed pricing terms, client requested revised delivery timeline..."
                value={followupForm.remarks}
                onChange={(e) => setFollowupForm({ ...followupForm, remarks: e.target.value })}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Outcome / Current Result"
                  placeholder="e.g. Positive acknowledge, sample demo requested"
                  value={followupForm.outcome}
                  onChange={(e) => setFollowupForm({ ...followupForm, outcome: e.target.value })}
                />

                <Input
                  type="date"
                  label="Next Follow-up Date"
                  required
                  min={istToday()}
                  helperText="When to contact the customer next (to close the proposal, use Mark Converted / Lost)"
                  value={followupForm.next_followup_date}
                  onChange={(e) => setFollowupForm({ ...followupForm, next_followup_date: e.target.value })}
                />
              </div>

              {needsPostponeReason && (
                <Input
                  label={`Reason for a follow-up beyond ${followUpHorizonDays} days`}
                  required
                  placeholder="e.g. Customer's budget is released next financial year"
                  value={followupForm.postpone_reason}
                  onChange={(e) => setFollowupForm({ ...followupForm, postpone_reason: e.target.value })}
                />
              )}
            </div>
          </FormSection>

          <div className={DIALOG_FOOTER}>
            <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsFollowupDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" className={DIALOG_BTN} type="submit" isLoading={isSubmitting}>
              Log Follow-up
            </Button>
          </div>
        </form>
      </Modal>

      {/* 9. Edit Proposal Details Modal */}
      {selectedProposal && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          title={`Edit Proposal: ${selectedProposal.proposal_number}`}
          description="Update tracking metadata, assigned owners, delivery requirements, or remarks."
          maxWidth="md"
        >
          <form onSubmit={handleEditProposal} className="space-y-4">
            {editError && (
              <InfoCallout variant="danger" title="Could not save" onClose={() => setEditError(null)}>
                {editError}
              </InfoCallout>
            )}
            <FormSection title="Schedule & Reference" icon={<CalendarDays />} description="Required date, version and the email / customer reference for this proposal.">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    type="date"
                    label="Required Completion Date"
                    required
                    value={editForm.required_date}
                    min={proposalDay(selectedProposal.request_date) || undefined}
                    onChange={(e) => setEditForm({ ...editForm, required_date: e.target.value })}
                  />
                  <Input
                    label="Proposal Version"
                    value={selectedProposal.version || 'v1.0'}
                    readOnly
                    disabled
                    helperText="Set automatically — saving changes makes it the next .1"
                  />
                </div>

                {editForm.required_date !== proposalDay(selectedProposal.required_date) && (
                  <Input
                    label="Reason for changing the required date"
                    required
                    placeholder="e.g. Customer extended the submission window"
                    value={editForm.required_date_change_reason}
                    onChange={(e) => setEditForm({ ...editForm, required_date_change_reason: e.target.value })}
                  />
                )}

                <Input
                  label="Email / Tender Reference"
                  placeholder="e.g. ATC/BSF/2026/092"
                  value={editForm.reference}
                  onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })}
                />
              </div>
            </FormSection>

            <FormSection title="Commercial Terms" icon={<FileCheck />} description="The quote as prepared: price, quantity, margin, validity and terms. A quoted value is required before review.">
              <CommercialFields
                value={editForm}
                onChange={(patch) => setEditForm({ ...editForm, ...patch })}
                quoteRequired={!['PROPOSAL_REQUESTED', 'UNDER_PREPARATION'].includes(proposalLaneOf(selectedProposal.status))}
                minValidityDate={proposalDay(selectedProposal.request_date) || undefined}
              />
            </FormSection>

            <FormSection title="Source Lead" icon={<Briefcase />} description="The customer's lead / opportunity this quote answers.">
              <LeadSelect
                value={editForm.lead_id}
                options={leadOptionsFor === (selectedProposal.customer_id || selectedProposal.organisation_id) ? leadOptions : []}
                current={selectedProposal.lead}
                onChange={(lead_id) => setEditForm({ ...editForm, lead_id })}
              />
            </FormSection>

            <FormSection title="Owners & Notes" icon={<User />} description="Who prepares the quote, who follows up, and internal notes.">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#14213D]">Responsible Person</label>
                    <select
                      value={editForm.responsible_id}
                      onChange={(e) => setEditForm({ ...editForm, responsible_id: e.target.value })}
                      className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {userWithRole(u)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#14213D]">Follow-up Owner</label>
                    <select
                      value={editForm.followup_owner_id}
                      onChange={(e) => setEditForm({ ...editForm, followup_owner_id: e.target.value })}
                      className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {userWithRole(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <Textarea
                  label="Internal Remarks / Notes"
                  rows={3}
                  placeholder="Add or update notes..."
                  value={editForm.remarks}
                  onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                />
              </div>
            </FormSection>

            <div className={DIALOG_FOOTER}>
              <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsEditOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" className={DIALOG_BTN} type="submit" isLoading={isSubmitting}>
                Save Changes
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* 10. Delete Confirmation Modal */}
      {selectedProposal && (
        <Modal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          title="Delete Proposal"
          description={`Are you sure you want to delete proposal ${selectedProposal.proposal_number}?`}
          maxWidth="sm"
        >
          <div className="space-y-4">
            {deleteError && (
              <InfoCallout variant="danger" title="Could not delete" onClose={() => setDeleteError(null)}>
                {deleteError}
              </InfoCallout>
            )}
            <p className="text-xs text-[#4A5568] leading-relaxed">
              This will soft-delete the proposal record from active views. Historical audit events and logged customer follow-ups will be safely preserved in the database.
            </p>
            <div className={DIALOG_FOOTER}>
              <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" className={DIALOG_BTN} type="button" onClick={handleDeleteProposal} isLoading={isSubmitting}>
                Delete Proposal
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
}

/** Source-lead picker (DEF-081): the customer's open leads; "None" keeps the proposal unlinked. */
function LeadSelect({
  value,
  options,
  current,
  onChange,
}: {
  value: string;
  options: any[];
  current?: { id: string; label?: string } | null;
  onChange: (leadId: string) => void;
}) {
  const list = current && !options.some((o) => o.id === current.id) ? [{ id: current.id, label: current.label || 'Current lead' }, ...options] : options;
  return (
    <Select
      label="Source Lead / Opportunity"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={list.length ? 'The lead this quote answers — shown on the lead and in reports.' : 'This customer has no open lead you can link.'}
      options={[{ value: '', label: list.length ? 'None (not from a lead)' : 'No open leads' }, ...list.map((o) => ({ value: o.id, label: o.label || o.id }))]}
    />
  );
}

/** Commercial terms of the quote (DEF-029). Amounts in ₹, margin in %. */
function CommercialFields({
  value,
  onChange,
  quoteRequired = false,
  minValidityDate,
}: {
  value: CommercialForm;
  onChange: (patch: Partial<CommercialForm>) => void;
  quoteRequired?: boolean;
  /** A quote cannot expire before it was requested (QA BUG-026). */
  minValidityDate?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label="Quoted Value (₹)"
          inputMode="decimal"
          required={quoteRequired}
          placeholder="e.g. 12,50,000"
          className="font-mono"
          value={value.quoted_value}
          onChange={(e) => onChange({ quoted_value: e.target.value })}
          helperText={quoteRequired ? 'Required at this stage' : 'Required before review'}
        />
        <Input
          label="Quantity"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          className="font-mono"
          value={value.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
        />
        <Input
          label="Margin (%)"
          type="number"
          min={-100}
          max={100}
          step="0.01"
          inputMode="decimal"
          className="font-mono"
          value={value.margin_percent}
          onChange={(e) => onChange({ margin_percent: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          type="date"
          label="Quote Valid Until"
          min={minValidityDate}
          value={value.validity_date}
          onChange={(e) => onChange({ validity_date: e.target.value })}
        />
        <Input
          label="Payment Terms"
          placeholder="e.g. 90% on delivery, 10% after installation"
          value={value.payment_terms}
          onChange={(e) => onChange({ payment_terms: e.target.value })}
        />
        <Input
          label="Delivery Terms"
          placeholder="e.g. F.O.R destination, 60 days"
          value={value.delivery_terms}
          onChange={(e) => onChange({ delivery_terms: e.target.value })}
        />
      </div>
    </div>
  );
}
