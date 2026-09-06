import { ThemeConfigSchema as DocxThemeConfigSchema } from '@json-to-office/shared-docx';
import { ThemeConfigSchema as PptxThemeConfigSchema } from '@json-to-office/shared-pptx';
import { mutateDocumentAtPath } from '../doc-mutations';
import type { FormatName } from '../env';

/**
 * The visual theme editor's model: what a theme of each format is made of,
 * read from the shared schemas so the form cannot drift from them, plus the
 * pure edits the form applies.
 *
 * The form never owns the theme. Every change is applied to the parsed JSON
 * and written back as text; keys the form has no field for (component
 * defaults, font registries, `$schema`) survive untouched.
 */

export type ThemeJson = Record<string, unknown>;

export type ParsedTheme =
  | { ok: true; theme: ThemeJson }
  | { ok: false; error: string };

export function parseTheme(text: string): ParsedTheme {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'A theme is a JSON object.' };
    }
    return { ok: true, theme: value as ThemeJson };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

export function serializeTheme(theme: ThemeJson): string {
  return JSON.stringify(theme, null, 2);
}

export type Path = (string | number)[];

/** Set a leaf, creating the objects on the way. Never mutates the input. */
export function setAt(theme: ThemeJson, path: Path, value: unknown): ThemeJson {
  return mutateDocumentAtPath(theme, path, value) as ThemeJson;
}

/** Remove a leaf. Never mutates the input; a missing path is a no-op. */
export function deleteAt(theme: ThemeJson, path: Path): ThemeJson {
  if (path.length === 0) return theme;
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = getAt(theme, parentPath);
  if (!parent || typeof parent !== 'object') return theme;
  if (Array.isArray(parent)) {
    // `splice` coerces its index: -1 would drop the last entry, NaN the
    // first, 1.5 the second. Only a real index deletes anything.
    if (typeof key !== 'number' || !Number.isInteger(key)) return theme;
    if (key < 0 || key >= parent.length) return theme;
    const next = parent.slice();
    next.splice(key, 1);
    return parentPath.length === 0
      ? (next as unknown as ThemeJson)
      : setAt(theme, parentPath, next);
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) return theme;
  const next = { ...(parent as Record<string, unknown>) };
  delete next[key as string];
  return parentPath.length === 0 ? next : setAt(theme, parentPath, next);
}

export function getAt(theme: unknown, path: Path): unknown {
  let current: unknown = theme;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export interface ColorTokenDescriptor {
  key: string;
  label: string;
  group: string;
  required: boolean;
  hint: string;
}

const COLOR_HINTS: Record<string, string> = {
  primary: 'Headings, the strongest brand colour',
  secondary: 'Supporting brand colour',
  accent: 'Highlights and emphasis',
  text: 'Default body text',
  textPrimary: 'Primary text',
  textSecondary: 'Secondary text',
  textMuted: 'Captions and de-emphasised text',
  background: 'Page or slide background',
  backgroundPrimary: 'Primary surface',
  backgroundSecondary: 'Alternate surface, table stripes',
  background2: 'Alternate surface, table rules',
  text2: 'Secondary text, captions',
  border: 'Default rules and borders',
  borderPrimary: 'Primary rules',
  borderSecondary: 'Subtle rules',
  accent4: 'Chart series 4',
  accent5: 'Chart series 5',
  accent6: 'Chart series 6',
};

const COLOR_GROUPS: Array<[string, string[]]> = [
  ['Core', ['primary', 'secondary', 'accent']],
  ['Text', ['text', 'textPrimary', 'textSecondary', 'textMuted', 'text2']],
  [
    'Background',
    ['background', 'backgroundPrimary', 'backgroundSecondary', 'background2'],
  ],
  ['Border', ['border', 'borderPrimary', 'borderSecondary']],
  ['Chart', ['accent4', 'accent5', 'accent6']],
];

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function schemaColors(schema: unknown): {
  keys: string[];
  required: Set<string>;
} {
  const colors = (schema as { properties?: { colors?: unknown } })?.properties
    ?.colors as { properties?: Record<string, unknown>; required?: string[] };
  return {
    keys: Object.keys(colors?.properties ?? {}),
    required: new Set(colors?.required ?? []),
  };
}

/** The colour tokens a format's theme schema declares, grouped for the form. */
export function colorTokens(format: FormatName): ColorTokenDescriptor[] {
  const { keys, required } = schemaColors(
    format === 'docx' ? DocxThemeConfigSchema : PptxThemeConfigSchema
  );
  const ordered: ColorTokenDescriptor[] = [];
  const seen = new Set<string>();
  for (const [group, groupKeys] of COLOR_GROUPS) {
    for (const key of groupKeys) {
      if (!keys.includes(key)) continue;
      seen.add(key);
      ordered.push({
        key,
        label: humanize(key),
        group,
        required: required.has(key),
        hint: COLOR_HINTS[key] ?? '',
      });
    }
  }
  for (const key of keys) {
    if (seen.has(key)) continue;
    ordered.push({
      key,
      label: humanize(key),
      group: 'Other',
      required: required.has(key),
      hint: COLOR_HINTS[key] ?? '',
    });
  }
  return ordered;
}

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/** `#abc` → `#AABBCC`; `abcdef` → `#ABCDEF`; anything else unchanged. */
export function normalizeHex(value: string): string {
  const trimmed = value.trim();
  const short = trimmed.match(/^#?([0-9A-Fa-f]{3})$/);
  if (short) {
    return `#${short[1]
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()}`;
  }
  const full = trimmed.match(/^#?([0-9A-Fa-f]{6})$/);
  if (full) return `#${full[1].toUpperCase()}`;
  return trimmed;
}

/** Colour keys a theme defines, for token pickers. */
export function definedColorKeys(theme: ThemeJson): string[] {
  const colors = theme.colors;
  if (!colors || typeof colors !== 'object') return [];
  return Object.entries(colors as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string')
    .map(([key]) => key);
}

/** Follow token references (`accent4: "primary"`) to a hex, or null. */
export function resolveColor(
  theme: ThemeJson,
  value: unknown,
  depth = 0
): string | null {
  if (typeof value !== 'string' || depth > 8) return null;
  if (HEX_COLOR.test(value)) return value;
  const bare = value.match(/^#?([0-9A-Fa-f]{6})$/);
  if (bare) return `#${bare[1]}`;
  const colors = theme.colors as Record<string, unknown> | undefined;
  return colors ? resolveColor(theme, colors[value], depth + 1) : null;
}

/** WCAG relative-luminance contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number | null {
  const match = hex.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!match) return null;
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

export const DOCX_FONT_ROLES = ['heading', 'body', 'mono', 'light'] as const;
export type DocxFontRole = (typeof DOCX_FONT_ROLES)[number];
export const PPTX_FONT_ROLES = ['heading', 'body'] as const;

export const FONT_ROLE_HINTS: Record<string, string> = {
  heading: 'Headings and titles',
  body: 'Body text',
  mono: 'Code and tabular figures',
  light: 'Large, light display text',
};

// ---------------------------------------------------------------------------
// Page (DOCX)
// ---------------------------------------------------------------------------

export const PAGE_SIZES = ['A4', 'A3', 'LETTER', 'LEGAL'] as const;
export const MARGIN_KEYS = [
  'top',
  'bottom',
  'left',
  'right',
  'header',
  'footer',
  'gutter',
] as const;

export type LengthUnit = 'in' | 'cm' | 'pt' | 'twips';
const TWIPS_PER_UNIT: Record<LengthUnit, number> = {
  in: 1440,
  cm: 1440 / 2.54,
  pt: 20,
  twips: 1,
};

export function twipsToUnit(twips: number, unit: LengthUnit): number {
  const value = twips / TWIPS_PER_UNIT[unit];
  return unit === 'twips' ? Math.round(value) : Math.round(value * 100) / 100;
}

export function unitToTwips(value: number, unit: LengthUnit): number {
  return Math.round(value * TWIPS_PER_UNIT[unit]);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export type FieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'fontRole'
  | 'fontFamily';

export interface StyleFieldDescriptor {
  path: Path;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Shown only under "More". */
  advanced?: boolean;
  hint?: string;
}

const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

export const DOCX_STYLE_FIELDS: readonly StyleFieldDescriptor[] = [
  { path: ['font'], label: 'Font role', kind: 'fontRole' },
  {
    path: ['size'],
    label: 'Size',
    kind: 'number',
    unit: 'pt',
    min: 8,
    max: 120,
    step: 0.5,
  },
  { path: ['color'], label: 'Colour', kind: 'color' },
  { path: ['bold'], label: 'Bold', kind: 'boolean' },
  { path: ['italic'], label: 'Italic', kind: 'boolean' },
  { path: ['underline'], label: 'Underline', kind: 'boolean' },
  {
    path: ['alignment'],
    label: 'Alignment',
    kind: 'select',
    options: ALIGNMENTS,
  },
  {
    path: ['spacing', 'before'],
    label: 'Space before',
    kind: 'number',
    unit: 'pt',
    min: 0,
    step: 1,
  },
  {
    path: ['spacing', 'after'],
    label: 'Space after',
    kind: 'number',
    unit: 'pt',
    min: 0,
    step: 1,
  },
  {
    path: ['lineSpacing', 'type'],
    label: 'Line spacing',
    kind: 'select',
    options: ['single', 'multiple', 'double', 'atLeast', 'exactly'],
  },
  {
    path: ['lineSpacing', 'value'],
    label: 'Line spacing value',
    kind: 'number',
    min: 0,
    step: 0.05,
    hint: 'A factor for multiple; points for atLeast and exactly',
  },
  {
    path: ['fontWeight'],
    label: 'Weight',
    kind: 'number',
    min: 100,
    max: 900,
    step: 100,
    advanced: true,
  },
  {
    path: ['characterSpacing', 'type'],
    label: 'Tracking',
    kind: 'select',
    options: ['condensed', 'expanded'],
    advanced: true,
  },
  {
    path: ['characterSpacing', 'value'],
    label: 'Tracking amount',
    kind: 'number',
    min: 0,
    step: 1,
    advanced: true,
    hint: 'Twentieths of a point',
  },
  {
    path: ['scale'],
    label: 'Width scale',
    kind: 'number',
    unit: '%',
    min: 1,
    max: 600,
    step: 1,
    advanced: true,
  },
  {
    path: ['keepNext'],
    label: 'Keep with next',
    kind: 'boolean',
    advanced: true,
  },
  {
    path: ['keepLinesTogether'],
    label: 'Keep lines together',
    kind: 'boolean',
    advanced: true,
  },
  {
    path: ['widowControl'],
    label: 'Widow control',
    kind: 'boolean',
    advanced: true,
  },
  {
    path: ['outlineLevel'],
    label: 'Outline level',
    kind: 'number',
    min: 0,
    max: 9,
    step: 1,
    advanced: true,
  },
  { path: ['baseStyle'], label: 'Based on', kind: 'text', advanced: true },
  {
    path: ['followingStyle'],
    label: 'Next style',
    kind: 'text',
    advanced: true,
  },
];

export const PPTX_STYLE_FIELDS: readonly StyleFieldDescriptor[] = [
  {
    path: ['fontSize'],
    label: 'Size',
    kind: 'number',
    unit: 'pt',
    min: 1,
    max: 200,
    step: 1,
  },
  { path: ['fontFace'], label: 'Font', kind: 'fontFamily' },
  { path: ['fontColor'], label: 'Colour', kind: 'color' },
  { path: ['bold'], label: 'Bold', kind: 'boolean' },
  { path: ['italic'], label: 'Italic', kind: 'boolean' },
  { path: ['align'], label: 'Alignment', kind: 'select', options: ALIGNMENTS },
  {
    path: ['lineSpacing'],
    label: 'Line spacing',
    kind: 'number',
    unit: 'pt',
    min: 0,
    step: 1,
    advanced: true,
  },
  {
    path: ['charSpacing'],
    label: 'Tracking',
    kind: 'number',
    unit: 'pt',
    step: 0.5,
    advanced: true,
  },
  {
    path: ['paraSpaceAfter'],
    label: 'Space after',
    kind: 'number',
    unit: 'pt',
    min: 0,
    step: 1,
    advanced: true,
  },
  {
    path: ['fontWeight'],
    label: 'Weight',
    kind: 'number',
    min: 100,
    max: 900,
    step: 100,
    advanced: true,
  },
];

/** DOCX's fixed style slots, in the order they read best. */
export const DOCX_STYLE_NAMES = [
  'normal',
  'title',
  'subtitle',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'TOC1',
  'TOC2',
  'TOC3',
  'TOC4',
  'TOC5',
  'TOC6',
] as const;

function schemaStyleNames(schema: unknown): string[] {
  const styles = (schema as { properties?: { styles?: unknown } })?.properties
    ?.styles as
    | { properties?: Record<string, unknown>; anyOf?: unknown[] }
    | undefined;
  if (!styles) return [];
  if (styles.properties) return Object.keys(styles.properties);
  // Type.Optional(Type.Partial(...)) still exposes `properties` in TypeBox;
  // a union wrapper would not, so read the first object branch.
  const branch = (styles.anyOf ?? []).find(
    (b) => (b as { properties?: unknown }).properties
  ) as { properties: Record<string, unknown> } | undefined;
  return branch ? Object.keys(branch.properties) : [];
}

/** The named style slots a format's schema declares, in the form's order. */
export function styleNames(format: FormatName): string[] {
  if (format === 'docx') {
    const declared = schemaStyleNames(DocxThemeConfigSchema);
    const ordered = DOCX_STYLE_NAMES.filter((n) => declared.includes(n));
    return [
      ...ordered,
      ...declared.filter((n) => !ordered.includes(n as never)),
    ];
  }
  return schemaStyleNames(PptxThemeConfigSchema);
}

export function styleFields(
  format: FormatName
): readonly StyleFieldDescriptor[] {
  return format === 'docx' ? DOCX_STYLE_FIELDS : PPTX_STYLE_FIELDS;
}

/** Styles the theme defines beyond the schema's named slots (DOCX allows any). */
export function customStyleNames(
  theme: ThemeJson,
  format: FormatName
): string[] {
  const known = new Set(styleNames(format));
  const styles = theme.styles;
  if (!styles || typeof styles !== 'object') return [];
  return Object.keys(styles as Record<string, unknown>).filter(
    (name) => !known.has(name)
  );
}

export const STYLE_LABELS: Record<string, string> = {
  normal: 'Normal (body)',
  title: 'Title',
  subtitle: 'Subtitle',
  body: 'Body',
  caption: 'Caption',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  heading4: 'Heading 4',
  heading5: 'Heading 5',
  heading6: 'Heading 6',
  TOC1: 'TOC level 1',
  TOC2: 'TOC level 2',
  TOC3: 'TOC level 3',
  TOC4: 'TOC level 4',
  TOC5: 'TOC level 5',
  TOC6: 'TOC level 6',
};

export function styleLabel(name: string): string {
  return STYLE_LABELS[name] ?? name;
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

/** Top-level keys the form edits directly; the rest is "Advanced". */
const FORM_KEYS: Record<FormatName, readonly string[]> = {
  docx: [
    'name',
    'displayName',
    'description',
    'version',
    'colors',
    'fonts',
    'page',
    'styles',
  ],
  pptx: [
    'name',
    'displayName',
    'description',
    'version',
    'colors',
    'fonts',
    'defaults',
    'styles',
  ],
};

/** The top-level keys the hand-built sections edit. */
export function formKeys(format: FormatName): readonly string[] {
  return FORM_KEYS[format];
}

/**
 * Keys the form leaves alone, with a one-line description each: neither a
 * hand-built section's nor, once the schema is known, one of the sections
 * derived from it.
 */
export function advancedKeys(
  theme: ThemeJson,
  format: FormatName,
  alsoHandled: readonly string[] = []
): Array<{ key: string; summary: string }> {
  const handled = new Set([...FORM_KEYS[format], ...alsoHandled]);
  return Object.keys(theme)
    .filter((key) => !handled.has(key))
    .map((key) => ({ key, summary: summarize(theme[key]) }));
}

function summarize(value: unknown): string {
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length === 0
      ? 'empty'
      : keys.slice(0, 4).join(', ') + (keys.length > 4 ? ', …' : '');
  }
  if (typeof value === 'string')
    return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return String(value);
}

/** Scaffold the containers a fresh theme may be missing, so fields have a home. */
export function ensureContainers(
  theme: ThemeJson,
  format: FormatName
): ThemeJson {
  let next = theme;
  const want: string[] =
    format === 'docx'
      ? ['colors', 'fonts', 'page', 'styles']
      : ['colors', 'fonts', 'defaults', 'styles'];
  for (const key of want) {
    if (!next[key] || typeof next[key] !== 'object')
      next = setAt(next, [key], {});
  }
  return next;
}
