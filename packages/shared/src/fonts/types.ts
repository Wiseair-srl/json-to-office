/**
 * Runtime types for the font registry + resolver.
 *
 * These are deliberately decoupled from the TypeBox schemas so renderers
 * can operate on resolved fonts without parsing/re-validating.
 */

import type { FontSource, FontRegistryEntry } from '../schemas/font-catalog';

/** One resolved variant — a buffer of font bytes. */
export interface ResolvedFontSource {
  data: Buffer;
  weight: number;
  italic: boolean;
  /** Format inferred from magic bytes at resolution time. */
  format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'pfb' | 'unknown';
}

/** A font reference resolved against the registry. */
export interface ResolvedFont {
  family: string;
  /** Zero or more variants, one per weight/style. Empty for safe-only fonts. */
  sources: ResolvedFontSource[];
  /** Non-fatal messages surfaced during resolution. */
  warnings: string[];
}

/**
 * Runtime options passed through generator APIs and CLI.
 *
 * NOT serializable — `onResolved` carries a function and `extraEntries[].sources`
 * may contain in-memory `Buffer` payloads. Callers that log or cache this
 * shape (e.g. request-body snapshots, cache-key payloads) MUST strip
 * `onResolved` and any `Buffer`-bearing sources first. The "documents as
 * data" invariant applies to the doc + theme JSON, not to this runtime
 * side-channel.
 */
export interface FontRuntimeOpts {
  /** Additional entries merged over the document's fontRegistry (runtime-only overrides). */
  extraEntries?: FontRegistryEntry[];
  /** Google Fonts fetch configuration. Fetching disabled when `enabled === false`. */
  googleFonts?: {
    enabled?: boolean;
    cacheDir?: string;
    fetchTimeoutMs?: number;
  };
  /** Promote FONT_UNRESOLVED warnings to errors. */
  strict?: boolean;
  /**
   * How non-safe font references are handled at export time:
   *
   * - `'custom'` (default) — keep font references as-is. Recipient needs
   *   the font installed; Word falls back to a generic substitute if not.
   *   Best for brand fidelity with known recipients.
   *
   * - `'substitute'` — rewrite every non-safe family reference (doc +
   *   theme) to a SAFE_FONTS equivalent per `substitution`. Document
   *   renders identically on every machine at the cost of visual
   *   fidelity. Best for broadly-shared output.
   */
  mode?: 'substitute' | 'custom';
  /**
   * Family-name substitution map, applied when `mode === 'substitute'`.
   * Keys are the non-safe family names referenced by the doc; values are
   * the SAFE_FONTS replacement to use. Unset keys fall back to
   * `buildDefaultSubstitutionMap` (category-based). Omit this field for
   * all-defaults behaviour.
   */
  substitution?: Record<string, string>;
  /** Base directory used to resolve `kind: "file"` source paths (default: cwd). */
  baseDir?: string;
  /**
   * Invoked once per generate with the resolved-and-materialized fonts
   * (after any HTTP/disk fetches). Useful for side-channels like staging
   * fonts for a downstream PDF converter — see the playground's LibreOffice
   * preview path.
   */
  onResolved?: (fonts: ResolvedFont[]) => void;
}

export type { FontSource, FontRegistryEntry };
