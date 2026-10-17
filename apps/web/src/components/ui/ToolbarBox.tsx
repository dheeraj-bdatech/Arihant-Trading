'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

/**
 * Tiny module-level store so a page's PageHeader (actions) and filter strips can find the
 * ToolbarBox they belong to, regardless of where they sit in the React tree.
 */
type Slots = { actions: HTMLElement | null; filters: HTMLElement | null; filterCount: number; dock: HTMLElement | null; dockPriority: number };
let slots: Slots = { actions: null, filters: null, filterCount: 0, dock: null, dockPriority: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const patch = (p: Partial<Slots>) => {
  slots = { ...slots, ...p };
  emit();
};
const useSlots = () => useSyncExternalStore(subscribe, () => slots, () => slots);

/**
 * One box for a page: tabs/search on the left; the Filter icon and every page action
 * (Create, Sync, Export…) on the right. Filter strips (<FilterBar>/<ToolbarSlot>) fold
 * away behind the Filter icon.
 */
export const ToolbarBox: React.FC<{ children?: React.ReactNode; row?: boolean; defaultOpen?: boolean; className?: string }> = ({
  children,
  defaultOpen = false,
  className,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const { filterCount } = useSlots();
  const actionsRef = useCallback((el: HTMLDivElement | null) => patch({ actions: el }), []);
  const filtersRef = useCallback((el: HTMLDivElement | null) => patch({ filters: el }), []);

  return (
    <div className={twMerge('toolbar-box', className)}>
      <div className="toolbar-box__head">
        <div className="toolbar-box__main">{children}</div>
        <div className="toolbar-box__tools">
          {filterCount > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label="Toggle filters"
              title="Filters"
              className={twMerge('toolbar-filter-btn', open && 'toolbar-filter-btn--on')}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>
          )}
          <div ref={actionsRef} className="toolbar-box__actions" />
        </div>
      </div>
      <div ref={filtersRef} className={twMerge('toolbar-box__slot', !open && 'toolbar-box__slot--closed')} />
    </div>
  );
};

/** Renders children inside the page's ToolbarBox filter drawer when one is mounted; otherwise inline. */
export const ToolbarSlot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { filters } = useSlots();
  useEffect(() => {
    patch({ filterCount: slots.filterCount + 1 });
    return () => patch({ filterCount: Math.max(0, slots.filterCount - 1) });
  }, []);
  if (!filters) return <>{children}</>;
  return createPortal(<div className="toolbar-slotted">{children}</div>, filters);
};

/** The page's filter row: the nearest horizontal flex row around a control (at most two levels up). */
function rowOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  for (let i = 0; node && i < 2; i++, node = node.parentElement) {
    if (/(^|\s)(\w+:)?flex-row(\s|$)/.test(node.className)) return node;
  }
  return el.parentElement;
}

/**
 * Marks the row a control sits in (the page's filter / tabs row) as the place page actions dock.
 * Higher priority wins (View menu 3 > other filter menus 2 > tabs 1), then the first one mounted;
 * rows inside dialogs are ignored.
 */
export function useActionDock(ref: React.RefObject<HTMLElement | null>, priority = 1) {
  useEffect(() => {
    const el = ref.current;
    const row = el && rowOf(el);
    if (!priority || !row || row.closest('[role="dialog"]') || (slots.dock && slots.dockPriority >= priority)) return;
    patch({ dock: row, dockPriority: priority });
    return () => {
      if (slots.dock === row) patch({ dock: null, dockPriority: 0 });
    };
  }, [ref, priority]);
}

/**
 * Renders page actions into the ToolbarBox action area, else at the right end of the page's
 * filter / tabs row (see useActionDock); falls back to a floating pill when the page has neither.
 */
export const ToolbarActions: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const { actions, dock } = useSlots();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (actions || !dock) return;
    const el = document.createElement('div');
    el.className = 'toolbar-dock';
    // A row that is not a flex row yet (e.g. a lone tab strip) becomes one, so actions sit beside it.
    const madeRow = getComputedStyle(dock).display !== 'flex';
    if (madeRow) dock.classList.add('toolbar-dock-row');
    dock.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
      if (madeRow) dock.classList.remove('toolbar-dock-row');
      setHost(null);
    };
  }, [actions, dock]);
  if (actions) return createPortal(<>{children}</>, actions);
  if (host) return createPortal(<>{children}</>, host);
  return (
    <div className={twMerge('ml-auto flex w-fit max-w-full flex-wrap items-center justify-end gap-2.5 rounded-[14px] border border-[#DCD8CE] bg-white/80 px-3 py-2 shadow-2xs backdrop-blur', className)}>
      {children}
    </div>
  );
};
