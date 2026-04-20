/**
 * Validate that every font name referenced in a document is either
 * in SAFE_FONTS or present in the document's fontRegistry / runtime overrides.
 *
 * Used at generate-start; emits warnings for unresolved names so pipelines
 * can surface them via their existing warning channels.
 */

import { SAFE_FONTS, isSafeFont } from '../schemas/font-catalog';
import type { FontRegistryEntry } from '../schemas/font-catalog';

export interface FontResolutionIssue {
  code: 'FONT_UNRESOLVED';
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
