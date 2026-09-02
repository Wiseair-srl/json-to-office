import React, { useCallback, useMemo, useRef } from 'react';
import { Braces } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { FORMAT } from '../../lib/env';
import {
  advancedKeys,
  deleteAt,
  ensureContainers,
  getAt,
  parseTheme,
  serializeTheme,
  setAt,
  type Path,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import {
  DraftTextInput,
  EditorSection,
  HINT_CLASS,
  QuietButton,
  ThemeEditorProvider,
  useThemeEditor,
  type ThemeEditorActions,
} from './theme-editor-shared';
import { cn } from '../../lib/utils';
import { ThemeColorsSection } from './theme-colors-section';
import { ThemeTypographySection } from './theme-typography-section';
import { ThemePageSection } from './theme-page-section';
import { ThemeStylesSection } from './theme-styles-section';

/**
 * The theme as a form.
 *
 * The tab owns the text; this component owns nothing. Every render parses
 * `text` and derives the form from it, and every edit is a pure change to
 * that parse written back through `onChange`. That is what keeps the two
 * views of a theme (this one and Monaco) from ever holding different files.
 *
 * `set` and `remove` are stable for the life of the editor and read the
 * latest parse from a ref, so memoised rows keep their identity across
 * writes and only the row whose value changed re-renders.
 */

export function ThemeVisualEditor({
  docName,
  text,
  onChange,
  onOpenJson,
  usedBy = [],
  nameClash = [],
}: {
  docName: string;
  text: string;
  onChange: (text: string) => void;
  onOpenJson: () => void;
  /** Open documents whose `props.theme` names this theme. */
  usedBy?: readonly string[];
  /** Other open theme files that declare the same name. */
  nameClash?: readonly string[];
}) {
  const parsed = useMemo(() => parseTheme(text), [text]);

  const latest = useRef<{
    theme: ThemeJson | null;
    onChange: (text: string) => void;
  }>({ theme: null, onChange });
  latest.current.theme = parsed.ok ? parsed.theme : null;
  latest.current.onChange = onChange;

  const update = useCallback((fn: (theme: ThemeJson) => ThemeJson) => {
    const current = latest.current.theme;
    // Never write over text the author is mid-way through fixing in JSON.
    if (!current) return;
    const next = fn(current);
    if (next === current) return;
    // Two edits in one tick (a picker firing twice, a switch and a clear)
    // must compose rather than the second clobbering the first, so the ref
    // moves ahead of the render that will confirm it.
    latest.current.theme = next;
    latest.current.onChange(serializeTheme(next));
  }, []);

  const set = useCallback(
    (path: Path, value: unknown) =>
      update((theme) => {
        const head = path[0];
        const container = typeof head === 'string' ? theme[head] : undefined;
        const base =
          path.length > 1 && (!container || typeof container !== 'object')
            ? ensureContainers(theme, FORMAT)
            : theme;
        return setAt(base, path, value);
      }),
    [update]
  );

  const remove = useCallback(
    (path: Path, prune?: { keepDepth: number }) =>
      update((theme) => {
        let next = deleteAt(theme, path);
        if (!prune) return next;
        let parent = path.slice(0, -1);
        while (parent.length > prune.keepDepth) {
          const value = getAt(next, parent);
          const emptyObject =
            !!value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value as object).length === 0;
          if (!emptyObject) break;
          next = deleteAt(next, parent);
          parent = parent.slice(0, -1);
        }
        return next;
      }),
    [update]
  );

  const actions = useMemo<ThemeEditorActions>(
    () => ({ set, remove }),
    [set, remove]
  );

  if (!parsed.ok) {
    return (
      <div className="flex h-full flex-col items-start gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          The theme JSON has an error:{' '}
          <span className="text-destructive">{parsed.error}</span>
        </p>
        <p className={HINT_CLASS}>
          The form stays read-only until the file parses, so nothing you typed
          in JSON is overwritten.
        </p>
        <Button variant="outline" size="sm" onClick={onOpenJson}>
          <Braces aria-hidden />
          Open JSON
        </Button>
      </div>
    );
  }

  const theme = parsed.theme;

  return (
    <ThemeEditorProvider value={actions}>
      <ScrollArea className="h-full">
        {/* Keyed by document so section disclosure resets per file. */}
        <div
          key={docName}
          className="@container mx-auto flex w-full max-w-[760px] flex-col gap-2 px-4 pt-1 pb-8"
        >
          <IdentitySection
            theme={theme}
            usedBy={usedBy}
            nameClash={nameClash}
          />
          <ThemeColorsSection theme={theme} />
          <ThemeTypographySection theme={theme} />
          {FORMAT === 'docx' && <ThemePageSection theme={theme} />}
          <ThemeStylesSection theme={theme} />
          <AdvancedSection theme={theme} onOpenJson={onOpenJson} />
        </div>
      </ScrollArea>
    </ThemeEditorProvider>
  );
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const IDENTITY_FIELDS: Record<
  string,
  readonly { key: string; label: string; hint?: string }[]
> = {
  docx: [
    { key: 'name', label: 'Name', hint: 'What a document puts in "theme"' },
    { key: 'displayName', label: 'Display name' },
    { key: 'description', label: 'Description' },
    { key: 'version', label: 'Version' },
  ],
  pptx: [
    { key: 'name', label: 'Name', hint: 'What a document puts in "theme"' },
  ],
};

function IdentityField({
  fieldKey,
  label,
  hint,
  value,
}: {
  fieldKey: string;
  label: string;
  hint?: string;
  value: string | undefined;
}) {
  const { set, remove } = useThemeEditor();
  const commit = useCallback(
    (next: string | null) =>
      next === null ? remove([fieldKey]) : set([fieldKey], next),
    [fieldKey, remove, set]
  );
  const id = `theme-identity-${fieldKey}`;
  return (
    <>
      <label htmlFor={id} className="flex flex-col pt-1.5 text-sm">
        {label}
        {hint && <span className={HINT_CLASS}>{hint}</span>}
      </label>
      <DraftTextInput
        id={id}
        value={value}
        onCommit={commit}
        className={fieldKey === 'name' ? 'font-mono' : undefined}
      />
    </>
  );
}

function IdentitySection({
  theme,
  usedBy,
  nameClash,
}: {
  theme: ThemeJson;
  usedBy: readonly string[];
  nameClash: readonly string[];
}) {
  const fields = IDENTITY_FIELDS[FORMAT];
  return (
    <EditorSection
      title="Identity"
      hint="A document picks this theme by its name; the rest is what the library shows."
    >
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        {fields.map((field) => {
          const value = theme[field.key];
          return (
            <IdentityField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              hint={field.hint}
              value={typeof value === 'string' ? value : undefined}
            />
          );
        })}
      </div>
      {/* Renaming a theme orphans every document that names it; say who
          that is before the field is touched, not after. */}
      <p className={cn(HINT_CLASS, 'mt-2')}>
        {usedBy.length > 0 ? (
          <>
            Used by{' '}
            {usedBy.map((name, index) => (
              <React.Fragment key={name}>
                {index > 0 && ', '}
                <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">
                  {name}
                </code>
              </React.Fragment>
            ))}
            . Renaming the theme breaks that reference until the document is
            updated.
          </>
        ) : (
          'Not used by any open document yet — Run sample shows it anyway.'
        )}
      </p>
      {nameClash.length > 0 && (
        <p className="mt-1 text-xs text-warning">
          {nameClash.join(', ')} also declare{nameClash.length === 1 ? 's' : ''}{' '}
          this name; only one of them can win when a document asks for it.
        </p>
      )}
    </EditorSection>
  );
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

function AdvancedSection({
  theme,
  onOpenJson,
}: {
  theme: ThemeJson;
  onOpenJson: () => void;
}) {
  const keys = useMemo(() => advancedKeys(theme, FORMAT), [theme]);
  return (
    <EditorSection
      title="Advanced"
      hint="Keys the form has no field for. They travel untouched through every edit here."
      actions={
        keys.length > 0 ? (
          <QuietButton onClick={onOpenJson}>
            <Braces className="size-3" aria-hidden />
            Edit in JSON
          </QuietButton>
        ) : undefined
      }
    >
      {keys.length === 0 ? (
        <p className={HINT_CLASS}>Nothing beyond the fields above.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {keys.map((entry) => (
            <li
              key={entry.key}
              className="flex min-w-0 items-baseline gap-2 text-xs"
            >
              <code className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[11px]">
                {entry.key}
              </code>
              <span className="truncate text-muted-foreground">
                {entry.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </EditorSection>
  );
}

export const ThemeVisualEditorMemoized = React.memo(ThemeVisualEditor);
