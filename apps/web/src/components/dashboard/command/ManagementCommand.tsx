'use client';

/**
 * Module 10 — Management Command dashboard (Blueprint §45). One screen for management across every module: what
 * needs action first, then each section's figures. Every figure says in one line what it counts and opens the module
 * list behind it. Each manager chooses the sections, figures, order and results period (Customise), saved to their
 * account so the phone and the desk show the same board.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Box,
  ChevronRight,
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
  type CommandMetric,
  type CommandPeriod,
  type CommandSectionKey,
  type CommandTone,
} from '@arihant/shared';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { Button, ButtonGroup, Checkbox, IconButton, InfoCallout, Modal, PageContainer, PageLoader } from '@/components/ui';
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

/* ------------------------------------------------------------- one figure -- */
const MetricRow: React.FC<{ section: CommandSectionKey; metric: CommandMetric }> = ({ section, metric: m }) => {
  const def = itemDef(section, m.key);
  if (!def) return null;
  const tone = TONE[m.tone];
  const items: DeckItem[] = (m.items ?? []).map((it) => ({
    id: it.id,
    title: it.title,
    subtitle: it.subtitle,
    date: it.date,
    meta: it.meta,
    tone: DECK_TONE[it.tone ?? 'neutral'],
    href: it.href || m.href || SECTION.get(section)!.href,
  }));
  const timed = items.some((it) => it.date?.includes('T'));
  const head = (
    <>
      <span className="dx-cmd__val">{shown(m)}</span>
      <span className="min-w-0 flex-1">
        <span className="dx-cmd__label">{def.label}</span>
        <span className="dx-cmd__help">{m.detail || def.help}</span>
      </span>
      {m.href && <ChevronRight size={15} className="dx-cmd__go shrink-0" aria-hidden />}
    </>
  );
  return (
    <li className="dx-cmd" data-tone={tone} data-metric={`${section}.${m.key}`}>
      {m.href ? (
        <Link href={m.href} className="dx-cmd__head" title={def.help}>
          {head}
        </Link>
      ) : (
        <div className="dx-cmd__head" title={def.help}>
          {head}
        </div>
      )}
      {m.breakdown && m.breakdown.length > 0 && (
        <ul className="dx-cmd__split">
          {m.breakdown.map((b) => {
            const body = (
              <>
                <span className="truncate">{b.label}</span>
                <b>{b.display ?? b.value.toLocaleString('en-IN')}</b>
              </>
            );
            return (
              <li key={b.label} data-tone={TONE[b.tone ?? 'neutral']}>
                {b.href ? <Link href={b.href}>{body}</Link> : <span>{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <div className="dx-cmd__items">
          <ItemList items={items} dateMode={timed ? 'countdown' : 'day'} countdown={(d) => <DeadlineChip deadline={d} />} />
        </div>
      )}
    </li>
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
  const visibleFigures = draft.sections.filter((s) => !s.hidden).reduce((n, s) => n + SECTION.get(s.key)!.items.length - s.hidden_items.length, 0);

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
    <Modal isOpen={open} onClose={onClose} title="Customise your dashboard" description="Pick what you want to see. Only you see this layout." maxWidth="2xl">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4A5568]">Results period</p>
          <ButtonGroup attached>
            {COMMAND_PERIODS.map((p) => (
              <Button key={p} size="sm" variant={draft.period === p ? 'primary' : 'secondary'} onClick={() => setDraft((d) => ({ ...d, period: p as CommandPeriod }))}>
                Last {p} days
              </Button>
            ))}
          </ButtonGroup>
          <p className="text-xs text-[#6B7280]">Used for conversion, demo results, tender results, proposal outcomes, cancelled visits and rejected claims.</p>
        </div>

        <Checkbox
          checked={draft.only_exceptions}
          onChange={(e) => setDraft((d) => ({ ...d, only_exceptions: e.target.checked }))}
          label="Show only what needs action"
          description="Hides figures that are at zero or are for information only."
        />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4A5568]">Sections and figures</p>
          <ul className="divide-y divide-[#ECE9E2] rounded-[14px] border border-[#DCD8CE] bg-white">
            {draft.sections.map((s, i) => {
              const def = SECTION.get(s.key)!;
              return (
                <li key={s.key} className="p-3 sm:p-4" data-section={s.key}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Checkbox checked={!s.hidden} onChange={(e) => patchSection(s.key, (x) => ({ ...x, hidden: !e.target.checked }))} label={<span className="font-semibold">{def.label}</span>} />
                    </div>
                    <IconButton icon={<ArrowUp size={14} />} aria-label={`Move ${def.label} up`} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon={<ArrowDown size={14} />} aria-label={`Move ${def.label} down`} size="sm" disabled={i === draft.sections.length - 1} onClick={() => move(i, 1)} />
                  </div>
                  {!s.hidden && (
                    <div className="mt-2 grid grid-cols-1 gap-1.5 pl-7 sm:grid-cols-2">
                      {def.items.map((it) => (
                        <Checkbox
                          key={it.key}
                          size="sm"
                          checked={!s.hidden_items.includes(it.key)}
                          onChange={(e) =>
                            patchSection(s.key, (x) => ({
                              ...x,
                              hidden_items: e.target.checked ? x.hidden_items.filter((k) => k !== it.key) : [...x.hidden_items, it.key],
                            }))
                          }
                          label={it.label}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

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
export function ManagementCommand() {
  const { user } = useAuth();
  const [data, setData] = useState<CommandDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [customising, setCustomising] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      setData(await api.get<CommandDashboardDto>('/dashboard/command'));
    } catch (e: any) {
      setError(e?.message || 'Could not load the command dashboard.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const onlyExceptions = data.layout.only_exceptions;
  const sections = data.sections
    .map((s) => ({ ...s, metrics: onlyExceptions ? s.metrics.filter((m) => isException(s.key, m)) : s.metrics }))
    .filter((s) => s.metrics.length > 0);
  const critical = exceptions.filter((e) => e.severity === 'critical').length;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const fmtDay = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });

  return (
    <PageContainer className="dx-root" data-desk="command">
      <HeroBanner
        greeting={greeting}
        name={(user?.full_name || 'there').split(' ')[0]}
        stats={[
          { label: 'Need action', value: exceptions.length, tone: exceptions.length ? 'ochre' : 'green' },
          { label: 'Critical', value: critical, tone: critical ? 'red' : 'green' },
          { label: 'Sections shown', value: data.sections.length, tone: 'teal' },
        ]}
        ctaHref="/regional"
        ctaLabel="Regional command"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[#4A5568]">
          All India · results for the last {data.period.days} days ({fmtDay(data.period.from)} – {fmtDay(data.period.to)})
          {onlyExceptions && ' · showing only what needs action'}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />} onClick={load} disabled={refreshing}>
            Refresh
          </Button>
          <Button size="sm" variant="primary" leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => setCustomising(true)}>
            Customise
          </Button>
        </div>
      </div>

      <Panel title="Needs your action" icon={<SlidersHorizontal size={15} />} tone={critical ? 'red' : exceptions.length ? 'ochre' : 'green'}>
        <AttentionList items={exceptions} />
      </Panel>

      {sections.length === 0 ? (
        <InfoCallout variant={onlyExceptions ? 'success' : 'neutral'} title={onlyExceptions ? 'All clear' : 'No figures selected'}>
          <p className="text-xs">{onlyExceptions ? 'Nothing in your chosen sections needs action right now.' : 'Use Customise to choose the sections and figures you want to see.'}</p>
        </InfoCallout>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {sections.map((s) => {
            const def = SECTION.get(s.key)!;
            const hot = s.metrics.some((m) => isException(s.key, m) && m.tone === 'critical');
            const warm = s.metrics.some((m) => isException(s.key, m));
            return (
              <Panel key={s.key} title={def.label} icon={ICONS[s.key]} tone={hot ? 'red' : warm ? 'ochre' : 'teal'} href={def.href} hrefLabel={`Open ${def.label.toLowerCase()}`}>
                <ul className="dx-cmd-list">
                  {s.metrics.map((m) => (
                    <MetricRow key={m.key} section={s.key} metric={m} />
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
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
