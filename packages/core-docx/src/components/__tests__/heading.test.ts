/**
 * The prop shapes a `heading` has to accept.
 *
 * A catalogue, not a set of behaviour checks: the corpus pins what each of
 * these produces down to the byte. What is left to say here is that every
 * shape compiles to one paragraph carrying the heading style for its level,
 * and that a heading is always a bookmark target — which is what makes it
 * reachable from a table of contents or a cross-reference.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIrBlock } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

async function headingBlocks(
  props: Record<string, unknown>
): Promise<DocxIrBlock[]> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'heading', props }],
  } as unknown as ReportComponentDefinition);
  return compiled.ir.sections[0].children;
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ['level 1', { level: 1, text: 'Main Title' }],
  ['level 2', { level: 2, text: 'Subtitle' }],
  ['level 3', { level: 3, text: 'Section Title' }],
  ['an alignment', { level: 1, text: 'Centered Heading', alignment: 'center' }],
  [
    'run styles at the top level',
    {
      level: 1,
      text: 'Styled Heading',
      bold: false,
      italic: true,
      color: '#0000FF',
    },
  ],
  ['no text at all', { level: 1, text: '' }],
  [
    'a page break before it',
    { level: 1, text: 'New Page Heading', pageBreak: true },
  ],
  [
    'its own spacing',
    {
      level: 2,
      text: 'Heading with Spacing',
      spacing: { before: 480, after: 240 },
    },
  ],
  [
    'numbering turned on',
    { level: 1, text: 'Numbered Heading', numbering: true },
  ],
  [
    'numbering turned off',
    { level: 1, text: 'Unnumbered Heading', numbering: false },
  ],
];

describe('components/heading', () => {
  it.each(CASES)('compiles a heading with %s', async (_name, props) => {
    const blocks = await headingBlocks(props);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('names the heading style for its level', async () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const [block] = await headingBlocks({ level, text: `H${level}` });
      expect(block.kind === 'paragraph' && block.styleId).toBe(
        `Heading${level}`
      );
    }
  });

  it('renders an out-of-range level as level 1', async () => {
    const [block] = await headingBlocks({ level: 9, text: 'Too deep' });
    expect(block.kind === 'paragraph' && block.styleId).toBe('Heading1');
  });

  it('bookmarks every heading, slugging its text when no id is given', async () => {
    const [block] = await headingBlocks({ level: 1, text: 'Main Title' });

    expect(block.kind).toBe('paragraph');
    if (block.kind !== 'paragraph') return;
    expect(block.children[0]).toEqual(
      expect.objectContaining({ kind: 'bookmarkStart', name: 'main-title' })
    );
  });

  it('detaches from numbering explicitly when asked to', async () => {
    const [block] = await headingBlocks({
      level: 1,
      text: 'Unnumbered',
      numbering: false,
    });

    expect(block.kind === 'paragraph' && block.numbering).toEqual({
      none: true,
    });
  });
});
