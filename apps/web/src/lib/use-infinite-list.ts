'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginatedResult } from '@arihant/shared';

type PageAnswer<T> = Partial<PaginatedResult<T>> | T[] | null | undefined;

const rowsOf = <T,>(res: PageAnswer<T>): T[] => (Array.isArray(res) ? res : res?.data ?? []);

const mergeById = <T extends { id?: unknown }>(prev: T[], next: T[]): T[] => {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...next.filter((r) => r.id == null || !seen.has(r.id))];
};

/**
 * Infinite register over a paged list endpoint. The API caps `limit` at 100, so long registers are
 * read page by page as the reader scrolls (see `onLoadMore` on RecordViews).
 *
 *  - `fetchPage(n)` must be a useCallback over the filters: a new identity starts again from page 1.
 *  - `loadMore()` appends the next page.
 *  - `refresh()` re-reads every page loaded so far in place (after an edit or a realtime event),
 *    so the reader is not dropped back to the top of the list.
 *  - Answers that arrive after the filters changed or a refresh started are discarded.
 */
export function useInfiniteList<T extends { id?: unknown }>(
  fetchPage: (page: number) => Promise<PageAnswer<T>>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const gen = useRef(0);
  const pages = useRef(0);
  const busy = useRef(false);

  const take = (answers: PageAnswer<T>[], upTo: number) => {
    const last = answers[answers.length - 1];
    const list = answers.reduce<T[]>((all, a) => mergeById(all, rowsOf(a)), []);
    pages.current = upTo;
    setLoaded(upTo);
    setRows(list);
    setTotal(Array.isArray(last) ? list.length : last?.total ?? list.length);
    setTotalPages(Array.isArray(last) ? 1 : last?.totalPages ?? 1);
  };

  // Filters changed (or the register was opened): start again from page 1.
  useEffect(() => {
    if (!enabled) return;
    const g = ++gen.current;
    setLoading(true);
    fetchPage(1)
      .then((res) => g === gen.current && take([res], 1))
      .catch((err) => {
        console.error('Failed to load list:', err);
        if (g === gen.current) take([[]], 1);
      })
      .finally(() => g === gen.current && setLoading(false));
  }, [fetchPage, enabled]);

  const refresh = useCallback(async () => {
    const g = ++gen.current;
    const upTo = Math.max(1, pages.current);
    try {
      const answers = await Promise.all(Array.from({ length: upTo }, (_, i) => fetchPage(i + 1)));
      if (g === gen.current) take(answers, upTo);
    } catch (err) {
      console.error('Failed to refresh list:', err);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [fetchPage]);

  const hasMore = loaded > 0 && loaded < totalPages;

  const loadMore = useCallback(async () => {
    if (busy.current || pages.current >= totalPages) return;
    busy.current = true;
    setLoadingMore(true);
    const g = gen.current;
    const next = pages.current + 1;
    try {
      const res = await fetchPage(next);
      if (g !== gen.current) return;
      pages.current = next;
      setLoaded(next);
      setRows((prev) => mergeById(prev, rowsOf(res)));
      if (!Array.isArray(res) && res) {
        if (res.total != null) setTotal(res.total);
        if (res.totalPages != null) setTotalPages(res.totalPages);
      }
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [fetchPage, totalPages]);

  return { rows, total, loading, loadingMore, hasMore, loadMore, refresh };
}
