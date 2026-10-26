'use client';

/**
 * Week schedule of demos for the demo team: Monday–Sunday columns (IST), each demo on the day it is confirmed for
 * (or requested for, until confirmed), plus how many demos each team member carries that week.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';

type Tone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

export interface DemoCalendarProps {
  demos: any[];
  onOpen: (demo: any) => void;
  statusLabel: (status?: string) => string;
  statusTone: (status?: string) => Tone;
}

const TONE: Record<Tone, string> = {
  success: 'bg-[#E3EFEE] text-[#0F5E63] border-[#D0E5E3]',
  info: 'bg-[#E3EFEE] text-[#0F5E63] border-[#D0E5E3]',
  warning: 'bg-[#FBEBDD] text-[#9A3412] border-[#E9C9B4]',
  danger: 'bg-[#FCE8EC] text-[#881337] border-[#F3C7CF]',
  neutral: 'bg-[#ECE9E2] text-[#4A5568] border-[#DCD8CE]',
};

/** Earlier in the list = needs the team sooner. */
const STATUS_ORDER = ['requested', 'under_planning', 'team_assigned', 'equipment_reserved', 'confirmed', 'rescheduled', 'completed'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
};
/** Monday of the week holding `iso` (dates are plain YYYY-MM-DD, so UTC maths gives the right weekday). */
const mondayOf = (iso: string) => {
  const { y, m, d } = parts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addIsoDays(iso, -((dow + 6) % 7));
};
const dayMonth = (iso: string) => {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
};
const demoDay = (demo: any) => calendarDay(demo.confirmed_date || demo.requested_date);
const rank = (status?: string) => {
  const i = STATUS_ORDER.indexOf(String(status || ''));
  return i === -1 ? STATUS_ORDER.length : i;
};

export const DemoCalendar: React.FC<DemoCalendarProps> = ({ demos, onOpen, statusLabel, statusTone }) => {
  const today = istToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  // Seven columns only when the calendar itself is wide enough to read them (the page may sit beside the
  // sidebar or inside a dialog), otherwise the days stack.
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 840));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addIsoDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];

  const live = useMemo(() => demos.filter((d) => d.status !== 'cancelled' && demoDay(d)), [demos]);
  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const day of days) map[day] = [];
    for (const d of live) {
      const day = demoDay(d);
      if (map[day]) map[day].push(d);
    }
    for (const day of days) {
      map[day].sort((a, b) => rank(a.status) - rank(b.status) || String(a.organisation_name || '').localeCompare(String(b.organisation_name || '')));
    }
    return map;
  }, [live, days]);

  const weekDemos = days.flatMap((d) => byDay[d]);
  const load = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of weekDemos) {
      if (d.status === 'completed') continue;
      const name = d.assignee_name || 'Unassigned';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [weekDemos]);

  const nextDemoDay = useMemo(
    () =>
      live
        .map(demoDay)
        .filter((day) => day > weekEnd && day >= today)
        .sort()[0],
    [live, weekEnd, today],
  );

  const { y: y1 } = parts(weekStart);
  const { y: y2 } = parts(weekEnd);
  const range = `${dayMonth(weekStart)}${y1 !== y2 ? ` ${y1}` : ''} – ${dayMonth(weekEnd)} ${y2}`;

  const card = (demo: any) => {
    const muted = demo.status === 'completed';
    const tone = statusTone(demo.status);
    const chips: { label: string; tone: Tone }[] = [];
    if (demo.travel_required) chips.push({ label: 'Travel', tone: 'neutral' });
    if (demo.service_escort_required) chips.push({ label: 'Service escort', tone: 'neutral' });
    if ((demo.reservations || []).some((r: any) => r.status === 'requested')) chips.push({ label: 'Kit approval pending', tone: 'warning' });
    if (demo.task_approval === 'required') chips.push({ label: 'Task approval', tone: 'neutral' });
    if (demo.task_approval === 'pending') chips.push({ label: 'Approval pending', tone: 'warning' });
    const place = demo.location || demo.city;
    return (
      <button
        key={demo.id}
        type="button"
        onClick={() => onOpen(demo)}
        className={twMerge(
          'w-full min-w-0 rounded-[10px] border border-[#DCD8CE] bg-white p-2 text-left transition-colors hover:border-[#0F5E63] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30',
          muted && 'opacity-60',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-mono text-[10px] font-semibold text-[#0F5E63]">{demo.demo_no}</span>
          <span className={twMerge('shrink-0 truncate rounded-full border px-1.5 py-px text-[9px] font-semibold', TONE[tone])}>{statusLabel(demo.status)}</span>
        </div>
        <div className="mt-1 truncate text-xs font-semibold text-[#14213D]" title={demo.organisation_name}>
          {demo.organisation_name || 'Customer'}
        </div>
        {demo.product_name && (
          <div className="truncate text-[11px] text-[#4A5568]" title={demo.product_name}>
            {demo.product_name}
          </div>
        )}
        {place && <div className="truncate text-[11px] text-[#6B7280]">{place}</div>}
        <div className={twMerge('mt-1 truncate text-[11px] font-medium', demo.assignee_name ? 'text-[#14213D]' : 'text-[#9A3412]')}>
          {demo.assignee_name || 'Unassigned'}
        </div>
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c.label} className={twMerge('max-w-full truncate rounded-full border px-1.5 py-px text-[9px] font-semibold', TONE[c.tone])}>
                {c.label}
              </span>
            ))}
          </div>
        )}
      </button>
    );
  };

  const dayHeader = (day: string, i: number) => (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#4A5568]">{WEEKDAYS[i]}</span>
      <span className="font-mono text-[11px] text-[#14213D]">{dayMonth(day)}</span>
      <span className="font-mono text-[10px] text-[#6B7280]">{byDay[day].length || ''}</span>
    </div>
  );

  return (
    <div ref={rootRef} className="space-y-3">
      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-base font-semibold text-[#14213D]">{range}</h3>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="xs" variant="secondary" leftIcon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => setWeekStart(addIsoDays(weekStart, -7))}>
            Prev week
          </Button>
          <Button type="button" size="xs" variant={weekStart === mondayOf(today) ? 'primary' : 'secondary'} onClick={() => setWeekStart(mondayOf(today))}>
            This week
          </Button>
          <Button type="button" size="xs" variant="secondary" rightIcon={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => setWeekStart(addIsoDays(weekStart, 7))}>
            Next week
          </Button>
        </div>
      </div>

      {/* Who carries what this week */}
      {load.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-[#4A5568]">Team this week:</span>
          {load.map(([name, n]) => (
            <span
              key={name}
              className={twMerge(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold',
                name === 'Unassigned' ? TONE.warning : 'border-[#DCD8CE] bg-[#FBFAF7] text-[#14213D]',
              )}
            >
              {name}
              <span className="font-mono text-[10px] text-[#4A5568]">{n}</span>
            </span>
          ))}
        </div>
      )}

      {weekDemos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[#DCD8CE] bg-[#FBFAF7] px-4 py-8 text-center">
          <p className="text-xs font-medium text-[#4A5568]">No demos scheduled this week</p>
          {nextDemoDay && (
            <Button type="button" size="xs" variant="secondary" onClick={() => setWeekStart(mondayOf(nextDemoDay))}>
              Jump to next demo
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* wide: seven columns, no sideways scrolling */}
          {wide ? (
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, i) => (
              <div
                key={day}
                className={twMerge(
                  'flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-[#ECE9E2] bg-[#FBFAF7] p-2',
                  day === today && 'border-[#D0E5E3] bg-[#E3EFEE]',
                )}
              >
                {dayHeader(day, i)}
                {byDay[day].length ? byDay[day].map(card) : <span className="py-2 text-center text-xs text-[#C9C4B8]">—</span>}
              </div>
            ))}
          </div>
          ) : (
          // narrow: days with demos, one under another
          <div className="space-y-2">
            {days.map((day, i) =>
              byDay[day].length ? (
                <div key={day} className={twMerge('space-y-1.5 rounded-[14px] border border-[#ECE9E2] bg-[#FBFAF7] p-2', day === today && 'border-[#D0E5E3] bg-[#E3EFEE]')}>
                  {dayHeader(day, i)}
                  {byDay[day].map(card)}
                </div>
              ) : null,
            )}
          </div>
          )}
        </>
      )}
    </div>
  );
};
