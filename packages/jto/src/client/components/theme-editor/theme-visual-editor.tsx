import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Braces, Search, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { FORMAT } from '../../lib/env';
import {
  advancedKeys,
  deleteAt,
  ensureContainers,
  formKeys,
  getAt,
  parseTheme,
  serializeTheme,
  setAt,
  type Path,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import {
  extendedSections,
  matchesQuery,
  type SchemaSection,
} from '../../lib/theme-editor/schema-form';
import { fetchThemeJsonSchema } from '../../lib/theme-json-schema';
import {
  DraftTextInput,
  EditorSection,
  HINT_CLASS,
  INPUT_CLASS,
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
import { ThemeSchemaSection } from './theme-schema-section';

/**
 * The sections the theme schema adds beyond the hand-built ones — palette,
 * type roles and scale, spacing, chrome, motif, component defaults — derived
 * once the schema arrives from the server. Until then those keys sit in the
 * Advanced list exactly as before.
 */
function useExtendedSections(): SchemaSection[] {
  const [sections, setSections] = useState<SchemaSection[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchThemeJsonSchema()
      .then((schema) => {
        if (!cancelled) setSections(extendedSections(schema, formKeys(FORMAT)));
      })
      .catch((error) => {
        console.warn('[theme editor] schema unavailable:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return sections;
}

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
      <ThemeForm
        docName={docName}
        theme={theme}
        usedBy={usedBy}
        nameClash={nameClash}
        onOpenJson={onOpenJson}
      />
    </ThemeEditorProvider>
  );
}

/**
 * Where the reader is: the section, and the groups inside it, that the
 * sticky bar is currently cutting through. Every section and schema group
 * carries a `data-crumb`; the ones whose box spans the bar's bottom edge are
 * the nesting chain, outermost first. Recomputed on scroll and on any change
 * to the form's height (a section opening, a search narrowing the rows).
 */
function useScrollCrumb(barRef: React.RefObject<HTMLDivElement | null>) {
  const [crumb, setCrumb] = useState<string[]>([]);
  useEffect(() => {
    const bar = barRef.current;
    const viewport = bar?.closest<HTMLElement>(
      '[data-radix-scroll-area-viewport]'
    );
    if (!bar || !viewport) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const line = bar.getBoundingClientRect().bottom + 1;
      const chain: string[] = [];
      for (const element of viewport.querySelectorAll<HTMLElement>(
        '[data-crumb]'
      )) {
        const box = element.getBoundingClientRect();
        if (box.top <= line && box.bottom > line)
          chain.push(element.dataset.crumb ?? '');
      }
      setCrumb((previous) =>
        previous.length === chain.length &&
        previous.every((entry, index) => entry === chain[index])
          ? previous
          : chain
      );
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    for (const child of viewport.children) observer.observe(child);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [barRef]);
  return crumb;
}

/**
 * The sections, behind a search box. The query filters every section's rows
 * by key, label and hint and holds the survivors open; a section with
 * nothing left steps aside. Cleared, everything is back where it was. The
 * bar also names the section being scrolled through, so a long form never
 * loses the reader.
 */
function ThemeForm({
  docName,
  theme,
  usedBy,
  nameClash,
  onOpenJson,
}: {
  docName: string;
  theme: ThemeJson;
  usedBy: readonly string[];
  nameClash: readonly string[];
  onOpenJson: () => void;
}) {
  const [query, setQuery] = useState('');
  const extended = useExtendedSections();
  const extendedKeys = useMemo(
    () => extended.map((section) => section.key),
    [extended]
  );
  const barRef = useRef<HTMLDivElement>(null);
  const crumb = useScrollCrumb(barRef);
  return (
    <ScrollArea className="h-full">
      {/* Keyed by document so section disclosure resets per file. */}
      <div
        key={docName}
        className="@container mx-auto flex w-full max-w-[760px] flex-col gap-2 px-4 pt-1 pb-8"
      >
        <div
          ref={barRef}
          className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur"
        >
          {/* The section under the bar, so a long form says where you are. */}
          <div
            aria-live="polite"
            className={cn(
              'flex h-4 items-center gap-1 truncate px-1 text-[10px] tracking-[0.08em] text-muted-foreground uppercase',
              crumb.length === 0 && 'invisible'
            )}
          >
            {crumb.map((entry, index) => (
              <React.Fragment key={`${index}-${entry}`}>
                {index > 0 && (
                  <span aria-hidden className="text-muted-foreground/50">
                    ›
                  </span>
                )}
                <span
                  className={cn(
                    index === crumb.length - 1 && 'text-foreground/80'
                  )}
                >
                  {entry}
                </span>
              </React.Fragment>
            ))}
          </div>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
              }}
              placeholder="Find a setting… (motif, tracking, safe area)"
              aria-label="Find a theme setting"
              autoComplete="off"
              spellCheck={false}
              className={cn(INPUT_CLASS, 'h-8 pr-7 pl-7')}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <IdentitySection
          theme={theme}
          usedBy={usedBy}
          nameClash={nameClash}
          query={query}
        />
        <ThemeColorsSection theme={theme} query={query} />
        <ThemeTypographySection theme={theme} query={query} />
        {FORMAT === 'docx' && <ThemePageSection theme={theme} query={query} />}
        <ThemeStylesSection theme={theme} query={query} />
        {extended.map((section) => (
          <ThemeSchemaSection
            key={section.key}
            section={section}
            theme={theme}
            query={query}
            onOpenJson={onOpenJson}
          />
        ))}
        <AdvancedSection
          theme={theme}
          onOpenJson={onOpenJson}
          alsoHandled={extendedKeys}
          query={query}
        />
      </div>
    </ScrollArea>
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
    { key: 'displayName', label: 'Display name' },
    { key: 'description', label: 'Description' },
    { key: 'version', label: 'Version' },
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
  query = '',
}: {
  theme: ThemeJson;
  usedBy: readonly string[];
  nameClash: readonly string[];
  query?: string;
}) {
  const searching = query.trim() !== '';
  const fields = matchesQuery(query, 'identity', 'name')
    ? IDENTITY_FIELDS[FORMAT]
    : IDENTITY_FIELDS[FORMAT].filter((field) =>
        matchesQuery(query, field.key, field.label, field.hint)
      );
  if (searching && fields.length === 0) return null;
  return (
    <EditorSection
      title="Identity"
      hint="A document picks this theme by its name; the rest is what the library shows."
      forceOpen={searching ? true : undefined}
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
  alsoHandled,
  query = '',
}: {
  theme: ThemeJson;
  onOpenJson: () => void;
  alsoHandled: readonly string[];
  query?: string;
}) {
  const searching = query.trim() !== '';
  const keys = useMemo(
    () =>
      advancedKeys(theme, FORMAT, alsoHandled).filter(
        (entry) =>
          matchesQuery(query, 'advanced') ||
          matchesQuery(query, entry.key, entry.summary)
      ),
    [alsoHandled, query, theme]
  );
  if (searching && keys.length === 0) return null;
  return (
    <EditorSection
      title="Advanced"
      hint="Keys the form has no field for. They travel untouched through every edit here."
      forceOpen={searching ? true : undefined}
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
