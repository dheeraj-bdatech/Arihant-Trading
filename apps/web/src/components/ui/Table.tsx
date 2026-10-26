import React from 'react';
import { twMerge } from 'tailwind-merge';

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="ui-table-wrap relative w-full overflow-x-auto overflow-y-visible rounded-[14px] border border-[#DCD8CE] bg-white shadow-2xs custom-scrollbar">
    <table
      ref={ref}
      className={twMerge('w-full caption-bottom text-xs text-left', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={twMerge(
      'bg-[#FBFAF7] border-b border-[#DCD8CE] text-[11px] font-semibold text-[#4A5568] uppercase tracking-wider sticky top-0 z-10',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={twMerge('divide-y divide-[#ECE9E2] bg-white', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

/** Clicks on these inside a clickable row do their own thing and don't also open the row. */
const ROW_INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="menuitem"]';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Makes the whole row open the record: click anywhere (except its own buttons / links) or press Enter. */
  onOpen?: () => void;
  /** Accessible name for a clickable row, e.g. "Open Access Control System". */
  openLabel?: string;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, onOpen, openLabel, onClick, onKeyDown, ...props }, ref) => (
    <tr
      ref={ref}
      className={twMerge(
        'transition-colors hover:bg-[#FBFAF7] data-[state=selected]:bg-[#E3EFEE] data-[selected=true]:bg-[#E3EFEE]',
        onOpen && 'cursor-pointer focus-visible:bg-[#E3EFEE] focus-visible:outline-none',
        className,
      )}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? openLabel : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (!onOpen || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest(ROW_INTERACTIVE)) return;
        // Selecting text in a cell is not a click on the row
        if (window.getSelection()?.toString()) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (onOpen && e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={twMerge('h-10 px-4 text-left align-middle font-semibold text-[#4A5568]', className)}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={twMerge('p-3.5 align-middle text-[#14213D] text-xs', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';
