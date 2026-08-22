/**
 * Tracked-change defaults.
 *
 * The ids, the runs and the registry that used to hand them out all live in the
 * compiler now — it allocates every `w:ins`/`w:del` id itself, per compilation,
 * in document order. What is left is the two values a revision falls back to
 * when the author states neither, which are shared with the schema.
 */

export const DEFAULT_REVISION_AUTHOR = 'json-to-office';
/** A fixed instant, so identical inputs produce byte-identical XML. */
export const DEFAULT_REVISION_DATE = '1970-01-01T00:00:00Z';
