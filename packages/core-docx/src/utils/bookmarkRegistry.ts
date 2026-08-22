/**
 * Naming a bookmark.
 *
 * A heading with no author-supplied id is addressable by a slug of its text, so
 * the slug has to be derivable identically by whoever writes the bookmark and
 * whoever points at it — the compiler and the document-outline pre-pass both
 * call this, and a disagreement would be a cross-reference resolving against an
 * id that never gets written.
 *
 * This used to be a registry with per-render state; the compiler numbers its
 * own bookmarks now, so what is left is the naming.
 */

/** Slug a piece of text into a bookmark id candidate. */
export function slugifyBookmarkText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 40); // Limit length
}

/**
 * Disambiguate a slug against ids already taken, appending `-1`, `-2`, … .
 *
 * Gives up after 100 attempts and returns the colliding id: a document with a
 * hundred headings slugging identically has a naming problem no suffix fixes.
 */
export function dedupeBookmarkId(
  base: string,
  taken: (id: string) => boolean
): string {
  let id = base;
  let attempt = 0;
  while (taken(id) && attempt < 100) {
    id = `${base}-${++attempt}`;
  }
  return id;
}
