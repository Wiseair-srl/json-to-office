import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderForJudging } from './render.js';
import { main } from './shipping-cli.js';

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
