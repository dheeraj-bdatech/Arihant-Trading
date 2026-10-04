'use client';

import React, { useState, useEffect } from 'react';
import {
  Truck,
  Plus,
  CheckCircle2,
  Clock,
  Building,
  User,
  Calendar,
  Package,
  Wrench,
  Search,
  CheckSquare,
  FileCheck,
  ChevronRight,
  Shield,
  MapPin,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  Tabs,
  PageContainer,
  PageHeader,
  EmptyState,
} from '@/components/ui';

export default function DeliveriesPage() {
  const { user } = useAuth();
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isUpdateStatusOpen, setIsUpdateStatusOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<any | null>(null);

  // New delivery form
  const [newDelivery, setNewDelivery] = useState({
    organisation_id: '',
    product_id: '',
    assigned_to: '',
    delivery_date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    delivery_location: '',
    product_model: '',
    serial_numbers: '',
    carrier_name: 'BlueDart Express Logistics',
    tracking_number: `TRK-${Math.floor(100000 + Math.random() * 900000)}`,
    order_reference: `PO/2026/${Math.floor(1000 + Math.random() * 9000)}`,
    remarks: '',
  });

  // Status update form
  const [updateForm, setUpdateForm] = useState({
    status: 'dispatched',
    received_by: '',
    installation_date: '',
    installation_notes: '',
    remarks: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchDeliveries = async () => {
    try {
      setIsLoading(true);
      const params: any = { limit: 100 };
      if (activeTab !== 'all') {
        params.status = activeTab;
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      const res = await api.get('/deliveries', params);
      setDeliveries(res.data || []);
    } catch (err) {
      console.error('Failed to load deliveries:', err);
    } finally {
      setIsLoading(false);
    }
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

  useEffect(() => {
    fetchDeliveries();
  }, [activeTab, searchQuery]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (!newDelivery.organisation_id) {
        throw new Error('Please select an organization / client customer.');
      }

      await api.post('/deliveries', {
        organisation_id: newDelivery.organisation_id,
        product_id: newDelivery.product_id || undefined,
        assigned_to: newDelivery.assigned_to || user?.id,
        delivery_date: newDelivery.delivery_date,
        delivery_location: newDelivery.delivery_location || undefined,
        product_model: newDelivery.product_model || undefined,
        serial_numbers: newDelivery.serial_numbers || undefined,
        carrier_name: newDelivery.carrier_name || undefined,
        tracking_number: newDelivery.tracking_number || undefined,
        order_reference: newDelivery.order_reference || undefined,
        remarks: newDelivery.remarks || undefined,
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
      await api.patch(`/deliveries/${selectedDelivery.id}/status`, {
        status: updateForm.status,
        received_by: updateForm.received_by || undefined,
        installation_date: updateForm.installation_date || undefined,
        installation_notes: updateForm.installation_notes || undefined,
        remarks: updateForm.remarks || undefined,
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'scheduled':
        return <Badge variant="warning">Scheduled</Badge>;
      case 'dispatched':
        return <Badge variant="info">Dispatched</Badge>;
      case 'in_transit':
        return <Badge variant="cyber">In Transit</Badge>;
      case 'delivered':
        return <Badge variant="success">Delivered</Badge>;
      case 'installed':
        return <Badge variant="success">Installed</Badge>;
      case 'handover_completed':
        return <Badge variant="default">Handover Complete</Badge>;
      case 'cancelled':
        return <Badge variant="danger">Cancelled</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  const counts = {
    all: deliveries.length,
    scheduled: deliveries.filter((d) => d.status === 'scheduled').length,
    in_transit: deliveries.filter((d) => ['dispatched', 'in_transit'].includes(d.status)).length,
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
    installed: deliveries.filter((d) => d.status === 'installed').length,
    handover_completed: deliveries.filter((d) => d.status === 'handover_completed').length,
  };

  return (
    <PageContainer>
      <PageHeader
        title="Equipment Logistics & Delivery Register"
        description="Comprehensive dispatch tracking, transit milestones, on-site installation sign-offs, and final client handover."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setActionError(null);
              setIsCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            <span>Create Dispatch Order</span>
          </Button>
        }
      />

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white border border-[#DCD8CE] rounded-[14px] p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5568]">Total Deliveries</div>
          <div className="text-2xl font-serif font-bold text-[#14213D] mt-1">{counts.all}</div>
        </div>
        <div className="bg-white border border-[#DCD8CE] rounded-[14px] p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9A3412]">Scheduled</div>
          <div className="text-2xl font-serif font-bold text-[#9A3412] mt-1">{counts.scheduled}</div>
        </div>
        <div className="bg-white border border-[#DCD8CE] rounded-[14px] p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0F5E63]">In Transit</div>
          <div className="text-2xl font-serif font-bold text-[#0F5E63] mt-1">{counts.in_transit}</div>
        </div>
        <div className="bg-white border border-[#DCD8CE] rounded-[14px] p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Delivered</div>
          <div className="text-2xl font-serif font-bold text-emerald-800 mt-1">{counts.delivered}</div>
        </div>
        <div className="bg-white border border-[#DCD8CE] rounded-[14px] p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Installed / Closed</div>
          <div className="text-2xl font-serif font-bold text-indigo-900 mt-1">{counts.installed + counts.handover_completed}</div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <Tabs
          tabs={[
            { id: 'all', label: 'All Orders', count: counts.all },
            { id: 'scheduled', label: 'Scheduled', count: counts.scheduled },
            { id: 'in_transit', label: 'In Transit', count: counts.in_transit },
            { id: 'delivered', label: 'Delivered', count: counts.delivered },
            { id: 'installed', label: 'Installed', count: counts.installed },
            { id: 'handover_completed', label: 'Completed', count: counts.handover_completed },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#4A5568]" />
          <input
            type="text"
            placeholder="Search delivery, client, serial..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[#C9C4B8] bg-white focus:outline-none focus:border-[#0F5E63] focus:ring-1 focus:ring-[#0F5E63]"
          />
        </div>
      </div>

      {/* Delivery Cards List */}
      {isLoading ? (
        <div className="p-12 text-center text-xs font-semibold text-[#4A5568] uppercase tracking-wider">
          Loading Delivery Register...
        </div>
      ) : deliveries.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No Delivery Consignments Found"
          description="There are currently no delivery consignments matching your criteria. Create a dispatch order to track shipments."
          action={
            <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              <span>Create Dispatch Order</span>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {deliveries.map((delivery) => (
            <Card key={delivery.id} className="p-5 flex flex-col justify-between hover:shadow-md transition-all">
              <div className="space-y-4">
                {/* Header: Delivery No & Status */}
                <div className="flex items-start justify-between gap-2 border-b border-[#ECE9E2] pb-3">
                  <div>
                    <span className="font-mono text-xs font-bold text-[#0F5E63]">
                      {delivery.delivery_no}
                    </span>
                    <h3 className="font-serif text-base font-bold text-[#14213D] line-clamp-1 mt-0.5">
                      {delivery.organisation_name || 'Defence / Security Buyer'}
                    </h3>
                  </div>
                  <div>{getStatusBadge(delivery.status)}</div>
                </div>

                {/* Details List */}
                <div className="space-y-2 text-xs text-[#4A5568]">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-[#0F5E63] shrink-0" />
                    <span className="font-semibold text-[#14213D]">Product:</span>
                    <span className="truncate">{delivery.product_name || 'Security Scanning Equipment'}</span>
                  </div>

                  {delivery.product_model && (
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-[#4A5568] shrink-0" />
                      <span>Model:</span>
                      <span className="font-mono text-[#14213D]">{delivery.product_model}</span>
                    </div>
                  )}

                  {delivery.delivery_location && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[#9A3412] shrink-0" />
                      <span className="truncate">{delivery.delivery_location}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#4A5568] shrink-0" />
                    <span>Target Date:</span>
                    <span className="font-mono text-[#14213D]">
                      {delivery.delivery_date ? new Date(delivery.delivery_date).toLocaleDateString('en-IN') : 'TBD'}
                    </span>
                  </div>

                  {delivery.tracking_number && (
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-[#4A5568] shrink-0" />
                      <span className="font-mono bg-[#FBFAF7] px-1.5 py-0.5 rounded border border-[#DCD8CE]">
                        {delivery.carrier_name || 'Carrier'}: {delivery.tracking_number}
                      </span>
                    </div>
                  )}

                  {delivery.assigned_name && (
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-[#4A5568] shrink-0" />
                      <span>In-charge:</span>
                      <span className="font-medium text-[#14213D]">{delivery.assigned_name}</span>
                    </div>
                  )}
                </div>

                {/* Remarks / Notes */}
                {delivery.remarks && (
                  <div className="p-2.5 rounded-[8px] bg-[#FBFAF7] border border-[#ECE9E2] text-[11px] text-[#4A5568]">
                    {delivery.remarks}
                  </div>
                )}
              </div>

              {/* Action Footer */}
              <div className="pt-4 border-t border-[#ECE9E2] mt-4 flex items-center justify-between">
                <span className="text-[10px] text-[#4A5568] font-mono">
                  {delivery.order_reference || 'Consignment'}
                </span>

                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setSelectedDelivery(delivery);
                    setUpdateForm({
                      status: delivery.status,
                      received_by: delivery.received_by || '',
                      installation_date: delivery.installation_date ? new Date(delivery.installation_date).toISOString().split('T')[0] : '',
                      installation_notes: delivery.installation_notes || '',
                      remarks: delivery.remarks || '',
                    });
                    setActionError(null);
                    setIsUpdateStatusOpen(true);
                  }}
                >
                  <span>Update Milestone</span>
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal: Create Dispatch Order */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Schedule Dispatch / Delivery Order"
        description="Initiate a new equipment delivery consignment against an order or tender contract."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {actionError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#14213D] mb-1">
              Client / Organization *
            </label>
            <select
              value={newDelivery.organisation_id}
              onChange={(e) => setNewDelivery({ ...newDelivery, organisation_id: e.target.value })}
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

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1">
                Target Delivery Date *
              </label>
              <Input
                type="date"
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
                    {u.full_name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#14213D] mb-1">
              Delivery Location / Site Address
            </label>
            <Input
              placeholder="e.g. Terminal 3 Gate 4, IGI Airport, New Delhi"
              value={newDelivery.delivery_location}
              onChange={(e) => setNewDelivery({ ...newDelivery, delivery_location: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1">
                Tender / Order Reference
              </label>
              <Input
                placeholder="e.g. GeM-GEM/2026/B/8821"
                value={newDelivery.order_reference}
                onChange={(e) => setNewDelivery({ ...newDelivery, order_reference: e.target.value })}
              />
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

          <div className="flex justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
            <Button variant="outline" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting}>
              Schedule Dispatch
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Update Delivery Milestone */}
      <Modal
        isOpen={isUpdateStatusOpen}
        onClose={() => setIsUpdateStatusOpen(false)}
        title={`Update Status: ${selectedDelivery?.delivery_no || ''}`}
        description="Record transit milestones, on-site arrival, technician installation, and final handover."
      >
        <form onSubmit={handleUpdateStatus} className="space-y-4">
          {actionError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {actionError}
            </div>
          )}

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
              <option value="scheduled">Scheduled (In Depot)</option>
              <option value="dispatched">Dispatched (Left Facility)</option>
              <option value="in_transit">In Transit (With Transporter)</option>
              <option value="delivered">Delivered (Received at Site)</option>
              <option value="installed">Installed & Commissioned</option>
              <option value="handover_completed">Handover Completed (Client Signoff)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {['delivered', 'installed', 'handover_completed'].includes(updateForm.status) && (
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1">
                Received / Accepted By (Client Officer)
              </label>
              <Input
                placeholder="e.g. Major R. K. Sharma (Store Officer)"
                value={updateForm.received_by}
                onChange={(e) => setUpdateForm({ ...updateForm, received_by: e.target.value })}
              />
            </div>
          )}

          {['installed', 'handover_completed'].includes(updateForm.status) && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  Commissioning Date
                </label>
                <Input
                  type="date"
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

          <div className="flex justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
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
