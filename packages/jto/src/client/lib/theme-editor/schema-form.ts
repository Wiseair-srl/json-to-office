/**
 * A form derived from the theme's JSON Schema, for the keys the hand-built
 * sections do not cover — palette, type roles and scale, spacing, chrome
 * recipes, motif, component defaults.
 *
 * The schema already says everything a field needs: the key, its type, its
 * bounds, its enum, whether a string is a colour, and a description to show
 * as the hint. Deriving the form from it means a new theme key becomes
 * editable the day the schema learns it, and the editor never invents a
 * meaning the runtime does not share. What the schema cannot express as one
 * control — a value that is either a number or an object, an array of
 * objects, a free-form map — is shown as such and handed to the JSON view.
 *
 * Pure: schema and value in, field tree out. The React section renders it.
 */
import type { Path, ThemeJson } from './model';
import { isHexColor, resolveColor } from './model';

type JsonSchema = Record<string, any>;

export type SchemaFieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'color'
  | 'list'
  | 'group'
  | 'json';

export interface SchemaField {
  kind: SchemaFieldKind;
  key: string;
  path: Path;
  label: string;
  /** The schema's description, when it has one. */
  hint?: string;
  required?: boolean;
  /** `enum`: the accepted values. */
  options?: string[];
  /** `number`: bounds and integrality. */
  min?: number;
  max?: number;
  integer?: boolean;
  /** `list`: what one entry is. */
  item?: SchemaField;
  /** `group`: the nested fields, in schema order. */
  children?: SchemaField[];
}

/** `basePt` → "Base pt", `runningHead` → "Running head", `a4` → "A4". */
export function humanize(key: string): string {
  if (/^[a-z]\d+$/.test(key)) return key.toUpperCase();
  const spaced = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const COLOR_PATTERN = /\[0-9A-Fa-f\]\{6\}/;

function enumOptions(schema: JsonSchema): string[] | undefined {
  if (Array.isArray(schema.enum))
    return schema.enum.every((v: unknown) => typeof v === 'string')
      ? schema.enum
      : undefined;
  const branches = schema.anyOf ?? schema.oneOf;
  if (
    Array.isArray(branches) &&
    branches.length > 0 &&
    branches.every(
      (b: JsonSchema) =>
        b && typeof b === 'object' && typeof b.const === 'string'
    )
  )
    return branches.map((b: JsonSchema) => b.const);
  return undefined;
}

function scalarKind(
  schema: JsonSchema
): Exclude<SchemaFieldKind, 'list' | 'group' | 'json'> | undefined {
  const options = enumOptions(schema);
  if (options) return 'enum';
  switch (schema.type) {
    case 'string':
      return typeof schema.pattern === 'string' &&
        COLOR_PATTERN.test(schema.pattern)
        ? 'color'
        : 'text';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return undefined;
  }
}

/** One field for one property schema; `json` when no single control fits. */
export function schemaField(
  key: string,
  schema: JsonSchema,
  path: Path,
  required = false
): SchemaField {
  const base: SchemaField = {
    kind: 'json',
    key,
    path,
    label: humanize(key),
    ...(typeof schema?.description === 'string' && {
      hint: schema.description,
    }),
    ...(required && { required }),
  };
  if (!schema || typeof schema !== 'object') return base;
  const scalar = scalarKind(schema);
  if (scalar) {
    const field: SchemaField = { ...base, kind: scalar };
    if (scalar === 'enum') field.options = enumOptions(schema);
    if (scalar === 'number') {
      const integer = schema.type === 'integer';
      const step = integer ? 1 : 0.5;
      const min =
        schema.minimum ??
        (typeof schema.exclusiveMinimum === 'number'
          ? schema.exclusiveMinimum + step
          : undefined);
      const max =
        schema.maximum ??
        (typeof schema.exclusiveMaximum === 'number'
          ? schema.exclusiveMaximum - step
          : undefined);
      if (min !== undefined) field.min = min;
      if (max !== undefined) field.max = max;
      if (integer) field.integer = true;
    }
    return field;
  }
  if (schema.type === 'object' && schema.properties) {
    const requiredKeys = new Set<string>(schema.required ?? []);
    return {
      ...base,
      kind: 'group',
      children: Object.entries(schema.properties as Record<string, JsonSchema>)
        .filter(([child]) => child !== '$schema')
        .map(([child, sub]) =>
          schemaField(child, sub, [...path, child], requiredKeys.has(child))
        ),
    };
  }
  if (
    schema.type === 'array' &&
    schema.items &&
    typeof schema.items === 'object' &&
    !Array.isArray(schema.items) &&
    scalarKind(schema.items)
  ) {
    return {
      ...base,
      kind: 'list',
      item: schemaField('item', schema.items, [...path, 0]),
      ...(typeof schema.maxItems === 'number' && { max: schema.maxItems }),
      ...(typeof schema.minItems === 'number' && { min: schema.minItems }),
    };
  }
  return base;
}

export interface SchemaSection {
  key: string;
  title: string;
  hint?: string;
  fields: SchemaField[];
}

/**
 * Titles for the keys the design system names, where the humanized key
 * would collide with a hand-built section ("Typography" is the fonts) or
 * say less than the rail should.
 */
const SECTION_TITLES: Record<string, string> = {
  palette: 'Palette',
  typography: 'Type roles & scale',
  spacing: 'Spacing',
  chrome: 'Chrome recipes',
  motif: 'Motif',
  componentDefaults: 'Component defaults',
};

/**
 * The top-level keys the schema declares as objects with named properties
 * and no hand-built section claims — one form section each, in schema
 * order. Keys the schema types otherwise (a font registry array, a word
 * list) stay in the Advanced list with the JSON view.
 */
export function extendedSections(
  schema: JsonSchema | null,
  handledKeys: readonly string[]
): SchemaSection[] {
  if (!schema?.properties) return [];
  const handled = new Set(handledKeys);
  return Object.entries(schema.properties as Record<string, JsonSchema>)
    .filter(
      ([key, sub]) =>
        !handled.has(key) &&
        key !== '$schema' &&
        sub &&
        typeof sub === 'object' &&
        sub.type === 'object' &&
        sub.properties
    )
    .map(([key, sub]) => {
      const field = schemaField(key, sub, [key]);
      return {
        key,
        title: SECTION_TITLES[key] ?? humanize(key),
        ...(field.hint && { hint: field.hint }),
        fields: field.children ?? [],
      };
    });
}

/** The keys the schema declares at the top level, `$schema` aside. */
export function schemaTopLevelKeys(schema: JsonSchema | null): string[] {
  return Object.keys(schema?.properties ?? {}).filter(
    (key) => key !== '$schema'
  );
}

/** Case-insensitive substring match of a query against any of the terms. */
export function matchesQuery(
  query: string,
  ...terms: (string | undefined)[]
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return terms.some((term) => term?.toLowerCase().includes(needle));
}

/**
 * The fields a search keeps: a field matches on its key, label, hint or
 * path; a group is kept whole when its own name matches, else pruned to the
 * children that match. An empty query keeps everything.
 */
export function filterFields(
  fields: readonly SchemaField[],
  query: string
): SchemaField[] {
  if (!query.trim()) return [...fields];
  const out: SchemaField[] = [];
  for (const field of fields) {
    const own = matchesQuery(
      query,
      field.key,
      field.label,
      field.hint,
      field.path.join('.')
    );
    if (field.kind === 'group' && field.children) {
      if (own) out.push(field);
      else {
        const children = filterFields(field.children, query);
        if (children.length) out.push({ ...field, children });
      }
    } else if (own) out.push(field);
  }
  return out;
}

/**
 * Why a JSON value cannot be edited by its field's control, or null when it
 * can. A value of the wrong shape is left alone and pointed at the JSON
 * view rather than silently replaced.
 */
export function fieldValueError(
  field: SchemaField,
  value: unknown
): string | null {
  if (value === undefined) return null;
  switch (field.kind) {
    case 'text':
    case 'color':
    case 'enum':
      return typeof value === 'string' ? null : 'Not a string';
    case 'number':
      return typeof value === 'number' ? null : 'Not a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Not a boolean';
    case 'list':
      return Array.isArray(value) ? null : 'Not a list';
    case 'group':
      return value && typeof value === 'object' && !Array.isArray(value)
        ? null
        : 'Not an object';
    default:
      return null;
  }
}

/**
 * Resolve a colour the way the design system reads it: a hex, a theme
 * colour token, or a palette token that itself names either. One hop
 * through the palette is enough — the palette's own values resolve through
 * the theme colours — and a cycle ends in null, not a loop.
 */
export function resolveThemeColor(
  theme: ThemeJson,
  value: unknown
): string | null {
  const direct = resolveColor(theme, value);
  if (direct) return direct;
  if (typeof value !== 'string') return null;
  const palette = theme.palette as Record<string, unknown> | undefined;
  const entry = palette?.[value];
  if (typeof entry !== 'string' || entry === value) return null;
  return isHexColor(entry) ? entry : resolveColor(theme, entry);
}

/** A short reading of a value the form shows but does not edit. */
export function summarizeValue(value: unknown): string {
  if (value === undefined) return 'Not set';
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length === 0
      ? 'Empty'
      : keys.slice(0, 4).join(', ') + (keys.length > 4 ? ', …' : '');
  }
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
