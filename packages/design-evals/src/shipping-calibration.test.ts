import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildEvidence,
  chooseDefinition,
  freezeDefinition,
  humanJudgments,
  humanRepeatability,
  admitVerification,
  authorVariance,
  labelArtifacts,
  loadShippingSemantics,
  recordedFacts,
  scoreDefinition,
  sittingAgreement,
  verifyDefinition,
  type EvidenceRow,
} from './shipping-calibration.js';
import {
  CANDIDATE_DEFINITIONS,
  definitionHash,
  promptDigest,
  type ShippingDefinition,
} from './shipping.js';

const round = (id: string, verdicts: Array<[string, string, boolean]>) => ({
  id,
  file: {
    verdicts: verdicts.map(([set, run, wouldShip]) => ({
      set,
      run,
      wouldShip,
      reasons: [],
      at: '2026-09-08T07:00:00.000Z',
    })),
  },
});

describe('human judgments', () => {
  const judgments = humanJudgments([
    round('r1', [
      ['before', 'cr-a#1', true],
      ['before', 'cr-a#2', false],
      ['after', 'cr-a#1', true],
    ]),
    round('r2', [
      ['before', 'cr-a#1', true],
      ['before', 'cr-a#2', true],
      ['after-exhibits', 'cr-b#1', false],
    ]),
  ]);

  it('identifies an artifact by set and run, and its brief by the run', () => {
    expect(judgments).toContainEqual({
      artifact: 'before/cr-a#2',
      set: 'before',
      run: 'cr-a#2',
      briefId: 'cr-a',
      round: 'r2',
      ship: true,
      at: '2026-09-08T07:00:00.000Z',
    });
  });

  it('labels an artifact by what every judgment of it agreed on, and marks a conflict unstable', () => {
    const labels = Object.fromEntries(
      labelArtifacts(judgments).map((entry) => [entry.artifact, entry.label])
    );
    expect(labels).toEqual({
      'after-exhibits/cr-b#1': false,
      'after/cr-a#1': true,
      'before/cr-a#1': true,
      'before/cr-a#2': 'unstable',
    });
  });

  it('measures the reviewer against themselves on every artifact judged twice', () => {
    const report = humanRepeatability(judgments);
    expect(report.n).toBe(2);
    expect(report.rawAgreement).toBe(0.5);
    expect(report.clusters).toBe(1);
  });
});

const row = (
  artifact: string,
  label: boolean | 'unstable',
  overrides: Partial<EvidenceRow> = {}
): EvidenceRow => ({
  artifact,
  briefId: artifact.split('/')[1].split('#')[0],
  format: 'docx',
  label,
  outcome: 'completed',
  qualityByCode: {},
  verdicts: { v1: { level: 4, wouldShip: false } },
  ...overrides,
});

const answer: ShippingDefinition = {
  id: 'answer',
  summary: 'The judge answers yes to the first question.',
  question: 'v1',
  judgeAnswer: true,
  minimumLevel: 0,
  noIntegrityDefect: false,
};
const level: ShippingDefinition = {
  id: 'level',
  summary: 'The judge places it at level four or above.',
  question: 'v1',
  judgeAnswer: false,
  minimumLevel: 4,
  noIntegrityDefect: false,
};
const pages: ShippingDefinition = {
  ...level,
  id: 'pages',
  summary: 'Level four or above with at most one page defect.',
  maximumPageDefects: 1,
};

describe('scoring a definition', () => {
  const rows: EvidenceRow[] = [
    row('before/cr-a#1', true),
    row('before/cr-a#2', false, {
      verdicts: { v1: { level: 3, wouldShip: false } },
    }),
    row('after/cr-b#1', true),
    row('after/cr-b#2', false, {
      verdicts: { v1: { level: 3, wouldShip: false } },
    }),
    row('after/cr-c#1', 'unstable'),
    row('after/cr-c#2', true, { verdicts: {} }),
  ];

  it('scores only stable, decidable artifacts and counts what it left out', () => {
    const score = scoreDefinition(level, rows);
    expect(score.id).toBe('level');
    expect(score.hash).toBe(definitionHash(level));
    expect(score.n).toBe(4);
    expect(score.excluded).toEqual({ unstable: 1, undecided: 1 });
    expect(score.kappa).toBe(1);
    expect(score.confusion).toEqual({
      bothShip: 2,
      bothHold: 2,
      humanOnly: 0,
      definitionOnly: 0,
    });
    expect(score.clusters).toBe(2);
  });

  it('reports each format on its own', () => {
    const mixed = [
      ...rows,
      row('deck/cd-a#1', true, { format: 'pptx' }),
      row('deck/cd-a#2', false, { format: 'pptx' }),
    ];
    const score = scoreDefinition(level, mixed);
    expect(score.byFormat.docx.n).toBe(4);
    expect(score.byFormat.pptx).toMatchObject({
      n: 2,
      confusion: { bothShip: 1, definitionOnly: 1 },
    });
  });
});

describe('choosing a definition', () => {
  const score = (id: string, kappa: number) => ({ id, kappa });

  it('takes the highest agreement', () => {
    expect(
      chooseDefinition(
        [score('answer', 0.2), score('level', 0.6)],
        [answer, level]
      ).chosen
    ).toBe('level');
  });

  it('within the margin, prefers a definition that reads no page term, then fewer terms', () => {
    const choice = chooseDefinition(
      [score('pages', 0.62), score('level', 0.6), score('answer', 0.1)],
      [answer, level, pages],
      { margin: 0.05 }
    );
    expect(choice.chosen).toBe('level');
    expect(choice.reason).toMatch(/page/);
  });

  it('names fewer terms when that is what decided', () => {
    const levelClean: ShippingDefinition = {
      ...level,
      id: 'level-clean',
      noIntegrityDefect: true,
    };
    const choice = chooseDefinition(
      [score('level-clean', 0.62), score('level', 0.6)],
      [levelClean, level],
      { margin: 0.05 }
    );
    expect(choice.chosen).toBe('level');
    expect(choice.reason).toMatch(/fewer terms/);
  });

  it('names what decided the choice when the order breaks the tie', () => {
    // Same page term, same number of terms: only the listed order separates them.
    const answerPages: ShippingDefinition = {
      ...answer,
      id: 'answer-pages',
      noIntegrityDefect: true,
      maximumPageDefects: 1,
    };
    const levelPages: ShippingDefinition = {
      ...pages,
      id: 'level-pages',
      noIntegrityDefect: true,
    };
    const choice = chooseDefinition(
      [score('level-pages', 0.66), score('answer-pages', 0.68)],
      [levelPages, answerPages],
      { margin: 0.05 }
    );
    expect(choice.chosen).toBe('level-pages');
    expect(choice.reason).not.toMatch(/fewer terms/);
    expect(choice.reason).toMatch(/listed first/);
  });

  it('never chooses a definition whose agreement is undefined', () => {
    expect(
      chooseDefinition(
        [score('answer', Number.NaN), score('level', 0.1)],
        [answer, level]
      ).chosen
    ).toBe('level');
  });
});

describe('freezing and verifying', () => {
  const frozen = freezeDefinition(level, {
    frozenAt: new Date('2026-09-11T18:00:00Z'),
    evidence: {
      scores: [],
      chosen: 'level',
      reason: 'best agreement',
      briefs: ['cr-a', 'cr-b'],
    },
  });
  const readAfter = {
    humanReadAt: '2026-09-11T19:00:00.000Z',
    sittings: [
      {
        question: 'v1' as const,
        judgedAt: '2026-09-11T18:30:00.000Z',
        promptSha256: promptDigest('v1'),
      },
    ],
  };

  it('freezes the definition with its hash and the evidence it was chosen on', () => {
    expect(frozen).toMatchObject({
      definition: level,
      hash: definitionHash(level),
      frozenAt: '2026-09-11T18:00:00.000Z',
      calibration: { chosen: 'level' },
    });
  });

  it('passes verification only at the target agreement, and says so either way', () => {
    const agreeing = [
      row('v/tr-a#1', true),
      row('v/tr-b#1', false, {
        verdicts: { v1: { level: 2, wouldShip: false } },
      }),
      row('v/tr-c#1', true),
      row('v/tr-d#1', false, {
        verdicts: { v1: { level: 3, wouldShip: false } },
      }),
    ];
    const pass = verifyDefinition(frozen, agreeing, readAfter);
    expect(pass.target).toBe(0.5);
    expect(pass.passed).toBe(true);

    const disagreeing = agreeing.map((entry) => ({
      ...entry,
      label: entry.label === true ? false : true,
    }));
    const fail = verifyDefinition(frozen, disagreeing, readAfter);
    expect(fail.passed).toBe(false);
    expect(fail.score.kappa).toBeLessThan(0.5);
  });

  it('refuses to verify a definition whose content changed after freezing', () => {
    expect(() =>
      verifyDefinition(
        { ...frozen, definition: { ...level, minimumLevel: 3 } },
        [],
        readAfter
      )
    ).toThrow(/hash/);
  });

  it('refuses a verification artifact from a brief the definition was calibrated on', () => {
    expect(() =>
      verifyDefinition(frozen, [row('v/cr-b#1', true)], readAfter)
    ).toThrow(/cr-b/);
  });

  it('refuses answers read before the definition was frozen', () => {
    expect(() =>
      verifyDefinition(frozen, [row('v/tr-a#1', true)], {
        ...readAfter,
        humanReadAt: '2026-09-11T17:59:00.000Z',
      })
    ).toThrow(/before/);
  });

  it('refuses a judge sitting that could have been seen before freezing', () => {
    const sitting = readAfter.sittings[0];
    // Judged before the freeze: its verdicts could have shaped the choice.
    expect(() =>
      verifyDefinition(frozen, [row('v/tr-a#1', true)], {
        ...readAfter,
        sittings: [{ ...sitting, judgedAt: '2026-09-11T17:30:00.000Z' }],
      })
    ).toThrow(/sitting/);
    // A sitting that does not say when it answered cannot show it came after.
    expect(() =>
      verifyDefinition(frozen, [row('v/tr-a#1', true)], {
        ...readAfter,
        sittings: [{ question: 'v1' }],
      })
    ).toThrow(/when/);
    // Another question's sitting is not the one the definition reads.
    expect(() =>
      verifyDefinition(frozen, [row('v/tr-a#1', true)], {
        ...readAfter,
        sittings: [
          sitting,
          { question: 'v2', judgedAt: '2026-09-11T17:30:00.000Z' },
        ],
      })
    ).not.toThrow();
  });

  it('refuses a judge sitting that read another prompt than the frozen one', () => {
    expect(() =>
      verifyDefinition(frozen, [row('v/tr-a#1', true)], {
        ...readAfter,
        sittings: [{ ...readAfter.sittings[0], promptSha256: 'f'.repeat(64) }],
      })
    ).toThrow(/prompt/);
  });

  describe('the verification record', () => {
    const attempt = (hash: string, briefs: string[], passed = false) => ({
      definition: 'x',
      hash,
      target: 0.5,
      passed,
      score: {} as never,
      set: { id: 'verification', briefs },
      verifiedAt: '2026-09-12T10:00:00.000Z',
      humanReadAt: '2026-09-12T09:00:00.000Z',
    });

    it('admits a first attempt on a set', () => {
      expect(() =>
        admitVerification(undefined, attempt('h1', ['tr-a', 'tr-b']))
      ).not.toThrow();
    });

    it('never lets a set verify a second definition: that is tuning on its outcome', () => {
      const record = { attempts: [attempt('h1', ['tr-a', 'tr-b'])] };
      expect(() =>
        admitVerification(record, attempt('h2', ['tr-b', 'tr-c']), 'retry')
      ).toThrow(/h1/);
    });

    it('lets the same definition try again on a set only with a stated reason, keeping both', () => {
      const record = { attempts: [attempt('h1', ['tr-a'])] };
      expect(() => admitVerification(record, attempt('h1', ['tr-a']))).toThrow(
        /reason/
      );
      expect(() =>
        admitVerification(
          record,
          attempt('h1', ['tr-a']),
          'the sitting crashed'
        )
      ).not.toThrow();
    });
  });

  it('keeps its candidates stable enough to freeze', () => {
    for (const definition of CANDIDATE_DEFINITIONS) {
      expect(
        freezeDefinition(definition, {
          frozenAt: new Date(0),
          evidence: { scores: [], chosen: definition.id, reason: 'test' },
        }).hash
      ).toBe(definitionHash(definition));
    }
  });
});

describe('assembling evidence', () => {
  const labels = labelArtifacts(
    humanJudgments([
      round('r1', [
        ['before', 'cr-a#1', true],
        ['before', 'cr-a#2', false],
      ]),
    ])
  );
  const set = {
    id: 'before',
    runs: [
      {
        label: 'cr-a#1',
        briefId: 'cr-a',
        format: 'docx',
        outcome: 'completed' as const,
      },
      {
        label: 'cr-a#2',
        briefId: 'cr-a',
        format: 'docx',
        outcome: 'completed' as const,
      },
      {
        label: 'cr-a#3',
        briefId: 'cr-a',
        format: 'docx',
        outcome: 'failed' as const,
      },
    ],
    facts: {
      'cr-a#1': { qualityByCode: { W_QUALITY_RENDERED_PAGE_UNDERFILLED: 1 } },
      'cr-a#2': { qualityByCode: { W_QUALITY_RENDERED_CLIP: 1 } },
    },
    sittings: {
      v1: {
        'cr-a#1': { level: 4, wouldShip: false },
        'cr-a#2': { level: 3, wouldShip: false },
      },
      v2: { 'cr-a#1': { level: 4, wouldShip: true } },
    },
  };

  it('joins each labelled artifact to its facts and to every sitting that judged it', () => {
    const rows = buildEvidence([set], labels);
    expect(rows).toEqual([
      {
        artifact: 'before/cr-a#1',
        briefId: 'cr-a',
        format: 'docx',
        label: true,
        outcome: 'completed',
        qualityByCode: { W_QUALITY_RENDERED_PAGE_UNDERFILLED: 1 },
        verdicts: {
          v1: { level: 4, wouldShip: false },
          v2: { level: 4, wouldShip: true },
        },
      },
      {
        artifact: 'before/cr-a#2',
        briefId: 'cr-a',
        format: 'docx',
        label: false,
        outcome: 'completed',
        qualityByCode: { W_QUALITY_RENDERED_CLIP: 1 },
        verdicts: { v1: { level: 3, wouldShip: false } },
      },
    ]);
  });

  it('refuses a labelled artifact the sets do not contain, rather than scoring around it', () => {
    const stray = labelArtifacts(
      humanJudgments([round('r1', [['after', 'cr-z#1', true]])])
    );
    expect(() => buildEvidence([set], stray)).toThrow(/after\/cr-z#1/);
  });

  it('refuses a completed run with no facts, rather than scoring it as clean', () => {
    const missing = { ...set, facts: {} };
    expect(() => buildEvidence([missing], labels)).toThrow(/facts/);
  });
});

describe('facts as they were when an artifact was judged', () => {
  const runs: Array<{ label: string; qualityByCode: Record<string, number> }> =
    [
      {
        label: 'cr-a#1',
        qualityByCode: {
          W_QUALITY_RENDERED_CLIP: 1,
          W_QUALITY_RENDERED_EMPTY_PAGE: 2,
          W_QUALITY_RENDERED_PAGE_UNDERFILLED: 5,
        },
      },
      { label: 'cr-a#2', qualityByCode: {} },
    ];

  it('keeps the recorded findings and takes page defects from the page-fill measure alone', () => {
    expect(
      recordedFacts(runs, {
        'cr-a#1': { underfilled: 2 },
        'cr-a#2': { underfilled: 0 },
      })
    ).toEqual({
      'cr-a#1': {
        qualityByCode: {
          W_QUALITY_RENDERED_CLIP: 1,
          W_QUALITY_RENDERED_PAGE_UNDERFILLED: 2,
        },
      },
      'cr-a#2': { qualityByCode: {} },
    });
  });

  it('refuses a run the measure never saw', () => {
    expect(() => recordedFacts(runs, { 'cr-a#1': { underfilled: 0 } })).toThrow(
      /cr-a#2/
    );
  });
});

describe('loading the shipping semantics a run set uses', () => {
  const excellentClean = CANDIDATE_DEFINITIONS.find(
    (definition) => definition.id === 'excellent-clean'
  )!;

  async function dirWith(files: Record<string, unknown>): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-semantics-'));
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), JSON.stringify(content));
    }
    return dir;
  }

  it('is the status quo, unverified, until a definition is frozen', async () => {
    const semantics = await loadShippingSemantics(await dirWith({}));
    expect(semantics).toEqual({
      definition: CANDIDATE_DEFINITIONS[0],
      verified: false,
    });
  });

  it('is the frozen definition once frozen, verified only by a passing verification of that hash', async () => {
    const frozen = freezeDefinition(excellentClean, {
      evidence: { scores: [], chosen: excellentClean.id, reason: 'test' },
    });
    expect(
      await loadShippingSemantics(
        await dirWith({ 'shipping-definition.json': frozen })
      )
    ).toEqual({ definition: excellentClean, verified: false });

    expect(
      await loadShippingSemantics(
        await dirWith({
          'shipping-definition.json': frozen,
          'shipping-verification.json': {
            attempts: [{ hash: frozen.hash, passed: true }],
          },
        })
      )
    ).toEqual({ definition: excellentClean, verified: true });

    expect(
      (
        await loadShippingSemantics(
          await dirWith({
            'shipping-definition.json': frozen,
            'shipping-verification.json': {
              attempts: [
                { hash: frozen.hash, passed: true },
                { hash: frozen.hash, passed: false },
              ],
            },
          })
        )
      ).verified
    ).toBe(false);
  });

  it('refuses a frozen file whose definition no longer hashes to what was frozen', async () => {
    const frozen = freezeDefinition(excellentClean, {
      evidence: { scores: [], chosen: excellentClean.id, reason: 'test' },
    });
    await expect(
      loadShippingSemantics(
        await dirWith({
          'shipping-definition.json': { ...frozen, hash: '0'.repeat(64) },
        })
      )
    ).rejects.toThrow(/hash/);
  });
});

describe('variance, reported apart', () => {
  it('measures one sitting against another on the artifacts both judged', () => {
    const agreement = sittingAgreement(
      {
        'cr-a#1': { level: 4, wouldShip: true },
        'cr-a#2': { level: 3, wouldShip: false },
        'cr-b#1': { level: 4, wouldShip: false },
        'cr-c#1': { level: 2, wouldShip: false },
      },
      {
        'cr-a#1': { level: 4, wouldShip: true },
        'cr-a#2': { level: 4, wouldShip: false },
        'cr-b#1': { level: 4, wouldShip: true },
      }
    );
    expect(agreement.n).toBe(3);
    expect(agreement.wouldShip.rawAgreement).toBeCloseTo(2 / 3, 10);
    expect(agreement.level.rawAgreement).toBeCloseTo(2 / 3, 10);
  });

  it('says how much the author varies: briefs whose passes the reviewer split, and the judge level range across passes', () => {
    const variance = authorVariance(
      [
        row('s/cr-a#1', true, {
          verdicts: { v1: { level: 4, wouldShip: true } },
        }),
        row('s/cr-a#2', false, {
          verdicts: { v1: { level: 2, wouldShip: false } },
        }),
        row('s/cr-a#3', 'unstable', {
          verdicts: { v1: { level: 3, wouldShip: false } },
        }),
        row('s/cr-b#1', true, {
          verdicts: { v1: { level: 4, wouldShip: true } },
        }),
        row('s/cr-b#2', true, {
          verdicts: { v1: { level: 4, wouldShip: true } },
        }),
      ],
      'v1'
    );
    expect(variance).toEqual({
      briefs: 2,
      briefsTheReviewerSplit: 1,
      meanJudgeLevelRange: 1,
    });
  });
});
