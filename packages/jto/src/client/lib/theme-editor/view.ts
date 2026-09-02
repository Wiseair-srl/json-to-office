import type { Settings } from '../types';

export type ThemeView = 'visual' | 'json';

export interface ThemeViewState {
  /** The view actually on screen. */
  view: ThemeView;
  /** Set when the preference is being overridden, and why. */
  forcedReason: string | undefined;
}

/**
 * Which of a theme's two views is showing.
 *
 * The switch lives in the app header and the views live in the tab, so the
 * rule that decides between them cannot live in either: the form needs the
 * file to parse, and a pending AI change has to be read as text, so both of
 * those force JSON for as long as they last. The author's preference comes
 * back on its own once they are gone.
 */
export function themeView(input: {
  preferred: Settings['themeEditorView'];
  parses: boolean;
  hasPendingDiff: boolean;
}): ThemeViewState {
  const forcedReason = input.hasPendingDiff
    ? 'Review the proposed change first'
    : !input.parses
      ? 'The visual view needs the JSON to parse'
      : undefined;
  return {
    view: forcedReason ? 'json' : input.preferred ?? 'visual',
    forcedReason,
  };
}

/** Whether a document's text is a JSON object — the form's precondition. */
export function parsesAsObject(text: string): boolean {
  try {
    const value = JSON.parse(text);
    return !!value && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}
