/**
 * Equations in DocxIR: the `equation` component and inline `\(…\)` formulas.
 *
 * The IR carries each formula as the LaTeX the author wrote, in a `math` run,
 * and records the `math` feature wherever one appears — the conversion is the
 * renderer's. What the compiler owns is where formulas are cut out of text,
 * and that nothing in the LaTeX is mistaken for the text's own markup.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrInline, DocxIrParagraph } from '../types';
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

async function firstParagraph(node: unknown): Promise<DocxIrParagraph> {
  const compiled = await compile([node]);
  const block = compiled.ir.sections[0].children[0];
  if (block.kind !== 'paragraph') throw new Error('not a paragraph');
  return block;
}

/** The runs, reduced to what a reader would see. */
function shape(runs: DocxIrInline[]): string[] {
  return runs.map((run) =>
    run.kind === 'math'
      ? `math:${run.latex}`
      : run.kind === 'text'
        ? `${run.formatting?.bold ? 'b:' : ''}${run.text}`
        : run.kind
  );
}

describe('equation component', () => {
  it('compiles to a centred paragraph holding one math run', async () => {
    const paragraph = await firstParagraph({
      name: 'equation',
      props: { latex: 'E = mc^2' },
    });

    expect(paragraph.children).toEqual([{ kind: 'math', latex: 'E = mc^2' }]);
    expect(paragraph.formatting?.alignment).toBe('center');
    // 6pt either side unless the author says otherwise.
    expect(paragraph.formatting?.spacing).toEqual({
      beforeTwips: 120,
      afterTwips: 120,
    });
  });

  it('takes alignment and spacing from its props', async () => {
    const paragraph = await firstParagraph({
      name: 'equation',
      props: {
        latex: 'x',
        alignment: 'left',
        spacing: { before: 0, after: 12 },
      },
    });

    expect(paragraph.formatting?.alignment).toBe('left');
    expect(paragraph.formatting?.spacing).toEqual({
      beforeTwips: 0,
      afterTwips: 240,
    });
  });

  it('requires the math feature at its path', async () => {
    const compiled = await compile([
      { name: 'equation', props: { latex: 'x' } },
    ]);
    expect(
      compiled.required.filter((r) => r.feature === 'math').map((r) => r.path)
    ).toEqual(['sections[0].children[0]']);
  });

  it('leaves out an equation with no LaTeX, and says so', async () => {
    const warnings: GenerationWarning[] = [];
    const compiled = await compile(
      [{ name: 'equation', props: { latex: '  ' } }],
      warnings
    );
    expect(compiled.ir.sections[0].children).toEqual([]);
    expect(warnings.map((w) => w.component)).toContain('equation');
  });
});

describe('inline formulas', () => {
  it('cuts each \\(…\\) out of a paragraph as a math run', async () => {
    const paragraph = await firstParagraph({
      name: 'paragraph',
      props: { text: 'mean \\(\\bar{x}\\) of **the data**' },
    });
    expect(shape(paragraph.children)).toEqual([
      'mean ',
      'math:\\bar{x}',
      ' of ',
      'b:the data',
    ]);
  });

  it('keeps LaTeX away from the text markup', async () => {
    // `_`, `*` and `{…}` are emphasis and placeholders in prose; inside a
    // formula they are subscripts, products and groups, and stay so.
    const compiled = await compile([
      {
        name: 'paragraph',
        props: { text: 'see \\(x_{i} * y_{j}\\) and \\(\\frac{a}{b}\\)' },
      },
    ]);
    const block = compiled.ir.sections[0].children[0] as DocxIrParagraph;
    expect(shape(block.children)).toEqual([
      'see ',
      'math:x_{i} * y_{j}',
      ' and ',
      'math:\\frac{a}{b}',
    ]);
    // A formula's braces are not a `{PLACEHOLDER}`, so no field is asked for.
    expect(compiled.required.map((r) => r.feature)).not.toContain('fields');
    expect(compiled.required.map((r) => r.feature)).toContain('math');
  });

  it('leaves prices and other text without \\( alone', async () => {
    const compiled = await compile([
      { name: 'paragraph', props: { text: 'From $5 to $6.' } },
    ]);
    const block = compiled.ir.sections[0].children[0] as DocxIrParagraph;
    expect(shape(block.children)).toEqual(['From $5 to $6.']);
    expect(compiled.required.map((r) => r.feature)).not.toContain('math');
  });

  it('drops an empty \\(\\), which the formula check reports', async () => {
    const paragraph = await firstParagraph({
      name: 'paragraph',
      props: { text: 'a \\(\\) b' },
    });
    expect(shape(paragraph.children)).toEqual(['a ', ' b']);
  });

  it('reads formulas in list items and table cells', async () => {
    const compiled = await compile([
      { name: 'list', props: { items: ['density \\(\\rho\\)'] } },
      {
        name: 'table',
        props: {
          columns: [{ cells: [{ content: '\\(\\mathrm{PM}_{2.5}\\)' }] }],
        },
      },
    ]);
    const runs = JSON.stringify(compiled.ir.sections[0].children);
    expect(runs).toContain('{"kind":"math","latex":"\\\\rho"}');
    expect(runs).toContain('{"kind":"math","latex":"\\\\mathrm{PM}_{2.5}"}');
  });

  it('leaves the delimiters as text where math is not drawn', async () => {
    const paragraph = await firstParagraph({
      name: 'heading',
      props: { text: 'About \\(x\\)', level: 1 },
    });
    expect(paragraph.children.some((run) => run.kind === 'math')).toBe(false);
  });
});
