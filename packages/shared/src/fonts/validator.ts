/**
 * Validate that every font name referenced in a document is either
 * in SAFE_FONTS or present in the document's fontRegistry / runtime overrides.
 *
 * Used at generate-start; emits warnings for unresolved names so pipelines
 * can surface them via their existing warning channels.
 */

import { SAFE_FONTS, isSafeFont } from '../schemas/font-catalog';
import type { FontRegistryEntry } from '../schemas/font-catalog';

/**
 * Warning codes for font resolution + rendering.
 *
 * - `FONT_UNRESOLVED`         — family not in SAFE_FONTS and not registered.
 * - `FONT_MODE_SUBSTITUTED`   — non-safe families rewritten to safe equivalents.
 * - `FONT_MODE_CUSTOM`        — export mode "custom" — refs kept as-is.
 * - `FONT_MODE_EMBED`         — export mode "embed" — the one summary: which
 *                               families embedded which faces, which faces
 *                               came from a nearest weight, which non-safe
 *                               families embedded nothing.
 *
 * One per face, from embed-mode face selection (`embed-faces.ts`):
 *
 * - `FONT_EMBED_SKIPPED_FORMAT`  — not TTF/OTF; OOXML carries neither WOFF,
 *                                  WOFF2, EOT nor Type 1, so it stays out.
 * - `FONT_EMBED_SKIPPED_LICENSE` — `OS/2.fsType` says restricted licence
 *                                  embedding; the face stays out.
 * - `FONT_EMBED_READ_ONLY`       — embedded under preview & print, so Word
 *                                  opens the document read-only.
 * - `FONT_EMBED_WEIGHT_DROPPED`  — fills none of Word's four slots per family
 *                                  (or another face already fills its slot);
 *                                  left as a reference, as in "custom".
 *
 * And one per request that asked for "embed" where it cannot happen:
 *
 * - `FONT_EMBED_UNSUPPORTED_RENDERER` — DOCX on a renderer other than
 *                                       `docxjs`; references kept as in
 *                                       "custom".
 * - `FONT_EMBED_UNSUPPORTED_FORMAT`   — PPTX; references kept as in "custom".
 */
export type FontIssueCode =
  | 'FONT_UNRESOLVED'
  | 'FONT_MODE_SUBSTITUTED'
  | 'FONT_MODE_CUSTOM'
  | 'FONT_MODE_EMBED'
  | 'FONT_EMBED_SKIPPED_FORMAT'
  | 'FONT_EMBED_SKIPPED_LICENSE'
  | 'FONT_EMBED_READ_ONLY'
  | 'FONT_EMBED_WEIGHT_DROPPED'
  | 'FONT_EMBED_UNSUPPORTED_RENDERER'
  | 'FONT_EMBED_UNSUPPORTED_FORMAT';

export interface FontResolutionIssue {
  code: FontIssueCode;
  family: string;
  message: string;
}

export interface FontValidationResult {
  /** Names that resolved via SAFE_FONTS or the registry. */
  resolved: string[];
  /** Names with no resolution path. */
  unresolved: string[];
  /** One warning per unresolved name. */
  warnings: FontResolutionIssue[];
}

export interface FontValidationInput {
  /** Font names referenced in the document (from collectFontNamesFromDocx / FromPptx). */
  referencedNames: Iterable<string>;
  /** Runtime-registered entries (e.g. from FontRuntimeOpts.extraEntries). */
  registeredEntries?: FontRegistryEntry[];
}

function buildRegistryIndex(
  registeredEntries?: FontRegistryEntry[]
): Set<string> {
  const idx = new Set<string>();
  for (const e of registeredEntries ?? []) {
    idx.add(e.family.toLowerCase());
    idx.add(e.id.toLowerCase());
  }
  return idx;
}

/**
 * Validate referenced font names against SAFE_FONTS + runtime-registered entries.
 * Does not perform network fetches — this runs purely off schema + opts content.
 */
export function validateFontReferences(
  input: FontValidationInput
): FontValidationResult {
  const registryIdx = buildRegistryIndex(input.registeredEntries);
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const warnings: FontResolutionIssue[] = [];

  for (const name of input.referencedNames) {
    if (isSafeFont(name) || registryIdx.has(name.toLowerCase())) {
      resolved.push(name);
      continue;
    }
    unresolved.push(name);
    warnings.push({
      code: 'FONT_UNRESOLVED',
      family: name,
      message:
        `Font "${name}" is not a SAFE_FONTS entry and is not registered via fonts.extraEntries. ` +
        `It will render with a host fallback on machines lacking the font. ` +
        `Safe fonts: ${SAFE_FONTS.join(', ')}.`,
    });
  }

  return { resolved, unresolved, warnings };
}
