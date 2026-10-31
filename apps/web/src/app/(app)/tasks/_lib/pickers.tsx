'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import type { AssigneeOption, LinkOption } from './task-lib';

export interface UserLite {
  id: string;
  full_name: string;
  role: string;
  is_active?: boolean;
}

/** Active users for dependency / escalation pickers. */
export function useActiveUsers(exclude: (string | null | undefined)[] = []) {
  const [users, setUsers] = useState<UserLite[]>([]);
  const key = exclude.join(',');
  useEffect(() => {
    api
      .get('/users', { limit: 100, is_active: 'true' })
      .then((r: any) => setUsers(((r?.data || r || []) as UserLite[]).filter((u) => u.is_active !== false && !exclude.includes(u.id))))
      .catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return users;
}

export const UserSelect: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  users: { id: string; full_name: string; role?: string }[];
  placeholder?: string;
  error?: string;
  helperText?: string;
}> = ({ label, value, onChange, users, placeholder = 'Choose…', error, helperText }) => (
  <Select
    label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    error={error}
    helperText={helperText}
    options={[{ value: '', label: placeholder }, ...users.map((u) => ({ value: u.id, label: `${u.full_name}${u.role ? ` (${u.role.replace(/_/g, ' ')})` : ''}` }))]}
  />
);

/**
 * Keys for a picker's search box, which keeps focus while ArrowDown / ArrowUp move the highlighted option
 * (wrapping) and Enter picks it. Enter never submits the enclosing form.
 */
function listboxKeys(e: React.KeyboardEvent, count: number, active: number, setActive: (i: number) => void, pick: (i: number) => void) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!count) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    setActive(active < 0 || active >= count ? (step > 0 ? 0 : count - 1) : (active + step + count) % count);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (active >= 0 && active < count) pick(active);
  }
}

/** Multi-select of employees in the creator's scope; peers are shown only for linked work. */
export const AssigneePicker: React.FC<{
  value: string[];
  onChange: (v: string[]) => void;
  options: AssigneeOption[];
  allowPeers: boolean;
  error?: string;
}> = ({ value, onChange, options, allowPeers, error }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlId = useId();
  const listId = `${controlId}-list`;
  const optionId = (id: string) => `${controlId}-opt-${id}`;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // closes only this picker, not an enclosing Modal
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const visible = options.filter((o) => (allowPeers || o.scope !== 'peer') && o.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const groups: [string, AssigneeOption[]][] = [
    ['You', visible.filter((o) => o.scope === 'self')],
    ['Your team', visible.filter((o) => o.scope === 'team' || o.scope === 'all')],
    ['Colleagues (linked work only)', visible.filter((o) => o.scope === 'peer')],
  ];
  const flat = groups.flatMap(([, rows]) => rows);
  const activeId = flat[active]?.id;
  useEffect(() => {
    if (activeId) document.getElementById(optionId(activeId))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  return (
    <div ref={ref} className="relative w-full">
      <label htmlFor={controlId} className="block text-xs font-semibold text-[#14213D] mb-1.5">Assignee(s) *</label>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setActive(-1);
        }}
        className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[8px] border bg-white px-2.5 py-1.5 text-left text-xs focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15 ${error ? 'border-[#881337]' : 'border-[#C9C4B8] focus:border-[#0F5E63]'}`}
      >
        {selected.length === 0 && <span className="text-[#6B7280] px-1">Choose one or more people…</span>}
        {selected.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-[#E3EFEE] px-2 py-0.5 text-[11px] font-semibold text-[#0F5E63]">
            {s.full_name}
            {s.on_leave && <span title="On approved leave" className="text-[#9A3412]">•</span>}
            <span
              role="button"
              tabIndex={0}
              aria-label={`Remove ${s.full_name}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(s.id);
              }}
              onKeyDown={(e) => e.key === 'Enter' && toggle(s.id)}
              className="-m-1 p-1"
            >
              <X className="h-3 w-3" />
            </span>
          </span>
        ))}
        <ChevronDown className="ml-auto h-4 w-4 text-[#6B7280]" />
      </button>
      {error && <p className="text-xs text-[#881337] mt-1">{error}</p>}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-[10px] border border-[#DCD8CE] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#ECE9E2] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[#6B7280]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => listboxKeys(e, flat.length, active, setActive, (i) => toggle(flat[i].id))}
              placeholder="Search people…"
              className="w-full text-xs outline-none"
              aria-label="Search people"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId ? optionId(activeId) : undefined}
            />
          </div>
          <div id={listId} role="listbox" aria-multiselectable aria-label="Assignees" className="max-h-72 overflow-y-auto py-1">
            {visible.length === 0 && <p className="px-3 py-2 text-xs text-[#6B7280]">{allowPeers ? 'No matches' : 'No matches in your team. Link the task to a customer, tender, demo or service ticket to request work from colleagues.'}</p>}
            {groups.map(([title, rows]) =>
              rows.length ? (
                <div key={title} role="group" aria-label={title}>
                  <div aria-hidden className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">{title}</div>
                  {rows.map((o) => {
                    const on = value.includes(o.id);
                    const i = flat.indexOf(o);
                    return (
                      <button
                        key={o.id}
                        id={optionId(o.id)}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggle(o.id)}
                        onMouseEnter={() => setActive(i)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${i === active ? 'bg-[#F6F5F1]' : 'hover:bg-[#FBFAF7]'} ${on ? 'text-[#0F5E63] font-semibold' : 'text-[#14213D]'}`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-[#0F5E63] bg-[#0F5E63] text-white' : 'border-[#C9C4B8]'}`}>{on && <Check className="h-3 w-3" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{o.full_name}</span>
                          <span className="block truncate text-[10px] font-normal text-[#6B7280]">{[o.role.replace(/_/g, ' '), o.department_name].filter(Boolean).join(' · ')}</span>
                        </span>
                        {o.on_leave && <span className="shrink-0 rounded-full bg-[#FBEBDD] px-1.5 py-0.5 text-[10px] font-semibold text-[#7C2D12]">On leave</span>}
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const LINK_LABEL: Record<string, string> = { customer: 'Customer', tender: 'Tender', demo: 'Demo', service: 'Service ticket', project: 'Project' };

/** Search-as-you-type picker for customers / open tenders / demos / service tickets / projects. */
export const LinkPicker: React.FC<{
  type: 'customer' | 'tender' | 'demo' | 'service' | 'project';
  value: string;
  onChange: (id: string, option: LinkOption | null) => void;
  required?: boolean;
  error?: string;
  helperText?: string;
}> = ({ type, value, onChange, required, error, helperText }) => {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<LinkOption[]>([]);
  const [selected, setSelected] = useState<LinkOption | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlId = useId();
  const listId = `${controlId}-list`;
  const optionId = (i: number) => `${controlId}-opt-${i}`;
  useEffect(() => {
    if (value && (!selected || selected.id !== value)) {
      api.get<LinkOption[]>('/tasks/lookups/links', { type, id: value }).then((r) => setSelected(r[0] || null)).catch(() => undefined);
    }
    if (!value) setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, type]);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      api
        .get<LinkOption[]>('/tasks/lookups/links', { type, search: q })
        .then((r) => {
          setOptions(r);
          setActive(q.trim() && r.length ? 0 : -1); // typing highlights the best match once the results are in
        })
        .catch(() => setOptions([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open, type]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // closes only this picker, not an enclosing Modal
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const pick = (o: LinkOption) => {
    setSelected(o);
    onChange(o.id, o);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const label = `${LINK_LABEL[type]}${required ? ' *' : ''}`;
  return (
    <div ref={ref} className="relative w-full">
      <label htmlFor={controlId} className="block text-xs font-semibold text-[#14213D] mb-1.5">{label}</label>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setActive(-1);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-10 w-full items-center gap-2 rounded-[8px] border bg-white px-3 text-left text-xs focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15 ${error ? 'border-[#881337]' : 'border-[#C9C4B8] focus:border-[#0F5E63]'}`}
      >
        <span className={`flex-1 truncate ${selected ? 'text-[#14213D]' : 'text-[#6B7280]'}`}>{selected ? `${selected.label}${selected.sub ? ` · ${selected.sub}` : ''}` : `Search ${LINK_LABEL[type].toLowerCase()}…`}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${LINK_LABEL[type]}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange('', null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && onChange('', null)}
            className="-m-1.5 p-1.5 text-[#6B7280] hover:text-[#881337]"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-[#6B7280]" />
      </button>
      {error ? <p className="text-xs text-[#881337] mt-1">{error}</p> : helperText ? <p className="text-[11px] text-[#4A5568] mt-1">{helperText}</p> : null}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-[10px] border border-[#DCD8CE] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#ECE9E2] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[#6B7280]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(-1); // the list is stale until the new results arrive
              }}
              onKeyDown={(e) => listboxKeys(e, options.length, active, setActive, (i) => pick(options[i]))}
              placeholder="Type to search…"
              className="w-full text-xs outline-none"
              aria-label={`Search ${LINK_LABEL[type]}`}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 && active < options.length ? optionId(active) : undefined}
            />
          </div>
          <ul id={listId} role="listbox" aria-label={LINK_LABEL[type]} className="max-h-64 overflow-y-auto py-1">
            {options.length === 0 && <li className="px-3 py-2 text-xs text-[#6B7280]">No open {LINK_LABEL[type].toLowerCase()} matches</li>}
            {options.map((o, i) => (
              <li key={o.id} role="none">
                <button
                  id={optionId(i)}
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full px-3 py-2 text-left ${i === active ? 'bg-[#F6F5F1]' : 'hover:bg-[#FBFAF7]'}`}
                >
                  <span className="block text-xs font-semibold text-[#14213D] truncate">{o.label}</span>
                  {o.sub && <span className="block text-[11px] text-[#4A5568] truncate">{o.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/** Date + optional time (IST). Emits 'YYYY-MM-DD' (= 23:59:59 IST) or 'YYYY-MM-DDTHH:mm'. */
export const DeadlineInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; min?: string; error?: string; helperText?: string; required?: boolean }> = ({
  label,
  value,
  onChange,
  min,
  error,
  helperText,
  required,
}) => {
  const [date, time] = useMemo(() => {
    const [d, t] = (value || '').split('T');
    return [d || '', t || ''];
  }, [value]);
  const emit = (d: string, t: string) => onChange(d ? (t ? `${d}T${t}` : d) : '');
  return (
    <div>
      {/* both columns may shrink: on phones the 16px field text makes a fixed 120px time box overflow the sheet */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)] gap-2 items-start sm:grid-cols-[1fr_auto]">
        <Input label={`${label}${required ? ' *' : ''}`} type="date" value={date} min={min} onChange={(e) => emit(e.target.value, time)} error={error} />
        <Input label="Time (optional)" type="time" value={time} onChange={(e) => emit(date, e.target.value)} className="w-full min-w-0 sm:w-[120px]" aria-label={`${label} time`} />
      </div>
      <p className="text-[11px] text-[#4A5568] mt-1">{helperText || (date && !time ? 'Without a time the deadline is 11:59 PM IST that day.' : 'Times are IST.')}</p>
    </div>
  );
};
