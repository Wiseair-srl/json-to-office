import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { generateBufferWithWarnings } from '../generator';
import type { PresentationComponentDefinition } from '../../types';

/**
 * `hyperlink.slide` is authored-position based: it names the Nth slide as
 * written in the JSON, disabled slides included. These tests pin both halves
 * of the contract — the rebase onto the generated numbering, and the refusal
 * to emit a relationship to a slide part that is not in the archive.
 */

function slide(text: string, hyperlinkSlide?: number) {
  return {
    name: 'slide',
    props: {},
    children: [
      {
        name: 'text',
        props: {
          text,
          ...(hyperlinkSlide === undefined
            ? {}
            : { hyperlink: { slide: hyperlinkSlide } }),
        },
      },
    ],
  };
}

function deck(
  children: ReturnType<typeof slide>[]
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'Hyperlink slide refs' },
    children,
  };
}

function disable(s: ReturnType<typeof slide>) {
  (s as { enabled?: boolean }).enabled = false;
  return s;
}

/** Every internal slide relationship target, across all slide rels parts. */
async function slideRelTargets(zip: JSZip): Promise<string[]> {
  const targets: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name)) continue;
    const xml = await zip.file(name)!.async('string');
    for (const match of xml.matchAll(
      /Type="[^"]*\/relationships\/slide"\s+Target="([^"]+)"/g
    )) {
      targets.push(match[1]);
    }
  }
  return targets;
}

function slideParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p)
  );
}

/** Fails if any slide relationship points at a part the archive lacks. */
async function expectNoDanglingSlideRels(zip: JSZip): Promise<void> {
  const parts = new Set(
    slideParts(zip).map((p) => p.replace('ppt/slides/', ''))
  );
  for (const target of await slideRelTargets(zip)) {
    expect(parts.has(target), `dangling slide relationship -> ${target}`).toBe(
      true
    );
  }
}

async function build(document: PresentationComponentDefinition) {
  const { buffer, warnings } = await generateBufferWithWarnings(document);
  return { zip: await JSZip.loadAsync(buffer), warnings };
}

describe('slide-targeted hyperlinks', () => {
  it('drops a link to a slide removed by enabled: false and warns', async () => {
    const { zip, warnings } = await build(
      deck([slide('First', 2), disable(slide('Second')), slide('Third')])
    );

    expect(slideParts(zip)).toHaveLength(2);
    await expectNoDanglingSlideRels(zip);
    expect(await slideRelTargets(zip)).toEqual([]);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: 'HYPERLINK_SLIDE_UNRESOLVED',
        component: 'text',
      })
    );
    expect(warnings[0].message).toContain('hyperlink.slide 2');
  });

  it('drops a link past the end of the deck and warns', async () => {
    const { zip, warnings } = await build(
      deck([slide('First', 9), slide('Second')])
    );

    expect(slideParts(zip)).toHaveLength(2);
    await expectNoDanglingSlideRels(zip);
    expect(await slideRelTargets(zip)).toEqual([]);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'HYPERLINK_SLIDE_UNRESOLVED' })
    );
  });

  it('rebases a link to a surviving slide onto the generated numbering', async () => {
    const { zip, warnings } = await build(
      deck([slide('First', 3), disable(slide('Second')), slide('Third')])
    );

    // Authored slide 3 renders as slide 2, so the ref must follow it there —
    // not stay on 3 (dangling) and not keep pointing at whatever is now third.
    expect(slideParts(zip)).toHaveLength(2);
    expect(await slideRelTargets(zip)).toEqual(['slide2.xml']);
    await expectNoDanglingSlideRels(zip);
    expect(warnings).toEqual([]);

    const target = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(target).toContain('<a:t>Third</a:t>');
  });

  it('leaves refs untouched when no slide is disabled', async () => {
    const { zip, warnings } = await build(
      deck([slide('First', 3), slide('Second'), slide('Third')])
    );

    expect(await slideRelTargets(zip)).toEqual(['slide3.xml']);
    await expectNoDanglingSlideRels(zip);
    expect(warnings).toEqual([]);
  });

  it('keeps url hyperlinks working alongside the slide-ref rules', async () => {
    const { zip, warnings } = await build({
      name: 'pptx',
      props: { title: 'url link' },
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'text',
              props: {
                text: 'Out',
                hyperlink: { url: 'https://example.com' },
              },
            },
          ],
        },
      ],
    });

    await expectNoDanglingSlideRels(zip);
    expect(warnings).toEqual([]);
    const rels = await zip
      .file('ppt/slides/_rels/slide1.xml.rels')!
      .async('string');
    expect(rels).toContain('https://example.com');
  });

  // Block bodies and component-slot `props` are merged into the rendered
  // component, so a `hyperlink.slide` written in a definition reaches the
  // writer exactly like a component's own — and must be rebased the same way.
  describe('block definitions', () => {
    function blocked(
      defaultSlideRef: number,
      children: ReturnType<typeof slide>[]
    ): PresentationComponentDefinition {
      return {
        name: 'pptx',
        props: {
          title: 'Block links',
          blocks: {
            linked: {
              slots: { body: { type: 'component', required: true } },
              body: [
                {
                  $slot: '/body',
                  props: {
                    x: 1,
                    y: 1,
                    w: 4,
                    h: 1,
                    hyperlink: { slide: defaultSlideRef },
                  },
                },
              ],
            },
          },
        },
        children,
      } as unknown as PresentationComponentDefinition;
    }

    function usingBlock(text: string) {
      return {
        name: 'slide',
        children: [
          {
            name: 'block',
            props: {
              ref: 'linked',
              slots: { body: { name: 'text', props: { text } } },
            },
          },
        ],
      } as unknown as ReturnType<typeof slide>;
    }

    it('rebases a definition slide ref past a slide dropped by enabled: false', async () => {
      const { zip, warnings } = await build(
        blocked(4, [
          usingBlock('First'),
          disable(slide('Second')),
          slide('Third'),
          slide('Fourth'),
        ])
      );

      expect(slideParts(zip)).toHaveLength(3);
      await expectNoDanglingSlideRels(zip);
      // Authored slide 4 survives as the 3rd rendered slide.
      expect(await slideRelTargets(zip)).toEqual(['slide3.xml']);
      expect(warnings).toEqual([]);
    });

    it('drops a definition slide ref that is out of range and warns', async () => {
      const { zip, warnings } = await build(
        blocked(9, [usingBlock('First'), slide('Second'), slide('Third')])
      );

      await expectNoDanglingSlideRels(zip);
      expect(await slideRelTargets(zip)).toEqual([]);
      expect(warnings).toContainEqual(
        expect.objectContaining({ code: 'HYPERLINK_SLIDE_UNRESOLVED' })
      );
    });
  });
});
