import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(packageRoot, '../..');

// Minimal docx fixture that exercises rendering without external font fetches.
const fixture = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { level: 1, text: 'Exit test' } },
        { name: 'paragraph', props: { text: 'Hello.' } },
      ],
    },
  ],
};

// Regression guard for the MemoryCache cleanup setInterval leak that kept
// `jto-cli docx generate` alive for ~5 minutes after the buffer was written
// (packages/shared/src/cache/memory-cache.ts startCleanupTimer).
describe('jto-cli docx generate exits promptly', () => {
  it('exits within 30s of writing the output file', async () => {
    const cliPath = path.join(packageRoot, 'dist', 'cli.js');
    if (!existsSync(cliPath)) {
      // In CI, dist/cli.js must exist — turbo's test task depends on ^build,
      // so a missing artifact is a real failure, not a skip. Locally we still
      // tolerate it (warn + return) so `pnpm test` works before `pnpm build`.
      if (process.env.CI) {
        throw new Error(
          `jto-cli artifact missing at ${cliPath}; run \`pnpm --filter @json-to-office/jto-cli build\` first`
        );
      }
      console.warn(`Skipping: ${cliPath} not built`);
      return;
    }

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jto-cli-exit-'));
    const inputPath = path.join(tmp, 'fixture.json');
    const outputPath = path.join(tmp, 'out.docx');
    writeFileSync(inputPath, JSON.stringify(fixture));

    const child = spawn(
      process.execPath,
      [
        cliPath,
        'docx',
        'generate',
        inputPath,
        '-o',
        outputPath,
        '--no-google-fonts',
      ],
      { cwd: repoRoot, stdio: 'pipe' }
    );

    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.stdout.on('data', () => {});

    const start = Date.now();
    const exitCode: number = await new Promise((resolve, reject) => {
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(
            `jto-cli did not exit within 30s (likely a leaked handle keeping the event loop alive). stderr:\n${stderr}`
          )
        );
      }, 30_000);
      child.on('exit', (code) => {
        clearTimeout(killTimer);
        resolve(code ?? -1);
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
    });

    expect(exitCode, `stderr:\n${stderr}`).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    // Sanity: the example renders in well under a second on the build machine;
    // anything close to 30s indicates the hang has regressed.
    expect(Date.now() - start).toBeLessThan(30_000);
  }, 35_000);
});
