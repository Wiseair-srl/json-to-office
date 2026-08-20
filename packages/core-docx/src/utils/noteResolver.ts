/**
 * Bind a paragraph's declared note bodies to the `[^id]` markers in its text.
 *
 * Footnotes and endnotes share the marker syntax and differ only in where Word
 * puts the body, so one resolver serves both: an id is looked up in
 * `footnotes` first, then `endnotes`.
 *
 * Registration is lazy — a body reaches its part only when a marker actually
 * resolves to it — and memoized, so repeating `[^id]` points both references at
 * the same note rather than duplicating the body.
 */

import type { Note } from '@json-to-office/shared-docx';
import { globalNoteRegistry } from './noteRegistry';

export interface NoteResolver {
  /** Called by the text parser for each `[^id]` marker it finds. */
  resolve: (id: string) => { id: number; endnote: boolean } | undefined;
  /**
   * Report declared bodies that never made it into the document. Call once the
   * paragraph's text has been fully parsed.
   */
  reportUnemitted: (text: string) => void;
}

interface DeclaredNote {
  text: string;
  endnote: boolean;
}

function collectDeclared(
  footnotes: readonly Note[] | undefined,
  endnotes: readonly Note[] | undefined
): Map<string, DeclaredNote> {
  const declared = new Map<string, DeclaredNote>();
  for (const note of footnotes ?? []) {
    declared.set(note.id, { text: note.text, endnote: false });
  }
  for (const note of endnotes ?? []) {
    if (declared.has(note.id)) {
      // One marker cannot mean two notes; the footnote declaration wins so the
      // outcome does not depend on prop order.
      console.warn(
        `Note id "${note.id}" is declared as both a footnote and an endnote in ` +
          'the same paragraph. Using the footnote and ignoring the endnote.'
      );
      continue;
    }
    declared.set(note.id, { text: note.text, endnote: true });
  }
  return declared;
}

/**
 * Build the resolver `parseTextWithDecorators` consults for each marker, or
 * undefined when the paragraph declares no notes (which leaves `[^…]` as
 * ordinary text).
 */
export function createNoteResolver(
  footnotes: readonly Note[] | undefined,
  endnotes: readonly Note[] | undefined
): NoteResolver | undefined {
  const declared = collectDeclared(footnotes, endnotes);
  if (declared.size === 0) return undefined;

  const registered = new Map<string, { id: number; endnote: boolean }>();

  return {
    resolve(id: string) {
      const existing = registered.get(id);
      if (existing !== undefined) return existing;

      const note = declared.get(id);
      if (note === undefined) {
        // The paragraph declares notes, so `[^id]` was meant as a marker.
        // Leave it literal rather than dropping text, but say so.
        console.warn(
          `Note marker "[^${id}]" has no matching entry in this paragraph's ` +
            `footnotes or endnotes (declared: ${[...declared.keys()].join(', ')}). ` +
            'Rendering the marker as literal text.'
        );
        return undefined;
      }

      const resolved = {
        id: note.endnote
          ? globalNoteRegistry.registerEndnote(note.text)
          : globalNoteRegistry.registerFootnote(note.text),
        endnote: note.endnote,
      };
      registered.set(id, resolved);
      return resolved;
    },

    reportUnemitted(text: string) {
      for (const [id, note] of declared) {
        if (registered.has(id)) continue;
        const kind = note.endnote ? 'Endnote' : 'Footnote';
        console.warn(
          text.includes(`[^${id}]`)
            ? `${kind} "${id}" is declared and its marker appears in the text, ` +
                'but the marker was not resolved — markers are not recognised ' +
                'in text that also contains {PLACEHOLDER} substitutions. ' +
                'The note will not appear in the document.'
            : `${kind} "${id}" is declared but never referenced as [^${id}] ` +
                'in this paragraph. It will not appear in the document.'
        );
      }
    },
  };
}
