import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  isSafeFont,
  POPULAR_GOOGLE_FONTS,
  WEIGHT_LABELS,
} from '@json-to-office/shared';

/**
 * Chart label fonts used to be a one-way door: they could name a family, never
 * a weight. `PptxChartPropsSchema` exposed exactly one weight-ish companion for
 * all five font-face props — `dataLabelFontBold`, a boolean — and core-pptx
 * copied the faces straight into the pptxgenjs options, so nothing reached
 * `synthesizeFamilyName`. Six sites that used to read "Inter Light" or
 * "Space Grotesk Medium" rendered at Regular, and the names could not go back:
 * they resolve to nothing and `scripts/validate-shipped-assets.ts` rejects them.
 *
 * That door is open now. Each font-face prop has a `<prop>FontWeight` sibling
 * (integer 100–900) and `packages/core-pptx/src/components/chart.ts` runs the
 * pair through the same `applyFontWeight` → `synthesizeFamilyName` seam that
 * run-level `fontFace` uses. The six sites below carry their designed weight
 * again; the remaining five name a family and genuinely want Regular.
 *
 * Both lists are pinned, not merely counted, so that:
 *   - a template edit that adds a chart font reference has to come here and
 *     say which of the two it is, and
 *   - a "fix" that smuggles a sub-family name back into a chart font key
 *     (rather than using the weight companion) fails loudly.
 */
const WEIGHTED_CHART_FONT_SITES = [
  'Alternative deck 16_9.pptx.json :: $.props.templates[6].placeholders[2].defaults.props.dataLabelFontFace :: Inter @300',
  'Company deck 16_9.pptx.json :: $.props.templates[12].placeholders[5].defaults.props.dataLabelFontFace :: Inter @300',
  'Company deck 16_9.pptx.json :: $.props.templates[6].placeholders[2].defaults.props.dataLabelFontFace :: Inter @300',
  'Company deck 4_3.pptx.json :: $.children[6].props.placeholders.chart.props.legendFontFace :: Inter @300',
  'Company deck 4_3.pptx.json :: $.props.templates[7].placeholders[2].defaults.props.dataLabelFontFace :: Inter @300',
  'data-report-presentation.pptx.json :: $.children[4].children[4].props.catAxisLabelFontFace :: Space Grotesk @500',
];

/** Chart font references that name a family and no weight — Regular by design. */
const WEIGHTLESS_CHART_FONT_SITES = [
  'data-report-presentation.pptx.json :: $.children[14].children[0].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[14].children[0].props.valAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[3].children[0].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[5].children[4].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[5].children[4].props.valAxisLabelFontFace :: Space Grotesk',
];

/**
 * Mirror of the chart font keys in `FONT_NAME_KEYS`
 * (packages/shared/src/fonts/collect.ts) minus the run-level `family` /
 * `fontFace`. Each one's weight companion is the same name with `FontFace`
 * swapped for `FontWeight`.
 */
const CHART_FONT_KEYS = new Set([
  'titleFontFace',
  'legendFontFace',
  'dataLabelFontFace',
  'catAxisLabelFontFace',
  'valAxisLabelFontFace',
]);

const weightKeyFor = (faceKey: string): string =>
  faceKey.replace('FontFace', 'FontWeight');

/** Same shape `scripts/validate-shipped-assets.ts` gates on. */
const SYNTHETIC_FAMILY =
  /^(.+) (Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)( Italic)?$/;

const CATALOG = new Set(
  POPULAR_GOOGLE_FONTS.map((f) => f.family.toLowerCase())
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../client/public/templates'
);

interface ChartFontSite {
  file: string;
  jsonPath: string;
  family: string;
  weight?: unknown;
}

function collectChartFontSites(file: string, json: unknown): ChartFontSite[] {
  const sites: ChartFontSite[] = [];

  const walk = (node: unknown, jsonPath: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${jsonPath}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const childPath = `${jsonPath}.${key}`;
      if (typeof value === 'string' && CHART_FONT_KEYS.has(key)) {
        sites.push({
          file,
          jsonPath: childPath,
          family: value,
          weight: record[weightKeyFor(key)],
        });
      } else {
        walk(value, childPath);
      }
    }
  };

  walk(json, '$');
  return sites;
}

const allSites = fs
  .readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith('.pptx.json'))
  .sort()
  .flatMap((file) =>
    collectChartFontSites(
      file,
      JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8'))
    )
  );

const label = (s: ChartFontSite): string =>
  `${s.file} :: ${s.jsonPath} :: ${s.family}` +
  (s.weight === undefined ? '' : ` @${String(s.weight)}`);

describe('chart label fonts in bundled templates', () => {
  it('finds chart font references at all (the walk is wired up)', () => {
    expect(allSites.length).toBeGreaterThan(0);
  });

  it('pins every chart font reference that carries a weight', () => {
    const actual = allSites
      .filter((s) => s.weight !== undefined)
      .map(label)
      .sort();
    expect(actual).toEqual([...WEIGHTED_CHART_FONT_SITES].sort());
  });

  it('pins every chart font reference that renders at Regular', () => {
    const actual = allSites
      .filter((s) => s.weight === undefined)
      .map(label)
      .sort();
    expect(actual).toEqual([...WEIGHTLESS_CHART_FONT_SITES].sort());
  });

  it('only ever names a weight synthesis can resolve to a real face', () => {
    // A non-canonical weight (350, 12.5, "300") reaches no sub-family face:
    // `synthesizeFamilyName` falls back to `weight >= 600 → bold`, so the
    // label silently renders Regular or Bold instead.
    const offCanon = allSites.filter(
      (s) => s.weight !== undefined && WEIGHT_LABELS[s.weight as number] == null
    );
    expect(offCanon).toEqual([]);
  });

  it('never names a synthesized sub-family in a chart font key', () => {
    // The weight companion is the supported way to ask for an intermediate
    // face. A sub-family name written into the font key itself still resolves
    // to nothing: `validate-shipped-assets` rejects it and no bytes are staged
    // for LibreOffice.
    const synthetic = allSites.filter((s) => {
      const name = s.family.trim();
      if (isSafeFont(name) || CATALOG.has(name.toLowerCase())) return false;
      const match = SYNTHETIC_FAMILY.exec(name);
      return match !== null && CATALOG.has(match[1].toLowerCase());
    });
    expect(synthetic).toEqual([]);
  });

  it('names only families the font registry can actually resolve', () => {
    const unresolvable = allSites.filter(
      (s) =>
        !isSafeFont(s.family.trim()) &&
        !CATALOG.has(s.family.trim().toLowerCase())
    );
    expect(unresolvable).toEqual([]);
  });
});
