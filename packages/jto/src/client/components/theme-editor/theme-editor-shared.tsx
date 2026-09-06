import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import { Input } from '../ui/input';
import { API_ENDPOINTS } from '../../config/api';
import type { Path } from '../../lib/theme-editor/model';
import { cn } from '../../lib/utils';

/**
 * Primitives the theme form is built from.
 *
 * Two rules shape everything here. The form never holds the theme: an edit
 * is a path and a value handed to the editor, which writes the JSON back to
 * the tab. And typing never fights the round trip: text and number inputs
 * keep a draft while focused and commit on blur or Enter, so the re-render
 * that follows a commit lands on an input that is no longer being typed in.
 */

// ---------------------------------------------------------------------------
// Editor context
// ---------------------------------------------------------------------------

export interface ThemeEditorActions {
  /** Write a leaf. Containers on the way are created. */
  set: (path: Path, value: unknown) => void;
  /**
   * Remove a leaf. With `prune`, empty objects left behind are removed too,
   * up to (not including) `keepDepth` path segments — a cleared
   * `lineSpacing.value` must not leave `lineSpacing: {}` behind, but the
   * style itself has to stay.
   */
  remove: (path: Path, prune?: { keepDepth: number }) => void;
}

const ThemeEditorContext = createContext<ThemeEditorActions | null>(null);

export const ThemeEditorProvider = ThemeEditorContext.Provider;

export function useThemeEditor(): ThemeEditorActions {
  const ctx = useContext(ThemeEditorContext);
  if (!ctx) {
    throw new Error('useThemeEditor must be used inside ThemeVisualEditor');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Font catalog (fetched once per session)
// ---------------------------------------------------------------------------

export interface FontCatalog {
  safe: string[];
  google: {
    family: string;
    category: string;
    weights: number[];
    hasItalic: boolean;
  }[];
}

const EMPTY_CATALOG: FontCatalog = { safe: [], google: [] };
let catalogCache: FontCatalog | null = null;
let catalogRequest: Promise<FontCatalog> | null = null;

function loadCatalog(): Promise<FontCatalog> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (!catalogRequest) {
    catalogRequest = fetch(API_ENDPOINTS.fonts.catalog)
      .then((r) => (r.ok ? r.json() : EMPTY_CATALOG))
      .then((data: unknown) => {
        const parsed = data as Partial<FontCatalog> | null;
        catalogCache = {
          safe: Array.isArray(parsed?.safe) ? parsed.safe : [],
          google: Array.isArray(parsed?.google) ? parsed.google : [],
        };
        return catalogCache;
      })
      .catch(() => {
        // The datalist is a convenience; a missing catalog leaves the inputs
        // free-text, which is what they are anyway.
        catalogRequest = null;
        return EMPTY_CATALOG;
      });
  }
  return catalogRequest;
}

export function useFontCatalog(): FontCatalog {
  const [catalog, setCatalog] = useState<FontCatalog>(
    catalogCache ?? EMPTY_CATALOG
  );
  useEffect(() => {
    let live = true;
    if (!catalogCache) {
      loadCatalog().then((c) => {
        if (live) setCatalog(c);
      });
    }
    return () => {
      live = false;
    };
  }, []);
  return catalog;
}

// ---------------------------------------------------------------------------
// Shared classes
// ---------------------------------------------------------------------------

export const INPUT_CLASS = 'h-7 px-2 text-xs shadow-none';
export const SELECT_TRIGGER_CLASS =
  'h-7 min-h-0 w-full gap-1.5 px-2 py-0 text-xs shadow-none [&>span]:truncate [&>span]:whitespace-nowrap';
export const HINT_CLASS = 'text-[11px] leading-snug text-muted-foreground';
export const FIELD_LABEL_CLASS =
  'text-[11px] font-medium leading-none text-muted-foreground';

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

/**
 * A form section wearing the rail's eyebrow: disclosure, 11px uppercase
 * tracked name, then a one-line hint under it. Hairline above, no elevation.
 */
export function EditorSection({
  title,
  hint,
  actions,
  defaultOpen = true,
  forceOpen,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  /** Held open regardless of the disclosure — while a search is filtering. */
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [toggled, setOpen] = useState(defaultOpen);
  const open = forceOpen ?? toggled;
  return (
    // The rule divides one section from the one above it; the first has the
    // pane's own header there instead, and two hairlines is one too many.
    <section
      className="border-t border-border/60 pt-2 first:border-t-0"
      data-crumb={title}
    >
      <div className="flex h-7 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm px-1',
            'text-foreground/75 transition-colors hover:bg-accent hover:text-foreground',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 transition-transform duration-150 ease-out',
              open && 'rotate-90'
            )}
          />
          <span className="text-[11px] font-medium tracking-[0.08em] uppercase">
            {title}
          </span>
        </button>
        {actions && (
          <div className="flex shrink-0 items-center gap-1 pr-1">{actions}</div>
        )}
      </div>
      {hint && <p className={cn(HINT_CLASS, 'px-1 pb-2')}>{hint}</p>}
      {open && <div className="flex flex-col gap-3 px-1 pb-4">{children}</div>}
    </section>
  );
}

/** 10px tracked divider inside a section, as the rail uses between groups. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

/** 24px clear target; hidden (not disabled) when there is nothing to clear. */
export function ClearButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm',
        'text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
        className
      )}
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

/** Inline text-styled button for secondary actions ("Define", "More"). */
export function QuietButton({
  children,
  onClick,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5',
        'text-[11px] font-medium text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Segmented radio group; the options are the whole control. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex h-6 shrink-0 items-center rounded-sm border border-border/70 bg-muted/60 p-0.5',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-full flex-1 cursor-pointer items-center justify-center rounded-[3px] px-1.5 text-[11px] transition-colors',
              'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft inputs
// ---------------------------------------------------------------------------

/**
 * Local draft while focused, committed on blur or Enter, dropped on Escape.
 * The draft lives in a ref as well as state because the blur handler runs in
 * the same tick as an Escape's `setDraft(null)` and must see the cleared
 * value, not the closure's stale one.
 */
export function useDraft(value: string, commit: (draft: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const write = useCallback((next: string | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const onFocus = useCallback(() => write(value), [value, write]);
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => write(e.target.value),
    [write]
  );
  const onBlur = useCallback(() => {
    const pending = draftRef.current;
    write(null);
    if (pending !== null && pending !== value) commit(pending);
  }, [commit, value, write]);
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        write(null);
        e.currentTarget.blur();
      }
    },
    [write]
  );
  // For a control that commits without going through the input — a stepper
  // that keeps focus in the field. Without this the draft stays on the value
  // from before the step, hides it on screen, and commits it back on blur.
  // A no-op while nothing is focused, so it never opens a draft of its own.
  const syncDraft = useCallback(
    (next: string) => {
      if (draftRef.current !== null) write(next);
    },
    [write]
  );
  return {
    syncDraft,
    props: { value: draft ?? value, onFocus, onChange, onBlur, onKeyDown },
  };
}

type DraftInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur' | 'onFocus' | 'onKeyDown'
>;

/** Text input; an empty commit clears the key. */
export function DraftTextInput({
  value,
  onCommit,
  className,
  ...rest
}: DraftInputProps & {
  value: string | undefined;
  onCommit: (next: string | null) => void;
}) {
  const commit = useCallback(
    (draft: string) => onCommit(draft.trim() === '' ? null : draft),
    [onCommit]
  );
  const { props: draft } = useDraft(value ?? '', commit);
  return (
    <Input
      type="text"
      autoComplete="off"
      spellCheck={false}
      className={cn(INPUT_CLASS, className)}
      {...draft}
      {...rest}
    />
  );
}

/**
 * Number field: a typed value, a unit suffix inside the box, and a pair of
 * steppers on the trailing edge.
 *
 * The native spinner is not enough here — it is hidden by the base input
 * reset, it appears only on hover in some engines, and it cannot step by the
 * half points a font size wants. These buttons step by the field's own
 * `step`, hold to repeat, and start from a sensible value when the key is
 * unset, so a blank size can be raised without typing a number first.
 */

/** Steps a number field, repeating while held. */
function useRepeat(step: (direction: 1 | -1) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const start = useCallback(
    (direction: 1 | -1) => {
      step(direction);
      const tick = (delay: number) => {
        timer.current = setTimeout(() => {
          step(direction);
          tick(60);
        }, delay);
      };
      tick(400);
    },
    [step]
  );
  useEffect(() => stop, [stop]);
  return { start, stop };
}

export function DraftNumberInput({
  value,
  onCommit,
  unit,
  className,
  min,
  max,
  step = 1,
  ...rest
}: DraftInputProps & {
  value: number | undefined;
  onCommit: (next: number | null) => void;
  unit?: string;
}) {
  const commit = useCallback(
    (draft: string) => {
      const trimmed = draft.trim();
      if (trimmed === '') {
        onCommit(null);
        return;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) onCommit(parsed);
    },
    [onCommit]
  );
  const { props: draft, syncDraft } = useDraft(
    value === undefined ? '' : String(value),
    commit
  );

  const numericStep = typeof step === 'number' ? step : Number(step) || 1;
  const lower = typeof min === 'number' ? min : Number(min);
  const upper = typeof max === 'number' ? max : Number(max);
  const bump = useCallback(
    (direction: 1 | -1) => {
      // An unset field steps from its floor, or from zero, rather than
      // refusing until a number is typed.
      const base = value ?? (Number.isFinite(lower) ? lower : 0);
      let next = base + direction * numericStep;
      if (Number.isFinite(lower)) next = Math.max(lower, next);
      if (Number.isFinite(upper)) next = Math.min(upper, next);
      // Float arithmetic on a 0.5 step leaves 12.299999999999999 behind.
      const stepped = Number(next.toFixed(4));
      // The steppers keep focus in the field, so a draft may be open on it.
      onCommit(stepped);
      syncDraft(String(stepped));
    },
    [lower, numericStep, onCommit, syncDraft, upper, value]
  );
  const repeat = useRepeat(bump);

  return (
    <div className="relative flex min-w-0 items-center">
      <Input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        className={cn(
          INPUT_CLASS,
          'tabular-nums',
          // Room for the steppers, plus the unit when there is one. Kept as
          // tight as the chrome allows: the narrowest field this is used in
          // is 6.5rem, and every pixel here is a pixel the number loses.
          // The native spinner is suppressed — these buttons replace it.
          unit ? 'pr-11' : 'pr-5',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className
        )}
        {...draft}
        {...rest}
      />
      {unit && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-5 text-[10px] text-muted-foreground"
        >
          {unit}
        </span>
      )}
      <div className="absolute right-0 flex h-7 w-4 flex-col border-l border-input/70">
        <StepButton
          label="Increase"
          icon={ChevronUp}
          onStart={() => repeat.start(1)}
          onStop={repeat.stop}
          disabled={
            Number.isFinite(upper) && value !== undefined && value >= upper
          }
        />
        <StepButton
          label="Decrease"
          icon={ChevronDown}
          onStart={() => repeat.start(-1)}
          onStop={repeat.stop}
          disabled={
            Number.isFinite(lower) && value !== undefined && value <= lower
          }
        />
      </div>
    </div>
  );
}

function StepButton({
  label,
  icon: Icon,
  onStart,
  onStop,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      disabled={disabled}
      onPointerDown={(event) => {
        // Keep focus (and any draft) in the field the buttons belong to.
        event.preventDefault();
        onStart();
      }}
      onPointerUp={onStop}
      onPointerLeave={onStop}
      onPointerCancel={onStop}
      className={cn(
        'flex h-1/2 cursor-pointer items-center justify-center',
        'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      <Icon className="size-2.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/** WCAG thresholds as the three state colours the system already rations. */
export function contrastTone(ratio: number): string {
  if (ratio >= 4.5) return 'text-success';
  if (ratio >= 3) return 'text-warning';
  return 'text-destructive';
}

export function ContrastBadge({
  label,
  ratio,
}: {
  label: string;
  ratio: number | null;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      <span
        className={cn(
          'font-medium tabular-nums',
          ratio === null ? 'text-muted-foreground' : contrastTone(ratio)
        )}
        title={
          ratio === null
            ? 'Both colours must resolve to a hex'
            : ratio >= 4.5
              ? 'Meets WCAG AA for body text'
              : ratio >= 3
                ? 'Large text only'
                : 'Below WCAG minimums'
        }
      >
        {ratio === null ? '—' : `${ratio.toFixed(1)}:1`}
      </span>
    </span>
  );
}
