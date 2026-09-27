/**
 * A table cell holding a component it cannot render.
 *
 * Validation refuses one (`unsupported_cell_content`), so the compiler meets
 * it only when something went round validation: a plugin's output, a caller
 * that turned it off, a direct IR caller. It keeps painting the grey
 * placeholder — the cell says what it could not render rather than going
 * blank — but never silently any more: every such cell raises a coded
 * warning naming where it is. Three statistics in a KPI row shipped as
 * "[Unsupported component type: statistic]" with no word to the author.
 *
 * These cases stay out of the corpus: every corpus document validates, and
 * this one must not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { unrenderedComponentText } from '@json-to-office/quality';
import type { GenerationWarning } from '@json-to-office/shared';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../core/generateFromIr';
import { generateBufferFromJson } from '../core/generator';
import type { ReportComponentDefinition } from '../types';

const statistic = (number: string, description: string) => ({
  name: 'statistic',
  props: { number, description, alignment: 'center', size: 'large' },
});

/** The KPI row that shipped: three statistics, one per column of a table. */
const kpiTable = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'section',
      props: {},
      children: [
        {
          name: 'table',
          props: {
            hideBorders: true,
            columns: [
              { cells: [{ content: statistic('22', 'Journeys tested') }] },
              { cells: [{ content: statistic('31', 'Issues found') }] },
              { cells: [{ content: 'Plain text' }] },
            ],
          },
        },
      ],
    },
  ],
} as unknown as ReportComponentDefinition;

/** Every text run in a compiled tree. */
function textRuns(node: unknown): { text: string; formatting?: any }[] {
  if (Array.isArray(node)) return node.flatMap(textRuns);
  if (!node || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  const own =
    record.kind === 'text' && typeof record.text === 'string'
      ? [{ text: record.text, formatting: record.formatting }]
      : [];
  return [...own, ...Object.values(record).flatMap(textRuns)];
}

const cellWarnings = (warnings: readonly GenerationWarning[]) =>
  warnings.filter(
    (warning) => warning.context?.code === 'W_UNSUPPORTED_CELL_CONTENT'
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a cell holding a component it cannot render', () => {
  it('paints the placeholder in grey and warns once per cell, naming it', async () => {
    const warnings: GenerationWarning[] = [];
    const { ir } = await compileDocumentToIr(kpiTable, { warnings }, warnings);

    const placeholders = textRuns(ir).filter((run) =>
      run.text.startsWith('[Unsupported')
    );
    expect(placeholders.map((run) => run.text)).toEqual([
      unrenderedComponentText('statistic'),
      unrenderedComponentText('statistic'),
    ]);
    for (const run of placeholders) {
      expect(run.formatting?.color).toEqual({ hex: '999999' });
    }
    // The plain cell renders as itself.
    expect(textRuns(ir).map((run) => run.text)).toContain('Plain text');

    const reported = cellWarnings(warnings);
    expect(reported).toHaveLength(2);
    for (const [index, warning] of reported.entries()) {
      expect(warning).toMatchObject({
        component: 'table',
        severity: 'warning',
        context: { code: 'W_UNSUPPORTED_CELL_CONTENT' },
      });
      expect(warning.message).toContain(
        `sections[0].children[0].rows[0].cells[${index}]`
      );
      expect(warning.message).toContain(
        `shows "${unrenderedComponentText('statistic')}"`
      );
    }
  });

  it('raises nothing for the content a cell does render', async () => {
    const warnings: GenerationWarning[] = [];
    await compileDocumentToIr(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'table',
            props: {
              columns: [
                {
                  cells: [
                    { content: 'text' },
                    { content: { name: 'paragraph', props: { text: 'p' } } },
                  ],
                },
              ],
            },
          },
        ],
      } as unknown as ReportComponentDefinition,
      { warnings },
      warnings
    );
    expect(cellWarnings(warnings)).toEqual([]);
  });

  it.each(['docxjs', 'office-open'] as const)(
    'writes the placeholder run and the warning on %s',
    async (renderer) => {
      const warnings: GenerationWarning[] = [];
      const { buffer } = await generateBufferViaIr(kpiTable, {
        renderer,
        warnings,
      });
      const xml = await (await JSZip.loadAsync(buffer))
        .file('word/document.xml')!
        .async('string');
      expect(xml.split(unrenderedComponentText('statistic')).length - 1).toBe(
        2
      );
      expect(cellWarnings(warnings)).toHaveLength(2);
    }
  );

  it('tells a caller that collects no warnings on the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateBufferViaIr(kpiTable);
    expect(
      warn.mock.calls.filter(([line]) =>
        String(line).includes('W_UNSUPPORTED_CELL_CONTENT')
      )
    ).toHaveLength(2);
  });

  it('is refused before it gets that far when generation validates', async () => {
    await expect(
      generateBufferFromJson(structuredClone(kpiTable) as never)
    ).rejects.toMatchObject({
      name: 'JsonValidationError',
      validationErrors: [
        expect.objectContaining({
          code: 'unsupported_cell_content',
          path: '/children/0/children/0/props/columns/0/cells/0/content',
        }),
        expect.objectContaining({
          code: 'unsupported_cell_content',
          path: '/children/0/children/0/props/columns/1/cells/0/content',
        }),
      ],
    });
  });
});
