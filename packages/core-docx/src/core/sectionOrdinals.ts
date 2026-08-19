/**
 * Section ordinal fold.
 *
 * A user-defined `section` can be split into several layout chunks (a columns
 * transition starts a new one). Every chunk of one section must share a single
 * bookmark: the start lands in the first chunk, the end in the last, and a
 * section-scoped TOC in between resolves against the same name.
 *
 * The ordinal is a fold over the chunk list, not a property of a chunk, so it
 * cannot be computed from `layout.sections[i]` alone. Computing it once up
 * front keeps the render loop free of the loop-carried counter it used to
 * thread through header/footer bookkeeping.
 */

/** The chunk fields the fold depends on. */
export interface SectionOrdinalInput {
  /** True for the first layout chunk of a user-defined section. */
  isUserSection: boolean;
  /** True for every layout chunk of a user-defined section. */
  belongsToUserSection: boolean;
}

export interface SectionOrdinal {
  /** 1-based ordinal shared by all chunks of one section; undefined outside. */
  ordinal?: number;
  /** True on the last chunk of a section, where the bookmark end belongs. */
  closeBookmark: boolean;
}

/**
 * Resolve the bookmark ordinal and closing chunk for every layout section.
 * Pure: same input, same output, no allocation against any registry.
 */
export function computeSectionOrdinals(
  sections: readonly SectionOrdinalInput[]
): SectionOrdinal[] {
  let counter = 0;

  return sections.map((section, index) => {
    if (!section.belongsToUserSection) {
      if (section.isUserSection) counter++;
      return { closeBookmark: false };
    }

    // First chunk opens a new ordinal; later chunks reuse the one in flight.
    const ordinal = section.isUserSection ? counter + 1 : counter;
    if (section.isUserSection) counter++;

    // The section ends when the next chunk is not part of it — either there is
    // no next chunk, it is outside any section, or it opens the next one.
    const next = sections[index + 1];
    const closeBookmark =
      !next || !next.belongsToUserSection || next.isUserSection;

    return { ordinal, closeBookmark };
  });
}
