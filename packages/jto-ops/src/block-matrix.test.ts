/**
 * The block boundary matrix, static half (#343, report portion).
 *
 * Every definition the client-report template embeds, at both edges of its
 * slot schema, on every bundled DOCX theme, in the design fonts and in the
 * fallback faces, on A4 and Letter, under the `client-report` profile: no
 * warning-severity finding, no scaffold marker, no placeholder, and a
 * document the block validator accepts. A block that ships with a budget
 * its own composition cannot hold at the theme's sizes fails here, before
 * LibreOffice is asked; the rendered half lives beside the preview
 * integration suite in `mcp-server`, where the converters are.
 *
 * The second half checks the opposite: a slot one past its budget, an array
 * one past its bound and a definition that names a missing dependency are
 * reported as coded issues at the authored pointer. Those are expected
 * diagnostics, not matrix cases, and they keep the clean half honest — a
 * suite that only ever expects silence cannot tell a rule from its absence.
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCX_QUALITY_PROFILES, themes } from '@json-to-office/core-docx';
import {
  readBlockDefinitions,
  validateBlockInvocations,
  type BlockSlot,
} from '@json-to-office/shared';
import {
  blockCaseDocument,
  boundaryInvocation,
  boundarySlotValue,
  enumerateBlockDefinitions,
  generateBlockMatrix,
  overBudgetInvocation,
  widestNumber,
  type BlockMatrixCase,
} from './block-matrix';
import { DocxFormatAdapter } from './format-adapter';

const TEMPLATE_NAME = 'client-report-blocks.docx.json';
const TEMPLATE = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      '../../jto/src/client/public/templates',
      TEMPLATE_NAME
    ),
    'utf8'
  )
);
const PROFILE = {
  quality: { profile: { id: 'client-report', formats: ['docx'] } },
} as const;
const THEMES = Object.keys(themes);
/** The roles the profile requires present: what `min` may not leave out. */
const REQUIRED_ROLES = (
  DOCX_QUALITY_PROFILES['client-report'].rules['docx/required-chrome']
    .parameters as { required: string[] }
).required;

const adapter = new DocxFormatAdapter();

async function analyze(document: unknown) {
  const analysis = await adapter.analyzeQuality(document, PROFILE);
  return {
    analysis,
    warnings: analysis.diagnostics
      .filter((d) => d.severity === 'warning')
      .map((d) => `${d.code} at ${d.path}`),
    blocking: analysis.diagnostics
      .filter((d) =>
        ['W_QUALITY_SCAFFOLD_MARKER', 'W_QUALITY_PLACEHOLDER_TEXT'].includes(
          d.code
        )
      )
      .map((d) => `${d.code} at ${d.path}`),
  };
}

describe('the generator', () => {
  it('enumerates every definition the template embeds, with where it lives', () => {
    const entries = enumerateBlockDefinitions(TEMPLATE, TEMPLATE_NAME);
    expect(entries.map((e) => e.name).sort()).toEqual(
      Object.keys(TEMPLATE.props.blocks).sort()
    );
    for (const entry of entries) {
      expect(entry.template).toBe(TEMPLATE_NAME);
      expect(entry.pointer).toBe(`/props/blocks/${entry.name}`);
    }
    // The template invokes every block it defines but the two the others
    // compose from; those still get a case, from their schema alone.
    const withoutExample = entries.filter((e) => !e.example).map((e) => e.name);
    expect(withoutExample.sort()).toEqual(['figure-caption', 'source-line']);
  });

  it('fills a string to its word budget and a figure to its width', () => {
    const budget: BlockSlot = { type: 'string', maxWords: 8, oneLine: true };
    expect(
      String(boundarySlotValue(budget, 'title', 'max')).split(' ')
    ).toHaveLength(8);
    expect(
      String(boundarySlotValue(budget, 'title', 'min')).split(' ').length
    ).toBeLessThanOrEqual(2);
    expect(widestNumber(12)).toBe('−1,234,567.0');
    expect(widestNumber(12)).toHaveLength(12);
    expect(widestNumber(16)).toHaveLength(16);
    expect(widestNumber(3)).toHaveLength(3);
    const value: BlockSlot = { type: 'string', maxLength: 12 };
    expect(String(boundarySlotValue(value, 'value', 'max'))).toHaveLength(12);
  });

  it('holds min and max cardinality, and counts table cells by the rows', () => {
    const definition = TEMPLATE.props.blocks['data-table'];
    const max = boundaryInvocation('data-table', definition, 'max');
    const min = boundaryInvocation('data-table', definition, 'min');
    const slots = (inv: Record<string, unknown>) =>
      (inv.props as Record<string, unknown>).slots as Record<string, unknown[]>;
    expect(slots(max).labels).toHaveLength(definition.slots.labels.maxItems);
    expect(slots(max).columns).toHaveLength(definition.slots.columns.maxItems);
    for (const column of slots(max).columns as { cells: unknown[] }[])
      expect(column.cells).toHaveLength(24);
    expect(slots(min).labels).toHaveLength(1);
    expect(slots(min).columns).toHaveLength(1);
    expect(slots(min)).not.toHaveProperty('notes');
    expect(slots(min)).not.toHaveProperty('source');
  });

  it('spans themes, fonts, edges and canvases without a list of blocks', () => {
    const cases = generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
      themes: ['consulting'],
      canvases: ['A4', 'LETTER'],
    });
    const blocks = Object.keys(TEMPLATE.props.blocks).length;
    expect(cases).toHaveLength((blocks + 1) * 2 * 2 * 2);
    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(cases.length);
    const letter = cases.find(
      (c) => c.canvas === 'LETTER' && c.block === 'report'
    )!;
    for (const section of letter.document.children as {
      props?: { page?: unknown };
    }[])
      expect(section.props?.page).toEqual({ size: 'LETTER' });
    const fallback = cases.find((c) => c.font === 'fallback')!;
    expect(
      (fallback.document.props as { themeOverrides?: unknown }).themeOverrides
    ).toMatchObject({
      fonts: { body: { family: 'DejaVu Sans' } },
    });
  });
});

const MATRIX = generateBlockMatrix(TEMPLATE, TEMPLATE_NAME, {
  themes: THEMES,
  canvases: ['A4', 'LETTER'],
  requiredRoles: REQUIRED_ROLES,
});

describe('every boundary case is warning-clean under client-report', () => {
  it('covers every bundled theme', () => {
    expect(THEMES).toEqual(
      expect.arrayContaining([
        'consulting',
        'minimal',
        'vermilion',
        'devportal',
      ])
    );
  });

  const byTheme = new Map<string, BlockMatrixCase[]>();
  for (const c of MATRIX)
    byTheme.set(c.theme, [...(byTheme.get(c.theme) ?? []), c]);

  for (const [theme, cases] of byTheme) {
    it(`${theme}: ${cases.length} cases`, async () => {
      const failures: string[] = [];
      for (const c of cases) {
        const definitions = readBlockDefinitions(c.document);
        const issues = validateBlockInvocations(
          c.document,
          definitions,
          'docx'
        );
        for (const issue of issues)
          failures.push(`${c.id}: ${issue.code} at ${issue.path}`);
        const { analysis, warnings, blocking } = await analyze(c.document);
        // A document the engine could not prepare reports nothing, and
        // nothing is not clean.
        for (const error of analysis.ruleErrors ?? [])
          failures.push(`${c.id}: ${error.ruleId}: ${error.message}`);
        if (analysis.profileId !== 'client-report')
          failures.push(`${c.id}: profile ${analysis.profileId}`);
        for (const w of [...warnings, ...blocking])
          failures.push(`${c.id}: ${w}`);
      }
      expect(failures).toEqual([]);
    }, 120_000);
  }
});

describe('a step past the boundary is a coded issue at the authored slot', () => {
  const entries = enumerateBlockDefinitions(TEMPLATE, TEMPLATE_NAME);

  for (const entry of entries) {
    const over = overBudgetInvocation(entry.name, entry.definition);
    if (!over) continue;
    it(`${entry.name}: ${over.slot} one ${over.kind === 'words' ? 'word' : 'item'} over`, async () => {
      const document = blockCaseDocument(
        entries,
        entry.name,
        'max',
        'consulting'
      );
      // Replace the block under test with its over-budget twin.
      const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(walk);
        if (typeof node !== 'object' || node === null) return node;
        const rec = node as Record<string, unknown>;
        const props = rec.props as Record<string, unknown> | undefined;
        if (rec.name === 'block' && props?.ref === entry.name)
          return over.invocation;
        return Array.isArray(rec.children)
          ? { ...rec, children: walk(rec.children) }
          : rec;
      };
      const broken = {
        ...document,
        children: walk(document.children),
      } as Record<string, unknown>;
      const slotPath = new RegExp(`/props/slots/${over.slot}(?![\\w-])`);
      const issues = validateBlockInvocations(
        broken,
        readBlockDefinitions(broken),
        'docx'
      );
      expect(issues.map((i) => `${i.code} ${i.path}`).join('\n')).toMatch(
        slotPath
      );
      // The engine refuses to prepare it, naming the same pointer: a
      // document past a budget never reaches the rules half-analysed.
      const { analysis } = await analyze(broken);
      expect(
        (analysis.ruleErrors ?? []).map((e) => e.message).join('\n')
      ).toMatch(slotPath);
    });
  }

  it('a definition that composes from a block the document lacks', async () => {
    const document = blockCaseDocument(entries, 'kpi-row', 'max', 'consulting');
    const blocks = (document.props as { blocks: Record<string, unknown> })
      .blocks;
    expect(blocks).toHaveProperty('source-line');
    delete blocks['source-line'];
    const { analysis } = await analyze(document);
    expect(
      (analysis.ruleErrors ?? []).map((e) => e.message).join('\n')
    ).toMatch(/source-line/);
  });
});
