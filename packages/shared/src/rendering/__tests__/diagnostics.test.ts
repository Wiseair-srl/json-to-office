import { describe, expect, it } from 'vitest';
import {
  UnsupportedRendererFeatureError,
  partitionDiagnostics,
  rendererError,
  rendererWarning,
} from '../diagnostics';
import { assertNever } from '../types';

describe('diagnostic builders', () => {
  it('builds an error-severity diagnostic', () => {
    expect(rendererError('toc', 'sections[0]', 'no field support')).toEqual({
      feature: 'toc',
      path: 'sections[0]',
      severity: 'error',
      message: 'no field support',
    });
  });

  it('builds a warning-severity diagnostic', () => {
    expect(rendererWarning('svg', 'slides[0]', 'raster fallback')).toEqual({
      feature: 'svg',
      path: 'slides[0]',
      severity: 'warning',
      message: 'raster fallback',
    });
  });
});

describe('partitionDiagnostics', () => {
  it('splits errors from warnings, preserving order', () => {
    const { errors, warnings } = partitionDiagnostics([
      rendererError('toc', 'a', 'e1'),
      rendererWarning('svg', 'b', 'w1'),
      rendererError('comments', 'c', 'e2'),
      rendererWarning('svg', 'd', 'w2'),
    ]);

    expect(errors.map((d) => d.message)).toEqual(['e1', 'e2']);
    expect(warnings.map((d) => d.message)).toEqual(['w1', 'w2']);
  });

  it('handles an empty list', () => {
    expect(partitionDiagnostics([])).toEqual({ errors: [], warnings: [] });
  });
});

describe('UnsupportedRendererFeatureError', () => {
  const error = new UnsupportedRendererFeatureError({
    format: 'docx',
    rendererId: 'office-open',
    diagnostics: [
      rendererError('comments', 'sections[0].comments[0]', 'not implemented'),
      rendererError('toc', 'sections[0].children[1]', 'no field support'),
      rendererError('comments', 'sections[1].comments[0]', 'not implemented'),
    ],
  });

  it('is an Error with a stable name and code', () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnsupportedRendererFeatureError');
    expect(error.code).toBe('UNSUPPORTED_RENDERER_FEATURE');
  });

  it('carries format, renderer id and every diagnostic', () => {
    expect(error.format).toBe('docx');
    expect(error.rendererId).toBe('office-open');
    expect(error.diagnostics).toHaveLength(3);
  });

  it('deduplicates features but keeps every path', () => {
    expect(error.features).toEqual(['comments', 'toc']);
    expect(error.paths).toEqual([
      'sections[0].comments[0]',
      'sections[0].children[1]',
      'sections[1].comments[0]',
    ]);
  });

  it('produces an actionable message naming renderer, features and paths', () => {
    expect(error.message).toContain('office-open');
    expect(error.message).toContain('docx');
    expect(error.message).toContain('"comments"');
    expect(error.message).toContain('"toc"');
    expect(error.message).toContain('sections[0].children[1]');
    expect(error.message).toContain('no field support');
  });

  it('copies the diagnostics array so callers cannot mutate it', () => {
    const source = [rendererError('toc', 'a', 'm')];
    const err = new UnsupportedRendererFeatureError({
      format: 'docx',
      rendererId: 'x',
      diagnostics: source,
    });
    source.push(rendererError('comments', 'b', 'm2'));

    expect(err.diagnostics).toHaveLength(1);
  });
});

describe('assertNever', () => {
  it('names the unhandled kind', () => {
    expect(() => assertNever({ kind: 'ghost' } as never, 'DocxBlock')).toThrow(
      /Unhandled variant in DocxBlock: kind="ghost"/
    );
  });

  it('falls back to type when there is no kind', () => {
    expect(() => assertNever({ type: 'spectre' } as never)).toThrow(
      /Unhandled variant: type="spectre"/
    );
  });

  it('handles primitives', () => {
    expect(() => assertNever('nope' as never)).toThrow(
      /Unhandled variant: nope/
    );
  });

  it('serialises a plain object with neither discriminant', () => {
    expect(() => assertNever({ a: 1 } as never)).toThrow(/\{"a":1\}/);
  });

  it('survives a circular object', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertNever(circular as never)).toThrow(/Unhandled variant/);
  });
});
