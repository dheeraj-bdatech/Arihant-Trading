'use client';

import React, { useEffect, useState } from 'react';
import { Modal, Button, Textarea, InfoCallout } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, isConflict, MANAGER_ROLES } from './serviceHelpers';

interface Props {
  ticket: any | null;
  role: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onStale: () => void | Promise<void>;
}

/** Sign-off. Engineers need an approved report; managers approve implicitly. */
export const CloseTicketModal: React.FC<Props> = ({ ticket, role, onClose, onDone, onStale }) => {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRemarks('');
    setError(null);
    setBusy(false);
  }, [ticket?.id]);

  if (!ticket) return null;
  const latest = (ticket.reports || [])[0];
  const isManager = MANAGER_ROLES.includes(role);
  const approved = latest?.report_status === 'Approved';
  const returned = latest?.report_status === 'Returned for Correction';
  const noConfirmation = latest && latest.customer_confirmation === false;
  const blockedForEngineer = !isManager && !approved;
  const blocker = !latest
    ? 'No service report is on file — file one first.'
    : returned
      ? 'The latest report was returned for correction.'
      : blockedForEngineer
        ? 'The service report must be approved by a manager before an engineer can close the ticket.'
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker) return setError(blocker);
    if (noConfirmation && remarks.trim().length < 5) {
      return setError('Customer confirmation was not obtained — add a closing remark (at least 5 characters) explaining why it can still be closed.');
    }
    setError(null);
    setBusy(true);
    try {
      await api.post(`/service/tickets/${ticket.id}/close`, { remarks: remarks.trim() || undefined });
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
    <Modal isOpen onClose={onClose} title="Sign off & close ticket" description={`${ticket.ticket_no} · ${ticket.organisation_name || ''}`} maxWidth="md" zIndex={80}>
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {blocker && <InfoCallout variant="warning">{blocker}</InfoCallout>}
        {!blocker && !approved && isManager && (
          <InfoCallout variant="info">The submitted report will be approved automatically when you close the ticket.</InfoCallout>
        )}
        {noConfirmation && (
          <InfoCallout variant="warning" title="No customer confirmation">
            The engineer could not obtain customer sign-off{latest?.confirmation_not_obtained_reason ? `: "${latest.confirmation_not_obtained_reason}"` : '.'} A closing remark is required.
          </InfoCallout>
        )}
        <Textarea
          label={noConfirmation ? 'Closing remarks' : 'Closing remarks (optional)'}
          required={!!noConfirmation}
          rows={3}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Anything worth recording at sign-off"
        />
        <div className="flex justify-end gap-2 border-t border-[#ECE9E2] pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={busy} disabled={!!blocker}>
            Close ticket
          </Button>
        </div>
      </form>
    </Modal>
  );
};
