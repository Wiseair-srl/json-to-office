import React, { useCallback, useMemo } from 'react';
import { Braces, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { getAt, type Path, type ThemeJson } from '../../lib/theme-editor/model';
import {
  fieldValueError,
  filterFields,
  matchesQuery,
  resolveThemeColor,
  summarizeValue,
  type SchemaField,
  type SchemaSection,
} from '../../lib/theme-editor/schema-form';
import { cn } from '../../lib/utils';
import {
  ClearButton,
  DraftNumberInput,
  DraftTextInput,
  EditorSection,
  GroupLabel,
  HINT_CLASS,
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

/**
 * A section for one extended theme key, rendered from its schema: every
 * property the schema names is a row with the control its type wants, its
 * description as the hint, and a clear that removes the key (pruning the
 * empty parents it leaves behind, so a theme never carries `"motif": {}`).
 * What the schema cannot express as one control is shown with its value
 * and a way to the JSON view.
 */

const UNSET = '__unset__';
const BOOLEAN_OPTIONS = [
  { value: 'unset' as const, label: 'Unset' },
  { value: 'off' as const, label: 'Off' },
  { value: 'on' as const, label: 'On' },
];

function fieldId(path: Path): string {
  return `theme-schema-${path.join('-')}`;
}

/** The depth below which a cleared key's empty parents are pruned. */
const SECTION_DEPTH = 1;

const ScalarControl = React.memo(function ScalarControl({
  field,
  value,
  theme,
  tokens,
  onOpenJson,
}: {
  field: SchemaField;
  value: unknown;
  theme: ThemeJson;
  tokens: readonly ColorToken[];
  onOpenJson: () => void;
}) {
  const { set, remove } = useThemeEditor();
  const path = field.path;
  const clear = useCallback(
    () => remove(path, { keepDepth: SECTION_DEPTH }),
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
  const id = fieldId(path);
  const error = fieldValueError(field, value);
  if (error) {
    return (
      <JsonOnly
        summary={`${error}: ${summarizeValue(value)}`}
        onOpenJson={onOpenJson}
        onClear={clear}
      />
    );
  }
  switch (field.kind) {
    case 'text':
      return (
        <DraftTextInput
          id={id}
          value={typeof value === 'string' ? value : undefined}
          onCommit={commitString}
        />
      );
    case 'number':
      return (
        <DraftNumberInput
          id={id}
          value={typeof value === 'number' ? value : undefined}
          onCommit={commitNumber}
          min={field.min}
          max={field.max}
          step={field.integer ? 1 : 0.5}
        />
      );
    case 'boolean':
      return (
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
    case 'enum':
      return (
        <Select
          value={typeof value === 'string' ? value : UNSET}
          onValueChange={(next) => (next === UNSET ? clear() : set(path, next))}
        >
          <SelectTrigger
            id={id}
            aria-label={field.label}
            className={SELECT_TRIGGER_CLASS}
          >
            <SelectValue placeholder="Unset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Unset</SelectItem>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'color':
      return (
        <ColorControl
          id={id}
          label={field.label}
          value={typeof value === 'string' ? value : undefined}
          resolved={resolveThemeColor(theme, value)}
          onCommit={commitString}
          tokens={tokens}
          className="min-w-0"
        />
      );
    default:
      return (
        <JsonOnly
          summary={summarizeValue(value)}
          onOpenJson={onOpenJson}
          onClear={value === undefined ? undefined : clear}
        />
      );
  }
});

/** A value the form shows but leaves to the JSON view. */
function JsonOnly({
  summary,
  onOpenJson,
  onClear,
}: {
  summary: string;
  onOpenJson: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {summary}
      </span>
      <QuietButton onClick={onOpenJson}>
        <Braces className="size-3" aria-hidden />
        JSON
      </QuietButton>
      {onClear && <ClearButton label="Clear" onClick={onClear} />}
    </div>
  );
}

/** An array of scalars: one row per entry, add at the end, clear per entry. */
const ListControl = React.memo(function ListControl({
  field,
  value,
  theme,
  tokens,
  onOpenJson,
}: {
  field: SchemaField;
  value: unknown;
  theme: ThemeJson;
  tokens: readonly ColorToken[];
  onOpenJson: () => void;
}) {
  const { set, remove } = useThemeEditor();
  const entries = Array.isArray(value) ? value : [];
  const item = field.item!;
  const add = useCallback(() => {
    const seed =
      item.kind === 'number'
        ? item.min ?? 0
        : item.kind === 'boolean'
          ? true
          : '';
    set(field.path, [...entries, seed]);
  }, [entries, field.path, item.kind, item.min, set]);
  const full = field.max !== undefined && entries.length >= field.max;
  if (value !== undefined && !Array.isArray(value)) {
    return (
      <JsonOnly
        summary={`Not a list: ${summarizeValue(value)}`}
        onOpenJson={onOpenJson}
        onClear={() => remove(field.path, { keepDepth: SECTION_DEPTH })}
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry, index) => {
        const entryField: SchemaField = {
          ...item,
          key: String(index),
          label: `${field.label} ${index + 1}`,
          path: [...field.path, index],
        };
        return (
          <div key={index} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <ListEntry
                field={entryField}
                value={entry}
                theme={theme}
                tokens={tokens}
                onOpenJson={onOpenJson}
                onRemove={() => {
                  const next = entries.filter((_, i) => i !== index);
                  if (next.length === 0)
                    remove(field.path, { keepDepth: SECTION_DEPTH });
                  else set(field.path, next);
                }}
              />
            </div>
          </div>
        );
      })}
      {!full && (
        <QuietButton onClick={add} className="self-start">
          <Plus className="size-3" aria-hidden />
          Add
        </QuietButton>
      )}
    </div>
  );
});

/**
 * One list entry. Clearing an entry removes it from the list rather than
 * leaving a hole, which is what a clear on an array member has to mean.
 */
function ListEntry({
  field,
  value,
  theme,
  tokens,
  onOpenJson,
  onRemove,
}: {
  field: SchemaField;
  value: unknown;
  theme: ThemeJson;
  tokens: readonly ColorToken[];
  onOpenJson: () => void;
  onRemove: () => void;
}) {
  const { set } = useThemeEditor();
  const commitString = useCallback(
    (next: string | null) =>
      next === null ? onRemove() : set(field.path, next),
    [field.path, onRemove, set]
  );
  const commitNumber = useCallback(
    (next: number | null) =>
      next === null ? onRemove() : set(field.path, next),
    [field.path, onRemove, set]
  );
  const id = fieldId(field.path);
  let control: React.ReactNode;
  switch (field.kind) {
    case 'color':
      control = (
        <ColorControl
          id={id}
          label={field.label}
          value={typeof value === 'string' ? value : undefined}
          resolved={resolveThemeColor(theme, value)}
          onCommit={commitString}
          tokens={tokens}
          className="min-w-0"
        />
      );
      break;
    case 'number':
      control = (
        <DraftNumberInput
          id={id}
          value={typeof value === 'number' ? value : undefined}
          onCommit={commitNumber}
          min={field.min}
          max={field.max}
          step={field.integer ? 1 : 0.5}
        />
      );
      break;
    case 'enum':
      control = (
        <Select
          value={typeof value === 'string' ? value : UNSET}
          onValueChange={(next) =>
            next === UNSET ? onRemove() : set(field.path, next)
          }
        >
          <SelectTrigger
            id={id}
            aria-label={field.label}
            className={SELECT_TRIGGER_CLASS}
          >
            <SelectValue placeholder="Unset" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'text':
      control = (
        <DraftTextInput
          id={id}
          value={typeof value === 'string' ? value : undefined}
          onCommit={commitString}
        />
      );
      break;
    default:
      control = (
        <JsonOnly summary={summarizeValue(value)} onOpenJson={onOpenJson} />
      );
  }
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{control}</div>
      <ClearButton label={`Remove ${field.label}`} onClick={onRemove} />
    </div>
  );
}

const FieldRow = React.memo(function FieldRow({
  field,
  value,
  theme,
  tokens,
  onOpenJson,
}: {
  field: SchemaField;
  value: unknown;
  theme: ThemeJson;
  tokens: readonly ColorToken[];
  onOpenJson: () => void;
}) {
  const { remove } = useThemeEditor();
  const isSet = value !== undefined;
  const id = fieldId(field.path);
  const clear = useCallback(
    () => remove(field.path, { keepDepth: SECTION_DEPTH }),
    [field.path, remove]
  );
  const clearable =
    isSet &&
    field.kind !== 'list' &&
    field.kind !== 'json' &&
    !fieldValueError(field, value);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,12rem)_1.5rem] items-start gap-x-2 gap-y-0.5 @[30rem]:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_1.5rem]">
      <label htmlFor={id} className="flex min-w-0 flex-col pt-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate text-sm',
              !isSet && 'text-muted-foreground'
            )}
          >
            {field.label}
          </span>
          <code className="truncate text-[10px] text-muted-foreground">
            {field.key}
          </code>
          {field.required && (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] tracking-wide text-muted-foreground uppercase">
              required
            </span>
          )}
        </span>
        {field.hint && (
          <span className={cn(HINT_CLASS, 'line-clamp-2')}>{field.hint}</span>
        )}
      </label>
      <div className="min-w-0 pt-0.5">
        {field.kind === 'list' ? (
          <ListControl
            field={field}
            value={value}
            theme={theme}
            tokens={tokens}
            onOpenJson={onOpenJson}
          />
        ) : (
          <ScalarControl
            field={field}
            value={value}
            theme={theme}
            tokens={tokens}
            onOpenJson={onOpenJson}
          />
        )}
      </div>
      <div className="pt-0.5">
        {clearable && (
          <ClearButton label={`Clear ${field.label}`} onClick={clear} />
        )}
      </div>
    </div>
  );
});

/** A group: its label, then its children one level in. */
function GroupRows({
  field,
  theme,
  tokens,
  onOpenJson,
  depth,
}: {
  field: SchemaField;
  theme: ThemeJson;
  tokens: readonly ColorToken[];
  onOpenJson: () => void;
  depth: number;
}) {
  const value = getAt(theme, field.path);
  const error = fieldValueError(field, value);
  const { remove } = useThemeEditor();
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        depth > 0 && 'border-l border-border/60 pl-3'
      )}
      data-crumb={field.label}
    >
      <div className="flex items-baseline gap-2">
        <GroupLabel>{field.label}</GroupLabel>
        <code className="text-[10px] text-muted-foreground">{field.key}</code>
        {value === undefined && (
          <span className={HINT_CLASS}>Not defined — inherits defaults</span>
        )}
      </div>
      {field.hint && <p className={cn(HINT_CLASS, '-mt-1')}>{field.hint}</p>}
      {error ? (
        <JsonOnly
          summary={`${error}: ${summarizeValue(value)}`}
          onOpenJson={onOpenJson}
          onClear={() => remove(field.path, { keepDepth: SECTION_DEPTH })}
        />
      ) : (
        <Rows
          fields={field.children ?? []}
          theme={theme}
          tokens={tokens}
          onOpenJson={onOpenJson}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

function Rows({
  fields,
  theme,
  tokens,
  onOpenJson,
  depth,
}: {
  fields: readonly SchemaField[];
  theme: ThemeJson;
  tokens: readonly ColorToken[];
  onOpenJson: () => void;
  depth: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {fields.map((field) =>
        field.kind === 'group' ? (
          <GroupRows
            key={field.key}
            field={field}
            theme={theme}
            tokens={tokens}
            onOpenJson={onOpenJson}
            depth={depth}
          />
        ) : (
          <FieldRow
            key={field.key}
            field={field}
            value={getAt(theme, field.path)}
            theme={theme}
            tokens={tokens}
            onOpenJson={onOpenJson}
          />
        )
      )}
    </div>
  );
}

export function ThemeSchemaSection({
  section,
  theme,
  query,
  onOpenJson,
}: {
  section: SchemaSection;
  theme: ThemeJson;
  query: string;
  onOpenJson: () => void;
}) {
  const tokens = useThemeColorTokens(theme);
  const defined = theme[section.key] !== undefined;
  const fields = useMemo(
    () =>
      matchesQuery(query, section.key, section.title, section.hint)
        ? section.fields
        : filterFields(section.fields, query),
    [query, section]
  );
  if (query.trim() && fields.length === 0) return null;
  return (
    <EditorSection
      title={section.title}
      hint={section.hint}
      defaultOpen={defined}
      forceOpen={query.trim() ? true : undefined}
      actions={
        <QuietButton onClick={onOpenJson}>
          <Braces className="size-3" aria-hidden />
          JSON
        </QuietButton>
      }
    >
      {!defined && (
        <p className={HINT_CLASS}>
          Not defined — inherits defaults. Set a field to define it.
        </p>
      )}
      <Rows
        fields={fields}
        theme={theme}
        tokens={tokens}
        onOpenJson={onOpenJson}
        depth={0}
      />
    </EditorSection>
  );
}
