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

/**
 * Register `comment` and return the opening anchor plus the id, or undefined
 * when there is no comment. Callers must pair this with `closeCommentRange`.
 */
export function openCommentRange(
  comment: Comment | undefined
): { id: number; start: ParagraphChild } | undefined {
  if (!comment) return undefined;
  const id = globalCommentRegistry.register(comment);
  return { id, start: new CommentRangeStart(id) };
}

/**
 * The closing anchor: range end followed by the reference run.
 *
 * `w:commentReference` is run-inner content, so it has to sit inside a `w:r`.
 * docx's `CommentReference` is the bare element; emitted as a direct child of
 * `w:p` it is schema-invalid and readers drop the comment silently (verified in
 * LibreOffice, which showed zero annotations before this wrapping).
 */
export function closeCommentRange(id: number): ParagraphChild[] {
  return [
    new CommentRangeEnd(id),
    new TextRun({ children: [new CommentReference(id)] }),
  ];
}
