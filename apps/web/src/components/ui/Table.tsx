import React from 'react';
import { twMerge } from 'tailwind-merge';

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="edge relative w-full overflow-x-auto overflow-y-visible rounded-[14px] border border-[#DCD8CE] bg-white shadow-2xs custom-scrollbar">
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

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={twMerge(
      'transition-colors hover:bg-[#FBFAF7] data-[state=selected]:bg-[#E3EFEE] data-[selected=true]:bg-[#E3EFEE]',
      className,
    )}
    {...props}
  />
));
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
