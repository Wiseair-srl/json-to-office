import { describe, it, expect } from 'vitest';
import { autoGoogleFontEntries } from '../generator';

describe('autoGoogleFontEntries', () => {
  it('skips families listed in skipFamilies even if they match the catalog', () => {
    // Inter is in POPULAR_GOOGLE_FONTS; without the skip set it would be
    // auto-fetched. With caller-supplied registration, we must not queue a
    // parallel Google fetch — the caller's local bytes should win.
    const skip = new Set(['inter']);
    const entries = autoGoogleFontEntries(new Set(['Inter']), skip);
    expect(entries).toEqual([]);
  });

  it('matches skipFamilies case-insensitively', () => {
    const skip = new Set(['inter']);
    // Reference uses different casing than the skip entry — still skipped.
    expect(autoGoogleFontEntries(new Set(['INTER']), skip)).toEqual([]);
    expect(autoGoogleFontEntries(new Set(['Inter']), skip)).toEqual([]);
  });

  it('still auto-fetches non-skipped catalog families', () => {
    const skip = new Set(['inter']);
    const entries = autoGoogleFontEntries(new Set(['Inter', 'Roboto']), skip);
    expect(entries).toHaveLength(1);
    expect(entries[0].family).toBe('Roboto');
  });

  it('skips safe fonts regardless of skipFamilies', () => {
    const entries = autoGoogleFontEntries(new Set(['Calibri']), new Set());
    expect(entries).toEqual([]);
  });
});
