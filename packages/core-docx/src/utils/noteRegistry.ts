/**
 * Note registry — footnote and endnote bodies collected while rendering their
 * markers.
 *
 * A note has two halves in the package: a reference run in
 * `word/document.xml` and a body in `word/footnotes.xml` or
 * `word/endnotes.xml`, joined by a numeric id that is document-scoped.
 * Async-local state gives each render its own counters, so concurrent
 * generations cannot interleave ids and point a reference at another
 * document's body.
 *
 * Footnotes and endnotes are separate id spaces — they are separate parts —
 * so each gets its own counter. Both start at 1: docx writes the reserved
 * separator (-1) and continuationSeparator (0) notes itself.
 */

import { Paragraph, TextRun } from 'docx';
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeUnicodeText } from './unicode';

/** docx's shape for the `footnotes` / `endnotes` document options. */
export type NoteBodies = Record<string, { children: Paragraph[] }>;

interface NoteState {
  footnoteCounter: number;
  endnoteCounter: number;
  footnotes: NoteBodies;
  endnotes: NoteBodies;
}

function createState(): NoteState {
  return {
    footnoteCounter: 0,
    endnoteCounter: 0,
    footnotes: {},
    endnotes: {},
  };
}

/** Note bodies are paragraphs — one per line, so authors can write short lists. */
function bodyParagraphs(text: string, style: string): Paragraph[] {
  return normalizeUnicodeText(text)
    .split('\n')
    .map(
      (line) =>
        new Paragraph({
          style,
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
    const id = ++state.footnoteCounter;
    state.footnotes[String(id)] = {
      children: bodyParagraphs(text, 'FootnoteText'),
    };
    return id;
  }

  /** Register an endnote body and return the id its reference must use. */
  registerEndnote(text: string): number {
    const state = this.state;
    const id = ++state.endnoteCounter;
    state.endnotes[String(id)] = {
      children: bodyParagraphs(text, 'EndnoteText'),
    };
    return id;
  }

  /** Every footnote registered in this scope, keyed by id. */
  getFootnotes(): NoteBodies {
    return { ...this.state.footnotes };
  }

  /** Every endnote registered in this scope, keyed by id. */
  getEndnotes(): NoteBodies {
    return { ...this.state.endnotes };
  }

  /** Test-only: reset the current scope's counters and bodies. */
  clear(): void {
    const state = this.scopes.getStore();
    if (state) {
      state.footnoteCounter = 0;
      state.endnoteCounter = 0;
      for (const key of Object.keys(state.footnotes)) {
        delete state.footnotes[key];
      }
      for (const key of Object.keys(state.endnotes)) {
        delete state.endnotes[key];
      }
    } else {
      this.fallback = createState();
    }
  }
}

export const globalNoteRegistry = new NoteRegistry();
