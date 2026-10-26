'use client';

/**
 * Field visits on a month calendar: past and upcoming visits as coloured chips on their day (done, upcoming,
 * report overdue, cancelled). Picking a day lists that day's visits with their details; picking a visit opens it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { Button } from '@/components/ui';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';

export type VisitTone = 'done' | 'upcoming' | 'overdue' | 'cancelled';

const TONE: Record<VisitTone, { chip: string; dot: string; label: string }> = {
  done: { chip: 'border-[#D0E5E3] bg-[#E3EFEE] text-[#0B4A4E]', dot: 'bg-[#0F5E63]', label: 'Done' },
  upcoming: { chip: 'border-[#C9C4B8] bg-white text-[#14213D]', dot: 'bg-[#14213D]', label: 'Upcoming' },
  overdue: { chip: 'border-[#E9C9B4] bg-[#FBEBDD] text-[#7C2D12]', dot: 'bg-[#9A3412]', label: 'Report overdue' },
  cancelled: { chip: 'border-[#DCD8CE] bg-[#ECE9E2] text-[#6B7280] line-through', dot: 'bg-[#C9C4B8]', label: 'Cancelled' },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_FMT = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_FMT = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
const shiftMonth = (iso: string, by: number) => {
  const d = utc(firstOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};

export const VisitCalendar: React.FC<{
  visits: any[];
  toneOf: (v: any) => VisitTone;
  onOpen: (v: any) => void;
}> = ({ visits, toneOf, onOpen }) => {
  const today = istToday();
  const [month, setMonth] = useState(() => firstOfMonth(today));
  const [selected, setSelected] = useState(today);
  // Chips need room: below ~640px of calendar width each day shows coloured dots instead
  const rootRef = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setRoomy(e.contentRect.width >= 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const v of visits) {
      const d = calendarDay(v.planned_date);
      if (!d) continue;
      (map[d] ||= []).push(v);
    }
    for (const list of Object.values(map)) list.sort((a, b) => String(a.start_time || '99').localeCompare(String(b.start_time || '99')));
    return map;
  }, [visits]);

  // Six weeks starting on the Monday on or before the 1st
  const cells = useMemo(() => {
    const offset = (utc(month).getUTCDay() + 6) % 7;
    const start = addIsoDays(month, -offset);
    return Array.from({ length: 42 }, (_, i) => addIsoDays(start, i));
  }, [month]);

  const monthVisits = visits.filter((v) => (calendarDay(v.planned_date) || '').startsWith(month.slice(0, 7)));
  const counts = monthVisits.reduce<Record<VisitTone, number>>((acc, v) => ((acc[toneOf(v)] += 1), acc), { done: 0, upcoming: 0, overdue: 0, cancelled: 0 });
  const dayVisits = byDay[selected] || [];

  const pick = (day: string) => {
    setSelected(day);
    if (!day.startsWith(month.slice(0, 7))) setMonth(firstOfMonth(day));
  };

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-base font-semibold text-[#14213D]">{MONTH_FMT.format(utc(month))}</h3>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="xs" variant="secondary" leftIcon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => setMonth(shiftMonth(month, -1))}>
            Prev
          </Button>
          <Button type="button" size="xs" variant="secondary" onClick={() => pick(today)}>
            Today
          </Button>
          <Button type="button" size="xs" variant="secondary" rightIcon={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => setMonth(shiftMonth(month, 1))}>
            Next
          </Button>
        </div>
      </div>

      {/* Legend doubles as this month's tally */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#4A5568]">
        {(Object.keys(TONE) as VisitTone[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className={twMerge('h-2 w-2 rounded-full', TONE[t].dot)} />
            {TONE[t].label} <span className="font-mono font-semibold text-[#14213D]">{counts[t]}</span>
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[#DCD8CE]">
        <div className="grid grid-cols-7 border-b border-[#ECE9E2] bg-[#FBFAF7]">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]">
              {roomy ? w : w[0]}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const list = byDay[day] || [];
            const inMonth = day.startsWith(month.slice(0, 7));
            const isToday = day === today;
            const isSel = day === selected;
            return (
              <button
                key={day}
                type="button"
                onClick={() => pick(day)}
                aria-pressed={isSel}
                aria-label={`${DAY_FMT.format(utc(day))}: ${list.length} visit${list.length === 1 ? '' : 's'}`}
                className={twMerge(
                  'flex min-h-[64px] min-w-0 flex-col gap-1 border-[#ECE9E2] p-1.5 text-left transition-colors hover:bg-[#FBFAF7] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F5E63]/40',
                  roomy && 'min-h-[92px]',
                  i % 7 !== 6 && 'border-r',
                  i < 35 && 'border-b',
                  !inMonth && 'bg-[#FBFAF7]/60',
                  isSel && 'bg-[#E3EFEE]/60',
                )}
              >
                <span
                  className={twMerge(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px]',
                    isToday ? 'bg-[#0F5E63] font-bold text-white' : inMonth ? 'text-[#14213D]' : 'text-[#C9C4B8]',
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {roomy ? (
                  <>
                    {list.slice(0, 2).map((v) => (
                      <span key={v.id} className={twMerge('truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', TONE[toneOf(v)].chip)}>
                        {v.start_time ? `${String(v.start_time).slice(0, 5)} ` : ''}
                        {v.organisation_name || 'Visit'}
                      </span>
                    ))}
                    {list.length > 2 && <span className="text-[10px] font-semibold text-[#0F5E63]">+{list.length - 2} more</span>}
                  </>
                ) : (
                  list.length > 0 && (
                    <span className="flex flex-wrap gap-0.5">
                      {list.slice(0, 4).map((v) => (
                        <span key={v.id} className={twMerge('h-1.5 w-1.5 rounded-full', TONE[toneOf(v)].dot)} />
                      ))}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* The picked day, with enough detail to know what each visit was or will be */}
      <section className="space-y-2" aria-live="polite">
        <h4 className="font-serif text-sm font-semibold text-[#14213D]">
          {DAY_FMT.format(utc(selected))}
          {selected === today && <span className="ml-1.5 font-sans text-xs font-normal text-[#0F5E63]">(today)</span>}
        </h4>
        {dayVisits.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#DCD8CE] px-3 py-4 text-center text-xs text-[#6B7280]">No visits on this day.</p>
        ) : (
          <ul className="space-y-2">
            {dayVisits.map((v) => {
              const tone = toneOf(v);
              const report = v.updates?.[0];
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(v)}
                    className="flex w-full flex-col gap-1.5 rounded-[12px] border border-[#DCD8CE] bg-white p-3 text-left transition-colors hover:border-[#0F5E63] sm:flex-row sm:items-start sm:gap-4"
                  >
                    <span className="flex shrink-0 items-center gap-1 font-mono text-xs font-semibold text-[#14213D] sm:w-24">
                      <Clock className="h-3.5 w-3.5 text-[#4A5568]" />
                      {v.start_time ? `${String(v.start_time).slice(0, 5)}${v.end_time ? `–${String(v.end_time).slice(0, 5)}` : ''}` : 'All day'}
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#14213D]">{v.organisation_name || 'Visit'}</span>
                        <span className={twMerge('rounded-full border px-2 py-px text-[10px] font-semibold', TONE[tone].chip)}>{TONE[tone].label}</span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[#4A5568]">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{v.location || '—'}</span>
                        {v.assignee_name && <span className="truncate"> · {v.assignee_name}</span>}
                      </span>
                      {tone === 'done' && report ? (
                        <span className="block text-xs text-[#14213D]">
                          <span className="font-semibold text-[#0F5E63]">Outcome: </span>
                          {report.outcome || 'Completed'}
                          {report.person_met ? ` · met ${report.person_met}` : ''}
                        </span>
                      ) : (
                        v.purpose && <span className="line-clamp-1 block text-xs text-[#14213D]">{v.purpose}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
