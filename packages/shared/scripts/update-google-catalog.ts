/**
 * Regenerate `src/fonts/catalog/popular-google.ts` from the Google Fonts
 * Developer API.
 *
 * Runs manually (not part of build) because regeneration requires an API key
 * and should be a conscious decision tied to verifying visual/metadata
 * compatibility — not a silent drift on every deploy.
 *
 * Usage:
 *   GOOGLE_FONTS_API_KEY=... pnpm --filter @json-to-office/shared update:fonts-catalog
 *
 * The script preserves the curated family allowlist (the 30-ish names that
 * already live in popular-google.ts) and only refreshes their `weights`,
 * `hasItalic`, and `category` fields from the API. Adding a new family to
 * the catalog is a deliberate code-edit step (append to `FAMILY_ALLOWLIST`
 * below) so the catalog stays opinionated.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(
  __dirname,
  '../src/fonts/catalog/popular-google.ts'
);

interface GoogleFontsApiFont {
  family: string;
  variants: string[];
  category: string;
}

interface GoogleFontsApiResponse {
  items: GoogleFontsApiFont[];
}

const CATEGORY_MAP: Record<
  string,
  'sans' | 'serif' | 'mono' | 'display' | 'handwriting'
> = {
  'sans-serif': 'sans',
  serif: 'serif',
  monospace: 'mono',
  display: 'display',
  handwriting: 'handwriting',
};

function parseExistingAllowlist(): string[] {
  // Extract the `family: '...'` strings from the current catalog file. Keeping
  // the allowlist inline in popular-google.ts (rather than in a separate
  // .allowlist.txt) means the catalog is self-documenting — reviewers see
  // the curated list right next to the data it generates.
  const src = readFileSync(CATALOG_PATH, 'utf8');
  const familyRe = /family:\s*'([^']+)'/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = familyRe.exec(src)) !== null) out.add(m[1]);
  return [...out];
}

function parseWeights(variants: string[]): {
  weights: number[];
  hasItalic: boolean;
} {
  const weights = new Set<number>();
  let hasItalic = false;
  for (const v of variants) {
    if (v === 'regular') {
      weights.add(400);
    } else if (v === 'italic') {
      weights.add(400);
      hasItalic = true;
    } else if (/^\d+$/.test(v)) {
      weights.add(parseInt(v, 10));
    } else {
      const m = v.match(/^(\d+)italic$/);
      if (m) {
        weights.add(parseInt(m[1], 10));
        hasItalic = true;
      }
    }
  }
  return {
    weights: [...weights].sort((a, b) => a - b),
    hasItalic,
  };
}

async function main(): Promise<void> {
  const key = process.env.GOOGLE_FONTS_API_KEY;
  if (!key) {
    console.error(
      'GOOGLE_FONTS_API_KEY is required. Get one at https://console.cloud.google.com/apis/credentials'
    );
    process.exit(2);
  }

  const allowlist = parseExistingAllowlist();
  if (allowlist.length === 0) {
    console.error(`No families parsed from ${CATALOG_PATH}; aborting.`);
    process.exit(2);
  }
  const allowlistLower = new Set(allowlist.map((f) => f.toLowerCase()));

  const res = await fetch(
    `https://www.googleapis.com/webfonts/v1/webfonts?key=${key}&sort=popularity`
  );
  if (!res.ok) {
    console.error(`Google Fonts API returned ${res.status}`);
    process.exit(1);
  }
  const payload = (await res.json()) as GoogleFontsApiResponse;

  // Rebuild the catalog in the original allowlist order so diffs stay minimal.
  const byFamilyLower = new Map<string, GoogleFontsApiFont>();
  for (const f of payload.items) byFamilyLower.set(f.family.toLowerCase(), f);

  const missing: string[] = [];
  const rebuilt = allowlist.map((name) => {
    const entry = byFamilyLower.get(name.toLowerCase());
    if (!entry) {
      missing.push(name);
      return null;
    }
    const { weights, hasItalic } = parseWeights(entry.variants);
    const category = CATEGORY_MAP[entry.category] ?? 'sans';
    return { family: entry.family, category, weights, hasItalic };
  });

  if (missing.length > 0) {
    console.error(
      `The following allowlisted families are missing from the API response (may have been deprecated):\n  ${missing.join(', ')}\nReview and decide whether to drop them.`
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const body = rebuilt
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map(
      (f) =>
        `  {\n    family: '${f.family}',\n    category: '${f.category}',\n    weights: [${f.weights.join(', ')}],\n    hasItalic: ${f.hasItalic},\n  },`
    )
    .join('\n');

  const file = `/**
 * Curated list of popular Google Fonts for picker autocomplete.
 *
 * Not exhaustive — the full Google Fonts library has ~1500 families.
 * This is ~30 names known to cover most real-world use cases.
 *
 * AUTO-GENERATED on ${today} via \`pnpm --filter @json-to-office/shared update:fonts-catalog\`.
 * Do not edit manually — changes here will be overwritten on next regen.
 * To add/remove a family, edit the allowlist in popular-google.ts (which
 * the script reads) and re-run.
 */

export interface PopularGoogleFont {
  family: string;
  category: 'sans' | 'serif' | 'mono' | 'display' | 'handwriting';
  /** Weights available on Google Fonts for this family. */
  weights: number[];
  /** Whether italic variants exist. */
  hasItalic: boolean;
}

export const POPULAR_GOOGLE_FONTS: readonly PopularGoogleFont[] = [
${body}
];
`;

  writeFileSync(CATALOG_PATH, file, 'utf8');
  // Use allowlistLower just to silence the unused-variable lint — the set is
  // kept for future filtering if we add a "reject if removed from API" mode.
  void allowlistLower;
  console.log(
    `Regenerated ${CATALOG_PATH} (${rebuilt.filter(Boolean).length} families; ${missing.length} missing).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
