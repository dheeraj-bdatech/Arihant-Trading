'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { availableFirst, fleetHint, kitForProduct, kitValue, unitHint } from '@/app/(app)/demos/_lib/fleet';
import type { SelectOption } from '@/components/ui';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { INDIAN_STATES, canonicalState, resolveLocation, stateOfCity } from './_lib/india-geo';
import { SECTOR_OPTIONS } from './_lib/sectors';
import { LeadConversation } from './_lib/LeadConversation';
import { calendarDay } from '@/lib/calendar-day';
import {
  Target,
  Search,
  Plus,
  Building,
  User,
  Phone,
  Mail,
  Clock,
  ChevronRight,
  RefreshCw,
  FileText,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Award,
  Layers,
  Sparkles,
  ExternalLink,
  MapPin,
  Tag,
  Paperclip,
  Check,
  X,
  Send,
  MessageSquare,
  Users,
  ShieldCheck,
  Briefcase,
  Compass,
  DollarSign,
  AlertCircle,
  Edit,
  History,
  Activity,
  UserCheck,
  CalendarDays,
  CheckCircle2,
  Bell,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  LayoutList,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useOpenParam } from '@/lib/use-open-param';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { RelatedRecords } from '@/components/links/RelatedRecords';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Modal,
  FormSteps,
  FormSection,
  Input,
  Select,
  Textarea,
  EmptyState,
  InfoCallout,
  PageHeader,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell, Spinner, PageLoader, StatGrid, FilterMenu,
  RecordViews,
  RecordTable,
  formatDateIN,
  daysFromToday,
  toneFor,
  ScrollStrip,
} from '@/components/ui';
import type { BadgeProps, BoardLane, RecordItem } from '@/components/ui';
import { formatLakh, LeadStatus, LeadCategory, LeadType, LeadLossReason, InteractionType, FollowUpStatus, INDIAN_MOBILE_PATTERN, isClosedLeadStatus } from '@arihant/shared';

const LEAD_CATEGORY_OPTIONS: { value: LeadCategory; label: string }[] = [
  { value: 'new_lead', label: 'New Lead' },
  { value: 'active', label: 'Active Pipeline' },
  { value: 'expected', label: 'Expected Deal' },
  { value: 'follow_up', label: 'Follow-up' },
];

const LEAD_SOURCE_OPTIONS = [
  { value: 'field_visit', label: 'Field Visit / On-Site' },
  { value: 'gem_portal', label: 'GeM Portal (Government e-Marketplace)' },
  { value: 'tender', label: 'Tender / E-Procurement Portal' },
  { value: 'referral', label: 'Referral / Recommendation' },
  { value: 'exhibition', label: 'Exhibition / Defense Expo' },
  { value: 'cold_outreach', label: 'Cold Outreach' },
  { value: 'website', label: 'Inbound / Company Website' },
  { value: 'partner', label: 'OEM / Partner Channel' },
];

/** Stages a lead can be registered in — later stages are reached through the lifecycle actions (QA DEF-059). */
const INITIAL_LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A supporting document on a logged interaction (Module 1 §8) — persisted to interaction_attachments. */
interface InteractionAttachment {
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}
const MAX_INTERACTION_FILE_BYTES = 10 * 1024 * 1024;

/** Signed direct upload through the shared uploads API (POST /uploads/sign → Cloudinary). */
async function uploadInteractionFile(file: File): Promise<InteractionAttachment> {
  const sig = await api.post<{ timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string; allowedFormats: string }>('/uploads/sign', {
    folder: 'interaction-documents',
  });
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('allowed_formats', sig.allowedFormats); // signed by the API — must be sent exactly as returned
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/auto/upload`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.secure_url) throw new Error(data?.error?.message || 'Upload failed');
  return {
    file_url: data.secure_url as string,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || 'application/octet-stream',
  };
}
/** A status that records the lead as won — CONVERTED, or legacy WON (from legacy OPEN / QUOTED leads); both need the PO. */
const isWinStatus = (st?: string | null) => st === 'converted' || st === 'won';

const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New / Inquired' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'follow_up', label: 'Follow-up Active' },
  { value: 'demo', label: 'Demo Scheduled' },
  { value: 'proposal', label: 'Proposal / Quoted' },
  { value: 'tender_discussion', label: 'Tender Discussion' },
  { value: 'negotiation', label: 'Commercial Negotiation' },
  { value: 'converted', label: 'Converted / Won' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'dropped', label: 'Dropped / Lost' },
];

// Lead register table (RecordViews list) badge helpers — same vocabulary as the regional registers.
type BadgeVariant = NonNullable<BadgeProps['variant']>;
const leadStatusBadge = (lane?: string): BadgeVariant => (lane === 'converted' ? 'success' : lane === 'lost' ? 'danger' : 'default');
const upperLabel = (s?: string | null) => String(s || '—').replace(/_/g, ' ');

const INTERACTION_TYPE_OPTIONS = [
  { value: 'call', label: 'Phone Call' },
  { value: 'physical_visit', label: 'Physical Visit / Meeting' },
  { value: 'video_conference', label: 'Video Conference' },
  { value: 'email', label: 'Email Correspondence' },
  { value: 'whatsapp', label: 'WhatsApp Message' },
  { value: 'demo', label: 'Demonstration / Trial' },
  { value: 'other', label: 'Other Touchpoint' },
];

// Specific Demo Kit standard accessories mapping
/** Leads fetched per request while the register scrolls. */
const LEADS_PAGE_SIZE = 25;

export default function LeadsPage() {
  const { user, hasRole, switchRole } = useAuth();
  const canReassign = hasRole(['management', 'regional_manager', 'admin']);
  const [isSwitchingPersona, setIsSwitchingPersona] = useState(false);

  // Quick switch role handler for modal self-service
  const handleQuickSwitchRole = async (role: 'regional_manager' | 'management') => {
    try {
      setIsSwitchingPersona(true);
      setFormError(null);
      await switchRole(role);
    } catch (err: any) {
      setFormError('Failed to switch persona: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSwitchingPersona(false);
    }
  };

  // Active Workspace Tab: 'leads' | 'customers' | 'followups' | 'reports'
  const [activeTab, setActiveTab] = useState<string>('leads');

  // Master Data
  const [productsList, setProductsList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [zonesList, setZonesList] = useState<any[]>([]);
  const [regionsList, setRegionsList] = useState<any[]>([]);
  const [demoEquipmentList, setDemoEquipmentList] = useState<any[]>([]);
  const [leadDemoTeamAvailability, setLeadDemoTeamAvailability] = useState<any[]>([]);
  const [isLoadingLeadTeamAvailability, setIsLoadingLeadTeamAvailability] = useState(false);
  const [organisationsList, setOrganisationsList] = useState<any[]>([]);

  // 1. Leads State (the register itself is useInfiniteList below, paged as the reader scrolls)
  const [leadFilters, setLeadFilters] = useState({
    search: '',
    lead_status: '',
    lead_type: '',
    sector: '',
    lead_source: '',
    followup: '',
    created_from: '',
    created_to: '',
    sort_by: 'created_at',
    sort_dir: 'desc' as 'asc' | 'desc',
  });
  // Type / Source / Sector live in the "More" inline panel under the filter row.
  const [moreLeadFiltersOpen, setMoreLeadFiltersOpen] = useState(false);
  // Created-date From / To live in the "Dates" inline panel under the filter row.
  const [leadDatesOpen, setLeadDatesOpen] = useState(false);
  // A From after To is not sent (the API rejects it); the panel shows the error instead.
  const leadDateRangeInvalid = Boolean(leadFilters.created_from && leadFilters.created_to && leadFilters.created_from > leadFilters.created_to);

  // 2. Customers / Organisations State
  const [customers, setCustomers] = useState<any[]>([]);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [totalCustomersCount, setTotalCustomersCount] = useState(0);
  const [customersPage, setCustomersPage] = useState(1);
  const [customersTotalPages, setCustomersTotalPages] = useState(1);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  // 3. Follow-ups Desk State
  const [followups, setFollowups] = useState<any[]>([]);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupTimeframe, setFollowupTimeframe] = useState<string>('all');

  // 4. Executive Metrics HUD State
  const [leadStats, setLeadStats] = useState<any | null>(null);
  const [followupStats, setFollowupStats] = useState<any | null>(null);

  // 5. Executive Reports State
  const [reportSubTab, setReportSubTab] = useState<string>('salesperson');
  const [salespersonReport, setSalespersonReport] = useState<any[]>([]);
  const [zoneReport, setZoneReport] = useState<any[]>([]);
  const [productReport, setProductReport] = useState<any[]>([]);
  const [interactionReport, setInteractionReport] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  // Per-report load errors (e.g. no access) shown in place of an empty table (QA DEF-052)
  const [reportErrors, setReportErrors] = useState<Record<string, string>>({});

  // Modal Dialogs State
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
  const [isLeadDetailOpen, setIsLeadDetailOpen] = useState(false);
  const [leadDetailTab, setLeadDetailTab] = useState<'overview' | 'activity' | 'conversation' | 'products' | 'ownership' | 'linked'>('overview');
  const [showLeadFullDetails, setShowLeadFullDetails] = useState(false);
  const [showLeadStageActions, setShowLeadStageActions] = useState(false);
  const [isLogInteractionOpen, setIsLogInteractionOpen] = useState(false);
  const [isCustomer360Open, setIsCustomer360Open] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [isCompleteFollowupOpen, setIsCompleteFollowupOpen] = useState(false);
  const [isRescheduleFollowupOpen, setIsRescheduleFollowupOpen] = useState(false);

  // Selected Entities
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [customerTimeline, setCustomerTimeline] = useState<any[]>([]);
  const [customerContacts, setCustomerContacts] = useState<any[]>([]);
  const [customerLeads, setCustomerLeads] = useState<any[]>([]);
  const [customerTimelineLoading, setCustomerTimelineLoading] = useState(false);
  const [customerManagementSummary, setCustomerManagementSummary] = useState<any | null>(null);
  const [c360Tab, setC360Tab] = useState<'management' | 'timeline' | 'contacts' | 'deals' | 'linked'>('management');
  const [selectedFollowup, setSelectedFollowup] = useState<any | null>(null);

  // Form States
  const [actionLoading, setActionLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createLeadError, setCreateLeadError] = useState<string | null>(null);
  // Inline field errors for the Register Lead form (QA DEF-102) — shown after the first submit, then kept live
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const [leadSubmitAttempted, setLeadSubmitAttempted] = useState(false);
  // Wizard pages already checked by "Next" — their errors stay live as the user edits (QA DEF-102).
  const [leadCheckedSteps, setLeadCheckedSteps] = useState<number[]>([]);
  // Synchronous guard: a double-click fires two submits before `actionLoading` re-renders the button (QA DEF-012)
  const createLeadInFlight = useRef(false);

  // Create Lead Form (Complete 18 Parameters)
  const [leadForm, setLeadForm] = useState({
    organisation_mode: 'new' as 'new' | 'existing',
    organisation_id: '',
    organisation_name: '',
    department: '',
    city: '',
    state: '',
    zone_id: '',
    region_id: '',
    sector: '',
    contact_name: '',
    contact_designation: '',
    contact_mobile: '',
    contact_email: '',
    product_ids: [] as string[],
    source: 'field_visit',
    category: 'new_lead' as LeadCategory,
    assigned_to: '',
    regional_manager_id: '',
    remarks: '',
    lead_status: 'new' as LeadStatus,
    last_interaction_date: istToday(),
    last_interaction_type: 'call',
    next_followup_date: '',
    value_lakh: '',
  });

  // Filter regions based on currently selected zone
  const filteredRegions = useMemo(() => {
    if (!leadForm.zone_id) return regionsList;
    return regionsList.filter((r) => r.zone_id === leadForm.zone_id);
  }, [regionsList, leadForm.zone_id]);

  // Who a new lead can be assigned to (QA DEF-060): sales register in their own name; Regional Managers pick
  // themselves or their team; management / admin pick any active salesperson or Regional Manager. Mirrors the API.
  const assignableSalespeople = useMemo(() => {
    const active = usersList.filter((u) => u.is_active !== false);
    if (user?.role === 'sales') {
      const self = active.find((u) => u.id === user.id);
      return [self || { id: user.id, full_name: user.full_name, role: user.role, reporting_manager_id: user.reporting_manager_id }];
    }
    const owners = active.filter((u) => u.role === 'sales' || u.role === 'regional_manager');
    if (user?.role === 'regional_manager') {
      return owners.filter(
        (u) => u.id === user.id || u.reporting_manager_id === user.id || (Boolean(user.region_id) && u.region_id === user.region_id),
      );
    }
    return owners;
  }, [usersList, user]);

  // Regional Managers a lead can report to (QA DEF-100) — active Regional Managers, plus management as escalation.
  const regionalManagerOptions = useMemo(
    () => usersList.filter((u) => u.is_active !== false && (u.role === 'regional_manager' || u.role === 'management')),
    [usersList],
  );

  /** Default Regional Manager for a lead owner: an RM supervises their own leads, a salesperson reports to theirs. */
  const defaultRmFor = (userId: string) => {
    const owner = usersList.find((u) => u.id === userId) || (user?.id === userId ? user : null);
    if (!owner) return '';
    if (owner.role === 'regional_manager') return owner.id;
    return owner.reporting_manager_id || '';
  };

  const handleSalespersonChange = (userId: string) => {
    setLeadForm((prev) => ({
      ...prev,
      assigned_to: userId,
      regional_manager_id: defaultRmFor(userId) || prev.regional_manager_id,
    }));
  };

  /** City typed → state filled in when the city is well known and the state was empty or derived (QA DEF-099). */
  const handleLeadCityChange = (city: string) => {
    setLeadForm((prev) => {
      const derived = stateOfCity(city);
      const stateWasDerived = !prev.state || stateOfCity(prev.city) === prev.state;
      return { ...prev, city, state: derived && stateWasDerived ? derived : prev.state };
    });
  };

  /** Register Lead form rules — the same rules the API enforces, shown inline under each field (QA DEF-102). */
  const validateLeadForm = (f: typeof leadForm): Record<string, string> => {
    const e: Record<string, string> = {};
    const today = istToday();
    if (f.organisation_mode === 'new' && !f.organisation_name.trim()) e.organisation_name = 'Organisation name is required';
    if (f.organisation_mode === 'existing' && !f.organisation_id) e.organisation_id = 'Select an existing organisation';
    if (!f.city.trim()) e.city = 'City is required';
    if (!f.state.trim()) e.state = 'State is required';
    else {
      const location = resolveLocation(f.city, f.state);
      if (location.error) e.state = location.error;
    }
    if (!f.sector) e.sector = 'Select a sector';
    if (!f.zone_id) e.zone_id = 'Select a zone';
    if (!f.region_id) e.region_id = 'Select a region';
    if (!f.contact_name.trim()) e.contact_name = 'Contact person name is required';
    if (!f.contact_designation.trim()) e.contact_designation = 'Designation / rank is required';
    if (!f.contact_mobile.trim()) e.contact_mobile = 'Mobile number is required';
    else if (!INDIAN_MOBILE_PATTERN.test(f.contact_mobile.trim())) e.contact_mobile = 'Enter a valid 10-digit mobile number (e.g. 98110 00000)';
    if (f.contact_email.trim() && !EMAIL_PATTERN.test(f.contact_email.trim())) e.contact_email = 'Enter a valid email address';
    if (f.product_ids.length === 0) e.product_ids = 'Select at least one product interest';
    if (!INITIAL_LEAD_STATUSES.includes(f.lead_status)) e.lead_status = 'A new lead starts as New, Contacted or Qualified';
    if (f.value_lakh !== '' && !(Number(f.value_lakh) > 0)) e.value_lakh = 'Estimated deal value must be greater than zero';
    if (!f.assigned_to) e.assigned_to = 'Select the salesperson who owns this lead';
    if (!f.last_interaction_date) e.last_interaction_date = 'Last interaction date is required';
    else if (f.last_interaction_date > today) e.last_interaction_date = 'Last interaction date cannot be in the future';
    if (f.next_followup_date) {
      if (f.next_followup_date < today) e.next_followup_date = 'Next follow-up cannot be in the past';
      else if (f.last_interaction_date && f.next_followup_date < f.last_interaction_date)
        e.next_followup_date = 'Next follow-up cannot be before the last interaction';
    }
    return e;
  };

  /** Register Lead wizard pages (Organisation & Location / Contact & Opportunity / Follow-up) and the fields on each. */
  const LEAD_STEP_FIELDS: string[][] = [
    ['organisation_name', 'organisation_id', 'city', 'state', 'sector', 'zone_id', 'region_id'],
    ['contact_name', 'contact_designation', 'contact_mobile', 'contact_email', 'lead_status', 'product_ids', 'value_lakh'],
    ['assigned_to', 'last_interaction_date', 'next_followup_date'],
  ];
  const leadErrorsFor = (f: typeof leadForm, pages: number[]) => {
    const keys = pages.flatMap((p) => LEAD_STEP_FIELDS[p] ?? []);
    return Object.fromEntries(Object.entries(validateLeadForm(f)).filter(([k]) => keys.includes(k)));
  };

  /** "Next" in the wizard: show every error on the current page inline, all at once (QA DEF-102). */
  const validateLeadStep = (page: number) => {
    const pages = Array.from(new Set([...leadCheckedSteps, page]));
    setLeadCheckedSteps(pages);
    const errors = leadErrorsFor(leadForm, pages);
    setLeadErrors(errors);
    return !Object.keys(errors).some((k) => (LEAD_STEP_FIELDS[page] ?? []).includes(k));
  };

  // After the first submit (or a checked page), errors follow the user's edits so each message clears as soon as it is fixed
  useEffect(() => {
    if (leadSubmitAttempted) setLeadErrors(validateLeadForm(leadForm));
    else if (leadCheckedSteps.length) setLeadErrors(leadErrorsFor(leadForm, leadCheckedSteps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadForm, leadSubmitAttempted, leadCheckedSteps]);

  const handleZoneChange = (zoneId: string) => {
    setLeadForm((prev) => {
      const isRegionInZone = regionsList.some((r) => r.id === prev.region_id && r.zone_id === zoneId);
      return {
        ...prev,
        zone_id: zoneId,
        region_id: isRegionInZone ? prev.region_id : '',
      };
    });
  };

  const handleSelectExistingOrg = async (orgId: string) => {
    const found = organisationsList.find((o) => o.id === orgId) || customers.find((c) => c.id === orgId);
    setLeadForm((prev) => ({
      ...prev,
      organisation_id: orgId,
      organisation_name: found?.name || prev.organisation_name,
      city: found?.city || prev.city,
      state: canonicalState(found?.state) || found?.state || prev.state,
      zone_id: found?.zone_id || prev.zone_id,
      region_id: found?.region_id || prev.region_id,
      sector: found?.sector || prev.sector,
    }));

    if (orgId) {
      try {
        const contacts = await api.get(`/contacts?organisation_id=${orgId}`);
        const cList = Array.isArray(contacts) ? contacts : contacts?.data || [];
        if (cList.length > 0) {
          const primary = cList.find((c: any) => c.is_primary) || cList[0];
          setLeadForm((prev) => ({
            ...prev,
            contact_name: primary.full_name || primary.name || '',
            contact_designation: primary.designation || '',
            contact_mobile: primary.mobile || primary.phone || '',
            contact_email: primary.email || '',
          }));
        }
      } catch (err) {
        // preserve current contact info
      }
    }
  };

  // Live Duplicate Detection Results
  const [duplicateMatches, setDuplicateMatches] = useState<any[]>([]);
  const [duplicateSuggestion, setDuplicateSuggestion] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Change Status Form
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [lossReason, setLossReason] = useState<string>('price');
  const [lossRemarks, setLossRemarks] = useState<string>('');

  // Reassign Salesperson Form
  const [newSalespersonId, setNewSalespersonId] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');

  // Add Interaction Form
  const [interactionForm, setInteractionForm] = useState({
    lead_id: '',
    organisation_id: '',
    contact_id: '',
    type: 'call',
    date: istToday(),
    notes: '',
    outcome: '',
    next_action: '',
    next_followup_date: '',
    attachments: [] as InteractionAttachment[],
  });
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Win details captured when a lead is marked CONVERTED (QA DEF-054)
  const [winPoReference, setWinPoReference] = useState('');
  const [winOrderValue, setWinOrderValue] = useState('');
  const [winOrderDate, setWinOrderDate] = useState('');
  const [statusFieldErrors, setStatusFieldErrors] = useState<Record<string, string>>({});

  // Follow-up Completion Form
  const [completionOutcome, setCompletionOutcome] = useState('');
  const [completionOutcomeError, setCompletionOutcomeError] = useState<string | null>(null);
  const [nextFollowupDateError, setNextFollowupDateError] = useState<string | null>(null);
  const [rescheduleDateError, setRescheduleDateError] = useState<string | null>(null);
  const [completionRemarks, setCompletionRemarks] = useState('');
  const [scheduleNextFollowup, setScheduleNextFollowup] = useState(false);
  const [nextFollowupDueDate, setNextFollowupDueDate] = useState('');
  const [nextFollowupDueTime, setNextFollowupDueTime] = useState('');

  // Action Success Toast
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Demo Transition Modal State
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [demoForm, setDemoForm] = useState({
    requested_date: addIsoDays(istToday(), 1),
    requested_time: '11:00',
    product_id: '',
    assigned_to: '',
    location: '',
    purpose: 'Live equipment demonstration & spec validation',
    expected_audience: 'Procurement Committee & Technical Officers',
    equipment_required: '',
    custom_accessories: '',
    auto_remind: true,
    reminder_notes: 'Please bring calibrated demonstration unit and client sign-off sheet.',
  });

  // Active selected equipment unit for Leads Demo Modal
  const selectedLeadEquipUnit = useMemo(() => {
    if (!demoForm.equipment_required || demoForm.equipment_required === 'custom') return null;
    return (demoEquipmentList || []).find(
      (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === demoForm.equipment_required
        || item.serial_no === demoForm.equipment_required
        || item.id === demoForm.equipment_required
    ) || null;
  }, [demoEquipmentList, demoForm.equipment_required]);

  // Active product fleet availability breakdown for Leads Demo Modal
  const activeLeadDemoFleet = useMemo(() => {
    const pId = demoForm.product_id;
    if (!pId) return null;
    const productUnits = (demoEquipmentList || []).filter((e) => e.product_id === pId);
    const available = productUnits.filter((e) => e.availability_status === 'available');
    const reserved = productUnits.filter((e) => e.availability_status === 'reserved' || e.availability_status === 'in_use');
    const maintenance = productUnits.filter((e) => e.availability_status === 'maintenance');
    const locations = Array.from(new Set(available.map((e) => e.current_location).filter(Boolean)));

    return {
      total: productUnits.length,
      availableCount: available.length,
      reservedCount: reserved.length,
      maintenanceCount: maintenance.length,
      availableUnits: available,
      locations,
      units: productUnits,
    };
  }, [demoEquipmentList, demoForm.product_id]);

  // Options for registered demo equipment models for Leads Demo Modal
  const leadRegisteredEquipmentOptions = useMemo(() => {
    const list = demoEquipmentList || [];
    const activeProductId = demoForm.product_id;

    // Once a product is chosen, only that product's own demo units are offered
    const units = activeProductId ? list.filter((e) => e.product_id === activeProductId) : list;
    const opts: SelectOption[] = [
      { value: '', label: activeProductId && !units.length ? '-- No demo unit for this product: pick Custom --' : '-- Choose Registered Demo Model & Serial --' },
    ];

    const formatOptLabel = (e: any) => {
      const cond = e.condition ? ` • ${e.condition}` : '';
      return `S/N: ${e.serial_no} — ${e.model} (${e.current_location} Depot${cond})`;
    };
    opts.push(...availableFirst(units.map((e) => ({ value: kitValue(e), label: formatOptLabel(e), ...unitHint(e) }))));

    opts.push({
      value: 'custom',
      label: '✎ Other / Custom Demo Model or Equipment Kit',
    });

    return opts;
  }, [demoEquipmentList, demoForm.product_id]);

  // Helper to fetch demo team availability for specified date
  const fetchLeadDemoTeamAvailability = async (dateStr: string) => {
    if (!dateStr) return;
    try {
      setIsLoadingLeadTeamAvailability(true);
      const res = await api.get('/demos/team/availability', { date: dateStr });
      if (Array.isArray(res)) {
        setLeadDemoTeamAvailability(res);
      }
    } catch (err) {
      console.warn('Could not fetch lead demo team availability:', err);
    } finally {
      setIsLoadingLeadTeamAvailability(false);
    }
  };

  useEffect(() => {
    if (isDemoModalOpen && demoForm.requested_date) {
      fetchLeadDemoTeamAvailability(demoForm.requested_date);
    }
  }, [isDemoModalOpen, demoForm.requested_date]);

  // Selected demo team member object for leads demo modal
  const selectedLeadDemoMember = useMemo(() => {
    if (!demoForm.assigned_to) return null;
    return (
      (leadDemoTeamAvailability.length > 0 ? leadDemoTeamAvailability : usersList).find(
        (u) => u.id === demoForm.assigned_to
      ) || null
    );
  }, [leadDemoTeamAvailability, usersList, demoForm.assigned_to]);

  // Demo team options with availability status tags for leads demo modal
  const leadDemoTeamOptions = useMemo(() => {
    const roster = leadDemoTeamAvailability.length > 0
      ? leadDemoTeamAvailability
      : usersList.filter((u) => ['demo_team', 'service_team', 'sales'].includes(u.role));

    return roster.map((m) => {
      const isAvail = m.is_available ?? true;
      const tag = isAvail
        ? '🟢 [AVAILABLE]'
        : `🟡 [BOOKED: ${m.active_demo?.demo_no || 'Another Trial'}]`;
      const roleTitle = m.role === 'demo_team' ? 'Demo Team Specialist' : m.role.replace(/_/g, ' ');
      return {
        value: m.id,
        label: `${tag} ${m.full_name} (${roleTitle})`,
      };
    });
  }, [leadDemoTeamAvailability, usersList]);

  // Proposal Transition Modal State
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [proposalForm, setProposalForm] = useState({
    required_date: addIsoDays(istToday(), 7),
    responsible_person_id: '',
    deal_value: '' as string | number,
    reference: '',
    remarks: 'Commercial and technical proposal formulation as per buyer specifications.',
    auto_remind: true,
  });

  // Discussion / Follow-Up Transition Modal State ("if discuss then when , all this")
  const [isDiscussionModalOpen, setIsDiscussionModalOpen] = useState(false);
  const [discussionStage, setDiscussionStage] = useState<'tender_discussion' | 'follow_up'>('tender_discussion');
  const [discussionForm, setDiscussionForm] = useState({
    discussion_date: addIsoDays(istToday(), 1),
    discussion_time: '14:30',
    mode: 'in_person',
    venue: '',
    assigned_to: '',
    agenda: 'Clause-by-clause tender specification compliance, pricing schedule, and delivery milestones.',
    auto_remind: true,
  });

  // Follow-up Reschedule Form
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleRemarks, setRescheduleRemarks] = useState('');

  // Load Master Data on Mount
  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [prodRes, usrRes, znRes, regRes, orgRes, deRes] = await Promise.allSettled([
          api.get('/masters/products'),
          // the full active roster (the API pages at 20 by default, which dropped some Regional Managers — QA DEF-100)
          api.get('/users', { limit: 100, is_active: 'true' }),
          api.get('/masters/zones'),
          api.get('/masters/regions'),
          api.get('/organisations', { limit: 200 }),
          api.get('/demos/equipment'),
        ]);

        if (prodRes.status === 'fulfilled') setProductsList(prodRes.value.data || prodRes.value || []);
        if (usrRes.status === 'fulfilled') setUsersList(usrRes.value.data || usrRes.value || []);
        if (znRes.status === 'fulfilled') setZonesList(znRes.value.data || znRes.value || []);
        if (regRes.status === 'fulfilled') setRegionsList(regRes.value.data || regRes.value || []);
        if (deRes.status === 'fulfilled') setDemoEquipmentList(Array.isArray(deRes.value) ? deRes.value : (deRes.value?.data || []));
        if (orgRes.status === 'fulfilled') {
          const orgList = orgRes.value.data || orgRes.value || [];
          setOrganisationsList(orgList);
          const totalOrgs = orgRes.value.total ?? (Array.isArray(orgRes.value) ? orgRes.value.length : orgList.length);
          setTotalCustomersCount(totalOrgs);
          setCustomersTotal((prev) => (prev > 0 ? prev : totalOrgs));
        }
      } catch (err) {
        console.error('Failed to load masters:', err);
      }
    };
    loadMasters();
  }, []);

  // The register's filters, sent to both the list and its KPI counts (/leads/dashboard), so a card counts what it lists.
  const leadFilterParams = useMemo(
    () => ({
      search: leadFilters.search || undefined,
      lead_status: leadFilters.lead_status || undefined,
      lead_type: leadFilters.lead_type || undefined,
      sector: leadFilters.sector || undefined,
      source: leadFilters.lead_source || undefined,
      followup: leadFilters.followup || undefined,
      created_from: (!leadDateRangeInvalid && leadFilters.created_from) || undefined,
      created_to: (!leadDateRangeInvalid && leadFilters.created_to) || undefined,
    }),
    [
      leadFilters.search,
      leadFilters.lead_status,
      leadFilters.lead_type,
      leadFilters.sector,
      leadFilters.lead_source,
      leadFilters.followup,
      leadFilters.created_from,
      leadFilters.created_to,
      leadDateRangeInvalid,
    ],
  );

  // Fetch Dashboard Stats (lead counts follow the register filters; answers to superseded filters are dropped)
  const statsRequest = useRef(0);
  const fetchDashboardStats = useCallback(async () => {
    const request = ++statsRequest.current;
    try {
      const [lDash, fDash] = await Promise.allSettled([
        api.get('/leads/dashboard', leadFilterParams),
        api.get('/follow-ups/metrics'),
      ]);
      if (request !== statsRequest.current) return;
      if (lDash.status === 'fulfilled') {
        const val = lDash.value?.data || lDash.value || {};
        const m = val.metrics || val;
        const totalCust = val.total_customers ?? val.totalCustomers ?? m.totalCustomers;
        if (typeof totalCust === 'number' && totalCust > 0) {
          setTotalCustomersCount(totalCust);
          setCustomersTotal((prev) => (prev > 0 && customerSearch ? prev : totalCust));
        }
        setLeadStats({
          ...val,
          ...m,
          total_leads: val.total_leads ?? val.totalLeads ?? m.totalLeads ?? m.total_leads ?? 0,
          fresh_leads: val.fresh_leads ?? val.freshLeads ?? m.freshLeads ?? m.fresh_leads ?? 0,
          reapproached_leads: val.reapproached_leads ?? val.re_approached_leads ?? val.reApproachedLeads ?? m.reApproachedLeads ?? m.reapproached_leads ?? 0,
          active_leads: val.active_leads ?? val.activeLeads ?? m.activeLeads ?? m.active_leads ?? 0,
          converted_leads: val.converted_leads ?? val.convertedLeads ?? m.convertedLeads ?? m.converted_leads ?? m.byStatus?.converted ?? 0,
          lost_leads: val.lost_leads ?? val.lostLeads ?? m.lostLeads ?? m.lost_leads ?? m.byStatus?.lost ?? 0,
        });
      }
      if (fDash.status === 'fulfilled') {
        const val = fDash.value?.data || fDash.value || {};
        setFollowupStats({
          ...val,
          dueToday: val.dueToday ?? val.due_today ?? 0,
          due_today: val.due_today ?? val.dueToday ?? 0,
          overdue: val.overdue ?? 0,
          upcoming: val.upcoming ?? 0,
          completed: val.completed ?? 0,
          total: val.total ?? 0,
        });
      }
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    }
  }, [leadFilterParams]);

  // Leads Register: one page per request, appended as the register scrolls (infinite scroll).
  // `fetchLeads` re-reads the pages already loaded, in place, after an edit.
  const fetchLeadsPage = useCallback(
    (page: number) =>
      api.get('/leads', {
        page,
        limit: LEADS_PAGE_SIZE,
        ...leadFilterParams,
        sort_by: leadFilters.sort_by !== 'created_at' ? leadFilters.sort_by : undefined,
        sort_dir: leadFilters.sort_dir !== 'desc' ? leadFilters.sort_dir : undefined,
      }),
    [leadFilterParams, leadFilters.sort_by, leadFilters.sort_dir],
  );
  const leadsList = useInfiniteList<any>(fetchLeadsPage, { enabled: activeTab === 'leads' });
  const { rows: leads, total: leadsTotal, loading: leadsLoading, refresh: fetchLeads } = leadsList;

  // Fetch Customers Register
  const fetchCustomers = useCallback(async () => {
    try {
      setCustomersLoading(true);
      const res = await api.get('/organisations', {
        page: customersPage,
        limit: 15,
        search: customerSearch || undefined,
      });

      const list = Array.isArray(res) ? res : (res?.data || []);
      setCustomers(list);
      const total = typeof res?.total === 'number' ? res.total : list.length;
      setCustomersTotal(total);
      if (!customerSearch) {
        setTotalCustomersCount(total);
      }
      setCustomersTotalPages(res?.totalPages ?? Math.max(1, Math.ceil(total / 15)));
    } catch (err) {
      console.error('Failed to load customers:', err);
      setCustomers([]);
    } finally {
      setCustomersLoading(false);
    }
  }, [customersPage, customerSearch]);

  // Fetch Follow-ups Desk
  const fetchFollowups = useCallback(async () => {
    try {
      setFollowupsLoading(true);
      const tf =
        followupTimeframe === 'today'
          ? 'due_today'
          : followupTimeframe !== 'all' && followupTimeframe !== 'completed'
          ? followupTimeframe
          : undefined;

      const res = await api.get('/follow-ups', {
        timeframe: tf,
        status: followupTimeframe === 'completed' ? 'completed' : undefined,
        limit: 50,
      });
      const list = Array.isArray(res) ? res : (res?.data || []);
      setFollowups(list);
    } catch (err) {
      console.error('Failed to load follow-ups:', err);
      setFollowups([]);
    } finally {
      setFollowupsLoading(false);
    }
  }, [followupTimeframe]);

  // Fetch Executive Reports
  const fetchReports = useCallback(async () => {
    try {
      setReportsLoading(true);
      const [spRes, znRes, prRes, inRes] = await Promise.allSettled([
        api.get('/leads/reports/salesperson'),
        api.get('/leads/reports/zones'),
        api.get('/leads/reports/products'),
        api.get('/leads/reports/interactions'),
      ]);

      // A report that fails (no access, server error) shows why instead of an empty table (QA DEF-052)
      const errors: Record<string, string> = {};
      const failure = (r: PromiseRejectedResult) =>
        r.reason?.status === 403
          ? 'You do not have access to this report.'
          : r.reason?.message || 'This report could not be loaded. Please try again.';
      if (spRes.status === 'fulfilled') {
        const val = spRes.value;
        setSalespersonReport(Array.isArray(val) ? val : (val?.data || []));
      } else {
        setSalespersonReport([]);
        errors.salesperson = failure(spRes);
      }
      if (znRes.status === 'fulfilled') {
        const val = znRes.value;
        setZoneReport(Array.isArray(val) ? val : (val?.data || []));
      } else {
        setZoneReport([]);
        errors.zones = failure(znRes);
      }
      if (prRes.status === 'fulfilled') {
        const val = prRes.value;
        setProductReport(Array.isArray(val) ? val : (val?.data || []));
      } else {
        setProductReport([]);
        errors.products = failure(prRes);
      }
      if (inRes.status === 'fulfilled') {
        // GET /leads/reports/interactions returns { byType, byEmployee }; the Field Activity cards show byType
        const val = inRes.value;
        setInteractionReport(Array.isArray(val) ? val : (val?.byType || val?.data || []));
      } else {
        setInteractionReport([]);
        errors.interactions = failure(inRes);
      }
      setReportErrors(errors);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    setCustomersPage(1);
  }, [customerSearch]);

  // Initial and reactive data fetching
  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // KPI counts re-read when the register filters change (debounced, so typing a search sends one request)
  useEffect(() => {
    const timer = setTimeout(fetchDashboardStats, 300);
    return () => clearTimeout(timer);
  }, [fetchDashboardStats]);

  useEffect(() => {
    // The leads register loads itself (useInfiniteList) whenever its tab is open.
    if (activeTab === 'customers') fetchCustomers();
    else if (activeTab === 'followups') fetchFollowups();
    else if (activeTab === 'reports') fetchReports();
  }, [activeTab, fetchCustomers, fetchFollowups, fetchReports]);

  // Debounced Duplicate Detection during Lead Creation
  useEffect(() => {
    if (!isCreateLeadOpen || leadForm.organisation_mode === 'existing') {
      setDuplicateMatches([]);
      setDuplicateSuggestion(null);
      return;
    }

    const queryOrg = leadForm.organisation_name.trim();
    const queryEmail = leadForm.contact_email.trim();
    const queryPhone = leadForm.contact_mobile.trim();

    if (queryOrg.length < 3 && queryEmail.length < 5 && queryPhone.length < 6) {
      setDuplicateMatches([]);
      setDuplicateSuggestion(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsCheckingDuplicate(true);
        const res = await api.get('/organisations/check-duplicate', {
          name: queryOrg || undefined,
          email: queryEmail || undefined,
          phone: queryPhone || undefined,
        });
        if (res?.isDuplicate && res.matches?.length > 0) {
          setDuplicateMatches(res.matches);
          setDuplicateSuggestion(res.suggestion);
        } else {
          setDuplicateMatches([]);
          setDuplicateSuggestion(null);
        }
      } catch (err) {
        // Silently handle
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [leadForm.organisation_name, leadForm.contact_email, leadForm.contact_mobile, isCreateLeadOpen, leadForm.organisation_mode]);

  // Automatically clear create lead errors and transient states whenever the modal is closed
  useEffect(() => {
    if (!isCreateLeadOpen) {
      setCreateLeadError(null);
      setFormError(null);
      setIsCheckingDuplicate(false);
    }
  }, [isCreateLeadOpen]);

  // Success / error banners belong to the lead they were raised on — drop them when another lead is opened (QA DEF-098)
  const selectedLeadId = selectedLead?.id;
  useEffect(() => {
    setActionSuccess(null);
    setFormError(null);
  }, [selectedLeadId]);

  const handleCloseLeadDetail = () => {
    setIsLeadDetailOpen(false);
    setActionSuccess(null);
    setFormError(null);
  };

  // Open Lead Details Modal
  const handleOpenLead = async (leadId: string) => {
    try {
      setActionSuccess(null);
      const fullLead = await api.get(`/leads/${leadId}`);
      setSelectedLead(fullLead);
      setLeadDetailTab('overview'); setShowLeadFullDetails(false); setShowLeadStageActions(false); setIsLeadDetailOpen(true);
    } catch (err: any) {
      console.error('Failed to inspect lead:', err);
    }
  };

  // Open Customer 360 Account Drawer
  const handleOpenCustomer360 = async (orgId: string) => {
    try {
      setCustomerTimelineLoading(true);
      setIsCustomer360Open(true);
      setC360Tab('management');
      const [orgRes, timelineRes, contactsRes, leadsRes] = await Promise.allSettled([
        api.get(`/organisations/${orgId}`),
        api.get(`/organisations/${orgId}/timeline`),
        api.get(`/contacts?organisation_id=${orgId}`),
        api.get(`/leads?organisation_id=${orgId}&limit=50`),
      ]);

      if (orgRes.status === 'fulfilled') setSelectedCustomer(orgRes.value);
      if (timelineRes.status === 'fulfilled') {
        const val = timelineRes.value;
        setCustomerTimeline(val.timeline || val.interactions || []);
        setCustomerManagementSummary(val.management_summary || null);
        if (val.organisation && (!orgRes || orgRes.status !== 'fulfilled')) {
          setSelectedCustomer(val.organisation);
        }
      }
      if (contactsRes.status === 'fulfilled') setCustomerContacts(contactsRes.value || []);
      if (leadsRes.status === 'fulfilled') setCustomerLeads(leadsRes.value.data || []);
    } catch (err) {
      console.error('Failed to load customer 360:', err);
    } finally {
      setCustomerTimelineLoading(false);
    }
  };

  // Deep links from the command palette, notifications and tasks: ?open=<lead id>, ?customer=<organisation id>
  useOpenParam(handleOpenLead);
  useOpenParam(handleOpenCustomer360, true, 'customer');

  // Handle Create Lead Submission (Atomic Sync of all 18 Parameters)
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createLeadInFlight.current) return;
    setFormError(null);
    setCreateLeadError(null);

    setLeadSubmitAttempted(true);
    const errors = validateLeadForm(leadForm);
    setLeadErrors(errors);
    if (Object.keys(errors).length > 0) {
      setCreateLeadError('Please correct the highlighted fields before registering the lead.');
      return;
    }

    createLeadInFlight.current = true;
    setActionLoading(true);
    try {
      await api.post('/leads', {
        organisation_id: leadForm.organisation_mode === 'existing' ? leadForm.organisation_id : undefined,
        organisation_name: leadForm.organisation_mode === 'new' ? leadForm.organisation_name.trim() : undefined,
        contact_name: leadForm.contact_name.trim() || undefined,
        contact_designation: leadForm.contact_designation.trim() || undefined,
        contact_mobile: leadForm.contact_mobile.trim() || undefined,
        contact_email: leadForm.contact_email.trim() || undefined,
        city: leadForm.city.trim() || undefined,
        state: canonicalState(leadForm.state) || leadForm.state.trim() || undefined,
        zone_id: leadForm.zone_id || undefined,
        region_id: leadForm.region_id || undefined,
        sector: leadForm.sector || undefined,
        department: leadForm.department.trim() || undefined,
        product_id: leadForm.product_ids[0] || undefined,
        product_ids: leadForm.product_ids.length > 0 ? leadForm.product_ids : undefined,
        source: leadForm.source || 'field_visit',
        category: leadForm.category || 'new_lead',
        assigned_to: leadForm.assigned_to || user?.id,
        regional_manager_id: leadForm.regional_manager_id || undefined,
        remarks: leadForm.remarks.trim() || undefined,
        lead_status: leadForm.lead_status || 'new',
        status: leadForm.lead_status || 'new',
        last_interaction_date: leadForm.last_interaction_date || istToday(),
        last_interaction_type: leadForm.last_interaction_type || 'call',
        next_followup_date: leadForm.next_followup_date ? leadForm.next_followup_date : undefined,
        value_lakh: leadForm.value_lakh ? Number(leadForm.value_lakh) : undefined,
        estimated_value_lakh: leadForm.value_lakh ? Number(leadForm.value_lakh) : undefined,
      });

      setIsCreateLeadOpen(false);
      resetLeadForm();
      fetchLeads();
      fetchDashboardStats();
      fetchCustomers();
      if (activeTab === 'followups') fetchFollowups();
    } catch (err: any) {
      const msg = err.message || 'Failed to register lead.';
      setCreateLeadError(msg);
      setFormError(msg);
    } finally {
      createLeadInFlight.current = false;
      setActionLoading(false);
    }
  };

  const resetLeadForm = () => {
    setFormError(null);
    setCreateLeadError(null);
    setActionLoading(false);
    setIsCheckingDuplicate(false);
    setLeadErrors({});
    setLeadSubmitAttempted(false);
    setLeadCheckedSteps([]);
    setLeadForm({
      organisation_mode: 'new',
      organisation_id: '',
      organisation_name: '',
      department: '',
      city: '',
      state: '',
      zone_id: '',
      region_id: '',
      sector: '',
      contact_name: '',
      contact_designation: '',
      contact_mobile: '',
      contact_email: '',
      product_ids: [],
      source: 'field_visit',
      category: 'new_lead',
      // Sales / RMs own what they register; management and admin pick the owner from the sales team
      assigned_to: user && (user.role === 'sales' || user.role === 'regional_manager') ? user.id : '',
      regional_manager_id: user && (user.role === 'sales' || user.role === 'regional_manager') ? defaultRmFor(user.id) : '',
      remarks: '',
      lead_status: 'new',
      last_interaction_date: istToday(),
      last_interaction_type: 'call',
      next_followup_date: '',
      value_lakh: '',
    });
    setDuplicateMatches([]);
    setDuplicateSuggestion(null);
  };

  const handleOpenCreateLead = () => {
    resetLeadForm();
    setFormError(null);
    setCreateLeadError(null);
    setIsCreateLeadOpen(true);
  };
  // Dashboard "New opportunity" quick action links to /leads?new=1 (QA DEF-108).
  useOpenParam(() => handleOpenCreateLead(), true, 'new');

  const handleCloseCreateLead = () => {
    setIsCreateLeadOpen(false);
    resetLeadForm();
    setFormError(null);
    setCreateLeadError(null);
  };

  // Status Change Submission
  const handleStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setFormError(null);

    if (isWinStatus(targetStatus)) {
      const errors: Record<string, string> = {};
      if (!winPoReference.trim()) errors.po_reference = 'Enter the purchase / supply order reference';
      if (winOrderValue !== '' && !(Number(winOrderValue) > 0)) errors.order_value = 'Order value must be greater than zero';
      if (winOrderDate && winOrderDate > istToday()) errors.order_date = 'Order date cannot be in the future';
      setStatusFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;
    }
    setActionLoading(true);

    try {
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: targetStatus,
        loss_reason: targetStatus === 'lost' ? lossReason : undefined,
        loss_remarks: targetStatus === 'lost' ? lossRemarks : undefined,
        po_reference: isWinStatus(targetStatus) ? winPoReference.trim() : undefined,
        order_value_lakh: isWinStatus(targetStatus) && winOrderValue !== '' ? Number(winOrderValue) : undefined,
        order_date: isWinStatus(targetStatus) && winOrderDate ? winOrderDate : undefined,
      });

      setIsStatusModalOpen(false);
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setActionSuccess(
        isWinStatus(targetStatus)
          ? `Lead marked ${targetStatus.toUpperCase()} on order ${winPoReference.trim()}.`
          : targetStatus === 'lost'
          ? 'Lead marked LOST. Its pending follow-ups were cancelled.'
          : `Lifecycle stage advanced to ${targetStatus.toUpperCase()} successfully!`,
      );
      fetchLeads();
      fetchDashboardStats();
      if (activeTab === 'followups') fetchFollowups();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update lead status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Reassign Salesperson Submission
  const handleReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    if (!canReassign) {
      setFormError('Access restricted: Only Regional Managers, Management, or Admins can transfer lead ownership.');
      return;
    }
    setFormError(null);
    setActionLoading(true);

    try {
      await api.patch(`/leads/${selectedLead.id}/assign`, {
        assigned_to: newSalespersonId,
        reason: reassignReason || undefined,
      });

      setIsReassignModalOpen(false);
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to reassign salesperson.');
    } finally {
      setActionLoading(false);
    }
  };

  // Add Product Interest to Selected Lead
  const handleAddProductInterest = async (productId: string) => {
    if (!selectedLead) return;
    setFormError(null);
    try {
      await api.post(`/leads/${selectedLead.id}/products`, { product_id: productId });
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to attach product.');
    }
  };

  // Remove Product Interest from Selected Lead
  const handleRemoveProductInterest = async (productId: string) => {
    if (!selectedLead) return;
    setFormError(null);
    try {
      await api.delete(`/leads/${selectedLead.id}/products/${productId}`);
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to remove product.');
    }
  };

  // Open Demo Modal with prepopulated values
  const handleOpenDemoModal = () => {
    if (!selectedLead) return;
    const defaultProdId = selectedLead.product_id || selectedLead.product_interests?.[0]?.product_id || (productsList[0]?.id || '');
    const defaultDemoUser = usersList.find((u) => u.role === 'demo_team')?.id || selectedLead.assigned_to || user?.id || '';
    const loc = `${selectedLead.city || ''}${selectedLead.city && selectedLead.state ? ', ' : ''}${selectedLead.state || ''}`.trim() || selectedLead.organisation_name || 'Client Site / Field';
    const prodName = selectedLead.product_name || selectedLead.product_interests?.[0]?.product_name || 'Equipment';

    setDemoForm({
      requested_date: addIsoDays(istToday(), 1),
      requested_time: '11:00',
      product_id: defaultProdId,
      assigned_to: defaultDemoUser,
      location: loc,
      purpose: `Live demonstration & specification validation for ${selectedLead.organisation_name}`,
      expected_audience: 'Procurement Committee & Commanding Officers',
      equipment_required: `${prodName} Demo Unit, test accessories, and calibration certificate`,
      custom_accessories: '',
      auto_remind: true,
      reminder_notes: 'Verify kit packing and transport permits before field deployment.',
    });
    setFormError(null);
    setIsDemoModalOpen(true);
  };

  // Open Proposal Modal with prepopulated values
  const handleOpenProposalModal = () => {
    if (!selectedLead) return;
    const defaultTenderUser = usersList.find((u) => u.role === 'tender_team')?.id || selectedLead.assigned_to || user?.id || '';
    const cleanOrg = (selectedLead.organisation_name || 'LEAD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    const ref = `PROP-${cleanOrg}-${istToday().slice(0, 4)}-${Date.now().toString().slice(-4)}`;

    setProposalForm({
      required_date: addIsoDays(istToday(), 7),
      responsible_person_id: defaultTenderUser,
      deal_value: selectedLead.estimated_value_lakh || selectedLead.value_lakh || '',
      reference: ref,
      remarks: `Commercial proposal & technical bid preparation for ${selectedLead.organisation_name}. Include delivery SLA and 3-year warranty terms.`,
      auto_remind: true,
    });
    setFormError(null);
    setIsProposalModalOpen(true);
  };

  // Open Discussion Modal with prepopulated values ("when")
  const handleOpenDiscussionModal = (stage: 'tender_discussion' | 'follow_up') => {
    if (!selectedLead) return;
    setDiscussionStage(stage);
    const defaultUser = selectedLead.assigned_to || usersList.find((u) => u.role === (stage === 'tender_discussion' ? 'tender_team' : 'sales'))?.id || user?.id || '';
    const venue = selectedLead.city ? `${selectedLead.organisation_name}, ${selectedLead.city}` : 'Client HQ / Virtual Conference';

    setDiscussionForm({
      discussion_date: addIsoDays(istToday(), 1),
      discussion_time: '14:30',
      mode: stage === 'tender_discussion' ? 'tender_committee' : 'in_person',
      venue: venue,
      assigned_to: defaultUser,
      agenda: stage === 'tender_discussion'
        ? 'Clause-by-clause tender terms review, RFP alignment, commercial pricing schedule, and earnest money deposit.'
        : 'Comprehensive follow-up on technical evaluation, buyer timeline, and next procurement stage.',
      auto_remind: true,
    });
    setFormError(null);
    setIsDiscussionModalOpen(true);
  };

  // Lifecycle Stage Advance Router
  const handleDirectAdvanceStatus = async (nextSt: string) => {
    if (!selectedLead) return;
    setActionSuccess(null);
    if (nextSt === 'lost') {
      setTargetStatus('lost');
      setFormError(null);
      setStatusFieldErrors({});
      setIsStatusModalOpen(true);
      return;
    }
    // Marking a lead won is confirmed with its purchase / supply order details (QA DEF-054)
    if (isWinStatus(nextSt)) {
      setTargetStatus(nextSt);
      setWinPoReference('');
      setWinOrderValue(selectedLead.value_lakh || selectedLead.estimated_value_lakh ? String(selectedLead.value_lakh || selectedLead.estimated_value_lakh) : '');
      setWinOrderDate(istToday());
      setFormError(null);
      setStatusFieldErrors({});
      setIsStatusModalOpen(true);
      return;
    }
    if (nextSt === 'demo') {
      handleOpenDemoModal();
      return;
    }
    if (nextSt === 'proposal') {
      handleOpenProposalModal();
      return;
    }
    if (nextSt === 'tender_discussion' || nextSt === 'follow_up') {
      handleOpenDiscussionModal(nextSt as any);
      return;
    }

    setActionLoading(true);
    setFormError(null);
    try {
      await api.patch(`/leads/${selectedLead.id}/status`, { status: nextSt });
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setActionSuccess(`Lifecycle stage advanced to ${nextSt.toUpperCase()} successfully!`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || `Failed to advance status to ${nextSt}.`);
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Demo Transition
  const handleSubmitDemoTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setActionLoading(true);
    setFormError(null);

    try {
      // 1. Create official Demo record
      await api.post('/demos', {
        organisation_id: selectedLead.organisation_id,
        lead_id: selectedLead.id,
        product_id: demoForm.product_id || undefined,
        requested_date: demoForm.requested_date,
        location: demoForm.location,
        purpose: demoForm.purpose,
        expected_audience: demoForm.expected_audience,
        equipment_required: demoForm.equipment_required,
        assigned_to: demoForm.assigned_to || undefined,
        remarks: demoForm.reminder_notes,
      });

      // 2. Advance Lead Lifecycle to DEMO
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: 'demo',
        remarks: `Demonstration scheduled for ${demoForm.requested_date} at ${demoForm.requested_time} (${demoForm.location}). Assigned specialist: ${usersList.find((u) => u.id === demoForm.assigned_to)?.full_name || 'Demo Team'}.`,
      });

      // 3. Auto-remind: Create high-priority task for assigned member
      if (demoForm.auto_remind && demoForm.assigned_to) {
        const prodName = productsList.find((p) => p.id === demoForm.product_id)?.name || selectedLead.product_name || 'Equipment';

        await api.post('/tasks', {
          title: `Conduct Demo: ${prodName} (${selectedLead.organisation_name})`,
          description: `Demo scheduled on ${demoForm.requested_date} at ${demoForm.requested_time}.\nLocation: ${demoForm.location}\nAudience: ${demoForm.expected_audience}\nEquipment: ${demoForm.equipment_required}\nNotes: ${demoForm.reminder_notes}`,
          assigned_to: demoForm.assigned_to,
          department: 'Demo Team',
          priority: 'urgent',
          task_type: 'one_time',
          deadline: demoForm.requested_date,
          start_date: istToday(),
          related_entity_type: 'lead',
          related_entity_id: selectedLead.id,
          expected_outcome: 'Field trial executed and signed demo trial certificate obtained',
        });

        await api.post('/notifications', {
          userId: demoForm.assigned_to,
          type: 'demo_assigned',
          title: `🎯 Demo Assigned: ${selectedLead.organisation_name}`,
          body: `You are assigned for product demonstration on ${demoForm.requested_date} at ${demoForm.requested_time} (${demoForm.location}).`,
          entityType: 'lead',
          entityId: selectedLead.id,
        });
      }

      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setIsDemoModalOpen(false);
      setActionSuccess(`Demo scheduled successfully! Demo Team coordinators and assigned specialist have been notified.`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to schedule demo and update status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Proposal Transition
  const handleSubmitProposalTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setActionLoading(true);
    setFormError(null);

    try {
      // 1. Create Proposal record
      await api.post('/proposals', {
        customer_id: selectedLead.organisation_id,
        organisation_id: selectedLead.organisation_id,
        lead_id: selectedLead.id,
        product_id: selectedLead.product_id || (selectedLead.product_interests?.[0]?.product_id) || undefined,
        required_date: proposalForm.required_date,
        reference: proposalForm.reference,
        responsible_person_id: proposalForm.responsible_person_id || undefined,
        remarks: proposalForm.remarks,
      });

      // 2. Advance Lead Lifecycle to PROPOSAL
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: 'proposal',
        remarks: `Proposal initiated (Ref: ${proposalForm.reference}). Submission deadline: ${proposalForm.required_date}. Lead specialist: ${usersList.find((u) => u.id === proposalForm.responsible_person_id)?.full_name || 'Tender Team'}.`,
      });

      // 3. Auto-remind: Create high-priority task for assigned proposal specialist
      if (proposalForm.auto_remind && proposalForm.responsible_person_id) {
        await api.post('/tasks', {
          title: `Draft Proposal: ${proposalForm.reference} (${selectedLead.organisation_name})`,
          description: `Formulate technical bid and commercial quotation.\nSubmission Deadline: ${proposalForm.required_date}\nScope: ${proposalForm.remarks}`,
          assigned_to: proposalForm.responsible_person_id,
          department: 'Tender Team',
          priority: 'high',
          task_type: 'one_time',
          deadline: proposalForm.required_date,
          start_date: istToday(),
          related_entity_type: 'lead',
          related_entity_id: selectedLead.id,
          expected_outcome: 'Proposal formulated and ready for managerial pricing review',
        });

        await api.post('/notifications', {
          userId: proposalForm.responsible_person_id,
          type: 'proposal_assigned',
          title: `📄 Proposal Assigned: ${proposalForm.reference}`,
          body: `You are responsible for proposal drafting for ${selectedLead.organisation_name} due by ${proposalForm.required_date}.`,
          entityType: 'lead',
          entityId: selectedLead.id,
        });
      }

      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setIsProposalModalOpen(false);
      setActionSuccess(`Proposal registered and delegated! Tender Team and assigned specialist notified.`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create proposal and update status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Discussion Transition ("when")
  const handleSubmitDiscussionTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setActionLoading(true);
    setFormError(null);

    const stageLabel = discussionStage === 'tender_discussion' ? 'TENDER DISCUSSION' : 'FOLLOW UP';
    const assignedMember = usersList.find((u) => u.id === discussionForm.assigned_to);

    try {
      // 1. Advance Lead Lifecycle
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: discussionStage,
        remarks: `${stageLabel} scheduled for ${discussionForm.discussion_date} at ${discussionForm.discussion_time} (${discussionForm.mode}). Venue: ${discussionForm.venue}. Assigned: ${assignedMember?.full_name || 'Team'}.`,
      });

      // 2. Log Interaction / Touchpoint
      await api.post('/interactions', {
        lead_id: selectedLead.id,
        organisation_id: selectedLead.organisation_id,
        contact_id: selectedLead.primary_contact_id || undefined,
        type: discussionStage,
        occurred_on: discussionForm.discussion_date,
        remarks: `[${stageLabel}] Scheduled at ${discussionForm.discussion_time} (${discussionForm.mode}). Venue: ${discussionForm.venue}. Agenda: ${discussionForm.agenda}`,
        outcome: `${stageLabel} Touchpoint Scheduled`,
        next_followup_date: discussionForm.discussion_date,
      });

      // 3. Auto-remind: Create calendar task for assigned member
      if (discussionForm.auto_remind && discussionForm.assigned_to) {
        await api.post('/tasks', {
          title: `${stageLabel}: ${selectedLead.organisation_name} (${discussionForm.mode.toUpperCase()})`,
          description: `When: ${discussionForm.discussion_date} at ${discussionForm.discussion_time}\nVenue / Link: ${discussionForm.venue}\nAgenda: ${discussionForm.agenda}`,
          assigned_to: discussionForm.assigned_to,
          department: discussionStage === 'tender_discussion' ? 'Tender Team' : 'Sales',
          priority: 'urgent',
          task_type: 'meeting',
          deadline: discussionForm.discussion_date,
          start_date: istToday(),
          related_entity_type: 'lead',
          related_entity_id: selectedLead.id,
          expected_outcome: 'Discussion minutes documented and buyer commitments captured',
        });

        await api.post('/notifications', {
          userId: discussionForm.assigned_to,
          type: 'meeting_scheduled',
          title: `🤝 Discussion Scheduled: ${selectedLead.organisation_name}`,
          body: `You are scheduled for a discussion on ${discussionForm.discussion_date} at ${discussionForm.discussion_time} (${discussionForm.venue}).`,
          entityType: 'lead',
          entityId: selectedLead.id,
        });
      }

      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setIsDiscussionModalOpen(false);
      setActionSuccess(`${stageLabel} scheduled on ${discussionForm.discussion_date}! Auto-reminder and task dispatched to ${assignedMember?.full_name || 'assigned member'}.`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to schedule discussion.');
    } finally {
      setActionLoading(false);
    }
  };

  // Log Interaction Submission
  const handleLogInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (attachmentUploading) {
      setFormError('Please wait for the document upload to finish.');
      return;
    }
    setActionLoading(true);

    try {
      await api.post('/interactions', {
        lead_id: interactionForm.lead_id || undefined,
        organisation_id: interactionForm.organisation_id,
        contact_id: interactionForm.contact_id || undefined,
        type: interactionForm.type,
        occurred_on: interactionForm.date,
        interaction_date: interactionForm.date,
        remarks: interactionForm.notes,
        notes: interactionForm.notes,
        outcome: interactionForm.outcome || undefined,
        next_action: interactionForm.next_action || undefined,
        followup_date: interactionForm.next_followup_date || undefined,
        next_followup_date: interactionForm.next_followup_date || undefined,
        attachments: interactionForm.attachments.length > 0 ? interactionForm.attachments : undefined,
      });

      setIsLogInteractionOpen(false);
      setInteractionForm({
        lead_id: '',
        organisation_id: '',
        contact_id: '',
        type: 'call',
        date: istToday(),
        notes: '',
        outcome: '',
        next_action: '',
        next_followup_date: '',
        attachments: [],
      });

      if (selectedLead) {
        const updated = await api.get(`/leads/${selectedLead.id}`);
        setSelectedLead(updated);
      }
      if (selectedCustomer) {
        handleOpenCustomer360(selectedCustomer.id);
      }
      fetchLeads();
      fetchFollowups();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to log interaction.');
    } finally {
      setActionLoading(false);
    }
  };

  // Follow-up Completion Submission
  const handleCompleteFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFollowup) return;
    setFormError(null);

    // Outcome is mandatory; the next follow-up (when booked) is today or later — checked here, enforced by the API
    const outcomeError = completionOutcome.trim() ? null : 'Enter the touchpoint outcome to complete this follow-up';
    const nextDateError =
      scheduleNextFollowup && !nextFollowupDueDate
        ? 'Choose the next follow-up date'
        : scheduleNextFollowup && nextFollowupDueDate < istToday()
        ? 'Next follow-up cannot be in the past'
        : null;
    setCompletionOutcomeError(outcomeError);
    setNextFollowupDateError(nextDateError);
    if (outcomeError || nextDateError) return;
    setActionLoading(true);

    try {
      await api.patch(`/follow-ups/${selectedFollowup.id}/complete`, {
        outcome: completionOutcome.trim(),
        remarks: completionRemarks || undefined,
        next_followup_date: scheduleNextFollowup && nextFollowupDueDate ? nextFollowupDueDate : undefined,
        next_followup_time: scheduleNextFollowup && nextFollowupDueDate && nextFollowupDueTime ? nextFollowupDueTime : undefined,
      });

      setIsCompleteFollowupOpen(false);
      setSelectedFollowup(null);
      setCompletionOutcome('');
      setCompletionRemarks('');
      setScheduleNextFollowup(false);
      setNextFollowupDueDate('');
      setNextFollowupDueTime('');
      fetchFollowups();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to complete follow-up.');
    } finally {
      setActionLoading(false);
    }
  };

  // Follow-up Reschedule Submission
  const handleRescheduleFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFollowup) return;
    setFormError(null);

    const dateError = !rescheduleDate
      ? 'Choose the new due date'
      : rescheduleDate < istToday()
      ? 'A follow-up cannot be rescheduled to a past date'
      : null;
    setRescheduleDateError(dateError);
    if (dateError) return;
    setActionLoading(true);

    try {
      await api.patch(`/follow-ups/${selectedFollowup.id}/reschedule`, {
        new_due_date: rescheduleDate,
        new_due_time: rescheduleTime || undefined,
        reason: rescheduleRemarks || undefined,
      });

      setIsRescheduleFollowupOpen(false);
      setSelectedFollowup(null);
      setRescheduleDate('');
      setRescheduleTime('');
      setRescheduleRemarks('');
      fetchFollowups();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to reschedule follow-up.');
    } finally {
      setActionLoading(false);
    }
  };

  // Status badge styling helper
  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'new':
        return <Badge variant="info" size="sm">NEW</Badge>;
      case 'contacted':
        return <Badge variant="outline" size="sm">CONTACTED</Badge>;
      case 'qualified':
        return <Badge variant="success" size="sm">QUALIFIED</Badge>;
      case 'follow_up':
        return <Badge variant="warning" size="sm">FOLLOW-UP</Badge>;
      case 'demo':
        return <Badge variant="cyber" size="sm">DEMO SCHEDULED</Badge>;
      case 'proposal':
        return <Badge variant="info" size="sm">PROPOSAL</Badge>;
      case 'tender_discussion':
        return <Badge variant="outline" size="sm">TENDER DISCUSSION</Badge>;
      case 'negotiation':
        return <Badge variant="warning" size="sm">NEGOTIATION</Badge>;
      case 'converted':
        return <Badge variant="success" size="sm">CONVERTED (WON)</Badge>;
      case 'lost':
        return <Badge variant="danger" size="sm">LOST</Badge>;
      case 'on_hold':
        return <Badge variant="default" size="sm">ON HOLD</Badge>;
      default:
        return <Badge variant="default" size="sm">{status?.toUpperCase()}</Badge>;
    }
  };

  // Computed HUD counts with fallback to loaded dataset
  const activePipelineCount =
    leadStats?.active_leads ??
    leadStats?.activeLeads ??
    leadStats?.metrics?.activeLeads ??
    (leads.length > 0
      ? leads.filter((l) => !isClosedLeadStatus(l.lead_status || l.status)).length
      : 0);

  const totalLeadsCount =
    leadStats?.total_leads ??
    leadStats?.totalLeads ??
    leadStats?.metrics?.totalLeads ??
    leadsTotal ??
    leads.length;

  const freshLeadsCount =
    leadStats?.fresh_leads ??
    leadStats?.freshLeads ??
    leadStats?.metrics?.freshLeads ??
    (leads.length > 0 ? leads.filter((l) => (l.lead_type || 'fresh') === 'fresh').length : 0);

  const reapproachedLeadsCount =
    leadStats?.reapproached_leads ??
    leadStats?.re_approached_leads ??
    leadStats?.reApproachedLeads ??
    leadStats?.metrics?.reApproachedLeads ??
    (leads.length > 0 ? leads.filter((l) => l.lead_type === 're_approached').length : 0);

  const convertedDealsCount =
    leadStats?.converted_leads ??
    leadStats?.convertedLeads ??
    leadStats?.metrics?.convertedLeads ??
    leadStats?.metrics?.byStatus?.converted ??
    (leads.length > 0 ? leads.filter((l) => ['converted', 'won'].includes(String(l.lead_status || l.status).toLowerCase())).length : 0);

  const lostLeadsCount =
    leadStats?.lost_leads ??
    leadStats?.lostLeads ??
    leadStats?.metrics?.lostLeads ??
    leadStats?.metrics?.byStatus?.lost ??
    (leads.length > 0 ? leads.filter((l) => ['lost', 'dropped'].includes(String(l.lead_status || l.status).toLowerCase())).length : 0);

  // Open leads with a pending follow-up due today / overdue — the same definition as the register's follow-up filter.
  // (The Follow-ups tab counts the follow-up records themselves, from followupStats.)
  const followupsDueTodayCount = leadStats?.followups_due_today ?? leadStats?.followUps?.dueToday ?? 0;

  const followupsOverdueCount = leadStats?.followups_overdue ?? leadStats?.followUps?.overdue ?? 0;

  // Lead register: filter row + KPI click-to-filter helpers
  const LEAD_STAGE_FILTERS: { key: string; label: string }[] = [
    { key: 'new', label: 'New' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'qualified', label: 'Qualified' },
    { key: 'follow_up', label: 'Follow-up stage' },
    { key: 'demo', label: 'Demo scheduled' },
    { key: 'proposal', label: 'Proposal sent' },
    { key: 'tender_discussion', label: 'Tender discussion' },
    { key: 'negotiation', label: 'Negotiation' },
    { key: 'converted', label: 'Converted (won)' },
    { key: 'lost', label: 'Lost' },
    { key: 'on_hold', label: 'On hold' },
  ];
  const LEAD_SOURCE_FILTERS: { key: string; label: string }[] = [
    { key: 'field_visit', label: 'Field visit' },
    { key: 'referral', label: 'Referral' },
    { key: 'tender', label: 'Tender' },
    { key: 'exhibition', label: 'Exhibition' },
    { key: 'website', label: 'Website' },
    { key: 'cold_outreach', label: 'Cold outreach' },
    { key: 'gem_portal', label: 'GeM portal' },
    { key: 'partner', label: 'OEM / partner' },
    { key: 'gem_direct', label: 'GeM / Direct (older leads)' },
  ];
  const LEAD_SORT_FIELDS: { key: string; label: string }[] = [
    { key: 'created_at', label: 'Created date' },
    { key: 'next_followup', label: 'Next follow-up' },
    { key: 'last_interaction', label: 'Last interaction' },
    { key: 'organisation', label: 'Organisation' },
  ];
  const leadStageCounts: Record<string, number> = leadStats?.byStatus || leadStats?.metrics?.byStatus || {};
  const updateLeadFilter = (patch: Partial<typeof leadFilters>) => setLeadFilters((prev) => ({ ...prev, ...patch }));
  const hasActiveLeadFilters = Boolean(
    leadFilters.search ||
      leadFilters.lead_status ||
      leadFilters.lead_type ||
      leadFilters.sector ||
      leadFilters.lead_source ||
      leadFilters.followup ||
      leadFilters.created_from ||
      leadFilters.created_to,
  );
  const clearLeadFilters = () =>
    setLeadFilters((prev) => ({
      ...prev,
      search: '',
      lead_status: '',
      lead_type: '',
      sector: '',
      lead_source: '',
      followup: '',
      created_from: '',
      created_to: '',
    }));
  const leadDatesActive = Boolean(leadFilters.created_from || leadFilters.created_to);
  const moreLeadFiltersActive = [leadFilters.lead_type, leadFilters.lead_source, leadFilters.sector].filter(Boolean).length;

  // Lead register as priority cards / stage board (RecordViews).
  const LEAD_LANE_ALIAS: Record<string, string> = { won: 'converted', dropped: 'lost', open: 'new', quoted: 'proposal' };
  const leadLaneKey = (status: string | null | undefined) => {
    const s = String(status || 'new').toLowerCase();
    return LEAD_LANE_ALIAS[s] || s;
  };
  const leadLanes: BoardLane[] = LEAD_STATUS_OPTIONS.map((o) => {
    const key = o.value === 'dropped' ? 'lost' : o.value;
    return { key, label: o.label, tone: toneFor(o.label) };
  });
  const leadStatusLabel = (key: string) => leadLanes.find((l) => l.key === key)?.label || key.replace(/_/g, ' ');
  const openLogTouch = (lead: any) => {
    setInteractionForm({
      ...interactionForm,
      lead_id: lead.id,
      organisation_id: lead.organisation_id,
      contact_id: lead.primary_contact_id || '',
    });
    setIsLogInteractionOpen(true);
  };
  const leadLaneById = new Map<string, string>();
  const leadRecordItems: RecordItem[] = leads.map((lead) => {
    const lane = leadLaneKey(lead.lead_status || lead.status);
    leadLaneById.set(lead.id, lane);
    const closed = lane === 'converted' || lane === 'lost';
    const products: string[] =
      lead.product_interests && lead.product_interests.length > 0
        ? lead.product_interests.map((p: any) => p.name || p.product_name).filter(Boolean)
        : lead.product_name
        ? [lead.product_name]
        : [];
    const productText = products.length > 2 ? `${products.slice(0, 2).join(', ')} +${products.length - 2}` : products.join(', ');
    const phone = lead.contact_mobile || lead.contact_phone;
    const lastTouch = lead.last_contact_date || lead.last_interaction_at;
    const category = LEAD_CATEGORY_OPTIONS.find((c) => c.value === lead.category)?.label;
    const facts: { label: string; value: React.ReactNode }[] = [
      {
        label: 'Contact',
        value: lead.contact_name
          ? `${lead.contact_name}${lead.contact_designation ? ` · ${lead.contact_designation}` : ''}`
          : 'Unspecified',
      },
      { label: 'Last touch', value: lastTouch ? formatDateIN(lastTouch) : 'None logged' },
      { label: 'Source', value: lead.source || 'Direct' },
      { label: category ? 'Category' : 'Sector', value: category || lead.sector || 'Defence / Security' },
    ];
    return {
      key: lead.id,
      code: lead.lead_type === 're_approached' ? 'Re-approached' : 'Fresh',
      title: lead.organisation_name || lead.product_name || 'Procurement Opportunity',
      subtitle: [productText, lead.city].filter(Boolean).join(' · ') || undefined,
      status: { label: leadStatusLabel(lane), tone: toneFor(leadStatusLabel(lane)) },
      due: { date: lead.next_followup_at || lead.next_followup_date, label: 'Follow-up', done: closed },
      value: formatLakh(lead.value_lakh || lead.estimated_value_lakh || 0),
      owner: lead.assignee_name || lead.assigned_salesperson_name || 'Unassigned',
      facts,
      primary: { label: 'Log touch', icon: <MessageSquare />, onClick: () => openLogTouch(lead) },
      quick: phone
        ? [{ label: `Call ${lead.contact_name || 'contact'}`, icon: <Phone />, onClick: () => { window.location.href = `tel:${phone}`; } }]
        : undefined,
      onOpen: () => handleOpenLead(lead.id),
    };
  });

  // Lead register as the page's own table (RecordViews list) — same rows, same order as leadRecordItems.
  const leadList = leads.length ? (
    <RecordTable items={leadRecordItems}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Opportunity / Title</TableHead>
            <TableHead>Organisation & Sector</TableHead>
            <TableHead>Primary Contact</TableHead>
            <TableHead>Classification</TableHead>
            <TableHead>Salesperson / RM</TableHead>
            <TableHead>Products</TableHead>
            <TableHead>Stage / Status</TableHead>
            <TableHead className="text-right">Est. Value</TableHead>
            <TableHead>Next Follow-Up</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead, i) => {
            const item = leadRecordItems[i];
            const lane = leadLaneKey(lead.lead_status || lead.status);
            const closed = lane === 'converted' || lane === 'lost';
            const products: string[] =
              lead.product_interests && lead.product_interests.length > 0
                ? lead.product_interests.map((p: any) => p.name || p.product_name).filter(Boolean)
                : lead.product_name
                ? [lead.product_name]
                : [];
            const productText = products.length > 2 ? `${products.slice(0, 2).join(', ')} +${products.length - 2}` : products.join(', ');
            const followup = lead.next_followup_at || lead.next_followup_date;
            const daysLeft = closed ? null : daysFromToday(followup);
            const overdueDays = daysLeft !== null && daysLeft < 0 ? -daysLeft : 0;
            return (
              <TableRow key={lead.id} onOpen={item.onOpen} openLabel={`Open lead ${item.title}`}>
                <TableCell className="font-bold text-[#14213D]">
                  {lead.product_name || (lead.product_interests && lead.product_interests[0]?.name) || lead.organisation_name || 'Procurement Opportunity'}
                  <div className="text-[10px] text-[#4A5568] font-normal">
                    <span className="font-mono text-[#0F5E63]">#{String(lead.id).slice(0, 8)}</span> · Source: {upperLabel(lead.source || 'Direct')}
                  </div>
                </TableCell>
                <TableCell className="text-[#14213D]">
                  <div className="font-semibold text-[#14213D]">{lead.organisation_name || '—'}</div>
                  <div className="text-[10px] text-[#4A5568]">
                    {[lead.sector || 'Defence / Security', [lead.city, lead.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {lead.contact_name ? (
                    <>
                      <div className="font-semibold text-[#14213D]">{lead.contact_name}</div>
                      <div className="text-[10px] text-[#4A5568]">
                        {lead.contact_designation || (
                          <span className="font-mono">{lead.contact_mobile || lead.contact_phone || '—'}</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-[#4A5568]">Unspecified</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={lead.lead_type === 're_approached' ? 'warning' : 'info'} size="sm" className="uppercase font-bold">
                    {lead.lead_type === 're_approached' ? 'Re-approached' : 'Fresh'}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="font-semibold text-[#14213D]">{lead.assignee_name || lead.assigned_salesperson_name || 'Unassigned'}</div>
                  {lead.regional_manager_name && <div className="text-[10px] text-[#4A5568]">RM: {lead.regional_manager_name}</div>}
                </TableCell>
                <TableCell className="text-[#14213D] max-w-[240px] truncate" title={products.join(', ') || undefined}>
                  {productText || <span className="text-[#4A5568]">None tagged</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={leadStatusBadge(lane)} size="sm" className="uppercase font-bold">
                    {upperLabel(lane)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">
                  {formatLakh(lead.value_lakh || lead.estimated_value_lakh || 0)}
                </TableCell>
                <TableCell className="font-mono text-[#4A5568] whitespace-nowrap">
                  {formatDateIN(followup)}
                  {overdueDays > 0 && (
                    <div className="text-[10px] font-bold text-[#881337]">
                      {overdueDays} {overdueDays === 1 ? 'DAY' : 'DAYS'} OVERDUE
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5">
                    {item.primary && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={item.primary.onClick}
                        disabled={item.primary.disabled}
                        className="text-xs text-[#0F5E63] hover:bg-[#E3EFEE]"
                      >
                        {item.primary.label}
                      </Button>
                    )}
                    <ChevronRight className="h-4 w-4 text-[#6B7280]" aria-hidden />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const followupsDueTodayTab = followupStats?.dueToday ?? followupStats?.due_today;
  // View menu (first control of the filter row) — one option per workspace register.
  const workspaceViewOptions = [
    { key: 'leads', label: 'Lead pipeline', icon: <Target />, count: leadsTotal },
    {
      key: 'customers',
      label: 'Customers (360°)',
      icon: <Building />,
      count: (activeTab === 'customers' && customerSearch) ? customersTotal : (totalCustomersCount || customersTotal),
    },
    { key: 'followups', label: 'Follow-ups', icon: <Clock />, count: followupsDueTodayTab ? `${followupsDueTodayTab} today` : undefined, urgent: true },
    { key: 'reports', label: 'Intelligence', icon: <TrendingUp /> },
  ].map((v) => ({ ...v, active: activeTab === v.key, onSelect: () => setActiveTab(v.key) }));
  const REPORT_SECTIONS = [
    { key: 'salesperson', label: 'Sales performance', icon: <Users /> },
    { key: 'zones', label: 'Zone breakdown', icon: <Compass /> },
    { key: 'products', label: 'Product demand', icon: <Briefcase /> },
    { key: 'interactions', label: 'Field activity', icon: <MessageSquare /> },
  ];
  const FOLLOWUP_TIMEFRAMES = [
    { key: 'all', label: 'All follow-ups', count: undefined },
    { key: 'today', label: 'Due today', count: followupStats?.dueToday ?? followupStats?.due_today ?? 0 },
    { key: 'overdue', label: 'Overdue', count: followupStats?.overdue ?? 0, urgent: true },
    { key: 'upcoming', label: 'Upcoming', count: followupStats?.upcoming ?? 0 },
    { key: 'completed', label: 'Completed', count: followupStats?.completed ?? 0 },
  ];
  const leadHeadlineCards: {
    key: string;
    label: string;
    value: number;
    subtext: string;
    icon: React.ReactNode;
    variant: 'primary' | 'emerald' | 'amber' | 'rose';
    active: boolean;
    onClick: () => void;
  }[] = [
    {
      key: 'pipeline',
      label: 'Active Pipeline',
      value: activePipelineCount,
      subtext: `Total Leads: ${totalLeadsCount}`,
      variant: 'primary',
      icon: <Compass className="h-4 w-4 text-[#0F5E63]" />,
      active: leadFilters.lead_status === 'active',
      onClick: () => {
        setActiveTab('leads');
        updateLeadFilter({ lead_status: leadFilters.lead_status === 'active' ? '' : 'active' });
      },
    },
    {
      key: 'fresh',
      label: 'Fresh Prospects',
      value: freshLeadsCount,
      subtext: 'First-time Accounts',
      variant: 'emerald',
      icon: <Sparkles className="h-4 w-4 text-[#0F5E63]" />,
      active: leadFilters.lead_type === 'fresh',
      onClick: () => {
        setActiveTab('leads');
        updateLeadFilter({ lead_type: leadFilters.lead_type === 'fresh' ? '' : 'fresh' });
      },
    },
    {
      key: 'reapproached',
      label: 'Re-Approached',
      value: reapproachedLeadsCount,
      subtext: 'Repeat Engagements',
      variant: 'amber',
      icon: <Layers className="h-4 w-4 text-[#9A3412]" />,
      active: leadFilters.lead_type === 're_approached',
      onClick: () => {
        setActiveTab('leads');
        updateLeadFilter({ lead_type: leadFilters.lead_type === 're_approached' ? '' : 're_approached' });
      },
    },
    {
      key: 'due_today',
      label: 'Follow-ups Due Today',
      value: followupsDueTodayCount,
      subtext: `Overdue: ${followupsOverdueCount}`,
      variant: Number(followupsOverdueCount) > 0 ? 'rose' : 'amber',
      icon: <Clock className="h-4 w-4 text-[#9A3412]" />,
      active: leadFilters.followup === 'due_today',
      onClick: () => {
        setActiveTab('leads');
        updateLeadFilter({ followup: leadFilters.followup === 'due_today' ? '' : 'due_today' });
      },
    },
    {
      key: 'converted',
      label: 'Converted Deals',
      value: convertedDealsCount,
      subtext: `Lost: ${lostLeadsCount}`,
      variant: 'emerald',
      icon: <Award className="h-4 w-4 text-[#0F5E63]" />,
      active: leadFilters.lead_status === 'converted',
      onClick: () => {
        setActiveTab('leads');
        updateLeadFilter({ lead_status: leadFilters.lead_status === 'converted' ? '' : 'converted' });
      },
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Page Header */}
      <PageHeader
        title="Lead & Customer Management"
        icon={<Target className="h-7 w-7 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreateLead}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New Opportunity / Lead
            </Button>
          </div>
        }
      />

      {/* 2. Key metrics — five cards; type / follow-up / converted cards filter the lead register (click again to clear). */}
      <StatGrid cols={5} className="gap-3">
        {leadHeadlineCards.map((c) => (
          <StatCard
            key={c.key}
            label={c.label}
            value={c.value}
            subtext={c.subtext}
            variant={c.variant}
            icon={c.icon}
            className={c.active ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
            onClick={c.onClick}
          />
        ))}
      </StatGrid>

      {/* 3. One filter row on every view: the View menu switches the register, then that view's search and dropdowns. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu label="View" icon={<LayoutList />} neutralKeys={[]} className="shrink-0" options={workspaceViewOptions} />

          {activeTab === 'leads' && (
            <>
              <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search leads"
                  placeholder="Search lead, client, salesperson…"
                  value={leadFilters.search}
                  onChange={(e) => updateLeadFilter({ search: e.target.value })}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <FilterMenu
                  label="Stage"
                  icon={<Layers />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  options={[{ key: 'all', label: 'All lifecycle stages' }, { key: 'active', label: 'Active pipeline (all open)' }, ...LEAD_STAGE_FILTERS].map((o) => ({
                    ...o,
                    count: o.key === 'all' ? undefined : o.key === 'active' ? activePipelineCount || undefined : leadStageCounts[o.key] || undefined,
                    active: (leadFilters.lead_status || 'all') === o.key,
                    onSelect: () => updateLeadFilter({ lead_status: o.key === 'all' ? '' : o.key }),
                  }))}
                />
                <FilterMenu
                  label="Follow-ups"
                  icon={<Clock />}
                  options={[
                    { key: 'all', label: 'All leads', count: undefined },
                    { key: 'overdue', label: 'Overdue', count: Number(followupsOverdueCount) || undefined },
                    { key: 'due_today', label: 'Due today', count: Number(followupsDueTodayCount) || undefined },
                    { key: 'upcoming', label: 'Upcoming', count: Number(leadStats?.followUps?.upcoming) || undefined },
                    { key: 'no_followup', label: 'Not scheduled', count: undefined },
                  ].map((f) => ({
                    ...f,
                    urgent: f.key === 'overdue',
                    active: (leadFilters.followup || 'all') === f.key,
                    onSelect: () => updateLeadFilter({ followup: f.key === 'all' ? '' : f.key }),
                  }))}
                />
                <button
                  type="button"
                  onClick={() => setMoreLeadFiltersOpen((o) => !o)}
                  aria-expanded={moreLeadFiltersOpen}
                  className={`filter-menu-btn ${moreLeadFiltersOpen || moreLeadFiltersActive > 0 ? 'filter-menu-btn--on' : ''}`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>More</span>
                  {moreLeadFiltersActive > 0 && <span className="filter-menu-chip">{moreLeadFiltersActive}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setLeadDatesOpen((o) => !o)}
                  aria-expanded={leadDatesOpen}
                  className={`filter-menu-btn ${leadDatesOpen || leadDatesActive ? 'filter-menu-btn--on' : ''}`}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>Dates</span>
                  {leadDatesActive && <span className="filter-menu-chip">On</span>}
                </button>
                <FilterMenu
                  label="Sort"
                  icon={<ArrowUpDown />}
                  neutralKeys={[...LEAD_SORT_FIELDS.map((f) => f.key), 'dir_desc', 'dir_asc']}
                  align="right"
                  options={[
                    ...LEAD_SORT_FIELDS.map((f) => ({
                      key: f.key,
                      label: f.label,
                      active: leadFilters.sort_by === f.key,
                      onSelect: () => updateLeadFilter({ sort_by: f.key }),
                    })),
                    { key: 'dir_desc', label: 'Descending', icon: <ChevronDown />, active: leadFilters.sort_dir === 'desc', onSelect: () => updateLeadFilter({ sort_dir: 'desc' }) },
                    { key: 'dir_asc', label: 'Ascending', icon: <ChevronUp />, active: leadFilters.sort_dir === 'asc', onSelect: () => updateLeadFilter({ sort_dir: 'asc' }) },
                  ]}
                />
                {hasActiveLeadFilters && (
                  <Button variant="ghost" size="xs" onClick={clearLeadFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}

          {activeTab === 'customers' && (
            <>
              <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search organisations"
                  placeholder="Search organisations by name, city, sector…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <span className="text-xs font-medium text-[#4A5568] sm:whitespace-nowrap">
                  Showing <strong className="text-[#14213D]">{customers.length}</strong> of{' '}
                  <strong className="text-[#14213D]">{customersTotal}</strong>{' '}
                  {customerSearch ? (
                    <>
                      matching accounts <span className="text-[#4A5568]/80">({totalCustomersCount || customersTotal} total)</span>
                    </>
                  ) : (
                    'accounts in system'
                  )}
                </span>
                {customerSearch && (
                  <Button variant="ghost" size="xs" onClick={() => setCustomerSearch('')} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}

          {activeTab === 'followups' && (
            <div className="flex flex-wrap items-center gap-2 lg:flex-1 lg:flex-nowrap">
              <FilterMenu
                label="Timeframe"
                icon={<CalendarDays />}
                options={FOLLOWUP_TIMEFRAMES.map((t) => ({
                  ...t,
                  active: followupTimeframe === t.key,
                  onSelect: () => setFollowupTimeframe(t.key),
                }))}
              />
              {followupTimeframe !== 'all' && (
                <Button variant="ghost" size="xs" onClick={() => setFollowupTimeframe('all')} className="text-xs text-[#4A5568] hover:text-[#881337]">
                  Clear
                </Button>
              )}
              <span className="whitespace-nowrap text-xs text-[#4A5568] lg:ml-auto">
                Total {followups.length} follow-ups displayed
              </span>
            </div>
          )}

          {activeTab === 'reports' && (
            <FilterMenu
              label="Report"
              icon={<Activity />}
              neutralKeys={[]}
              className="shrink-0"
              options={REPORT_SECTIONS.map((r) => ({
                ...r,
                active: reportSubTab === r.key,
                onSelect: () => setReportSubTab(r.key),
              }))}
            />
          )}
        </div>

        {/* "More" inline panel: the less-used lead filters (type, source, sector). */}
        {activeTab === 'leads' && moreLeadFiltersOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-2.5 text-xs">
            <span className="font-semibold text-[#4A5568]">More filters</span>
            <FilterMenu
              label="Type"
              icon={<Tag />}
              options={[
                { key: 'all', label: 'All lead types', count: undefined },
                { key: 'fresh', label: 'Fresh accounts', count: freshLeadsCount || undefined },
                { key: 're_approached', label: 'Re-approached accounts', count: reapproachedLeadsCount || undefined },
              ].map((o) => ({
                ...o,
                active: (leadFilters.lead_type || 'all') === o.key,
                onSelect: () => updateLeadFilter({ lead_type: o.key === 'all' ? '' : o.key }),
              }))}
            />
            <FilterMenu
              label="Source"
              icon={<Compass />}
              options={[{ key: 'all', label: 'All sources' }, ...LEAD_SOURCE_FILTERS].map((o) => ({
                ...o,
                active: (leadFilters.lead_source || 'all') === o.key,
                onSelect: () => updateLeadFilter({ lead_source: o.key === 'all' ? '' : o.key }),
              }))}
            />
            <FilterMenu
              label="Sector"
              icon={<Building />}
              className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
              options={[{ value: 'all', label: 'All sectors' }, ...SECTOR_OPTIONS.map((s) => ({ value: s.value, label: s.value }))].map((s) => ({
                key: s.value,
                label: s.label,
                active: (leadFilters.sector || 'all') === s.value,
                onSelect: () => updateLeadFilter({ sector: s.value === 'all' ? '' : s.value }),
              }))}
            />
            {moreLeadFiltersActive > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => updateLeadFilter({ lead_type: '', lead_source: '', sector: '' })}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset
              </Button>
            )}
          </div>
        )}

        {/* "Dates" inline panel: leads created From / To (IST days, both inclusive). Phones: two equal columns. */}
        {activeTab === 'leads' && leadDatesOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-[#ECE9E2] pt-2.5 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <span className="col-span-2 font-semibold text-[#4A5568]">Created date</span>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              From
              <input
                type="date"
                aria-label="Created from"
                value={leadFilters.created_from}
                max={leadFilters.created_to || undefined}
                onChange={(e) => updateLeadFilter({ created_from: e.target.value })}
                aria-invalid={leadDateRangeInvalid || undefined}
                className={`h-10 w-full min-w-0 rounded-lg border bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:w-auto ${leadDateRangeInvalid ? 'border-[#881337]' : 'border-[#C9C4B8]'}`}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              To
              <input
                type="date"
                aria-label="Created to"
                value={leadFilters.created_to}
                min={leadFilters.created_from || undefined}
                onChange={(e) => updateLeadFilter({ created_to: e.target.value })}
                aria-invalid={leadDateRangeInvalid || undefined}
                className={`h-10 w-full min-w-0 rounded-lg border bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:w-auto ${leadDateRangeInvalid ? 'border-[#881337]' : 'border-[#C9C4B8]'}`}
              />
            </label>
            {leadDateRangeInvalid && (
              <span role="alert" className="col-span-2 font-medium text-[#881337]">
                From date must be on or before To date.
              </span>
            )}
            {leadDatesActive && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => updateLeadFilter({ created_from: '', created_to: '' })}
                className="col-span-2 justify-self-start text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset dates
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* ========================================================================= */}
      {/* TAB 1: LEAD REGISTER & PIPELINE                                           */}
      {/* ========================================================================= */}
      {activeTab === 'leads' && (
        <div className="space-y-4">
          {/* Lead register: priority cards / stage board */}
          {leadsLoading ? (
            <Card padding="none" className="border-[#DCD8CE]">
              <PageLoader label="Loading pipeline" />
            </Card>
          ) : leads.length === 0 ? (
            <Card padding="none" className="border-[#DCD8CE]">
              <div className="py-12">
                <EmptyState
                  icon={Target}
                  title="No opportunities match your filter"
                  description={
                    leadDatesActive
                      ? 'No leads were created in this date range with the current filters. Try widening the dates or clearing filters.'
                      : 'Try adjusting your stage, type, or search filters, or register a new lead.'
                  }
                  action={
                    hasActiveLeadFilters ? (
                      <Button size="sm" variant="secondary" onClick={clearLeadFilters}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={handleOpenCreateLead}>
                        Create Opportunity
                      </Button>
                    )
                  }
                />
              </div>
            </Card>
          ) : (
            <RecordViews
              items={leadRecordItems}
              lanes={leadLanes}
              laneOf={(item) => leadLaneById.get(item.key) || 'new'}
              storageKey="leads"
              defaultView="list"
              list={leadList}
              hideEmptyLanes
              summary={
                <span className="font-mono text-xs">
                  {leads.length} of {leadsTotal} {leadsTotal === 1 ? 'lead' : 'leads'}
                </span>
              }
              empty="No opportunities match your filter."
              onLoadMore={leadsList.loadMore}
              hasMore={leadsList.hasMore}
              loadingMore={leadsList.loadingMore}
            />
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CUSTOMER REGISTER & 360° ACCOUNT VIEW                             */}
      {/* ========================================================================= */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          {customersLoading ? (
            <PageLoader label="Loading customer accounts" />
          ) : customers.length === 0 ? (
            <EmptyState
              icon={Building}
              title="No customer accounts found"
              description="No organisations match your search. Create an opportunity to auto-register an account."
            />
          ) : (
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Sector / Category</TableHead>
                  <TableHead>Primary Contact</TableHead>
                  <TableHead>Current Sales Owner</TableHead>
                  <TableHead>Pipeline Status</TableHead>
                  <TableHead>Latest Touchpoint</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((org) => (
                  <TableRow
                    key={org.id}
                    className="group cursor-pointer"
                    onClick={() => handleOpenCustomer360(org.id)}
                  >
                    <TableCell>
                      <div className="font-bold text-[#14213D] group-hover:text-[#0F5E63] transition-colors flex items-center gap-1.5">
                        <Building className="h-4 w-4 text-[#0F5E63] shrink-0" />
                        <span>{org.name}</span>
                      </div>
                      {org.department && (
                        <div className="text-[10px] text-[#4A5568]">{org.department}</div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs text-[#14213D] flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-[#4A5568]" />
                        <span>{org.city || '—'}, {org.state || '—'}</span>
                      </div>
                      {org.zone_name && (
                        <div className="text-[10px] text-[#4A5568]">{org.zone_name} Zone</div>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className="px-2 py-0.5 rounded bg-[#FBFAF7] border border-[#DCD8CE] text-[11px] font-medium text-[#14213D]">
                        {org.sector || 'Government / PSU'}
                      </span>
                    </TableCell>

                    <TableCell>
                      {org.primary_contact ? (
                        <div>
                          <div className="font-medium text-[#14213D]">
                            {org.primary_contact.name}
                          </div>
                          <div className="text-[10px] text-[#4A5568]">
                            {org.primary_contact.phone || org.primary_contact.email || org.primary_contact.designation || '—'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#4A5568] italic text-[11px]">No contact set</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className="font-semibold text-[#14213D]">
                        {org.current_salesperson || 'Unassigned'}
                      </span>
                    </TableCell>

                    <TableCell>
                      {org.lead_status ? getStatusBadge(org.lead_status) : (
                        <span className="text-[#4A5568] text-[10px] italic">No active lead</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {org.last_interaction_at ? (
                        <div className="text-[11px] font-mono text-[#14213D]">
                          {formatDateIN(org.last_interaction_at)}
                        </div>
                      ) : (
                        <span className="text-[#4A5568] italic text-[10px]">No interactions</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCustomer360(org.id);
                        }}
                        rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
                      >
                        360° View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {customersTotalPages > 1 && (
            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[#4A5568]">
                Showing {customers.length > 0 ? (customersPage - 1) * 15 + 1 : 0}–{Math.min(customersPage * 15, customersTotal)} of {customersTotal} accounts • Page {customersPage} of {customersTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 flex-1 sm:h-8 sm:flex-none"
                  disabled={customersPage <= 1}
                  onClick={() => setCustomersPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 flex-1 sm:h-8 sm:flex-none"
                  disabled={customersPage >= customersTotalPages}
                  onClick={() => setCustomersPage((p) => Math.min(customersTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: FOLLOW-UPS DESK                                                    */}
      {/* ========================================================================= */}
      {activeTab === 'followups' && (
        <div className="space-y-4">
          {followupsLoading ? (
            <PageLoader label="Loading follow-ups" />
          ) : followups.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No follow-ups in this queue"
              description="You have no pending follow-up touchpoints matching this timeframe."
            />
          ) : (
            <Table className="min-w-[950px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Client & Opportunity</TableHead>
                  <TableHead>Contact Officer</TableHead>
                  <TableHead>Assigned Salesperson</TableHead>
                  <TableHead>Follow-up Objective / Remarks</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {followups.map((fu) => {
                  const isOverdue =
                    fu.status === 'pending' &&
                    Boolean(fu.due_date) && calendarDay(fu.due_date) < istToday();
                  const isToday =
                    fu.status === 'pending' &&
                    calendarDay(fu.due_date) === istToday();

                  return (
                    <TableRow key={fu.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Clock className={`h-4 w-4 ${isOverdue ? 'text-[#881337]' : isToday ? 'text-[#9A3412]' : 'text-[#0F5E63]'}`} />
                          <span className="font-mono font-bold text-xs text-[#14213D]">
                            {formatDateIN(fu.due_date)}
                          </span>
                          {fu.due_time && (
                            <span className="font-mono text-[10px] text-[#4A5568]">{String(fu.due_time).slice(0, 5)}</span>
                          )}
                        </div>
                        {isOverdue && (
                          <Badge variant="danger" size="sm" className="mt-1 text-[10px]">
                            OVERDUE
                          </Badge>
                        )}
                        {isToday && (
                          <Badge variant="warning" size="sm" className="mt-1 text-[10px]">
                            DUE TODAY
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-bold text-[#14213D] line-clamp-1">
                          {fu.organisation_name || 'Organisation'}
                        </div>
                        {fu.lead_title && (
                          <div className="text-[10px] text-[#0F5E63] font-medium line-clamp-1">
                            Deal: {fu.lead_title}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {fu.contact_name ? (
                          <div>
                            <div className="font-medium text-[#14213D]">{fu.contact_name}</div>
                            <div className="text-[10px] text-[#4A5568]">
                              {fu.contact_designation || '—'}
                              {(fu.contact_mobile || fu.contact_phone) ? ` · ${fu.contact_mobile || fu.contact_phone}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#4A5568] italic text-[11px]">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <span className="font-semibold text-[#14213D] text-xs">
                          {fu.assigned_to_name || fu.assigned_salesperson_name || 'Unassigned'}
                        </span>
                      </TableCell>

                      <TableCell>
                        {(() => {
                          // Remarks accumulate one line per event (created, rescheduled …): show the objective and the latest note
                          const lines = String(fu.remarks || '').split('\n').map((l) => l.trim()).filter(Boolean);
                          const latest = lines.length > 1 ? lines[lines.length - 1] : null;
                          return (
                            <>
                              <p className="text-xs text-[#14213D] leading-snug max-w-sm line-clamp-2">
                                {lines[0] || 'Standard pipeline follow-up'}
                              </p>
                              {latest && (
                                <div className="text-[10px] text-[#9A3412] mt-0.5 max-w-sm line-clamp-2" title={lines.slice(1).join('\n')}>
                                  {latest}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {fu.outcome && (
                          <div className="text-[10px] text-[#0B4A4E] mt-0.5">
                            Outcome: {fu.outcome}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {fu.status === 'completed' ? (
                          <Badge variant="success" size="sm">COMPLETED</Badge>
                        ) : fu.status === 'cancelled' ? (
                          <Badge variant="default" size="sm">CANCELLED</Badge>
                        ) : (
                          <Badge variant="outline" size="sm">PENDING</Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {fu.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="xs"
                              variant="success"
                              onClick={() => {
                                setSelectedFollowup(fu);
                                setCompletionOutcome('');
                                setCompletionRemarks('');
                                setScheduleNextFollowup(false);
                                setNextFollowupDueDate('');
                                setNextFollowupDueTime('');
                                setCompletionOutcomeError(null);
                                setNextFollowupDateError(null);
                                setFormError(null);
                                setIsCompleteFollowupOpen(true);
                              }}
                              leftIcon={<Check className="h-3 w-3" />}
                            >
                              Complete
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                setSelectedFollowup(fu);
                                setRescheduleDate(calendarDay(fu.due_date));
                                setRescheduleTime(fu.due_time ? String(fu.due_time).slice(0, 5) : '');
                                setRescheduleRemarks('');
                                setRescheduleDateError(null);
                                setFormError(null);
                                setIsRescheduleFollowupOpen(true);
                              }}
                            >
                              Reschedule
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: EXECUTIVE INTELLIGENCE REPORTS                                     */}
      {/* ========================================================================= */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          {reportErrors[reportSubTab] ? (
            <InfoCallout variant="warning" title="Report unavailable">
              {reportErrors[reportSubTab]}
            </InfoCallout>
          ) : (
            !reportsLoading &&
            ((reportSubTab === 'salesperson' && salespersonReport.length === 0) ||
              (reportSubTab === 'zones' && zoneReport.length === 0) ||
              (reportSubTab === 'products' && productReport.length === 0) ||
              (reportSubTab === 'interactions' && interactionReport.length === 0)) && (
              <EmptyState
                icon={<Activity />}
                title="No data for this report yet"
                description="Leads, follow-ups and touchpoints in your scope will appear here as they are recorded."
              />
            )
          )}
          {/* Sub-report 1: Salesperson Performance */}
          {reportSubTab === 'salesperson' && salespersonReport.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Salesperson Conversion & Pipeline Ownership</CardTitle>
              </CardHeader>
              <CardContent>
                <Table className="min-w-[950px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Salesperson Name</TableHead>
                      <TableHead>Total Assigned Leads</TableHead>
                      <TableHead>Fresh Leads</TableHead>
                      <TableHead>Re-Approached</TableHead>
                      <TableHead>Active Deals</TableHead>
                      <TableHead>Converted (Won)</TableHead>
                      <TableHead>Lost Deals</TableHead>
                      <TableHead>Pending Follow-ups</TableHead>
                      <TableHead>Overdue Follow-ups</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salespersonReport.map((sp) => (
                      <TableRow key={sp.salesperson_id}>
                        <TableCell className="font-bold text-[#14213D]">
                          {sp.salesperson_name}
                        </TableCell>
                        <TableCell className="font-semibold text-center">{sp.total_leads}</TableCell>
                        <TableCell className="text-center font-medium text-[#0B4A4E]">{sp.fresh_leads}</TableCell>
                        <TableCell className="text-center font-medium text-[#7C2D12]">{sp.reapproached_leads}</TableCell>
                        <TableCell className="text-center font-bold text-[#0F5E63]">{sp.active_leads}</TableCell>
                        <TableCell className="text-center font-extrabold text-[#0B4A4E]">{sp.converted_leads}</TableCell>
                        <TableCell className="text-center text-[#700F2D] font-medium">{sp.lost_leads}</TableCell>
                        <TableCell className="text-center font-mono">{sp.pending_followups}</TableCell>
                        <TableCell className="text-center">
                          {Number(sp.overdue_followups) > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-[#FCE8EC] text-[#700F2D] font-bold text-xs">
                              {sp.overdue_followups}
                            </span>
                          ) : (
                            <span className="text-[#4A5568] font-mono">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Sub-report 2: Territorial Zone Breakdown */}
          {reportSubTab === 'zones' && zoneReport.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Territorial Zone & Regional Pipeline Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <Table className="min-w-[800px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-center">Total Leads</TableHead>
                      <TableHead className="text-center">Fresh Leads</TableHead>
                      <TableHead className="text-center">Re-Approached</TableHead>
                      <TableHead className="text-center">Converted (Won)</TableHead>
                      <TableHead className="text-center">Lost Deals</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zoneReport.map((z, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-bold text-[#14213D]">{z.zone_name}</TableCell>
                        <TableCell className="font-medium text-[#14213D]">{z.region_name}</TableCell>
                        <TableCell className="text-center font-bold text-[#0F5E63]">{z.total_leads}</TableCell>
                        <TableCell className="text-center font-semibold text-[#0B4A4E]">{z.fresh_leads}</TableCell>
                        <TableCell className="text-center font-semibold text-[#7C2D12]">{z.reapproached_leads}</TableCell>
                        <TableCell className="text-center font-bold text-[#0B4A4E]">{z.converted_leads}</TableCell>
                        <TableCell className="text-center font-medium text-[#700F2D]">{z.lost_leads}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Sub-report 3: Product Demand Intelligence */}
          {reportSubTab === 'products' && productReport.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Product Demand & Inquiry Heatmap</CardTitle>
              </CardHeader>
              <CardContent>
                <Table className="min-w-[750px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-center">Total Lead Inquiries</TableHead>
                      <TableHead className="text-center">Active Pipeline Deals</TableHead>
                      <TableHead className="text-center">Converted Deals</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productReport.map((p) => (
                      <TableRow key={p.product_id}>
                        <TableCell className="font-bold text-[#14213D]">{p.product_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" size="sm">{p.category?.toUpperCase() || 'DEFENCE'}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-bold text-[#0F5E63]">{p.total_leads}</TableCell>
                        <TableCell className="text-center font-semibold text-[#7C2D12]">{p.active_leads}</TableCell>
                        <TableCell className="text-center font-extrabold text-[#0B4A4E]">{p.converted_leads}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Sub-report 4: Field Activity Breakdown */}
          {reportSubTab === 'interactions' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {interactionReport.map((ir, idx) => (
                <div
                  key={idx}
                  className="p-3 sm:p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs hover:border-[#0F5E63] transition-all flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568] block mb-1">
                      Channel
                    </span>
                    <Badge variant="outline" size="sm" className="font-bold uppercase">
                      {ir.interaction_type}
                    </Badge>
                  </div>
                  <div className="mt-4 pt-2 border-t border-[#DCD8CE] flex items-baseline justify-between">
                    <span className="text-[10px] text-[#4A5568] font-semibold">Total Logged</span>
                    <span className="text-xl font-extrabold text-[#0F5E63]">
                      {ir.total_interactions ?? ir.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE LEAD / OPPORTUNITY (WITH LIVE DUPLICATE DETECTION)        */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateLeadOpen}
        onClose={handleCloseCreateLead}
        title="Register New Lead Opportunity"
        description="Capture comprehensive opportunity intelligence, contact person, jurisdiction, and initial interaction."
        maxWidth="4xl"
      >
        {/* noValidate: required fields are checked by validateLeadForm and reported inline, all at once (QA DEF-102) */}
        <form onSubmit={handleCreateLead} noValidate className="text-xs">
          <FormSteps
            onCancel={handleCloseCreateLead}
            validateStep={validateLeadStep}
            banner={
              (createLeadError || formError) && (
                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D] flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="font-medium">{createLeadError || formError}</span>
                </div>
              )
            }
            submit={
              <Button type="submit" variant="primary" isLoading={actionLoading} disabled={actionLoading}>
                <span className="sm:hidden">Register Lead</span>
                <span className="hidden sm:inline">Register Lead Opportunity</span>
              </Button>
            }
            steps={[
              {
                title: 'Organisation',
                icon: <Building />,
                description: 'Which agency is this opportunity with? Pick an existing account or create a new one.',
                content: (
          <div className="space-y-3">
            <div>
              <div className="flex w-full items-center gap-1.5 rounded-lg bg-[#FBFAF7] p-1 sm:inline-flex sm:w-auto">
                <button
                  type="button"
                  onClick={() => setLeadForm({ ...leadForm, organisation_mode: 'new' })}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all sm:flex-none sm:py-1 ${
                    leadForm.organisation_mode === 'new'
                      ? 'bg-[#0F5E63] text-white shadow-sm'
                      : 'bg-white text-[#4A5568] border border-[#DCD8CE] hover:border-[#0F5E63]'
                  }`}
                >
                  Create New Account
                </button>
                <button
                  type="button"
                  onClick={() => setLeadForm({ ...leadForm, organisation_mode: 'existing' })}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all sm:flex-none sm:py-1 ${
                    leadForm.organisation_mode === 'existing'
                      ? 'bg-[#0F5E63] text-white shadow-sm'
                      : 'bg-white text-[#4A5568] border border-[#DCD8CE] hover:border-[#0F5E63]'
                  }`}
                >
                  Select Existing Account
                </button>
              </div>
            </div>

            {leadForm.organisation_mode === 'new' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Organisation / Agency Name *"
                    required
                    value={leadForm.organisation_name}
                    onChange={(e) => setLeadForm({ ...leadForm, organisation_name: e.target.value })}
                    placeholder="e.g. Central Reserve Police Force or Western Naval Command"
                    error={leadErrors.organisation_name}
                  />
                  <Input
                    label="Department / Unit / Wing"
                    value={leadForm.department}
                    onChange={(e) => setLeadForm({ ...leadForm, department: e.target.value })}
                    placeholder="e.g. Procurement & Ordnance Branch"
                  />
                </div>

                {/* Duplicate Detection Alert Banner */}
                {isCheckingDuplicate && (
                  <div className="text-[11px] text-[#4A5568] italic flex items-center gap-1.5">
                    <Spinner size="xs" />
                    <span>Checking account database for duplicate records...</span>
                  </div>
                )}
                {duplicateMatches.length > 0 && (
                  <div className="p-3 rounded-xl bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] space-y-2">
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <AlertTriangle className="h-4 w-4 text-[#7C2D12] shrink-0" />
                      <span>Possible Duplicate Organisation Detected!</span>
                    </div>
                    <p className="text-[11px] text-[#7C2D12] leading-snug">
                      {duplicateSuggestion}
                    </p>
                    <div className="space-y-1.5 pt-1">
                      {duplicateMatches.map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-col gap-2 p-2 rounded-lg bg-white border border-[#E9C9B4] sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-[#14213D] block">{m.name}</span>
                            <span className="text-[10px] text-[#4A5568]">
                              {m.city || ''}, {m.state || ''} • Match: {m.matchReason}
                            </span>
                          </div>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            className="h-9 w-full shrink-0 sm:h-7 sm:w-auto"
                            onClick={() => {
                              setLeadForm({
                                ...leadForm,
                                organisation_mode: 'existing',
                                organisation_id: m.id,
                              });
                              handleSelectExistingOrg(m.id);
                            }}
                          >
                            Link This Account
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Select
                  label="Select Existing Organisation Account *"
                  required
                  value={leadForm.organisation_id}
                  error={leadErrors.organisation_id}
                  onChange={(e) => handleSelectExistingOrg(e.target.value)}
                  options={[
                    { value: '', label: 'Select Organisation...' },
                    ...(organisationsList.length > 0 ? organisationsList : customers).map((c) => ({
                      value: c.id,
                      label: `${c.name} (${c.city || c.state || 'India'})`,
                    })),
                  ]}
                />
              </div>
            )}
          </div>
                ),
              },
              {
                title: 'Location',
                icon: <MapPin />,
                description: 'Where the agency is based — this decides the zone and region that own the lead.',
                content: (
          <div className="space-y-3">
            {/* City, State, Zone, Region, Sector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="City *"
                required
                value={leadForm.city}
                onChange={(e) => handleLeadCityChange(e.target.value)}
                placeholder="e.g. New Delhi"
                error={leadErrors.city}
              />
              <Select
                label="State / UT *"
                required
                value={leadForm.state}
                onChange={(e) => setLeadForm({ ...leadForm, state: e.target.value })}
                error={leadErrors.state}
                helperText={stateOfCity(leadForm.city) === leadForm.state && leadForm.state ? `Filled in from ${leadForm.city.trim()}` : undefined}
                options={[
                  { value: '', label: 'Select State / UT...' },
                  ...INDIAN_STATES.map((st) => ({ value: st, label: st })),
                  // a legacy free-text state on an existing account stays visible (and is flagged) until corrected
                  ...(leadForm.state && !INDIAN_STATES.includes(leadForm.state)
                    ? [{ value: leadForm.state, label: `${leadForm.state} (not recognised)` }]
                    : []),
                ]}
              />
              <Select
                label="Sector / Department *"
                required
                error={leadErrors.sector}
                value={leadForm.sector}
                onChange={(e) => setLeadForm({ ...leadForm, sector: e.target.value })}
                options={[
                  { value: '', label: 'Select Sector...' },
                  ...SECTOR_OPTIONS,
                ]}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Zone *"
                required
                error={leadErrors.zone_id}
                value={leadForm.zone_id}
                onChange={(e) => handleZoneChange(e.target.value)}
                options={[
                  { value: '', label: 'Select Zone...' },
                  ...zonesList.map((z) => ({ value: z.id, label: `${z.name} (${z.code})` })),
                ]}
              />
              <Select
                label="Region *"
                required
                error={leadErrors.region_id}
                value={leadForm.region_id}
                onChange={(e) => setLeadForm({ ...leadForm, region_id: e.target.value })}
                options={[
                  { value: '', label: leadForm.zone_id ? 'Select Region in Zone...' : 'Select Region...' },
                  ...filteredRegions.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </div>
          </div>
                ),
              },
              {
                title: 'Contact',
                icon: <User />,
                description: 'The officer you are dealing with.',
                content: (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Contact Person Name *"
                required
                value={leadForm.contact_name}
                onChange={(e) => setLeadForm({ ...leadForm, contact_name: e.target.value })}
                placeholder="e.g. Col. Alok Mathur or Shri R.K. Sharma"
                error={leadErrors.contact_name}
              />
              <Input
                label="Designation / Rank *"
                required
                value={leadForm.contact_designation}
                onChange={(e) => setLeadForm({ ...leadForm, contact_designation: e.target.value })}
                placeholder="e.g. DIG Procurement, Director, ADG"
                error={leadErrors.contact_designation}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Mobile / Direct Phone *"
                required
                type="tel"
                inputMode="tel"
                maxLength={16}
                value={leadForm.contact_mobile}
                onChange={(e) => setLeadForm({ ...leadForm, contact_mobile: e.target.value })}
                placeholder="+91 98110 00000"
                error={leadErrors.contact_mobile}
              />
              <Input
                label="Email Address"
                type="email"
                value={leadForm.contact_email}
                onChange={(e) => setLeadForm({ ...leadForm, contact_email: e.target.value })}
                placeholder="officer@crpf.gov.in"
                error={leadErrors.contact_email}
              />
            </div>
          </div>
                ),
              },
              {
                title: 'Opportunity',
                icon: <Target />,
                description: 'What they are interested in, how the lead came in, and its current status.',
                content: (
          <div className="space-y-3">
            <div>
                <Select
                  label="Product Interests *"
                  required={leadForm.product_ids.length === 0}
                  error={leadErrors.product_ids}
                  value=""
                  onChange={(e) => {
                    const pid = e.target.value;
                    if (pid && !leadForm.product_ids.includes(pid)) {
                      setLeadForm({
                        ...leadForm,
                        product_ids: [...leadForm.product_ids, pid],
                      });
                    }
                  }}
                  options={[
                    {
                      value: '',
                      label:
                        leadForm.product_ids.length === 0
                          ? 'Select Product Interest...'
                          : '+ Add another product interest...',
                    },
                    ...productsList
                      .filter((p) => !leadForm.product_ids.includes(p.id))
                      .map((p) => ({
                        value: p.id,
                        label: `${p.name} (${p.category || 'Security'})`,
                      })),
                  ]}
                />
            </div>
            {/* chips for the chosen products */}
            {leadForm.product_ids.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {leadForm.product_ids.map((pid) => {
                  const prod = productsList.find((p) => p.id === pid);
                  return (
                    <span
                      key={pid}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E3EFEE] text-[#0F5E63] text-xs font-semibold border border-[#0F5E63]/20"
                    >
                      <span className="truncate max-w-[200px]">{prod ? prod.name : pid}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setLeadForm({
                            ...leadForm,
                            product_ids: leadForm.product_ids.filter((id) => id !== pid),
                          })
                        }
                        className="text-[#0F5E63] hover:text-[#700F2D] transition-colors"
                        title="Remove product"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Select
                label="Lead Category *"
                required
                value={leadForm.category}
                onChange={(e) => setLeadForm({ ...leadForm, category: e.target.value as LeadCategory })}
                options={LEAD_CATEGORY_OPTIONS}
              />
              <Select
                label="Lead Source *"
                required
                value={leadForm.source}
                onChange={(e) => setLeadForm({ ...leadForm, source: e.target.value })}
                options={LEAD_SOURCE_OPTIONS}
              />
              <Select
                label="Lead Status *"
                required
                value={leadForm.lead_status}
                onChange={(e) => setLeadForm({ ...leadForm, lead_status: e.target.value as LeadStatus })}
                error={leadErrors.lead_status}
                helperText="Later stages are reached from the lead's lifecycle actions"
                options={LEAD_STATUS_OPTIONS.filter((o) => INITIAL_LEAD_STATUSES.includes(o.value))}
              />
              <Input
                label="Deal Value (₹ Lakh)"
                type="number"
                step="0.1"
                min="0.01"
                value={leadForm.value_lakh}
                onChange={(e) => setLeadForm({ ...leadForm, value_lakh: e.target.value })}
                placeholder="e.g. 45.0"
                error={leadErrors.value_lakh}
              />
            </div>
          </div>
                ),
              },
              {
                title: 'Follow-up',
                icon: <Clock />,
                description: 'Who owns the lead, the last conversation and the next step.',
                content: (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Assigned Salesperson *"
                required
                value={leadForm.assigned_to}
                onChange={(e) => handleSalespersonChange(e.target.value)}
                disabled={user?.role === 'sales'}
                error={leadErrors.assigned_to}
                helperText={user?.role === 'sales' ? 'Leads you register are assigned to you' : undefined}
                options={[
                  { value: '', label: 'Select Salesperson...' },
                  ...assignableSalespeople.map((u: any) => ({
                    value: u.id,
                    label: `${u.full_name} (${u.role === 'regional_manager' ? 'Regional Manager' : 'Sales'})`,
                  })),
                ]}
              />
              <Select
                label="Regional Manager"
                value={leadForm.regional_manager_id}
                onChange={(e) => setLeadForm({ ...leadForm, regional_manager_id: e.target.value })}
                options={[
                  { value: '', label: 'Auto-assigned from reporting manager' },
                  ...regionalManagerOptions.map((u) => ({
                    value: u.id,
                    label: `${u.full_name} (${u.role === 'regional_manager' ? `RM${u.region_name ? ` · ${u.region_name}` : ''}` : 'Management'})`,
                  })),
                ]}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Last Interaction Date *"
                type="date"
                required
                max={istToday()}
                value={leadForm.last_interaction_date}
                onChange={(e) => setLeadForm({ ...leadForm, last_interaction_date: e.target.value })}
                error={leadErrors.last_interaction_date}
              />
              <Select
                label="Last Interaction Type"
                value={leadForm.last_interaction_type}
                onChange={(e) => setLeadForm({ ...leadForm, last_interaction_type: e.target.value })}
                options={INTERACTION_TYPE_OPTIONS}
              />
              <Input
                label="Next Follow-up Date (Optional)"
                type="date"
                min={leadForm.last_interaction_date > istToday() ? leadForm.last_interaction_date : istToday()}
                value={leadForm.next_followup_date}
                onChange={(e) => setLeadForm({ ...leadForm, next_followup_date: e.target.value })}
                error={leadErrors.next_followup_date}
              />
            </div>
            <Textarea
              label="Remarks & Discussion Summary"
              value={leadForm.remarks}
              onChange={(e) => setLeadForm({ ...leadForm, remarks: e.target.value })}
              placeholder="Record procurement timeline, budget sanction details, trial requirements, or interaction feedback..."
              rows={3}
            />
          </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: LEAD DETAILS & LIFECYCLE PROGRESSION STEPPER                      */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isLeadDetailOpen}
        onClose={handleCloseLeadDetail}
        title={selectedLead?.title || (selectedLead?.organisation_name ? `${selectedLead.organisation_name} — Opportunity Intelligence` : 'Opportunity Intelligence')}
        description={`Account: ${selectedLead?.organisation_name || 'Government Body'}${selectedLead?.department ? ` • ${selectedLead.department}` : ''}${selectedLead?.city ? ` (${selectedLead.city}, ${selectedLead.state || ''})` : ''}`}
        maxWidth="4xl"
      >
        {selectedLead && (
          <div className="space-y-4 text-xs">
            {/* Snapshot: the four things a salesperson needs before acting, plus the stage progress and next move */}
            {(() => {
              const PIPELINE = ['new', 'contacted', 'qualified', 'demo', 'proposal', 'tender_discussion', 'negotiation', 'converted'];
              const label = (st: string) => st.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              const current = (selectedLead.lead_status || selectedLead.status || 'new').toLowerCase();
              const curIdx = PIPELINE.indexOf(current);
              const allowed: string[] = selectedLead.allowed_transitions || [];
              const nextStage = PIPELINE.find((st, i) => i > curIdx && allowed.includes(st));
              const sideActions = allowed.filter((st) => st !== nextStage && !PIPELINE.includes(st) || (st !== nextStage && PIPELINE.includes(st) && PIPELINE.indexOf(st) > curIdx && st !== 'converted'));
              const closeActions = allowed.filter((st) => st === 'converted' || st === 'lost');
              // A won lead offers only management's reopen actions (the API returns none to anyone else — QA DEF-055)
              const otherActions =
                current === 'converted' || current === 'won'
                  ? allowed
                  : sideActions.filter((st) => st !== 'lost' && st !== 'converted');
              const nextFollowUp = selectedLead.next_followup_date || selectedLead.next_followup_at || selectedLead.follow_ups?.[0]?.due_date;
              const secondaryButtons = (
                <>
                  {otherActions.map((st) => (
                    <Button
                      key={st}
                      size="xs"
                      variant="outline"
                      className="h-10 text-xs leading-tight sm:h-7 sm:text-[11px]"
                      isLoading={actionLoading && targetStatus === st}
                      onClick={() => handleDirectAdvanceStatus(st)}
                    >
                      {current === 'converted' || current === 'won'
                        ? `Reopen to ${label(st)} (management)`
                        : st === 'follow_up'
                        ? 'Schedule Follow-up'
                        : st === 'on_hold'
                        ? 'Put On Hold'
                        : `Skip to ${label(st)}`}
                    </Button>
                  ))}
                  {closeActions.map((st) => (
                    <Button
                      key={st}
                      size="xs"
                      variant={st === 'converted' ? 'success' : 'danger'}
                      className="h-10 text-xs leading-tight sm:h-7 sm:text-[11px]"
                      isLoading={actionLoading && targetStatus === st}
                      onClick={() => handleDirectAdvanceStatus(st)}
                    >
                      {st === 'converted' ? 'Mark Converted' : 'Mark Lost'}
                    </Button>
                  ))}
                </>
              );
              const hasSecondary = otherActions.length + closeActions.length > 0;
              return (
                <div className="rounded-xl bg-white border border-[#DCD8CE] divide-y divide-[#ECE9E2]">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 sm:p-4">
                    <div>
                      <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Stage</span>
                      <div className="mt-1">{getStatusBadge(selectedLead.lead_status || selectedLead.status)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Deal Value</span>
                      <span className="font-extrabold text-[#0F5E63] mt-1 block text-sm font-mono">
                        {formatLakh(selectedLead.value_lakh || selectedLead.estimated_value_lakh || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Probability</span>
                      <div className="mt-1">
                        <Badge
                          variant={
                            selectedLead.probability === 'high'
                              ? 'success'
                              : selectedLead.probability === 'medium'
                              ? 'warning'
                              : 'default'
                          }
                          size="sm"
                          className="font-bold uppercase text-[10px]"
                        >
                          {selectedLead.probability || 'MEDIUM'}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Next Follow-up</span>
                      <span className={`mt-1 block font-mono text-xs font-semibold ${nextFollowUp ? 'text-[#9A3412]' : 'text-[#6B7280]'}`}>
                        {nextFollowUp ? formatDateIN(nextFollowUp) : 'None scheduled'}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 sm:p-4 space-y-3">
                    {/* Stage progress: one segment per pipeline stage */}
                    <div>
                      <div className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="font-semibold text-[#14213D]">
                          {curIdx >= 0 ? `Stage ${curIdx + 1} of ${PIPELINE.length} · ${label(current)}` : `Current stage: ${label(current)}`}
                        </span>
                        {nextStage && <span className="text-[#4A5568]">Next: {label(nextStage)}</span>}
                      </div>
                      <ol className="mt-2 grid grid-cols-8 gap-1" aria-label="Lead pipeline">
                        {PIPELINE.map((st, i) => (
                          <li
                            key={st}
                            title={label(st)}
                            aria-current={st === current ? 'step' : undefined}
                            className={`h-1.5 rounded-full ${
                              st === current ? 'bg-[#0F5E63]' : curIdx >= 0 && i < curIdx ? 'bg-[#0F5E63]/40' : 'bg-[#ECE9E2]'
                            }`}
                          >
                            <span className="sr-only">{label(st)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    {actionSuccess && (
                      <div className="p-2.5 rounded-lg bg-[#E3EFEE] border border-[#0F5E63]/30 text-[#0F5E63] text-xs font-semibold flex items-center justify-between animate-in fade-in">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />
                          <span>{actionSuccess}</span>
                        </div>
                        <button type="button" onClick={() => setActionSuccess(null)} className="text-[#0F5E63] hover:opacity-70 font-bold ml-2">×</button>
                      </div>
                    )}

                    {formError && (
                      <div className="p-2.5 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D] text-xs font-medium">
                        {formError}
                      </div>
                    )}

                    {allowed.length === 0 ? (
                      <div className="text-[11px] text-[#4A5568] italic">
                        This lead is in terminal stage ({label(current)}). No further transitions allowed.
                      </div>
                    ) : nextStage ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                          <Button
                            size="xs"
                            variant="primary"
                            className="h-10 text-xs leading-tight sm:h-7 sm:text-[11px]"
                            rightIcon={<ArrowRight className="h-3 w-3" />}
                            isLoading={actionLoading && targetStatus === nextStage}
                            onClick={() => handleDirectAdvanceStatus(nextStage)}
                          >
                            Move to {label(nextStage)}
                          </Button>
                          {hasSecondary && (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="h-10 text-xs leading-tight sm:h-7 sm:text-[11px]"
                              aria-expanded={showLeadStageActions}
                              rightIcon={showLeadStageActions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              onClick={() => setShowLeadStageActions((v) => !v)}
                            >
                              More actions
                            </Button>
                          )}
                        </div>
                        {showLeadStageActions && (
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center animate-in fade-in duration-150">
                            {secondaryButtons}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">{secondaryButtons}</div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Section tabs */}
            <ScrollStrip role="tablist" aria-label="Lead sections" activeKey={leadDetailTab} wrapperClassName="border-b border-[#DCD8CE]" className="items-center gap-1 pb-px">
              {([
                ['overview', 'Overview', null],
                ['activity', 'Activity & Notes', null],
                ['conversation', 'Conversation', selectedLead.message_count || 0],
                ['products', 'Products', (selectedLead.product_interests || []).length || (selectedLead.product_name ? 1 : 0)],
                ['ownership', 'Ownership History', (selectedLead.assignment_history || []).length],
                ['linked', 'Linked Records', null],
              ] as const).map(([key, lbl, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={leadDetailTab === key}
                  onClick={() => setLeadDetailTab(key)}
                  className={`px-3.5 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    leadDetailTab === key
                      ? 'border-[#0F5E63] text-[#0F5E63]'
                      : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                  }`}
                >
                  {lbl}
                  {count ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#E3EFEE] text-[#0F5E63] text-[10px]">{count}</span> : null}
                </button>
              ))}
            </ScrollStrip>

            {/* Every tab shares one panel height so switching tabs doesn't resize the dialog; each tab's card fills it */}
            <div className="flex min-h-[220px] flex-col">
            {leadDetailTab === 'overview' && (() => {
              const label = (st: string) => st.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              const zoneName = selectedLead.zone_name || zonesList.find((z) => z.id === selectedLead.zone_id)?.name;
              const createdOn = selectedLead.created_at
                ? new Date(selectedLead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
                : null;
              // Everything that is reference data rather than something to act on lives behind "Show all details"
              const moreDetails: [string, React.ReactNode][] = [
                ['Department / Unit / Wing', selectedLead.department],
                ['Sector', SECTOR_OPTIONS.find((s) => s.value === selectedLead.sector)?.label || selectedLead.sector],
                ['Zone', zoneName && (zoneName.toLowerCase().includes('zone') ? zoneName : `${zoneName} Zone`)],
                ['Region Office', selectedLead.region_name || regionsList.find((r) => r.id === selectedLead.region_id)?.name],
                ['Regional Manager', selectedLead.regional_manager_name],
                ['Channel', label(selectedLead.channel || 'direct')],
                ['Lead Source', LEAD_SOURCE_OPTIONS.find((s) => s.value === selectedLead.source)?.label || selectedLead.source],
                [
                  'Category',
                  selectedLead.category === 'new_lead'
                    ? 'New Lead'
                    : selectedLead.category === 'follow_up'
                    ? 'Follow-up'
                    : selectedLead.category && label(selectedLead.category),
                ],
                ['Classification', selectedLead.lead_type === 're_approached' ? 'Re-approached' : 'Fresh Account'],
                ['Registered On', createdOn && <span className="font-mono">{createdOn}</span>],
              ];
              return (
                <div className="flex-1 rounded-xl bg-white border border-[#DCD8CE] divide-y divide-[#ECE9E2] animate-in fade-in duration-150">
                  {/* Key contact with one-tap call / email */}
                  <div className="flex flex-col gap-3 p-3 sm:p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] text-[#0F5E63]">
                        <User className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Key Contact</span>
                        <span className="font-bold text-[#14213D] text-sm block truncate">
                          {selectedLead.contact_name || 'No contact specified'}
                        </span>
                        {selectedLead.contact_designation && (
                          <span className="text-[11px] text-[#4A5568] block truncate">{selectedLead.contact_designation}</span>
                        )}
                      </div>
                    </div>
                    {(selectedLead.contact_mobile || selectedLead.contact_email) && (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {selectedLead.contact_mobile && (
                          <a
                            href={`tel:${selectedLead.contact_mobile}`}
                            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#C9C4B8] bg-white px-3 font-mono text-xs font-semibold text-[#0F5E63] hover:bg-[#E3EFEE] sm:h-8"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            <span>{selectedLead.contact_mobile}</span>
                          </a>
                        )}
                        {selectedLead.contact_email && (
                          <a
                            href={`mailto:${selectedLead.contact_email}`}
                            title={selectedLead.contact_email}
                            className="inline-flex h-10 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[#C9C4B8] bg-white px-3 font-mono text-xs font-semibold text-[#0F5E63] hover:bg-[#E3EFEE] sm:h-8 sm:max-w-[240px]"
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{selectedLead.contact_email}</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Who owns it and where it is */}
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Sales Owner</span>
                      <span className="font-semibold text-[#14213D] block mt-0.5 truncate">
                        {selectedLead.assigned_salesperson_name || selectedLead.assignee_name || 'Unassigned'}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Location</span>
                      <span className="font-semibold text-[#14213D] mt-0.5 flex items-center gap-1 min-w-0">
                        <MapPin className="h-3 w-3 text-[#4A5568] shrink-0" />
                        <span className="truncate">
                          {[selectedLead.city, selectedLead.state].filter(Boolean).join(', ') || '—'}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Reference details, collapsed by default */}
                  <div className="p-3 sm:p-4">
                    <button
                      type="button"
                      aria-expanded={showLeadFullDetails}
                      onClick={() => setShowLeadFullDetails((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg text-xs font-semibold text-[#0F5E63] hover:text-[#0B4A4E]"
                    >
                      <span>{showLeadFullDetails ? 'Hide details' : 'Show all details'}</span>
                      {showLeadFullDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {showLeadFullDetails && (
                      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 animate-in fade-in duration-150">
                        {moreDetails.map(([k, v]) => (
                          <div key={k} className="min-w-0">
                            <dt className="text-[10px] uppercase text-[#4A5568] font-bold">{k}</dt>
                            <dd className="mt-0.5 font-medium text-[#14213D] [overflow-wrap:anywhere]">{v || '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </div>
              );
            })()}

            {leadDetailTab === 'activity' && (
              <div className="flex flex-1 flex-col animate-in fade-in duration-150">
            {/* Interactions, Scheduled Follow-Up & Remarks */}
            <div className="flex flex-1 flex-col p-3 sm:p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
              <div className="flex items-center gap-2 border-b border-[#ECE9E2] pb-2">
                <Clock className="h-4 w-4 text-[#0F5E63] shrink-0" />
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                  Interactions, Follow-Up Schedule & Notes
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Last Interaction Touchpoint</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#14213D]">
                      {selectedLead.last_contact_date
                        ? formatDateIN(selectedLead.last_contact_date)
                        : selectedLead.last_interaction_at
                        ? formatDateIN(selectedLead.last_interaction_at)
                        : selectedLead.interactions?.[0]?.occurred_on
                        ? formatDateIN(selectedLead.interactions[0].occurred_on)
                        : 'None logged'}
                    </span>
                    <Badge variant="outline" size="sm" className="font-bold text-[10px]">
                      {INTERACTION_TYPE_OPTIONS.find(t => t.value === (selectedLead.last_interaction_type || selectedLead.interactions?.[0]?.type))?.label ||
                        (selectedLead.last_interaction_type || selectedLead.interactions?.[0]?.type || 'CALL').toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Next Follow-Up Commitment</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#14213D]">
                      {selectedLead.next_followup_date
                        ? formatDateIN(selectedLead.next_followup_date)
                        : selectedLead.next_followup_at
                        ? formatDateIN(selectedLead.next_followup_at)
                        : selectedLead.follow_ups?.[0]?.due_date
                        ? formatDateIN(selectedLead.follow_ups[0].due_date)
                        : 'None scheduled'}
                    </span>
                    {(selectedLead.next_followup_date || selectedLead.next_followup_at || selectedLead.follow_ups?.[0]?.due_date) && (
                      <Badge variant="warning" size="sm" className="uppercase font-bold text-[10px]">
                        {selectedLead.next_followup_status || selectedLead.follow_ups?.[0]?.status || 'PENDING'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-1 flex-col">
                <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Remarks & Discussion Summary</span>
                <div className="flex-1 p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] text-xs text-[#14213D] leading-relaxed">
                  {selectedLead.remarks || selectedLead.last_interaction_notes || selectedLead.interactions?.[0]?.remarks || (
                    <span className="text-[#4A5568] italic">No remarks provided during opportunity registration.</span>
                  )}
                </div>
              </div>
            </div>

              </div>
            )}

            {leadDetailTab === 'products' && (
              <div className="flex flex-1 flex-col animate-in fade-in duration-150">
            {/* Product Interests Section */}
            <div className="flex flex-1 flex-col p-3 sm:p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-[#0F5E63]" />
                  <span>Product Interests</span>
                </span>
                {productsList.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) handleAddProductInterest(e.target.value);
                      e.target.value = '';
                    }}
                    className="h-10 w-full max-w-full px-2 py-1 text-xs bg-white border border-[#DCD8CE] rounded-lg text-[#14213D] sm:h-auto sm:w-auto sm:text-[11px]"
                  >
                    <option value="">+ Add Product Interest</option>
                    {productsList.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedLead.product_interests && selectedLead.product_interests.length > 0 ? (
                <ul className="divide-y divide-[#ECE9E2] rounded-lg bg-white border border-[#DCD8CE]">
                  {selectedLead.product_interests.map((p: any) => (
                    <li
                      key={p.product_id || p.id}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-[#14213D]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Briefcase className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
                        <span className="truncate">{p.name || p.product_name || productsList.find((x) => x.id === (p.product_id || p.id))?.name || 'Product Interest'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveProductInterest(p.product_id || p.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#FCE8EC] hover:text-[#881337] transition-colors"
                        title="Remove product"
                        aria-label="Remove product"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : selectedLead.product_name ? (
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#DCD8CE] text-xs font-medium text-[#14213D]">
                    <span>{selectedLead.product_name}</span>
                  </span>
                </div>
              ) : (
                <span className="flex flex-1 items-center justify-center text-center text-[11px] text-[#4A5568] italic">No products attached yet.</span>
              )}
            </div>

              </div>
            )}

            {leadDetailTab === 'ownership' && (
              <div className="flex flex-1 flex-col animate-in fade-in duration-150">
            {/* Salesperson Assignment History Audit */}
            <div className="flex flex-1 flex-col p-3 sm:p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-[#0F5E63]" />
                  <span>Salesperson Ownership Audit History</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {!canReassign && (
                    <span className="text-[10px] font-medium text-[#4A5568] bg-[#E3EFEE] px-2 py-0.5 rounded-full border border-[#DCD8CE]">
                      Managerial Action
                    </span>
                  )}
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setNewSalespersonId(selectedLead.assigned_to || '');
                      setReassignReason('');
                      setFormError(null);
                      setIsReassignModalOpen(true);
                    }}
                  >
                    Reassign Lead
                  </Button>
                </div>
              </div>

              {selectedLead.assignment_history && selectedLead.assignment_history.length > 0 ? (
                <div className="space-y-2">
                  {selectedLead.assignment_history.map((h: any) => (
                    <div
                      key={h.id}
                      className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] flex flex-col gap-1 text-[11px] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-[#14213D]">
                          {h.previous_salesperson_name || 'Unassigned'} → {h.new_salesperson_name}
                        </span>
                        {h.reason && (
                          <span className="text-[#4A5568] block mt-0.5">Reason: {h.reason}</span>
                        )}
                      </div>
                      <div className="text-[#4A5568] font-mono text-[10px] sm:shrink-0 sm:text-right">
                        By {h.changed_by_name || 'Admin'} • {formatDateIN(h.changed_at)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="flex flex-1 items-center justify-center text-center text-[11px] text-[#4A5568] italic">
                  Initial assignment active. No salesperson reassignments recorded.
                </span>
              )}
            </div>

              </div>
            )}

            {leadDetailTab === 'conversation' && (
              <LeadConversation
                leadId={selectedLead.id}
                onPosted={() => setSelectedLead((prev: any) => (prev ? { ...prev, message_count: (prev.message_count || 0) + 1 } : prev))}
              />
            )}

            {leadDetailTab === 'linked' && (
              <RelatedRecords
                className="flex-1 animate-in fade-in duration-150"
                to={{ kind: 'lead', id: selectedLead.id, organisationId: selectedLead.organisation_id }}
                sections={['demos', 'proposals', 'tasks', 'visits']}
                description="Demos and proposals raised from this lead, plus the customer's tasks and field visits."
                addTask={{ title: `Follow up: ${selectedLead.organisation_name || 'lead'}` }}
              />
            )}

            </div>

            {/* Action Bar */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[#DCD8CE] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-full sm:h-8 sm:w-auto"
                onClick={() => {
                  setIsLeadDetailOpen(false);
                  handleOpenCustomer360(selectedLead.organisation_id);
                }}
                leftIcon={<Building className="h-4 w-4" />}
              >
                Open 360° Account View
              </Button>
              <div className="flex items-center gap-2 sm:flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-10 flex-1 sm:h-8 sm:flex-none"
                  onClick={() => {
                    setInteractionForm({
                      ...interactionForm,
                      lead_id: selectedLead.id,
                      organisation_id: selectedLead.organisation_id,
                      contact_id: selectedLead.primary_contact_id || '',
                    });
                    setIsLogInteractionOpen(true);
                  }}
                  leftIcon={<MessageSquare className="h-4 w-4" />}
                >
                  Log Touchpoint
                </Button>
                <Button variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={handleCloseLeadDetail}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: ADVANCE STATUS & LOSS REASON CAPTURE                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        title={isWinStatus(targetStatus) ? `Confirm Win: Mark Lead ${targetStatus.toUpperCase()}` : `Advance Opportunity Status: ${targetStatus.toUpperCase()}`}
        description={
          isWinStatus(targetStatus)
            ? 'Record the order this opportunity was won on. A converted lead is closed and can be reopened only by management.'
            : 'Transitions are verified against Arihant BOS state machine rules.'
        }
        maxWidth="md"
        zIndex={60}
      >
        <form onSubmit={handleStatusChange} noValidate className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
              {formError}
            </div>
          )}

          {targetStatus === 'lost' && (
            <div className="space-y-3 p-3 rounded-xl bg-[#FCE8EC] border border-[#F3C7CF]">
              <span className="font-bold text-[#700F2D] block text-xs">
                Mandatory Win/Loss Analysis Reason:
              </span>
              <Select
                label="Loss Reason *"
                required
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                options={[
                  { value: 'price', label: 'Price / Commercial Disadvantage' },
                  { value: 'competitor', label: 'Competitor Selected (L1 / GeM preference)' },
                  { value: 'no_response', label: 'No Response / Client Silent' },
                  { value: 'not_interested', label: 'Client Not Interested' },
                  { value: 'eligibility', label: 'Technical Eligibility / Spec Mismatch' },
                  { value: 'timing', label: 'Budget Deferred / Timing Cancelled' },
                  { value: 'other', label: 'Other' },
                ]}
              />
              <Textarea
                label="Loss Remarks & Debrief Notes"
                value={lossRemarks}
                onChange={(e) => setLossRemarks(e.target.value)}
                placeholder="Details of competitor bid, price difference, or specification requirements..."
              />
            </div>
          )}

          {isWinStatus(targetStatus) && (
            <div className="space-y-3 p-3 rounded-xl bg-[#E3EFEE] border border-[#0F5E63]/30">
              <span className="font-bold text-[#0F5E63] block text-xs">Win details (purchase / supply order)</span>
              <Input
                label="PO / Supply Order Reference *"
                required
                value={winPoReference}
                onChange={(e) => setWinPoReference(e.target.value)}
                placeholder="e.g. GEMC-511687712345678 or SO/CRPF/2026/114"
                error={statusFieldErrors.po_reference}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Order Value (₹ Lakh)"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={winOrderValue}
                  onChange={(e) => setWinOrderValue(e.target.value)}
                  error={statusFieldErrors.order_value}
                />
                <Input
                  label="Order Date"
                  type="date"
                  max={istToday()}
                  value={winOrderDate}
                  onChange={(e) => setWinOrderDate(e.target.value)}
                  error={statusFieldErrors.order_date}
                />
              </div>
            </div>
          )}

          <p className="text-[#4A5568]">
            Confirm advancing this opportunity from{' '}
            <strong className="text-[#14213D]">{selectedLead?.lead_status?.toUpperCase()}</strong> to{' '}
            <strong className="text-[#0F5E63]">{targetStatus.toUpperCase()}</strong>.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsStatusModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-10 flex-1 sm:h-8 sm:flex-none"
              variant={targetStatus === 'lost' ? 'danger' : isWinStatus(targetStatus) ? 'success' : 'primary'}
              isLoading={actionLoading}
            >
              {isWinStatus(targetStatus) ? 'Confirm Win' : 'Confirm Transition'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: REASSIGN SALESPERSON & LOG REASON                                */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isReassignModalOpen}
        onClose={() => setIsReassignModalOpen(false)}
        title="Reassign Opportunity Ownership"
        description="Transfers the lead to a new salesperson and immutably records the reassignment in audit history."
        maxWidth="md"
        zIndex={60}
      >
        <form onSubmit={handleReassign} className="space-y-4 text-xs">
          {!canReassign && (
            <div className="p-3.5 rounded-xl bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] space-y-2.5">
              <div className="flex items-center gap-2 font-semibold text-xs text-[#7C2D12]">
                <AlertTriangle className="h-4 w-4 text-[#9A3412] shrink-0" />
                <span>Managerial Authorization Required</span>
              </div>
              <p className="text-[11px] text-[#7C2D12] leading-relaxed">
                Under Arihant BOS territorial governance, lead ownership reassignment is restricted to <strong>Regional Manager</strong>, <strong>Management</strong>, or <strong>Admin</strong> roles to ensure account integrity. Your current active role is <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-[#FBEBDD]/70 border border-[#E9C9B4] text-[#7C2D12]">{user?.role}</span>.
              </p>
              <div className="pt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  size="xs"
                  variant="primary"
                  className="h-auto min-h-9 w-full py-1.5 leading-tight sm:h-7 sm:min-h-0 sm:w-auto sm:py-0"
                  isLoading={isSwitchingPersona}
                  onClick={() => handleQuickSwitchRole('regional_manager')}
                >
                  <UserCheck className="h-3.5 w-3.5 mr-1" />
                  Switch to Regional Manager (Vikram Sharma)
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="h-auto min-h-9 w-full py-1.5 leading-tight sm:h-7 sm:min-h-0 sm:w-auto sm:py-0"
                  isLoading={isSwitchingPersona}
                  onClick={() => handleQuickSwitchRole('management')}
                >
                  Switch to Management (Rajiv Arihant)
                </Button>
              </div>
            </div>
          )}

          {formError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
              {formError}
            </div>
          )}

          <Select
            label="New Salesperson *"
            required
            value={newSalespersonId}
            onChange={(e) => setNewSalespersonId(e.target.value)}
            options={[
              { value: '', label: 'Select Salesperson' },
              ...usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
            ]}
          />

          <Input
            label="Reassignment Reason"
            value={reassignReason}
            onChange={(e) => setReassignReason(e.target.value)}
            placeholder="e.g. Territory reorganization / officer transferred to Delhi HQ"
          />

          <div className="flex flex-col gap-2 pt-2 border-t border-[#DCD8CE] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {!canReassign ? (
              <span className="text-[11px] text-[#7C2D12] font-medium">
                Switch role above to enable transfer.
              </span>
            ) : (
              <span className="text-[11px] text-[#4A5568]">
                Authorized as {user?.role.replace('_', ' ')}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsReassignModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="h-10 flex-1 sm:h-8 sm:flex-none"
                isLoading={actionLoading}
                disabled={!canReassign}
              >
                <span className="sm:hidden">Reassign Lead</span>
                <span className="hidden sm:inline">Reassign & Dispatch Event</span>
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5A: DEMO REQUEST & FIELD TEAM COORDINATION                          */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        title="🎯 Schedule Product Demonstration"
        description={`Coordinates field demonstration for ${selectedLead?.organisation_name || 'Client'}. Dispatches auto-reminders and tasks to the assigned demo specialist.`}
        maxWidth="4xl"
        zIndex={60}
      >
        <form onSubmit={handleSubmitDemoTransition} className="text-xs">
          <FormSteps
            onCancel={() => setIsDemoModalOpen(false)}
            banner={
              <div className="space-y-3">
                {formError && (
                  <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
                    {formError}
                  </div>
                )}

                {/* Context Strip: Customer, Location, Requested Date, Salesperson */}
                <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Customer:</span>
                    <span className="font-semibold text-[#14213D] truncate block">
                      🏢 {selectedLead?.organisation_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Location:</span>
                    <span className="font-semibold text-[#14213D] truncate block">
                      📍 {demoForm.location || selectedLead?.city || 'Client Site / Field'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Requested Date:</span>
                    <span className="font-semibold text-[#14213D] block font-mono">
                      📅 {demoForm.requested_date ? formatDateIN(demoForm.requested_date) : 'Pending'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Lead Salesperson:</span>
                    <span className="font-semibold text-[#14213D] truncate block">
                      👤 {usersList.find((u) => u.id === selectedLead?.assigned_to)?.full_name || selectedLead?.assigned_to_user?.full_name || user?.full_name || 'Assigned Officer'}
                    </span>
                  </div>
                </div>
              </div>
            }
            submit={
              <Button type="submit" variant="primary" size="sm" className="h-10 sm:h-8" isLoading={actionLoading}>
                <span className="sm:hidden">Schedule Demo</span>
                <span className="hidden sm:inline">Schedule Demo & Advance Lifecycle</span>
              </Button>
            }
            steps={[
              {
                title: 'Schedule',
                icon: <CalendarDays />,
                description: 'When and where the demonstration will take place.',
                content: (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                type="date"
                label="Demo Date *"
                required
                value={demoForm.requested_date}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, requested_date: e.target.value }))}
              />
              <Input
                type="time"
                label="Scheduled Time"
                value={demoForm.requested_time}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, requested_time: e.target.value }))}
              />
            </div>

            <Input
              label="Location (Demo Venue / Department / Base) *"
              required
              value={demoForm.location}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="e.g. Tactical Range, Ordnance Factory Jodhpur"
              helperText="Auto-populated from account/trip location. Edit if field site differs."
            />
          </div>
                ),
              },
              {
                title: 'Equipment',
                icon: <Layers />,
                description: 'Which product and demo kit to take. Pick one from the live fleet list if you like.',
                content: (
          /* Equipment & Specific Kit Selection (Row 1: Two Selects, Below: Full-width Details) */
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <Select
                label="Equipment / Product for Demo *"
                required
                value={demoForm.product_id}
                onChange={(e) => {
                  const pId = e.target.value;
                  setDemoForm((prev) => ({ ...prev, product_id: pId, equipment_required: kitForProduct(prev.equipment_required, pId, demoEquipmentList || []) }));
                }}
                options={[
                  { value: '', label: 'Select Product / Equipment' },
                  ...availableFirst(productsList.map((p) => {
                    const pUnits = (demoEquipmentList || []).filter((e) => e.product_id === p.id);
                    const ready = pUnits.filter((e) => e.availability_status === 'available').length;
                    return { value: p.id, label: `${p.name}`, ...fleetHint(ready, pUnits.length) };
                  })),
                ]}
              />

              <Select
                label="Specific Demo Kit / Serial / Accessories Needed"
                value={
                  leadRegisteredEquipmentOptions.some((o) => o.value === demoForm.equipment_required)
                    ? demoForm.equipment_required
                    : demoForm.equipment_required
                    ? 'custom'
                    : ''
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setDemoForm((prev) => ({ ...prev, equipment_required: 'custom' }));
                  } else {
                    const matchedEquip = (demoEquipmentList || []).find(
                      (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === val
                        || item.serial_no === val
                        || item.id === val
                    );
                    setDemoForm((prev) => ({
                      ...prev,
                      equipment_required: val,
                      product_id: matchedEquip?.product_id || prev.product_id,
                    }));
                  }
                }}
                options={leadRegisteredEquipmentOptions}
              />
            </div>

            {/* Live Product Fleet Availability & Status HUD - Full Width */}
            {activeLeadDemoFleet && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                      Live Product Fleet Availability:
                    </span>
                    <span className="font-bold text-xs text-[#14213D]">
                      {productsList.find((p) => p.id === demoForm.product_id)?.name || 'Selected Equipment'}
                    </span>
                  </div>
                  {activeLeadDemoFleet.availableCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0F5E63] animate-pulse" />
                      AVAILABLE ({activeLeadDemoFleet.availableCount} Ready)
                    </span>
                  ) : activeLeadDemoFleet.total > 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FBEBDD] text-[#7C2D12] border border-[#E9C9B4]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9A3412]" />
                      RESERVED ({activeLeadDemoFleet.total} in Fleet)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#ECE9E2] text-[#14213D] border border-[#C9C4B8]">
                      No Fleet Unit
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-[#ECE9E2]">
                  <span className="text-[#4A5568]">
                    {activeLeadDemoFleet.availableCount > 0
                      ? `Stationed at: ${activeLeadDemoFleet.locations.join(', ')} Depot`
                      : activeLeadDemoFleet.total > 0
                      ? `All units currently deployed or reserved.`
                      : `Custom requisition required.`}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]">
                    <span>Fleet: <b>{activeLeadDemoFleet.total}</b></span>
                    <span className="text-[#0B4A4E]">Ready: <b>{activeLeadDemoFleet.availableCount}</b></span>
                    <span className="text-[#7C2D12]">In-Trial: <b>{activeLeadDemoFleet.reservedCount}</b></span>
                    {activeLeadDemoFleet.maintenanceCount > 0 && (
                      <span className="text-[#700F2D]">Maint: <b>{activeLeadDemoFleet.maintenanceCount}</b></span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Specific Demo Kit / Serial / Accessories Detail Card - FULL WIDTH, NOT SPLIT IN HALF */}
            {selectedLeadEquipUnit && (
              <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2.5 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1 pb-2 border-b border-[#ECE9E2]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[#14213D]">{selectedLeadEquipUnit.model}</span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-white border border-[#DCD8CE] text-[#14213D] font-bold">
                      S/N: {selectedLeadEquipUnit.serial_no}
                    </span>
                    <span className="text-xs text-[#4A5568]">📍 {selectedLeadEquipUnit.current_location} Depot</span>
                  </div>
                  <div>
                    {selectedLeadEquipUnit.availability_status === 'available' ? (
                      <Badge variant="success">● READY & AVAILABLE</Badge>
                    ) : selectedLeadEquipUnit.availability_status === 'reserved' || selectedLeadEquipUnit.availability_status === 'in_use' ? (
                      <Badge variant="warning">
                        ○ RESERVED {selectedLeadEquipUnit.reserved_until ? `UNTIL ${formatDateIN(selectedLeadEquipUnit.reserved_until)}` : ''}
                      </Badge>
                    ) : (
                      <Badge variant="danger">▲ MAINTENANCE: {selectedLeadEquipUnit.condition || 'Service Needed'}</Badge>
                    )}
                  </div>
                </div>

                {/* 4-Column Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Operational Condition:</span>
                    <span className="font-semibold text-[#14213D]">{selectedLeadEquipUnit.condition || 'Operational'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Fleet Custodian:</span>
                    <span className="font-semibold text-[#14213D]">{selectedLeadEquipUnit.responsible_person_name || 'Demo Team Coordinator'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Depot Base:</span>
                    <span className="font-semibold text-[#14213D]">{selectedLeadEquipUnit.current_location} Depot</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Unit Serial:</span>
                    <span className="font-mono font-bold text-[#14213D]">{selectedLeadEquipUnit.serial_no}</span>
                  </div>
                </div>

                {/* Warn when the chosen unit is busy or under maintenance */}
                {selectedLeadEquipUnit.availability_status === 'available' ? null : selectedLeadEquipUnit.availability_status === 'reserved' || selectedLeadEquipUnit.availability_status === 'in_use' ? (
                  <div className="p-2 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] text-[11px] flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-[#7C2D12] shrink-0" />
                    <span>This serial is currently scheduled for another trial. Submitting will flag a scheduling overlap notice to the Demo Coordinator.</span>
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D] text-[11px] flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-[#700F2D] shrink-0" />
                    <span>Unit marked under maintenance ({selectedLeadEquipUnit.condition}). You may select another serial or custom kit.</span>
                  </div>
                )}
              </div>
            )}

            <Input
              label="Additional Custom Accessories / Test Samples Needed (Optional)"
              value={demoForm.custom_accessories}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, custom_accessories: e.target.value }))}
              placeholder={
                demoForm.equipment_required === 'custom'
                  ? "Enter custom model name, serial number and accessories..."
                  : "e.g. Test calibration pieces, knife sample, spare batteries, vehicle gate pass"
              }
            />
          </div>
                ),
              },
              {
                title: 'Specialist',
                icon: <UserCheck />,
                description: 'Who from the demo team will run it. Availability is shown for the chosen date.',
                content: (
          <div className="space-y-3">
          {/* Assigned Demo Team Specialist Allocation & Live Availability */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <label className="text-xs font-semibold text-[#14213D]">
                Assigned Demo Team Specialist *
              </label>
              {isLoadingLeadTeamAvailability ? (
                <span className="text-[10px] text-[#0F5E63] flex items-center gap-1">
                  <Spinner size="xs" /> Checking Team Availability...
                </span>
              ) : (
                <span className="text-[10px] text-[#4A5568]">
                  Availability for {formatDateIN(demoForm.requested_date)}
                </span>
              )}
            </div>

            <Select
              value={demoForm.assigned_to}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
              options={[
                { value: '', label: '-- Select Demo Team Member / Specialist --' },
                ...leadDemoTeamOptions,
              ]}
            />

            {/* Selected Demo Team Member Live Availability & Notification Card */}
            {selectedLeadDemoMember && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5 border-b border-[#ECE9E2]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-xs text-[#14213D]">{selectedLeadDemoMember.full_name}</span>
                    <Badge variant="cyber" className="text-[10px] py-0">
                      {selectedLeadDemoMember.role === 'demo_team' ? 'DEMO SPECIALIST' : selectedLeadDemoMember.role.replace(/_/g, ' ').toUpperCase()}
                    </Badge>
                    {selectedLeadDemoMember.phone && (
                      <span className="text-[10px] text-[#4A5568]">📞 {selectedLeadDemoMember.phone}</span>
                    )}
                  </div>
                  <div>
                    {selectedLeadDemoMember.is_available ?? true ? (
                      <Badge variant="success">● AVAILABLE ON {formatDateIN(demoForm.requested_date)}</Badge>
                    ) : (
                      <Badge variant="warning">
                        ▲ BUSY ON {selectedLeadDemoMember.active_demo?.demo_no || 'ANOTHER TRIAL'}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-[#4A5568]">
                  {selectedLeadDemoMember.is_available ?? true ? (
                    <div className="flex items-center gap-1.5 text-[#0B4A4E]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                      <span>Specialist has zero trial schedule conflicts on this date and is cleared for field demonstration.</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[#7C2D12]">
                      <AlertTriangle className="h-3.5 w-3.5 text-[#9A3412] shrink-0" />
                      <span>Specialist has active trial booking for <strong>{selectedLeadDemoMember.active_demo?.organisation_name || 'Client'}</strong>. Booking will flag a schedule overlap notice.</span>
                    </div>
                  )}
                </div>

                {/* Auto-Notification Callout */}
                <div className="p-2 rounded-lg bg-[#E3EFEE]/70 border border-[#0F5E63]/20 text-[#0F5E63] text-[11px] flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
                  <span>
                    <strong>Auto-Notification & Calendar Sync:</strong> Submitting this demo will instantly alert <strong>{selectedLeadDemoMember.full_name}</strong> and list this trial under their <strong>"My Demos"</strong> dashboard.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Auto Remind Card */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E3EFEE]/50 border border-[#0F5E63]/30 cursor-pointer">
            <input
              type="checkbox"
              checked={demoForm.auto_remind}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, auto_remind: e.target.checked }))}
              className="mt-0.5 rounded text-[#0F5E63] focus:ring-[#0F5E63]"
            />
            <div>
              <span className="text-xs font-bold text-[#0F5E63] block">
                Auto-remind assigned member & register task on their dashboard
              </span>
              <span className="text-[11px] text-[#4A5568]">
                Dispatches an instant notification to their notification center and assigns a high-priority action task on their dashboard.
              </span>
            </div>
          </label>
          </div>
                ),
              },
              {
                title: 'Objective',
                icon: <Target />,
                description: 'Why the demo is happening, who will attend, and anything the field team must know.',
                content: (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Purpose / Demonstration Objective *"
                required
                value={demoForm.purpose}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, purpose: e.target.value }))}
                placeholder="e.g. Live range trials & ballistic validation"
              />
              <Input
                label="Expected Audience / Evaluation Committee *"
                required
                value={demoForm.expected_audience}
                onChange={(e) => setDemoForm((prev) => ({ ...prev, expected_audience: e.target.value }))}
                placeholder="e.g. Technical Evaluation Committee & Board Officers"
              />
            </div>

            <Textarea
              label="Special Requirements & Field Deployment Instructions"
              value={demoForm.reminder_notes}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, reminder_notes: e.target.value }))}
              rows={2}
              placeholder="e.g. Gate pass required at security entry. 230V power needed. Carry identity documentation."
            />
          </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5B: COMMERCIAL & TECHNICAL PROPOSAL DRAFTING                        */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isProposalModalOpen}
        onClose={() => setIsProposalModalOpen(false)}
        title="📄 Prepare Commercial & Technical Proposal"
        description={`Transitions opportunity to PROPOSAL, notifies the Tender Team, and delegates proposal drafting to the responsible specialist.`}
        maxWidth="2xl"
        zIndex={60}
      >
        <form onSubmit={handleSubmitProposalTransition} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
              {formError}
            </div>
          )}

          {/* Account context strip */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Opportunity Account</span>
              <span className="text-xs font-bold text-[#14213D]">{selectedLead?.organisation_name}</span>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Current Stage</span>
              <span className="text-xs font-bold text-[#0F5E63]">{selectedLead?.lead_status?.toUpperCase()}</span>
            </div>
          </div>

          <FormSection
            title="Proposal"
            icon={<FileText />}
            description="The RFP being answered, its value and what the proposal covers."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Proposal Reference / RFP No. *"
                required
                value={proposalForm.reference}
                onChange={(e) => setProposalForm((prev) => ({ ...prev, reference: e.target.value }))}
                placeholder="e.g. RFP-ORD-2026-0042"
              />
              <Input
                type="number"
                label="Estimated Deal Value (₹ Lakh)"
                value={proposalForm.deal_value}
                onChange={(e) => setProposalForm((prev) => ({ ...prev, deal_value: e.target.value }))}
                placeholder="e.g. 78.00"
              />
            </div>

            <Textarea
              label="Proposal Scope, Technical Specs & Clauses"
              value={proposalForm.remarks}
              onChange={(e) => setProposalForm((prev) => ({ ...prev, remarks: e.target.value }))}
              rows={3}
              placeholder="e.g. Supply of tactical communication units with 3-year OEM warranty, on-site commissioning, and compliance certification."
            />
          </FormSection>

          <FormSection
            title="Deadline & owner"
            icon={<UserCheck />}
            description="When it must be submitted and who is drafting it."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                type="date"
                label="Submission Deadline Date *"
                required
                value={proposalForm.required_date}
                onChange={(e) => setProposalForm((prev) => ({ ...prev, required_date: e.target.value }))}
              />
              <Select
                label="Responsible Bid / Proposal Specialist *"
                required
                value={proposalForm.responsible_person_id}
                onChange={(e) => setProposalForm((prev) => ({ ...prev, responsible_person_id: e.target.value }))}
                options={[
                  { value: '', label: 'Select Specialist' },
                  ...usersList.map((u) => ({
                    value: u.id,
                    label: `${u.full_name} (${u.role.replace('_', ' ').toUpperCase()})`,
                  })),
                ]}
              />
            </div>

            {/* Auto Remind Card */}
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E3EFEE]/50 border border-[#0F5E63]/30 cursor-pointer">
              <input
                type="checkbox"
                checked={proposalForm.auto_remind}
                onChange={(e) => setProposalForm((prev) => ({ ...prev, auto_remind: e.target.checked }))}
                className="mt-0.5 rounded text-[#0F5E63] focus:ring-[#0F5E63]"
              />
              <div>
                <span className="text-xs font-bold text-[#0F5E63] block">
                  Auto-remind proposal specialist & register deadline task on their dashboard
                </span>
                <span className="text-[11px] text-[#4A5568]">
                  Dispatches a notification to the assigned specialist and creates a high-priority deadline task in their accountability queue.
                </span>
              </div>
            </label>
          </FormSection>

          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex items-center gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:static sm:z-auto sm:mx-0 sm:mb-0 sm:flex-wrap sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-2">
            <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsProposalModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" isLoading={actionLoading}>
              <span className="sm:hidden">Generate Proposal</span>
              <span className="hidden sm:inline">Generate Proposal Task & Advance Lifecycle</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5C: TENDER DISCUSSION & TOUCHPOINT SCHEDULING ("WHEN")               */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDiscussionModalOpen}
        onClose={() => setIsDiscussionModalOpen(false)}
        title={discussionStage === 'tender_discussion' ? "🤝 Schedule Tender Discussion" : "📅 Schedule Strategic Follow-Up"}
        description="Coordinates meeting timing, sets calendar touchpoint, and auto-reminds the designated team member."
        maxWidth="2xl"
        zIndex={60}
      >
        <form onSubmit={handleSubmitDiscussionTransition} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
              {formError}
            </div>
          )}

          {/* Account context strip */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Opportunity Account</span>
              <span className="text-xs font-bold text-[#14213D]">{selectedLead?.organisation_name}</span>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Touchpoint Type</span>
              <span className="text-xs font-bold text-[#0F5E63]">{discussionStage === 'tender_discussion' ? 'TENDER DISCUSSION' : 'FOLLOW UP'}</span>
            </div>
          </div>

          <FormSection
            title="When & where"
            icon={<CalendarDays />}
            description="Meeting time, format and where everyone joins."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                type="date"
                label="Discussion Date (When) *"
                required
                value={discussionForm.discussion_date}
                onChange={(e) => setDiscussionForm((prev) => ({ ...prev, discussion_date: e.target.value }))}
              />
              <Input
                type="time"
                label="Discussion Time (When) *"
                required
                value={discussionForm.discussion_time}
                onChange={(e) => setDiscussionForm((prev) => ({ ...prev, discussion_time: e.target.value }))}
              />
              <Select
                label="Meeting Format / Mode *"
                required
                value={discussionForm.mode}
                onChange={(e) => setDiscussionForm((prev) => ({ ...prev, mode: e.target.value }))}
                options={[
                  { value: 'in_person', label: 'In-Person Executive Meeting' },
                  { value: 'tender_committee', label: 'Tender Committee Session' },
                  { value: 'video_call', label: 'Video Conference (VC / Teams / Meet)' },
                  { value: 'telephonic', label: 'Telephonic Briefing' },
                  { value: 'site_visit', label: 'Site / Facility Inspection' },
                ]}
              />
              {(() => {
                const isLink = discussionForm.mode === 'video_call';
                const isPhone = discussionForm.mode === 'telephonic';
                return (
                  <Input
                    label={isLink ? 'Meeting Link *' : isPhone ? 'Dial-in Number / Bridge *' : 'Meeting Venue *'}
                    required
                    type={isLink ? 'url' : 'text'}
                    value={discussionForm.venue}
                    onChange={(e) => setDiscussionForm((prev) => ({ ...prev, venue: e.target.value }))}
                    placeholder={
                      isLink
                        ? 'e.g. https://meet.google.com/xyz'
                        : isPhone
                        ? 'e.g. +91 98765 43210 or conference bridge ID'
                        : 'e.g. Conference Room B, HQ Jodhpur'
                    }
                  />
                );
              })()}
            </div>
          </FormSection>

          <FormSection
            title="Owner & agenda"
            icon={<UserCheck />}
            description="Who leads the discussion and what will be covered."
          >
            <Select
              label="Assigned Discussion Lead / Member *"
              required
              value={discussionForm.assigned_to}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
              options={[
                { value: '', label: 'Select Team Member' },
                ...usersList.map((u) => ({
                  value: u.id,
                  label: `${u.full_name} (${u.role.replace('_', ' ').toUpperCase()})`,
                })),
              ]}
            />

            <Textarea
              label="Meeting Agenda & Tender Discussion Topics"
              value={discussionForm.agenda}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, agenda: e.target.value }))}
              rows={3}
              placeholder="e.g. Review specification compliance, tender clauses, earnest money deposit terms, and delivery milestones."
            />

            {/* Auto Remind Card */}
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E3EFEE]/50 border border-[#0F5E63]/30 cursor-pointer">
              <input
                type="checkbox"
                checked={discussionForm.auto_remind}
                onChange={(e) => setDiscussionForm((prev) => ({ ...prev, auto_remind: e.target.checked }))}
                className="mt-0.5 rounded text-[#0F5E63] focus:ring-[#0F5E63]"
              />
              <div>
                <span className="text-xs font-bold text-[#0F5E63] block">
                  Auto-remind team member & register calendar task on their side
                </span>
                <span className="text-[11px] text-[#4A5568]">
                  Sends an instant reminder and logs an urgent meeting task on the designated team member's personal dashboard.
                </span>
              </div>
            </label>
          </FormSection>

          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex items-center gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:static sm:z-auto sm:mx-0 sm:mb-0 sm:flex-wrap sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-2">
            <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsDiscussionModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" isLoading={actionLoading}>
              <span className="sm:hidden">Schedule Touchpoint</span>
              <span className="hidden sm:inline">Schedule Touchpoint & Advance Lifecycle</span>
            </Button>
          </div>
        </form>
      </Modal>


      {/* ========================================================================= */}
      {/* MODAL 6: CUSTOMER 360° ACCOUNT INTELLIGENCE DRAWER                        */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCustomer360Open}
        onClose={() => setIsCustomer360Open(false)}
        title={selectedCustomer?.name || 'Customer 360° Account View'}
        description={`${selectedCustomer?.city || 'Delhi'}, ${selectedCustomer?.state || 'Delhi'} • Sector: ${selectedCustomer?.sector || 'Defence'} • Zone: ${selectedCustomer?.zone_name || 'North'}`}
        maxWidth="4xl"
      >
        {selectedCustomer && (
          <div className="space-y-5 text-xs">
            {/* Account Quick Intelligence Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Account Sector</span>
                <span className="font-semibold text-[#14213D] mt-0.5 block">
                  {selectedCustomer.sector || 'Government / PSU'}
                </span>
                {selectedCustomer.department && (
                  <span className="text-[10px] text-[#4A5568] block truncate">{selectedCustomer.department}</span>
                )}
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Territory & Zone</span>
                <span className="font-semibold text-[#14213D] mt-0.5 block">
                  {selectedCustomer.zone_name || 'North'} ({selectedCustomer.region_name || selectedCustomer.city || 'HQ'})
                </span>
                <span className="text-[10px] text-[#4A5568] block">
                  {selectedCustomer.city || '—'}, {selectedCustomer.state || '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Current Sales Lead</span>
                <span className="font-bold text-[#0F5E63] mt-0.5 block">
                  {customerManagementSummary?.current_salesperson || selectedCustomer.current_salesperson || 'Assigned Rep'}
                </span>
                <span className="text-[10px] text-[#0F5E63] font-semibold block">Active Territory Owner</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Pipeline Volume</span>
                <span className="font-extrabold text-[#14213D] mt-0.5 block">
                  {customerLeads.length} Leads • {customerTimeline.length} Touchpoints
                </span>
                <span className="text-[10px] text-[#4A5568] block">
                  {customerContacts.length} Registered Contacts
                </span>
              </div>
            </div>

            {/* Sub-Navigation Tabs: one sliding row on phones */}
            <ScrollStrip role="tablist" aria-label="Customer 360 sections" activeKey={c360Tab} wrapperClassName="border-b border-[#DCD8CE]" className="items-center gap-1.5 pb-2">
              <button
                type="button"
                role="tab"
                aria-selected={c360Tab === 'management'}
                onClick={() => setC360Tab('management')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'management'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#FBFAF7] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Executive Management HUD</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={c360Tab === 'timeline'}
                onClick={() => setC360Tab('timeline')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'timeline'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#FBFAF7] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span>Chronological Timeline</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${c360Tab === 'timeline' ? 'bg-white/20 text-white' : 'bg-[#DCD8CE] text-[#14213D]'}`}>
                  {customerTimeline.length}
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={c360Tab === 'contacts'}
                onClick={() => setC360Tab('contacts')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'contacts'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#FBFAF7] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Contacts Roster</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${c360Tab === 'contacts' ? 'bg-white/20 text-white' : 'bg-[#DCD8CE] text-[#14213D]'}`}>
                  {customerContacts.length}
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={c360Tab === 'deals'}
                onClick={() => setC360Tab('deals')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'deals'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#FBFAF7] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <Briefcase className="h-3.5 w-3.5" />
                <span>Opportunities</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${c360Tab === 'deals' ? 'bg-white/20 text-white' : 'bg-[#DCD8CE] text-[#14213D]'}`}>
                  {customerLeads.length}
                </span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={c360Tab === 'linked'}
                onClick={() => setC360Tab('linked')}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'linked'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#FBFAF7] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Linked records</span>
              </button>
            </ScrollStrip>

            {/* TAB 1: EXECUTIVE MANAGEMENT INTELLIGENCE HUD */}
            {c360Tab === 'management' && (
              <div className="space-y-4">
                {/* 1. Touchpoint Horizons: First vs Latest Interaction */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* First Interaction Card */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                        <span>First Interaction (Prospect Onboarding)</span>
                      </span>
                      {customerManagementSummary?.first_interaction?.occurred_on && (
                        <Badge variant="info" size="sm" className="font-mono text-[10px]">
                          {formatDateIN(customerManagementSummary.first_interaction.occurred_on)}
                        </Badge>
                      )}
                    </div>
                    {customerManagementSummary?.first_interaction ? (
                      <div className="space-y-1.5 pt-1 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge variant="outline" size="sm" className="uppercase font-bold text-[9px]">
                            {customerManagementSummary.first_interaction.type}
                          </Badge>
                          <span className="text-[#4A5568]">
                            Conducted by: <strong className="text-[#14213D]">{customerManagementSummary.first_interaction.employee_name || 'Executive'}</strong>
                          </span>
                        </div>
                        {customerManagementSummary.first_interaction.contact_name && (
                          <div className="text-[#4A5568]">
                            Client Contact: <span className="font-medium text-[#14213D]">{customerManagementSummary.first_interaction.contact_name}</span>
                          </div>
                        )}
                        <p className="text-[#14213D] italic bg-[#FBFAF7] p-2 rounded-lg border border-[#DCD8CE]">
                          "{customerManagementSummary.first_interaction.remarks || customerManagementSummary.first_interaction.notes || 'Initial prospect connection established.'}"
                        </p>
                        {customerManagementSummary.first_interaction.outcome && (
                          <div className="text-[10px] text-[#0B4A4E] font-semibold">
                            Outcome: {customerManagementSummary.first_interaction.outcome}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-[#4A5568] italic">No first interaction on record.</div>
                    )}
                  </div>

                  {/* Latest Interaction Card */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                        <span>Latest Interaction (Recent Touchpoint)</span>
                      </span>
                      {customerManagementSummary?.latest_interaction?.occurred_on && (
                        <Badge variant="success" size="sm" className="font-mono text-[10px]">
                          {formatDateIN(customerManagementSummary.latest_interaction.occurred_on)}
                        </Badge>
                      )}
                    </div>
                    {customerManagementSummary?.latest_interaction ? (
                      <div className="space-y-1.5 pt-1 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge variant="outline" size="sm" className="uppercase font-bold text-[9px]">
                            {customerManagementSummary.latest_interaction.type}
                          </Badge>
                          <span className="text-[#4A5568]">
                            Conducted by: <strong className="text-[#14213D]">{customerManagementSummary.latest_interaction.employee_name || 'Executive'}</strong>
                          </span>
                        </div>
                        {customerManagementSummary.latest_interaction.contact_name && (
                          <div className="text-[#4A5568]">
                            Client Contact: <span className="font-medium text-[#14213D]">{customerManagementSummary.latest_interaction.contact_name}</span>
                          </div>
                        )}
                        <p className="text-[#14213D] italic bg-[#FBFAF7] p-2 rounded-lg border border-[#DCD8CE]">
                          "{customerManagementSummary.latest_interaction.remarks || customerManagementSummary.latest_interaction.notes || 'Interaction discussion recorded.'}"
                        </p>
                        {customerManagementSummary.latest_interaction.outcome && (
                          <div className="text-[10px] text-[#0B4A4E] font-semibold">
                            Outcome: {customerManagementSummary.latest_interaction.outcome}
                          </div>
                        )}
                        {customerManagementSummary.latest_interaction.next_action && (
                          <div className="text-[10px] text-[#0F5E63] font-semibold flex items-center gap-1">
                            <ArrowRight className="h-3 w-3" />
                            <span>Next Action: {customerManagementSummary.latest_interaction.next_action}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-[#4A5568] italic">No touchpoints recorded yet.</div>
                    )}
                  </div>
                </div>

                {/* 2. Salesperson Continuity & Product Interests */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Salesperson Continuity Audit */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-[#0F5E63]" />
                        <span>Salesperson Ownership Continuity</span>
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#E3EFEE]/50 border border-[#DCD8CE] flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Current Active Salesperson</span>
                        <span className="font-bold text-[#0F5E63] text-xs">
                          {customerManagementSummary?.current_salesperson || 'Unassigned'}
                        </span>
                      </div>
                      <Badge variant="info" size="sm">CURRENT OWNER</Badge>
                    </div>

                    {customerManagementSummary?.previous_salespersons && customerManagementSummary.previous_salespersons.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Previous Salespersons &amp; Reassignments:</span>
                        {customerManagementSummary.previous_salespersons.map((h: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between gap-2 text-[10px]"
                          >
                            <div className="min-w-0">
                              {h.source ? (
                                <span className="font-semibold text-[#14213D]">
                                  {h.salesperson_name || 'Former team member'}
                                  <span className="font-normal text-[#4A5568]"> · {h.source === 'lead' ? 'owned a lead' : 'logged interactions'}</span>
                                </span>
                              ) : (
                                <span className="font-semibold text-[#14213D]">
                                  {h.previous_salesperson_name || 'Unassigned'} → {h.new_salesperson_name}
                                </span>
                              )}
                              {h.reason && <span className="text-[#4A5568] block">Reason: {h.reason}</span>}
                            </div>
                            <span className="shrink-0 text-[#4A5568] font-mono text-[9px]">
                              {formatDateIN(h.changed_at)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-[#4A5568] italic pt-1">
                        Initial salesperson assignment active. No previous transfers on record.
                      </div>
                    )}
                  </div>

                  {/* Product Interest Landscape */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                        <span>Product Interest Landscape</span>
                      </span>
                      <Badge variant="outline" size="sm">
                        {customerManagementSummary?.product_interests?.length || 0} Products
                      </Badge>
                    </div>

                    {customerManagementSummary?.product_interests && customerManagementSummary.product_interests.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {customerManagementSummary.product_interests.map((pName: string, idx: number) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-[11px] font-semibold text-[#0F5E63]"
                          >
                            <Check className="h-3 w-3 text-[#0F5E63]" />
                            <span>{pName}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-[#4A5568] italic pt-2">
                        No product interests linked to opportunities yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Previous Meetings & Field Demonstrations */}
                <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                      <span>Previous In-Person Meetings & Demonstrations (Face-to-Face Field Touchpoints)</span>
                    </span>
                    <Badge variant="info" size="sm">
                      {customerManagementSummary?.previous_meetings?.length || 0} Meetings Held
                    </Badge>
                  </div>

                  {customerManagementSummary?.previous_meetings && customerManagementSummary.previous_meetings.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {customerManagementSummary.previous_meetings.map((m: any) => (
                        <div
                          key={m.id}
                          className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-1 text-[11px]"
                        >
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" size="sm" className="uppercase font-bold text-[9px]">
                              {m.type === 'physical_visit' ? 'Face-to-Face Visit' : m.type === 'video_conference' ? 'Video Conference' : m.type === 'demo' ? 'Demonstration' : m.type}
                            </Badge>
                            <span className="text-[#4A5568] font-mono text-[10px]">
                              {formatDateIN(m.occurred_on || m.interaction_date)}
                            </span>
                          </div>
                          <div className="text-[#4A5568] text-[10px]">
                            Conducted by: <strong className="text-[#14213D]">{m.employee_name || 'Executive'}</strong>
                            {m.contact_name && <span> • Contact: <strong className="text-[#14213D]">{m.contact_name}</strong></span>}
                          </div>
                          <p className="text-[#14213D] line-clamp-2">
                            {m.remarks || m.notes || 'Meeting concluded.'}
                          </p>
                          {m.outcome && (
                            <div className="text-[10px] text-[#0B4A4E] font-semibold">
                              Outcome: {m.outcome}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#4A5568] italic p-2 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE] text-center">
                      No physical visits or product demonstrations recorded yet.
                    </div>
                  )}
                </div>

                {/* 4. Follow-Up History & Compliance */}
                <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-[#0F5E63]" />
                      <span>Follow-up History & Compliance Status</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-center">
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Total Scheduled</span>
                      <span className="text-sm font-extrabold text-[#14213D] mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.total || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-center">
                      <span className="text-[10px] text-[#7C2D12] uppercase font-bold block">Pending</span>
                      <span className="text-sm font-extrabold text-[#7C2D12] mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.pending || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#E3EFEE] border border-[#D0E5E3] text-center">
                      <span className="text-[10px] text-[#0B4A4E] uppercase font-bold block">Completed</span>
                      <span className="text-sm font-extrabold text-[#0B4A4E] mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.completed || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-center">
                      <span className="text-[10px] text-[#700F2D] uppercase font-bold block">Overdue</span>
                      <span className="text-sm font-extrabold text-[#700F2D] mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.overdue || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5. Current Opportunity Status */}
                <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                      <span>Current Opportunity Status Across Account</span>
                    </span>
                    <Badge variant="info" size="sm">
                      {customerManagementSummary?.current_opportunity_status?.length || 0} Active Leads
                    </Badge>
                  </div>

                  {customerManagementSummary?.current_opportunity_status && customerManagementSummary.current_opportunity_status.length > 0 ? (
                    <div className="divide-y divide-[#DCD8CE] border border-[#DCD8CE] rounded-lg overflow-hidden">
                      {customerManagementSummary.current_opportunity_status.map((opp: any) => (
                        <div key={opp.id} className="p-2.5 bg-white flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between text-[11px] hover:bg-[#FBFAF7]">
                          <div>
                            <div className="font-bold text-[#14213D] flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>{opp.product_name}</span>
                              {opp.lead_type === 're_approached' ? (
                                <Badge variant="warning" size="sm" className="font-bold text-[9px]">
                                  RE-APPROACHED
                                </Badge>
                              ) : (
                                <Badge variant="info" size="sm" className="font-bold text-[9px]">
                                  FRESH
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-[#4A5568] mt-0.5">
                              Assigned: <strong className="text-[#14213D]">{opp.assigned_salesperson || 'Unassigned'}</strong>
                              {opp.next_followup_date && (
                                <span> • Next Due: <strong className="text-[#0F5E63]">{formatDateIN(opp.next_followup_date)}</strong></span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="font-mono font-bold text-[#14213D]">
                              {formatLakh(opp.value_lakh || 0)}
                            </span>
                            {getStatusBadge(opp.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#4A5568] italic p-3 text-center bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]">
                      No opportunities registered for this organization.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: CHRONOLOGICAL CUSTOMER INTERACTION TIMELINE */}
            {c360Tab === 'timeline' && (
              <div className="p-3 sm:p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                      <History className="h-4 w-4 text-[#0F5E63] shrink-0" />
                      <span>Chronological Customer Interaction Timeline</span>
                    </span>
                    <span className="text-[10px] text-[#4A5568] block mt-0.5">
                      Tracks all calls, visits, demos, WhatsApp, emails, tenders, proposals, and service discussions in one continuous customer record.
                    </span>
                  </div>
                  <Button
                    size="xs"
                    variant="primary"
                    className="h-10 w-full shrink-0 text-xs sm:h-7 sm:w-auto sm:text-[11px]"
                    onClick={() => {
                      setInteractionForm({
                        ...interactionForm,
                        lead_id: customerLeads[0]?.id || '',
                        organisation_id: selectedCustomer.id,
                        contact_id: customerContacts[0]?.id || '',
                      });
                      setIsLogInteractionOpen(true);
                    }}
                    leftIcon={<Plus className="h-3 w-3" />}
                  >
                    Log Discussion
                  </Button>
                </div>

                {customerTimelineLoading ? (
                  <div className="p-8 text-center text-[#4A5568]">Loading chronological customer history...</div>
                ) : customerTimeline.length === 0 ? (
                  <div className="p-5 sm:p-8 rounded-lg bg-white border border-[#DCD8CE] text-center text-[#4A5568] space-y-2">
                    <p>No interactions recorded yet for this organisation.</p>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setInteractionForm({
                          ...interactionForm,
                          lead_id: customerLeads[0]?.id || '',
                          organisation_id: selectedCustomer.id,
                          contact_id: customerContacts[0]?.id || '',
                        });
                        setIsLogInteractionOpen(true);
                      }}
                      leftIcon={<Plus className="h-3 w-3" />}
                    >
                      Record First Touchpoint
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customerTimeline.map((it) => {
                      const channelIcons: Record<string, string> = {
                        call: '📞',
                        physical_visit: '🏢',
                        video_conference: '🎥',
                        demo: '🎯',
                        proposal: '📄',
                        whatsapp: '💬',
                        email: '✉️',
                        tender_discussion: '⚖️',
                        follow_up: '⏰',
                        service_discussion: '🔧',
                      };
                      const icon = channelIcons[it.type] || '💬';

                      return (
                        <div
                          key={it.id}
                          className="p-3 sm:p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs hover:border-[#0F5E63] transition-colors"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base">{icon}</span>
                              <Badge variant="outline" size="sm" className="uppercase font-bold text-[10px]">
                                {it.type?.replace('_', ' ')}
                              </Badge>
                              <span className="text-[11px] text-[#4A5568] font-medium font-mono">
                                {formatDateIN(it.occurred_on || it.interaction_date || it.created_at)}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#4A5568] sm:text-right">
                              Employee: <strong className="text-[#14213D]">{it.employee_name || it.created_by_name || 'Executive'}</strong>
                            </div>
                          </div>

                          {it.contact_name && (
                            <div className="text-[10px] text-[#4A5568] flex flex-wrap items-center gap-1">
                              <User className="h-3 w-3 text-[#4A5568] shrink-0" />
                              <span>Contact Person: <strong className="text-[#14213D]">{it.contact_name}</strong></span>
                              {it.contact_mobile && <span className="font-mono">({it.contact_mobile})</span>}
                            </div>
                          )}

                          <p className="text-[#14213D] text-xs leading-relaxed font-sans bg-[#FBFAF7] p-2.5 rounded-lg border border-[#DCD8CE]">
                            {it.remarks || it.notes || 'No discussion notes provided.'}
                          </p>

                          {it.outcome && (
                            <div className="text-[11px] text-[#0B4A4E] bg-[#E3EFEE] px-2.5 py-1 rounded-md border border-[#D0E5E3] font-medium">
                              Outcome: {it.outcome}
                            </div>
                          )}

                          {(it.next_action || it.followup_date || it.next_action_date) && (
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#0F5E63] font-medium pt-0.5">
                              {it.next_action && (
                                <div className="flex items-center gap-1.5">
                                  <ArrowRight className="h-3.5 w-3.5" />
                                  <span>Next Action: {it.next_action}</span>
                                </div>
                              )}
                              {(it.followup_date || it.next_action_date) && (
                                <div className="flex items-center gap-1 text-[#4A5568] font-mono text-[10px]">
                                  <Clock className="h-3 w-3" />
                                  <span>Target Due: {formatDateIN(it.followup_date || it.next_action_date)}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {it.attachments && it.attachments.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-1.5">
                              {it.attachments.map((att: any) => (
                                <a
                                  key={att.id}
                                  href={att.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FBFAF7] border border-[#DCD8CE] text-[10px] text-[#0F5E63] hover:underline"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  <span>{att.file_name}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: CONTACTS ROSTER */}
            {c360Tab === 'contacts' && (
              <div className="p-3 sm:p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-[#0F5E63]" />
                    <span>Account Contacts Roster</span>
                  </span>
                </div>

                {customerContacts.length === 0 ? (
                  <span className="text-[11px] text-[#4A5568] italic">No contacts registered for this organization.</span>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {customerContacts.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 font-bold text-[#14213D]">{c.name || c.full_name}</span>
                          {c.is_primary && (
                            <Badge variant="info" size="sm" className="text-[9px]">PRIMARY</Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[#4A5568]">{c.designation || 'Officer'}</div>
                        <div className="flex flex-col gap-1 text-[10px] text-[#4A5568] font-mono">
                          {(c.phone || c.mobile) && <span>📞 {c.phone || c.mobile}</span>}
                          {c.email && <span>✉️ {c.email}</span>}
                        </div>
                        <div className="pt-1 border-t border-[#DCD8CE]">
                          <Button
                            size="xs"
                            variant="secondary"
                            className="h-9 w-full text-xs sm:h-7 sm:w-auto sm:text-[11px]"
                            onClick={() => {
                              setInteractionForm({
                                ...interactionForm,
                                organisation_id: selectedCustomer.id,
                                contact_id: c.id,
                              });
                              setIsLogInteractionOpen(true);
                            }}
                            leftIcon={<Plus className="h-3 w-3" />}
                          >
                            Log Touchpoint with Contact
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: ACTIVE OPPORTUNITIES */}
            {c360Tab === 'deals' && (
              <div className="p-3 sm:p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                    <Briefcase className="h-4 w-4 text-[#0F5E63]" />
                    <span>Active Pipeline & Opportunities</span>
                  </span>
                </div>

                {customerLeads.length === 0 ? (
                  <div className="p-6 text-center text-[#4A5568] italic bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]">
                    No deals or opportunities registered under this organisation.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customerLeads.map((ld) => (
                      <div
                        key={ld.id}
                        className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between hover:border-[#0F5E63] transition-colors cursor-pointer"
                        onClick={() => {
                          setIsCustomer360Open(false);
                          handleOpenLead(ld.id);
                        }}
                      >
                        <div className="space-y-1">
                          <div className="font-bold text-[#14213D] flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{ld.title || ld.product_name || 'Procurement Opportunity'}</span>
                            {ld.lead_type === 're_approached' ? (
                              <Badge variant="warning" size="sm" className="font-bold text-[9px]">
                                RE-APPROACHED
                              </Badge>
                            ) : (
                              <Badge variant="info" size="sm" className="font-bold text-[9px]">
                                FRESH
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-[#4A5568]">
                            Assigned to: <strong className="text-[#14213D]">{ld.assignee_name || ld.assigned_salesperson_name || 'Unassigned'}</strong>
                            {ld.next_followup_date && (
                              <span> • Follow-up Due: <strong className="text-[#0F5E63]">{formatDateIN(ld.next_followup_date)}</strong></span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-mono font-bold text-[#14213D]">
                            {formatLakh(ld.value_lakh || ld.estimated_value_lakh || 0)}
                          </span>
                          {getStatusBadge(ld.lead_status || ld.status)}
                          <Button size="xs" variant="secondary" rightIcon={<ChevronRight className="h-3 w-3" />}>
                            Details
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: everything other modules hold for this customer */}
            {c360Tab === 'linked' && (
              <RelatedRecords
                to={{ kind: 'customer', id: selectedCustomer.id }}
                sections={['visits', 'demos', 'proposals', 'tenders', 'deliveries', 'service', 'tasks', 'expenses']}
                description="Visits, demos, proposals, tenders, deliveries, service, tasks and expenses for this customer."
              />
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#DCD8CE]">
              <Button
                variant="secondary"
                size="sm"
                className="h-10 flex-1 sm:h-8 sm:flex-none"
                onClick={() => {
                  setInteractionForm({
                    ...interactionForm,
                    lead_id: customerLeads[0]?.id || '',
                    organisation_id: selectedCustomer.id,
                    contact_id: customerContacts[0]?.id || '',
                  });
                  setIsLogInteractionOpen(true);
                }}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Log New Interaction
              </Button>
              <Button variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsCustomer360Open(false)}>
                Close View
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5: LOG FIELD INTERACTION & AUTO FOLLOW-UP SCHEDULER                 */}
      {/* Layered foreground action dialog with zIndex={70}                         */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isLogInteractionOpen}
        onClose={() => setIsLogInteractionOpen(false)}
        title="Log Client Interaction & Field Minutes"
        description="Record phone calls, in-person meetings, discussions, and technical presentations."
        maxWidth="lg"
        zIndex={70}
      >
        <form onSubmit={handleLogInteraction} className="text-xs">
          <FormSteps
            onCancel={() => setIsLogInteractionOpen(false)}
            maxSteps={2}
            stepTitles={['Interaction & Minutes', 'Next Step & Documents']}
            banner={
              formError && (
                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
                  {formError}
                </div>
              )
            }
            submit={
              <Button type="submit" variant="primary" size="sm" className="h-10 sm:h-8" isLoading={actionLoading}>
                Save Touchpoint
              </Button>
            }
            steps={[
              {
                title: 'Interaction',
                icon: <MessageSquare />,
                description: 'How and when you spoke to the client, and with whom.',
                content: (
          <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Interaction Channel *"
              value={interactionForm.type}
              onChange={(e) => setInteractionForm({ ...interactionForm, type: e.target.value })}
              options={[
                { value: 'call', label: '📞 Phone Call' },
                { value: 'physical_visit', label: '🏢 Physical Visit (In-Person)' },
                { value: 'video_conference', label: '🎥 Video Conference' },
                { value: 'demo', label: '🎯 Product Demonstration / Trial' },
                { value: 'proposal', label: '📄 Proposal Submission' },
                { value: 'whatsapp', label: '💬 WhatsApp Message' },
                { value: 'email', label: '✉️ Email Correspondence' },
                { value: 'tender_discussion', label: '⚖️ Pre-Tender Discussion' },
                { value: 'follow_up', label: '⏰ Routine Follow-up' },
                { value: 'service_discussion', label: '🔧 Service / Warranty Review' },
              ]}
            />
            <Input
              label="Interaction Date *"
              type="date"
              required
              value={interactionForm.date}
              onChange={(e) => setInteractionForm({ ...interactionForm, date: e.target.value })}
            />
          </div>

          {customerContacts.length > 0 && (
            <Select
              label="Contact Person (Optional)"
              value={interactionForm.contact_id}
              onChange={(e) => setInteractionForm({ ...interactionForm, contact_id: e.target.value })}
              options={[
                { value: '', label: 'General / Primary Contact' },
                ...customerContacts.map((c) => ({
                  value: c.id,
                  label: `${c.name || c.full_name || 'Contact'}${c.designation ? ` (${c.designation})` : ''}`,
                })),
              ]}
            />
          )}
          </div>
                ),
              },
              {
                title: 'Minutes',
                icon: <FileText />,
                description: 'What was discussed and how the client responded.',
                content: (
          <div className="space-y-3">
            <Textarea
              label="Minutes / Discussion Notes *"
              required
              value={interactionForm.notes}
              onChange={(e) => setInteractionForm({ ...interactionForm, notes: e.target.value })}
              placeholder="Key discussion points, specifications requested, procurement timing, decision maker feedback..."
            />
            <Input
              label="Client Outcome / Feedback"
              value={interactionForm.outcome}
              onChange={(e) => setInteractionForm({ ...interactionForm, outcome: e.target.value })}
              placeholder="e.g. Approved technical trial"
            />
          </div>
                ),
              },
              {
                title: 'Next step',
                icon: <Clock />,
                description: 'What happens next. A due date here creates a follow-up automatically.',
                content: (
          <div className="space-y-3">
            <Input
              label="Next Action Step"
              value={interactionForm.next_action}
              onChange={(e) => setInteractionForm({ ...interactionForm, next_action: e.target.value })}
              placeholder="e.g. Send formal quote & compliance"
            />
            <Input
              label="Next Touchpoint Due Date (Auto-creates Follow-up)"
              type="date"
              value={interactionForm.next_followup_date}
              onChange={(e) => setInteractionForm({ ...interactionForm, next_followup_date: e.target.value })}
            />
          </div>
                ),
              },
              {
                title: 'Documents',
                icon: <Paperclip />,
                description: 'Optional: attach supporting documents such as a proposal or MOM.',
                content: (
          <div className="space-y-2">
            <label
              className={`inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs font-semibold text-[#0F5E63] hover:bg-[#E3EFEE] sm:min-h-8 ${attachmentUploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              <Paperclip className="h-3.5 w-3.5" /> {attachmentUploading ? 'Uploading…' : 'Attach documents'}
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                className="hidden"
                disabled={attachmentUploading}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  if (files.length === 0) return;
                  setAttachmentError(null);
                  const tooBig = files.find((f) => f.size > MAX_INTERACTION_FILE_BYTES);
                  if (tooBig) {
                    setAttachmentError(`${tooBig.name} is larger than 10 MB.`);
                    return;
                  }
                  setAttachmentUploading(true);
                  try {
                    const uploaded: InteractionAttachment[] = [];
                    for (const file of files) uploaded.push(await uploadInteractionFile(file));
                    setInteractionForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...uploaded] }));
                  } catch (err: any) {
                    setAttachmentError(err.message || 'Document upload failed.');
                  } finally {
                    setAttachmentUploading(false);
                  }
                }}
              />
            </label>
            {attachmentError && <p className="text-[11px] text-[#881337]">{attachmentError}</p>}
            {interactionForm.attachments.length === 0 ? (
              <p className="text-[11px] text-[#4A5568]">No documents attached. PDF, Word, Excel or photos · up to 10 MB each.</p>
            ) : (
              <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#DCD8CE]">
                {interactionForm.attachments.map((a, i) => (
                  <li key={a.file_url} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <a href={a.file_url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[#0F5E63] underline">
                      {a.file_name}
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${a.file_name}`}
                      className="h-10 w-10 shrink-0 px-0 sm:h-8 sm:w-8"
                      onClick={() =>
                        setInteractionForm((prev) => ({ ...prev, attachments: prev.attachments.filter((_, j) => j !== i) }))
                      }
                    >
                      <X className="h-3.5 w-3.5 text-[#9A3412]" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 7: COMPLETE FOLLOW-UP & OPTIONAL CONTINUATION SCHEDULER             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCompleteFollowupOpen}
        onClose={() => setIsCompleteFollowupOpen(false)}
        title="Complete Follow-up Touchpoint"
        description="Records outcome remarks and optionally schedules the subsequent pipeline reminder."
        maxWidth="md"
        zIndex={60}
      >
        <form onSubmit={handleCompleteFollowup} noValidate className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
              {formError}
            </div>
          )}

          <FormSection
            title="Outcome"
            icon={<CheckCircle2 />}
            description="How the touchpoint went."
          >
            <Input
              label="Touchpoint Outcome *"
              required
              value={completionOutcome}
              onChange={(e) => {
                setCompletionOutcome(e.target.value);
                if (e.target.value.trim()) setCompletionOutcomeError(null);
              }}
              placeholder="e.g. Officer agreed to physical demonstration on 28th"
              error={completionOutcomeError || undefined}
            />

            <Textarea
              label="Remarks / Minutes"
              value={completionRemarks}
              onChange={(e) => setCompletionRemarks(e.target.value)}
              placeholder="Details of client discussion..."
            />
          </FormSection>

          <FormSection
            title="Next follow-up"
            icon={<CalendarDays />}
            description="Optionally book the next reminder for this lead."
          >
            <label className="flex min-h-10 items-center gap-2 cursor-pointer sm:min-h-0">
              <input
                type="checkbox"
                checked={scheduleNextFollowup}
                onChange={(e) => setScheduleNextFollowup(e.target.checked)}
                className="rounded border-[#DCD8CE] text-[#0F5E63] focus:ring-[#0F5E63]"
              />
              <span className="font-semibold text-[#14213D] text-xs">
                Schedule next follow-up touchpoint
              </span>
            </label>

            {scheduleNextFollowup && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Next Follow-up Due Date *"
                  type="date"
                  required={scheduleNextFollowup}
                  min={istToday()}
                  value={nextFollowupDueDate}
                  onChange={(e) => setNextFollowupDueDate(e.target.value)}
                  error={nextFollowupDateError || undefined}
                />
                <Input
                  label="Next Follow-up Due Time"
                  type="time"
                  value={nextFollowupDueTime}
                  onChange={(e) => setNextFollowupDueTime(e.target.value)}
                  helperText="Optional"
                />
              </div>
            )}
          </FormSection>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsCompleteFollowupOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="success" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" isLoading={actionLoading}>
              Mark Completed
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 8: RESCHEDULE FOLLOW-UP                                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isRescheduleFollowupOpen}
        onClose={() => setIsRescheduleFollowupOpen(false)}
        title="Reschedule Follow-up Touchpoint"
        description="Updates the reminder date and time for this sales activity."
        maxWidth="sm"
        zIndex={60}
      >
        <form onSubmit={handleRescheduleFollowup} noValidate className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D]">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="New Due Date *"
              type="date"
              required
              min={istToday()}
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              error={rescheduleDateError || undefined}
            />
            <Input
              label="New Due Time"
              type="time"
              value={rescheduleTime}
              onChange={(e) => setRescheduleTime(e.target.value)}
              helperText="Optional"
            />
          </div>

          <Input
            label="Reschedule Remarks"
            value={rescheduleRemarks}
            onChange={(e) => setRescheduleRemarks(e.target.value)}
            placeholder="e.g. Officer on leave until next Monday"
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" onClick={() => setIsRescheduleFollowupOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" isLoading={actionLoading}>
              Reschedule
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
