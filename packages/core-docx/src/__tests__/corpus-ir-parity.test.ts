/**
 * The DocxIR path against the same recorded goldens as the pre-IR writer.
 *
 * `corpus-goldens.ts` holds one SHA-256 per case, recorded from the pipeline
 * before any of this existed. Reproducing those hashes through the IR is the
 * whole claim of the migration — that nothing about any document changed — and
 * it is a claim that has to be checked case by case rather than asserted.
 *
 * A failure here means one of two things, and the difference matters: either
 * the compiler lost something, or the IR is right and the pre-IR writer was
 * wrong. Only the second is a reason to edit a golden, and only with the
 * divergence written down.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../core/generateFromIr';
import { CORPUS } from './fixtures/corpus';
import { CORPUS_GOLDENS } from './fixtures/corpus-goldens';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

describe('DOCX corpus through DocxIR', () => {
  it.each(CORPUS.map((c) => [c.name, c] as const))(
    'reproduces the golden package for %s',
    async (name, testCase) => {
      const { buffer } = await generateBufferViaIr(
        structuredClone(testCase.document) as never
      );

      expect(sha256(buffer)).toBe(CORPUS_GOLDENS[name]);
    },
    30_000
  );

  it('lowers every corpus case, refusing nothing', async () => {
    const refused: string[] = [];
    for (const testCase of CORPUS) {
      const compiled = await compileDocumentToIr(
        structuredClone(testCase.document) as never
      );
      for (const item of compiled.unsupported) {
        refused.push(
          `${testCase.name}: ${item.name}${item.detail ? ` (${item.detail})` : ''} at ${item.path}`
        );
      }
    }

    expect(refused).toEqual([]);
  }, 120_000);

  it('produces identical bytes on a second run', async () => {
    const [first] = CORPUS;
    const a = await generateBufferViaIr(
      structuredClone(first.document) as never
    );
    const b = await generateBufferViaIr(
      structuredClone(first.document) as never
    );

    expect(a.buffer.equals(b.buffer)).toBe(true);
  });
});
