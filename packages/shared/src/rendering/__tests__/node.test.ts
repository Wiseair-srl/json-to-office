/**
 * Reading an installed backend's version, and refusing the wrong one.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RENDERER_BACKEND_VERSION_MISMATCH,
  assertBackendVersion,
  installedPackageVersion,
} from '../node';

/** A consumer package with one exports-only dependency, `@scope/lib`. */
const root = mkdtempSync(join(tmpdir(), 'jto-backend-version-'));
const lib = join(root, 'node_modules', '@scope', 'lib');
mkdirSync(join(lib, 'dist'), { recursive: true });
writeFileSync(
  join(lib, 'package.json'),
  JSON.stringify({
    name: '@scope/lib',
    version: '1.2.3',
    exports: { '.': { import: './dist/index.mjs' } },
  })
);
writeFileSync(join(lib, 'dist', 'index.mjs'), 'export {};\n');
// A nested manifest that is not the package's own, as bundled dists carry.
writeFileSync(
  join(lib, 'dist', 'package.json'),
  JSON.stringify({ type: 'module' })
);
const consumer = pathToFileURL(join(root, 'src', 'index.js')).href;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('installed backend versions', () => {
  it('reads the manifest above the entry the caller resolved', () => {
    const entry = pathToFileURL(join(lib, 'dist', 'index.mjs')).href;
    expect(installedPackageVersion('@scope/lib', consumer, entry)).toBe(
      '1.2.3'
    );
  });

  it("searches the caller's module paths when nothing was resolved", () => {
    // What a runtime without `import.meta.resolve` leaves to this helper.
    expect(installedPackageVersion('@scope/lib', consumer)).toBe('1.2.3');
  });

  it('answers nothing for a package that is not there', () => {
    expect(installedPackageVersion('@scope/missing', consumer)).toBeUndefined();
  });

  it('passes the version the adapter was built for', () => {
    expect(() =>
      assertBackendVersion('@scope/lib', '1.2.3', '1.2.3')
    ).not.toThrow();
  });

  it('refuses any other version by name, naming both', () => {
    let error: unknown;
    try {
      assertBackendVersion('@scope/lib', '1.2.3', '1.3.0');
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      name: RENDERER_BACKEND_VERSION_MISMATCH,
      packageName: '@scope/lib',
      expectedVersion: '1.2.3',
      installedVersion: '1.3.0',
    });
    expect((error as Error).message).toContain('@scope/lib 1.3.0');
    expect((error as Error).message).toContain('@scope/lib@1.2.3');
  });

  it('refuses a version it cannot read', () => {
    expect(() =>
      assertBackendVersion('@scope/lib', '1.2.3', undefined)
    ).toThrow(/version unreadable/);
  });
});
