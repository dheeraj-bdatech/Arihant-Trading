'use client';

import React, { useState } from 'react';
import { Button, Badge, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg } from './serviceHelpers';

/** Mirror of the API's part-request status machine. */
export const PART_TRANSITIONS: Record<string, string[]> = {
  Requested: ['Reserved', 'Unavailable – Ordered', 'Issued', 'Cancelled'],
  Reserved: ['Issued', 'Partially Issued', 'Unavailable – Ordered', 'Cancelled'],
  'Partially Issued': ['Issued', 'Returned', 'Cancelled'],
  'Unavailable – Ordered': ['Reserved', 'Issued', 'Cancelled'],
  Issued: ['Returned'],
  Cancelled: [],
  Returned: [],
};

const partVariant = (s: string) =>
  s === 'Issued' ? 'success' : s === 'Reserved' || s === 'Partially Issued' ? 'info' : s === 'Unavailable – Ordered' ? 'urgent' : s === 'Cancelled' || s === 'Returned' ? 'default' : 'warning';

interface Props {
  ticket: any;
  role: string;
  onChanged: () => void | Promise<void>;
}

export const PartsTab: React.FC<Props> = ({ ticket, role, onChanged }) => {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);

  const closed = ['closed', 'cancelled'].includes(String(ticket.status));
  const canRequest = ['service_team', 'admin'].includes(role) && !closed;
  const canUpdate = ['management', 'admin', 'service_team'].includes(role);
  const parts: any[] = ticket.part_requests || [];

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = Number(qty);
    if (name.trim().length < 2) return setError('Part name must be at least 2 characters.');
    if (!Number.isInteger(q) || q < 1) return setError('Quantity must be a whole number of 1 or more.');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/service/tickets/${ticket.id}/part-requests`, {
        part_name: name.trim(),
        quantity: q,
        store_remarks: remarks.trim() || undefined,
      });
      setName('');
      setQty('1');
      setRemarks('');
      await onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const move = async (p: any, status: string) => {
    setRowBusy(p.id + status);
    setRowError(null);
    try {
      await api.patch(`/service/tickets/${ticket.id}/part-requests/${p.id}/status`, { status });
      await onChanged();
    } catch (err) {
      setRowError({ id: p.id, msg: errMsg(err) });
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <h5 className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Spares & part requests</h5>
      {parts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#DCD8CE] p-4 text-center text-xs text-[#4A5568]">No spare parts requested for this incident.</div>
      ) : (
        <div className="space-y-2">
          {parts.map((p) => {
            const next = PART_TRANSITIONS[p.status] || [];
            return (
              <div key={p.id} className="space-y-2 rounded-xl border border-[#DCD8CE] bg-white p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong className="text-[#14213D]">{p.part_name}</strong>{' '}
                    <span className="font-mono font-bold text-[#0F5E63]">× {p.quantity}</span>
                    <span className="ml-2 text-[#4A5568]">by {p.requested_by_name || 'Technician'}</span>
                  </div>
                  <Badge variant={partVariant(p.status) as any} size="sm">
                    {p.status}
                  </Badge>
                </div>
                {(p.store_remarks || p.expected_date) && (
                  <p className="text-[11px] text-[#4A5568]">
                    {p.store_remarks}
                    {p.expected_date ? ` · expected ${new Date(p.expected_date).toLocaleDateString('en-IN')}` : ''}
                  </p>
                )}
                {canUpdate && next.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-[#ECE9E2] pt-2">
                    {next.map((s) => (
                      <Button
                        key={s}
                        size="xs"
                        variant={s === 'Cancelled' ? 'ghost' : s === 'Issued' ? 'primary' : 'secondary'}
                        isLoading={rowBusy === p.id + s}
                        disabled={!!rowBusy}
                        onClick={() => move(p, s)}
                      >
                        {s === 'Unavailable – Ordered' ? 'Mark unavailable / ordered' : s}
                      </Button>
                    ))}
                  </div>
                )}
                {rowError?.id === p.id && (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                    {rowError?.msg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canRequest ? (
        <form onSubmit={add} className="space-y-3 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] p-3.5">
          <h6 className="font-serif text-xs font-bold text-[#14213D]">Raise a spare part request</h6>
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input label="Part name / number" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Conveyor motor VFD-200" />
            <Input label="Quantity" type="number" min={1} step={1} required value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input label="Remarks for store" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Urgent replacement" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="xs" isLoading={busy}>
              Submit request
            </Button>
          </div>
        </form>
      ) : (
        !closed && <p className="text-[11px] text-[#4A5568]">Part requests are raised by the assigned service engineer.</p>
      )}
    </div>
  );
};
