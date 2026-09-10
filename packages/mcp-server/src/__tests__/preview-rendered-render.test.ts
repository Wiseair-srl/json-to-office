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

  it('notes a page carrying only its running head and footer as empty', async () => {
    // The trailing page of a report under a running head: the section chrome
    // repeats on it, so the page has words, but none of them are content.
    const document = report([
      {
        name: 'section',
        props: {
          header: [{ name: 'paragraph', props: { text: 'Client report' } }],
          footer: [{ name: 'paragraph', props: { text: 'Page {PAGE}' } }],
        },
        children: [
          {
            name: 'paragraph',
            props: { text: 'Lead paragraph of the report.' },
          },
          { name: 'paragraph', props: { text: ' ', pageBreak: true } },
        ],
      },
    ]);
    const { rendered, findings } = await renderWithFindings(document);
    expect(rendered.totalPages).toBe(2);
    const empty = findings.diagnostics.filter(
      (d) => d.code === 'W_QUALITY_RENDERED_EMPTY_PAGE'
    );
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({
      severity: 'info',
      message: expect.stringMatching(/only its running head or footer/),
      context: { mapping: 'unmapped', page: 2, kind: 'chrome-only' },
    });
    expect(findings.summary?.inventory.missing).toBe(0);

    // The client-report profile owns the promotion to warning: a report's
    // figures live in captioned blocks, so a text-free page is a defect.
    const promoted = await collectRenderedFindings({
      format: 'docx',
      document,
      render: {},
      rendered: rendered.rendered!,
      adapter: getAdapter('docx'),
      quality: { profile: { id: 'client-report' } },
    });
    expect(
      promoted.diagnostics.filter(
        (d) => d.code === 'W_QUALITY_RENDERED_EMPTY_PAGE'
      )
    ).toEqual([expect.objectContaining({ severity: 'warning' })]);
    expect(promoted.summary?.profileId).toBe('client-report');
  }, 120_000);

  it('flags a short section left on its own page under a running head, at that section', async () => {
    const chrome = {
      header: [{ name: 'paragraph', props: { text: 'Client report' } }],
      footer: [{ name: 'paragraph', props: { text: 'Page {PAGE}' } }],
    };
    const section = (children: unknown[]) => ({
      name: 'section',
      props: { ...chrome, pageBreak: true },
      children,
    });
    const document = report([
      section([{ name: 'heading', props: { text: 'Cover', level: 1 } }]),
      section([
        { name: 'heading', props: { text: 'A short section', level: 1 } },
        {
          name: 'paragraph',
          props: { text: 'One paragraph, then a page break.' },
        },
      ]),
      section([
        { name: 'heading', props: { text: 'The end', level: 1 } },
        { name: 'paragraph', props: { text: LONG } },
      ]),
    ]);
    const { rendered, findings } = await renderWithFindings(document);
    expect(rendered.totalPages).toBe(3);
    expect(rendered.rendered?.pages.every((p) => p.ink !== undefined)).toBe(
      true
    );
    const underfilled = findings.diagnostics.filter(
      (d) => d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED'
    );
    expect(underfilled).toEqual([
      expect.objectContaining({
        severity: 'info',
        path: '/children/1',
        context: expect.objectContaining({ mapping: 'mapped', page: 2 }),
      }),
    ]);
    expect(underfilled[0].context?.fill).toBeLessThan(0.5);
    expect(findings.summary?.inventory.missing).toBe(0);
  }, 120_000);

  // #408: a report whose closing section spills a line of prose and its
  // notes onto a page of their own. The finding has to land on the section
  // that closes the document and name the move that repairs it, and the
  // move has to work: `pageBreak` on that section, so the closing argument
  // and its notes share one designed page.
  const NOTES = [
    {
      name: 'divider',
      props: { thickness: 0.5, spacing: { before: 12, after: 4 } },
    },
    {
      name: 'paragraph',
      props: {
        text: 'Notes and sources',
        font: { bold: true },
        keepNext: true,
      },
    },
    {
      name: 'list',
      props: {
        format: 'decimal',
        items: [
          'Internal business case model, September 2026.',
          'Market sizing and competitor share, internal analysis, 2026.',
        ],
      },
    },
  ];
  /** Sixteen sentences of recommendation: two pages of evidence, then a tail. */
  const CLOSE = Array.from(
    { length: 16 },
    (_, i) => `Point ${i} states the recommendation with several more words`
  ).join('. ');
  const closing = (notes: unknown[] = NOTES, tail = CLOSE) =>
    report([
      {
        name: 'section',
        props: {
          header: [{ name: 'paragraph', props: { text: 'Client report' } }],
          footer: [{ name: 'paragraph', props: { text: 'Page {PAGE}' } }],
        },
        children: [
          { name: 'heading', props: { text: 'Evidence', level: 1 } },
          { name: 'paragraph', props: { text: LONG } },
          { name: 'paragraph', props: { text: LONG } },
          { name: 'paragraph', props: { text: LONG } },
        ],
      },
      {
        name: 'section',
        children: [
          { name: 'heading', props: { text: 'Recommendation', level: 1 } },
          { name: 'paragraph', props: { text: tail } },
          ...notes,
        ],
      },
    ]);

  it('lands a stub last page on the closing section and names the page break that repairs it', async () => {
    const { rendered, findings } = await renderWithFindings(closing());
    const stub = findings.diagnostics.filter(
      (d) =>
        d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED' &&
        d.context?.kind === 'last-page'
    );
    expect(stub).toEqual([
      expect.objectContaining({
        path: '/children/1',
        context: expect.objectContaining({ page: rendered.totalPages }),
      }),
    ]);
    expect(stub[0].suggestion).toMatch(/pageBreak/);
    expect(findings.summary?.inventory.missing).toBe(0);
  }, 120_000);

  it('clears the stub when the closing section starts its own page, with every string still mapped', async () => {
    const document = closing() as {
      children: { props?: Record<string, unknown> }[];
    };
    const last = document.children[document.children.length - 1];
    last.props = { ...(last.props ?? {}), pageBreak: true };
    const before = await renderWithFindings(closing());
    const after = await renderWithFindings(document);
    expect(
      before.findings.diagnostics.some((d) => d.context?.kind === 'last-page')
    ).toBe(true);
    expect(
      after.findings.diagnostics.filter(
        (d) => d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED'
      )
    ).toEqual([]);
    // Nothing dropped, nothing clipped, no page left blank.
    expect(after.findings.summary?.inventory.missing).toBe(0);
    expect(
      after.findings.diagnostics.filter(
        (d) =>
          d.code === 'W_QUALITY_RENDERED_EMPTY_PAGE' ||
          d.code === 'W_QUALITY_RENDERED_CLIP'
      )
    ).toEqual([]);
    expect(after.findings.summary?.inventory.mapped).toBe(
      before.findings.summary?.inventory.mapped
    );
  }, 240_000);

  it('leaves a last page that a long notes section legitimately fills alone', async () => {
    // Twenty sources are a page of content, not a stub: the rule measures
    // ink, so a notes-only last page that is full must not be reported.
    const long = [
      NOTES[0],
      NOTES[1],
      {
        name: 'list',
        props: {
          format: 'decimal',
          items: Array.from(
            { length: 26 },
            (_, i) =>
              `Source ${i + 1}: internal analysis of the programme's cost base and delivery plan, 2026.`
          ),
        },
      },
    ];
    const { findings } = await renderWithFindings(
      closing(long, 'A short close.')
    );
    expect(
      findings.diagnostics.filter(
        (d) =>
          d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED' &&
          d.context?.kind === 'last-page'
      )
    ).toEqual([]);
    expect(findings.summary?.inventory.missing).toBe(0);
  }, 120_000);

  it('leaves a short closing paragraph that still shares its page', async () => {
    // The other boundary: a two-line close and two sources, on a page the
    // evidence already fills. Nothing spills, so nothing is a stub.
    const { rendered, findings } = await renderWithFindings(
      closing(NOTES, 'The recommendation is to proceed as set out above.')
    );
    expect(rendered.totalPages).toBe(2);
    expect(
      findings.diagnostics.filter(
        (d) => d.code === 'W_QUALITY_RENDERED_PAGE_UNDERFILLED'
      )
    ).toEqual([]);
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
