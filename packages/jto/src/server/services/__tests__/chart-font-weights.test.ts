import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { isSafeFont, POPULAR_GOOGLE_FONTS } from '@json-to-office/shared';

/**
 * Chart label fonts are a one-way door: they can name a family, never a weight.
 *
 * Run-level `fontFace` reaches `applyFontWeight` → `synthesizeFamilyName`, so
 * `{ fontFace: "Inter", fontWeight: 300 }` renders as the "Inter Light" face.
 * The chart component has no such seam — packages/core-pptx/src/components/
 * chart.ts copies `titleFontFace` / `legendFontFace` / `dataLabelFontFace` /
 * `catAxisLabelFontFace` / `valAxisLabelFontFace` straight into the pptxgenjs
 * options, and `PptxChartPropsSchema` (additionalProperties: false) exposes
 * exactly one weight-ish companion for all five: `dataLabelFontBold`, a
 * boolean. A boolean cannot say 300 or 500.
 *
 * So every entry below renders at Regular, whatever the surrounding deck text
 * does. Six of them used to say "Inter Light" / "Space Grotesk Medium" and lost
 * that weight when the templates stopped hand-authoring synthesized sub-family
 * names; the names cannot be put back, because they resolve to nothing and
 * `scripts/validate-shipped-assets.ts` rejects them.
 *
 * This is the inventory of that unavoidable degradation. It is pinned, not
 * merely counted, so that:
 *   - a template edit that adds a chart font reference has to come here and
 *     acknowledge that its weight will be dropped, and
 *   - a "fix" that smuggles a sub-family name back into a chart font key
 *     (the one place the synthesis seam does not run) fails loudly.
 *
 * The real fix lives outside the templates: give the chart schema a weight
 * companion and run `synthesizeFamilyName` over these props in core-pptx.
 * When that lands, these sites gain a `fontWeight` sibling and this list
 * shrinks.
 */
const WEIGHTLESS_CHART_FONT_SITES = [
  'Alternative deck 16_9.pptx.json :: $.props.templates[6].placeholders[2].defaults.props.dataLabelFontFace :: Inter',
  'Company deck 16_9.pptx.json :: $.props.templates[12].placeholders[5].defaults.props.dataLabelFontFace :: Inter',
  'Company deck 16_9.pptx.json :: $.props.templates[6].placeholders[2].defaults.props.dataLabelFontFace :: Inter',
  'Company deck 4_3.pptx.json :: $.children[6].props.placeholders.chart.props.legendFontFace :: Inter',
  'Company deck 4_3.pptx.json :: $.props.templates[7].placeholders[2].defaults.props.dataLabelFontFace :: Inter',
  'data-report-presentation.pptx.json :: $.children[14].children[0].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[14].children[0].props.valAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[3].children[0].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[4].children[4].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[5].children[4].props.catAxisLabelFontFace :: Space Grotesk',
  'data-report-presentation.pptx.json :: $.children[5].children[4].props.valAxisLabelFontFace :: Space Grotesk',
];

/**
 * Mirror of the chart font keys in `FONT_NAME_KEYS`
 * (packages/shared/src/fonts/collect.ts) minus the run-level `family` /
 * `fontFace`, which do go through the weight synthesis seam.
 */
const CHART_FONT_KEYS = new Set([
  'titleFontFace',
  'legendFontFace',
  'dataLabelFontFace',
  'catAxisLabelFontFace',
  'valAxisLabelFontFace',
]);

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
}

function collectChartFontSites(file: string, json: unknown): ChartFontSite[] {
  const sites: ChartFontSite[] = [];

  const walk = (node: unknown, jsonPath: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${jsonPath}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>
    )) {
      const childPath = `${jsonPath}.${key}`;
      if (typeof value === 'string' && CHART_FONT_KEYS.has(key)) {
        sites.push({ file, jsonPath: childPath, family: value });
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

describe('chart label fonts in bundled templates', () => {
  it('finds chart font references at all (the walk is wired up)', () => {
    expect(allSites.length).toBeGreaterThan(0);
  });

  it('pins every chart font reference that cannot carry its weight', () => {
    const actual = allSites
      .map((s) => `${s.file} :: ${s.jsonPath} :: ${s.family}`)
      .sort();
    expect(actual).toEqual([...WEIGHTLESS_CHART_FONT_SITES].sort());
  });

  it('never names a synthesized sub-family in a chart font key', () => {
    // Chart props bypass `synthesizeFamilyName`, so a sub-family name here is
    // not a stale authoring habit — it is a deliberate attempt to fake a
    // weight. It still resolves to nothing: `validate-shipped-assets` rejects
    // it and no bytes are staged for LibreOffice.
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
