import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Pipette, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  hexToHsv,
  hsvToHex,
  readableInk,
  type Hsv,
} from '../../lib/theme-editor/color';
import {
  normalizeHex,
  resolveColor,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import { cn } from '../../lib/utils';
import { INPUT_CLASS, useDraft } from './theme-editor-shared';

/**
 * The colour control: a swatch that opens a picker, and a field beside it
 * that still takes a typed hex — or the name of another token, because both
 * schemas let one colour reference another.
 *
 * The picker holds its own HSV for as long as it is open. Hex is a lossy
 * home for it (every grey comes back as hue 0, black loses saturation), so
 * re-deriving HSV from the committed value on each drag would make the hue
 * rail jump under the pointer at the edges of the square.
 *
 * Dragging writes through on an animation frame rather than on every pointer
 * move: one theme edit is a re-parse and a re-serialise of the whole file, and
 * a 120Hz trackpad would otherwise ask for a hundred of them a second.
 */

const TOKEN_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;
const PLACEHOLDER_HEX = '#D4D4D8';

export interface ColorToken {
  key: string;
  hex: string;
}

/** Commit at most once per frame while a pointer drag is in flight. */
function useFrameCommit(commit: (hex: string) => void) {
  const pending = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(commit);
  latest.current = commit;

  const flush = useCallback(() => {
    frame.current = null;
    const value = pending.current;
    pending.current = null;
    if (value !== null) latest.current(value);
  }, []);

  const schedule = useCallback(
    (hex: string) => {
      pending.current = hex;
      if (frame.current === null) {
        frame.current = requestAnimationFrame(flush);
      }
    },
    [flush]
  );

  // A drag that ends between frames must not lose its last position.
  const finish = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      flush();
    }
  }, [flush]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  return { schedule, finish };
}

/** Pointer drag over a box, reported as 0–1 on each axis. */
function useDragArea(
  onMove: (x: number, y: number) => void,
  onEnd: () => void
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const report = useCallback(
    (event: React.PointerEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      onMove(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
    },
    [onMove]
  );
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      report(event);
    },
    [report]
  );
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      report(event);
    },
    [report]
  );
  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onEnd();
    },
    [onEnd]
  );
  return { ref, onPointerDown, onPointerMove, onPointerUp };
}

function SaturationArea({
  hsv,
  onChange,
  onEnd,
}: {
  hsv: Hsv;
  onChange: (next: Hsv) => void;
  onEnd: () => void;
}) {
  const move = useCallback(
    (x: number, y: number) => onChange({ ...hsv, s: x, v: 1 - y }),
    [hsv, onChange]
  );
  const drag = useDragArea(move, onEnd);
  const step = useCallback(
    (event: React.KeyboardEvent) => {
      const delta = event.shiftKey ? 0.1 : 0.02;
      const map: Record<string, Partial<Hsv>> = {
        ArrowLeft: { s: Math.max(0, hsv.s - delta) },
        ArrowRight: { s: Math.min(1, hsv.s + delta) },
        ArrowUp: { v: Math.min(1, hsv.v + delta) },
        ArrowDown: { v: Math.max(0, hsv.v - delta) },
      };
      const next = map[event.key];
      if (!next) return;
      event.preventDefault();
      onChange({ ...hsv, ...next });
      onEnd();
    },
    [hsv, onChange, onEnd]
  );
  return (
    <div
      ref={drag.ref}
      role="application"
      aria-label="Saturation and brightness"
      tabIndex={0}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onKeyDown={step}
      className={cn(
        'relative h-32 w-full cursor-crosshair touch-none overflow-hidden rounded-sm border',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
      )}
      style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#fff,transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,#000,transparent)]" />
      <span
        aria-hidden
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          backgroundColor: hsvToHex(hsv),
        }}
      />
    </div>
  );
}

const HUE_GRADIENT =
  'linear-gradient(to right,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)';

function HueRail({
  hsv,
  onChange,
  onEnd,
}: {
  hsv: Hsv;
  onChange: (next: Hsv) => void;
  onEnd: () => void;
}) {
  const move = useCallback(
    (x: number) => onChange({ ...hsv, h: x * 360 }),
    [hsv, onChange]
  );
  const drag = useDragArea(move, onEnd);
  return (
    <div
      ref={drag.ref}
      role="slider"
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      tabIndex={0}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onKeyDown={(event) => {
        const delta =
          event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!delta) return;
        event.preventDefault();
        onChange({
          ...hsv,
          h: (hsv.h + delta * (event.shiftKey ? 10 : 2) + 360) % 360,
        });
        onEnd();
      }}
      className={cn(
        'relative h-3 w-full cursor-ew-resize touch-none rounded-full border',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
      )}
      style={{ background: HUE_GRADIENT }}
    >
      <span
        aria-hidden
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        style={{
          left: `${(hsv.h / 360) * 100}%`,
          backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }),
        }}
      />
    </div>
  );
}

function TokenChips({
  tokens,
  active,
  onPick,
}: {
  tokens: readonly ColorToken[];
  active: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {tokens.map((token) => {
        const selected = token.key === active;
        return (
          <Tooltip key={token.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onPick(token.key)}
                aria-label={`Use token ${token.key}`}
                aria-pressed={selected}
                className={cn(
                  'flex size-6 cursor-pointer items-center justify-center rounded-sm border',
                  'transition-shadow focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
                  selected
                    ? 'ring-1 ring-ring ring-offset-1 ring-offset-popover'
                    : 'border-border/70'
                )}
                style={{ backgroundColor: token.hex }}
              >
                {selected && (
                  <Check
                    className="size-3"
                    style={{ color: readableInk(token.hex) }}
                    aria-hidden
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="font-mono text-xs">
                {token.key} {token.hex}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Swatch + field. The swatch opens the picker; the field takes a hex, or a
 * token name when `allowReference`.
 */
export function ColorControl({
  id,
  label,
  value,
  resolved,
  onCommit,
  allowReference = true,
  tokens,
  className,
}: {
  id?: string;
  label: string;
  /** Raw JSON value: a hex, a token name, or nothing. */
  value: string | undefined;
  /** What the value resolves to after following references. */
  resolved: string | null;
  onCommit: (next: string | null) => void;
  allowReference?: boolean;
  /** Theme colours offered as one-click references inside the picker. */
  tokens?: readonly ColorToken[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const commitText = useCallback(
    (draft: string) => {
      const trimmed = draft.trim();
      if (trimmed === '') {
        onCommit(null);
        return;
      }
      const hex = normalizeHex(trimmed);
      if (/^#[0-9A-F]{6}$/.test(hex)) {
        onCommit(hex);
        return;
      }
      if (allowReference && TOKEN_NAME.test(trimmed)) onCommit(trimmed);
      // Anything else reverts: the input drops its draft on blur regardless.
    },
    [allowReference, onCommit]
  );
  const { props: draft } = useDraft(value ?? '', commitText);
  const swatch = resolved ?? PLACEHOLDER_HEX;
  const reference = value && !value.startsWith('#') ? value : null;

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} picker`}
            className={cn(
              'relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-sm border',
              'transition-shadow focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
              resolved
                ? 'border-border hover:ring-1 hover:ring-ring/50'
                : 'border-dashed border-muted-foreground/40 opacity-60'
            )}
            style={{ backgroundColor: swatch }}
          />
        </PopoverTrigger>
        {/* Focus lands on the saturation square, which takes arrow keys, so
            the picker is usable without a pointer from the moment it opens. */}
        <PopoverContent className="w-64">
          <ColorPickerBody
            label={label}
            value={value}
            resolved={resolved}
            tokens={allowReference ? tokens : undefined}
            onCommit={onCommit}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        type="text"
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        placeholder="#RRGGBB"
        title={reference && resolved ? `${reference} → ${resolved}` : undefined}
        className={cn(
          INPUT_CLASS,
          'w-full min-w-0 font-mono',
          reference ? 'lowercase' : 'uppercase'
        )}
        {...draft}
      />
    </div>
  );
}

function ColorPickerBody({
  label,
  value,
  resolved,
  tokens,
  onCommit,
  onDone,
}: {
  label: string;
  value: string | undefined;
  resolved: string | null;
  tokens?: readonly ColorToken[];
  onCommit: (next: string | null) => void;
  onDone: () => void;
}) {
  // Seeded once per opening — this body only exists while the popover is up —
  // so HSV is the truth for as long as it lasts and hex is derived from it: a
  // drag through grey or black keeps the hue it came in with.
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(resolved ?? PLACEHOLDER_HEX) ?? { h: 0, s: 0, v: 0.8 }
  );
  const seeded = useRef(resolved);
  if (resolved !== seeded.current) {
    // A token chip or a typed hex changed the value from outside the square.
    seeded.current = resolved;
    const next = hexToHsv(resolved ?? PLACEHOLDER_HEX);
    if (next) setHsv(next);
  }

  const commitHex = useCallback((hex: string) => onCommit(hex), [onCommit]);
  const { schedule, finish } = useFrameCommit(commitHex);
  const onChange = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      seeded.current = hex;
      schedule(hex);
    },
    [schedule]
  );

  const hex = hsvToHex(hsv);
  const eyedropper =
    typeof window !== 'undefined' && 'EyeDropper' in window
      ? async () => {
          try {
            const EyeDropperCtor = (
              window as unknown as {
                EyeDropper: new () => {
                  open: () => Promise<{ sRGBHex: string }>;
                };
              }
            ).EyeDropper;
            const picked = await new EyeDropperCtor().open();
            const normalized = normalizeHex(picked.sRGBHex);
            if (/^#[0-9A-F]{6}$/.test(normalized)) onCommit(normalized);
          } catch {
            // Dismissed, or denied. Nothing to say about either.
          }
        }
      : null;

  return (
    <div className="flex flex-col gap-2.5">
      <SaturationArea hsv={hsv} onChange={onChange} onEnd={finish} />
      <HueRail hsv={hsv} onChange={onChange} onEnd={finish} />
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-6 shrink-0 rounded-sm border"
          style={{ backgroundColor: resolved ?? PLACEHOLDER_HEX }}
        />
        <PickerHexInput hex={hex} onCommit={onCommit} label={label} />
        {eyedropper && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={eyedropper}
                aria-label="Pick a colour from the screen"
                className={cn(
                  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm',
                  'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
                )}
              >
                <Pipette className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Pick from the screen</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                onCommit(null);
                onDone();
              }}
              aria-label={`Clear ${label}`}
              disabled={value === undefined}
              className={cn(
                'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm',
                'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-40'
              )}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Clear</p>
          </TooltipContent>
        </Tooltip>
      </div>
      {tokens && tokens.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t pt-2">
          <span className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Theme colours
          </span>
          <TokenChips
            tokens={tokens}
            active={value && !value.startsWith('#') ? value : null}
            onPick={(key) => onCommit(key)}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            A token follows the theme when that colour changes; a hex does not.
          </p>
        </div>
      )}
    </div>
  );
}

/** The hex inside the popover: shows the square's live value, commits on blur. */
function PickerHexInput({
  hex,
  label,
  onCommit,
}: {
  hex: string;
  label: string;
  onCommit: (next: string | null) => void;
}) {
  const commit = useCallback(
    (draft: string) => {
      const normalized = normalizeHex(draft);
      if (/^#[0-9A-F]{6}$/.test(normalized)) onCommit(normalized);
    },
    [onCommit]
  );
  const { props: draft } = useDraft(hex, commit);
  return (
    <Input
      type="text"
      aria-label={`${label} hex`}
      autoComplete="off"
      spellCheck={false}
      // Flat on the popover, like every other input in the app is flat on
      // the surface behind it; `bg-background` here would read as a filled
      // field only because the popover is a lighter white.
      className={cn(
        INPUT_CLASS,
        'h-7 min-w-0 flex-1 bg-transparent font-mono uppercase'
      )}
      {...draft}
    />
  );
}

/**
 * Theme colours as picker chips, memoised on the colours themselves.
 *
 * Every edit anywhere in a theme produces a new parse, so a list derived from
 * the theme object would be a new array each time and would re-render every
 * memoised row that holds one. Keyed on the serialised colours, the identity
 * only moves when the palette actually does.
 */
export function useThemeColorTokens(theme: ThemeJson): ColorToken[] {
  const json = JSON.stringify(theme.colors ?? null);
  return useMemo(() => {
    const colors = JSON.parse(json) as Record<string, unknown> | null;
    // `themeColorTokens` reads nothing but `colors`, so this stands in for
    // the whole theme.
    return colors ? themeColorTokens({ colors }) : [];
  }, [json]);
}

/** Theme colours as picker chips, in the order the theme declares them. */
export function themeColorTokens(theme: ThemeJson): ColorToken[] {
  const colors = theme.colors;
  if (!colors || typeof colors !== 'object') return [];
  const out: ColorToken[] = [];
  for (const [key, value] of Object.entries(
    colors as Record<string, unknown>
  )) {
    const hex = resolveColor(theme, value);
    if (hex) out.push({ key, hex });
  }
  return out;
}
