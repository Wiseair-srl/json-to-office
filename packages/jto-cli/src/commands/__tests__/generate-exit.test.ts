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

// Regression guard for leaked handles that keep `jto-cli docx generate` alive
// after the buffer is written. This guards against a process that never exits,
// not
// against slow I/O. Startup is dominated by cosmiconfig's config search, which
// probes ~90 paths; on Windows CI those probes are slow and highly variable, so
// a 30s budget there measures runner load rather than a hang. Windows gets a
// looser budget: a leak keeps the process alive indefinitely and is still
// caught, while a merely slow runner no longer fails the suite.
const EXIT_BUDGET_MS = process.platform === 'win32' ? 120_000 : 30_000;

describe('jto-cli docx generate exits promptly', () => {
  it(
    'exits without leaking a handle that keeps the process alive',
    async () => {
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
      let stdout = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.stdout.on('data', (d) => (stdout += d.toString()));

      const start = Date.now();
      const exitCode: number = await new Promise((resolve, reject) => {
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(
            new Error(
              `jto-cli did not exit within ${EXIT_BUDGET_MS}ms (likely a leaked handle keeping the event loop alive).\nstdout:\n${stdout}\nstderr:\n${stderr}`
            )
          );
        }, EXIT_BUDGET_MS);
        child.on('exit', (code) => {
          clearTimeout(killTimer);
          resolve(code ?? -1);
        });
        child.on('error', (err) => {
          clearTimeout(killTimer);
          reject(err);
        });
      });

      expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
      expect(existsSync(outputPath)).toBe(true);
      // Sanity: anything at the budget means the process had to be killed rather
      // than exiting on its own.
      expect(Date.now() - start).toBeLessThan(EXIT_BUDGET_MS);
    },
    EXIT_BUDGET_MS + 5_000
  );
});
