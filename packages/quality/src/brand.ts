import { QUALITY_CODES, type QualityRuleFinding } from './types';

/**
 * Brand facts shared by both formats: the colours a document paints outside
 * its theme, and the font families it asks for.
 *
 * Both are read off the *authored* tree rather than the resolved model,
 * because both findings are repaired by editing what the author wrote — a
 * hex swapped for a token, a family removed — and a pointer into a resolved
 * structure is not a patch target.
 */

/** A colour written as a literal rather than as a theme token. */
export interface ColorLiteral {
  /** RFC 6901 pointer to the value. */
  path: string;
  /** Exactly as authored, so a message can quote it. */
  raw: string;
  /** Normalized `#RRGGBB`, uppercase — the comparable form. */
  hex: string;
}

export interface FontFamilyUse {
  path: string;
  family: string;
}

/**
 * Keys whose string value paints. Deliberately a property test rather than a
 * value test: `#FF0000` inside a sentence is prose, and a six-character
 * identifier that happens to be hex is an id. A colour is a colour because of
 * where it sits.
 */
const COLOR_KEY = /(colou?r|fill|stroke|shade|tint|background|border)/i;

/** Family-name properties across both formats: docx `font.family`, pptx `fontFace`. */
const FAMILY_KEYS = new Set(['family', 'fontFace', 'fontFamily']);

const HEX = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** `#RRGGBB` uppercase, expanding 3-digit shorthand; undefined when not hex. */
export function normalizeHex(value: string): string | undefined {
  const found = HEX.exec(value.trim());
  if (!found) return undefined;
  const digits = found[1];
  const full =
    digits.length === 3
      ? digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
      : digits;
  return `#${full.toUpperCase()}`;
}

interface WalkOptions {
  onString(value: string, path: string, key: string): void;
}

/**
 * Depth-first over the authored tree, carrying the nearest *named* key.
 *
 * Array indices are not keys — `colors: ['#112233']` is a list of colours, and
 * carrying `colors` down through the index is what lets the entry be
 * recognised as one.
 */
function walk(node: unknown, path: string, key: string, options: WalkOptions) {
  if (typeof node === 'string') {
    options.onString(node, path, key);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, index) =>
      walk(entry, `${path}/${index}`, key, options)
    );
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  // A disabled component never paints, so nothing inside it is a brand defect.
  if (record.enabled === false) return;
  for (const [name, value] of Object.entries(record)) {
    walk(value, `${path}/${pointerSegment(name)}`, name, options);
  }
}

export function collectColorLiterals(
  document: unknown
): readonly ColorLiteral[] {
  const found: ColorLiteral[] = [];
  walk(document, '', '', {
    onString: (value, path, key) => {
      if (!COLOR_KEY.test(key)) return;
      const hex = normalizeHex(value);
      if (hex) found.push({ path, raw: value, hex });
    },
  });
  return found;
}

export function collectFontFamilies(
  document: unknown
): readonly FontFamilyUse[] {
  const found: FontFamilyUse[] = [];
  walk(document, '', '', {
    onString: (value, path, key) => {
      const family = value.trim();
      if (FAMILY_KEYS.has(key) && family !== '') found.push({ path, family });
    },
  });
  return found;
}

export interface NearestToken {
  token: string;
  hex: string;
  distance: number;
}

/**
 * The palette entry closest to `hex`, by the "redmean" approximation — cheap,
 * and much closer to how an eye ranks near-neighbours than a plain RGB
 * distance, which would happily call a dark blue the nearest match for a dark
 * green.
 *
 * Ties break on the token name so the same document always emits the same fix.
 */
export function nearestPaletteToken(
  hex: string,
  palette: Readonly<Record<string, string>>
): NearestToken | undefined {
  const target = normalizeHex(hex);
  if (!target) return undefined;
  const [tr, tg, tb] = channels(target);
  let best: NearestToken | undefined;
  for (const token of Object.keys(palette).sort()) {
    const candidate = normalizeHex(palette[token] ?? '');
    if (!candidate) continue;
    const [cr, cg, cb] = channels(candidate);
    const meanRed = (tr + cr) / 2;
    const dr = tr - cr;
    const dg = tg - cg;
    const db = tb - cb;
    const distance = Math.sqrt(
      (2 + meanRed / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - meanRed) / 256) * db * db
    );
    if (!best || distance < best.distance) {
      best = { token, hex: candidate, distance };
    }
  }
  return best;
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * A colour the theme does not define, with the token that would replace it.
 *
 * `info`, not a warning: an off-palette colour is often deliberate — a
 * client's own brand red inside a report that is otherwise on theme — and the
 * finding exists to make the choice visible, not to overrule it. The fix is
 * offered because the common case is a colour typed from memory that is one
 * or two channels away from a token the document already has.
 */
export function offPaletteFinding(input: {
  path: string;
  raw: string;
  hex: string;
  nearest?: NearestToken;
}): QualityRuleFinding {
  const { nearest } = input;
  return {
    code: QUALITY_CODES.OFF_PALETTE,
    severity: 'info',
    category: 'brand',
    certainty: 'deterministic',
    message: nearest
      ? `${input.raw} is not in the theme palette; the nearest token is \`${nearest.token}\` (${nearest.hex}).`
      : `${input.raw} is not in the theme palette.`,
    path: input.path,
    suggestion: nearest
      ? `Use "${nearest.token}" so the colour follows the theme, or keep the literal if it is deliberately off-palette.`
      : 'Name a theme colour instead of a literal, so a theme swap repaints it.',
    context: {
      color: input.hex,
      ...(nearest && {
        nearestToken: nearest.token,
        nearestHex: nearest.hex,
        distance: Math.round(nearest.distance * 10) / 10,
      }),
    },
    evidence: {
      actual: input.hex,
      ...(nearest && { expected: nearest.hex }),
    },
    ...(nearest && {
      fixes: [{ op: 'add' as const, path: input.path, value: nearest.token }],
    }),
  };
}

/** Every family the document can paint, over the limit a design can carry. */
export function fontCountFinding(input: {
  path: string;
  families: readonly string[];
  maximum: number;
  relatedPaths?: readonly string[];
}): QualityRuleFinding {
  return {
    code: QUALITY_CODES.FONT_COUNT,
    severity: 'warning',
    category: 'brand',
    certainty: 'deterministic',
    message: `${input.families.length} font families in one document (${input.families.join(', ')}) — past ${input.maximum} a document reads as assembled rather than designed.`,
    path: input.path,
    suggestion:
      'Carry the extra weight with size, weight and colour instead of another family; a family the theme already defines costs nothing.',
    context: { families: [...input.families], maximum: input.maximum },
    evidence: {
      actual: input.families.length,
      expected: input.maximum,
      unit: 'families',
    },
    ...(input.relatedPaths &&
      input.relatedPaths.length > 0 && { relatedPaths: input.relatedPaths }),
  };
}
