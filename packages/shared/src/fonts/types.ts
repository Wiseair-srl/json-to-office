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
 * One family as the `embed` export mode writes it into a DOCX: the regular
 * face, which docx.js requires, and up to three more — the four faces Word's
 * font table addresses per family. Chosen from a `ResolvedFont`'s sources by
 * `toEmbeddedFontFaces` (`@json-to-office/shared/fonts/node`).
 *
 * Declared here rather than beside that function: it is part of core-docx's
 * public render options, and a type there must not pull the Node-only subpath,
 * and the font tooling it re-exports, into every caller's type graph.
 */
export interface EmbeddedFontFace {
  family: string;
  regular: Buffer;
  bold?: Buffer;
  italic?: Buffer;
  boldItalic?: Buffer;
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
   *
   * - `'embed'` — keep references as in `custom` and write the resolved
   *   TTF/OTF bytes of every non-safe family into the file, so a reader
   *   without the font installed still sees it. DOCX on the `docxjs`
   *   renderer only: Word's font table has four slots per family
   *   (regular, bold, italic, bold italic), so other weights stay
   *   references, and a face whose licence forbids embedding is left out.
   *   Elsewhere it falls back to `custom` with a warning.
   */
  mode?: 'substitute' | 'custom' | 'embed';
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
