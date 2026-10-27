'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { twMerge } from 'tailwind-merge';

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** text shown at the end of the row (defaults to the value) */
  display?: string;
  /** optional second line of the hover tooltip */
  detail?: string;
  /** makes the row a link (e.g. drill into the matching list) */
  href?: string;
  /** makes the row a button (e.g. a chart that doubles as a filter); `active` marks the picked row */
  onSelect?: () => void;
  active?: boolean;
}

/**
 * Horizontal bar list — one series of magnitudes (counts per status, per person, per role…). Bars grow from one
 * left baseline in brand teal, square at the baseline and rounded at the data end; the label and value are always
 * printed, so the bar is never the only carrier of the number. Hovering a row shows its tooltip.
 */
export const BarList: React.FC<{
  items: BarListItem[];
  /** what the list measures, for screen readers ("Open tasks by status") */
  label: string;
  /** scale maximum; defaults to the largest value */
  max?: number;
  emptyText?: string;
  /** share of the row the label may take (longer labels, e.g. "Equipment availability changed") */
  labelWidth?: string;
  className?: string;
}> = ({ items, label, max, emptyText = 'Nothing to show for this period.', labelWidth = '40%', className }) => {
  const [hover, setHover] = useState<string | null>(null);
  const top = Math.max(1, max ?? 0, ...items.map((i) => i.value));
  if (!items.length || items.every((i) => !i.value)) return <p className={twMerge('py-4 text-center text-xs text-[#6B7280]', className)}>{emptyText}</p>;
  return (
    <ul aria-label={label} className={twMerge('space-y-0.5', className)}>
      {items.map((i) => {
        const shown = i.display ?? String(i.value);
        const row = (
          <>
            <span className="truncate text-xs text-[#14213D]" title={i.label}>
              {i.label}
            </span>
            <span className="relative flex h-5 items-center" aria-hidden>
              {i.value > 0 && (
                <span
                  className={`block h-2.5 rounded-r-[4px] transition-colors ${hover === i.key ? 'bg-[#0B4A4E]' : 'bg-[#0F5E63]'}`}
                  style={{ width: `max(3px, ${(i.value / top) * 100}%)` }}
                />
              )}
            </span>
            <span className={`text-right font-mono text-xs tabular-nums ${i.value ? 'font-semibold text-[#14213D]' : 'text-[#6B7280]'}`}>{shown}</span>
            {hover === i.key && (
              <span role="tooltip" className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[#DCD8CE] bg-white px-2.5 py-1.5 text-[11px] text-[#14213D] shadow-sm">
                <span className="font-semibold">{i.label}</span> · <span className="font-mono">{shown}</span>
                {i.detail && <span className="block text-[#4A5568]">{i.detail}</span>}
              </span>
            )}
          </>
        );
        const cls = `relative grid w-full items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[#FBFAF7] ${i.active ? 'bg-[#E3EFEE] ring-1 ring-[#0F5E63]/30' : ''}`;
        const style = { gridTemplateColumns: `minmax(0, ${labelWidth}) 1fr auto` };
        const events = { onMouseEnter: () => setHover(i.key), onMouseLeave: () => setHover(null), onFocus: () => setHover(i.key), onBlur: () => setHover(null) };
        return (
          <li key={i.key}>
            {i.onSelect ? (
              <button type="button" onClick={i.onSelect} aria-pressed={Boolean(i.active)} className={`${cls} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/40`} aria-label={`${i.label}: ${shown}`} style={style} {...events}>
                {row}
              </button>
            ) : i.href ? (
              <Link href={i.href} className={`${cls} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/40`} aria-label={`${i.label}: ${shown}`} style={style} {...events}>
                {row}
              </Link>
            ) : (
              <div className={cls} tabIndex={0} aria-label={`${i.label}: ${shown}`} style={style} {...events}>
                {row}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
