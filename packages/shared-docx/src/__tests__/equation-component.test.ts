/**
 * The `equation` component and the inline `\(…\)` syntax, as the schema and
 * the format-level validators see them.
 *
 * Whether a formula's LaTeX converts is not asked here: that is the
 * renderer's question (`checkDocxFormulas` in core-docx). These tests pin the
 * part that needs no backend — the schema, where formulas are found, and the
 * `office-open` refusal.
 */

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { collectFormulas, inlineMathSpans } from '../math';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { collectDocxRendererErrors } from '../schemas/renderer';
import { validateDocument } from '../validation/unified';

function document(
  children: unknown[],
  renderer?: 'docxjs' | 'office-open'
): Record<string, unknown> {
  return {
    name: 'docx',
    ...(renderer ? { renderer } : {}),
    props: {},
    children: [{ name: 'section', children }],
  };
}

const quadratic = {
  name: 'equation',
  props: { latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' },
};

describe('equation schema', () => {
  const schema = generateUnifiedDocumentSchema();

  it('accepts an equation with alignment and spacing', () => {
    const node = {
      name: 'equation',
      props: { ...quadratic.props, alignment: 'left', spacing: { before: 4 } },
    };
    expect(Value.Check(schema, document([node]))).toBe(true);
    expect(validateDocument(document([node])).errors).toEqual([]);
  });

  it('requires a non-empty latex', () => {
    expect(
      validateDocument(document([{ name: 'equation', props: {} }])).valid
    ).toBe(false);
    expect(
      validateDocument(document([{ name: 'equation', props: { latex: '' } }]))
        .valid
    ).toBe(false);
  });

  it('refuses props it does not declare', () => {
    const node = { name: 'equation', props: { latex: 'x', fontSize: 14 } };
    expect(validateDocument(document([node])).valid).toBe(false);
  });

  it('is flow content, so a column or a text box can hold one', () => {
    const columns = {
      name: 'columns',
      props: { columns: 2 },
      children: [quadratic],
    };
    expect(validateDocument(document([columns])).errors).toEqual([]);
  });
});

describe('inlineMathSpans', () => {
  it('finds each \\(…\\) span with its position', () => {
    const text = 'a \\(x^2\\) b \\(y\\)';
    expect(inlineMathSpans(text)).toEqual([
      { index: 2, length: 7, latex: 'x^2' },
      { index: 12, length: 5, latex: 'y' },
    ]);
  });

  it('leaves dollar signs, and an escaped \\\\(, alone', () => {
    expect(inlineMathSpans('costs $5 and $6')).toEqual([]);
    expect(inlineMathSpans('literal \\\\(x\\\\) here')).toEqual([]);
  });
});

describe('collectFormulas', () => {
  it('finds formulas where math is drawn, at their paths', () => {
    const doc = document([
      quadratic,
      { name: 'paragraph', props: { text: 'mean \\(\\bar{x}\\)' } },
      { name: 'list', props: { items: ['\\(a\\)', { text: '\\(b\\)' }] } },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: '\\(h\\)' },
              cells: [{ content: '\\(c\\)' }],
            },
          ],
        },
      },
      // A heading takes no inline math, so its delimiters are text.
      { name: 'heading', props: { text: '\\(not math\\)', level: 1 } },
    ]);
    expect(
      collectFormulas(doc).map(({ latex, path, kind }) => [latex, path, kind])
    ).toEqual([
      [quadratic.props.latex, '/children/0/children/0/props/latex', 'equation'],
      ['\\bar{x}', '/children/0/children/1/props/text', 'inline'],
      ['a', '/children/0/children/2/props/items/0', 'inline'],
      ['b', '/children/0/children/2/props/items/1/text', 'inline'],
      ['h', '/children/0/children/3/props/columns/0/header/content', 'inline'],
      ['c', '/children/0/children/3/props/columns/0/cells/0/content', 'inline'],
    ]);
  });
});

describe('equations under office-open', () => {
  it('reports nothing under docxjs', () => {
    expect(collectDocxRendererErrors(document([quadratic], 'docxjs'))).toEqual(
      []
    );
  });

  it('refuses every formula under office-open, once per string', () => {
    const doc = document(
      [
        quadratic,
        { name: 'paragraph', props: { text: '\\(a\\) and \\(b\\)' } },
      ],
      'office-open'
    );
    const errors = collectDocxRendererErrors(doc);
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['/children/0/children/0/props/latex', 'unsupported_renderer_feature'],
      ['/children/0/children/1/props/text', 'unsupported_renderer_feature'],
    ]);
    expect(errors[0]!.message).toContain('docxjs');
  });
});
