/**
 * The `divider` component: a thin line, drawn the way Word draws one.
 *
 * A paragraph border on an empty paragraph, with the paragraph's own line box
 * collapsed so the divider costs its thickness and its spacing rather than a
 * full line of invisible type. That collapse is the construction #291 caught
 * an author hand-rolling on a paragraph that *did* have text; owning it here
 * is the point of the component.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrParagraph } from '../types';
import type { ReportComponentDefinition } from '../../types';
import type { GenerationWarning } from '@json-to-office/shared';

async function compile(
  children: unknown[],
  warnings: GenerationWarning[] = []
) {
  return compileDocumentToIr(
    {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'section', children }],
    } as unknown as ReportComponentDefinition,
    { warnings }
  );
}

async function divider(props?: Record<string, unknown>) {
  const compiled = await compile([
    props === undefined ? { name: 'divider' } : { name: 'divider', props },
  ]);
  const block = compiled.ir.sections[0].children[0];
  if (block.kind !== 'paragraph') throw new Error('not a paragraph');
  return block as DocxIrParagraph;
}

describe('divider geometry', () => {
  it('draws an empty paragraph wearing a bottom border', async () => {
    const paragraph = await divider();

    expect(paragraph.children).toEqual([]);
    expect(paragraph.formatting?.borders).toEqual({
      bottom: {
        style: 'single',
        sizeEighthPoints: 8,
        color: { hex: 'D8D3C8' },
        spacePoints: 0,
      },
    });
    // No top, left or right: a divider is one line, not a box.
    expect(Object.keys(paragraph.formatting?.borders ?? {})).toEqual([
      'bottom',
    ]);
  });

  it('collapses its own line box', async () => {
    // Without this the divider costs a full line of the style's type — about
    // 11pt of nothing above the line — which is what sends authors looking
    // for the trick themselves.
    expect((await divider()).formatting?.spacing).toEqual({
      beforeTwips: 120,
      afterTwips: 120,
      lineTwips: 20,
      lineRule: 'exact',
    });
  });

  it('states both spacing edges even when only one is authored', async () => {
    // Half-authored spacing must not leave the other edge to the style: a
    // separator whose gap above and below disagree reads as a mistake.
    expect(
      (await divider({ spacing: { before: 24 } })).formatting?.spacing
    ).toMatchObject({ beforeTwips: 480, afterTwips: 120 });
    expect(
      (await divider({ spacing: { after: 0 } })).formatting?.spacing
    ).toMatchObject({ beforeTwips: 120, afterTwips: 0 });
  });

  it('measures thickness in eighths of a point', async () => {
    expect(
      (await divider({ thickness: 3 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 24 });
    expect(
      (await divider({ thickness: 0.25 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 2 });
  });

  it('clamps a thickness Word could not draw', async () => {
    // The schema states the range; `componentDefaults` can still deliver a
    // value that never passed it, and `w:sz` past 96 eighths is not a border.
    expect(
      (await divider({ thickness: 400 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 96 });
    expect(
      (await divider({ thickness: 0 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 2 });
  });

  it('translates the authoring style vocabulary into w:val', async () => {
    for (const [authored, val] of [
      ['solid', 'single'],
      ['dashed', 'dashed'],
      ['dotted', 'dotted'],
      ['double', 'double'],
    ] as const) {
      expect(
        (await divider({ style: authored })).formatting?.borders?.bottom
      ).toMatchObject({ style: val });
    }
  });

  it('resolves a theme colour token', async () => {
    expect(
      (await divider({ color: 'accent' })).formatting?.borders?.bottom
    ).toMatchObject({ color: { hex: '6E7F71' } });
    expect(
      (await divider({ color: '#E6620C' })).formatting?.borders?.bottom
    ).toMatchObject({ color: { hex: 'E6620C' } });
  });
});

describe('divider width', () => {
  // A4 (11906 twips) less the minimal theme's 1700-twip side margins. Pinned
  // rather than re-derived: the point of the number is that the compiler
  // measures the real page, not that it can repeat its own arithmetic.
  const MEASURE_TWIPS = 8506;

  it('runs the full measure with no indent at all', async () => {
    // Stating no indent is what makes the default exact wherever it lands —
    // in a column, in a re-margined section — rather than exact only on a
    // page the compiler happened to measure.
    expect((await divider()).formatting?.indent).toBeUndefined();
    expect(
      (await divider({ width: '100%' })).formatting?.indent
    ).toBeUndefined();
  });

  it('indents the remainder away, on the side alignment names', async () => {
    const half = Math.round(MEASURE_TWIPS / 2);
    expect((await divider({ width: '50%' })).formatting?.indent).toEqual({
      rightTwips: MEASURE_TWIPS - half,
    });
    expect(
      (await divider({ width: '50%', alignment: 'right' })).formatting?.indent
    ).toEqual({ leftTwips: MEASURE_TWIPS - half });

    const centred = (await divider({ width: '50%', alignment: 'center' }))
      .formatting?.indent;
    const remainder = MEASURE_TWIPS - half;
    expect(centred).toEqual({
      leftTwips: Math.round(remainder / 2),
      rightTwips: remainder - Math.round(remainder / 2),
    });
  });

  it('reads a number as points', async () => {
    expect((await divider({ width: 144 })).formatting?.indent).toEqual({
      rightTwips: MEASURE_TWIPS - 2880,
    });
  });

  it('runs the full measure, with a warning, when width overshoots', async () => {
    const warnings: GenerationWarning[] = [];
    await compile([{ name: 'divider', props: { width: 2000 } }], warnings);

    expect((await divider({ width: 2000 })).formatting?.indent).toBeUndefined();
    expect(warnings.map((w) => w.component)).toContain('divider');
    expect(warnings[0].message).toMatch(/wider than the \d+pt text measure/);
  });
});

describe('divider capability', () => {
  it('requires the borders feature, by path', async () => {
    const compiled = await compile([
      { name: 'paragraph', props: { text: 'Above.' } },
      { name: 'divider' },
    ]);
    const borders = compiled.required.filter((r) => r.feature === 'borders');

    expect(borders).toHaveLength(1);
    expect(borders[0].path).toBe('sections[0].children[1]');
  });
});
