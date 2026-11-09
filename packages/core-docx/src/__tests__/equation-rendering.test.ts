/**
 * Equations through the renderers.
 *
 * `docxjs` draws them with docx's own math (`latexToMath` → `Math*`), so the
 * package holds Word's equation markup — `m:oMath` with fractions, radicals
 * and n-ary operators as elements — never the LaTeX source as text.
 * `office-open` does not declare `math`, so a formula there is refused by name
 * before any bytes exist. And whether a formula converts is asked of the
 * renderer, through `checkFormula`, which is what the validators call.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../core/generateFromIr';
import { checkDocxFormulas } from '../core/formulaCheck';
import { generateBufferWithWarnings } from '../core/generator';
import { resolveDocxRenderer } from '../renderers/registry';
import type { ReportComponentDefinition } from '../types';

function document(children: unknown[], renderer?: string) {
  return {
    name: 'docx',
    ...(renderer ? { renderer } : {}),
    props: { theme: 'minimal' },
    children: [{ name: 'section', children }],
  } as unknown as ReportComponentDefinition;
}

const CHILDREN = [
  {
    name: 'paragraph',
    props: {
      text: 'The mean \\(\\bar{x} = \\frac{1}{n}\\sum_{i=1}^n x_i\\) holds.',
    },
  },
  {
    name: 'equation',
    props: { latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}' },
  },
];

async function documentXml(children: unknown[]): Promise<string> {
  const { buffer } = await generateBufferViaIr(document(children), {
    renderer: 'docxjs',
  });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

describe('equations under docxjs', () => {
  it('writes Word equation markup, not LaTeX', async () => {
    const xml = await documentXml(CHILDREN);

    expect(xml.match(/<m:oMath>/g)).toHaveLength(2);
    expect(xml).toContain('<m:f>'); // fractions
    expect(xml).toContain('<m:rad>'); // the square root
    expect(xml).toContain('<m:nary>'); // the sum
    expect(xml).not.toContain('\\frac');
    expect(xml).not.toContain('\\(');
  });

  it('keeps the prose around an inline formula in the same paragraph', async () => {
    const xml = await documentXml([CHILDREN[0]]);
    const paragraph = xml.match(
      /<w:p>(?:(?!<\/w:p>)[\s\S])*<m:oMath>[\s\S]*?<\/w:p>/
    )![0];
    expect(paragraph).toContain('The mean ');
    expect(paragraph).toContain(' holds.');
  });

  it('centres a display equation alone in its paragraph', async () => {
    const xml = await documentXml([CHILDREN[1]]);
    const paragraph = xml.match(/<w:p>[\s\S]*?<m:oMath>[\s\S]*?<\/w:p>/)![0];
    expect(paragraph).toMatch(/<w:jc w:val="center"\/>/);
    expect(paragraph.match(/<w:r>/g) ?? []).toHaveLength(0);
  });
});

describe('equations under office-open', () => {
  it('is refused by name, not written as source text', async () => {
    await expect(
      generateBufferViaIr(document(CHILDREN), { renderer: 'office-open' })
    ).rejects.toThrow(/math/);
  });
});

describe('formula check', () => {
  it('docxjs answers with the converter, and office-open is not asked', async () => {
    const docxjs = await resolveDocxRenderer('docxjs');
    const officeOpen = await resolveDocxRenderer('office-open');

    expect(await docxjs.checkFormula!('\\frac{1}{2}')).toBeUndefined();
    expect(await docxjs.checkFormula!('\\frac{1}{2')).toMatch(/closing }/);
    expect(officeOpen.capabilities.has('math')).toBe(false);
    expect(officeOpen.checkFormula).toBeUndefined();
  });

  it('reports each bad formula at its path', async () => {
    const errors = await checkDocxFormulas(
      document([
        { name: 'paragraph', props: { text: 'ok \\(x\\) bad \\(\\foo\\)' } },
        { name: 'equation', props: { latex: '\\frac{1}{2' } },
      ])
    );
    expect(errors.map((e) => [e.path, e.code, e.value])).toEqual([
      ['/children/0/children/0/props/text', 'invalid_latex', '\\foo'],
      ['/children/0/children/1/props/latex', 'invalid_latex', '\\frac{1}{2'],
    ]);
    expect(errors[0]!.message).toMatch(/unknown command \\foo/);
  });

  it('asks nothing of a renderer that draws no equations', async () => {
    const errors = await checkDocxFormulas(
      document([{ name: 'equation', props: { latex: '\\foo' } }]),
      'office-open'
    );
    expect(errors).toEqual([]);
  });

  it('blocks generation over a formula that will not convert', async () => {
    await expect(
      generateBufferWithWarnings(
        document([{ name: 'equation', props: { latex: '\\foo' } }])
      )
    ).rejects.toMatchObject({
      name: 'JsonValidationError',
      validationErrors: [
        expect.objectContaining({
          path: '/children/0/children/0/props/latex',
          code: 'invalid_latex',
        }),
      ],
    });
  });
});
