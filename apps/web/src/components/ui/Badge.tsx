import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
  | 'default'
  | 'danger'
  | 'warning'
  | 'success'
  | 'info'
  | 'outline'
  | 'urgent'
  | 'cyber'
  | 'live';
  size?: 'sm' | 'md';
  hasDot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  children,
  variant = 'default',
  size = 'md',
  hasDot = false,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center font-medium rounded-full select-none border transition-colors text-[11px]';

  const variants = {
    default: 'bg-[#FBFAF7] text-[#4A5568] border-[#DCD8CE]',
    info: 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30 font-semibold',
    cyber: 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30 font-semibold',
    danger: 'bg-[#FCE8EC] text-[#881337] border-[#F3C7CF] font-semibold',
    warning: 'bg-[#FBEBDD] text-[#7C2D12] border-[#E9C9B4] font-semibold',
    success: 'bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30 font-semibold',
    outline: 'bg-transparent text-[#14213D] border-[#C9C4B8]',
    urgent: 'bg-[#9A3412] text-white border-transparent font-bold',
    live: 'bg-[#9A3412] text-white border-transparent font-bold',
  };

  const dotColors = {
    default: 'bg-[#4A5568]',
    danger: 'bg-[#881337]',
    warning: 'bg-[#9A3412]',
    success: 'bg-[#0F5E63]',
    info: 'bg-[#0F5E63]',
    cyber: 'bg-[#0F5E63]',
    outline: 'bg-[#6B7280]',
    urgent: 'bg-white',
    live: 'bg-white',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-0.5 text-[11px] gap-1.5',
  };

  const isUrgentOrLive = variant === 'urgent' || variant === 'live';

  return (
    <span
      className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
      {...props}
    >
      {(hasDot || isUrgentOrLive) && (
        <span
          className={twMerge(
            'h-1.5 w-1.5 rounded-full shrink-0',
            dotColors[variant],
            isUrgentOrLive && 'animate-ping',
          )}
        />
      )}
      {children}
    </span>
  );
};
