/**
 * Walk a document tree and collect every font family name referenced.
 *
 * Matches both DOCX conventions (`family` nested under `font`, theme.fonts.*)
 * and PPTX conventions (`fontFace`, chart `titleFontFace` etc., theme.fonts.*).
 * Key-name matching is intentionally permissive so future component schemas
 * that reuse the same conventions pick up automatically.
 */

export const FONT_NAME_KEYS = new Set([
  'family',
  'fontFace',
  'titleFontFace',
  'legendFontFace',
  'dataLabelFontFace',
  'catAxisLabelFontFace',
  'valAxisLabelFontFace',
]);

export const THEME_FONT_KEYS = new Set(['heading', 'body', 'mono', 'light']);

function collect(node: unknown, out: Set<string>, parentKey?: string): void {
  if (node == null) return;

  if (typeof node === 'string') {
    // String values under a font-name key or under theme.fonts.{heading,body,...}
    if (
      parentKey &&
      (FONT_NAME_KEYS.has(parentKey) || THEME_FONT_KEYS.has(parentKey))
    ) {
      const trimmed = node.trim();
      if (trimmed.length > 0) out.add(trimmed);
    }
    return;
  }

  if (Array.isArray(node)) {
    // Forward parentKey so font-name arrays (e.g. theme.fonts.heading: [...])
    // are walked with the same context as the non-array case. Mirrors
    // substitute.ts's rewrite walker — the two must stay in sync or
    // substitution silently misses array-shaped references.
    for (const item of node) collect(item, out, parentKey);
    return;
  }

  if (typeof node === 'object') {
    // Special-cased: theme.fonts is an object whose values (or values.family) are font names.
    const maybeFonts = (node as Record<string, unknown>).fonts;
    if (parentKey === 'theme' && maybeFonts && typeof maybeFonts === 'object') {
      for (const [k, v] of Object.entries(
        maybeFonts as Record<string, unknown>
      )) {
        if (typeof v === 'string') {
          const trimmed = v.trim();
          if (trimmed.length > 0) out.add(trimmed);
        } else if (v && typeof v === 'object') {
          const fam = (v as Record<string, unknown>).family;
          if (typeof fam === 'string' && fam.trim().length > 0) {
            out.add(fam.trim());
          }
        }
        void k;
      }
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      collect(v, out, k);
    }
  }
}

/** Scan an arbitrary doc tree (DOCX or PPTX) for every font family referenced. */
export function collectFontNames(doc: unknown): Set<string> {
  const out = new Set<string>();
  collect(doc, out);
  return out;
}

/** Scan a DOCX document tree for every font family name referenced. */
export const collectFontNamesFromDocx = collectFontNames;

/** Scan a PPTX presentation tree for every font family name referenced. */
export const collectFontNamesFromPptx = collectFontNames;
