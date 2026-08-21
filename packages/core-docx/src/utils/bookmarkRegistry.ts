/**
 * Bookmark Registry
 * Utilities for managing document bookmarks for internal hyperlinks
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { BookmarkStart, BookmarkEnd } from 'docx';
import type { ParagraphChild } from 'docx';

export interface BookmarkInfo {
  id: string;
  title: string;
  type: string; // e.g., 'heading', 'paragraph', 'table', etc.
}

interface BookmarkState {
  bookmarks: Map<string, BookmarkInfo>;
  /** Next `w:bookmarkStart/@w:id` for a content bookmark. */
  nextLinkId: number;
}

/**
 * Content bookmarks number from here up.
 *
 * `w:id` pairs a `bookmarkStart` with its `bookmarkEnd`, so it has to be unique
 * across the whole document — including against the section bookmarks, which
 * allocate from their own two ranges in `sectionBookmarks.ts` (layout ordinals
 * from 1, nested sections from 1_000_000). This is the third disjoint range.
 */
const CONTENT_LINK_ID_BASE = 2_000_000;

function createState(): BookmarkState {
  return { bookmarks: new Map(), nextLinkId: CONTENT_LINK_ID_BASE + 1 };
}

/**
 * Slug a piece of text into a bookmark id candidate.
 *
 * Pure half of `generateId`: the document-outline pre-pass has to predict the
 * ids render will produce before any registry state exists, so the algorithm
 * cannot live inside the registry.
 */
export function slugifyBookmarkText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 40); // Limit length
}

/**
 * Disambiguate a slug against ids already taken, appending `-1`, `-2`, … .
 * Gives up after 100 attempts and returns the colliding id, exactly as
 * `generateId` always has.
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

/**
 * Registry for managing document bookmarks
 * Used to track bookmark IDs and validate internal hyperlink targets
 */
export class BookmarkRegistry {
  private readonly fallback: BookmarkState = createState();
  private readonly scopes = new AsyncLocalStorage<BookmarkState>();

  private get state(): BookmarkState {
    return this.scopes.getStore() ?? this.fallback;
  }

  /** Run work with an isolated registry that follows its async call chain. */
  runScoped<T>(callback: () => T): T {
    return this.scopes.run(createState(), callback);
  }

  /**
   * Register a bookmark
   */
  register(id: string, title: string, type: string): void {
    if (this.state.bookmarks.has(id)) {
      console.warn(
        `Duplicate bookmark ID: ${id}. Using the latest registration.`
      );
    }
    this.state.bookmarks.set(id, { id, title, type });
  }

  /**
   * A `w:id` no other bookmark in this document will use.
   *
   * docx's own `Bookmark` cannot supply one: its constructor builds a fresh
   * id generator per instance (`bookmarkUniqueNumericIdGen()`), so every
   * bookmark it emits carries `w:id="1"`. Reported upstream as dolanmiu/docx
   * #3478, still unreleased as of 9.7.1. Duplicated ids leave the start/end
   * pairing ambiguous, which is why a `REF` field could not read a target's
   * text even though navigating to it by name worked.
   */
  allocateLinkId(): number {
    return this.state.nextLinkId++;
  }

  /**
   * Generate a unique bookmark ID from text
   * Converts text to a URL-friendly format
   */
  generateId(text: string, _type: string = 'bookmark'): string {
    return dedupeBookmarkId(slugifyBookmarkText(text), (id) =>
      this.state.bookmarks.has(id)
    );
  }

  /**
   * Check if a bookmark exists
   */
  exists(id: string): boolean {
    return this.state.bookmarks.has(id);
  }

  /**
   * Get bookmark info by ID
   */
  get(id: string): BookmarkInfo | undefined {
    return this.state.bookmarks.get(id);
  }

  /**
   * Get all registered bookmarks
   */
  getAll(): BookmarkInfo[] {
    return Array.from(this.state.bookmarks.values());
  }

  /**
   * Clear all bookmarks
   */
  clear(): void {
    this.state.bookmarks.clear();
  }

  /**
   * Validate that all internal hyperlink references exist
   * Returns array of missing bookmark IDs
   */
  validateReferences(referencedIds: string[]): string[] {
    const missing: string[] = [];
    for (const id of referencedIds) {
      if (!this.exists(id)) {
        missing.push(id);
      }
    }
    return missing;
  }
}

// Global registry instance
export const globalBookmarkRegistry = new BookmarkRegistry();

/**
 * A bookmark around `children`, as the three elements OOXML actually wants:
 * `w:bookmarkStart`, the content, `w:bookmarkEnd`.
 *
 * Replaces docx's `Bookmark`, which pairs every start/end with `w:id="1"`
 * (see `allocateLinkId`). Spread the result into a paragraph's children.
 */
export function createBookmarkedContent(
  name: string,
  children: readonly ParagraphChild[]
): ParagraphChild[] {
  const linkId = globalBookmarkRegistry.allocateLinkId();
  return [
    new BookmarkStart(name, linkId),
    ...children,
    new BookmarkEnd(linkId),
  ];
}
