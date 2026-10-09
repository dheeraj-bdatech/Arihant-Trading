'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MoreVertical } from 'lucide-react';

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** Kebab "⋮" overflow menu for table rows: keeps a row to one line, secondary actions live in the panel. */
export const RowMenu: React.FC<{ items: RowMenuItem[]; label?: string; buttonLabel?: string }> = ({ items, label = 'Row actions', buttonLabel }) => {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.row-menu__panel') && !btn.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (visible.length === 0) return null;
  const up = open ? window.innerHeight - open.bottom < visible.length * 40 + 24 : false;

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(open ? null : btn.current!.getBoundingClientRect());
        }}
        className={`row-menu__btn ${buttonLabel ? 'row-menu__btn--label' : ''} ${open ? 'row-menu__btn--on' : ''}`}
      >
        {buttonLabel ? (
          <>
            <span>{buttonLabel}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        ) : (
          <MoreVertical className="h-4 w-4" />
        )}
      </button>
      {open &&
        createPortal(
          <div
            role="menu"
            className="mt-select-panel row-menu__panel"
            style={{ position: 'fixed', zIndex: 120, minWidth: 190, right: Math.max(8, window.innerWidth - open.right), ...(up ? { bottom: window.innerHeight - open.top + 6 } : { top: open.bottom + 6 }) }}
          >
            <div className="p-1.5 space-y-0.5">
              {visible.map((it, i) => (
                <button
                  key={it.key}
                  role="menuitem"
                  type="button"
                  disabled={it.disabled}
                  style={{ ['--n' as string]: i }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(null);
                    it.onSelect();
                  }}
                  className={`row-menu__item ${it.danger ? 'row-menu__item--danger' : ''}`}
                >
                  {it.icon}
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
