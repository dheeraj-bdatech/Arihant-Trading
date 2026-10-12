'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ChevronRight, Flame, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { CountUp } from '@/components/ui';
import './command-deck.css';

/* ------------------------------------------------------------------ tones -- */
/** colours live in command-deck.css under [data-tone]; components only pick a tone */
export type Tone = 'teal' | 'red' | 'ochre' | 'ink' | 'green';
const GRAD_STOPS: Record<Tone, [string, string]> = {
  teal: ['#14b8a6', '#0f766e'],
  red: ['#f97316', '#c2410c'],
  ochre: ['#f2b53d', '#b7791f'],
  ink: ['#4a63a6', '#1f2e52'],
  green: ['#4ade80', '#15803d'],
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

/* -------------------------------------------------------------------- hero -- */
export interface HeroStat {
  label: string;
  value: number;
  tone: Tone;
}
export const HeroBanner: React.FC<{
  greeting: string;
  name: string;
  roleLabel: string;
  zone?: string;
  dateLabel: string;
  summary: string;
  stats: HeroStat[];
  ctaHref: string;
  ctaLabel: string;
}> = ({ greeting, name, roleLabel, zone, dateLabel, summary, stats, ctaHref, ctaLabel }) => (
  <section className="dx-hero dx-rise">
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <span className="dx-hero__eyebrow">
          <span className="dx-hero__live" aria-hidden /> Command dashboard
        </span>
        <h1 className="dx-hero__title">
          {greeting}, <em>{name}</em>
        </h1>
        <p className="dx-hero__sub">{summary}</p>
        <div className="dx-hero__meta">
          <span className="dx-pill">{roleLabel}</span>
          {zone && <span className="dx-pill">{zone}</span>}
          <span className="dx-pill font-mono">{dateLabel}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:items-end">
        <div className="dx-hero__stats">
          {stats.map((s) => (
            <div key={s.label} className="dx-hstat" data-tone={s.tone}>
              <div className="dx-hstat__v">{s.value}</div>
              <div className="dx-hstat__l">{s.label}</div>
            </div>
          ))}
        </div>
        <Link href={ctaHref} className="dx-cta self-start lg:self-end">
          {ctaLabel} <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  </section>
);

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

export const KpiTile: React.FC<KpiProps> = ({ label, value, sub, href, icon, tone = 'teal', chip, progress }) => {
  const mounted = useMounted(220);
  return (
    <Link href={href} className="block h-full">
      <div className="dx-kpi" data-tone={tone}>
        <div className="dx-kpi__top">
          <span className="dx-kpi__label line-clamp-2">{label}</span>
          <span className="dx-kpi__icon">{icon}</span>
        </div>
        <div>
          <CountUp as="div" className="dx-kpi__val">
            {String(value)}
          </CountUp>
          <span className="dx-kpi__foot">
            <span className="truncate">{sub}</span>
            {chip && <span className="dx-kpi__chip">{chip}</span>}
          </span>
        </div>
        {typeof progress === 'number' && (
          <div className="dx-kpi__bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: mounted ? `${Math.min(100, Math.max(0, progress))}%` : '0%' }} />
          </div>
        )}
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
  tone?: Tone;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ title, icon, href, hrefLabel = 'View all', tone = 'teal', className = '', style, children }) => (
  <section className={`dx-panel dx-rise ${className}`} data-tone={tone} style={style}>
    <header className="dx-panel__head">
      <div className="dx-panel__title">
        {icon && <span className="dx-panel__icon">{icon}</span>}
        <h2 className="dx-panel__h">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="dx-link">
          {hrefLabel} <ChevronRight size={12} />
        </Link>
      )}
    </header>
    <div className="dx-panel__body">{children}</div>
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
  critical: { Icon: Flame, tone: 'red' as Tone, label: 'Critical' },
  warning: { Icon: AlertTriangle, tone: 'ochre' as Tone, label: 'Warning' },
  info: { Icon: Info, tone: 'teal' as Tone, label: 'Info' },
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

type AttentionFilter = 'all' | AttentionItem['severity'];

export const AttentionList: React.FC<{ items: AttentionItem[] }> = ({ items }) => {
  const [filter, setFilter] = useState<AttentionFilter>('all');

  if (items.length === 0) {
    return (
      <div className="dx-empty">
        <span className="dx-empty__ic">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="font-serif text-[15px] font-bold text-[color:var(--th-ink)]">Nothing is waiting on you</p>
        <p className="max-w-xs text-xs text-[color:var(--th-mute)]">Deadlines, blocked work and approvals that need action will appear here.</p>
      </div>
    );
  }

  const count = (s: AttentionFilter) => (s === 'all' ? items.length : items.filter((i) => i.severity === s).length);
  const tabs = (['all', 'critical', 'warning', 'info'] as const).filter((t) => t === 'all' || count(t) > 0);
  const shown = filter === 'all' ? items : items.filter((i) => i.severity === filter);

  return (
    <>
      <div className="dx-tabs" role="tablist" aria-label="Filter alerts by severity">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={filter === t} className="dx-tab" onClick={() => setFilter(t)}>
            {t === 'all' ? 'All' : SEV[t].label} <b>{count(t)}</b>
          </button>
        ))}
      </div>
      <ul className="dx-attn">
        {shown.map((it, i) => {
          const { Icon, tone } = SEV[it.severity];
          return (
            <li key={it.id} className="dx-slide" style={{ animationDelay: `${i * 40}ms` }} data-tone={tone}>
              <Link href={it.href} className="dx-attn__row">
                <span className="dx-attn__ic">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="dx-attn__t">{it.title}</span>
                  {it.detail && <span className="dx-attn__d">{it.detail}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  {it.right}
                  {it.when && <span className="dx-attn__when">{it.when}</span>}
                </span>
                <ArrowUpRight size={15} className="dx-attn__go hidden shrink-0 sm:block" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
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
  const gid = useId().replace(/:/g, '');
  const R = 40;
  const C = 2 * Math.PI * R;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const [from, to] = GRAD_STOPS[tone];
  return (
    <div className="dx-ring">
      <div className="dx-ring__svg">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={from} />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="9" style={{ stroke: 'var(--th-line)' }} />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={mounted ? C * (1 - pct) : C}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <div className="dx-ring__val">{display ?? `${Math.round(pct * 100)}%`}</div>
      </div>
      <div className="dx-ring__l">{label}</div>
      {sub && <div className="dx-ring__s">{sub}</div>}
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
      {title && (
        <div className="dx-stack__title">
          {title}
          <span>{total} total</span>
        </div>
      )}
      <div className="dx-stack__bar">
        {segments.map((s) => (
          <div
            key={s.label}
            className="dx-stack__seg"
            data-tone={s.tone}
            style={{ width: mounted && total ? `${(s.value / total) * 100}%` : '0%' }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <ul className="dx-stack__legend">
        {segments.map((s) => (
          <li key={s.label} className="dx-stack__li" data-tone={s.tone}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="dx-stack__dot" />
              <span className="truncate">{s.label}</span>
            </span>
            <span>
              <b>{s.value}</b>
              <i>{total ? Math.round((s.value / total) * 100) : 0}%</i>
            </span>
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
const ACTION_TONES: Tone[] = ['teal', 'red', 'ink', 'ochre'];
export const QuickActions: React.FC<{ actions: QuickAction[] }> = ({ actions }) => (
  <div className="dx-qa">
    {actions.map((a, i) => (
      <Link key={a.label} href={a.href} className="dx-qa__row dx-slide" data-tone={ACTION_TONES[i % ACTION_TONES.length]} style={{ animationDelay: `${i * 55}ms` }}>
        <span className="dx-qa__ic">{a.icon}</span>
        <span className="min-w-0">
          <span className="dx-qa__t">{a.label}</span>
          <span className="dx-qa__d">{a.hint}</span>
        </span>
        <ChevronRight size={16} className="dx-qa__go" />
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
  if (items.length === 0) return <p className="dx-none">{empty}</p>;
  return (
    <ol className="dx-tl">
      {items.map((it, i) => {
        const body = (
          <>
            <span className="dx-tl__dot" />
            <span className="min-w-0 flex-1">
              <span className="dx-tl__t">{it.title}</span>
              {it.detail && <span className="dx-tl__d">{it.detail}</span>}
            </span>
            {it.when && <span className="dx-tl__when">{it.when}</span>}
          </>
        );
        return (
          <li key={it.id} className="dx-slide" data-tone={it.tone} style={{ animationDelay: `${i * 50}ms` }}>
            {it.href ? (
              <Link href={it.href} className="dx-tl__row">
                {body}
              </Link>
            ) : (
              <div className="dx-tl__row">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
};
