/**
 * The gallery decks, rendered (#455): every deck template the server bundles
 * renders through LibreOffice with no warning-severity rendered finding under
 * the profile it declares, or the pptx default.
 *
 * The six defects this pins were real on the page, in the templates' own
 * faces: a label printed over a title word that LibreOffice kept on the first
 * line, two paragraphs and a label broken over more lines than their boxes
 * hold, a caption wrapped under its photograph, a line set to the very edge
 * of its box.
 *
 * The bar holds only where the host has those faces. A deck set in Space
 * Grotesk and rendered in DejaVu breaks every line somewhere else, and a
 * spill it reports there says nothing about the template. So a render that
 * substituted a family the deck asks for skips its case and names the
 * families; providing the faces to the converter-dependent CI job is #343's.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAdapter } from '../lib/adapters.js';
import { probePreviewDependencies } from '../preview/dependencies.js';
import { renderPreview } from '../preview/render.js';
import { collectRenderedFindings } from '../preview/rendered-findings.js';

const dependencies = await probePreviewDependencies();
const RUN =
  dependencies.libreoffice.available && dependencies.pdftoppm.available;

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../jto/src/client/public/templates'
);
const DECKS = readdirSync(TEMPLATES_DIR)
  .filter((name) => name.endsWith('.pptx.json'))
  .sort();

const rendered = (d: { certainty?: string }) => d.certainty === 'rendered';

describe.skipIf(!RUN)('gallery decks render warning-clean', () => {
  it('found the decks', () => {
    expect(DECKS.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of DECKS) {
    it(`${name} renders with no rendered warning`, async (context) => {
      const document = JSON.parse(
        readFileSync(path.join(TEMPLATES_DIR, name), 'utf8')
      );
      const render = { baseDir: TEMPLATES_DIR };
      const cacheDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'jto-stock-decks-')
      );
      try {
        const preview = await renderPreview({
          format: 'pptx',
          document,
          dpi: 36,
          outputMode: 'path',
          rendered: true,
          render,
          getAdapter,
          cacheDir,
        });
        if (!preview.ok) throw new Error(JSON.stringify(preview.diagnostics));
        const findings = await collectRenderedFindings({
          format: 'pptx',
          document,
          render,
          rendered: preview.rendered!,
          ...(preview.prepared && { prepared: preview.prepared }),
          adapter: getAdapter('pptx'),
        });
        expect(findings.summary, 'the pass ran').toBeDefined();

        const substituted = findings.diagnostics
          .filter(
            (d) =>
              rendered(d) && d.code === 'W_QUALITY_RENDERED_FONT_SUBSTITUTED'
          )
          .map((d) => String(d.evidence?.expected ?? d.message));
        if (substituted.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `${name}: skipped, this host substitutes ${substituted.join(', ')}`
          );
          context.skip();
        }

        const warnings = findings.diagnostics
          .filter((d) => rendered(d) && d.severity === 'warning')
          .map((d) => `${d.code} at ${d.path}: ${d.message}`);
        expect(warnings).toEqual([]);
      } finally {
        await fs.rm(cacheDir, { recursive: true, force: true });
      }
    }, 180_000);
  }
});
