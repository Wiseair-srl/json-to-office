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
import type { Comment, CommentReply } from '@json-to-office/shared-docx';
import { normalizeUnicodeText } from './unicode';

export const DEFAULT_COMMENT_AUTHOR = 'json-to-office';
// Deterministic fallback so identical inputs produce byte-identical XML
export const DEFAULT_COMMENT_DATE = '1970-01-01T00:00:00Z';

interface CommentState {
  counter: number;
  comments: ICommentOptions[];
  /** Whether anything in this render asked for a resolved state. */
  hasResolved: boolean;
}

function createState(): CommentState {
  return { counter: 0, comments: [], hasResolved: false };
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
   * Register a comment thread and return every id its anchors must carry — the
   * root first, then each reply in order. Word anchors every comment in a
   * thread over the same range, so all of them need a range and a reference.
   *
   * Ids are unique and monotonic within a render. `parentId` is derived here
   * rather than authored; docx turns it into the `w15:paraIdParent` links in
   * `word/commentsExtended.xml`.
   */
  register(comment: Comment): number[] {
    const state = this.state;
    const resolved = comment.resolved;
    const rootId = ++state.counter;

    state.comments.push({
      ...this.toOptions(comment, rootId),
      ...(resolved !== undefined && { resolved }),
    });

    const ids = [rootId];
    for (const reply of comment.replies ?? []) {
      const replyId = ++state.counter;
      state.comments.push({
        ...this.toOptions(reply, replyId),
        parentId: rootId,
        // Word resolves a thread as a whole, so the flag rides every member.
        ...(resolved !== undefined && { resolved }),
      });
      ids.push(replyId);
    }

    if (resolved !== undefined) state.hasResolved = true;
    return ids;
  }

  private toOptions(
    comment: Comment | CommentReply,
    id: number
  ): ICommentOptions {
    const author = comment.author || DEFAULT_COMMENT_AUTHOR;
    return {
      id,
      author,
      initials: comment.initials || deriveInitials(author),
      date: new Date(comment.date || DEFAULT_COMMENT_DATE),
      children: bodyParagraphs(comment.text),
    };
  }

  /**
   * Every comment registered in this scope, in id order.
   *
   * docx writes `word/commentsExtended.xml` — and therefore any `w15:done` —
   * only when at least one comment in the document carries a `parentId`. A
   * document whose only resolved comment has no replies would silently lose
   * that state, so say so rather than dropping it quietly.
   */
  getAll(): ICommentOptions[] {
    const state = this.state;
    if (
      state.hasResolved &&
      !state.comments.some((comment) => comment.parentId !== undefined)
    ) {
      console.warn(
        'A comment sets `resolved` but the document has no replies. Word stores ' +
          'the resolved flag in commentsExtended.xml, which is written only for ' +
          'threaded comments, so the flag will not survive.'
      );
    }
    return [...state.comments];
  }

  /** Test-only: reset the current scope's counter and bodies. */
  clear(): void {
    const state = this.scopes.getStore();
    if (state) {
      state.counter = 0;
      state.comments.length = 0;
      state.hasResolved = false;
    } else {
      this.fallback = createState();
    }
  }
}

export const globalCommentRegistry = new CommentRegistry();
