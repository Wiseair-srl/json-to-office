/**
 * Comment (review annotation) registry.
 *
 * Word comment ids live in their own OOXML namespace, separate from the
 * `w:ins` / `w:del` ids in `revisionUtils.ts`, so they get their own counter —
 * but the same async-local scoping, and the registry must be entered from the
 * same `runScoped` nest, or two concurrent generations interleave counters and
 * a comment anchor points at another document's body.
 *
 * The registry holds both halves of a comment: the id used by the anchor in
 * `word/document.xml`, and the body that `renderDocument` hands to docx for
 * `word/comments.xml`.
 */

import { Paragraph, TextRun } from 'docx';
import type { ICommentOptions } from 'docx';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Comment } from '@json-to-office/shared-docx';
import { normalizeUnicodeText } from './unicode';

export const DEFAULT_COMMENT_AUTHOR = 'json-to-office';
// Deterministic fallback so identical inputs produce byte-identical XML
export const DEFAULT_COMMENT_DATE = '1970-01-01T00:00:00Z';

interface CommentState {
  counter: number;
  comments: ICommentOptions[];
}

function createState(): CommentState {
  return { counter: 0, comments: [] };
}

/**
 * Initials shown on the comment bubble. Word derives them from the author when
 * the file omits them; we do it up front so the value is stable across viewers.
 */
function deriveInitials(author: string): string {
  const initials = author
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);
  return initials || author.slice(0, 2).toUpperCase();
}

/** Comment body paragraphs — one per line, so authors can write short lists. */
function bodyParagraphs(text: string): Paragraph[] {
  return normalizeUnicodeText(text)
    .split('\n')
    .map((line) => new Paragraph({ children: [new TextRun({ text: line })] }));
}

class CommentRegistry {
  private fallback: CommentState = createState();
  private readonly scopes = new AsyncLocalStorage<CommentState>();

  private get state(): CommentState {
    return this.scopes.getStore() ?? this.fallback;
  }

  /** Run work with an isolated registry that follows its async call chain. */
  runScoped<T>(callback: () => T): T {
    return this.scopes.run(createState(), callback);
  }

  /**
   * Register a comment body and return the id its anchors must use. Ids are
   * unique and monotonic within a render.
   */
  register(comment: Comment): number {
    const state = this.state;
    const id = ++state.counter;
    const author = comment.author || DEFAULT_COMMENT_AUTHOR;

    state.comments.push({
      id,
      author,
      initials: comment.initials || deriveInitials(author),
      date: new Date(comment.date || DEFAULT_COMMENT_DATE),
      children: bodyParagraphs(comment.text),
    });

    return id;
  }

  /** Every comment registered in this scope, in id order. */
  getAll(): ICommentOptions[] {
    return [...this.state.comments];
  }

  /** Test-only: reset the current scope's counter and bodies. */
  clear(): void {
    const state = this.scopes.getStore();
    if (state) {
      state.counter = 0;
      state.comments.length = 0;
    } else {
      this.fallback = createState();
    }
  }
}

export const globalCommentRegistry = new CommentRegistry();
