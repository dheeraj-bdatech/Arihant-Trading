'use client';

import { useEffect, useRef } from 'react';

/**
 * Cross-module deep links: `/service?open=<id>` (or another param) opens that record once the page is ready,
 * then drops the param from the address bar so a refresh or back-navigation does not reopen it.
 * Reads window.location directly so list pages need no Suspense boundary for useSearchParams.
 */
export function useOpenParam(open: (id: string) => unknown, ready = true, param = 'open') {
  const done = useRef(false);
  const handler = useRef(open);
  handler.current = open;
  useEffect(() => {
    if (done.current || !ready) return;
    const id = new URLSearchParams(window.location.search).get(param);
    if (!id) return;
    done.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    void handler.current(id);
  }, [ready, param]);
}
