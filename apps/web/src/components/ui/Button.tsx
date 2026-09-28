import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'danger'
  | 'ghost'
  | 'success'
  | 'cyber';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      ...props
    },
    ref,
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/20 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98] text-[13px] min-w-0 cursor-pointer';

    const variants = {
      primary:
        'bg-[#0F5E63] hover:bg-[#0B4A4E] text-white shadow-xs border border-[#0F5E63] hover:shadow-sm',
      secondary:
        'bg-white hover:bg-[#FBFAF7] text-[#14213D] border border-[#C9C4B8]',
      outline:
        'border border-[#DCD8CE] bg-white text-[#14213D] hover:bg-[#FBFAF7] hover:border-[#14213D] shadow-2xs',
      danger:
        'bg-[#881337] hover:bg-[#700F2D] text-white shadow-xs border border-transparent',
      success:
        'bg-[#0F5E63] hover:bg-[#0B4A4E] text-white shadow-xs border border-transparent',
      ghost:
        'text-[#4A5568] hover:text-[#14213D] hover:bg-[#E3EFEE] border border-transparent',
      cyber:
        'bg-[#FBEBDD] hover:bg-[#F2B872]/20 text-[#7C2D12] border border-[#9A3412]/30 font-bold',
    };

    const sizes = {
      xs: 'px-2 py-0.5 text-[11px] gap-1',
      sm: 'px-2.5 py-1 text-xs gap-1.5',
      md: 'px-3.5 py-2 text-[13px] gap-2',
      lg: 'px-4.5 py-2.5 text-sm gap-2.5',
      icon: 'p-2 text-sm',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={twMerge(
          clsx(
            baseStyles,
            variants[variant],
            sizes[size],
            fullWidth && 'w-full',
            className,
          ),
        )}
        {...props}
      >
        {isLoading ? (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  'aria-label': string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      'aria-label': ariaLabel,
      title,
      variant = 'ghost',
      size = 'md',
      isLoading = false,
      className,
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const sizeCls = {
      xs: 'w-6 h-6 p-1 text-xs rounded',
      sm: 'w-7 h-7 p-1.5 text-xs rounded-md',
      md: 'w-8 h-8 p-1.5 text-sm rounded-lg',
      lg: 'w-10 h-10 p-2 text-base rounded-xl',
    };

    return (
      <Button
        ref={ref}
        variant={variant}
        size="icon"
        disabled={disabled}
        isLoading={isLoading}
        aria-label={ariaLabel}
        title={title || ariaLabel}
        className={twMerge(sizeCls[size], className)}
        {...props}
      >
        {!isLoading && icon}
      </Button>
    );
  },
);

IconButton.displayName = 'IconButton';

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  attached?: boolean;
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  attached = false,
  className,
  children,
  ...props
}) => {
  return (
    <div
      className={twMerge(
        'inline-flex items-center',
        attached
          ? '[&>button]:rounded-none [&>button:first-child]:rounded-l-lg [&>button:last-child]:rounded-r-lg [&>button:not(:first-child)]:-ml-[1px]'
          : 'gap-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};
