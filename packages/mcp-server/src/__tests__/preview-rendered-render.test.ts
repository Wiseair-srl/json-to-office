/**
 * The rendered pass over a real LibreOffice PDF (#344): a document mutated
 * to clip must be caught at the authored pointer, and a clean document must
 * come back without rendered integrity findings. Skipped where the
 * converters are absent, like the rest of the preview integration suite.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getAdapter } from '../lib/adapters.js';
import { probePreviewDependencies } from '../preview/dependencies.js';
import { renderPreview } from '../preview/render.js';
import { collectRenderedFindings } from '../preview/rendered-findings.js';

const dependencies = await probePreviewDependencies();
const RUN =
  dependencies.libreoffice.available && dependencies.pdftoppm.available;

const LONG = Array.from(
  { length: 40 },
  (_, i) => `Sentence ${i} keeps going with several more words`
).join('. ');

function report(children: unknown[]) {
  return { name: 'docx', props: {}, children };
}

async function renderWithFindings(document: unknown) {
  const cacheDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'jto-rendered-test-')
  );
  try {
    const rendered = await renderPreview({
      format: 'docx',
      document,
      dpi: 36,
      outputMode: 'path',
      rendered: true,
      getAdapter,
      cacheDir,
    });
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
    expect(rendered.rendered).toBeDefined();
    const findings = await collectRenderedFindings({
      format: 'docx',
      document,
      render: {},
      rendered: rendered.rendered!,
      adapter: getAdapter('docx'),
    });
    return { rendered, findings };
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN)('rendered pass over a LibreOffice PDF', () => {
  it('measures a framed paragraph spilling far past its declared box', async () => {
    const document = report([
      {
        name: 'paragraph',
        props: {
          text: `Framed. ${LONG}`,
          font: { size: 12 },
          floating: {
            width: 4000,
            height: 800,
            horizontalPosition: { offset: 720 },
            verticalPosition: { offset: 14500 },
          },
        },
      },
    ]);
    const { findings } = await renderWithFindings(document);
    const spill = findings.diagnostics.filter(
      (d) => d.code === 'W_QUALITY_RENDERED_SPILL'
    );
    expect(spill).toHaveLength(1);
    expect(spill[0]).toMatchObject({
      certainty: 'rendered',
      path: '/children/0/props/text',
      context: { mapping: 'mapped', page: 1 },
    });
    // Declared 40 pt tall; the renderer let it run down the page.
    expect(spill[0].evidence?.expected).toBe(40);
    expect(spill[0].evidence?.actual as number).toBeGreaterThan(400);
  }, 120_000);

  it('reports a text box the renderer dropped entirely as missing text', async () => {
    const document = report([
      {
        name: 'text-box',
        props: {
          width: 4000,
          height: 800,
          floating: {
            horizontalPosition: { offset: 720 },
            verticalPosition: { offset: 14500 },
          },
        },
        children: [{ name: 'paragraph', props: { text: `Boxed. ${LONG}` } }],
      },
    ]);
    const { findings } = await renderWithFindings(document);
    const codes = findings.diagnostics.map((d) => d.code);
    expect(codes).toContain('W_QUALITY_RENDERED_TEXT_MISSING');
    expect(codes).toContain('W_QUALITY_RENDERED_EMPTY_PAGE');
    const missing = findings.diagnostics.find(
      (d) => d.code === 'W_QUALITY_RENDERED_TEXT_MISSING'
    );
    expect(missing).toMatchObject({
      path: '/children/0/children/0/props/text',
      context: { mapping: 'mapped' },
    });
    expect(findings.summary.inventory.missing).toBe(1);
  }, 120_000);

  it('reports nothing on a clean report, and reuses cached geometry on a re-preview', async () => {
    const document = report([
      { name: 'heading', props: { text: 'Executive summary', level: 1 } },
      {
        name: 'paragraph',
        props: {
          text: 'Revenue grew twelve percent on the back of three new accounts, while operating margin held at the level of the prior year.',
        },
      },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Metric' },
              cells: [{ content: 'Revenue' }, { content: 'Margin' }],
            },
            {
              header: { content: 'FY26' },
              cells: [{ content: '12.4' }, { content: '31.0' }],
            },
          ],
        },
      },
    ]);
    const cacheDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'jto-rendered-test-')
    );
    try {
      const first = await renderPreview({
        format: 'docx',
        document,
        dpi: 36,
        outputMode: 'path',
        rendered: true,
        getAdapter,
        cacheDir,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const findings = await collectRenderedFindings({
        format: 'docx',
        document,
        render: {},
        rendered: first.rendered!,
        adapter: getAdapter('docx'),
      });
      const warnings = findings.diagnostics.filter(
        (d) => d.severity === 'warning'
      );
      expect(warnings).toEqual([]);
      expect(findings.summary.inventory.missing).toBe(0);
      expect(findings.summary.inventory.mapped).toBeGreaterThanOrEqual(7);

      const second = await renderPreview({
        format: 'docx',
        document,
        dpi: 36,
        outputMode: 'path',
        rendered: true,
        getAdapter,
        cacheDir,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.cache.hits).toBe(second.pages.length);
      expect(second.timings.convertMs).toBe(0);
      expect(second.rendered).toEqual(first.rendered);
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }
  }, 180_000);
});
