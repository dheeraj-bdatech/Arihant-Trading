'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Badge,
  Select,
  EmptyState,
} from '@/components/ui';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Building2,
  Filter,
  RefreshCw,
  ExternalLink,
  Flame,
  Users,
  Eye,
} from 'lucide-react';
import { api } from '@/lib/api';
import { istToday, istDateOf, toIstLocalInput } from '@/lib/ist-date';

/** IST calendar day (YYYY-MM-DD) of an event value (instant or bare date). */
const eventIstDay = (value: string | Date): string | null => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : istDateOf(d);
};

/** The IST month containing today, as { year, month (0-based) } — the calendar opens on India's current month. */
const istCurrentMonth = () => {
  const t = istToday();
  return { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) - 1 };
};

interface TenderCalendarViewProps {
  currentUser: any;
  onOpenDossier: (tenderId: string) => void;
}

export function TenderCalendarView({
  currentUser,
  onOpenDossier,
}: TenderCalendarViewProps) {
  // Month shown, in IST (the browser/server clocks may be in another zone or 5h30 behind India).
  const [shownMonth, setShownMonth] = useState(istCurrentMonth);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'agenda'>('grid');

  const loadEvents = async () => {
    try {
      setLoading(true);
      const res = await api.get('/tenders/calendar');
      setEvents(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load tender calendar events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  // Compute Month Boundaries
  const { year, month } = shownMonth;
  // Pure calendar arithmetic in UTC so the grid never depends on the browser's timezone.
  const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0));

  // Day of week: 0=Sun, 1=Mon, ..., 6=Sat. Convert to Mon-first: Mon=0, ..., Sun=6
  const startingDayIndex = (firstDayOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = lastDayOfMonth.getUTCDate();
  const todayIst = istToday();

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setShownMonth({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  };
  const prevMonth = () => shiftMonth(-1);
  const nextMonth = () => shiftMonth(1);
  const setToday = () => setShownMonth(istCurrentMonth());

  // Filter events
  const filteredEvents = useMemo(() => {
    if (selectedType === 'all') return events;
    return events.filter((e) => e.event_type === selectedType);
  }, [events, selectedType]);

  // Group events by YYYY-MM-DD
  const eventsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const ev of filteredEvents) {
      if (!ev.date && !ev.event_date) continue;
      const key = eventIstDay(ev.date || ev.event_date);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [filteredEvents]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const getEventBadge = (type: string) => {
    switch (type) {
      case 'submission_deadline':
        return {
          bg: 'bg-[#9A3412]/10 text-[#9A3412] border border-[#9A3412]/20',
          dot: 'bg-[#9A3412]',
          label: 'Submission',
        };
      case 'pre_bid_meeting':
        return {
          bg: 'bg-[#0F5E63]/10 text-[#0F5E63] border border-[#0F5E63]/20',
          dot: 'bg-[#0F5E63]',
          label: 'Pre-Bid',
        };
      case 'query_deadline':
        return {
          bg: 'bg-[#FFF8EB] text-[#7C2D12] border border-[#E9C9B4]',
          dot: 'bg-[#9A3412]',
          label: 'Query Due',
        };
      case 'technical_opening':
      case 'commercial_opening':
        return {
          bg: 'bg-[#14213D]/10 text-[#14213D] border border-[#14213D]/20',
          dot: 'bg-[#14213D]',
          label: type === 'technical_opening' ? 'Tech Open' : 'Comm Open',
        };
      default:
        return {
          bg: 'bg-[#ECE9E2] text-[#14213D] border border-[#DCD8CE]',
          dot: 'bg-[#6B7280]',
          label: 'Event',
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Calendar Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#E3EFEE] text-[#0F5E63]">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-serif font-bold text-[#14213D]">
              {monthNames[month]} {year}
            </h2>
            <p className="text-xs text-[#4A5568]">
              Central tender schedule of submission deadlines, pre-bid conferences, and opening sessions.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-[#FBFAF7] p-1 rounded-lg border border-[#DCD8CE]">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white text-[#0F5E63] shadow-sm'
                  : 'text-[#4A5568] hover:text-[#14213D]'
              }`}
            >
              Month Grid
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === 'agenda'
                  ? 'bg-white text-[#0F5E63] shadow-sm'
                  : 'text-[#4A5568] hover:text-[#14213D]'
              }`}
            >
              Agenda
            </button>
          </div>

          {/* Event Filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            aria-label="Filter events by milestone type"
            className="text-xs rounded-lg border border-[#C9C4B8] bg-white px-2.5 py-1.5 text-[#14213D] focus:border-[#0F5E63]"
          >
            <option value="all">All Milestones</option>
            <option value="submission_deadline">Submission Deadlines</option>
            <option value="pre_bid_meeting">Pre-Bid Conferences</option>
            <option value="query_deadline">Query Deadlines</option>
            <option value="technical_opening">Technical Openings</option>
            <option value="commercial_opening">Commercial Openings</option>
          </select>

          {/* Month Navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              onClick={prevMonth}
              aria-label="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="xs" onClick={setToday}>
              Today
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={nextMonth}
              aria-label="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-[14px] bg-[#FBFAF7] border border-[#ECE9E2] text-xs">
        <span className="font-semibold text-[#14213D]">Legend:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#9A3412]" />
          <span className="text-[#4A5568]">Submission Deadline</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#0F5E63]" />
          <span className="text-[#4A5568]">Pre-Bid Conference</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#9A3412]" />
          <span className="text-[#4A5568]">Query Deadline</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#14213D]" />
          <span className="text-[#4A5568]">Bid Opening</span>
        </div>
      </div>

      {/* View: Month Grid */}
      {viewMode === 'grid' && (
        <Card className="p-0 overflow-hidden bg-white border-[#DCD8CE]">
          {/* Days of Week Header */}
          <div className="grid grid-cols-7 border-b border-[#DCD8CE] bg-[#FBFAF7] text-center text-xs font-bold text-[#4A5568] py-2.5">
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div className="text-[#9A3412]">Sat</div>
            <div className="text-[#9A3412]">Sun</div>
          </div>

          {/* Calendar Day Cells */}
          <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#ECE9E2]">
            {/* Empty offset days */}
            {Array.from({ length: startingDayIndex }).map((_, idx) => (
              <div
                key={`empty-${idx}`}
                className="min-h-[110px] bg-[#F6F5F1]/40 p-2 text-[#C9C4B8]"
              />
            ))}

            {/* Days of Month */}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayEvents = eventsByDate.get(dateStr) || [];
              const isToday = todayIst === dateStr;

              return (
                <div
                  key={`day-${day}`}
                  className={`min-h-[110px] p-2 flex flex-col justify-between transition-colors ${
                    isToday ? 'bg-[#E3EFEE]/30 font-semibold' : 'bg-white hover:bg-[#FBFAF7]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-md ${
                        isToday
                          ? 'bg-[#0F5E63] text-white font-mono'
                          : 'text-[#14213D] font-mono'
                      }`}
                    >
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-[#4A5568] font-mono font-medium">
                        {dayEvents.length} event{dayEvents.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Day Events Stack */}
                  <div className="space-y-1 mt-1.5 flex-1 overflow-y-auto max-h-[85px]">
                    {dayEvents.map((ev, evIdx) => {
                      const badgeInfo = getEventBadge(ev.event_type);
                      return (
                        <div
                          key={evIdx}
                          onClick={() => ev.tender_id && onOpenDossier(ev.tender_id)}
                          className={`cursor-pointer text-[10px] px-1.5 py-1 rounded flex items-center gap-1.5 leading-tight truncate hover:opacity-85 ${badgeInfo.bg}`}
                          title={`${badgeInfo.label}: ${ev.title}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 shrink-0 rounded-full ${badgeInfo.dot}`}
                          />
                          <span className="truncate">{ev.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* View: Agenda / Chronological List */}
      {viewMode === 'agenda' && (
        <div className="space-y-3">
          {filteredEvents.length === 0 ? (
            <Card className="p-8 text-center text-xs text-[#4A5568]">
              No scheduled events found for this filter.
            </Card>
          ) : (
            filteredEvents
              .sort(
                (a, b) =>
                  new Date(a.date || a.event_date).getTime() -
                  new Date(b.date || b.event_date).getTime(),
              )
              .map((ev, idx) => {
                const badgeInfo = getEventBadge(ev.event_type);
                const evDay = eventIstDay(ev.date || ev.event_date) || '';
                const evTime = toIstLocalInput(ev.date || ev.event_date).slice(11, 16);
                return (
                  <Card
                    key={idx}
                    className="p-3.5 flex items-center justify-between hover:border-[#0F5E63] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-center px-3 py-1.5 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg">
                        <span className="block text-[10px] uppercase font-bold text-[#4A5568]">
                          {evDay ? monthNames[Number(evDay.slice(5, 7)) - 1].slice(0, 3) : ''}
                        </span>
                        <span className="block text-base font-bold font-mono text-[#14213D]">
                          {evDay ? Number(evDay.slice(8, 10)) : ''}
                        </span>
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badgeInfo.bg}`}
                          >
                            {badgeInfo.label}
                          </span>
                          <span className="text-xs font-mono text-[#4A5568]">
                            {evTime ? `${evTime} IST` : ''}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-[#14213D]">
                          {ev.title}
                        </h4>
                      </div>
                    </div>

                    {ev.tender_id && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => onOpenDossier(ev.tender_id)}
                        rightIcon={<ExternalLink className="w-3.5 h-3.5" />}
                      >
                        View Tender
                      </Button>
                    )}
                  </Card>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}
