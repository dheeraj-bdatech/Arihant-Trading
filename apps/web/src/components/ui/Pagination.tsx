import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { Button } from './Button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  /** Rows per page, to show "21–40 of 132". */
  limit: number;
  onPage: (page: number) => void;
  /** Plural noun for the count, e.g. "people". */
  noun?: string;
  disabled?: boolean;
  className?: string;
}

/** Table footer for a server-paged list: the range and total on the left, Prev / Next on the right. */
export const Pagination: React.FC<PaginationProps> = ({ page, totalPages, total, limit, onPage, noun = 'records', disabled, className }) => {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav
      aria-label="Pagination"
      className={twMerge('flex flex-wrap items-center justify-between gap-2 border-t border-[#ECE9E2] bg-[#FBFAF7] px-4 py-2.5 text-xs text-[#4A5568]', className)}
    >
      <span>
        <span className="font-mono text-[#14213D]">
          {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}
        </span>{' '}
        of <span className="font-mono text-[#14213D]">{total.toLocaleString('en-IN')}</span> {noun}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <span className="font-mono">
            Page {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="h-10 md:h-8"
            disabled={disabled || page <= 1}
            onClick={() => onPage(page - 1)}
            leftIcon={<ChevronLeft className="h-4 w-4" />}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-10 md:h-8"
            disabled={disabled || page >= totalPages}
            onClick={() => onPage(page + 1)}
            rightIcon={<ChevronRight className="h-4 w-4" />}
          >
            Next
          </Button>
        </div>
      )}
    </nav>
  );
};
