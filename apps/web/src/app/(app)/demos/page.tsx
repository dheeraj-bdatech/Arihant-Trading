'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Box,
  Plus,
  MapPin,
  Calendar,
  ChevronRight,
  CheckCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Send,
  Sparkles,
  Users,
  Search,
  RefreshCw,
  Building,
  Layers,
  Wrench,
  BarChart3,
  History,
  Plane,
  Info,
  Check,
  X,
  TrendingUp,
  AlertCircle,
  Package,
  ExternalLink,
  FileText,
  CalendarDays,
  LayoutList,
  ClipboardList,
  Hourglass,
  CalendarCheck,
  CircleCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { type UrlParams, dropUrlParams, isUrlDay, urlPicker } from '@/lib/url-filters';
import { useOpenParam } from '@/lib/use-open-param';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { DemoCalendar } from './_lib/DemoCalendar';
import { canRead } from '@/lib/module-access';
import { canOpen } from '@/lib/route-access';
import { formatINR } from '@arihant/shared';
import { RelatedRecords } from '@/components/links/RelatedRecords';
import { CreateDemoModal } from './_lib/CreateDemoModal';
import { OrganisationPicker } from './_lib/OrganisationPicker';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  PageContainer,
  PageHeader,
  StatCard,
  StatGrid,
  SectionHeader,
  FilterMenu,
  EmptyState,
  InfoCallout,
  Checkbox, Spinner, PageLoader, FormSteps, FormSection,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, RowMenu,
  RecordList, RecordTable, RecordViews, StepTrack, formatDateIN, daysFromToday, toneFor, type BadgeProps, type RecordItem, type TrackStep, formatDateTimeIN } from '@/components/ui';

// =========================================================================
// STRUCTURED FAILURE TAXONOMY METADATA (§17 & §18)
// 9 Canonical Categories for Management Recurring Pattern Analysis
// =========================================================================
const FAILURE_REASON_METADATA: Record<
  string,
  {
    label: string;
    description: string;
    severity: 'critical' | 'high' | 'moderate';
    typicalRootCause: string;
    recommendedCountermeasure: string;
  }
> = {
  PRODUCT_LIMITATION: {
    label: 'Product limitation',
    description: 'Product specifications or physical form factor did not meet operational criteria.',
    severity: 'critical',
    typicalRootCause: 'Tender RFP required technical capabilities exceeding standard product BOM.',
    recommendedCountermeasure: 'Trigger engineering R&D feasibility review; propose custom modular variant.',
  },
  EQUIPMENT_ISSUE: {
    label: 'Equipment issue',
    description: 'Hardware calibration fault, battery exhaustion, or accessory failure during field trial.',
    severity: 'high',
    typicalRootCause: 'Depot dispatch protocol lacked full 48-hour battery burn-in and calibration pass.',
    recommendedCountermeasure: 'Mandate depot equipment custodian checklist and pack 2x hot-swappable backup batteries.',
  },
  TECHNICAL_FAILURE: {
    label: 'Technical failure',
    description: 'Unexpected sensor crash, thermal sensor blackout, or software communication disconnection.',
    severity: 'critical',
    typicalRootCause: 'Firmware stability flaw or environmental electromagnetic/RF interference.',
    recommendedCountermeasure: 'Deploy latest certified firmware patch; conduct pre-deployment RF noise audit.',
  },
  CUSTOMER_REQUIREMENT_MISMATCH: {
    label: 'Customer requirement mismatch',
    description: 'Prospect expected capabilities or integrations outside the agreed trial scope.',
    severity: 'moderate',
    typicalRootCause: 'Pre-demo technical scoping between sales rep and client procurement was vague.',
    recommendedCountermeasure: 'Mandate signed Pre-Demo Technical Questionnaire prior to equipment dispatch.',
  },
  PRICING_CONCERN: {
    label: 'Pricing concern',
    description: 'Customer found unit cost, AMC rate, or consumable pricing beyond budgetary limits.',
    severity: 'moderate',
    typicalRootCause: 'Client operating under lower departmental sanction; price-to-spec ratio perceived high.',
    recommendedCountermeasure: 'Escalate to Regional Manager for bundled GeM terms, multi-year AMC, or financing options.',
  },
  DECISION_MAKER_UNAVAILABLE: {
    label: 'Decision-maker unavailable',
    description: 'Key approving authority (SP, DIG, Procurement Director) was absent from trial.',
    severity: 'high',
    typicalRootCause: 'Sudden VIP movement or lack of senior officer calendar re-confirmation.',
    recommendedCountermeasure: 'Require 24-hour written confirmation of senior officer presence before deploying depot assets.',
  },
  COMPETITOR_PREFERENCE: {
    label: 'Competitor preference',
    description: 'Client inclined toward or heavily favored a competitor product/brand demonstrated.',
    severity: 'high',
    typicalRootCause: 'Competitor established early specification lock-in or aggressive local dealer influence.',
    recommendedCountermeasure: 'Prepare head-to-head DGQA compliance matrix and request secondary comparative trial.',
  },
  DEMO_PREPARATION_ISSUE: {
    label: 'Demo preparation issue',
    description: 'Site unprepared, inadequate target samples, test power unavailable, or lighting issues.',
    severity: 'moderate',
    typicalRootCause: 'Failure to verify site conditions (mains power, darkroom, test targets) before arrival.',
    recommendedCountermeasure: 'Equip demo vans with portable silent generators and self-contained calibration target kits.',
  },
  OTHER: {
    label: 'Other',
    description: 'Custom, environmental, or situational factors not captured by standard taxonomy.',
    severity: 'moderate',
    typicalRootCause: 'Force majeure, sudden operational dispatch of target unit, weather cancellation.',
    recommendedCountermeasure: 'Review supervisor remarks and reschedule under priority planning protocol.',
  },
};

// Demo lifecycle in workflow order — drives the status filter and the stage board lanes.
const DEMO_STATUSES: { key: string; label: string }[] = [
  // a new request waits for the demo coordinator to accept and plan it
  { key: 'requested', label: 'Approval pending' },
  { key: 'under_planning', label: 'Under planning' },
  { key: 'team_assigned', label: 'Team assigned' },
  { key: 'equipment_reserved', label: 'Equipment reserved' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'completed', label: 'Completed' },
  { key: 'rescheduled', label: 'Rescheduled' },
  { key: 'cancelled', label: 'Cancelled' },
];
// A demo's day (confirmed, else requested) as an IST calendar day; outcomes are recorded on or after it.
const demoDay = (demo: any) => calendarDay(demo?.confirmed_date || demo?.requested_date) || '';
const isDemoDayAhead = (demo: any) => demoDay(demo) > istToday();
const dmy = (day?: string | null) => {
  const d = calendarDay(day);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};
const demoStatusLabel = (status?: string) =>
  DEMO_STATUSES.find((s) => s.key === status)?.label || String(status || 'Unknown').replace(/_/g, ' ');
// Register list: demo date stays plain once the demo is closed out (same set as the card's due date).
const DEMO_DONE = ['completed', 'cancelled', 'failed', 'closed'];
// "Pending requests" = the coordinator's planning queue: open demos whose date is not (re)confirmed yet
// (MODULE_3 §4.1–4.2). Same set as DEMO_PENDING_STATUSES in demos.service.ts, which also counts it.
const DEMO_PENDING_STATUSES = ['requested', 'under_planning', 'team_assigned', 'equipment_reserved', 'rescheduled'];
const DEMOS_PAGE_SIZE = 50;
// Dashboard deep links (/demos?status=requested,confirmed&from=…&result=fail&failure_reason=…): the register's first
// filters, read from the URL before the first fetch. Unknown values are ignored; the effect in the page then drops
// these keys from the address bar. A status set (comma list) is passed to the API as is.
const DEMO_URL_KEYS = ['status', 'from', 'to', 'result', 'failure_reason'];
const demoUrlFilters = (q: UrlParams) => {
  const pick = urlPicker(q);
  const result = pick('result', (v) => ['success', 'fail', 'partial'].includes(v));
  // a failure reason only goes with a failed outcome (the Outcome menu pairs them the same way)
  const failureReason = result === '' || result === 'fail' ? pick('failure_reason', (v) => Object.keys(FAILURE_REASON_METADATA).includes(v)) : '';
  return {
    status: pick('status', (v) => v.split(',').every((s) => DEMO_STATUSES.some((d) => d.key === s))),
    from: pick('from', isUrlDay),
    to: pick('to', isUrlDay),
    result: failureReason ? 'fail' : result,
    failureReason,
  };
};
/**
 * Every page of a /demos query, for the views whose counts and client-side filters need the whole set (my demos,
 * field failures, a calendar week). The API serves at most 100 rows a page; 20 pages bound a runaway query.
 */
const fetchAllDemos = async (params: Record<string, string>): Promise<any[]> => {
  const rows: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await api.get('/demos', { ...params, page, limit: 100 });
    rows.push(...(res?.data || []));
    if (page >= (res?.totalPages || 1)) break;
  }
  return rows;
};
/** Only a technical failure quarantines the trial's units (demos.service submitOutcome). */
const isQuarantiningFailure = (demo: any) => demo?.outcome?.result === 'fail' && demo?.outcome?.failure_reason === 'TECHNICAL_FAILURE';
type BadgeVariant = NonNullable<BadgeProps['variant']>;
const DEMO_STATUS_BADGE: Record<string, BadgeVariant> = {
  requested: 'warning',
  under_planning: 'warning',
  team_assigned: 'default',
  equipment_reserved: 'default',
  confirmed: 'default',
  rescheduled: 'default',
  completed: 'success',
  cancelled: 'danger',
  failed: 'danger',
};
const demoStatusBadge = (status?: string): BadgeVariant => DEMO_STATUS_BADGE[String(status || '')] ?? 'outline';

/** A demo's stage as the pipeline board's columns: management approval, planning, date confirmed, done. */
const DemoStageTrack: React.FC<{ status?: string }> = ({ status }) => {
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E9C9B4] bg-[#FBEBDD] px-2.5 py-1 text-xs font-semibold text-[#9A3412]">
        <XCircle className="h-3.5 w-3.5" aria-hidden /> Cancelled
      </span>
    );
  }
  const steps: TrackStep[] = [
    { key: 'approval', label: status === 'requested' ? 'Approval pending' : 'Approved', icon: Hourglass },
    { key: 'planning', label: 'Planning', icon: ClipboardList },
    { key: 'confirmed', label: status === 'rescheduled' ? 'Rescheduled' : 'Confirmed', icon: CalendarCheck },
    { key: 'done', label: status === 'failed' ? 'Failed' : 'Completed', icon: CircleCheck },
  ];
  const current =
    status === 'requested' ? 0 : ['under_planning', 'team_assigned', 'equipment_reserved'].includes(String(status)) ? 1 : status === 'confirmed' || status === 'rescheduled' ? 2 : 3;
  return (
    <StepTrack
      steps={steps}
      current={current}
      tone={status === 'requested' || status === 'rescheduled' ? 'warning' : status === 'failed' ? 'danger' : 'primary'}
      complete={status === 'completed'}
      label={`Stage: ${demoStatusLabel(status)}`}
    />
  );
};

// Action row at the end of a dialog form. From `sm` up it is the plain divider row it always was (each
// dialog adds its own `sm:justify-*` / `sm:gap-*`). Phones (bottom sheet): pinned to the bottom edge of
// the sheet with the buttons sharing the width, like the FormSteps footer. `!-mb-4` beats the bottom
// margin a parent `space-y-*` puts on its children.
const SHEET_FOOTER =
  'flex items-center gap-2 border-t border-[#DCD8CE] pt-3 max-sm:sticky max-sm:-bottom-4 max-sm:z-10 max-sm:-mx-4 max-sm:!-mb-4 max-sm:bg-white max-sm:px-4 max-sm:pb-3 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1';


function DemosPageContent() {
  const { user, hasRole } = useAuth();
  // Planning, dates and direct bookings belong to coordinators; sales raise requests (mirrors the API roles).
  const isCoordinator = hasRole(['demo_team', 'management', 'regional_manager', 'admin']);
  // Management approves a new request; the demo team then fixes the date with the client (admin can override both)
  const canApprove = hasRole(['management', 'admin']);
  const canConfirmDate = hasRole(['demo_team', 'admin']);
  // Assigning a specialist is a coordinator call (POST /demos/:id/assign-team); sales only raise the request
  const canAssignTeam = hasRole(['demo_team', 'management', 'regional_manager', 'admin']);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  // Primary active tab
  const [activeTab, setActiveTab] = useState<
    'pipeline' | 'my_demos' | 'coordinator' | 'fleet' | 'analytics' | 'history' | 'failures'
  >(user?.role === 'demo_team' ? 'my_demos' : 'pipeline');

  // Sync URL search param ?tab=failures (and the other tab ids)
  useEffect(() => {
    if (
      tabParam &&
      ['pipeline', 'my_demos', 'coordinator', 'fleet', 'analytics', 'history', 'failures'].includes(tabParam)
    ) {
      setActiveTab(tabParam as any);
    }
  }, [tabParam]);

  // Expanded table rows (detail panels)
  const router = useRouter();

  // Deep link from visits, tasks and notifications: /demos?open=<demo id> shows that demo's card in a dialog.
  const [linkedDemo, setLinkedDemo] = useState<any | null>(null);
  // The open dialog's demo id, so a refresh after an action can re-read it (the dialog must never show stale actions)
  const linkedDemoId = useRef<string | null>(null);
  linkedDemoId.current = linkedDemo?.id ?? null;
  useOpenParam(async (id) => {
    const demo = await api.get(`/demos/${id}`).catch(() => null);
    if (demo) setLinkedDemo(demo);
  });

  // Dedicated Failures Tab Filter & Modal States
  const [failSearchQuery, setFailSearchQuery] = useState('');
  const [failReasonFilter, setFailReasonFilter] = useState('all');
  const [failEscortFilter, setFailEscortFilter] = useState('all');
  const [failServiceTicketFilter, setFailServiceTicketFilter] = useState('all');
  const [expandedFailId, setExpandedFailId] = useState<string | null>(null);
  const [selectedFailureDetail, setSelectedFailureDetail] = useState<any | null>(null);
  const [isFailureDetailModalOpen, setIsFailureDetailModalOpen] = useState(false);

  // Core Data States
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [serviceEngineers, setServiceEngineers] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any | null>(null);
  const [customerHistoryDemos, setCustomerHistoryDemos] = useState<any[]>([]);
  // Bumped after every reload, so views that fetch for themselves (the calendar week) re-read too
  const [dataVersion, setDataVersion] = useState(0);

  // Demos assigned to the current user, and every failed trial: filtered by the API (assigned_to / result=fail,
  // under the caller's RBAC scope) and read in full, so their counts never stop at the first page.
  const [myDemosList, setMyDemosList] = useState<any[]>([]);
  const [failedDemos, setFailedDemos] = useState<any[]>([]);

  // Filtered Failures for Management Incident Audit
  const displayedFailures = useMemo(() => {
    return failedDemos.filter((d) => {
      // Reason filter
      if (failReasonFilter !== 'all' && d.outcome?.failure_reason !== failReasonFilter) {
        return false;
      }
      // Escort filter
      if (failEscortFilter === 'escorted' && !d.service_escort_required) return false;
      if (failEscortFilter === 'unescorted' && d.service_escort_required) return false;

      // Service ticket filter
      const hasTicket = Boolean(d.service_ticket_id || d.outcome?.service_ticket_id);
      if (failServiceTicketFilter === 'ticket_logged' && !hasTicket) return false;
      if (failServiceTicketFilter === 'no_ticket' && hasTicket) return false;

      // Text search
      if (failSearchQuery) {
        const q = failSearchQuery.toLowerCase();
        const orgName = (d.organisation_name || '').toLowerCase();
        const prodName = (d.product_name || '').toLowerCase();
        const loc = (d.location || '').toLowerCase();
        const demoNo = (d.demo_no || '').toLowerCase();
        const reason = (d.outcome?.failure_reason || '').toLowerCase();
        const ticketNo = (d.service_ticket_no || d.service_ticket_id || '').toLowerCase();
        const remarks = (d.outcome?.remarks || d.outcome?.notes || '').toLowerCase();
        if (
          !orgName.includes(q) &&
          !prodName.includes(q) &&
          !loc.includes(q) &&
          !demoNo.includes(q) &&
          !reason.includes(q) &&
          !ticketNo.includes(q) &&
          !remarks.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [failedDemos, failReasonFilter, failEscortFilter, failServiceTicketFilter, failSearchQuery]);

  const [selectedHistoryOrgId, setSelectedHistoryOrgId] = useState<string>('');
  const historySeq = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Filters for Pipeline tab
  const [urlFilters] = useState(() => demoUrlFilters(searchParams));
  useEffect(() => {
    dropUrlParams(DEMO_URL_KEYS);
  }, []);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState(urlFilters.status);
  const [filterProduct, setFilterProduct] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState(urlFilters.from);
  const [filterDateTo, setFilterDateTo] = useState(urlFilters.to);
  const [filterResult, setFilterResult] = useState(urlFilters.result);
  const [filterFailureReason, setFilterFailureReason] = useState(urlFilters.failureReason);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(Boolean(urlFilters.from || urlFilters.to));

  // The register's filters, applied by the API to the list, its counts (/demos/summary) and the analytics KPIs.
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (filterSearch.trim()) params.search = filterSearch.trim();
    if (filterStatus) params.status = filterStatus;
    if (filterProduct) params.product_id = filterProduct;
    if (filterLocation) params.location = filterLocation;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    if (filterResult) params.result = filterResult;
    if (filterFailureReason) params.failure_reason = filterFailureReason;
    return params;
  }, [filterSearch, filterStatus, filterProduct, filterLocation, filterDateFrom, filterDateTo, filterResult, filterFailureReason]);

  // Pipeline register: one server page per request, appended as the register scrolls.
  const fetchPipelinePage = useCallback(
    (page: number) => api.get('/demos', { ...filterParams, page, limit: DEMOS_PAGE_SIZE }),
    [filterParams],
  );
  const pipelineList = useInfiniteList<any>(fetchPipelinePage);
  const filteredDemos = pipelineList.rows;
  // The pipeline calendar reads its visible week from the server under the same filters (any date filter narrows it)
  const loadCalendarWeek = useCallback(
    async (from: string, to: string) => {
      const lo = filterParams.date_from && filterParams.date_from > from ? filterParams.date_from : from;
      const hi = filterParams.date_to && filterParams.date_to < to ? filterParams.date_to : to;
      if (lo > hi) return [];
      return fetchAllDemos({ ...filterParams, date_from: lo, date_to: hi });
    },
    [filterParams],
  );

  // Coordinator planning queue: the pending requests under the same filters. The queue is a status set, so the
  // status filter does not narrow it (its count, summary.pending_requests, ignores it too).
  const fetchQueuePage = useCallback(
    (page: number) => {
      const { status: _status, ...rest } = filterParams;
      return api.get('/demos', { ...rest, status: DEMO_PENDING_STATUSES.join(','), page, limit: DEMOS_PAGE_SIZE });
    },
    [filterParams],
  );
  const queueList = useInfiniteList<any>(fetchQueuePage);
  const coordinatorDemos = queueList.rows;

  // Counts for the menus, view counts and KPI cards, from the server under the same filters as the list.
  const [demoSummary, setDemoSummary] = useState<any | null>(null);
  // Each search keystroke refetches: only the newest answer may land, an older slower one is dropped
  const countsSeq = useRef(0);
  const loadFilteredCounts = useCallback(async () => {
    const seq = ++countsSeq.current;
    const [summaryRes, analyticsRes] = await Promise.all([
      api.get('/demos/summary', filterParams).catch(() => null),
      canRead(user?.role, 'demoAnalytics') ? api.get('/demos/analytics', filterParams).catch(() => null) : Promise.resolve(null),
    ]);
    if (seq !== countsSeq.current) return;
    if (summaryRes) setDemoSummary(summaryRes);
    if (analyticsRes) setAnalyticsData(analyticsRes);
  }, [filterParams, user?.role]);
  useEffect(() => {
    loadFilteredCounts();
  }, [loadFilteredCounts]);

  // Live Equipment Availability Checker State
  const [availFilterProduct, setAvailFilterProduct] = useState('');
  const [availFilterLocation, setAvailFilterLocation] = useState('');
  const [availFilterDate, setAvailFilterDate] = useState(
    istToday(),
  );
  const [availabilityResults, setAvailabilityResults] = useState<any | null>(null);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);

  // Selected Demo for actions & detail
  const [selectedDemo, setSelectedDemo] = useState<any | null>(null);
  const [selectedDemoAudit, setSelectedDemoAudit] = useState<any | null>(null);

  // Modals visibility
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAssignTeamOpen, setIsAssignTeamOpen] = useState(false);
  const [isReserveEquipOpen, setIsReserveEquipOpen] = useState(false);
  const [isConfirmDateOpen, setIsConfirmDateOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isAllocateOpen, setIsAllocateOpen] = useState(false);
  // The allocate sheet doubles as "suggest an alternative" (§16): same unit picker, the requester decides.
  const [allocateMode, setAllocateMode] = useState<'allocate' | 'suggest'>('allocate');

  // Selected reservation for custodian actions
  const [selectedReservation, setSelectedReservation] = useState<any | null>(null);

  // Submitting / Error states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 2. Assign Team Form
  const [teamForm, setTeamForm] = useState({
    assigned_to: '',
    confirmed_date: '',
    travel_required: false,
    travel_from: '',
    travel_to: '',
    travel_date: '',
    travel_remarks: '',
    remarks: '',
  });

  // 3. Equipment Reservation Form
  const [reserveForm, setReserveForm] = useState({
    equipment_id: '',
    reserved_from: '',
    reserved_to: '',
    remarks: '',
  });
  const [reserveModalError, setReserveModalError] = useState<string | null>(null);
  // 409 from the API when the unit is booked for another demo: who holds it and which bid is worth more (§16).
  const [reserveConflict, setReserveConflict] = useState<any | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // A unit of another product than the demo requested is a substitute: hidden by default, and needs a reason.
  const [showOtherProducts, setShowOtherProducts] = useState(false);
  const [substituteReason, setSubstituteReason] = useState('');
  const canOverrideConflict = user?.role === 'management' || user?.role === 'admin';
  const [modalEquipmentUnits, setModalEquipmentUnits] = useState<any[]>([]);
  const [isLoadingModalEquipment, setIsLoadingModalEquipment] = useState(false);

  // 4. Confirm Date Form
  const [confirmForm, setConfirmForm] = useState({
    confirmed_date: '',
    remarks: '',
    extend_reservation: false,
  });
  // 400 DATE_OUTSIDE_RESERVATION: the confirmed day is not covered by this demo's equipment reservation.
  const [confirmError, setConfirmError] = useState<{ message: string; outsideReservation: boolean } | null>(null);

  // 5. Reschedule Form
  const [rescheduleForm, setRescheduleForm] = useState({
    new_date: '',
    reason: '',
  });

  // 6. Cancel Form
  const [cancelForm, setCancelForm] = useState({
    cancellation_reason: 'customer_cancelled',
    remarks: '',
  });

  // 7. Outcome & Structured Failure Analysis Form (9 failure categories)
  const [outcomeForm, setOutcomeForm] = useState({
    completed: true,
    result: 'success' as 'success' | 'fail' | 'partial',
    failure_reason: 'TECHNICAL_FAILURE',
    customer_response: '',
    technical_performance: '',
    product_suitability: '',
    decision_maker_present: true,
    competitor_involved: '',
    next_step: '',
    opportunity_stage: 'Proposal',
    remarks: '',
  });

  // 8. Add / Edit Equipment Form (with custodian & availability status)
  const [equipmentForm, setEquipmentForm] = useState({
    id: '',
    product_id: '',
    model: '',
    serial_no: '',
    current_location: 'Delhi',
    responsible_person: '',
    responsible_person_name: '',
    availability_status: 'available',
    condition: 'Operational',
    remarks: '',
  });

  // 9. Custodian Reject Form
  const [rejectForm, setRejectForm] = useState({
    rejection_reason: 'Unit booked for another high-priority client trial',
    remarks: '',
  });

  // 10. Custodian Allocate Alternative Unit Form
  const [allocateForm, setAllocateForm] = useState({
    equipment_id: '',
    reason: 'Primary unit undergoing scheduled maintenance; alternative operational unit allocated',
    reserved_from: '',
    reserved_to: '',
    remarks: '',
  });

  // =========================================================================
  // DATA FETCHING
  // =========================================================================

  // Unfiltered data for the other views; `withFiltered` also re-reads the filtered register, queue and counts
  // (after an action). The first load skips them: their own effects load them.
  // Re-read the demo open in the dialog after an action, so its stage, kit and actions match the server.
  const refreshLinkedDemo = async () => {
    const id = linkedDemoId.current;
    if (!id) return;
    const fresh = await api.get(`/demos/${id}`).catch(() => null);
    if (fresh) setLinkedDemo((prev: any) => (prev && prev.id === id ? fresh : prev));
  };

  const fetchDemosData = async (withFiltered = true) => {
    if (withFiltered) {
      void pipelineList.refresh();
      void queueList.refresh();
      void loadFilteredCounts();
      void refreshLinkedDemo();
      setDataVersion((v) => v + 1);
    }
    try {
      setIsLoading(true);
      setActionError(null);

      const [
        myRes,
        failedRes,
        equipRes,
        productsRes,
        teamRes,
        serviceRes,
      ] = await Promise.all([
        user?.id ? fetchAllDemos({ assigned_to: user.id }) : Promise.resolve([]),
        fetchAllDemos({ result: 'fail' }),
        api.get('/demos/equipment'),
        api.get('/masters/products'),
        api.get('/demos/team/availability').catch(() => []),
        api.get('/users', { role: 'service_team' }).catch(() => ({ data: [] })),
      ]);

      setMyDemosList(myRes);
      setFailedDemos(failedRes);
      setEquipmentList(equipRes || []);
      setProducts(productsRes || []);
      setTeamMembers(teamRes || []);
      setServiceEngineers(serviceRes.data || serviceRes || []);
    } catch (err: any) {
      console.error('Failed to load demo data:', err);
      setActionError(err.message || 'Failed to load demo data.');
    } finally {
      setIsLoading(false);
      setLoadedOnce(true);
    }
  };

  useEffect(() => {
    fetchDemosData(false);
    // re-read once the signed-in user is known (My demos is filtered by their id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Fetch Team availability whenever team modal opens or date changes
  const loadTeamAvailability = async (targetDate: string) => {
    try {
      const res = await api.get('/demos/team/availability', { date: targetDate });
      setTeamMembers(res || []);
    } catch (err) {
      console.error('Failed to load team availability:', err);
    }
  };

  // Run live availability check
  const runAvailabilityCheck = async () => {
    try {
      setIsCheckingAvailability(true);
      const res = await api.get('/demos/equipment/availability', {
        product_id: availFilterProduct || undefined,
        location: availFilterLocation || undefined,
        from_date: availFilterDate,
        to_date: availFilterDate,
      });
      setAvailabilityResults(res);
    } catch (err: any) {
      console.error('Availability check failed:', err);
    } finally {
      setIsCheckingAvailability(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'fleet') {
      runAvailabilityCheck();
    }
  }, [availFilterProduct, availFilterLocation, availFilterDate, activeTab]);

  // Handle customer history load
  const loadCustomerHistory = async (orgId: string) => {
    const seq = ++historySeq.current;
    setSelectedHistoryOrgId(orgId);
    setCustomerHistoryDemos([]);
    if (!orgId) return;
    try {
      const rows = await fetchAllDemos({ organisation_id: orgId });
      // switching customers quickly: only the last pick may fill the timeline
      if (seq === historySeq.current) setCustomerHistoryDemos(rows);
    } catch (err) {
      console.error('Failed to load customer history:', err);
    }
  };



  // Pipeline filter-row helpers
  // Locations under the other filters (server counts), plus the selected one even if nothing matches it now.
  const locationCounts: Record<string, number> = demoSummary?.by_location || {};
  const demoLocations = Array.from(new Set([...Object.keys(locationCounts), ...(filterLocation ? [filterLocation] : [])])).sort();
  const hasPipelineFilters = Boolean(
    filterSearch || filterStatus || filterProduct || filterLocation || filterDateFrom || filterDateTo || filterResult || filterFailureReason,
  );
  const clearPipelineFilters = () => {
    setFilterSearch('');
    setFilterStatus('');
    setFilterProduct('');
    setFilterLocation('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterResult('');
    setFilterFailureReason('');
  };
  const hasFailureFilters = Boolean(
    failSearchQuery || failReasonFilter !== 'all' || failEscortFilter !== 'all' || failServiceTicketFilter !== 'all',
  );






  // =========================================================================
  // ACTIONS & HANDLERS
  // =========================================================================

  const handleOpenAssignTeam = async (demo: any) => {
    setSelectedDemo(demo);
    // DATE columns arrive as serialized instants: always work with the IST calendar day (YYYY-MM-DD)
    const date = demoDay(demo);
    setTeamForm({
      assigned_to: demo.assigned_to || '',
      confirmed_date: date,
      travel_required: demo.travel_required || false,
      travel_from: demo.travel_from || 'Delhi HQ',
      travel_to: demo.travel_to || demo.location || '',
      travel_date: calendarDay(demo.travel_date) || date,
      travel_remarks: demo.travel_remarks || '',
      remarks: demo.remarks || '',
    });
    await loadTeamAvailability(date);
    setIsAssignTeamOpen(true);
  };

  const handleAssignTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemo || isSubmitting) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      // Assigning a specialist does not confirm the date: only a date the coordinator changed on an approved demo
      // is sent. Travel details go only with travel.
      const dateChanged = teamForm.confirmed_date && teamForm.confirmed_date !== demoDay(selectedDemo);
      const payload: Record<string, unknown> = {
        assigned_to: teamForm.assigned_to,
        remarks: teamForm.remarks,
        travel_required: teamForm.travel_required,
        ...(dateChanged && selectedDemo.status !== 'requested' ? { confirmed_date: teamForm.confirmed_date } : {}),
        ...(teamForm.travel_required
          ? {
              travel_from: teamForm.travel_from,
              travel_to: teamForm.travel_to,
              travel_date: calendarDay(teamForm.travel_date) || undefined,
              travel_remarks: teamForm.travel_remarks,
            }
          : {}),
      };
      await api.post(`/demos/${selectedDemo.id}/assign-team`, payload);
      setActionSuccess(`Demo team member assigned to ${selectedDemo.demo_no}.`);
      setIsAssignTeamOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to assign team member.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadModalEquipmentAvailability = async (fromDate: string, toDate: string) => {
    if (!fromDate || !toDate) return;
    try {
      setIsLoadingModalEquipment(true);
      setReserveModalError(null);
      const res = await api.get('/demos/equipment/availability', {
        from_date: fromDate,
        to_date: toDate,
      });
      setModalEquipmentUnits(res?.units || []);
    } catch (err: any) {
      console.error('Failed to load modal equipment availability:', err);
      setModalEquipmentUnits(equipmentList);
    } finally {
      setIsLoadingModalEquipment(false);
    }
  };

  const handleOpenReserve = (demo: any) => {
    setSelectedDemo(demo);
    setReserveModalError(null);
    setReserveConflict(null);
    setOverrideReason('');
    setShowOtherProducts(false);
    setSubstituteReason('');
    const dateStr = calendarDay(demo.confirmed_date || demo.requested_date) || istToday();
    setReserveForm({
      equipment_id: '',
      reserved_from: dateStr,
      reserved_to: dateStr,
      remarks: '',
    });
    setIsReserveEquipOpen(true);
    loadModalEquipmentAvailability(dateStr, dateStr);
  };

  useEffect(() => {
    if (isReserveEquipOpen && reserveForm.reserved_from && reserveForm.reserved_to) {
      if (reserveForm.reserved_from > reserveForm.reserved_to) {
        setReserveModalError('Reservation start date cannot be after end date.');
        return;
      }
      setReserveModalError(null);
      const timer = setTimeout(() => {
        loadModalEquipmentAvailability(reserveForm.reserved_from, reserveForm.reserved_to);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [reserveForm.reserved_from, reserveForm.reserved_to, isReserveEquipOpen]);

  const handleReserveSubmit = async (e: React.FormEvent | null, override = false) => {
    e?.preventDefault();
    if (!selectedDemo) return;
    setReserveModalError(null);
    setActionError(null);
    if (override && overrideReason.trim().length < 5) {
      setReserveModalError('Give a reason for overriding the existing reservation (at least 5 characters).');
      return;
    }

    const fromDate = calendarDay(reserveForm.reserved_from);
    const toDate = calendarDay(reserveForm.reserved_to) || fromDate;

    if (!fromDate || !toDate) {
      setReserveModalError('Reservation start and end dates are required.');
      return;
    }

    if (fromDate > toDate) {
      setReserveModalError('Reservation start date cannot be after end date.');
      return;
    }

    if (!reserveForm.equipment_id) {
      setReserveModalError('Please select an available fleet equipment unit.');
      return;
    }

    // Verify chosen unit status in live availability roster
    const activeRoster = modalEquipmentUnits.length > 0 ? modalEquipmentUnits : equipmentList;
    const chosenUnit = activeRoster.find((u) => u.id === reserveForm.equipment_id);

    const isSubstitute = !!(chosenUnit && selectedDemo?.product_id && chosenUnit.product_id && chosenUnit.product_id !== selectedDemo.product_id);
    if (isSubstitute && substituteReason.trim().length < 5) {
      setReserveModalError(
        `${chosenUnit.model} is a ${chosenUnit.product_name || 'different product'} unit, but this demo is for ${selectedDemo.product_name || 'another product'}. Give a reason (at least 5 characters) for sending a substitute, or pick a matching unit.`,
      );
      return;
    }

    if (chosenUnit) {
      const isAlreadyOnThisDemo = selectedDemo?.reservations?.some((r: any) => r.equipment_id === chosenUnit.id);
      if (isAlreadyOnThisDemo) {
        setReserveModalError(
          `Equipment unit ${chosenUnit.model} (${chosenUnit.serial_no || 'Unit'}) is already reserved for this demo.`,
        );
        return;
      }

      const inMaintenance = chosenUnit.effective_status === 'maintenance' || chosenUnit.availability_status === 'maintenance';
      // The roster loaded for the chosen dates already says whether the unit is free then. The unit's own
      // availability_status reads "reserved" while any booking of it runs, so it only counts when that roster has not
      // loaded — otherwise the picker offers a unit this check then refuses (QA BUG-029).
      const isUnavailable =
        !chosenUnit.is_available_for_dates ||
        chosenUnit.effective_status === 'reserved' ||
        (modalEquipmentUnits.length === 0 && chosenUnit.availability_status === 'reserved') ||
        inMaintenance;

      // A unit booked for another demo goes to the server, which compares the two bids' values and lets
      // management override in favour of the higher-value one. Units in maintenance are never bookable.
      if (inMaintenance || (isUnavailable && !canOverrideConflict)) {
        setReserveModalError(
          `Equipment unit ${chosenUnit.model} (${chosenUnit.serial_no || 'Unit'}) is already reserved for the chosen date window (${dmy(fromDate)} to ${dmy(toDate)}). Please select an available unit.`,
        );
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await api.post(`/demos/${selectedDemo.id}/reserve`, {
        ...reserveForm,
        reserved_from: fromDate,
        reserved_to: toDate,
        ...(override ? { override_conflict: true, override_reason: overrideReason.trim() } : {}),
        ...(isSubstitute ? { product_mismatch_reason: substituteReason.trim() } : {}),
      });
      setReserveConflict(null);

      if (res.location_mismatch) {
        setActionSuccess(
          `Demo Unit Reserved! NOTE: Equipment is located in ${res.equipment_location}, while Demo is in ${res.demo_location}. Depot transit planning recorded.`,
        );
      } else {
        setActionSuccess(`Equipment unit reserved for ${selectedDemo.demo_no}.`);
      }
      setIsReserveEquipOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.priority_analysis) setReserveConflict(err.data);
      setReserveModalError(err.message || 'Failed to reserve equipment unit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Custodian Approve Reservation
  const handleApproveReservation = async (reservation: any) => {
    if (isSubmitting) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/demos/reservations/${reservation.id}/approve`, {
        remarks: 'Approved by depot equipment custodian',
      });
      setActionSuccess(
        `Equipment reservation for ${reservation.model} (${reservation.serial_no || 'unit'}) approved.`,
      );
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to approve reservation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Custodian Open Reject Modal
  const handleOpenReject = (reservation: any, demo: any) => {
    setSelectedReservation(reservation);
    setSelectedDemo(demo);
    setRejectForm({
      rejection_reason: 'Unit booked for another high-priority client trial',
      remarks: '',
    });
    setIsRejectOpen(true);
  };

  // Custodian Reject Reservation Submit
  const handleRejectReservationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReservation) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/demos/reservations/${selectedReservation.id}/reject`, rejectForm);
      setActionSuccess(`Reservation rejected: ${rejectForm.rejection_reason}`);
      setIsRejectOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to reject reservation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Custodian Open Allocate Alternative Unit Modal
  const handleOpenAllocate = (reservation: any, demo: any, mode: 'allocate' | 'suggest' = 'allocate') => {
    setSelectedReservation(reservation);
    setSelectedDemo(demo);
    setAllocateMode(mode);
    setAllocateForm({
      // Accepting a suggestion pre-selects the suggested unit.
      equipment_id: mode === 'allocate' && reservation.status === 'alternative_suggested' ? reservation.alternative_equipment_id || '' : '',
      reason: '',
      // DATE columns arrive as serialized instants: the inputs and the API take the IST calendar day
      reserved_from: calendarDay(reservation.reserved_from) || demoDay(demo),
      reserved_to: calendarDay(reservation.reserved_to) || calendarDay(reservation.reserved_from) || demoDay(demo),
      remarks: '',
    });
    setIsAllocateOpen(true);
  };

  // §14: coordinator picks a new request up — Requested → Under Planning.
  const handleStartPlanning = async (demo: any) => {
    // a double click must not send a second approval (the API would answer it with an error)
    if (isSubmitting) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/demos/${demo.id}/start-planning`, {});
      setActionSuccess(`Demo request ${demo.demo_no} approved. ${demo.requested_by_name || 'The salesperson'} has been notified and it is now under planning.`);
      // keep an open demo dialog in step with the list
      setLinkedDemo((prev: any) => (prev && prev.id === demo.id ? { ...prev, status: 'under_planning' } : prev));
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Could not approve the request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Custodian Allocate Alternative Unit Submit
  const handleAllocateAnotherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReservation || !allocateForm.equipment_id) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      if (allocateMode === 'suggest') {
        await api.post(`/demos/reservations/${selectedReservation.id}/alternative`, {
          alternative_equipment_id: allocateForm.equipment_id,
          alternative_reason: allocateForm.reason,
        });
        setActionSuccess('Alternative unit suggested to the requester.');
        setIsAllocateOpen(false);
        await fetchDemosData();
        return;
      }
      await api.post(`/demos/reservations/${selectedReservation.id}/allocate`, {
        ...allocateForm,
        reserved_from: calendarDay(allocateForm.reserved_from) || undefined,
        reserved_to: calendarDay(allocateForm.reserved_to) || undefined,
      });
      setActionSuccess('Alternative depot equipment unit successfully allocated.');
      setIsAllocateOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to allocate alternative unit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemo) return;
    setActionError(null);
    setIsSubmitting(true);

    setConfirmError(null);
    try {
      if ((calendarDay(confirmForm.confirmed_date) || '') < istToday()) {
        throw new Error('The confirmed demo date is in the past. Choose today or a later date.');
      }
      await api.post(`/demos/${selectedDemo.id}/confirm`, {
        confirmed_date: confirmForm.confirmed_date,
        remarks: confirmForm.remarks,
        ...(confirmForm.extend_reservation ? { extend_reservation: true } : {}),
      });
      setActionSuccess(`Demonstration date confirmed for ${selectedDemo.demo_no}.`);
      setIsConfirmDateOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setConfirmError({
        message: err.message || 'Failed to confirm date.',
        outsideReservation: err?.data?.code === 'DATE_OUTSIDE_RESERVATION',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemo) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/demos/${selectedDemo.id}/reschedule`, rescheduleForm);
      setActionSuccess(`Demo ${selectedDemo.demo_no} rescheduled to ${dmy(rescheduleForm.new_date)}.`);
      setIsRescheduleOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to reschedule demo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemo) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/demos/${selectedDemo.id}/cancel`, cancelForm);
      setActionSuccess(`Demo ${selectedDemo.demo_no} cancelled. Equipment & team reservations released.`);
      setIsCancelOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel demo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenOutcome = (demo: any) => {
    // An outcome describes a trial that has happened: only on or after the demo day (IST).
    if (!demo.outcome && isDemoDayAhead(demo)) {
      setActionError(`Demo ${demo.demo_no} is scheduled for ${dmy(demoDay(demo))}. Its outcome can only be recorded on or after that date.`);
      return;
    }
    setSelectedDemo(demo);
    if (demo.outcome) {
      setOutcomeForm({
        completed: demo.outcome.completed ?? true,
        result: demo.outcome.result || 'success',
        failure_reason: demo.outcome.failure_reason || 'TECHNICAL_FAILURE',
        customer_response: demo.outcome.customer_response || '',
        technical_performance: demo.outcome.technical_performance || '',
        product_suitability: demo.outcome.product_suitability || '',
        decision_maker_present: demo.outcome.decision_maker_present ?? true,
        competitor_involved: demo.outcome.competitor_involved || '',
        next_step: demo.outcome.next_step || '',
        opportunity_stage: demo.outcome.opportunity_stage || 'Proposal',
        remarks: demo.outcome.remarks || '',
      });
    } else {
      setOutcomeForm({
        completed: true,
        result: 'success',
        failure_reason: 'TECHNICAL_FAILURE',
        // No pre-written narrative: what the team enters is what feeds the failure analysis / auto-ticket.
        customer_response: '',
        technical_performance: '',
        product_suitability: '',
        decision_maker_present: true,
        competitor_involved: '',
        next_step: '',
        opportunity_stage: 'Proposal',
        remarks: '',
      });
    }
    setIsOutcomeOpen(true);
  };

  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemo) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (outcomeForm.result === 'fail' && !outcomeForm.technical_performance.trim() && !outcomeForm.remarks.trim()) {
        throw new Error('Describe what went wrong in the trial (technical performance or remarks) when the demo was unsuccessful.');
      }
      // A failure reason belongs to a failed trial only (the form keeps a default for when "fail" is picked)
      const { failure_reason, ...rest } = outcomeForm;
      await api.post(`/demos/${selectedDemo.id}/outcome`, rest.result === 'fail' ? outcomeForm : rest);
      setActionSuccess(`Demo ${selectedDemo.demo_no} marked completed and outcome logged.`);
      setIsOutcomeOpen(false);
      await fetchDemosData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit demo outcome.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAudit = async (demo: any) => {
    setSelectedDemo(demo);
    try {
      const res = await api.get(`/demos/${demo.id}/audit`);
      setSelectedDemoAudit(res);
      setIsAuditOpen(true);
    } catch (err) {
      console.error('Failed to load audit trail:', err);
    }
  };

  const handleSaveEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      const { id: _id, responsible_person_name: _name, ...formFields } = equipmentForm;
      const equipPayload: any = {
        ...formFields,
        product_id: equipmentForm.product_id || undefined,
        responsible_person: equipmentForm.responsible_person || undefined,
        condition: equipmentForm.condition || undefined,
        remarks: equipmentForm.remarks || undefined,
      };
      Object.keys(equipPayload).forEach((k) => {
        if (equipPayload[k] === '') delete equipPayload[k];
      });

      if (equipmentForm.id) {
        await api.patch(`/demos/equipment/${equipmentForm.id}`, equipPayload);
        setActionSuccess(`Equipment unit ${equipmentForm.serial_no} updated.`);
      } else {
        await api.post('/demos/equipment', equipPayload);
        setActionSuccess(`New equipment unit ${equipmentForm.serial_no} added to depot fleet.`);
      }
      setIsEquipmentModalOpen(false);
      await fetchDemosData();
      await runAvailabilityCheck();
    } catch (err: any) {
      setActionError(err.message || 'Failed to save equipment unit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper status badge styling
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'requested':
        return <Badge variant="warning">APPROVAL PENDING</Badge>;
      case 'under_planning':
        return <Badge variant="info">UNDER PLANNING</Badge>;
      case 'confirmed':
        return <Badge variant="cyber">CONFIRMED</Badge>;
      case 'equipment_reserved':
        return <Badge variant="info">EQUIPMENT RESERVED</Badge>;
      case 'team_assigned':
        return <Badge variant="info">TEAM ASSIGNED</Badge>;
      case 'completed':
        return <Badge variant="success">COMPLETED</Badge>;
      case 'cancelled':
        return <Badge variant="danger">CANCELLED</Badge>;
      case 'rescheduled':
        return <Badge variant="outline">RESCHEDULED</Badge>;
      default:
        return <Badge>{status.toUpperCase()}</Badge>;
    }
  };

  // Clean date formatter to eliminate raw ISO strings
  const formatDemoDate = (dateVal?: string | null, includeTime: boolean = false) => {
    if (!dateVal) return 'TBD';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return dateVal;
      // A calendar day (DATE columns arrive as serialized instants): format its IST day, never the browser's
      const dayVal = includeTime ? '' : calendarDay(dateVal);
      if (dayVal) {
        const [year, month, day] = dayVal.split('-').map(Number);
        const parsed = new Date(year, month - 1, day);
        return parsed.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }
      if (includeTime) {
        return d.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateVal;
    }
  };

  const openConfirmDate = (demo: any) => {
    setSelectedDemo(demo);
    const day = demoDay(demo);
    setConfirmForm({
      confirmed_date: day && day >= istToday() ? day : istToday(),
      remarks: demo.remarks || '',
      extend_reservation: false,
    });
    setConfirmError(null);
    setIsConfirmDateOpen(true);
  };

  const openRescheduleDemo = (demo: any) => {
    setSelectedDemo(demo);
    setRescheduleForm({
      new_date: demoDay(demo) || istToday(),
      reason: '',
    });
    setIsRescheduleOpen(true);
  };

  const openCancelDemo = (demo: any) => {
    setSelectedDemo(demo);
    setCancelForm({ cancellation_reason: 'customer_cancelled', remarks: '' });
    setIsCancelOpen(true);
  };

  // Unified, high-fidelity Demonstration Card for both "Demo Pipeline & Requests" and "My Demos"
  // Cross-module chips on a demo card: the tender it supports, the lead it came from, its customer and any service ticket.
  const renderDemoLinks = (demo: any) => {
    const role = user?.role;
    const chip = 'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 sm:py-0.5 rounded-full border';
    const linkChip = `${chip} bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/25 hover:underline`;
    const plainChip = `${chip} bg-[#FBFAF7] text-[#4A5568] border-[#DCD8CE]`;
    const follow = (href: string) => (canOpen(role, href) ? href : null);
    const items: { key: string; label: string; href: string | null }[] = [
      demo.tender_id && { key: 'tender', label: `Tender ${demo.tender_no || ''}`.trim(), href: follow(`/tenders?highlight=${demo.tender_id}`) },
      demo.lead_id && { key: 'lead', label: 'From lead', href: follow(`/leads?open=${demo.lead_id}`) },
      demo.service_ticket_id && { key: 'ticket', label: `Ticket ${demo.service_ticket_no || ''}`.trim(), href: follow(`/service?open=${demo.service_ticket_id}`) },
    ].filter(Boolean) as any[];
    if (!items.length && !demo.deal_value) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {items.map((it) =>
          it.href ? (
            <Link key={it.key} href={it.href} className={linkChip}>
              {it.label}
            </Link>
          ) : (
            <span key={it.key} className={plainChip}>
              {it.label}
            </span>
          ),
        )}
        {demo.deal_value ? <span className={`${plainChip} font-mono`}>Deal value {formatINR(Number(demo.deal_value))}</span> : null}
      </div>
    );
  };

  // The demo dialog's body: approval banner, stage, the facts at a glance, kit bookings and the outcome.
  const renderDemoCard = (demo: any) => (
    <div key={demo.id} className="space-y-4">
      {/* A new request is the demo team's to approve: the decision sits on top, not inside the Actions menu */}
      {demo.status === 'requested' && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#E9C9B4] bg-[#FFF8EB] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#7C2D12]">
              {canApprove ? 'This demo request is waiting for your approval' : 'Waiting for management approval'}
            </p>
            <p className="text-[11px] text-[#4A5568]">
              {canApprove
                ? `Requested by ${demo.requested_by_name || 'sales'} for ${formatDemoDate(demo.requested_date)}. Approving notifies them and hands the date to the demo team.`
                : canConfirmDate
                  ? 'Once management approves it, you can confirm the date with the client.'
                  : 'Management will approve it, then the demo team confirms the date. You will get a notification.'}
            </p>
          </div>
          {canApprove && (
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="ghost" className="text-[#9A3412]" onClick={() => openCancelDemo(demo)}>
                Decline
              </Button>
              <Button type="button" size="sm" variant="primary" isLoading={isSubmitting} leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => handleStartPlanning(demo)}>
                Approve request
              </Button>
            </div>
          )}
        </div>
      )}
      {/* Where it stands (the pipeline's columns) and what kind of trip it is */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DemoStageTrack status={demo.status} />
        <div className="flex flex-wrap items-center gap-1.5">
          {demo.visit_id && <Badge variant="info" size="sm"><MapPin className="mr-1 h-3 w-3" />From visit</Badge>}
          {demo.travel_required && <Badge variant="info" size="sm"><Plane className="mr-1 h-3 w-3" />Travel</Badge>}
          {demo.service_escort_required && <Badge variant="info" size="sm"><Wrench className="mr-1 h-3 w-3" />Service escort</Badge>}
        </div>
      </div>
      {renderDemoLinks(demo)}

      {/* The plan at a glance: the day on the left; where, who and what kit beside it; the brief underneath */}
      {(() => {
        const label = 'text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]';
        const day = calendarDay(demo.confirmed_date || demo.requested_date);
        const open = demo.status !== 'completed' && demo.status !== 'cancelled';
        const dd = open ? daysFromToday(day) : null;
        const when = day ? new Date(`${day}T00:00:00+05:30`) : null;
        const part = (o: Intl.DateTimeFormatOptions) => (when ? when.toLocaleDateString('en-GB', { ...o, timeZone: 'Asia/Kolkata' }) : '');
        const reservations: any[] = demo.reservations || [];
        const booked = reservations.filter((r) => r.status === 'approved');
        const pending = reservations.some((r) => r.status === 'requested');
        const facts = [
          {
            key: 'where',
            icon: <MapPin className="h-4 w-4" />,
            label: 'Location',
            value: demo.location || demo.city || '—',
            sub: demo.expected_audience ? `Audience of ${demo.expected_audience}` : null,
          },
          {
            key: 'who',
            icon: <Users className="h-4 w-4" />,
            label: 'Demo specialist',
            value: demo.assignee_name || 'Not assigned yet',
            missing: !demo.assignee_name,
            sub: `Requested by ${demo.requested_by_name || 'sales'}`,
          },
          {
            key: 'kit',
            icon: <Package className="h-4 w-4" />,
            label: 'Equipment',
            value: demo.product_name || demo.equipment_required || '—',
            sub: booked.length ? (
              <Badge size="sm" variant="success">Kit: {booked.map((r) => r.serial_no || r.model).join(', ')}</Badge>
            ) : pending ? (
              <Badge size="sm" variant="warning">Kit approval pending</Badge>
            ) : open ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge size="sm" variant="warning">No kit reserved</Badge>
                <button type="button" onClick={() => handleOpenReserve(demo)} className="text-[11px] font-semibold text-[#0F5E63] hover:underline">
                  {isCoordinator ? 'Reserve unit' : 'Request unit'}
                </button>
              </span>
            ) : (
              'No kit was reserved'
            ),
          },
        ];
        const brief = [
          demo.purpose && { label: 'Purpose', value: demo.purpose },
          demo.special_requirements && { label: 'Site needs', value: demo.special_requirements },
        ].filter(Boolean) as { label: string; value: string }[];
        return (
          <div className="overflow-hidden rounded-[14px] border border-[#DCD8CE] bg-white">
            <div className="flex flex-col sm:flex-row">
              <div className="m-3 mb-0 flex items-center justify-between gap-3 rounded-[12px] bg-[#E3EFEE] px-4 py-3 sm:mb-3 sm:mr-0 sm:w-40 sm:shrink-0 sm:flex-col sm:items-start sm:justify-center">
                <div>
                  <div className={`${label} !text-[#0B4A4E]`}>{demo.confirmed_date ? 'Confirmed date' : 'Requested date'}</div>
                  {when ? (
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="font-serif text-3xl font-bold leading-none text-[#14213D]">{part({ day: 'numeric' })}</span>
                      <span className="font-mono text-xs font-semibold uppercase text-[#14213D]">{part({ month: 'short', year: 'numeric' })}</span>
                    </div>
                  ) : (
                    <div className="mt-1 font-mono text-sm font-semibold text-[#14213D]">TBD</div>
                  )}
                </div>
                {when && (
                  <div className="flex flex-col items-end gap-1 sm:items-start">
                    <span className="text-xs font-medium text-[#0B4A4E]">{part({ weekday: 'long' })}</span>
                    {dd !== null && (
                      <Badge size="sm" variant={dd <= 0 ? 'urgent' : dd <= 3 ? 'warning' : 'info'}>
                        {dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : dd > 0 ? `In ${dd} days` : `${-dd} day${dd === -1 ? '' : 's'} ago`}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <dl className="grid min-w-0 flex-1 grid-cols-1 divide-y divide-[#ECE9E2] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] sm:divide-x sm:divide-y-0">
                {facts.map((f) => (
                  <div key={f.key} className="flex min-w-0 gap-2.5 px-4 py-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] text-[#0F5E63]">{f.icon}</span>
                    <div className="min-w-0 space-y-0.5">
                      <dt className={label}>{f.label}</dt>
                      <dd className={`line-clamp-2 text-sm font-semibold ${f.missing ? 'text-[#9A3412]' : 'text-[#14213D]'}`} title={typeof f.value === 'string' ? f.value : undefined}>
                        {f.value}
                      </dd>
                      {f.sub && <dd className="text-[11px] text-[#4A5568]">{f.sub}</dd>}
                    </div>
                  </div>
                ))}
              </dl>
            </div>
            {brief.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-[#ECE9E2] px-4 py-3 text-sm">
                {brief.map((b) => (
                  <React.Fragment key={b.label}>
                    <dt className={`${label} pt-0.5`}>{b.label}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words text-[#14213D]">{b.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </div>
        );
      })()}

      {/* Reschedule / Cancellation Banner if applicable */}
      {demo.reschedule_reason && (
        <div className="p-2.5 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-xs text-[#7C2D12] flex items-center gap-2">
          <Clock className="h-4 w-4 text-[#9A3412] flex-shrink-0" />
          <span>
            <strong>Rescheduled from {formatDemoDate(demo.rescheduled_from)}:</strong>{' '}
            {demo.reschedule_reason}
          </span>
        </div>
      )}

      {demo.cancellation_reason && (
        <div className="p-2.5 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D] flex items-center gap-2">
          <XCircle className="h-4 w-4 text-[#881337] flex-shrink-0" />
          <span>
            <strong>Cancellation Reason:</strong> {demo.cancellation_reason}
          </span>
        </div>
      )}

      {/* Equipment Bookings & Custodian Status (§16) */}
      {demo.reservations && demo.reservations.length > 0 ? (
        <div className="space-y-2 border-t border-[#ECE9E2] pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-[#14213D] flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-[#0F5E63]" />
              Equipment Reservations & Custodian Status ({demo.reservations.length})
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {demo.reservations.map((res: any) => (
              <div
                key={res.id}
                className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-xs flex flex-col justify-between gap-2"
              >
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2 sm:items-center">
                    <span className="min-w-0 font-semibold text-[#14213D]">
                      {res.model} — {res.serial_no || 'Unserialized'}
                    </span>
                    {res.status === 'approved' && <Badge variant="success" className="shrink-0">APPROVED</Badge>}
                    {res.status === 'requested' && <Badge variant="warning" className="shrink-0">AWAITING CUSTODIAN</Badge>}
                    {res.status === 'rejected' && <Badge variant="danger" className="shrink-0">REJECTED</Badge>}
                    {res.status === 'alternative_suggested' && <Badge variant="info" className="shrink-0">ALTERNATIVE SUGGESTED</Badge>}
                    {res.status === 'cancelled' && <Badge variant="outline" className="shrink-0">CANCELLED</Badge>}
                  </div>
                  <p className="text-[11px] text-[#4A5568]">
                    Depot: <strong>{res.current_location}</strong> • Window: {formatDemoDate(res.reserved_from)} to {formatDemoDate(res.reserved_to)}
                  </p>
                  {res.approved_by_name && (
                    <p className="text-[11px] text-[#0B4A4E]">
                      Approved by: {res.approved_by_name}
                    </p>
                  )}
                  {/* the API keeps the custodian's reason (rejection, suggestion or reallocation) in alternative_reason */}
                  {res.alternative_reason && (
                    <p className={`text-[11px] ${res.status === 'rejected' ? 'text-[#700F2D]' : 'text-[#0B4A4E]'}`}>
                      {res.status === 'rejected' ? 'Rejection' : 'Reason'}: {res.alternative_reason}
                    </p>
                  )}
                  {res.alt_model && (
                    <p className="text-[11px] text-[#0B4A4E]">
                      Alt Unit: {res.alt_model} ({res.alt_serial_no || 'N/A'}) @ {res.alt_location}
                    </p>
                  )}
                </div>

                {/* Custodian actions if requested */}
                {res.status === 'alternative_suggested' && hasRole(['demo_team', 'service_team', 'management', 'regional_manager', 'admin']) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#ECE9E2]">
                    <Button variant="outline" size="xs" className="h-9 flex-auto sm:h-7 sm:flex-none" onClick={() => handleOpenAllocate(res, demo)}>
                      Allocate Suggested Unit
                    </Button>
                  </div>
                )}
                {res.status === 'requested' &&
                  hasRole(['demo_team', 'service_team', 'management', 'regional_manager', 'admin']) && (
                    // phones: the three custodian actions share the row as 36px targets
                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#ECE9E2]">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleApproveReservation(res)}
                        className="h-9 flex-auto sm:h-7 sm:flex-none bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3] hover:bg-[#E3EFEE]"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleOpenAllocate(res, demo)}
                        className="h-9 flex-auto sm:h-7 sm:flex-none bg-[#E3EFEE] text-[#0F5E63] border-[#D0E5E3] hover:bg-[#E3EFEE]"
                      >
                        Allocate Alt Unit
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleOpenAllocate(res, demo, 'suggest')}
                        className="h-9 flex-auto sm:h-7 sm:flex-none"
                      >
                        Suggest Alternative
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleOpenReject(res, demo)}
                        className="h-9 flex-auto sm:h-7 sm:flex-none bg-[#FCE8EC] text-[#700F2D] border-[#F3C7CF] hover:bg-[#FCE8EC]"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Demo Outcome Banner (§17 & §18) - 9 Specifications Captured */}
      {demo.outcome && (
        <div
          className={`p-3.5 rounded-xl border text-xs space-y-2.5 ${
            demo.outcome.result === 'success'
              ? 'bg-[#E3EFEE]/60 border-[#D0E5E3] text-[#0B4A4E]'
              : demo.outcome.result === 'fail'
              ? 'bg-[#FCE8EC]/60 border-[#F3C7CF] text-[#700F2D]'
              : 'bg-[#FFF8EB]/60 border-[#E9C9B4] text-[#7C2D12]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                  demo.outcome.result === 'success'
                    ? 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]'
                    : demo.outcome.result === 'fail'
                    ? 'bg-[#FCE8EC] text-[#700F2D] border-[#F3C7CF]'
                    : 'bg-[#FBEBDD] text-[#7C2D12] border-[#E9C9B4]'
                }`}
              >
                {demo.outcome.result === 'success'
                  ? 'Trial Result: Pass'
                  : demo.outcome.result === 'fail'
                  ? 'Trial Result: Fail / Deficiency'
                  : 'Trial Result: Partial'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/90 border border-[#DCD8CE] text-[#14213D]">
                Opportunity Stage: {demo.outcome.opportunity_stage || 'Not set'}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  demo.outcome.completed
                    ? 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]'
                    : 'bg-[#ECE9E2] text-[#4A5568] border-[#DCD8CE]'
                }`}
              >
                {demo.outcome.completed ? '✓ Demo Completed on Site' : '⚠ Incomplete / Cut Short'}
              </span>
            </div>

            <div>
              {demo.outcome.decision_maker_present ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[11px] text-[#0B4A4E] bg-[#E3EFEE]/70 px-2 py-0.5 rounded-full border border-[#D0E5E3]">
                  <CheckCircle2 className="h-3 w-3" />
                  Decision-Maker Attended
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-[11px] text-[#4A5568] bg-[#ECE9E2] px-2 py-0.5 rounded-full border border-[#DCD8CE]">
                  Decision-Maker Absent
                </span>
              )}
            </div>
          </div>

          {demo.outcome.result === 'fail' && demo.outcome.failure_reason && (
            <div className="p-2 rounded-lg bg-[#FCE8EC]/80 border border-[#F3C7CF] text-[#700F2D] flex flex-wrap items-center justify-between gap-1 text-[11px]">
              <span className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-[#881337] shrink-0" />
                <span>
                  Failure Reason:{' '}
                  {FAILURE_REASON_METADATA[demo.outcome.failure_reason]?.label ||
                    demo.outcome.failure_reason.replace(/_/g, ' ')}
                </span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white text-[#700F2D] border border-[#F3C7CF]">
                {demo.outcome.failure_reason}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px] pt-1 text-[#14213D]">
            {demo.outcome.customer_response && (
              <div className="bg-white/80 p-2 rounded-lg border border-[#DCD8CE]">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">
                  Customer Response
                </span>
                <span className="font-medium text-[#14213D]">{demo.outcome.customer_response}</span>
              </div>
            )}
            {demo.outcome.technical_performance && (
              <div className="bg-white/80 p-2 rounded-lg border border-[#DCD8CE]">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">
                  Technical Performance
                </span>
                <span className="font-medium text-[#14213D]">{demo.outcome.technical_performance}</span>
              </div>
            )}
            {demo.outcome.product_suitability && (
              <div className="bg-white/80 p-2 rounded-lg border border-[#DCD8CE]">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">
                  Product Suitability
                </span>
                <span className="font-medium text-[#14213D]">{demo.outcome.product_suitability}</span>
              </div>
            )}
            {demo.outcome.competitor_involved && (
              <div className="bg-white/80 p-2 rounded-lg border border-[#DCD8CE]">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">
                  Competitor Involved
                </span>
                <span className="font-medium text-[#14213D]">{demo.outcome.competitor_involved}</span>
              </div>
            )}
            {demo.outcome.next_step && (
              <div className="bg-white/80 p-2 rounded-lg border border-[#DCD8CE]">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">
                  Next Commercial Step
                </span>
                <span className="font-medium text-[#14213D]">{demo.outcome.next_step}</span>
              </div>
            )}
            {demo.outcome.remarks && (
              <div className="bg-white/80 p-2 rounded-lg border border-[#DCD8CE]">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">
                  Remarks / Field Notes
                </span>
                <span className="font-medium text-[#14213D]">{demo.outcome.remarks}</span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );

  // Pinned to the bottom of the demo dialog: history on the left; the next step and every other action (pencil) on the right
  const renderDemoFooter = (demo: any) => {
    const open = demo.status !== 'completed' && demo.status !== 'cancelled';
    // a new request's decision already sits in the approval banner
    const next = demo.status === 'requested' ? undefined : toDemoRecord(demo).primary;
    return (
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex items-center justify-between gap-2 border-t border-[#ECE9E2] bg-white px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5">
        {/* phones: the history button is just its icon so the next step and Actions keep one line */}
        <Button variant="ghost" size="sm" className="shrink-0" leftIcon={<History className="h-4 w-4" />} onClick={() => handleOpenAudit(demo)} aria-label="Audit trail">
          <span className="hidden sm:inline">Audit trail</span>
        </Button>
        <div className="flex min-w-0 items-center gap-2 [&>.row-menu__btn]:shrink-0 [&>.row-menu__btn]:whitespace-nowrap">
          {/* a step that is not open yet reads as a note, not a greyed-out button */}
          {next?.disabled ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-[#4A5568]">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">Outcome opens {formatDemoDate(demoDay(demo))}</span>
            </span>
          ) : next ? (
            <Button size="sm" variant="primary" onClick={next.onClick}>
              {next.label}
            </Button>
          ) : null}
              <RowMenu
                label="Demo actions"
                buttonLabel="Actions"
                items={[
                  {
                    key: 'assign',
                    label: demo.assigned_to ? 'Change Team' : 'Assign Team',
                    icon: <Users />,
                    hidden: !(open && hasRole(['demo_team', 'management', 'regional_manager', 'admin'])),
                    onSelect: () => handleOpenAssignTeam(demo),
                  },
                  {
                    key: 'plan',
                    label: 'Approve Request',
                    icon: <ClipboardList />,
                    hidden: !(demo.status === 'requested' && canApprove),
                    onSelect: () => handleStartPlanning(demo),
                  },
                  {
                    key: 'reserve',
                    label: !isCoordinator ? 'Request Unit' : demo.reservations && demo.reservations.length > 0 ? 'Manage Kit & Serials' : 'Reserve Unit',
                    icon: <Package />,
                    hidden: !open,
                    onSelect: () => handleOpenReserve(demo),
                  },
                  { key: 'confirm', label: 'Confirm Date', icon: <CheckCircle2 />, hidden: !(open && canConfirmDate && demo.status !== 'requested'), onSelect: () => openConfirmDate(demo) },
                  // §14: a request still waiting for management approval is not rescheduled (the API refuses it)
                  { key: 'resched', label: 'Reschedule', icon: <Clock />, hidden: !(open && isCoordinator && demo.status !== 'requested'), onSelect: () => openRescheduleDemo(demo) },
                  {
                    key: 'outcome',
                    label: isDemoDayAhead(demo) ? `Record Outcome (from ${dmy(demoDay(demo))})` : 'Record Outcome',
                    icon: <ShieldCheck />,
                    // the API records an outcome only for a confirmed demo (approved, date agreed with the client)
                    hidden: !(open && demo.status === 'confirmed'),
                    disabled: isDemoDayAhead(demo),
                    onSelect: () => handleOpenOutcome(demo),
                  },
                  { key: 'cancel', label: 'Cancel Demo', icon: <X />, danger: true, hidden: !open, onSelect: () => openCancelDemo(demo) },
                ]}
              />
        </div>
      </div>
    );
  };

  const renderCoordinatorCard = (demo: any) => (
    <Card key={demo.id} className="p-4 sm:p-5 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs hover:border-[#0F5E63] transition-all">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-[#0F5E63] px-2 py-0.5 rounded bg-[#E3EFEE] border border-[#DCD8CE]">
              {demo.demo_no}
            </span>
            <h4 className="min-w-0 font-bold text-[#14213D]">{demo.organisation_name}</h4>
            {renderStatusBadge(demo.status)}
          </div>
          <div className="text-xs text-[#4A5568] mt-2 space-y-1">
            <p>
              <strong className="text-[#14213D]">Site Location:</strong> {demo.location || 'Client Proving Ground'}
            </p>
            <p>
              <strong className="text-[#14213D]">Product:</strong> {demo.product_name || 'Security Scanning Unit'}
            </p>
            <p>
              <strong className="text-[#14213D]">Requested Date:</strong> {formatDemoDate(demo.requested_date)}
            </p>
            <p>
              <strong className="text-[#14213D]">Purpose:</strong> {demo.purpose || 'Qualify tender criteria'}
            </p>
          </div>
        </div>
  
        {/* phones: 40px buttons that fill the row (Confirm Date, the primary, ends up full width) */}
        <div className="flex flex-wrap items-center gap-2">
          {canAssignTeam && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenAssignTeam(demo)}
              className="h-10 flex-auto sm:h-8 sm:flex-none text-xs border-[#DCD8CE] text-[#0B4A4E] hover:bg-[#E3EFEE]"
            >
              <Users className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
              {demo.assigned_to ? 'Change Team' : 'Assign Team'}
            </Button>
          )}
  
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenReserve(demo)}
            className="h-10 flex-auto sm:h-8 sm:flex-none text-xs border-[#DCD8CE] text-[#7C2D12] hover:bg-[#FFF8EB]"
          >
            <Package className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />
            Reserve Depot Unit
          </Button>
  
          {demo.status === 'requested' ? (
            canApprove && (
              <Button variant="primary" size="sm" isLoading={isSubmitting} onClick={() => handleStartPlanning(demo)} className="h-10 flex-auto sm:h-8 sm:flex-none text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Approve request
              </Button>
            )
          ) : (
            canConfirmDate && (
              <Button variant="primary" size="sm" onClick={() => openConfirmDate(demo)} className="h-10 flex-auto sm:h-8 sm:flex-none text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Confirm Date
              </Button>
            )
          )}
        </div>
      </div>
  
      {/* Coordinator View of Reservations (§16) */}
      {demo.reservations && demo.reservations.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#E3EFEE] space-y-2">
          <span className="text-xs font-bold text-[#14213D] flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-[#0F5E63]" />
            Allocated Fleet Units & Custodian Status:
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {demo.reservations.map((res: any) => (
              <div
                key={res.id}
                className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-xs flex flex-col justify-between gap-1.5"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 sm:items-center">
                    <span className="min-w-0 font-semibold text-[#14213D]">
                      {res.model} ({res.serial_no || 'No Serial'})
                    </span>
                    {res.status === 'approved' && <Badge variant="success" className="shrink-0">APPROVED</Badge>}
                    {res.status === 'requested' && <Badge variant="warning" className="shrink-0">PENDING APPROVAL</Badge>}
                    {res.status === 'rejected' && <Badge variant="danger" className="shrink-0">REJECTED</Badge>}
                    {res.status === 'alternative_suggested' && <Badge variant="info" className="shrink-0">ALTERNATIVE SUGGESTED</Badge>}
                    {res.status === 'cancelled' && <Badge variant="outline" className="shrink-0">CANCELLED</Badge>}
                  </div>
                  <p className="text-[11px] text-[#4A5568] mt-0.5">
                    Depot: {res.current_location} • {formatDemoDate(res.reserved_from)} to {formatDemoDate(res.reserved_to)}
                  </p>
                  {res.approved_by_name && (
                    <p className="text-[11px] text-[#0B4A4E]">Approved by: {res.approved_by_name}</p>
                  )}
                  {res.alternative_reason && (
                    <p className={`text-[11px] ${res.status === 'rejected' ? 'text-[#700F2D]' : 'text-[#0B4A4E]'}`}>
                      {res.status === 'rejected' ? 'Rejection' : 'Reason'}: {res.alternative_reason}
                    </p>
                  )}
                  {res.alt_model && (
                    <p className="text-[11px] text-[#0B4A4E]">
                      Alternative: {res.alt_model} ({res.alt_serial_no || 'N/A'})
                    </p>
                  )}
                </div>
  
                {res.status === 'requested' && hasRole(['demo_team', 'service_team', 'management', 'regional_manager', 'admin']) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#E3EFEE]">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleApproveReservation(res)}
                      className="h-9 flex-auto sm:h-7 sm:flex-none bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3] hover:bg-[#E3EFEE]"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleOpenAllocate(res, demo)}
                      className="h-9 flex-auto sm:h-7 sm:flex-none bg-[#E3EFEE] text-[#0F5E63] border-[#D0E5E3] hover:bg-[#E3EFEE]"
                    >
                      Allocate Alt Unit
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleOpenAllocate(res, demo, 'suggest')}
                      className="h-9 flex-auto sm:h-7 sm:flex-none"
                    >
                      Suggest Alternative
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleOpenReject(res, demo)}
                      className="h-9 flex-auto sm:h-7 sm:flex-none bg-[#FCE8EC] text-[#700F2D] border-[#F3C7CF] hover:bg-[#FCE8EC]"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );

  // Pipeline register as priority cards / stage board. The full demo card (reservations, outcome,
  // custodian approvals, every action) opens in the existing demo dialog.
  const toDemoRecord = (demo: any): RecordItem => {
    const open = demo.status !== 'completed' && demo.status !== 'cancelled';
    const canAssign = open && hasRole(['demo_team', 'management', 'regional_manager', 'admin']);
    const place = demo.location || demo.city;
    const reservations: any[] = demo.reservations || [];
    const facts: RecordItem['facts'] = [
      {
        label: 'Kit',
        value: reservations.length
          ? `${reservations.length} unit${reservations.length === 1 ? '' : 's'} reserved`
          : demo.product_name || demo.equipment_required || 'No reservation',
      },
      demo.expected_audience && { label: 'Audience', value: demo.expected_audience },
      demo.tender_id && { label: 'Tender', value: demo.tender_no || 'Linked' },
      demo.purpose && { label: 'Purpose', value: demo.purpose },
    ].filter(Boolean) as NonNullable<RecordItem['facts']>;
    const badges: NonNullable<RecordItem['badges']> = [];
    if (demo.travel_required) badges.push({ label: 'Travel', tone: 'info' });
    if (demo.service_escort_required) badges.push({ label: 'Service escort', tone: 'info' });
    if (reservations.some((r) => r.status === 'requested')) badges.push({ label: 'Kit approval pending', tone: 'warning' });
    // a task on this demo needs manager sign-off: pending once it is handed in
    if (demo.task_approval === 'pending') badges.push({ label: 'Task approval pending', tone: 'warning' });
    else if (demo.task_approval === 'required') badges.push({ label: 'Task approval required', tone: 'info' });

    let primary: RecordItem['primary'];
    if (open) {
      if (!demo.assigned_to && canAssign && ['requested', 'under_planning'].includes(demo.status)) {
        primary = { label: 'Assign team', onClick: () => handleOpenAssignTeam(demo) };
      } else if (demo.status === 'confirmed') {
        primary = isDemoDayAhead(demo)
          ? { label: `Outcome from ${dmy(demoDay(demo))}`, disabled: true, onClick: () => {} }
          : { label: 'Record outcome', onClick: () => handleOpenOutcome(demo) };
      } else if (demo.status === 'requested' && canApprove) {
        primary = { label: 'Approve request', onClick: () => handleStartPlanning(demo) };
      } else if (demo.status !== 'requested' && canConfirmDate) {
        primary = { label: 'Confirm date', onClick: () => openConfirmDate(demo) };
      } else if (!isCoordinator && !reservations.length) {
        primary = { label: 'Request unit', onClick: () => handleOpenReserve(demo) };
      }
    }
    const quick: RecordItem['quick'] = [];
    if (open) {
      if (isCoordinator && demo.status !== 'requested') quick.push({ label: 'Reschedule', icon: <Clock />, onClick: () => openRescheduleDemo(demo) });
      quick.push({ label: !isCoordinator ? 'Request unit' : reservations.length ? 'Manage kit & serials' : 'Reserve unit', icon: <Package />, onClick: () => handleOpenReserve(demo) });
    } else {
      quick.push({ label: 'Audit trail', icon: <History />, onClick: () => handleOpenAudit(demo) });
    }
    if (place) {
      quick.push({
        label: 'Open in maps',
        icon: <MapPin />,
        onClick: () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`, '_blank', 'noopener'),
      });
    }

    return {
      key: String(demo.id),
      code: demo.demo_no,
      title: demo.organisation_name || 'Client Organisation',
      subtitle: [demo.product_name || demo.equipment_required, place].filter(Boolean).join(' · ') || undefined,
      status: { label: demoStatusLabel(demo.status), tone: toneFor(demoStatusLabel(demo.status)) },
      badges,
      due: {
        date: demo.confirmed_date || demo.requested_date,
        label: 'Demo date',
        done: ['completed', 'cancelled', 'failed', 'closed'].includes(demo.status),
      },
      value: demo.deal_value ? formatINR(Number(demo.deal_value)) : undefined,
      owner: demo.assignee_name || (demo.requested_by_name ? `By ${demo.requested_by_name}` : undefined),
      facts,
      primary,
      quick,
      onOpen: () => setLinkedDemo(demo),
    };
  };

  if (isLoading && !loadedOnce) {
    return (
      <PageContainer>
        <PageLoader label="Loading field demonstrations" rows={4} />
      </PageContainer>
    );
  }

  // The View menu (first control of the filter row) replaces the old row of view tabs.
  // Server counts under the active filters; a count leaves out its own dimension (the queue ignores the status filter).
  const pendingPlanningCount: number = demoSummary?.pending_requests ?? queueList.total;
  const statusCounts: Record<string, number> = demoSummary?.by_status || {};
  const resultCounts: Record<string, number> = demoSummary?.by_result || {};
  // The register's filters drive the pipeline list, the coordinator queue and the analytics, so they show on those views.
  const showRegisterFilters = activeTab === 'pipeline' || activeTab === 'coordinator' || activeTab === 'analytics';
  const viewOptions = [
    { key: 'pipeline', label: 'Demo pipeline & requests', icon: <Layers />, count: pipelineList.total },
    { key: 'my_demos', label: 'My demos', icon: <Users />, count: myDemosList.length },
    { key: 'coordinator', label: 'Coordinator planning queue', icon: <Wrench />, count: pendingPlanningCount },
    { key: 'failures', label: 'Field failures & incidents', icon: <AlertTriangle />, count: failedDemos.length, urgent: true },
    { key: 'fleet', label: 'Depot fleet & availability', icon: <Package />, count: equipmentList.length },
    { key: 'analytics', label: 'Analytics & failure insights', icon: <BarChart3 /> },
    { key: 'history', label: 'Customer trial history', icon: <History /> },
  ].map((o) => ({ ...o, active: activeTab === o.key, onSelect: () => setActiveTab(o.key as typeof activeTab) }));

  return (
    <PageContainer>
      {/* Top Banner & Header */}
      <PageHeader
        icon={<Sparkles className="h-7 w-7 text-[#0F5E63]" />}
        title="Field Demonstrations & Trials Management"
        actions={
          <>

            {hasRole(['sales', 'regional_manager', 'demo_team', 'management', 'admin']) && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setIsCreateOpen(true)}
                className="flex items-center gap-2 shadow-sm"
              >
                <Plus className="h-4 w-4" />
                New Demo Request
              </Button>
            )}
          </>
        }
      />

      {/* Key metrics (views that have them) sit directly under the header, above the filter row. */}
      {activeTab === 'analytics' && analyticsData && (
        <StatGrid cols={4} className="gap-3">
          <StatCard
            label="Total Demos"
            value={analyticsData.overview.total_demos}
            subtext={`${analyticsData.overview.active_pipeline} active in pipeline`}
            icon={<Layers className="h-4 w-4" />}
          />

          <StatCard
            label="Completed Trials"
            value={analyticsData.overview.completed_demos}
            valueColor="emerald"
            subtext={`${analyticsData.overview.successful} successful trials`}
            icon={<CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />}
          />

          <StatCard
            label="Trial Success Rate"
            value={`${analyticsData.overview.success_rate_percent}%`}
            valueColor="primary"
            progress={analyticsData.overview.success_rate_percent}
            progressColor="primary"
            icon={<Sparkles className="h-4 w-4 text-[#0F5E63]" />}
          />

          <StatCard
            label="Cancelled / Rescheduled"
            value={`${analyticsData.overview.cancelled_demos} / ${analyticsData.overview.rescheduled_demos}`}
            valueColor="amber"
            subtext="Fleet reallocations logged"
            icon={<Clock className="h-4 w-4 text-[#9A3412]" />}
          />
        </StatGrid>
      )}

      {activeTab === 'failures' && (
        <StatGrid cols={4} className="gap-3">
          <StatCard
            label="Total Trial Failures"
            value={failedDemos.length}
            subtext="Field deficiencies & objections"
            valueColor="rose"
            icon={<AlertTriangle className="h-4 w-4 text-[#881337]" />}
          />
          <StatCard
            label="Technical Breakdowns"
            value={failedDemos.filter((d) => d.outcome?.failure_reason === 'TECHNICAL_FAILURE').length}
            subtext="Hardware / calibration / defect"
            valueColor="rose"
            icon={<Wrench className="h-4 w-4 text-[#881337]" />}
          />
          <StatCard
            label="Auto Service Tickets"
            value={failedDemos.filter((d) => d.service_ticket_id || d.outcome?.service_ticket_id).length}
            subtext="Breakdown tickets auto-logged"
            valueColor="amber"
            icon={<ShieldAlert className="h-4 w-4 text-[#9A3412]" />}
          />
          <StatCard
            label="Quarantined Fleet Units"
            value={equipmentList.filter((e) => e.availability_status === 'maintenance').length}
            subtext="Protected from reassignment"
            valueColor="primary"
            icon={<Package className="h-4 w-4 text-[#0F5E63]" />}
          />
        </StatGrid>
      )}

      {/* One filter row on every view: the View menu first, then that view's own search and filters. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu label="View" icon={<LayoutList />} neutralKeys={[]} options={viewOptions} className="shrink-0" />
          {showRegisterFilters && (
            <>
              <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search demos"
                  placeholder="Search demo ID, client, product, assignee…"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                {activeTab !== 'coordinator' && (
                  <FilterMenu
                    label="Status"
                    icon={<Layers />}
                    options={[
                      { key: '', label: 'All statuses' },
                      ...DEMO_STATUSES,
                      // a status set from a dashboard link shows as one custom choice
                      ...(filterStatus.includes(',') ? [{ key: filterStatus, label: `Custom · ${filterStatus.split(',').length} statuses` }] : []),
                    ].map((o) => ({
                      ...o,
                      count: o.key ? o.key.split(',').reduce((n, s) => n + (statusCounts[s] || 0), 0) : demoSummary?.status_total,
                      active: filterStatus === o.key,
                      onSelect: () => setFilterStatus(o.key),
                    }))}
                    neutralKeys={['']}
                  />
                )}
                <FilterMenu
                  label="Product"
                  icon={<Package />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  neutralKeys={['']}
                  options={[{ id: '', name: 'All products' }, ...products].map((p: any) => ({
                    key: p.id,
                    label: p.name,
                    active: filterProduct === p.id,
                    onSelect: () => setFilterProduct(p.id),
                  }))}
                />
                <FilterMenu
                  label="Location"
                  icon={<MapPin />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  neutralKeys={['']}
                  options={[
                    { key: '', label: 'All locations', active: !filterLocation, onSelect: () => setFilterLocation('') },
                    ...demoLocations.map((loc) => ({
                      key: loc,
                      label: loc,
                      count: locationCounts[loc] || 0,
                      active: filterLocation === loc,
                      onSelect: () => setFilterLocation(loc),
                    })),
                  ]}
                />
                <FilterMenu
                  label="Outcome"
                  icon={<CheckCircle2 />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  neutralKeys={['']}
                  options={[
                    { key: '', label: 'All outcomes', active: !filterResult, onSelect: () => { setFilterResult(''); setFilterFailureReason(''); } },
                    { key: 'success', label: 'Successful pass', count: resultCounts.success || 0, active: filterResult === 'success', onSelect: () => { setFilterResult('success'); setFilterFailureReason(''); } },
                    { key: 'partial', label: 'Partial trial', count: resultCounts.partial || 0, active: filterResult === 'partial', onSelect: () => { setFilterResult('partial'); setFilterFailureReason(''); } },
                    {
                      key: 'fail',
                      label: 'Failed (any reason)',
                      urgent: true,
                      count: resultCounts.fail || 0,
                      active: filterResult === 'fail' && !filterFailureReason,
                      onSelect: () => { setFilterResult('fail'); setFilterFailureReason(''); },
                    },
                    ...Object.entries(FAILURE_REASON_METADATA).map(([key, meta]) => ({
                      key: `fail:${key}`,
                      label: `Failed · ${meta.label}`,
                      active: filterResult === 'fail' && filterFailureReason === key,
                      onSelect: () => { setFilterResult('fail'); setFilterFailureReason(key); },
                    })),
                  ]}
                />
                <button
                  type="button"
                  onClick={() => setIsDateFilterOpen((prev) => !prev)}
                  aria-expanded={isDateFilterOpen}
                  className={`filter-menu-btn ${isDateFilterOpen || filterDateFrom || filterDateTo ? 'filter-menu-btn--on' : ''}`}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>Dates</span>
                  {(filterDateFrom || filterDateTo) && <span className="filter-menu-chip">On</span>}
                </button>
                {hasPipelineFilters && (
                  <Button variant="ghost" size="xs" onClick={clearPipelineFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}
          {activeTab === 'failures' && (
            <>
              <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search incidents"
                  placeholder="Search client, location, product, S/N, ticket #…"
                  value={failSearchQuery}
                  onChange={(e) => setFailSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <FilterMenu
                  label="Reason"
                  icon={<AlertTriangle />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  options={[
                    { key: 'all', label: 'All failure reasons', count: failedDemos.length },
                    ...Object.entries(FAILURE_REASON_METADATA).map(([k, v]) => ({
                      key: k,
                      label: v.label,
                      count: failedDemos.filter((d) => d.outcome?.failure_reason === k).length,
                    })),
                  ].map((o) => ({ ...o, active: failReasonFilter === o.key, onSelect: () => setFailReasonFilter(o.key) }))}
                />
                <FilterMenu
                  label="Escort"
                  icon={<ShieldCheck />}
                  options={[
                    { key: 'all', label: 'All escort scenarios', count: undefined },
                    { key: 'escorted', label: 'Service escorted', count: failedDemos.filter((d) => d.service_escort_required).length },
                    { key: 'unescorted', label: 'Unescorted (solo sales)', count: failedDemos.filter((d) => !d.service_escort_required).length },
                  ].map((o) => ({ ...o, active: failEscortFilter === o.key, onSelect: () => setFailEscortFilter(o.key) }))}
                />
                <FilterMenu
                  label="Ticket"
                  icon={<Wrench />}
                  options={[
                    { key: 'all', label: 'All ticket states', count: undefined },
                    { key: 'ticket_logged', label: 'Ticket logged', count: failedDemos.filter((d) => d.service_ticket_id || d.outcome?.service_ticket_id).length },
                    { key: 'no_ticket', label: 'No ticket', count: failedDemos.filter((d) => !(d.service_ticket_id || d.outcome?.service_ticket_id)).length },
                  ].map((o) => ({ ...o, active: failServiceTicketFilter === o.key, onSelect: () => setFailServiceTicketFilter(o.key) }))}
                />
                {hasFailureFilters && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setFailSearchQuery('');
                      setFailReasonFilter('all');
                      setFailEscortFilter('all');
                      setFailServiceTicketFilter('all');
                    }}
                    className="text-xs text-[#4A5568] hover:text-[#881337]"
                  >
                    Clear
                  </Button>
                )}
                <span className="whitespace-nowrap pl-1 text-[11px] text-[#4A5568]">
                  <b className="font-mono text-[#14213D]">{displayedFailures.length}</b> of {failedDemos.length}
                </span>
              </div>
            </>
          )}
        </div>

        {showRegisterFilters && isDateFilterOpen && (
          <div className="flex flex-wrap items-center gap-3 border-t border-[#ECE9E2] pt-2.5 text-xs">
            <span className="font-semibold text-[#4A5568]">Demo date (confirmed or requested)</span>
            <label className="flex items-center gap-1.5 text-[#4A5568]">
              From
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="h-8 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[#4A5568]">
              To
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="h-8 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
              />
            </label>
            {(filterDateFrom || filterDateTo) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFilterDateFrom('');
                  setFilterDateTo('');
                }}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset dates
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Global Alerts / Feedback */}
      {actionSuccess && (
        <InfoCallout
          variant="success"
          title="Action Completed"
          onClose={() => setActionSuccess(null)}
        >
          {actionSuccess}
        </InfoCallout>
      )}

      {actionError && (
        <InfoCallout
          variant="danger"
          title="Operation Error"
          onClose={() => setActionError(null)}
        >
          {actionError}
        </InfoCallout>
      )}

      {/* =================================================================== */}
      {/* TAB 1: DEMO PIPELINE & REQUESTS                                    */}
      {/* =================================================================== */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          {/* Demos Table */}
          {pipelineList.loading && filteredDemos.length === 0 ? (
            <PageLoader label="Loading demonstrations" rows={3} />
          ) : filteredDemos.length === 0 ? (
            <EmptyState
              icon={<Box className="h-6 w-6" />}
              title="No Demonstrations Found"
              description="No trial requests match the selected filters. Create a new demo request or adjust your search parameters."
              action={
                <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
                  Create Demo Request
                </Button>
              }
            />
          ) : (
            (() => {
              const statusById = new Map(filteredDemos.map((d) => [String(d.id), d.status as string]));
              const extraLanes = Array.from(new Set(filteredDemos.map((d) => d.status as string)))
                .filter((s) => s && !DEMO_STATUSES.some((l) => l.key === s))
                .map((s) => ({ key: s, label: demoStatusLabel(s) }));
              const demoItems = filteredDemos.map(toDemoRecord);
              const demoList = filteredDemos.length ? (
                <RecordTable items={demoItems}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Demo Request No.</TableHead>
                        <TableHead>Customer & Location</TableHead>
                        <TableHead>Product / Equipment</TableHead>
                        <TableHead>Assigned To</TableHead>
                        <TableHead>Demo Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDemos.map((demo, idx) => {
                        const item = demoItems[idx];
                        const demoDate = demo.confirmed_date || demo.requested_date;
                        const daysLeft = DEMO_DONE.includes(demo.status) ? null : daysFromToday(demoDate);
                        const product = demo.product_name || demo.equipment_required;
                        const owner = demo.assignee_name || (demo.requested_by_name ? `By ${demo.requested_by_name}` : '');
                        return (
                          <TableRow key={item.key}>
                            <TableCell className="font-bold whitespace-nowrap">
                              <span className="font-mono text-[#0F5E63]">{demo.demo_no || '-'}</span>
                            </TableCell>
                            <TableCell className="font-bold text-[#14213D]">
                              {demo.organisation_name || 'Client Organisation'}
                              <div className="text-[10px] text-[#4A5568] font-normal">{demo.location || demo.city || '-'}</div>
                            </TableCell>
                            <TableCell className="text-[#14213D] max-w-[240px] truncate" title={product || undefined}>
                              {product || '-'}
                            </TableCell>
                            <TableCell className="text-[#4A5568] whitespace-nowrap">{owner || '-'}</TableCell>
                            <TableCell className="font-mono whitespace-nowrap">
                              {formatDateIN(demoDate)}
                              {daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && (
                                <div className="text-[10px] font-bold text-[#881337]">{daysLeft === 0 ? 'TODAY' : `${daysLeft} DAYS LEFT`}</div>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge variant={demoStatusBadge(demo.status)} size="sm" className="uppercase font-bold">
                                {demoStatusLabel(demo.status)}
                              </Badge>
                              {(demo.task_approval || (demo.reservations || []).some((r: any) => r.status === 'requested')) && (
                                <div className="mt-1 text-[10px] font-semibold text-[#9A3412]">
                                  {[
                                    (demo.reservations || []).some((r: any) => r.status === 'requested') && 'Kit approval pending',
                                    demo.task_approval === 'pending' ? 'Task approval pending' : demo.task_approval === 'required' && 'Task approval required',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2">
                                {item.primary && (
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={item.primary.disabled}
                                    onClick={item.primary.onClick}
                                    className="shadow-xs text-xs"
                                  >
                                    {item.primary.label}
                                  </Button>
                                )}
                                <Button size="sm" variant="secondary" onClick={() => setLinkedDemo(demo)} className="shadow-xs text-xs">
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
                <RecordViews
                  // per role, so the demo team opens on the schedule while everyone else keeps the list
                  storageKey={`demos:${user?.role || 'all'}`}
                  defaultView={user?.role === 'demo_team' ? 'calendar' : 'list'}
                  items={demoItems}
                  list={demoList}
                  calendar={
                    <DemoCalendar
                      demos={filteredDemos}
                      loadRange={loadCalendarWeek}
                      reloadKey={dataVersion}
                      onOpen={(d) => setLinkedDemo(d)}
                      statusLabel={demoStatusLabel}
                      statusTone={(st) => toneFor(demoStatusLabel(st))}
                    />
                  }
                  lanes={[...DEMO_STATUSES, ...extraLanes].map((l) => ({ ...l, tone: toneFor(l.label) }))}
                  laneOf={(i) => statusById.get(i.key) || ''}
                  summary={
                    <>
                      <span className="font-mono font-semibold text-[#14213D]">{filteredDemos.length}</span> of {pipelineList.total} demos
                      {pendingPlanningCount ? ` · ${pendingPlanningCount} pending requests` : ''}
                    </>
                  }
                  empty="No demonstrations match the selected filters."
                  onLoadMore={pipelineList.loadMore}
                  hasMore={pipelineList.hasMore}
                  loadingMore={pipelineList.loadingMore}
                />
              );
            })()
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB: MY DEMOS (Assigned to logged-in Specialist)                    */}
      {/* =================================================================== */}
      {activeTab === 'my_demos' && (() => {
        // The demo specialist's day-to-day: their week at a glance, then only what is waiting on them.
        const weekStart = addIsoDays(istToday(), -((new Date(`${istToday()}T00:00:00`).getDay() + 6) % 7));
        const weekEnd = addIsoDays(weekStart, 6);
        const live = myDemosList.filter((d) => d.status !== 'cancelled');
        const thisWeek = live.filter((d) => demoDay(d) >= weekStart && demoDay(d) <= weekEnd).length;
        const approvalPending = live.filter(
          (d) => d.status === 'requested' || d.task_approval === 'pending' || (d.reservations || []).some((r: any) => r.status === 'requested'),
        ).length;
        const outcomeDue = live.filter((d) => d.status === 'confirmed' && !isDemoDayAhead(d)).length;
        const actionItems = live.map(toDemoRecord).filter((i) => i.primary && !i.primary.disabled);
        const stats = [
          { label: 'This week', value: thisWeek, tone: 'text-[#0F5E63]' },
          { label: 'Approval pending', value: approvalPending, tone: approvalPending ? 'text-[#9A3412]' : 'text-[#14213D]' },
          { label: 'Outcome due', value: outcomeDue, tone: outcomeDue ? 'text-[#9A3412]' : 'text-[#14213D]' },
        ];
        return (
          <div className="space-y-4 animate-in fade-in duration-150">
            <Card padding="md" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <h2 className="font-serif text-lg font-semibold text-[#14213D]">My demo schedule</h2>
                <p className="text-xs text-[#4A5568]">Demos assigned to you. Open any demo to plan, reserve kit or record the outcome.</p>
              </div>
              <div className="grid grid-cols-3 gap-2 md:flex md:gap-3">
                {stats.map((st) => (
                  <div key={st.label} className="rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2 text-center md:min-w-[110px]">
                    <div className={`font-mono text-lg font-bold ${st.tone}`}>{st.value}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#4A5568]">{st.label}</div>
                  </div>
                ))}
              </div>
            </Card>

            {myDemosList.length === 0 ? (
              <EmptyState
                icon={<Users className="h-8 w-8 text-[#4A5568]" />}
                title="No demos assigned to you yet"
                description="When the coordinator schedules a client trial with you, it appears here on your week."
              />
            ) : (
              <>
                <Card padding="md">
                  <DemoCalendar
                    demos={myDemosList}
                    onOpen={(d) => setLinkedDemo(d)}
                    statusLabel={demoStatusLabel}
                    statusTone={(st) => toneFor(demoStatusLabel(st))}
                  />
                </Card>
                {actionItems.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-serif text-sm font-semibold text-[#14213D]">
                      Needs your action <span className="font-mono text-xs text-[#4A5568]">({actionItems.length})</span>
                    </h3>
                    <RecordList items={actionItems} />
                  </section>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* =================================================================== */}
      {/* TAB 2: COORDINATOR PLANNING QUEUE                                  */}
      {/* =================================================================== */}
      {activeTab === 'coordinator' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-[#14213D] flex items-center gap-2">
                <Wrench className="h-5 w-5 text-[#9A3412]" />
                Demo Dispatch & Planning Workbench
              </h2>
              <p className="text-xs text-[#4A5568] mt-0.5">
                Review pending requests, confirm operational dates, detect depot location mismatches,
                and prevent equipment/team double bookings.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="warning">
                {pendingPlanningCount} Pending
              </Badge>
            </div>
          </div>

          {queueList.loading && coordinatorDemos.length === 0 ? (
            <PageLoader label="Loading planning queue" rows={3} />
          ) : coordinatorDemos.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" />}
              title="Planning Queue Is Clear"
              description={
                hasPipelineFilters
                  ? 'No pending requests match the selected filters.'
                  : 'No demonstrations are currently awaiting planning, team assignment, equipment reservation or date confirmation.'
              }
            />
          ) : (
            (
            <div className="grid grid-cols-1 gap-4">
              {coordinatorDemos.map((demo) => renderCoordinatorCard(demo))}
              {queueList.hasMore && (
                <Button variant="secondary" size="sm" isLoading={queueList.loadingMore} onClick={queueList.loadMore} className="justify-self-center">
                  Load more ({coordinatorDemos.length} of {queueList.total})
                </Button>
              )}
            </div>
          )
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: DEPOT FLEET & LIVE AVAILABILITY CHECKER                     */}
      {/* =================================================================== */}
      {activeTab === 'fleet' && (
        <div className="space-y-6">
          {/* Live Availability Checker Box (§8) */}
          <Card className="p-4 sm:p-5 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#DCD8CE] pb-4">
              <div>
                <h3 className="text-base font-bold text-[#14213D] flex items-center gap-2">
                  <Package className="h-5 w-5 text-[#0F5E63]" />
                  Live Fleet Availability & Conflict Checker
                </h3>
                <p className="text-xs text-[#4A5568] mt-1">
                  Query inventory across Delhi, Patna, and Kolkata depots for specific dates to prevent
                  committing unavailable equipment.
                </p>
              </div>

              {hasRole(['demo_team', 'service_team', 'admin']) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEquipmentForm({
                      id: '',
                      product_id: products[0]?.id || '',
                      model: '',
                      serial_no: '',
                      current_location: 'Delhi',
                      responsible_person: '',
                      responsible_person_name: '',
                      availability_status: 'available',
                      condition: 'Operational',
                      remarks: '',
                    });
                    setIsEquipmentModalOpen(true);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Depot Unit
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <Select
                label="Product Line"
                value={availFilterProduct}
                onChange={(e) => setAvailFilterProduct(e.target.value)}
                options={[
                  { label: 'All Products', value: '' },
                  ...products.map((p) => ({ label: p.name, value: p.id })),
                ]}
              />

              <Select
                label="Depot Location"
                value={availFilterLocation}
                onChange={(e) => setAvailFilterLocation(e.target.value)}
                options={[
                  { label: 'All Depots (Delhi, Patna, Kolkata)', value: '' },
                  { label: 'Delhi Central Depot', value: 'Delhi' },
                  { label: 'Patna Regional Depot', value: 'Patna' },
                  { label: 'Kolkata East Depot', value: 'Kolkata' },
                ]}
              />

              <Input
                label="Target Trial Date"
                type="date"
                value={availFilterDate}
                onChange={(e) => setAvailFilterDate(e.target.value)}
              />
            </div>

            {/* Availability Summary Stats */}
            {availabilityResults && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#DCD8CE]">
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE]">
                  <span className="text-xs text-[#4A5568] block">Total Units</span>
                  <span className="text-xl font-bold text-[#14213D]">
                    {availabilityResults.summary.total}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-[#E3EFEE] border border-[#D0E5E3]">
                  <span className="text-xs font-medium text-[#0B4A4E] block">Available Now</span>
                  <span className="text-xl font-bold text-[#0B4A4E]">
                    {availabilityResults.summary.available}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4]">
                  <span className="text-xs font-medium text-[#7C2D12] block">Reserved for Demos</span>
                  <span className="text-xl font-bold text-[#7C2D12]">
                    {availabilityResults.summary.reserved}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF]">
                  <span className="text-xs font-medium text-[#700F2D] block">In Maintenance</span>
                  <span className="text-xl font-bold text-[#700F2D]">
                    {availabilityResults.summary.maintenance}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Depot Fleet Inventory Table */}
          <Card className="p-0 overflow-hidden bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
            <div className="p-4 border-b border-[#DCD8CE] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#14213D]">
                Depot Units Roster ({equipmentList.length} Units Total)
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#14213D]">
                <thead className="bg-[#FBFAF7] text-xs uppercase tracking-wider text-[#4A5568] border-b border-[#DCD8CE]">
                  <tr>
                    <th className="py-3 px-4">Model & Serial</th>
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">Current Depot</th>
                    <th className="py-3 px-4">Responsible Custodian</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Condition</th>
                    <th className="py-3 px-4">Reserved / Expected Avail</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3EFEE]">
                  {equipmentList.map((unit) => (
                    <tr key={unit.id} className="hover:bg-[#E3EFEE] transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#14213D]">{unit.model}</p>
                        <span className="font-mono text-xs text-[#4A5568]">
                          {unit.serial_no || 'N/A'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#4A5568]">{unit.product_name}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 font-medium text-[#14213D]">
                          <MapPin className="h-3.5 w-3.5 text-[#0F5E63]" />
                          {unit.current_location}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <span className="font-medium text-[#14213D]">
                          {unit.responsible_person_name || 'Depot Service Team'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {unit.availability_status === 'available' && (
                          <Badge variant="success">AVAILABLE</Badge>
                        )}
                        {unit.availability_status === 'reserved' && (
                          <Badge variant="warning">RESERVED</Badge>
                        )}
                        {unit.availability_status === 'in_use' && (
                          <Badge variant="info">IN FIELD TRIAL</Badge>
                        )}
                        {unit.availability_status === 'maintenance' && (
                          <Badge variant="danger">MAINTENANCE</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#4A5568]">
                        {unit.condition || 'Operational'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-[#4A5568]">
                        {/* §15: reserved window (next live booking) and when the unit is free again */}
                        {unit.next_reserved_from
                          ? `Booked ${formatDateIN(unit.next_reserved_from)} – ${formatDateIN(unit.next_reserved_to || unit.next_reserved_from)}`
                          : unit.reserved_until
                            ? `Until ${formatDateIN(unit.reserved_until)}`
                            : 'Immediate'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {hasRole(['demo_team', 'service_team', 'admin']) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEquipmentForm({
                                id: unit.id,
                                product_id: unit.product_id,
                                model: unit.model,
                                serial_no: unit.serial_no || '',
                                current_location: unit.current_location || 'Delhi',
                                responsible_person: unit.responsible_person || '',
                                responsible_person_name: unit.responsible_person_name || '',
                                availability_status: unit.availability_status || 'available',
                                condition: unit.condition || 'Operational',
                                remarks: unit.remarks || '',
                              });
                              setIsEquipmentModalOpen(true);
                            }}
                            className="text-xs"
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: MANAGEMENT ANALYTICS & FAILURE ANALYSIS                     */}
      {/* =================================================================== */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {analyticsData && (
            <>
              {/* Structured Failure Analysis Breakdown & Recurring Pattern Matrix (§18 & §19) */}
              <Card className="p-4 sm:p-6 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs space-y-6">
                <SectionHeader
                  icon={<AlertTriangle className="h-5 w-5 text-[#881337]" />}
                  title="Management Recurring Failure Pattern Analysis (§17 & §18)"
                  description="Systematic taxonomy of trial deficiencies to understand why demonstrations fail and direct engineering R&D, commercial terms, and field prep protocols."
                  badge={<Badge variant="danger">{analyticsData.overview.unsuccessful} Total Failures Recorded</Badge>}
                />

                {analyticsData.failure_analysis.length === 0 ? (
                  <p className="text-sm text-[#4A5568] italic text-center py-6">
                    Zero unsuccessful demo trials recorded.
                  </p>
                ) : (
                  <>
                    {/* Visual Progress Distribution */}
                    <div className="space-y-3 pb-4 border-b border-[#DCD8CE]">
                      <div className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                        Failure Category Distribution
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {analyticsData.failure_analysis.map((item: any) => {
                          const meta = FAILURE_REASON_METADATA[item.reason];
                          return (
                            <div key={item.reason} className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-[#14213D]">
                                  {meta?.label || item.reason.replace(/_/g, ' ')}
                                </span>
                                <span className="text-[#4A5568] font-mono font-semibold">
                                  {item.count} trials ({item.percentage}%)
                                </span>
                              </div>
                              <div className="w-full bg-[#E3EFEE] h-2 rounded-full overflow-hidden">
                                <div
                                  className="bg-[#881337] h-full rounded-full transition-all"
                                  style={{ width: `${Math.max(item.percentage, 4)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Executive Root Cause & Mitigation Table */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                        <span>Recurring Pattern Taxonomy & Corrective Countermeasures</span>
                        <span className="text-[11px] font-normal text-[#4A5568]">
                          Covers all 9 operational failure categories
                        </span>
                      </div>

                      <div>
                        <Table className="w-full text-left text-xs">
                          <TableHeader className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] uppercase font-bold text-[10px]">
                            <TableRow>
                              <TableHead className="py-2.5 px-3">Failure Reason</TableHead>
                              <TableHead className="py-2.5 px-2">Severity</TableHead>
                              <TableHead className="py-2.5 px-2 text-center">Occurrences</TableHead>
                              <TableHead className="py-2.5 px-3">Typical Root Cause Pattern</TableHead>
                              <TableHead className="py-2.5 px-3">Recommended Management Countermeasure</TableHead>
                              <TableHead className="py-2.5 px-2 text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="divide-y divide-[#DCD8CE]">
                            {Object.entries(FAILURE_REASON_METADATA).map(([key, meta]) => {
                              const found = analyticsData.failure_analysis.find((f: any) => f.reason === key);
                              const count = found?.count || 0;
                              const pct = found?.percentage || 0;

                              return (
                                <TableRow key={key} className={count > 0 ? 'bg-[#FCE8EC]/20' : 'hover:bg-[#FBFAF7]'}>
                                  <TableCell className="py-3 px-3">
                                    <div className="font-bold text-[#14213D]">{meta.label}</div>
                                    <div className="text-[11px] text-[#4A5568]">{meta.description}</div>
                                  </TableCell>
                                  <TableCell className="py-3 px-2">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
                                        meta.severity === 'critical'
                                          ? 'bg-[#FCE8EC] text-[#700F2D] border-[#F3C7CF]'
                                          : meta.severity === 'high'
                                          ? 'bg-[#FBEBDD] text-[#7C2D12] border-[#E9C9B4]'
                                          : 'bg-[#E3EFEE] text-[#0B4A4E] border-[#D0E5E3]'
                                      }`}
                                    >
                                      {meta.severity}
                                    </span>
                                  </TableCell>
                                  <TableCell className="py-3 px-2 text-center">
                                    <span className={`font-mono font-bold ${count > 0 ? 'text-[#881337]' : 'text-[#6B7280]'}`}>
                                      {count} ({pct}%)
                                    </span>
                                  </TableCell>
                                  <TableCell className="py-3 px-3 text-[11px] text-[#14213D]">
                                    {meta.typicalRootCause}
                                  </TableCell>
                                  <TableCell className="py-3 px-3 text-[11px] text-[#0F5E63] font-medium">
                                    {meta.recommendedCountermeasure}
                                  </TableCell>
                                  <TableCell className="py-3 px-2 text-right">
                                    {count > 0 && (
                                      <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                          setFilterResult('fail');
                                          setFilterFailureReason(key);
                                          setActiveTab('pipeline');
                                        }}
                                      >
                                        Filter ({count})
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                )}
              </Card>

              {/* Product Failure Correlation (if available) */}
              {analyticsData.product_failures && analyticsData.product_failures.length > 0 && (
                <Card className="p-4 sm:p-6 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs space-y-4">
                  <SectionHeader
                    icon={<Box className="h-5 w-5 text-[#0F5E63]" />}
                    title="Product-Level Trial Failure Distribution"
                    description="Analysis of which hardware units and catalog models encounter recurring field objections or technical failures."
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {analyticsData.product_failures.map((pf: any, idx: number) => (
                      <div key={idx} className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-1">
                        <div className="font-bold text-[#14213D] text-xs">{pf.product_name}</div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#700F2D] font-medium">
                            {FAILURE_REASON_METADATA[pf.failure_reason]?.label || pf.failure_reason.replace(/_/g, ' ')}
                          </span>
                          <span className="font-mono font-bold bg-[#FCE8EC] text-[#700F2D] px-1.5 py-0.2 rounded border border-[#F3C7CF]">
                            {pf.fail_count} failed
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Decision-Maker Attendance Impact Analysis (§17) */}
              {analyticsData.decision_maker_impact && (
                <Card className="p-4 sm:p-6 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
                  <SectionHeader
                    icon={<Users className="h-5 w-5 text-[#0F5E63]" />}
                    title="Senior Decision-Maker Attendance Impact"
                    description="Correlation between trial success rate and executive/commanding officer physical attendance at the demonstration."
                    badge={
                      <Badge
                        variant={
                          analyticsData.decision_maker_impact.attended.rate_percent >= 50
                            ? 'success'
                            : 'warning'
                        }
                      >
                        {analyticsData.decision_maker_impact.attended.rate_percent}% Win Rate When Attended
                      </Badge>
                    }
                    className="mb-4"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-[#E3EFEE]/50 border border-[#D0E5E3]">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-2">
                        <span className="text-xs font-bold text-[#0B4A4E] uppercase tracking-wider">
                          Decision-Maker Attended Trial
                        </span>
                        <span className="text-xs font-bold text-[#0B4A4E]">
                          {analyticsData.decision_maker_impact.attended.rate_percent}% Success Rate
                        </span>
                      </div>
                      <p className="text-2xl font-bold text-[#0B4A4E]">
                        {analyticsData.decision_maker_impact.attended.successful} /{' '}
                        {analyticsData.decision_maker_impact.attended.total}
                        <span className="text-xs font-normal text-[#0B4A4E] ml-1.5">
                          trials succeeded
                        </span>
                      </p>
                      <div className="w-full bg-[#D0E5E3] h-2 rounded-full overflow-hidden mt-3">
                        <div
                          className="bg-[#0F5E63] h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(
                              analyticsData.decision_maker_impact.attended.rate_percent,
                              4,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-2">
                        <span className="text-xs font-bold text-[#4A5568] uppercase tracking-wider">
                          Decision-Maker Absent
                        </span>
                        <span className="text-xs font-bold text-[#4A5568]">
                          {analyticsData.decision_maker_impact.absent.rate_percent}% Success Rate
                        </span>
                      </div>
                      <p className="text-2xl font-bold text-[#14213D]">
                        {analyticsData.decision_maker_impact.absent.successful} /{' '}
                        {analyticsData.decision_maker_impact.absent.total}
                        <span className="text-xs font-normal text-[#4A5568] ml-1.5">
                          trials succeeded
                        </span>
                      </p>
                      <div className="w-full bg-[#E3EFEE] h-2 rounded-full overflow-hidden mt-3">
                        <div
                          className="bg-[#4A5568] h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(
                              analyticsData.decision_maker_impact.absent.rate_percent,
                              4,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Depot Utilization Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {analyticsData.depot_fleet.map((depot: any) => (
                  <Card key={depot.current_location} className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
                    <h4 className="font-semibold text-[#14213D] flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-[#0F5E63]" />
                      {depot.current_location} Depot
                    </h4>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                      <div className="p-2 rounded bg-[#FBFAF7] border border-[#DCD8CE]">
                        <span className="text-[#4A5568] block">Total</span>
                        <span className="font-bold text-[#14213D] text-sm">{depot.total_units}</span>
                      </div>
                      <div className="p-2 rounded bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3]">
                        <span className="block">Free</span>
                        <span className="font-bold text-sm">{depot.available_units}</span>
                      </div>
                      <div className="p-2 rounded bg-[#FFF8EB] text-[#7C2D12] border border-[#E9C9B4]">
                        <span className="block">Booked</span>
                        <span className="font-bold text-sm">{depot.reserved_units}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: CUSTOMER TRIAL HISTORY                                      */}
      {/* =================================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <Card className="p-4 sm:p-5 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
            <SectionHeader
              icon={<History className="h-5 w-5 text-[#0F5E63]" />}
              title="Customer Demonstration & Field Trial Timeline"
              description="Select an organisation to view the complete history of trials, certificates, outcomes, and follow-up actions."
            />

            <div className="mt-4 max-w-md">
              <OrganisationPicker
                label="Select Organisation / Department"
                value={selectedHistoryOrgId}
                placeholder="— Select a Client Organisation —"
                onChange={(org) => loadCustomerHistory(org?.id || '')}
              />
            </div>
          </Card>

          {selectedHistoryOrgId && (
            <div className="space-y-4">
              {customerHistoryDemos.length === 0 ? (
                <EmptyState
                  icon={<Building className="h-6 w-6" />}
                  title="No Field Demonstrations Recorded"
                  description="No historical field demonstration trials are on record for this organisation yet."
                />
              ) : (
                customerHistoryDemos.map((demo) => (
                  <Card key={demo.id} className="p-4 sm:p-5 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs hover:border-[#0F5E63] transition-all">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#DCD8CE] pb-3">
                      <div>
                        <span className="font-mono text-xs font-bold text-[#0F5E63]">
                          {demo.demo_no}
                        </span>
                        <h4 className="text-base font-semibold text-[#14213D]">
                          {demo.product_name || 'Security Equipment Trial'}
                        </h4>
                      </div>
                      <div>{renderStatusBadge(demo.status)}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-3 text-xs text-[#14213D]">
                      <div>
                        <span className="text-[#4A5568] block">Date & Site:</span>
                        <span>
                          {formatDemoDate(demo.confirmed_date || demo.requested_date)} @ {demo.location}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#4A5568] block">Demo Specialist:</span>
                        <span>{demo.assignee_name || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-[#4A5568] block">Sales Contact:</span>
                        <span>{demo.requested_by_name || 'Direct'}</span>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-[#14213D] space-y-1">
                      <p>
                        <strong>Purpose:</strong> {demo.purpose || 'Trial evaluation'}
                      </p>
                      {demo.remarks && (
                        <p>
                          <strong>Notes:</strong> {demo.remarks}
                        </p>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 7: FIELD FAILURES & INCIDENT LOG (When / What / Where / Why)    */}
      {/* =================================================================== */}
      {activeTab === 'failures' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Root-cause breakdown + response status (real data only) */}
          {(() => {
            const byReason = Object.entries(
              failedDemos.reduce((acc: Record<string, number>, d) => {
                const k = d.outcome?.failure_reason || 'UNSPECIFIED';
                acc[k] = (acc[k] || 0) + 1;
                return acc;
              }, {}),
            ).sort((x, y) => y[1] - x[1]);
            const max = Math.max(1, ...byReason.map(([, n]) => n));
            const ticketed = failedDemos.filter((d) => d.service_ticket_id || d.outcome?.service_ticket_id).length;
            const escorted = failedDemos.filter((d) => d.service_escort_required).length;
            const total = Math.max(1, failedDemos.length);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <Card className="lg:col-span-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 mb-3">
                    <h3 className="font-serif text-base font-bold text-[#14213D]">Root-cause breakdown</h3>
                    <span className="text-[11px] text-[#4A5568]">Click a bar to filter incidents</span>
                  </div>
                  <div className="space-y-2">
                    {byReason.length === 0 && <p className="text-xs text-[#4A5568]">No failures recorded.</p>}
                    {byReason.map(([k, n]) => {
                      const on = failReasonFilter === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setFailReasonFilter(on ? 'all' : k)}
                          className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${on ? 'bg-[#FBE9D0]' : 'hover:bg-[#FBFAF7]'}`}
                        >
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-semibold text-[#14213D] truncate">{FAILURE_REASON_METADATA[k]?.label || k.replace(/_/g, ' ')}</span>
                            <span className="font-mono font-bold text-[#9A3412]">{n}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[#ECE9E2] overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-[#C98A1B] to-[#9A3412]" style={{ width: `${(n / max) * 100}%` }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
                <Card className="lg:col-span-2 p-4 sm:p-5 space-y-4">
                  <h3 className="font-serif text-base font-bold text-[#14213D]">Response coverage</h3>
                  {[
                    { label: 'Breakdown ticket logged', n: ticketed, color: '#0F5E63', hint: 'Module 6 auto-ticket' },
                    { label: 'Service-escorted trials', n: escorted, color: '#C98A1B', hint: 'Engineer on site' },
                    { label: 'Quarantined units', n: equipmentList.filter((e) => e.availability_status === 'maintenance').length, color: '#9A3412', hint: 'Held from reassignment' },
                  ].map((r) => (
                    <div key={r.label}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-semibold text-[#14213D]">{r.label}</span>
                        <span className="font-mono font-bold" style={{ color: r.color }}>{r.n} / {failedDemos.length}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#ECE9E2] overflow-hidden mt-1">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.n / total) * 100)}%`, background: r.color }} />
                      </div>
                      <div className="text-[10px] text-[#6B7280] mt-0.5">{r.hint}</div>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })()}

          {/* Incident feed */}
          {displayedFailures.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Zero Incidents Found in Filter"
              description="No demonstration failures match the selected search criteria or failure categories."
            />
          ) : (
            <div className="space-y-3">
              {displayedFailures.map((demo) => {
                const outcome = demo.outcome || {};
                const reasonMeta = outcome.failure_reason ? FAILURE_REASON_METADATA[outcome.failure_reason] : null;
                const hasServiceTicket = Boolean(demo.service_ticket_id || outcome.service_ticket_id);
                const ticketNo = demo.service_ticket_no || (demo.service_ticket_id ? `TCK-${demo.service_ticket_id.slice(0, 8)}` : null);
                const serials = (demo.reservations || []).map((r: any) => r.serial_no).filter(Boolean).join(', ');
                const when = demo.confirmed_date || demo.requested_date;
                const open = expandedFailId === demo.id;
                const steps = [
                  { label: 'Trial failed', done: true },
                  { label: hasServiceTicket ? `Ticket ${ticketNo ?? ''}`.trim() : 'No ticket', done: hasServiceTicket },
                  // only a technical failure sends the trial's units to maintenance
                  isQuarantiningFailure(demo) ? { label: 'Unit quarantined', done: true } : { label: 'Unit not quarantined', done: false },
                  { label: demo.service_escort_required ? 'Escort on site' : 'Solo trial', done: Boolean(demo.service_escort_required) },
                ];
                return (
                  <Card key={demo.id} className="p-0 overflow-hidden" style={{ borderLeft: `5px solid ${hasServiceTicket ? '#C98A1B' : '#9A3412'}` }}>
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-[#0F5E63] px-2 py-0.5 rounded bg-[#E3EFEE]">{demo.demo_no}</span>
                            <span className="inline-flex items-center rounded-full bg-[#FBEBDD] px-2.5 py-0.5 text-[11px] font-bold text-[#7C2D12]">
                              {reasonMeta?.label || (outcome.failure_reason ? outcome.failure_reason.replace(/_/g, ' ') : 'Unspecified deficiency')}
                            </span>
                            {hasServiceTicket && <Badge variant="warning" size="sm">SERVICE TICKET</Badge>}
                          </div>
                          <h3 className="font-serif text-lg font-bold text-[#14213D] leading-snug">
                            {demo.organisation_name || 'Client Agency / Command'}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4A5568]">
                            <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" />{demo.product_name || 'Model unspecified'}{serials ? ` · S/N ${serials}` : ''}</span>
                            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{demo.location || demo.city || 'Command / Depot Range'}</span>
                            <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{when ? formatDateIN(when) : 'N/A'} · {outcome.completed ? 'executed on site' : 'cut short'}</span>
                          </div>
                        </div>
                        <RowMenu
                          buttonLabel="Actions"
                          label="Incident actions"
                          items={[
                            { key: 'dossier', label: 'Incident Dossier', icon: <Info />, onSelect: () => { setSelectedFailureDetail(demo); setIsFailureDetailModalOpen(true); } },
                            { key: 'audit', label: 'Full Audit Trail', icon: <History />, onSelect: () => handleOpenAudit(demo) },
                            { key: 'service', label: `Open Service Desk${ticketNo ? ` (${ticketNo})` : ''}`, icon: <Wrench />, hidden: !hasServiceTicket, onSelect: () => router.push(demo.service_ticket_id ? `/service?open=${demo.service_ticket_id}` : '/service') },
                          ]}
                        />
                      </div>

                      {/* response timeline */}
                      <ol className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {steps.map((st, i) => (
                          <li key={i} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${st.done ? 'border-[#C98A1B]/50 bg-[#FFF6E6] text-[#7C2D12]' : 'border-dashed border-[#DCD8CE] text-[#6B7280]'}`}>
                            <span className={`h-2 w-2 shrink-0 rounded-full ${st.done ? 'bg-[#9A3412]' : 'bg-[#DCD8CE]'}`} />
                            <span className="truncate">{st.label}</span>
                          </li>
                        ))}
                      </ol>

                      <button
                        type="button"
                        onClick={() => setExpandedFailId(open ? null : demo.id)}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#0F5E63] hover:underline"
                      >
                        {open ? 'Hide' : 'Show'} findings
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                      </button>
                    </div>

                    {open && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-[#ECE9E2] bg-[#FBFAF7] p-4 sm:p-5 text-xs">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568]">Technical performance</div>
                          <p className="mt-1 text-[#14213D]">{outcome.technical_performance || 'Performance parameters failed field specifications.'}</p>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568]">Customer response</div>
                          <p className="mt-1 text-[#14213D]">{outcome.customer_feedback || outcome.customer_response || 'Procurement officers cited trial deficiencies.'}</p>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568]">Recovery step</div>
                          <p className="mt-1 text-[#14213D]">{outcome.next_step || 'Re-calibration and scheduled follow-up trial required.'}</p>
                        </div>
                        <div className="md:col-span-3 flex flex-wrap items-center gap-2">
                          <Badge variant={outcome.decision_maker_present ? 'success' : 'outline'} size="sm">
                            {outcome.decision_maker_present ? 'Decision-maker attended' : 'Decision-maker absent'}
                          </Badge>
                          <span className="italic text-[#4A5568]">&ldquo;{outcome.remarks || outcome.notes || reasonMeta?.typicalRootCause || 'Deficiency logged on site.'}&rdquo;</span>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* MODALS                                                              */}
      {/* =================================================================== */}

      {/* 1. New Demo Request Modal */}
      <CreateDemoModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(d) => {
          setActionSuccess(`Demo request ${d.demo_no} created successfully.`);
          fetchDemosData();
        }}
      />

      {/* 2. Team Assignment Modal (§5 & §11) */}
      <Modal
        isOpen={isAssignTeamOpen}
        onClose={() => setIsAssignTeamOpen(false)}
        title={`Assign Demo Team Member — ${selectedDemo?.demo_no}`}
      >
        <form onSubmit={handleAssignTeamSubmit} className="space-y-5 text-sm">
          <FormSection
            title="Specialist"
            icon={<Users />}
            description="Pick who will run this demo. Busy specialists are flagged."
          >
          <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-[#14213D]">
            <p>
              <strong>Client:</strong> {selectedDemo?.organisation_name}
            </p>
            <p>
              <strong>Location:</strong> {selectedDemo?.location}
            </p>
            <p>
              <strong>Target Date:</strong>{' '}
              {dmy(teamForm.confirmed_date || demoDay(selectedDemo))}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#14213D] mb-1.5">
              Select Demo Specialist (Availability Checked) *
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-[#DCD8CE] rounded-lg p-2 bg-[#FBFAF7]">
              {teamMembers.map((member) => (
                <label
                  key={member.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                    teamForm.assigned_to === member.id
                      ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#14213D]'
                      : member.is_available
                      ? 'bg-white border-[#DCD8CE] text-[#14213D] hover:bg-[#E3EFEE]'
                      : 'bg-[#FCE8EC] border-[#F3C7CF] text-[#700F2D] opacity-90'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="radio"
                      name="team_member"
                      value={member.id}
                      checked={teamForm.assigned_to === member.id}
                      onChange={() => setTeamForm({ ...teamForm, assigned_to: member.id })}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-xs text-[#14213D]">{member.full_name}</p>
                      <span className="text-[10px] text-[#4A5568]">
                        {member.role.replace(/_/g, ' ')} • {member.phone || 'No phone'}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 pl-2">
                    {member.is_available ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3]">
                        AVAILABLE
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FCE8EC] text-[#700F2D] border border-[#F3C7CF]"
                        title={`Conflict: Assigned to ${member.active_demo?.demo_no} at ${member.active_demo?.location}`}
                      >
                        BUSY: {member.active_demo?.demo_no || 'Assigned'}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
          </FormSection>

          <FormSection
            title="Schedule & travel"
            icon={<CalendarDays />}
            description="Confirm the date and note any travel the specialist needs."
          >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Trial Date"
              type="date"
              min={istToday()}
              value={teamForm.confirmed_date}
              // before management approval the date is not fixed here: the specialist is checked on the requested day
              disabled={selectedDemo?.status === 'requested'}
              helperText={selectedDemo?.status === 'requested' ? 'Fixed once management approves the request.' : undefined}
              onChange={(e) => {
                setTeamForm({ ...teamForm, confirmed_date: e.target.value });
                if (e.target.value) loadTeamAvailability(e.target.value);
              }}
            />

            <Input
              label="Planning Remarks"
              placeholder="e.g. Client requested 09:30 AM early briefing"
              value={teamForm.remarks}
              onChange={(e) => setTeamForm({ ...teamForm, remarks: e.target.value })}
            />
          </div>

          {/* Travel Requirement Options */}
          <div className="space-y-3">
            <Checkbox
              checked={teamForm.travel_required}
              onChange={(e) => setTeamForm({ ...teamForm, travel_required: e.target.checked })}
              label="Travel Required for Specialist"
            />

            {teamForm.travel_required && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="From"
                  value={teamForm.travel_from}
                  onChange={(e) => setTeamForm({ ...teamForm, travel_from: e.target.value })}
                />
                <Input
                  label="To"
                  value={teamForm.travel_to}
                  onChange={(e) => setTeamForm({ ...teamForm, travel_to: e.target.value })}
                />
                <Input
                  label="Travel Date"
                  type="date"
                  value={teamForm.travel_date}
                  onChange={(e) => setTeamForm({ ...teamForm, travel_date: e.target.value })}
                />
              </div>
            )}
          </div>
          </FormSection>

          <div className={`${SHEET_FOOTER} sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsAssignTeamOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              isLoading={isSubmitting}
              disabled={!teamForm.assigned_to}
            >
              Confirm Assignment
            </Button>
          </div>
        </form>
      </Modal>

      {/* 3. Reserve Equipment Modal (§9 & §10) */}
      <Modal
        isOpen={isReserveEquipOpen}
        onClose={() => setIsReserveEquipOpen(false)}
        title={`Reserve Equipment Unit — ${selectedDemo?.demo_no}`}
      >
        <form onSubmit={handleReserveSubmit} className="space-y-5 text-sm">
          {reserveModalError && (
            <div className="p-3 rounded-xl bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D] flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-xs">
                <p className="font-bold">Reservation Conflict Detected</p>
                <p>{reserveModalError}</p>
              </div>
            </div>
          )}

          {reserveConflict?.priority_analysis && (() => {
            const pa = reserveConflict.priority_analysis;
            const money = (v: unknown) => (Number(v) > 0 ? formatINR(Number(v)) : 'No value recorded');
            return (
              <div className="p-3 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] space-y-3 text-xs">
                <p className="font-bold text-[#14213D]">Priority by opportunity value (§16)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg bg-white border border-[#ECE9E2] space-y-0.5">
                    <p className="text-[10px] uppercase font-bold text-[#4A5568]">Holding the unit</p>
                    <p className="font-semibold text-[#14213D]">{pa.conflicting_demo?.demo_no} · {pa.conflicting_demo?.organisation || '—'}</p>
                    <p className="text-[#4A5568]">{pa.conflicting_demo?.salesperson || '—'}{pa.conflicting_demo?.tender_no ? ` · Tender ${pa.conflicting_demo.tender_no}` : ''}</p>
                    <p className="font-mono text-[#14213D]">{money(pa.conflicting_demo?.tender_value)}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-[#ECE9E2] space-y-0.5">
                    <p className="text-[10px] uppercase font-bold text-[#4A5568]">This demo</p>
                    <p className="font-semibold text-[#14213D]">{pa.current_demo?.demo_no}</p>
                    <p className="text-[#4A5568]">{pa.current_demo?.tender_no ? `Tender ${pa.current_demo.tender_no}` : 'No tender linked'}</p>
                    <p className="font-mono text-[#14213D]">{money(pa.current_demo?.tender_value)}</p>
                  </div>
                </div>
                <p className="text-[#4A5568]">{pa.recommendation}</p>
                {canOverrideConflict ? (
                  <div className="space-y-2">
                    <Input
                      label="Override reason (management)"
                      placeholder="Why this demo takes the unit"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    />
                    <Button type="button" variant="danger" size="sm" isLoading={isSubmitting} onClick={() => handleReserveSubmit(null, true)} className="h-10 w-full sm:h-8 sm:w-auto">
                      Override and reserve for this demo
                    </Button>
                    <p className="text-[11px] text-[#4A5568]">The other demo&apos;s reservation is marked &quot;alternative suggested&quot; and the change is audited.</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-[#4A5568]">Pick another unit or dates, or ask management to decide.</p>
                )}
              </div>
            );
          })()}

          <FormSection
            title="Dates"
            icon={<CalendarDays />}
            description="How long should the unit be held for this demo?"
          >
          <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-[#14213D] grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Demo Destination</span>
              <span className="font-semibold text-xs text-[#14213D] block mt-0.5">
                {selectedDemo?.location || 'Site Location'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Demo Required Product</span>
              <span className="font-semibold text-xs text-[#0F5E63] block mt-0.5">
                {selectedDemo?.product_name || 'Standard Specification'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Reservation Start Date *"
              type="date"
              value={reserveForm.reserved_from}
              onChange={(e) => setReserveForm({ ...reserveForm, reserved_from: e.target.value })}
              required
            />
            <Input
              label="Reservation End Date *"
              type="date"
              value={reserveForm.reserved_to}
              onChange={(e) => setReserveForm({ ...reserveForm, reserved_to: e.target.value })}
              required
            />
          </div>
          </FormSection>

          <FormSection
            title="Equipment unit *"
            icon={<Package />}
            description="Select a fleet unit (serial number & depot). Units already booked for these dates are greyed out."
            action={
              isLoadingModalEquipment && (
                <div className="flex items-center gap-1.5 text-[11px] text-[#0F5E63]">
                  <Spinner size="xs" />
                  <span className="sm:hidden">Checking…</span>
                  <span className="hidden sm:inline">Checking live date calendar...</span>
                </div>
              )
            }
          >
          <div>
            <div className="space-y-2 max-h-64 overflow-y-auto border border-[#DCD8CE] rounded-xl p-2 bg-[#FBFAF7]">
              {(() => {
                const fullRoster = modalEquipmentUnits.length > 0 ? modalEquipmentUnits : equipmentList;
                const demoProductId = selectedDemo?.product_id;
                const otherProductCount = demoProductId ? fullRoster.filter((u) => u.product_id !== demoProductId).length : 0;
                // Units of the requested product only, unless the coordinator opts to look at substitutes.
                const roster =
                  demoProductId && !showOtherProducts
                    ? fullRoster.filter((u) => u.product_id === demoProductId || u.id === reserveForm.equipment_id)
                    : fullRoster;
                const substituteToggle = demoProductId && otherProductCount > 0 && (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-dashed border-[#C9C4B8] bg-white p-2 text-[11px] font-semibold text-[#0F5E63] hover:bg-[#E3EFEE]"
                    onClick={() => setShowOtherProducts((v) => !v)}
                  >
                    {showOtherProducts
                      ? 'Show only units of the requested product'
                      : `Show ${otherProductCount} unit${otherProductCount === 1 ? '' : 's'} of other products (substitute — reason required)`}
                  </button>
                );
                const sortedRoster = [...roster].sort((a, b) => {
                  const aOnDemo = selectedDemo?.reservations?.some((r: any) => r.equipment_id === a.id);
                  const bOnDemo = selectedDemo?.reservations?.some((r: any) => r.equipment_id === b.id);
                  const aIsMaint = a.effective_status === 'maintenance' || a.availability_status === 'maintenance';
                  const bIsMaint = b.effective_status === 'maintenance' || b.availability_status === 'maintenance';
                  const aAvail = !aOnDemo && !aIsMaint && (modalEquipmentUnits.length > 0
                    ? a.is_available_for_dates !== false && a.effective_status === 'available'
                    : a.availability_status === 'available');
                  const bAvail = !bOnDemo && !bIsMaint && (modalEquipmentUnits.length > 0
                    ? b.is_available_for_dates !== false && b.effective_status === 'available'
                    : b.availability_status === 'available');
                  const aMatch = selectedDemo?.product_id && a.product_id === selectedDemo.product_id;
                  const bMatch = selectedDemo?.product_id && b.product_id === selectedDemo.product_id;

                  if (aAvail && !bAvail) return -1;
                  if (!aAvail && bAvail) return 1;
                  if (aMatch && !bMatch) return -1;
                  if (!aMatch && bMatch) return 1;
                  return 0;
                });

                if (sortedRoster.length === 0) {
                  return (
                    <>
                      <div className="p-4 text-center text-xs text-[#4A5568]">
                        {demoProductId && !showOtherProducts
                          ? `No ${selectedDemo?.product_name || 'requested product'} units found in depot inventory.`
                          : 'No fleet equipment units found in depot inventory.'}
                      </div>
                      {substituteToggle}
                    </>
                  );
                }

                return [...sortedRoster.map((unit) => {
                  const isLocationMismatch =
                    unit.current_location &&
                    selectedDemo?.location &&
                    !selectedDemo.location.toLowerCase().includes(unit.current_location.toLowerCase());

                  const isAlreadyOnThisDemo = selectedDemo?.reservations?.some((r: any) => r.equipment_id === unit.id);
                  const isMaintenance = unit.effective_status === 'maintenance' || unit.availability_status === 'maintenance';
                  const isReserved = modalEquipmentUnits.length > 0
                    ? (!unit.is_available_for_dates || unit.effective_status === 'reserved')
                    : (unit.availability_status === 'reserved');
                  const isAvailable = !isAlreadyOnThisDemo && !isMaintenance && !isReserved;
                  const isProductMatch = selectedDemo?.product_id && unit.product_id === selectedDemo.product_id;
                  // §16: management may still pick a unit booked for another demo; the API then compares the two
                  // opportunities' values and offers the override. Everyone else picks a free unit.
                  const isOverridable = canOverrideConflict && isReserved && !isAlreadyOnThisDemo && !isMaintenance;

                  if (!isAvailable && !isOverridable) {
                    return (
                      <div
                        key={unit.id}
                        className="block p-2.5 rounded-lg border border-[#DCD8CE] bg-[#FBFAF7]/90 text-[#4A5568] cursor-not-allowed select-none transition-all"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="reserve_unit"
                              disabled
                              checked={false}
                              className="mt-0.5 cursor-not-allowed opacity-40"
                            />
                            <div>
                              <p className="font-semibold text-xs text-[#4A5568] line-through">
                                {unit.model} — {unit.serial_no || 'Unserialized'}
                              </p>
                              <span className="text-[10px] text-[#4A5568]">
                                Product: {unit.product_name} • Depot: {unit.current_location}
                              </span>
                              {unit.conflicting_reservation ? (
                                <p className="text-[10px] text-[#881337] font-semibold mt-0.5">
                                  ⚠️ Booked for {unit.conflicting_reservation.demo_no || 'Another Demo'} ({dmy(unit.conflicting_reservation.reserved_from)} to {dmy(unit.conflicting_reservation.reserved_to)})
                                </p>
                              ) : isAlreadyOnThisDemo ? (
                                <p className="text-[10px] text-[#0B4A4E] font-semibold mt-0.5">
                                  ℹ️ Already allocated to this Demo ({selectedDemo?.demo_no})
                                </p>
                              ) : isMaintenance ? (
                                <p className="text-[10px] text-[#881337] font-semibold mt-0.5">
                                  ⚠️ Unit is currently under maintenance
                                </p>
                              ) : (
                                <p className="text-[10px] text-[#7C2D12] font-semibold mt-0.5">
                                  ⚠️ Unit is currently locked or reserved for selected dates
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isAlreadyOnThisDemo ? (
                              <Badge variant="info" size="sm">ALREADY ALLOCATED</Badge>
                            ) : isMaintenance ? (
                              <Badge variant="danger" size="sm">MAINTENANCE</Badge>
                            ) : (
                              <Badge variant="warning" size="sm">RESERVED FOR DATES</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <label
                      key={unit.id}
                      className={`block p-2.5 rounded-lg border cursor-pointer transition-all ${
                        reserveForm.equipment_id === unit.id
                          ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#14213D] shadow-sm ring-1 ring-[#0F5E63]/20'
                          : 'bg-white border-[#DCD8CE] text-[#14213D] hover:bg-[#E3EFEE]'
                      }`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="reserve_unit"
                            value={unit.id}
                            checked={reserveForm.equipment_id === unit.id}
                            onChange={() => setReserveForm({ ...reserveForm, equipment_id: unit.id })}
                            className="cursor-pointer"
                          />
                          <div>
                            <p className="font-semibold text-xs text-[#14213D]">
                              {unit.model} — {unit.serial_no || 'Unserialized'}
                            </p>
                            <span className="text-[10px] text-[#4A5568]">
                              Product: {unit.product_name} • Depot: {unit.current_location}
                            </span>
                            {isOverridable && (
                              <p className="text-[10px] text-[#9A3412] font-semibold mt-0.5">
                                Booked for {unit.conflicting_reservation?.demo_no || 'another demo'}
                                {unit.conflicting_reservation
                                  ? ` (${dmy(unit.conflicting_reservation.reserved_from)} to ${dmy(unit.conflicting_reservation.reserved_to)})`
                                  : ''}
                                {' '}· management can override by opportunity value
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                          {isProductMatch && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20">
                              MATCHES DEMO PRODUCT
                            </span>
                          )}
                          {selectedDemo?.product_id && unit.product_id && !isProductMatch && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#FBEBDD] text-[#9A3412] border border-[#9A3412]/20">
                              OTHER PRODUCT
                            </span>
                          )}
                          {isLocationMismatch && (
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FFF8EB] text-[#7C2D12] border border-[#E9C9B4]"
                              title={`Depot (${unit.current_location}) differs from Demo Location (${selectedDemo?.location})`}
                            >
                              DEPOT MISMATCH
                            </span>
                          )}
                          {isOverridable ? (
                            <Badge variant="warning" size="sm">RESERVED FOR DATES</Badge>
                          ) : (
                            <Badge variant="success" size="sm">AVAILABLE</Badge>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                }), <React.Fragment key="__substitute_toggle">{substituteToggle}</React.Fragment>];
              })()}
            </div>
            {(() => {
              const roster = modalEquipmentUnits.length > 0 ? modalEquipmentUnits : equipmentList;
              const chosen = roster.find((u) => u.id === reserveForm.equipment_id);
              if (!chosen || !selectedDemo?.product_id || !chosen.product_id || chosen.product_id === selectedDemo.product_id) return null;
              return (
                <div className="mt-2 space-y-2 rounded-lg border border-[#9A3412]/30 bg-[#FBEBDD] p-3 text-xs text-[#7C2D12]">
                  <p>
                    <strong>Substitute unit:</strong> {chosen.model} is a {chosen.product_name || 'different product'} unit, but this demo is for{' '}
                    {selectedDemo.product_name || 'another product'}.
                  </p>
                  <Input
                    label="Reason for sending a substitute *"
                    placeholder="e.g. Requested model under calibration; client agreed to trial the variant"
                    value={substituteReason}
                    onChange={(e) => setSubstituteReason(e.target.value)}
                    required
                  />
                </div>
              );
            })()}
          </div>
          </FormSection>

          <FormSection title="Logistics" icon={<Plane />}>
          <Input
            label="Reservation / Logistics Remarks"
            placeholder="e.g. Courier dispatch arranged via BlueDart secure air-cargo"
            value={reserveForm.remarks}
            onChange={(e) => setReserveForm({ ...reserveForm, remarks: e.target.value })}
          />
          </FormSection>

          <div className={`${SHEET_FOOTER} sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsReserveEquipOpen(false)}>
              Cancel
            </Button>
            {(() => {
              const roster = modalEquipmentUnits.length > 0 ? modalEquipmentUnits : equipmentList;
              const chosen = roster.find((u) => u.id === reserveForm.equipment_id);
              const isChosenBookable =
                chosen &&
                !selectedDemo?.reservations?.some((r: any) => r.equipment_id === chosen.id) &&
                chosen.effective_status !== 'maintenance' &&
                chosen.availability_status !== 'maintenance';
              const isChosenAvailable =
                isChosenBookable &&
                (modalEquipmentUnits.length > 0
                  ? chosen.is_available_for_dates !== false && chosen.effective_status === 'available'
                  : chosen.availability_status === 'available');
              // management may submit a booked unit: the API answers with the value comparison and the override
              const canSubmit = isChosenAvailable || (canOverrideConflict && isChosenBookable);

              return (
                <Button
                  variant="primary"
                  type="submit"
                  isLoading={isSubmitting}
                  disabled={!reserveForm.equipment_id || !canSubmit}
                >
                  Lock Reservation
                </Button>
              );
            })()}
          </div>
        </form>
      </Modal>

      {/* 4. Confirm Date Modal (§14) */}
      <Modal
        isOpen={isConfirmDateOpen}
        onClose={() => setIsConfirmDateOpen(false)}
        title={`Confirm Demo Date — ${selectedDemo?.demo_no}`}
      >
        <form onSubmit={handleConfirmDateSubmit} className="space-y-4 text-sm">
          <p className="text-xs text-[#4A5568]">
            Requested date is <strong className="font-mono">{dmy(selectedDemo?.requested_date)}</strong>. Confirm the final
            scheduled date approved by client command.
          </p>
          {(() => {
            const held = (selectedDemo?.reservations || []).filter((r: any) => ['approved', 'requested'].includes(r.status));
            if (!held.length) return null;
            return (
              <div className="rounded-lg border border-[#DCD8CE] bg-[#FBFAF7] p-3 text-xs text-[#14213D] space-y-1">
                <span className="text-[10px] font-bold uppercase text-[#4A5568] block">Equipment reserved</span>
                {held.map((r: any) => (
                  <div key={r.id} className="font-mono">
                    {r.model || 'Unit'} ({r.serial_no || 'no serial'}): {dmy(r.reserved_from)} – {dmy(r.reserved_to || r.reserved_from)}
                  </div>
                ))}
              </div>
            );
          })()}

          {confirmError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D] space-y-2">
              <p>{confirmError.message}</p>
              {confirmError.outsideReservation && (
                <Checkbox
                  checked={confirmForm.extend_reservation}
                  onChange={(e) => setConfirmForm({ ...confirmForm, extend_reservation: e.target.checked })}
                  label="Extend the reservation to cover this date"
                  description="Only possible when no other demo holds the unit on the added days."
                />
              )}
            </div>
          )}

          <Input
            label="Final Confirmed Date *"
            type="date"
            min={istToday()}
            value={confirmForm.confirmed_date}
            onChange={(e) => setConfirmForm({ ...confirmForm, confirmed_date: e.target.value, extend_reservation: false })}
            required
          />

          <Input
            label="Confirmation Remarks"
            placeholder="e.g. Site gate pass sanctioned by DIG office"
            value={confirmForm.remarks}
            onChange={(e) => setConfirmForm({ ...confirmForm, remarks: e.target.value })}
          />

          <div className={`${SHEET_FOOTER} sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsConfirmDateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Confirm Date
            </Button>
          </div>
        </form>
      </Modal>

      {/* 5. Reschedule Modal (§16) */}
      <Modal
        isOpen={isRescheduleOpen}
        onClose={() => setIsRescheduleOpen(false)}
        title={`Reschedule Demo — ${selectedDemo?.demo_no}`}
      >
        <form onSubmit={handleRescheduleSubmit} className="space-y-4 text-sm">
          <div className="p-3 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-xs text-[#7C2D12]">
            Current Date: <strong className="font-mono">{dmy(demoDay(selectedDemo))}</strong>.
            Rescheduling will update or release reserved equipment and re-verify specialist availability.
          </div>

          <Input
            label="New Demonstration Date *"
            type="date"
            min={istToday()}
            value={rescheduleForm.new_date}
            onChange={(e) => setRescheduleForm({ ...rescheduleForm, new_date: e.target.value })}
            required
          />

          <Input
            label="Rescheduling Reason *"
            placeholder="e.g. Client inspection postponed due to state VIP security deployment"
            value={rescheduleForm.reason}
            onChange={(e) => setRescheduleForm({ ...rescheduleForm, reason: e.target.value })}
            required
          />

          <div className={`${SHEET_FOOTER} sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsRescheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              isLoading={isSubmitting}
              disabled={!rescheduleForm.reason}
            >
              Reschedule Demo
            </Button>
          </div>
        </form>
      </Modal>

      {/* 6. Cancel Demo Modal (§15) */}
      <Modal
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        title={`Cancel Demonstration — ${selectedDemo?.demo_no}`}
      >
        <form onSubmit={handleCancelSubmit} className="space-y-4 text-sm">
          <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
            Cancelling this demonstration will immediately release all reserved equipment units back to
            the depot pool and relieve assigned team members.
          </div>

          <Select
            label="Cancellation Reason *"
            value={cancelForm.cancellation_reason}
            onChange={(e) => setCancelForm({ ...cancelForm, cancellation_reason: e.target.value })}
            options={[
              { label: 'Customer Cancelled / Postponed Indefinitely', value: 'customer_cancelled' },
              { label: 'Equipment Unavailable at Depot', value: 'equipment_unavailable' },
              { label: 'Demo Specialist Unavailable', value: 'team_unavailable' },
              { label: 'Date Conflict with Higher Priority Trial', value: 'date_conflict' },
              { label: 'Commercial Issue / Budget Frozen', value: 'commercial_issue' },
              { label: 'Other Operational Circumstance', value: 'other' },
            ]}
            required
          />

          <Input
            label="Detailed Remarks / Context"
            placeholder="e.g. Letter received from Procurement Directorate dated 21-Sep"
            value={cancelForm.remarks}
            onChange={(e) => setCancelForm({ ...cancelForm, remarks: e.target.value })}
          />

          <div className={`${SHEET_FOOTER} sm:flex-wrap sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsCancelOpen(false)}>
              Close
            </Button>
            <Button variant="danger" type="submit" isLoading={isSubmitting}>
              <span className="sm:hidden">Cancel demo</span>
              <span className="hidden sm:inline">Confirm Cancellation & Release Resources</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* 7. Outcome & Structured Failure Analysis Modal (§17 & §18) */}
      <Modal
        isOpen={isOutcomeOpen}
        onClose={() => setIsOutcomeOpen(false)}
        title={`Record Demo Outcome & Failure Analysis — ${selectedDemo?.demo_no}`}
        description="Capture complete trial execution data, customer feedback, technical performance, and structured failure root cause analysis."
        maxWidth="lg"
      >
        <form onSubmit={handleOutcomeSubmit} className="text-sm">
          <FormSteps
            onCancel={() => setIsOutcomeOpen(false)}
            submit={
              <Button variant="primary" type="submit" isLoading={isSubmitting}>
                <span className="sm:hidden">Complete demo</span>
                <span className="hidden sm:inline">Complete Demo & Update Customer History</span>
              </Button>
            }
            steps={[
              {
                title: 'Result',
                icon: <CheckCircle2 />,
                description: 'How did the demo go, and was it completed with the decision-maker present?',
                content: (
            <div className="space-y-3">
              <Select
                label="Overall Demo Result *"
                value={outcomeForm.result}
                onChange={(e: any) => setOutcomeForm({ ...outcomeForm, result: e.target.value })}
                options={[
                  { label: 'Successful Trial (Pass)', value: 'success' },
                  { label: 'Unsuccessful Trial (Deficiency / Fail)', value: 'fail' },
                  { label: 'Partial Demonstration', value: 'partial' },
                ]}
                required
              />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="pt-2">
                <Checkbox
                  checked={outcomeForm.completed}
                  onChange={(e) => setOutcomeForm({ ...outcomeForm, completed: e.target.checked })}
                  label="Demo Completed"
                  description="Field trial executed on site"
                />
              </div>

              <div className="pt-2">
                <Checkbox
                  checked={outcomeForm.decision_maker_present}
                  onChange={(e) =>
                    setOutcomeForm({ ...outcomeForm, decision_maker_present: e.target.checked })
                  }
                  label="Decision-Maker Attended"
                  description="Key officer / decision-maker present"
                />
              </div>
            </div>
            </div>
                ),
              },
              {
                title: 'Failure reason',
                icon: <AlertTriangle />,
                description: 'Primary failure reason (required for failure analysis): pick the category that best explains why the trial failed.',
                hidden: outcomeForm.result !== 'fail',
                content: (
          outcomeForm.result === 'fail' && (
            <div className="space-y-2.5">
              <Select
                value={outcomeForm.failure_reason}
                onChange={(e) => setOutcomeForm({ ...outcomeForm, failure_reason: e.target.value })}
                options={[
                  { label: 'Product limitation — Product specifications did not meet operational criteria', value: 'PRODUCT_LIMITATION' },
                  { label: 'Equipment issue — Battery, power, or hardware calibration fault', value: 'EQUIPMENT_ISSUE' },
                  { label: 'Technical failure — Sensor blackout, software crash, or signal loss', value: 'TECHNICAL_FAILURE' },
                  { label: 'Customer requirement mismatch — Prospect required custom spec outside standard BOM', value: 'CUSTOMER_REQUIREMENT_MISMATCH' },
                  { label: 'Pricing concern — Budget expectation exceeded / pricing resistance', value: 'PRICING_CONCERN' },
                  { label: 'Decision-maker unavailable — Approving authority / SP / DIG absent', value: 'DECISION_MAKER_UNAVAILABLE' },
                  { label: 'Competitor preference — Client inclined towards competitor brand/device', value: 'COMPETITOR_PREFERENCE' },
                  { label: 'Demo preparation issue — Site test targets or power source unprepared', value: 'DEMO_PREPARATION_ISSUE' },
                  { label: 'Other — Custom operational failure reason', value: 'OTHER' },
                ]}
                required
              />
              {outcomeForm.failure_reason && FAILURE_REASON_METADATA[outcomeForm.failure_reason] && (
                <div className="text-[11px] text-[#700F2D] bg-white/80 p-2.5 rounded-lg border border-[#F3C7CF] space-y-1">
                  <div><strong>Identified Pattern:</strong> {FAILURE_REASON_METADATA[outcomeForm.failure_reason].typicalRootCause}</div>
                  <div><strong>Mitigation Protocol:</strong> {FAILURE_REASON_METADATA[outcomeForm.failure_reason].recommendedCountermeasure}</div>
                </div>
              )}
            </div>
          )
                ),
              },
              {
                title: 'Assessment',
                icon: <BarChart3 />,
                description: 'How did the customer react, and how did the product perform in the field?',
                content: (
            <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Customer Response *"
                placeholder="e.g. Positive response; requested formal quote"
                value={outcomeForm.customer_response}
                onChange={(e) => setOutcomeForm({ ...outcomeForm, customer_response: e.target.value })}
                required
              />
              <Input
                label={outcomeForm.result === 'fail' ? 'What went wrong (technical performance) *' : 'Technical Performance'}
                placeholder={outcomeForm.result === 'fail' ? 'e.g. Sensor lost calibration after 20 passes' : 'e.g. 100% detection rate during 50-pass trial'}
                required={outcomeForm.result === 'fail'}
                value={outcomeForm.technical_performance}
                onChange={(e) =>
                  setOutcomeForm({ ...outcomeForm, technical_performance: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Product Suitability"
                placeholder="e.g. Fully compliant with MHA guidelines"
                value={outcomeForm.product_suitability}
                onChange={(e) => setOutcomeForm({ ...outcomeForm, product_suitability: e.target.value })}
              />
              <Input
                label="Competitor Involved (if any)"
                placeholder="e.g. Godrej, Smiths Detection, Rapiscan"
                value={outcomeForm.competitor_involved}
                onChange={(e) => setOutcomeForm({ ...outcomeForm, competitor_involved: e.target.value })}
              />
            </div>
            </div>
                ),
              },
              {
                title: 'Follow-up',
                icon: <TrendingUp />,
                description: 'Where does the opportunity stand now, and what happens next?',
                content: (
            <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Opportunity Stage"
                value={outcomeForm.opportunity_stage}
                onChange={(e) => setOutcomeForm({ ...outcomeForm, opportunity_stage: e.target.value })}
                options={[
                  { label: 'Prospect — Early stage scoping', value: 'Prospect' },
                  { label: 'Qualification — Specs matched', value: 'Qualification' },
                  { label: 'Proposal — Commercial quotation requested', value: 'Proposal' },
                  { label: 'GeM Tender Bid — Official procurement bid', value: 'Tender' },
                  { label: 'Closed Won — Purchase order in progress', value: 'Closed Won' },
                  { label: 'Closed Lost — Deal cancelled or lost to competitor', value: 'Closed Lost' },
                ]}
              />
              <Input
                label="Next Commercial Step"
                placeholder="e.g. Commercial proposal submission & follow-up meeting"
                value={outcomeForm.next_step}
                onChange={(e) => setOutcomeForm({ ...outcomeForm, next_step: e.target.value })}
              />
            </div>

            <Input
              label="Detailed Outcome Remarks / Trial Notes"
              placeholder="e.g. Demonstrated to DIG and 4 DSPs. Clean technical pass."
              value={outcomeForm.remarks}
              onChange={(e) => setOutcomeForm({ ...outcomeForm, remarks: e.target.value })}
            />
            </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      <Modal
        isOpen={!!linkedDemo}
        onClose={() => setLinkedDemo(null)}
        title={linkedDemo?.organisation_name || `Demo ${linkedDemo?.demo_no || ''}`}
        description={linkedDemo ? `${linkedDemo.demo_no} · logged ${formatDemoDate(linkedDemo.created_at)}` : undefined}
        maxWidth="4xl"
      >
        {linkedDemo && (
          <div className="space-y-5">
            {renderDemoCard(linkedDemo)}
            <RelatedRecords
              to={{ kind: 'demo', id: linkedDemo.id, organisationId: linkedDemo.organisation_id }}
              sections={['tasks', 'proposals', 'tenders', 'service']}
              description="Tasks on this demo, and the customer's proposals, tenders and service tickets."
              className="border-t border-[#ECE9E2] pt-5"
            />
            {renderDemoFooter(linkedDemo)}
          </div>
        )}
      </Modal>

      {/* 8. Audit Trail Modal (§23) */}
      <Modal
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        title={`Audit Trail & Change History — ${selectedDemo?.demo_no}`}
      >
        <div className="space-y-4 text-xs sm:max-h-96 sm:overflow-y-auto sm:pr-1">
          {selectedDemoAudit?.reschedule_events?.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-semibold text-[#14213D] text-xs">Rescheduling History:</h5>
              {selectedDemoAudit.reschedule_events.map((res: any) => (
                <div key={res.id} className="p-2.5 rounded bg-[#FBFAF7] border border-[#DCD8CE]">
                  <p className="font-medium text-[#14213D]">
                    Moved from {res.old_date ? dmy(res.old_date) : 'Initial Date'} &rarr; {dmy(res.new_date)}
                  </p>
                  <p className="text-[#4A5568] mt-0.5 italic">Reason: "{res.reason}"</p>
                  <p className="text-[10px] text-[#4A5568] mt-1">
                    By: {res.actor_name || 'Coordinator'} ({res.actor_role}) on{' '}
                    {formatDateTimeIN(res.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h5 className="font-semibold text-[#14213D] text-xs">System Events:</h5>
            {selectedDemoAudit?.audit_logs?.map((log: any) => (
              <div key={log.id} className="p-2 rounded bg-[#FBFAF7] border border-[#DCD8CE]">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <span className="min-w-0 font-mono font-semibold text-[#0F5E63]">{log.action}</span>
                  <span className="text-[10px] text-[#4A5568]">
                    {formatDateTimeIN(log.created_at)}
                  </span>
                </div>
                <p className="text-[#4A5568] mt-1">
                  Actor: {log.actor_name} ({log.actor_role})
                </p>
              </div>
            ))}
          </div>

          <div className={`${SHEET_FOOTER} sm:justify-end sm:pt-2`}>
            <Button variant="outline" size="sm" onClick={() => setIsAuditOpen(false)} className="h-10 sm:h-8">
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* 9. Add / Edit Equipment Unit Modal */}
      <Modal
        isOpen={isEquipmentModalOpen}
        onClose={() => setIsEquipmentModalOpen(false)}
        title={equipmentForm.id ? 'Edit Depot Equipment Unit' : 'Add New Depot Equipment Unit'}
      >
        <form onSubmit={handleSaveEquipment} className="text-sm">
          <FormSteps
            onCancel={() => setIsEquipmentModalOpen(false)}
            submit={
              <Button variant="primary" type="submit" isLoading={isSubmitting}>
                <span className="sm:hidden">Save unit</span>
                <span className="hidden sm:inline">Save Equipment Unit</span>
              </Button>
            }
            steps={[
              {
                title: 'Unit',
                icon: <Package />,
                description: 'Which product is this, and how is the unit identified?',
                content: (
          <div className="space-y-3">
          <Select
            label="Product Line *"
            value={equipmentForm.product_id}
            onChange={(e) => setEquipmentForm({ ...equipmentForm, product_id: e.target.value })}
            options={[
              { label: '— Select Product —', value: '' },
              ...products.map((p) => ({ label: p.name, value: p.id })),
            ]}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Model Code *"
              placeholder="e.g. DFMD-MULTI-9"
              value={equipmentForm.model}
              onChange={(e) => setEquipmentForm({ ...equipmentForm, model: e.target.value })}
              required
            />
            <Input
              label="Serial Number *"
              placeholder="e.g. DFMD-DEL-03"
              value={equipmentForm.serial_no}
              onChange={(e) => setEquipmentForm({ ...equipmentForm, serial_no: e.target.value })}
              required
            />
          </div>
          </div>
                ),
              },
              {
                title: 'Location',
                icon: <MapPin />,
                description: 'Where is the unit kept, and who is responsible for it?',
                content: (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Depot Location *"
              value={equipmentForm.current_location}
              onChange={(e) =>
                setEquipmentForm({ ...equipmentForm, current_location: e.target.value })
              }
              options={[
                { label: 'Delhi Central Depot', value: 'Delhi' },
                { label: 'Patna Regional Depot', value: 'Patna' },
                { label: 'Kolkata East Depot', value: 'Kolkata' },
              ]}
              required
            />

            <Select
              label="Responsible Custodian / Specialist"
              value={equipmentForm.responsible_person}
              onChange={(e) =>
                setEquipmentForm({ ...equipmentForm, responsible_person: e.target.value })
              }
              options={[
                { label: '— Select Custodian / Officer —', value: '' },
                // custodians approve kit requests (§16): the demo team and the service team
                ...[...teamMembers, ...serviceEngineers]
                  .filter((m, i, all) => m?.id && all.findIndex((o) => o.id === m.id) === i)
                  .map((m) => ({
                    label: `${m.full_name} (${String(m.role || 'service_team').replace(/_/g, ' ')})`,
                    value: m.id,
                  })),
                // the current custodian stays selectable even when outside both lists
                ...(equipmentForm.responsible_person &&
                ![...teamMembers, ...serviceEngineers].some((m) => m?.id === equipmentForm.responsible_person)
                  ? [{ label: equipmentForm.responsible_person_name || 'Current custodian', value: equipmentForm.responsible_person }]
                  : []),
              ]}
            />
          </div>
                ),
              },
              {
                title: 'Status',
                icon: <Wrench />,
                description: 'What condition is the unit in, and can it go out on demos?',
                content: (
          <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Operational Condition"
              value={equipmentForm.condition}
              onChange={(e) => setEquipmentForm({ ...equipmentForm, condition: e.target.value })}
              options={[
                { label: 'Operational (Ready for Field Trial)', value: 'Operational' },
                { label: 'Good (Minor Cosmetic Wear)', value: 'Good' },
                { label: 'Requires Calibration', value: 'Requires Calibration' },
                { label: 'Maintenance Underway', value: 'Maintenance' },
              ]}
            />

            <Select
              label="Availability Status"
              value={equipmentForm.availability_status}
              onChange={(e) =>
                setEquipmentForm({ ...equipmentForm, availability_status: e.target.value })
              }
              options={[
                { label: 'Available for Field Demos', value: 'available' },
                { label: 'Reserved for Demo', value: 'reserved' },
                { label: 'In Field Trial', value: 'in_use' },
                { label: 'Under Maintenance / Calibration', value: 'maintenance' },
              ]}
            />
          </div>

          <Input
            label="Remarks / Notes"
            placeholder="e.g. Staged with heavy-duty wheeled flight case"
            value={equipmentForm.remarks}
            onChange={(e) => setEquipmentForm({ ...equipmentForm, remarks: e.target.value })}
          />
          </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* 10. Reject Equipment Reservation Modal (§16) */}
      <Modal
        isOpen={isRejectOpen}
        onClose={() => setIsRejectOpen(false)}
        title="Reject Equipment Reservation Request"
      >
        <form onSubmit={handleRejectReservationSubmit} className="space-y-4 text-sm">
          <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
            Rejecting reservation for <strong>{selectedReservation?.model}</strong> (Serial:{' '}
            {selectedReservation?.serial_no || 'N/A'}) requested for Demo{' '}
            <strong>{selectedDemo?.demo_no}</strong>.
          </div>

          <Select
            label="Rejection Reason *"
            value={rejectForm.rejection_reason}
            onChange={(e) => setRejectForm({ ...rejectForm, rejection_reason: e.target.value })}
            options={[
              {
                label: 'Unit booked for another high-priority client trial',
                value: 'Unit booked for another high-priority client trial',
              },
              {
                label: 'Equipment undergoing mandatory factory calibration / repair',
                value: 'Equipment undergoing mandatory factory calibration / repair',
              },
              {
                label: 'Transit time between depots exceeds demo timeframe',
                value: 'Transit time between depots exceeds demo timeframe',
              },
              {
                label: 'Technical limitation for client proving site specifications',
                value: 'Technical limitation for client proving site specifications',
              },
              {
                label: 'Other operational reservation conflict',
                value: 'Other operational reservation conflict',
              },
            ]}
            required
          />

          <Input
            label="Custodian Remarks / Explanation"
            placeholder="e.g. Advised salesperson to request alternative unit from Patna depot"
            value={rejectForm.remarks}
            onChange={(e) => setRejectForm({ ...rejectForm, remarks: e.target.value })}
          />

          <div className={`${SHEET_FOOTER} sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" isLoading={isSubmitting}>
              Confirm Rejection
            </Button>
          </div>
        </form>
      </Modal>

      {/* 11. Suggest / Allocate Alternative Unit Modal (§16) */}
      <Modal
        isOpen={isAllocateOpen}
        onClose={() => setIsAllocateOpen(false)}
        title={allocateMode === 'suggest' ? 'Suggest an Alternative Unit' : 'Allocate Alternative Equipment Unit'}
      >
        <form onSubmit={handleAllocateAnotherSubmit} className="space-y-5 text-sm">
          <div className="p-3 rounded-lg bg-[#E3EFEE] border border-[#D0E5E3] text-xs text-[#0B4A4E]">
            Reallocating equipment for Demo <strong>{selectedDemo?.demo_no}</strong> (Site:{' '}
            {selectedDemo?.location}). Currently requested: <strong>{selectedReservation?.model}</strong>.
          </div>

          <FormSection
            title="Alternative unit *"
            icon={<Package />}
            description="Select the alternative fleet unit to send instead."
          >
          <div>
            <div className="space-y-2 max-h-52 overflow-y-auto border border-[#DCD8CE] rounded-lg p-2 bg-[#FBFAF7]">
              {equipmentList
                .filter((unit) => unit.id !== selectedReservation?.equipment_id)
                .map((unit) => (
                  <label
                    key={unit.id}
                    className={`block p-2.5 rounded-lg border cursor-pointer transition-all ${
                      allocateForm.equipment_id === unit.id
                        ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#14213D]'
                        : 'bg-white border-[#DCD8CE] text-[#14213D] hover:bg-[#E3EFEE]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="radio"
                          name="allocate_unit"
                          value={unit.id}
                          checked={allocateForm.equipment_id === unit.id}
                          onChange={() =>
                            setAllocateForm({ ...allocateForm, equipment_id: unit.id })
                          }
                        />
                        <div>
                          <p className="font-semibold text-xs text-[#14213D]">
                            {unit.model} — {unit.serial_no || 'Unserialized'}
                          </p>
                          <span className="text-[10px] text-[#4A5568]">
                            Depot: {unit.current_location} • Condition: {unit.condition}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={unit.availability_status === 'available' ? 'success' : 'warning'}
                        className="shrink-0"
                      >
                        {unit.availability_status.toUpperCase()}
                      </Badge>
                    </div>
                  </label>
                ))}
            </div>
          </div>
          </FormSection>

          <FormSection
            title="Details"
            icon={<FileText />}
            description="Why the unit is changing, the dates to hold it, and dispatch notes."
          >
          <Input
            label={allocateMode === 'suggest' ? 'Why this unit instead *' : 'Reason for Reallocation *'}
            placeholder="e.g. Primary unit reserved; allocating alternate calibrated unit from Delhi depot"
            value={allocateForm.reason}
            onChange={(e) => setAllocateForm({ ...allocateForm, reason: e.target.value })}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Reservation From"
              type="date"
              value={allocateForm.reserved_from}
              onChange={(e) => setAllocateForm({ ...allocateForm, reserved_from: e.target.value })}
            />
            <Input
              label="Reservation To"
              type="date"
              value={allocateForm.reserved_to}
              onChange={(e) => setAllocateForm({ ...allocateForm, reserved_to: e.target.value })}
            />
          </div>

          <Input
            label="Logistics Remarks"
            placeholder="e.g. Priority dispatch via road express"
            value={allocateForm.remarks}
            onChange={(e) => setAllocateForm({ ...allocateForm, remarks: e.target.value })}
          />
          </FormSection>

          <div className={`${SHEET_FOOTER} sm:justify-end sm:gap-3`}>
            <Button variant="outline" type="button" onClick={() => setIsAllocateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              isLoading={isSubmitting}
              disabled={!allocateForm.equipment_id || !allocateForm.reason}
            >
              <span className="sm:hidden">{allocateMode === 'suggest' ? 'Suggest' : 'Reallocate'}</span>
              <span className="hidden sm:inline">{allocateMode === 'suggest' ? 'Send Suggestion' : 'Confirm Reallocation'}</span>
            </Button>
          </div>
        </form>
      </Modal>
      {/* 9. Comprehensive Field Trial Incident Dossier Modal */}
      <Modal
        isOpen={isFailureDetailModalOpen}
        onClose={() => setIsFailureDetailModalOpen(false)}
        title={`Field Trial Incident Dossier — ${selectedFailureDetail?.demo_no || 'Incident Record'}`}
        maxWidth="3xl"
      >
        {selectedFailureDetail && (
          <div className="space-y-4 text-xs sm:max-h-[80vh] sm:overflow-y-auto sm:pr-1">
            {/* Incident Summary Banner */}
            <div className="p-3.5 rounded-xl bg-[#FFF8F6] border border-[#FCA5A5] flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold text-sm text-[#7C2D12]">
                  {selectedFailureDetail.organisation_name || 'Client Agency / Command'}
                </span>
                <div className="text-[11px] text-[#9A3412] mt-0.5">
                  Demo #{selectedFailureDetail.demo_no} • Version {selectedFailureDetail.version || 1} •{' '}
                  Logged{' '}
                  {formatDateTimeIN(selectedFailureDetail.updated_at || selectedFailureDetail.created_at,)}
                </div>
              </div>
              <Badge variant="urgent" size="sm" className="font-bold uppercase tracking-wider">
                FAILED TRIAL DEFICIENCY
              </Badge>
            </div>

            {/* 4 W's Detailed Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* WHEN & WHERE */}
              <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                <h5 className="font-bold text-xs uppercase tracking-wider text-[#0F5E63] flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Timeline &amp; Operational Location</span>
                </h5>
                <div className="space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">Trial Scheduled:</span>
                    <span className="text-right font-semibold text-[#14213D]">
                      {selectedFailureDetail.confirmed_date
                        ? formatDateIN(selectedFailureDetail.confirmed_date)
                        : selectedFailureDetail.requested_date
                        ? formatDateIN(selectedFailureDetail.requested_date)
                        : 'Not specified'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">Proving Grounds:</span>
                    <span className="text-right font-semibold text-[#14213D]">
                      {selectedFailureDetail.location || 'Depot'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">City &amp; Region:</span>
                    <span className="text-right font-semibold text-[#14213D]">
                      {selectedFailureDetail.city || 'Delhi'} ({selectedFailureDetail.region_id || 'Zone'})
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">Execution Scope:</span>
                    <span className="text-right font-semibold text-[#14213D]">
                      {selectedFailureDetail.outcome?.completed ? 'Completed on Site' : 'Aborted Early'}
                    </span>
                  </div>
                </div>
              </div>

              {/* WHAT */}
              <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                <h5 className="font-bold text-xs uppercase tracking-wider text-[#0F5E63] flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  <span>Equipment &amp; Quarantine Audit</span>
                </h5>
                <div className="space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">Product Name:</span>
                    <span className="text-right font-semibold text-[#14213D]">
                      {selectedFailureDetail.product_name || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">Catalog Code:</span>
                    <span className="text-right font-mono text-[#14213D]">
                      {selectedFailureDetail.product_code || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="shrink-0 text-[#4A5568]">Hardware S/N:</span>
                    <span className="text-right font-mono text-[#14213D]">
                      {selectedFailureDetail.reservations
                        ?.map((r: any) => r.serial_no)
                        .filter(Boolean)
                        .join(', ') || 'Assigned Fleet'}
                    </span>
                  </div>
                  {isQuarantiningFailure(selectedFailureDetail) && (
                    <div className="pt-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#FBEBDD] text-[#9A3412] border border-[#E9C9B4]">
                        ⚠️ Hardware Quarantined in Maintenance
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* WHY: Root Cause Taxonomy */}
            <div className="p-3.5 rounded-xl bg-white border border-[#FCA5A5] space-y-2">
              <h5 className="font-bold text-xs uppercase tracking-wider text-[#9A3412] flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Root Cause Analysis &amp; Taxonomy Classification</span>
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[#4A5568]">Category:</div>
                  <div className="font-bold text-[#7C2D12]">
                    {FAILURE_REASON_METADATA[selectedFailureDetail.outcome?.failure_reason]?.label ||
                      selectedFailureDetail.outcome?.failure_reason ||
                      'Unspecified'}
                  </div>
                  <div className="text-[11px] font-mono text-[#9A3412] mt-0.5">
                    {selectedFailureDetail.outcome?.failure_reason}
                  </div>
                </div>
                <div>
                  <div className="text-[#4A5568]">Field Deficiency Notes:</div>
                  <div className="text-[#14213D] font-medium italic mt-0.5">
                    "{selectedFailureDetail.outcome?.remarks ||
                      selectedFailureDetail.outcome?.notes ||
                      'Deficiency recorded during live testing.'}"
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-[#ECE9E2] text-xs">
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#4A5568]">Technical Performance</div>
                  <div className="text-[#14213D] mt-0.5">
                    {selectedFailureDetail.outcome?.technical_performance || 'Not compliant'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#4A5568]">Client Feedback</div>
                  <div className="text-[#14213D] mt-0.5">
                    {selectedFailureDetail.outcome?.customer_feedback ||
                      selectedFailureDetail.outcome?.customer_response ||
                      'Expressed objections'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#4A5568]">Recovery Step</div>
                  <div className="text-[#14213D] mt-0.5">
                    {selectedFailureDetail.outcome?.next_step || 'Service overhaul'}
                  </div>
                </div>
              </div>
            </div>

            {/* Crew, Logistics & Escort */}
            <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#ECE9E2] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-[#4A5568]">Sales Officer: </span>
                <strong className="text-[#14213D]">
                  {selectedFailureDetail.assignee_name ||
                    selectedFailureDetail.created_by_name ||
                    'Assigned Officer'}
                </strong>
              </div>
              <div>
                <span className="text-[#4A5568]">Service Escort: </span>
                {selectedFailureDetail.service_escort_required ? (
                  <span className="font-bold text-[#0F5E63]">
                    🛡️ Attached ({selectedFailureDetail.service_engineer_name || 'Engineer On-Site'})
                  </span>
                ) : (
                  <span className="font-medium text-[#4A5568]">⚠️ Unescorted Solo Sales</span>
                )}
              </div>
              <div>
                <span className="text-[#4A5568]">Decision-Maker: </span>
                <strong
                  className={
                    selectedFailureDetail.outcome?.decision_maker_present
                      ? 'text-[#0B4A4E]'
                      : 'text-[#4A5568]'
                  }
                >
                  {selectedFailureDetail.outcome?.decision_maker_present ? '✓ Attended' : 'Absent'}
                </strong>
              </div>
            </div>

            {/* Module 6 Ticket Callout */}
            {(selectedFailureDetail.service_ticket_id ||
              selectedFailureDetail.outcome?.service_ticket_id) && (
              <div className="p-3 rounded-xl bg-[#FFF8F6] border border-[#FCA5A5] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-[#9A3412]" />
                  <div>
                    <span className="font-bold text-xs text-[#7C2D12]">
                      Module 6 Breakdown Ticket Auto-Logged
                    </span>
                    <div className="font-mono text-[11px] text-[#9A3412]">
                      Ticket No:{' '}
                      {selectedFailureDetail.service_ticket_no || selectedFailureDetail.service_ticket_id}
                    </div>
                  </div>
                </div>
                <Link href={selectedFailureDetail.service_ticket_id ? `/service?open=${selectedFailureDetail.service_ticket_id}` : '/service'}>
                  <Button size="sm" variant="primary" className="h-10 w-full sm:h-8 sm:w-auto bg-[#9A3412] hover:bg-[#7C2D12] text-white">
                    Open Ticket in Service Desk &rarr;
                  </Button>
                </Link>
              </div>
            )}

            {/* Modal Actions */}
            <div className={`${SHEET_FOOTER} sm:justify-between`}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleOpenAudit(selectedFailureDetail);
                }}
                className="h-10 sm:h-8"
              >
                <History className="h-3.5 w-3.5 mr-1 shrink-0 text-[#0F5E63]" />
                <span className="sm:hidden">Audit trail</span>
                <span className="hidden sm:inline">Inspect Full Audit Trail</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsFailureDetailModalOpen(false)}
                className="h-10 sm:h-8"
              >
                Close Dossier
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}

export default function DemosPage() {
  return (
    <React.Suspense
      fallback={
        <PageLoader label="Loading field demonstration command" className="m-6" />
      }
    >
      <DemosPageContent />
    </React.Suspense>
  );
}
