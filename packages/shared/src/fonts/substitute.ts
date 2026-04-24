/**
 * Font family substitution: rewrite every non-safe family reference in
 * the doc tree + theme to a SAFE_FONTS equivalent. Used by the
 * `'substitute'` export mode (`FontRuntimeOpts.mode`) so that non-safe
 * fonts (Playfair Display, Inter, …) ship as Georgia/Calibri and the
 * document renders identically on every recipient machine — no embed
 * bytes, no Word-for-Mac intermediate-weight surprises.
 *
 * The walker mirrors the shape used by `collectFontNamesFromDocx/Pptx`
 * so the two stay in sync: whatever `collect` scans, `rewrite` will
 * rewrite. Future component-schema additions that introduce new font
 * keys go in `FONT_NAME_KEYS` / `THEME_FONT_KEYS` once, both sides pick
 * them up.
 */

import { SAFE_FONTS, isSafeFont } from '../schemas/font-catalog';
import { POPULAR_GOOGLE_FONTS } from './catalog/popular-google';
import { FONT_NAME_KEYS, THEME_FONT_KEYS } from './collect';

/** One swap recorded during a rewrite. */
export interface FontSubstitution {
  from: string;
  to: string;
}

export interface ApplyFontSubstitutionResult<T> {
  doc: T;
  substitutions: FontSubstitution[];
}

/**
 * Walk a doc tree + swap every non-safe family reference per `mapping`.
 * Returns a new tree (structural clone) plus the list of `(from, to)`
 * swaps made, deduped by source name.
 *
 * Families already in SAFE_FONTS are never rewritten (even if a mapping
 * entry targets them as a key — safe fonts don't need substitution).
 * Families with no mapping entry are left untouched — callers should
 * feed the result of `buildDefaultSubstitutionMap` to ensure every
 * non-safe reference gets a fallback.
 */
export function applyFontSubstitution<T>(
  doc: T,
  mapping: Record<string, string>
): ApplyFontSubstitutionResult<T> {
  const seen = new Map<string, string>();
  const rewritten = rewrite(doc, mapping, seen) as T;
  const substitutions: FontSubstitution[] = [];
  for (const [from, to] of seen) substitutions.push({ from, to });
  return { doc: rewritten, substitutions };
}

function rewrite(
  node: unknown,
  mapping: Record<string, string>,
  seen: Map<string, string>,
  parentKey?: string
): unknown {
  if (node == null) return node;

  if (typeof node === 'string') {
    if (
      parentKey &&
      (FONT_NAME_KEYS.has(parentKey) || THEME_FONT_KEYS.has(parentKey))
    ) {
      return maybeSwap(node, mapping, seen);
    }
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => rewrite(item, mapping, seen, parentKey));
  }

  if (typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // Parallel to collect.ts: `theme.fonts` may hold plain strings
      // keyed by heading/body/mono/light. Those strings are font names
      // and need swapping just like `font.family` does.
      if (
        parentKey === 'theme' &&
        k === 'fonts' &&
        v &&
        typeof v === 'object'
      ) {
        const nextFonts: Record<string, unknown> = {};
        for (const [fk, fv] of Object.entries(v as Record<string, unknown>)) {
          if (typeof fv === 'string') {
            nextFonts[fk] = maybeSwap(fv, mapping, seen);
          } else if (fv && typeof fv === 'object') {
            const fam = (fv as Record<string, unknown>).family;
            nextFonts[fk] =
              typeof fam === 'string'
                ? { ...(fv as object), family: maybeSwap(fam, mapping, seen) }
                : rewrite(fv, mapping, seen, fk);
          } else {
            nextFonts[fk] = fv;
          }
        }
        out[k] = nextFonts;
        continue;
      }
      out[k] = rewrite(v, mapping, seen, k);
    }
    return out;
  }

  return node;
}

function maybeSwap(
  name: string,
  mapping: Record<string, string>,
  seen: Map<string, string>
): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return name;
  if (isSafeFont(trimmed)) return name;
  // Case-insensitive mapping lookup. Users may feed mappings with
  // slightly different casing than the doc's reference (e.g. "inter" vs
  // "Inter") — honour the target verbatim, don't force case.
  const lowered = trimmed.toLowerCase();
  for (const [from, to] of Object.entries(mapping)) {
    if (from.toLowerCase() === lowered) {
      seen.set(trimmed, to);
      return to;
    }
  }
  return name;
}

// ---------------------------------------------------------------------------
// Default-mapping builder
// ---------------------------------------------------------------------------

/**
 * Explicit overrides for the most common non-safe fonts we see. Chosen
 * for visual similarity: sans serifs map to Calibri, serifs to Georgia
 * or Cambria depending on axis proportion, monospace to Consolas.
 * Extendable as real usage surfaces more families.
 */
const EXPLICIT_OVERRIDES: Record<string, string> = {
  Inter: 'Calibri',
  Roboto: 'Calibri',
  'Open Sans': 'Calibri',
  Lato: 'Calibri',
  'Source Sans 3': 'Calibri',
  'Source Sans Pro': 'Calibri',
  'IBM Plex Sans': 'Calibri',
  'Work Sans': 'Calibri',
  Manrope: 'Calibri',
  Nunito: 'Calibri',
  'Nunito Sans': 'Calibri',
  Poppins: 'Calibri',
  Montserrat: 'Calibri',
  'Playfair Display': 'Georgia',
  Merriweather: 'Georgia',
  'Source Serif 4': 'Cambria',
  'Source Serif Pro': 'Cambria',
  'IBM Plex Serif': 'Cambria',
  'Crimson Pro': 'Cambria',
  Lora: 'Georgia',
  'PT Serif': 'Georgia',
  'Cormorant Garamond': 'Cambria',
  'JetBrains Mono': 'Consolas',
  'Fira Code': 'Consolas',
  'IBM Plex Mono': 'Consolas',
  'Source Code Pro': 'Consolas',
  'Roboto Mono': 'Consolas',
};

const CATEGORY_FALLBACK: Record<string, string> = {
  sans: 'Calibri',
  serif: 'Georgia',
  mono: 'Consolas',
  display: 'Georgia',
  handwriting: 'Segoe UI',
};

/**
 * Pick the safe-font fallback for a single non-safe family. Precedence:
 *   1. Explicit override in `EXPLICIT_OVERRIDES`.
 *   2. Category lookup in `POPULAR_GOOGLE_FONTS`.
 *   3. Final default (`Calibri`).
 *
 * Exposed for the playground dialog so it can pre-populate the per-family
 * picker with the same defaults the CLI would apply.
 */
export function defaultSubstituteFor(family: string): string {
  const trimmed = family.trim();
  // Explicit (case-insensitive).
  for (const [from, to] of Object.entries(EXPLICIT_OVERRIDES)) {
    if (from.toLowerCase() === trimmed.toLowerCase()) return to;
  }
  // Category.
  const catalog = POPULAR_GOOGLE_FONTS.find(
    (f) => f.family.toLowerCase() === trimmed.toLowerCase()
  );
  if (catalog) {
    const cat = CATEGORY_FALLBACK[catalog.category];
    if (cat) return cat;
  }
  return 'Calibri';
}

/**
 * Build a substitution map for every non-safe family in `referencedNames`.
 * Safe fonts are omitted from the result since they don't need swapping.
 * Caller can override individual entries before passing to
 * `applyFontSubstitution`.
 */
export function buildDefaultSubstitutionMap(
  referencedNames: Iterable<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of referencedNames) {
    const name = raw.trim();
    if (name.length === 0) continue;
    if (isSafeFont(name)) continue;
    if (out[name]) continue;
    out[name] = defaultSubstituteFor(name);
  }
  return out;
}

/** Re-export SAFE_FONTS for dialog/CLI consumers that need the allowlist. */
export { SAFE_FONTS };

/**
 * Cache-key suffix used to scope generator outputs by export mode. When
 * `fonts.mode === 'substitute'` the doc tree is rewritten pre-render, so
 * a substitute-mode buffer and a custom-mode buffer for the same base
 * theme must not collide in the byte cache. Keep this as a single
 * helper so a typo in one caller can't silently alias one mode onto the
 * other's cache slot.
 */
export function scopedThemeName(
  baseThemeName: string,
  fontMode: string | undefined
): string {
  return fontMode === 'substitute'
    ? `${baseThemeName}#substitute`
    : baseThemeName;
}

// ---------------------------------------------------------------------------
// Export-mode pre-pass
// ---------------------------------------------------------------------------

import type { FontRuntimeOpts } from './types';
import { collectFontNames } from './collect';

export interface ApplyExportModeInput<D, T> {
  doc: D;
  theme: T;
  fonts?: FontRuntimeOpts;
}

export interface ApplyExportModeWarning {
  code: 'FONT_MODE_CUSTOM' | 'FONT_MODE_SUBSTITUTED';
  message: string;
}

export interface ApplyExportModeResult<D, T> {
  doc: D;
  theme: T;
  warnings: ApplyExportModeWarning[];
}

/**
 * Inspect `fonts.mode` and apply the pre-resolution rewrite for the
 * requested mode.
 *
 * - `'custom'` (default) — no rewrite. Font references stay as authored;
 *   recipients need the font installed or Word falls back. The
 *   LibreOffice preview stager registers resolved bytes so preview
 *   fidelity matches the recipient-side experience when the font is
 *   installed.
 * - `'substitute'` — rewrite every non-safe family in doc + theme to its
 *   mapped safe equivalent. Fills in defaults via
 *   `buildDefaultSubstitutionMap` for any non-safe reference not present
 *   in `fonts.substitution`. Emits one `FONT_MODE_SUBSTITUTED` warning
 *   listing every swap.
 */
export function applyExportMode<D, T>(
  input: ApplyExportModeInput<D, T>
): ApplyExportModeResult<D, T> {
  const mode = input.fonts?.mode ?? 'custom';
  if (mode === 'custom') {
    // Suppress the advisory entirely when callers never passed a `fonts`
    // option: they opted out of font-mode handling, so noisy per-run
    // warnings would flood existing callers that predate the pipeline.
    if (!input.fonts) {
      return { doc: input.doc, theme: input.theme, warnings: [] };
    }
    // Only emit the advisory when the doc/theme actually references a
    // non-safe family — a safe-only doc has nothing for recipients to be
    // missing, and the warning would be noise.
    const referenced = new Set<string>([
      ...collectFontNames(input.doc),
      ...collectFontNames(input.theme),
    ]);
    const nonSafe = [...referenced].filter((name) => !isSafeFont(name.trim()));
    const warnings: ApplyExportModeWarning[] =
      nonSafe.length > 0
        ? [
            {
              code: 'FONT_MODE_CUSTOM',
              message: `Export mode "custom": non-safe font references (${nonSafe.join(', ')}) kept as-is. Recipients need these fonts installed locally; Word falls back to a generic substitute otherwise.`,
            },
          ]
        : [];
    return {
      doc: input.doc,
      theme: input.theme,
      warnings,
    };
  }
  // mode === 'substitute'
  const referenced = new Set<string>([
    ...collectFontNames(input.doc),
    ...collectFontNames(input.theme),
  ]);
  const defaults = buildDefaultSubstitutionMap(referenced);
  const mapping: Record<string, string> = {
    ...defaults,
    ...(input.fonts?.substitution ?? {}),
  };

  const docRewrite = applyFontSubstitution(input.doc, mapping);
  const themeRewrite = applyFontSubstitution(input.theme, mapping);
  const combined = new Map<string, string>();
  for (const s of docRewrite.substitutions) combined.set(s.from, s.to);
  for (const s of themeRewrite.substitutions) combined.set(s.from, s.to);

  const warnings: ApplyExportModeWarning[] = [];
  if (combined.size > 0) {
    const list = [...combined]
      .map(([from, to]) => `${from} → ${to}`)
      .join(', ');
    warnings.push({
      code: 'FONT_MODE_SUBSTITUTED',
      message: `Export mode "substitute": rewrote non-safe families to safe equivalents — ${list}. No fonts embedded; document renders identically on every machine.`,
    });
  }
  return {
    doc: docRewrite.doc,
    theme: themeRewrite.doc,
    warnings,
  };
}
