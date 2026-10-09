'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';

/** Spec §24: urgent ≤ 48h, upcoming ≤ 7d. Mirrors TENDER_URGENT_HOURS / TENDER_UPCOMING_DAYS. */
const URGENT_MS = 48 * 3600_000;
const UPCOMING_MS = 7 * 24 * 3600_000;

export type DeadlineTone = 'overdue' | 'urgent' | 'soon' | 'ok';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function describeDeadline(deadline: string | Date | null | undefined, now: number) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (Number.isNaN(ms)) return null;
  const tone: DeadlineTone = ms < 0 ? 'overdue' : ms <= URGENT_MS ? 'urgent' : ms <= UPCOMING_MS ? 'soon' : 'ok';
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const label =
    tone === 'overdue'
      ? 'CLOSED'
      : d > 0
        ? `${d}d ${pad(h)}h ${pad(m)}m`
        : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return { ms, tone, label };
}

const TONE_CLS: Record<DeadlineTone, string> = {
  overdue: 'bg-[#ECE9E2] text-[#4A5568] border-[#C9C4B8]',
  urgent: 'bg-[#9A3412] text-white border-transparent deadline-pulse',
  soon: 'bg-[#FBEBDD] text-[#7C2D12] border-[#F2B872]',
  ok: 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30',
};

/** Live ticking chip: "02d 04h 11m" → "05:12:09" inside the last day, pulsing under 48h. */
export const DeadlineChip: React.FC<{ deadline?: string | Date | null; className?: string }> = ({ deadline, className }) => {
  const now = useNow(1000);
  const info = describeDeadline(deadline, now);
  if (!info) return <Badge variant="urgent" size="sm">CLOSING SOON</Badge>;
  return (
    <span
      title={`Closes ${new Date(deadline as string).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums ${TONE_CLS[info.tone]} ${className ?? ''}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {info.label}
    </span>
  );
};
