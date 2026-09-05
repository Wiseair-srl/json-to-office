import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFingerprint,
  buildManifest,
  endpointClass,
  fontInventory,
  gitState,
  sha256,
  UNAVAILABLE,
} from './manifest.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

describe('endpointClass', () => {
  it('separates what stays on the machine from what leaves it', () => {
    expect(endpointClass('http://localhost:7801')).toBe('local');
    expect(endpointClass('http://127.0.0.1:7801')).toBe('local');
    expect(endpointClass('http://10.0.4.2:7801')).toBe('private');
    expect(endpointClass('https://charts.corp.internal')).toBe('private');
    expect(endpointClass('https://export.highcharts.com')).toBe('hosted');
    expect(endpointClass(undefined)).toBe('none');
  });

  it('treats an unparseable endpoint as hosted, not as safe', () => {
    expect(endpointClass('not a url')).toBe('hosted');
  });
});

describe('gitState', () => {
  it('reads the SHA and whether the tree describes it', () => {
    const state = gitState(repoRoot);
    expect(state.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(typeof state.dirty).toBe('boolean');
  });

  it('answers `unavailable` outside a repository rather than throwing', () => {
    expect(gitState('/').sha).toBe(UNAVAILABLE);
  });
});

describe('buildManifest', () => {
  const manifest = buildManifest({
    repoRoot,
    model: 'claude-sonnet-5',
    modelParameters: { maxTurns: 40 },
    serverInstructions: 'instructions',
    mode: 'cold',
    maxRetries: 1,
    agentSdkVersion: '0.3.259',
  });

  it('carries every field a later comparison needs', () => {
    for (const key of [
      'gitSha',
      'gitDirty',
      'packageVersions',
      'agentSdkVersion',
      'model',
      'modelParameters',
      'serverInstructionsHash',
      'skillHash',
      'mode',
      'os',
      'node',
      'libreoffice',
      'poppler',
      'fonts',
      'exportServer',
      'maxRetries',
    ]) {
      expect(manifest, key).toHaveProperty(key);
    }
  });

  it('hashes the instructions, and records a cold run as skill-free', () => {
    expect(manifest.serverInstructionsHash).toBe(sha256('instructions'));
    expect(manifest.skillHash).toBe('none');
    expect(manifest.skillMode).toBeUndefined();
  });

  it('records which skill an assisted run carried, and how it was loaded', () => {
    // A ceiling measured from one file instead of the whole bundle carries the
    // workflow and none of the taste — and understating the ceiling makes
    // every later phase look better than it is.
    const assisted = buildManifest({
      repoRoot,
      model: 'm',
      modelParameters: {},
      serverInstructions: 'i',
      mode: 'assisted',
      maxRetries: 0,
      agentSdkVersion: '0',
      skill: {
        text: 'x',
        name: 'json-to-office',
        version: '3.1.0',
        files: ['SKILL.md', 'assets/taste/typography.md'],
        hash: 'abc',
        mode: 'bundle',
      },
    });
    expect(assisted).toMatchObject({
      skillHash: 'abc',
      skillName: 'json-to-office',
      skillVersion: '3.1.0',
      skillMode: 'bundle',
      mode: 'assisted',
    });
    expect(assisted.skillFiles).toHaveLength(2);
  });

  it('reports the package versions this run was made with', () => {
    expect(manifest.packageVersions['@json-to-office/mcp-server']).toMatch(
      /^\d+\.\d+\.\d+/
    );
  });

  it('records a field it could not read rather than dropping it', () => {
    // A manifest with a hole is still a manifest; one that quietly shrank is
    // a comparison waiting to mislead.
    expect(manifest.exportServer.endpointClass).toBe('none');
    expect(
      buildManifest({
        repoRoot,
        model: 'm',
        modelParameters: {},
        serverInstructions: 'i',
        mode: 'cold',
        maxRetries: 0,
        agentSdkVersion: '0',
        libreofficePath: '/nowhere/soffice',
        pdftoppmPath: '/nowhere/pdftoppm',
      }).libreoffice
    ).toBe(UNAVAILABLE);
  });

  it('finds the converters on PATH, not only from an env var', () => {
    // The first baseline recorded both as `unavailable` while every page count
    // in it came from a real render. A manifest that claims the run had no
    // renderer is worse than one with a hole, because it looks complete.
    // Skipped where the host genuinely has neither, which is a real CI case.
    for (const field of ['libreoffice', 'poppler'] as const) {
      const value = manifest[field];
      expect(typeof value, field).toBe('string');
      if (value !== UNAVAILABLE) {
        expect(value.length, field).toBeGreaterThan(3);
        // One line, not a whole banner.
        expect(value, field).not.toContain('\n');
      }
    }
  });
});

describe('fontInventory', () => {
  it('lists families rather than hashing them', () => {
    // "The inventories differ" is not an answer to which font was missing.
    const fonts = fontInventory();
    expect(Array.isArray(fonts)).toBe(true);
    expect(fonts).toEqual([...fonts].sort());
  });
});

describe('tree stability across a run', () => {
  const base = {
    repoRoot,
    model: 'claude-sonnet-5',
    modelParameters: {},
    serverInstructions: 'instructions',
    mode: 'cold' as const,
    maxRetries: 1,
    agentSdkVersion: '0.3.259',
  };

  it('is stable when the tree the run started on is the tree it ended on', () => {
    const manifest = buildManifest({
      ...base,
      atStart: {
        gitSha: gitState(repoRoot).sha,
        buildFingerprint: buildFingerprint(repoRoot),
      },
    });
    expect(manifest.treeStableDuringRun).toBe(true);
    expect(manifest.gitShaAtStart).toBe(manifest.gitSha);
  });

  it('is unstable when the compiled workspace moved under the run', () => {
    // The real failure: another session ran `pnpm build` at minute 58 of a
    // 76-minute set. Nothing in git changed for the runs already finished, and
    // the manifest — assembled at the end — looked clean.
    const manifest = buildManifest({
      ...base,
      atStart: {
        gitSha: gitState(repoRoot).sha,
        buildFingerprint: 'a-build-that-is-no-longer-on-disk',
      },
    });
    expect(manifest.treeStableDuringRun).toBe(false);
    expect(manifest.buildFingerprintAtStart).not.toBe(
      manifest.buildFingerprint
    );
  });

  it('is unstable when the revision moved under the run', () => {
    const manifest = buildManifest({
      ...base,
      atStart: {
        gitSha: '0000000000000000000000000000000000000000',
        buildFingerprint: buildFingerprint(repoRoot),
      },
    });
    expect(manifest.treeStableDuringRun).toBe(false);
  });

  it('claims stability rather than inventing it when no start state was captured', () => {
    const manifest = buildManifest(base);
    expect(manifest.treeStableDuringRun).toBe(true);
    expect(manifest.gitShaAtStart).toBe(manifest.gitSha);
  });
});

describe('buildFingerprint covers every compiled entry point', () => {
  /** A fake workspace: `packages/<name>/dist/<files>`, each with content. */
  async function workspace(
    packages: Record<string, Record<string, string>>
  ): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-fingerprint-'));
    for (const [name, files] of Object.entries(packages)) {
      const dist = path.join(root, 'packages', name, 'dist');
      await fs.mkdir(dist, { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        await fs.writeFile(path.join(dist, file), content);
      }
    }
    return root;
  }

  it('notices a rebuild that touched only the CLI entry', async () => {
    // The regression: `tsup` builds `cli` and `index` as separate entries, and
    // `serverCommand` launches `mcp-server/dist/cli.js`. Fingerprinting only
    // `index.js` left a CLI-only rebuild invisible to the one check whose job
    // is noticing that the compiled product moved under a measurement.
    const root = await workspace({
      'mcp-server': { 'index.js': 'index', 'cli.js': 'cli' },
    });
    const before = buildFingerprint(root);

    await fs.writeFile(
      path.join(root, 'packages/mcp-server/dist/cli.js'),
      'cli, rebuilt and longer'
    );

    expect(buildFingerprint(root)).not.toBe(before);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('still records an unbuilt package as absent', async () => {
    // Both readings come from the SAME root, so the built package's size and
    // mtime are identical across them and the only thing that moved is the
    // unbuilt package appearing. Comparing two temp roots would have passed
    // whatever the code did, since their mtimes differ anyway.
    const root = await workspace({ built: { 'index.js': 'x' } });
    const builtOnly = buildFingerprint(root);

    await fs.mkdir(path.join(root, 'packages', 'unbuilt'), { recursive: true });

    expect(buildFingerprint(root)).not.toBe(UNAVAILABLE);
    expect(buildFingerprint(root)).not.toBe(builtOnly);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('answers UNAVAILABLE when there is no packages directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-empty-'));
    expect(buildFingerprint(root)).toBe(UNAVAILABLE);
    await fs.rm(root, { recursive: true, force: true });
  });
});
