export const IST = 'Asia/Kolkata';

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { timeZone: IST, dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00+05:30`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { timeZone: IST, dateStyle: 'medium' });
}

export function apiMessages(err: any): string[] {
  const m = err?.data?.message;
  if (Array.isArray(m)) return m.map(String);
  if (typeof m === 'string') return [m];
  return [];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
