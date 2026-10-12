'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { APP_THEMES, useAppTheme, type AppSize } from '@/lib/theme-context';

const SIZES: { key: AppSize; label: string; aria: string }[] = [
  { key: 'md', label: 'A', aria: 'Normal text' },
  { key: 'lg', label: 'A+', aria: 'Large text' },
  { key: 'xl', label: 'A++', aria: 'Extra large text' },
];

/** Theme + text-size picker. Used in the app header and on the sign-in screen. */
export const AppearanceMenu: React.FC<{ className?: string; align?: 'left' | 'right' }> = ({ className = '', align = 'right' }) => {
  const { theme, setTheme, size, setSize } = useAppTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Appearance"
        aria-label="Appearance: theme and text size"
        className="app-hbtn relative flex items-center justify-center p-2 rounded-lg bg-white hover:bg-[#F6F5F1] border border-[#DCD8CE] text-[#4A5568] hover:text-[#0F5E63] transition-colors cursor-pointer"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && (
        <div role="dialog" aria-label="Appearance" className={`appearance-pop absolute top-[calc(100%+8px)] z-50 w-[300px] max-w-[calc(100vw-24px)] p-3 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="appearance-pop__label">Theme</div>
          <div className="grid gap-2">
            {APP_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={theme === t.key}
                onClick={() => setTheme(t.key)}
                className="appearance-opt"
              >
                <span className="appearance-opt__sw" style={{ background: t.swatch }} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[13px] font-bold leading-tight">{t.label}</span>
                  <span className="block text-[11px] opacity-70 leading-tight">{t.hint}</span>
                </span>
                {theme === t.key && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
          <div className="appearance-pop__label mt-3">Text size</div>
          <div className="grid grid-cols-3 gap-2">
            {SIZES.map((s) => (
              <button key={s.key} type="button" aria-label={s.aria} aria-pressed={size === s.key} onClick={() => setSize(s.key)} className="appearance-size">
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
