/**
 * Renderer selection, isolation and failure behaviour on the public API.
 */

import { describe, expect, it } from 'vitest';
import {
  generateBufferFromJson,
  generateBufferWithWarnings,
} from '../core/generator';
import { compileDocumentToIr } from '../core/generateFromIr';
import type { PptxIrImageElement } from '../ir/types';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';
import type { PresentationComponentDefinition } from '../types';
import { CORPUS } from './fixtures/corpus';
import { CORPUS_GOLDENS } from './fixtures/corpus-goldens';
import { packageDigest } from './fixtures/packageDigest';

const deck = (text: string): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Corpus', author: 'JTO' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'text', props: { text } }],
      },
    ],
  }) as PresentationComponentDefinition;

/** Two distinct 1x1 PNGs, so each deck interns bytes nothing else shares. */
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const OTHER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The same deck, plus one inline image so the compilation interns a resource. */
const deckWithImage = (
  text: string,
  base64: string
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Corpus', author: 'JTO' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          { name: 'text', props: { text } },
          { name: 'image', props: { base64, x: 0, y: 0, w: 1, h: 1 } },
        ],
      },
    ],
  }) as PresentationComponentDefinition;

const imageOf = (element: { kind: string }): PptxIrImageElement => {
  if (element.kind !== 'image') {
    throw new Error(`expected an image element, got "${element.kind}"`);
  }
  return element as PptxIrImageElement;
};

describe('renderer selection', () => {
  it('defaults to pptxgenjs', async () => {
    const [first] = CORPUS;
    const withDefault = await generateBufferFromJson(
      structuredClone(first.document) as never
    );
    const explicit = await generateBufferFromJson(
      structuredClone(first.document) as never,
      { renderer: 'pptxgenjs' }
    );

    await expect(packageDigest(withDefault as Buffer)).resolves.toBe(
      CORPUS_GOLDENS[first.name]
    );
    await expect(packageDigest(explicit as Buffer)).resolves.toBe(
      CORPUS_GOLDENS[first.name]
    );
  });

  it('renders through the office-open backend when asked', async () => {
    const buffer = await generateBufferFromJson(deck('office-open') as never, {
      renderer: 'office-open',
    });

    expect(buffer.length).toBeGreaterThan(0);
    // A different backend, so different bytes — the point is that it is a real
    // package, not that it matches.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('selects the backend from the document discriminator', async () => {
    const document = {
      ...deck('document-selected'),
      renderer: 'office-open',
    } as PresentationComponentDefinition;
    const buffer = await generateBufferFromJson(document);

    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('rejects an unknown renderer id with the valid ids', async () => {
    await expect(
      generateBufferFromJson(deck('x') as never, {
        renderer: 'nope' as never,
      })
    ).rejects.toThrow(/Unknown pptx renderer "nope".*pptxgenjs/s);
  });

  it('accepts the renderer option on the plugin generator', async () => {
    const generator = createPresentationGenerator({ renderer: 'office-open' });
    const transitionDeck = deck('plugin');
    transitionDeck.children[0].props = {
      transition: { type: 'fade' },
    } as never;
    const { buffer } = await generator.generateBuffer(transitionDeck as never);

    expect(buffer.length).toBeGreaterThan(0);
  });
});

describe('concurrent generation isolation', () => {
  it('produces the same bytes when the whole corpus runs concurrently', async () => {
    const results = await Promise.all(
      CORPUS.map(async (testCase) => [
        testCase.name,
        await packageDigest(
          (await generateBufferFromJson(
            structuredClone(testCase.document) as never
          )) as Buffer
        ),
      ])
    );

    for (const [name, digest] of results) {
      expect({ name, digest }).toEqual({ name, digest: CORPUS_GOLDENS[name] });
    }
    // Renders the entire corpus at once, so it outgrows the strict local
    // budget whenever the machine is also running the other packages' suites
    // — which is exactly what `pnpm test` does.
  }, 60_000);

  it('does not share resource ids between concurrent compilations', async () => {
    const [a, b] = await Promise.all([
      compileDocumentToIr(deckWithImage('one', PNG_1PX) as never),
      compileDocumentToIr(deckWithImage('two', OTHER_PNG) as never),
    ]);

    expect(a.ir.slides[0].elements[0].id).toBe(b.ir.slides[0].elements[0].id);

    // Each compilation interns its own image starting from res1: the counter
    // restarts per compilation rather than being shared or continued across
    // them, so neither deck ever names a resource the other owns.
    expect(a.ir.resources.map((r) => r.id)).toEqual(['res1']);
    expect(b.ir.resources.map((r) => r.id)).toEqual(['res1']);
    expect(imageOf(a.ir.slides[0].elements[1]).resourceId).toBe('res1');
    expect(imageOf(b.ir.slides[0].elements[1]).resourceId).toBe('res1');

    // Same id, genuinely different bytes — which is exactly why the ids must
    // not be treated as global.
    expect(a.ir.resources[0].origin).not.toEqual(b.ir.resources[0].origin);
  });

  it('keeps warnings separate between concurrent generations', async () => {
    const bad = {
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            { name: 'text', props: { text: 'x', color: 'notacolour' } },
          ],
        },
      ],
    } as unknown as PresentationComponentDefinition;

    const [withWarning, clean] = await Promise.all([
      generateBufferWithWarnings(structuredClone(bad) as never),
      generateBufferWithWarnings(deck('fine') as never),
    ]);

    expect(withWarning.warnings.map((w) => w.code)).toContain('UNKNOWN_COLOR');
    expect(clean.warnings).toEqual([]);
  });
});
