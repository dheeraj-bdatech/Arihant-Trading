'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { SERVICE_REASON_REQUIRED, SERVICE_STATUS_LABELS, serviceResolveBlocker, type ServiceStatus } from '@arihant/shared';
import { dateOnly, errMsg, isConflict, todayLocal, MANAGER_ROLES } from './serviceHelpers';

export interface Engineer {
  id: string;
  name: string;
}

interface Props {
  ticket: any | null;
  target: ServiceStatus | null;
  role: string;
  userId: string;
  engineers: Engineer[];
  onClose: () => void;
  /** Called after a successful move (parent refreshes the list + dossier). */
  onDone: () => void | Promise<void>;
  /** Called on a 409 so the parent can reload the ticket (fresh version + allowed steps). */
  onStale: () => void | Promise<void>;
}

const HINTS: Partial<Record<ServiceStatus, string>> = {
  awaiting_part: 'The SLA clock pauses while the ticket waits for a spare part.',
  awaiting_customer: 'The SLA clock pauses while we wait for the customer (access, approvals, availability).',
  on_hold: 'The SLA clock pauses while the ticket is on hold.',
  escalated: 'Only a regional manager, management or admin can de-escalate this later.',
  cancelled: 'A cancelled ticket is final and cannot be reopened. Open part requests are released.',
  reopened: 'Reopening restarts the SLA clock and is only possible within the reopen window.',
  revisit_required: 'Record why another visit is needed.',
  resolved: 'A ticket is resolved by its service report (work done + customer sign-off).',
  in_progress: 'Work starts on or after the scheduled visit day.',
  received: 'The assigned engineer is taken off the ticket and it goes back to the intake queue.',
};

const REASON_LABEL: Partial<Record<ServiceStatus, string>> = {
  awaiting_part: 'Which part is needed, and why?',
  awaiting_customer: 'What are we waiting on the customer for?',
  escalated: 'Why is this being escalated?',
  on_hold: 'Why is the ticket on hold?',
  revisit_required: 'Why is a revisit required?',
  cancelled: 'Why is the ticket being cancelled?',
  reopened: 'Why is the ticket being reopened?',
};

export const StatusActionModal: React.FC<Props> = ({ ticket, target, role, userId, engineers, onClose, onDone, onStale }) => {
  const [remarks, setRemarks] = useState('');
  const [assignee, setAssignee] = useState('');
  const [date, setDate] = useState('');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isManager = MANAGER_ROLES.includes(role);
  const needsReason = !!target && SERVICE_REASON_REQUIRED.includes(target);
  // work in progress needs an engineer too: an unassigned ticket picks one on the way (the API refuses none)
  const needsEngineer = target === 'assigned' || target === 'visit_scheduled' || (target === 'in_progress' && !ticket?.assigned_to);
  // a ticket held by an engineer this user cannot dispatch keeps that engineer (moving it is a reassignment)
  const keepsHolder = !!ticket?.assigned_to && !engineers.some((e) => e.id === ticket.assigned_to);
  const needsDate = target === 'visit_scheduled';
  // the API's rule: only this cycle's finished report can back "resolved"
  const resolveBlocker = target === 'resolved' && ticket ? serviceResolveBlocker(ticket) : null;
  const plannedDay = dateOnly(ticket?.planned_visit_date);
  // Manual start before the scheduled visit day is refused by the API (managers may override).
  const startTooEarly = target === 'in_progress' && !!plannedDay && plannedDay > todayLocal() && String(ticket?.status) === 'visit_scheduled';

  // `engineers` is already what this user may dispatch (GET /service/engineers): a field engineer gets only
  // himself, a chief service engineer his depot team, managers everyone in scope.
  const engineerOptions = useMemo(
    () => engineers.map((e) => (e.id === userId ? { ...e, name: `${e.name} (me)` } : e)),
    [userId, engineers],
  );

  useEffect(() => {
    if (!ticket || !target) return;
    setRemarks('');
    setError(null);
    setOverride(false);
    setBusy(false);
    const current = ticket.assigned_to as string | null;
    setAssignee(
      current && engineers.some((e) => e.id === current) ? current : role === 'service_team' && engineers.length <= 1 ? userId : '',
    );
    const planned = dateOnly(ticket.planned_visit_date);
    setDate(planned && planned >= todayLocal() ? planned : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, target]);

  if (!ticket || !target) return null;
  const label = SERVICE_STATUS_LABELS[target];
  // §47: swapping the engineer on the way is a reassignment, so the API wants its reason
  const changesEngineer = needsEngineer && !keepsHolder && !!ticket.assigned_to && !!assignee && assignee !== ticket.assigned_to;

  const validate = (): string | null => {
    const r = remarks.trim();
    if (needsReason && r.length < 5) return 'Please give a reason of at least 5 characters.';
    if (changesEngineer && r.length < 5) return 'Give a reason for changing the engineer (at least 5 characters).';
    if (needsEngineer && !keepsHolder && !assignee) return 'Select a service engineer.';
    if (needsDate) {
      if (!date) return 'Pick the planned visit date.';
      if (date < todayLocal() && !(isManager && override)) {
        return 'The visit date cannot be in the past' + (isManager ? ' — tick "Manager override" to allow it.' : '.');
      }
    }
    if (resolveBlocker) return resolveBlocker;
    if (startTooEarly && !(isManager && override)) {
      return `The visit is scheduled for ${plannedDay.split('-').reverse().join('/')}. Work can start on or after that day — reschedule the visit if the engineer is going earlier.`;
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) return setError(v);
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/service/tickets/${ticket.id}/status`, {
        status: target,
        version: ticket.version,
        remarks: remarks.trim() || undefined,
        assigned_to: needsEngineer && !keepsHolder ? assignee : undefined,
        planned_visit_date: needsDate ? date : undefined,
        manager_override: (needsDate || startTooEarly) && isManager && override ? true : undefined,
      });
      await onDone();
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        setError(`${errMsg(err)} The ticket has been refreshed — review it and try again.`);
        await onStale();
      } else {
        setError(errMsg(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Move to: ${label}`}
      description={`${ticket.ticket_no} · ${ticket.claimed_organisation_name || ticket.organisation_name || ''}`}
      maxWidth="md"
      zIndex={80}
    >
      <form onSubmit={submit} className={`space-y-4 ${needsEngineer ? "min-h-[24rem]" : ""}`}>
        {error && (
          <div role="alert" className="rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] p-3 text-xs text-[#700F2D]">
            {error}
          </div>
        )}
        {HINTS[target] && <p className="rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] p-2.5 text-xs text-[#4A5568]">{HINTS[target]}</p>}

        {needsEngineer && keepsHolder && (
          <Input label="Service engineer" value={ticket.assignee_name || 'Assigned engineer'} disabled helperText="Stays on the ticket — use Reassign engineer to change it." />
        )}
        {needsEngineer && !keepsHolder && (
          <Select
            label={role === 'service_team' && engineers.length <= 1 ? 'Service engineer (you)' : 'Service engineer'}
            required
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={[
              { value: '', label: '-- Select engineer --' },
              ...engineerOptions.map((en) => ({ value: en.id, label: en.name })),
            ]}
          />
        )}

        {needsDate && (
          <div className="space-y-2">
            <Input
              label="Planned visit date"
              type="date"
              required
              min={override && isManager ? undefined : todayLocal()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {isManager && (
              <label className="flex min-h-10 items-center gap-2 text-xs text-[#14213D] cursor-pointer sm:min-h-0">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63]"
                />
                Manager override — allow a date in the past
              </label>
            )}
          </div>
        )}

        {startTooEarly && (
          <div className="space-y-2 rounded-lg border border-[#9A3412]/30 bg-[#FBEBDD] p-2.5 text-xs text-[#7C2D12]">
            <p>The visit is scheduled for {plannedDay.split('-').reverse().join('/')}. Work can start on or after that day.</p>
            {isManager && (
              <label className="flex min-h-10 items-center gap-2 text-xs text-[#14213D] cursor-pointer sm:min-h-0">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63]"
                />
                Manager override — start work before the scheduled day
              </label>
            )}
          </div>
        )}

        {target === 'resolved' ? (
          !resolveBlocker ? (
            <Textarea
              label="Rectification details (optional — a report is on file)"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="What was found and what was done to fix it?"
            />
          ) : (
            <p className="rounded-lg border border-[#9A3412]/30 bg-[#FBEBDD] p-2.5 text-xs text-[#7C2D12]">
              {resolveBlocker} Use <strong>File service report</strong> on the ticket: it records the work done and the
              customer&apos;s sign-off, and resolves the ticket.
            </p>
          )
        ) : (
          <Textarea
            label={needsReason ? REASON_LABEL[target] || 'Reason' : changesEngineer ? 'Why is the engineer changing?' : 'Remarks (optional)'}
            required={needsReason || changesEngineer}
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={needsReason || changesEngineer ? 'A short written reason is mandatory (min. 5 characters)' : 'Optional note for the audit trail'}
          />
        )}

        {/* phones: 40px targets; the confirm button takes the rest of the row, within thumb reach */}
        <div className="flex justify-end gap-2 border-t border-[#ECE9E2] pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-10 shrink-0 sm:h-8">
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            isLoading={busy}
            disabled={!!resolveBlocker || (startTooEarly && !(isManager && override))}
            className="h-10 flex-1 sm:h-8 sm:flex-initial"
          >
            Confirm: {label}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
