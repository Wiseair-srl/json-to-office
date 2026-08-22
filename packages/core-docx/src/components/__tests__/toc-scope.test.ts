/**
 * Section-scoped tables of contents.
 *
 * A TOC at the top of a document lists the whole document; one inside a section
 * lists that section, by restricting its field to the section's bookmark. The
 * scoping is the interesting part, because it depends on where the component
 * sits rather than on what it says — and `scope: 'auto'`, the default, means
 * exactly "wherever I am".
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { resolveTocField } from '../../core/tocField';
import { createMockTheme } from './helpers';
import type { DocxIR, DocxIrTableOfContents } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

async function compile(children: unknown[]): Promise<DocxIR> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as unknown as ReportComponentDefinition);
  return compiled.ir;
}

/** Every TOC field in the document, in order. */
function tocFields(ir: DocxIR): DocxIrTableOfContents[] {
  return ir.sections.flatMap((section) =>
    section.children.filter(
      (block): block is DocxIrTableOfContents => block.kind === 'toc'
    )
  );
}

const heading = (text: string, level = 1) => ({
  name: 'heading',
  props: { level, text },
});

describe('TOC scope', () => {
  it('lists the whole document when it sits at the top level', async () => {
    const ir = await compile([
      { name: 'toc', props: { title: 'Contents', scope: 'auto' } },
      heading('First'),
    ]);

    const [toc] = tocFields(ir);
    expect(toc.bookmarkScope).toBeUndefined();
  });

  it('restricts itself to its own section when it sits inside one', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [
          { name: 'toc', props: { title: 'In section', scope: 'auto' } },
          heading('Inside'),
        ],
      },
    ]);

    const [toc] = tocFields(ir);
    expect(toc.bookmarkScope).toBe('_Section_1');
  });

  it('lists the whole document when a TOC inside a section asks it to', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [
          { name: 'toc', props: { scope: 'document' } },
          heading('Inside'),
        ],
      },
    ]);

    const [toc] = tocFields(ir);
    expect(toc.bookmarkScope).toBeUndefined();
  });

  it('falls back to document scope, and says so, with no section to scope to', () => {
    const field = resolveTocField({ scope: 'section' }, createMockTheme(), {});

    expect(field.bookmarkScope).toBeUndefined();
    expect(field.warnings.join(' ')).toContain(
      'Falling back to document scope'
    );
  });

  it('gives each section its own bookmark, so two TOCs differ', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [{ name: 'toc', props: {} }, heading('One')],
      },
      {
        name: 'section',
        props: {},
        children: [{ name: 'toc', props: {} }, heading('Two')],
      },
    ]);

    const [first, second] = tocFields(ir);
    expect(first.bookmarkScope).toBe('_Section_1');
    expect(second.bookmarkScope).toBe('_Section_2');
  });

  it('scopes two TOCs in one section to the same bookmark', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [
          { name: 'toc', props: { title: 'Short' } },
          { name: 'toc', props: { title: 'Full', depth: { to: 6 } } },
          heading('One'),
        ],
      },
    ]);

    const [first, second] = tocFields(ir);
    expect(first.bookmarkScope).toBe(second.bookmarkScope);
  });

  it('caches only the entries its section holds', async () => {
    const ir = await compile([
      {
        name: 'section',
        props: {},
        children: [{ name: 'toc', props: {} }, heading('Mine')],
      },
      { name: 'section', props: {}, children: [heading('Theirs')] },
    ]);

    const [toc] = tocFields(ir);
    expect(toc.cachedEntries?.map((entry) => entry.text)).toEqual(['Mine']);
  });

  it('takes the depth range it was given', async () => {
    for (const depth of [{ to: 1 }, { to: 3 }, { from: 2, to: 4 }]) {
      const ir = await compile([
        { name: 'toc', props: { depth } },
        heading('H'),
      ]);

      const [toc] = tocFields(ir);
      expect(toc.headingRange).toEqual({
        from: depth.from ?? 1,
        to: depth.to,
      });
    }
  });

  it('adds a title paragraph only when one is given', async () => {
    const withTitle = await compile([
      { name: 'toc', props: { title: 'Contents' } },
    ]);
    const without = await compile([{ name: 'toc', props: {} }]);

    expect(withTitle.sections[0].children).toHaveLength(2);
    expect(without.sections[0].children).toHaveLength(1);
  });

  it('gives the TOC title no style at all', async () => {
    // Not even Normal: a title with an outline level would collect itself into
    // the very list it introduces. It carries its own bold and size instead.
    const ir = await compile([{ name: 'toc', props: { title: 'Contents' } }]);

    const [title] = ir.sections[0].children;
    expect(title.kind).toBe('paragraph');
    if (title.kind !== 'paragraph') return;
    expect(title.styleId).toBeUndefined();
    expect(title.children[0]).toEqual(
      expect.objectContaining({
        formatting: { bold: true, sizeHalfPoints: 28 },
      })
    );
  });

  it('names the field after its title, or after nothing in particular', async () => {
    const named = await compile([
      { name: 'toc', props: { title: 'Contents' } },
    ]);
    const unnamed = await compile([{ name: 'toc', props: {} }]);

    expect(tocFields(named)[0].alias).toBe('Contents');
    expect(tocFields(unnamed)[0].alias).toBe('Table of Contents');
  });

  it('bookmarks a section even when it holds nothing but a TOC', async () => {
    const ir = await compile([
      { name: 'section', props: {}, children: [{ name: 'toc', props: {} }] },
    ]);

    expect(ir.sections[0].bookmark?.name).toBe('_Section_1');
  });
});
