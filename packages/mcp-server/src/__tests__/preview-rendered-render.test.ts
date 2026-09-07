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
  it('reports a framed paragraph cut off at the page foot as truncated, at its pointer', async () => {
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
    const codes = findings.diagnostics.map((d) => d.code);
    const clip = findings.diagnostics.filter(
      (d) => d.code === 'W_QUALITY_RENDERED_CLIP'
    );
    // Two clips, both the paragraph's: its head rendered and the tail did
    // not (truncated), and a word at the frame's top sits past the page edge.
    expect(clip.length, codes.join(',')).toBeGreaterThanOrEqual(1);
    for (const finding of clip) {
      expect(finding).toMatchObject({
        certainty: 'rendered',
        path: '/children/0/props/text',
        context: { mapping: 'mapped', page: 1 },
      });
    }
    const truncated = clip.find((d) => d.context?.kind === 'truncated');
    expect(truncated).toBeDefined();
    expect(truncated?.evidence?.actual as number).toBeLessThan(100);
    expect(codes).not.toContain('W_QUALITY_RENDERED_SPILL');
  }, 120_000);

  it('notes a page with nothing on it as information, at no pointer', async () => {
    // A trailing empty paragraph forced onto its own page. LibreOffice lays
    // a stray break out the same way on every platform, unlike the
    // pathological text boxes that vanish on one and paginate on another.
    const document = report([
      { name: 'paragraph', props: { text: 'Lead paragraph of the report.' } },
      { name: 'paragraph', props: { text: ' ', pageBreak: true } },
    ]);
    const { rendered, findings } = await renderWithFindings(document);
    expect(rendered.totalPages).toBe(2);
    const empty = findings.diagnostics.filter(
      (d) => d.code === 'W_QUALITY_RENDERED_EMPTY_PAGE'
    );
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({
      severity: 'info',
      context: { mapping: 'unmapped', page: 2 },
    });
    expect(empty[0]).not.toHaveProperty('path');
    expect(findings.summary?.inventory.missing).toBe(0);
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
