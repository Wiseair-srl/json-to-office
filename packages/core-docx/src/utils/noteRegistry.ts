/**
 * Note registry — footnote bodies collected while rendering their markers.
 *
 * A footnote has two halves in the package: a `w:footnoteReference` run in
 * `word/document.xml` and a body in `word/footnotes.xml`, joined by a numeric
 * id that is document-scoped. Async-local state gives each render its own
 * counter, so concurrent generations cannot interleave ids and point a
 * reference at another document's body.
 *
 * Ids start at 1: docx writes the reserved separator (-1) and
 * continuationSeparator (0) notes itself.
 */

import { Paragraph, TextRun } from 'docx';
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeUnicodeText } from './unicode';

/** docx's shape for the `footnotes` / `endnotes` document options. */
export type NoteBodies = Record<string, { children: Paragraph[] }>;

interface NoteState {
  counter: number;
  footnotes: NoteBodies;
}

function createState(): NoteState {
  return { counter: 0, footnotes: {} };
}

/** Note bodies are paragraphs — one per line, so authors can write short lists. */
function bodyParagraphs(text: string): Paragraph[] {
  return normalizeUnicodeText(text)
    .split('\n')
    .map(
      (line) =>
        new Paragraph({
          style: 'FootnoteText',
          children: [new TextRun({ text: line })],
        })
    );
}

class NoteRegistry {
  private fallback: NoteState = createState();
  private readonly scopes = new AsyncLocalStorage<NoteState>();

  private get state(): NoteState {
    return this.scopes.getStore() ?? this.fallback;
  }

  /** Run work with an isolated registry that follows its async call chain. */
  runScoped<T>(callback: () => T): T {
    return this.scopes.run(createState(), callback);
  }

  /**
   * Register a footnote body and return the id its reference must use. Ids are
   * unique and monotonic within a render.
   */
  registerFootnote(text: string): number {
    const state = this.state;
    const id = ++state.counter;
    state.footnotes[String(id)] = { children: bodyParagraphs(text) };
    return id;
  }

  /** Every footnote registered in this scope, keyed by id. */
  getFootnotes(): NoteBodies {
    return { ...this.state.footnotes };
  }

  /** Test-only: reset the current scope's counter and bodies. */
  clear(): void {
    const state = this.scopes.getStore();
    if (state) {
      state.counter = 0;
      for (const key of Object.keys(state.footnotes)) {
        delete state.footnotes[key];
      }
    } else {
      this.fallback = createState();
    }
  }
}

export const globalNoteRegistry = new NoteRegistry();
