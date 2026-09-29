/**
 * The one `@office-open/pptx` release this adapter renders with.
 *
 * The adapter hands its options to the backend as data, typed against one
 * release; the move from 0.11 to 0.14 renamed most of them, and the raw bump
 * lost the options of all 55 corpus decks without a single error. The
 * pin in `package.json`, the constant the adapter checks and the installed
 * package have to agree, and anything else is refused by name.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENDERER_BACKEND_VERSION_MISMATCH,
  installedPackageVersion,
} from '@json-to-office/shared/rendering/node';
import { OFFICE_OPEN_VERSION, createOfficeOpenPptxRenderer } from '..';

const manifest = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
) as { dependencies: Record<string, string> };

describe('the @office-open/pptx version', () => {
  afterEach(() => {
    vi.doUnmock('@json-to-office/shared/rendering/node');
    vi.resetModules();
  });

  it('is the one package.json pins, exactly', () => {
    expect(manifest.dependencies['@office-open/pptx']).toBe(
      OFFICE_OPEN_VERSION
    );
  });

  it('is the one installed', async () => {
    expect(installedPackageVersion('@office-open/pptx', import.meta.url)).toBe(
      OFFICE_OPEN_VERSION
    );
    await expect(createOfficeOpenPptxRenderer()).resolves.toBeDefined();
  });

  it('refuses the renderer when another one is installed', async () => {
    vi.resetModules();
    vi.doMock('@json-to-office/shared/rendering/node', async (original) => ({
      ...(await original<object>()),
      installedPackageVersion: () => '0.11.0',
    }));
    const { createOfficeOpenPptxRenderer: create } = await import('..');
    await expect(create()).rejects.toMatchObject({
      name: RENDERER_BACKEND_VERSION_MISMATCH,
      installedVersion: '0.11.0',
      expectedVersion: OFFICE_OPEN_VERSION,
    });
  });
});
