/**
 * Review-comment defaults.
 *
 * The ids and the bodies live in the compiler now — it numbers every comment
 * itself, per compilation, and carries the bodies in the IR. What is left is
 * the two values a comment falls back to when the author states neither.
 */

export const DEFAULT_COMMENT_AUTHOR = 'json-to-office';
/** A fixed instant, so identical inputs produce byte-identical XML. */
export const DEFAULT_COMMENT_DATE = '1970-01-01T00:00:00Z';
