/**
 * What a `section` does to the document around it.
 *
 * A section is not a block: the layout stage turns it into a real OOXML
 * section, so what is worth checking is what comes out the other side — that
 * its children arrive in order, that a page override reaches the section
 * properties rather than being dropped, and that a section nested in another
 * one flattens away instead of nesting.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIR } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

async function compile(children: unknown[]): Promise<DocxIR> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as unknown as ReportComponentDefinition);
  return compiled.ir;
}

const p = (text: string) => ({ name: 'paragraph', props: { text } });

/** The text of every paragraph in a section, in order. */
function textOf(ir: DocxIR, section = 0): string[] {
  return ir.sections[section].children.flatMap((block) =>
    block.kind === 'paragraph'
      ? [
          block.children
            .map((child) => (child.kind === 'text' ? child.text : ''))
            .join(''),
        ]
      : []
  );
}

describe('components/section', () => {
  it('compiles a section with no children to nothing at all', async () => {
    // A section is a container for content; with none it has nothing to
    // delimit, and an empty OOXML section would still take a page.
    const ir = await compile([{ name: 'section', props: {}, children: [] }]);

    expect(ir.sections).toEqual([]);
  });

  it('carries its children through, in order', async () => {
    const ir = await compile([
      { name: 'section', props: {}, children: [p('First'), p('Second')] },
    ]);

    expect(textOf(ir)).toEqual(['First', 'Second']);
  });

  it('keeps mixed component types in one section', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [
          { name: 'heading', props: { level: 1, text: 'Title' } },
          p('Body'),
          { name: 'list', props: { items: ['One', 'Two'] } },
        ],
      },
    ]);

    expect(textOf(ir)).toEqual(['Title', 'Body', 'One', 'Two']);
  });

  it('flattens a section nested inside another', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [
          p('Outer before'),
          { name: 'section', props: {}, children: [p('Inner')] },
          p('Outer after'),
        ],
      },
    ]);

    // One section, not two: the inner one is content, not a page break.
    expect(ir.sections).toHaveLength(1);
    expect(textOf(ir)).toEqual(['Outer before', 'Inner', 'Outer after']);
  });

  it('gives each top-level section its own OOXML section', async () => {
    const ir = await compile([
      { name: 'section', props: {}, children: [p('One')] },
      { name: 'section', props: {}, children: [p('Two')] },
    ]);

    expect(ir.sections).toHaveLength(2);
    expect(textOf(ir, 0)).toEqual(['One']);
    expect(textOf(ir, 1)).toEqual(['Two']);
  });

  it('applies a named page size and its margins', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {
          page: {
            size: 'LEGAL',
            margins: { top: 720, bottom: 720, left: 1440, right: 1440 },
          },
        },
        children: [p('Legal')],
      },
    ]);

    const { page } = ir.sections[0].properties;
    expect(page.widthTwips).toBe(12240);
    expect(page.heightTwips).toBe(20160);
    expect(page.margins).toEqual(
      expect.objectContaining({
        topTwips: 720,
        bottomTwips: 720,
        leftTwips: 1440,
        rightTwips: 1440,
      })
    );
  });

  it('applies margins on their own, keeping the theme page size', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: { page: { margins: { left: 2880, right: 2880 } } },
        children: [p('Margins only')],
      },
    ]);

    const { page } = ir.sections[0].properties;
    expect(page.margins.leftTwips).toBe(2880);
    expect(page.margins.rightTwips).toBe(2880);
    // A4, from the theme: a margins-only override leaves the paper alone.
    expect(page.widthTwips).toBe(11906);
  });

  it('applies a size on its own, keeping the theme margins', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: { page: { size: 'A3' } },
        children: [p('A3')],
      },
    ]);

    const { page } = ir.sections[0].properties;
    expect(page.widthTwips).toBe(16838);
    expect(page.heightTwips).toBe(23811);
    expect(page.margins.topTwips).toBe(1700);
  });

  it('takes custom dimensions, and gives them no paper code', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: { page: { size: { width: 15000, height: 20000 } } },
        children: [p('Custom')],
      },
    ]);

    const { page } = ir.sections[0].properties;
    expect(page.widthTwips).toBe(15000);
    expect(page.heightTwips).toBe(20000);
    // A custom page is not a standard paper, so no printer code goes with it.
    expect(page.code).toBeUndefined();
  });
});
