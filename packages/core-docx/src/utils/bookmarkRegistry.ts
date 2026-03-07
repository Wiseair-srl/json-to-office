/**
 * Bookmark Registry
 * Utilities for managing document bookmarks for internal hyperlinks
 */

export interface BookmarkInfo {
  id: string;
  title: string;
  type: string; // e.g., 'heading', 'paragraph', 'table', etc.
}

/**
 * Registry for managing document bookmarks
 * Used to track bookmark IDs and validate internal hyperlink targets
 */
export class BookmarkRegistry {
  private bookmarks: Map<string, BookmarkInfo> = new Map();
  private counter = 0;

  /**
   * Register a bookmark
   */
  register(id: string, title: string, type: string): void {
    if (this.bookmarks.has(id)) {
      console.warn(
        `Duplicate bookmark ID: ${id}. Using the latest registration.`
      );
    }
    this.bookmarks.set(id, { id, title, type });
  }

  /**
   * Generate a unique bookmark ID from text
   * Converts text to a URL-friendly format
   */
  generateId(text: string, _type: string = 'bookmark'): string {
    // Convert to lowercase, replace spaces with hyphens, remove special characters
    const baseId = text
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 40); // Limit length

    // Ensure uniqueness by appending counter if needed
    let id = baseId;
    let attempt = 0;
    while (this.bookmarks.has(id) && attempt < 100) {
      id = `${baseId}-${++attempt}`;
    }

    return id;
  }

  /**
   * Check if a bookmark exists
   */
  exists(id: string): boolean {
    return this.bookmarks.has(id);
  }

  /**
   * Get bookmark info by ID
   */
  get(id: string): BookmarkInfo | undefined {
    return this.bookmarks.get(id);
  }

  /**
   * Get all registered bookmarks
   */
  getAll(): BookmarkInfo[] {
    return Array.from(this.bookmarks.values());
  }

  /**
   * Clear all bookmarks
   */
  clear(): void {
    this.bookmarks.clear();
    this.counter = 0;
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
