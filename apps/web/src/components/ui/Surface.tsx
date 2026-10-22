import React from 'react';
import { twMerge } from 'tailwind-merge';
import { clsx } from 'clsx';

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: 'div' | 'section' | 'article' | 'aside' | 'span';
  bg?:
  | 'canvas'
  | 'card'
  | 'white'
  | 'muted'
  | 'secondary'
  | 'brand'
  | 'dangerSubtle'
  | 'successSubtle'
  | 'warningSubtle'
  | 'transparent';
  border?: 'default' | 'subtle' | 'brand' | 'danger' | 'warning' | 'success' | 'none';
  rounded?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  padding?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  shadow?: 'none' | '2xs' | 'xs' | 'sm' | 'md';
  hover?: boolean;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  (
    {
      as: Component = 'div',
      bg = 'card',
      border = 'default',
      rounded = 'lg',
      padding = 'none',
      shadow = 'none',
      hover = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const backgrounds = {
      canvas: 'bg-[#F6F5F1]',
      card: 'bg-white',
      white: 'bg-white',
      muted: 'bg-[#FBFAF7]',
      secondary: 'bg-[#E3EFEE]',
      brand: 'bg-[#0F5E63] text-white',
      dangerSubtle: 'bg-[#FCE8EC] text-[#881337]',
      successSubtle: 'bg-[#E3EFEE] text-[#0F5E63]',
      warningSubtle: 'bg-[#FBEBDD] text-[#7C2D12]',
      transparent: 'bg-transparent',
    };

    const borders = {
      default: 'border border-[#DCD8CE]',
      subtle: 'border border-[#ECE9E2]',
      brand: 'border border-[#0F5E63]',
      danger: 'border border-[#F3C7CF]',
      warning: 'border border-[#E9C9B4]',
      success: 'border border-[#D0E5E3]',
      none: 'border-0',
    };

    const roundeds = {
      none: 'rounded-none',
      xs: 'rounded-[4px]',
      sm: 'rounded-[6px]',
      md: 'rounded-[8px]',
      lg: 'rounded-[14px]',
      xl: 'rounded-[16px]',
      '2xl': 'rounded-[20px]',
      full: 'rounded-full',
    };

    const paddings = {
      none: '',
      xs: 'p-2',
      sm: 'p-3',
      md: 'p-4 sm:p-5',
      lg: 'p-6 sm:p-8',
      xl: 'p-8 sm:p-10',
    };

    const shadows = {
      none: '',
      '2xs': 'shadow-2xs',
      xs: 'shadow-xs',
      sm: 'shadow-sm',
      md: 'shadow-md',
    };

    return (
      <Component
        ref={ref as any}
        className={twMerge(
          clsx(
            backgrounds[bg],
            borders[border],
            roundeds[rounded],
            paddings[padding],
            shadows[shadow],
            hover && 'transition-all duration-150 hover:border-[#0F5E63] hover:shadow-xs',
            className,
          ),
        )}
        {...props}
      >
        {children}
      </Component>
    );
  },
);
Surface.displayName = 'Surface';

export const Box = Surface;
