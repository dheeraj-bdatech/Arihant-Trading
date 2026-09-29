import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full flex flex-col justify-end text-left">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold text-[#14213D] mb-1.5"
          >
            {label}
            {props.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={twMerge(
            'flex h-10 w-full rounded-[8px] border border-[#C9C4B8] bg-white px-3.5 py-2 text-xs font-normal text-[#14213D] placeholder:text-[#8A8578] transition-colors focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-[#881337] focus:border-[#881337] focus:ring-[#881337]/15',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-[#881337] font-medium mt-1">{error}</p>}
        {helperText && !error && (
          <p className="text-xs text-[#4A5568] font-normal mt-1">{helperText}</p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
