/**
 * The bookmark a section is addressable by.
 *
 * `w:bookmarkStart/@w:name` is what a section-scoped table of contents resolves
 * its `\b` switch against, so the name has to be derivable identically by
 * whoever writes the bookmark and whoever points at it. It is derived from the
 * section's ordinal, and both sides call this.
 *
 * This used to be a registry with per-render state, because the pre-IR writer
 * had two producers allocating from two different traversal orders. The
 * compiler has one, so a pure function is enough.
 */

/** A resolved OOXML bookmark: its name plus the numeric id its ends share. */
export interface SectionBookmark {
  /** `w:bookmarkStart/@w:name`, and the TOC `\b` switch argument. */
  id: string;
  /** `w:bookmarkStart/@w:id` / `w:bookmarkEnd/@w:id`. */
  linkId: number;
}

/**
 * The bookmark for a layout section, derived from its ordinal.
 *
 * Every layout chunk of one user-defined section shares an ordinal (see
 * `computeSectionOrdinals`), so they all resolve to the same bookmark — which
 * is the point: the start lands in the first chunk and the end in the last.
 */
export function sectionBookmark(ordinal: number): SectionBookmark {
  return { id: `_Section_${ordinal}`, linkId: ordinal };
}
