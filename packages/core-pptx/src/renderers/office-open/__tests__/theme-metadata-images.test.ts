/**
 * Deck-level semantics the office-open adapter used to drop on the floor.
 *
 * Three of these are things the backend *can* express and the adapter simply
 * did not map: the authored theme (#258), the company property (#262), and a
 * slide transition, which never even reached the IR because processing dropped
 * it (#257). The fourth is a real gap — a picture's crop and rounding have
 * nowhere to go in `PictureOptions` — so it is refused instead of drawn wrong
 * (#259).
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';

const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const RENDERERS = ['pptxgenjs', 'office-open'] as const;

function deck(
  props: Record<string, unknown>,
  slideProps: Record<string, unknown> = {},
  children: unknown[] = [
    { name: 'text', props: { text: 'Hello', x: 1, y: 1, w: 4, h: 1 } },
  ]
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'Deck', ...props },
    children: [{ name: 'slide', props: slideProps, children }],
  } as unknown as PresentationComponentDefinition;
}

async function open(
  document: PresentationComponentDefinition,
  renderer: (typeof RENDERERS)[number]
): Promise<JSZip> {
  const { buffer } = await generateBufferViaIr(document as never, { renderer });
  return JSZip.loadAsync(buffer);
}

async function partOrUndefined(
  zip: JSZip,
  path: string
): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

/* ------------------------------------------------------------------ *
 * Theme (#258)
 * ------------------------------------------------------------------ */

const BRANDED = {
  theme: {
    name: 'branded',
    colors: {
      primary: '#112233',
      secondary: '#778899',
      accent: '#AABBCC',
      background: '#FFFFFF',
      text: '#445566',
      text2: '#667788',
    },
    fonts: { heading: 'Courier New', body: 'Comic Sans MS' },
    defaults: { fontSize: 18, fontColor: '#445566' },
  },
};

describe.each(RENDERERS)('%s document theme', (renderer) => {
  it('writes the authored heading and body faces into theme1.xml', async () => {
    const zip = await open(deck(BRANDED), renderer);
    const theme = await partOrUndefined(zip, 'ppt/theme/theme1.xml');

    expect(theme).toBeDefined();
    expect(theme).toContain('Courier New');
    expect(theme).toContain('Comic Sans MS');
    // Not the Office default, which is what a deck with no mapped theme gets.
    expect(theme).not.toMatch(/<a:latin typeface="Calibri Light"/);
  });
});

describe('office-open colour scheme', () => {
  it('carries the resolved palette into the scheme slots', async () => {
    const zip = await open(deck(BRANDED), 'office-open');
    const theme = await partOrUndefined(zip, 'ppt/theme/theme1.xml');

    // `primary` is the project's name for accent1, `text` for dark1.
    expect(theme).toMatch(/<a:accent1>[\s\S]*?112233/);
    expect(theme).toMatch(/<a:dk1>[\s\S]*?445566/);
  });
});

/* ------------------------------------------------------------------ *
 * Company metadata (#262)
 * ------------------------------------------------------------------ */

describe.each(RENDERERS)('%s document metadata', (renderer) => {
  it('writes company into the extended properties', async () => {
    const zip = await open(deck({ company: 'Acme' }), renderer);
    const app = await partOrUndefined(zip, 'docProps/app.xml');

    expect(app).toBeDefined();
    expect(app).toContain('<Company>Acme</Company>');
  });
});

/* ------------------------------------------------------------------ *
 * Transitions (#257)
 * ------------------------------------------------------------------ */

describe('slide transitions', () => {
  const withTransition = deck(
    {},
    { transition: { type: 'fade', speed: 'fast' } }
  );

  it('survives processing and reaches the office-open package', async () => {
    const zip = await open(withTransition, 'office-open');
    const slide = await partOrUndefined(zip, 'ppt/slides/slide1.xml');

    expect(slide).toMatch(/<p:transition[^>]*spd="fast"/);
    expect(slide).toContain('<p:fade');
  });

  it('is refused by PptxGenJS, which has no transition API', async () => {
    await expect(
      generateBufferViaIr(withTransition as never, { renderer: 'pptxgenjs' })
    ).rejects.toThrow(/transitions/);
  });

  it('names the slide path in the refusal', async () => {
    await expect(
      generateBufferViaIr(withTransition as never, { renderer: 'pptxgenjs' })
    ).rejects.toThrow(/slides\[0\]\.transition/);
  });

  it('asks nothing of either backend when the type is none', async () => {
    const none = deck({}, { transition: { type: 'none' } });

    for (const renderer of RENDERERS) {
      const zip = await open(none, renderer);
      const slide = await partOrUndefined(zip, 'ppt/slides/slide1.xml');
      expect(slide).not.toContain('<p:transition');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Image crop and rounding (#259)
 * ------------------------------------------------------------------ */

describe('image crop and rounding', () => {
  const image = (props: Record<string, unknown>) =>
    deck({}, {}, [
      {
        name: 'image',
        props: { base64: PNG_4X2, x: 1, y: 1, w: 2, h: 2, ...props },
      },
    ]);

  it.each([
    ['a cover fit', { sizing: { type: 'cover', w: 2, h: 1 } }, /image-crop/],
    [
      'an explicit crop',
      { sizing: { type: 'crop', w: 1, h: 1 } },
      /image-crop/,
    ],
    ['rounding', { rounding: true }, /image-rounding/],
  ])('office-open refuses %s', async (_name, props, message) => {
    await expect(
      generateBufferViaIr(image(props) as never, { renderer: 'office-open' })
    ).rejects.toThrow(message);
  });

  it('accepts a contain fit, which never reaches the IR as a crop', async () => {
    // `resolveImageLayout` fits and centres the element itself and drops the
    // sizing, so there is nothing left for a backend to crop.
    const { buffer } = await generateBufferViaIr(
      image({ sizing: { type: 'contain', w: 2, h: 1 } }) as never,
      { renderer: 'office-open' }
    );

    expect(buffer.length).toBeGreaterThan(0);
  });

  it.each([
    ['a cover fit', { sizing: { type: 'cover', w: 2, h: 1 } }],
    ['an explicit crop', { sizing: { type: 'crop', w: 1, h: 1 } }],
    ['a contain fit', { sizing: { type: 'contain', w: 2, h: 1 } }],
    ['rounding', { rounding: true }],
  ])('pptxgenjs still draws %s', async (_name, props) => {
    const { buffer } = await generateBufferViaIr(image(props) as never, {
      renderer: 'pptxgenjs',
    });

    expect(buffer.length).toBeGreaterThan(0);
  });

  it('leaves a plain image alone on both backends', async () => {
    for (const renderer of RENDERERS) {
      const zip = await open(image({}), renderer);
      const slide = await partOrUndefined(zip, 'ppt/slides/slide1.xml');
      expect(slide).toContain('<p:pic>');
    }
  });
});
