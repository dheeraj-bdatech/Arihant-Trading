'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

interface Opt { value: string; label: string; disabled: boolean }
interface Open { el: HTMLSelectElement; opts: Opt[]; rect: DOMRect; up: boolean }

/**
 * Replaces the browser's unstyleable <select> popup with a themed listbox for every plain
 * <select> in the app (the `Select` component's own hidden select is `.sr-only` and skipped).
 * The select element stays the source of truth: we set its value and fire a bubbling change.
 */
export function NativeSelectMenu() {
  const [open, setOpen] = useState<Open | null>(null);
  const [hi, setHi] = useState(0);

  useEffect(() => {
    const show = (el: HTMLSelectElement) => {
      const rect = el.getBoundingClientRect();
      const opts = Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent || '', disabled: o.disabled }));
      setHi(Math.max(0, el.selectedIndex));
      setOpen({ el, opts, rect, up: window.innerHeight - rect.bottom < 280 && rect.top > 280 });
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const el = t?.closest?.('select') as HTMLSelectElement | null;
      if (!el || el.multiple || el.size > 1 || el.disabled || el.classList.contains('sr-only') || el.dataset.native != null) return;
      e.preventDefault();
      el.focus();
      show(el);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLSelectElement;
      if (el?.tagName === 'SELECT' && (e.key === 'Enter' || e.key === ' ') && !el.classList.contains('sr-only') && !el.multiple && el.dataset.native == null) {
        e.preventDefault();
        show(el);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.mt-select-panel--native')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(open.opts.length - 1, h + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(open.opts[hi]); }
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hi]);

  const pick = (o?: Opt) => {
    if (!open || !o || o.disabled) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(open.el, o.value);
    open.el.dispatchEvent(new Event('change', { bubbles: true }));
    open.el.dispatchEvent(new Event('input', { bubbles: true }));
    setOpen(null);
  };

  if (!open) return null;
  const { rect, up, opts, el } = open;
  const width = Math.max(rect.width, 190);
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  const style: React.CSSProperties = {
    position: 'fixed', left, width, zIndex: 120,
    ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  };
  return createPortal(
    <div className="mt-select-panel mt-select-panel--native" style={style}>
      <div role="listbox" className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
        {opts.map((o, i) => (
          <div
            key={`${o.value}-${i}`}
            role="option"
            aria-selected={i === el.selectedIndex}
            onMouseEnter={() => setHi(i)}
            onClick={() => pick(o)}
            style={{ ['--n' as string]: Math.min(i, 12) }}
            className={`flex items-center justify-between cursor-pointer text-[#14213D] ${i === hi ? 'bg-[#FFF6E6]' : ''} ${o.disabled ? 'opacity-40' : ''}`}
          >
            <span className="truncate pr-2">{o.label}</span>
            {i === el.selectedIndex && <Check className="h-3.5 w-3.5 shrink-0" />}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
