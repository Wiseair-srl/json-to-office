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
      className={cn(
        'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded border border-border bg-background text-[11px] font-mono font-medium text-muted-foreground shadow-[0_1px_0_0] shadow-border/50 leading-none select-none',
        className,
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
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

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
