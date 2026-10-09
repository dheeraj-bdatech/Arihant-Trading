'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Flame, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { CountUp } from '@/components/ui';

/* ------------------------------------------------------------------ tones -- */
export type Tone = 'teal' | 'red' | 'ochre' | 'ink' | 'green';
const TONE: Record<Tone, { text: string; bar: string; chip: string }> = {
  teal: { text: 'text-[#0F5E63]', bar: '#0F5E63', chip: 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30' },
  red: { text: 'text-[#9A3412]', bar: '#9A3412', chip: 'bg-[#FBEBDD] text-[#7C2D12] border-[#9A3412]/30' },
  ochre: { text: 'text-[#A15C07]', bar: '#C98A1B', chip: 'bg-[#FFF4DC] text-[#8A5A00] border-[#C98A1B]/40' },
  ink: { text: 'text-[#14213D]', bar: '#14213D', chip: 'bg-[#EEF1F7] text-[#14213D] border-[#14213D]/20' },
  green: { text: 'text-[#1F7A55]', bar: '#1F7A55', chip: 'bg-[#EAF6F0] text-[#1F7A55] border-[#1F7A55]/30' },
};

/** mounts false then flips true so CSS transitions (rings, bars) animate in */
function useMounted(delay = 60) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setM(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return m;
}

/* ---------------------------------------------------------------- KPI tile -- */
export interface KpiProps {
  label: string;
  value: string | number;
  sub?: string;
  href: string;
  icon: React.ReactNode;
  tone?: Tone;
  chip?: string;
  /** 0-100; draws an animated progress bar */
  progress?: number;
}

export const KpiTile: React.FC<KpiProps> = ({ label, value, sub, href, icon, tone = 'teal', chip }) => {
  // same box model as the shared StatCard so dashboard tiles match every other page
  return (
    <Link href={href} className="block h-full">
      <div className="kpi-tile tilt-3d glare edge relative flex h-full flex-col justify-between overflow-hidden rounded-[14px] border border-[#DCD8CE] bg-white p-3 shadow-2xs sm:p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[11px] font-semibold uppercase leading-tight tracking-wider text-[#4A5568] sm:text-xs">{label}</span>
          <span className="kpi-icon shrink-0 rounded-[8px] border border-[#DCD8CE] bg-[#FBFAF7] p-1.5 text-[#9A3412] [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        </div>
        <div>
          <CountUp as="div" className={`font-mono text-xl font-bold tracking-tight sm:text-2xl ${TONE[tone].text}`}>
            {String(value)}
          </CountUp>
          <span className="mt-1.5 flex items-center justify-between gap-2 text-xs font-medium text-[#4A5568]">
            <span className="truncate">{sub}</span>
            {chip && <span className={`shrink-0 rounded-full border px-2 font-mono text-[10px] font-bold leading-4 ${TONE[tone].chip}`}>{chip}</span>}
          </span>
        </div>
      </div>
    </Link>
  );
};

/* ------------------------------------------------------------------- panel -- */
export const Panel: React.FC<{
  title: string;
  icon?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, href, hrefLabel = 'View all', className = '', children }) => (
  <section className={`edge relative overflow-hidden rounded-[14px] border border-[#DCD8CE] bg-white shadow-2xs ${className}`}>
    <header className="flex items-center justify-between gap-3 border-b border-[#ECE9E2] bg-[#FBFAF7] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-[#9A3412]">{icon}</span>}
        <h2 className="truncate font-serif text-[13px] font-bold uppercase tracking-wider text-[#14213D]">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="flex shrink-0 items-center gap-1 text-xs font-bold text-[#9A3412] hover:underline">
          {hrefLabel} <ChevronRight size={12} />
        </Link>
      )}
    </header>
    {children}
  </section>
);

/* ------------------------------------------------------------- attention -- */
export interface AttentionItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail?: string;
  href: string;
  right?: React.ReactNode;
  when?: string;
}

const SEV = {
  critical: { Icon: Flame, cls: 'text-[#9A3412] bg-[#FBEBDD]' },
  warning: { Icon: AlertTriangle, cls: 'text-[#A15C07] bg-[#FFF4DC]' },
  info: { Icon: Info, cls: 'text-[#0F5E63] bg-[#E3EFEE]' },
} as const;

export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const AttentionList: React.FC<{ items: AttentionItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EAF6F0] text-[#1F7A55]">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="font-serif text-sm font-bold text-[#14213D]">Nothing is waiting on you</p>
        <p className="max-w-xs text-xs text-[#4A5568]">Deadlines, blocked work and approvals that need action will appear here.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((it, i) => {
        const { Icon, cls } = SEV[it.severity];
        return (
          <li key={it.id} className="dash-row" style={{ animationDelay: `${i * 45}ms` }}>
            <Link href={it.href} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cls}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-[#14213D]">{it.title}</span>
                {it.detail && <span className="block truncate text-[11px] text-[#4A5568]">{it.detail}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {it.right}
                {it.when && <span className="font-mono text-[10px] text-[#6B7280]">{it.when}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

/* --------------------------------------------------------------- rings -- */
export const RingGauge: React.FC<{ label: string; sub?: string; value: number; max: number; display?: string; tone?: Tone }> = ({
  label,
  sub,
  value,
  max,
  display,
  tone = 'teal',
}) => {
  const mounted = useMounted(160);
  const R = 38;
  const C = 2 * Math.PI * R;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative h-[104px] w-[104px]">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="#EFDDBE" strokeWidth="9" />
          <circle cx="50" cy="50" r={R} fill="none" stroke="#C98A1B" strokeWidth="1" strokeDasharray="2 5" opacity="0.7" transform="scale(1)" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={TONE[tone].bar}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={mounted ? C * (1 - pct) : C}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-mono text-lg font-bold leading-none ${TONE[tone].text}`}>{display ?? `${Math.round(pct * 100)}%`}</span>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wider text-[#14213D]">{label}</div>
      {sub && <div className="text-[11px] text-[#4A5568]">{sub}</div>}
    </div>
  );
};

/* ------------------------------------------------------------ stacked bar -- */
export interface Segment {
  label: string;
  value: number;
  tone: Tone;
}
export const StackBar: React.FC<{ title?: string; segments: Segment[] }> = ({ title, segments }) => {
  const mounted = useMounted(200);
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      {title && <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#4A5568]">{title}</div>}
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#EFDDBE]">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full transition-[width] duration-1000 ease-out first:rounded-l-full last:rounded-r-full"
            style={{ width: mounted && total ? `${(s.value / total) * 100}%` : '0%', background: TONE[s.tone].bar }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-[#4A5568]">
              <span className="h-2 w-2 shrink-0 rotate-45" style={{ background: TONE[s.tone].bar }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-mono font-bold text-[#14213D]">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* ---------------------------------------------------------- quick actions -- */
export interface QuickAction {
  label: string;
  hint: string;
  href: string;
  icon: React.ReactNode;
}
export const QuickActions: React.FC<{ actions: QuickAction[] }> = ({ actions }) => (
  <div className="grid grid-cols-2 gap-3 p-4">
    {actions.map((a, i) => (
      <Link
        key={a.label}
        href={a.href}
        className="dash-row tilt-3d group flex flex-col gap-2 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] p-3 transition-colors hover:border-[#9A3412] hover:bg-[#FBE9D0]"
        style={{ animationDelay: `${i * 55}ms` }}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#9A3412] shadow-2xs ring-1 ring-[#C98A1B]/40 transition-transform group-hover:scale-110">
          {a.icon}
        </span>
        <span>
          <span className="block text-[13px] font-bold text-[#14213D]">{a.label}</span>
          <span className="block text-[11px] leading-snug text-[#4A5568]">{a.hint}</span>
        </span>
      </Link>
    ))}
  </div>
);

/* --------------------------------------------------------------- timeline -- */
export interface TimelineItem {
  id: string;
  title: string;
  detail?: string;
  when?: string;
  tone: Tone;
  href?: string;
}
export const Timeline: React.FC<{ items: TimelineItem[]; empty?: string }> = ({ items, empty = 'No recent activity' }) => {
  if (items.length === 0) return <p className="px-4 py-10 text-center text-xs text-[#4A5568]">{empty}</p>;
  return (
    <ol className="relative px-4 py-3">
      <span aria-hidden className="absolute bottom-5 left-[26px] top-5 w-px border-l border-dotted border-[#C98A1B]" />
      {items.map((it, i) => {
        const body = (
          <>
            <span className="relative z-10 mt-1 h-3 w-3 shrink-0 rotate-45 border-2 border-white" style={{ background: TONE[it.tone].bar }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[#14213D]">{it.title}</span>
              {it.detail && <span className="block truncate text-[11px] text-[#4A5568]">{it.detail}</span>}
            </span>
            {it.when && <span className="shrink-0 font-mono text-[10px] text-[#6B7280]">{it.when}</span>}
          </>
        );
        return (
          <li key={it.id} className="dash-row py-2" style={{ animationDelay: `${i * 50}ms` }}>
            {it.href ? (
              <Link href={it.href} className="flex items-start gap-3">
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
};
