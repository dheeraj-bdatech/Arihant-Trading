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

    /** One label per column, resolving colSpan / rowSpan across every header row ("Leads · New"). */
    const columnLabels = (thead: HTMLTableSectionElement | null) => {
      const grid: string[][] = [];
      Array.from(thead?.rows ?? []).forEach((row, r) => {
        grid[r] ??= [];
        let c = 0;
        for (const cell of Array.from(row.cells)) {
          while (grid[r][c] !== undefined) c++;
          const text = (cell.textContent || '').trim();
          for (let dr = 0; dr < Math.max(cell.rowSpan, 1); dr++)
            for (let dc = 0; dc < Math.max(cell.colSpan, 1); dc++) (grid[r + dr] ??= [])[c + dc] = text;
          c += Math.max(cell.colSpan, 1);
        }
      });
      const width = Math.max(0, ...grid.map((g) => g.length));
      return Array.from({ length: width }, (_, i) =>
        [...new Set(grid.map((g) => g[i]).filter(Boolean))].join(' · '),
      );
    };

    const labelTables = () => {
      document.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        const heads = columnLabels(table.tHead);
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
