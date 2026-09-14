import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeDocument } from './analyze.js';
import { RenderError, renderForJudging } from './render.js';
import { freezeDefinition } from './shipping-calibration.js';
import { main } from './shipping-cli.js';
import {
  CANDIDATE_DEFINITIONS,
  definitionHash,
  promptDigest,
  type ShippingDefinition,
} from './shipping.js';

vi.mock('./analyze.js', async (original) => ({
  ...(await original<typeof import('./analyze.js')>()),
  analyzeDocument: vi.fn(),
}));
vi.mock('./render.js', async (original) => ({
  ...(await original<typeof import('./render.js')>()),
  renderForJudging: vi.fn(),
}));

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

/**
 * A recorded set on disk, the way the runner leaves one: a scorecard, and a
 * delivered document in `runs/<brief>/` for every completed run.
 */
async function writeSet(
  runs: ReadonlyArray<{ briefId: string; format: string; outcome?: string }>
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-cli-'));
  dirs.push(dir);
  const recorded = runs.map((run) => ({ outcome: 'completed', ...run }));
  await fs.writeFile(
    path.join(dir, 'scorecard.json'),
    JSON.stringify({ runs: recorded })
  );
  for (const { briefId, outcome } of recorded) {
    if (outcome !== 'completed') continue;
    await fs.mkdir(path.join(dir, 'runs', briefId), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'runs', briefId, 'document.json'),
      JSON.stringify({ id: briefId })
    );
  }
  return dir;
}

describe('pnpm shipping sheets', () => {
  it('renders every sheet it can when one render fails, and names the failure', async () => {
    const dir = await writeSet([
      { briefId: 'cd-broken', format: 'pptx' },
      { briefId: 'cd-fine', format: 'pptx' },
    ]);
    // One converter crash must not leave every later document without a sheet.
    vi.mocked(renderForJudging).mockImplementation(
      async (_format, document) => {
        if ((document as { id: string }).id === 'cd-broken') {
          throw new RenderError(
            'Preview failed at the convert stage: Command failed: /Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf preview.pptx\nUnspecified Application Error',
            'convert'
          );
        }
        return { sheet: { png: Buffer.from('png') }, totalPages: 3 } as never;
      }
    );

    const lines: string[] = [];
    const code = await main(['sheets', dir], (text) => lines.push(text));

    expect(code).toBe(1);
    await expect(
      fs.readFile(
        path.join(dir, 'runs', 'cd-fine', 'contact-sheet.png'),
        'utf8'
      )
    ).resolves.toBe('png');
    const output = lines.join('\n');
    expect(output).toContain('cd-broken: render failed at the convert stage');
    expect(output).not.toContain('soffice');
    expect(output).toContain('1 contact sheet(s) rendered');
    expect(output).toContain('1 failed');
  });
});

describe('pnpm shipping verify', () => {
  it('records the judge sittings it read and every artifact outside the denominator', async () => {
    const briefs = ['tr-a', 'tr-b', 'tr-c', 'tr-d'];
    const levels = [4, 4, 3, 3];
    const set = await writeSet([
      ...briefs.map((briefId) => ({ briefId, format: 'docx' })),
      // Completed, but never shown to the reviewer: it has no sheet.
      { briefId: 'tr-e', format: 'docx' },
      { briefId: 'tr-f', format: 'docx', outcome: 'failed' },
    ]);
    await fs.writeFile(
      path.join(set, 'facts.json'),
      JSON.stringify({
        source: 'reanalysis',
        runs: Object.fromEntries(
          [...briefs, 'tr-e'].map((briefId) => [briefId, { qualityByCode: {} }])
        ),
      })
    );
    await fs.writeFile(
      path.join(set, 'sitting-v1.json'),
      JSON.stringify({
        question: 'v1',
        judgeModel: 'claude-opus-5',
        judgedAt: '2026-09-14T08:00:00.000Z',
        promptSha256: promptDigest('v1'),
        runs: briefs.map((briefId, index) => ({
          briefId,
          run: briefId,
          now: { level: levels[index], wouldShip: false, genericness: 2 },
        })),
      })
    );
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-verify-'));
    dirs.push(work);
    const human = path.join(work, 'human.json');
    await fs.writeFile(
      human,
      JSON.stringify({
        question:
          'After reading its argument, would you send this to the client unchanged?',
        readAt: '2026-09-14T09:00:00.000Z',
        verdicts: briefs.map((run, index) => ({
          set: 'verification',
          run,
          wouldShip: levels[index] >= 4,
        })),
      })
    );
    const definition = path.join(work, 'definition.json');
    await fs.writeFile(
      definition,
      JSON.stringify(
        freezeDefinition(
          CANDIDATE_DEFINITIONS.find((entry) => entry.id === 'excellent')!,
          {
            frozenAt: new Date('2026-09-13T20:00:00.000Z'),
            evidence: {
              scores: [],
              chosen: 'excellent',
              reason: 'test',
              briefs: ['cr-z'],
            },
          }
        )
      )
    );
    const record = path.join(work, 'record.json');

    const lines: string[] = [];
    const code = await main(
      [
        'verify',
        '--definition',
        definition,
        '--set',
        `verification=${set}`,
        '--human',
        human,
        '--record',
        record,
      ],
      (text) => lines.push(text)
    );

    expect(code, lines.join('\n')).toBe(0);
    const [attempt] = JSON.parse(await fs.readFile(record, 'utf8')).attempts;
    expect(attempt.passed).toBe(true);
    expect(attempt.allocation.sittings).toEqual([
      {
        set: 'verification',
        question: 'v1',
        judgeModel: 'claude-opus-5',
        judgedAt: '2026-09-14T08:00:00.000Z',
        promptSha256: promptDigest('v1'),
      },
    ]);
    expect(attempt.allocation.outside).toEqual([
      { set: 'verification', run: 'tr-e', reason: 'no contact sheet' },
      { set: 'verification', run: 'tr-f', reason: 'run failed' },
    ]);
    expect(lines.join('\n')).toContain('2 artifact(s) outside the denominator');
  });

  it('refuses verdicts that do not say what the reviewer was asked', async () => {
    const set = await writeSet([{ briefId: 'tr-a', format: 'docx' }]);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-verify-'));
    dirs.push(work);
    const human = path.join(work, 'human.json');
    await fs.writeFile(
      human,
      JSON.stringify({
        readAt: '2026-09-14T09:00:00.000Z',
        verdicts: [{ set: 'verification', run: 'tr-a', wouldShip: true }],
      })
    );
    const definition = path.join(work, 'definition.json');
    await fs.writeFile(
      definition,
      JSON.stringify(
        freezeDefinition(CANDIDATE_DEFINITIONS[0], {
          frozenAt: new Date('2026-09-13T20:00:00.000Z'),
          evidence: { scores: [], chosen: 'x', reason: 'test', briefs: [] },
        })
      )
    );
    const lines: string[] = [];
    const code = await main(
      [
        'verify',
        '--definition',
        definition,
        '--set',
        `verification=${set}`,
        '--human',
        human,
        '--record',
        path.join(work, 'record.json'),
      ],
      (text) => lines.push(text)
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('carries no question');
  });
});

describe('pnpm shipping reanalyze', () => {
  it('leaves a document it could not render out of the facts, and fails so it is rerun', async () => {
    const dir = await writeSet([
      { briefId: 'cd-unrenderable', format: 'pptx' },
      { briefId: 'cd-fine', format: 'pptx' },
    ]);
    // A failed render falls back to counting slides and drops every rendered
    // finding, so the facts say less than they seem to.
    vi.mocked(analyzeDocument).mockImplementation(async (_format, document) =>
      (document as { id: string }).id === 'cd-unrenderable'
        ? { diagnostics: [], pages: 11, pageCountSource: 'structural' }
        : { diagnostics: [], pages: 10, pageCountSource: 'rendered' }
    );

    const lines: string[] = [];
    const code = await main(['reanalyze', dir], (text) => lines.push(text));

    expect(code).toBe(1);
    const output = lines.join('\n');
    expect(output).toContain(
      'cd-unrenderable: not rendered — left out of facts.json'
    );
    expect(output).toContain('1 of 2 document(s) could not be rendered');
    // Its findings would read as none, which a definition takes as clean.
    const facts = JSON.parse(
      await fs.readFile(path.join(dir, 'facts.json'), 'utf8')
    );
    expect(facts.runs['cd-unrenderable']).toBeUndefined();
    expect(facts.runs['cd-fine'].pageCountSource).toBe('rendered');
  });
});

describe('pnpm shipping freeze', () => {
  const custom: ShippingDefinition = {
    id: 'custom-level',
    summary: 'Level three or above, written into this calibration only.',
    question: 'v1',
    judgeAnswer: false,
    minimumLevel: 3,
    noIntegrityDefect: false,
  };
  const manifest = (hash: string, chosen = custom.id) => ({
    candidates: [{ definition: custom, score: { id: custom.id, hash } }],
    choice: { chosen, reason: 'highest kappa (0.70)' },
    allocation: { calibration: [{ briefs: ['cr-a', 'cr-b'] }] },
    generatedAt: '2026-09-13T20:00:00.000Z',
    gitSha: 'abc',
  });
  const freeze = async (calibration: unknown) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-freeze-'));
    dirs.push(dir);
    const file = path.join(dir, 'calibration.json');
    const out = path.join(dir, 'definition.json');
    await fs.writeFile(file, JSON.stringify(calibration));
    const lines: string[] = [];
    const code = await main(
      ['freeze', '--calibration', file, '--out', out],
      (text) => lines.push(text)
    );
    return { code, lines, out };
  };

  it('freezes the definition the calibration scored, not the one the code holds now', async () => {
    const { code, lines, out } = await freeze(manifest(definitionHash(custom)));
    expect(code, lines.join('\n')).toBe(0);
    const frozen = JSON.parse(await fs.readFile(out, 'utf8'));
    expect(frozen.definition).toEqual(custom);
    expect(frozen.hash).toBe(definitionHash(custom));
    expect(frozen.calibration.briefs).toEqual(['cr-a', 'cr-b']);
  });

  it('refuses a definition whose terms or prompt no longer hash as they were scored', async () => {
    const { code, lines } = await freeze(manifest('f'.repeat(64)));
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('calibrate again');
  });

  it('refuses a candidate the calibration never scored', async () => {
    const { code, lines } = await freeze(
      manifest(definitionHash(custom), 'nowhere')
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('"nowhere"');
  });
});
