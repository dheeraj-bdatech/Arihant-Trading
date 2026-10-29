'use client';

import Link from 'next/link';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Truck,
  Plus,
  CheckCircle2,
  Clock,
  Building,
  Calendar,
  Package,
  Wrench,
  Search,
  CheckSquare,
  FileCheck,
  MapPin,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { useOpenParam } from '@/lib/use-open-param';
import { userWithRole } from '@/lib/role-label';
import { PROPOSAL_ORDER_TYPES } from '@arihant/shared';
import { canRead } from '@/lib/module-access';
import { canOpen } from '@/lib/route-access';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  FilterMenu,
  PageContainer,
  PageHeader,
  FormSteps,
  FormSection,
  EmptyState, PageLoader, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, StatGrid, StatCard, RowMenu,
  RecordViews, RecordTable, RecordDetails, formatDateIN, daysFromToday, rowDetails, toneFor, type BadgeProps, type RecordItem } from '@/components/ui';

// Consignment lifecycle in workflow order — drives the stage board lanes and the next-step button.
const DELIVERY_STATUSES: { key: string; label: string }[] = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'installed', label: 'Installed' },
  { key: 'handover_completed', label: 'Handover complete' },
  { key: 'cancelled', label: 'Cancelled' },
];
const DELIVERY_FLOW = DELIVERY_STATUSES.filter((s) => s.key !== 'cancelled').map((s) => s.key);
// Handover signed off / cancelled: the consignment is closed and its milestones can no longer change.
const CLOSED_DELIVERY = ['handover_completed', 'cancelled'];
// Milestones move one step at a time: the dialog offers the current stage (to update its details), the next one, or cancel.
const allowedDeliveryStatuses = (current?: string) => {
  const idx = DELIVERY_FLOW.indexOf(String(current));
  const next = idx >= 0 ? DELIVERY_FLOW[idx + 1] : undefined;
  return [current, next, 'cancelled'].filter((s, i, a): s is string => !!s && a.indexOf(s) === i);
};
// "In Transit" card: consignments that have left the depot but not reached site (dispatched + in transit).
const IN_TRANSIT_FILTER = 'dispatched,in_transit';
const DELIVERIES_PAGE_SIZE = 25;
type DeliveryMetrics = { total: number; byStatus: Record<string, number> };
const deliveryStatusLabel = (status?: string) =>
  DELIVERY_STATUSES.find((s) => s.key === status)?.label || String(status || 'Unknown').replace(/_/g, ' ');

type BadgeVariant = NonNullable<BadgeProps['variant']>;
const DELIVERY_BADGE: Record<string, BadgeVariant> = {
  delivered: 'success',
  installed: 'success',
  handover_completed: 'success',
  completed: 'success',
  pending: 'warning',
  awaiting: 'warning',
  on_hold: 'warning',
  scheduled: 'default',
  dispatched: 'default',
  in_transit: 'default',
  cancelled: 'danger',
  failed: 'danger',
  rejected: 'danger',
};
const MILESTONE_OPTION_LABEL: Record<string, string> = {
  scheduled: 'Scheduled (In Depot)',
  dispatched: 'Dispatched (Left Facility)',
  in_transit: 'In Transit (With Transporter)',
  delivered: 'Delivered (Received at Site)',
  installed: 'Installed & Commissioned',
  handover_completed: 'Handover Completed (Client Signoff)',
  cancelled: 'Cancelled',
};
const deliveryBadge = (status?: string): BadgeVariant => DELIVERY_BADGE[String(status || '').toLowerCase()] ?? 'outline';


export default function DeliveriesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Deep link from linked-records panels: /deliveries?search=<SO / delivery no>
  useOpenParam(setSearchQuery, true, 'search');


  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isUpdateStatusOpen, setIsUpdateStatusOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<any | null>(null);
  // List view's Inspect: the same details pop-up the cards open for a record.
  const [inspected, setInspected] = useState<RecordItem | null>(null);

  // New delivery form. PO / carrier / LR stay empty until the user enters them (or links a converted
  // proposal, whose PO fills the order reference) — nothing is invented.
  const emptyDelivery = () => ({
    organisation_id: '',
    product_id: '',
    assigned_to: '',
    delivery_date: addIsoDays(istToday(), 3),
    delivery_location: '',
    product_model: '',
    serial_numbers: '',
    carrier_name: '',
    tracking_number: '',
    order_reference: '',
    remarks: '',
    tender_id: '',
    proposal_id: '',
  });
  const [newDelivery, setNewDelivery] = useState(emptyDelivery);
  const openCreate = (prefill?: Partial<ReturnType<typeof emptyDelivery>>) => {
    setNewDelivery({ ...emptyDelivery(), ...prefill });
    setActionError(null);
    setIsCreateOpen(true);
  };

  // Converted proposals (customer POs) of the selected customer, so the dispatch is raised against the order it fulfils.
  const [orgProposals, setOrgProposals] = useState<any[]>([]);
  useEffect(() => {
    setOrgProposals([]);
    if (!newDelivery.organisation_id || !canRead(user?.role, 'proposals')) return;
    api
      .get('/proposals', { organisation_id: newDelivery.organisation_id, status: 'CONVERTED', limit: 50 })
      .then((res: any) =>
        setOrgProposals((res?.data || []).filter((p: any) => String(p.status).toUpperCase() === 'CONVERTED')),
      )
      .catch(() => setOrgProposals([]));
  }, [newDelivery.organisation_id, user?.role]);
  // Older conversions recorded the PO number in converted_to; it now holds the order type ("Purchase Order" …).
  const proposalPo = (p: any) =>
    p?.conversion_reference ||
    p?.converted_reference ||
    (p?.converted_to && !(PROPOSAL_ORDER_TYPES as readonly string[]).includes(p.converted_to) ? p.converted_to : '') ||
    '';
  const selectProposal = (proposalId: string) => {
    const p = orgProposals.find((x) => x.id === proposalId);
    setNewDelivery((cur) => ({
      ...cur,
      proposal_id: proposalId,
      // Fill only what the user has not typed yet.
      order_reference: p && !cur.order_reference ? proposalPo(p) : cur.order_reference,
      product_id: p?.product_id && !cur.product_id ? p.product_id : cur.product_id,
    }));
  };
  // Deep link from a converted proposal: /deliveries?proposal=<id> opens the dispatch form against it.
  useOpenParam(async (proposalId) => {
    try {
      const p: any = await api.get(`/proposals/${proposalId}`);
      const orgId = p?.organisation_id || p?.customer_id || '';
      openCreate({
        organisation_id: orgId,
        proposal_id: proposalId,
        order_reference: proposalPo(p),
        product_id: p?.product_id || '',
      });
    } catch {
      openCreate();
    }
  }, true, 'proposal');

  // Won tenders of the selected customer, so a delivery can be raised against the bid it fulfils.
  const [orgTenders, setOrgTenders] = useState<any[]>([]);
  useEffect(() => {
    setOrgTenders([]);
    if (!newDelivery.organisation_id || !canRead(user?.role, 'tenders')) return;
    api
      .get('/tenders', { organisation_id: newDelivery.organisation_id, limit: 50 })
      .then((res: any) => setOrgTenders((res?.data || []).filter((t: any) => ['won', 'WON'].includes(t.status))))
      .catch(() => setOrgTenders([]));
  }, [newDelivery.organisation_id, user?.role]);

  // Status update form
  const [updateForm, setUpdateForm] = useState({
    status: 'dispatched',
    received_by: '',
    installation_date: '',
    installation_notes: '',
    remarks: '',
    document_url: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Register: one page per request, appended as the reader scrolls (the API caps a page at 100 rows).
  const fetchDeliveriesPage = useCallback(
    (page: number) => {
      const params: any = { page, limit: DELIVERIES_PAGE_SIZE };
      if (activeTab !== 'all') params.status = activeTab;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      return api.get('/deliveries', params);
    },
    [activeTab, searchQuery],
  );
  const deliveriesList = useInfiniteList<any>(fetchDeliveriesPage);
  const { rows: deliveries, total, loading: isLoading } = deliveriesList;

  // KPI cards + status menu counts: counted by the API over the same scope and filters as the register,
  // except status (each count is a status), so picking a status never zeroes the other cards.
  const [metrics, setMetrics] = useState<DeliveryMetrics | null>(null);
  const metricsGen = useRef(0);
  const fetchMetrics = useCallback(async () => {
    const g = ++metricsGen.current;
    const params: any = {};
    if (searchQuery.trim()) params.search = searchQuery.trim();
    try {
      const res = await api.get<DeliveryMetrics>('/deliveries/metrics', params);
      if (g === metricsGen.current) setMetrics(res);
    } catch (err) {
      console.error('Failed to load delivery metrics:', err);
    }
  }, [searchQuery]);
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // After a create / milestone update: re-read the pages already loaded (in place) and the counts.
  const fetchDeliveries = () => {
    deliveriesList.refresh();
    fetchMetrics();
  };

  const fetchDependencies = async () => {
    try {
      const [orgsRes, prodsRes, usersRes] = await Promise.all([
        api.get('/organisations', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/products', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
      ]);
      setOrganisations(orgsRes.data || orgsRes || []);
      setProducts(prodsRes.data || prodsRes || []);
      setUsers(usersRes.data || usersRes || []);
    } catch (err) {
      console.error('Failed to load dependencies:', err);
    }
  };

  useEffect(() => {
    fetchDependencies();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (!newDelivery.organisation_id) {
        throw new Error('Please select an organization / client customer.');
      }
      if (!newDelivery.delivery_location.trim()) {
        throw new Error('Enter the delivery location / site address.');
      }
      if (!newDelivery.delivery_date || newDelivery.delivery_date < istToday()) {
        throw new Error('The target delivery date cannot be in the past. Choose today or a later date.');
      }

      await api.post('/deliveries', {
        organisation_id: newDelivery.organisation_id,
        product_id: newDelivery.product_id || undefined,
        assigned_to: newDelivery.assigned_to || user?.id,
        delivery_date: newDelivery.delivery_date,
        delivery_location: newDelivery.delivery_location || undefined,
        // API field names: the serial is what the service portal matches a breakdown report back to this customer by.
        model: newDelivery.product_model.trim() || undefined,
        equipment_serial: newDelivery.serial_numbers.trim() || undefined,
        order_reference: newDelivery.order_reference || undefined,
        tender_id: newDelivery.tender_id || undefined,
        proposal_id: newDelivery.proposal_id || undefined,
        // Deliveries have no carrier/LR columns; keep what was entered in the remarks instead of dropping it.
        remarks:
          [
            newDelivery.remarks.trim(),
            [newDelivery.carrier_name.trim() && `Carrier: ${newDelivery.carrier_name.trim()}`, newDelivery.tracking_number.trim() && `LR/Tracking: ${newDelivery.tracking_number.trim()}`].filter(Boolean).join(' · '),
          ]
            .filter(Boolean)
            .join('\n') || undefined,
      });

      setIsCreateOpen(false);
      fetchDeliveries();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create delivery consignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDelivery) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (updateForm.status === 'handover_completed' && (updateForm.received_by.trim().length < 3 || !updateForm.document_url.trim())) {
        throw new Error('Handover needs the client sign-off: the officer who signed and the signed handover certificate (link or reference number).');
      }
      await api.patch(`/deliveries/${selectedDelivery.id}/status`, {
        status: updateForm.status,
        received_by: updateForm.received_by.trim() || undefined,
        installation_date: updateForm.installation_date || undefined,
        installation_notes: updateForm.installation_notes || undefined,
        // New transition remarks only: the API appends them to the delivery's milestone log.
        remarks: updateForm.remarks.trim() || undefined,
        document_url: updateForm.document_url.trim() || undefined,
      });

      setIsUpdateStatusOpen(false);
      setSelectedDelivery(null);
      fetchDeliveries();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update delivery status');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Opens the existing milestone dialog; `next` pre-selects the following stage (the user still confirms it).
  const openStatusUpdate = (delivery: any, next?: string) => {
    setSelectedDelivery(delivery);
    setUpdateForm({
      status: next || delivery.status,
      received_by: '',
      installation_date: calendarDay(delivery.installation_date),
      installation_notes: delivery.installation_notes || '',
      remarks: '',
      document_url: delivery.document_url || '',
    });
    setActionError(null);
    setIsUpdateStatusOpen(true);
  };

  // Register as priority cards / stage board.
  const toDeliveryRecord = (delivery: any): RecordItem => {
    const remarks = String(delivery.remarks || '');
    // Carrier / LR are stored in the remarks at creation ("Carrier: … · LR/Tracking: …").
    const carrier = remarks.match(/Carrier:\s*([^·\n]+)/)?.[1]?.trim();
    const tracking = remarks.match(/LR\/Tracking:\s*([^·\n]+)/)?.[1]?.trim();
    const idx = DELIVERY_FLOW.indexOf(delivery.status);
    const next = idx >= 0 && idx < DELIVERY_FLOW.length - 1 ? DELIVERY_FLOW[idx + 1] : undefined;
    const done = ['delivered', 'installed', 'handover_completed', 'cancelled'].includes(delivery.status);
    const closed = CLOSED_DELIVERY.includes(delivery.status);
    const facts = [
      { label: 'Order ref', value: delivery.order_reference || '—' },
      delivery.model && { label: 'Model', value: delivery.model },
      { label: 'Serial', value: delivery.equipment_serial || '—' },
      (carrier || tracking) && { label: 'Carrier / LR', value: [carrier, tracking].filter(Boolean).join(' · ') },
      delivery.tender_id && {
        label: 'Tender',
        value: canOpen(user?.role, '/tenders') ? (
          <Link href={`/tenders?highlight=${delivery.tender_id}`} onClick={(e) => e.stopPropagation()} className="text-[#0F5E63] hover:underline">
            {delivery.tender_no || 'Linked'}
          </Link>
        ) : (
          delivery.tender_no || 'Linked'
        ),
      },
      // QA DEF-070: the converted proposal (customer PO) this dispatch fulfils.
      delivery.proposal_id && {
        label: 'Proposal',
        value: canOpen(user?.role, '/proposals') ? (
          <Link href={`/proposals?open=${delivery.proposal_id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[#0F5E63] hover:underline">
            {delivery.proposal_no || 'Linked'}
          </Link>
        ) : (
          <span className="font-mono">{delivery.proposal_no || 'Linked'}</span>
        ),
      },
    ].filter(Boolean) as NonNullable<RecordItem['facts']>;
    const quick: NonNullable<RecordItem['quick']> = [];
    if (delivery.organisation_id && canOpen(user?.role, '/leads')) {
      quick.push({ label: 'Customer 360', icon: <Building />, onClick: () => router.push(`/leads?customer=${delivery.organisation_id}`) });
    }
    if (delivery.delivery_location) {
      quick.push({
        label: 'Open in maps',
        icon: <MapPin />,
        onClick: () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.delivery_location)}`, '_blank', 'noopener'),
      });
    }

    return {
      key: String(delivery.id),
      code: delivery.delivery_no,
      title: delivery.product_name || delivery.order_reference || 'Security Scanning Equipment',
      subtitle: [delivery.organisation_name || 'Defence / Security Buyer', delivery.delivery_location].filter(Boolean).join(' · '),
      status: { label: deliveryStatusLabel(delivery.status), tone: toneFor(deliveryStatusLabel(delivery.status)) },
      due: { date: delivery.delivery_date, label: 'Delivery', done },
      owner: delivery.assignee_name || undefined,
      facts,
      // Closed consignments (handover signed off / cancelled) have no further milestones.
      primary: closed
        ? undefined
        : next
          ? { label: `Mark ${deliveryStatusLabel(next).toLowerCase()}`, onClick: () => openStatusUpdate(delivery, next) }
          : { label: 'Update milestone', onClick: () => openStatusUpdate(delivery) },
      quick,
      details: rowDetails(delivery),
    };
  };

  const byStatus = metrics?.byStatus ?? {};
  const statusCount = (key: string) => key.split(',').reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  const counts = {
    all: metrics?.total ?? 0,
    scheduled: statusCount('scheduled'),
    in_transit: statusCount(IN_TRANSIT_FILTER),
    closed: statusCount('delivered,installed,handover_completed'),
  };
  const hasActiveFilters = activeTab !== 'all' || Boolean(searchQuery);

  // Deep link from notifications / dashboards: /deliveries?open=<id> opens that consignment's details.
  useOpenParam(async (id) => {
    try {
      const d = deliveries.find((x) => String(x.id) === id) ?? (await api.get(`/deliveries/${id}`));
      if (d) setInspected(toDeliveryRecord(d));
    } catch (err) {
      console.error('Failed to open delivery:', err);
    }
  }, !isLoading);

  const deliveryItems = deliveries.map(toDeliveryRecord);
  const deliveryList = deliveries.length ? (
    <RecordTable items={deliveryItems}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Delivery No.</TableHead>
            <TableHead>Customer & Site</TableHead>
            <TableHead>Equipment</TableHead>
            <TableHead>Order Ref</TableHead>
            <TableHead>Delivery Date</TableHead>
            <TableHead>In-charge</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((delivery, i) => {
            const item = deliveryItems[i];
            const daysLeft = item.due && !item.due.done ? daysFromToday(delivery.delivery_date) : null;
            const equipmentMeta = [delivery.model, delivery.equipment_serial].filter(Boolean).join(' · ');
            return (
              <TableRow key={item.key}>
                <TableCell className="font-bold whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{delivery.delivery_no || '-'}</span>
                </TableCell>
                <TableCell className="font-bold text-[#14213D]">
                  {delivery.organisation_name || 'Defence / Security Buyer'}
                  {delivery.delivery_location && (
                    <div className="text-[10px] text-[#4A5568] font-normal max-w-[240px] truncate" title={delivery.delivery_location}>
                      {delivery.delivery_location}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-[#14213D]">
                  {delivery.product_name || 'Security Scanning Equipment'}
                  {equipmentMeta && <div className="text-[10px] text-[#4A5568] font-normal">{equipmentMeta}</div>}
                </TableCell>
                <TableCell className="font-bold whitespace-nowrap">
                  {delivery.order_reference ? (
                    <span className="font-mono text-[#0F5E63]">{delivery.order_reference}</span>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                  {delivery.tender_id && (
                    <div className="text-[10px] text-[#4A5568] font-normal">
                      Tender{' '}
                      {canOpen(user?.role, '/tenders') ? (
                        <Link href={`/tenders?highlight=${delivery.tender_id}`} className="font-mono text-[#0F5E63] hover:underline">
                          {delivery.tender_no || 'Linked'}
                        </Link>
                      ) : (
                        <span className="font-mono">{delivery.tender_no || 'Linked'}</span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(delivery.delivery_date)}
                  {daysLeft !== null && daysLeft <= 7 && (
                    <div className="text-[10px] font-bold text-[#881337]">
                      {daysLeft < 0
                        ? `${-daysLeft} ${daysLeft === -1 ? 'DAY' : 'DAYS'} OVERDUE`
                        : daysLeft === 0
                          ? 'DUE TODAY'
                          : `${daysLeft} ${daysLeft === 1 ? 'DAY' : 'DAYS'} LEFT`}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-[#4A5568] whitespace-nowrap">{delivery.assignee_name || '-'}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={deliveryBadge(delivery.status)} size="sm" className="uppercase font-bold">
                    {deliveryStatusLabel(delivery.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {item.primary && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={item.primary.disabled}
                        onClick={item.primary.onClick}
                        className="text-xs text-[#0F5E63] hover:bg-[#E3EFEE]"
                      >
                        {item.primary.label}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setInspected(item)} className="shadow-xs text-xs">
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
      <PageHeader
        title="Equipment Logistics & Delivery Register"
        actions={
          <Button
            variant="primary"
            onClick={() => openCreate()}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            <span>Create Dispatch Order</span>
          </Button>
        }
      />

      {/* Key metrics — one row; Scheduled / In Transit filter the register (click again to clear). */}
      <StatGrid cols={4} className="gap-3">
        <StatCard
          title="Total Deliveries"
          value={counts.all}
          icon={<Truck size={16} />}
          variant="primary"
          className={activeTab === 'all' ? undefined : 'cursor-pointer'}
          onClick={() => setActiveTab('all')}
        />
        <StatCard
          title="Scheduled"
          value={counts.scheduled}
          icon={<Clock size={16} />}
          variant="amber"
          className={activeTab === 'scheduled' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => setActiveTab((cur) => (cur === 'scheduled' ? 'all' : 'scheduled'))}
        />
        <StatCard
          title="In Transit"
          subtext="Dispatched + in transit"
          value={counts.in_transit}
          icon={<Package size={16} />}
          variant="rose"
          className={activeTab === IN_TRANSIT_FILTER ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => setActiveTab((cur) => (cur === IN_TRANSIT_FILTER ? 'all' : IN_TRANSIT_FILTER))}
        />
        <StatCard title="Delivered / Closed" value={counts.closed} icon={<CheckCircle2 size={16} />} variant="emerald" />
      </StatGrid>

      {/* One filter row: search + status dropdown. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search deliveries"
              placeholder="Search delivery, client, serial…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Status"
              icon={<Layers />}
              options={[
                { key: 'all', label: 'All orders', count: counts.all },
                ...DELIVERY_STATUSES.map((s) => ({ ...s, count: statusCount(s.key) })),
              ].map((o) => ({
                ...o,
                // The In Transit card's filter (dispatched + in transit) shows as both of its milestones.
                active: o.key === activeTab || (o.key !== 'all' && activeTab.split(',').includes(o.key)),
                onSelect: () => setActiveTab(o.key),
              }))}
            />
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setActiveTab('all');
                  setSearchQuery('');
                }}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Delivery Cards List */}
      {isLoading ? (
        <PageLoader label="Loading delivery register" />
      ) : deliveries.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No Delivery Consignments Found"
          description="There are currently no delivery consignments matching your criteria. Create a dispatch order to track shipments."
          action={
            <Button variant="primary" onClick={() => openCreate()}>
              <Plus className="h-4 w-4 mr-1" />
              <span>Create Dispatch Order</span>
            </Button>
          }
        />
      ) : (
        (() => {
          const statusById = new Map(deliveries.map((d) => [String(d.id), d.status as string]));
          const extraLanes = Array.from(new Set(deliveries.map((d) => d.status as string)))
            .filter((s) => s && !DELIVERY_STATUSES.some((l) => l.key === s))
            .map((s) => ({ key: s, label: deliveryStatusLabel(s) }));
          return (
            <RecordViews
              storageKey="deliveries"
              defaultView="list"
              list={deliveryList}
              items={deliveryItems}
              lanes={[...DELIVERY_STATUSES, ...extraLanes].map((l) => ({ ...l, tone: toneFor(l.label) }))}
              laneOf={(i) => statusById.get(i.key) || ''}
              summary={
                <>
                  <span className="font-mono font-semibold text-[#14213D]">
                    {deliveries.length === total ? total : `${deliveries.length} of ${total}`}
                  </span>{' '}
                  {total === 1 ? 'consignment' : 'consignments'}
                </>
              }
              empty="No delivery consignments match your criteria."
              onLoadMore={deliveriesList.loadMore}
              hasMore={deliveriesList.hasMore}
              loadingMore={deliveriesList.loadingMore}
            />
          );
        })()
      )}
      <RecordDetails item={inspected} onClose={() => setInspected(null)} />

      {/* Modal: Create Dispatch Order */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Schedule Dispatch / Delivery Order"
        description="Initiate a new equipment delivery consignment against an order or tender contract."
      >
        <form onSubmit={handleCreate}>
          <FormSteps
            onCancel={() => setIsCreateOpen(false)}
            banner={
              actionError && (
                <div className="p-3 bg-[#FCE8EC] border border-[#F3C7CF] rounded-lg text-xs text-[#700F2D]">
                  {actionError}
                </div>
              )
            }
            submit={
              <Button variant="primary" type="submit" isLoading={isSubmitting}>
                Schedule Dispatch
              </Button>
            }
            steps={[
              {
                title: 'Customer',
                icon: <Building />,
                description: 'Who is receiving this consignment, and is it against a won tender?',
                content: (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Client / Organization *
                      </label>
                      <select
                        value={newDelivery.organisation_id}
                        onChange={(e) => setNewDelivery({ ...newDelivery, organisation_id: e.target.value, tender_id: '' })}
                        className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white focus:outline-none focus:border-[#0F5E63]"
                        required
                      >
                        <option value="">Select Government Organization...</option>
                        {organisations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name} {org.city ? `(${org.city})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {canRead(user?.role, 'tenders') && newDelivery.organisation_id && (
                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">Against won tender (optional)</label>
                        <select
                          value={newDelivery.tender_id}
                          onChange={(e) => setNewDelivery({ ...newDelivery, tender_id: e.target.value })}
                          className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white focus:outline-none focus:border-[#0F5E63]"
                          disabled={!orgTenders.length}
                        >
                          <option value="">{orgTenders.length ? 'Not linked to a tender' : 'No won tenders for this customer'}</option>
                          {orgTenders.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.tender_number || t.tender_no}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {canRead(user?.role, 'proposals') && newDelivery.organisation_id && (
                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">Against converted proposal / PO (optional)</label>
                        <select
                          value={newDelivery.proposal_id}
                          onChange={(e) => selectProposal(e.target.value)}
                          className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white focus:outline-none focus:border-[#0F5E63]"
                          disabled={!orgProposals.length && !newDelivery.proposal_id}
                        >
                          <option value="">{orgProposals.length ? 'Not linked to a proposal' : 'No converted proposals for this customer'}</option>
                          {newDelivery.proposal_id && !orgProposals.some((p) => p.id === newDelivery.proposal_id) && (
                            <option value={newDelivery.proposal_id}>Linked proposal</option>
                          )}
                          {orgProposals.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.proposal_number || p.proposal_no}
                              {proposalPo(p) ? ` · PO ${proposalPo(p)}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Tender / Order (PO) Reference
                      </label>
                      <Input
                        placeholder="e.g. GeM-GEM/2026/B/8821"
                        value={newDelivery.order_reference}
                        onChange={(e) => setNewDelivery({ ...newDelivery, order_reference: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Equipment',
                icon: <Package />,
                description: 'What is being shipped, and which units by serial number.',
                content: (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">
                          Equipment Product
                        </label>
                        <select
                          value={newDelivery.product_id}
                          onChange={(e) => setNewDelivery({ ...newDelivery, product_id: e.target.value })}
                          className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white focus:outline-none focus:border-[#0F5E63]"
                        >
                          <option value="">Select Equipment...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">
                          Model / Variant
                        </label>
                        <Input
                          placeholder="e.g. Dual-View 6040 HD"
                          value={newDelivery.product_model}
                          onChange={(e) => setNewDelivery({ ...newDelivery, product_model: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Serial Numbers (comma separated)
                      </label>
                      <Input
                        placeholder="e.g. SN-2026-X10, SN-2026-X11"
                        value={newDelivery.serial_numbers}
                        onChange={(e) => setNewDelivery({ ...newDelivery, serial_numbers: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Schedule',
                icon: <Calendar />,
                description: 'When and where it should arrive, and who on our side owns it.',
                content: (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">
                          Target Delivery Date *
                        </label>
                        <Input
                          type="date"
                          min={istToday()}
                          value={newDelivery.delivery_date}
                          onChange={(e) => setNewDelivery({ ...newDelivery, delivery_date: e.target.value })}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">
                          Responsible Employee
                        </label>
                        <select
                          value={newDelivery.assigned_to}
                          onChange={(e) => setNewDelivery({ ...newDelivery, assigned_to: e.target.value })}
                          className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white focus:outline-none focus:border-[#0F5E63]"
                        >
                          <option value="">Select Staff...</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {userWithRole(u)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Delivery Location / Site Address *
                      </label>
                      <Input
                        required
                        placeholder="e.g. Terminal 3 Gate 4, IGI Airport, New Delhi"
                        value={newDelivery.delivery_location}
                        onChange={(e) => setNewDelivery({ ...newDelivery, delivery_location: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Shipping',
                icon: <Truck />,
                description: 'Transporter details and any handling instructions for the dispatch team.',
                content: (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">
                          Carrier / Transporter
                        </label>
                        <Input
                          placeholder="e.g. BlueDart Express"
                          value={newDelivery.carrier_name}
                          onChange={(e) => setNewDelivery({ ...newDelivery, carrier_name: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#14213D] mb-1">
                          LR / Tracking Number
                        </label>
                        <Input
                          placeholder="e.g. TRK-882319"
                          value={newDelivery.tracking_number}
                          onChange={(e) => setNewDelivery({ ...newDelivery, tracking_number: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Dispatch Instructions / Remarks
                      </label>
                      <Input
                        placeholder="e.g. Handle with care, fragile optical detectors inside."
                        value={newDelivery.remarks}
                        onChange={(e) => setNewDelivery({ ...newDelivery, remarks: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* Modal: Update Delivery Milestone */}
      <Modal
        isOpen={isUpdateStatusOpen}
        onClose={() => setIsUpdateStatusOpen(false)}
        title={`Update Status: ${selectedDelivery?.delivery_no || ''}`}
        description="Record transit milestones, on-site arrival, technician installation, and final handover."
      >
        <form onSubmit={handleUpdateStatus} className="space-y-5">
          {actionError && (
            <div className="p-3 bg-[#FCE8EC] border border-[#F3C7CF] rounded-lg text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          <FormSection title="Milestone" icon={<Truck />} description="Where the consignment stands now.">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  Consignment Status *
                </label>
                <select
                  value={updateForm.status}
                  onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                  className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white focus:outline-none focus:border-[#0F5E63]"
                  required
                >
                  {allowedDeliveryStatuses(selectedDelivery?.status).map((s) => (
                    <option key={s} value={s}>
                      {MILESTONE_OPTION_LABEL[s] || deliveryStatusLabel(s)}
                      {s === selectedDelivery?.status ? ' — current (update details)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[#4A5568]">Milestones are recorded in order: Scheduled → Dispatched → In Transit → Delivered → Installed → Handover.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  Transition Remarks
                </label>
                <Input
                  placeholder="e.g. Reached regional cargo hub on schedule."
                  value={updateForm.remarks}
                  onChange={(e) => setUpdateForm({ ...updateForm, remarks: e.target.value })}
                />
              </div>
            </div>
          </FormSection>

          {['delivered', 'installed', 'handover_completed'].includes(updateForm.status) && (
            <FormSection title="Site Handover" icon={<CheckSquare />} description="Who accepted it at site and, once installed, the commissioning details.">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#14213D] mb-1">
                    Received / Accepted By (Client Officer)
                  </label>
                  <Input
                    placeholder="e.g. Major R. K. Sharma (Store Officer)"
                    value={updateForm.received_by}
                    required={updateForm.status === 'handover_completed'}
                    onChange={(e) => setUpdateForm({ ...updateForm, received_by: e.target.value })}
                  />
                </div>

                {updateForm.status === 'handover_completed' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#14213D] mb-1">
                      Signed Handover Certificate (link or reference no.) *
                    </label>
                    <Input
                      placeholder="e.g. HOC/2026/114 or a document link"
                      value={updateForm.document_url}
                      required
                      onChange={(e) => setUpdateForm({ ...updateForm, document_url: e.target.value })}
                    />
                  </div>
                )}

                {['installed', 'handover_completed'].includes(updateForm.status) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Commissioning Date
                      </label>
                      <Input
                        type="date"
                        max={istToday()}
                        value={updateForm.installation_date}
                        onChange={(e) => setUpdateForm({ ...updateForm, installation_date: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#14213D] mb-1">
                        Installation / Commissioning Notes
                      </label>
                      <Input
                        placeholder="e.g. Calibration passed, operators trained on console."
                        value={updateForm.installation_notes}
                        onChange={(e) => setUpdateForm({ ...updateForm, installation_notes: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {/* Phones: a sticky footer docked to the sheet's bottom edge, the two buttons sharing its width
              (same as the Create dialog's FormSteps footer). From sm up: the plain right-aligned row.
              `!-mb-4`: the form's space-y-5 would otherwise reset the bottom margin that cancels the body padding. */}
          <div className="sticky -bottom-4 z-10 -mx-4 !-mb-4 flex gap-2 border-t border-[#ECE9E2] bg-white px-4 py-3 [&>*]:min-w-0 [&>*]:flex-1 sm:static sm:mx-0 sm:!mb-0 sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-3 sm:[&>*]:flex-none">
            <Button variant="outline" type="button" onClick={() => setIsUpdateStatusOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Record Milestone
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
