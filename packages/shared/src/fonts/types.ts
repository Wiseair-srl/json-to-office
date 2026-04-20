/**
 * Runtime types for the font registry + resolver.
 *
 * These are deliberately decoupled from the TypeBox schemas so renderers
 * can operate on resolved fonts without parsing/re-validating.
 */

import type { FontSource, FontRegistryEntry } from '../schemas/font-catalog';

/** One resolved variant — a buffer ready to embed. */
export interface ResolvedFontSource {
  data: Buffer;
  weight: number;
  italic: boolean;
  /** Format inferred from magic bytes at resolution time. */
  format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'unknown';
}

/** A font reference resolved against the registry. */
export interface ResolvedFont {
  family: string;
  /** True if we should emit embedding bytes into the output file. */
  willEmbed: boolean;
  /** Zero or more variants, one per weight/style. Empty for safe-only fonts. */
  sources: ResolvedFontSource[];
  /** Non-fatal messages surfaced during resolution. */
  warnings: string[];
}

/** Runtime options passed through generator APIs and CLI. */
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
