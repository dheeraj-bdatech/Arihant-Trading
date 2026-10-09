import React from 'react';
import { twMerge } from 'tailwind-merge';
import { ToolbarSlot } from './ToolbarBox';

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const FilterBar = React.forwardRef<HTMLDivElement, FilterBarProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <ToolbarSlot>
        <div
          ref={ref}
          className={twMerge(
            'p-4 bg-white border border-[#DCD8CE] rounded-[14px] shadow-2xs space-y-3',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </ToolbarSlot>
    );
  },
);

FilterBar.displayName = 'FilterBar';
