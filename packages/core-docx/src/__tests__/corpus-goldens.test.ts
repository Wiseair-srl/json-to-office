/**
 * The DOCX pipeline against recorded golden output.
 *
 * `corpus-goldens.ts` holds one SHA-256 per corpus case, recorded from the
 * pipeline as it stands today. This is what will keep the default backend
 * honest when generation moves behind a renderer IR: a byte change anywhere in
 * a package fails here, and can only be accepted by editing a golden and
 * saying why.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { CORPUS } from './fixtures/corpus';
import { CORPUS_GOLDENS } from './fixtures/corpus-goldens';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

describe('DOCX corpus goldens', () => {
  it('covers every recorded golden and records every corpus case', () => {
    expect([...CORPUS.map((c) => c.name)].sort()).toEqual(
      Object.keys(CORPUS_GOLDENS).sort()
    );
  });

  it('has no duplicate case names', () => {
    const names = CORPUS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CORPUS.map((c) => [c.name, c] as const))(
    'reproduces the golden package for %s',
    async (name, testCase) => {
      const buffer = await generateBufferFromJson(
        structuredClone(testCase.document) as never
      );

      expect(sha256(buffer as Buffer)).toBe(CORPUS_GOLDENS[name]);
    },
    30_000
  );

  it('produces identical bytes on a second run', async () => {
    const [first] = CORPUS;
    const a = await generateBufferFromJson(
      structuredClone(first.document) as never
    );
    const b = await generateBufferFromJson(
      structuredClone(first.document) as never
    );

    expect((a as Buffer).equals(b as Buffer)).toBe(true);
  });
});
