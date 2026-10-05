'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
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
  Filter,
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
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
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
  FilterBar,
  EmptyState,
  InfoCallout,
  Tabs,
  Checkbox,
} from '@/components/ui';

// Specific Demo Kit standard accessories mapping
const getStandardKitAccessories = (productName?: string, category?: string) => {
  const p = (productName || '').toLowerCase();
  const c = (category || '').toLowerCase();

  if (p.includes('metal detector') || p.includes('hhmd') || p.includes('dfmd') || c.includes('metal')) {
    return [
      'Rugged flight case with custom high-density EVA foam',
      '2x Rechargeable NiMH battery packs + desktop cradle charger',
      'Standard MHA test calibration piece & test knife sample',
      'Ballistic nylon belt holster & safety wrist lanyard',
      'Factory sensitivity verification & calibration certificate',
    ];
  }
  if (p.includes('thermal') || p.includes('ti-') || p.includes('infrared') || c.includes('thermal')) {
    return [
      'Hermetic waterproof IP67 hard carrying case',
      '2x High-capacity Li-ion batteries + AC/DC field charger',
      'High-speed HDMI / Video-out cable for command viewing',
      'Optical microfiber lens cleaning kit & protective cap',
      'Field survey tripod with quick-release mounting plate',
      'Thermal resolution test target & calibration report',
    ];
  }
  if (p.includes('night vision') || p.includes('monocular') || p.includes('nvm') || c.includes('night vision')) {
    return [
      'Mil-spec Pelican protective case with desiccants',
      'Combat helmet mount shroud & skull crusher harness',
      'Sacrificial protective objective window & demist shield',
      'Dual AA battery adapter cartridge & lens cleaning pen',
      'Infrared (IR) covert test target card',
      'OEM optical resolution test & FOM certification dossier',
    ];
  }
  if (p.includes('breath') || p.includes('alco') || c.includes('analyser')) {
    return [
      'Hard carrying case with molded foam insert',
      '100x Individually wrapped sterile sampling mouthpieces',
      'Wireless Bluetooth mobile receipt printer + 5 paper rolls',
      'Rechargeable battery pack & vehicle 12V auxiliary charger',
      'Gas sensor calibration & verification test certificate',
    ];
  }
  if (p.includes('barrier') || p.includes('boom') || p.includes('bollard') || c.includes('barrier')) {
    return [
      'Skid-mounted live demonstration barrier unit',
      'Electro-hydraulic power unit (HPU) demo control console',
      'Dual optical safety photocell sensor kit',
      'Remote RF transmitter key fob controller (2 units)',
      'Crash rating structural impact dossier & wiring schematic',
    ];
  }
  return [
    'Original ruggedized transit & deployment case',
    'Standard AC power supply adapter (230V / 50Hz)',
    'Full accessory connection wiring & interface harness',
    'Certified demonstration verification sample kit',
    'OEM operational manual and calibration compliance card',
  ];
};

export default function VisitsPage() {
  const { user, hasRole } = useAuth();

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'my_visits' | 'manager_dashboard' | 'trips' | 'customer_history' | 'employee_activity'>('my_visits');

  // Core Data
  const [visits, setVisits] = useState<any[]>([]);
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
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterTravelOnly, setFilterTravelOnly] = useState(false);
  const [filterDemoOnly, setFilterDemoOnly] = useState(false);

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
    planned_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], // 1 week in advance default
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
  });
  const [demoTeamAvailability, setDemoTeamAvailability] = useState<any[]>([]);
  const [isLoadingTeamAvailability, setIsLoadingTeamAvailability] = useState(false);

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

    // Filter matching equipment vs others
    const matched = activeProductId ? list.filter((e) => e.product_id === activeProductId) : [];
    const others = activeProductId ? list.filter((e) => e.product_id !== activeProductId) : list;

    const opts: { value: string; label: string }[] = [
      { value: '', label: '-- Choose Registered Demo Model & Serial --' },
    ];

    const formatOptLabel = (e: any, isStar = false) => {
      const isAvail = e.availability_status === 'available';
      const isReserved = e.availability_status === 'reserved' || e.availability_status === 'in_use';
      const isMaint = e.availability_status === 'maintenance';

      const statusTag = isAvail
        ? '🟢 [AVAILABLE]'
        : isReserved
        ? `🟡 [RESERVED${e.reserved_until ? ` to ${new Date(e.reserved_until).toLocaleDateString()}` : ''}]`
        : isMaint
        ? '🔴 [MAINTENANCE]'
        : `⚪ [${(e.availability_status || 'UNKNOWN').toUpperCase()}]`;

      const cond = e.condition ? ` • ${e.condition}` : '';
      return `${isStar ? '★ ' : ''}${statusTag} S/N: ${e.serial_no} — ${e.model} (${e.current_location} Depot${cond})`;
    };

    if (matched.length > 0) {
      opts.push(
        ...matched.map((e) => ({
          value: `${e.model} | S/N: ${e.serial_no} (${e.current_location} Depot)`,
          label: formatOptLabel(e, true),
        }))
      );
    }

    if (others.length > 0) {
      opts.push(
        ...others.map((e) => ({
          value: `${e.model} | S/N: ${e.serial_no} (${e.current_location} Depot)`,
          label: formatOptLabel(e, false),
        }))
      );
    }

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
    trip_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
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
  const fetchData = async () => {
    try {
      setIsLoading(true);

      const [visitsRes, tripsRes, orgsRes, prodsRes, usersRes, demoEquipRes] = await Promise.all([
        api.get('/visits', {
          limit: 100,
          search: filterSearch || undefined,
          status: filterStatus || undefined,
          assigned_to: filterEmployee || undefined,
          dateFrom: filterDateFrom || undefined,
          dateTo: filterDateTo || undefined,
          travel_required: filterTravelOnly ? 'true' : undefined,
          demo_required: filterDemoOnly ? 'true' : undefined,
        }),
        api.get('/visits/trips'),
        api.get('/organisations', { limit: 100 }),
        api.get('/products', { limit: 100 }).catch(() => api.get('/masters/products')).catch(() => []),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/demos/equipment').catch(() => []),
      ]);

      setVisits(visitsRes.data || []);
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
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterStatus, filterEmployee, filterDateFrom, filterDateTo, filterTravelOnly, filterDemoOnly]);

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

      const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const chosenOfficer = [newVisit.assigned_to, user?.id].find(
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
        planned_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
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
      });
      setTravelDetails({
        travel_from: 'Delhi NCR (HQ Base)',
        travel_to: '',
        travel_mode: 'Express Train (Shatabdi/Rajdhani)',
        lodging_required: false,
        stay_nights: '1',
      });
      await fetchData();
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
      await api.post('/visits/trips', {
        employee_id: newTrip.employee_id || user?.id,
        trip_date: newTrip.trip_date,
        base_location: newTrip.base_location,
        notes: newTrip.notes,
      });

      setIsCreateTripOpen(false);
      setNewTrip({
        employee_id: '',
        trip_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        base_location: '',
        notes: '',
      });
      await fetchData();
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
      await fetchData();
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
      await fetchData();
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
      await api.post(`/visits/${selectedVisit.id}/reschedule`, {
        new_date: rescheduleData.new_date,
        start_time: rescheduleData.start_time || undefined,
        end_time: rescheduleData.end_time || undefined,
        reason: rescheduleData.reason,
      });

      setIsRescheduleOpen(false);
      setRescheduleData({ new_date: '', start_time: '', end_time: '', reason: '' });
      await fetchData();
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
      await fetchData();
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
      await fetchData();
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
      await fetchData();
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

  // KPI Calculations
  const stats = useMemo(() => {
    const total = visits.length;
    const today = new Date().toISOString().split('T')[0];
    const todayCount = visits.filter((v) => v.planned_date === today).length;
    const directives = visits.filter((v) => v.manager_assigned || v.remarks?.includes('Manager Directive') || v.remarks?.includes('Manager Intervention') || v.assigned_by_manager).length;
    const completed = visits.filter((v) => v.status === 'completed').length;
    return { total, todayCount, directives, completed };
  }, [visits]);

  // Manager Visit Card rendering all 10 fields and manager directives
  const renderManagerVisitCard = (v: any) => (
    <div
      key={v.id}
      className="p-4 bg-white border border-[#DCD8CE] rounded-xl hover:border-[#0F5E63] transition-all shadow-2xs space-y-3"
    >
      {/* Top row: Organisation, Tour tag, Requirement badges, Status */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-gray-100 pb-2.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold text-[#14213D] text-base">{v.organisation_name}</span>
            {v.trip_base_location && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1">
                <Route className="h-3 w-3" />
                Tour: {v.trip_base_location}
              </span>
            )}
            {v.travel_required && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                <Compass className="h-3 w-3" />
                Travel Required
              </span>
            )}
            {v.demo_required && (
              <div className="flex items-center gap-1.5">
                {v.linked_demo_no ? (
                  <Link
                    href={`/demos?search=${v.linked_demo_no}`}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/25 hover:underline flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Linked Demo: {v.linked_demo_no}
                  </Link>
                ) : (
                  <Link
                    href={`/demos`}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Demo Required • Request Demo
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Key metadata row: Location, Date & Time, Assigned Officer, Contact Person */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4A5568] mt-1.5">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <span className="font-medium text-gray-700">{v.location || 'HQ Station'}</span>
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
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
              <User className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <span>Officer: <strong className="text-gray-800">{v.assignee_name || 'Sales Staff'}</strong></span>
            </span>
            {(v.contact_name || v.contact_person) && (
              <span className="flex items-center gap-1 text-[#0F5E63]">
                <Users className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                <span>Contact: <strong className="text-gray-800">{v.contact_name || v.contact_person}</strong></span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {getStatusBadge(v.status)}
        </div>
      </div>

      {/* Purpose & Product/Outcome 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="p-2.5 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]/60 space-y-1">
          <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">Visit Purpose</span>
          <p className="text-gray-800 font-medium">{v.purpose || 'Portfolio review & client engagement'}</p>
        </div>

        <div className="p-2.5 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]/60 space-y-1">
          <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block">Product & Expected Outcome</span>
          <div className="flex items-center gap-1.5 text-gray-800 font-medium">
            <Layers className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>{v.product_name || 'General Defence Portfolio'}</span>
          </div>
          {v.expected_outcome && (
            <p className="text-gray-600 text-[11px] italic mt-0.5">
              Outcome: {v.expected_outcome}
            </p>
          )}
        </div>
      </div>

      {/* Remarks & Manager Directives / Change Reasons */}
      {(v.remarks || v.change_reason) && (
        <div className="text-xs space-y-1">
          {v.remarks && (
            <div className="p-2 bg-gray-50 rounded-lg border border-gray-200 text-gray-700 flex items-start gap-1.5">
              <FileText className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-gray-900">Remarks: </span>
                <span>{v.remarks}</span>
              </div>
            </div>
          )}
          {v.change_reason && (
            <div className="p-2 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold">Schedule Change: </span>
                <span>{v.change_reason}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manager Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
        <div className="text-[11px] text-[#4A5568]">
          Visit ID: <span className="font-mono text-gray-600 font-semibold">{v.id.slice(0, 8)}</span>
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
            className="border-amber-300 text-amber-800 hover:bg-amber-50 text-xs"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1 text-amber-700" />
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
        description="Weekly tour programs, multi-stop trips, regional manager directives, and post-visit intelligence."
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
                setNewVisit((prev) => ({ ...prev, assigned_to: prev.assigned_to || defaultOfficer }));
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

      {/* KPI Cards */}
      <StatGrid columns={4}>
        <StatCard
          label="Total Field Visits"
          value={stats.total}
          subtext="Scheduled itineraries"
          icon={<CalendarDays className="h-4 w-4 text-[#0F5E63]" />}
        />

        <StatCard
          label="Today's Visits"
          value={stats.todayCount}
          valueColor="emerald"
          subtext="Active deployments today"
          icon={<Clock className="h-4 w-4 text-emerald-600" />}
        />

        <StatCard
          label="Manager Directives"
          value={stats.directives}
          valueColor="amber"
          subtext='"Also-Meet" strategic guidance'
          icon={<Sparkles className="h-4 w-4 text-amber-600" />}
        />

        <StatCard
          label="Completed Reports"
          value={stats.completed}
          valueColor="primary"
          subtext="Intelligence & outcomes logged"
          icon={<CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />}
        />
      </StatGrid>

      {/* Main Tab Switcher */}
      <Tabs
        variant="pills"
        tabs={[
          {
            id: 'my_visits',
            label: `My Scheduled Visits`,
            icon: <Calendar className="h-3.5 w-3.5" />,
            count: visits.length,
          },
          ...(hasRole(['management', 'regional_manager', 'admin'])
            ? [
                {
                  id: 'manager_dashboard',
                  label: 'Manager Team Activity',
                  icon: <Shield className="h-3.5 w-3.5" />,
                },
              ]
            : []),
          {
            id: 'trips',
            label: 'Trips & Multi-Stop Plans',
            icon: <Route className="h-3.5 w-3.5" />,
            count: trips.length,
          },
          {
            id: 'customer_history',
            label: 'Customer Timeline',
            icon: <Building className="h-3.5 w-3.5" />,
          },
          {
            id: 'employee_activity',
            label: 'Employee Activity Dossier',
            icon: <History className="h-3.5 w-3.5" />,
          },
        ]}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* Filter Toolbar */}
      <div className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* Search */}
          <div className="col-span-1 sm:col-span-2">
            <Input
              placeholder="Search organisation, city, officer, purpose..."
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="text-xs"
            />
          </div>

          {/* Status Filter */}
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={[
              { value: '', label: 'All Statuses' },
              { value: 'planned', label: 'Planned' },
              { value: 'modified', label: 'Modified' },
              { value: 'rescheduled', label: 'Rescheduled' },
              { value: 'completed', label: 'Completed' },
              { value: 'not_completed', label: 'Not Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />

          {/* Employee Filter (For Managers) */}
          {hasRole(['management', 'regional_manager', 'admin']) && (
            <Select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              options={[
                { value: '', label: 'All Team Members' },
                ...usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
              ]}
            />
          )}

          {/* Date From */}
          <Input
            type="date"
            placeholder="From Date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="text-xs"
          />

          {/* Date To */}
          <Input
            type="date"
            placeholder="To Date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="text-xs"
          />
        </div>

        {/* Quick Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-100">
          <div className="flex items-center gap-4 text-xs font-semibold text-gray-700">
            <Checkbox
              checked={filterTravelOnly}
              onChange={(e) => setFilterTravelOnly(e.target.checked)}
              label="Travel Required Only"
            />

            <Checkbox
              checked={filterDemoOnly}
              onChange={(e) => setFilterDemoOnly(e.target.checked)}
              label="Demo Required Only"
            />
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilterSearch('');
              setFilterStatus('');
              setFilterEmployee('');
              setFilterDateFrom('');
              setFilterDateTo('');
              setFilterTravelOnly(false);
              setFilterDemoOnly(false);
              fetchData();
            }}
            className="text-xs text-[#4A5568]"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            <span>Reset Filters</span>
          </Button>
        </div>
      </div>

      {/* TAB CONTENT: MY VISITS */}
      {activeTab === 'my_visits' && (
        <div className="space-y-3.5">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
              Loading field visit schedules...
            </div>
          ) : visits.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
              No field visits match the active filters.
            </div>
          ) : (
            visits.map((v) => (
              <div
                key={v.id}
                className="p-5 rounded-xl border border-[#DCD8CE] bg-white hover:border-[#3770E3] transition-all space-y-4 shadow-xs"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {getStatusBadge(v.status)}

                      {v.manager_assigned && (
                        <Badge variant="warning" size="sm" className="bg-amber-100 text-amber-900 border-amber-300">
                          Manager Assigned
                        </Badge>
                      )}

                      {v.travel_required && (
                        <Badge variant="info" size="sm" className="bg-blue-50 text-blue-800 border-blue-200">
                          Travel Required
                        </Badge>
                      )}

                      {v.planned_date && (() => {
                        const planDate = new Date(v.planned_date);
                        const createdDate = v.created_at ? new Date(v.created_at) : new Date();
                        const diffDays = Math.round((planDate.getTime() - createdDate.getTime()) / (1000 * 3600 * 24));
                        if (diffDays >= 5) {
                          return (
                            <Badge variant="outline" size="sm" className="bg-emerald-50 text-emerald-800 border-emerald-300">
                              1-Wk Cycle
                            </Badge>
                          );
                        }
                        return null;
                      })()}

                      {v.demo_required && (
                        v.linked_demo_no ? (
                          <Link
                            href={`/demos?search=${v.linked_demo_no}`}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/25 hover:underline flex items-center gap-1"
                          >
                            <Sparkles className="h-3 w-3" />
                            DEMO: {v.linked_demo_no}
                          </Link>
                        ) : (
                          <Badge variant="default" size="sm" className="bg-purple-50 text-purple-800 border-purple-200">
                            DEMO TRIAL REQ.
                          </Badge>
                        )
                      )}

                      <span className="text-sm font-bold text-[#14213D]">
                        {v.organisation_name || 'Client Agency'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4A5568]">
                      <span className="flex items-center gap-1 text-gray-700 font-medium">
                        <MapPin className="h-3.5 w-3.5 text-[#0F5E63]" />
                        {v.location || 'Site Location'}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-gray-700">
                        <Clock className="h-3.5 w-3.5 text-[#4A5568]" />
                        {new Date(v.planned_date).toLocaleDateString('en-IN', {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {v.start_time ? ` • ${v.start_time} - ${v.end_time || ''}` : ''}
                      </span>
                      <span className="flex items-center gap-1 text-[#4A5568]">
                        <User className="h-3.5 w-3.5 text-[#4A5568]" />
                        Officer: {v.assignee_name || 'Sales Staff'}
                      </span>
                      {v.product_name && (
                        <span className="flex items-center gap-1 text-emerald-800 font-medium">
                          <Layers className="h-3.5 w-3.5 text-emerald-600" />
                          Product: {v.product_name}
                        </span>
                      )}
                      {(v.contact_name || v.contact_person) && (
                        <span className="flex items-center gap-1 text-[#0F5E63] font-medium">
                          <User className="h-3.5 w-3.5 text-[#0F5E63]" />
                          Contact: <span className="font-semibold text-gray-800">{v.contact_name || v.contact_person}</span>
                        </span>
                      )}
                    </div>

                    {v.purpose && (
                      <p className="text-xs text-gray-700 pt-1 font-medium">
                        <span className="text-[#4A5568] font-semibold">Purpose:</span> {v.purpose}
                      </p>
                    )}

                    {v.expected_outcome && (
                      <p className="text-xs text-[#4A5568]">
                        <span className="font-semibold text-gray-600">Expected Outcome:</span> {v.expected_outcome}
                      </p>
                    )}

                    {v.remarks && !v.remarks.includes('Manager Directive:') && !v.remarks.includes('Manager Intervention') && (
                      <p className="text-xs text-[#4A5568] bg-[#FBFAF7] px-2.5 py-1.5 rounded-lg border border-[#DCD8CE] mt-1">
                        <span className="font-semibold text-gray-700">Remarks: </span>
                        {v.remarks}
                      </p>
                    )}

                    {v.change_reason && (
                      <div className="text-xs text-amber-900 bg-amber-50/80 p-2 rounded-lg border border-amber-200 mt-1">
                        <span className="font-bold">Change Reason:</span> {v.change_reason}
                        {v.rescheduled_from && (
                          <span className="text-amber-700 ml-2">(Rescheduled from {new Date(v.rescheduled_from).toLocaleDateString('en-IN')})</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Manager Also-Meet Intervention */}
                    {hasRole(['management', 'regional_manager', 'admin']) && (
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
                        className="border-amber-300 text-amber-800 hover:bg-amber-50"
                      >
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        <span>Also-Meet Directive</span>
                      </Button>
                    )}

                    {/* Post-Visit Update: only for planned or modified or rescheduled visits */}
                    {['planned', 'modified', 'rescheduled'].includes(v.status) && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
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
                          }}
                        >
                          <FileEdit className="h-3.5 w-3.5 mr-1" />
                          <span>Submit Report</span>
                        </Button>

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
                          className="text-[#0F5E63]"
                        >
                          <span>Reschedule</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedVisit(v);
                            setNewDestination({
                              new_location: v.location || '',
                              reason: '',
                            });
                            setIsDestinationOpen(true);
                          }}
                          className="text-gray-700"
                        >
                          <span>Change Station</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedVisit(v);
                            setCancelReason('');
                            setIsCancelOpen(true);
                          }}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <span>Cancel</span>
                        </Button>
                      </>
                    )}

                    {/* Claim Expense for this visit */}
                    <Link href={`/expenses?visit_id=${v.id}`}>
                      <Button size="sm" variant="ghost" className="text-[#0F5E63]">
                        <Receipt className="h-3.5 w-3.5 mr-1 text-[#4A5568]" />
                        <span>Claim Expense</span>
                      </Button>
                    </Link>

                    {/* Audit History */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenAudit(v)}
                      className="text-gray-500 hover:text-gray-800"
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Manager "Also-Meet" Banner Callout */}
                {(v.manager_assigned || v.remarks?.includes('Manager Directive') || v.remarks?.includes('Manager Intervention')) && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start space-x-3 shadow-xs">
                    <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-800 uppercase tracking-wider block text-[10px]">
                        REGIONAL MANAGER STRATEGIC "ALSO-MEET" DIRECTIVE:
                      </span>
                      <p className="mt-0.5 font-medium leading-relaxed">
                        {v.remarks}
                      </p>
                    </div>
                  </div>
                )}

                {/* Completed Report Callout */}
                {v.updates && v.updates.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-gray-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0F5E63] uppercase tracking-wider text-[10px] flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        POST-VISIT INTELLIGENCE LOGGED:
                      </span>
                      {v.updates[0].updated_by_name && (
                        <span className="text-[10px] text-[#4A5568]">Logged by {v.updates[0].updated_by_name}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="font-bold text-gray-700">Person Met: </span>
                        <span>{v.updates[0].person_met || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="font-bold text-gray-700">Outcome: </span>
                        <span className="font-semibold text-emerald-700">{v.updates[0].outcome || 'Completed'}</span>
                      </div>
                      {v.updates[0].product_discussed && (
                        <div>
                          <span className="font-bold text-gray-700">Product Discussed: </span>
                          <span className="text-[#0F5E63] font-medium">{v.updates[0].product_discussed}</span>
                        </div>
                      )}
                      {v.updates[0].opportunity && (
                        <div>
                          <span className="font-bold text-gray-700">Opportunity: </span>
                          <span className="text-emerald-700 font-medium">{v.updates[0].opportunity}</span>
                        </div>
                      )}
                      {v.updates[0].tender_opportunity && (
                        <div className="col-span-full">
                          <span className="font-bold text-[#0F5E63]">Tender / GeM Bid: </span>
                          <span className="font-mono text-[#0F5E63] bg-[#E3EFEE] px-2 py-0.5 rounded text-[11px] font-semibold border border-[#DCD8CE]">
                            {v.updates[0].tender_opportunity}
                          </span>
                        </div>
                      )}
                      {v.updates[0].demo_required && (
                        <div>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F5E63] bg-[#E3EFEE] px-2 py-0.5 rounded-full border border-[#DCD8CE]">
                            <Sparkles className="h-3 w-3" /> Technical Demo Requested
                          </span>
                        </div>
                      )}
                    </div>
                    {v.updates[0].discussion && (
                      <p className="text-gray-700 italic border-l-2 border-[#3770E3] pl-2 mt-1.5">
                        "{v.updates[0].discussion}"
                      </p>
                    )}
                    {v.updates[0].remarks && (
                      <p className="text-xs text-gray-600 bg-white p-2 rounded border border-[#DCD8CE] mt-1">
                        <span className="font-bold text-gray-700">Field Remarks: </span>{v.updates[0].remarks}
                      </p>
                    )}
                    {v.updates[0].followup_date && (
                      <div className="text-[11px] text-[#0F5E63] font-semibold flex items-center gap-1 mt-1.5">
                        <Clock className="h-3 w-3" />
                        Next Follow-up Commitment: {new Date(v.updates[0].followup_date).toLocaleDateString('en-IN')}
                        {v.updates[0].next_action ? ` — ${v.updates[0].next_action}` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
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
                <span className="text-2xl font-black text-[#14213D]">{managerData.summary?.todayCount || 0}</span>
                <span className="block text-xs text-[#4A5568]">Deployed Today</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <span className="text-2xl font-black text-[#14213D]">{managerData.summary?.tomorrowCount || 0}</span>
                <span className="block text-xs text-[#4A5568]">Tomorrow</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <span className="text-2xl font-black text-[#14213D]">{managerData.summary?.next7DaysCount || 0}</span>
                <span className="block text-xs text-[#4A5568]">Next 7 Days (1-Wk Cycle)</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-[#DCD8CE]">
                <span className="text-2xl font-black text-[#14213D]">{managerData.summary?.laterCount || 0}</span>
                <span className="block text-xs text-[#4A5568]">Later</span>
              </div>
            </div>
          </div>

          {/* Group 1: Today */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Today's Deployed Operations ({managerData.grouped?.today?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-emerald-700">Live Field Status</span>
            </h3>
            {(!managerData.grouped?.today || managerData.grouped?.today?.length === 0) ? (
              <p className="text-xs text-gray-500 italic p-3 bg-white rounded-lg border border-gray-200">No field visits scheduled for today.</p>
            ) : (
              managerData.grouped?.today?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>

          {/* Group 2: Tomorrow */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <span>Tomorrow's Deployments ({managerData.grouped?.tomorrow?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-blue-700">Departure Readiness</span>
            </h3>
            {(!managerData.grouped?.tomorrow || managerData.grouped?.tomorrow?.length === 0) ? (
              <p className="text-xs text-gray-500 italic p-3 bg-white rounded-lg border border-gray-200">No field visits scheduled for tomorrow.</p>
            ) : (
              managerData.grouped?.tomorrow?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>

          {/* Group 3: Next 7 Days */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>Next 7 Days Field Schedule ({managerData.grouped?.next_7_days?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-indigo-700">Pre-Planned Horizon</span>
            </h3>
            {(!managerData.grouped?.next_7_days || managerData.grouped?.next_7_days?.length === 0) ? (
              <p className="text-xs text-gray-500 italic p-3 bg-white rounded-lg border border-gray-200">No field visits scheduled for the next 7 days.</p>
            ) : (
              managerData.grouped?.next_7_days?.map((v: any) => renderManagerVisitCard(v))
            )}
          </div>

          {/* Group 4: Later / Future Deployments */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-purple-800 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Route className="h-3.5 w-3.5" />
                <span>Later & Long-Range Tour Programs ({managerData.grouped?.later?.length || 0})</span>
              </span>
              <span className="text-xs font-medium text-purple-700">Future Calendar</span>
            </h3>
            {(!managerData.grouped?.later || managerData.grouped?.later?.length === 0) ? (
              <p className="text-xs text-gray-500 italic p-3 bg-white rounded-lg border border-gray-200">No long-range visits scheduled beyond 7 days.</p>
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
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
                        className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                      >
                        <Navigation className="h-3.5 w-3.5 mr-1 text-indigo-600" />
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
                    <p className="text-xs text-gray-400 italic">No visits currently attached to this tour.</p>
                  ) : (
                    t.visits.map((tv: any, idx: number) => (
                      <div
                        key={tv.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs"
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
                            className="text-gray-400 hover:text-gray-700"
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
          <div className="flex items-center gap-3 bg-white p-4 rounded-xl border border-[#DCD8CE] shadow-xs">
            <span className="text-xs font-bold text-gray-700 shrink-0">Select Customer / Agency:</span>
            <Select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              options={organisations.map((o) => ({ value: o.id, label: `${o.name} (${o.city || 'State'})` }))}
              className="max-w-md"
            />
          </div>

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
                      <span className="text-xs font-bold text-gray-800">
                        {new Date(item.planned_date).toLocaleDateString('en-IN', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    {getStatusBadge(item.status)}
                  </div>

                  <div className="text-xs text-gray-700 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-lg">
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
                    <p className="text-xs text-gray-700 pt-1">
                      <span className="font-bold text-[#4A5568]">Discussion Notes:</span> {item.discussion}
                    </p>
                  )}

                  {item.followup_date && (
                    <div className="text-[11px] text-emerald-800 font-semibold flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Follow-up Commitment: {new Date(item.followup_date).toLocaleDateString('en-IN')}
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
            <p className="text-xs text-gray-500 mt-0.5">Chronological record of verified customer engagements and milestone follow-ups.</p>
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
                      {new Date(act.activity_date).toLocaleDateString('en-IN')}
                    </span>
                    {act.outcome && (
                      <span className="font-semibold text-emerald-800">
                        Outcome: {act.outcome}
                      </span>
                    )}
                  </div>

                  {act.next_action && (
                    <div className="text-xs text-blue-900 bg-blue-50 p-2 rounded-lg border border-blue-200">
                      <span className="font-bold">Next Action Commitment:</span> {act.next_action}
                      {act.followup_date && ` (By ${new Date(act.followup_date).toLocaleDateString('en-IN')})`}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* MODAL 1: PLAN CLIENT VISIT */}
      {/* ----------------------------------------------------------- */}
      <Modal
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        title="Plan Client Field Visit"
        description="Schedule upcoming procurement meetings and product demonstrations."
        maxWidth="4xl"
      >
        <form onSubmit={handleScheduleVisit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
              {actionError}
            </div>
          )}

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-blue-600" />
            <span>Standard operating procedure: Plan field visits approximately 1 week in advance.</span>
          </div>

          {/* Section 1: Customer Agency & Assigned Visiting Officer */}
          <div className="space-y-3 p-3.5 bg-gray-50/70 rounded-xl border border-[#DCD8CE]">
            <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
              1. Visiting Officer & Target Agency
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
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

          {/* Section 2: Date & Purpose */}
          <div className="space-y-3 p-3.5 bg-gray-50/70 rounded-xl border border-[#DCD8CE]">
            <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
              2. Date, Time & Meeting Purpose
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="w-full flex flex-col justify-end text-left">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#14213D]">
                    Planned Date <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 7);
                      setNewVisit({ ...newVisit, planned_date: d.toISOString().split('T')[0] });
                    }}
                    className="text-[10px] text-[#0F5E63] hover:underline font-bold"
                  >
                    +7 Days
                  </button>
                </div>
                <input
                  type="date"
                  required
                  value={newVisit.planned_date}
                  onChange={(e) => setNewVisit({ ...newVisit, planned_date: e.target.value })}
                  className="flex h-10 w-full rounded-[8px] border border-[#C9C4B8] bg-white px-3.5 py-2 text-xs text-[#14213D] transition-colors focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>

              <Input
                label="Start Time"
                type="time"
                value={newVisit.start_time}
                onChange={(e) => setNewVisit({ ...newVisit, start_time: e.target.value })}
              />

              <Input
                label="End Time"
                type="time"
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

          {/* Section 3: Product Focus & Expected Outcome */}
          <div className="space-y-3 p-3.5 bg-gray-50/70 rounded-xl border border-[#DCD8CE]">
            <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
              3. Product Focus & Strategic Outcome
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>

          {/* Section 4: Travel, Demo Requirements & Remarks */}
          <div className="space-y-3.5 p-3.5 bg-gray-50/70 rounded-xl border border-[#DCD8CE]">
            <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
              4. Field Requisition & Special Requirements
            </span>

            {/* Clean Requirement Checkboxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      A. Live Demonstration Setup Details
                    </span>
                    <span className="text-[10px] text-[#0F5E63] font-semibold">
                      {newVisit.demo_required ? 'Configuring ▼' : 'Click to Setup ▶'}
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

            {/* A. Live Demonstration Setup Details */}
            {newVisit.demo_required && (
              <div className="p-3.5 bg-white rounded-xl border border-[#DCD8CE] space-y-3 animate-in fade-in duration-150">
                <div className="pb-1.5 border-b border-[#ECE9E2] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#14213D]">
                      A. Live Demonstration Setup Details
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0F5E63] animate-pulse" />
                      Live Fleet Sync
                    </span>
                  </div>
                  <span className="text-[10px] text-[#4A5568]">
                    Depot Inventory & Calibration Status
                  </span>
                </div>

                {/* 1. Demo Form Context Bar (Customer, Location, Requested Date, Salesperson, Purpose) */}
                <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#ECE9E2] space-y-2 text-xs">
                  <div className="flex items-center justify-between pb-1.5 border-b border-[#ECE9E2]">
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
                        📅 {new Date(newVisit.planned_date).toLocaleDateString()}
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
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[#14213D]">
                      Assigned Demo Team Specialist *
                    </label>
                    {isLoadingTeamAvailability ? (
                      <span className="text-[10px] text-[#0F5E63] flex items-center gap-1">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Checking Team Availability...
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#4A5568]">
                        Availability for {new Date(newVisit.planned_date).toLocaleDateString()}
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

                  {/* Pre-selection Demo Team Member Roster (when none selected yet) */}
                  {!selectedDemoMember && (
                    <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                          Demo Team Availability on {new Date(newVisit.planned_date).toLocaleDateString()}:
                        </span>
                        <span className="text-[10px] text-[#0F5E63] font-medium">Click specialist to book</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {(demoTeamAvailability.length > 0 ? demoTeamAvailability : usersList.filter((u) => ['demo_team', 'service_team', 'sales'].includes(u.role))).map((m) => {
                          const isAvail = m.is_available ?? true;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setDemoDetails((prev) => ({ ...prev, demo_assigned_to: m.id }))}
                              className="flex items-center justify-between p-2 rounded bg-white border border-[#ECE9E2] hover:border-[#0F5E63] text-left transition-colors group"
                            >
                              <div className="space-y-0.5 truncate pr-1">
                                <span className="font-semibold text-[#14213D] text-[11px] block truncate group-hover:text-[#0F5E63]">
                                  {m.full_name}
                                </span>
                                <span className="text-[10px] text-[#4A5568] block truncate">
                                  {m.role === 'demo_team' ? 'Demo Specialist' : m.role.replace(/_/g, ' ')} {m.phone ? `• ${m.phone}` : ''}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-bold shrink-0 ml-1 px-1.5 py-0.5 rounded ${
                                  isAvail ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {isAvail ? '🟢 Available' : '🟡 Booked'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                            <Badge variant="success">● AVAILABLE ON {new Date(newVisit.planned_date).toLocaleDateString()}</Badge>
                          ) : (
                            <Badge variant="warning">
                              ▲ BUSY ON {selectedDemoMember.active_demo?.demo_no || 'ANOTHER TRIAL'}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="text-[11px] text-[#4A5568]">
                        {selectedDemoMember.is_available ?? true ? (
                          <div className="flex items-center gap-1.5 text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            <span>Specialist has zero trial schedule conflicts on this date and is cleared for field demonstration.</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-amber-800">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
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
                        setDemoDetails({ ...demoDetails, product_id: pId });
                        if (pId && !newVisit.product_id) {
                          setNewVisit((prev) => ({ ...prev, product_id: pId }));
                        }
                      }}
                      options={[
                        { value: '', label: '-- Select Equipment Category / Product --' },
                        ...products.map((p) => {
                          const pUnits = (demoEquipmentList || []).filter((e) => e.product_id === p.id);
                          const avail = pUnits.filter((e) => e.availability_status === 'available');
                          let statusTag = '';
                          if (avail.length > 0) {
                            const locs = Array.from(new Set(avail.map((u) => u.current_location).filter(Boolean)));
                            statusTag = `[AVAILABLE: ${avail.length} of ${pUnits.length} in ${locs.join(', ')}]`;
                          } else if (pUnits.length > 0) {
                            statusTag = `[RESERVED / IN USE: ${pUnits.length} Units]`;
                          } else {
                            statusTag = `[NO DEMO FLEET UNIT]`;
                          }
                          return {
                            value: p.id,
                            label: `${statusTag} ${p.name} (${p.category || 'Security'})`,
                          };
                        }),
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

                  {/* Fleet Availability Overview by Product (when no product is selected yet) - Full Width */}
                  {!activeProductFleet && (
                    <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                          Demo Equipment Fleet Availability & Status:
                        </span>
                        <span className="text-[10px] text-[#0F5E63] font-medium">Click to select equipment</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {products.slice(0, 9).map((p) => {
                          const pUnits = (demoEquipmentList || []).filter((e) => e.product_id === p.id);
                          const availCount = pUnits.filter((e) => e.availability_status === 'available').length;
                          const total = pUnits.length;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setDemoDetails((prev) => ({ ...prev, product_id: p.id }));
                                if (!newVisit.product_id) setNewVisit((prev) => ({ ...prev, product_id: p.id }));
                              }}
                              className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#ECE9E2] hover:border-[#0F5E63] text-left transition-colors group"
                            >
                              <span className="font-semibold text-[#14213D] truncate text-[11px] group-hover:text-[#0F5E63]">
                                {p.name}
                              </span>
                              <span
                                className={`text-[10px] font-mono font-bold shrink-0 ml-1.5 px-1.5 py-0.5 rounded ${
                                  availCount > 0
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : total > 0
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {availCount > 0 ? `🟢 ${availCount}/${total} Ready` : total > 0 ? '🟡 In-Trial' : 'Requisition'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            AVAILABLE ({activeProductFleet.availableCount} Ready)
                          </span>
                        ) : activeProductFleet.total > 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                            RESERVED ({activeProductFleet.total} in Fleet)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-700 border border-gray-300">
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
                          <span className="text-emerald-700">Ready: <b>{activeProductFleet.availableCount}</b></span>
                          <span className="text-amber-700">In-Trial: <b>{activeProductFleet.reservedCount}</b></span>
                          {activeProductFleet.maintenanceCount > 0 && (
                            <span className="text-red-700">Maint: <b>{activeProductFleet.maintenanceCount}</b></span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Available Demo Kits & Serials Roster (when product is selected but specific unit not yet chosen) - Full Width */}
                  {!selectedEquipUnit && activeProductFleet && activeProductFleet.units.length > 0 && (
                    <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2.5 text-xs animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                          Available Demo Kits in Fleet ({activeProductFleet.units.length}):
                        </span>
                        <span className="text-[10px] text-[#0F5E63] font-medium">Click any kit below to assign</span>
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {activeProductFleet.units.map((u) => {
                          const isReady = u.availability_status === 'available';
                          const isReserved = u.availability_status === 'reserved' || u.availability_status === 'in_use';
                          return (
                            <div
                              key={u.id}
                              onClick={() => {
                                const val = `${u.model} | S/N: ${u.serial_no} (${u.current_location} Depot)`;
                                setDemoDetails((prev) => ({
                                  ...prev,
                                  equipment_required: val,
                                  product_id: u.product_id || prev.product_id,
                                }));
                              }}
                              className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg bg-white border border-[#ECE9E2] hover:border-[#0F5E63] cursor-pointer transition-all hover:shadow-xs group gap-2"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-[#14213D] text-[11px] group-hover:text-[#0F5E63]">{u.model}</span>
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#FBFAF7] border border-[#DCD8CE] font-bold text-[#14213D]">
                                    S/N: {u.serial_no}
                                  </span>
                                  <span className="text-[10px] text-[#4A5568]">📍 {u.current_location} Depot</span>
                                  {isReady ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                      🟢 Ready
                                    </span>
                                  ) : isReserved ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                      🟡 Reserved
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                                      🔴 Maint
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[#4A5568]">
                                  📦 Kit includes: Flight case, dual Li-ion batteries, charger & calibration block
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-[#0F5E63] font-bold group-hover:underline">Select Kit →</span>
                              </div>
                            </div>
                          );
                        })}
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
                              ○ RESERVED {selectedEquipUnit.reserved_until ? `UNTIL ${new Date(selectedEquipUnit.reserved_until).toLocaleDateString()}` : ''}
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

                      {/* Included Standard Demo Kit Accessories - Full Width Grid */}
                      <div className="pt-2 border-t border-[#ECE9E2]">
                        <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block mb-1.5">
                          📦 Specific Demo Kit / Included Accessories & Calibration Items:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 text-xs text-[#14213D]">
                          {getStandardKitAccessories(selectedEquipUnit.product_name, selectedEquipUnit.product_category).map((item, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white border border-[#ECE9E2]">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <span className="truncate text-[11px]">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Status Note Callout */}
                      {selectedEquipUnit.availability_status === 'available' ? (
                        <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                          <span>Kit verified and calibrated for client field demonstration. Immediate dispatch supported from {selectedEquipUnit.current_location} Depot.</span>
                        </div>
                      ) : selectedEquipUnit.availability_status === 'reserved' || selectedEquipUnit.availability_status === 'in_use' ? (
                        <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                          <span>This serial is currently scheduled for another trial. Submitting will flag a scheduling overlap notice to the Demo Coordinator.</span>
                        </div>
                      ) : (
                        <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-[11px] flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-700 shrink-0" />
                          <span>Unit marked under maintenance ({selectedEquipUnit.condition}). You may select another serial or custom kit.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
              </div>
            )}

            {/* 4B. Outstation Travel Details */}
            {newVisit.travel_required && (
              <div className="p-3.5 bg-white rounded-xl border border-[#DCD8CE] space-y-3 animate-in fade-in duration-150">
                <div className="pb-1.5 border-b border-[#ECE9E2]">
                  <span className="text-xs font-bold text-[#14213D]">
                    4B. Outstation Travel & Tour Details
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                        label: `${t.base_location} Tour (${new Date(t.trip_date).toLocaleDateString('en-IN')})`,
                      })),
                    ]}
                  />
                </div>

                <div className="flex items-center gap-6 pt-1 text-xs text-[#4A5568]">
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
            )}

            {/* Remarks & Operational Notes */}
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1.5">
                Remarks & Operational Notes
              </label>
              <textarea
                value={newVisit.remarks}
                onChange={(e) => setNewVisit({ ...newVisit, remarks: e.target.value })}
                placeholder="e.g. Officer requested technical compliance sheets; gate pass required for vehicle."
                rows={2}
                className="flex w-full rounded-lg border border-[#DCD8CE] bg-white px-3.5 py-2 text-xs font-normal text-[#14213D] placeholder:text-gray-400 transition-colors focus:border-[#3770E3] focus:outline-none focus:ring-2 focus:ring-[#3770E3]/15"
              />
            </div>

            {trips.length > 0 && !newVisit.travel_required && (
              <Select
                label="Attach to Existing Tour Program (Optional)"
                value={newVisit.trip_id}
                onChange={(e) => setNewVisit({ ...newVisit, trip_id: e.target.value })}
                options={[
                  { value: '', label: '-- Standalone Field Visit --' },
                  ...trips.map((t) => ({ value: t.id, label: `${t.base_location} Tour (${new Date(t.trip_date).toLocaleDateString('en-IN')})` })),
                ]}
              />
            )}
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-gray-100">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsScheduleOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Schedule Visit
            </Button>
          </div>
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
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
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

          <div className="grid grid-cols-2 gap-3">
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
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <span className="font-bold block">Base Station: {selectedTrip?.base_location}</span>
            <span>Visits in this tour program should be reasonably close to avoid travel schedule conflict.</span>
          </div>

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

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Station / Address"
              value={tripVisit.location}
              onChange={(e) => setTripVisit({ ...tripVisit, location: e.target.value })}
              placeholder="e.g. Chandigarh Sector 17"
            />

            <div className="grid grid-cols-2 gap-1.5">
              <Input
                label="Start"
                type="time"
                value={tripVisit.start_time}
                onChange={(e) => setTripVisit({ ...tripVisit, start_time: e.target.value })}
              />
              <Input
                label="End"
                type="time"
                value={tripVisit.end_time}
                onChange={(e) => setTripVisit({ ...tripVisit, end_time: e.target.value })}
              />
            </div>
          </div>

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
        <form onSubmit={handleAlsoMeetSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          {/* Current Target Context: Organisation is already selected by the salesperson */}
          {selectedVisit && (
            <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-[#ECE9E2]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#14213D] text-sm">
                    {selectedVisit.organisation_name}
                  </span>
                  <Badge variant="outline" size="sm" className="bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30">
                    Target Agency Selected
                  </Badge>
                </div>
                <span className="font-mono text-gray-500 text-[11px]">Visit #{selectedVisit.id.slice(0, 8)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-[#4A5568]">
                <div>
                  <span className="text-gray-400 block">Visiting Officer:</span>
                  <strong className="text-[#14213D]">{selectedVisit.assignee_name || selectedVisit.assigned_to_name || 'Assigned Officer'}</strong>
                </div>
                <div>
                  <span className="text-gray-400 block">Station / City:</span>
                  <strong className="text-[#14213D]">{selectedVisit.location || 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-gray-400 block">Planned Date:</span>
                  <strong className="text-[#14213D]">{selectedVisit.planned_date ? new Date(selectedVisit.planned_date).toLocaleDateString('en-IN') : 'N/A'}</strong>
                </div>
                <div>
                  <span className="text-gray-400 block">Customer Contact:</span>
                  <strong className="text-[#14213D]">{selectedVisit.contact_person || selectedVisit.contact_name || 'General Office'}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Manager Directive Instructions for Current Visit */}
          <div className="space-y-3 p-3.5 bg-amber-50/50 rounded-xl border border-amber-200">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-700" />
              <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Manager Directive for {selectedVisit?.organisation_name || 'Customer Agency'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#14213D] mb-1">
                Manager Directive Instructions <span className="text-red-500">*</span>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>

          {/* Optional: Add Secondary Adjacent Organisation to Itinerary */}
          <div className="p-3.5 bg-gray-50/80 rounded-xl border border-[#DCD8CE] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-[#0F5E63]" />
                <div>
                  <span className="text-xs font-bold text-[#14213D] block">
                    Add a Second Organisation to this Trip (Multi-Stop Itinerary)
                  </span>
                  <span className="text-[11px] text-gray-500">
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

            {alsoMeetData.assign_additional && (
              <div className="space-y-3 pt-3 border-t border-[#ECE9E2]">
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                  This will schedule an additional separate field visit for <strong>{selectedVisit?.assignee_name || 'the officer'}</strong> and group both meetings into a unified tour program.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Start Time for 2nd Visit"
                    type="time"
                    value={alsoMeetData.start_time}
                    onChange={(e) => setAlsoMeetData({ ...alsoMeetData, start_time: e.target.value })}
                  />

                  <Input
                    label="End Time for 2nd Visit"
                    type="time"
                    value={alsoMeetData.end_time}
                    onChange={(e) => setAlsoMeetData({ ...alsoMeetData, end_time: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsAlsoMeetOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              {alsoMeetData.assign_additional ? 'Add 2nd Visit & Save Directive' : 'Save Directive'}
            </Button>
          </div>
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
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="New Planned Date"
              type="date"
              required
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
                value={rescheduleData.end_time}
                onChange={(e) => setRescheduleData({ ...rescheduleData, end_time: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Mandatory Rescheduling Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={rescheduleData.reason}
              onChange={(e) => setRescheduleData({ ...rescheduleData, reason: e.target.value })}
              placeholder="e.g. Customer requested postponement due to VIP convoy duty."
              className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#3770E3] focus:border-[#3770E3]"
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
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
              {actionError}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Cancellation Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Field trial cancelled by Ministry due to weather."
              className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#3770E3] focus:border-[#3770E3]"
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
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
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
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Reason for Venue Change <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={newDestination.reason}
              onChange={(e) => setNewDestination({ ...newDestination, reason: e.target.value })}
              placeholder="e.g. Demonstrations moved to outdoor proving range by DIG technical."
              className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#3770E3] focus:border-[#3770E3]"
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
        <form onSubmit={handleReportSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
              {actionError}
            </div>
          )}

          {/* Meeting Status Toggle */}
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
            <label className="block text-xs font-bold text-gray-700">Did the meeting take place?</label>
            <div className="flex items-center gap-6 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-emerald-800">
                <input
                  type="radio"
                  name="met_completed"
                  checked={reportData.met_completed === true}
                  onChange={() => setReportData({ ...reportData, met_completed: true })}
                />
                <span>Yes — Meeting Completed</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-semibold text-red-800">
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

          {reportData.met_completed ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Discussion Summary & Technical Notes <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={reportData.discussion}
                  onChange={(e) => setReportData({ ...reportData, discussion: e.target.value })}
                  placeholder="Points discussed, customer reactions, technical clarifications requested..."
                  className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#3770E3] focus:border-[#3770E3]"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="Next Action Commitment"
                  value={reportData.next_action}
                  onChange={(e) => setReportData({ ...reportData, next_action: e.target.value })}
                  placeholder="e.g. Dispatch demo unit from Delhi Depot"
                />

                <Input
                  label="Follow-Up Milestone Date"
                  type="date"
                  value={reportData.followup_date}
                  onChange={(e) => setReportData({ ...reportData, followup_date: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
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

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  General Remarks & Field Intelligence Notes
                </label>
                <textarea
                  rows={2}
                  value={reportData.remarks}
                  onChange={(e) => setReportData({ ...reportData, remarks: e.target.value })}
                  placeholder="Additional field intelligence, competitive products observed, technical feedback..."
                  className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#3770E3] focus:border-[#3770E3]"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Reason Why Meeting Did Not Take Place <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={reportData.remarks}
                onChange={(e) => setReportData({ ...reportData, remarks: e.target.value })}
                placeholder="e.g. Officer was summoned urgently for VIP convoy movement."
                className="w-full text-xs p-2.5 rounded-lg border border-[#DCD8CE] focus:ring-1 focus:ring-[#3770E3] focus:border-[#3770E3]"
              />
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsReportOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Submit Intelligence
            </Button>
          </div>
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
            <p className="text-xs text-gray-500 italic p-4 text-center">No audit records found.</p>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0F5E63]">{log.action}</span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(log.created_at).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="text-gray-700">
                  <span className="font-semibold text-gray-600">Actor:</span> {log.actor_name || 'System'} ({log.actor_role})
                </div>
                {log.new_value?.reason && (
                  <div className="text-gray-600 italic">
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
