'use client';

/**
 * Module 10 — Management Command dashboard (Blueprint §45). One screen for management across every module: what
 * needs action first, then each section's figures. A figure's tab says in one line what it counts and lists the
 * records behind it with their status, loaded as the card scrolls. Each manager picks the results period on the board itself (it applies to every card at once) and the
 * sections, figures and order under Customise — both saved to their account so the phone and the desk show the same
 * board.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  FileSpreadsheet,
  FileText,
  MapPin,
  Receipt,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Users,
  Wrench,
} from 'lucide-react';
import {
  COMMAND_PERIODS,
  COMMAND_SECTIONS,
  type CommandDashboardDto,
  type CommandItemDef,
  type CommandLayout,
  type CommandListItem,
  type CommandMetric,
  type CommandPeriod,
  type CommandRecordsDto,
  type CommandSection,
  type CommandSectionKey,
  type CommandTone,
} from '@arihant/shared';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { Button, ButtonGroup, Checkbox, IconButton, InfoCallout, Modal, PageContainer, PageLoader, ScrollStrip, Spinner } from '@/components/ui';
import { DeadlineChip } from '@/components/tender/Countdown';
import { AttentionList, HeroBanner, ItemList, Panel, type AttentionItem, type DeckItem, type Tone } from './CommandDeck';

const ICONS: Record<CommandSectionKey, React.ReactNode> = {
  sales: <Target size={15} />,
  visits: <MapPin size={15} />,
  demos: <Box size={15} />,
  tenders: <FileText size={15} />,
  proposals: <FileSpreadsheet size={15} />,
  service: <Wrench size={15} />,
  team: <Users size={15} />,
  expenses: <Receipt size={15} />,
};
const SECTION = new Map(COMMAND_SECTIONS.map((s) => [s.key, s]));
const ITEM = new Map(COMMAND_SECTIONS.flatMap((s) => s.items.map((i) => [`${s.key}.${i.key}`, i] as const)));
const itemDef = (section: CommandSectionKey, key: string): CommandItemDef | undefined => ITEM.get(`${section}.${key}`);

const TONE: Record<CommandTone, Tone> = { critical: 'red', warning: 'ochre', ok: 'green', neutral: 'ink' };
const DECK_TONE: Record<CommandTone, NonNullable<DeckItem['tone']>> = { critical: 'critical', warning: 'warning', ok: 'success', neutral: 'neutral' };

const shown = (m: CommandMetric) => m.display ?? (m.value == null ? '—' : m.value.toLocaleString('en-IN'));
/** An action figure above zero: something is waiting on someone. */
const isException = (section: CommandSectionKey, m: CommandMetric) => itemDef(section, m.key)?.kind === 'action' && (m.value ?? 0) > 0;

/* ------------------------------------------------------ one figure's records -- */
interface Loaded {
  items: DeckItem[];
  total: number;
  next: number | null;
  dates: CommandRecordsDto['dates'];
}
const PAGE = 20;
/** Pages loaded per board load (generatedAt) and figure, so going back to a tab shows its list straight away. */
const loaded = new Map<string, Loaded>();
const DATE_MODE: Record<CommandRecordsDto['dates'], 'day' | 'countdown' | 'ago' | 'none'> = { due: 'day', deadline: 'countdown', past: 'ago', none: 'none' };

/**
 * A figure's tab: one line on what it counts, then the records behind it (GET /dashboard/command/records) with their
 * status, a page at a time as the card is scrolled.
 */
const FigureRecords: React.FC<{ section: CommandSectionKey; metric: CommandMetric; days: CommandPeriod; stamp: string }> = ({ section, metric: m, days, stamp }) => {
  const def = itemDef(section, m.key)!;
  const key = `${stamp}|${section}.${m.key}`;
  const [list, setList] = useState<Loaded | null>(() => loaded.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marker = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<CommandRecordsDto>(`/dashboard/command/records?section=${section}&metric=${m.key}&offset=${offset}&limit=${PAGE}`);
        const fallback = m.href || SECTION.get(section)!.href;
        const page = res.items.map(
          (it: CommandListItem): DeckItem => ({
            id: it.id,
            title: it.title,
            subtitle: it.subtitle,
            date: it.date,
            status: it.status,
            meta: it.meta,
            tone: DECK_TONE[it.tone ?? 'neutral'],
            href: it.href || fallback,
          }),
        );
        const prev = offset ? loaded.get(key) : undefined;
        // a record that moved between pages while scrolling is shown once
        const seen = new Set(prev?.items.map((it) => it.id));
        const next: Loaded = { items: [...(prev?.items ?? []), ...page.filter((it) => !seen.has(it.id))], total: res.total, next: res.next, dates: res.dates };
        loaded.set(key, next);
        if (alive.current) setList(next);
      } catch (e: any) {
        if (alive.current) setError(e?.message || 'Could not load the list.');
      } finally {
        if (alive.current) setLoading(false);
      }
    },
    [key, section, m.key, m.href],
  );

  useEffect(() => {
    if (!loaded.has(key)) load(0);
  }, [key, load]);

  // infinite scroll inside the card: the next page when the end of the list nears the bottom of the pane
  useEffect(() => {
    const el = marker.current;
    if (!el || list?.next == null || loading || error || typeof IntersectionObserver === 'undefined') return;
    const next = list.next;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(next), {
      root: el.closest('.dx-cmd-pane'),
      rootMargin: '0px 0px 160px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list?.next, loading, error, load]);

  return (
    <>
      <div className="dx-rec__cap">
        <p className="min-w-0 flex-1">
          {m.detail || def.help}
          {def.period && (
            <span className="dx-cmd__per" title={`Counted over the last ${days} days`}>
              {days}d
            </span>
          )}
        </p>
        {list && (
          <span className="dx-rec__count">
            {list.total.toLocaleString('en-IN')} {list.total === 1 ? 'record' : 'records'}
          </span>
        )}
      </div>
      {list ? (
        <ItemList items={list.items} dateMode={DATE_MODE[list.dates]} countdown={(d) => <DeadlineChip deadline={d} />} empty="Nothing here right now" />
      ) : (
        !error && (
          <div className="dx-rec__wait" role="status">
            <Spinner size="sm" /> Loading the list…
          </div>
        )
      )}
      {error && (
        <div className="dx-rec__err" role="alert">
          <span>{error}</span>
          <Button size="xs" variant="secondary" leftIcon={<RefreshCw className="h-3 w-3" />} onClick={() => load(list?.next ?? 0)}>
            Try again
          </Button>
        </div>
      )}
      {list?.next != null && !error && (
        <div ref={marker} className="dx-more" aria-live="polite">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-xs text-[#4A5568]">
              <Spinner size="sm" /> Loading more…
            </span>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => load(list.next!)}>
              {(list.total - list.items.length).toLocaleString('en-IN')} more
            </Button>
          )}
        </div>
      )}
    </>
  );
};

/* ---------------------------------------------------------- one section -- */
/**
 * A section card: one tab per figure (short name and value), the chosen figure's records below it. It opens on the
 * first figure that needs action, so the card leads with what is waiting; the tabs stay put while the list scrolls.
 */
const SectionCard: React.FC<{ section: CommandSection; days: CommandPeriod; stamp: string }> = ({ section: s, days, stamp }) => {
  const def = SECTION.get(s.key)!;
  const uid = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const current = s.metrics.find((m) => m.key === picked) ?? s.metrics.find((m) => isException(s.key, m)) ?? s.metrics[0];
  const hot = s.metrics.some((m) => isException(s.key, m) && m.tone === 'critical');
  const warm = s.metrics.some((m) => isException(s.key, m));

  // arrow keys / Home / End move between the tabs (WAI-ARIA tabs pattern)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = s.metrics.indexOf(current);
    const n = s.metrics.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    setPicked(s.metrics[to].key);
    document.getElementById(`${uid}-${s.metrics[to].key}`)?.focus();
  };

  // "Open …" lands on the list behind the chosen figure (Overdue → every overdue task, not the manager's own board);
  // a figure without one opens the module
  return (
    <Panel className="dx-cmd-card" title={def.label} icon={ICONS[s.key]} tone={hot ? 'red' : warm ? 'ochre' : 'teal'} href={current.href || def.href} hrefLabel={`Open ${def.label.toLowerCase()}`}>
      <ScrollStrip activeKey={current.key} className="dx-tabs dx-tabs--strip" role="tablist" aria-label={`${def.label} figures`} onKeyDown={onKeyDown}>
        {s.metrics.map((m) => {
          const d = itemDef(s.key, m.key);
          if (!d) return null;
          const on = m.key === current.key;
          return (
            <button
              key={m.key}
              id={`${uid}-${m.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`${uid}-pane`}
              tabIndex={on ? 0 : -1}
              title={d.label}
              className="dx-tab"
              data-tone={isException(s.key, m) ? TONE[m.tone] : undefined}
              onClick={() => setPicked(m.key)}
            >
              {d.tab} <b>{shown(m)}</b>
            </button>
          );
        })}
      </ScrollStrip>
      <div id={`${uid}-pane`} role="tabpanel" aria-labelledby={`${uid}-${current.key}`} className="dx-cmd-pane">
        <FigureRecords key={current.key} section={s.key} metric={current} days={days} stamp={stamp} />
      </div>
    </Panel>
  );
};

/* ------------------------------------------------------------- customise -- */
const CustomiseModal: React.FC<{
  open: boolean;
  layout: CommandLayout;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, layout, onClose, onSaved }) => {
  const [draft, setDraft] = useState<CommandLayout>(layout);
  const [saving, setSaving] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(layout);
      setError(null);
    }
  }, [open, layout]);

  const patchSection = (key: CommandSectionKey, fn: (s: CommandLayout['sections'][number]) => CommandLayout['sections'][number]) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? fn(s) : s)) }));
  const move = (index: number, by: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.sections];
      const [s] = next.splice(index, 1);
      next.splice(index + by, 0, s);
      return { ...d, sections: next };
    });
  const visibleSections = draft.sections.filter((s) => !s.hidden);
  const visibleFigures = visibleSections.reduce((n, s) => n + SECTION.get(s.key)!.items.length - s.hidden_items.length, 0);

  const save = async () => {
    setSaving('save');
    setError(null);
    try {
      await api.patch('/dashboard/command/layout', draft);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Could not save your layout.');
    } finally {
      setSaving(null);
    }
  };
  const reset = async () => {
    setSaving('reset');
    setError(null);
    try {
      await api.delete('/dashboard/command/layout');
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Could not reset your layout.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Customise your dashboard" description="Pick the sections and figures you want to see, in your order. Only you see this layout." maxWidth="5xl">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <Checkbox
            checked={draft.only_exceptions}
            onChange={(e) => setDraft((d) => ({ ...d, only_exceptions: e.target.checked }))}
            label="Show only what needs action"
            description="Hides figures that are at zero or are for information only."
          />
          <p className="shrink-0 font-mono text-[11px] text-[#4A5568]">
            {visibleFigures} figures · {visibleSections.length} of {draft.sections.length} sections
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Sections and figures, in dashboard order">
          {draft.sections.map((s, i) => {
            const def = SECTION.get(s.key)!;
            const on = def.items.length - s.hidden_items.length;
            return (
              <li
                key={s.key}
                data-section={s.key}
                // a ring, not a border: the theme turns bordered boxes in a dialog into wells the colour of the dialog
                className={`flex flex-col rounded-[14px] p-3 ring-1 ring-inset transition-colors ${s.hidden ? 'bg-[#F6F5F1] ring-[#ECE9E2]' : 'bg-white ring-[#DCD8CE]'}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${s.hidden ? 'bg-[#ECE9E2] text-[#6B7280]' : 'bg-[#E3EFEE] text-[#0F5E63]'}`} aria-hidden>
                    {ICONS[s.key]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Checkbox checked={!s.hidden} onChange={(e) => patchSection(s.key, (x) => ({ ...x, hidden: !e.target.checked }))} label={<span className="text-[13px] font-semibold">{def.label}</span>} />
                    <p className="mt-0.5 pl-6 font-mono text-[10.5px] text-[#6B7280]">{s.hidden ? 'Hidden' : `${on} of ${def.items.length} figures`}</p>
                  </div>
                  <IconButton
                    icon={
                      <>
                        <ArrowUp size={13} className="sm:hidden" />
                        <ArrowLeft size={13} className="hidden sm:block" />
                      </>
                    }
                    aria-label={`Move ${def.label} earlier`}
                    title="Move earlier"
                    size="xs"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <IconButton
                    icon={
                      <>
                        <ArrowDown size={13} className="sm:hidden" />
                        <ArrowRight size={13} className="hidden sm:block" />
                      </>
                    }
                    aria-label={`Move ${def.label} later`}
                    title="Move later"
                    size="xs"
                    disabled={i === draft.sections.length - 1}
                    onClick={() => move(i, 1)}
                  />
                </div>
                <div className="mt-2.5 flex flex-col gap-1.5 border-t border-[#ECE9E2] pt-2.5">
                  {def.items.map((it) => (
                    <Checkbox
                      key={it.key}
                      size="sm"
                      disabled={s.hidden}
                      checked={!s.hidden_items.includes(it.key)}
                      onChange={(e) =>
                        patchSection(s.key, (x) => ({
                          ...x,
                          hidden_items: e.target.checked ? x.hidden_items.filter((k) => k !== it.key) : [...x.hidden_items, it.key],
                        }))
                      }
                      label={<span className="font-medium">{it.label}</span>}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        {visibleFigures === 0 && <InfoCallout variant="warning" title="Nothing selected">Tick at least one figure, or your dashboard will be empty.</InfoCallout>}
        {error && <InfoCallout variant="danger" title="Not saved">{error}</InfoCallout>}

        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" size="sm" onClick={reset} isLoading={saving === 'reset'} disabled={saving !== null}>
            Reset to default
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving !== null}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} isLoading={saving === 'save'} disabled={saving !== null}>
              Save layout
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------------------------------------------ page -- */
/** Cards fetched per scroll step: the first row shares its line with "Needs your action". */
const FIRST_CARDS = 2;
const MORE_CARDS = 3;

/**
 * The board loads in pages from the server: first what needs action across every card (hero, attention card and the
 * card order), then the section cards a row at a time (GET /dashboard/command?sections=…) as the page is scrolled.
 */
export function ManagementCommand() {
  const { user } = useAuth();
  /** `only=action` load: layout, period, card order and the figures that need action on every card. */
  const [data, setData] = useState<CommandDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [customising, setCustomising] = useState(false);
  /** The period being switched to while it saves; the board shows it selected straight away. */
  const [nextPeriod, setNextPeriod] = useState<CommandPeriod | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);
  /** Section cards loaded so far, in board order. */
  const [cards, setCards] = useState<CommandSection[]>([]);
  const [cardsLoaded, setCardsLoaded] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  /** Which board load the card pages belong to: a page that lands after a refresh or period change is dropped. */
  const boardStamp = useRef<string | null>(null);
  const cardsMarker = useRef<HTMLDivElement>(null);
  /** A row request in flight (state lags a render behind; this stops a second trigger asking for the same row). */
  const cardsBusy = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const board = await api.get<CommandDashboardDto>('/dashboard/command?only=action');
      boardStamp.current = board.generatedAt;
      setCards([]);
      setCardsLoaded(0);
      setCardsError(null);
      setData(board);
    } catch (e: any) {
      setError(e?.message || 'Could not load the command dashboard.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const moreCards = !!data && cardsLoaded < data.order.length;
  const loadCards = useCallback(async () => {
    if (!data || cardsBusy.current || cardsLoaded >= data.order.length) return;
    cardsBusy.current = true;
    const stamp = data.generatedAt;
    const keys = data.order.slice(cardsLoaded, cardsLoaded + (cardsLoaded ? MORE_CARDS : FIRST_CARDS));
    setCardsLoading(true);
    setCardsError(null);
    try {
      const page = await api.get<CommandDashboardDto>(`/dashboard/command?sections=${keys.join(',')}`);
      if (boardStamp.current !== stamp) return;
      setCards((c) => [...c, ...page.sections]);
      setCardsLoaded((n) => n + keys.length);
    } catch (e: any) {
      if (boardStamp.current === stamp) setCardsError(e?.message || 'Could not load the next cards.');
    } finally {
      cardsBusy.current = false;
      setCardsLoading(false);
    }
  }, [data, cardsLoaded]);

  // infinite scroll: the next row of cards when the end of the grid nears the bottom of the screen (and again while
  // it stays in view, so a tall screen fills itself)
  useEffect(() => {
    const el = cardsMarker.current;
    if (!el || !moreCards || cardsLoading || cardsError || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadCards(), { rootMargin: '0px 0px 240px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [moreCards, cardsLoading, cardsError, loadCards, cards.length]);

  const exceptions: AttentionItem[] = useMemo(() => {
    if (!data) return [];
    return data.sections
      .flatMap((s) =>
        s.metrics
          .filter((m) => isException(s.key, m))
          .map((m) => ({ section: s.key, m, def: itemDef(s.key, m.key)! })),
      )
      .sort((a, b) => Number(b.m.tone === 'critical') - Number(a.m.tone === 'critical'))
      .map(({ section, m, def }) => ({
        id: `${section}.${m.key}`,
        severity: m.tone === 'critical' ? 'critical' : 'warning',
        title: `${m.value!.toLocaleString('en-IN')} · ${def.label}`,
        detail: m.detail || def.help,
        href: m.href || SECTION.get(section)!.href,
        right: <span className="dx-cmd__chip">{SECTION.get(section)!.label}</span>,
      }));
  }, [data]);

  const onlyExceptions = data?.layout.only_exceptions ?? false;
  const sections = useMemo(
    () =>
      cards
        .map((s) => ({ ...s, metrics: onlyExceptions ? s.metrics.filter((m) => isException(s.key, m)) : s.metrics }))
        .filter((s) => s.metrics.length > 0),
    [cards, onlyExceptions],
  );

  /** One results period for the whole board: saved to the layout, then every card is re-counted over it. */
  const changePeriod = async (p: CommandPeriod) => {
    if (!data || nextPeriod !== null || p === data.layout.period) return;
    setNextPeriod(p);
    setPeriodError(null);
    try {
      await api.patch('/dashboard/command/layout', { period: p });
      await load();
    } catch (e: any) {
      setPeriodError(e?.message || 'Could not change the results period.');
    } finally {
      setNextPeriod(null);
    }
  };

  if (error && !data) {
    return (
      <PageContainer>
        <InfoCallout variant="danger" title="Command dashboard did not load">
          <p className="text-xs">{error}</p>
          <Button size="sm" variant="secondary" className="mt-3" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load}>
            Try again
          </Button>
        </InfoCallout>
      </PageContainer>
    );
  }
  if (!data) {
    return (
      <PageContainer>
        <PageLoader label="Loading the command dashboard" rows={4} />
      </PageContainer>
    );
  }

  const period = nextPeriod ?? data.layout.period;
  const critical = exceptions.filter((e) => e.severity === 'critical').length;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const fmtDay = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });

  return (
    <PageContainer className="dx-root" data-desk="command">
      <HeroBanner
        compact
        greeting={greeting}
        name={(user?.full_name || 'there').split(' ')[0]}
        stats={[
          { label: 'Need action', value: exceptions.length, tone: exceptions.length ? 'ochre' : 'green' },
          { label: 'Critical', value: critical, tone: critical ? 'red' : 'green' },
          { label: 'Sections shown', value: data.order.length, tone: 'teal' },
        ]}
        ctaHref="/regional"
        ctaLabel="Regional command"
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#4A5568]">Results period</span>
          <ButtonGroup attached role="group" aria-label="Results period for every card">
            {COMMAND_PERIODS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? 'primary' : 'secondary'}
                aria-pressed={period === p}
                isLoading={nextPeriod === p}
                disabled={nextPeriod !== null && nextPeriod !== p}
                onClick={() => changePeriod(p)}
              >
                {p} days
              </Button>
            ))}
          </ButtonGroup>
          <p className="text-xs text-[#4A5568]">
            All India · {fmtDay(data.period.from)} – {fmtDay(data.period.to)} · applies to every card&apos;s
            <span className="dx-cmd__per">{data.period.days}d</span> figures
            {onlyExceptions && ' · showing only what needs action'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />} onClick={load} disabled={refreshing}>
            Refresh
          </Button>
          <Button size="sm" variant="primary" leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => setCustomising(true)}>
            Customise
          </Button>
        </div>
      </div>
      {periodError && (
        <InfoCallout variant="danger" title="Results period not changed" onClose={() => setPeriodError(null)}>
          <p className="text-xs">{periodError}</p>
        </InfoCallout>
      )}

      {/* "Needs your action" is the first card of the grid, the same size as the rest; the section cards come from the
          server a row at a time as the page scrolls */}
      <div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Panel className="dx-cmd-card" title="Needs your action" icon={<SlidersHorizontal size={15} />} tone={critical ? 'red' : exceptions.length ? 'ochre' : 'green'}>
            <AttentionList items={exceptions} pageSize={3} />
          </Panel>
          {sections.map((s) => (
            <SectionCard key={s.key} section={s} days={data.period.days} stamp={data.generatedAt} />
          ))}
        </div>
        {cardsError ? (
          <div className="dx-rec__err" role="alert">
            <span>{cardsError}</span>
            <Button size="xs" variant="secondary" leftIcon={<RefreshCw className="h-3 w-3" />} onClick={loadCards}>
              Try again
            </Button>
          </div>
        ) : (
          moreCards && (
            <div ref={cardsMarker} className="dx-more" aria-live="polite">
              {cardsLoading ? (
                <span className="inline-flex items-center gap-2 text-xs text-[#4A5568]">
                  <Spinner size="sm" /> Loading more cards…
                </span>
              ) : (
                <Button size="sm" variant="secondary" onClick={loadCards}>
                  {data.order.length - cardsLoaded} more {data.order.length - cardsLoaded === 1 ? 'section' : 'sections'}
                </Button>
              )}
            </div>
          )
        )}
      </div>

      {!moreCards && !cardsLoading && sections.length === 0 && (
        <InfoCallout variant={onlyExceptions ? 'success' : 'neutral'} title={onlyExceptions ? 'All clear' : 'No figures selected'}>
          <p className="text-xs">{onlyExceptions ? 'Nothing in your chosen sections needs action right now.' : 'Use Customise to choose the sections and figures you want to see.'}</p>
        </InfoCallout>
      )}

      <CustomiseModal
        open={customising}
        layout={data.layout}
        onClose={() => setCustomising(false)}
        onSaved={() => {
          setCustomising(false);
          load();
        }}
      />
    </PageContainer>
  );
}
