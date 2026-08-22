/**
 * The PPTX pipeline against recorded golden output.
 *
 * `corpus-goldens.ts` holds one SHA-256 per corpus case, recorded from the
 * pipeline before the renderer IR became the default. This is what keeps the
 * default backend honest once the code those hashes were produced by is gone:
 * a byte change anywhere in a package fails here, and can only be accepted by
 * editing a golden and saying why.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { CORPUS } from './fixtures/corpus';
import { CORPUS_GOLDENS } from './fixtures/corpus-goldens';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

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

      expect(sha256(buffer)).toBe(CORPUS_GOLDENS[name]);
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
