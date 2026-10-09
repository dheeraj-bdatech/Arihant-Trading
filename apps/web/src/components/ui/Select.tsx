'use client';

import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { twMerge } from 'tailwind-merge';
import { ChevronDown, Search, Check, X } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
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
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const selectId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : generatedId);

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const [dropUp, setDropUp] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const nativeSelectRef = useRef<HTMLSelectElement | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

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

    // Filter options based on user search query
    const filteredOptions = useMemo(() => {
      if (!searchQuery.trim()) return parsedOptions;
      const q = searchQuery.toLowerCase().trim();
      return parsedOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q),
      );
    }, [parsedOptions, searchQuery]);

    // Currently selected option object
    const selectedOption = useMemo(() => {
      return parsedOptions.find((opt) => String(opt.value) === String(currentValue));
    }, [parsedOptions, currentValue]);

    const isPlaceholder = !selectedOption || selectedOption.value === '';
    const displayLabel = selectedOption
      ? selectedOption.label
      : placeholder || (parsedOptions[0]?.value === '' ? parsedOptions[0]?.label : '-- Select an option --');

    // Toggle dropdown open state and position check
    const handleToggle = () => {
      if (disabled) return;
      if (!isOpen && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setDropUp(spaceBelow < 280 && rect.top > 280);
      }
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
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
          setSearchQuery('');
        }
      };

      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsOpen(false);
          setSearchQuery('');
          triggerRef.current?.focus();
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleGlobalKeyDown);

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleGlobalKeyDown);
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
        className="w-full flex flex-col justify-end text-left relative"
      >
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-semibold text-[#14213D] mb-1.5"
          >
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
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
          type="button"
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
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
              isPlaceholder ? 'text-[#8A8578]' : 'text-[#14213D]',
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
        {isOpen && (
          <div
            className={twMerge(
              'mt-select-panel absolute z-50 left-0 right-0 w-full min-w-[200px] rounded-[10px] border border-[#DCD8CE] bg-white shadow-xl animate-in fade-in-50 zoom-in-95 duration-100 overflow-hidden',
              dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
            )}
          >
            {/* Search Input Bar */}
            {searchable && (
              <div className="p-2 border-b border-[#ECE9E2] bg-[#FBFAF7]">
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
                    className="w-full h-8 pl-8 pr-7 text-xs bg-white border border-[#DCD8CE] rounded-[6px] text-[#14213D] placeholder:text-[#8A8578] focus:outline-none focus:border-[#0F5E63] focus:ring-1 focus:ring-[#0F5E63]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2 p-0.5 text-gray-400 hover:text-gray-600 rounded"
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
              className="max-h-60 overflow-y-auto p-1 space-y-0.5"
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
                        opt.value === '' && 'text-gray-400 italic',
                      )}
                    >
                      <span className="truncate pr-2">{opt.label}</span>
                      {isSelected && opt.value !== '' && (
                        <Check className="h-3.5 w-3.5 text-[#0F5E63] shrink-0 ml-1.5" />
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="py-4 px-3 text-center text-xs text-[#8A8578] italic">
                  No matching options found for &quot;{searchQuery}&quot;
                </div>
              )}
            </div>
          </div>
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
