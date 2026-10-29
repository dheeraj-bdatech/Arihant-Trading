'use client';

/**
 * Customer picker over the whole organisation master: the list is searched on the server as the user types
 * (the API caps a page at 100, so a preloaded list silently hid every customer past the first page).
 * The picked organisation always stays in the options, whatever the current search shows.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Input, Select } from '@/components/ui';

export interface OrganisationPickerProps {
  label: string;
  /** Selected organisation id ('' for none). */
  value: string;
  onChange: (org: any | null) => void;
  /** The selected organisation's record when it is already known (e.g. a prefilled customer). */
  initial?: any | null;
  placeholder?: string;
  required?: boolean;
}

export const OrganisationPicker: React.FC<OrganisationPickerProps> = ({ label, value, onChange, initial, placeholder, required }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<any | null>(initial ?? null);

  useEffect(() => {
    if (initial?.id) setPicked(initial);
  }, [initial?.id]);

  useEffect(() => {
    if (!value) setPicked(null);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get('/organisations', { search: search.trim() || undefined, limit: 20 })
        .then((res: any) => !cancelled && setResults(res?.data || []))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  const options = useMemo(() => {
    const list = picked && picked.id === value && !results.some((o) => o.id === picked.id) ? [picked, ...results] : results;
    return [
      { label: placeholder || '— Select a client organisation —', value: '' },
      ...list.map((o) => ({ label: o.city ? `${o.name} · ${o.city}` : o.name, value: o.id })),
    ];
  }, [picked, results, value, placeholder]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#4A5568]" aria-hidden />
        <Input
          type="search"
          aria-label={`Search ${label.replace(/\s*\*\s*$/, '').toLowerCase()}`}
          placeholder={loading ? 'Searching customers…' : 'Type to search customers by name…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select
        label={label}
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          const org = id ? (picked?.id === id ? picked : results.find((o) => o.id === id)) || null : null;
          setPicked(org);
          onChange(org);
        }}
        options={options}
        required={required}
      />
    </div>
  );
};
