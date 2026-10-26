'use client';

/**
 * Long forms, one section at a time. Inside a Modal the step tracker (with its progress line)
 * renders in the modal header; the body shows only the current section; a sticky footer carries
 * Back / Next and, on the last step, the caller's submit button.
 *
 * All sections stay mounted (just invisible), so form state, native `required` checks and the
 * caller's <form onSubmit> keep working. "Next" validates the current section first, and if a
 * submit hits an invalid field in another section, that section is opened for the user.
 */
import React, { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { twMerge } from 'tailwind-merge';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from './Button';
import { ModalSlotContext } from './Modal';

export interface FormStep {
  /** Short name shown in the tracker, e.g. "Organisation". */
  title: string;
  /** One line of guidance shown above the section's fields. */
  description?: React.ReactNode;
  icon?: React.ReactNode;
  content: React.ReactNode;
  /** Skip this step (e.g. a section that does not apply to the chosen type). */
  hidden?: boolean;
  /**
   * Put this section on a fixed page (0-based) instead of spreading sections evenly. Use it on every
   * step or none; a hidden section then never moves its neighbours onto another page.
   */
  page?: number;
}

export interface FormStepsProps {
  steps: FormStep[];
  /** Rendered on the last step in place of "Next" — usually the existing submit Button. */
  submit: React.ReactNode;
  /** Shown as "Cancel" on the first step. */
  onCancel?: () => void;
  /** Extra content above the sections that should stay visible on every step (errors, alerts). */
  banner?: React.ReactNode;
  /**
   * At most this many steps are shown (default 3); extra sections are merged into neighbouring steps
   * and keep their own headings inside. 1 = a single page with no tracker.
   */
  maxSteps?: number;
  /** Names for the merged pages, in order (default: the section titles joined with " & "). */
  stepTitles?: string[];
  /** While saving: Cancel / Back are disabled so the dialog cannot be left mid-request. */
  busy?: boolean;
  /**
   * Custom check for one page (0-based) when the user presses Next, replacing the native `required` tooltip.
   * Forms that report their errors inline under each field pass this; return false to stay on the page.
   */
  validateStep?: (page: number) => boolean;
  className?: string;
}

const FIELDS = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
/** Field error messages as the ui controls render them (Input / Select / Textarea / FieldTile). */
const FIELD_ERROR = 'p[class*="text-[#881337]"]';

interface StepPage {
  title: string;
  parts: FormStep[];
}

/** Spread the visible sections over at most `max` pages, earlier pages taking the extra one. */
function toPages(visible: FormStep[], max: number, titles?: string[]): StepPage[] {
  if (visible.some((s) => s.page != null)) {
    const keys = Array.from(new Set(visible.map((s) => s.page ?? 0))).sort((a, b) => a - b);
    return keys.map((k) => {
      const parts = visible.filter((s) => (s.page ?? 0) === k);
      return { title: titles?.[k] || parts.map((p) => p.title).join(' & '), parts };
    });
  }
  const n = Math.max(1, Math.min(max, visible.length));
  const base = Math.floor(visible.length / n);
  const extra = visible.length % n;
  const pages: StepPage[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const parts = visible.slice(at, at + base + (i < extra ? 1 : 0));
    at += parts.length;
    pages.push({ title: titles?.[i] || parts.map((p) => p.title).join(' & '), parts });
  }
  return pages;
}

export const FormSteps: React.FC<FormStepsProps> = ({ steps: allSteps, submit, onCancel, banner, maxSteps = 3, stepTitles, busy, validateStep, className }) => {
  const steps = toPages(
    allSteps.filter((s) => !s.hidden),
    maxSteps,
    stepTitles,
  );
  const single = steps.length === 1;
  const [active, setActive] = useState(0);
  const [reached, setReached] = useState(0);
  const panels = useRef<(HTMLElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const jumpPending = useRef(false);
  const [errorSteps, setErrorSteps] = useState<number[]>([]);
  const { header } = useContext(ModalSlotContext);

  const current = Math.min(active, steps.length - 1);
  const isLast = current === steps.length - 1;

  // Keep the index valid if steps are hidden/shown while open.
  useEffect(() => {
    if (active > steps.length - 1) setActive(Math.max(0, steps.length - 1));
  }, [active, steps.length]);

  // Errors set by the form's own checks or the server sit next to their field, which may be on a
  // hidden step. Mark those steps in the tracker, and when errors first appear somewhere other than
  // the open step, open the first one so Save never seems to do nothing.
  const activeRef = useRef(current);
  activeRef.current = current;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let prev: number[] = [];
    const scan = () => {
      const found = panels.current.flatMap((p, i) => (p && p.querySelector(FIELD_ERROR) ? [i] : []));
      if (found.join() === prev.join()) return;
      const fresh = found.length > 0 && prev.length === 0;
      prev = found;
      setErrorSteps(found);
      if (fresh && !found.includes(activeRef.current)) setActive(found[0]);
    };
    const observer = new MutationObserver(scan);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    scan();
    return () => observer.disconnect();
  }, []);

  const scrollTop = () => {
    const body = rootRef.current?.closest('.modal-body');
    if (body) body.scrollTop = 0;
  };

  /** Validity of one section (the caller's validateStep, else native); reports the first problem in place. */
  const validate = (i: number) => {
    if (validateStep) return validateStep(i);
    const panel = panels.current[i];
    if (!panel) return true;
    const fields = Array.from(panel.querySelectorAll<HTMLInputElement>(FIELDS));
    const bad = fields.find((f) => !f.checkValidity());
    if (bad) {
      bad.reportValidity();
      return false;
    }
    // An inline error the form already shows on this step (e.g. "End time must be after the start time") also
    // keeps the user here, instead of surfacing only when the final submit is pressed.
    const shown = panel.querySelector(FIELD_ERROR);
    if (shown) {
      shown.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return false;
    }
    return true;
  };

  const go = (i: number) => {
    if (i === current) return;
    if (i > current) {
      for (let s = current; s < i; s++) {
        if (!validate(s)) {
          setActive(s);
          return;
        }
      }
    }
    setActive(i);
    setReached((r) => Math.max(r, i));
    scrollTop();
  };

  // A submit that trips over a required field in a hidden section: open that section and point at it.
  const onInvalidCapture = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const idx = panels.current.findIndex((p) => p?.contains(target));
    if (idx === -1 || idx === current || jumpPending.current) return;
    jumpPending.current = true;
    setActive(idx);
    requestAnimationFrame(() => {
      jumpPending.current = false;
      (target as HTMLInputElement).reportValidity?.();
    });
  };

  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100;

  const tracker = (
    <div className="px-4 pb-0 pt-1 sm:px-5">
      {/* Desktop: every step, joined by a line */}
      <ol className="hidden items-center gap-2 pb-3 sm:flex">
        {steps.map((s, i) => {
          const done = i < current;
          const on = i === current;
          const bad = errorSteps.includes(i);
          // With many steps only the open one is named, so names never get cut to "Cus…".
          const showLabel = on || steps.length <= 3;
          const canClick = i <= Math.max(reached, current) + 1;
          return (
            <li key={s.title} className={twMerge('flex min-w-0 flex-1 items-center gap-2 last:flex-none', on && 'min-w-fit')}>
              <button
                type="button"
                onClick={() => canClick && go(i)}
                disabled={!canClick}
                aria-current={on ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${s.title}`}
                title={s.title}
                className="group flex min-w-0 shrink-0 items-center gap-2 rounded-lg py-0.5 pr-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30 disabled:cursor-not-allowed"
              >
                <span
                  className={twMerge(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-colors',
                    done && 'bg-[#0F5E63] text-white',
                    on && 'bg-[#0F5E63] text-white ring-4 ring-[#0F5E63]/15',
                    !done && !on && 'border border-[#C9C4B8] bg-white text-[#4A5568] group-enabled:group-hover:border-[#0F5E63]',
                    bad && 'bg-[#881337] text-white ring-[#881337]/15 border-transparent',
                  )}
                >
                  {bad ? '!' : done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={twMerge('truncate text-xs font-semibold', !showLabel && 'sr-only', bad ? 'text-[#881337]' : on ? 'text-[#14213D]' : done ? 'text-[#0F5E63]' : 'text-[#4A5568]')}>
                  {s.title}
                </span>
              </button>
              {i < steps.length - 1 && <span className={twMerge('h-px min-w-3 flex-1', done ? 'bg-[#0F5E63]' : 'bg-[#DCD8CE]')} />}
            </li>
          );
        })}
      </ol>
      {/* Phone: just where you are */}
      <div className="flex items-center justify-between pb-2.5 sm:hidden">
        <span className="text-xs font-semibold text-[#14213D]">{steps[current]?.title}</span>
        <span className="font-mono text-[11px] text-[#4A5568]">
          Step {current + 1} of {steps.length}
        </span>
      </div>
      {/* The progress line along the bottom of the header */}
      <div className="-mx-4 h-[3px] bg-[#ECE9E2] sm:-mx-5">
        <div className="h-full bg-[#0F5E63] transition-[width] duration-300" style={{ width: `${Math.max(progress, 4)}%` }} />
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={twMerge('flex min-h-full flex-col', className)} onInvalidCapture={onInvalidCapture}>
      {!single && (header ? createPortal(tracker, header) : <div className="-mx-4 -mt-1 mb-4 border-b border-[#DCD8CE] sm:-mx-5">{tracker}</div>)}

      {banner && <div className="mb-4 space-y-3">{banner}</div>}

      {/* Every step sits in the same grid cell, so the body is always as tall as the longest step and the
          dialog keeps one size while the user moves between steps. Closed steps are only made invisible. */}
      <div className="grid flex-1 [&>section]:[grid-area:1/1]">
      {steps.map((s, i) => (
        <section
          key={s.title}
          ref={(el) => {
            panels.current[i] = el;
          }}
          aria-hidden={i !== current || undefined}
          aria-label={s.title}
          // no transitions while hidden: `transition-all` would otherwise animate visibility and ghost the old step
          className={twMerge('space-y-6', i !== current && 'invisible [&_*]:!transition-none')}
        >
          {s.parts.map((part, j) => (
            <div key={part.title} className={twMerge('space-y-4', j > 0 && 'border-t border-[#ECE9E2] pt-5')}>
              {(part.description || part.icon || s.parts.length > 1) && (
                <div className="flex items-start gap-2.5">
                  {part.icon && <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E3EFEE] text-[#0F5E63] [&>svg]:h-4 [&>svg]:w-4">{part.icon}</span>}
                  <div className="min-w-0">
                    <div className="font-serif text-[15px] font-semibold text-[#14213D]">{part.title}</div>
                    {part.description && <p className="text-xs text-[#4A5568]">{part.description}</p>}
                  </div>
                </div>
              )}
              {part.content}
            </div>
          ))}
        </section>
      ))}
      </div>

      {/* Sticky footer: always reachable, whatever the section length */}
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-6 flex items-center justify-between gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5">
        {!single && (
          <span className="hidden font-mono text-[11px] text-[#4A5568] sm:inline">
            Step {current + 1} of {steps.length}
          </span>
        )}
        {/* phones: the buttons share the full width, so each is a big thumb target */}
        <div className="ml-auto flex w-full items-center justify-end gap-2 [&>*]:min-w-0 [&>*]:flex-1 sm:w-auto sm:flex-wrap sm:[&>*]:flex-none">
          {current === 0 ? (
            onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )
          ) : (
            <Button type="button" variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => go(current - 1)} disabled={busy}>
              Back
            </Button>
          )}
          {/* Distinct keys: React must not reuse the clicked "Next" <button> as the submit button, or its type flips
              to "submit" during the click and the form is submitted before the last step is shown. */}
          {isLast ? (
            <React.Fragment key="submit">{submit}</React.Fragment>
          ) : (
            <Button key="next" type="button" rightIcon={<ArrowRight className="h-4 w-4" />} onClick={() => go(current + 1)}>
              <span className="sm:hidden">Next</span>
              <span className="hidden sm:inline">Next: {stepTitles ? steps[current + 1]?.title : steps[current + 1]?.parts[0]?.title}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * A titled group of fields for forms that fit on one screen: icon + heading, optional hint,
 * a divider line, then the fields. Use it to break a flat list of fields into 2–4 labelled blocks.
 */
export const FormSection: React.FC<{
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, description, icon, action, className, children }) => (
  <section className={twMerge('space-y-3', className)}>
    <div className="flex items-end justify-between gap-3 border-b border-[#ECE9E2] pb-2">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="inline-flex text-[#0F5E63] [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#14213D]">{title}</div>
          {description && <p className="text-xs text-[#4A5568]">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </section>
);
