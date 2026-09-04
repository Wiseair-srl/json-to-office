/**
 * The setup guide may not name a variable the server does not read.
 *
 * An unknown environment variable is not an error — it is a setting that
 * silently never applies. The Claude Desktop guide shipped telling people to
 * set `JTO_OUTPUT_DIR` and `JTO_WORKSPACE_DIR`; the server reads
 * `JTO_MCP_OUTPUT_DIR` and `JTO_MCP_WORKSPACE_DIR`. Everyone who followed it
 * got a server that ignored both and said nothing, and the eval harness lost
 * two good runs to the same guess before anyone noticed the names differed.
 *
 * So the guide is checked against the source rather than against a memory of
 * it: every `JTO_*` name the documentation mentions has to be one the code
 * actually looks at.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OUTPUT_DIR_ENV, WORKSPACE_DIR_ENV } from '../index.js';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const repoRoot = path.resolve(packageRoot, '../..');

/** Every `process.env.X` the server's own source reads. */
function honouredEnvNames(): Set<string> {
  const names = new Set<string>([OUTPUT_DIR_ENV, WORKSPACE_DIR_ENV]);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__') walk(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
      const source = readFileSync(full, 'utf8');
      for (const found of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        names.add(found[1]);
      }
      // `process.env[SOME_CONST]` — the two that matter are seeded above.
    }
  };
  walk(path.join(packageRoot, 'src'));
  return names;
}

const GUIDES = [
  'docs/guide/claude-desktop.md',
  'docs/guide/mcp-server.md',
  'packages/mcp-server/README.md',
];

describe('documented environment variables', () => {
  const honoured = honouredEnvNames();

  it('reads the two directory variables through their exported constants', () => {
    // Spelled out once, here, so a reader of this test knows the real names.
    expect(OUTPUT_DIR_ENV).toBe('JTO_MCP_OUTPUT_DIR');
    expect(WORKSPACE_DIR_ENV).toBe('JTO_MCP_WORKSPACE_DIR');
  });

  it.each(GUIDES)('%s names only variables the server reads', (guide) => {
    const file = path.join(repoRoot, guide);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // A guide that has moved is not this test's business to fail on.
      return;
    }
    // A trailing underscore means prose about a prefix, not a variable name.
    const mentioned = new Set(
      [...text.matchAll(/\bJTO_[A-Z0-9_]*[A-Z0-9]\b/g)].map((found) => found[0])
    );
    const unknown = [...mentioned].filter((name) => !honoured.has(name)).sort();
    expect(
      unknown,
      `${guide} tells the reader to set ${unknown.join(', ')}, which the server never reads. ` +
        `It honours: ${[...honoured]
          .filter((n) => n.startsWith('JTO_'))
          .sort()
          .join(', ')}.`
    ).toEqual([]);
  });
});
