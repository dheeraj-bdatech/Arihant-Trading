'use client';

/**
 * Shared pieces of the management reports hub (/reports/*): the report tabs, the URL-backed period / territory
 * filters, the data hook and the CSV export. Every figure comes from GET /reports/* — the pages only lay it out.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, ClipboardList, Gauge, Receipt, TableProperties, Wrench } from 'lucide-react';
import { canViewReport, formatIndianCurrency, type ReportKey, type ReportRate, type ReportTerritoryFilters } from '@arihant/shared';
import { api } from '@/lib/api';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { FilterBar, Input, Select, Tabs } from '@/components/ui';
import { useUrlFilters } from '@/app/(app)/expenses/_lib/use-url-filters';

/** Raw record registers (the original consolidated reports page). */
export const REGISTER_ROLES = ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'];

export const REPORT_TABS: { key: ReportKey | 'registers'; href: string; label: string; icon: React.ReactNode }[] = [
  { key: 'pipeline', href: '/reports/pipeline', label: 'Sales pipeline', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { key: 'service', href: '/reports/service', label: 'Service', icon: <Wrench className="h-3.5 w-3.5" /> },
  { key: 'expenses', href: '/reports/expenses', label: 'Expenses', icon: <Receipt className="h-3.5 w-3.5" /> },
  { key: 'productivity', href: '/reports/productivity', label: 'Productivity', icon: <Gauge className="h-3.5 w-3.5" /> },
  { key: 'registers', href: '/reports/registers', label: 'Registers', icon: <TableProperties className="h-3.5 w-3.5" /> },
];

export const canOpen = (role: string | undefined, key: ReportKey | 'registers') =>
  key === 'registers' ? !!role && REGISTER_ROLES.includes(role) : canViewReport(role, key);

/** The report tabs this role may open; the current one highlighted. */
export const ReportsNav: React.FC<{ role: string | undefined }> = ({ role }) => {
  const router = useRouter();
  const pathname = usePathname();
  const tabs = REPORT_TABS.filter((t) => canOpen(role, t.key));
  const active = tabs.find((t) => pathname.startsWith(t.href))?.key ?? '';
  return (
    <div className="-mx-1 overflow-x-auto px-1 custom-scrollbar">
      <Tabs
        variant="underline"
        className="min-w-max"
        activeTab={active}
        onChange={(id) => {
          const t = tabs.find((x) => x.key === id);
          if (t) router.push(t.href);
        }}
        tabs={tabs.map((t) => ({ id: t.key, label: t.label, icon: t.icon }))}
      />
    </div>
  );
};

export const ReportsDenied: React.FC = () => (
  <div className="rounded-[14px] border border-[#DCD8CE] bg-white p-8 text-center">
    <ClipboardList className="mx-auto h-8 w-8 text-[#6B7280]" aria-hidden />
    <p className="mt-3 font-serif text-lg text-[#14213D]">This report is not available for your role</p>
    <p className="mt-1 text-xs text-[#4A5568]">Pick another report above, or ask an administrator for access.</p>
  </div>
);

/* ------------------------------------------------------------------------------------------------ period presets -- */

const fyStart = (day: string) => (day.slice(5, 7) >= '04' ? `${day.slice(0, 4)}-04-01` : `${Number(day.slice(0, 4)) - 1}-04-01`);
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
/** First day of the Indian-FY quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar) `day` is in. */
const quarterStart = (day: string) => {
  const m = Number(day.slice(5, 7));
  const qm = m >= 4 ? 4 + Math.floor((m - 4) / 3) * 3 : 1;
  return `${day.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`;
};

export function periodPresets(today = istToday()) {
  const lastMonthEnd = addIsoDays(monthStart(today), -1);
  const lastFyEnd = addIsoDays(fyStart(today), -1);
  return [
    { key: 'month', label: 'This month', from: monthStart(today), to: today },
    { key: 'last_month', label: 'Last month', from: monthStart(lastMonthEnd), to: lastMonthEnd },
    { key: 'quarter', label: 'This quarter', from: quarterStart(today), to: today },
    { key: 'fy', label: 'Financial year to date', from: fyStart(today), to: today },
    { key: 'last_fy', label: 'Last financial year', from: fyStart(lastFyEnd), to: lastFyEnd },
  ];
}

/* --------------------------------------------------------------------------------------------------- filters -- */

const BASE_KEYS = ['from', 'to', 'zone_id', 'region_id'] as const;

/**
 * Report filters held in the URL (shareable, survive refresh). Default period: financial year to date, the same
 * default the API applies, so an empty query string and the shown dates always agree.
 */
export function useReportFilters<K extends string>(extra: readonly K[] = []) {
  const keys = useMemo(() => [...BASE_KEYS, ...extra], [extra]);
  const f = useUrlFilters(keys as readonly (K | (typeof BASE_KEYS)[number])[]);
  const fy = periodPresets().find((p) => p.key === 'fy')!;
  const from = f.values.from || fy.from;
  const to = f.values.to || fy.to;
  const query = useMemo(() => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.values)) if (v) q[k] = v as string;
    return q;
  }, [f.values]);
  return { ...f, from, to, query, invalid: from > to };
}

/** What the filter bar reads from useReportFilters. */
export interface ReportFilterState {
  from: string;
  to: string;
  invalid: boolean;
  set: (patch: Partial<Record<(typeof BASE_KEYS)[number], string | null>>) => void;
}

/** Period presets + dates, then zone / region when the caller may pick them. `children` adds report-specific controls. */
export const ReportFilterBar: React.FC<{
  filters: ReportFilterState;
  territory?: ReportTerritoryFilters | null;
  children?: React.ReactNode;
}> = ({ filters: f, territory, children }) => {
  const presets = periodPresets();
  const preset = presets.find((p) => p.from === f.from && p.to === f.to)?.key ?? 'custom';
  const zoneId = territory?.zone_id ?? '';
  const regions = (territory?.regions ?? []).filter((r) => !zoneId || r.zone_id === zoneId);
  return (
    <FilterBar>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        <div className="lg:w-[210px]">
          <Select
            label="Period"
            value={preset}
            onChange={(e) => {
              const p = presets.find((x) => x.key === e.target.value);
              if (p) f.set({ from: p.from, to: p.to });
            }}
          >
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom" disabled>
              Custom range
            </option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:w-[300px]">
          <Input label="From" type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && f.set({ from: e.target.value })} />
          <Input label="To" type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && f.set({ to: e.target.value })} />
        </div>
        {territory?.can_pick_zone && (
          <div className="lg:w-[190px]">
            <Select label="Zone" value={zoneId} onChange={(e) => f.set({ zone_id: e.target.value || null, region_id: null })}>
              <option value="">All zones</option>
              {territory.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {territory?.can_pick_region && regions.length > 0 && (
          <div className="lg:w-[200px]">
            <Select label="Region" value={territory.region_id ?? ''} onChange={(e) => f.set({ region_id: e.target.value || null })}>
              <option value="">{territory.can_pick_zone ? 'All regions' : 'Whole territory'}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {children}
      </div>
      {f.invalid && <p className="text-xs text-[#881337]">“From” must be on or before “To”.</p>}
    </FilterBar>
  );
};

/* ------------------------------------------------------------------------------------------------------ data -- */

/** GET a report; keeps the last result on screen while a new filter loads. */
export function useReport<T>(path: string, query: Record<string, string>, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(query);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path, JSON.parse(key))
      .then((r) => alive && setData(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load this report.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, key, enabled, nonce]);
  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

/* ------------------------------------------------------------------------------------------------ formatting -- */

/** ₹ in Lakh / Crore once it is large enough to need it. */
export const money = (v: number | null | undefined) => formatIndianCurrency(v ?? 0, true);
export const pctText = (r: number | null | undefined) => (r === null || r === undefined ? '—' : `${r}%`);
export const rateSub = (r: ReportRate, of: string) => (r.whole > 0 ? `${r.part} of ${r.whole} ${of}` : `No ${of} in this period`);
export const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** Downloads rows as a UTF-8 CSV (Excel-safe: BOM, quoted cells, formula-injection guard). */
export function downloadCsv(fileName: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '""';
    const s = String(v);
    const safe = typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}_${istToday()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
