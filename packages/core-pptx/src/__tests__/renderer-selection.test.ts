/**
 * Renderer selection, isolation and failure behaviour on the public API.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  generateBufferFromJson,
  generateBufferWithWarnings,
} from '../core/generator';
import { compileDocumentToIr } from '../core/generateFromIr';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';
import type { PresentationComponentDefinition } from '../types';
import { CORPUS } from './fixtures/corpus';
import { CORPUS_GOLDENS } from './fixtures/corpus-goldens';

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

const sha = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

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

    expect(sha(withDefault)).toBe(CORPUS_GOLDENS[first.name]);
    expect(sha(explicit)).toBe(CORPUS_GOLDENS[first.name]);
  });

  it('reports the missing optional backend when office-open is selected', async () => {
    await expect(
      generateBufferFromJson(deck('x') as never, { renderer: 'office-open' })
    ).rejects.toThrow(/@office-open\/pptx/);
  });

  it('rejects an unknown renderer id with the valid ids', async () => {
    await expect(
      generateBufferFromJson(deck('x') as never, {
        renderer: 'nope' as never,
      })
    ).rejects.toThrow(/Unknown pptx renderer "nope".*pptxgenjs/s);
  });

  it('accepts the renderer option on the plugin generator', async () => {
    const generator = createPresentationGenerator({ renderer: 'pptxgenjs' });
    const { buffer } = await generator.generateBuffer(deck('plugin') as never);

    expect(buffer.length).toBeGreaterThan(0);
  });
});

describe('concurrent generation isolation', () => {
  it('produces the same bytes when the whole corpus runs concurrently', async () => {
    const results = await Promise.all(
      CORPUS.map(async (testCase) => [
        testCase.name,
        sha(
          (await generateBufferFromJson(
            structuredClone(testCase.document) as never
          )) as Buffer
        ),
      ])
    );

    for (const [name, hash] of results) {
      expect({ name, hash }).toEqual({ name, hash: CORPUS_GOLDENS[name] });
    }
  });

  it('does not share resource ids between concurrent compilations', async () => {
    const [a, b] = await Promise.all([
      Promise.resolve(compileDocumentToIr(deck('one') as never)),
      Promise.resolve(compileDocumentToIr(deck('two') as never)),
    ]);

    expect(a.ir.slides[0].elements[0].id).toBe(b.ir.slides[0].elements[0].id);
    expect(a.ir.resources).toEqual([]);
    expect(b.ir.resources).toEqual([]);
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
