/**
 * Link safety for free-text URLs (tender Drive folders, document links, portal URLs).
 *
 * Users type these links, so a stored value can be anything — including `javascript:` or `data:` URLs that run
 * script when rendered as `<a href>` and clicked. Only absolute http(s) links are ever rendered as hrefs.
 */

/** The URL normalised when it is an absolute http:// or https:// link; null for anything else (or empty). */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    // The URL parser strips embedded tabs / newlines and lower-cases the scheme, so "JaVa\tScript:" is caught too.
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Inline validation message for a link field: null when the value is empty (optional field) or a valid http(s)
 * link, otherwise a message naming the field.
 */
export function validateHttpUrl(value: string | null | undefined, label = 'Link'): string | null {
  if (!value || !value.trim()) return null;
  return safeHttpUrl(value) ? null : `${label} must be a full web address starting with https:// (or http://).`;
}
