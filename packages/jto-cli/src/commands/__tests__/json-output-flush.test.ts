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

/**
 * `--format json` used to be truncated at one pipe buffer — 65_537 bytes on
 * macOS and Linux — because the command called `process.exit()` in the same
 * tick as the write. Writes to a pipe are asynchronous, so everything still
 * queued was discarded and the payload became invalid JSON; writes to a regular
 * file are synchronous, so redirecting to a file hid the bug entirely. That
 * made the failure depend on the size of the document and on whether the caller
 * piped or redirected.
 *
 * The document below is sized to clear 64 KB of diagnostics comfortably, and
 * the assertion is that the payload parses — not merely that bytes arrived.
 * stdio is 'pipe', which is the shape that used to fail.
 */
const SLIDE_COUNT = 60;

const oversizedDeck = {
  name: 'pptx',
  props: {
    theme: 'default',
    grid: { columns: 12, rows: 6 },
  },
  children: Array.from({ length: SLIDE_COUNT }, (_, slide) => ({
    name: 'slide',
    children: Array.from({ length: 6 }, (_, index) => ({
      name: 'text',
      props: {
        // 6pt clears any shipped minimum-font floor, so every one of these
        // 360 nodes yields a finding and the payload lands well past 64 KB.
        text: `Slide ${slide + 1} caption ${index + 1}`,
        fontSize: 6,
        grid: { column: 1, row: (index % 6) + 1, columnSpan: 10 },
      },
    })),
  })),
};

describe('jto-cli validate --format json survives a pipe', () => {
  it('emits complete, parseable JSON for a payload larger than one pipe buffer', async () => {
    const cliPath = path.join(packageRoot, 'dist', 'cli.js');
    if (!existsSync(cliPath)) {
      if (process.env.CI) {
        throw new Error(
          `jto-cli artifact missing at ${cliPath}; run \`pnpm --filter @json-to-office/jto-cli build\` first`
        );
      }
      console.warn(`Skipping: ${cliPath} not built`);
      return;
    }

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jto-cli-json-'));
    const inputPath = path.join(tmp, 'deck.pptx.json');
    const profilePath = path.join(tmp, 'profile.json');
    writeFileSync(inputPath, JSON.stringify(oversizedDeck));
    writeFileSync(
      profilePath,
      JSON.stringify({ id: 'executive-presentation', formats: ['pptx'] })
    );

    const child = spawn(
      process.execPath,
      [
        cliPath,
        'pptx',
        'validate',
        inputPath,
        '--quality-profile',
        profilePath,
        '--format',
        'json',
      ],
      { cwd: repoRoot, stdio: 'pipe' }
    );

    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    await new Promise<void>((resolve) => child.on('close', () => resolve()));

    expect(stdout.length).toBeGreaterThan(65_537);
    const parsed = JSON.parse(stdout) as Array<{
      warnings?: unknown[];
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.warnings?.length).toBeGreaterThan(0);
  }, 60_000);
});
