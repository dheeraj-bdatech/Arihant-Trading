'use client';

import React from 'react';
import { PauseCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { describeDeadline, useNow, type DeadlineTone } from '@/components/tender/Countdown';
import { isFinished, isSlaPaused } from './serviceHelpers';

const TONE_CLS: Record<DeadlineTone, string> = {
  overdue: 'bg-[#9A3412] text-white border-transparent',
  urgent: 'bg-[#FBEBDD] text-[#7C2D12] border-[#9A3412]/50 deadline-pulse',
  soon: 'bg-[#FBEBDD] text-[#7C2D12] border-[#F2B872]',
  ok: 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30',
};

function span(ms: number): string {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(s)}`;
}

/** Live SLA countdown. Past the deadline it flips to "BREACHED +…" (service tickets, unlike tenders, keep running). */
export const SlaChip: React.FC<{ deadline?: string | Date | null; prefix?: string; tickMs?: number; className?: string }> = ({
  deadline,
  prefix,
  tickMs = 1000,
  className,
}) => {
  const now = useNow(tickMs);
  const info = describeDeadline(deadline, now);
  if (!info) return null;
  return (
    <span
      title={`Due ${new Date(deadline as string).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${TONE_CLS[info.tone]} ${className ?? ''}`}
    >
      {info.tone === 'overdue' ? <AlertTriangle className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {prefix ? `${prefix} ` : ''}
      {info.tone === 'overdue' ? `BREACHED +${span(info.ms)}` : span(info.ms)}
    </span>
  );
};

export const SlaPausedPill: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border border-[#C9C4B8] bg-[#ECE9E2] px-2.5 py-0.5 text-[11px] font-bold text-[#4A5568] ${className ?? ''}`}
    title="The SLA clock is stopped while the ticket waits on a part, the customer, or is on hold"
  >
    <PauseCircle className="h-3 w-3" />
    SLA PAUSED
  </span>
);

/** One-line SLA state for a ticket card. */
export const TicketSlaInline: React.FC<{ ticket: any; tickMs?: number }> = ({ ticket, tickMs = 30_000 }) => {
  if (isFinished(ticket.status)) return null;
  if (isSlaPaused(ticket)) return <SlaPausedPill />;
  if (!ticket.sla_resolution_due_at) return null;
  return <SlaChip deadline={ticket.sla_resolution_due_at} prefix="Resolve" tickMs={tickMs} />;
};

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Dossier SLA block: response + resolution deadlines, pause state, breach state. */
export const SlaPanel: React.FC<{ ticket: any }> = ({ ticket }) => {
  const finished = isFinished(ticket.status);
  const paused = !finished && isSlaPaused(ticket);
  const breached = !!ticket.sla_breached;
  const pausedMins = Number(ticket.sla_paused_minutes || 0);

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 text-xs ${
        breached ? 'border-[#9A3412]/50 bg-[#FBEBDD]' : 'border-[#DCD8CE] bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-serif text-xs font-bold uppercase tracking-wider text-[#0F5E63]">Service Level (SLA)</span>
        {breached && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#9A3412] px-2 py-0.5 text-[10px] font-bold text-white">
            <AlertTriangle className="h-3 w-3" /> SLA BREACHED
          </span>
        )}
        {paused && <SlaPausedPill />}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <span className="block text-[10px] text-[#4A5568]">First response due</span>
          {ticket.first_response_at ? (
            <span className="inline-flex items-center gap-1 font-semibold text-[#0F5E63]">
              <CheckCircle2 className="h-3.5 w-3.5" /> Responded {fmt(ticket.first_response_at)}
            </span>
          ) : finished || paused || !ticket.sla_response_due_at ? (
            <span className="font-mono font-semibold text-[#14213D]">{fmt(ticket.sla_response_due_at)}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <SlaChip deadline={ticket.sla_response_due_at} />
              <span className="font-mono text-[10px] text-[#4A5568]">{fmt(ticket.sla_response_due_at)}</span>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <span className="block text-[10px] text-[#4A5568]">Resolution due</span>
          {finished || paused || !ticket.sla_resolution_due_at ? (
            <span className="font-mono font-semibold text-[#14213D]">{fmt(ticket.sla_resolution_due_at)}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <SlaChip deadline={ticket.sla_resolution_due_at} />
              <span className="font-mono text-[10px] text-[#4A5568]">{fmt(ticket.sla_resolution_due_at)}</span>
            </div>
          )}
        </div>
      </div>
      {(paused || pausedMins > 0) && (
        <p className="text-[11px] text-[#4A5568]">
          {paused ? 'Clock stopped while the ticket is waiting. ' : ''}
          {pausedMins > 0 ? `Total time paused so far: ${Math.floor(pausedMins / 60)}h ${pausedMins % 60}m.` : ''}
        </p>
      )}
    </div>
  );
};
