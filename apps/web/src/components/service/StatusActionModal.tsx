'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { SERVICE_REASON_REQUIRED, SERVICE_STATUS_LABELS, type ServiceStatus } from '@arihant/shared';
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
  resolved: 'Describe the rectification so the record is complete (a service report can follow).',
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
  const needsEngineer = target === 'assigned' || target === 'visit_scheduled';
  const needsDate = target === 'visit_scheduled';
  const hasReport = (ticket?.reports || []).length > 0;

  // Engineers may only assign a ticket to themselves.
  const engineerOptions = useMemo(() => {
    if (role === 'service_team') return [{ id: userId, name: 'Myself' }];
    return engineers;
  }, [role, userId, engineers]);

  useEffect(() => {
    if (!ticket || !target) return;
    setRemarks('');
    setError(null);
    setOverride(false);
    setBusy(false);
    const current = ticket.assigned_to as string | null;
    setAssignee(
      role === 'service_team' ? userId : current && engineers.some((e) => e.id === current) ? current : current || '',
    );
    const planned = dateOnly(ticket.planned_visit_date);
    setDate(planned && planned >= todayLocal() ? planned : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, target]);

  if (!ticket || !target) return null;
  const label = SERVICE_STATUS_LABELS[target];

  const validate = (): string | null => {
    const r = remarks.trim();
    if (needsReason && r.length < 5) return 'Please give a reason of at least 5 characters.';
    if (needsEngineer && !assignee) return 'Select a service engineer.';
    if (needsDate) {
      if (!date) return 'Pick the planned visit date.';
      if (date < todayLocal() && !(isManager && override)) {
        return 'The visit date cannot be in the past' + (isManager ? ' — tick "Manager override" to allow it.' : '.');
      }
    }
    if (target === 'resolved' && !hasReport && r.length < 10) {
      return 'Describe the rectification (at least 10 characters), or file a service report first.';
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
        assigned_to: needsEngineer ? assignee : undefined,
        planned_visit_date: needsDate ? date : undefined,
        manager_override: needsDate && isManager && override ? true : undefined,
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
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {HINTS[target] && <p className="rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] p-2.5 text-xs text-[#4A5568]">{HINTS[target]}</p>}

        {needsEngineer && (
          <Select
            label={role === 'service_team' ? 'Service engineer (you)' : 'Service engineer'}
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
              <label className="flex items-center gap-2 text-xs text-[#14213D] cursor-pointer">
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

        {target === 'resolved' ? (
          <Textarea
            label={hasReport ? 'Rectification details (optional — a report is on file)' : 'Rectification details'}
            required={!hasReport}
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What was found and what was done to fix it?"
          />
        ) : (
          <Textarea
            label={needsReason ? REASON_LABEL[target] || 'Reason' : 'Remarks (optional)'}
            required={needsReason}
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={needsReason ? 'A short written reason is mandatory (min. 5 characters)' : 'Optional note for the audit trail'}
          />
        )}

        <div className="flex justify-end gap-2 border-t border-[#ECE9E2] pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={busy}>
            Confirm: {label}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
