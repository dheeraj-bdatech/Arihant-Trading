import React from 'react';
import { useCountUp } from './CountUp';
import { twMerge } from 'tailwind-merge';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  title?: string;
  value: string | number | null | undefined;
  subtext?: string;
  icon?: React.ReactNode;
  valueColor?: 'default' | 'primary' | 'emerald' | 'amber' | 'rose';
  variant?: 'default' | 'primary' | 'emerald' | 'amber' | 'rose';
  progress?: number;
  progressColor?: 'primary' | 'emerald' | 'amber' | 'rose';
  badge?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  title,
  value,
  subtext,
  icon,
  valueColor,
  variant = 'default',
  progress,
  progressColor = 'primary',
  badge,
  className,
  ...props
}) => {
  const animatedValue = useCountUp(value);
  const displayLabel = label || title || '';
  const effectiveColor = valueColor || variant;

  const valueColorCls = {
    default: 'text-[#14213D]',
    primary: 'text-[#0F5E63]',
    emerald: 'text-[#0F5E63]',
    amber: 'text-[#9A3412]',
    rose: 'text-[#881337]',
  }[effectiveColor];

  const progressColorCls = {
    primary: 'bg-[#0F5E63]',
    emerald: 'bg-[#0F5E63]',
    amber: 'bg-[#9A3412]',
    rose: 'bg-[#881337]',
  }[progressColor];

  return (
    <div
      className={twMerge(
        'tilt-3d glare edge kpi-tile',
        'p-3 sm:p-4 bg-white border border-[#DCD8CE] rounded-[14px] shadow-2xs hover:border-[#0F5E63] transition-all duration-150 flex flex-col justify-between relative overflow-hidden',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-[#4A5568] line-clamp-2 leading-tight">
          {displayLabel}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
          {icon && (
            <span className="kpi-icon p-1.5 rounded-[8px] bg-[#FBFAF7] border border-[#DCD8CE] text-[#0F5E63]">
              {icon}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className={twMerge('text-xl sm:text-2xl font-mono font-bold tracking-tight', valueColorCls)}>
          {animatedValue}
        </div>

        {progress !== undefined && (
          <div className="w-full bg-[#ECE9E2] h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={twMerge('h-full rounded-full transition-all duration-300 bar-grow', progressColorCls)}
              style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
            />
          </div>
        )}

        {subtext && (
          <span className="text-xs text-[#4A5568] mt-1.5 block font-medium">
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
};

export interface StatGridProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4 | 5;
  cols?: 2 | 3 | 4 | 5;
  children: React.ReactNode;
}

export const StatGrid: React.FC<StatGridProps> = ({
  columns,
  cols = 4,
  children,
  className,
  ...props
}) => {
  const effectiveCols = (columns || cols) as 2 | 3 | 4 | 5;
  const colCls = {
    2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
    3: 'grid grid-cols-1 md:grid-cols-3 gap-4',
    4: 'grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4',
    5: 'grid grid-cols-2 md:grid-cols-5 gap-2.5 sm:gap-4',
  }[effectiveCols] || 'grid grid-cols-2 md:grid-cols-4 gap-4';

  return (
    <div className={twMerge(colCls, className)} {...props}>
      {children}
    </div>
  );
};
