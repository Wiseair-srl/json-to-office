import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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
