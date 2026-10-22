import React from 'react';
import { Info, AlertTriangle, CheckCircle, AlertCircle, X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export interface InfoCalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'warning' | 'danger' | 'success' | 'neutral';
  title?: string;
  icon?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
}

export const InfoCallout: React.FC<InfoCalloutProps> = ({
  variant = 'info',
  title,
  icon,
  onClose,
  children,
  className,
  ...props
}) => {
  const variantStyles = {
    info: 'bg-[#E3EFEE] border-[#0F5E63]/30 text-[#0F5E63]',
    warning: 'bg-[#FBEBDD] border-[#9A3412]/30 text-[#7C2D12]',
    danger: 'bg-[#FCE8EC] border-[#F3C7CF] text-[#881337]',
    success: 'bg-[#E3EFEE] border-[#D0E5E3] text-[#0F5E63]',
    neutral: 'bg-[#FBFAF7] border-[#DCD8CE] text-[#14213D]',
  }[variant];

  const closeButtonColors = {
    info: 'text-[#0F5E63] hover:bg-[#D3E7E6]',
    warning: 'text-[#7C2D12] hover:bg-[#F2B872]/30',
    danger: 'text-[#881337] hover:bg-[#FCE8EC]',
    success: 'text-[#0F5E63] hover:bg-[#E3EFEE]',
    neutral: 'text-[#4A5568] hover:bg-[#ECE9E2]',
  }[variant];

  const defaultIcons = {
    info: <Info className="h-4 w-4 shrink-0 text-[#0F5E63]" />,
    warning: <AlertTriangle className="h-4 w-4 shrink-0 text-[#9A3412]" />,
    danger: <AlertCircle className="h-4 w-4 shrink-0 text-[#881337]" />,
    success: <CheckCircle className="h-4 w-4 shrink-0 text-[#0F5E63]" />,
    neutral: <Info className="h-4 w-4 shrink-0 text-[#4A5568]" />,
  };

  const renderedIcon = icon !== undefined ? icon : defaultIcons[variant];

  return (
    <div
      className={twMerge(
        'p-3.5 rounded-[10px] border text-xs leading-relaxed flex items-start gap-3 relative',
        variantStyles,
        className,
      )}
      {...props}
    >
      {renderedIcon}
      <div className="flex-1 min-w-0">
        {title && <h5 className="font-bold mb-0.5">{title}</h5>}
        <div className="space-y-1">{children}</div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss alert"
          className={twMerge(
            'p-1 rounded-md transition-colors shrink-0 -mr-1 -mt-1 cursor-pointer',
            closeButtonColors,
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
