/**
 * The judge and its calibration, driven by a scripted vision model.
 *
 * What is worth pinning here is the harness's handling of an opinion, not the
 * opinion: that a malformed answer is refused rather than scored, that the
 * brief reaches the judge so level 4 can be assessed at all, that an unrated
 * calibration pair is reported rather than averaged away.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCalibrationSheet,
  calibrationReport,
  judgeIsCalibrated,
  ordersFirst,
  type CalibrationSheet,
} from './calibration.js';
import { JudgeError, judgeDocument, judgePair, parseJson } from './judge.js';
import type { Brief } from './corpus.js';
import { RUBRIC, rubricPrompt, SHIPPING_QUESTION } from './rubric.js';

const BRIEF: Brief = {
  id: 'sample-brief',
  format: 'docx',
  archetype: 'client-report',
  language: 'en',
  density: 'medium',
  title: 'Market entry assessment',
  text: 'Assess entry into the Nordic region with the numbers given.',
  hash: 'a'.repeat(64),
};

const SHEET = { png: Buffer.from([1, 2, 3]), label: 'candidate' };

function call(value: unknown, capture?: { last?: unknown }) {
  return async (input: unknown) => {
    if (capture) capture.last = input;
    return { value, inputTokens: 900, outputTokens: 120 };
  };
}

describe('rubricPrompt', () => {
  it('is generated from the rubric table, so the two cannot drift', () => {
    const prompt = rubricPrompt();
    for (const level of RUBRIC) {
      expect(prompt).toContain(level.name);
      expect(prompt).toContain(level.bar);
    }
    expect(prompt).toContain(SHIPPING_QUESTION);
  });

  it('states that a lower failure outranks a higher success', () => {
    expect(rubricPrompt()).toMatch(/NEVER compensates/);
  });
});

describe('judgeDocument', () => {
  it('returns the verdict and what the call cost', async () => {
    const result = await judgeDocument({
      brief: BRIEF,
      sheet: SHEET,
      call: call({
        level: 4,
        wouldShip: true,
        genericness: 1,
        rationale: 'Page 3 states its takeaway; the KPI row aligns.',
      }),
    });
    expect(result.verdict).toMatchObject({ level: 4, wouldShip: true });
    expect(result).toMatchObject({ inputTokens: 900, outputTokens: 120 });
  });

  it('gives the judge the brief, so level 4 can be assessed at all', async () => {
    // "Does the structure fit the purpose" is unanswerable without the
    // purpose, and a judge without it silently scores something else.
    const capture: { last?: any } = {};
    await judgeDocument({
      brief: BRIEF,
      sheet: SHEET,
      call: call(
        { level: 3, wouldShip: false, genericness: 2, rationale: 'x' },
        capture
      ),
    });
    expect(capture.last.text).toContain(BRIEF.text);
    expect(capture.last.text).toContain(BRIEF.title);
    expect(capture.last.images).toHaveLength(1);
  });

  it('refuses an answer that is not a verdict rather than scoring it', async () => {
    await expect(
      judgeDocument({
        brief: BRIEF,
        sheet: SHEET,
        call: call({ level: 9, wouldShip: 'maybe' }),
      })
    ).rejects.toThrow(JudgeError);
  });
});

describe('judgePair', () => {
  it('names both sides so the rationale can be read against them', async () => {
    const capture: { last?: any } = {};
    const result = await judgePair({
      brief: BRIEF,
      a: { png: Buffer.from([1]), label: 'baseline' },
      b: { png: Buffer.from([2]), label: 'phase-1' },
      call: call(
        { winner: 'b', margin: 'clear', rationale: 'Cover and rhythm.' },
        capture
      ),
    });
    expect(result.verdict.winner).toBe('b');
    expect(capture.last.text).toContain('baseline');
    expect(capture.last.text).toContain('phase-1');
    expect(capture.last.images).toHaveLength(2);
  });

  it('refuses a comparison with no winner in it', async () => {
    await expect(
      judgePair({
        brief: BRIEF,
        a: SHEET,
        b: SHEET,
        call: call({ rationale: 'both fine' }),
      })
    ).rejects.toThrow(JudgeError);
  });
});

describe('parseJson', () => {
  it('reads a fenced answer, a bare one, and one with commentary around it', () => {
    expect(parseJson('```json\n{"level":3}\n```')).toEqual({ level: 3 });
    expect(parseJson('{"level":3}')).toEqual({ level: 3 });
    expect(parseJson('Here it is: {"level":3} — hope that helps.')).toEqual({
      level: 3,
    });
  });

  it('says the reply had no JSON rather than returning undefined', () => {
    expect(() => parseJson('I would not ship this.')).toThrow(JudgeError);
  });
});

describe('ordersFirst', () => {
  it('is stable for a pair and mixed across pairs', () => {
    // A rater shown the new work in the same position every time learns the
    // position.
    expect(ordersFirst('pair-1')).toBe(ordersFirst('pair-1'));
    const ids = Array.from({ length: 40 }, (_, index) => `pair-${index}`);
    const first = ids.filter(ordersFirst).length;
    expect(first).toBeGreaterThan(10);
    expect(first).toBeLessThan(30);
  });
});

describe('calibration', () => {
  function sheet(
    rows: Array<{ human: '' | 'a' | 'b' | 'tie'; judge: 'a' | 'b' | 'tie' }>
  ): CalibrationSheet {
    return buildCalibrationSheet({
      pairs: rows.map((row, index) => ({
        id: `pair-${index}`,
        briefId: `brief-${index}`,
        a: { label: 'baseline', sheetPath: '/a.png' },
        b: { label: 'candidate', sheetPath: '/b.png' },
        judge: { winner: row.judge, margin: 'clear', rationale: 'because' },
      })),
      now: new Date('2026-09-03T10:00:00Z'),
    }) as CalibrationSheet & { pairs: Array<{ human: string }> };
  }

  function rate(
    built: CalibrationSheet,
    humans: Array<'' | 'a' | 'b' | 'tie'>
  ): CalibrationSheet {
    return {
      ...built,
      pairs: built.pairs.map((pair, index) => ({
        ...pair,
        human: humans[index],
      })),
    };
  }

  it('leaves the human column blank and records the judge answer', () => {
    const built = sheet([{ human: '', judge: 'a' }]);
    expect(built.pairs[0].human).toBe('');
    expect(built.pairs[0].judge).toBe('a');
    expect(built.question).toContain('which document you would rather send');
  });

  it('reports agreement, kappa and an interval over the rated pairs', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      human: '' as const,
      judge: (index % 2 === 0 ? 'a' : 'b') as 'a' | 'b',
    }));
    const rated = rate(
      sheet(rows),
      rows.map((row, index) => (index === 9 ? 'a' : row.judge))
    );
    const report = calibrationReport(rated, { resamples: 400 });
    expect(report.n).toBe(10);
    expect(report.rawAgreement).toBe(0.9);
    expect(report.interval).toBeDefined();
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toMatchObject({ human: 'a', judge: 'b' });
  });

  it('drops unrated pairs and says how many there were', () => {
    // A half-filled sheet should say so, not average itself towards whichever
    // answer is more convenient.
    const rated = rate(
      sheet([
        { human: '', judge: 'a' },
        { human: '', judge: 'b' },
        { human: '', judge: 'a' },
      ]),
      ['a', '', 'a']
    );
    const report = calibrationReport(rated);
    expect(report.n).toBe(2);
    expect(report.unrated).toBe(1);
  });

  it('holds the judge to the programme threshold', () => {
    const rows = Array.from({ length: 10 }, () => ({
      human: '' as const,
      judge: 'a' as const,
    }));
    const agreeing = rate(
      sheet(rows),
      rows.map(() => 'a' as const)
    );
    const disagreeing = rate(
      sheet(rows),
      rows.map((_, index) => (index < 5 ? 'a' : 'b')) as Array<'a' | 'b'>
    );
    expect(judgeIsCalibrated(calibrationReport(agreeing))).toBe(true);
    expect(judgeIsCalibrated(calibrationReport(disagreeing))).toBe(false);
  });
});
