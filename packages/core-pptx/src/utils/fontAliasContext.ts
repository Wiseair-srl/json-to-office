/**
 * Resolve (family, weight, italic) into the PPTX run's final `(fontFace,
 * bold, italic)` triple. Non-RIBBI weights are rewritten to synthetic
 * sub-family names (e.g. "Inter Light") so PowerPoint / LibreOffice can
 * resolve the matching installed face; RIBBI stays on the canonical
 * family and uses native bold/italic toggles.
 *
 * Mirrors the DOCX `applyFontWeightAlias` helper so both cores coerce
 * fontWeight identically.
 */

import { synthesizeFamilyName } from '@json-to-office/shared';

export function applyFontWeight(params: {
  family?: string;
  fontWeight?: number;
  italic?: boolean;
  bold?: boolean;
}): { fontFace?: string; bold?: boolean; italic?: boolean } {
  if (!params.family) {
    const weight =
      params.fontWeight ?? (params.bold === true ? 700 : undefined);
    return {
      bold: weight != null ? weight >= 600 : params.bold,
      italic: params.italic,
    };
  }
  const weight = params.fontWeight ?? (params.bold === true ? 700 : undefined);
  const synth = synthesizeFamilyName(
    params.family,
    weight,
    params.italic === true
  );
  return { fontFace: synth.family, bold: synth.bold, italic: synth.italic };
}
