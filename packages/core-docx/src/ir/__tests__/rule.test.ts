/**
 * The `rule` component: a thin line, drawn the way Word draws one.
 *
 * A paragraph border on an empty paragraph, with the paragraph's own line box
 * collapsed so the rule costs its thickness and its spacing rather than a full
 * line of invisible type. That collapse is the construction #291 caught an
 * author hand-rolling on a paragraph that *did* have text; owning it here is
 * the point of the component.
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

async function rule(props?: Record<string, unknown>) {
  const compiled = await compile([
    props === undefined ? { name: 'rule' } : { name: 'rule', props },
  ]);
  const block = compiled.ir.sections[0].children[0];
  if (block.kind !== 'paragraph') throw new Error('not a paragraph');
  return block as DocxIrParagraph;
}

describe('rule geometry', () => {
  it('draws an empty paragraph wearing a bottom border', async () => {
    const paragraph = await rule();

    expect(paragraph.children).toEqual([]);
    expect(paragraph.formatting?.borders).toEqual({
      bottom: {
        style: 'single',
        sizeEighthPoints: 8,
        color: { hex: 'F0F0F0' },
        spacePoints: 0,
      },
    });
    // No top, left or right: a rule is one line, not a box.
    expect(Object.keys(paragraph.formatting?.borders ?? {})).toEqual([
      'bottom',
    ]);
  });

  it('collapses its own line box', async () => {
    // Without this the rule costs a full line of the style's type — about
    // 11pt of nothing above the line — which is what sends authors looking
    // for the trick themselves.
    expect((await rule()).formatting?.spacing).toEqual({
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
      (await rule({ spacing: { before: 24 } })).formatting?.spacing
    ).toMatchObject({ beforeTwips: 480, afterTwips: 120 });
    expect(
      (await rule({ spacing: { after: 0 } })).formatting?.spacing
    ).toMatchObject({ beforeTwips: 120, afterTwips: 0 });
  });

  it('measures thickness in eighths of a point', async () => {
    expect(
      (await rule({ thickness: 3 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 24 });
    expect(
      (await rule({ thickness: 0.25 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 2 });
  });

  it('clamps a thickness Word could not draw', async () => {
    // The schema states the range; `componentDefaults` can still deliver a
    // value that never passed it, and `w:sz` past 96 eighths is not a border.
    expect(
      (await rule({ thickness: 400 })).formatting?.borders?.bottom
    ).toMatchObject({ sizeEighthPoints: 96 });
    expect(
      (await rule({ thickness: 0 })).formatting?.borders?.bottom
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
        (await rule({ style: authored })).formatting?.borders?.bottom
      ).toMatchObject({ style: val });
    }
  });

  it('resolves a theme colour token', async () => {
    expect(
      (await rule({ color: 'accent' })).formatting?.borders?.bottom
    ).toMatchObject({ color: { hex: '2C3E50' } });
    expect(
      (await rule({ color: '#E6620C' })).formatting?.borders?.bottom
    ).toMatchObject({ color: { hex: 'E6620C' } });
  });
});

describe('rule width', () => {
  // A4 (11906 twips) less the minimal theme's 1080-twip side margins. Pinned
  // rather than re-derived: the point of the number is that the compiler
  // measures the real page, not that it can repeat its own arithmetic.
  const MEASURE_TWIPS = 9746;

  it('runs the full measure with no indent at all', async () => {
    // Stating no indent is what makes the default exact wherever it lands —
    // in a column, in a re-margined section — rather than exact only on a
    // page the compiler happened to measure.
    expect((await rule()).formatting?.indent).toBeUndefined();
    expect((await rule({ width: '100%' })).formatting?.indent).toBeUndefined();
  });

  it('indents the remainder away, on the side alignment names', async () => {
    const half = Math.round(MEASURE_TWIPS / 2);
    expect((await rule({ width: '50%' })).formatting?.indent).toEqual({
      rightTwips: MEASURE_TWIPS - half,
    });
    expect(
      (await rule({ width: '50%', alignment: 'right' })).formatting?.indent
    ).toEqual({ leftTwips: MEASURE_TWIPS - half });

    const centred = (await rule({ width: '50%', alignment: 'center' }))
      .formatting?.indent;
    const remainder = MEASURE_TWIPS - half;
    expect(centred).toEqual({
      leftTwips: Math.round(remainder / 2),
      rightTwips: remainder - Math.round(remainder / 2),
    });
  });

  it('reads a number as points', async () => {
    expect((await rule({ width: 144 })).formatting?.indent).toEqual({
      rightTwips: MEASURE_TWIPS - 2880,
    });
  });

  it('runs the full measure, with a warning, when width overshoots', async () => {
    const warnings: GenerationWarning[] = [];
    await compile([{ name: 'rule', props: { width: 2000 } }], warnings);

    expect((await rule({ width: 2000 })).formatting?.indent).toBeUndefined();
    expect(warnings.map((w) => w.component)).toContain('rule');
    expect(warnings[0].message).toMatch(/wider than the \d+pt text measure/);
  });
});

describe('rule capability', () => {
  it('requires the borders feature, by path', async () => {
    const compiled = await compile([
      { name: 'paragraph', props: { text: 'Above.' } },
      { name: 'rule' },
    ]);
    const borders = compiled.required.filter((r) => r.feature === 'borders');

    expect(borders).toHaveLength(1);
    expect(borders[0].path).toBe('sections[0].children[1]');
  });
});
