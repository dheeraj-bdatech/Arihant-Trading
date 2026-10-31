'use client';

import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { twMerge } from 'tailwind-merge';
import { ChevronDown, Search, Check, X } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** Short status shown as a pill on the right of the option in the open list (not in the closed field), e.g. "2/2 ready". */
  hint?: string;
  hintTone?: 'success' | 'warning' | 'danger' | 'neutral';
}

const HINT_TONES: Record<NonNullable<SelectOption['hintTone']>, string> = {
  success: 'bg-[#E3EFEE] text-[#0F5E63] border-[#D0E5E3]',
  warning: 'bg-[#FBEBDD] text-[#9A3412] border-[#E9C9B4]',
  danger: 'bg-[#FCE8EC] text-[#881337] border-[#F3C7CF]',
  neutral: 'bg-[#ECE9E2] text-[#4A5568] border-[#DCD8CE]',
};

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  /**
   * Server-side search: called with the typed query (and '' when the panel resets). The caller swaps in the
   * matching `options`; the panel then shows them as given instead of filtering them again locally.
   */
  onSearchChange?: (query: string) => void;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      options,
      children,
      id,
      value,
      defaultValue,
      onChange,
      disabled,
      required,
      placeholder,
      searchable = true,
      searchPlaceholder,
      onSearchChange,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const selectId = id || generatedId;
    const labelId = `${selectId}-label`;
    const triggerId = `${selectId}-trigger`;

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    // The panel is portalled to <body> with fixed coordinates, so a scrolling parent (a modal body,
    // a card with overflow hidden) can never clip it.
    const [panelPos, setPanelPos] = useState<React.CSSProperties | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const nativeSelectRef = useRef<HTMLSelectElement | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Extract options from options prop or React children <option> elements
    const parsedOptions: SelectOption[] = useMemo(() => {
      if (options && options.length > 0) {
        return options;
      }
      if (!children) return [];

      const extracted: SelectOption[] = [];
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child) && child.type === 'option') {
          const optValue = (child.props as any).value ?? '';
          const optLabel = (child.props as any).children?.toString() ?? String(optValue);
          extracted.push({ value: String(optValue), label: optLabel });
        }
      });
      return extracted;
    }, [options, children]);

    // Current controlled or uncontrolled value
    const [internalValue, setInternalValue] = useState<string>(
      value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : '',
    );

    const currentValue = value !== undefined ? String(value) : internalValue;

    // Server-side search: report every query change (typing, clearing, the reset on open/close)
    const onSearchChangeRef = useRef(onSearchChange);
    onSearchChangeRef.current = onSearchChange;
    useEffect(() => {
      onSearchChangeRef.current?.(searchQuery);
    }, [searchQuery]);

    // Filter options based on user search query (the caller already did it for a server-side search)
    const filteredOptions = useMemo(() => {
      if (onSearchChange || !searchQuery.trim()) return parsedOptions;
      const q = searchQuery.toLowerCase().trim();
      return parsedOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q),
      );
    }, [parsedOptions, searchQuery, onSearchChange]);

    // Currently selected option object
    const selectedOption = useMemo(() => {
      return parsedOptions.find((opt) => String(opt.value) === String(currentValue));
    }, [parsedOptions, currentValue]);

    const isPlaceholder = !selectedOption || selectedOption.value === '';
    const displayLabel = selectedOption
      ? selectedOption.label
      : placeholder || (parsedOptions[0]?.value === '' ? parsedOptions[0]?.label : '-- Select an option --');

    // Place the panel under the trigger, or above it when there is more room there
    const updatePanelPos = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const up = spaceBelow < 300 && spaceAbove > spaceBelow;
      const width = Math.max(rect.width, 200);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPanelPos({
        position: 'fixed',
        left,
        width,
        zIndex: 120,
        maxHeight: Math.max(160, (up ? spaceAbove : spaceBelow) - 4),
        ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };

    // Toggle dropdown open state and position check
    const handleToggle = () => {
      if (disabled) return;
      if (!isOpen) updatePanelPos();
      setIsOpen((prev) => !prev);
      setSearchQuery('');
      setHighlightedIndex(-1);
    };

    // Auto focus search input on open
    useEffect(() => {
      if (isOpen && searchable) {
        const timer = setTimeout(() => {
          searchInputRef.current?.focus();
        }, 30);
        return () => clearTimeout(timer);
      }
    }, [isOpen, searchable]);

    // Click outside and Escape key handler
    useEffect(() => {
      if (!isOpen) return;

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node;
        if (containerRef.current && !containerRef.current.contains(target) && !panelRef.current?.contains(target)) {
          setIsOpen(false);
          setSearchQuery('');
        }
      };

      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // Handled here: the enclosing Modal must not also close (and drop the form) on this Escape.
          e.preventDefault();
          setIsOpen(false);
          setSearchQuery('');
          triggerRef.current?.focus();
        }
      };

      // Follow the trigger when the page or a modal body scrolls (but not when the option list itself scrolls)
      const handleReposition = (e: Event) => {
        if (panelRef.current?.contains(e.target as Node)) return;
        updatePanelPos();
      };

      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleGlobalKeyDown);
      document.addEventListener('scroll', handleReposition, true);
      window.addEventListener('resize', handleReposition);

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleGlobalKeyDown);
        document.removeEventListener('scroll', handleReposition, true);
        window.removeEventListener('resize', handleReposition);
      };
    }, [isOpen]);

    // Handle selection of an option
    const handleSelect = (opt: SelectOption) => {
      setInternalValue(opt.value);

      if (nativeSelectRef.current) {
        nativeSelectRef.current.value = opt.value;
      }

      if (onChange) {
        const syntheticEvent = {
          target: {
            value: opt.value,
            name: props.name || selectId,
            id: selectId,
          },
          currentTarget: {
            value: opt.value,
            name: props.name || selectId,
            id: selectId,
          },
          preventDefault: () => {},
          stopPropagation: () => {},
        } as unknown as React.ChangeEvent<HTMLSelectElement>;
        onChange(syntheticEvent);
      }

      setIsOpen(false);
      setSearchQuery('');
      triggerRef.current?.focus();
    };

    // Keyboard navigation inside dropdown
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
          e.preventDefault();
          handleToggle();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[highlightedIndex]);
        }
      }
    };

    // Keep highlighted option in scroll view
    useEffect(() => {
      if (highlightedIndex >= 0 && listRef.current) {
        const item = listRef.current.children[highlightedIndex] as HTMLElement;
        if (item) {
          item.scrollIntoView({ block: 'nearest' });
        }
      }
    }, [highlightedIndex]);

    return (
      <div
        ref={containerRef}
        className="w-full flex flex-col justify-start text-left relative"
      >
        {label && (
          // Labels the visible trigger (the native select below is hidden from assistive tech).
          // A click focuses the trigger like a native select would, without opening the list.
          <label
            id={labelId}
            htmlFor={triggerId}
            onClick={(e) => {
              e.preventDefault();
              triggerRef.current?.focus();
            }}
            className="block text-xs font-semibold text-[#14213D] mb-1.5"
          >
            {required && typeof label === 'string' ? label.replace(/\s*\*\s*$/, '') : label}
            {required && <span className="text-[#881337] ml-0.5">*</span>}
          </label>
        )}

        {/* Hidden Native Select for standard form submission, validity and ref forwarding */}
        <select
          ref={(node) => {
            nativeSelectRef.current = node;
            if (typeof ref === 'function') {
              ref(node);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLSelectElement | null>).current = node;
            }
          }}
          id={selectId}
          name={props.name}
          value={currentValue}
          onChange={onChange}
          required={required}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          {...props}
        >
          {parsedOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Visible Searchable Trigger Button */}
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          // Announced as "<label>, <current value>"
          aria-labelledby={label ? `${labelId} ${triggerId}` : undefined}
          className={twMerge(
            'flex h-10 w-full items-center justify-between rounded-[8px] border border-[#C9C4B8] bg-white px-3.5 py-2 text-xs text-[#14213D] transition-colors focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15 disabled:cursor-not-allowed disabled:opacity-50 text-left',
            isOpen && 'border-[#0F5E63] ring-2 ring-[#0F5E63]/15',
            error && 'border-[#881337] focus:border-[#881337] focus:ring-[#881337]/15',
            className,
          )}
        >
          <span
            className={twMerge(
              'truncate mr-2 font-normal',
              isPlaceholder ? 'text-[#6B7280]' : 'text-[#14213D]',
            )}
          >
            {displayLabel}
          </span>
          <ChevronDown
            className={twMerge(
              'h-4 w-4 text-[#4A5568] shrink-0 transition-transform duration-200',
              isOpen && 'rotate-180 text-[#0F5E63]',
            )}
          />
        </button>

        {/* Searchable Dropdown Popup Menu */}
        {isOpen && panelPos && typeof document !== 'undefined' && createPortal(
          <div
            ref={panelRef}
            style={panelPos}
            className="select-panel flex flex-col rounded-[10px] border border-[#DCD8CE] bg-white shadow-xl animate-in fade-in-50 zoom-in-95 duration-100 overflow-hidden"
          >
            {/* Search Input Bar */}
            {searchable && (
              <div className="shrink-0 p-2 border-b border-[#ECE9E2] bg-[#FBFAF7]">
                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#4A5568] pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={searchPlaceholder || `Search ${label ? label.replace(/\s*\(.*\)/g, '') : 'options'}...`}
                    className="w-full h-8 pl-8 pr-7 text-xs bg-white border border-[#DCD8CE] rounded-[6px] text-[#14213D] placeholder:text-[#6B7280] focus:outline-none focus:border-[#0F5E63] focus:ring-1 focus:ring-[#0F5E63]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2 p-0.5 text-[#6B7280] hover:text-[#4A5568] rounded"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {parsedOptions.length > 5 && (
                  <div className="text-[10px] text-[#4A5568] px-1 pt-1 flex justify-between items-center">
                    <span>{filteredOptions.length} of {parsedOptions.length} items</span>
                    {searchQuery && <span className="font-medium text-[#0F5E63]">Filtered</span>}
                  </div>
                )}
              </div>
            )}

            {/* Filtered Options List */}
            <div
              ref={listRef}
              role="listbox"
              aria-labelledby={label ? labelId : undefined}
              className="min-h-0 max-h-60 overflow-y-auto p-1 space-y-0.5"
            >
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, idx) => {
                  const isSelected = String(opt.value) === String(currentValue);
                  const isHighlighted = idx === highlightedIndex;

                  return (
                    <div
                      key={opt.value || `empty-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      style={{ ['--n' as string]: Math.min(idx, 12) }}
                      onClick={() => handleSelect(opt)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={twMerge(
                        'px-3 py-2 text-xs rounded-md cursor-pointer flex items-center justify-between transition-colors',
                        isSelected
                          ? 'bg-[#E3EFEE] text-[#0F5E63] font-semibold'
                          : isHighlighted
                          ? 'bg-[#F6F5F1] text-[#14213D]'
                          : 'text-[#14213D] hover:bg-[#FBFAF7]',
                        opt.value === '' && 'text-[#6B7280] italic',
                      )}
                    >
                      <span className="truncate pr-2">{opt.label}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {opt.hint && (
                          <span
                            className={twMerge(
                              'whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold not-italic',
                              HINT_TONES[opt.hintTone || 'neutral'],
                            )}
                          >
                            {opt.hint}
                          </span>
                        )}
                        {isSelected && opt.value !== '' && <Check className="h-3.5 w-3.5 text-[#0F5E63]" />}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="py-4 px-3 text-center text-xs text-[#6B7280] italic">
                  No matching options found for &quot;{searchQuery}&quot;
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

        {error && <p className="text-xs text-[#881337] font-medium mt-1">{error}</p>}
        {helperText && !error && (
          <p className="text-xs text-[#4A5568] font-normal mt-1">{helperText}</p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
