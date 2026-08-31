/**
 * The real thing: a stock stdio client spawning the built binary.
 *
 * Needs `dist/cli.js`, which turbo's `test` task does not build for this
 * package (it depends on upstream builds only), so the suite skips rather
 * than fails on a checkout that has not been built. `server.test.ts` keeps
 * the protocol covered in that case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const run = promisify(execFile);

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const cliPath = path.join(packageRoot, 'dist', 'cli.js');
const built = existsSync(cliPath);

describe.skipIf(!built)('jto-mcp over stdio', () => {
  let scratch: string;
  let client: Client;

  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-stdio-'));
    client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cliPath, '--output-dir', scratch],
        stderr: 'pipe',
      })
    );
  });

  afterAll(async () => {
    await client.close();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('completes the handshake and discovers jto_info', async () => {
    expect(client.getServerVersion()?.name).toBe('json-to-office');
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('jto_info');
  });

  it('answers jto_info with the output root it was given', async () => {
    const result = await client.callTool({ name: 'jto_info', arguments: {} });
    const info = result.structuredContent as Record<string, any>;
    expect(info.ok).toBe(true);
    expect(info.output.root).toBe(scratch);
    expect(info.output.ephemeral).toBe(false);
  });

  // The bundled entry resolves packages differently from the source one under
  // vitest — the cores are `jto-ops`' dependency, not ours — so the version
  // report has to be asserted against the built binary, not only in-process.
  it('reports every generation package from the bundled entry', async () => {
    const result = await client.callTool({ name: 'jto_info', arguments: {} });
    const { packages } = result.structuredContent as Record<string, any>;
    for (const name of [
      '@json-to-office/jto-ops',
      '@json-to-office/shared',
      '@json-to-office/shared-docx',
      '@json-to-office/shared-pptx',
      '@json-to-office/core-docx',
      '@json-to-office/core-pptx',
    ]) {
      expect(packages[name]).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('serves the jto:// resources over the real transport', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      'jto://catalog',
      'jto://renderers',
      'jto://schema/docx/document',
      'jto://schema/docx/theme',
      'jto://schema/pptx/document',
      'jto://schema/pptx/theme',
      'jto://templates',
      'jto://themes',
      'jto://themes/values',
    ]);

    // Bodies are built lazily, so listing them proves nothing about reading
    // one — and the generated schemas are the expensive path.
    const read = await client.readResource({ uri: 'jto://catalog' });
    const [entry] = read.contents as [{ mimeType: string; text: string }];
    expect(entry.mimeType).toBe('application/json');
    expect(JSON.parse(entry.text)).toHaveProperty('formats');
  });
});

/**
 * #272's acceptance, checked against the artifact that actually ships.
 *
 * The ops layer was split out of `jto-cli` precisely so the server would not
 * drag a terminal UI into its install and cold start. A stray import of the
 * CLI package would reintroduce all of it at once and nothing else here would
 * notice, so this reads the bundled binary rather than the manifest.
 */
describe.skipIf(!built)('dependency budget', () => {
  it('imports nothing but ops, schemas, the SDK and node builtins', async () => {
    const bundle = await fs.readFile(cliPath, 'utf8');
    const pattern =
      /(?:^|[\s;}])(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

    const specifiers = new Set<string>();
    for (const match of bundle.matchAll(pattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/'))
        specifiers.add(specifier);
    }

    const external = [...specifiers].filter(
      (specifier) =>
        specifier.startsWith('@') || specifier.includes('/') === false
    );
    expect(external.length).toBeGreaterThan(0);

    for (const forbidden of [
      'ink',
      'react',
      'react-devtools-core',
      'commander',
      'chalk',
      '@json-to-office/jto-cli',
    ]) {
      expect(
        [...specifiers].filter(
          (specifier) =>
            specifier === forbidden || specifier.startsWith(`${forbidden}/`)
        ),
        `${forbidden} reached the shipped bundle`
      ).toEqual([]);
    }
  });
});

describe.skipIf(!built)('stdout hygiene', () => {
  it('writes nothing to stdout but the version for --version', async () => {
    const { stdout } = await run(process.execPath, [cliPath, '--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+|^dev-mode$/);
  });

  it('sends unknown-argument complaints to stderr, not stdout', async () => {
    await expect(
      run(process.execPath, [cliPath, '--nope'])
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('unknown argument'),
    });
  });

  it.each(['--workspace-dir', '--output-dir'])(
    'does not let %s swallow the option after it',
    async (flag) => {
      // Consuming the next token blindly named a directory after an option
      // the user meant to RUN, and started a server that never exits instead
      // of printing the version and stopping.
      const { stdout } = await run(process.execPath, [
        cliPath,
        flag,
        '--version',
      ]);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+|^dev-mode$/);
    }
  );

  it.each(['--workspace-dir', '--output-dir'])(
    'refuses %s when its value is another flag',
    async (flag) => {
      await expect(
        run(process.execPath, [cliPath, flag, '--output-dir=/tmp/jto-x'])
      ).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining(`${flag} needs a directory path`),
      });
    }
  );

  it.each(['--workspace-dir', '--output-dir'])(
    'refuses a trailing %s with no value',
    async (flag) => {
      // Silently falling back to the environment would ignore a flag the user
      // passed precisely to override it.
      await expect(
        run(process.execPath, [cliPath, flag])
      ).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('needs a directory path'),
      });
    }
  );
});
