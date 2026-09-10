/**
 * The labeled mapping corpus of the rendered pass (#344, #343 report
 * portion): report-shaped documents rendered through LibreOffice, every
 * authored string labelled with where it should land, and the pass's
 * mapping scored as precision and recall against those labels.
 *
 * The cases are the ones the matching was built to survive: duplicate
 * strings ("Total" in two tables, one sentence twice, a contents page that
 * repeats every heading), ligature-prone words, running chrome around a
 * paragraph that breaks across pages, a family declared with a source that
 * cannot load, a native chart's own titles, a table broken badly across a
 * page, and text whose tail never rendered. Each case also states the
 * warning-level findings the pass must report — and, by omission, the ones
 * it must not.
 *
 * Fully clipped text is covered by unit fixtures rather than here, because
 * LibreOffice has no portable way to produce it: an off-page frame is pulled
 * back onto the page, a frame taller than its text simply grows, a table cell
 * breaks a long word rather than clipping it, and a zero-width column renders
 * its text one character to a line. The one case that does drop text — a
 * bottom-anchored table-based text box — vanishes on macOS and paginates for
 * minutes on Linux, so it cannot be a converter fixture. `truncated-frame`
 * covers the partial clip, which is what LibreOffice does produce.
 *
 * Scoring: an entry is a true positive when the pass maps it and the label
 * says it should, on the page the label names when it names one; a false
 * positive when the pass maps it and the label says otherwise, or to the
 * wrong page; a miss when the label says mapped and the pass did not.
 * Precision ≥ 0.95 and recall ≥ 0.90 are the #344 acceptance targets.
 *
 * Skipped where the converters are absent, like the rest of the preview
 * integration suite.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assignInventory, pdftotextAvailable } from '@json-to-office/jto-ops';

import { getAdapter } from '../lib/adapters.js';
import { probePreviewDependencies } from '../preview/dependencies.js';
import { renderPreview } from '../preview/render.js';
import {
  collectRenderedFindings,
  inventoryFromFacts,
} from '../preview/rendered-findings.js';

const dependencies = await probePreviewDependencies();
const RUN =
  dependencies.libreoffice.available &&
  dependencies.pdftoppm.available &&
  (await pdftotextAvailable());

type Expected = 'mapped' | 'missing' | 'skipped' | 'ambiguous';

interface Label {
  status: Expected;
  /** 1-based page the (first) occurrence must start on, when it matters. */
  page?: number;
  /** The occurrence must start after this 1-based page. */
  afterPage?: number;
}

interface Case {
  id: string;
  document: unknown;
  /** Labels by authored pointer; unlabelled entries are expected `mapped`. */
  labels: Record<string, Label>;
  /** Warning-level rendered codes the pass must report, as a set. */
  warnings: string[];
  /** Information-level rendered codes the pass must report, as a set. */
  infos?: string[];
}

const LONG = Array.from(
  { length: 60 },
  (_, i) => `Sentence ${i} keeps the paragraph going with several more words`
).join('. ');

function report(
  children: unknown[],
  props: Record<string, unknown> = {},
  root: Record<string, unknown> = {}
) {
  return {
    name: 'docx',
    props: { theme: 'minimal', ...props },
    children,
    ...root,
  };
}

const cell = (content: string) => ({ content });
const table = (rows: [string, string][]) => ({
  name: 'table',
  props: {
    columns: [
      { header: cell('Item'), cells: rows.map(([a]) => cell(a)) },
      { header: cell('Value'), cells: rows.map(([, b]) => cell(b)) },
    ],
  },
});

const CASES: Case[] = [
  {
    id: 'duplicates-and-contents',
    document: report([
      { name: 'toc', props: { title: 'Contents', depth: { to: 2 } } },
      { name: 'heading', props: { text: 'Alpha results', level: 1 } },
      { name: 'paragraph', props: { text: 'Revenue grew in the period.' } },
      table([
        ['Total', '120'],
        ['Services', '80'],
      ]),
      { name: 'heading', props: { text: 'Beta outlook', level: 2 } },
      { name: 'paragraph', props: { text: 'Revenue grew in the period.' } },
      table([
        ['Total', '140'],
        ['Services', '90'],
      ]),
      { name: 'heading', props: { text: 'Gamma appendix', level: 3 } },
    ]),
    labels: {
      // The contents page renders both entries in range; the level-3 heading
      // is outside it and its optional entry must not be invented.
      '/children/0': { status: 'mapped', page: 1 },
      '/children/1/props/text': { status: 'mapped', page: 1 },
      '/children/4/props/text': { status: 'mapped', page: 1 },
    },
    warnings: [],
  },
  {
    id: 'ligatures',
    document: report([
      {
        name: 'heading',
        props: { text: 'Efficient office affluence', level: 1 },
      },
      {
        name: 'paragraph',
        props: {
          text: 'The office staff found the fluffy waffle sufficiently affluent and the firefly effortlessly efficient.',
          font: { family: 'Liberation Serif' },
        },
      },
    ]),
    labels: {},
    warnings: [],
  },
  {
    id: 'chrome-around-a-split-paragraph',
    document: report([
      {
        name: 'section',
        props: {
          header: [
            { name: 'paragraph', props: { text: 'Client report 2026' } },
          ],
          footer: [
            {
              name: 'paragraph',
              props: { text: 'Confidential — page {PAGE} of {NUMPAGES}' },
            },
          ],
        },
        children: [
          { name: 'heading', props: { text: 'Introduction', level: 1 } },
          { name: 'paragraph', props: { text: `Opening. ${LONG}` } },
          { name: 'paragraph', props: { text: `Second. ${LONG}` } },
          { name: 'paragraph', props: { text: `Third. ${LONG}` } },
          {
            name: 'paragraph',
            props: { text: 'Closing remark after the break.' },
          },
        ],
      },
    ]),
    labels: {
      '/children/0/props/header/0/props/text': { status: 'mapped' },
      '/children/0/props/footer/0/props/text': { status: 'mapped' },
      // Three long paragraphs push the close several pages in; the label
      // only insists it lands after the first page.
      '/children/0/children/4/props/text': { status: 'mapped', afterPage: 1 },
    },
    warnings: [],
  },
  {
    // A table at the top of a page, its label column wrapping and its
    // figures centred beside the wrap, so each figure sits alone on a row
    // of nothing but digits inside the top fifth — the band where running
    // chrome lives and where a bare number is normally the page number.
    // These are cells; each must keep its own occurrence, and the footer,
    // which is nothing but the page field, must still take its own row.
    id: 'numeric-cells-in-the-chrome-band',
    document: report(
      [
        {
          name: 'section',
          props: {
            footer: [{ name: 'paragraph', props: { text: '{PAGE}' } }],
          },
          children: [
            { name: 'heading', props: { text: 'Cost of the plan', level: 1 } },
            { name: 'paragraph', props: { text: 'Opening line.' } },
            {
              name: 'heading',
              props: { text: 'What the plan costs', level: 2, pageBreak: true },
            },
            {
              name: 'table',
              props: {
                width: 100,
                columns: [
                  {
                    width: '60%',
                    header: cell('Cost item'),
                    cells: [
                      'Retention programme for the target cohort across every region we operate in',
                      'Additional recruiting capacity and tooling for the in-house talent team',
                    ].map(cell),
                  },
                  {
                    width: '40%',
                    header: cell('0.35'),
                    cells: ['0.45', '0.25'].map(cell),
                  },
                ],
              },
            },
          ],
        },
      ],
      // The house theme centres a cell against a wrapped neighbour, which
      // is what leaves a figure alone on its row.
      { theme: 'consulting' }
    ),
    labels: {
      '/children/0/props/footer/0/props/text': { status: 'skipped' },
    },
    warnings: [],
  },
  {
    id: 'declared-font-that-cannot-load',
    document: report(
      [
        {
          name: 'paragraph',
          props: {
            text: 'Set in a family whose file is not there.',
            font: { family: 'Phantom Grotesk' },
          },
        },
      ],
      {
        fontRegistry: [
          {
            id: 'Phantom Grotesk',
            family: 'Phantom Grotesk',
            category: 'sans',
            sources: [
              { kind: 'file', path: 'fonts/phantom-grotesk.otf', weight: 400 },
            ],
          },
        ],
      }
    ),
    labels: {},
    warnings: ['W_QUALITY_RENDERED_FONT_SUBSTITUTED'],
  },
  {
    id: 'native-chart-titles',
    document: report(
      [
        { name: 'heading', props: { text: 'Revenue', level: 1 } },
        {
          name: 'chart',
          props: {
            type: 'bar',
            title: 'Revenue by quarter (EUR m)',
            valAxisTitle: 'EUR m',
            data: [
              {
                name: 'Revenue',
                labels: ['Q1', 'Q2', 'Q3'],
                values: [1, 2, 3],
              },
            ],
            caption: 'Figure 1: quarterly revenue, company data',
          },
        },
      ],
      {},
      { renderer: 'office-open' }
    ),
    labels: {
      '/children/1/props/title': { status: 'mapped', page: 1 },
      '/children/1/props/valAxisTitle': { status: 'mapped', page: 1 },
    },
    warnings: [],
  },
  {
    id: 'table-split-across-a-page',
    // Prose sized so the table starts near the foot of page one and only its
    // first row fits there: the split the rendered pass is meant to name.
    document: report([
      { name: 'heading', props: { text: 'Delivery figures', level: 1 } },
      {
        name: 'paragraph',
        props: {
          text: Array.from(
            { length: 48 },
            (_, i) =>
              `Line ${i} of the run-up prose that fills the page ahead of the table`
          ).join('. '),
        },
      },
      table([
        ['Contracted work delivered', '120'],
        ['Services delivered', '80'],
        ['Licences delivered', '60'],
        ['Support delivered', '40'],
      ]),
    ]),
    labels: {},
    warnings: [],
    // The stub second page is a true finding of its own: one row is all that
    // is on it. Both are listed so neither can vanish unnoticed.
    infos: [
      'W_QUALITY_RENDERED_TABLE_SPLIT',
      'W_QUALITY_RENDERED_PAGE_UNDERFILLED',
    ],
  },
  {
    id: 'truncated-frame',
    document: report([
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
    ]),
    labels: { '/children/0/props/text': { status: 'mapped', page: 1 } },
    warnings: ['W_QUALITY_RENDERED_CLIP'],
  },
];

interface Score {
  tp: number;
  fp: number;
  fn: number;
}

async function runCase(c: Case) {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-corpus-'));
  try {
    const rendered = await renderPreview({
      format: 'docx',
      document: c.document,
      dpi: 36,
      outputMode: 'path',
      rendered: true,
      getAdapter,
      cacheDir,
    });
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
    if (!rendered.rendered || !rendered.prepared) {
      throw new Error('no geometry or prepared document');
    }
    const inventory = inventoryFromFacts('docx', rendered.prepared.facts);
    const { matches } = assignInventory(rendered.rendered.pages, inventory);
    const findings = await collectRenderedFindings({
      format: 'docx',
      document: c.document,
      render: {},
      rendered: rendered.rendered,
      prepared: rendered.prepared,
      adapter: getAdapter('docx'),
    });
    return { matches, findings };
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN)('rendered mapping corpus', () => {
  const total: Score = { tp: 0, fp: 0, fn: 0 };
  const rows: string[] = [];

  for (const c of CASES) {
    it(`maps ${c.id} as labelled and reports only the expected findings`, async () => {
      const { matches, findings } = await runCase(c);
      const score: Score = { tp: 0, fp: 0, fn: 0 };
      const wrong: string[] = [];
      for (const match of matches) {
        const label = c.labels[match.entry.path];
        const expected: Expected =
          label?.status ??
          (match.entry.optional
            ? 'mapped'
            : match.needle.length < 3
              ? 'skipped'
              : 'mapped');
        const page = match.occurrences[0]?.pageIndex;
        const onPage =
          (label?.page === undefined || page === label.page - 1) &&
          (label?.afterPage === undefined ||
            (page !== undefined && page > label.afterPage - 1));
        if (match.status === 'mapped') {
          if (expected === 'mapped' && onPage) score.tp += 1;
          else {
            score.fp += 1;
            wrong.push(
              `${match.entry.path} "${match.entry.text.slice(0, 30)}" mapped to page ${(page ?? -1) + 1}, expected ${expected}${label?.page ? ` on page ${label.page}` : ''}`
            );
          }
        } else if (expected === 'mapped') {
          score.fn += 1;
          wrong.push(
            `${match.entry.path} "${match.entry.text.slice(0, 30)}" ${match.status}, expected mapped`
          );
        }
      }
      total.tp += score.tp;
      total.fp += score.fp;
      total.fn += score.fn;
      rows.push(`${c.id}: tp=${score.tp} fp=${score.fp} fn=${score.fn}`);
      expect(wrong, wrong.join('\n')).toEqual([]);

      // Codes as a set: a truncated frame also clips a word or two at the
      // page edge by a few points, and how many is the renderer's rounding.
      const warnings = [
        ...new Set(
          findings.diagnostics
            .filter(
              (d) => d.severity === 'warning' && d.certainty === 'rendered'
            )
            .map((d) => d.code)
        ),
      ].sort();
      expect(warnings, JSON.stringify(findings.diagnostics, null, 1)).toEqual(
        [...new Set(c.warnings)].sort()
      );
      if (c.infos) {
        const infos = [
          ...new Set(
            findings.diagnostics
              .filter(
                (d) => d.severity === 'info' && d.certainty === 'rendered'
              )
              .map((d) => d.code)
          ),
        ].sort();
        expect(infos, JSON.stringify(findings.diagnostics, null, 1)).toEqual(
          [...new Set(c.infos)].sort()
        );
      }
      expect(findings.summary?.findings.unmapped).toBe(0);
    }, 120_000);
  }

  it('meets the mapping targets over the whole corpus', () => {
    const precision = total.tp / Math.max(1, total.tp + total.fp);
    const recall = total.tp / Math.max(1, total.tp + total.fn);
    // eslint-disable-next-line no-console
    console.log(
      [
        ...rows,
        `corpus: precision ${precision.toFixed(3)} recall ${recall.toFixed(3)} (tp=${total.tp} fp=${total.fp} fn=${total.fn})`,
      ].join('\n')
    );
    expect(total.tp + total.fn).toBeGreaterThan(30);
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});
