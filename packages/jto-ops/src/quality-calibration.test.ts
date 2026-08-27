/**
 * The quality rules, calibrated against the stock templates (#216).
 *
 * The acceptance bar for a design lint is that known-good documents come back
 * clean: a rule that flags the shipped templates trains every consumer to
 * ignore it. Warning-severity findings must therefore be zero across the
 * whole corpus *under the default profile*; infos (tight fits, a deliberate
 * 4:3 canvas) are advisory and allowed. A rule change that breaks this suite
 * is mistuned until proven otherwise — fix the threshold, not the template,
 * unless the template is genuinely wrong (that has happened once:
 * `Company deck 4_3` relied on the renderer's silent 4:3 fallback instead of
 * declaring its canvas).
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

const files = readdirSync(TEMPLATES_DIR).filter(
  (file) => file.endsWith('.pptx.json') || file.endsWith('.docx.json')
);

describe('stock templates pass the quality rules clean', () => {
  it('found the corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
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

      const warnings = findings.filter(
        (finding) => finding.severity === 'warning'
      );
      expect(
        warnings.map((finding) => `${finding.code} at ${finding.path}`)
      ).toEqual([]);

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
