import React from 'react';
import { twMerge } from 'tailwind-merge';

const SIZES = { xs: 14, sm: 20, md: 32, lg: 52 } as const;

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SIZES;
  /** `light` for use on filled (teal/terracotta) buttons. */
  tone?: 'primary' | 'light';
}

/**
 * Arihant "gyro" loader: two rings orbiting on different 3D axes around a pulsing core.
 * Replaces every stock border/arc spinner in the app.
 */
export const Spinner: React.FC<SpinnerProps> = ({ size = 'sm', tone = 'primary', className, style, ...props }) => (
  <span
    role="status"
    aria-label="Loading"
    className={twMerge('bos-gyro', tone === 'light' && 'bos-gyro--light', className)}
    style={{ ['--s' as string]: `${SIZES[size]}px`, ...style }}
    {...props}
  >
    <i className="bos-gyro__ring bos-gyro__ring--a" />
    <i className="bos-gyro__ring bos-gyro__ring--b" />
    <i className="bos-gyro__core" />
  </span>
);

/** Centered loader block for list/table/page loading states, with skeleton rows beneath. */
export const PageLoader: React.FC<{ label?: string; rows?: number; className?: string }> = ({
  label = 'Loading records',
  rows = 3,
  className,
}) => (
  <div className={twMerge('rounded-[14px] border border-[#DCD8CE] bg-white p-6 shadow-2xs', className)} aria-busy="true">
    <div className="flex flex-col items-center gap-3 py-4">
      <Spinner size="lg" />
      <p className="loader-label font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4A5568]">
        {label}
        <span className="loader-dots" aria-hidden />
      </p>
    </div>
    <div className="mt-2 space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="shimmer h-9 rounded-lg" style={{ opacity: 1 - i * 0.22 }} />
      ))}
    </div>
  </div>
);
