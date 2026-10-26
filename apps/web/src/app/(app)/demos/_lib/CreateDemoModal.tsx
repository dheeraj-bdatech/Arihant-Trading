'use client';

/**
 * "Create New Demo Trial Request" as a reusable popup: the demos page uses it, and so can any other module
 * (e.g. a Demo-related task) that needs to raise a demo. It loads its own masters, shows live fleet and demo-team
 * availability, and submits through POST /demos — which notifies the demo team, coordinators and (when an escort
 * is requested) the service team, exactly as a request raised from the demos page.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { availableFirst, fleetHint, kitForProduct, kitValue, unitHint } from './fleet';
import type { SelectOption } from '@/components/ui';
import { AlertCircle, AlertTriangle, Building, CalendarDays, FileText, Package, Plane } from 'lucide-react';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { canRead } from '@/lib/module-access';
import { formatINR } from '@arihant/shared';
import { Badge, Button, Checkbox, FormSteps, Input, Modal, Select, formatDateIN } from '@/components/ui';

export interface CreateDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-select the customer (and optionally tender / purpose) when opened from another module. */
  prefill?: { organisation_id?: string | null; tender_id?: string | null; purpose?: string | null };
  /** Called with the API response of POST /demos after a successful create (has id, demo_no, organisation_id). */
  onCreated?: (demo: { id: string; demo_no: string; organisation_id?: string | null } & Record<string, unknown>) => void;
}

// Create Demo Request Form (9 specifications)
const emptyDemo = () => ({
  organisation_id: '',
  product_id: '',
  location: '',
  requested_date: addIsoDays(istToday(), 5),
  assigned_to: '', // Salesperson
  purpose: '',
  expected_audience: '',
  equipment_required: '',
  special_requirements: '',
  remarks: '',
  visit_id: '',
  travel_required: false,
  travel_from: 'Delhi Depot',
  travel_to: '',
  travel_date: '',
  travel_remarks: '',
  service_escort_required: false,
  service_engineer_id: '',
  tender_id: '',
  deal_value: '',
});

export const CreateDemoModal: React.FC<CreateDemoModalProps> = ({ isOpen, onClose, prefill, onCreated }) => {
  const { user } = useAuth();
  const [newDemo, setNewDemo] = useState(emptyDemo);
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [serviceEngineers, setServiceEngineers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form + masters every time the popup opens, with the caller's prefill applied.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setError(null);
    setNewDemo({
      ...emptyDemo(),
      organisation_id: prefill?.organisation_id || '',
      tender_id: prefill?.tender_id || '',
      purpose: prefill?.purpose || '',
    });
    Promise.all([
      api.get('/organisations', { limit: 100 }).catch(() => ({ data: [] })),
      api.get('/masters/products').catch(() => []),
      api.get('/demos/equipment').catch(() => []),
      api.get('/users', { role: 'service_team' }).catch(() => ({ data: [] })),
      // A prefilled customer may be outside the first page of organisations — fetch it so the picker can show it.
      prefill?.organisation_id ? api.get(`/organisations/${prefill.organisation_id}`).catch(() => null) : Promise.resolve(null),
    ]).then(([orgsRes, productsRes, equipRes, serviceRes, prefOrg]: any[]) => {
      if (!alive) return;
      const orgs: any[] = orgsRes?.data || orgsRes || [];
      const extra = prefOrg?.id && !orgs.some((o) => o.id === prefOrg.id) ? [prefOrg] : [];
      const allOrgs = [...extra, ...orgs];
      setOrganisations(allOrgs);
      setProducts(productsRes || []);
      setEquipmentList(equipRes || []);
      setServiceEngineers(serviceRes?.data || serviceRes || []);
      const org = prefill?.organisation_id ? allOrgs.find((o) => o.id === prefill.organisation_id) : null;
      if (org) setNewDemo((d) => (d.location ? d : { ...d, location: `${org.city || 'Depot Site'}` }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Demo team with free / busy for the requested date.
  useEffect(() => {
    if (!isOpen || !newDemo.requested_date) return;
    let alive = true;
    api
      .get('/demos/team/availability', { date: newDemo.requested_date })
      .then((res: any) => alive && setTeamMembers(Array.isArray(res) ? res : []))
      .catch(() => alive && setTeamMembers([]));
    return () => {
      alive = false;
    };
  }, [isOpen, newDemo.requested_date]);

  // Open tenders of the selected customer, for linking a demo to the bid it supports (drives equipment priority).
  const [orgTenders, setOrgTenders] = useState<any[]>([]);
  useEffect(() => {
    setOrgTenders([]);
    if (!newDemo.organisation_id || !canRead(user?.role, 'tenders')) return;
    api
      .get('/tenders', { organisation_id: newDemo.organisation_id, limit: 50 })
      .then((res: any) => setOrgTenders((res?.data || []).filter((t: any) => !['lost', 'cancelled', 'not_participating', 'LOST', 'CANCELLED'].includes(t.status))))
      .catch(() => setOrgTenders([]));
  }, [newDemo.organisation_id, user?.role]);


  // Selected demo equipment unit for Create New Demo Modal
  const selectedNewDemoEquipUnit = useMemo(() => {
    if (!newDemo.equipment_required || newDemo.equipment_required === 'custom') return null;
    return (equipmentList || []).find(
      (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === newDemo.equipment_required
        || item.serial_no === newDemo.equipment_required
        || item.id === newDemo.equipment_required
    ) || null;
  }, [equipmentList, newDemo.equipment_required]);

  // Active product fleet availability breakdown for Create New Demo Modal
  const activeNewDemoProductFleet = useMemo(() => {
    const pId = newDemo.product_id;
    if (!pId) return null;
    const productUnits = (equipmentList || []).filter((e) => e.product_id === pId);
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
  }, [equipmentList, newDemo.product_id]);

  // Options for registered demo equipment models from fleet matrix for Create New Demo Modal
  const newDemoEquipmentOptions = useMemo(() => {
    const list = equipmentList || [];
    const activeProductId = newDemo.product_id;

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
  }, [equipmentList, newDemo.product_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if ((calendarDay(newDemo.requested_date) || '') < istToday()) {
        throw new Error('The requested trial date is in the past. Choose today or a later date.');
      }
      const payload: any = {
        ...newDemo,
        product_id: newDemo.product_id || undefined,
        assigned_to: newDemo.assigned_to || undefined,
        visit_id: newDemo.visit_id || undefined,
        service_escort_required: newDemo.service_escort_required || false,
        service_engineer_id: newDemo.service_escort_required && newDemo.service_engineer_id ? newDemo.service_engineer_id : undefined,
        travel_from: newDemo.travel_required ? newDemo.travel_from : undefined,
        travel_to: newDemo.travel_required ? newDemo.travel_to : undefined,
        travel_date: newDemo.travel_required ? newDemo.travel_date : undefined,
        travel_remarks: newDemo.travel_required ? newDemo.travel_remarks : undefined,
        tender_id: newDemo.tender_id || undefined,
        deal_value: newDemo.deal_value ? Number(newDemo.deal_value) : undefined,
      };

      // Strip all empty string properties so class-validator doesn't attempt UUID regex on ""
      Object.keys(payload).forEach((key) => {
        if (payload[key] === '') {
          delete payload[key];
        }
      });

      const created = await api.post('/demos', payload);
      onCreated?.(created);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create demo request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Demo Trial Request">
    <form onSubmit={handleSubmit} className="text-sm">
      <FormSteps
        onCancel={onClose}
        busy={isSubmitting}
        banner={
          error && (
            <div className="flex items-start gap-2 rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] p-3 text-xs font-medium text-[#700F2D]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )
        }
        submit={
          <Button variant="primary" type="submit" isLoading={isSubmitting}>
            <span className="sm:hidden">Submit request</span>
            <span className="hidden sm:inline">Submit Demo Request</span>
          </Button>
        }
        steps={[
          {
            title: 'Customer',
            icon: <Building />,
            description: 'Who is the demo for? Link a tender or deal value so higher-value demos get priority on shared units.',
            content: (
      <div className="space-y-3">
      <Select
        label="Client Organisation *"
        value={newDemo.organisation_id}
        onChange={(e) => {
          const orgId = e.target.value;
          const org = organisations.find((o) => o.id === orgId);
          setNewDemo({
            ...newDemo,
            organisation_id: orgId,
            location: org ? `${org.city || 'Depot Site'}` : newDemo.location,
            tender_id: '',
          });
        }}
        options={[
          { label: '— Select Client Organisation —', value: '' },
          ...organisations.map((o) => ({ label: o.name, value: o.id })),
        ]}
        required
      />

      {/* Opportunity value: when two demos want the same unit, the higher-value one gets priority (§16) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {canRead(user?.role, 'tenders') && (
          <Select
            label="Linked tender (optional)"
            value={newDemo.tender_id}
            onChange={(e) => setNewDemo({ ...newDemo, tender_id: e.target.value })}
            options={[
              { label: newDemo.organisation_id ? (orgTenders.length ? '— Not for a specific tender —' : 'No open tenders for this customer') : 'Select the customer first', value: '' },
              ...orgTenders.map((t) => ({
                label: `${t.tender_number || t.tender_no}${t.estimated_value ? ` · ${formatINR(Number(t.estimated_value))}` : ''}`,
                value: t.id,
              })),
            ]}
            disabled={!orgTenders.length}
          />
        )}
        <Input
          label="Deal value (₹, optional)"
          type="number"
          min={0}
          step="1"
          placeholder={newDemo.tender_id ? 'Defaults to the tender value' : 'Expected order value'}
          value={newDemo.deal_value}
          onChange={(e) => setNewDemo({ ...newDemo, deal_value: e.target.value })}
        />
      </div>
      </div>
            ),
          },
          {
            title: 'Equipment',
            icon: <Package />,
            description: 'Which product should be demonstrated? Each product shows how many demo units are ready; pick a specific kit if needed.',
            content: (
        <div className="grid grid-cols-1 gap-4 items-start">
          <div className="space-y-2">
            <Select
              label="Equipment / Product Required for Demo *"
              value={newDemo.product_id}
              onChange={(e) => {
                const pId = e.target.value;
                setNewDemo({ ...newDemo, product_id: pId, equipment_required: kitForProduct(newDemo.equipment_required, pId, equipmentList || []) });
              }}
              options={[
                { label: '— Select Security Product / Equipment —', value: '' },
                ...availableFirst(products.map((p) => {
                  const pUnits = (equipmentList || []).filter((e) => e.product_id === p.id);
                  const ready = pUnits.filter((e) => e.availability_status === 'available').length;
                    return { value: p.id, label: `${p.name}`, ...fleetHint(ready, pUnits.length) };
                })),
              ]}
              required
            />

            {/* Live Product Fleet Availability & Status HUD */}
            {activeNewDemoProductFleet && (
              <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-1.5 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                    Live Product Fleet Availability:
                  </span>
                  {activeNewDemoProductFleet.availableCount > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E3EFEE] text-[#0B4A4E] border border-[#D0E5E3]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0F5E63] animate-pulse" />
                      AVAILABLE ({activeNewDemoProductFleet.availableCount} Ready)
                    </span>
                  ) : activeNewDemoProductFleet.total > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FBEBDD] text-[#7C2D12] border border-[#E9C9B4]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9A3412]" />
                      RESERVED ({activeNewDemoProductFleet.total} in Fleet)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#ECE9E2] text-[#14213D] border border-[#C9C4B8]">
                      No Fleet Unit
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-[#4A5568]">
                    {activeNewDemoProductFleet.availableCount > 0
                      ? `Stationed at: ${activeNewDemoProductFleet.locations.join(', ')} Depot`
                      : activeNewDemoProductFleet.total > 0
                      ? `All units currently deployed or reserved.`
                      : `Custom requisition required.`}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px]">
                    <span>Fleet: <b>{activeNewDemoProductFleet.total}</b></span>
                    <span className="text-[#0B4A4E]">Ready: <b>{activeNewDemoProductFleet.availableCount}</b></span>
                    <span className="text-[#7C2D12]">In-Trial: <b>{activeNewDemoProductFleet.reservedCount}</b></span>
                    {activeNewDemoProductFleet.maintenanceCount > 0 && (
                      <span className="text-[#700F2D]">Maint: <b>{activeNewDemoProductFleet.maintenanceCount}</b></span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Select
              label="Specific Demo Kit / Serial / Accessories Needed"
              value={
                newDemoEquipmentOptions.some((o) => o.value === newDemo.equipment_required)
                  ? newDemo.equipment_required
                  : newDemo.equipment_required
                  ? 'custom'
                  : ''
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  setNewDemo({ ...newDemo, equipment_required: 'custom' });
                } else {
                  const matchedEquip = (equipmentList || []).find(
                    (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === val
                      || item.serial_no === val
                      || item.id === val
                  );
                  setNewDemo((prev) => ({
                    ...prev,
                    equipment_required: val,
                    product_id: matchedEquip?.product_id || prev.product_id,
                  }));
                }
              }}
              options={newDemoEquipmentOptions}
            />

            {/* Specific Demo Kit / Serial / Accessories Detail Card */}
            {selectedNewDemoEquipUnit && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5 border-b border-[#ECE9E2]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-xs text-[#14213D]">{selectedNewDemoEquipUnit.model}</span>
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-[#DCD8CE] text-[#14213D] font-bold">
                      S/N: {selectedNewDemoEquipUnit.serial_no}
                    </span>
                    <span className="text-[10px] text-[#4A5568]">📍 {selectedNewDemoEquipUnit.current_location} Depot</span>
                  </div>
                  <div>
                    {selectedNewDemoEquipUnit.availability_status === 'available' ? (
                      <Badge variant="success">● READY & AVAILABLE</Badge>
                    ) : selectedNewDemoEquipUnit.availability_status === 'reserved' || selectedNewDemoEquipUnit.availability_status === 'in_use' ? (
                      <Badge variant="warning">
                        ○ RESERVED {selectedNewDemoEquipUnit.reserved_until ? `UNTIL ${formatDateIN(selectedNewDemoEquipUnit.reserved_until)}` : ''}
                      </Badge>
                    ) : (
                      <Badge variant="danger">▲ MAINTENANCE: {selectedNewDemoEquipUnit.condition || 'Service Needed'}</Badge>
                    )}
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-[#4A5568] block">Operational Condition:</span>
                    <span className="font-semibold text-[#14213D]">{selectedNewDemoEquipUnit.condition || 'Operational'}</span>
                  </div>
                  <div>
                    <span className="text-[#4A5568] block">Fleet Custodian:</span>
                    <span className="font-semibold text-[#14213D]">{selectedNewDemoEquipUnit.responsible_person_name || 'Demo Team Coordinator'}</span>
                  </div>
                </div>

                {/* Warn when the chosen unit is busy or under maintenance */}
                {selectedNewDemoEquipUnit.availability_status === 'available' ? null : selectedNewDemoEquipUnit.availability_status === 'reserved' || selectedNewDemoEquipUnit.availability_status === 'in_use' ? (
                  <div className="p-1.5 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] text-[10px] flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#7C2D12] shrink-0" />
                    <span>This serial is currently scheduled for another trial. Submitting will flag a scheduling overlap notice to the Demo Coordinator.</span>
                  </div>
                ) : (
                  <div className="p-1.5 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-[#700F2D] text-[10px] flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-[#700F2D] shrink-0" />
                    <span>Unit marked under maintenance ({selectedNewDemoEquipUnit.condition}). You may select another serial or custom kit.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
            ),
          },
          {
            title: 'Schedule',
            icon: <CalendarDays />,
            description: 'When and where should the demo happen, who will attend, and who is the account owner?',
            content: (
      <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Requested Trial Date *"
          type="date"
          min={istToday()}
          value={newDemo.requested_date}
          onChange={(e) => setNewDemo({ ...newDemo, requested_date: e.target.value })}
          required
        />

        <Input
          label="Demo Site Location *"
          placeholder="e.g. CRPF Group Centre, Delhi"
          value={newDemo.location}
          onChange={(e) => setNewDemo({ ...newDemo, location: e.target.value })}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Expected Audience / Board Members"
          placeholder="e.g. DIG Technical & Procurement Board"
          value={newDemo.expected_audience}
          onChange={(e) => setNewDemo({ ...newDemo, expected_audience: e.target.value })}
        />

        <Select
          label="Demo Team Member (optional)"
          value={newDemo.assigned_to}
          onChange={(e) => setNewDemo({ ...newDemo, assigned_to: e.target.value })}
          options={[
            { label: '— Assign later (coordinator) —', value: '' },
            // free on the requested date first; busy members show which demo they are on
            ...availableFirst(
              teamMembers.map((m): SelectOption => ({
                label: `${m.full_name} (${m.role.replace(/_/g, ' ')})`,
                value: m.id,
                hint: m.is_available ? 'Free' : `Busy${m.active_demo?.demo_no ? ` · ${m.active_demo.demo_no}` : ''}`,
                hintTone: m.is_available ? 'success' : 'danger',
              })),
            ),
          ]}
        />
      </div>

      </div>
            ),
          },
          {
            title: 'Purpose',
            icon: <FileText />,
            description: 'What should the demo prove, and what extra items or site arrangements are needed?',
            content: (
      <div className="space-y-3">
      <Input
        label="Purpose of Demonstration *"
        placeholder="e.g. Live detection rate verification for GeM tender bid"
        value={newDemo.purpose}
        onChange={(e) => setNewDemo({ ...newDemo, purpose: e.target.value })}
        required
      />

      <Input
        label="Additional Custom Accessories / Test Samples Needed (Optional)"
        placeholder="e.g. Test calibration pieces, knife sample, spare batteries, vehicle gate pass"
        value={newDemo.remarks}
        onChange={(e) => setNewDemo({ ...newDemo, remarks: e.target.value })}
      />

      <Input
        label="Special Requirements / Site Conditions"
        placeholder="e.g. Outdoor proving ground; generator power supply needed"
        value={newDemo.special_requirements}
        onChange={(e) => setNewDemo({ ...newDemo, special_requirements: e.target.value })}
      />
      </div>
            ),
          },
          {
            title: 'Logistics',
            icon: <Plane />,
            description: 'Does the demo team need to travel, or should a service engineer go along?',
            content: (
      <div className="space-y-4">
      {/* Travel Requirement Toggle (§12) */}
      <div className="space-y-3">
        <Checkbox
          checked={newDemo.travel_required}
          onChange={(e) => setNewDemo({ ...newDemo, travel_required: e.target.checked })}
          label="Travel Required for Demo Team"
        />

        {newDemo.travel_required && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="From Depot"
              value={newDemo.travel_from}
              onChange={(e) => setNewDemo({ ...newDemo, travel_from: e.target.value })}
            />
            <Input
              label="To Destination"
              value={newDemo.travel_to}
              onChange={(e) => setNewDemo({ ...newDemo, travel_to: e.target.value })}
              placeholder="e.g. Patna Proving Site"
            />
            <Input
              label="Travel Date"
              type="date"
              value={newDemo.travel_date}
              onChange={(e) => setNewDemo({ ...newDemo, travel_date: e.target.value })}
            />
          </div>
        )}
      </div>

      {/* Service Team Escort for Live Trial Support */}
      <div className="pt-4 border-t border-[#ECE9E2] space-y-3">
        <div>
            <Checkbox
              checked={newDemo.service_escort_required}
              onChange={(e) => {
                const checked = e.target.checked;
                setNewDemo({
                  ...newDemo,
                  service_escort_required: checked,
                  service_engineer_id: checked ? newDemo.service_engineer_id : '',
                });
              }}
              label="Request Service Team Escort for Live Demo"
            />
        </div>

        {newDemo.service_escort_required && (
          <div className="pt-2.5 border-t border-[#ECE9E2] space-y-2">
            <Select
              label="Select Available Service Engineer *"
              value={newDemo.service_engineer_id || ''}
              onChange={(e) => setNewDemo({ ...newDemo, service_engineer_id: e.target.value })}
              options={[
                { label: '— Select Service Engineer to Escort Tour —', value: '' },
                ...serviceEngineers.map((se) => ({
                  label: `🔧 ${se.full_name} (${se.email})`,
                  value: se.id,
                })),
              ]}
              required
            />
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
  );
};
