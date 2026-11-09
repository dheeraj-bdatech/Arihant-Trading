import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type SectorOption = { value: string; label: string };

/**
 * Customer sectors used by lead registration and quick customer creation. The System Administrator maintains the
 * live list (Admin → Client categories); this built-in copy is what pickers show until that list loads, or if it fails.
 */
export const SECTOR_OPTIONS: SectorOption[] = [
  { value: 'Defence', label: 'Defence (Army / Navy / Air Force)' },
  { value: 'Police / Paramilitary', label: 'Police / Paramilitary (CRPF, BSF, CISF, ITBP, SSB)' },
  { value: 'State Police', label: 'State Police & Special Forces' },
  { value: 'Railways', label: 'Railways & Metro Transit' },
  { value: 'Security / Intelligence', label: 'Intelligence & Security Agencies' },
  { value: 'Nuclear & Energy', label: 'Nuclear, Power & Critical Infrastructure' },
  { value: 'Aviation & Airports', label: 'Aviation & Airport Security' },
  { value: 'Prisons & Correctional', label: 'Prisons & Correctional Services' },
  { value: 'PSU / Government', label: 'Public Sector Undertaking (PSU) / Govt' },
  { value: 'Corporate Security', label: 'Corporate & Industrial Security' },
  { value: 'Other', label: 'Other Sector' },
];

let cached: SectorOption[] | null = null;
let loading: Promise<SectorOption[]> | null = null;

/** Forget the loaded list, so the next picker reads the admin's latest categories. */
export function clearSectorOptions() {
  cached = null;
  loading = null;
}

/** The active client categories from the master list, loaded once per page load and shared by every picker. */
export function useSectorOptions(): SectorOption[] {
  const [options, setOptions] = useState<SectorOption[]>(cached ?? SECTOR_OPTIONS);
  useEffect(() => {
    if (cached) return setOptions(cached);
    loading ??= api
      .get('/masters/client-categories')
      .then((res: any) => {
        const rows: any[] = Array.isArray(res) ? res : res?.data ?? [];
        const list = rows.map((c) => ({ value: String(c.name), label: String(c.label || c.name) }));
        if (list.length) cached = list;
        return cached ?? SECTOR_OPTIONS;
      })
      .catch(() => {
        loading = null;
        return SECTOR_OPTIONS;
      });
    let alive = true;
    loading.then((list) => alive && setOptions(list));
    return () => {
      alive = false;
    };
  }, []);
  return options;
}

/** The options plus `current` when a record still carries a category that was hidden or renamed since. */
export function withSector(options: SectorOption[], current: string | null | undefined): SectorOption[] {
  return current && !options.some((o) => o.value === current) ? [...options, { value: current, label: current }] : options;
}
