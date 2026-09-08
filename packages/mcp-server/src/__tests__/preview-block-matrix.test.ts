/**
 * The block boundary matrix, rendered half (#343, report portion): the
 * boundary documents `@json-to-office/jto-ops` generates from the
 * client-report template — every embedded block at the edges of its slot
 * schema, the whole report at those edges — rendered through LibreOffice
 * and read back by the rendered pass under the `client-report` profile.
 *
 * The bar is the mapping corpus's: no warning-severity rendered finding
 * (spill, clip, overlap, missing text, stranded heading, declared font
 * substitution) and no finding the pass could not map to an authored
 * pointer. Information-level findings are reported in the log and allowed:
 * a widow at the foot of a 24-row table is what the renderer did, not a
 * defect in the block.
 *
 * The default run is the house theme in the design fonts at both edges,
 * the fallback faces at the wide edge, the whole report at the wide edge on
 * every bundled theme, and the report on Letter — some forty renders.
 * `JTO_BLOCK_MATRIX=full` widens it to every theme, font, edge and canvas.
 *
 * The last case is the control: the report with a framed paragraph that
 * cannot fit its frame. A suite that only ever expects silence cannot tell
 * a clean render from a pass that stopped looking, so one injected defect
 * must come back as the warning it is.
 *
 * Skipped where the converters are absent, like the rest of the preview
 * integration suite.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateBlockMatrix,
  pdftotextAvailable,
  type BlockMatrixCase,
} from '@json-to-office/jto-ops';

import { getAdapter } from '../lib/adapters.js';
import { probePreviewDependencies } from '../preview/dependencies.js';
import { renderPreview } from '../preview/render.js';
import { collectRenderedFindings } from '../preview/rendered-findings.js';

const dependencies = await probePreviewDependencies();
const RUN =
  dependencies.libreoffice.available &&
  dependencies.pdftoppm.available &&
  (await pdftotextAvailable());
const FULL = process.env.JTO_BLOCK_MATRIX === 'full';

const TEMPLATE_NAME = 'client-report-blocks.docx.json';
const TEMPLATE = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../jto/src/client/public/templates',
      TEMPLATE_NAME
    ),
    'utf8'
  )
);
const THEMES = ['consulting', 'minimal', 'vermilion', 'devportal'];
/** What the client-report profile requires present; see DOCX_QUALITY_PROFILES. */
const REQUIRED_ROLES = ['takeaway', 'source'];
const QUALITY = {
  profile: { id: 'client-report', formats: ['docx' as const] },
  // The matrix is a boundary document, blocks at their edges one after the
  // other; how full each page ends up is a property of a composed report,
  // not of any block, so the page-fill rule is suppressed here the way an
  // author suppresses it. Its own coverage is in preview-rendered-render.
  policy: {
    suppressions: [
      {
        code: 'W_QUALITY_RENDERED_PAGE_UNDERFILLED',
        reason: 'boundary matrix, not a composed report',
      },
    ],
  },
};

function cases(): BlockMatrixCase[] {
  const shared = { requiredRoles: REQUIRED_ROLES };
  if (FULL)
    return generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      ...shared,
      themes: THEMES,
      canvases: ['A4', 'LETTER'],
    });
  return [
    ...generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      ...shared,
      themes: ['consulting'],
      fonts: ['design'],
      report: false,
    }),
    ...generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      ...shared,
      themes: ['consulting'],
      fonts: ['fallback'],
      edges: ['max'],
      report: false,
    }),
    ...generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      ...shared,
      themes: THEMES,
      fonts: ['design'],
      edges: ['max'],
      blocks: false,
    }),
    ...generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      ...shared,
      themes: ['consulting'],
      fonts: ['fallback'],
      edges: ['min', 'max'],
      canvases: ['LETTER'],
      blocks: false,
    }),
  ];
}

const LONG = Array.from(
  { length: 60 },
  (_, i) => `Sentence ${i} keeps the paragraph going with several more words`
).join('. ');

/** The report at its wide edge with one paragraph that cannot fit its frame. */
function injected(report: BlockMatrixCase): BlockMatrixCase {
  const document = structuredClone(report.document) as {
    children: { children: unknown[] }[];
  };
  document.children[document.children.length - 1].children.push({
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
  });
  return { ...report, id: `${report.id}+framed-spill`, document };
}

async function render(document: unknown) {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-matrix-'));
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
    if (!rendered.rendered || !rendered.prepared)
      throw new Error('no geometry or prepared document');
    const findings = await collectRenderedFindings({
      format: 'docx',
      document,
      render: {},
      rendered: rendered.rendered,
      prepared: rendered.prepared,
      adapter: getAdapter('docx'),
      quality: QUALITY,
    });
    return { findings, pages: rendered.rendered.pages.length };
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
}

const rendered = (d: { certainty?: string }) => d.certainty === 'rendered';

describe.skipIf(!RUN)('rendered block boundary matrix', () => {
  const matrix = cases();
  const rows: string[] = [];

  for (const c of matrix) {
    it(`${c.id} renders warning-clean and fully mapped`, async () => {
      const { findings, pages } = await render(c.document);
      const warnings = findings.diagnostics
        .filter((d) => d.severity === 'warning' && rendered(d))
        .map((d) => `${d.code} at ${d.path}`);
      const infos = findings.diagnostics.filter(
        (d) => d.severity === 'info' && rendered(d)
      );
      rows.push(
        `${c.id}: ${pages} page(s), ${infos.length} info ${[
          ...new Set(infos.map((d) => d.code)),
        ].join(' ')}`
      );
      expect(warnings, JSON.stringify(findings.diagnostics, null, 1)).toEqual(
        []
      );
      expect(findings.summary, 'the pass ran').toBeDefined();
      // A page-level finding (an empty page) has no pointer to map to; a
      // finding about text must name the slot that produced it.
      const unmapped = findings.diagnostics.filter(
        (d) =>
          rendered(d) &&
          d.path !== undefined &&
          (d.context as { mapping?: string } | undefined)?.mapping ===
            'unmapped'
      );
      expect(unmapped.map((d) => `${d.code} at ${d.path}`)).toEqual([]);
      expect(pages).toBeGreaterThan(0);
    }, 180_000);
  }

  it('reports an injected spill as the warning it is', async () => {
    const report = matrix.find(
      (c) =>
        c.block === 'report' && c.edge === 'max' && c.theme === 'consulting'
    );
    expect(report, 'a consulting report at the wide edge').toBeDefined();
    const { findings } = await render(injected(report!).document);
    const codes = [
      ...new Set(
        findings.diagnostics
          .filter((d) => d.severity === 'warning' && rendered(d))
          .map((d) => d.code)
      ),
    ];
    expect(codes).toContain('W_QUALITY_RENDERED_CLIP');
  }, 180_000);

  it('logs what the matrix rendered', () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        `block matrix: ${matrix.length} case(s)${FULL ? ' (full)' : ''}`,
        ...rows,
      ].join('\n')
    );
    // Completeness is each case's own assertion; this one only reports, so
    // running it alone (or after a case that threw) says nothing false.
    expect(matrix.length).toBeGreaterThan(0);
  });
});
