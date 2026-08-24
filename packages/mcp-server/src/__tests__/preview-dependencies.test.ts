/**
 * What happens on a host that cannot render.
 *
 * A missing LibreOffice is the single most likely reason `jto_preview` does
 * not work, and it is not the caller's fault — so it must come back as a
 * result an agent can read and relay ("install this"), never as a stack trace
 * and never as a protocol error. The probe is injected here so that path is
 * exercised on a machine that happens to have both binaries.
 */

import { describe, it, expect, vi } from 'vitest';

import { ERROR_CODES } from '../lib/errors.js';
import type { FormatAdapter } from '../lib/adapters.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';
import {
  missingDependencyFailure,
  probePreviewDependencies,
  readConverterVersions,
  type PreviewDependencies,
} from '../preview/dependencies.js';
import { renderPreview } from '../preview/render.js';

const present = (name: string) => ({
  available: true as const,
  path: `/nowhere/${name}`,
  envVar: 'X',
  searched: [`/nowhere/${name}`],
});
const absent = (name: string) => ({
  available: false as const,
  envVar: name === 'soffice' ? 'LIBREOFFICE_PATH' : 'PDFTOPPM_PATH',
  searched: [`/usr/bin/${name}`, `/usr/local/bin/${name}`],
});

const bothPresent: PreviewDependencies = {
  libreoffice: present('soffice'),
  pdftoppm: present('pdftoppm'),
};

/** Enough of an adapter for the paths that never reach a real generator. */
function fakeAdapter(
  generateBuffer: FormatAdapter['generateBuffer'] = async () =>
    Buffer.from('PK')
): FormatAdapter {
  return { generateBuffer } as unknown as FormatAdapter;
}

describe('missingDependencyFailure', () => {
  it('passes a host that has both', () => {
    expect(missingDependencyFailure(bothPresent)).toBeUndefined();
  });

  it.each([
    ['LibreOffice', { ...bothPresent, libreoffice: absent('soffice') }],
    ['poppler', { ...bothPresent, pdftoppm: absent('pdftoppm') }],
    ['both', { libreoffice: absent('soffice'), pdftoppm: absent('pdftoppm') }],
  ])('refuses when %s is missing', (_label, dependencies) => {
    const result = missingDependencyFailure(
      dependencies as PreviewDependencies
    );
    expect(result).toBeDefined();
    const [issue] = result!.diagnostics;
    expect(issue.code).toBe(ERROR_CODES.DEPENDENCY_MISSING);
    // Actionable means: what is missing, how to install it, how to override.
    expect(issue.suggestion).toMatch(/install/i);
    expect(issue.suggestion).toContain('LIBREOFFICE_PATH');
    expect(issue.suggestion).toContain('PDFTOPPM_PATH');
    expect(issue.context?.missing).toBeInstanceOf(Array);
    // And where it looked, so a user with a custom install can see the gap.
    expect(issue.context).toHaveProperty('libreoffice');
    expect(issue.context).toHaveProperty('pdftoppm');
  });

  it('names only what is actually absent', () => {
    const result = missingDependencyFailure({
      ...bothPresent,
      pdftoppm: absent('pdftoppm'),
    })!;
    expect(result.diagnostics[0].message).toContain('poppler');
    expect(result.diagnostics[0].message).not.toContain(
      'LibreOffice (soffice)'
    );
  });
});

describe('renderPreview on a host without the binaries', () => {
  it('returns a structured refusal instead of throwing', async () => {
    const getAdapter = vi.fn(() => fakeAdapter());
    const result = await renderPreview({
      format: 'docx',
      document: { name: 'docx' },
      getAdapter,
      cacheDir: null,
      probe: async () => ({
        libreoffice: absent('soffice'),
        pdftoppm: absent('pdftoppm'),
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.DEPENDENCY_MISSING);
    // Nothing was generated: a host that cannot render should not pay for a
    // document it will never convert.
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it('refuses a malformed page spec before it even probes', async () => {
    const probe = vi.fn(async () => bothPresent);
    const result = await renderPreview({
      format: 'docx',
      document: {},
      pages: '5-2',
      getAdapter: () => fakeAdapter(),
      cacheDir: null,
      probe,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(
      PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC
    );
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses an oversized bounded selection before it even probes', async () => {
    const probe = vi.fn(async () => bothPresent);
    const result = await renderPreview({
      format: 'docx',
      document: {},
      pages: '1-40',
      dpi: 300,
      outputMode: 'images',
      getAdapter: () => fakeAdapter(),
      cacheDir: null,
      probe,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(PREVIEW_ERROR_CODES.TOO_LARGE);
    expect(result.diagnostics[0].suggestion).toContain('outputMode "path"');
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses more pages than the per-call ceiling, in any mode', async () => {
    const result = await renderPreview({
      format: 'docx',
      document: {},
      pages: '1-500',
      outputMode: 'path',
      getAdapter: () => fakeAdapter(),
      cacheDir: null,
      probe: async () => bothPresent,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].context).toMatchObject({ maxPages: 50 });
  });
});

describe('cancellation', () => {
  it('stops on an already-aborted signal without generating', async () => {
    const getAdapter = vi.fn(() => fakeAdapter());
    const result = await renderPreview({
      format: 'docx',
      document: {},
      getAdapter,
      cacheDir: null,
      probe: async () => bothPresent,
      signal: AbortSignal.abort(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.CANCELLED);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it('reports cancellation, not a build failure, when the abort lands mid-generate', async () => {
    const controller = new AbortController();
    const result = await renderPreview({
      format: 'docx',
      document: {},
      getAdapter: () =>
        fakeAdapter(async () => {
          controller.abort();
          throw new Error('The operation was aborted');
        }),
      cacheDir: null,
      probe: async () => bothPresent,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.CANCELLED);
  });
});

describe('converter versions', () => {
  it('stays well-defined when a path is missing', async () => {
    const versions = await readConverterVersions({
      libreoffice: absent('soffice'),
      pdftoppm: absent('pdftoppm'),
    });
    expect(versions.identities).toEqual({
      libreoffice: 'absent',
      pdftoppm: 'absent',
    });
  });

  it('never throws on a binary that is not there', async () => {
    const versions = await readConverterVersions(bothPresent);
    expect(Object.keys(versions.identities).sort()).toEqual([
      'libreoffice',
      'pdftoppm',
    ]);
  });
});

describe('probePreviewDependencies', () => {
  it('answers with a status for both binaries', async () => {
    const dependencies = await probePreviewDependencies();
    for (const status of [dependencies.libreoffice, dependencies.pdftoppm]) {
      expect(typeof status.available).toBe('boolean');
      expect(status.searched.length).toBeGreaterThan(0);
      if (status.available) expect(status.path).toBeTruthy();
    }
  });
});
