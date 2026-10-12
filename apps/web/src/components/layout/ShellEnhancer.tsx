'use client';

import { useEffect } from 'react';
import { NativeSelectMenu } from './NativeSelectMenu';

/**
 * Behaviour shared by every theme:
 *  - themed listbox for native <select>s (NativeSelectMenu)
 *  - labels every table cell with its column header so narrow screens can stack rows into cards
 */
export function ShellEnhancer() {
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const labelTables = () => {
      document.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        const heads = Array.from(table.tHead?.rows[0]?.cells ?? []).map((h) => (h.textContent || '').trim());
        if (heads.length <= 2) return;
        const rows = Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)).filter((r) => r.cells.length > 1); // single spanning cell = empty / message row
        for (const r of rows) Array.from(r.cells).forEach((c, i) => { if (heads[i] && c.dataset.label !== heads[i]) c.dataset.label = heads[i]; });
        table.dataset.stackable = '1';
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      timer = setTimeout(() => (raf = requestAnimationFrame(labelTables)), 80);
    };

    labelTables();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);
  return <NativeSelectMenu />;
}
