'use client';

import React from 'react';
import { ShieldQuestion, Link2, Phone, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui';

/** Dossier banner for a public-portal ticket whose customer has not been matched to a real organisation yet. */
export const UnverifiedBanner: React.FC<{ ticket: any; canLink: boolean; onLink: () => void }> = ({ ticket, canLink, onLink }) => {
  const i = ticket.intake || {};
  const place = [i.claimed_department, i.claimed_city, i.claimed_state].filter(Boolean).join(', ');
  return (
    <div className="rounded-xl border-2 border-[#9A3412]/50 bg-[#FBEBDD] p-3.5 space-y-2.5 text-xs text-[#7C2D12]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <ShieldQuestion className="h-5 w-5 shrink-0 text-[#9A3412]" />
          <div>
            <p className="text-sm font-bold">Unverified customer — claims to be {ticket.claimed_organisation_name}</p>
            <p className="mt-0.5 text-[11px]">
              Raised through the public service portal. Details below are unchecked; confirm who this is before dispatching.
              {place ? ` Stated location: ${place}.` : ''}
            </p>
          </div>
        </div>
        {canLink && (
          <Button size="sm" variant="primary" onClick={onLink}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Link to customer
          </Button>
        )}
      </div>
      {ticket.intake && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-[#9A3412]/20 bg-white/70 p-2.5 text-[#14213D]">
          <p className="flex items-center gap-1.5">
            <User className="h-3 w-3 text-[#9A3412]" />
            <strong>{i.contact_name || '—'}</strong>
            {i.contact_designation ? <span className="text-[#4A5568]">· {i.contact_designation}</span> : null}
          </p>
          <p className="flex items-center gap-1.5">
            <Phone className="h-3 w-3 text-[#9A3412]" />
            {i.contact_phone ? <a className="font-mono hover:underline" href={`tel:${i.contact_phone}`}>{i.contact_phone}</a> : '—'}
          </p>
          <p className="flex items-center gap-1.5 min-w-0">
            <Mail className="h-3 w-3 shrink-0 text-[#9A3412]" />
            {i.contact_email ? <a className="truncate hover:underline" href={`mailto:${i.contact_email}`}>{i.contact_email}</a> : '—'}
          </p>
          <p>
            <span className="text-[#4A5568]">Portal ref:</span> <span className="font-mono font-semibold">{i.reference || '—'}</span>
          </p>
          <p>
            <span className="text-[#4A5568]">Auto-match:</span>{' '}
            {i.match_method ? `${i.match_method}${i.match_confidence != null ? ` (${Math.round(Number(i.match_confidence) * 100)}%)` : ''}` : 'none'}
          </p>
          <p>
            <span className="text-[#4A5568]">Customer urgency:</span> {String(i.urgency || '—').replace(/_/g, ' ')}
          </p>
          {i.preferred_visit_date && (
            <p>
              <span className="text-[#4A5568]">Preferred visit:</span> {new Date(i.preferred_visit_date).toLocaleDateString('en-IN')}
            </p>
          )}
          {i.site_access_notes && (
            <p className="sm:col-span-2">
              <span className="text-[#4A5568]">Site access notes:</span> {i.site_access_notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
