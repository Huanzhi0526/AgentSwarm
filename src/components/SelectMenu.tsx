import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuItem {
  value: string;
  label: string;
  badge?: string;
  muted?: boolean;
}

interface SelectMenuProps {
  value: string;
  options: SelectMenuItem[];
  onChange: (nextValue: string) => void;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

export const SelectMenu: React.FC<SelectMenuProps> = ({
  value,
  options,
  onChange,
  align = 'left',
  size = 'sm',
  className = '',
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc, true);
    };
  }, [open]);

  const activeItem = options.find((o) => o.value === value) ?? options[0];
  const heightCls = size === 'md' ? 'h-10 text-[14px]' : 'h-9 text-[13px]';

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-1.5 rounded-xl border bg-white px-3 font-medium text-[#2C2E35] transition cursor-pointer ${heightCls} ${
          open ? 'border-[var(--ac-mid)] ring-2 ring-[var(--ac-soft-hover)]' : 'border-[#E4E4EC] hover:border-[#CFCFD9]'
        }`}
      >
        <span className="truncate leading-normal py-0.5">{activeItem?.label || value}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-[#8E919C] transition-transform duration-150 ${
            open ? 'rotate-180 text-[var(--ac-primary)]' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute top-[calc(100%+6px)] z-50 min-w-full max-w-[270px] w-max max-h-64 overflow-y-auto rounded-2xl border border-[#E6E6EE] bg-white p-1.5 shadow-[0_10px_30px_rgba(20,20,35,0.10)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition cursor-pointer ${
                  selected
                    ? 'bg-[var(--ac-soft)] font-semibold text-[var(--ac-text)]'
                    : opt.muted
                      ? 'text-[#8E919C] hover:bg-[#F7F7FA]'
                      : 'text-[#3C3E47] hover:bg-[#F7F7FA]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {opt.badge && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
                        opt.muted
                          ? 'bg-[#F1F1F5] text-[#8E919C]'
                          : 'bg-[#EAF5EE] text-[#458964]'
                      }`}
                    >
                      {opt.badge}
                    </span>
                  )}
                  {selected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-[var(--ac-primary)]" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
