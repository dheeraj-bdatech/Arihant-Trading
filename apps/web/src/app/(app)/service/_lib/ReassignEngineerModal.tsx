'use client';

import React, { useEffect, useState } from 'react';
import { Modal, Button, Select, Textarea, InfoCallout } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, isConflict } from '@/components/service/serviceHelpers';
import type { Engineer } from '@/components/service/StatusActionModal';

interface Props {
  ticket: any | null;
  engineers: Engineer[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onStale: () => void | Promise<void>;
}

/** §47: hand an open ticket to another engineer without changing its status (reason goes to the assignment history). */
export const ReassignEngineerModal: React.FC<Props> = ({ ticket, engineers, onClose, onDone, onStale }) => {
  const [assignee, setAssignee] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAssignee('');
    setReason('');
    setErrors({});
    setError(null);
    setBusy(false);
  }, [ticket?.id]);

  if (!ticket) return null;
  const options = engineers.filter((e) => e.id !== ticket.assigned_to);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!assignee) e.assignee = 'Choose the engineer who takes over.';
    if (reason.trim().length < 5) e.reason = 'Give a reason (at least 5 characters).';
    setErrors(e);
    if (Object.keys(e).length) return;
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/service/tickets/${ticket.id}/assign`, { assigned_to: assignee, reason: reason.trim(), version: ticket.version });
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
    <Modal isOpen onClose={onClose} title="Reassign engineer" description={`Ticket ${ticket.ticket_no || ''} keeps its current status; only the engineer changes.`} maxWidth="md" zIndex={80}>
      <form onSubmit={submit} className="space-y-3">
        {error && (
          <div role="alert" className="rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] p-3 text-xs text-[#700F2D]">
            {error}
          </div>
        )}
        <div className="rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] p-3 text-xs">
          <span className="text-[#4A5568]">Current engineer:</span> <strong className="text-[#14213D]">{ticket.assignee_name || 'Unassigned'}</strong>
        </div>
        {options.length === 0 ? (
          <InfoCallout variant="warning">There is no other engineer you can assign this ticket to.</InfoCallout>
        ) : (
          <Select
            label="New engineer"
            required
            value={assignee}
            error={errors.assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={[{ value: '', label: '-- Select engineer --' }, ...options.map((eng) => ({ value: eng.id, label: eng.name }))]}
          />
        )}
        <Textarea
          label="Reason for reassignment"
          required
          rows={2}
          value={reason}
          error={errors.reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Engineer on leave; Patna depot engineer is closer to site."
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={busy} disabled={options.length === 0}>
            Reassign
          </Button>
        </div>
      </form>
    </Modal>
  );
};
