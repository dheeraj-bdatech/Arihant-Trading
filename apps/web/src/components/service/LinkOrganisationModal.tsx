'use client';

import React, { useEffect, useState } from 'react';
import { Search, Building, Check } from 'lucide-react';
import { Modal, Button, Input, Textarea, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, isConflict } from './serviceHelpers';

interface Props {
  ticket: any | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onStale: () => void | Promise<void>;
}

/** Search the organisation master and link an unverified portal ticket to the real customer. */
export const LinkOrganisationModal: React.FC<Props> = ({ ticket, onClose, onDone, onStale }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<any | null>(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket) return;
    setSearch(ticket.claimed_organisation_name || '');
    setPicked(null);
    setRemarks('');
    setError(null);
    setBusy(false);
  }, [ticket?.id]);

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get('/organisations', { search: search.trim() || undefined, limit: 15 })
        .then((res) => !cancelled && setResults(res.data || []))
        .catch((e) => !cancelled && setError(errMsg(e, 'Could not search organisations.')))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, ticket?.id]);

  if (!ticket) return null;

  const submit = async () => {
    if (!picked) return setError('Pick the customer organisation to link.');
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/service/tickets/${ticket.id}/link-organisation`, {
        organisation_id: picked.id,
        remarks: remarks.trim() || undefined,
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
      title="Link to verified customer"
      description={`${ticket.ticket_no} claims to be "${ticket.claimed_organisation_name}". Choose the real customer organisation.`}
      maxWidth="md"
      zIndex={80}
    >
      <div className="space-y-3">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#4A5568]" />
          <Input
            placeholder="Search customers by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search organisations"
          />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-[#DCD8CE] divide-y divide-[#ECE9E2] bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-xs text-[#4A5568]">
              <Spinner size="sm" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-xs text-[#4A5568]">No matching organisations.</p>
          ) : (
            results.map((o) => {
              const on = picked?.id === o.id;
              return (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => setPicked(o)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${on ? 'bg-[#E3EFEE]' : 'hover:bg-[#FBFAF7]'}`}
                >
                  <Building className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[#14213D]">{o.name}</strong>
                    <span className="text-[10px] text-[#4A5568]">{[o.city, o.state, o.sector].filter(Boolean).join(' · ')}</span>
                  </span>
                  {on && <Check className="h-4 w-4 text-[#0F5E63]" />}
                </button>
              );
            })
          )}
        </div>
        <Textarea label="Verification note (optional)" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Confirmed by phone with the station in-charge" />
        <div className="flex justify-end gap-2 border-t border-[#ECE9E2] pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" isLoading={busy} disabled={!picked} onClick={submit}>
            {picked ? `Link to ${picked.name}` : 'Link customer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
