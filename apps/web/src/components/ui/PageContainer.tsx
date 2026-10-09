import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          'page-stagger relative space-y-5 pb-12 max-w-full',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

PageContainer.displayName = 'PageContainer';
