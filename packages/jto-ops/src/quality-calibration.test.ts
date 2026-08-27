/**
 * The quality rules, calibrated against the stock templates (#216).
 *
 * The acceptance bar for a design lint is that known-good documents come back
 * clean: a rule that flags the shipped templates trains every consumer to
 * ignore it. Warning-severity findings must therefore be zero across the
 * whole corpus; infos (tight fits, a deliberate 4:3 canvas) are advisory and
 * allowed. A rule change that breaks this suite is mistuned until proven
 * otherwise — fix the threshold, not the template, unless the template is
 * genuinely wrong (that has happened once: `Company deck 4_3` relied on the
 * renderer's silent 4:3 fallback instead of declaring its canvas).
 */

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
