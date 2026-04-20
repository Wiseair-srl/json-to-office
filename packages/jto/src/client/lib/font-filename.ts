/**
 * Browser-safe mirror of parseFontFilename from packages/jto/src/commands/font-flags.ts.
 * The CLI version imports node:path; Vite would refuse to bundle that into the
 * playground, so we duplicate the pure-string logic here.
 *
 * Keep in sync with the CLI version — both parse filenames like
 * `Inter-BoldItalic.ttf`, `Roboto_500.otf`, `Brand Regular.ttf` into
 * `{ family, weight, italic }`.
 */

const WEIGHT_NAMES: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

export interface ParsedFontFilename {
  family: string;
  weight: number;
  italic: boolean;
}

/** Strip directory and extension — browser-safe equivalent of basename+extname. */
function stripExtension(filename: string): string {
  const name = filename.substring(filename.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

export function parseFontFilename(filename: string): ParsedFontFilename {
  const stem = stripExtension(filename);
  const parts = stem.split(/[-_\s]+/).filter(Boolean);
  if (parts.length <= 1) {
    return { family: stem, weight: 400, italic: false };
  }

  const tail = parts[parts.length - 1].toLowerCase();
  const italic = /italic|oblique/.test(tail);
  const withoutItalic = tail.replace(/italic|oblique/g, '');

  let weight: number | null = null;
  if (withoutItalic !== '') {
    const numeric = parseInt(withoutItalic, 10);
    if (
      !Number.isNaN(numeric) &&
      String(numeric) === withoutItalic &&
      numeric >= 100 &&
      numeric <= 900
    ) {
      weight = numeric;
    } else if (withoutItalic in WEIGHT_NAMES) {
      weight = WEIGHT_NAMES[withoutItalic];
    }
  } else if (italic) {
    weight = 400;
  }

  if (weight === null) {
    return { family: stem, weight: 400, italic: false };
  }

  const family = parts.slice(0, -1).join(' ');
  return { family, weight, italic };
}
