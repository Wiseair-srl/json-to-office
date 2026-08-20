/**
 * A TOC field carries cached entries so readers that never refresh fields —
 * headless LibreOffice, and therefore our PDF path — show real content instead
 * of just the TOC title.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { collectTocHeadings } from '../core/collectTocHeadings';
import type { SectionLayout } from '../core/layout';

async function documentXml(children: unknown[]): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

/**
 * The field body: everything between the `separate` and `end` field chars.
 *
 * This is where a reader that does not refresh fields takes its content from,
 * so it is the region the entries have to land in.
 */
function cachedFieldBody(xml: string): string {
  const separate = xml.indexOf('<w:fldChar w:fldCharType="separate"/>');
  const end = xml.indexOf('<w:fldChar w:fldCharType="end"/>', separate);
  expect(separate, 'no separate field char').toBeGreaterThan(-1);
  expect(end, 'no end field char').toBeGreaterThan(separate);
  return xml.slice(separate, end);
}

/**
 * The whole TOC block. docx puts the first entry's run *after* the separate
 * char but its `w:pPr` before it, so paragraph-level assertions need the block
 * rather than the field body.
 */
function tocBlock(xml: string): string {
  const match = xml.match(/<w:sdt>[\s\S]*?<\/w:sdt>/);
  expect(match, 'no TOC sdt block').not.toBeNull();
  return match![0];
}

const toc = { name: 'toc', props: { title: 'Contents' } };

describe('TOC cached entries', () => {
  it('writes the entries between the separate and end field chars', async () => {
    const xml = await documentXml([
      toc,
      { name: 'heading', props: { text: 'Getting Started', level: 1 } },
      { name: 'heading', props: { text: 'Prerequisites', level: 2 } },
    ]);

    const body = cachedFieldBody(xml);
    expect(body).toContain('Getting Started');
    expect(body).toContain('Prerequisites');

    const block = tocBlock(xml);
    expect(block).toContain('<w:pStyle w:val="TOC1"/>');
    expect(block).toContain('<w:pStyle w:val="TOC2"/>');
  });

  it('honours the depth range', async () => {
    const xml = await documentXml([
      { name: 'toc', props: { title: 'Contents', depth: { from: 1, to: 2 } } },
      { name: 'heading', props: { text: 'Level one', level: 1 } },
      { name: 'heading', props: { text: 'Level two', level: 2 } },
      { name: 'heading', props: { text: 'Level three', level: 3 } },
    ]);

    const body = cachedFieldBody(xml);
    expect(body).toContain('Level one');
    expect(body).toContain('Level two');
    expect(body).not.toContain('Level three');
  });

  it('strips markdown decorators from entry titles', async () => {
    const xml = await documentXml([
      toc,
      { name: 'heading', props: { text: '**2026** results', level: 1 } },
    ]);

    const body = cachedFieldBody(xml);
    expect(body).toContain('2026 results');
    expect(body).not.toContain('**');
  });

  it('collects a heading nested in a text-box', async () => {
    const xml = await documentXml([
      toc,
      {
        name: 'text-box',
        props: { width: 300, height: 100 },
        children: [
          { name: 'heading', props: { text: 'Boxed title', level: 1 } },
        ],
      },
    ]);

    expect(cachedFieldBody(xml)).toContain('Boxed title');
  });

  it('collects a themeStyle-mapped paragraph at its mapped level', async () => {
    const xml = await generateBufferFromJson({
      name: 'docx',
      props: {
        theme: 'minimal',
        themeOverrides: { styles: { calloutTitle: { size: 14, bold: true } } },
      },
      children: [
        {
          name: 'toc',
          props: {
            title: 'Contents',
            styles: [{ styleId: 'calloutTitle', level: 2 }],
          },
        },
        { name: 'heading', props: { text: 'Real heading', level: 1 } },
        {
          name: 'paragraph',
          props: { text: 'Callout heading', themeStyle: 'calloutTitle' },
        },
        { name: 'paragraph', props: { text: 'Ordinary body text' } },
      ],
    } as never).then(async (buf) => {
      const zip = await JSZip.loadAsync(buf);
      return zip.file('word/document.xml')!.async('string');
    });

    const body = cachedFieldBody(xml);
    expect(body).toContain('Real heading');
    expect(body).toContain('Callout heading');
    expect(body).not.toContain('Ordinary body text');

    // docx picks a cached entry's paragraph style by looking up its *level* in
    // stylesWithLevels, so once a TOC maps a style to level 2 every level-2
    // entry takes that style name rather than TOC2. Word restores TOC2 on
    // refresh; asserted here so the divergence is recorded, not discovered.
    expect(tocBlock(xml)).toContain('<w:pStyle w:val="callout Title"/>');
  });

  it('matches a style mapping written as the Word display name', async () => {
    // `themeStyle` carries the theme key; a TOC mapping may instead name the
    // Word display name the \t switch needs. Word collects the paragraph
    // either way, so the cached entries must too.
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: {
        theme: 'minimal',
        themeOverrides: { styles: { calloutTitle: { size: 14, bold: true } } },
      },
      children: [
        {
          name: 'toc',
          props: {
            title: 'Contents',
            styles: [{ styleId: 'callout Title', level: 2 }],
          },
        },
        {
          name: 'paragraph',
          props: { text: 'Callout heading', themeStyle: 'calloutTitle' },
        },
      ],
    } as never);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(cachedFieldBody(xml)).toContain('Callout heading');
  });

  it('scopes a section TOC to its own section', async () => {
    const xml = await documentXml([
      {
        name: 'section',
        props: {},
        children: [
          { name: 'toc', props: { title: 'Contents', scope: 'section' } },
          { name: 'heading', props: { text: 'Inside this section', level: 1 } },
        ],
      },
      {
        name: 'section',
        props: {},
        children: [
          { name: 'heading', props: { text: 'A different section', level: 1 } },
        ],
      },
    ]);

    const body = cachedFieldBody(xml);
    expect(body).toContain('Inside this section');
    expect(body).not.toContain('A different section');
  });

  it('handles a single entry', async () => {
    const xml = await documentXml([
      toc,
      { name: 'heading', props: { text: 'Only heading', level: 1 } },
    ]);

    expect(cachedFieldBody(xml)).toContain('Only heading');
  });

  it('leaves the field empty when there is nothing to cache', async () => {
    const xml = await documentXml([
      toc,
      { name: 'paragraph', props: { text: 'No headings here.' } },
    ]);

    expect(cachedFieldBody(xml)).not.toContain('No headings here.');
  });

  it('omits page numbers — nothing in generation paginates', async () => {
    const xml = await documentXml([
      toc,
      { name: 'heading', props: { text: 'Getting Started', level: 1 } },
    ]);

    // A cached page number would be a fabricated one; Word fills real ones in.
    expect(cachedFieldBody(xml)).not.toContain('PAGEREF');
  });
});

describe('collectTocHeadings', () => {
  const section = (
    components: unknown[],
    extra: Partial<SectionLayout> = {}
  ): SectionLayout =>
    ({
      properties: {},
      components,
      layoutType: 'single',
      breakBefore: false,
      isUserSection: false,
      belongsToUserSection: false,
      ...extra,
    }) as unknown as SectionLayout;

  it('never reaches headers or footers', () => {
    const entries = collectTocHeadings([
      section([{ name: 'paragraph', props: { text: 'Body' } }], {
        header: [
          { name: 'heading', props: { text: 'Header heading', level: 1 } },
        ] as never,
        footer: [
          { name: 'heading', props: { text: 'Footer heading', level: 1 } },
        ] as never,
      }),
    ]);

    expect(entries).toEqual([]);
  });

  it('prunes disabled subtrees', () => {
    const entries = collectTocHeadings([
      section([
        { name: 'heading', props: { text: 'Kept', level: 1 } },
        {
          name: 'heading',
          props: { text: 'Dropped', level: 1 },
          enabled: false,
        },
        {
          name: 'text-box',
          props: {},
          enabled: false,
          children: [
            { name: 'heading', props: { text: 'Also dropped', level: 1 } },
          ],
        },
      ]),
    ]);

    expect(entries.map((entry) => entry.title)).toEqual(['Kept']);
  });

  it('descends columns defensively even though layout hoists them', () => {
    const entries = collectTocHeadings([
      section([
        {
          name: 'columns',
          props: { count: 2 },
          children: [
            { name: 'heading', props: { text: 'In a column', level: 2 } },
          ],
        },
      ]),
    ]);

    expect(entries).toEqual([{ title: 'In a column', level: 2 }]);
  });

  it('ignores heading-style themeStyle paragraphs', () => {
    // `themeStyle: heading1` maps to the display-only JTD_HeadingText style,
    // which carries no outline level precisely so it stays out of the TOC.
    const entries = collectTocHeadings([
      section([
        {
          name: 'paragraph',
          props: { text: 'Looks like a heading', themeStyle: 'heading1' },
        },
      ]),
    ]);

    expect(entries).toEqual([]);
  });
});
