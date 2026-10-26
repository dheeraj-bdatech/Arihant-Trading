import React from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export interface TrackStep {
  key: string;
  label: string;
  icon: LucideIcon;
}

const CURRENT_TONE = {
  primary: 'border-[#0F5E63] bg-[#0F5E63] text-white',
  warning: 'border-[#A15C07] bg-[#A15C07] text-white',
  danger: 'border-[#9A3412] bg-[#9A3412] text-white',
} as const;

/**
 * A record's stage as its board columns in order (task status, demo lifecycle…): steps before the current one
 * are ticked, the current one is filled, later ones are outlined. `complete` fills the last step as done.
 */
export const StepTrack: React.FC<{
  steps: TrackStep[];
  current: number;
  /** colour of the current step: primary (normal), warning (waiting on someone), danger (blocked) */
  tone?: keyof typeof CURRENT_TONE;
  complete?: boolean;
  label?: string;
  className?: string;
}> = ({ steps, current, tone = 'primary', complete, label, className }) => (
  <ol className={twMerge('flex flex-wrap items-center gap-1.5', className)} aria-label={label}>
    {steps.map((st, i) => {
      const on = complete ? i === steps.length - 1 : i === current;
      const done = !on && (complete || i < current);
      const Icon = done ? Check : st.icon;
      return (
        <li key={st.key} className="flex items-center gap-1.5" aria-current={on ? 'step' : undefined}>
          {i > 0 && <span aria-hidden className={twMerge('h-px w-3 sm:w-5', complete || i <= current ? 'bg-[#0F5E63]' : 'bg-[#DCD8CE]')} />}
          <span
            className={twMerge(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
              on ? CURRENT_TONE[complete ? 'primary' : tone] : done ? 'border-[#D0E5E3] bg-[#E3EFEE] text-[#0F5E63]' : 'border-[#DCD8CE] bg-white text-[#6B7280]',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {/* phones: only the current step is named */}
            <span className={on ? '' : 'hidden sm:inline'}>{st.label}</span>
          </span>
        </li>
      );
    })}
  </ol>
);
