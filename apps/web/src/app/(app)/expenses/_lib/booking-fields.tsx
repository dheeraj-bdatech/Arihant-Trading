'use client';

/**
 * Booking-style form building blocks for the claim editor (travel-portal layout): big labelled
 * field tiles, icon chips, numbered step cards and the progress stepper on the claim hero.
 */
import React from 'react';
import { twMerge } from 'tailwind-merge';
import {
  BedDouble,
  Bus,
  Car,
  CarTaxiFront,
  Check,
  Plane,
  Plus,
  Receipt,
  TrainFront,
  UtensilsCrossed,
} from 'lucide-react';
import { Card, Select, type SelectOption } from '@/components/ui';

// ------------------------------------------------------------------ icons
export const categoryIcon = (code?: string | null, cls = 'h-5 w-5') => {
  switch (code) {
    case 'TRAVEL':
      return <Plane className={cls} />;
    case 'HOTEL':
      return <BedDouble className={cls} />;
    case 'LOCAL_CONVEYANCE':
      return <CarTaxiFront className={cls} />;
    case 'FOOD':
      return <UtensilsCrossed className={cls} />;
    default:
      return <Receipt className={cls} />;
  }
};

export const travelModeIcon = (mode: string, cls = 'h-4 w-4') => {
  switch (mode) {
    case 'flight':
      return <Plane className={cls} />;
    case 'train':
      return <TrainFront className={cls} />;
    case 'bus':
      return <Bus className={cls} />;
    case 'cab':
      return <CarTaxiFront className={cls} />;
    default:
      return <Car className={cls} />;
  }
};

// ------------------------------------------------------------------ field tile
/**
 * One labelled box: small uppercase caption on top, a large value underneath. The whole box
 * takes the focus ring so a row of tiles reads like a single search bar.
 */
export const FieldTile: React.FC<{
  label: string;
  htmlFor?: string;
  required?: boolean;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  readOnly?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, required, icon, hint, error, readOnly, className, children }) => (
  <div className={twMerge('min-w-0', className)}>
    <div
      className={twMerge(
        'field-tile relative rounded-lg border px-3.5 pt-2 pb-2.5 transition-colors',
        readOnly ? 'bg-[#FBFAF7] border-[#DCD8CE]' : 'bg-white border-[#C9C4B8] hover:border-[#0F5E63]/60',
        'focus-within:border-[#0F5E63] focus-within:ring-2 focus-within:ring-[#0F5E63]/15',
        error && 'border-[#881337] hover:border-[#881337] focus-within:border-[#881337] focus-within:ring-[#881337]/15',
      )}
    >
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#4A5568]">
        {icon && <span className="text-[#0F5E63] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        {label}
        {required && <span className="text-[#9A3412]">*</span>}
      </label>
      {children}
    </div>
    {error ? (
      <p className="mt-1 text-xs font-medium text-[#881337]">{error}</p>
    ) : hint ? (
      <p className="mt-1 text-xs text-[#4A5568]">{hint}</p>
    ) : null}
  </div>
);

/** Borderless input that lives inside a FieldTile. */
export const TileInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={twMerge(
      'field-tile-control mt-0.5 block h-7 w-full min-w-0 bg-transparent text-[15px] leading-7 font-semibold text-[#14213D] outline-none placeholder:font-normal placeholder:text-[#8A8578] read-only:cursor-default',
      className,
    )}
    {...props}
  />
));
TileInput.displayName = 'TileInput';

/** Borderless textarea that lives inside a FieldTile. */
export const TileTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={twMerge(
      'field-tile-control mt-0.5 block w-full resize-none bg-transparent text-sm text-[#14213D] outline-none placeholder:text-[#8A8578]',
      className,
    )}
    {...props}
  />
));
TileTextarea.displayName = 'TileTextarea';

/** The standard searchable Select, stripped of its own box so it sits inside a FieldTile. */
export const TileSelect: React.FC<{
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}> = ({ id, value, options, onChange }) => (
  <Select
    id={id}
    value={value}
    options={options}
    onChange={(e) => onChange(e.target.value)}
    className="field-tile-control mt-0.5 h-7 border-0 bg-transparent px-0 py-0 text-[15px] ring-0 focus:ring-0"
  />
);

// ------------------------------------------------------------------ chips
export interface ChipOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

/** Single-choice pill row (travel mode, meal type) — one tap instead of opening a dropdown. */
export const ChipGroup: React.FC<{
  label: string;
  value: string;
  options: ChipOption[];
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
}> = ({ label, value, options, onChange, required, error }) => (
  <div>
    <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#4A5568]">
      {label}
      {required && <span className="ml-0.5 text-[#9A3412]">*</span>}
    </div>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={twMerge(
              'inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30',
              active
                ? 'border-[#0F5E63] bg-[#E3EFEE] text-[#0F5E63]'
                : 'border-[#C9C4B8] bg-white text-[#14213D] hover:border-[#0F5E63]/60',
              error && !value && 'border-[#881337]/60',
            )}
          >
            {o.icon}
            {o.label}
            {active && <Check className="h-3.5 w-3.5" />}
          </button>
        );
      })}
    </div>
    {error && <p className="mt-1 text-xs font-medium text-[#881337]">{error}</p>}
  </div>
);

// ------------------------------------------------------------------ reveal
/** "+ Add remarks" style link that opens an optional block, keeping the form short by default. */
export const RevealButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] font-semibold text-[#0F5E63] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30"
  >
    <Plus className="h-3.5 w-3.5" />
    {children}
  </button>
);

// ------------------------------------------------------------------ steps
export type StepState = 'done' | 'active' | 'pending';

const StepDot: React.FC<{ n: number; state: StepState; onDark?: boolean }> = ({ n, state, onDark }) => (
  <span
    className={twMerge(
      'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold',
      state === 'done' && (onDark ? 'bg-[#F2B872] text-[#14213D]' : 'bg-[#0F5E63] text-white'),
      state === 'active' && (onDark ? 'bg-white text-[#14213D] ring-4 ring-white/15' : 'bg-[#0F5E63] text-white ring-4 ring-[#0F5E63]/15'),
      state === 'pending' && (onDark ? 'border border-white/30 text-white/60' : 'border border-[#C9C4B8] text-[#4A5568]'),
    )}
  >
    {state === 'done' ? <Check className="h-3.5 w-3.5" /> : n}
  </span>
);

/** Horizontal progress bar for the dark claim hero. */
export const Stepper: React.FC<{ steps: { label: string; state: StepState }[] }> = ({ steps }) => (
  <ol className="flex items-center gap-2 sm:gap-3">
    {steps.map((s, i) => (
      <li key={s.label} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 last:flex-none">
        <span className="flex min-w-0 items-center gap-2">
          <StepDot n={i + 1} state={s.state} onDark />
          <span
            className={twMerge(
              'truncate text-xs font-semibold sm:inline sm:text-[13px]',
              s.state === 'active' ? 'inline' : 'hidden',
              s.state === 'pending' ? 'text-white/60' : 'text-white',
            )}
          >
            {s.label}
          </span>
        </span>
        {i < steps.length - 1 && <span className={twMerge('h-px min-w-4 flex-1', s.state === 'done' ? 'bg-[#F2B872]' : 'bg-white/20')} />}
      </li>
    ))}
  </ol>
);

/** A numbered section of the form: step badge, serif title, one-line guidance, optional action. */
export const StepCard: React.FC<{
  n: number;
  state: StepState;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}> = ({ n, state, title, description, action, className, children }) => (
  <Card className={twMerge('overflow-visible', state === 'pending' && 'opacity-70', className)}>
    <div className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
      <StepDot n={n} state={state} />
      <div className="min-w-0 flex-1">
        <h2 className="font-serif text-lg leading-7 text-[#14213D]">{title}</h2>
        {description && <p className="text-[13px] text-[#4A5568]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children && <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5">{children}</div>}
  </Card>
);
