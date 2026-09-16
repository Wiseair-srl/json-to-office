/**
 * The gallery templates, judged by the quality rules: coverage of what the
 * gallery ships (#216, reduced under #343).
 *
 * These templates used to be the rules' false-positive bar on their own — a
 * hand-kept list of reference-quality documents that had to come back clean
 * under the default profile. That bar is the block matrix now: every
 * supported boundary case of every definition a template embeds must come
 * back warning-clean, statically and rendered (`block-matrix.test.ts`, and
 * `preview-block-matrix.test.ts` in mcp-server), and it covers every theme,
 * canvas and font a definition is supported on rather than the one each
 * template happens to use.
 *
 * What stays here is justified by the gallery itself: every template it ships
 * is a document someone copies, so none may carry a warning-severity finding
 * under its default profile beyond the true findings and illustrative
 * placeholders recorded for it below. The list of templates is the directory,
 * not a curated set, and every allowance is exact: a new finding fails, and so
 * does an allowance that stopped firing.
 *
 * The bar is deliberately not extended to every profile. `executive-presentation`
 * flags most stock templates and is right to: they are reusable layouts, not
 * executive decks. The second suite below therefore checks the opposite
 * property — that naming a profile by id reaches the rules and moves the
 * verdict the way that profile's parameters describe.
 */

import type { QualityAnalysis } from '@json-to-office/quality';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DocxFormatAdapter, PptxFormatAdapter } from './format-adapter';

const TEMPLATES_DIR = path.resolve(
  __dirname,
  '../../jto/src/client/public/templates'
);

/**
 * True findings on a reference template, allowed by path so the bar still bites.
 *
 * `minimalist-pitch-deck` lays several text boxes across the seam of its radial
 * background: sampling the rendered slide at the corners of
 * `/children/3/children/3` returns pure #3C44E3 on the left and pure #F0CDC4 on
 * the right. No single ink clears 4.5:1 over both, so these are not mistuned
 * thresholds and not colour bugs — they are boxes that need moving off the
 * seam, which is a layout change rather than a lint fix. Every other contrast
 * finding in the corpus was repaired by recolouring the run.
 *
 * Listed individually, and subtracted rather than skipped: a new finding on any
 * other path — or on these templates under any other rule — still fails.
 */
const KNOWN_TRUE_FINDINGS: Readonly<Record<string, readonly string[]>> = {
  // Arial, Calibri, Times New Roman and Trebuchet MS in one report (#326).
  // A true finding on a template that predates the rule: four families is a
  // real defect, and the fix is a redesign of the template rather than a
  // threshold. Listed so it cannot grow quietly.
  'standard-annual-report.docx.json': ['W_QUALITY_FONT_COUNT at /props'],
  // Numeric table columns set flush left and rounded two ways, and four
  // families: a starting-point template that predates the table rules (#326).
  'vermilion-annual-report.docx.json': [
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/5/props/columns/1',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/5/props/columns/2',
    'W_QUALITY_TABLE_MIXED_DECIMALS at /children/9/children/5/props/columns/2',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/5/props/columns/3',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/5/props/columns/4',
    'W_QUALITY_TABLE_MIXED_DECIMALS at /children/9/children/5/props/columns/4',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/7/props/columns/1',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/7/props/columns/2',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/7/props/columns/3',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/9/children/7/props/columns/4',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/10/children/17/props/columns/1',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/10/children/17/props/columns/2',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/10/children/17/props/columns/3',
    'W_QUALITY_TABLE_NUMERIC_ALIGN at /children/10/children/17/props/columns/4',
    'W_QUALITY_FONT_COUNT at /props',
  ],
  'minimalist-pitch-deck.pptx.json': [
    'W_QUALITY_TEXT_CONTRAST at /children/0/children/1',
    'W_QUALITY_TEXT_CONTRAST at /children/2/children/3',
    'W_QUALITY_TEXT_CONTRAST at /children/3/children/4',
    'W_QUALITY_TEXT_CONTRAST at /children/3/children/6',
    'W_QUALITY_TEXT_CONTRAST at /children/4/children/9',
    'W_QUALITY_TEXT_CONTRAST at /children/7/children/8',
    'W_QUALITY_TEXT_CONTRAST at /children/8/children/5',
    'W_QUALITY_TEXT_CONTRAST at /children/9/children/22',
    'W_QUALITY_TEXT_CONTRAST at /children/12/children/7',
    'W_QUALITY_TEXT_CONTRAST at /children/12/children/8',
    // Same two boxes as ever on the laptop-mockup slide; the mockup itself
    // became nine native shapes, which moved every later index along by eight.
    // Every slide that carried a template now invokes its chrome block as its
    // first child, which moved those slides' indexes along by one.
    'W_QUALITY_TEXT_CONTRAST at /children/13/children/15',
    'W_QUALITY_TEXT_CONTRAST at /children/13/children/16',
    'W_QUALITY_TEXT_CONTRAST at /children/14/children/12',
    'W_QUALITY_TEXT_CONTRAST at /children/17/children/6',
    'W_QUALITY_TEXT_CONTRAST at /children/17/children/8',
    'W_QUALITY_TEXT_CONTRAST at /children/17/children/9',
    'W_QUALITY_TEXT_CONTRAST at /children/18/children/2',
  ],
};

/**
 * Illustrative placeholders inside the gallery templates (#325).
 *
 * These are true findings, and the rule is right to raise them: the templates
 * are demonstration documents whose body copy is lorem ipsum and whose slots
 * read "Your Subtitle Text Here". Copying one and shipping it unedited is
 * exactly the failure the rule exists to catch, so they are recorded per
 * document rather than suppressed globally — a count, because the paths run to
 * dozens per deck and pinning each one would obscure what is being allowed.
 *
 * The count is exact on purpose: a template that grows a new placeholder, or
 * one that is finally written out in real prose, moves the number and asks for
 * a decision. `W_QUALITY_SCAFFOLD_MARKER` is never allowed here — a shipped
 * template must never carry an unfilled slot.
 */
const ILLUSTRATIVE_PLACEHOLDERS: Readonly<Record<string, number>> = {
  'standard-annual-report.docx.json': 3,
  'tech-report.docx.json': 26,
  'data-report-presentation.pptx.json': 47,
  'management-plan.pptx.json': 53,
  'minimalist-pitch-deck.pptx.json': 42,
  'vermilion-annual-report.docx.json': 50,
};

const files = readdirSync(TEMPLATES_DIR)
  .filter((file) => /\.(docx|pptx)\.json$/.test(file))
  .sort();

describe('gallery templates carry no warning beyond what is recorded for them', () => {
  it('reads the gallery, and records allowances only for templates it ships', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of [
      ...Object.keys(KNOWN_TRUE_FINDINGS),
      ...Object.keys(ILLUSTRATIVE_PLACEHOLDERS),
    ])
      expect(files).toContain(file);
  });

  for (const file of files) {
    it(`${file} carries no warning-severity findings`, async () => {
      const document = JSON.parse(
        readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')
      );
      const adapter = file.endsWith('.pptx.json')
        ? new PptxFormatAdapter()
        : new DocxFormatAdapter();
      const analysis = await adapter.analyzeQuality(document);
      const findings = analysis.diagnostics;

      const allowed = new Set(KNOWN_TRUE_FINDINGS[file] ?? []);
      const placeholders = findings.filter(
        (finding) =>
          finding.severity === 'warning' &&
          finding.code === 'W_QUALITY_PLACEHOLDER_TEXT'
      );
      expect(placeholders).toHaveLength(ILLUSTRATIVE_PLACEHOLDERS[file] ?? 0);
      expect(
        findings.filter(
          (finding) => finding.code === 'W_QUALITY_SCAFFOLD_MARKER'
        )
      ).toEqual([]);

      const warnings = findings
        .filter(
          (finding) =>
            finding.severity === 'warning' &&
            finding.code !== 'W_QUALITY_PLACEHOLDER_TEXT'
        )
        .map((finding) => `${finding.code} at ${finding.path}`);
      expect(warnings.filter((warning) => !allowed.has(warning))).toEqual([]);
      // An allowance that stops firing is stale; drop it rather than let it
      // quietly widen what the bar accepts.
      expect([...allowed].filter((entry) => !warnings.includes(entry))).toEqual(
        []
      );

      for (const finding of findings) {
        expect(['warning', 'info']).toContain(finding.severity);
        expect(finding.code).toMatch(/^W_QUALITY_[A-Z_]+$/);
        expect(finding.path).toMatch(/^(\/[^/]*)*$/);
      }
    });
  }
});

/** Outline skip, bounded geometry: advisory by default, blocking for executives. */
const OUTLINE_SKIP_DOCX = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'Decision', level: 1 } },
    { name: 'heading', props: { text: 'Evidence', level: 3 } },
    { name: 'paragraph', props: { text: 'Supporting detail.' } },
  ],
};

/** 12pt over 90 body words: an ordinary technical slide, an unreadable executive one. */
const COMPACT_SLIDE_PPTX = {
  name: 'pptx',
  props: { theme: 'minimal', slideWidth: 13.333, slideHeight: 7.5 },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        // Titled, so the profile's own title rule has nothing to say and
        // this case stays about the type and density it is named for.
        { name: 'text', props: { text: 'The compact slide', style: 'title' } },
        {
          name: 'text',
          props: {
            text: Array.from({ length: 90 }, (_, i) => `word${i}`).join(' '),
            fontSize: 12,
          },
        },
      ],
    },
  ],
};

function summarize(analysis: QualityAnalysis) {
  return analysis.diagnostics
    .map(({ code, severity }) => `${code}:${severity}`)
    .sort();
}

/**
 * A caller names a shipped profile by id — `{ id, formats }` — and never
 * reconstructs its rules. That request used to reach the engine carrying
 * nothing but the id, so the analysis ran on defaults while stamping the
 * requested `profileId`. These cases fail if that regresses.
 */
describe('shipped profiles are reachable by id', () => {
  it('executive-report promotes the outline rule the general default leaves advisory', async () => {
    const adapter = new DocxFormatAdapter();

    const byDefault = await adapter.analyzeQuality(OUTLINE_SKIP_DOCX);
    expect(summarize(byDefault)).toEqual(['W_QUALITY_HEADING_SKIP:info']);

    const executive = await adapter.analyzeQuality(OUTLINE_SKIP_DOCX, {
      quality: { profile: { id: 'executive-report', formats: ['docx'] } },
    });
    expect(summarize(executive)).toEqual(['W_QUALITY_HEADING_SKIP:warning']);
    expect(executive.profileId).toBe('executive-report');
  });

  it('executive-presentation flags type and density technical-presentation accepts', async () => {
    const adapter = new PptxFormatAdapter();

    const byDefault = await adapter.analyzeQuality(COMPACT_SLIDE_PPTX);
    expect(summarize(byDefault)).toEqual([]);

    const executive = await adapter.analyzeQuality(COMPACT_SLIDE_PPTX, {
      quality: { profile: { id: 'executive-presentation', formats: ['pptx'] } },
    });
    expect(summarize(executive)).toEqual([
      'W_QUALITY_FONT_SIZE_MIN:warning',
      'W_QUALITY_SLIDE_DENSITY:warning',
    ]);
    expect(executive.profileId).toBe('executive-presentation');
  });

  // The remaining profiles ship no rule overrides: they must resolve and stamp
  // their id without silently shifting the baseline verdict.
  for (const [id, format] of [
    ['general', 'docx'],
    ['legal-appendix', 'docx'],
    ['technical-presentation', 'pptx'],
  ] as const) {
    it(`${id} resolves without moving the default verdict`, async () => {
      const adapter =
        format === 'docx' ? new DocxFormatAdapter() : new PptxFormatAdapter();
      const document =
        format === 'docx' ? OUTLINE_SKIP_DOCX : COMPACT_SLIDE_PPTX;

      const byDefault = await adapter.analyzeQuality(document);
      const named = await adapter.analyzeQuality(document, {
        quality: { profile: { id, formats: [format] } },
      });

      expect(summarize(named)).toEqual(summarize(byDefault));
      expect(named.profileId).toBe(id);
    });
  }
});
