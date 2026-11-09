'use client';

import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui';

/** What the row needs from a useInfiniteList register. */
type PagedList = {
  rows: unknown[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

/**
 * The end of a paged section on the visits page. With `auto` it reads the next page as it scrolls into view and
 * keeps reading while it stays in view (the last list on a tab); without it (a section with more sections below)
 * the reader asks for more, so scrolling past does not keep growing it. The button is also the keyboard fallback.
 */
export function LoadMoreRow({ list, auto = false }: { list: PagedList; auto?: boolean }) {
  const { rows, total, hasMore, loadingMore, loadMore } = list;
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = marker.current;
    if (!auto || !el || !hasMore || loadingMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [auto, hasMore, loadingMore, loadMore, rows.length]);

  if (!hasMore) return null;
  return (
    <div ref={marker} className="flex justify-center pt-1">
      <Button variant="secondary" size="sm" isLoading={loadingMore} onClick={loadMore}>
        Load more ({rows.length} of {total})
      </Button>
    </div>
  );
}
