'use client';

import React, { useEffect, useRef } from 'react';

/** Scrolling Madhubani border strip: paired fish, lotus and diamond chains. Decorative only. */
export const MithilaBand: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden className={`mithila-band ${className ?? ''}`} />
);

/**
 * Painted 3D backdrop. Pure CSS 3D (works without WebGL): motifs live on separate depth
 * planes, so the pointer tilts the whole scene and scrolling slides each plane at its own
 * speed (parallax). Pointer-transparent and skipped for reduced motion.
 */
export const MithilaDecor: React.FC = () => {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const set = (k: string, v: string) => el.style.setProperty(k, v);
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        set('--px', ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
        set('--py', ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
      });
    };
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.scrollTop === 'number') set('--sy', `${Math.min(t.scrollTop, 4000)}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    };
  }, []);

  return (
    <div ref={stage} aria-hidden className="mt-stage">
      <div className="mt-scene">
        {/* far plane */}
        <div className="mt-layer" style={{ ['--z' as string]: '-420px', ['--k' as string]: '-0.035' }}>
          <img src="/mithila/lotus.svg" alt="" className="mt-m mt-lotus-a" />
          <img src="/mithila/lotus.svg" alt="" className="mt-m mt-lotus-b" />
          <img src="/mithila/lotus.svg" alt="" className="mt-m mt-lotus-c" />
          <img src="/mithila/sun.svg" alt="" className="mt-m mt-sun-b" />
        </div>
        {/* mid plane */}
        <div className="mt-layer" style={{ ['--z' as string]: '-240px', ['--k' as string]: '-0.06' }}>
          <img src="/mithila/sun.svg" alt="" className="mt-m mt-sun" />
          <i className="mt-m mt-vine mt-vine-a" />
          <i className="mt-m mt-vine mt-vine-b" />
          <i className="mt-m mt-ring mt-ring-a" />
          <i className="mt-m mt-ring mt-ring-b" />
          <i className="mt-m mt-ring mt-ring-c" />
        </div>
        {/* near plane */}
        <div className="mt-layer" style={{ ['--z' as string]: '-90px', ['--k' as string]: '-0.1' }}>
          <img src="/mithila/fish.svg" alt="" className="mt-m mt-fish mt-fish-a" />
          <img src="/mithila/fish.svg" alt="" className="mt-m mt-fish mt-fish-b" />
          <img src="/mithila/fish.svg" alt="" className="mt-m mt-fish mt-fish-c" />
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`mt-m mt-cube mt-cube-${n}`}>
              {['f', 'b', 'l', 'r', 't', 'u'].map((f) => (
                <i key={f} className={`mt-face mt-face-${f}`} />
              ))}
            </span>
          ))}
          {[1, 2, 3, 4].map((n) => (
            <i key={n} className={`mt-m mt-gem mt-gem-${n}`} />
          ))}
        </div>
        {/* front plane: drifting painted dots */}
        <div className="mt-layer" style={{ ['--z' as string]: '70px', ['--k' as string]: '-0.16' }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <i key={i} className="mt-dot" style={{ ['--i' as string]: i }} />
          ))}
        </div>
      </div>
    </div>
  );
};
