import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

function normalizeValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

export default function OrgSelect({
  value,
  options = [],
  onChange,
  placeholder = 'Select an option',
  disabled = false,
  className = '',
  searchable = false,
  searchPlaceholder = 'Search options',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const selectedOption = useMemo(
    () => options.find((option) => normalizeValue(option.value) === normalizeValue(value)) || null,
    [options, value],
  );
  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const searchValue = String(query || '').trim().toLowerCase();
    if (!searchValue) return options;

    return options.filter((option) => {
      const haystack = [
        option?.label,
        option?.description,
        option?.meta,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');
      return haystack.includes(searchValue);
    });
  }, [options, query, searchable]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
    }
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`org-select ${open ? 'open' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className="org-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span className={`org-select-value ${selectedOption ? '' : 'placeholder'}`.trim()}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown size={16} />
      </button>

      {open ? (
        <div className="org-select-menu" role="listbox">
          {searchable ? (
            <div className="org-select-search-shell">
              <input
                type="search"
                className="org-select-search-input"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}

          {filteredOptions.length === 0 ? (
            <div className="org-select-empty">No matching options.</div>
          ) : filteredOptions.map((option) => {
            const active = normalizeValue(option.value) === normalizeValue(value);
            const optionDisabled = Boolean(option.disabled);
            return (
              <button
                key={`${option.value}`}
                type="button"
                className={`org-select-option ${active ? 'active' : ''} ${optionDisabled ? 'disabled' : ''}`.trim()}
                role="option"
                aria-selected={active}
                disabled={optionDisabled}
                title={option.title || ''}
                onClick={() => {
                  if (optionDisabled) return;
                  onChange?.(option.value);
                  setOpen(false);
                }}
              >
                <span className="org-select-option-copy">
                  <span className="org-select-option-label-row">
                    <strong>{option.label}</strong>
                    {option.badge ? (
                      <span className={`org-select-option-badge tone-${option.badgeTone || 'neutral'}`.trim()}>
                        {option.badge}
                      </span>
                    ) : null}
                  </span>
                  {option.description ? <small>{option.description}</small> : null}
                  {option.meta ? <small className={`org-select-option-meta ${optionDisabled ? 'disabled' : ''}`.trim()}>{option.meta}</small> : null}
                </span>
                {active ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
