/**
 * Monaco themes for the playground editor.
 *
 * The editor pane is the largest surface in the app, and stock `vs` / `vs-dark`
 * paint it pure white / #1E1E1E — neither of which is a plane in the Wiseair
 * system, so the editor read as a foreign panel bolted onto the shell. Dark in
 * particular follows the ramp (canvas #1D2130 → card #282c3e → fill #3b4054 →
 * border #494e65) rather than collapsing onto one near-black. These
 * themes inherit the stock JSON token colors (already tuned for legibility on
 * a near-white / near-black bed, and already following the same blue-keys /
 * red-strings / green-numbers convention the schema viewer uses) and repaint
 * only the chrome — background, gutter, current-line, selection, and the
 * floating widgets — from the design tokens.
 *
 * Values are the hex equivalents of the HSL triplets in `index.css`; Monaco
 * takes hex only and needs both themes defined up front, while only the active
 * theme's variables are readable from the document at any moment.
 */

import type { Monaco } from '@monaco-editor/react';

export const MONACO_THEME_LIGHT = 'jto-light';
export const MONACO_THEME_DARK = 'jto-dark';

/** Hex mirror of the light `:root` tokens the editor chrome draws from. */
const LIGHT = {
  surface: '#ffffff', // --surface-editor (= --card)
  popover: '#ffffff', // --popover
  foreground: '#1a1f2e', // --foreground
  muted: '#546f9c', // --muted-foreground
  border: '#e2e6ed', // --border
  fill: '#f8f9fc', // --accent / --muted / --header-bg (subtle fill)
  lineHighlight: '#edeff3', // --sidebar-accent (hover / active surface)
  selection: '#4f7ef833', // --data-blue wash
  inserted: '#16a34a26', // --success wash
  removed: '#ef444426', // --destructive wash
};

/** Hex mirror of the `.dark` tokens — the surface ramp, not one flat black. */
const DARK = {
  surface: '#282c3e', // --surface-editor (= --card)
  popover: '#32374e', // --popover
  foreground: '#fafafa', // --foreground
  muted: '#a4b2cc', // --muted-foreground
  border: '#494e65', // --border
  fill: '#3b4054', // --accent / --muted / --header-bg (subtle fill)
  lineHighlight: '#3b405499', // --accent, softened into a current-line band
  selection: '#85a6fa33', // --primary wash
  inserted: '#34d39926', // --success wash
  removed: '#fca5a526', // --destructive wash
};

type Palette = typeof LIGHT;

/**
 * Chrome-only color overrides. `inherit: true` keeps every syntax rule from
 * the base theme, so JSON highlighting is untouched.
 */
function chrome(p: Palette): Record<string, string> {
  return {
    'editor.background': p.surface,
    'editor.foreground': p.foreground,
    'editor.lineHighlightBackground': p.lineHighlight,
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': p.selection,
    'editor.inactiveSelectionBackground': p.fill,
    'editorCursor.foreground': p.foreground,

    'editorGutter.background': p.surface,
    'editorLineNumber.foreground': `${p.muted}99`,
    'editorLineNumber.activeForeground': p.foreground,
    'editorIndentGuide.background1': p.border,
    'editorIndentGuide.activeBackground1': p.muted,
    'editorWhitespace.foreground': p.border,

    // Floating surfaces sit on --popover, one step above the card, exactly as
    // menus and dialogs do elsewhere in the app.
    'editorWidget.background': p.popover,
    'editorWidget.border': p.border,
    'editorSuggestWidget.background': p.popover,
    'editorSuggestWidget.border': p.border,
    'editorSuggestWidget.selectedBackground': p.fill,
    'editorSuggestWidget.foreground': p.foreground,
    'editorHoverWidget.background': p.popover,
    'editorHoverWidget.border': p.border,
    'input.background': p.surface,
    'input.border': p.border,
    'dropdown.background': p.popover,
    'dropdown.border': p.border,
    'list.hoverBackground': p.fill,
    'list.activeSelectionBackground': p.fill,
    'list.activeSelectionForeground': p.foreground,

    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': `${p.muted}33`,
    'scrollbarSlider.hoverBackground': `${p.muted}55`,
    'scrollbarSlider.activeBackground': `${p.muted}77`,

    // The diff editor is the compare view; keep its beds on the semantic pair.
    'diffEditor.insertedTextBackground': p.inserted,
    'diffEditor.removedTextBackground': p.removed,
    'diffEditor.border': p.border,

    'editorGroupHeader.tabsBackground': p.fill,
    'editorOverviewRuler.border': '#00000000',
  };
}

let registered = false;

/**
 * Register both themes on a Monaco instance. Idempotent — safe to call from
 * every mount path (global config, plugin reconfiguration, lazy editors).
 */
export function registerMonacoThemes(monaco: Monaco): void {
  if (registered) return;
  monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: chrome(LIGHT),
  });
  monaco.editor.defineTheme(MONACO_THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: chrome(DARK),
  });
  registered = true;
}

/** Theme name for a resolved `light` / `dark` preference. */
export function monacoThemeFor(resolvedTheme: string): string {
  return resolvedTheme === 'dark' ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}
