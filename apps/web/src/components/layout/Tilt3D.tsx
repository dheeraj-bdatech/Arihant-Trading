'use client';

import { useEffect } from 'react';

/**
 * Delegated 3D tilt: any element with `.tilt-3d` leans toward the pointer.
 * One listener for the whole app; no per-card state.
 */
export function Tilt3D() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    let active: HTMLElement | null = null;
    const reset = (el: HTMLElement | null) => {
      if (el) el.style.transform = '';
    };

    const onMove = (e: PointerEvent) => {
      let el = (e.target as HTMLElement | null)?.closest?.('.tilt-3d') as HTMLElement | null;
      if (!el) {
        // hand-built KPI tiles: small bordered boxes with no form controls or tables inside
        const tile = (e.target as HTMLElement | null)?.closest?.('.rounded-xl.border') as HTMLElement | null;
        if (tile && tile.offsetWidth <= 380 && tile.offsetHeight <= 190 && !tile.querySelector('input,select,textarea,table,button')) {
          tile.classList.add('tilt-3d', 'glare');
          el = tile;
        }
      }
      if (el !== active) {
        reset(active);
        active = el;
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
      el.style.transform = `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg) translateZ(6px)`;
    };
    const onLeave = () => {
      reset(active);
      active = null;
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      reset(active);
    };
  }, []);
  return null;
}
