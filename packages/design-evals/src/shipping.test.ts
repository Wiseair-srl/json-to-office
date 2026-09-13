import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_DEFINITIONS,
  definitionHash,
  pageDefects,
  promptDigest,
  ships,
  SHIPPING_QUESTIONS,
  type ShippingDefinition,
} from './shipping.js';
import { rubricPrompt, SHIPPING_QUESTION } from './rubric.js';

const base: ShippingDefinition = {
  id: 'test',
  summary: 'test',
  question: 'v1',
  judgeAnswer: false,
  minimumLevel: 0,
  noIntegrityDefect: false,
};

const facts = (overrides: Partial<Parameters<typeof ships>[1]> = {}) => ({
  outcome: 'completed' as const,
  judge: { level: 4, wouldShip: true },
  qualityByCode: {},
  ...overrides,
});

describe('ships', () => {
  it('never ships a failed run, whatever the definition asks', () => {
    expect(ships(base, facts({ outcome: 'failed' }))).toBe(false);
  });

  it('follows the judge when the definition reads its answer', () => {
    const answer = { ...base, judgeAnswer: true };
    expect(ships(answer, facts())).toBe(true);
    expect(
      ships(answer, facts({ judge: { level: 5, wouldShip: false } }))
    ).toBe(false);
  });

  it('holds a level floor', () => {
    const floor = { ...base, minimumLevel: 4 };
    expect(ships(floor, facts({ judge: { level: 4, wouldShip: false } }))).toBe(
      true
    );
    expect(ships(floor, facts({ judge: { level: 3, wouldShip: true } }))).toBe(
      false
    );
  });

  it('cannot decide without a verdict it needs, and says so', () => {
    expect(
      ships({ ...base, minimumLevel: 3 }, facts({ judge: undefined }))
    ).toBe(undefined);
    // A definition that reads no verdict decides without one.
    expect(
      ships({ ...base, noIntegrityDefect: true }, facts({ judge: undefined }))
    ).toBe(true);
  });

  it('refuses any integrity defect, static or rendered', () => {
    const clean = { ...base, noIntegrityDefect: true };
    expect(
      ships(clean, facts({ qualityByCode: { W_QUALITY_RENDERED_CLIP: 1 } }))
    ).toBe(false);
    expect(
      ships(clean, facts({ qualityByCode: { W_QUALITY_TEXT_OVERFLOW: 2 } }))
    ).toBe(false);
    expect(
      ships(clean, facts({ qualityByCode: { W_QUALITY_OFF_PALETTE: 9 } }))
    ).toBe(true);
  });

  it('counts empty and under-filled pages together against a ceiling', () => {
    const pages = { ...base, maximumPageDefects: 1 };
    expect(
      ships(
        pages,
        facts({ qualityByCode: { W_QUALITY_RENDERED_PAGE_UNDERFILLED: 1 } })
      )
    ).toBe(true);
    expect(
      ships(
        pages,
        facts({
          qualityByCode: {
            W_QUALITY_RENDERED_PAGE_UNDERFILLED: 1,
            W_QUALITY_RENDERED_EMPTY_PAGE: 1,
          },
        })
      )
    ).toBe(false);
    expect(
      pageDefects({
        W_QUALITY_RENDERED_PAGE_UNDERFILLED: 2,
        W_QUALITY_RENDERED_EMPTY_PAGE: 1,
        W_QUALITY_RENDERED_CLIP: 4,
      })
    ).toBe(3);
  });
});

describe('the candidate definitions', () => {
  it('start from the status quo: the judge answering the current question', () => {
    expect(SHIPPING_QUESTIONS.v1).toBe(SHIPPING_QUESTION);
    expect(CANDIDATE_DEFINITIONS[0]).toMatchObject({
      question: 'v1',
      judgeAnswer: true,
      minimumLevel: 0,
      noIntegrityDefect: false,
    });
  });

  it('have unique ids, a summary each, and questions that exist', () => {
    const ids = CANDIDATE_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of CANDIDATE_DEFINITIONS) {
      expect(definition.summary.length).toBeGreaterThan(20);
      expect(SHIPPING_QUESTIONS[definition.question]).toBeTypeOf('string');
    }
  });

  it('are identified by content, so an edited definition is a different one', () => {
    const [first] = CANDIDATE_DEFINITIONS;
    expect(definitionHash(first)).toBe(definitionHash({ ...first }));
    expect(definitionHash(first)).not.toBe(
      definitionHash({ ...first, minimumLevel: first.minimumLevel + 1 })
    );
    // The question's wording is part of what was frozen, not just its id.
    expect(definitionHash(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('name the whole prompt a judge sitting read by its digest', () => {
    expect(promptDigest('v1')).toBe(
      createHash('sha256')
        .update(rubricPrompt(SHIPPING_QUESTIONS.v1))
        .digest('hex')
    );
    expect(promptDigest('v1')).not.toBe(promptDigest('v2'));
  });
});
