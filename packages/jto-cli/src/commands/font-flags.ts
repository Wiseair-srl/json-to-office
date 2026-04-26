/**
 * Parsing helpers for the CLI font flags:
 *   --font <name>=<path>   (repeatable)
 *   --fonts-dir <path>     (scan .ttf/.otf)
 *
 * Both produce FontRegistryEntry[] ready to plug into
 * `options.fonts.extraEntries`. Filenames are parsed into weight/italic using
 * the conventional Google Fonts / Adobe naming patterns; multi-variant files
 * for the same family coalesce into a single entry with multiple sources.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { FontRegistryEntry } from '@json-to-office/shared';

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

const SUPPORTED_EXT = new Set(['.ttf', '.otf']);

export interface ParsedFontFilename {
  family: string;
  weight: number;
  italic: boolean;
}

/**
 * Extract `{ family, weight, italic }` from a font filename like
 * `Inter-BoldItalic.ttf`, `Roboto_500.otf`, `Brand Regular.ttf`.
 * Unknown suffixes fall through with default weight 400.
 */
export function parseFontFilename(filename: string): ParsedFontFilename {
  const stem = basename(filename, extname(filename));
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
    // Tail was purely "italic" with no weight info — use regular weight.
    weight = 400;
  }

  if (weight === null) {
    // Unrecognized suffix — treat whole stem as family.
    return { family: stem, weight: 400, italic: false };
  }

  const family = parts.slice(0, -1).join(' ');
  return { family, weight, italic };
}

/** Parse `--font Inter=./fonts/Inter-Regular.ttf` into a FontRegistryEntry. */
export function parseFontFlag(
  spec: string,
  cwd: string = process.cwd()
): FontRegistryEntry {
  const eq = spec.indexOf('=');
  if (eq < 0) {
    throw new Error(
      `--font expects <name>=<path>, got "${spec}". Example: --font Inter=./fonts/Inter-Regular.ttf`
    );
  }
  const family = spec.slice(0, eq).trim();
  const path = spec.slice(eq + 1).trim();
  if (!family || !path) {
    throw new Error(`--font has empty name or path: "${spec}"`);
  }
  const absolutePath = resolve(cwd, path);
  const variant = parseFontFilename(path);
  return {
    id: family,
    family,
    sources: [
      {
        kind: 'file',
        path: absolutePath,
        weight: variant.weight,
        italic: variant.italic,
      },
    ],
  };
}

/**
 * Scan `dir` for .ttf/.otf and coalesce by family.
 * e.g. `Inter-Regular.ttf` + `Inter-Bold.ttf` → one entry with two sources.
 */
export function parseFontsDir(
  dir: string,
  cwd: string = process.cwd()
): FontRegistryEntry[] {
  const absoluteDir = resolve(cwd, dir);
  let entries: string[];
  try {
    entries = readdirSync(absoluteDir);
  } catch (err) {
    throw new Error(
      `--fonts-dir "${dir}" could not be read: ${(err as Error).message}`
    );
  }
  const byFamily = new Map<string, FontRegistryEntry>();
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) continue;
    const fullPath = join(absoluteDir, name);
    try {
      if (!statSync(fullPath).isFile()) continue;
    } catch {
      continue;
    }
    const variant = parseFontFilename(name);
    const source = {
      kind: 'file' as const,
      path: fullPath,
      weight: variant.weight,
      italic: variant.italic,
    };
    const existing = byFamily.get(variant.family);
    if (existing) {
      existing.sources.push(source);
    } else {
      byFamily.set(variant.family, {
        id: variant.family,
        family: variant.family,
        sources: [source],
      });
    }
  }
  return [...byFamily.values()];
}
