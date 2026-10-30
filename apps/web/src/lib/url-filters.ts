import type { ReadonlyURLSearchParams } from 'next/navigation';

/**
 * Dashboard deep links (/leads?followup=overdue, /visits?status=open&from=…): a list page takes its first filters from
 * the URL, before its first fetch. Read them from the router (useSearchParams), not window.location — after a
 * client-side link the address bar only changes once the new page has rendered — then drop the keys from the address
 * bar so a refresh, or the user's own filter changes, are not fighting stale parameters.
 */
export type UrlParams = URLSearchParams | ReadonlyURLSearchParams;

/** A real calendar day 'YYYY-MM-DD' (2026-02-30 and 2026-13-01 are not). */
export const isUrlDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);

/** A reader over `q`: the value of `key` when `ok` accepts it, else ''. */
export const urlPicker = (q: UrlParams) => (key: string, ok: (v: string) => boolean) => {
  const v = q.get(key) || '';
  return ok(v) ? v : '';
};

/** Removes these keys from the address bar once the page has read them, without navigating (as useOpenParam does). */
export function dropUrlParams(keys: readonly string[]) {
  const url = new URL(window.location.href);
  if (!keys.some((k) => url.searchParams.has(k))) return;
  keys.forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
