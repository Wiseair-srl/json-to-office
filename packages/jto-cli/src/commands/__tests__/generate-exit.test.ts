import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

    // TEMP DIAGNOSTIC: dump whatever is still holding the event loop open so a
    // Windows-only hang is debuggable from CI logs. Timer is unref'd so it
    // cannot itself keep the process alive.
    const probePath = path.join(tmp, 'probe.mjs');
    writeFileSync(
      probePath,
      `import { createHook } from 'node:async_hooks';
const started = Date.now();
const pending = new Map();
createHook({
  init(id, type) {
    if (type.startsWith('FS') || type === 'GETADDRINFOREQWRAP' || type === 'TCPCONNECTWRAP') {
      pending.set(id, { type, at: Date.now() - started, stack: new Error().stack });
    }
  },
  after: (id) => pending.delete(id),
  destroy: (id) => pending.delete(id),
}).enable();
const dump = (label) => {
  process.stderr.write('[DIAG ' + label + '] elapsed=' + (Date.now() - started) + 'ms pending=' + pending.size + '\\n');
  for (const [, v] of [...pending].slice(0, 3)) {
    process.stderr.write('[DIAG ' + label + '] ' + v.type + ' opened@' + v.at + 'ms\\n' + v.stack + '\\n');
  }
};
setTimeout(() => dump('10s'), 10000).unref();
setTimeout(() => dump('20s'), 20000).unref();\n`
    );

    const child = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(probePath).href,
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
            `jto-cli did not exit within 30s (likely a leaked handle keeping the event loop alive).\nstdout:\n${stdout}\nstderr:\n${stderr}`
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

    expect(exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    // Sanity: the example renders in well under a second on the build machine;
    // anything close to 30s indicates the hang has regressed.
    expect(Date.now() - start).toBeLessThan(30_000);
  }, 35_000);
});
