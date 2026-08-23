import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Shared primitives for the playground rail.
 *
 * The rail is deliberately recessive: it orients you, it is not where the work
 * happens. Everything here is quiet by default — muted foregrounds, hairlines
 * instead of borders-as-decoration, no elevation — so the one row you are
 * editing is the only thing in the panel with real contrast.
 *
 * Quiet has a floor. `--sidebar-foreground` below /65 drops under 4.5:1 on the
 * light sidebar, so text lives in a /65–/85 band and the hierarchy is carried
 * by size (13 / 11 / 10px), weight, and uppercase tracking instead of by
 * fading things out. Only icons — graphics, 3:1 — go as low as /55.
 */

/** Case-insensitive substring match used by the rail filter. */
export function matchesQuery(value: string, query: string): boolean {
  if (!query) return true;
  return value.toLowerCase().includes(query.toLowerCase());
}

/**
 * Marks the matched run with weight, not colour. Every hue in this system is
 * spoken for (primary = action, data-blue = preview, warning = in use,
 * accent2 = theme category), so a tinted highlight would collide with a status
 * meaning. Weight is free.
 */
export function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent p-0 font-semibold text-current">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

/**
 * Eyebrow above each rail section: disclosure, name, count, then actions
 * pushed right. 11px uppercase needs the tracking to stay legible at this
 * weight.
 *
 * Every section in the rail wears this, chevron on the leading edge — the
 * panel used to carry three different expand affordances (chevron left for the
 * library, chevron right for the outline, none for the open files), which made
 * three unrelated grammars out of one idea.
 */
export function SectionLabel({
  children,
  count,
  actions,
  className,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const label = (
    <>
      <ChevronRight
        aria-hidden
        className={cn(
          'size-3 shrink-0 transition-transform duration-150 ease-out',
          open && 'rotate-90'
        )}
      />
      <span className="text-[11px] font-medium tracking-[0.08em] uppercase">
        {children}
      </span>
      {count !== undefined && (
        <span className="text-[11px] font-normal tabular-nums text-sidebar-foreground/65">
          {count}
        </span>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 select-none',
        className
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm px-1',
          'text-sidebar-foreground/70 transition-colors',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none'
        )}
      >
        {label}
      </button>
      {actions && (
        <div className="flex shrink-0 items-center gap-0.5 pr-1">{actions}</div>
      )}
    </div>
  );
}

/**
 * 20px icon button for section actions. Sized down from the shared `Button`
 * on purpose — a 36px control next to an 11px label reads as the louder
 * element, which inverts the hierarchy of the rail.
 */
export const RailIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm',
      'text-sidebar-foreground/55 transition-colors',
      'hover:bg-sidebar-accent hover:text-sidebar-foreground',
      'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none',
      'disabled:pointer-events-none disabled:opacity-40',
      '[&>svg]:size-3.5',
      className
    )}
    {...props}
  />
));
RailIconButton.displayName = 'RailIconButton';

/**
 * Status marker on a row's right edge. Reserved for the two states that are
 * *not* the row you are editing — the active row already owns the accent bed,
 * and a third bed on screen would flatten the hierarchy.
 */
export function StatusDot({
  tone,
  className,
}: {
  tone: 'preview' | 'in-use';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        tone === 'preview' ? 'bg-data-blue' : 'bg-warning',
        className
      )}
    />
  );
}

/** Quiet, actionable empty state. A dead sentence here wastes the only row. */
export function EmptyRow({
  icon: Icon,
  label,
  onClick,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  hint?: string;
}) {
  if (!onClick) {
    return (
      <p className="px-2 py-1 text-[12px] leading-tight text-sidebar-foreground/70">
        {label}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        'flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2',
        'text-[13px] text-sidebar-foreground/70 transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-foreground',
        'focus-visible:ring-sidebar-ring focus-visible:ring-1 focus-visible:outline-none'
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
