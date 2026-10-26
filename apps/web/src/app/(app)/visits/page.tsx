'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { availableFirst, fleetHint, kitForProduct, kitValue, unitHint } from '@/app/(app)/demos/_lib/fleet';
import type { SelectOption } from '@/components/ui';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Plus,
  MapPin,
  Building,
  User,
  Clock,
  AlertCircle,
  FileEdit,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Sparkles,
  Receipt,
  UserPlus,
  RefreshCw,
  Search,
  Shield,
  Layers,
  History,
  Route,
  Navigation,
  Car,
  ChevronRight,
  Info,
  CalendarDays,
  FileText,
  AlertTriangle,
  Users,
  Compass,
  FlaskConical,
  Plane,
  Hotel,
  Zap,
  Bell,
  Wrench,
  LayoutList,
  SlidersHorizontal,
  Pencil,
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useOpenParam } from '@/lib/use-open-param';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { GuardedLink } from '@/components/links/GuardedLink';
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
  EmptyState,
  InfoCallout,
  Checkbox, CountUp, PageLoader, Spinner, FilterMenu,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, RowMenu,
  FormSteps, FormSection, RecordViews, formatDateIN, formatDateTimeIN, type RecordItem, type RecordTone } from '@/components/ui';
import type { RowMenuItem } from '@/components/ui/RowMenu';
import type { FilterMenuOption } from '@/components/ui/FilterMenu';
import { NewClaimButton } from '../expenses/_lib/ClaimFormModal';
import { VisitCalendar, type VisitTone } from './_lib/VisitCalendar';

// Specific Demo Kit standard accessories mapping
// Same rules the API enforces: a visit's time window must end after it starts; field plans cannot be made
// for a past day; a visit is reported on or after its planned day (all IST).
const timeRangeError = (start?: string | null, end?: string | null): string | undefined =>
  start && end && end <= start ? `End time (${end}) must be after the start time (${start}).` : undefined;
// Board columns for visits: what is coming, what still needs its report, what is done
const VISIT_LANES: { key: VisitTone; label: string; tone: RecordTone }[] = [
  { key: 'upcoming', label: 'Upcoming', tone: 'info' },
  { key: 'overdue', label: 'Report overdue', tone: 'warning' },
  { key: 'done', label: 'Done', tone: 'success' },
  { key: 'cancelled', label: 'Cancelled', tone: 'neutral' },
];
const isActiveVisitStatus = (status?: string) => ['planned', 'modified', 'rescheduled'].includes(String(status));
const isFutureVisit = (v: any) => (calendarDay(v?.planned_date) || '') > istToday();
const REPORT_PENDING = ['planned', 'modified', 'rescheduled'];
// Visit day has passed but no report yet (the API sets report_overdue; derive it for older payloads).
const isReportOverdue = (v: any) =>
  v?.report_overdue ?? (REPORT_PENDING.includes(v?.status) && (calendarDay(v?.planned_date) || '') < istToday());
// The visit register is read page by page (the API caps a page at 100).
const VISITS_PAGE_SIZE = 50;
const fmtDay = (d: string) => {
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};

export default function VisitsPage() {
  const { user, hasRole } = useAuth();
  // Salespeople can only plan visits for themselves (enforced by the API too)
  const isSalesRole = hasRole('sales');
  // The visiting rep files the post-visit report; management only reports visits they made themselves
  const canFileReport = (v: any) => !hasRole('management') || v.assigned_to === user?.id;
  const router = useRouter();
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'my_visits' | 'manager_dashboard' | 'trips' | 'customer_history' | 'employee_activity'>('my_visits');
  // the visit open in the detail popup (looked up in the list so it refreshes after an action)
  const [openVisitId, setOpenVisitId] = useState<string | null>(null);

  // Core Data
  const [trips, setTrips] = useState<any[]>([]);
  const [managerData, setManagerData] = useState<any | null>(null);
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [demoEquipmentList, setDemoEquipmentList] = useState<any[]>([]);
  const [selectedOrgHistory, setSelectedOrgHistory] = useState<any[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [employeeActivities, setEmployeeActivities] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Filters
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterTravelOnly, setFilterTravelOnly] = useState(false);
  const [filterDemoOnly, setFilterDemoOnly] = useState(false);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  // The search box applies on Enter
  const [appliedSearch, setAppliedSearch] = useState('');

  // The visit register: filtered and paged on the API, loaded as the reader scrolls
  const listFilters = useMemo(
    () => ({
      search: appliedSearch || undefined,
      status: filterStatus || undefined,
      assigned_to: filterEmployee || undefined,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      travel_required: filterTravelOnly ? 'true' : undefined,
      demo_required: filterDemoOnly ? 'true' : undefined,
    }),
    [appliedSearch, filterStatus, filterEmployee, filterDateFrom, filterDateTo, filterTravelOnly, filterDemoOnly],
  );
  const fetchVisitsPage = useCallback(
    (page: number) => api.get('/visits', { ...listFilters, page, limit: VISITS_PAGE_SIZE }),
    [listFilters],
  );
  const visitsList = useInfiniteList<any>(fetchVisitsPage);
  const { rows: visits, total: visitsTotal, loading: visitsLoading } = visitsList;

  // KPI cards: counted on the API over the same scope and filters as the list (not from the loaded page)
  const [stats, setStats] = useState({ total: 0, today: 0, directives: 0, completed: 0, overdue: 0, upcoming: 0 });
  const statsGen = useRef(0);
  const fetchStats = useCallback(async () => {
    const g = ++statsGen.current;
    const res = await api.get('/visits/stats', listFilters).catch(() => null);
    if (res && g === statsGen.current) setStats(res);
  }, [listFilters]);
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Modals
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isCreateTripOpen, setIsCreateTripOpen] = useState(false);
  const [isAddTripVisitOpen, setIsAddTripVisitOpen] = useState(false);
  const [isAlsoMeetOpen, setIsAlsoMeetOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isDestinationOpen, setIsDestinationOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);

  const [selectedVisit, setSelectedVisit] = useState<any | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);

  // Form States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. Plan Visit Form
  const [newVisit, setNewVisit] = useState({
    organisation_id: '',
    assigned_to: '', // Visiting officer who is going
    location: '',
    planned_date: addIsoDays(istToday(), 7), // 1 week in advance default
    start_time: '10:00',
    end_time: '11:30',
    purpose: '',
    contact_person: '',
    product_id: '',
    demo_required: false,
    travel_required: false,
    expected_outcome: '',
    remarks: '',
    trip_id: '',
  });

  // Demo and Travel requisition details for dynamic form expansion
  const [demoDetails, setDemoDetails] = useState({
    demo_assigned_to: '',
    product_id: '',
    equipment_required: '',
    custom_accessories: '',
    expected_audience: '',
    special_requirements: '',
    power_required: true,
    night_trial: false,
    gate_pass_required: true,
    service_escort_required: false,
    service_engineer_id: '',
  });
  const [demoTeamAvailability, setDemoTeamAvailability] = useState<any[]>([]);
  const [isLoadingTeamAvailability, setIsLoadingTeamAvailability] = useState(false);

  const serviceEngineers = useMemo(() => {
    return (usersList || []).filter((u) => u.role === 'service_team');
  }, [usersList]);

  const [travelDetails, setTravelDetails] = useState({
    travel_from: 'Delhi NCR (HQ Base)',
    travel_to: '',
    travel_mode: 'Express Train (Shatabdi/Rajdhani)',
    lodging_required: false,
    stay_nights: '1',
  });

  // Options for registered demo equipment models from fleet matrix
  // Active selected equipment unit object
  const selectedEquipUnit = useMemo(() => {
    if (!demoDetails.equipment_required || demoDetails.equipment_required === 'custom') return null;
    return (demoEquipmentList || []).find(
      (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === demoDetails.equipment_required
        || item.serial_no === demoDetails.equipment_required
        || item.id === demoDetails.equipment_required
    ) || null;
  }, [demoEquipmentList, demoDetails.equipment_required]);

  // Active product fleet availability breakdown
  const activeProductFleet = useMemo(() => {
    const pId = demoDetails.product_id || newVisit.product_id;
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
  }, [demoEquipmentList, demoDetails.product_id, newVisit.product_id]);

  // Options for registered demo equipment models from fleet matrix
  const registeredEquipmentOptions = useMemo(() => {
    const list = demoEquipmentList || [];
    const activeProductId = demoDetails.product_id || newVisit.product_id;

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
  }, [demoEquipmentList, demoDetails.product_id, newVisit.product_id]);

  // Helper to fetch demo team availability for specified date
  const fetchDemoTeamAvailability = async (dateStr: string) => {
    if (!dateStr) return;
    try {
      setIsLoadingTeamAvailability(true);
      const res = await api.get('/demos/team/availability', { date: dateStr });
      if (Array.isArray(res)) {
        setDemoTeamAvailability(res);
      }
    } catch (err) {
      console.warn('Could not fetch demo team availability:', err);
    } finally {
      setIsLoadingTeamAvailability(false);
    }
  };

  useEffect(() => {
    if (newVisit.demo_required && newVisit.planned_date) {
      fetchDemoTeamAvailability(newVisit.planned_date);
    }
  }, [newVisit.demo_required, newVisit.planned_date]);

  // Selected demo team member object
  const selectedDemoMember = useMemo(() => {
    if (!demoDetails.demo_assigned_to) return null;
    return (
      (demoTeamAvailability.length > 0 ? demoTeamAvailability : usersList).find(
        (u) => u.id === demoDetails.demo_assigned_to
      ) || null
    );
  }, [demoTeamAvailability, usersList, demoDetails.demo_assigned_to]);

  // Demo team options with availability status tags
  const demoTeamOptions = useMemo(() => {
    const roster = demoTeamAvailability.length > 0
      ? demoTeamAvailability
      : usersList.filter((u) => u.role === 'demo_team');

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
  }, [demoTeamAvailability, usersList]);

  // Derived effective demo location (same as trip or visit location)
  const effectiveDemoLocation = useMemo(() => {
    if (newVisit.location) return newVisit.location;
    if (newVisit.trip_id) {
      const trip = trips.find((t) => t.id === newVisit.trip_id);
      if (trip?.base_location) return trip.base_location;
    }
    if (travelDetails.travel_to) return travelDetails.travel_to;
    const org = organisations.find((o) => o.id === newVisit.organisation_id);
    return org?.city || 'Client Site / Field';
  }, [newVisit.location, newVisit.trip_id, travelDetails.travel_to, newVisit.organisation_id, trips, organisations]);

  // 2. Create Trip Form
  const [newTrip, setNewTrip] = useState({
    employee_id: '',
    trip_date: addIsoDays(istToday(), 7),
    base_location: '',
    notes: '',
  });

  // 3. Add Visit to Trip Form
  const [tripVisit, setTripVisit] = useState({
    organisation_id: '',
    location: '',
    start_time: '14:00',
    end_time: '15:30',
    purpose: '',
    instructions: '',
    reason: 'Customer is in the same operational area',
  });

  // 4. Also Meet Form
  const [alsoMeetData, setAlsoMeetData] = useState({
    instructions: '',
    assign_additional: false,
    organisation_id: '',
    location: '',
    contact_person: '',
    purpose: 'Strategic procurement review / GeM requirements',
    start_time: '14:30',
    end_time: '16:00',
  });

  // 5. Reschedule Form
  const [rescheduleData, setRescheduleData] = useState({
    new_date: '',
    start_time: '',
    end_time: '',
    reason: '',
  });

  // 6. Cancel Form
  const [cancelReason, setCancelReason] = useState('');

  // 7. Destination Form
  const [newDestination, setNewDestination] = useState({
    new_location: '',
    reason: '',
  });

  // 8. Post-Visit Report Form
  const [reportData, setReportData] = useState({
    met_completed: true,
    person_met: '',
    discussion: '',
    product_discussed: '',
    outcome: '',
    opportunity: '',
    tender_opportunity: '',
    demo_required: false,
    next_action: '',
    followup_date: '',
    remarks: '',
  });

  // -------------------------------------------------------------
  // Load All Master and Module Data
  // -------------------------------------------------------------
  // (the visit register itself is useInfiniteList above)
  const fetchData = async () => {
    try {
      const [tripsRes, orgsRes, prodsRes, usersRes, demoEquipRes] = await Promise.all([
        api.get('/visits/trips'),
        api.get('/organisations', { limit: 100 }),
        api.get('/products', { limit: 100 }).catch(() => api.get('/masters/products')).catch(() => []),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/demos/equipment').catch(() => []),
      ]);

      setTrips(tripsRes || []);
      setOrganisations(orgsRes.data || []);
      setProducts(Array.isArray(prodsRes) ? prodsRes : (prodsRes?.data || []));
      setUsersList(usersRes.data || []);
      setDemoEquipmentList(Array.isArray(demoEquipRes) ? demoEquipRes : (demoEquipRes?.data || []));

      if (orgsRes.data && orgsRes.data.length > 0 && !selectedOrgId) {
        setSelectedOrgId(orgsRes.data[0].id);
      }

      // Load manager field activity if user has manager or management role
      if (hasRole(['management', 'regional_manager', 'admin'])) {
        const mgrRes = await api.get('/visits/manager/field-activity', {
          assigned_to: filterEmployee || undefined,
          status: filterStatus || undefined,
          dateFrom: filterDateFrom || undefined,
          dateTo: filterDateTo || undefined,
        }).catch(() => null);
        setManagerData(mgrRes);
      }

      // Load employee activity
      if (user?.id) {
        const actRes = await api.get(`/visits/employees/${user.id}/activities`).catch(() => []);
        setEmployeeActivities(actRes || []);
      }
    } catch (err) {
      console.error('Failed to load visit planning data:', err);
    }
  };
  // After an action: the page data, the visit register (pages loaded so far) and the KPI counts
  const reloadAll = () => Promise.all([fetchData(), visitsList.refresh(), fetchStats()]);

  useEffect(() => {
    fetchData();
  }, [filterStatus, filterEmployee, filterDateFrom, filterDateTo, filterTravelOnly, filterDemoOnly]);

  // Deep link from Customer 360 / linked records: /visits?customer=<organisation id> opens that customer's visit history.
  // Runs after the first load so the default customer selection does not overwrite it.
  useOpenParam(
    async (orgId) => {
      setActiveTab('customer_history');
      if (!organisations.some((o) => o.id === orgId)) {
        const org = await api.get(`/organisations/${orgId}`).catch(() => null);
        if (org?.id) setOrganisations((prev) => [org, ...prev]);
      }
      setSelectedOrgId(orgId);
    },
    organisations.length > 0,
    'customer',
  );

  // Deep link from notifications: /visits?open=<visit id> opens the visit in its customer's history.
  useOpenParam(
    async (visitId) => {
      const v = visits.find((x) => x.id === visitId) ?? (await api.get(`/visits/${visitId}`).catch(() => null));
      if (!v?.organisation_id) return;
      setActiveTab('customer_history');
      if (!organisations.some((o) => o.id === v.organisation_id)) {
        const org = await api.get(`/organisations/${v.organisation_id}`).catch(() => null);
        if (org?.id) setOrganisations((prev) => [org, ...prev]);
      }
      setSelectedOrgId(v.organisation_id);
    },
    organisations.length > 0,
  );

  // Load customer history when selectedOrgId changes
  useEffect(() => {
    if (selectedOrgId) {
      api.get(`/visits/organisations/${selectedOrgId}/history`)
        .then((data) => setSelectedOrgHistory(data || []))
        .catch(() => setSelectedOrgHistory([]));
    }
  }, [selectedOrgId]);

  // Sync visiting officer default when auth user loads
  useEffect(() => {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (user?.id && UUID_REGEX.test(user.id) && !newVisit.assigned_to) {
      setNewVisit((prev) => ({ ...prev, assigned_to: prev.assigned_to || user.id }));
    }
  }, [user?.id, newVisit.assigned_to]);

  // Sync demo product focus when selected in Section 3
  useEffect(() => {
    if (newVisit.product_id) {
      setDemoDetails((prev) => ({ ...prev, product_id: newVisit.product_id }));
    }
  }, [newVisit.product_id]);

  // Sync travel destination when location changes
  useEffect(() => {
    if (newVisit.location) {
      setTravelDetails((prev) => ({ ...prev, travel_to: newVisit.location }));
    }
  }, [newVisit.location]);

  // -------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------
  const handleScheduleVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (!newVisit.organisation_id) {
        throw new Error('Please select a customer organisation.');
      }
      if ((newVisit.planned_date || '') < istToday()) {
        throw new Error('Cannot schedule a field visit for a past date.');
      }
      const rangeErr = timeRangeError(newVisit.start_time, newVisit.end_time);
      if (rangeErr) throw new Error(rangeErr);

      const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const chosenOfficer = [isSalesRole ? user?.id : newVisit.assigned_to, user?.id].find(
        (id) => typeof id === 'string' && UUID_REGEX.test(id.trim())
      )?.trim() || (usersList.find((u) => u.id && UUID_REGEX.test(u.id))?.id);

      if (!chosenOfficer) {
        throw new Error('Please select a visiting officer who is going.');
      }

      let enrichedRemarks = newVisit.remarks ? [newVisit.remarks] : [];
      if (newVisit.demo_required) {
        const demoParts = [];
        const fullEquip = [
          demoDetails.equipment_required && demoDetails.equipment_required !== 'custom'
            ? demoDetails.equipment_required
            : '',
          demoDetails.custom_accessories,
        ]
          .filter(Boolean)
          .join(' + ');

        if (fullEquip) demoParts.push(`Demo Kit / Model: ${fullEquip}`);
        if (demoDetails.expected_audience) demoParts.push(`Audience: ${demoDetails.expected_audience}`);
        const facilities = [
          demoDetails.power_required ? '230V AC Power Socket' : '',
          demoDetails.night_trial ? 'Dark Room / Night Vision Setup' : '',
          demoDetails.gate_pass_required ? 'Equipment Gate Pass' : '',
        ].filter(Boolean);
        if (facilities.length > 0) demoParts.push(`Facilities: ${facilities.join(', ')}`);
        if (demoDetails.special_requirements) demoParts.push(`Note: ${demoDetails.special_requirements}`);
        if (demoParts.length > 0) enrichedRemarks.push(`[LIVE DEMO REQUISITION] ${demoParts.join(' | ')}`);
      }
      if (newVisit.travel_required) {
        const travelParts = [];
        if (travelDetails.travel_from) travelParts.push(`From: ${travelDetails.travel_from}`);
        if (travelDetails.travel_mode) travelParts.push(`Mode: ${travelDetails.travel_mode}`);
        if (travelDetails.lodging_required) travelParts.push(`Hotel Required (${travelDetails.stay_nights} Night(s))`);
        if (travelParts.length > 0) enrichedRemarks.push(`[OUTSTATION TRAVEL] ${travelParts.join(' | ')}`);
      }

      const payloadRemarks = enrichedRemarks.length > 0 ? enrichedRemarks.join('\n') : undefined;

      const activeProductId = (newVisit.demo_required && demoDetails.product_id ? demoDetails.product_id : newVisit.product_id)?.trim();
      const validProductId = activeProductId && UUID_REGEX.test(activeProductId) ? activeProductId : undefined;
      const validTripId = newVisit.trip_id?.trim() && UUID_REGEX.test(newVisit.trip_id.trim()) ? newVisit.trip_id.trim() : undefined;

      await api.post('/visits', {
        organisation_id: newVisit.organisation_id,
        assigned_to: chosenOfficer,
        location: newVisit.location?.trim() || undefined,
        planned_date: newVisit.planned_date,
        start_time: newVisit.start_time?.trim() || undefined,
        end_time: newVisit.end_time?.trim() || undefined,
        purpose: newVisit.purpose,
        contact_person: newVisit.contact_person?.trim() || undefined,
        product_id: validProductId,
        demo_required: newVisit.demo_required,
        demo_assigned_to: newVisit.demo_required && demoDetails.demo_assigned_to ? demoDetails.demo_assigned_to : undefined,
        service_escort_required: newVisit.demo_required ? (demoDetails.service_escort_required || false) : false,
        service_engineer_id: newVisit.demo_required && demoDetails.service_escort_required && demoDetails.service_engineer_id ? demoDetails.service_engineer_id : undefined,
        travel_required: newVisit.travel_required,
        expected_outcome: newVisit.expected_outcome?.trim() || undefined,
        remarks: payloadRemarks,
        trip_id: validTripId,
      });

      setIsScheduleOpen(false);
      const defaultOfficer = (user?.id && UUID_REGEX.test(user.id))
        ? user.id
        : (usersList.find((u) => u.id && UUID_REGEX.test(u.id))?.id || '');
      setNewVisit({
        organisation_id: '',
        assigned_to: defaultOfficer,
        location: '',
        planned_date: addIsoDays(istToday(), 7),
        start_time: '10:00',
        end_time: '11:30',
        purpose: '',
        contact_person: '',
        product_id: '',
        demo_required: false,
        travel_required: false,
        expected_outcome: '',
        remarks: '',
        trip_id: '',
      });
      setDemoDetails({
        demo_assigned_to: '',
        product_id: '',
        equipment_required: '',
        custom_accessories: '',
        expected_audience: '',
        special_requirements: '',
        power_required: true,
        night_trial: false,
        gate_pass_required: true,
        service_escort_required: false,
        service_engineer_id: '',
      });
      setTravelDetails({
        travel_from: 'Delhi NCR (HQ Base)',
        travel_to: '',
        travel_mode: 'Express Train (Shatabdi/Rajdhani)',
        lodging_required: false,
        stay_nights: '1',
      });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to schedule field visit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      if ((newTrip.trip_date || '') < istToday()) {
        throw new Error('Cannot schedule a tour program for a past date.');
      }
      await api.post('/visits/trips', {
        employee_id: newTrip.employee_id || user?.id,
        trip_date: newTrip.trip_date,
        base_location: newTrip.base_location,
        notes: newTrip.notes,
      });

      setIsCreateTripOpen(false);
      setNewTrip({
        employee_id: '',
        trip_date: addIsoDays(istToday(), 7),
        base_location: '',
        notes: '',
      });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create tour program.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTripVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      const rangeErr = timeRangeError(tripVisit.start_time, tripVisit.end_time);
      if (rangeErr) throw new Error(rangeErr);
      await api.post(`/visits/trips/${selectedTrip.id}/visits`, {
        organisation_id: tripVisit.organisation_id,
        location: tripVisit.location,
        start_time: tripVisit.start_time,
        end_time: tripVisit.end_time,
        purpose: tripVisit.purpose,
        instructions: tripVisit.instructions,
        reason: tripVisit.reason,
      });

      setIsAddTripVisitOpen(false);
      setTripVisit({
        organisation_id: '',
        location: '',
        start_time: '14:00',
        end_time: '15:30',
        purpose: '',
        instructions: '',
        reason: 'Customer is in the same operational area',
      });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to add customer visit to trip.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAlsoMeetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (alsoMeetData.assign_additional) {
        const rangeErr = timeRangeError(alsoMeetData.start_time, alsoMeetData.end_time);
        if (rangeErr) throw new Error(rangeErr);
      }
      await api.post(`/visits/${selectedVisit.id}/intervention`, {
        instructions: alsoMeetData.instructions,
        organisation_id: alsoMeetData.assign_additional && alsoMeetData.organisation_id ? alsoMeetData.organisation_id : undefined,
        location: alsoMeetData.assign_additional && alsoMeetData.location ? alsoMeetData.location : undefined,
        contact_person: alsoMeetData.contact_person || undefined,
        purpose: alsoMeetData.purpose || undefined,
        start_time: alsoMeetData.assign_additional && alsoMeetData.start_time ? alsoMeetData.start_time : undefined,
        end_time: alsoMeetData.assign_additional && alsoMeetData.end_time ? alsoMeetData.end_time : undefined,
      });

      setIsAlsoMeetOpen(false);
      setAlsoMeetData({
        instructions: '',
        assign_additional: false,
        organisation_id: '',
        location: '',
        contact_person: '',
        purpose: 'Strategic procurement review / GeM requirements',
        start_time: '14:30',
        end_time: '16:00',
      });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to attach manager directive.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      if ((calendarDay(rescheduleData.new_date) || '') < istToday()) {
        throw new Error('Rescheduled date must be today or a future date.');
      }
      const rangeErr = timeRangeError(
        rescheduleData.start_time || selectedVisit.start_time,
        rescheduleData.end_time || selectedVisit.end_time,
      );
      if (rangeErr) throw new Error(rangeErr);
      await api.post(`/visits/${selectedVisit.id}/reschedule`, {
        new_date: rescheduleData.new_date,
        start_time: rescheduleData.start_time || undefined,
        end_time: rescheduleData.end_time || undefined,
        reason: rescheduleData.reason,
      });

      setIsRescheduleOpen(false);
      setRescheduleData({ new_date: '', start_time: '', end_time: '', reason: '' });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to reschedule visit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/visits/${selectedVisit.id}/cancel`, {
        reason: cancelReason,
      });

      setIsCancelOpen(false);
      setCancelReason('');
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel visit.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDestinationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/visits/${selectedVisit.id}/destination`, {
        new_location: newDestination.new_location,
        reason: newDestination.reason,
      });

      setIsDestinationOpen(false);
      setNewDestination({ new_location: '', reason: '' });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update destination.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/visits/${selectedVisit.id}/update`, {
        met_completed: reportData.met_completed,
        person_met: reportData.person_met,
        discussion: reportData.discussion,
        product_discussed: reportData.product_discussed,
        outcome: reportData.outcome,
        opportunity: reportData.opportunity,
        tender_opportunity: reportData.tender_opportunity,
        demo_required: reportData.demo_required,
        next_action: reportData.next_action || undefined,
        followup_date: reportData.followup_date || undefined,
        remarks: reportData.remarks,
      });

      setIsReportOpen(false);
      setReportData({
        met_completed: true,
        person_met: '',
        discussion: '',
        product_discussed: '',
        outcome: '',
        opportunity: '',
        tender_opportunity: '',
        demo_required: false,
        next_action: '',
        followup_date: '',
        remarks: '',
      });
      await reloadAll();
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit post-visit update.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAudit = async (visit: any) => {
    setSelectedVisit(visit);
    setIsAuditOpen(true);
    try {
      const logs = await api.get(`/visits/${visit.id}/audit`);
      setAuditLogs(logs || []);
    } catch (err) {
      setAuditLogs([]);
    }
  };

  // Status badge styling helper
  // Visit-level badge: the status, plus a "report overdue" flag once the visit day has passed unreported.
  const getVisitBadges = (v: any) => (
    <>
      {getStatusBadge(v.status)}
      {isReportOverdue(v) && (
        <Badge variant="urgent" size="sm" title="The visit day has passed: submit the post-visit report, reschedule or cancel it.">
          REPORT OVERDUE
        </Badge>
      )}
    </>
  );
  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return <Badge variant="success" size="sm">COMPLETED</Badge>;
      case 'cancelled':
        return <Badge variant="danger" size="sm">CANCELLED</Badge>;
      case 'rescheduled':
        return <Badge variant="warning" size="sm">RESCHEDULED</Badge>;
      case 'modified':
        return <Badge variant="info" size="sm">MODIFIED</Badge>;
      case 'not_completed':
        return <Badge variant="warning" size="sm">CONTACT UNAVAILABLE</Badge>;
      default:
        return <Badge variant="info" size="sm">PLANNED</Badge>;
    }
  };

  const hasActiveFilters = Boolean(
    filterSearch || filterStatus || filterEmployee || filterDateFrom || filterDateTo || filterTravelOnly || filterDemoOnly,
  );
  const handleClearFilters = () => {
    setFilterSearch('');
    setAppliedSearch('');
    setFilterStatus('');
    setFilterEmployee('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterTravelOnly(false);
    setFilterDemoOnly(false);
  };

  // Which filters the current view uses: the visit list uses all of them; the team activity board is fetched with
  // status, team member and dates only; trips, customer timeline and employee activity ignore them.
  const isVisitList = activeTab === 'my_visits';
  const isTeamView = activeTab === 'manager_dashboard';
  const showListFilters = isVisitList || isTeamView;
  const datesActive = Boolean(filterDateFrom || filterDateTo);
  const requirementsActive = filterTravelOnly || filterDemoOnly;
  const moreActive = (isVisitList && requirementsActive ? 1 : 0) + (datesActive ? 1 : 0);
  const viewHasActiveFilters = isVisitList
    ? hasActiveFilters
    : isTeamView && Boolean(filterStatus || filterEmployee || datesActive);
  const canSeeTeamActivity = hasRole(['management', 'regional_manager', 'admin']);
  // The "Today's Visits" card's filter is on
  const todayFilterOn = filterStatus === 'open' && filterDateFrom === istToday() && filterDateTo === istToday();
  const viewOptions: FilterMenuOption[] = [
    {
      key: 'my_visits',
      // The list is scoped by role on the API: everyone's for management/admin, the territory's for an RM
      label: hasRole(['management', 'admin']) ? 'All visits' : hasRole('regional_manager') ? 'Territory visits' : 'My visits',
      icon: <Calendar />,
      count: visitsTotal || undefined,
    },
    ...(canSeeTeamActivity ? [{ key: 'manager_dashboard', label: 'Team activity', icon: <Shield /> }] : []),
    { key: 'trips', label: 'Trips & multi-stop plans', icon: <Route />, count: trips.length || undefined },
    { key: 'customer_history', label: 'Customer timeline', icon: <Building /> },
    { key: 'employee_activity', label: 'Employee activity', icon: <History /> },
  ].map((o) => ({
    ...o,
    active: activeTab === o.key,
    onSelect: () => setActiveTab(o.key as typeof activeTab),
  }));

  // ── Calendar / Upcoming / Past ──
  const visitTone = (v: any): VisitTone =>
    v.status === 'cancelled' ? 'cancelled' : v.status === 'completed' || v.status === 'not_completed' ? 'done' : isReportOverdue(v) ? 'overdue' : 'upcoming';
  const upcomingVisits = useMemo(
    () =>
      visits
        .filter((v) => isActiveVisitStatus(v.status) && (calendarDay(v.planned_date) || '') >= istToday())
        .sort((a, b) => `${calendarDay(a.planned_date)} ${a.start_time || ''}`.localeCompare(`${calendarDay(b.planned_date)} ${b.start_time || ''}`)),
    [visits],
  );
  const pastVisits = useMemo(
    () =>
      visits
        .filter((v) => !upcomingVisits.includes(v))
        .sort((a, b) => `${calendarDay(b.planned_date)} ${b.start_time || ''}`.localeCompare(`${calendarDay(a.planned_date)} ${a.start_time || ''}`)),
    [visits, upcomingVisits],
  );
  // Team activity cards can open visits outside the (filtered) visit list
  const openVisit = openVisitId
    ? visits.find((v) => v.id === openVisitId) ||
      Object.values(managerData?.grouped ?? {}).flat().find((v: any) => v.id === openVisitId) ||
      null
    : null;
  const visitToneById = useMemo(() => new Map(visits.map((v) => [v.id, visitTone(v)])), [visits]);

  // The manager's "also-meet" note on a visit
  const renderDirective = (v: any) => (
    <>
    {/* Manager "Also-Meet" Banner Callout */}
    {(v.manager_assigned || v.remarks?.includes('Manager Directive') || v.remarks?.includes('Manager Intervention')) && (
      <div className="p-3.5 rounded-xl bg-[#FFF8EB] border border-[#E9C9B4] text-xs text-[#7C2D12] flex items-start space-x-3 shadow-xs">
        <Sparkles className="h-4 w-4 text-[#9A3412] shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-[#7C2D12] uppercase tracking-wider block text-[10px]">
            REGIONAL MANAGER STRATEGIC "ALSO-MEET" DIRECTIVE:
          </span>
          <p className="mt-0.5 font-medium leading-relaxed">
            {v.remarks}
          </p>
        </div>
      </div>
    )}
    </>
  );
  // Everything one post-visit report recorded
  const renderReportBody = (r: any) => {
    const fact = (label: string, value: React.ReactNode) =>
      value ? (
        <div className="min-w-0">
          <span className="font-bold text-[#14213D]">{label}: </span>
          <span className="break-words">{value}</span>
        </div>
      ) : null;
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {fact('Meeting', r.met_completed === false ? 'Not held / contact not met' : 'Held')}
          {fact('Person met', r.person_met)}
          {fact('Outcome', r.outcome && <span className="font-semibold text-[#0B4A4E]">{r.outcome}</span>)}
          {fact('Product discussed', r.product_discussed)}
          {fact('Opportunity', r.opportunity)}
          {fact('Next action', r.next_action)}
          {r.tender_opportunity && (
            <div className="col-span-full">
              <span className="font-bold text-[#0F5E63]">Tender / GeM Bid: </span>
              <span className="font-mono text-[#0F5E63] bg-[#E3EFEE] px-2 py-0.5 rounded text-[11px] font-semibold border border-[#DCD8CE]">
                {r.tender_opportunity}
              </span>
            </div>
          )}
          {r.demo_required && (
            <div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F5E63] bg-[#E3EFEE] px-2 py-0.5 rounded-full border border-[#DCD8CE]">
                <Sparkles className="h-3 w-3" /> Technical Demo Requested
              </span>
            </div>
          )}
        </div>
        {r.discussion && (
          <p className="whitespace-pre-wrap break-words text-[#14213D] border-l-2 border-[#0F5E63] pl-2 mt-1.5">
            <span className="font-bold not-italic">Discussion: </span>
            {r.discussion}
          </p>
        )}
        {r.remarks && (
          <p className="whitespace-pre-wrap break-words text-xs text-[#4A5568] bg-white p-2 rounded border border-[#DCD8CE] mt-1">
            <span className="font-bold text-[#14213D]">Field Remarks: </span>{r.remarks}
          </p>
        )}
        {r.followup_date && (
          <div className="text-[11px] text-[#0F5E63] font-semibold flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3" />
            Next Follow-up Commitment: {formatDateIN(r.followup_date)}
          </div>
        )}
      </div>
    );
  };
  const reportByline = (r: any) =>
    [r.updated_by_name && `by ${r.updated_by_name}`, r.created_at && formatDateTimeIN(r.created_at)].filter(Boolean).join(' · ');
  // The post-visit report(s) the field team submitted: the latest in full, earlier ones underneath
  const renderReport = (v: any) => {
    const [latest, ...earlier] = v.updates ?? [];
    if (!latest) return null;
    return (
      <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-[#14213D] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="font-bold text-[#0F5E63] uppercase tracking-wider text-[10px] flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#0F5E63]" />
            Post-visit report submitted
          </span>
          <span className="text-[10px] text-[#4A5568]">{reportByline(latest)}</span>
        </div>
        {renderReportBody(latest)}
        {earlier.length > 0 && (
          <details className="border-t border-[#ECE9E2] pt-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-[#0F5E63]">
              Earlier submissions ({earlier.length})
            </summary>
            <div className="mt-2 space-y-3">
              {earlier.map((r: any) => (
                <div key={r.id} className="rounded-lg border border-[#ECE9E2] bg-white p-2.5 space-y-1.5">
                  <div className="text-[10px] text-[#4A5568]">{reportByline(r)}</div>
                  {renderReportBody(r)}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  };

  const visitDayParts = (v: any) => {
    const d = calendarDay(v.planned_date) || '';
    const dt = d ? new Date(`${d}T00:00:00Z`) : null;
    return {
      weekday: dt ? dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }) : '',
      day: d ? Number(d.slice(8)) : '',
      month: dt ? dt.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) : '',
    };
  };
  const visitTime = (v: any) => (v.start_time ? `${String(v.start_time).slice(0, 5)}${v.end_time ? ` – ${String(v.end_time).slice(0, 5)}` : ''}` : 'All day');
  const canReport = (v: any) => isActiveVisitStatus(v.status) && !isFutureVisit(v) && canFileReport(v);

  // One compact row per visit; the whole row opens the visit
  const renderVisitRow = (v: any) => {
    const parts = visitDayParts(v);
    const report = v.updates?.[0];
    return (
      <li key={v.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpenVisitId(v.id)}
          onKeyDown={(e) => e.key === 'Enter' && setOpenVisitId(v.id)}
          className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-[#DCD8CE] bg-white p-3 transition-colors hover:border-[#0F5E63] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30"
        >
          <div className="w-12 shrink-0 rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] py-1 text-center">
            <div className="text-[10px] font-semibold uppercase text-[#4A5568]">{parts.weekday}</div>
            <div className="font-mono text-lg font-bold leading-none text-[#14213D]">{parts.day}</div>
            <div className="text-[10px] text-[#4A5568]">{parts.month}</div>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-[#14213D]">{v.organisation_name || 'Client agency'}</span>
              {getVisitBadges(v)}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#4A5568]">
              <span className="inline-flex items-center gap-1 font-mono text-[#14213D]">
                <Clock className="h-3 w-3" />
                {visitTime(v)}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{v.location || '—'}</span>
              </span>
              {isManagerRole && v.assignee_name && <span>{v.assignee_name}</span>}
            </div>
            {report ? (
              <p className="line-clamp-1 text-xs text-[#14213D]">
                <span className="font-semibold text-[#0F5E63]">Outcome: </span>
                {report.outcome || 'Completed'}
                {report.person_met ? ` · met ${report.person_met}` : ''}
              </p>
            ) : (
              v.purpose && <p className="line-clamp-1 text-xs text-[#14213D]">{v.purpose}</p>
            )}
          </div>
          {canReport(v) && (
            <Button
              size="sm"
              variant={isReportOverdue(v) ? 'primary' : 'secondary'}
              className="shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                openReport(v);
              }}
            >
              Submit report
            </Button>
          )}
        </div>
      </li>
    );
  };

  // The visits as records for List / Cards / Board (Calendar uses the visits directly)
  const visitItems: RecordItem[] = visits.map((v) => {
    const tone = visitToneById.get(v.id) || 'upcoming';
    const report = v.updates?.[0];
    return {
      key: v.id,
      title: v.organisation_name || 'Client agency',
      subtitle: [visitTime(v), v.location].filter(Boolean).join(' · '),
      status: { label: VISIT_LANES.find((l) => l.key === tone)!.label, tone: VISIT_LANES.find((l) => l.key === tone)!.tone },
      badges: [
        v.travel_required && { label: 'Travel', tone: 'info' as const },
        v.demo_required && { label: v.linked_demo_no ? `Demo ${v.linked_demo_no}` : 'Demo', tone: 'info' as const },
        v.manager_assigned && { label: 'Manager assigned', tone: 'warning' as const },
      ].filter(Boolean) as RecordItem['badges'],
      due: { date: v.planned_date, label: 'Visit', done: tone !== 'upcoming' && tone !== 'overdue' },
      owner: v.assignee_name,
      facts: [
        report ? { label: 'Outcome', value: report.outcome || 'Completed' } : v.purpose && { label: 'Purpose', value: v.purpose },
        (v.contact_name || v.contact_person) && { label: 'Contact', value: v.contact_name || v.contact_person },
        v.product_name && { label: 'Product', value: v.product_name },
      ].filter(Boolean) as RecordItem['facts'],
      primary: canReport(v) ? { label: 'Submit report', onClick: () => openReport(v) } : undefined,
      onOpen: () => setOpenVisitId(v.id),
    };
  });

  // ── Row action openers (shared by "My Visits" and manager tables) ──
  const openAlsoMeet = (v: any) => {
    setSelectedVisit(v);
    const directiveText = v.remarks?.includes('Manager Intervention / Directive:')
      ? v.remarks.split('Manager Intervention / Directive:')[1].trim()
      : v.remarks?.includes('Manager Directive:')
      ? v.remarks.split('Manager Directive:')[1].trim()
      : v.remarks?.includes('Manager Intervention:')
      ? v.remarks.split('Manager Intervention:')[1].trim()
      : '';
    setAlsoMeetData({
      instructions: directiveText,
      assign_additional: false,
      organisation_id: '',
      location: v.location || '',
      contact_person: '',
      purpose: 'Strategic procurement review / GeM requirements',
      start_time: '14:30',
      end_time: '16:00',
    });
    setIsAlsoMeetOpen(true);
  };
  const openReport = (v: any) => {
    if (isFutureVisit(v)) return; // reported on or after the visit day only
    setSelectedVisit(v);
    setReportData({
      met_completed: true,
      person_met: '',
      discussion: '',
      product_discussed: v.product_name || '',
      outcome: '',
      opportunity: '',
      tender_opportunity: '',
      demo_required: v.demo_required || false,
      next_action: '',
      followup_date: '',
      remarks: '',
    });
    setIsReportOpen(true);
  };
  const openReschedule = (v: any) => {
    setSelectedVisit(v);
    setRescheduleData({
      new_date: v.planned_date,
      start_time: v.start_time || '',
      end_time: v.end_time || '',
      reason: '',
    });
    setIsRescheduleOpen(true);
  };
  const openDestination = (v: any) => {
    setSelectedVisit(v);
    setNewDestination({ new_location: v.location || '', reason: '' });
    setIsDestinationOpen(true);
  };
  const openCancel = (v: any) => {
    setSelectedVisit(v);
    setCancelReason('');
    setIsCancelOpen(true);
  };

  const fmtDate = (d: any) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
  const isActiveVisit = (v: any) => ['planned', 'modified', 'rescheduled'].includes(v.status);
  const isManagerRole = hasRole(['management', 'regional_manager', 'admin']);

  // Click anywhere on the card (except its own links / buttons) to open the visit and its full report
  const renderManagerVisitCard = (v: any) => (
    <div
      key={v.id}
      role="button"
      tabIndex={0}
      aria-label={`Open visit to ${v.organisation_name || 'customer'}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return;
        if (window.getSelection()?.toString()) return;
        setOpenVisitId(v.id);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && setOpenVisitId(v.id)}
      className="p-4 bg-white border border-[#DCD8CE] rounded-xl hover:border-[#0F5E63] transition-all shadow-2xs space-y-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30"
    >
      {/* Top row: Organisation, Tour tag, Requirement badges, Status */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-[#ECE9E2] pb-2.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {v.organisation_id ? (
              <GuardedLink href={`/leads?customer=${v.organisation_id}`} className="font-extrabold text-[#14213D] text-base hover:underline hover:text-[#0F5E63]" title="Open Customer 360">
                {v.organisation_name}
              </GuardedLink>
            ) : (
              <span className="font-extrabold text-[#14213D] text-base">{v.organisation_name}</span>
            )}
            {v.trip_base_location && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3] flex items-center gap-1">
                <Route className="h-3 w-3" />
                Tour: {v.trip_base_location}
              </span>
            )}
            {v.travel_required && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3] flex items-center gap-1">
                <Compass className="h-3 w-3" />
                Travel Required
              </span>
            )}
            {v.demo_required && (
              <div className="flex items-center gap-1.5">
                {v.linked_demo_no ? (
                  <GuardedLink
                    href={v.linked_demo_id ? `/demos?open=${v.linked_demo_id}` : `/demos`}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/25 hover:underline flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Linked Demo: {v.linked_demo_no}
                  </GuardedLink>
                ) : (
                  <GuardedLink
                    href={`/demos`}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FFF8EB] text-[#7C2D12] border border-[#E9C9B4] hover:bg-[#FBEBDD] flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Demo Required • Request Demo
                  </GuardedLink>
                )}
              </div>
            )}
          </div>

          {/* Key metadata row: Location, Date & Time, Assigned Officer, Contact Person */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4A5568] mt-1.5">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
              <span className="font-medium text-[#14213D]">{v.location || 'HQ Station'}</span>
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
              <span>
                {new Date(v.planned_date).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
                {v.start_time ? ` (${v.start_time}${v.end_time ? ` - ${v.end_time}` : ''})` : ''}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
              <span>Officer: <strong className="text-[#14213D]">{v.assignee_name || 'Sales Staff'}</strong></span>
            </span>
            {(v.contact_name || v.contact_person) && (
              <span className="flex items-center gap-1 text-[#0F5E63]">
                <Users className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                <span>Contact: <strong className="text-[#14213D]">{v.contact_name || v.contact_person}</strong></span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {getVisitBadges(v)}
        </div>
      </div>

      {/* Purpose & Product/Outcome 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="p-2.5 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]/60 space-y-1">
          <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">Visit Purpose</span>
          <p className="text-[#14213D] font-medium">{v.purpose || 'Portfolio review & client engagement'}</p>
        </div>

        <div className="p-2.5 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]/60 space-y-1">
          <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">Product & Expected Outcome</span>
          <div className="flex items-center gap-1.5 text-[#14213D] font-medium">
            <Layers className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
            <span>{v.product_name || 'General Defence Portfolio'}</span>
          </div>
          {v.expected_outcome && (
            <p className="text-[#4A5568] text-[11px] italic mt-0.5">
              Outcome: {v.expected_outcome}
            </p>
          )}
        </div>
      </div>

      {/* Submitted report at a glance; the card opens it in full */}
      {v.updates?.[0] && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#D0E5E3] bg-[#E3EFEE] px-3 py-2 text-xs text-[#0B4A4E]">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
          <span className="font-bold">Report submitted</span>
          {v.updates[0].outcome && <span className="min-w-0 truncate">Outcome: {v.updates[0].outcome}</span>}
          <span className="text-[11px] text-[#4A5568]">{reportByline(v.updates[0])}</span>
          <span className="ml-auto font-semibold text-[#0F5E63]">View full report →</span>
        </div>
      )}

      {/* Remarks & Manager Directives / Change Reasons */}
      {(v.remarks || v.change_reason) && (
        <div className="text-xs space-y-1">
          {v.remarks && (
            <div className="p-2 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE] text-[#14213D] flex items-start gap-1.5">
              <FileText className="h-3.5 w-3.5 text-[#6B7280] mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-[#14213D]">Remarks: </span>
                <span>{v.remarks}</span>
              </div>
            </div>
          )}
          {v.change_reason && (
            <div className="p-2 bg-[#FFF8EB] rounded-lg border border-[#E9C9B4] text-[#7C2D12] flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-[#9A3412] mt-0.5 shrink-0" />
              <div>
                <span className="font-bold">Schedule Change: </span>
                <span>{v.change_reason}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manager Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#ECE9E2]">
        <div className="text-[11px] text-[#4A5568]">
          Visit ID: <span className="font-mono text-[#4A5568] font-semibold">{v.id.slice(0, 8)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedVisit(v);
              const directiveText = v.remarks?.includes('Manager Intervention / Directive:')
                ? v.remarks.split('Manager Intervention / Directive:')[1].trim()
                : v.remarks?.includes('Manager Directive:')
                ? v.remarks.split('Manager Directive:')[1].trim()
                : v.remarks?.includes('Manager Intervention:')
                ? v.remarks.split('Manager Intervention:')[1].trim()
                : '';
              setAlsoMeetData({
                instructions: directiveText,
                assign_additional: false,
                organisation_id: '',
                location: v.location || '',
                contact_person: '',
                purpose: 'Strategic procurement review / GeM requirements',
                start_time: '14:30',
                end_time: '16:00',
              });
              setIsAlsoMeetOpen(true);
            }}
            className="border-[#E9C9B4] text-[#7C2D12] hover:bg-[#FFF8EB] text-xs"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1 text-[#7C2D12]" />
            <span>Also-Meet Directive</span>
          </Button>

          {['planned', 'modified', 'rescheduled'].includes(v.status) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedVisit(v);
                setRescheduleData({
                  new_date: v.planned_date,
                  start_time: v.start_time || '',
                  end_time: v.end_time || '',
                  reason: '',
                });
                setIsRescheduleOpen(true);
              }}
              className="text-[#0F5E63] text-xs"
            >
              <span>Reschedule</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <PageContainer>
      {/* ── TOP HERO BANNER: VISIT & FIELD PLANNING ── */}
      <PageHeader
        icon={<Calendar className="h-7 w-7 text-[#0F5E63]" />}
        title="Field Visits & Tour Operations"
        actions={
          <>
            <Button
              onClick={() => setIsCreateTripOpen(true)}
              variant="outline"
              className="border-[#DCD8CE] text-[#0F5E63] hover:bg-[#FBFAF7] shadow-xs"
            >
              <Car className="h-4 w-4 mr-1.5" />
              <span>New Tour Program</span>
            </Button>

            <Button
              onClick={() => {
                const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
                const defaultOfficer = (user?.id && UUID_REGEX.test(user.id))
                  ? user.id
                  : (usersList.find((u) => u.id && UUID_REGEX.test(u.id))?.id || '');
                setNewVisit((prev) => ({ ...prev, assigned_to: isSalesRole ? defaultOfficer : prev.assigned_to || defaultOfficer }));
                setIsScheduleOpen(true);
              }}
              variant="primary"
              className="shadow-xs"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span>Plan Field Visit</span>
            </Button>
          </>
        }
      />

      {/* KPI Cards — one row */}
      <StatGrid cols={4} className="gap-3">
        <StatCard
          label="Total Field Visits"
          value={stats.total}
          subtext="Scheduled itineraries"
          icon={<CalendarDays className="h-4 w-4 text-[#0F5E63]" />}
        />

        <StatCard
          label="Today's Visits"
          value={stats.today}
          valueColor="emerald"
          subtext="Open visits planned today"
          icon={<Clock className="h-4 w-4 text-[#0F5E63]" />}
          className={todayFilterOn ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => {
            // Same rule as the count: open visits (planned / modified / rescheduled) planned for today (IST)
            if (!todayFilterOn && !showListFilters) setActiveTab('my_visits');
            const today = istToday();
            setFilterStatus(todayFilterOn ? '' : 'open');
            setFilterDateFrom(todayFilterOn ? '' : today);
            setFilterDateTo(todayFilterOn ? '' : today);
          }}
        />

        <StatCard
          label="Manager Directives"
          value={stats.directives}
          valueColor="amber"
          subtext='"Also-Meet" strategic guidance'
          icon={<Sparkles className="h-4 w-4 text-[#9A3412]" />}
        />

        <StatCard
          label="Completed Reports"
          value={stats.completed}
          valueColor="primary"
          subtext="Intelligence & outcomes logged"
          icon={<CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />}
          className={filterStatus === 'completed' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => {
            // The status filter only applies to the visit list / team activity, so jump to the list from other views.
            if (filterStatus !== 'completed' && !showListFilters) setActiveTab('my_visits');
            setFilterStatus(filterStatus === 'completed' ? '' : 'completed');
          }}
        />
      </StatGrid>

      {/* One filter row: View first (it is the page navigation), then only the controls the current view uses. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu label="View" icon={<LayoutList />} neutralKeys={[]} options={viewOptions} />

          {isVisitList && (
            <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
              <input
                type="search"
                aria-label="Search field visits"
                placeholder="Search organisation, city, officer, purpose… (Enter)"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setAppliedSearch(filterSearch.trim());
                }}
                className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
              />
            </div>
          )}

          {showListFilters && (
            <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
              <FilterMenu
                label="Status"
                icon={<Layers />}
                neutralKeys={['']}
                options={[
                  { key: '', label: 'All statuses' },
                  { key: 'planned', label: 'Planned' },
                  { key: 'modified', label: 'Modified' },
                  { key: 'rescheduled', label: 'Rescheduled' },
                  { key: 'open', label: 'Open (not yet reported)' },
                  { key: 'overdue', label: 'Report overdue', count: stats.overdue || undefined },
                  { key: 'completed', label: 'Completed', count: stats.completed },
                  { key: 'not_completed', label: 'Not completed' },
                  { key: 'cancelled', label: 'Cancelled' },
                ].map((o) => ({
                  ...o,
                  active: filterStatus === o.key,
                  onSelect: () => setFilterStatus(o.key),
                }))}
              />
              {canSeeTeamActivity && (
                <FilterMenu
                  label="Team member"
                  icon={<Users />}
                  className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                  options={[{ id: '', full_name: 'All team members', role: '' }, ...usersList].map((u: any) => ({
                    key: u.id || 'all',
                    label: u.role ? `${u.full_name} (${u.role})` : u.full_name,
                    active: filterEmployee === u.id,
                    onSelect: () => setFilterEmployee(u.id),
                  }))}
                />
              )}
              {/* Visit list: "More" holds requirements + planned dates. Team activity is not filtered by requirements, so it only gets "Dates". */}
              <button
                type="button"
                onClick={() => setIsDateFilterOpen((prev) => !prev)}
                aria-expanded={isDateFilterOpen}
                className={`filter-menu-btn ${isDateFilterOpen || moreActive > 0 ? 'filter-menu-btn--on' : ''}`}
              >
                {isVisitList ? <SlidersHorizontal className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
                <span>{isVisitList ? 'More' : 'Dates'}</span>
                {moreActive > 0 && <span className="filter-menu-chip">{isVisitList ? moreActive : 'On'}</span>}
              </button>
              {viewHasActiveFilters && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleClearFilters}
                  className="text-xs text-[#4A5568] hover:text-[#881337]"
                >
                  Clear
                </Button>
              )}
            </div>
          )}

          {activeTab === 'customer_history' && (
            <FilterMenu
              label="Customer"
              icon={<Building />}
              neutralKeys={[]}
              className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
              options={organisations.map((o) => ({
                key: o.id,
                label: `${o.name} (${o.city || 'State'})`,
                active: selectedOrgId === o.id,
                onSelect: () => setSelectedOrgId(o.id),
              }))}
            />
          )}
        </div>

        {showListFilters && isDateFilterOpen && (
          <div className="flex flex-wrap items-center gap-3 border-t border-[#ECE9E2] pt-2.5 text-xs">
            {isVisitList && (
              <FilterMenu
                label="Requirements"
                icon={<Car />}
                neutralKeys={['any']}
                options={[
                  { key: 'any', label: 'Any requirement', travel: false, demo: false },
                  { key: 'travel', label: 'Travel required', travel: true, demo: false },
                  { key: 'demo', label: 'Demo required', travel: false, demo: true },
                  { key: 'both', label: 'Travel + demo required', travel: true, demo: true },
                ].map(({ travel, demo, ...o }) => ({
                  ...o,
                  active: filterTravelOnly === travel && filterDemoOnly === demo,
                  onSelect: () => {
                    setFilterTravelOnly(travel);
                    setFilterDemoOnly(demo);
                  },
                }))}
              />
            )}
            <span className="font-semibold text-[#4A5568]">Planned date</span>
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
            {moreActive > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFilterDateFrom('');
                  setFilterDateTo('');
                  if (isVisitList) {
                    setFilterTravelOnly(false);
                    setFilterDemoOnly(false);
                  }
                }}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* TAB CONTENT: MY VISITS */}
      {activeTab === 'my_visits' && (
        <div className="space-y-3.5">
          {!visitsLoading && stats.overdue > 0 && filterStatus !== 'overdue' && (
            <InfoCallout variant="warning" title={`${stats.overdue} visit report${stats.overdue === 1 ? '' : 's'} overdue`}>
              {stats.overdue === 1 ? 'A visit' : 'Some visits'} dated before today {stats.overdue === 1 ? 'is' : 'are'} still open.{' '}
              {hasRole('management')
                ? 'The assigned officer has not submitted the post-visit report yet.'
                : 'Submit the post-visit report, or reschedule / cancel the visit.'}{' '}
              <button type="button" className="font-bold text-[#0F5E63] hover:underline" onClick={() => setFilterStatus('overdue')}>
                Show overdue
              </button>
            </InfoCallout>
          )}
          {visitsLoading ? (
            <PageLoader label="Loading field visits" />
          ) : visits.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
              No field visits match the active filters.
            </div>
          ) : (
            <>
              {/* Same view switch as the other registers (List · Cards · Board) plus the visit calendar */}
              <RecordViews
                storageKey="visits"
                defaultView="calendar"
                items={visitItems}
                lanes={VISIT_LANES}
                laneOf={(i) => visitToneById.get(i.key) || 'upcoming'}
                list={<ul className="space-y-2">{[...upcomingVisits, ...pastVisits].map(renderVisitRow)}</ul>}
                calendar={<VisitCalendar visits={visits} toneOf={visitTone} onOpen={(v) => setOpenVisitId(v.id)} />}
                onLoadMore={visitsList.loadMore}
                hasMore={visitsList.hasMore}
                loadingMore={visitsList.loadingMore}
                summary={
                  <>
                    {visits.length < visitsTotal && <><span className="font-mono font-semibold text-[#14213D]">{visits.length}</span> of </>}
                    <span className="font-mono font-semibold text-[#14213D]">{visitsTotal}</span> visits · {stats.upcoming} upcoming
                    {stats.overdue ? <span className="font-semibold text-[#9A3412]"> · {stats.overdue} report{stats.overdue === 1 ? '' : 's'} overdue</span> : null}
                  </>
                }
                empty="No field visits match the active filters."
              />
            </>
          )}
        </div>
      )}

      {/* TAB CONTENT: MANAGER DASHBOARD (TEAM FIELD ACTIVITY) */}
      {activeTab === 'manager_dashboard' && managerData && (
        <div className="space-y-6">
          {/* Summary counters banner - Light Executive */}
          <div className="p-4 bg-[#E3EFEE] border border-[#DCD8CE] rounded-xl shadow-xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Team Field Deployment Horizon</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <CountUp as="span" className="text-2xl font-black text-[#14213D]">{managerData.summary?.todayCount || 0}</CountUp>
                <span className="block text-xs text-[#4A5568]">Deployed Today</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <CountUp as="span" className="text-2xl font-black text-[#14213D]">{managerData.summary?.tomorrowCount || 0}</CountUp>
                <span className="block text-xs text-[#4A5568]">Tomorrow</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <CountUp as="span" className="text-2xl font-black text-[#14213D]">{managerData.summary?.next7DaysCount || 0}</CountUp>
                <span className="block text-xs text-[#4A5568]">Next 7 Days (1-Wk Cycle)</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <CountUp as="span" className="text-2xl font-black text-[#14213D]">{managerData.summary?.laterCount || 0}</CountUp>
                <span className="block text-xs text-[#4A5568]">Later</span>
              </div>
            </div>
          </div>

          {/* Past visits still waiting for their report */}
          {managerData.grouped?.overdue?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#7C2D12] bg-[#FBEBDD] px-3 py-1.5 rounded-lg border border-[#E9C9B4] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Report Overdue ({managerData.grouped.overdue.length})</span>
                </span>
                <span className="text-xs font-medium text-[#7C2D12]">Visit day passed, no report</span>
              </h3>
              {managerData.grouped.overdue.map((v: any) => renderManagerVisitCard(v))}
            </div>
          )}

          {/* Past visits the team has reported on, newest first */}
          {(() => {
            const reported = [...(managerData.grouped?.past ?? []), ...(managerData.grouped?.today ?? [])]
              .filter((v: any) => v.updates?.length > 0)
              .sort((a: any, b: any) => String(b.updates[0].created_at).localeCompare(String(a.updates[0].created_at)));
            return (
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-[#0B4A4E] bg-[#E3EFEE] px-3 py-1.5 rounded-lg border border-[#D0E5E3] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Reports Submitted by Team ({reported.length})</span>
                  </span>
                  <span className="text-xs font-medium text-[#0B4A4E]">Click a visit for the full report</span>
                </h3>
                {reported.length === 0 ? (
                  <p className="text-xs text-[#4A5568] italic p-3 bg-white rounded-lg border border-[#DCD8CE]">No post-visit reports submitted yet.</p>
                ) : (
                  reported.map((v: any) => renderManagerVisitCard(v))
                )}
              </div>
            );
          })()}

          {/* Group 1: Today */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0B4A4E] bg-[#E3EFEE] px-3 py-1.5 rounded-lg border border-[#D0E5E3] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Today's Deployed Operations ({managerData.grouped?.today?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-[#0B4A4E]">Live Field Status</span>
            </h3>
            {(!managerData.grouped?.today || managerData.grouped?.today?.length === 0) ? (
              <p className="text-xs text-[#4A5568] italic p-3 bg-white rounded-lg border border-[#DCD8CE]">No field visits scheduled for today.</p>
            ) : (
              managerData.grouped?.today?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>

          {/* Group 2: Tomorrow */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0B4A4E] bg-[#E3EFEE] px-3 py-1.5 rounded-lg border border-[#D0E5E3] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <span>Tomorrow's Deployments ({managerData.grouped?.tomorrow?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-[#0B4A4E]">Departure Readiness</span>
            </h3>
            {(!managerData.grouped?.tomorrow || managerData.grouped?.tomorrow?.length === 0) ? (
              <p className="text-xs text-[#4A5568] italic p-3 bg-white rounded-lg border border-[#DCD8CE]">No field visits scheduled for tomorrow.</p>
            ) : (
              managerData.grouped?.tomorrow?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>

          {/* Group 3: Next 7 Days */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0B4A4E] bg-[#E3EFEE] px-3 py-1.5 rounded-lg border border-[#D0E5E3] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>Next 7 Days Field Schedule ({managerData.grouped?.next_7_days?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-[#0B4A4E]">Pre-Planned Horizon</span>
            </h3>
            {(!managerData.grouped?.next_7_days || managerData.grouped?.next_7_days?.length === 0) ? (
              <p className="text-xs text-[#4A5568] italic p-3 bg-white rounded-lg border border-[#DCD8CE]">No field visits scheduled for the next 7 days.</p>
            ) : (
              managerData.grouped?.next_7_days?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>

          {/* Group 4: Later / Future Deployments */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#14213D] bg-[#EEF1F5] px-3 py-1.5 rounded-lg border border-[#DCD8CE] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Route className="h-3.5 w-3.5" />
                <span>Later & Long-Range Tour Programs ({managerData.grouped?.later?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-[#14213D]">Future Calendar</span>
            </h3>
            {(!managerData.grouped?.later || managerData.grouped?.later?.length === 0) ? (
              <p className="text-xs text-[#4A5568] italic p-3 bg-white rounded-lg border border-[#DCD8CE]">No long-range visits scheduled beyond 7 days.</p>
            ) : (
              managerData.grouped?.later?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: TRIPS & MULTI-STOP PLANS */}
      {activeTab === 'trips' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#4A5568]">
              Multi-stop tour programs. Managers can optimize trips by adding adjacent client visits to save travel overhead.
            </p>
            <Button size="sm" onClick={() => setIsCreateTripOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              <span>New Tour Program</span>
            </Button>
          </div>

          {trips.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
              No tour programs planned yet. Create one to organize multi-stop customer visits.
            </div>
          ) : (
            trips.map((t) => (
              <div key={t.id} className="p-5 bg-white border border-[#DCD8CE] rounded-xl shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#ECE9E2] pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="info" size="sm">TRIP</Badge>
                      <span className="text-base font-bold text-[#14213D]">
                        {t.base_location} Tour
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[#4A5568]">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(t.trip_date).toLocaleDateString('en-IN', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        Officer: {t.employee_name}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasRole(['management', 'regional_manager', 'admin']) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedTrip(t);
                          setTripVisit({
                            organisation_id: '',
                            location: t.base_location,
                            start_time: '14:00',
                            end_time: '15:30',
                            purpose: '',
                            instructions: '',
                            reason: 'Customer is in the same operational area',
                          });
                          setIsAddTripVisitOpen(true);
                        }}
                        className="border-[#D0E5E3] text-[#0B4A4E] hover:bg-[#E3EFEE]"
                      >
                        <Navigation className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                        <span>+ Add Customer Visit to Trip</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Tree Structure of Visits */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider block">
                    Planned Stop Itinerary ({t.visits?.length || 0} visits)
                  </span>

                  {(!t.visits || t.visits.length === 0) ? (
                    <p className="text-xs text-[#6B7280] italic">No visits currently attached to this tour.</p>
                  ) : (
                    t.visits.map((tv: any, idx: number) => (
                      <div
                        key={tv.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="h-6 w-6 rounded-full bg-[#0F5E63] text-white flex items-center justify-center font-bold text-[10px]">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#14213D]">{tv.organisation_name}</span>
                              {tv.manager_assigned && (
                                <Badge variant="warning" size="sm" className="text-[9px] py-0">
                                  MANAGER DIRECTIVE
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-[#4A5568] flex items-center gap-2 mt-0.5">
                              <span>{tv.location}</span>
                              <span>•</span>
                              <span>{tv.start_time ? `${tv.start_time} - ${tv.end_time || ''}` : 'Slot TBD'}</span>
                              {tv.purpose && <span>• Purpose: {tv.purpose}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {getStatusBadge(tv.status)}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenAudit(tv)}
                            className="text-[#6B7280] hover:text-[#14213D]"
                          >
                            <History className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB CONTENT: CUSTOMER TIMELINE */}
      {activeTab === 'customer_history' && (
        <div className="space-y-4">
          <div className="space-y-3">
            {selectedOrgHistory.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
                No past field visits or interactions recorded for this customer.
              </div>
            ) : (
              selectedOrgHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="info" size="sm">VISIT RECORD</Badge>
                      <span className="text-xs font-bold text-[#14213D]">
                        {new Date(item.planned_date).toLocaleDateString('en-IN', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    {getStatusBadge(item.status)}
                  </div>

                  <div className="text-xs text-[#14213D] grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[#FBFAF7] p-2.5 rounded-lg">
                    <div>
                      <span className="font-semibold text-[#4A5568]">Officer Met:</span> {item.person_met || 'N/A'}
                    </div>
                    <div>
                      <span className="font-semibold text-[#4A5568]">Field Staff:</span> {item.employee_name || 'Staff'}
                    </div>
                    <div>
                      <span className="font-semibold text-[#4A5568]">Outcome:</span> {item.post_visit_outcome || item.expected_outcome || 'N/A'}
                    </div>
                  </div>

                  {item.discussion && (
                    <p className="text-xs text-[#14213D] pt-1">
                      <span className="font-bold text-[#4A5568]">Discussion Notes:</span> {item.discussion}
                    </p>
                  )}

                  {item.followup_date && (
                    <div className="text-[11px] text-[#0B4A4E] font-semibold flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Follow-up Commitment: {formatDateIN(item.followup_date)}
                      {item.next_action ? ` (${item.next_action})` : ''}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: EMPLOYEE ACTIVITY DOSSIER */}
      {activeTab === 'employee_activity' && (
        <div className="space-y-4">
          <div className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Field Performance & Activity Log</h3>
            <p className="text-xs text-[#4A5568] mt-0.5">Chronological record of verified customer engagements and milestone follow-ups.</p>
          </div>

          <div className="space-y-3">
            {employeeActivities.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
                No activity records logged yet. Completing field visits will automatically populate this dossier.
              </div>
            ) : (
              employeeActivities.map((act) => (
                <div key={act.id} className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[#14213D]">{act.title}</span>
                    <Badge variant={act.status === 'completed' ? 'success' : 'default'} size="sm">
                      {act.status?.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="text-xs text-[#4A5568] flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDateIN(act.activity_date)}
                    </span>
                    {act.outcome && (
                      <span className="font-semibold text-[#0B4A4E]">
                        Outcome: {act.outcome}
                      </span>
                    )}
                  </div>

                  {act.next_action && (
                    <div className="text-xs text-[#0B4A4E] bg-[#E3EFEE] p-2 rounded-lg border border-[#D0E5E3]">
                      <span className="font-bold">Next Action Commitment:</span> {act.next_action}
                      {act.followup_date && ` (By ${formatDateIN(act.followup_date)})`}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* VISIT DETAIL: everything about one visit, and what can be done with it */}
      <Modal
        isOpen={Boolean(openVisit)}
        onClose={() => setOpenVisitId(null)}
        title={openVisit?.organisation_name || 'Field visit'}
        description={openVisit ? `${fmtDate(openVisit.planned_date)} · ${visitTime(openVisit)}` : undefined}
        maxWidth="3xl"
      >
        {openVisit && (() => {
          const v = openVisit;
          const tile = 'rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2.5 min-w-0';
          const tileLabel = 'text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]';
          const active = isActiveVisitStatus(v.status);
          const mine = !!user?.id && [v.assigned_to, v.planned_by, v.service_engineer_id].includes(user.id);
          const menu: RowMenuItem[] = [
            { key: 'reschedule', label: 'Reschedule', icon: <CalendarDays />, hidden: !active, onSelect: () => openReschedule(v) },
            { key: 'station', label: 'Change station', icon: <MapPin />, hidden: !active, onSelect: () => openDestination(v) },
            { key: 'also', label: 'Also-meet directive', icon: <UserPlus />, hidden: !isManagerRole, onSelect: () => openAlsoMeet(v) },
            { key: 'cancel', label: 'Cancel visit', icon: <XCircle />, danger: true, hidden: !active, onSelect: () => openCancel(v) },
          ];
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {getVisitBadges(v)}
                {v.manager_assigned && <Badge variant="warning" size="sm">Manager assigned</Badge>}
                {v.travel_required && <Badge variant="info" size="sm">Travel</Badge>}
                {v.demo_required &&
                  (v.linked_demo_no ? (
                    <GuardedLink href={v.linked_demo_id ? `/demos?open=${v.linked_demo_id}` : '/demos'} className="inline-flex items-center gap-1 rounded-full border border-[#D0E5E3] bg-[#E3EFEE] px-2 py-0.5 text-[10px] font-bold text-[#0F5E63] hover:underline">
                      <Sparkles className="h-3 w-3" /> Demo {v.linked_demo_no}
                    </GuardedLink>
                  ) : (
                    <Badge variant="default" size="sm">Demo requested</Badge>
                  ))}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className={tile}>
                  <div className={tileLabel}>When</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-[#14213D]">{fmtDate(v.planned_date)}</div>
                  <div className="text-[11px] text-[#4A5568]">{visitTime(v)}</div>
                </div>
                <div className={tile}>
                  <div className={tileLabel}>Where</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-[#14213D]" title={v.location}>{v.location || '—'}</div>
                  {v.product_name && <div className="truncate text-[11px] text-[#4A5568]">Product: {v.product_name}</div>}
                </div>
                <div className={tile}>
                  <div className={tileLabel}>Officer</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-[#14213D]">{v.assignee_name || '—'}</div>
                </div>
                <div className={tile}>
                  <div className={tileLabel}>Contact</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-[#14213D]">{v.contact_name || v.contact_person || '—'}</div>
                </div>
              </div>

              {(v.purpose || v.expected_outcome) && (
                <div className="space-y-1 text-sm text-[#14213D]">
                  {v.purpose && <p className="whitespace-pre-wrap break-words"><span className="font-semibold text-[#4A5568]">Purpose: </span>{v.purpose}</p>}
                  {v.expected_outcome && <p className="whitespace-pre-wrap break-words"><span className="font-semibold text-[#4A5568]">Expected outcome: </span>{v.expected_outcome}</p>}
                </div>
              )}
              {v.remarks && !v.remarks.includes('Manager Directive:') && !v.remarks.includes('Manager Intervention') && (
                <p className="rounded-lg border border-[#DCD8CE] bg-[#FBFAF7] px-3 py-2 text-xs text-[#4A5568]">
                  <span className="font-semibold text-[#14213D]">Remarks: </span>
                  {v.remarks}
                </p>
              )}
              {v.change_reason && (
                <p className="rounded-lg border border-[#E9C9B4] bg-[#FFF8EB] px-3 py-2 text-xs text-[#7C2D12]">
                  <span className="font-bold">Change reason:</span> {v.change_reason}
                  {v.rescheduled_from && <span className="ml-1">(rescheduled from {formatDateIN(v.rescheduled_from)})</span>}
                </p>
              )}
              {renderDirective(v)}
              {renderReport(v)}

              {/* Pinned to the bottom: history on the left; the report, expenses and other changes (pencil) on the right */}
              <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#ECE9E2] bg-white px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5">
                <Button variant="ghost" size="sm" leftIcon={<History className="h-4 w-4" />} onClick={() => handleOpenAudit(v)}>
                  Audit trail
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {v.status !== 'cancelled' && mine && (
                    <NewClaimButton size="sm" variant="secondary" visitId={v.id} tripId={v.trip_id || undefined}>
                      <Receipt className="mr-1 h-3.5 w-3.5" />
                      Claim expense
                    </NewClaimButton>
                  )}
                  {active && canFileReport(v) && (
                    <Button
                      size="sm"
                      variant="primary"
                      leftIcon={<FileEdit className="h-4 w-4" />}
                      disabled={isFutureVisit(v)}
                      title={isFutureVisit(v) ? `The report can be submitted on or after ${fmtDay(calendarDay(v.planned_date) || '')}.` : undefined}
                      onClick={() => openReport(v)}
                    >
                      Submit report
                    </Button>
                  )}
                  {menu.some((m) => !m.hidden) && <RowMenu label="Change this visit" icon={<Pencil className="h-4 w-4" />} items={menu} />}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* MODAL 1: PLAN CLIENT VISIT */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        title="Plan Client Field Visit"
        description="Schedule upcoming procurement meetings and product demonstrations."
        maxWidth="4xl"
      >
        <form onSubmit={handleScheduleVisit}>
          <FormSteps
            onCancel={() => setIsScheduleOpen(false)}
            banner={
              actionError && (
                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D] font-semibold">
                  {actionError}
                </div>
              )
            }
            submit={
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Schedule Visit
              </Button>
            }
            steps={[
              {
                title: 'Agency',
                icon: <Building />,
                description: isSalesRole
                  ? 'Which customer agency you will visit.'
                  : 'Who is going, and which customer agency they will visit.',
                content: (
                  <div className="space-y-3">
                    <div className={`grid grid-cols-1 gap-3 ${isSalesRole ? '' : 'sm:grid-cols-2'}`}>
                      {!isSalesRole && (
                        <Select
                          label="Visiting Officer (Who is going)"
                          required
                          value={newVisit.assigned_to || ''}
                          onChange={(e) => setNewVisit({ ...newVisit, assigned_to: e.target.value })}
                          options={[
                            { value: '', label: '-- Select Officer Who is Going --' },
                            ...usersList.map((u) => ({
                              value: u.id,
                              label: `${u.full_name} (${u.role ? u.role.replace('_', ' ') : 'Officer'})`,
                            })),
                          ]}
                        />
                      )}

                      <Select
                        label="Organisation (Choose Agency)"
                        required
                        value={newVisit.organisation_id}
                        onChange={(e) => {
                          const orgId = e.target.value;
                          const org = organisations.find((o) => o.id === orgId);
                          setNewVisit({
                            ...newVisit,
                            organisation_id: orgId,
                            location: org?.city || newVisit.location,
                          });
                        }}
                        options={[
                          { value: '', label: '-- Choose Customer Agency --' },
                          ...organisations.map((o) => ({ value: o.id, label: `${o.name} (${o.city || 'State'})` })),
                        ]}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                      <Input
                        label="Location / Station"
                        required
                        value={newVisit.location}
                        onChange={(e) => setNewVisit({ ...newVisit, location: e.target.value })}
                        placeholder="e.g. Jalandhar Cantonment / New Delhi"
                      />

                      <Input
                        label="Customer Contact Person"
                        value={newVisit.contact_person}
                        onChange={(e) => setNewVisit({ ...newVisit, contact_person: e.target.value })}
                        placeholder="e.g. Commandant Signals / DIG Procurement"
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Schedule',
                icon: <Calendar />,
                description: 'When the visit happens and its main purpose.',
                content: (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-[#E3EFEE] border border-[#D0E5E3] text-xs text-[#0B4A4E] flex items-center gap-2">
                      <Info className="h-4 w-4 shrink-0 text-[#0F5E63]" />
                      <span>Standard operating procedure: Plan field visits approximately 1 week in advance.</span>
                    </div>

                    <div className="w-full flex flex-col justify-end text-left">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-[#14213D]">
                          Planned Date <span className="text-[#881337]">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setNewVisit({ ...newVisit, planned_date: addIsoDays(istToday(), 7) });
                          }}
                          className="text-[10px] text-[#0F5E63] hover:underline font-bold"
                        >
                          +7 Days
                        </button>
                      </div>
                      <input
                        type="date"
                        required
                        min={istToday()}
                        value={newVisit.planned_date}
                        onChange={(e) => setNewVisit({ ...newVisit, planned_date: e.target.value })}
                        className="flex h-10 w-full rounded-[8px] border border-[#C9C4B8] bg-white px-3.5 py-2 text-xs text-[#14213D] transition-colors focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Start Time"
                        type="time"
                        value={newVisit.start_time}
                        onChange={(e) => setNewVisit({ ...newVisit, start_time: e.target.value })}
                      />

                      <Input
                        label="End Time"
                        type="time"
                        error={timeRangeError(newVisit.start_time, newVisit.end_time)}
                        value={newVisit.end_time}
                        onChange={(e) => setNewVisit({ ...newVisit, end_time: e.target.value })}
                      />
                    </div>

                    <Input
                      label="Primary Purpose of Visit"
                      required
                      value={newVisit.purpose}
                      onChange={(e) => setNewVisit({ ...newVisit, purpose: e.target.value })}
                      placeholder="e.g. Technical demonstration of DFMD / HHMD for upcoming GeM procurement"
                    />
                  </div>
                ),
              },
              {
                title: 'Requirements',
                icon: <Layers />,
                description: 'Product focus, expected outcome, and whether a demo or travel is needed.',
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Primary Product Focus"
                        value={newVisit.product_id}
                        onChange={(e) => setNewVisit({ ...newVisit, product_id: e.target.value })}
                        options={[
                          { value: '', label: '-- General / Portfolio Meeting --' },
                          ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.category || 'Security'})` })),
                        ]}
                      />

                      <Input
                        label="Expected Strategic Outcome"
                        value={newVisit.expected_outcome}
                        onChange={(e) => setNewVisit({ ...newVisit, expected_outcome: e.target.value })}
                        placeholder="e.g. Secure trial evaluation certificate and quote RFP"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label
                        className={twMerge(
                          "flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors bg-white",
                          newVisit.demo_required ? "border-[#0F5E63] bg-[#E3EFEE]/40 text-[#0F5E63] ring-1 ring-[#0F5E63]" : "border-[#DCD8CE] hover:bg-[#FBFAF7]"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={newVisit.demo_required}
                          onChange={(e) => setNewVisit({ ...newVisit, demo_required: e.target.checked })}
                          className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#14213D]">
                              Live Demonstration Setup
                            </span>
                            <span className="text-[10px] text-[#0F5E63] font-semibold">
                              {newVisit.demo_required ? 'Added as next step' : 'Click to Setup'}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#4A5568] block mt-0.5">
                            Equipment Fleet Availability & Specific Demo Kit Selection
                          </span>
                        </div>
                      </label>

                      <label
                        className={twMerge(
                          "flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors bg-white",
                          newVisit.travel_required ? "border-[#0F5E63] bg-[#FBFAF7]" : "border-[#DCD8CE] hover:bg-[#FBFAF7]"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={newVisit.travel_required}
                          onChange={(e) => setNewVisit({ ...newVisit, travel_required: e.target.checked })}
                          className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                        />
                        <span className="text-xs font-semibold text-[#14213D]">
                          Travel Requirement (Outstation Tour)
                        </span>
                      </label>
                    </div>

                    {trips.length > 0 && !newVisit.travel_required && (
                      <Select
                        label="Attach to Existing Tour Program (Optional)"
                        value={newVisit.trip_id}
                        onChange={(e) => setNewVisit({ ...newVisit, trip_id: e.target.value })}
                        options={[
                          { value: '', label: '-- Standalone Field Visit --' },
                          ...trips.map((t) => ({ value: t.id, label: `${t.base_location} Tour (${formatDateIN(t.trip_date)})` })),
                        ]}
                      />
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1.5">
                        Remarks & Operational Notes
                      </label>
                      <textarea
                        value={newVisit.remarks}
                        onChange={(e) => setNewVisit({ ...newVisit, remarks: e.target.value })}
                        placeholder="e.g. Officer requested technical compliance sheets; gate pass required for vehicle."
                        rows={2}
                        className="flex w-full rounded-lg border border-[#DCD8CE] bg-white px-3.5 py-2 text-xs font-normal text-[#14213D] placeholder:text-[#6B7280] transition-colors focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Demo kit',
                icon: <FlaskConical />,
                description: 'Book a demo specialist and choose the equipment to take.',
                hidden: !newVisit.demo_required,
                content: (
                  <div className="space-y-3">
                    {/* 1. Demo Form Context Bar (Customer, Location, Requested Date, Salesperson, Purpose) */}
                    <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#ECE9E2] space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-1.5 border-b border-[#ECE9E2]">
                        <span className="font-bold text-[#14213D] uppercase tracking-wider text-[10px]">
                          Live Demonstration Trial Specification
                        </span>
                        <span className="text-[10px] text-[#0F5E63] font-medium">
                          ✓ Auto-synced with Visit & Tour Program
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div>
                          <span className="text-[#4A5568] block text-[10px]">Customer / Client:</span>
                          <span className="font-semibold text-[#14213D] truncate block">
                            {organisations.find((o) => o.id === newVisit.organisation_id)?.name || 'Select Customer in Form'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#4A5568] block text-[10px]">Trial Location:</span>
                          <span className="font-semibold text-[#14213D] truncate block">
                            📍 {effectiveDemoLocation}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#4A5568] block text-[10px]">Requested Date:</span>
                          <span className="font-semibold text-[#14213D] block font-mono">
                            📅 {formatDateIN(newVisit.planned_date)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#4A5568] block text-[10px]">Lead Salesperson:</span>
                          <span className="font-semibold text-[#14213D] truncate block">
                            👤 {usersList.find((u) => u.id === newVisit.assigned_to)?.full_name || user?.full_name || 'Assigned Officer'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 2. Demo Team Specialist Allocation & Live Availability */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <label className="text-xs font-semibold text-[#14213D]">
                          Assigned Demo Team Specialist *
                        </label>
                        {isLoadingTeamAvailability ? (
                          <span className="text-[10px] text-[#0F5E63] flex items-center gap-1">
                            <Spinner size="xs" /> Checking Team Availability...
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#4A5568]">
                            Availability for {formatDateIN(newVisit.planned_date)}
                          </span>
                        )}
                      </div>

                      <Select
                        value={demoDetails.demo_assigned_to}
                        onChange={(e) => setDemoDetails({ ...demoDetails, demo_assigned_to: e.target.value })}
                        options={[
                          { value: '', label: '-- Select Demo Team Member / Specialist --' },
                          ...demoTeamOptions,
                        ]}
                      />

                      {/* Selected Demo Team Member Live Availability & Notification Card */}
                      {selectedDemoMember && (
                        <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                          <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5 border-b border-[#ECE9E2]">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-[#14213D]">{selectedDemoMember.full_name}</span>
                              <Badge variant="cyber" className="text-[10px] py-0">
                                {selectedDemoMember.role === 'demo_team' ? 'DEMO SPECIALIST' : selectedDemoMember.role.replace(/_/g, ' ').toUpperCase()}
                              </Badge>
                              {selectedDemoMember.phone && (
                                <span className="text-[10px] text-[#4A5568]">📞 {selectedDemoMember.phone}</span>
                              )}
                            </div>
                            <div>
                              {selectedDemoMember.is_available ?? true ? (
                                <Badge variant="success">● AVAILABLE ON {formatDateIN(newVisit.planned_date)}</Badge>
                              ) : (
                                <Badge variant="warning">
                                  ▲ BUSY ON {selectedDemoMember.active_demo?.demo_no || 'ANOTHER TRIAL'}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="text-[11px] text-[#4A5568]">
                            {selectedDemoMember.is_available ?? true ? (
                              <div className="flex items-center gap-1.5 text-[#0B4A4E]">
                                <CheckCircle2 className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                                <span>Specialist has zero trial schedule conflicts on this date and is cleared for field demonstration.</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-[#7C2D12]">
                                <AlertTriangle className="h-3.5 w-3.5 text-[#9A3412] shrink-0" />
                                <span>Specialist has active trial booking for <strong>{selectedDemoMember.active_demo?.organisation_name || 'Client'}</strong>. Booking will flag a schedule overlap notice.</span>
                              </div>
                            )}
                          </div>

                          {/* Auto-Notification Callout */}
                          <div className="p-2 rounded-lg bg-[#E3EFEE]/70 border border-[#0F5E63]/20 text-[#0F5E63] text-[11px] flex items-center gap-2">
                            <Bell className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
                            <span>
                              <strong>Auto-Notification & Calendar Sync:</strong> Submitting this visit will instantly alert <strong>{selectedDemoMember.full_name}</strong> and list this trial under their <strong>"My Demos"</strong> dashboard.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 3. Equipment & Specific Kit Selection (Row 1: Two Selects, Below: Full-width Details) */}
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <Select
                          label="Equipment / Product Required for Demo *"
                          value={demoDetails.product_id || newVisit.product_id}
                          onChange={(e) => {
                            const pId = e.target.value;
                            setDemoDetails({ ...demoDetails, product_id: pId, equipment_required: kitForProduct(demoDetails.equipment_required, pId, demoEquipmentList || []) });
                            if (pId && !newVisit.product_id) {
                              setNewVisit((prev) => ({ ...prev, product_id: pId }));
                            }
                          }}
                          options={[
                            { value: '', label: '-- Select Equipment Category / Product --' },
                            ...availableFirst(products.map((p) => {
                              const pUnits = (demoEquipmentList || []).filter((e) => e.product_id === p.id);
                              const ready = pUnits.filter((e) => e.availability_status === 'available').length;
                    return { value: p.id, label: `${p.name} (${p.category || 'Security'})`, ...fleetHint(ready, pUnits.length) };
                            })),
                          ]}
                        />

                        <Select
                          label="Specific Demo Kit / Serial / Accessories Needed"
                          value={
                            registeredEquipmentOptions.some((o) => o.value === demoDetails.equipment_required)
                              ? demoDetails.equipment_required
                              : demoDetails.equipment_required
                              ? 'custom'
                              : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'custom') {
                              setDemoDetails({ ...demoDetails, equipment_required: 'custom' });
                            } else {
                              const matchedEquip = (demoEquipmentList || []).find(
                                (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === val
                                  || item.serial_no === val
                                  || item.id === val
                              );
                              setDemoDetails({
                                ...demoDetails,
                                equipment_required: val,
                                product_id: matchedEquip?.product_id || demoDetails.product_id,
                              });
                              if (matchedEquip?.product_id && !newVisit.product_id) {
                                setNewVisit((prev) => ({ ...prev, product_id: matchedEquip.product_id }));
                              }
                            }
                          }}
                          options={registeredEquipmentOptions}
                        />
                      </div>

                      {/* Live Product Fleet Availability & Status HUD - Full Width */}
                      {activeProductFleet && (
                        <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                                Live Product Fleet Availability:
                              </span>
                              <span className="font-bold text-xs text-[#14213D]">
                                {products.find((p) => p.id === (demoDetails.product_id || newVisit.product_id))?.name || 'Selected Equipment'}
                              </span>
                            </div>
                            {activeProductFleet.availableCount > 0 ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#0F5E63] animate-pulse" />
                                AVAILABLE ({activeProductFleet.availableCount} Ready)
                              </span>
                            ) : activeProductFleet.total > 0 ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FBEBDD] text-[#7C2D12] border border-[#E9C9B4]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#9A3412]" />
                                RESERVED ({activeProductFleet.total} in Fleet)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#ECE9E2] text-[#14213D] border border-[#C9C4B8]">
                                No Fleet Unit
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-[#ECE9E2]">
                            <span className="text-[#4A5568]">
                              {activeProductFleet.availableCount > 0
                                ? `Stationed at: ${activeProductFleet.locations.join(', ')} Depot`
                                : activeProductFleet.total > 0
                                ? `All units currently deployed or reserved.`
                                : `Custom requisition required.`}
                            </span>
                            <div className="flex items-center gap-2 font-mono text-[10px]">
                              <span>Fleet: <b>{activeProductFleet.total}</b></span>
                              <span className="text-[#0B4A4E]">Ready: <b>{activeProductFleet.availableCount}</b></span>
                              <span className="text-[#7C2D12]">In-Trial: <b>{activeProductFleet.reservedCount}</b></span>
                              {activeProductFleet.maintenanceCount > 0 && (
                                <span className="text-[#700F2D]">Maint: <b>{activeProductFleet.maintenanceCount}</b></span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Specific Demo Kit / Serial / Accessories Detail Card - FULL WIDTH, NOT SPLIT IN HALF */}
                      {selectedEquipUnit && (
                        <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2.5 text-xs animate-in fade-in">
                          <div className="flex flex-wrap items-center justify-between gap-1 pb-2 border-b border-[#ECE9E2]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-[#14213D]">{selectedEquipUnit.model}</span>
                              <span className="font-mono text-xs px-2 py-0.5 rounded bg-white border border-[#DCD8CE] text-[#14213D] font-bold">
                                S/N: {selectedEquipUnit.serial_no}
                              </span>
                              <span className="text-xs text-[#4A5568]">📍 {selectedEquipUnit.current_location} Depot</span>
                            </div>
                            <div>
                              {selectedEquipUnit.availability_status === 'available' ? (
                                <Badge variant="success">● READY & AVAILABLE</Badge>
                              ) : selectedEquipUnit.availability_status === 'reserved' || selectedEquipUnit.availability_status === 'in_use' ? (
                                <Badge variant="warning">
                                  ○ RESERVED {selectedEquipUnit.reserved_until ? `UNTIL ${formatDateIN(selectedEquipUnit.reserved_until)}` : ''}
                                </Badge>
                              ) : (
                                <Badge variant="danger">▲ MAINTENANCE: {selectedEquipUnit.condition || 'Service Needed'}</Badge>
                              )}
                            </div>
                          </div>

                          {/* 4-Column Metadata Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div>
                              <span className="text-[10px] text-[#4A5568] block">Operational Condition:</span>
                              <span className="font-semibold text-[#14213D]">{selectedEquipUnit.condition || 'Operational'}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-[#4A5568] block">Fleet Custodian:</span>
                              <span className="font-semibold text-[#14213D]">{selectedEquipUnit.responsible_person_name || 'Demo Team Coordinator'}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-[#4A5568] block">Depot Base:</span>
                              <span className="font-semibold text-[#14213D]">{selectedEquipUnit.current_location} Depot</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-[#4A5568] block">Unit Serial:</span>
                              <span className="font-mono font-bold text-[#14213D]">{selectedEquipUnit.serial_no}</span>
                            </div>
                          </div>

                          {/* Warn when the chosen unit is busy or under maintenance */}
                          {selectedEquipUnit.availability_status === 'available' ? null : selectedEquipUnit.availability_status === 'reserved' || selectedEquipUnit.availability_status === 'in_use' ? (
                            <div className="p-2 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] text-[11px] flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-[#7C2D12] shrink-0" />
                              <span>This serial is currently scheduled for another trial. Submitting will flag a scheduling overlap notice to the Demo Coordinator.</span>
                            </div>
                          ) : (
                            <div className="p-2 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D] text-[11px] flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-[#700F2D] shrink-0" />
                              <span>Unit marked under maintenance ({selectedEquipUnit.condition}). You may select another serial or custom kit.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              },
              {
                title: 'Demo site',
                icon: <Wrench />,
                description: 'Audience, trial objective, and what the site needs ready.',
                hidden: !newVisit.demo_required,
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Additional Accessories / Test Samples Needed (Optional)"
                        value={demoDetails.custom_accessories}
                        onChange={(e) =>
                          setDemoDetails({ ...demoDetails, custom_accessories: e.target.value })
                        }
                        placeholder={
                          demoDetails.equipment_required === 'custom'
                            ? "Enter custom model name, serial number and accessories..."
                            : "e.g. Test calibration pieces, knife sample, spare batteries, vehicle gate pass"
                        }
                      />

                      <Input
                        label="Expected Audience / Evaluation Committee"
                        value={demoDetails.expected_audience}
                        onChange={(e) => setDemoDetails({ ...demoDetails, expected_audience: e.target.value })}
                        placeholder="e.g. DIG Store, Commandant & 4 Technical Officers"
                      />
                    </div>

                    <Input
                      label="Trial Specifics / Demonstration Objective"
                      value={demoDetails.special_requirements}
                      onChange={(e) => setDemoDetails({ ...demoDetails, special_requirements: e.target.value })}
                      placeholder="e.g. Range testing at 50m / walkthrough sensitivity tests"
                    />

                    {/* Facility & Site Prerequisites */}
                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1.5">
                        Site & Facility Readiness Checklist
                      </label>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-[#4A5568]">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={demoDetails.power_required}
                            onChange={(e) => setDemoDetails({ ...demoDetails, power_required: e.target.checked })}
                            className="rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                          />
                          <span>230V AC Power Socket Needed</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={demoDetails.night_trial}
                            onChange={(e) => setDemoDetails({ ...demoDetails, night_trial: e.target.checked })}
                            className="rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                          />
                          <span>Indoor Dark Room / Night Vision Setup</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={demoDetails.gate_pass_required}
                            onChange={(e) => setDemoDetails({ ...demoDetails, gate_pass_required: e.target.checked })}
                            className="rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                          />
                          <span>Vehicle Entry Gate Pass Required</span>
                        </label>
                      </div>
                    </div>

                    {/* Service Team Escort for Live Trial Support */}
                    <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={demoDetails.service_escort_required || false}
                            onChange={(e) =>
                              setDemoDetails({
                                ...demoDetails,
                                service_escort_required: e.target.checked,
                                service_engineer_id: e.target.checked ? demoDetails.service_engineer_id : '',
                              })
                            }
                            className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                          />
                          <span className="text-xs font-bold text-[#14213D]">
                            Request Service Team Escort for Live Demo (Optional)
                          </span>
                        </label>
                      </div>

                      {demoDetails.service_escort_required && (
                        <div className="pt-2 border-t border-[#ECE9E2] space-y-2">
                          <Select
                            label="Select Available Service Engineer *"
                            value={demoDetails.service_engineer_id || ''}
                            onChange={(e) => setDemoDetails({ ...demoDetails, service_engineer_id: e.target.value })}
                            options={[
                              { value: '', label: '-- Select Service Engineer to Escort Tour --' },
                              ...serviceEngineers.map((se) => ({
                                value: se.id,
                                label: `🔧 ${se.full_name} (${se.email})`,
                              })),
                            ]}
                            required
                          />
                          <div className="p-2 rounded-lg bg-[#E3EFEE] border border-[#D0E5E3] text-[#0B4A4E] text-[11px] flex items-center gap-2">
                            <Info className="h-3.5 w-3.5 text-[#0B4A4E] shrink-0" />
                            <span>
                              Attaching a Service Engineer will automatically link them to this tour program and notify Management, Demo Team, Service Team, Salesperson, and the Regional Manager.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              },
              {
                title: 'Travel',
                icon: <Plane />,
                description: 'Outstation travel, transit mode and overnight stay.',
                hidden: !newVisit.travel_required,
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Departure Station / Origin City"
                        value={travelDetails.travel_from}
                        onChange={(e) => setTravelDetails({ ...travelDetails, travel_from: e.target.value })}
                        placeholder="e.g. Delhi NCR (HQ Depot)"
                      />

                      <Input
                        label="Destination Station / Tour Base"
                        value={travelDetails.travel_to || newVisit.location}
                        onChange={(e) => setTravelDetails({ ...travelDetails, travel_to: e.target.value })}
                        placeholder="e.g. Lucknow / Jalandhar / Chandigarh"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Preferred Transit Mode"
                        value={travelDetails.travel_mode}
                        onChange={(e) => setTravelDetails({ ...travelDetails, travel_mode: e.target.value })}
                        options={[
                          { value: 'Express Train (Shatabdi/Rajdhani/Vande Bharat)', label: 'Express Train (Shatabdi / Rajdhani / Vande Bharat)' },
                          { value: 'Commercial Flight', label: 'Commercial Flight' },
                          { value: 'Intercity Road / Official Taxi', label: 'Intercity Road / Official Taxi' },
                          { value: 'Company Utility Vehicle / Service Van', label: 'Company Utility Vehicle / Service Van' },
                        ]}
                      />

                      <Select
                        label="Attach to Existing Tour Program (Trip)"
                        value={newVisit.trip_id}
                        onChange={(e) => setNewVisit({ ...newVisit, trip_id: e.target.value })}
                        options={[
                          { value: '', label: '-- Auto-Generate New Tour Program --' },
                          ...trips.map((t) => ({
                            value: t.id,
                            label: `${t.base_location} Tour (${formatDateIN(t.trip_date)})`,
                          })),
                        ]}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-xs text-[#4A5568]">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={travelDetails.lodging_required}
                          onChange={(e) => setTravelDetails({ ...travelDetails, lodging_required: e.target.checked })}
                          className="rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
                        />
                        <span className="text-xs font-medium text-[#14213D]">
                          Overnight Lodging / Hotel Stay Required
                        </span>
                      </label>

                      {travelDetails.lodging_required && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#4A5568]">Nights:</span>
                          <select
                            value={travelDetails.stay_nights}
                            onChange={(e) => setTravelDetails({ ...travelDetails, stay_nights: e.target.value })}
                            className="text-xs p-1 rounded border border-[#C9C4B8] bg-white font-mono"
                          >
                            <option value="1">1 Night</option>
                            <option value="2">2 Nights</option>
                            <option value="3">3 Nights</option>
                            <option value="4+">4+ Nights</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 2: CREATE TOUR PROGRAM (TRIP) */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isCreateTripOpen}
        onClose={() => setIsCreateTripOpen(false)}
        title="Create Field Tour Program (Trip)"
        description="Establish an operational tour encompassing multiple client agency visits."
        maxWidth="md"
      >
        <form onSubmit={handleCreateTrip} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          {hasRole(['management', 'regional_manager', 'admin']) && (
            <Select
              label="Assigned Sales Executive"
              value={newTrip.employee_id}
              onChange={(e) => setNewTrip({ ...newTrip, employee_id: e.target.value })}
              options={[
                { value: '', label: '-- Assign to Self / Current User --' },
                ...usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
              ]}
            />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Base Destination / City"
              required
              value={newTrip.base_location}
              onChange={(e) => setNewTrip({ ...newTrip, base_location: e.target.value })}
              placeholder="e.g. Chandigarh / Jammu"
            />

            <Input
              label="Trip Date"
              type="date"
              required
              min={istToday()}
              value={newTrip.trip_date}
              onChange={(e) => setNewTrip({ ...newTrip, trip_date: e.target.value })}
            />
          </div>

          <Input
            label="Tour Mission Notes"
            value={newTrip.notes}
            onChange={(e) => setNewTrip({ ...newTrip, notes: e.target.value })}
            placeholder="e.g. 2-day sector review with BSF Punjab Frontier & State Police Wireless"
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsCreateTripOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Establish Tour Plan
            </Button>
          </div>
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 3: MANAGER ADD VISIT TO TRIP (OPTIMIZATION) */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isAddTripVisitOpen}
        onClose={() => setIsAddTripVisitOpen(false)}
        title="Trip Optimization: Add Customer to Itinerary"
        description={`Add an adjacent client meeting to ${selectedTrip?.employee_name || 'employee'}'s trip to maximize travel efficiency.`}
        maxWidth="md"
      >
        <form onSubmit={handleAddTripVisit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          <div className="p-3 bg-[#FFF8EB] border border-[#E9C9B4] rounded-lg text-xs text-[#7C2D12]">
            <span className="font-bold block">Base Station: {selectedTrip?.base_location}</span>
            <span>Visits in this tour program should be reasonably close to avoid travel schedule conflict.</span>
          </div>

          <FormSection title="Agency & time" icon={<Building />}>
            <Select
              label="Select Additional Client Agency"
              required
              value={tripVisit.organisation_id}
              onChange={(e) => {
                const org = organisations.find((o) => o.id === e.target.value);
                setTripVisit({
                  ...tripVisit,
                  organisation_id: e.target.value,
                  location: org?.city || tripVisit.location,
                });
              }}
              options={[
                { value: '', label: '-- Choose Agency in Same Area --' },
                ...organisations.map((o) => ({ value: o.id, label: `${o.name} (${o.city || 'State'})` })),
              ]}
            />

            <Input
              label="Station / Address"
              value={tripVisit.location}
              onChange={(e) => setTripVisit({ ...tripVisit, location: e.target.value })}
              placeholder="e.g. Chandigarh Sector 17"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Start"
                type="time"
                value={tripVisit.start_time}
                onChange={(e) => setTripVisit({ ...tripVisit, start_time: e.target.value })}
              />
              <Input
                label="End"
                type="time"
                error={timeRangeError(tripVisit.start_time, tripVisit.end_time)}
                value={tripVisit.end_time}
                onChange={(e) => setTripVisit({ ...tripVisit, end_time: e.target.value })}
              />
            </div>
          </FormSection>

          <FormSection title="Brief" icon={<FileText />} description="Why the officer should meet this agency.">
            <Input
              label="Purpose of This Meeting"
              value={tripVisit.purpose}
              onChange={(e) => setTripVisit({ ...tripVisit, purpose: e.target.value })}
              placeholder="e.g. Introduce Vehicle Surveillance System"
            />

            <Input
              label="Manager Directive / Instructions for Officer"
              required
              value={tripVisit.instructions}
              onChange={(e) => setTripVisit({ ...tripVisit, instructions: e.target.value })}
              placeholder="e.g. Also meet DIG Logistics to follow up on the upcoming GeM bid."
            />
          </FormSection>

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddTripVisitOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Add to Itinerary
            </Button>
          </div>
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 4: ALSO-MEET DIRECTIVE */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isAlsoMeetOpen}
        onClose={() => setIsAlsoMeetOpen(false)}
        title="Manager Directive / 'Also-Meet' Strategic Guidance"
        description="Attach executive instructions and specify additional officers or stakeholders to meet during this visit."
        maxWidth="lg"
      >
        <form onSubmit={handleAlsoMeetSubmit}>
          <FormSteps
            onCancel={() => setIsAlsoMeetOpen(false)}
            banner={
              actionError && (
                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
                  {actionError}
                </div>
              )
            }
            submit={
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                {alsoMeetData.assign_additional ? 'Add 2nd Visit & Save Directive' : 'Save Directive'}
              </Button>
            }
            steps={[
              {
                title: 'Directive',
                icon: <Sparkles />,
                description: `Instructions for the officer visiting ${selectedVisit?.organisation_name || 'the customer agency'}.`,
                content: (
                  <div className="space-y-3">
                    {/* Current Target Context: Organisation is already selected by the salesperson */}
                    {selectedVisit && (
                      <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#ECE9E2]">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#14213D] text-sm">
                              {selectedVisit.organisation_name}
                            </span>
                            <Badge variant="outline" size="sm" className="bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30">
                              Target Agency Selected
                            </Badge>
                          </div>
                          <span className="font-mono text-[#4A5568] text-[11px]">Visit #{selectedVisit.id.slice(0, 8)}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-[#4A5568]">
                          <div>
                            <span className="text-[#6B7280] block">Visiting Officer:</span>
                            <strong className="text-[#14213D]">{selectedVisit.assignee_name || selectedVisit.assigned_to_name || 'Assigned Officer'}</strong>
                          </div>
                          <div>
                            <span className="text-[#6B7280] block">Station / City:</span>
                            <strong className="text-[#14213D]">{selectedVisit.location || 'N/A'}</strong>
                          </div>
                          <div>
                            <span className="text-[#6B7280] block">Planned Date:</span>
                            <strong className="text-[#14213D]">{selectedVisit.planned_date ? formatDateIN(selectedVisit.planned_date) : 'N/A'}</strong>
                          </div>
                          <div>
                            <span className="text-[#6B7280] block">Customer Contact:</span>
                            <strong className="text-[#14213D]">{selectedVisit.contact_person || selectedVisit.contact_name || 'General Office'}</strong>
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1">
                        Manager Directive Instructions <span className="text-[#881337]">*</span>
                      </label>
                      <textarea
                        required
                        rows={3}
                        value={alsoMeetData.instructions}
                        onChange={(e) => setAlsoMeetData({ ...alsoMeetData, instructions: e.target.value })}
                        placeholder="e.g. While visiting Delhi Police HQ, also meet SP Provisioning in same complex regarding pending GeM tender and clarify demonstration schedule."
                        className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] bg-white text-[#14213D] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Also meet',
                icon: <UserPlus />,
                description: 'Optionally name another officer to meet here, or add a second agency to the trip.',
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Specific Officer to Also Meet (Optional)"
                        value={alsoMeetData.contact_person}
                        onChange={(e) => setAlsoMeetData({ ...alsoMeetData, contact_person: e.target.value })}
                        placeholder="e.g. SP Provisioning / Col. Bhatia / DIG Store"
                        helperText="Authority or stakeholder to meet at this organisation"
                      />

                      <Input
                        label="Strategic Agenda / Meeting Purpose (Optional)"
                        value={alsoMeetData.purpose}
                        onChange={(e) => setAlsoMeetData({ ...alsoMeetData, purpose: e.target.value })}
                        placeholder="e.g. Review upcoming GeM custom bid & verify demo compliance"
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Route className="h-4 w-4 text-[#0F5E63]" />
                          <div>
                            <span className="text-xs font-bold text-[#14213D] block">
                              Add a Second Organisation to this Trip (Multi-Stop Itinerary)
                            </span>
                            <span className="text-[11px] text-[#4A5568]">
                              Optional: Check only if you want the officer to visit a DIFFERENT client agency in the same city.
                            </span>
                          </div>
                        </div>
                        <Checkbox
                          checked={alsoMeetData.assign_additional}
                          onChange={(e) => setAlsoMeetData({ ...alsoMeetData, assign_additional: e.target.checked })}
                          label="Add 2nd Org"
                        />
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Second stop',
                icon: <Route />,
                description: 'The other agency the officer should visit in the same city.',
                hidden: !alsoMeetData.assign_additional,
                content: (
                  <div className="space-y-3">
                    <div className="p-2.5 rounded-lg bg-[#E3EFEE] border border-[#D0E5E3] text-[11px] text-[#0B4A4E]">
                      This will schedule an additional separate field visit for <strong>{selectedVisit?.assignee_name || 'the officer'}</strong> and group both meetings into a unified tour program.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Select Secondary Organisation to Meet"
                        required={alsoMeetData.assign_additional}
                        value={alsoMeetData.organisation_id}
                        onChange={(e) => {
                          const orgId = e.target.value;
                          const org = organisations.find((o) => o.id === orgId);
                          setAlsoMeetData({
                            ...alsoMeetData,
                            organisation_id: orgId,
                            location: org?.city || selectedVisit?.location || alsoMeetData.location,
                          });
                        }}
                        options={[
                          { value: '', label: '-- Select Adjacent Organisation --' },
                          ...organisations
                            .filter((o) => o.id !== selectedVisit?.organisation_id)
                            .map((o) => ({
                              value: o.id,
                              label: `${o.name} (${o.city || 'Office'})`,
                            })),
                        ]}
                      />

                      <Input
                        label="Second Location / Office Detail"
                        required={alsoMeetData.assign_additional}
                        value={alsoMeetData.location}
                        onChange={(e) => setAlsoMeetData({ ...alsoMeetData, location: e.target.value })}
                        placeholder="e.g. ITBP Camp, Tigri / CGO Complex"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        label="Start Time for 2nd Visit"
                        type="time"
                        value={alsoMeetData.start_time}
                        onChange={(e) => setAlsoMeetData({ ...alsoMeetData, start_time: e.target.value })}
                      />

                      <Input
                        label="End Time for 2nd Visit"
                        type="time"
                        error={timeRangeError(alsoMeetData.start_time, alsoMeetData.end_time)}
                        value={alsoMeetData.end_time}
                        onChange={(e) => setAlsoMeetData({ ...alsoMeetData, end_time: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 5: RESCHEDULE VISIT */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isRescheduleOpen}
        onClose={() => setIsRescheduleOpen(false)}
        title="Reschedule Client Field Visit"
        description="Postpone or advance the visit. A reason is strictly mandatory and will be recorded in the audit trail."
        maxWidth="md"
      >
        <form onSubmit={handleRescheduleSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D] font-semibold">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="New Planned Date"
              type="date"
              required
              min={istToday()}
              value={rescheduleData.new_date}
              onChange={(e) => setRescheduleData({ ...rescheduleData, new_date: e.target.value })}
            />

            <div className="grid grid-cols-2 gap-1.5">
              <Input
                label="Start Time"
                type="time"
                value={rescheduleData.start_time}
                onChange={(e) => setRescheduleData({ ...rescheduleData, start_time: e.target.value })}
              />
              <Input
                label="End Time"
                type="time"
                error={timeRangeError(rescheduleData.start_time || selectedVisit?.start_time, rescheduleData.end_time || selectedVisit?.end_time)}
                value={rescheduleData.end_time}
                onChange={(e) => setRescheduleData({ ...rescheduleData, end_time: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#14213D] mb-1">
              Mandatory Rescheduling Reason <span className="text-[#881337]">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={rescheduleData.reason}
              onChange={(e) => setRescheduleData({ ...rescheduleData, reason: e.target.value })}
              placeholder="e.g. Customer requested postponement due to VIP convoy duty."
              className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsRescheduleOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Confirm Reschedule
            </Button>
          </div>
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 6: CANCEL VISIT */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        title="Cancel Client Field Visit"
        description="Cancelling will alert the regional manager and create an append-only audit record."
        maxWidth="md"
      >
        <form onSubmit={handleCancelSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D] font-semibold">
              {actionError}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#14213D] mb-1">
              Cancellation Reason <span className="text-[#881337]">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Field trial cancelled by Ministry due to weather."
              className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsCancelOpen(false)}>
              Back
            </Button>
            <Button type="submit" variant="danger" size="sm" isLoading={isSubmitting}>
              Confirm Cancellation
            </Button>
          </div>
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 7: CHANGE DESTINATION */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isDestinationOpen}
        onClose={() => setIsDestinationOpen(false)}
        title="Change Visit Destination"
        description="Update the meeting station or venue. Audit logs will record both prior and new locations."
        maxWidth="md"
      >
        <form onSubmit={handleDestinationSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          <Input
            label="New Location / Testing Ground"
            required
            value={newDestination.new_location}
            onChange={(e) => setNewDestination({ ...newDestination, new_location: e.target.value })}
            placeholder="e.g. Delhi Frontier Testing Range"
          />

          <div>
            <label className="block text-xs font-bold text-[#14213D] mb-1">
              Reason for Venue Change <span className="text-[#881337]">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={newDestination.reason}
              onChange={(e) => setNewDestination({ ...newDestination, reason: e.target.value })}
              placeholder="e.g. Demonstrations moved to outdoor proving range by DIG technical."
              className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsDestinationOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Update Station
            </Button>
          </div>
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 8: POST-VISIT REPORT */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        title="Submit Post-Visit Outcome Report"
        description="Record intelligence, officer feedback, and follow-up milestones."
        maxWidth="lg"
      >
        <form onSubmit={handleReportSubmit}>
          <FormSteps
            onCancel={() => setIsReportOpen(false)}
            banner={
              actionError && (
                <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D] font-semibold">
                  {actionError}
                </div>
              )
            }
            submit={
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Submit Intelligence
              </Button>
            }
            steps={[
              {
                title: 'Meeting',
                icon: <CheckCircle2 />,
                description: 'Did the meeting take place? If not, record why.',
                content: (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-[#14213D]">Did the meeting take place?</label>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer font-semibold text-[#0B4A4E]">
                          <input
                            type="radio"
                            name="met_completed"
                            checked={reportData.met_completed === true}
                            onChange={() => setReportData({ ...reportData, met_completed: true })}
                          />
                          <span>Yes — Meeting Completed</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer font-semibold text-[#700F2D]">
                          <input
                            type="radio"
                            name="met_completed"
                            checked={reportData.met_completed === false}
                            onChange={() => setReportData({ ...reportData, met_completed: false })}
                          />
                          <span>No — Not Completed / Customer Unavailable</span>
                        </label>
                      </div>
                    </div>

                    {!reportData.met_completed && (
                      <div>
                        <label className="block text-xs font-bold text-[#14213D] mb-1">
                          Reason Why Meeting Did Not Take Place <span className="text-[#881337]">*</span>
                        </label>
                        <textarea
                          required
                          rows={3}
                          value={reportData.remarks}
                          onChange={(e) => setReportData({ ...reportData, remarks: e.target.value })}
                          placeholder="e.g. Officer was summoned urgently for VIP convoy movement."
                          className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
                        />
                      </div>
                    )}

                    {/* §12: a missed meeting still gets a next step (e.g. officer on leave → revisit date) */}
                    {!reportData.met_completed && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          label="Next Action"
                          required={Boolean(reportData.followup_date)}
                          value={reportData.next_action}
                          onChange={(e) => setReportData({ ...reportData, next_action: e.target.value })}
                          placeholder="e.g. Revisit once the officer is back from leave"
                        />

                        <Input
                          label="Follow-Up Date"
                          type="date"
                          min={calendarDay(selectedVisit?.planned_date) || undefined}
                          value={reportData.followup_date}
                          onChange={(e) => setReportData({ ...reportData, followup_date: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: 'Discussion',
                icon: <Users />,
                description: 'Who you met and what was discussed.',
                hidden: !reportData.met_completed,
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Person Met (Name & Rank / Designation)"
                        required
                        value={reportData.person_met}
                        onChange={(e) => setReportData({ ...reportData, person_met: e.target.value })}
                        placeholder="e.g. Dr. A.K. Sharma, DIG Procurement"
                      />

                      <Input
                        label="Product Discussed"
                        value={reportData.product_discussed}
                        onChange={(e) => setReportData({ ...reportData, product_discussed: e.target.value })}
                        placeholder="e.g. HHMD MHA QR Specification"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1">
                        Discussion Summary & Technical Notes <span className="text-[#881337]">*</span>
                      </label>
                      <textarea
                        required
                        rows={3}
                        value={reportData.discussion}
                        onChange={(e) => setReportData({ ...reportData, discussion: e.target.value })}
                        placeholder="Points discussed, customer reactions, technical clarifications requested..."
                        className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Outcome',
                icon: <Sparkles />,
                description: 'What came out of the meeting and any opportunity spotted.',
                hidden: !reportData.met_completed,
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Meeting Outcome"
                        required
                        value={reportData.outcome}
                        onChange={(e) => setReportData({ ...reportData, outcome: e.target.value })}
                        placeholder="e.g. Trial requested / Positive technical feedback"
                      />

                      <Input
                        label="Opportunity Identified"
                        value={reportData.opportunity}
                        onChange={(e) => setReportData({ ...reportData, opportunity: e.target.value })}
                        placeholder="e.g. Estimated 100 units tender in Q3"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <Input
                        label="Tender / GeM Bid Opportunity"
                        value={reportData.tender_opportunity}
                        onChange={(e) => setReportData({ ...reportData, tender_opportunity: e.target.value })}
                        placeholder="e.g. GeM custom bid GEM/2026/B/88219 for 250 units"
                      />

                      <div className="pt-4">
                        <Checkbox
                          checked={reportData.demo_required}
                          onChange={(e) => setReportData({ ...reportData, demo_required: e.target.checked })}
                          label="Demo / Field Trial Required as Next Step"
                        />
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Follow-up',
                icon: <CalendarDays />,
                description: 'The next action, when to follow up, and any field notes.',
                hidden: !reportData.met_completed,
                content: (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Next Action Commitment"
                        required={Boolean(reportData.followup_date)}
                        value={reportData.next_action}
                        onChange={(e) => setReportData({ ...reportData, next_action: e.target.value })}
                        placeholder="e.g. Dispatch demo unit from Delhi Depot"
                      />

                      <Input
                        label="Follow-Up Milestone Date"
                        type="date"
                        min={calendarDay(selectedVisit?.planned_date) || undefined}
                        value={reportData.followup_date}
                        onChange={(e) => setReportData({ ...reportData, followup_date: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#14213D] mb-1">
                        General Remarks & Field Intelligence Notes
                      </label>
                      <textarea
                        rows={2}
                        value={reportData.remarks}
                        onChange={(e) => setReportData({ ...reportData, remarks: e.target.value })}
                        placeholder="Additional field intelligence, competitive products observed, technical feedback..."
                        className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#0F5E63] focus:border-[#0F5E63]"
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* ----------------------------------------------------------- */}
      {/* MODAL 9: VISIT AUDIT TRAIL */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        title="Immutable Visit Audit Trail"
        description={`Audit history for visit to ${selectedVisit?.organisation_name || 'agency'}.`}
        maxWidth="md"
      >
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {auditLogs.length === 0 ? (
            <p className="text-xs text-[#4A5568] italic p-4 text-center">No audit records found.</p>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="p-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0F5E63]">{log.action}</span>
                  <span className="text-[10px] text-[#4A5568]">
                    {formatDateTimeIN(log.created_at)}
                  </span>
                </div>
                <div className="text-[#14213D]">
                  <span className="font-semibold text-[#4A5568]">Actor:</span> {log.actor_name || 'System'} ({log.actor_role})
                </div>
                {log.new_value?.reason && (
                  <div className="text-[#4A5568] italic">
                    Reason: "{log.new_value.reason}"
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </PageContainer>
  );
}
