/**
 * What sits directly under a table.
 *
 * OOXML gives a table no space-after — the property does not exist — so
 * whatever follows one draws hard against its bottom rule unless it brings its
 * own space above. A heading does, from its style. A body paragraph and a list
 * item did not, and both landed on the border.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrBlock, DocxIrParagraph } from '../types';
import type { ReportComponentDefinition } from '../../types';

const TABLE = {
  name: 'table',
  props: {
    columns: [
      { header: { content: 'A' }, cells: [{ content: '1' }] },
      { header: { content: 'B' }, cells: [{ content: '2' }] },
    ],
  },
};

async function blocks(children: unknown[]): Promise<DocxIrBlock[]> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: {},
    children: [{ name: 'section', children }],
  } as unknown as ReportComponentDefinition);
  return compiled.ir.sections[0].children;
}

const paragraphAt = (all: DocxIrBlock[], index: number): DocxIrParagraph => {
  const block = all[index];
  if (block.kind !== 'paragraph') throw new Error('not a paragraph');
  return block;
};

describe('a block directly under a table', () => {
  it('separates a body paragraph from the rule above it', async () => {
    const all = await blocks([
      TABLE,
      { name: 'paragraph', props: { text: 'Straight after.' } },
    ]);

    expect(paragraphAt(all, 1).formatting?.spacing?.beforeTwips).toBe(120);
  });

  it('separates the first item of a list', async () => {
    const all = await blocks([
      TABLE,
      { name: 'list', props: { items: ['First', 'Second'] } },
    ]);

    expect(paragraphAt(all, 1).formatting?.spacing?.beforeTwips).toBe(120);
    // Only the first: the rest are spaced from each other already.
    expect(
      paragraphAt(all, 2).formatting?.spacing?.beforeTwips
    ).toBeUndefined();
  });

  it('leaves a heading to the space its own style carries', async () => {
    const all = await blocks([
      TABLE,
      { name: 'heading', props: { text: 'Section', level: 2 } },
    ]);

    // Stating a smaller value here would make a heading *less* separated than
    // Heading2 already makes it.
    expect(
      paragraphAt(all, 1).formatting?.spacing?.beforeTwips
    ).toBeUndefined();
  });

  it('leaves an author who stated their own space alone', async () => {
    const all = await blocks([
      TABLE,
      {
        name: 'paragraph',
        // Points, as paragraph spacing has always been.
        props: { text: 'Mine.', spacing: { before: 20 } },
      },
    ]);

    expect(paragraphAt(all, 1).formatting?.spacing?.beforeTwips).toBe(400);
  });

  it('says nothing about a paragraph that follows a paragraph', async () => {
    const all = await blocks([
      { name: 'paragraph', props: { text: 'First.' } },
      { name: 'paragraph', props: { text: 'Second.' } },
    ]);

    expect(
      paragraphAt(all, 1).formatting?.spacing?.beforeTwips
    ).toBeUndefined();
  });
});

describe('a list marker stays inside the text margin', () => {
  it('indents level 0 to Word’s own 720/360', async () => {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [{ name: 'list', props: { items: ['One'] } }],
        },
      ],
    } as unknown as ReportComponentDefinition);

    // Every bundled theme used to set `indent: 3`, read as three points, which
    // put the marker at 60 - 360 = -300 twips: outside the page margin, to the
    // left of the body text it labels.
    expect(compiled.ir.numbering[0].levels[0].indent).toEqual({
      leftTwips: 720,
      hangingTwips: 360,
    });
  });

  it('still honours an indent the document asks for', async () => {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [{ name: 'list', props: { items: ['One'], indent: 72 } }],
        },
      ],
    } as unknown as ReportComponentDefinition);

    // Points: 72pt is an inch.
    expect(compiled.ir.numbering[0].levels[0].indent.leftTwips).toBe(1440);
  });
});
