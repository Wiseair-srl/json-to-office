/**
 * Every fix a rule offers has to apply, and has to make its own finding go
 * away (#346).
 *
 * A `fixes` array that does not parse, addresses a pointer that is not there,
 * or repairs half of what the finding described is worse than no fix at all:
 * the MCP surface hands these patches straight to `jto_workspace_patch`, and a
 * fix that leaves the finding standing turns a repair loop into a loop. So
 * this suite applies each finding's patch to a private copy of the document,
 * re-analyzes, and asserts the finding is gone and nothing new is broken.
 *
 * The fixture list is deliberately small and hand-built rather than drawn from
 * the stock templates: reference documents are clean, and a clean document
 * offers no fixes to test.
 */

import { describe, expect, it } from 'vitest';
import type { JsonPatchOperation } from '@json-to-office/quality';
import { createAdapter, type FormatName } from './format-adapter';

/**
 * RFC 6902 `add`, `replace` and `remove`, enough for the operations the rules
 * emit. Deliberately a second implementation rather than a shared helper: the
 * point is that the patches are valid against the standard, not that they
 * survive a round trip through the same code that wrote them.
 */
function applyPatch(
  document: unknown,
  operations: readonly JsonPatchOperation[]
): unknown {
  let root: unknown = structuredClone(document);
  for (const operation of operations) {
    const tokens = operation.path
      .split('/')
      .slice(1)
      .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
    expect(tokens.length, `empty pointer in ${operation.op}`).toBeGreaterThan(
      0
    );

    let parent: unknown = root;
    for (const token of tokens.slice(0, -1)) {
      parent = Array.isArray(parent)
        ? parent[Number(token)]
        : (parent as Record<string, unknown>)?.[token];
      expect(
        parent,
        `${operation.op} ${operation.path}: parent does not exist`
      ).toBeDefined();
    }
    const last = tokens[tokens.length - 1];

    if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : Number(last);
      expect(
        Number.isInteger(index),
        `bad array index in ${operation.path}`
      ).toBe(true);
      if (operation.op === 'remove') parent.splice(index, 1);
      else if (operation.op === 'add') parent.splice(index, 0, operation.value);
      else {
        expect(
          index < parent.length,
          `replace ${operation.path}: index out of range`
        ).toBe(true);
        parent[index] = operation.value;
      }
      continue;
    }

    const record = parent as Record<string, unknown>;
    expect(
      typeof record === 'object' && record !== null,
      `${operation.op} ${operation.path}: parent is not an object`
    ).toBe(true);
    if (operation.op === 'remove') delete record[last];
    else if (operation.op === 'replace') {
      expect(
        last in record,
        `replace ${operation.path}: member does not exist`
      ).toBe(true);
      record[last] = operation.value;
    } else record[last] = operation.value;
  }
  return root;
}

const CANVAS = { slideWidth: 13.333, slideHeight: 7.5 };

interface Fixture {
  id: string;
  format: FormatName;
  /** The code whose fix is under test; the fixture must produce exactly it. */
  code: string;
  document: Record<string, unknown>;
}

const FIXTURES: readonly Fixture[] = [
  {
    id: 'pptx chart without a palette',
    format: 'pptx',
    code: 'W_QUALITY_CHART_SERIES_COLORS',
    document: {
      name: 'pptx',
      props: CANVAS,
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'chart',
              props: {
                type: 'bar',
                x: 1,
                y: 1,
                w: 8,
                h: 4.5,
                valAxisTitle: 'Revenue (€m)',
                data: [
                  { name: 'FY24', labels: ['Q1', 'Q2'], values: [4, 6] },
                  { name: 'FY25', labels: ['Q1', 'Q2'], values: [5, 8] },
                ],
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: 'pptx table with a left-aligned numeric column',
    format: 'pptx',
    code: 'W_QUALITY_TABLE_NUMERIC_ALIGN',
    document: {
      name: 'pptx',
      props: CANVAS,
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'table',
              props: {
                x: 0.5,
                y: 0.5,
                w: 9,
                headerRow: true,
                rows: [
                  ['Segment', 'Revenue'],
                  ['Retail', '12.0'],
                  ['Wholesale', { text: '15.5', bold: true }],
                ],
              },
            },
          ],
        },
      ],
    },
  },
  {
    id: 'docx chart without a palette',
    format: 'docx',
    code: 'W_QUALITY_CHART_SERIES_COLORS',
    document: {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'chart',
          props: {
            type: 'column',
            valAxisTitle: 'Revenue (€m)',
            caption: 'Revenue grew in both segments. Source: internal.',
            data: [
              { name: 'FY24', labels: ['Q1', 'Q2'], values: [4, 6] },
              { name: 'FY25', labels: ['Q1', 'Q2'], values: [5, 8] },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'docx table with a left-aligned numeric column',
    format: 'docx',
    code: 'W_QUALITY_TABLE_NUMERIC_ALIGN',
    document: {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'table',
          props: {
            columns: [
              {
                header: { content: 'Segment' },
                cells: [{ content: 'Retail' }, { content: 'Wholesale' }],
              },
              {
                header: { content: 'Revenue' },
                cells: [
                  { content: '12.0', horizontalAlignment: 'center' },
                  { content: '15.5' },
                ],
              },
            ],
          },
        },
      ],
    },
  },
];

async function analyze(fixture: Fixture, document: unknown) {
  const analysis = await createAdapter(fixture.format).analyzeQuality!(
    document
  );
  return analysis.diagnostics;
}

describe('a rule that offers a fix offers one that works', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.id}: the patch applies and clears the finding`, async () => {
      const before = await analyze(fixture, fixture.document);
      const targets = before.filter((finding) => finding.code === fixture.code);
      expect(
        targets.length,
        `fixture produced no ${fixture.code}`
      ).toBeGreaterThan(0);

      for (const finding of targets) {
        expect(finding.fixes, `${fixture.code} carries no fix`).toBeDefined();
        const patched = applyPatch(fixture.document, finding.fixes!);
        const after = await analyze(fixture, patched);

        expect(
          after
            .filter((entry) => entry.code === fixture.code)
            .map((entry) => entry.path)
        ).not.toContain(finding.path);

        // A repair that trades one defect for another is not a repair.
        const newWarnings = after
          .filter((entry) => entry.severity === 'warning')
          .map((entry) => `${entry.code} at ${entry.path}`)
          .filter(
            (entry) =>
              !before
                .filter((old) => old.severity === 'warning')
                .map((old) => `${old.code} at ${old.path}`)
                .includes(entry)
          );
        expect(newWarnings).toEqual([]);
      }
    });
  }
});
