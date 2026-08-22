/**
 * The PPTX pipeline against recorded golden output.
 *
 * `corpus-goldens.ts` holds one part digest per corpus case, recorded from the
 * pipeline before the renderer IR became the default. This is what keeps the
 * default backend honest once the code those digests were produced by is gone:
 * a change to any part fails here, and can only be accepted by editing a
 * golden and saying why.
 *
 * The digest deliberately says nothing about compression — see
 * `fixtures/packageDigest.ts`. Byte-for-byte stability is a separate claim and
 * has its own assertion below, within one process on one runtime, which is the
 * scope it holds at.
 */

import { describe, expect, it } from 'vitest';
import { generateBufferFromJson } from '../core/generator';
import { CORPUS } from './fixtures/corpus';
import { CORPUS_GOLDENS } from './fixtures/corpus-goldens';
import { packageDigest } from './fixtures/packageDigest';

describe('PPTX corpus goldens', () => {
  it('covers every recorded golden and records every corpus case', () => {
    expect([...CORPUS.map((c) => c.name)].sort()).toEqual(
      Object.keys(CORPUS_GOLDENS).sort()
    );
  });

  it.each(CORPUS.map((c) => [c.name, c] as const))(
    'reproduces the golden package for %s',
    async (name, testCase) => {
      const buffer = (await generateBufferFromJson(
        structuredClone(testCase.document) as never
      )) as Buffer;

      await expect(packageDigest(buffer)).resolves.toBe(CORPUS_GOLDENS[name]);
    }
  );

  it('produces identical bytes on a second run', async () => {
    const [first] = CORPUS;
    const a = (await generateBufferFromJson(
      structuredClone(first.document) as never
    )) as Buffer;
    const b = (await generateBufferFromJson(
      structuredClone(first.document) as never
    )) as Buffer;

    expect(a.equals(b)).toBe(true);
  });
});
