'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export interface FilterMenuOption {
  key: string;
  label: string;
  /** small count shown at the right of the row */
  count?: number | string;
  icon?: React.ReactNode;
  /** whether this option is currently applied */
  active: boolean;
  onSelect: () => void;
  /** highlights the row in terracotta (urgent items) */
  urgent?: boolean;
}

/**
 * One compact button that opens a list of quick filters (alerts, stages, toggles).
 * Replaces long rows of chips: the button itself shows what is active.
 */
export const FilterMenu: React.FC<{
  label: string;
  icon?: React.ReactNode;
  options: FilterMenuOption[];
  /** options flagged as "off / show all" are not counted as an active filter */
  neutralKeys?: string[];
  align?: 'left' | 'right';
  className?: string;
}> = ({ label, icon, options, neutralKeys = ['all'], align = 'left', className }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const applied = options.filter((o) => o.active && !neutralKeys.includes(o.key));
  const urgentTotal = options.reduce((n, o) => (o.urgent && Number(o.count) > 0 ? n + 1 : n), 0);

  return (
    <div ref={ref} className={twMerge('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={twMerge('filter-menu-btn', (open || applied.length > 0) && 'filter-menu-btn--on')}
      >
        {icon && <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        <span>{label}</span>
        {applied.length === 1 ? (
          <span className="filter-menu-chip max-w-[130px] truncate">{applied[0].label}</span>
        ) : applied.length > 1 ? (
          <span className="filter-menu-chip">{applied.length}</span>
        ) : urgentTotal > 0 ? (
          <span className="filter-menu-chip filter-menu-chip--urgent">{urgentTotal}</span>
        ) : null}
        <ChevronDown className={twMerge('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="listbox" className={twMerge('filter-menu-panel', align === 'right' ? 'right-0' : 'left-0')}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={o.active}
              onClick={() => {
                o.onSelect();
                setOpen(false);
              }}
              className={twMerge('filter-menu-row', o.active && 'filter-menu-row--on', o.urgent && Number(o.count) > 0 && 'filter-menu-row--urgent')}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {o.active ? <Check className="h-3.5 w-3.5" /> : o.icon ? <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{o.icon}</span> : null}
              </span>
              <span className="flex-1 truncate text-left">{o.label}</span>
              {o.count !== undefined && <span className="font-mono text-[11px] font-bold">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
