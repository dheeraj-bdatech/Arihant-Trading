'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const ACTIVE = '[aria-selected="true"], [aria-checked="true"], [aria-current="page"], [data-active="true"]';

export interface ScrollStripProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  children: React.ReactNode;
  /** Classes for the outer box (borders, background, margins). `className` styles the sliding row. */
  wrapperClassName?: string;
  /** Change this when the selection changes to slide the active item (aria-selected…) into view. */
  activeKey?: unknown;
}

/**
 * Sideways slider for tab strips and chip rows that do not fit, e.g. an 11-tab dossier on a phone.
 * Swipe, trackpad or shift-scroll it; arrow buttons and faded edges show only on the side that has
 * more. The selected item is kept in view.
 *
 * overflowX is inline because theme.css resets `.overflow-x-auto` below 1180px (for stacked tables).
 */
export const ScrollStrip: React.FC<ScrollStripProps> = ({ children, className, wrapperClassName, activeKey, style, ...rest }) => {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, children]);

  // Keep the selected tab/chip visible (only this row moves, never the page or dialog).
  useIsoLayoutEffect(() => {
    const el = track.current;
    const on = el?.querySelector<HTMLElement>(ACTIVE);
    if (!el || !on) return;
    const pad = 36; // clear of the arrow button
    const start = on.offsetLeft;
    const end = start + on.offsetWidth;
    if (start < el.scrollLeft + pad) el.scrollTo({ left: Math.max(0, start - pad), behavior: 'smooth' });
    else if (end > el.scrollLeft + el.clientWidth - pad) el.scrollTo({ left: end - el.clientWidth + pad, behavior: 'smooth' });
  }, [activeKey]);

  const slide = (dir: -1 | 1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const fade = 28;
  // 'none' (not undefined) so a theme fade on tab rows does not dim a strip that already fits.
  const mask =
    edge.left || edge.right
      ? `linear-gradient(to right, ${edge.left ? `transparent 0, #000 ${fade}px` : '#000 0'}, ${edge.right ? `#000 calc(100% - ${fade}px), transparent 100%` : '#000 100%'})`
      : 'none';

  const arrow = (dir: -1 | 1) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
      onClick={() => slide(dir)}
      className={twMerge(
        'absolute top-1/2 z-[2] inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[#DCD8CE] bg-white text-[#14213D] shadow-sm transition-opacity hover:border-[#0F5E63] hover:text-[#0F5E63]',
        dir < 0 ? 'left-0' : 'right-0',
      )}
    >
      {dir < 0 ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );

  return (
    <div className={twMerge('relative min-w-0', wrapperClassName)}>
      <div
        ref={track}
        className={twMerge('relative flex min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
        style={{ overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', WebkitMaskImage: mask, maskImage: mask, ...style }}
        {...rest}
      >
        {children}
      </div>
      {edge.left && arrow(-1)}
      {edge.right && arrow(1)}
    </div>
  );
};
