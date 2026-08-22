/**
 * The ordinal fold decides which layout chunk opens a section bookmark, which
 * chunks share it, and which one closes it. Getting it wrong produces bookmarks
 * that never close (or close twice), and a section-scoped TOC silently resolves
 * against nothing.
 */
import { describe, it, expect } from 'vitest';
import { computeSectionOrdinals } from '../sectionOrdinals';
import { sectionBookmark } from '../sectionBookmarks';

const outside = { isUserSection: false, belongsToUserSection: false };
const opens = { isUserSection: true, belongsToUserSection: true };
const continues = { isUserSection: false, belongsToUserSection: true };

describe('computeSectionOrdinals', () => {
  it('leaves chunks outside any user section unnumbered', () => {
    expect(computeSectionOrdinals([outside, outside])).toEqual([
      { closeBookmark: false },
      { closeBookmark: false },
    ]);
  });

  it('numbers sections from 1 and closes each single-chunk section', () => {
    expect(computeSectionOrdinals([opens, opens])).toEqual([
      { ordinal: 1, closeBookmark: true },
      { ordinal: 2, closeBookmark: true },
    ]);
  });

  it('shares one ordinal across every chunk of a split section', () => {
    expect(
      computeSectionOrdinals([opens, continues, continues, opens])
    ).toEqual([
      { ordinal: 1, closeBookmark: false },
      { ordinal: 1, closeBookmark: false },
      { ordinal: 1, closeBookmark: true },
      { ordinal: 2, closeBookmark: true },
    ]);
  });

  it('closes a section when the next chunk falls outside it', () => {
    expect(computeSectionOrdinals([opens, continues, outside])).toEqual([
      { ordinal: 1, closeBookmark: false },
      { ordinal: 1, closeBookmark: true },
      { closeBookmark: false },
    ]);
  });

  it('keeps numbering across chunks that sit between sections', () => {
    expect(computeSectionOrdinals([opens, outside, opens])).toEqual([
      { ordinal: 1, closeBookmark: true },
      { closeBookmark: false },
      { ordinal: 2, closeBookmark: true },
    ]);
  });

  it('is pure — same input, same output', () => {
    const input = [opens, continues, outside, opens];
    expect(computeSectionOrdinals(input)).toEqual(
      computeSectionOrdinals(input)
    );
  });
});

describe('sectionBookmark', () => {
  it('names a layout section after its ordinal', () => {
    expect(sectionBookmark(3)).toEqual({ id: '_Section_3', linkId: 3 });
  });

  it('resolves the same ordinal to the same bookmark, every time', () => {
    // The two ends of one section are written at different moments, and both
    // derive the name rather than remembering it.
    expect(sectionBookmark(3)).toEqual(sectionBookmark(3));
  });
});
