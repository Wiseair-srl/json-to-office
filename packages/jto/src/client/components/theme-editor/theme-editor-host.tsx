import React, { useCallback, useMemo } from 'react';
import { EditorMonacoThemeMemoized } from '../json-editor/editor-monaco-theme';
import { ThemeVisualEditor } from './theme-visual-editor';
import { useSettingsStore } from '../../store/settings-store-provider';
import { useDocumentsStore } from '../../store/documents-store-provider';
import { getThemeName } from '../../lib/theme-validation';
import { themeView } from '../../lib/theme-editor/view';
import type { TextFile } from '../../lib/types';

/**
 * A theme tab: the same file seen either as a form or as JSON source.
 *
 * The switch between the two sits in the app header, beside Run, rather than
 * on a strip of its own — a tab this narrow cannot spare 36px to say what it
 * already is. The header owns the preference; this reads the same rule so the
 * two never disagree about which view a forced JSON is showing.
 */
export function ThemeEditorHost({
  document,
  onChange,
}: {
  document: TextFile;
  onChange: (text: string) => void;
}) {
  const preferred = useSettingsStore((s) => s.themeEditorView);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const hasPendingDiff = useDocumentsStore(
    (s) => s.pendingDiffs[document.name] !== undefined
  );

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(document.text);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [document.text]);
  const themeName = parsed ? getThemeName(parsed) : null;

  // Which open documents name this theme, and which other open theme files
  // claim the same name — the two things the Identity section has to say.
  const usedBy = useDocumentsStore((s) => {
    if (!themeName) return EMPTY;
    const names = s.documents
      .filter(
        (d) =>
          (s.documentTypes[d.name] ?? 'application/json+report') ===
            'application/json+report' && documentThemeName(d.text) === themeName
      )
      .map((d) => d.name);
    return names.length === 0 ? EMPTY : names.join('\n');
  });
  const nameClash = useDocumentsStore((s) => {
    if (!themeName) return EMPTY;
    const names = s.documents
      .filter(
        (d) =>
          d.name !== document.name &&
          s.documentTypes[d.name] === 'application/json+theme' &&
          themeFileName(d.text) === themeName
      )
      .map((d) => d.name);
    return names.length === 0 ? EMPTY : names.join('\n');
  });

  const { view } = themeView({
    preferred,
    parses: parsed !== null,
    hasPendingDiff,
  });

  const openJson = useCallback(
    () => setSettings({ themeEditorView: 'json' }),
    [setSettings]
  );

  return (
    <div className="h-full">
      {view === 'visual' ? (
        <ThemeVisualEditor
          docName={document.name}
          text={document.text}
          onChange={onChange}
          onOpenJson={openJson}
          usedBy={usedBy === EMPTY ? NONE : usedBy.split('\n')}
          nameClash={nameClash === EMPTY ? NONE : nameClash.split('\n')}
        />
      ) : (
        <EditorMonacoThemeMemoized document={document} onChange={onChange} />
      )}
    </div>
  );
}

const EMPTY = '';
const NONE: string[] = [];

/** `props.theme` of a document, or null when it has none or does not parse. */
function documentThemeName(text: string): string | null {
  try {
    const theme = JSON.parse(text)?.props?.theme;
    return typeof theme === 'string' ? theme : null;
  } catch {
    return null;
  }
}

/** The `name` inside a theme file, or null. */
function themeFileName(text: string): string | null {
  try {
    return getThemeName(JSON.parse(text));
  } catch {
    return null;
  }
}

export const ThemeEditorHostMemoized = React.memo(ThemeEditorHost);
