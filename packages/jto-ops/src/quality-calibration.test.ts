/**
 * The quality rules, calibrated against the reference stock templates (#216).
 *
 * The acceptance bar for a design lint is that known-good documents come back
 * clean: a rule that flags reference-quality documents trains every consumer
 * to ignore it. Warning-severity findings must therefore be zero across the
 * reference templates *under the default profile*; infos (tight fits) are
 * advisory and allowed. A rule change that breaks this suite is mistuned
 * until proven otherwise — fix the threshold, not the template, unless the
 * template is genuinely wrong.
 *
 * Only `STOCK_REFERENCE_TEMPLATES` participate. The other playground
 * templates (the legacy 16:9/4:3 decks) are starting points, not quality
 * references — findings on them are acceptable and must never bend a
 * threshold.
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
import { STOCK_REFERENCE_TEMPLATES } from './quality-reference-corpus';

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
  'minimalist-pitch-deck.pptx.json': [
    'W_QUALITY_TEXT_CONTRAST at /children/0/children/1',
    'W_QUALITY_TEXT_CONTRAST at /children/2/children/2',
    'W_QUALITY_TEXT_CONTRAST at /children/3/children/3',
    'W_QUALITY_TEXT_CONTRAST at /children/3/children/5',
    'W_QUALITY_TEXT_CONTRAST at /children/4/children/8',
    'W_QUALITY_TEXT_CONTRAST at /children/7/children/7',
    'W_QUALITY_TEXT_CONTRAST at /children/8/children/4',
    'W_QUALITY_TEXT_CONTRAST at /children/9/children/21',
    'W_QUALITY_TEXT_CONTRAST at /children/12/children/6',
    'W_QUALITY_TEXT_CONTRAST at /children/12/children/7',
    // Same two boxes as ever on the laptop-mockup slide; the mockup itself
    // became nine native shapes, which moved every later index along by eight.
    'W_QUALITY_TEXT_CONTRAST at /children/13/children/14',
    'W_QUALITY_TEXT_CONTRAST at /children/13/children/15',
    'W_QUALITY_TEXT_CONTRAST at /children/14/children/11',
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
};

const files = STOCK_REFERENCE_TEMPLATES;

describe('reference stock templates pass the quality rules clean', () => {
  it('found the corpus', () => {
    const present = new Set(readdirSync(TEMPLATES_DIR));
    expect(files.filter((file) => !present.has(file))).toEqual([]);
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
  it('executive-report promotes the outline rule technical-report leaves advisory', async () => {
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
    ['technical-report', 'docx'],
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
