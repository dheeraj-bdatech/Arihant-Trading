import React, { useEffect, useRef } from 'react';
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

  if (!modalIdRef.current) {
    modalIdRef.current = `modal_${++nextModalId}`;
  }
  const modalId = modalIdRef.current;

  useEffect(() => {
    if (!isOpen) return;

    // Default base z-index 50, increment by 10 for each nested stacked modal
    const baseZ = zIndex ?? (50 + activeModalStack.length * 10);
    const entry: StackEntry = {
      id: modalId,
      onClose,
      zIndex: baseZ,
    };
    activeModalStack.push(entry);
    updateBodyOverflow();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const top = activeModalStack[activeModalStack.length - 1];
        if (top && top.id === modalId) {
          e.stopPropagation();
          onClose();
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
  }, [isOpen, onClose, modalId, zIndex]);

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
      className={twMerge('fixed inset-0 flex items-center justify-center p-3 sm:p-4', className)}
      style={{ zIndex: resolvedZIndex }}
    >
      {/* Translucent overlay */}
      <div
        className="fixed inset-0 bg-[#2B1A12]/45 backdrop-blur-[3px] transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Light Executive Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={twMerge(
          'relative w-full rounded-[14px] bg-white border border-[#DCD8CE] shadow-2xl overflow-hidden z-10 animate-in zoom-in-95 duration-150 text-[#14213D]',
          maxWidths[maxWidth],
        )}
      >
        <div aria-hidden className="mithila-strip" />
        {/* Dialog Header */}
        <div className="px-5 py-4 border-b border-[#ECE9E2] bg-[#FBFAF7] flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-serif text-[16px] font-bold text-[#14213D] tracking-tight">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-[#4A5568] font-normal mt-0.5 leading-relaxed">
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
          />
        </div>

        {/* Dialog Body with custom-scrollbar */}
        <div className="px-4 py-4 sm:px-5 max-h-[calc(100dvh-8.5rem)] overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
