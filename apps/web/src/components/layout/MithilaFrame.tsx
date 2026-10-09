'use client';

import { useEffect } from 'react';
import { NativeSelectMenu } from './NativeSelectMenu';

/**
 * Applies the Mithila theme app-wide and frames hand-built panels consistently.
 *  - adds `mithila` to <body> while the signed-in app is mounted (so portal modals inherit it)
 *  - tags big bordered white boxes `.mt-panel` (vermilion line + dotted ochre inner rule) and
 *    leaves small ones (chips, icon boxes, inputs, buttons) alone, so every card matches.
 */
const CANDIDATES = '[class~="border"][class*="rounded-"]';
const SKIP_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SPAN', 'TD', 'TH', 'TR', 'TABLE', 'LABEL', 'IMG', 'SVG', 'I']);

export function MithilaFrame() {
  useEffect(() => {
    document.body.classList.add('mithila');
    const root = document.querySelector('main') || document.body;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** every body row of a table gets the height of its tallest row (min 68px) so lists read evenly */
    const equalizeRows = () => {
      document.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        const rows = Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)).filter((r) => r.cells.length > 1); // single spanning cell = empty / message row
        // label every cell with its column header so narrow screens can stack rows into cards
        const heads = Array.from(table.tHead?.rows[0]?.cells ?? []).map((h) => (h.textContent || '').trim());
        if (heads.length > 2) {
          for (const r of rows) Array.from(r.cells).forEach((c, i) => { if (heads[i] && c.dataset.label !== heads[i]) c.dataset.label = heads[i]; });
          table.dataset.stackable = '1';
        }
        if (rows.length === 0) return;
        table.style.setProperty('--row-h', '0px');
        let max = 0;
        for (const r of rows) max = Math.max(max, r.offsetHeight);
        table.style.setProperty('--row-h', `${Math.min(150, Math.max(68, Math.ceil(max)))}px`);
      });
    };

    const frame = () => {
      equalizeRows();
      root.querySelectorAll<HTMLElement>(CANDIDATES).forEach((el) => {
        if (SKIP_TAGS.has(el.tagName) || el.classList.contains('edge') || el.classList.contains('toolbar-box') || el.closest('.toolbar-slotted')) return;
        const big = el.offsetWidth >= 240 && el.offsetHeight >= 64;
        const bg = big ? getComputedStyle(el).backgroundColor : '';
        const solid = big && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        el.classList.toggle('mt-panel', big && solid);
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      timer = setTimeout(() => (raf = requestAnimationFrame(frame)), 80);
    };

    frame();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true }); // body, so tables inside portal popups are covered too
    window.addEventListener('resize', schedule);
    return () => {
      document.body.classList.remove('mithila');
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);
  return <NativeSelectMenu />;
}
