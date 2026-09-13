import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeDocument } from './analyze.js';
import { renderForJudging } from './render.js';
import { freezeDefinition } from './shipping-calibration.js';
import { main } from './shipping-cli.js';
import { CANDIDATE_DEFINITIONS } from './shipping.js';

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

describe('pnpm shipping sheets', () => {
  it('renders every sheet it can when one render fails, and names the failure', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-cli-'));
    dirs.push(dir);
    const runs = ['cd-broken', 'cd-fine'].map((briefId) => ({
      briefId,
      format: 'pptx',
      outcome: 'completed',
    }));
    await fs.writeFile(
      path.join(dir, 'scorecard.json'),
      JSON.stringify({ runs })
    );
    for (const { briefId } of runs) {
      await fs.mkdir(path.join(dir, 'runs', briefId), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'runs', briefId, 'document.json'),
        JSON.stringify({ id: briefId })
      );
    }
    // One converter crash must not leave every later document without a sheet.
    vi.mocked(renderForJudging).mockImplementation(
      async (_format, document) => {
        if ((document as { id: string }).id === 'cd-broken') {
          throw new Error(
            'Preview failed at the convert stage: Command failed:\n/Applications/LibreOffice.app/Contents/MacOS/soffice --headless'
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
    expect(output).toContain(
      'cd-broken: render failed — Preview failed at the convert stage: Command failed:'
    );
    expect(output).not.toContain('soffice');
    expect(output).toContain('1 contact sheet(s) rendered');
    expect(output).toContain('1 failed');
  });
});

describe('pnpm shipping verify', () => {
  it('records which judge sitting the verification read, beside the definition hash', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-verify-'));
    dirs.push(dir);
    const set = path.join(dir, 'set');
    await fs.mkdir(set);
    const briefs = ['tr-a', 'tr-b', 'tr-c', 'tr-d'];
    const levels = [4, 4, 3, 3];
    await fs.writeFile(
      path.join(set, 'scorecard.json'),
      JSON.stringify({
        runs: briefs.map((briefId) => ({
          briefId,
          format: 'docx',
          outcome: 'completed',
        })),
      })
    );
    await fs.writeFile(
      path.join(set, 'facts.json'),
      JSON.stringify({
        source: 'reanalysis',
        runs: Object.fromEntries(
          briefs.map((briefId) => [briefId, { qualityByCode: {} }])
        ),
      })
    );
    await fs.writeFile(
      path.join(set, 'sitting-v1.json'),
      JSON.stringify({
        question: 'v1',
        judgeModel: 'claude-opus-5',
        judgedAt: '2026-09-14T08:00:00.000Z',
        runs: briefs.map((briefId, index) => ({
          briefId,
          run: briefId,
          now: { level: levels[index], wouldShip: false, genericness: 2 },
        })),
      })
    );
    const human = path.join(dir, 'human.json');
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
    const definition = path.join(dir, 'definition.json');
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
    const record = path.join(dir, 'record.json');

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
      },
    ]);
  });
});

describe('pnpm shipping reanalyze', () => {
  it('names the documents it could not render instead of counting their pages quietly', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipping-facts-'));
    dirs.push(dir);
    const runs = ['cd-unrenderable', 'cd-fine'].map((briefId) => ({
      briefId,
      format: 'pptx',
      outcome: 'completed',
    }));
    await fs.writeFile(
      path.join(dir, 'scorecard.json'),
      JSON.stringify({ runs })
    );
    for (const { briefId } of runs) {
      await fs.mkdir(path.join(dir, 'runs', briefId), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'runs', briefId, 'document.json'),
        JSON.stringify({ id: briefId })
      );
    }
    // A failed render falls back to counting slides and drops every rendered
    // finding, so the facts say less than they seem to.
    vi.mocked(analyzeDocument).mockImplementation(async (_format, document) =>
      (document as { id: string }).id === 'cd-unrenderable'
        ? { diagnostics: [], pages: 11, pageCountSource: 'structural' }
        : { diagnostics: [], pages: 10, pageCountSource: 'rendered' }
    );

    const lines: string[] = [];
    const code = await main(['reanalyze', dir], (text) => lines.push(text));

    expect(code).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain(
      'cd-unrenderable: 11 page(s), counted without a render — no rendered findings'
    );
    expect(output).toContain('1 of 2 document(s) could not be rendered');
    const facts = JSON.parse(
      await fs.readFile(path.join(dir, 'facts.json'), 'utf8')
    );
    expect(facts.runs['cd-unrenderable'].pageCountSource).toBe('structural');
  });
});
