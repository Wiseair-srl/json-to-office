import React, { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Input } from '../ui/input';
import { FORMAT } from '../../lib/env';
import {
  DOCX_FONT_ROLES,
  customStyleNames,
  getAt,
  resolveColor,
  styleFields,
  styleLabel,
  styleNames,
  type Path,
  type StyleFieldDescriptor,
  type ThemeJson,
} from '../../lib/theme-editor/model';
import { cn } from '../../lib/utils';
import {
  ClearButton,
  DraftNumberInput,
  DraftTextInput,
  EditorSection,
  FIELD_LABEL_CLASS,
  HINT_CLASS,
  INPUT_CLASS,
  QuietButton,
  SELECT_TRIGGER_CLASS,
  Segmented,
  useThemeEditor,
} from './theme-editor-shared';
import {
  ColorControl,
  useThemeColorTokens,
  type ColorToken,
} from './color-picker';
import { FamilyCombobox } from './font-combobox';
import { matchesQuery } from '../../lib/theme-editor/schema-form';

/**
 * The named styles: the schema's slots first, then whatever else the theme
 * defines. Each row is a one-line summary until opened, because fifteen
 * open grids would bury the two the author came to change.
 *
 * Rows are memoised on the style's JSON, not its object: the tab re-parses
 * the whole theme on every write, so identities are new each time and only
 * the text says whether anything in this style moved.
 */

const NAMES = styleNames(FORMAT);
const FIELDS = styleFields(FORMAT);
const BASIC = FIELDS.filter((f) => !f.advanced);
const ADVANCED = FIELDS.filter((f) => f.advanced);
const STYLE_DEPTH = 2; // ['styles', name]

const BOOLEAN_OPTIONS = [
  { value: 'unset' as const, label: 'Unset' },
  { value: 'off' as const, label: 'Off' },
  { value: 'on' as const, label: 'On' },
];

type StyleJson = Record<string, unknown>;

function fieldKey(field: StyleFieldDescriptor): string {
  return field.path.join('.');
}

function summarize(style: StyleJson): string {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value) parts.push(value);
  };
  if (FORMAT === 'docx') {
    push(style.font);
    if (typeof style.size === 'number') parts.push(`${style.size}pt`);
  } else {
    push(style.fontFace);
    if (typeof style.fontSize === 'number') parts.push(`${style.fontSize}pt`);
  }
  if (style.bold === true) parts.push('bold');
  if (typeof style.fontWeight === 'number') parts.push(`w${style.fontWeight}`);
  if (style.italic === true) parts.push('italic');
  if (style.underline === true) parts.push('underline');
  push(FORMAT === 'docx' ? style.color : style.fontColor);
  push(FORMAT === 'docx' ? style.alignment : style.align);
  if (parts.length === 0) {
    const keys = Object.keys(style);
    return keys.length === 0 ? 'Defined, nothing set' : keys.join(' · ');
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

interface FieldProps {
  styleName: string;
  field: StyleFieldDescriptor;
  value: unknown;
  tokens: readonly ColorToken[];
  resolved: string | null;
}

/**
 * One control for both ways a style names a colour. The picker offers the
 * theme's own tokens as chips and a hex everywhere else, so the source is a
 * choice inside the control rather than a mode switch beside it.
 */
function ColorField({
  styleName,
  field,
  value,
  tokens,
  resolved,
  onCommit,
}: FieldProps & { onCommit: (next: string | null) => void }) {
  return (
    <ColorControl
      id={`theme-style-${styleName}-${fieldKey(field)}`}
      label={field.label}
      value={typeof value === 'string' ? value : undefined}
      resolved={resolved}
      onCommit={onCommit}
      tokens={tokens}
      className="min-w-0"
    />
  );
}

const StyleField = React.memo(function StyleField(props: FieldProps) {
  const { styleName, field, value } = props;
  const { set, remove } = useThemeEditor();
  const path = useMemo<Path>(
    () => ['styles', styleName, ...field.path],
    [field.path, styleName]
  );
  const clear = useCallback(
    () => remove(path, { keepDepth: STYLE_DEPTH }),
    [path, remove]
  );
  const commitString = useCallback(
    (next: string | null) => (next === null ? clear() : set(path, next)),
    [clear, path, set]
  );
  const commitNumber = useCallback(
    (next: number | null) => (next === null ? clear() : set(path, next)),
    [clear, path, set]
  );
  const id = `theme-style-${styleName}-${fieldKey(field)}`;
  const isSet = value !== undefined;

  let control: React.ReactNode;
  switch (field.kind) {
    case 'text':
      control = (
        <DraftTextInput
          id={id}
          value={typeof value === 'string' ? value : undefined}
          onCommit={commitString}
        />
      );
      break;
    case 'number':
      control = (
        <DraftNumberInput
          id={id}
          value={typeof value === 'number' ? value : undefined}
          onCommit={commitNumber}
          unit={field.unit}
          min={field.min}
          max={field.max}
          step={field.step}
        />
      );
      break;
    case 'boolean':
      // Three states, not two. A switch can only be on or off, and a style
      // that says nothing about `bold` is not the same as one that says
      // `false` — the first inherits, the second overrides.
      control = (
        <Segmented<'unset' | 'off' | 'on'>
          label={field.label}
          value={value === undefined ? 'unset' : value === true ? 'on' : 'off'}
          options={BOOLEAN_OPTIONS}
          onChange={(next) =>
            next === 'unset' ? clear() : set(path, next === 'on')
          }
          className="h-7"
        />
      );
      break;
    case 'select':
      control = (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => set(path, next)}
        >
          <SelectTrigger id={id} className={SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder="Unset" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'fontRole':
      control = (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => set(path, next)}
        >
          <SelectTrigger id={id} className={SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder="Unset" />
          </SelectTrigger>
          <SelectContent>
            {DOCX_FONT_ROLES.map((role) => (
              <SelectItem key={role} value={role} className="text-xs">
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'fontFamily':
      control = (
        <FamilyCombobox
          id={id}
          label={field.label}
          value={typeof value === 'string' ? value : undefined}
          onCommit={commitString}
          pickerPath={path}
        />
      );
      break;
    case 'color':
      control = <ColorField {...props} onCommit={commitString} />;
      break;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex h-4 items-center justify-between gap-1">
        <label
          htmlFor={field.kind === 'boolean' ? undefined : id}
          className={cn(FIELD_LABEL_CLASS, isSet && 'text-foreground')}
          title={field.hint}
        >
          {field.label}
        </label>
        {isSet && field.kind !== 'boolean' && (
          <ClearButton
            label={`Clear ${field.label}`}
            onClick={clear}
            className="size-5"
          />
        )}
      </div>
      {control}
      {field.hint && <p className={HINT_CLASS}>{field.hint}</p>}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface StyleRowProps {
  name: string;
  custom: boolean;
  /** `undefined` when the style is not defined at all. */
  styleJson: string | undefined;
  /** The theme's colour tokens, JSON, so the memo compare stays a `===`. */
  tokensJson: string;
  /** Resolved hex per colour field key, JSON. */
  resolvedJson: string;
}

const StyleRow = React.memo(function StyleRow({
  name,
  custom,
  styleJson,
  tokensJson,
  resolvedJson,
}: StyleRowProps) {
  const { set, remove } = useThemeEditor();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const style = useMemo<StyleJson | undefined>(
    () => (styleJson === undefined ? undefined : JSON.parse(styleJson)),
    [styleJson]
  );
  const tokens = useMemo(
    () => JSON.parse(tokensJson) as ColorToken[],
    [tokensJson]
  );
  const resolved = useMemo<Record<string, string | null>>(
    () => JSON.parse(resolvedJson),
    [resolvedJson]
  );
  const define = useCallback(() => set(['styles', name], {}), [name, set]);
  const removeStyle = useCallback(
    () => remove(['styles', name]),
    [name, remove]
  );
  const label = styleLabel(name);
  const setCount = style ? Object.keys(style).length : 0;

  const renderField = (field: StyleFieldDescriptor) => (
    <StyleField
      key={fieldKey(field)}
      styleName={name}
      field={field}
      value={style ? getAt(style, field.path) : undefined}
      tokens={tokens}
      resolved={resolved[fieldKey(field)] ?? null}
    />
  );

  return (
    <div className="rounded-sm border border-border/70">
      <div className="flex h-8 items-center gap-1 pr-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-left',
            'transition-colors hover:bg-accent',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform duration-150 ease-out',
              open && 'rotate-90'
            )}
          />
          <span className="shrink-0 text-sm">{label}</span>
          {custom && (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] tracking-wide text-muted-foreground uppercase">
              custom
            </span>
          )}
          <span className={cn(HINT_CLASS, 'min-w-0 flex-1 truncate')}>
            {style ? summarize(style) : 'Not defined — inherits defaults'}
          </span>
        </button>
        {custom && (
          <button
            type="button"
            onClick={removeStyle}
            aria-label={`Remove style ${name}`}
            title="Remove style"
            className={cn(
              'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm',
              'text-muted-foreground/70 transition-colors hover:bg-accent hover:text-destructive',
              'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none'
            )}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border/60 px-2 pt-2 pb-3">
          {!style ? (
            <div className="flex items-center gap-3">
              <span className={HINT_CLASS}>
                Not defined — inherits defaults.
              </span>
              <QuietButton onClick={define}>
                <Plus className="size-3" aria-hidden />
                Define
              </QuietButton>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 @[30rem]:grid-cols-2">
                {BASIC.map(renderField)}
              </div>
              {ADVANCED.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <QuietButton
                      onClick={() => setMore((m) => !m)}
                      aria-expanded={more}
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn(
                          'size-3 transition-transform duration-150 ease-out',
                          more && 'rotate-90'
                        )}
                      />
                      More
                    </QuietButton>
                    <span className={HINT_CLASS}>
                      {ADVANCED.length} more fields
                      {setCount > 0 &&
                        ` · ${setCount} key${setCount === 1 ? '' : 's'} set`}
                    </span>
                  </div>
                  {more && (
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 @[30rem]:grid-cols-2">
                      {ADVANCED.map(renderField)}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Add custom style (docx)
// ---------------------------------------------------------------------------

function AddCustomStyle({ existing }: { existing: Set<string> }) {
  const { set } = useThemeEditor();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const problem = !trimmed
    ? null
    : existing.has(trimmed)
      ? 'A style with this name exists'
      : /\s/.test(trimmed)
        ? 'No spaces — this is the style id a document names'
        : null;
  const submit = () => {
    if (!trimmed || problem) return;
    set(['styles', trimmed], {});
    setName('');
    setOpen(false);
  };
  if (!open) {
    return (
      <QuietButton onClick={() => setOpen(true)}>
        <Plus className="size-3" aria-hidden />
        Add custom style
      </QuietButton>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="theme-new-style" className="text-xs">
        New style
      </label>
      {/* Plain controlled input: the name is local state until "Add", so
          the draft-on-blur behaviour of the field inputs would only get in
          the way of the validation message updating as you type. */}
      <Input
        id="theme-new-style"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. callout"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        className={cn(INPUT_CLASS, 'w-40')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <QuietButton type="submit" disabled={!trimmed || !!problem}>
        Add
      </QuietButton>
      <QuietButton onClick={() => setOpen(false)}>Cancel</QuietButton>
      {problem && (
        <span className="text-[11px] text-destructive">{problem}</span>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function ThemeStylesSection({
  theme,
  query = '',
}: {
  theme: ThemeJson;
  query?: string;
}) {
  const searching = query.trim() !== '';
  const tokens = useThemeColorTokens(theme);
  const tokensJson = useMemo(() => JSON.stringify(tokens), [tokens]);
  const custom = useMemo(() => customStyleNames(theme, FORMAT), [theme]);
  const rows = useMemo(() => {
    const styles = theme.styles;
    const table =
      styles && typeof styles === 'object' && !Array.isArray(styles)
        ? (styles as Record<string, unknown>)
        : {};
    const colorFields = FIELDS.filter((f) => f.kind === 'color');
    const row = (name: string, isCustom: boolean): StyleRowProps => {
      const style = table[name];
      const defined = !!style && typeof style === 'object';
      const resolved: Record<string, string | null> = {};
      for (const field of colorFields) {
        resolved[fieldKey(field)] = defined
          ? resolveColor(theme, getAt(style, field.path))
          : null;
      }
      return {
        name,
        custom: isCustom,
        styleJson: defined ? JSON.stringify(style) : undefined,
        tokensJson,
        resolvedJson: JSON.stringify(resolved),
      };
    };
    const all = [
      ...NAMES.map((name) => row(name, false)),
      ...custom.map((name) => row(name, true)),
    ];
    return matchesQuery(query, 'styles', 'style')
      ? all
      : all.filter((entry) =>
          matchesQuery(query, entry.name, styleLabel(entry.name))
        );
  }, [theme, tokensJson, custom, query]);

  const existing = useMemo(() => new Set([...NAMES, ...custom]), [custom]);
  const definedCount = rows.filter((r) => r.styleJson !== undefined).length;
  if (searching && rows.length === 0) return null;

  return (
    <EditorSection
      title="Styles"
      hint={
        FORMAT === 'docx'
          ? 'Paragraph styles a document names with themeStyle. A colour may be a token or a hex; sizes are points.'
          : 'Text presets a slide names by style. Sizes are points; a colour may be a token or a hex.'
      }
      forceOpen={searching ? true : undefined}
      actions={
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {definedCount}/{rows.length}
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <StyleRow key={row.name} {...row} />
        ))}
      </div>
      {FORMAT === 'docx' && <AddCustomStyle existing={existing} />}
    </EditorSection>
  );
}
