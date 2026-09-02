import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search, Type } from 'lucide-react';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useFontPickerStore } from '../../store/font-picker-store';
import type { Path } from '../../lib/theme-editor/model';
import { cn } from '../../lib/utils';
import {
  HINT_CLASS,
  QuietButton,
  useFontCatalog,
  type FontCatalog,
} from './theme-editor-shared';

/**
 * A font family as a combobox: the catalog filtered as you type, with the
 * typed text itself always on offer — a theme may legitimately name a face
 * this browser has never heard of, and refusing it would make the form less
 * capable than the JSON it edits.
 *
 * Only a slice of the matches is rendered. The Google list is ~1500 families,
 * and a combobox that has to lay out 1500 rows before it can show the first
 * one stops feeling like a text field.
 */

const MAX_ROWS = 40;

interface Option {
  family: string;
  /** "Safe" for the OS list, else the Google category. */
  tag: string;
  safe: boolean;
}

function buildOptions(catalog: FontCatalog): Option[] {
  return [
    ...catalog.safe.map((family) => ({ family, tag: 'safe', safe: true })),
    ...catalog.google.map((font) => ({
      family: font.family,
      tag: font.category,
      safe: false,
    })),
  ];
}

function score(family: string, query: string): number {
  const lower = family.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  const index = lower.indexOf(query);
  return index === -1 ? -1 : 2 + index;
}

/**
 * With a query, the best `MAX_ROWS` matches. Without one, the current family
 * first and the catalog after it.
 *
 * Pinning the current value is what makes the unfiltered list honest: the
 * catalog runs to hundreds of families and only a window of it is rendered,
 * so a theme naming the four-hundredth would otherwise open a list its own
 * value is not in — with the first row highlighted, one Return away from
 * replacing it.
 */
function filterOptions(
  options: Option[],
  query: string,
  current: string | undefined
): Option[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    if (!current) return options.slice(0, MAX_ROWS);
    const known = options.find((option) => option.family === current);
    const rest = options.filter((option) => option.family !== current);
    return [
      known ?? { family: current, tag: 'current', safe: false },
      ...rest,
    ].slice(0, MAX_ROWS);
  }
  const scored: { option: Option; rank: number }[] = [];
  for (const option of options) {
    const rank = score(option.family, trimmed);
    if (rank !== -1) scored.push({ option, rank });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || Number(b.option.safe) - Number(a.option.safe)
  );
  return scored.slice(0, MAX_ROWS).map((entry) => entry.option);
}

export function FamilyCombobox({
  id,
  label,
  value,
  onCommit,
  pickerPath,
  className,
}: {
  id?: string;
  label: string;
  value: string | undefined;
  onCommit: (next: string | null) => void;
  /** Where the full font dialog writes when "Browse all" is used. */
  pickerPath: Path;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const catalog = useFontCatalog();
  const options = useMemo(() => buildOptions(catalog), [catalog]);
  const matches = useMemo(
    () => filterOptions(options, query, value),
    [options, query, value]
  );

  const typed = query.trim();
  const exact = matches.some(
    (option) => option.family.toLowerCase() === typed.toLowerCase()
  );
  const custom = typed && !exact ? typed : null;
  const rows = custom
    ? [custom, ...matches.map((m) => m.family)]
    : matches.map((m) => m.family);

  const choose = useCallback(
    (family: string) => {
      onCommit(family);
      setOpen(false);
      setQuery('');
    },
    [onCommit]
  );

  const browse = useCallback(() => {
    setOpen(false);
    useFontPickerStore
      .getState()
      .openFor({ jsonPath: pickerPath, currentValue: value });
  }, [pickerPath, value]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => {
          const next =
            index < 0
              ? event.key === 'ArrowDown'
                ? 0
                : rows.length - 1
              : index + (event.key === 'ArrowDown' ? 1 : -1);
          const last = rows.length - 1;
          const clamped = next < 0 ? last : next > last ? 0 : next;
          listRef.current
            ?.querySelector(`[data-row="${clamped}"]`)
            ?.scrollIntoView({ block: 'nearest' });
          return clamped;
        });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const family = rows[active];
        if (family) choose(family);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    },
    [active, choose, rows]
  );

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Open on the family that is set, not on row zero: Return is then
          // a no-op on a list the author only meant to look at. A family the
          // catalog does not have and no query has offered leaves nothing
          // highlighted rather than arming a different one.
          if (next) {
            setQuery('');
            setActive(value ? 0 : -1);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className={cn(
              'flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm border',
              'border-input bg-background px-2 text-xs shadow-none transition-colors',
              'hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
            )}
          >
            <Type className="size-3 shrink-0 opacity-50" aria-hidden />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                !value && 'text-muted-foreground'
              )}
              style={
                value
                  ? { fontFamily: `"${value.replace(/"/g, '')}", system-ui` }
                  : undefined
              }
            >
              {value || 'Inherit'}
            </span>
            <ChevronsUpDown
              className="size-3 shrink-0 opacity-50"
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" onKeyDown={onKeyDown}>
          <div className="flex items-center gap-1.5 border-b px-2">
            <Search className="size-3.5 shrink-0 opacity-50" aria-hidden />
            <Input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              placeholder="Search fonts…"
              aria-label={`Search fonts for ${label}`}
              autoComplete="off"
              spellCheck={false}
              // Transparent, not `bg-background`: the popover is its own
              // surface, and the input's default fill would paint a lighter
              // block from the icon to the right edge of the row.
              className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label={`${label} options`}
            className="max-h-64 overflow-y-auto p-1"
          >
            {custom && (
              <Row
                index={0}
                active={active === 0}
                family={custom}
                tag="use as typed"
                selected={value === custom}
                onPick={choose}
                onHover={setActive}
              />
            )}
            {matches.map((option, index) => {
              const row = custom ? index + 1 : index;
              return (
                <Row
                  key={`${option.safe ? 's' : 'g'}:${option.family}`}
                  index={row}
                  active={active === row}
                  family={option.family}
                  tag={option.tag}
                  selected={value === option.family}
                  onPick={choose}
                  onHover={setActive}
                />
              );
            })}
            {rows.length === 0 && (
              <p className={cn(HINT_CLASS, 'px-2 py-3 text-center')}>
                {catalog.safe.length + catalog.google.length === 0
                  ? 'The font catalog is unavailable — type a family name.'
                  : 'No family matches.'}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between border-t px-1.5 py-1">
            <QuietButton onClick={browse}>Browse all fonts…</QuietButton>
            {value && (
              <QuietButton
                onClick={() => {
                  onCommit(null);
                  setOpen(false);
                }}
              >
                Clear
              </QuietButton>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const Row = React.memo(function Row({
  index,
  active,
  family,
  tag,
  selected,
  onPick,
  onHover,
}: {
  index: number;
  active: boolean;
  family: string;
  tag: string;
  selected: boolean;
  onPick: (family: string) => void;
  onHover: (index: number) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-row={index}
      onMouseMove={() => onHover(index)}
      onClick={() => onPick(family)}
      className={cn(
        'flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-xs',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      <Check
        className={cn(
          'size-3 shrink-0',
          selected ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{family}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{tag}</span>
    </button>
  );
});
