'use client';

import React, { useState } from 'react';
import { MapPin, LogOut } from 'lucide-react';
import { Button, Badge, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg } from './serviceHelpers';
import { isAssignedEngineer } from './serviceHelpers';

export const VISIT_OUTCOMES = [
  { value: 'Completed', label: 'Completed' },
  { value: 'Partially Completed', label: 'Partially completed (notes required)' },
  { value: 'Customer Not Available', label: 'Customer not available — awaits customer (notes required)' },
  { value: 'Part Required', label: 'Part required — awaits part (notes required)' },
  { value: 'Escalation Needed', label: 'Escalation needed (notes required)' },
  { value: 'Revisit Required', label: 'Revisit required (notes required)' },
];
const NOTES_REQUIRED = ['Partially Completed', 'Customer Not Available', 'Part Required', 'Escalation Needed', 'Revisit Required'];
const CHECKIN_STATUSES = ['visit_scheduled', 'assigned', 'awaiting_part', 'awaiting_customer', 'reopened', 'revisit_required', 'in_progress'];

function getPosition(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout: 6000, maximumAge: 60_000 },
    );
  });
}

interface Props {
  ticket: any;
  role: string;
  userId: string;
  onChanged: () => void | Promise<void>;
}

const VisitCard: React.FC<{ visit: any; ticket: any; canWork: boolean; closed: boolean; onChanged: Props['onChanged'] }> = ({ visit: v, ticket, canWork, closed, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('Completed');
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);

  const checkedIn = !!v.actual_check_in;
  const checkedOut = !!v.actual_check_out;
  const statusOk = CHECKIN_STATUSES.includes(String(ticket.status));

  const checkIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { lat, lng } = await getPosition();
      await api.patch(`/service/tickets/${ticket.id}/visits/${v.id}/check-in`, {
        check_in_lat: lat,
        check_in_lng: lng,
      });
      await onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const checkOut = async () => {
    if (NOTES_REQUIRED.includes(outcome) && notes.trim().length < 5) {
      return setError(`Visit notes (at least 5 characters) are required for "${outcome}".`);
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/service/tickets/${ticket.id}/visits/${v.id}/check-out`, {
        visit_outcome: outcome,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      setNotes('');
      await onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-[#DCD8CE] bg-white p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-[#14213D]">Visit #{v.visit_number}</span>
        <Badge variant={checkedOut ? 'success' : checkedIn ? 'info' : 'default'} size="sm">
          {checkedOut ? v.visit_outcome || 'CHECKED OUT' : checkedIn ? 'ON SITE (CHECKED IN)' : 'SCHEDULED'}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs text-[#4A5568] sm:grid-cols-3">
        <div>
          Scheduled: <strong className="text-[#14213D]">{v.scheduled_start ? new Date(v.scheduled_start).toLocaleString('en-IN') : 'TBD'}</strong>
        </div>
        <div>
          Check-in: <strong className="text-[#14213D]">{checkedIn ? new Date(v.actual_check_in).toLocaleString('en-IN') : 'Pending'}</strong>
        </div>
        <div>
          Check-out: <strong className="text-[#14213D]">{checkedOut ? new Date(v.actual_check_out).toLocaleString('en-IN') : 'Pending'}</strong>
        </div>
      </div>
      {checkedIn && v.check_in_lat != null && (
        <p className="font-mono text-[10px] text-[#4A5568]">
          GPS {Number(v.check_in_lat).toFixed(4)}, {Number(v.check_in_lng).toFixed(4)}
        </p>
      )}
      {v.notes && <p className="rounded border border-[#ECE9E2] bg-[#FBFAF7] p-2 text-xs text-[#14213D]">{v.notes}</p>}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!checkedOut && !closed && (
        <div className="space-y-2 border-t border-[#ECE9E2] pt-2">
          {!canWork ? (
            <p className="text-[11px] text-[#4A5568]">Only the assigned engineer can check in and out of a visit.</p>
          ) : !checkedIn ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" onClick={checkIn} isLoading={busy} disabled={!statusOk}>
                <MapPin className="mr-1 h-3 w-3" />
                GPS check-in
              </Button>
              <Button size="xs" variant="secondary" disabled title="Check in first">
                <LogOut className="mr-1 h-3 w-3" />
                Check-out
              </Button>
              <span className="text-[11px] text-[#4A5568]">{statusOk ? 'Check in on arrival; check-out unlocks afterwards.' : `Cannot check in while the ticket is ${String(ticket.status).replace(/_/g, ' ')}.`}</span>
            </div>
          ) : !open ? (
            <Button size="xs" onClick={() => setOpen(true)}>
              <LogOut className="mr-1 h-3 w-3" />
              Check-out
            </Button>
          ) : (
            <div className="space-y-2">
              <Select label="Visit outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} options={VISIT_OUTCOMES} />
              <Textarea
                label={NOTES_REQUIRED.includes(outcome) ? 'Visit notes (required)' : 'Visit notes (optional)'}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              {outcome !== 'Completed' && outcome !== 'Partially Completed' && (
                <p className="text-[11px] text-[#4A5568]">This outcome will also move the ticket status automatically.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button size="xs" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
                  Cancel
                </Button>
                <Button size="xs" onClick={checkOut} isLoading={busy}>
                  Confirm check-out
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const VisitsTab: React.FC<Props> = ({ ticket, role, userId, onChanged }) => {
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = ['closed', 'cancelled'].includes(String(ticket.status));
  const canSchedule = ['management', 'regional_manager', 'service_team', 'admin'].includes(role) && !closed;
  const canWork = role === 'admin' || (role === 'service_team' && isAssignedEngineer(ticket, userId));
  const visits: any[] = ticket.visits || [];

  const schedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!when) return setError('Pick the planned date and time.');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/service/tickets/${ticket.id}/visits`, {
        scheduled_start: new Date(when).toISOString(),
        notes: notes.trim() || undefined,
      });
      setWhen('');
      setNotes('');
      await onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Technical visits</h5>
      {visits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#DCD8CE] p-4 text-center text-xs text-[#4A5568]">No visits recorded yet for this ticket.</div>
      ) : (
        <div className="space-y-2.5">
          {visits.map((v) => (
            <VisitCard key={v.id} visit={v} ticket={ticket} canWork={canWork} closed={closed} onChanged={onChanged} />
          ))}
        </div>
      )}

      {canSchedule && (
        <form onSubmit={schedule} className="space-y-3 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] p-3.5">
          <h6 className="font-serif text-xs font-bold text-[#14213D]">Add a visit slot</h6>
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input label="Planned date & time" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
            <Input label="Visit notes / instructions" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bring replacement optics assembly" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="xs" isLoading={busy}>
              Add visit
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
