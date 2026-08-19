/**
 * Comment anchors — the `word/document.xml` half of a review comment.
 *
 * Word expects, in this order inside the commented paragraph(s):
 *
 *   <w:commentRangeStart w:id="N"/> …runs… <w:commentRangeEnd w:id="N"/>
 *   <w:r><w:commentReference w:id="N"/></w:r>
 *
 * The range may span several paragraphs, in which case the start sits in the
 * first and the end plus reference in the last — which is how a list-level
 * comment is anchored.
 */

import {
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  TextRun,
} from 'docx';
import type { ParagraphChild } from 'docx';
import type { Comment } from '@json-to-office/shared-docx';
import { globalCommentRegistry } from './commentRegistry';

export interface CommentAnchor {
  /** Every comment in the thread: the root first, then its replies. */
  ids: number[];
  /** Range-start elements to place before the commented content. */
  start: ParagraphChild[];
}

/**
 * Register `comment` (and its replies) and return the opening anchors, or
 * undefined when there is no comment. Callers must pair this with
 * `closeCommentRange`.
 *
 * A thread anchors every one of its comments over the same range, which is how
 * Word writes threads and how it groups them in the review pane.
 */
export function openCommentRange(
  comment: Comment | undefined
): CommentAnchor | undefined {
  if (!comment) return undefined;
  const ids = globalCommentRegistry.register(comment);
  return { ids, start: ids.map((id) => new CommentRangeStart(id)) };
}

/**
 * The closing anchors: each range end followed by its reference run.
 *
 * `w:commentReference` is run-inner content, so it has to sit inside a `w:r`.
 * docx's `CommentReference` is the bare element; emitted as a direct child of
 * `w:p` it is schema-invalid and readers drop the comment silently (verified in
 * LibreOffice, which showed zero annotations before this wrapping).
 */
export function closeCommentRange(ids: readonly number[]): ParagraphChild[] {
  return ids.flatMap((id) => [
    new CommentRangeEnd(id),
    new TextRun({ children: [new CommentReference(id)] }),
  ]);
}
