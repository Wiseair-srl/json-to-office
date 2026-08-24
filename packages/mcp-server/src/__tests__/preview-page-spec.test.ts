/**
 * The page selection syntax is the one part of `jto_preview` an agent has to
 * spell correctly from a description alone, so every shape the description
 * promises is pinned here — including the ones that must be refused.
 */

import { describe, it, expect } from 'vitest';

import {
  ALL_PAGES,
  PAGE_SPEC_PATTERN,
  canonicalRangeSpec,
  formatPageSelection,
  parsePageSpec,
  resolvePages,
} from '../preview/page-spec.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';
import { boundedPageCount } from '../preview/render.js';

function ranges(spec: string) {
  const parsed = parsePageSpec(spec);
  if (!parsed.ok) throw new Error(`expected "${spec}" to parse`);
  return parsed.ranges;
}

function pages(spec: string, totalPages: number, maxPages = 50) {
  const resolved = resolvePages(ranges(spec), totalPages, maxPages);
  if (!resolved.ok) throw new Error(`expected "${spec}" to resolve`);
  return resolved.pages;
}

describe('parsePageSpec', () => {
  it('reads "all" as every page', () => {
    expect(ranges(ALL_PAGES)).toEqual([{ from: 1, to: null }]);
    expect(ranges('ALL')).toEqual([{ from: 1, to: null }]);
  });

  it('reads single pages, closed ranges and both open ends', () => {
    expect(ranges('3')).toEqual([{ from: 3, to: 3 }]);
    expect(ranges('2-5')).toEqual([{ from: 2, to: 5 }]);
    expect(ranges('4-')).toEqual([{ from: 4, to: null }]);
    expect(ranges('-3')).toEqual([{ from: 1, to: 3 }]);
  });

  it('reads a comma-separated mix and ignores whitespace', () => {
    expect(ranges(' 1-3 , 7 , 10- ')).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 7 },
      { from: 10, to: null },
    ]);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['0', 'page zero'],
    ['0-2', 'range from zero'],
    ['5-2', 'backwards range'],
    ['1,,2', 'empty item'],
    ['abc', 'not a number'],
    ['1-2-3', 'two dashes'],
    ['-', 'a bare dash'],
  ])('refuses %j (%s)', (spec) => {
    const parsed = parsePageSpec(spec);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.diagnostics[0].code).toBe(
      PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC
    );
    // Every refusal has to teach the syntax, not just reject.
    expect(parsed.diagnostics[0].suggestion).toContain('1-3,7');
  });

  it('names the fix for a backwards range', () => {
    const parsed = parsePageSpec('5-2');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.diagnostics[0].message).toContain('2-5');
  });

  it('has a schema pattern that agrees with the parser', () => {
    const pattern = new RegExp(PAGE_SPEC_PATTERN);
    for (const good of ['all', '3', '2-5', '4-', '-3', '1-3,7', ' 1 , 2 ']) {
      expect(pattern.test(good), good).toBe(true);
      expect(parsePageSpec(good).ok, good).toBe(true);
    }
    for (const bad of ['', 'abc', '1-2-3', '-', '1,,2']) {
      expect(pattern.test(bad), bad).toBe(false);
    }
  });
});

describe('resolvePages', () => {
  it('expands, dedupes and sorts', () => {
    expect(pages('3,1-2,1', 10)).toEqual([1, 2, 3]);
  });

  it('clamps an open end to the last page without complaining', () => {
    const resolved = resolvePages(ranges('4-'), 6, 50);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.pages).toEqual([4, 5, 6]);
    expect(resolved.diagnostics).toHaveLength(0);
  });

  it('clamps a closed range that overshoots, and says so', () => {
    const resolved = resolvePages(ranges('1-20'), 3, 50);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.pages).toEqual([1, 2, 3]);
    expect(resolved.diagnostics[0].severity).toBe('info');
    expect(resolved.diagnostics[0].message).toContain('clamped');
  });

  it('refuses a selection that starts past the end', () => {
    const resolved = resolvePages(ranges('9'), 3, 50);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(
      PREVIEW_ERROR_CODES.INVALID_PAGE_SPEC
    );
    expect(resolved.diagnostics[0].message).toContain('3 pages');
    expect(resolved.diagnostics[0].context).toMatchObject({ totalPages: 3 });
  });

  it('refuses more pages than the per-call ceiling', () => {
    const resolved = resolvePages(ranges('all'), 200, 50);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].context).toMatchObject({
      selected: 200,
      maxPages: 50,
    });
  });

  it('refuses a document with no pages', () => {
    const resolved = resolvePages(ranges('all'), 0, 50);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(
      PREVIEW_ERROR_CODES.PAGE_COUNT_UNAVAILABLE
    );
  });
});

describe('formatPageSelection', () => {
  it('collapses runs so one selection has one spelling', () => {
    expect(formatPageSelection([1, 2, 3, 7])).toBe('1-3,7');
    expect(formatPageSelection([7, 3, 2, 1])).toBe('1-3,7');
    expect(formatPageSelection([5])).toBe('5');
    expect(formatPageSelection([])).toBe('');
    expect(formatPageSelection([1, 1, 2])).toBe('1-2');
  });

  it('agrees across every spelling of the same selection', () => {
    const spellings = ['1,2,3', '1-3', '3,2,1', '1-2,2-3'];
    const rendered = spellings.map((spec) =>
      formatPageSelection(pages(spec, 10))
    );
    expect(new Set(rendered).size).toBe(1);
  });
});

describe('boundedPageCount', () => {
  it('counts a closed selection before anything renders', () => {
    expect(boundedPageCount(ranges('1-40'))).toBe(40);
    expect(boundedPageCount(ranges('1-3,7'))).toBe(4);
    expect(boundedPageCount(ranges('1-3,2-4'))).toBe(4);
  });

  it('gives up on an open end, which needs the page count', () => {
    expect(boundedPageCount(ranges('all'))).toBeUndefined();
    expect(boundedPageCount(ranges('4-'))).toBeUndefined();
  });
});

describe('canonicalRangeSpec', () => {
  const spec = (text: string) => canonicalRangeSpec(ranges(text));

  it('gives every spelling of one selection the same key material', () => {
    expect(new Set(['1,2,3', '3,2,1', '1-3', '1-2,2-3'].map(spec)).size).toBe(
      1
    );
    expect(spec('1-3')).toBe('1-3');
  });

  it('sorts and merges adjacent and overlapping ranges', () => {
    expect(spec('7,1-3')).toBe('1-3,7');
    expect(spec('1-3,4-6')).toBe('1-6');
    expect(spec('1-5,2-3')).toBe('1-5');
    expect(spec('1-3,7-9')).toBe('1-3,7-9');
  });

  it('lets an open end swallow everything after it', () => {
    expect(spec('all')).toBe('1-');
    expect(spec('1-')).toBe('1-');
    expect(spec('2-,5,9-10')).toBe('2-');
    expect(spec('1,3-')).toBe('1,3-');
  });

  it('keeps genuinely different selections apart', () => {
    expect(spec('1-3')).not.toBe(spec('2-5'));
    expect(spec('all')).not.toBe(spec('1-3'));
  });
});
