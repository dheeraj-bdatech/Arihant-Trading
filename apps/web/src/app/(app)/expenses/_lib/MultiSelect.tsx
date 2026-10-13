'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/** Searchable multi-select styled like the kit's form controls (used by report filters). */
export const MultiSelect: React.FC<{
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}> = ({ label, options, value, onChange, placeholder = 'Any' }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const id = useMemo(() => `ms-${label.toLowerCase().replace(/\W+/g, '-')}`, [label]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={ref} className="relative w-full text-left">
      <label htmlFor={id} className="block text-xs font-semibold text-[#14213D] mb-1.5">{label}</label>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-[8px] border border-[#C9C4B8] bg-white px-3 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
      >
        <span className={`flex-1 truncate text-left ${selectedLabels.length ? '' : 'text-[#8A8578]'}`}>
          {selectedLabels.length === 0 ? placeholder : selectedLabels.length <= 2 ? selectedLabels.join(', ') : `${selectedLabels.length} selected`}
        </span>
        {value.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            onKeyDown={(e) => e.key === 'Enter' && onChange([])}
            className="text-[#8A8578] hover:text-[#881337]"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-[#8A8578]" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] rounded-[10px] border border-[#DCD8CE] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#ECE9E2] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[#8A8578]" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full text-xs outline-none" />
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-[#8A8578]">No matches</li>}
            {filtered.map((o) => {
              const on = value.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.value)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#FBFAF7] ${on ? 'text-[#0F5E63] font-semibold' : 'text-[#14213D]'}`}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-[#0F5E63] bg-[#0F5E63] text-white' : 'border-[#C9C4B8]'}`}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
