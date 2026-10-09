import React, { useEffect, useRef, useState } from 'react';

/** Animates the first number in a value ("₹12.5 L", "42", "1,240") from 0 on mount/change. */
export function useCountUp(value: string | number | null | undefined): string {
  // never print the literal "undefined"/"null" while data is still loading
  const text = value === undefined || value === null || /(^|\s)(undefined|null|NaN)(\s|$)/.test(String(value)) ? '—' : String(value);
  const [out, setOut] = useState(text);
  const raf = useRef(0);
  useEffect(() => {
    const m = text.match(/^(\D*?)(-?\d[\d,]*\.?\d*)(.*)$/s);
    if (!m || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOut(text);
      return;
    }
    const [, pre, numStr, post] = m;
    const target = parseFloat(numStr.replace(/,/g, ''));
    if (!Number.isFinite(target) || Math.abs(target) > 1e12) {
      setOut(text);
      return;
    }
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;
    const grouped = numStr.includes(',');
    const start = performance.now();
    const dur = 700;
    const fmt = (n: number) => {
      const f = n.toFixed(decimals);
      return grouped ? Number(f).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : f;
    };
    const step = (now: number) => {
      const k = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      setOut(`${pre}${fmt(target * eased)}${post}`);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setOut(text);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [text]);
  return out;
}

/** Drop-in text wrapper: counts the first number inside its children up from 0. */
export const CountUp: React.FC<React.HTMLAttributes<HTMLSpanElement> & { as?: 'div' | 'span' }> = ({
  children,
  as: Tag = 'div',
  ...props
}) => {
  const text = React.Children.toArray(children).join('');
  const animated = useCountUp(text);
  return <Tag {...(props as React.HTMLAttributes<HTMLElement>)}>{animated}</Tag>;
};
