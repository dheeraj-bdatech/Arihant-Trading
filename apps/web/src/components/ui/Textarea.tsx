import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, id, rows = 3, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold text-[#14213D]"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={twMerge(
            'flex w-full rounded-[8px] border border-[#C9C4B8] bg-white px-3.5 py-2 text-xs font-normal text-[#14213D] placeholder:text-[#6B7280] transition-colors focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15 disabled:cursor-not-allowed disabled:opacity-50 resize-y',
            error && 'border-[#881337] focus:border-[#881337] focus:ring-[#881337]/15',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-[#881337] font-medium">{error}</p>}
        {helperText && !error && (
          <p className="text-xs text-[#4A5568] font-normal">{helperText}</p>
        )}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';
