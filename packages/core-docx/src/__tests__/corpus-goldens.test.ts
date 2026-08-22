/**
 * The DOCX pipeline against recorded golden output.
 *
 * `corpus-goldens.ts` holds one digest per corpus case, covering every part of
 * the package. This is what keeps the default backend honest now that
 * generation is behind a renderer IR: a change to any part fails here, and can
 * only be accepted by editing a golden and saying why.
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

      expect(packageDigest(buffer as Buffer)).toBe(CORPUS_GOLDENS[name]);
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
