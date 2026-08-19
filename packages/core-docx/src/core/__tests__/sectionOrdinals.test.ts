/**
 * The ordinal fold decides which layout chunk opens a section bookmark, which
 * chunks share it, and which one closes it. Getting it wrong produces bookmarks
 * that never close (or close twice), and a section-scoped TOC silently resolves
 * against nothing.
 */
import { describe, it, expect } from 'vitest';
import { computeSectionOrdinals } from '../sectionOrdinals';
import {
  globalSectionBookmarkRegistry,
  type SectionBookmark,
} from '../sectionBookmarks';

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

describe('globalSectionBookmarkRegistry', () => {
  it('maps a layout ordinal to a stable bookmark', () => {
    expect(globalSectionBookmarkRegistry.forLayoutSection(3)).toEqual({
      id: '_Section_3',
      linkId: 3,
    });
    expect(globalSectionBookmarkRegistry.forLayoutSection(3)).toEqual(
      globalSectionBookmarkRegistry.forLayoutSection(3)
    );
  });

  it('allocates one bookmark per section component and remembers it', () => {
    globalSectionBookmarkRegistry.runScoped(() => {
      const a = { name: 'section' };
      const b = { name: 'section' };

      const first = globalSectionBookmarkRegistry.forSectionComponent(a);
      const second = globalSectionBookmarkRegistry.forSectionComponent(b);
      const firstAgain = globalSectionBookmarkRegistry.forSectionComponent(a);

      expect(first).toEqual({ id: '_NestedSection_1', linkId: 1_000_001 });
      expect(second).toEqual({ id: '_NestedSection_2', linkId: 1_000_002 });
      expect(firstAgain).toEqual(first);
    });
  });

  it('keeps nested link ids clear of layout link ids', () => {
    globalSectionBookmarkRegistry.runScoped(() => {
      const nested: SectionBookmark =
        globalSectionBookmarkRegistry.forSectionComponent({});
      expect(nested.linkId).toBeGreaterThan(
        globalSectionBookmarkRegistry.forLayoutSection(999).linkId
      );
    });
  });

  it('restarts numbering in each render scope', () => {
    const ids = [1, 2].map(() =>
      globalSectionBookmarkRegistry.runScoped(
        () => globalSectionBookmarkRegistry.forSectionComponent({}).id
      )
    );
    expect(ids).toEqual(['_NestedSection_1', '_NestedSection_1']);
  });
});
