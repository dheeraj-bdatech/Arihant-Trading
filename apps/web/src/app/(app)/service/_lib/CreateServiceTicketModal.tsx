'use client';

/**
 * "Log Equipment Breakdown Incident" (§31) as a self-contained popup: the service desk opens it from its own
 * page, other modules (e.g. a service-related task) open it with a customer already picked. It loads its own
 * reference data when opened and creates the ticket through POST /service/tickets, which emits service.created
 * so the service team is notified.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Building, FileText, Flame, UserCheck, Wrench } from 'lucide-react';
import type { ComplaintSource, ServicePriority, WarrantyStatus } from '@arihant/shared';
import { istToday } from '@/lib/ist-date';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button, FormSteps, Input, Modal, Select, Textarea } from '@/components/ui';
import { errMsg } from '@/components/service/serviceHelpers';

export interface CreateServiceTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-select the customer (and optionally a short issue summary) when opened from another module. */
  prefill?: { organisation_id?: string | null; issue?: string | null };
  /** Called with the API response of the create call after success (has id, ticket_no, organisation_id). */
  onCreated?: (ticket: { id: string; ticket_no?: string; organisation_id?: string | null } & Record<string, unknown>) => void;
}

/** Roles that may dispatch an engineer while logging (GET /service/engineers decides whom). */
const DISPATCH_ROLES = ['management', 'regional_manager', 'service_team', 'admin'];

const emptyTicket = () => ({
  organisation_id: '',
  organisation_name: '',
  city: '',
  ticket_no: '',
  contact_id: '',
  product_id: '',
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

const listOf = (res: any): any[] => (Array.isArray(res) ? res : res?.data || []);

export const CreateServiceTicketModal: React.FC<CreateServiceTicketModalProps> = ({ isOpen, onClose, prefill, onCreated }) => {
  const { user } = useAuth();
  const role = user?.role || '';

  const [newTicket, setNewTicket] = useState(emptyTicket);
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [orgContacts, setOrgContacts] = useState<any[]>([]);
  const [serviceEngineers, setServiceEngineers] = useState<any[]>([]);
  const [workload, setWorkload] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fresh form and reference data each time it opens; the prefilled customer is resolved once the list arrives.
  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setActionError(null);
    setNewTicket({ ...emptyTicket(), organisation_id: prefill?.organisation_id || '', complaint: prefill?.issue || '' });

    api
      .get('/organisations', { limit: 100 })
      .then(async (res) => {
        let orgs = listOf(res);
        // A prefilled customer outside the first page of the master still has to show by name.
        const wanted = prefill?.organisation_id;
        if (wanted && !orgs.some((o) => o.id === wanted)) {
          const one = await api.get(`/organisations/${wanted}`).catch(() => null);
          if (one?.id) orgs = [one, ...orgs];
        }
        if (!live) return;
        setOrganisations(orgs);
        const match = wanted ? orgs.find((o) => o.id === wanted) : null;
        if (match) setNewTicket((t) => (t.organisation_id === match.id ? { ...t, organisation_name: match.name, city: match.city || t.city } : t));
      })
      .catch(() => {});
    api
      .get('/products')
      .then((res: any) => live && setProducts(listOf(res)))
      .catch(() => live && setProducts([]));

    if (DISPATCH_ROLES.includes(role)) {
      api
        .get('/service/engineers')
        .then((res: any) => live && setServiceEngineers(listOf(res)))
        .catch(() => live && setServiceEngineers([]));
      // Each engineer's current queue (same numbers as the desk's workload HUD), to pick someone free.
      api
        .get('/service/stats')
        .then((res: any) => live && setWorkload(res?.employeeWorkload || []))
        .catch(() => live && setWorkload([]));
    }
    return () => {
      live = false;
    };
    // Re-run per opening; the prefill is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, role]);

  // Contact persons of the selected customer (§31) — none for an unverified customer
  useEffect(() => {
    const orgId = newTicket.organisation_id;
    setOrgContacts([]);
    if (!orgId) return;
    let live = true;
    api
      .get('/contacts', { organisation_id: orgId })
      .then((res: any) => live && setOrgContacts(listOf(res)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [newTicket.organisation_id]);

  const loadOf = useMemo(() => new Map(workload.map((w: any) => [w.id, w])), [workload]);
  const engineers = useMemo(
    () =>
      serviceEngineers.map((u: any) => {
        const w = loadOf.get(u.id);
        const name = (u.full_name || u.email) as string;
        return { id: u.id as string, label: w ? `${name} · ${w.activeTickets} active${w.overdueTickets ? `, ${w.overdueTickets} overdue` : ''}` : name };
      }),
    [serviceEngineers, loadOf],
  );
  const freeEngineers = useMemo(
    () => serviceEngineers.filter((u: any) => loadOf.get(u.id)?.workloadStatus === 'AVAILABLE').map((u: any) => u.full_name || u.email),
    [serviceEngineers, loadOf],
  );

  // 1. Log New Incident (§31)
  const handleLogTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // opened from inside another form (e.g. a task) — never submit that one too
    setActionError(null);
    setIsSubmitting(true);

    try {
      if (newTicket.received_date && newTicket.received_date > istToday()) {
        throw new Error('Date received cannot be in the future.');
      }
      const typedName = newTicket.organisation_name.trim();
      let orgId = newTicket.organisation_id;
      let claimedName: string | undefined;
      if (!orgId) {
        if (!typedName) throw new Error('Please enter or select a customer organisation.');
        // Picked by name but not from the list: match it case-insensitively before treating it as new.
        const match = organisations.find((o) => String(o.name).trim().toLowerCase() === typedName.toLowerCase());
        if (match) orgId = match.id;
        // Not in the master: log it against the unverified-customer record (for every role, never a guessed
        // master entry); it is linked to the real organisation once that is added with its true state / city.
        else claimedName = typedName;
      }

      const created = await api.post('/service/tickets', {
        organisation_id: orgId || undefined,
        claimed_organisation_name: claimedName,
        ticket_no: newTicket.ticket_no.trim() || undefined,
        equipment_serial: newTicket.serial_no || undefined,
        location: newTicket.location || newTicket.city || undefined,
        contact_id: (orgId && newTicket.contact_id) || undefined,
        product_id: newTicket.product_id || undefined,
        complaint: newTicket.complaint,
        complaint_source: newTicket.complaint_source,
        received_date: newTicket.received_date || undefined,
        priority: newTicket.priority,
        warranty_status: newTicket.warranty_status,
        assigned_to: newTicket.assigned_to || undefined,
        planned_visit_date: newTicket.planned_visit_date || undefined,
      });

      setNewTicket(emptyTicket());
      onCreated?.(created);
      onClose();
    } catch (err) {
      setActionError(errMsg(err, 'Failed to register breakdown incident.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Log Equipment Breakdown Incident"
      description="Register a defense/PSU customer maintenance incident under warranty or AMC contract."
      maxWidth="lg"
    >
      <form onSubmit={handleLogTicket}>
        <FormSteps
          onCancel={onClose}
          banner={
            actionError && (
              <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
                {actionError}
              </div>
            )
          }
          submit={
            // phones: same 40px height as Back, and a label that fits half the footer
            <Button type="submit" size="sm" isLoading={isSubmitting} className="h-10 sm:h-8">
              <span className="sm:hidden">Register incident</span>
              <span className="hidden sm:inline">Register Incident & Dispatch</span>
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
                      helperText="Leave blank for the next TCK number, or enter the customer's own reference"
                      value={newTicket.ticket_no}
                      onChange={(e) => setNewTicket({ ...newTicket, ticket_no: e.target.value })}
                    />
                    <Input
                      label="Date Received"
                      type="date"
                      required
                      max={istToday()}
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
                    <div className="p-2.5 rounded-lg bg-[#EEF1F5] border border-[#DCD8CE] text-xs text-[#14213D] flex items-center gap-2">
                      <Flame className="h-4 w-4 shrink-0 text-[#1F2E52]" />
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
                      Client Agency / Organisation <span className="text-[#881337]">*</span>
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
                          contact_id: match && match.id === newTicket.organisation_id ? newTicket.contact_id : '',
                          city: match?.city || newTicket.city,
                        });
                      }}
                      placeholder="e.g. Delhi Police Traffic HQ / BSF Sector"
                      className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      required
                    />
                    {!newTicket.organisation_id && newTicket.organisation_name.trim().length > 2 &&
                      !organisations.some((o) => String(o.name).trim().toLowerCase() === newTicket.organisation_name.trim().toLowerCase()) && (
                        <p className="mt-1 text-[11px] text-[#9A3412]">
                          Not in the customer master — the ticket is logged as an unverified customer; link it to the right organisation once it is added.
                        </p>
                      )}
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
                  <div className="sm:col-span-2">
                    <Select
                      label="Contact Person"
                      value={newTicket.contact_id}
                      disabled={!newTicket.organisation_id}
                      onChange={(e) => setNewTicket({ ...newTicket, contact_id: e.target.value })}
                      options={[
                        {
                          value: '',
                          label: !newTicket.organisation_id
                            ? '-- Select a customer from the master first --'
                            : orgContacts.length
                            ? '-- Select contact person --'
                            : '-- No contacts on file for this customer --',
                        },
                        ...orgContacts.map((c: any) => ({
                          value: c.id,
                          label: [c.full_name, c.designation, c.mobile].filter(Boolean).join(' · '),
                        })),
                      ]}
                    />
                  </div>
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
                      label="Equipment / Product"
                      value={newTicket.product_id}
                      onChange={(e) => setNewTicket({ ...newTicket, product_id: e.target.value })}
                      options={[
                        { value: '', label: '-- Select product --' },
                        ...products.map((p: any) => ({
                          value: p.id,
                          label: [p.name, p.make, p.category].filter(Boolean).join(' · '),
                        })),
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
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select
                      label="Initial Field Engineer Dispatch (Optional)"
                      value={newTicket.assigned_to}
                      onChange={(e) => setNewTicket({ ...newTicket, assigned_to: e.target.value })}
                      options={[
                        { value: '', label: '-- Unassigned (Assign Later) --' },
                        ...engineers.map((eng) => ({ value: eng.id, label: eng.label })),
                      ]}
                    />
                    <Input
                      label="Planned Visit Date"
                      type="date"
                      value={newTicket.planned_visit_date}
                      onChange={(e) => setNewTicket({ ...newTicket, planned_visit_date: e.target.value })}
                    />
                  </div>
                  {workload.length > 0 && (
                    <p className="text-[11px] text-[#4A5568]">
                      {freeEngineers.length
                        ? <>Free now (no open tickets): <span className="font-semibold text-[#0F5E63]">{freeEngineers.join(', ')}</span></>
                        : 'Every engineer has open tickets — the list shows each one’s current queue.'}
                    </p>
                  )}
                </div>
              ),
            },
          ]}
        />
      </form>
    </Modal>
  );
};
