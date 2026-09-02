import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Renders a single key cap (e.g. ⌘, Shift, K).
 * Compose multiple `<Kbd>` elements inside a `<KbdGroup>` for combos.
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        // No tooltip-specific case any more: a tooltip is a popover surface
        // like every other overlay, and the muted chip reads on it as it does
        // everywhere else.
        'pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Groups multiple `<Kbd>` keys for a shortcut combo (e.g. ⌘ Shift P).
 */
export function KbdGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {children}
    </span>
  );
}

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/**
 * Convenience: renders a full shortcut from a descriptor string.
 * Accepts formats like "mod+shift+p", "mod+k", "mod+b".
 * `mod` becomes ⌘ on Mac, Ctrl on others.
 */
export function KbdShortcut({
  shortcut,
  className,
}: {
  shortcut: string;
  className?: string;
}) {
  const parts = shortcut.split('+').map((k) => k.trim().toLowerCase());

  const labels: string[] = parts.map((p) => {
    switch (p) {
      case 'mod':
        return IS_MAC ? '⌘' : 'Ctrl';
      case 'shift':
        return IS_MAC ? '⇧' : 'Shift';
      case 'alt':
        return IS_MAC ? '⌥' : 'Alt';
      case 'ctrl':
        return IS_MAC ? '⌃' : 'Ctrl';
      case 'enter':
        return '↵';
      default:
        return p.toUpperCase();
    }
  });

  return (
    <KbdGroup className={className}>
      {labels.map((label, i) => (
        <Kbd key={i}>{label}</Kbd>
      ))}
    </KbdGroup>
  );
}
