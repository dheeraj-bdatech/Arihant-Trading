/**
 * Case-insensitive "contains" pattern for a SQL LIKE on lower(...): the user's text is matched literally, so a
 * typed `%`, `_` or `\` is not a wildcard (Postgres LIKE escapes with a backslash by default).
 */
export function containsPattern(text: string): string {
  return `%${text.trim().toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}
