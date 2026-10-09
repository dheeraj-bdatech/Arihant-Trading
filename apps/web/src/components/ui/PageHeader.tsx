import React from 'react';
import { twMerge } from 'tailwind-merge';
import { ToolbarActions } from './ToolbarBox';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Kept for accessibility only (screen-reader h1); no visible caption is rendered. */
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Page actions. Visible title/caption removed by design (the sidebar shows the module).
 * When the page has a ToolbarBox, actions render inside it next to the Filter icon;
 * otherwise they fall back to a compact floating bar.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  icon: _icon,
  actions,
  className,
  children,
  ...props
}) => {
  return (
    <div className={twMerge('contents', className)} {...props}>
      <h1 className="sr-only">{title}</h1>
      {children}
      {actions && <ToolbarActions>{actions}</ToolbarActions>}
    </div>
  );
};
