'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filters live in the URL query string so views are shareable and survive refresh.
 * Multi-value filters are stored comma-separated.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = params.get(k) || '';
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback(
    (patch: Partial<Record<K, string | string[] | null>>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [string, string | string[] | null][]) {
        const s = Array.isArray(v) ? v.filter(Boolean).join(',') : v;
        if (s) next.set(k, s);
        else next.delete(k);
      }
      if (opts.resetPage && !('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);
  const list = (k: K) => (values[k] ? values[k].split(',').filter(Boolean) : []);
  const activeCount = keys.filter((k) => k !== ('page' as K) && k !== ('sort_by' as K) && k !== ('sort_dir' as K) && values[k]).length;

  return { values, set, clear, list, activeCount, query: values as Record<string, string> };
}
