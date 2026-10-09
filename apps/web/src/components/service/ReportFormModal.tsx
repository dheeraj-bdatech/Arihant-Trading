'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, Button, Input, Select, Textarea, InfoCallout } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, isConflict, todayLocal } from './serviceHelpers';

const CONFIRMATION_TYPES = ['Signature', 'OTP', 'Email Confirmation', 'Photo of Signed Job Sheet'];

interface PartRow {
  name: string;
  qty: string;
}

const blank = (ticket: any) => ({
  problem: ticket?.complaint || '',
  rootCause: '',
  action: '',
  parts: [] as PartRow[],
  warranty: ticket?.warranty_status || 'in_warranty',
  obtained: true,
  confirmationType: 'Signature',
  officer: '',
  notObtainedReason: '',
  rating: '',
  customerRemarks: '',
  furtherWork: false,
  furtherDesc: '',
  nextVisit: '',
  reportUrl: '',
});

interface Props {
  ticket: any | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onStale: () => void | Promise<void>;
}

export const ReportFormModal: React.FC<Props> = ({ ticket, onClose, onDone, onStale }) => {
  const [f, setF] = useState(() => blank(ticket));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setF(blank(ticket));
    setErrors({});
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  if (!ticket) return null;
  const status = String(ticket.status);
  const wrongStatus = !['in_progress', 'resolved'].includes(status);
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (f.problem.trim().length < 5) e.problem = 'Describe the problem identified (at least 5 characters).';
    if (f.action.trim().length < 5) e.action = 'Describe the action taken (at least 5 characters).';
    f.parts.forEach((p, i) => {
      const hasName = p.name.trim().length > 0;
      const q = Number(p.qty);
      if (!hasName && p.qty) e[`part_${i}`] = 'Enter the part name.';
      else if (hasName && (!Number.isInteger(q) || q < 1)) e[`part_${i}`] = 'Quantity must be a whole number of 1 or more.';
    });
    if (f.obtained) {
      if (f.officer.trim().length < 2) e.officer = 'Customer officer name (and designation) is required when sign-off is obtained.';
    } else if (f.notObtainedReason.trim().length < 5) {
      e.notObtainedReason = 'Explain why customer confirmation could not be obtained (at least 5 characters).';
    }
    if (f.rating) {
      const r = Number(f.rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) e.rating = 'Rating must be a whole number from 1 to 5.';
    }
    if (f.furtherWork) {
      if (f.furtherDesc.trim().length < 5) e.furtherDesc = 'Describe the further work needed (at least 5 characters).';
      if (!f.nextVisit) e.nextVisit = 'Pick the next visit date.';
      else if (f.nextVisit < todayLocal()) e.nextVisit = 'The next visit date cannot be in the past.';
    }
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (wrongStatus) return setError('A report can only be filed while the ticket is in progress (or resolved). Start work first.');
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return setError('Please fix the highlighted fields.');
    setError(null);
    setBusy(true);
    const parts = f.parts
      .filter((p) => p.name.trim())
      .map((p) => ({ part_name: p.name.trim(), quantity: Number(p.qty) || 1 }));
    try {
      await api.post(`/service/tickets/${ticket.id}/report`, {
        problem_identified: f.problem.trim(),
        root_cause: f.rootCause.trim() || undefined,
        action_taken: f.action.trim(),
        parts_replaced: parts.length ? parts : undefined,
        warranty_status: f.warranty,
        customer_confirmation: f.obtained,
        customer_confirmation_type: f.obtained ? f.confirmationType : 'Not Obtained',
        customer_name_signed: f.obtained ? f.officer.trim() : undefined,
        confirmation_not_obtained_reason: f.obtained ? undefined : f.notObtainedReason.trim(),
        customer_feedback_rating: f.rating ? Number(f.rating) : undefined,
        customer_remarks: f.customerRemarks.trim() || undefined,
        further_work_required: f.furtherWork,
        further_work_description: f.furtherWork ? f.furtherDesc.trim() : undefined,
        next_visit_date: f.furtherWork ? f.nextVisit : undefined,
        report_url: f.reportUrl.trim() || undefined,
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
      if (isConflict(err)) await onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="File Service Report"
      description="Diagnostic findings, rectification, spares used and customer confirmation. Filing moves the ticket to Service Report Submitted."
      maxWidth="lg"
      zIndex={80}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {wrongStatus && (
          <InfoCallout variant="warning">
            This ticket is "{status.replace(/_/g, ' ')}". A report can be filed once work has started — check in on the visit or move the ticket to In Progress first.
          </InfoCallout>
        )}

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] p-3 text-xs">
          <div>
            <span className="text-[#4A5568]">Ticket:</span> <strong className="font-mono text-[#0F5E63]">{ticket.ticket_no}</strong>
          </div>
          <div>
            <span className="text-[#4A5568]">Customer:</span> <strong className="text-[#14213D]">{ticket.organisation_name}</strong>
          </div>
          {ticket.equipment_serial && (
            <div className="col-span-2">
              <span className="text-[#4A5568]">Machine S/N:</span> <strong className="font-mono text-[#14213D]">{ticket.equipment_serial}</strong>
            </div>
          )}
        </div>

        <Textarea label="Problem identified" required rows={2} value={f.problem} error={errors.problem} onChange={(e) => set({ problem: e.target.value })} placeholder="e.g. Diode array board shorted after a power surge." />
        <Input label="Root cause (optional)" value={f.rootCause} onChange={(e) => set({ rootCause: e.target.value })} />
        <Textarea label="Action taken / rectification steps" required rows={3} value={f.action} error={errors.action} onChange={(e) => set({ action: e.target.value })} placeholder="e.g. Replaced PCB #DA-200, cleaned collimator, recalibrated generator." />

        <div className="space-y-2 rounded-xl border border-[#DCD8CE] bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#14213D]">Spare parts replaced</span>
            <Button type="button" size="xs" variant="secondary" onClick={() => set({ parts: [...f.parts, { name: '', qty: '1' }] })}>
              <Plus className="mr-1 h-3 w-3" /> Add part
            </Button>
          </div>
          {f.parts.length === 0 && <p className="text-[11px] text-[#4A5568]">No parts replaced.</p>}
          {f.parts.map((p, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Input placeholder="Part name / number" aria-label={`Part ${i + 1} name`} value={p.name} onChange={(e) => set({ parts: f.parts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                </div>
                <div className="w-24">
                  <Input type="number" min={1} step={1} aria-label={`Part ${i + 1} quantity`} value={p.qty} onChange={(e) => set({ parts: f.parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
                </div>
                <Button type="button" size="sm" variant="ghost" aria-label="Remove part" onClick={() => set({ parts: f.parts.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-3.5 w-3.5 text-[#9A3412]" />
                </Button>
              </div>
              {errors[`part_${i}`] && <p className="text-xs font-medium text-[#881337]">{errors[`part_${i}`]}</p>}
            </div>
          ))}
        </div>

        <Select
          label="Warranty / billable status"
          value={f.warranty}
          onChange={(e) => set({ warranty: e.target.value })}
          options={[
            { value: 'in_warranty', label: 'Warranty covered (FOC spares)' },
            { value: 'amc', label: 'Covered under AMC' },
            { value: 'out_of_warranty', label: 'Out of warranty — billable' },
          ]}
        />

        <div className="space-y-3 rounded-xl border border-[#DCD8CE] bg-white p-3">
          <span className="text-xs font-semibold text-[#14213D]">Customer confirmation</span>
          <div className="flex flex-wrap gap-4 text-xs text-[#14213D]">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="confirm" checked={f.obtained} onChange={() => set({ obtained: true })} /> Obtained
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="confirm" checked={!f.obtained} onChange={() => set({ obtained: false })} /> Not obtained
            </label>
          </div>
          {f.obtained ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="How was it confirmed?" value={f.confirmationType} onChange={(e) => set({ confirmationType: e.target.value })} options={CONFIRMATION_TYPES.map((t) => ({ value: t, label: t }))} />
              <Input label="Customer officer name & designation" required value={f.officer} error={errors.officer} onChange={(e) => set({ officer: e.target.value })} placeholder="e.g. ACP Rajiv Kumar, Security Head" />
            </div>
          ) : (
            <Textarea label="Why was confirmation not obtained?" required rows={2} value={f.notObtainedReason} error={errors.notObtainedReason} onChange={(e) => set({ notObtainedReason: e.target.value })} />
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Customer feedback rating (optional)"
              value={f.rating}
              error={errors.rating}
              onChange={(e) => set({ rating: e.target.value })}
              options={[{ value: '', label: 'No rating' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))]}
            />
            <Input label="Customer remarks (optional)" value={f.customerRemarks} onChange={(e) => set({ customerRemarks: e.target.value })} />
          </div>
        </div>

        <Input label="Signed report document URL (optional)" value={f.reportUrl} onChange={(e) => set({ reportUrl: e.target.value })} placeholder="https://…" />

        <div className="space-y-2 rounded-xl border border-[#DCD8CE] bg-white p-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#14213D]">
            <input type="checkbox" checked={f.furtherWork} onChange={(e) => set({ furtherWork: e.target.checked })} className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63]" />
            Further work / revisit required
          </label>
          {f.furtherWork && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Textarea label="Further work needed" required rows={2} value={f.furtherDesc} error={errors.furtherDesc} onChange={(e) => set({ furtherDesc: e.target.value })} />
              <Input label="Next visit date" type="date" required min={todayLocal()} value={f.nextVisit} error={errors.nextVisit} onChange={(e) => set({ nextVisit: e.target.value })} />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#ECE9E2] pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={busy} disabled={wrongStatus}>
            File service report
          </Button>
        </div>
      </form>
    </Modal>
  );
};
