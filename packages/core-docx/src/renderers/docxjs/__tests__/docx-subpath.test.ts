/**
 * The on-demand loader for `docx` subpath entries (`docx/charts`,
 * `docx/shapes`): loaded once, never rejecting, and failing by name only when
 * a document needs the entry.
 */

import { describe, expect, it, vi } from 'vitest';
import { docxSubpath } from '../docxSubpath';

describe('docxSubpath', () => {
  it('imports once, however often it is asked to load', async () => {
    const importer = vi.fn(async () => ({ answer: 42 }));
    const entry = docxSubpath('docx/charts', 'chart', importer);

    expect(entry.loaded()).toBe(false);
    await Promise.all([entry.load(), entry.load()]);
    await entry.load();

    expect(importer).toHaveBeenCalledTimes(1);
    expect(entry.loaded()).toBe(true);
    expect(entry.get()).toEqual({ answer: 42 });
  });

  it('says to load it first when asked before any load', () => {
    const entry = docxSubpath('docx/shapes', 'visual', async () => ({}));

    expect(() => entry.get()).toThrow(/docx\/shapes is not loaded/);
  });

  it('keeps a failed import for the document that needs it', async () => {
    const importer = vi.fn(async () => {
      throw new Error('Package subpath ./charts is not defined by "exports"');
    });
    const entry = docxSubpath('docx/charts', 'chart', importer);

    await expect(entry.load()).resolves.toBeUndefined();
    await entry.load();

    expect(importer).toHaveBeenCalledTimes(1);
    expect(entry.loaded()).toBe(false);
    expect(() => entry.get()).toThrow(
      /The docx `chart` component needs docx 9\.8\.0 or later: the `docx\/charts` entry could not be loaded \(Package subpath \.\/charts/
    );
  });

  it('loads the real entries docx 9.8.0 ships', async () => {
    const charts = docxSubpath(
      'docx/charts',
      'chart',
      () => import('docx/charts')
    );
    const shapes = docxSubpath(
      'docx/shapes',
      'visual',
      () => import('docx/shapes')
    );
    await Promise.all([charts.load(), shapes.load()]);

    expect(typeof charts.get().ChartRun).toBe('function');
    expect(typeof shapes.get().ShapeGroupRun).toBe('function');
  });
});
