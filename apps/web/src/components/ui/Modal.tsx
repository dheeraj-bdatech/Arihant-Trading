import React, { createContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { IconButton } from './Button';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
  zIndex?: number;
  className?: string;
}

/**
 * Lets content inside a modal (e.g. FormSteps) render into the modal chrome: the progress line
 * sits in the header, right under the title, instead of scrolling away with the body.
 */
export const ModalSlotContext = createContext<{ header: HTMLElement | null }>({ header: null });

// Global modal stack tracking for z-index layering, body scroll lock, and ESC key routing
interface StackEntry {
  id: string;
  onClose: () => void;
  zIndex: number;
}
const activeModalStack: StackEntry[] = [];
let nextModalId = 0;

function updateBodyOverflow() {
  if (typeof document === 'undefined') return;
  if (activeModalStack.length > 0) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = 'unset';
  }
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'lg',
  zIndex,
  className,
}) => {
  const modalIdRef = useRef<string | null>(null);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  if (!modalIdRef.current) {
    modalIdRef.current = `modal_${++nextModalId}`;
  }
  const modalId = modalIdRef.current;
  // Callers usually pass an inline onClose; reading it through a ref keeps the stack entry (and so the
  // z-index order of nested dialogs) fixed while open instead of re-registering on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Default base z-index 50, increment by 10 for each nested stacked modal
    const baseZ = zIndex ?? (50 + activeModalStack.length * 10);
    const entry: StackEntry = {
      id: modalId,
      onClose: () => onCloseRef.current(),
      zIndex: baseZ,
    };
    activeModalStack.push(entry);
    updateBodyOverflow();

    const handleKeyDown = (e: KeyboardEvent) => {
      // An open dropdown / menu inside the dialog already consumed this Escape (it calls preventDefault):
      // close just that, never the whole form with the user's input in it.
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const top = activeModalStack[activeModalStack.length - 1];
        if (top && top.id === modalId) {
          e.stopPropagation();
          onCloseRef.current();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = activeModalStack.findIndex((m) => m.id === modalId);
      if (idx !== -1) {
        activeModalStack.splice(idx, 1);
      }
      updateBodyOverflow();
    };
  }, [isOpen, modalId, zIndex]);

  if (!isOpen) return null;

  const currentEntry = activeModalStack.find((m) => m.id === modalId);
  const resolvedZIndex = zIndex ?? currentEntry?.zIndex ?? (50 + activeModalStack.length * 10);

  const maxWidths = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
    '2xl': 'sm:max-w-2xl',
    '3xl': 'sm:max-w-3xl',
    '4xl': 'sm:max-w-4xl',
    '5xl': 'sm:max-w-5xl',
  };

  return createPortal(
    <div
      // Phones: a bottom sheet (full width, docked to the bottom edge, thumb-reachable actions).
      // From `sm` up: the centred dialog.
      className={twMerge('fixed inset-0 flex items-end justify-center sm:items-center sm:p-4', className)}
      style={{ zIndex: resolvedZIndex }}
    >
      {/* Translucent overlay */}
      <div
        className="fixed inset-0 bg-[#2B1A12]/45 backdrop-blur-[3px] transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Light Executive Modal Container. `modal-sheet` (theme.css) rounds only the top corners on phones;
          the bottom padding keeps the sticky footers above the iPhone home indicator. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={twMerge(
          'modal-sheet relative z-10 flex max-h-[calc(100dvh-2.5rem)] w-full flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-[#DCD8CE] bg-white pb-[env(safe-area-inset-bottom)] text-[#14213D] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-[14px] sm:border-b sm:pb-0',
          maxWidths[maxWidth],
        )}
      >
        {/* Dialog Header — a <header> (not a div) so the theme's "first div is transparent" rule keeps its divider line */}
        <header className="modal-header shrink-0 border-b border-[#DCD8CE] bg-white">
          {/* grab handle: tells a phone user this is a sheet over the page */}
          <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-[#DCD8CE]" />
          </div>
          <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-1.5 sm:px-5 sm:pb-3.5 sm:pt-4">
            <div className="min-w-0 border-l-[3px] border-[#0F5E63] pl-3">
              <h3 className="line-clamp-2 font-serif text-[16px] font-semibold leading-snug tracking-tight text-[#14213D] [overflow-wrap:anywhere] sm:line-clamp-none sm:text-[18px]">
                {title}
              </h3>
              {description && (
                <p className="mt-0.5 line-clamp-2 text-xs font-normal leading-relaxed text-[#4A5568] sm:line-clamp-none">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              type="button"
              icon={<X className="h-4 w-4" />}
              aria-label="Close modal"
              onClick={onClose}
              size="sm"
              variant="ghost"
              className="-mr-1.5 -mt-1 shrink-0 sm:mr-0 sm:mt-0"
            />
          </div>
          <div ref={setHeaderSlot} className="empty:hidden" />
        </header>

        {/* Dialog Body with custom-scrollbar. It only ever scrolls down: wide content (tab rows, tables)
            slides inside its own box, and a long code or URL wraps, so a sideways swipe can never pan
            the whole body off-screen and leave the dialog looking empty. */}
        <div className="modal-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 [overflow-wrap:anywhere] sm:px-5 sm:py-5 custom-scrollbar">
          <ModalSlotContext.Provider value={{ header: headerSlot }}>{children}</ModalSlotContext.Provider>
        </div>
      </div>
    </div>,
    document.body,
  );
};
