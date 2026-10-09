import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  icon?: React.ReactNode;
  badgeVariant?: 'default' | 'urgent' | 'warning' | 'info' | 'success';
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: 'pills' | 'segmented' | 'underline';
  size?: 'sm' | 'md';
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  variant = 'segmented',
  size = 'md',
  className,
}) => {
  const sizeStyles = {
    sm: 'px-2.5 py-1 text-xs gap-1.5',
    md: 'px-3.5 py-1.5 text-xs gap-2',
  };

  const containerStyles = {
    segmented:
      'flex items-center space-x-1 p-1 bg-white border border-[#DCD8CE] rounded-[10px] overflow-x-auto select-none',
    pills:
      'flex flex-wrap items-center gap-1.5 border-b border-[#DCD8CE] pb-2 select-none',
    underline:
      'flex items-center space-x-4 border-b border-[#DCD8CE] select-none overflow-x-auto',
  };

  const itemStyles = (isActive: boolean) => {
    if (variant === 'pills') {
      return isActive
        ? 'bg-[#E3EFEE] text-[#14213D] shadow-xs font-semibold rounded-[8px]'
        : 'text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1] rounded-[8px] font-medium';
    }
    if (variant === 'underline') {
      return isActive
        ? 'border-b-2 border-[#0F5E63] text-[#14213D] font-semibold rounded-none pb-2 -mb-[1px]'
        : 'text-[#4A5568] hover:text-[#14213D] rounded-none pb-2 -mb-[1px] font-medium border-b-2 border-transparent';
    }
    // segmented default
    return isActive
      ? 'bg-[#E3EFEE] text-[#14213D] shadow-xs font-semibold rounded-[8px]'
      : 'text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1] rounded-[8px] font-medium';
  };

  return (
    <div data-tabs className={twMerge(containerStyles[variant], className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={twMerge(
              'flex items-center transition-all duration-150 whitespace-nowrap cursor-pointer',
              sizeStyles[size],
              itemStyles(isActive),
              isActive && 'tab-pop',
            )}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={twMerge(
                  'px-1.5 py-0.2 text-[10px] font-bold font-mono rounded-full transition-colors',
                  isActive
                    ? 'bg-white text-[#0F5E63]'
                    : 'bg-[#EEF1F5] text-[#14213D]',
                  tab.badgeVariant === 'urgent' && 'bg-[#FBEBDD] text-[#9A3412] font-bold',
                  tab.badgeVariant === 'warning' && 'bg-[#FFF8EB] text-[#A15C07] font-bold',
                  tab.badgeVariant === 'success' && 'bg-[#EAF6F0] text-[#1F7A55] font-bold',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
