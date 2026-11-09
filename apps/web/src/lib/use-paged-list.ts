'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginatedResult } from '@arihant/shared';

type PageAnswer<T> = Partial<PaginatedResult<T>> | T[] | null | undefined;

/**
 * One page of a server-paged list at a time (page controls, not infinite scroll).
 *
 *  - `fetchPage(page)` must be a useCallback over the filters: a new identity goes back to page 1.
 *  - `refresh()` re-reads the current page in place (after an edit), stepping back a page if it emptied.
 *  - Answers that arrive after the filters or page changed are discarded.
 */
export function usePagedList<T>(fetchPage: (page: number) => Promise<PageAnswer<T>>, { enabled = true }: { enabled?: boolean } = {}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const load = useCallback(
    async (n: number) => {
      const mine = ++gen.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchPage(n);
        if (mine !== gen.current) return;
        const data = Array.isArray(res) ? res : res?.data ?? [];
        const count = Array.isArray(res) ? res.length : Number(res?.total ?? data.length);
        const pages = Array.isArray(res) ? 1 : Number(res?.totalPages ?? 1) || 1;
        // the last row of the last page was deleted: show the page before it
        if (data.length === 0 && n > 1 && n > pages) {
          setPage(pages);
          return;
        }
        setRows(data);
        setTotal(count);
        setTotalPages(pages);
      } catch (err: any) {
        if (mine === gen.current) setError(err?.message || 'Could not load this list');
      } finally {
        if (mine === gen.current) setLoading(false);
      }
    },
    [fetchPage],
  );

  // new filters → page 1
  useEffect(() => setPage(1), [fetchPage]);
  useEffect(() => {
    if (enabled) void load(page);
  }, [enabled, load, page]);

  const refresh = useCallback(() => load(page), [load, page]);

  return { rows, total, totalPages, page, setPage, loading, error, refresh };
}
