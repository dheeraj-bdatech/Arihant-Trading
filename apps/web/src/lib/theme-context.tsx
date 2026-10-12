'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type AppTheme = 'ios' | 'material' | 'clay';
export type AppSize = 'md' | 'lg' | 'xl';

/**
 * The app ships one visual language: Material You (Material 3).
 * theme.css still carries the iOS Glass and Soft Clay token sets; add them back to this list
 * (and widen THEME_BOOT_SCRIPT) to offer them again.
 */
export const APP_THEMES: { key: AppTheme; label: string; hint: string; swatch: string }[] = [
  { key: 'material', label: 'Material You', hint: 'Tonal purple, rounded', swatch: 'linear-gradient(135deg,#eaddff,#f3edf7 50%,#6750a4)' },
];

export const DEFAULT_THEME: AppTheme = 'material';
const THEME_KEY = 'app-theme-v2'; // v2: previous test choices (iOS / Clay) are ignored
const SIZE_KEY = 'app-size';

/** runs before first paint (inlined in <head>) so there is no flash of the wrong theme */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('${THEME_KEY}'),s=localStorage.getItem('${SIZE_KEY}');d.setAttribute('data-app-theme','material');if(s==='lg'||s==='xl')d.setAttribute('data-app-size',s);}catch(e){}})();`;

interface ThemeCtx {
  theme: AppTheme;
  size: AppSize;
  setTheme: (t: AppTheme) => void;
  setSize: (s: AppSize) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<AppTheme>(DEFAULT_THEME);
  const [size, setSizeState] = useState<AppSize>('md');

  // pick up what the boot script already applied
  useEffect(() => {
    const d = document.documentElement;
    const t = d.getAttribute('data-app-theme') as AppTheme | null;
    if (t && APP_THEMES.some((x) => x.key === t)) setThemeState(t);
    const s = d.getAttribute('data-app-size');
    if (s === 'lg' || s === 'xl') setSizeState(s);
  }, []);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-app-theme', t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }, []);

  const setSize = useCallback((s: AppSize) => {
    setSizeState(s);
    if (s === 'md') document.documentElement.removeAttribute('data-app-size');
    else document.documentElement.setAttribute('data-app-size', s);
    try {
      localStorage.setItem(SIZE_KEY, s);
    } catch {}
  }, []);

  return <Ctx.Provider value={{ theme, size, setTheme, setSize }}>{children}</Ctx.Provider>;
};

export function useAppTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAppTheme must be used inside ThemeProvider');
  return c;
}
