/**
 * The IR pipeline against the same goldens as the default pipeline.
 *
 * This is the evidence that routing generation through PptxIR changes nothing:
 * every corpus case must produce the exact bytes recorded before the IR
 * existed. Once the default is switched over, `corpus-goldens.test.ts` becomes
 * this test — until then, the two run side by side.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import { CORPUS } from '../../../__tests__/fixtures/corpus';
import { CORPUS_GOLDENS } from '../../../__tests__/fixtures/corpus-goldens';

describe('PptxIR pipeline against the recorded goldens', () => {
  it.each(CORPUS.map((c) => [c.name, c] as const))(
    'reproduces the golden package for %s',
    async (name, testCase) => {
      const { buffer } = await generateBufferViaIr(
        structuredClone(testCase.document) as never
      );

      expect(createHash('sha256').update(buffer).digest('hex')).toBe(
        CORPUS_GOLDENS[name]
      );
    }
  );
});
