import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: React.ReactNode;
  description?: string;
  size?: 'sm' | 'md';
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, size = 'md', disabled, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const labelId = `${inputId}-label`;
    const descriptionId = `${inputId}-description`;

    const sizeCls = {
      sm: 'h-3.5 w-3.5 rounded',
      md: 'h-4 w-4 rounded-[4px]',
    }[size];

    return (
      <label
        htmlFor={inputId}
        className={twMerge(
          'inline-flex items-start gap-2 select-none cursor-pointer text-left',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          id={inputId}
          disabled={disabled}
          // The wrapping <label> alone would read label + description as one long name:
          // name the box by its label and announce the description separately.
          aria-label={typeof label === 'string' ? label : undefined}
          aria-labelledby={label && typeof label !== 'string' ? labelId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          className={twMerge(
            'mt-0.5 border border-[#C9C4B8] text-[#0F5E63] accent-[#0F5E63] bg-white transition-colors focus:ring-2 focus:ring-[#0F5E63]/20 focus:border-[#0F5E63] cursor-pointer shrink-0',
            sizeCls,
          )}
          {...props}
        />
        {(label || description) && (
          <div className="flex flex-col">
            {label && (
              <span id={labelId} className="text-xs font-semibold text-[#14213D] leading-tight">
                {label}
              </span>
            )}
            {description && (
              <span id={descriptionId} className="text-[11px] text-[#4A5568] font-normal mt-0.5 leading-relaxed">
                {description}
              </span>
            )}
          </div>
        )}
      </label>
    );
  },
);

Checkbox.displayName = 'Checkbox';
