import React, { useCallback } from 'react';
import { Braces, SlidersHorizontal } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { useSettingsStore } from '../../store/settings-store-provider';
import { parsesAsObject, themeView } from '../../lib/theme-editor/view';
import type { ThemeView } from '../../lib/theme-editor/view';
import { cn } from '../../lib/utils';

/**
 * Form or source, for the theme on screen. Nothing at all for anything else.
 *
 * It lives in the app header because the theme tab has no header of its own:
 * a switch is two words wide and a strip to hold it costs 36px of a pane that
 * is mostly form. Header space is only spent while a theme is open.
 */
export function ThemeViewSwitch() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const preferred = useSettingsStore((s) => s.themeEditorView);

  // A string, so the selector's identity check stays cheap: 'theme' when the
  // active tab is one, '' otherwise.
  const activeThemeName = useDocumentsStore((s) =>
    s.activeTab && s.documentTypes[s.activeTab] === 'application/json+theme'
      ? s.activeTab
      : ''
  );
  const parses = useDocumentsStore((s) => {
    if (!activeThemeName) return true;
    const document = s.documents.find((d) => d.name === activeThemeName);
    return document ? parsesAsObject(document.text) : true;
  });
  const hasPendingDiff = useDocumentsStore(
    (s) => !!activeThemeName && s.pendingDiffs[activeThemeName] !== undefined
  );

  const setView = useCallback(
    (next: ThemeView) => setSettings({ themeEditorView: next }),
    [setSettings]
  );

  if (!activeThemeName) return null;

  const { view, forcedReason } = themeView({
    preferred,
    parses,
    hasPendingDiff,
  });

  return (
    <div
      role="tablist"
      aria-label="Theme editor view"
      title={forcedReason}
      className="flex h-7 shrink-0 items-center rounded-sm border border-border/70 bg-muted/60 p-0.5"
    >
      <ViewButton
        active={view === 'visual'}
        disabled={forcedReason !== undefined}
        onClick={() => setView('visual')}
        icon={SlidersHorizontal}
        label="Visual"
      />
      <ViewButton
        active={view === 'json'}
        onClick={() => setView('json')}
        icon={Braces}
        label="JSON"
      />
    </div>
  );
}

function ViewButton({
  active,
  disabled,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      // The label is `display: none` below `md`, which takes it out of the
      // accessibility tree along with the button's only name.
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-6 cursor-pointer items-center gap-1.5 rounded-[3px] px-2 text-xs transition-colors',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'bg-background text-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

export const ThemeViewSwitchMemoized = React.memo(ThemeViewSwitch);
