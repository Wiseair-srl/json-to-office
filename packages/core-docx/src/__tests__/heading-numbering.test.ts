/**
 * `heading.props.numbering` used to be accepted by the schema and ignored by
 * the renderer. It now binds the heading to one shared multilevel definition
 * (1., 1.1., 1.1.1.) whose levels carry `w:pStyle`, so Word treats it as its
 * own built-in heading numbering — which is what makes the `\r` cross-reference
 * switch and the TOC's own refresh agree with what we cache.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { collectDocumentOutline } from '../core/collectTocHeadings';
import type { SectionLayout } from '../core/layout';
import { minimalTheme } from '../templates/themes';
import type { ThemeConfig } from '../styles';

async function pack(
  children: unknown[],
  options?: { customThemes: { [key: string]: ThemeConfig }; theme: string }
): Promise<{ document: string; numbering: string }> {
  const buf = await generateBufferFromJson(
    {
      name: 'docx',
      props: { theme: options?.theme ?? 'minimal' },
      children,
    } as never,
    options && { customThemes: options.customThemes }
  );
  const zip = await JSZip.loadAsync(buf);
  return {
    document: await zip.file('word/document.xml')!.async('string'),
    numbering: (await zip.file('word/numbering.xml')?.async('string')) ?? '',
  };
}

/** The abstract numbering whose levels bind the Heading styles. */
function headingAbstractNum(numbering: string): string {
  const block = (
    numbering.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []
  ).find((b) => b.includes('<w:pStyle w:val="Heading1"/>'));
  if (!block) throw new Error('no heading abstractNum in numbering.xml');
  return block;
}

/** The concrete numId the heading definition resolves to in this document. */
function headingNumId(numbering: string): string {
  const abstractId = headingAbstractNum(numbering).match(
    /w:abstractNumId="(\d+)"/
  )?.[1];
  const num = numbering.match(
    new RegExp(
      `<w:num w:numId="(\\d+)"><w:abstractNumId w:val="${abstractId}"/>`
    )
  );
  if (!num) throw new Error('heading abstractNum has no concrete w:num');
  return num[1];
}

/** Paragraph properties blocks, in document order. */
function paragraphProps(document: string): string[] {
  return document.match(/<w:pPr>[\s\S]*?<\/w:pPr>/g) ?? [];
}

function propsForStyle(document: string, styleId: string): string[] {
  return paragraphProps(document).filter((p) =>
    p.includes(`<w:pStyle w:val="${styleId}"/>`)
  );
}

function layoutOf(components: unknown[]): SectionLayout[] {
  return [
    {
      components,
      properties: {},
    } as unknown as SectionLayout,
  ];
}

describe('heading numbering', () => {
  it('binds a numbered heading to the shared definition at its own level', async () => {
    const { document, numbering } = await pack([
      { name: 'heading', props: { text: 'Alpha', level: 1, numbering: true } },
      { name: 'heading', props: { text: 'Beta', level: 2, numbering: true } },
    ]);

    const numId = headingNumId(numbering);
    expect(propsForStyle(document, 'Heading1')[0]).toContain(
      `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`
    );
    expect(propsForStyle(document, 'Heading2')[0]).toContain(
      `<w:numPr><w:ilvl w:val="1"/><w:numId w:val="${numId}"/></w:numPr>`
    );
  });

  it('registers the definition once however many headings use it', async () => {
    const { numbering } = await pack(
      Array.from({ length: 5 }, (_, i) => ({
        name: 'heading',
        props: { text: `H${i}`, level: 1, numbering: true },
      }))
    );

    const withHeadingStyles = (
      numbering.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []
    ).filter((b) => b.includes('<w:pStyle w:val="Heading1"/>'));
    expect(withHeadingStyles).toHaveLength(1);
  });

  it('writes six decimal levels bound to Heading1..6, flush left', async () => {
    const { numbering } = await pack([
      { name: 'heading', props: { text: 'Alpha', level: 1, numbering: true } },
    ]);
    const abstract = headingAbstractNum(numbering);

    for (let level = 0; level < 6; level++) {
      const lvl = abstract.match(
        new RegExp(`<w:lvl w:ilvl="${level}"[^>]*>[\\s\\S]*?</w:lvl>`)
      )?.[0];
      expect(lvl, `level ${level} missing`).toBeDefined();
      expect(lvl).toContain('<w:numFmt w:val="decimal"/>');
      expect(lvl).toContain('<w:suff w:val="space"/>');
      expect(lvl).toContain(`<w:pStyle w:val="Heading${level + 1}"/>`);
      expect(lvl).toContain('<w:ind w:left="0" w:hanging="0"/>');
      const text = Array.from(
        { length: level + 1 },
        (_, i) => `%${i + 1}`
      ).join('.');
      expect(lvl).toContain(`<w:lvlText w:val="${text}."/>`);
    }
    // Word supports nine list levels but only six heading styles.
    expect(abstract).not.toContain('<w:lvl w:ilvl="6"');
  });

  it('emits the numId-0 opt-out for numbering: false', async () => {
    const { document } = await pack([
      { name: 'heading', props: { text: 'Plain', level: 2, numbering: false } },
    ]);

    expect(propsForStyle(document, 'Heading2')[0]).toContain(
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>'
    );
  });

  it('leaves w:numPr off entirely when numbering is absent', async () => {
    const { document } = await pack([
      { name: 'heading', props: { text: 'Plain', level: 1 } },
    ]);

    expect(propsForStyle(document, 'Heading1')[0]).not.toContain('<w:numPr>');
  });

  it('numbers every heading from componentDefaults, minus the opted-out one', async () => {
    const { document, numbering } = await pack(
      [
        { name: 'heading', props: { text: 'Alpha', level: 1 } },
        { name: 'heading', props: { text: 'Beta', level: 2 } },
        {
          name: 'heading',
          props: { text: 'Aside', level: 2, numbering: false },
        },
      ],
      {
        theme: 'numbered',
        customThemes: {
          numbered: {
            ...minimalTheme,
            componentDefaults: {
              ...minimalTheme.componentDefaults,
              heading: { numbering: true },
            },
          },
        },
      }
    );

    const numId = headingNumId(numbering);
    const level2 = propsForStyle(document, 'Heading2');
    expect(propsForStyle(document, 'Heading1')[0]).toContain(
      `<w:numId w:val="${numId}"/>`
    );
    expect(level2[0]).toContain(`<w:numId w:val="${numId}"/>`);
    expect(level2[1]).toContain('<w:numId w:val="0"/>');
  });
});

describe('heading numbering outline', () => {
  it('numbers a heading sequence the way Word does', () => {
    const outline = collectDocumentOutline(
      layoutOf(
        [
          ['Alpha', 1],
          ['Beta', 2],
          ['Gamma', 2],
          ['Delta', 1],
          ['Epsilon', 3],
        ].map(([text, level]) => ({
          name: 'heading',
          props: { text, level, numbering: true },
        }))
      )
    );

    expect(outline.entries.map((e) => e.number)).toEqual([
      '1',
      '1.1',
      '1.2',
      '2',
      // A level-3 heading with no level-2 above it: Word writes the zeros too.
      '2.0.1',
    ]);
  });

  it('does not advance the counter for an opted-out heading', () => {
    const outline = collectDocumentOutline(
      layoutOf([
        {
          name: 'heading',
          props: { text: 'Alpha', level: 1, numbering: true },
        },
        {
          name: 'heading',
          props: { text: 'Aside', level: 1, numbering: false },
        },
        { name: 'heading', props: { text: 'Beta', level: 1, numbering: true } },
      ])
    );

    expect(outline.entries.map((e) => e.number)).toEqual(['1', undefined, '2']);
  });

  it('skips disabled headings', () => {
    const outline = collectDocumentOutline(
      layoutOf([
        {
          name: 'heading',
          props: { text: 'Alpha', level: 1, numbering: true },
        },
        {
          name: 'heading',
          enabled: false,
          props: { text: 'Dropped', level: 1, numbering: true },
        },
        { name: 'heading', props: { text: 'Beta', level: 1, numbering: true } },
      ])
    );

    expect(outline.entries.map((e) => e.number)).toEqual(['1', '2']);
  });
});

describe('TOC cached entries with numbering', () => {
  it('prefixes the cached title with the heading number', async () => {
    const { document } = await pack([
      { name: 'toc', props: { title: 'Contents' } },
      { name: 'heading', props: { text: 'Alpha', level: 1, numbering: true } },
      { name: 'heading', props: { text: 'Beta', level: 2, numbering: true } },
    ]);

    expect(document).toContain('1 Alpha');
    expect(document).toContain('1.1 Beta');
  });

  it('leaves unnumbered headings unprefixed', async () => {
    const { document } = await pack([
      { name: 'toc', props: { title: 'Contents' } },
      { name: 'heading', props: { text: 'Alpha', level: 1 } },
    ]);

    expect(document).toContain('>Alpha<');
  });
});
