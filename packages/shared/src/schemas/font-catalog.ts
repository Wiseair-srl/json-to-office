/**
 * Font catalog + registry schemas.
 *
 * Shared by DOCX and PPTX pipelines. Defines:
 * - SAFE_FONTS: Office-safe font names (installed on Windows/macOS with Office).
 * - FontFamilyNameSchema: free-form string for `font.family` / `fontFace`, with LLM-facing guidance.
 * - FontSourceSchema: one binary variant (safe | google | file | data).
 * - FontRegistryEntrySchema / FontRegistrySchema: document-scoped font registry.
 */

import { Type, Static } from '@sinclair/typebox';

/**
 * Fonts pre-installed with Microsoft Office on Windows + macOS.
 * Using one of these requires no registration and no embedding.
 */
export const SAFE_FONTS = [
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Georgia',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Helvetica',
  'Helvetica Neue',
  'Menlo',
  'Monaco',
] as const;

export type SafeFontName = (typeof SAFE_FONTS)[number];

/** Case-insensitive membership test against SAFE_FONTS. */
export function isSafeFont(name: string): boolean {
  const lower = name.toLowerCase();
  return SAFE_FONTS.some((f) => f.toLowerCase() === lower);
}

/**
 * Font family name used in `font.family` / `fontFace`.
 *
 * Stays a free-form string so users can reference custom or Google fonts.
 * Description + examples guide LLMs and JSON Schema consumers toward SAFE_FONTS.
 */
export const FontFamilyNameSchema = Type.String({
  description:
    'Font family name. Prefer a SAFE_FONTS entry (Arial, Calibri, Cambria, Consolas, Courier New, Georgia, Segoe UI, Tahoma, Times New Roman, Trebuchet MS, Verdana, Helvetica, Helvetica Neue, Menlo, Monaco) for zero-setup rendering. For any other font, register it in props.fontRegistry[] and reference it here by family. Unregistered non-safe names render with a host fallback.',
  examples: ['Arial', 'Calibri', 'Georgia', 'Inter', 'Roboto'],
});

// ----------------------------------------------------------------------------
// Font sources — one weight/style variant
// ----------------------------------------------------------------------------

const FontWeightSchema = Type.Number({
  minimum: 100,
  maximum: 900,
  description: 'OpenType weight (100 thin ... 900 black). Default 400.',
});

const FontItalicSchema = Type.Boolean({
  description: 'Whether this source is italic. Default false.',
});

/** Safe reference — no embedding needed. */
const SafeFontSourceSchema = Type.Object(
  {
    kind: Type.Literal('safe'),
    family: Type.String({
      description: 'A SAFE_FONTS name — installed with Office.',
    }),
  },
  {
    additionalProperties: false,
    description: 'Office-installed font — no embedding',
  }
);

/** Google Fonts — fetched and embedded at generate time. */
const GoogleFontSourceSchema = Type.Object(
  {
    kind: Type.Literal('google'),
    family: Type.String({
      description: 'Exact Google Fonts family name (e.g. "Inter").',
    }),
    weights: Type.Optional(
      Type.Array(FontWeightSchema, {
        description: 'Weights to fetch. Default [400, 700].',
      })
    ),
    italics: Type.Optional(
      Type.Boolean({ description: 'Include italic variants. Default false.' })
    ),
  },
  {
    additionalProperties: false,
    description: 'Google Fonts — auto-fetched and embedded',
  }
);

/** Local TTF/OTF file — resolved relative to the JSON file, or absolute. */
const FileFontSourceSchema = Type.Object(
  {
    kind: Type.Literal('file'),
    path: Type.String({
      description:
        'Path to a .ttf/.otf file. Relative paths are resolved against the JSON document file.',
    }),
    weight: Type.Optional(FontWeightSchema),
    italic: Type.Optional(FontItalicSchema),
  },
  { additionalProperties: false, description: 'Local font file to embed' }
);

/**
 * Direct URL to a TTF/OTF. Used to bypass Google Fonts redistribution for
 * families with known metadata defects — e.g. rsms/inter hosted on jsDelivr.
 * A single URL fetches one variant; multiple URLs build a multi-weight family.
 */
const UrlFontSourceSchema = Type.Object(
  {
    kind: Type.Literal('url'),
    url: Type.String({
      description: 'HTTPS URL of a TTF or OTF file.',
    }),
    weight: Type.Optional(FontWeightSchema),
    italic: Type.Optional(FontItalicSchema),
  },
  {
    additionalProperties: false,
    description: 'Direct TTF/OTF URL (non-Google CDN)',
  }
);

/**
 * Variable-font-instanced variant. Points at a variable TTF URL plus a
 * target weight (and optional additional `axes` pins); the fetcher
 * downloads the variable TTF once (disk-cached) and uses harfbuzz to pin
 * the `wght` axis (plus any additional axes) to produce a clean static
 * TTF for embedding.
 *
 * Used to escape Google Fonts' lossy per-weight static generation — e.g.
 * Google ships Inter Thin and Inter ExtraLight as near-identical glyph
 * files (both sourced around wght=250), but the upstream variable Inter
 * produces properly distinct static instances when pinned precisely at
 * wght=100 vs wght=200.
 */
const VariableFontSourceSchema = Type.Object(
  {
    kind: Type.Literal('variable'),
    url: Type.String({
      description: 'HTTPS URL of a variable TTF (`fvar` axis table required).',
    }),
    weight: FontWeightSchema,
    italic: Type.Optional(FontItalicSchema),
    axes: Type.Optional(
      Type.Record(Type.String(), Type.Number(), {
        description:
          'Additional axis pin values (e.g. `{ ital: 1, opsz: 14 }`) merged on top of the derived `wght` pin. Uncommon — the `weight` field is usually enough.',
      })
    ),
  },
  {
    additionalProperties: false,
    description:
      'Variable-font instancer. The fetcher pins `wght` to `weight` (plus any `axes` overrides) and emits a clean static TTF, bypassing upstream distributions that collapse multiple static weights onto the same glyph geometry.',
  }
);

/** Inline base64 / data-URL — self-contained JSON. */
const DataFontSourceSchema = Type.Object(
  {
    kind: Type.Literal('data'),
    data: Type.String({
      description:
        'Base64-encoded TTF/OTF or data: URL (data:font/ttf;base64,...). Makes the JSON self-contained at the cost of size.',
    }),
    weight: Type.Optional(FontWeightSchema),
    italic: Type.Optional(FontItalicSchema),
  },
  { additionalProperties: false, description: 'Inline base64 font — portable' }
);

/**
 * One weight/style variant backing a font registry entry.
 *
 * Kinds:
 * - safe: references an Office-installed font; no embedding.
 * - google: Google Fonts family; fetched and embedded at generate time.
 * - file: local .ttf/.otf read from disk.
 * - data: inline base64, makes JSON self-contained.
 */
export const FontSourceSchema = Type.Union(
  [
    SafeFontSourceSchema,
    GoogleFontSourceSchema,
    FileFontSourceSchema,
    DataFontSourceSchema,
    UrlFontSourceSchema,
    VariableFontSourceSchema,
  ],
  {
    description:
      'A single font variant source. Use kind:"safe" for installed fonts, kind:"google" for Google Fonts, kind:"file" for local files, kind:"data" for base64, kind:"url" for direct HTTPS TTF/OTF URLs, kind:"variable" to instance a variable TTF at a specific weight.',
  }
);

export type FontSource = Static<typeof FontSourceSchema>;

// ----------------------------------------------------------------------------
// Font registry entry
// ----------------------------------------------------------------------------

const FontCategorySchema = Type.Union(
  [
    Type.Literal('sans'),
    Type.Literal('serif'),
    Type.Literal('mono'),
    Type.Literal('display'),
    Type.Literal('handwriting'),
  ],
  { description: 'Broad category used for fallback selection' }
);

export const FontRegistryEntrySchema = Type.Object(
  {
    id: Type.String({
      description:
        'Registry key. By convention, match the display family name ("Inter", "Roboto Slab").',
    }),
    family: Type.String({
      description:
        'Display family used in font.family / fontFace / theme.fonts.*. Usually identical to id.',
    }),
    category: Type.Optional(FontCategorySchema),
    sources: Type.Array(FontSourceSchema, {
      minItems: 1,
      description:
        'One or more weight/style variants. List at least a regular (weight 400, italic false).',
    }),
  },
  {
    additionalProperties: false,
    description:
      'A font registered for this document. Referenced by family from font.family, fontFace, and theme.fonts.*.',
  }
);

export type FontRegistryEntry = Static<typeof FontRegistryEntrySchema>;

/**
 * Document-scoped font registry.
 *
 * Ships with the JSON — no runtime side-channel needed for the common case.
 * Every font name used in font.family / fontFace / theme.fonts.* that isn't
 * in SAFE_FONTS must resolve to an entry here (by family) or tooling warns.
 */
export const FontRegistrySchema = Type.Array(FontRegistryEntrySchema, {
  description:
    'Document-scoped font registry. Every non-safe font used in this document must be registered here.',
});

export type FontRegistryDefinition = Static<typeof FontRegistrySchema>;
