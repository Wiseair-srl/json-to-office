/**
 * Bind a paragraph's declared footnote bodies to the `[^id]` markers in its
 * text.
 *
 * Registration is lazy — a body reaches `word/footnotes.xml` only when a marker
 * actually resolves to it — and memoized, so repeating `[^id]` points both
 * references at the same note rather than duplicating the body.
 */

import type { Footnote } from '@json-to-office/shared-docx';
import { globalNoteRegistry } from './noteRegistry';

export interface FootnoteResolver {
  /** Called by the text parser for each `[^id]` marker it finds. */
  resolve: (id: string) => number | undefined;
  /**
   * Report declared bodies that never made it into the document. Call once the
   * paragraph's text has been fully parsed.
   */
  reportUnemitted: (text: string) => void;
}

/**
 * Build the resolver `parseTextWithDecorators` consults for each marker, or
 * undefined when the paragraph declares no footnotes (which leaves `[^…]` as
 * ordinary text).
 */
export function createFootnoteResolver(
  footnotes: readonly Footnote[] | undefined
): FootnoteResolver | undefined {
  if (!footnotes || footnotes.length === 0) return undefined;

  const bodies = new Map(footnotes.map((note) => [note.id, note.text]));
  const registered = new Map<string, number>();

  return {
    resolve(id: string) {
      const existing = registered.get(id);
      if (existing !== undefined) return existing;

      const body = bodies.get(id);
      if (body === undefined) {
        // The paragraph declares footnotes, so `[^id]` was meant as a marker.
        // Leave it literal rather than dropping text, but say so.
        console.warn(
          `Footnote marker "[^${id}]" has no matching entry in this ` +
            `paragraph's footnotes (declared: ${[...bodies.keys()].join(', ')}). ` +
            'Rendering the marker as literal text.'
        );
        return undefined;
      }

      const noteId = globalNoteRegistry.registerFootnote(body);
      registered.set(id, noteId);
      return noteId;
    },

    reportUnemitted(text: string) {
      for (const id of bodies.keys()) {
        if (registered.has(id)) continue;
        console.warn(
          text.includes(`[^${id}]`)
            ? `Footnote "${id}" is declared and its marker appears in the text, ` +
                'but the marker was not resolved — markers are not recognised ' +
                'in text that also contains {PLACEHOLDER} substitutions. ' +
                'The footnote will not appear in the document.'
            : `Footnote "${id}" is declared but never referenced as [^${id}] ` +
                'in this paragraph. It will not appear in the document.'
        );
      }
    },
  };
}
