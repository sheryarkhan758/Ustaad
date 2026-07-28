/**
 * A searchable single-select.
 *
 * ── Why not a native `<select>` ────────────────────────────────────────────
 * Seventy-two areas in a native select on Android is a scroll wheel with no
 * search. The parent knows the name of their own neighbourhood and should be
 * able to type three letters of it.
 *
 * ── Why not a library ──────────────────────────────────────────────────────
 * The ARIA combobox pattern is about a hundred lines when you actually
 * implement it, and every headless library that does it ships four times that
 * in bytes this audience pays for.
 *
 * ── Keyboard, in full ──────────────────────────────────────────────────────
 * Down/Up move the active option and open the list if closed. Enter selects.
 * Escape closes without selecting and returns focus to the input. Home/End jump
 * to the ends. Tab closes and moves on, committing nothing — a list that
 * selected whatever happened to be highlighted when you tabbed away would put
 * the wrong city on a booking.
 *
 * `aria-activedescendant` rather than moving DOM focus, so the typed query
 * stays in the input where the person is looking.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChevronDown, Close, Search } from './Icon';

export function Combobox({
  id,
  label,
  value,
  onChange,
  options = [],
  /** `(option) => ({ text, lang })` — see `useLocalName`. */
  renderName,
  placeholder,
  disabled = false,
  /** Shown in place of the list when there is nothing to choose. */
  emptyMessage,
  invalid = false,
  'aria-describedby': describedBy,
}) {
  const { t } = useTranslation('common');
  const generated = useId();
  const inputId = id ?? generated;
  const listId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const name = useCallback(
    (option) => (renderName ? renderName(option) : { text: option?.name ?? '', lang: undefined }),
    [renderName],
  );

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );

  /**
   * Filtered on both scripts at once.
   *
   * A person reading the Urdu interface may still type "Clifton", and a person
   * reading the English one may paste کلفٹن. Matching only the displayed name
   * would make one of those searches silently fail.
   */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.name?.toLowerCase().includes(needle) ||
        option.nameUr?.toLowerCase().includes(needle) ||
        option.id?.toLowerCase().includes(needle),
    );
  }, [options, query]);

  // Close when focus or a click leaves the component entirely.
  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // Keep the active option in view as it moves.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children?.[activeIndex];
    // The method is optional too, not just the node: jsdom does not implement
    // `scrollIntoView`, and neither do some older WebViews. Keeping the active
    // option in view is a nicety; throwing during a render is not.
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const commit = useCallback(
    (option) => {
      onChange?.(option?.id ?? null);
      setQuery('');
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!open) setOpen(true);
          setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (!open) setOpen(true);
          setActiveIndex((index) => Math.max(index - 1, 0));
          break;
        case 'Home':
          if (open) {
            event.preventDefault();
            setActiveIndex(0);
          }
          break;
        case 'End':
          if (open) {
            event.preventDefault();
            setActiveIndex(filtered.length - 1);
          }
          break;
        case 'Enter':
          if (open && activeIndex >= 0 && filtered[activeIndex]) {
            event.preventDefault();
            commit(filtered[activeIndex]);
          }
          break;
        case 'Escape':
          if (open) {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
          break;
        case 'Tab':
          // Commits nothing. A list that selected whatever happened to be
          // highlighted when you tabbed away would put the wrong city on a
          // booking.
          setOpen(false);
          setActiveIndex(-1);
          break;
        default:
          break;
      }
    },
    [open, activeIndex, filtered, commit],
  );

  const selectedName = selected ? name(selected) : null;
  const displayValue = open ? query : (selectedName?.text ?? '');

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined
          }
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-label={label}
          disabled={disabled}
          value={displayValue}
          // The selected value renders in its own language, which may differ
          // from the page's when there is no Urdu name for it.
          lang={!open && selectedName ? selectedName.lang : undefined}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          className={[
            'w-full rounded-control border bg-white ps-9 pe-9 text-body text-ink min-h-tap',
            'placeholder:text-slate-light transition-colors',
            'disabled:cursor-not-allowed disabled:bg-paper disabled:text-slate',
            invalid
              ? 'border-flag focus:border-flag'
              : 'border-slate-line hover:border-slate focus:border-verdigris-deep',
          ].join(' ')}
        />

        <Search
          size="sm"
          className="pointer-events-none absolute inset-y-0 start-3 my-auto text-slate-light"
        />

        {value && !disabled ? (
          <button
            type="button"
            onClick={() => commit(null)}
            aria-label={t('action.clear')}
            className="absolute inset-y-0 end-0 flex w-tap items-center justify-center text-slate hover:text-ink"
          >
            <Close size="sm" />
          </button>
        ) : (
          <ChevronDown
            size="sm"
            className="pointer-events-none absolute inset-y-0 end-3 my-auto text-slate-light"
          />
        )}
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={[
            'absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-control border border-slate-line bg-white py-1 shadow-raised',
            // The list belongs to the field it drops from, so it grows out of
            // it rather than appearing over it.
            'animate-rise',
          ].join(' ')}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-small text-slate">
              {emptyMessage ?? t('picker.noMatches')}
            </li>
          ) : (
            filtered.map((option, index) => {
              const optionName = name(option);
              const isSelected = option.id === value;
              return (
                <li
                  key={option.id}
                  id={`${inputId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  lang={optionName.lang}
                  // `onMouseDown` rather than `onClick`: the input's blur fires
                  // first on click and would close the list before the
                  // selection landed.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(option);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={[
                    'flex min-h-tap cursor-pointer items-center justify-between gap-2 px-3 text-small',
                    index === activeIndex ? 'bg-verdigris-soft text-verdigris-deep' : 'text-ink',
                    isSelected ? 'font-semibold' : '',
                  ].join(' ')}
                >
                  <span>{optionName.text}</span>
                  {isSelected ? <span aria-hidden="true">✓</span> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
