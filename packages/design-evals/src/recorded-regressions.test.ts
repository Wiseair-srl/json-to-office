/**
 * The documents that showed two known defects, kept as the inputs that
 * showed them (#408, #420).
 *
 * Both defects were found in generated documents, not constructed ones, and
 * both were diagnosed from the geometry those documents rendered to. So the
 * documents themselves are the regression inputs: they are copied out of the
 * eval run they came from into `src/__fixtures__/regressions` — `evals-out`
 * is not tracked — and each has to keep reproducing what it showed.
 *
 * **#408, the stub last page.** Four of the twenty-four documents in the
 * `checkpoint-after-5` exhibit set closed on a page carrying nothing but the
 * tail of the last paragraph and the notes, 10% to 22% of the body area. The
 * repair was chosen by measuring: every position in the last two sections
 * that can carry a page break was tried on all four, and `pageBreak` on a
 * section was the only move that cleared every one. `keepNext` on the
 * paragraph above the notes — the advice these runs were given — cleared one
 * of the four; placing the notes before the closing prose cleared none.
 * Which of the last two sections takes the break differs per document,
 * because it depends on where the natural break already falls, so each input
 * records its own; that is what the finding's advice says too.
 *
 * **#420, table cells read as never rendered.** Three documents whose
 * numeric and wrapped cells were reported missing from pages that plainly
 * show them, all from reading order: a cell run together with its neighbour
 * across a tight column gap, a figure centred between the two lines of the
 * label beside it, and a numeric row that flowed into the page band and was
 * claimed as the page number. The `jto-ops` unit fixtures pin the geometry;
 * these pin the documents.
 *
 * Skipped where the converters are absent, like every rendering suite here,
 * and where the Highcharts export server is absent, since six of the seven
 * documents draw a chart through it.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  collectRenderedFindings,
  getAdapter,
  renderPreview,
} from '@json-to-office/mcp-server';
import { pdftotextAvailable } from '@json-to-office/jto-ops';

const run = promisify(execFile);
const onPath = async (bin: string, flag: string): Promise<boolean> => {
  try {
    await run(bin, [flag], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
};
const converters =
  ((await onPath('soffice', '--version')) ||
    (await onPath(
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '--version'
    ))) &&
  (await onPath('pdftoppm', '-v')) &&
  (await pdftotextAvailable());
if (process.env.JTO_REQUIRE_LIBREOFFICE === '1' && !converters)
  throw new Error(
    'JTO_REQUIRE_LIBREOFFICE=1 but LibreOffice, pdftoppm or pdftotext was not found.'
  );

/**
 * The chart service, probed the way `jto_info` resolves it. Not covered by
 * `JTO_REQUIRE_LIBREOFFICE`: that flag is about the converters, and CI runs
 * no export server, so a missing one is a skip wherever it happens.
 */
const charts = await (async () => {
  const url =
    process.env.HIGHCHARTS_SERVER_URL?.trim() || 'http://localhost:7801';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
})();

const RUN = converters && charts;

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/regressions'
);

type Rec = Record<string, unknown>;

const document = (name: string): Rec =>
  JSON.parse(readFileSync(path.join(FIXTURES, `${name}.docx.json`), 'utf8'));

async function findings(doc: unknown) {
  const rendered = await renderPreview({
    format: 'docx',
    document: doc,
    dpi: 72,
    outputMode: 'path',
    rendered: true,
    getAdapter,
  });
  if (!rendered.ok || !rendered.rendered)
    throw new Error(
      JSON.stringify((rendered as { diagnostics?: unknown }).diagnostics)
    );
  const result = await collectRenderedFindings({
    format: 'docx',
    document: doc,
    render: {},
    rendered: rendered.rendered,
    adapter: getAdapter('docx'),
  });
  const of = (...codes: string[]) =>
    result.diagnostics.filter((d) => codes.includes(String(d.code)));
  return {
    pages: rendered.rendered.pages.length,
    stub: result.diagnostics.filter(
      (d) =>
        d.context?.kind === 'last-page' || d.context?.kind === 'middle-page'
    ),
    lost: of(
      'W_QUALITY_RENDERED_TEXT_MISSING',
      'W_QUALITY_RENDERED_CLIP',
      'W_QUALITY_RENDERED_EMPTY_PAGE'
    ),
    mapped: result.summary?.inventory.mapped,
  };
}

/** The recorded document, and the section whose page break repairs it. */
const STUBS = [
  { fixture: 'last-page-workforce-1', section: 5, fill: 0.1 },
  { fixture: 'last-page-workforce-3', section: 7, fill: 0.22 },
  { fixture: 'last-page-market-entry-3', section: 3, fill: 0.1 },
  { fixture: 'last-page-post-merger-2', section: 4, fill: 0.21 },
] as const;

/** The recorded document, and the cells it used to report as never rendered. */
const CELLS = [
  {
    fixture: 'table-cells-workforce-3',
    cells: ['0.45', '0.25', '1.05'],
  },
  {
    fixture: 'table-cells-post-merger-2',
    cells: [
      'Go/no-go: fund and launch dispatch migration',
      'Go/no-go: extend migration to remaining depots',
      'Review: confirm trajectory of the EUR 3.3m dependent synergy',
    ],
  },
  {
    fixture: 'table-cells-post-merger-2-before',
    cells: ['20.0', '45.0', '70.0'],
  },
] as const;

describe.skipIf(!RUN)('the stub last page of the exhibit set (#408)', () => {
  it.each(STUBS)(
    '$fixture closes on a stub page that a page break on section $section repairs',
    async ({ fixture, section, fill }) => {
      const before = await findings(document(fixture));
      expect(before.stub).toEqual([
        expect.objectContaining({
          code: 'W_QUALITY_RENDERED_PAGE_UNDERFILLED',
          context: expect.objectContaining({ kind: 'last-page', fill }),
          suggestion: expect.stringMatching(/pageBreak/),
        }),
      ]);

      const repaired = document(fixture);
      const sections = repaired.children as Rec[];
      sections[section].props = {
        ...((sections[section].props as Rec | undefined) ?? {}),
        pageBreak: true,
      };
      const after = await findings(repaired);
      // No stub, on the last page or on the page the break was taken from.
      expect(after.stub).toEqual([]);
      // And nothing was dropped, clipped or left blank to achieve it.
      expect(after.lost).toEqual(before.lost);
      expect(after.mapped).toBe(before.mapped);
      expect(after.pages).toBe(before.pages);
    },
    240_000
  );
});

describe.skipIf(!RUN)('table cells the pass used to lose (#420)', () => {
  it.each(CELLS)(
    '$fixture maps every cell of the table that reported them missing',
    async ({ fixture, cells }) => {
      const result = await findings(document(fixture));
      for (const cell of cells)
        expect(
          result.lost.filter((d) => String(d.message).includes(cell)),
          `${fixture}: ${cell}`
        ).toEqual([]);
      // Nor any other cell of any other table: these documents still carry
      // findings of their own — a running head that repeats the first
      // section's tracker is a rendering defect, not a matching one — and
      // what this pins is that no table cell is among them.
      expect(
        result.lost.filter((d) => /\/(cells|columns)\//.test(String(d.path))),
        `${fixture}: cells`
      ).toEqual([]);
    },
    240_000
  );
});
