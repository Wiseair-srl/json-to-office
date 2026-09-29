/**
 * The one `@office-open/docx` release this adapter renders with.
 *
 * The adapter hands its options to the backend as data, typed against one
 * release; the move from 0.11 to 0.14 renamed most of them, and the raw bump
 * lost content from 216 of 308 corpus documents without a single error. The
 * pin in `package.json`, the constant the adapter checks and the installed
 * package have to agree, and anything else is refused by name.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENDERER_BACKEND_VERSION_MISMATCH,
  installedPackageVersion,
} from '@json-to-office/shared/rendering/node';
import { OFFICE_OPEN_VERSION, createOfficeOpenDocxRenderer } from '..';

const manifest = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
) as { dependencies: Record<string, string> };

describe('the @office-open/docx version', () => {
  afterEach(() => {
    vi.doUnmock('@json-to-office/shared/rendering/node');
    vi.resetModules();
  });

  it('is the one package.json pins, exactly', () => {
    expect(manifest.dependencies['@office-open/docx']).toBe(
      OFFICE_OPEN_VERSION
    );
  });

  it('is the one installed', async () => {
    expect(installedPackageVersion('@office-open/docx', import.meta.url)).toBe(
      OFFICE_OPEN_VERSION
    );
    await expect(createOfficeOpenDocxRenderer()).resolves.toBeDefined();
  });

  it('refuses the renderer when another one is installed', async () => {
    vi.resetModules();
    vi.doMock('@json-to-office/shared/rendering/node', async (original) => ({
      ...(await original<object>()),
      installedPackageVersion: () => '0.11.0',
    }));
    const { createOfficeOpenDocxRenderer: create } = await import('..');
    await expect(create()).rejects.toMatchObject({
      name: RENDERER_BACKEND_VERSION_MISMATCH,
      installedVersion: '0.11.0',
      expectedVersion: OFFICE_OPEN_VERSION,
    });
  });
});
