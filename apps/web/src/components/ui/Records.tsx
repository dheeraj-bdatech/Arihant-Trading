'use client';

/**
 * Field-friendly record layouts that replace wide tables on list pages.
 *
 *  - RecordCards   priority cards: deadline chip + one big next-step button, most urgent first
 *  - StageBoard    columns per stage; on phones one stage at a time behind big stage buttons
 *  - RecordList    the task module's list: a table from tablet up, compact cards on phones
 *  - RecordViews   all three, behind a List | Cards | Board toggle remembered per page, in one card
 *                  that scrolls on its own and loads the next page near the end (infinite scroll)
 *
 * Cards show the first two `facts`; the board shows title, owner and value only.
 *
 * Every page maps its rows to one RecordItem shape. Touch targets are 44px, and 56px on phones
 * ("glove mode", see `.rec` in theme.css). Status is always text + colour, never colour alone, in the
 * shared Badge colours (same as the task module).
 */
import React, { useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { ArrowRight, CalendarDays, ChevronDown, Columns3, LayoutGrid, List } from 'lucide-react';
import { istDateOf, istToday } from '@/lib/ist-date';
import { formatINR, formatLakh } from '@arihant/shared';
import { Badge, type BadgeProps } from './Badge';
import { Button, IconButton } from './Button';
import { Card } from './Card';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

export type RecordTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

export interface RecordAction {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export interface RecordItem {
  key: string;
  /** Mono reference, e.g. a bid or ticket number. */
  code?: string;
  title: string;
  subtitle?: string;
  status?: { label: string; tone: RecordTone };
  /** Extra small chips (priority, flags). */
  badges?: { label: string; tone: RecordTone }[];
  /** The date that drives urgency. `done` shows it plain (no overdue colouring). */
  due?: { date: string | Date | null | undefined; label?: string; done?: boolean };
  /** Pre-formatted amount, e.g. formatLakh(...). */
  value?: string;
  owner?: string;
  /** Shown in expanded rows, split detail and (first two) on cards. */
  facts?: { label: string; value: React.ReactNode }[];
  primary?: RecordAction;
  /** Icon buttons (call, map, note…) — keep to 1–3. */
  quick?: RecordAction[];
  /**
   * Tapping the record body opens the page's own detail modal. Without it, cards inside RecordViews
   * open the built-in details pop-up (every fact + `details` + the actions).
   */
  onOpen?: () => void;
  /** Free slot under the subtitle (progress bar, stage bar…). */
  extra?: React.ReactNode;
  /** Every field of the record, listed under "All details" in the pop-up — see rowDetails(). */
  details?: { label: string; value: React.ReactNode }[];
}

// ------------------------------------------------------------------ helpers
/** Chip tone → shared Badge variant; `urgent` (solid terracotta) is for overdue dates only. */
type ChipTone = RecordTone | 'urgent';
const VARIANT: Record<ChipTone, NonNullable<BadgeProps['variant']>> = {
  danger: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'info',
  neutral: 'default',
  urgent: 'urgent',
};
// Badge dot colours, for the board's column headers.
const DOT: Record<RecordTone, string> = {
  danger: 'bg-[#881337]',
  warning: 'bg-[#9A3412]',
  success: 'bg-[#0F5E63]',
  info: 'bg-[#0F5E63]',
  neutral: 'bg-[#4A5568]',
};

/** Maps a free-text status to a tone: closed/won → success, lost/breached → danger, waiting → warning… */
export function toneFor(status: string | null | undefined): RecordTone {
  const s = String(status || '').toLowerCase();
  if (/(won|convert|closed|resolved|handover|complet|approved|deliver|install|done|paid|on track)/.test(s)) return 'success';
  if (/(lost|cancel|reject|escalat|breach|critical|overdue|fail|needs attention)/.test(s)) return 'danger';
  if (/(await|pending|follow|revisit|reopen|negotiat|quot|report|watch|hold|high|eval|clarif)/.test(s)) return 'warning';
  if (/(new|identif|received|request|schedul|prepar|assign|contact|reserv|pq|draft|open|progress|dispatch|transit)/.test(s)) return 'info';
  return 'neutral';
}

/** Whole days from today (IST) to a date; negative = past. Null when there is no date. */
export function daysFromToday(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istDateOf(date);
  if (!d) return null;
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${istToday()}T00:00:00Z`)) / 86400000);
}

const asDate = (date: string | Date) => (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00+05:30`) : new Date(date));

const shortDate = (date: string | Date | null | undefined) => {
  if (!date) return '—';
  const d = asDate(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
};

const fullDate = (date: string | Date | null | undefined) => {
  if (!date) return '—';
  const d = asDate(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

function dueChip(due: RecordItem['due']): { text: string; tone: ChipTone } | null {
  if (!due?.date) return null;
  const n = daysFromToday(due.date);
  if (n === null) return null;
  if (due.done) return { text: shortDate(due.date), tone: 'neutral' };
  if (n < 0) return { text: `${-n}d overdue`, tone: 'urgent' };
  if (n === 0) return { text: 'Today', tone: 'danger' };
  if (n === 1) return { text: 'Tomorrow', tone: 'warning' };
  if (n <= 3) return { text: `In ${n} days`, tone: 'warning' };
  return { text: shortDate(due.date), tone: 'neutral' };
}

const Chip: React.FC<{ tone: ChipTone; children: React.ReactNode; className?: string }> = ({ tone, children, className }) => (
  <Badge variant={VARIANT[tone]} size="sm" className={twMerge('whitespace-nowrap', className)}>
    {children}
  </Badge>
);

const DueChip: React.FC<{ item: RecordItem }> = ({ item }) => {
  const c = dueChip(item.due);
  return c ? <Chip tone={c.tone}>{c.text}</Chip> : null;
};

const Quick: React.FC<{ actions?: RecordAction[] }> = ({ actions }) =>
  actions?.length ? (
    <>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          aria-label={a.label}
          title={a.label}
          disabled={a.disabled}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick?.();
          }}
          className="rec-tap inline-flex shrink-0 items-center justify-center rounded-[10px] border border-[#C9C4B8] bg-white text-[#14213D] hover:border-[#0F5E63] disabled:opacity-40 [&>svg]:h-[18px] [&>svg]:w-[18px]"
        >
          {a.icon ?? <span className="px-2 text-xs font-semibold">{a.label}</span>}
        </button>
      ))}
    </>
  ) : null;

const Primary: React.FC<{ action?: RecordAction; className?: string }> = ({ action, className }) =>
  action ? (
    <button
      type="button"
      disabled={action.disabled}
      onClick={(e) => {
        e.stopPropagation();
        action.onClick?.();
      }}
      className={twMerge(
        'rec-tap inline-flex min-w-[10rem] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#0F5E63] px-3 text-[13px] font-semibold text-white hover:bg-[#0B4A4E] disabled:opacity-50',
        className,
      )}
    >
      <span className="truncate">{action.label}</span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </button>
  ) : null;

const Facts: React.FC<{ facts?: RecordItem['facts']; className?: string; full?: boolean }> = ({ facts, className, full }) =>
  facts?.length ? (
    <dl className={twMerge('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}>
      {facts.map((f) => (
        <div key={f.label} className="min-w-0 rounded-[10px] border border-[#ECE9E2] bg-[#FBFAF7] px-2.5 py-2">
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#4A5568]">{f.label}</dt>
          <dd className={twMerge('mt-0.5 text-[13px] font-semibold text-[#14213D]', full ? 'break-words' : 'truncate')}>{f.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  ) : null;

// ------------------------------------------------------------------ record details (raw row → lines)
const ACRONYM: Record<string, string> = { emd: 'EMD', sla: 'SLA', gem: 'GeM', pq: 'PQ', lr: 'LR', gst: 'GST', oem: 'OEM', po: 'PO', id: 'ID', url: 'URL', mha: 'MHA', mod: 'MoD' };
/** snake_case → "Sentence case" with known acronyms; a trailing "_no" reads "No." (tender_no → Tender No.). */
const humanize = (s: string) =>
  s
    .split('_')
    .filter(Boolean)
    .map((w, i, all) =>
      w === 'no' && i > 0 && i === all.length - 1 ? 'No.' : ACRONYM[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w),
    )
    .join(' ');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /(amount|fee|cost|price|^value$|_value$)/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

function detailValue(key: string, v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  if (NUMERIC.test(s)) {
    const n = Number(s);
    if (key.endsWith('_lakh')) return formatLakh(n);
    if (MONEY.test(key)) return formatINR(n);
    return typeof v === 'number' ? n.toLocaleString('en-IN') : s;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fullDate(s);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    return /^12:00\s?am$/i.test(time) ? fullDate(d) : `${fullDate(d)}, ${time}`; // midnight IST = a plain date
  }
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(s)) return humanize(s); // enum values: in_transit → In transit
  return s;
}

/**
 * Turns an API row into labelled lines for the details pop-up ("show everything about this record").
 * Skips ids, empty values and nested objects; formats dates (IST), money, lakh values and yes/no.
 */
export function rowDetails(
  row: Record<string, unknown> | null | undefined,
  { omit = [], labels = {} }: { omit?: string[]; labels?: Record<string, string> } = {},
): NonNullable<RecordItem['details']> {
  if (!row) return [];
  const out: NonNullable<RecordItem['details']> = [];
  for (const [key, v] of Object.entries(row)) {
    if (omit.includes(key) || key === 'id' || key === 'version' || /_ids?$/.test(key)) continue;
    if (v == null || v === '' || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) continue;
    if (typeof v === 'string' && UUID.test(v)) continue;
    out.push({ label: labels[key] ?? humanize(key), value: detailValue(key, v) });
  }
  return out;
}

const Empty: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="rounded-[14px] border border-dashed border-[#C9C4B8] bg-[#FBFAF7] p-8 text-center text-sm text-[#4A5568]">{children ?? 'Nothing to show.'}</div>
);

/** Sort: open before done, nearest date first, no date last. */
export function byUrgency(a: RecordItem, b: RecordItem): number {
  const ad = a.due?.done ? 1 : 0;
  const bd = b.due?.done ? 1 : 0;
  if (ad !== bd) return ad - bd;
  const an = daysFromToday(a.due?.date ?? null);
  const bn = daysFromToday(b.due?.date ?? null);
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return an - bn;
}

// ------------------------------------------------------------------ 1. priority cards
/** Inside RecordViews: opens the built-in details pop-up for records without their own onOpen. */
const PeekContext = React.createContext<((item: RecordItem) => void) | null>(null);
const useOpen = (item: RecordItem) => {
  const peek = React.useContext(PeekContext);
  return item.onOpen ?? (peek ? () => peek(item) : undefined);
};

export const RecordCard: React.FC<{ item: RecordItem }> = ({ item }) => {
  const open = useOpen(item);
  return (
    <article
      className={twMerge('rec ui-card flex flex-col gap-2.5 p-3.5 sm:p-4', open && 'cursor-pointer hover:border-[#0F5E63]/50')}
      onClick={open}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-haspopup={open ? 'dialog' : undefined}
      onKeyDown={(e) => {
        if (open && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        {item.code && item.code !== item.title ? <span className="min-w-0 break-all font-mono text-xs font-semibold text-[#0F5E63]">{item.code}</span> : <span />}
        <DueChip item={item} />
      </div>
      <div>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[#14213D]">{item.title}</h3>
        {item.subtitle && <p className="mt-0.5 line-clamp-2 text-[13px] text-[#4A5568]">{item.subtitle}</p>}
      </div>
      {item.extra}
      {item.facts?.length ? <Facts facts={item.facts.slice(0, 2)} className="grid-cols-2 sm:grid-cols-2" /> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {item.status && <Chip tone={item.status.tone}>{item.status.label}</Chip>}
        {item.badges?.map((b) => (
          <Chip key={b.label} tone={b.tone}>
            {b.label}
          </Chip>
        ))}
        {item.value && <span className="ml-auto font-mono text-[14px] font-semibold text-[#14213D]">{item.value}</span>}
      </div>
      {(item.owner || item.due?.label) && (
        <p className="text-[12px] text-[#4A5568]">
          {item.due?.date && item.due.label ? `${item.due.label} ${shortDate(item.due.date)}` : ''}
          {item.due?.date && item.due.label && item.owner ? ' · ' : ''}
          {item.owner}
        </p>
      )}
      {(item.primary || item.quick?.length) && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Quick actions={item.quick} />
          <Primary action={item.primary} />
        </div>
      )}
    </article>
  );
};

export const RecordCards: React.FC<{ items: RecordItem[]; empty?: React.ReactNode; className?: string; sort?: boolean }> = ({ items, empty, className, sort = true }) => {
  const list = useMemo(() => (sort ? [...items].sort(byUrgency) : items), [items, sort]);
  if (!list.length) return <Empty>{empty}</Empty>;
  return (
    <div className={twMerge('grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3', className)}>
      {list.map((i) => (
        <RecordCard key={i.key} item={i} />
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ 1b. list (task-module layout)
/** Facts as one muted line under the title ("Portal GeM · EMD ₹ 41,000"), like the task context line. */
const contextLine = (item: RecordItem) =>
  [item.subtitle, ...(item.facts ?? []).map((f) => `${f.label} ${textOf(f.value) || '—'}`)].filter(Boolean).join(' · ');

/** Date plus a relative hint ("3d overdue", "in 2 days"), terracotta once it is due — like DueText on tasks. */
const DueCell: React.FC<{ item: RecordItem }> = ({ item }) => {
  if (!item.due?.date) return <span className="text-xs text-[#6B7280]">No date</span>;
  const n = daysFromToday(item.due.date);
  const hint = item.due.done || n === null ? null : n < 0 ? `${-n}d overdue` : n === 0 ? 'Due today' : n === 1 ? 'Tomorrow' : `In ${n} days`;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-mono text-xs tabular-nums text-[#14213D]">{fullDate(item.due.date)}</span>
      {hint && <span className={twMerge('text-[11px] font-medium', n !== null && n <= 0 ? 'text-[#9A3412]' : 'text-[#4A5568]')}>{hint}</span>}
    </span>
  );
};

const isOverdue = (item: RecordItem) => !item.due?.done && (daysFromToday(item.due?.date ?? null) ?? 0) < 0;

const BadgeRow: React.FC<{ item: RecordItem }> = ({ item }) =>
  item.badges?.length ? (
    <>
      {item.badges.map((b) => (
        <Chip key={b.label} tone={b.tone}>
          {b.label}
        </Chip>
      ))}
    </>
  ) : null;

const ListRow: React.FC<{ item: RecordItem; show: { owner: boolean; due: boolean; value: boolean; actions: boolean } }> = ({ item, show }) => {
  const open = useOpen(item);
  const context = contextLine(item);
  return (
    <TableRow className={open ? 'cursor-pointer' : undefined} onClick={open}>
      {/* Widths are capped on inner wrappers: auto table layout ignores max-width on cells. */}
      <TableCell>
        <div className="min-w-0 max-w-[310px]">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.code && item.code !== item.title && <span className="font-mono text-xs font-semibold text-[#0F5E63]">{item.code}</span>}
            <BadgeRow item={item} />
          </div>
          <div className="truncate font-medium text-[#14213D]" title={item.title}>
            {item.title}
          </div>
          {context && (
            <div className="truncate text-[11px] text-[#4A5568]" title={context}>
              {context}
            </div>
          )}
        </div>
      </TableCell>
      {show.owner && (
        <TableCell>
          <div className="min-w-0 max-w-[160px] truncate text-xs font-medium text-[#14213D]" title={item.owner}>
            {item.owner || 'Unassigned'}
          </div>
        </TableCell>
      )}
      <TableCell>{item.status && <Chip tone={item.status.tone}>{item.status.label}</Chip>}</TableCell>
      {show.due && (
        <TableCell className="whitespace-nowrap">
          <div className="w-32">
            <DueCell item={item} />
          </div>
        </TableCell>
      )}
      {show.value && <TableCell className="whitespace-nowrap text-right font-mono text-xs font-semibold text-[#14213D]">{item.value || '—'}</TableCell>}
      {show.actions && (
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-1">
            {item.quick?.map((a) => (
              <IconButton key={a.label} icon={a.icon ?? <ArrowRight />} aria-label={a.label} title={a.label} size="sm" variant="secondary" disabled={a.disabled} onClick={a.onClick} />
            ))}
            {item.primary && (
              <Button size="xs" disabled={item.primary.disabled} onClick={item.primary.onClick} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                {item.primary.label}
              </Button>
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );
};

/** Phones: one card per record — code + badges, title, context, status, date and owner, then the actions. */
const ListCard: React.FC<{ item: RecordItem }> = ({ item }) => {
  const open = useOpen(item);
  const context = contextLine(item);
  return (
    <Card
      className={twMerge('space-y-2.5 p-4', isOverdue(item) && 'border-l-[3px] border-l-[#9A3412]', open && 'cursor-pointer')}
      onClick={open}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-haspopup={open ? 'dialog' : undefined}
      onKeyDown={(e) => {
        if (open && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          {item.code && item.code !== item.title ? <span className="min-w-0 break-all font-mono text-xs font-semibold text-[#0F5E63]">{item.code}</span> : <span />}
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            <BadgeRow item={item} />
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 font-medium text-[#14213D]">{item.title}</div>
        {context && <div className="truncate text-[11px] text-[#4A5568]">{context}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {item.status && <Chip tone={item.status.tone}>{item.status.label}</Chip>}
        {item.value && <span className="ml-auto font-mono text-sm font-semibold text-[#14213D]">{item.value}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <DueCell item={item} />
        {item.owner && <span className="min-w-0 truncate text-right text-xs text-[#4A5568]">{item.owner}</span>}
      </div>
      {item.extra}
      {(item.primary || item.quick?.length) && (
        <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
          <Quick actions={item.quick} />
          <Primary action={item.primary} />
        </div>
      )}
    </Card>
  );
};

/** The task module's list layout for any register: table from tablet up (most urgent first), cards on phones. */
export const RecordList: React.FC<{ items: RecordItem[]; empty?: React.ReactNode; sort?: boolean }> = ({ items, empty, sort = true }) => {
  const list = useMemo(() => (sort ? [...items].sort(byUrgency) : items), [items, sort]);
  if (!list.length) return <Empty>{empty}</Empty>;
  // Columns only for what this register actually has.
  const show = {
    owner: list.some((i) => i.owner),
    due: list.some((i) => i.due?.date),
    value: list.some((i) => i.value),
    actions: list.some((i) => i.primary || i.quick?.length),
  };
  const dueLabel = list.find((i) => i.due?.label)?.due?.label || 'Due';

  return (
    <>
      <div className="hidden md:block">
        <Table className="[&_td]:px-3 [&_th]:px-3">
          <TableHeader>
            <TableRow>
              <TableHead>Record</TableHead>
              {show.owner && <TableHead>Owner</TableHead>}
              <TableHead>Status</TableHead>
              {show.due && <TableHead>{dueLabel}</TableHead>}
              {show.value && <TableHead className="text-right">Value</TableHead>}
              {show.actions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((i) => (
              <ListRow key={i.key} item={i} show={show} />
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-3 md:hidden">
        {list.map((i) => (
          <li key={i.key}>
            <ListCard item={i} />
          </li>
        ))}
      </ul>
    </>
  );
};

/**
 * DD/MM/YYYY in IST (zero-padded) — the app's one date format for tables, cards and details ('-' when there is no
 * date). Never call toLocaleDateString() directly: without a locale + timeZone it shows the browser's order and day.
 */
export const formatDateIN = (date: string | number | Date | null | undefined) => {
  if (date === null || date === undefined || date === '') return '-';
  const d = typeof date === 'number' ? new Date(date) : asDate(date);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

/** DD/MM/YYYY, hh:mm am/pm in IST — for timestamps (audit rows, activity, notifications). */
export const formatDateTimeIN = (date: string | number | Date | null | undefined) => {
  if (date === null || date === undefined || date === '') return '-';
  const d = typeof date === 'number' ? new Date(date) : asDate(date);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
};

/**
 * A page's own register table as RecordViews' `list`: the table from tablet up, the list's phone cards
 * below that. `items` are the same records as the table rows, in the same order.
 */
export const RecordTable: React.FC<{ items: RecordItem[]; children: React.ReactNode }> = ({ items, children }) => (
  <>
    <div className="hidden md:block">{children}</div>
    <ul className="space-y-3 md:hidden">
      {items.map((i) => (
        <li key={i.key}>
          <ListCard item={i} />
        </li>
      ))}
    </ul>
  </>
);

// ------------------------------------------------------------------ 2. stage board
export interface BoardLane {
  key: string;
  label: string;
  tone?: RecordTone;
}

const MiniCard: React.FC<{ item: RecordItem }> = ({ item }) => {
  const open = useOpen(item);
  return (
    <article
      className={twMerge('rec ui-card flex flex-col gap-1.5 p-3', open && 'cursor-pointer hover:border-[#0F5E63]/50')}
      onClick={open}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-haspopup={open ? 'dialog' : undefined}
      onKeyDown={(e) => {
        if (open && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        {item.code && item.code !== item.title ? <span className="min-w-0 truncate font-mono text-[11.5px] font-semibold text-[#0F5E63]">{item.code}</span> : <span />}
        <DueChip item={item} />
      </div>
      <h4 className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#14213D]">{item.title}</h4>
      {item.subtitle && <p className="line-clamp-1 text-[12px] text-[#4A5568]">{item.subtitle}</p>}
      {(item.badges?.length || item.value || item.owner) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#4A5568]">
          {item.badges?.map((b) => (
            <Chip key={b.label} tone={b.tone}>
              {b.label}
            </Chip>
          ))}
          {item.value && <span className="font-mono font-semibold text-[#14213D]">{item.value}</span>}
          {item.owner && <span className="ml-auto truncate">{item.owner}</span>}
        </div>
      )}
      {(item.primary || item.quick?.length) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Quick actions={item.quick} />
          <Primary action={item.primary} />
        </div>
      )}
    </article>
  );
};

export const StageBoard: React.FC<{
  items: RecordItem[];
  lanes: BoardLane[];
  laneOf: (item: RecordItem) => string;
  empty?: React.ReactNode;
  /** Hide lanes with no records (still shown on phones as disabled stage buttons). */
  hideEmptyLanes?: boolean;
}> = ({ items, lanes, laneOf, empty, hideEmptyLanes = false }) => {
  const grouped = useMemo(() => {
    const m = new Map<string, RecordItem[]>(lanes.map((l) => [l.key, []]));
    for (const i of items) {
      const k = laneOf(i);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    m.forEach((v) => v.sort(byUrgency));
    return m;
  }, [items, lanes, laneOf]);
  const visible = lanes.filter((l) => !hideEmptyLanes || (grouped.get(l.key)?.length ?? 0) > 0);
  const firstWithItems = visible.find((l) => (grouped.get(l.key)?.length ?? 0) > 0)?.key ?? visible[0]?.key;
  const [lane, setLane] = useState<string | undefined>(undefined);
  const active = lane && visible.some((l) => l.key === lane) ? lane : firstWithItems;
  if (!items.length) return <Empty>{empty}</Empty>;

  return (
    <div className="rec">
      {/* Phones: big stage buttons, one stage's cards below — no sideways swiping */}
      <div className="md:hidden">
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Stages">
          {visible.map((l) => {
            const n = grouped.get(l.key)?.length ?? 0;
            const on = l.key === active;
            return (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setLane(l.key)}
                className={twMerge(
                  'rec-tap flex items-center justify-between gap-2 rounded-[10px] border px-3 py-1.5 text-left text-[13px] font-semibold leading-tight',
                  on ? 'border-[#0F5E63] bg-[#0F5E63] text-white' : 'border-[#C9C4B8] bg-white text-[#14213D]',
                  !n && !on && 'opacity-60',
                )}
              >
                <span className="line-clamp-2 min-w-0">{l.label}</span>
                <span className="shrink-0 font-mono text-xs">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 space-y-2.5">
          {(grouped.get(active ?? '') ?? []).map((i) => (
            <MiniCard key={i.key} item={i} />
          ))}
          {!(grouped.get(active ?? '') ?? []).length && <Empty>Nothing in this stage.</Empty>}
        </div>
      </div>

      {/* Tablet / desktop: every stage as a column. The surrounding RecordViews card scrolls the
          whole board both ways; column headers stay pinned while their cards scroll under them. */}
      <div className="hidden gap-3 md:grid" style={{ gridAutoFlow: 'column', gridAutoColumns: 'minmax(260px, 1fr)' }}>
        {visible.map((l) => {
          const list = grouped.get(l.key) ?? [];
          return (
            <section key={l.key} className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-[#ECE9E2] bg-white/70 p-2.5 pt-0" aria-label={l.label}>
              {/* pinned flush to the card edge: the offset cancels the RecordViews body padding (p-3 / sm:p-4) */}
              <header className="sticky -top-3 z-[1] -mx-2.5 sm:-top-4 flex items-center justify-between gap-2 rounded-t-[14px] border-b border-[#ECE9E2] bg-[#F6F5F1] px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#4A5568]">
                  <span className={twMerge('h-2 w-2 rounded-full', DOT[l.tone ?? 'neutral'])} />
                  {l.label}
                </span>
                <span className="font-mono text-xs font-semibold text-[#14213D]">{list.length}</span>
              </header>
              {list.map((i) => (
                <MiniCard key={i.key} item={i} />
              ))}
              {!list.length && <p className="px-1 pb-2 text-xs italic text-[#6B7280]">Empty</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ details pop-up
/** Visible text of a fact value (string, number or e.g. a <Link> around text) — to size its tile. */
const textOf = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return '';
};

/** "All details" rows shown before the "Show all" toggle — keeps the pop-up to about half a phone screen. */
const DETAILS_PREVIEW = 6;

/**
 * Everything about one record: status chips, the key numbers, every fact, `details` (all fields)
 * and the same actions as the card. An action closes the pop-up first so its own form is on top.
 */
export const RecordDetails: React.FC<{ item: RecordItem | null; onClose: () => void }> = ({ item, onClose }) => {
  const closeThen = (a: RecordAction): RecordAction => ({ ...a, onClick: () => (onClose(), a.onClick?.()) });
  const [showAll, setShowAll] = useState(false);
  React.useEffect(() => setShowAll(false), [item]);
  // Raw rows often carry the same value twice (tender_no + tender_number, publish_date + publication_date)
  // or repeat what the header already shows (title, code, subtitle, status, badges); on a phone every
  // repeat is another screen of scrolling.
  const details = useMemo(() => {
    if (!item?.details?.length) return [];
    const shown = new Set(
      [item.title, item.code, item.subtitle, item.status?.label, ...(item.badges ?? []).map((b) => b.label)]
        .filter(Boolean)
        .map((t) => String(t).trim().toLowerCase()),
    );
    const tiles = new Set((item.facts ?? []).map((f) => `${f.label}|${textOf(f.value)}`.trim().toLowerCase()));
    const seen = new Map<string, string>();
    return item.details.filter((d) => {
      const v = textOf(d.value).trim().toLowerCase();
      if (!v) return true;
      if (shown.has(v) || tiles.has(`${d.label}|${v}`.toLowerCase())) return false;
      // same value under a near-same label: publish/publication date, assigned/assignee name
      const stem = d.label.toLowerCase().split(/\s+/)[0].slice(0, 5);
      if (seen.get(v) === stem) return false;
      seen.set(v, stem);
      return true;
    });
  }, [item]);
  const visibleDetails = showAll ? details : details.slice(0, DETAILS_PREVIEW);
  const hiddenCount = details.length - DETAILS_PREVIEW;
  const summary = item
    ? ([
        item.value && { label: 'Value', value: <span className="font-mono">{item.value}</span> },
        item.owner && { label: 'Owner', value: item.owner },
        item.due?.date && { label: item.due.label || 'Due', value: fullDate(item.due.date) },
        ...(item.facts ?? []),
      ].filter(Boolean) as NonNullable<RecordItem['facts']>)
    : [];

  return (
    <Modal isOpen={!!item} onClose={onClose} title={item?.title ?? ''} description={item?.subtitle} maxWidth="2xl">
      {item && (
        <div className="rec space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.code && item.code !== item.title && <span className="mr-1 break-all font-mono text-xs font-semibold text-[#0F5E63]">{item.code}</span>}
            {item.status && <Chip tone={item.status.tone}>{item.status.label}</Chip>}
            {item.badges?.map((b) => (
              <Chip key={b.label} tone={b.tone}>
                {b.label}
              </Chip>
            ))}
            <DueChip item={item} />
          </div>
          {item.extra}
          {summary.length > 0 && (
            // `!` beats the ui-kit `.grid { gap: 16px }` in globals.css, which loads after Tailwind's utilities
            <dl className="grid grid-flow-row-dense grid-cols-2 !gap-2 sm:grid-cols-3">
              {summary.map((f) => (
                <div
                  key={f.label}
                  // a long code or sentence gets the full row instead of breaking mid-word in half a phone
                  className={twMerge(
                    'min-w-0 rounded-[10px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2',
                    textOf(f.value).length > 18 && 'col-span-2',
                  )}
                >
                  <dt className="text-[10.5px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#4A5568]">{f.label}</dt>
                  <dd className="mt-0.5 break-words text-[13px] font-semibold leading-5 text-[#14213D]">{f.value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          {details.length ? (
            <section aria-label="All details">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#4A5568]">All details</h3>
              {/* label · value on one row (two columns of rows on wider screens); a long value drops under its label */}
              <dl id="record-all-details" className="grid grid-cols-1 !gap-x-6 !gap-y-0 sm:grid-cols-2">
                {visibleDetails.map((d) => {
                  const long = textOf(d.value).length > 30;
                  return (
                    <div key={d.label} className={twMerge('min-w-0 border-b border-[#ECE9E2] py-2', !long && 'flex items-baseline justify-between gap-3')}>
                      <dt className="shrink-0 text-[12px] leading-[16px] text-[#4A5568]">{d.label}</dt>
                      <dd className={twMerge('min-w-0 break-words text-[13px] font-semibold leading-[20px] text-[#14213D]', long ? 'mt-0.5' : 'text-right')}>{d.value}</dd>
                    </div>
                  );
                })}
              </dl>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  aria-expanded={showAll}
                  aria-controls="record-all-details"
                  onClick={() => setShowAll((v) => !v)}
                  className="rec-tap mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#C9C4B8] bg-white px-4 text-[13px] font-semibold text-[#0F5E63] hover:border-[#0F5E63]"
                >
                  {showAll ? 'Show less' : 'Show more'}
                  <ChevronDown className={twMerge('h-4 w-4 transition-transform', showAll && 'rotate-180')} />
                </button>
              )}
            </section>
          ) : null}
          {(item.primary || item.quick?.length) && (
            // pinned to the bottom of the dialog so the actions never sit below a long details list
            <div className="sticky -bottom-4 z-[1] -mx-4 -mb-4 flex items-center gap-2 border-t border-[#ECE9E2] bg-[#FBFAF7] px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5">
              <Quick actions={item.quick?.map(closeThen)} />
              <Primary action={item.primary && closeThen(item.primary)} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ------------------------------------------------------------------ view switcher
export type RecordView = 'list' | 'cards' | 'board' | 'calendar';

const readView = (key: string, fallback: RecordView): RecordView => {
  try {
    const v = localStorage.getItem(`records-view:${key}`);
    return v === 'list' || v === 'cards' || v === 'board' || v === 'calendar' ? v : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Bottom-of-list marker for infinite scroll: asks for the next page once it scrolls into view, and
 * keeps asking while it stays in view (a short page does not fill the card). The button is the
 * fallback for keyboards and browsers without IntersectionObserver.
 */
const LoadMore: React.FC<{
  scroller: React.RefObject<HTMLDivElement>;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
  count: number;
}> = ({ scroller, onLoadMore, hasMore, loading, count }) => {
  const marker = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = marker.current;
    if (!el || !onLoadMore || !hasMore || loading || typeof IntersectionObserver === 'undefined') return;
    // On tablet/desktop the card body is the scroller; on phones it grows and the page scrolls instead.
    const box = scroller.current;
    const root = box && getComputedStyle(box).maxHeight !== 'none' ? box : null;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoadMore(), {
      root,
      rootMargin: '0px 0px 320px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [scroller, onLoadMore, hasMore, loading, count]);

  if (!onLoadMore || !count) return null;
  return (
    <div ref={marker} className="flex min-h-[52px] items-center justify-center pt-3 text-xs text-[#4A5568]" aria-live="polite">
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size="sm" /> Loading more…
        </span>
      ) : hasMore ? (
        <button type="button" onClick={onLoadMore} className="rec-tap rounded-[10px] border border-[#C9C4B8] bg-white px-4 font-semibold text-[#14213D] hover:border-[#0F5E63]">
          Load more
        </button>
      ) : (
        <span className="font-mono">All {count} loaded</span>
      )}
    </div>
  );
};

/** True below the `md` breakpoint (768px), tracking resizes. False during SSR and the first client render. */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

/**
 * One register, three ways to look at it: list rows, priority cards (both most urgent first) or a
 * stage board, in one card that scrolls on its own (both ways for the board) and pulls the next page
 * as the reader nears the end (`onLoadMore` + `hasMore`, see useInfiniteList). A page may pass `list`
 * (its own table of the same records) in place of the built-in rows. The choice of view is remembered
 * per page (`storageKey`) in this browser.
 */
export const RecordViews: React.FC<{
  items: RecordItem[];
  lanes: BoardLane[];
  laneOf: (item: RecordItem) => string;
  storageKey: string;
  defaultView?: RecordView;
  empty?: React.ReactNode;
  hideEmptyLanes?: boolean;
  /** Card heading, e.g. "Proposal register". */
  title?: React.ReactNode;
  /** Shown next to the toggle, e.g. "24 of 952 bids". */
  summary?: React.ReactNode;
  /** Infinite scroll: fetch the next page. Omit when every record is already loaded. */
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  /** The page's own table of the same records, shown in place of the built-in List rows. */
  list?: React.ReactNode;
  /** A schedule of the same records; adds a "Calendar" choice to the view switch. */
  calendar?: React.ReactNode;
}> = ({ items, lanes, laneOf, storageKey, defaultView = 'cards', empty, hideEmptyLanes, title, summary, onLoadMore, hasMore, loadingMore, list, calendar }) => {
  const [view, setView] = useState<RecordView>(defaultView);
  const [peek, setPeek] = useState<RecordItem | null>(null);
  // Phones get one layout — the compact list cards (the List view's phone form). Fact boxes and a stage board do
  // not fit a 375px screen, so the view switch is hidden there and any remembered choice shows as the list.
  const isPhone = useIsPhone();
  const shown: RecordView = isPhone || (view === 'calendar' && !calendar) ? 'list' : view;
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setView(readView(storageKey, defaultView)), [storageKey, defaultView]);
  const choose = (v: RecordView) => {
    setView(v);
    scroller.current?.scrollTo({ top: 0, left: 0 });
    try {
      localStorage.setItem(`records-view:${storageKey}`, v);
    } catch {
      /* private mode: keep it for this visit only */
    }
  };
  const opts: { key: RecordView; label: string; icon: React.ReactNode }[] = [
    { key: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
    { key: 'cards', label: 'Cards', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { key: 'board', label: 'Board', icon: <Columns3 className="h-3.5 w-3.5" /> },
    ...(calendar ? [{ key: 'calendar' as const, label: 'Calendar', icon: <CalendarDays className="h-3.5 w-3.5" /> }] : []),
  ];

  return (
    <PeekContext.Provider value={setPeek}>
      <Card padding="none" className="rec flex flex-col rounded-[14px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECE9E2] px-3 py-1.5 sm:px-4">
          <div className="min-w-0 space-y-0.5">
            {title && <h2 className="font-serif text-sm font-bold text-[#14213D]">{title}</h2>}
            {summary && <div className="text-[13px] text-[#4A5568]">{summary}</div>}
          </div>
          <div role="radiogroup" aria-label="View" className="hidden rounded-[10px] border border-[#C9C4B8] bg-white p-0.5 md:inline-flex">
            {opts.map((o) => {
              const on = shown === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => choose(o.key)}
                  className={twMerge(
                    'inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors sm:h-8',
                    on ? 'bg-[#0F5E63] text-white' : 'text-[#4A5568] hover:text-[#14213D]',
                  )}
                >
                  {o.icon}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* 7.25rem ≈ top bar (4rem) + this card's compact header: scrolled to the end of the page, the card runs
            down to the bottom edge of the screen (pages have no bottom padding) */}
        <div ref={scroller} className="custom-scrollbar bg-[#FBFAF7] p-3 sm:p-4 md:max-h-[max(420px,calc(100dvh-7.25rem))] md:overflow-auto">
          {shown === 'calendar' ? (
            calendar
          ) : shown === 'list' ? (
            list ?? <RecordList items={items} empty={empty} />
          ) : shown === 'cards' ? (
            <RecordCards items={items} empty={empty} />
          ) : (
            <StageBoard items={items} lanes={lanes} laneOf={laneOf} empty={empty} hideEmptyLanes={hideEmptyLanes} />
          )}
          <LoadMore scroller={scroller} onLoadMore={onLoadMore} hasMore={hasMore} loading={loadingMore} count={items.length} />
        </div>
      </Card>
      <RecordDetails item={peek} onClose={() => setPeek(null)} />
    </PeekContext.Provider>
  );
};
