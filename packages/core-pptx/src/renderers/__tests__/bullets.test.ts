/**
 * Bullets, through both backends.
 *
 * `bullet: false` is the interesting case. It is not an absence — a paragraph
 * can inherit a bullet from the format's own list style — so it has to reach
 * the package as `<a:buNone/>`. Compiling it to an enabled bullet is what #254
 * was, and it turned a document that said "no bullet" into one that grew one.
 *
 * The other cases are here because they are what proves the fix did not simply
 * disable bullets everywhere.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';

const RENDERERS = ['pptxgenjs', 'office-open'] as const;

function deck(bullet: unknown): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'Bullets' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'text',
            props: {
              text: 'Item',
              x: 1,
              y: 1,
              w: 4,
              h: 1,
              ...(bullet === undefined ? {} : { bullet }),
            },
          },
        ],
      },
    ],
  } as unknown as PresentationComponentDefinition;
}

/** Every bullet element on the first slide, in document order. */
async function bulletElements(
  bullet: unknown,
  renderer: (typeof RENDERERS)[number]
): Promise<string[]> {
  const { buffer } = await generateBufferViaIr(deck(bullet) as never, {
    renderer,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  return [...xml.matchAll(/<a:bu[A-Za-z]+[^>]*?\/?>/g)].map((m) => m[0]);
}

describe.each(RENDERERS)('%s bullets', (renderer) => {
  it('writes buNone for an explicit false', async () => {
    const elements = await bulletElements(false, renderer);

    expect(elements).toContain('<a:buNone/>');
    expect(elements.some((el) => el.startsWith('<a:buChar'))).toBe(false);
    expect(elements.some((el) => el.startsWith('<a:buAutoNum'))).toBe(false);
  });

  it('writes a glyph for an explicit true', async () => {
    const elements = await bulletElements(true, renderer);

    expect(elements.some((el) => el.startsWith('<a:buChar'))).toBe(true);
    expect(elements).not.toContain('<a:buNone/>');
  });

  it('writes an auto-number for a numbered bullet', async () => {
    const elements = await bulletElements({ type: 'number' }, renderer);

    expect(elements.some((el) => el.startsWith('<a:buAutoNum'))).toBe(true);
    expect(elements).not.toContain('<a:buNone/>');
  });

  it('honours a custom glyph', async () => {
    const elements = await bulletElements(
      { type: 'bullet', style: '▸' },
      renderer
    );

    // One backend writes the character, the other a numeric reference to it.
    // Both are the same glyph once parsed, which is all that is being claimed.
    expect(
      elements.some((el) => el.includes('▸') || el.includes('&#x25B8;'))
    ).toBe(true);
  });

  it('starts a numbered bullet where the author asked', async () => {
    const elements = await bulletElements(
      { type: 'number', startAt: 4 },
      renderer
    );

    expect(elements.some((el) => el.includes('startAt="4"'))).toBe(true);
  });
});
