/**
 * The reference block catalog: every definition the server's discovered
 * documents carry, with a working invocation and dependencies each. Fetched
 * once and shared — completion asks for it on every keystroke, and the list
 * only changes when a document on disk does.
 */
import type { BlockReference } from '@json-to-office/shared';
import { API_BASE_URL } from '../config/api';

let catalog: Promise<BlockReference[]> | null = null;
let current: BlockReference[] = [];

/** What is known right now; `[]` until the first fetch answers. */
export function blockReferences(): readonly BlockReference[] {
  if (!catalog) void loadBlockReferences();
  return current;
}

export async function loadBlockReferences(): Promise<BlockReference[]> {
  catalog ??= fetch(`${API_BASE_URL}/discovery/blocks`)
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Block discovery failed: ${response.statusText}`);
      const result = (await response.json()) as {
        success: boolean;
        data?: BlockReference[];
        error?: string;
      };
      if (!result.success || !result.data)
        throw new Error(result.error || 'Block discovery failed');
      current = result.data;
      return current;
    })
    .catch((error) => {
      console.warn('[blocks] reference catalog unavailable:', error);
      catalog = null;
      return current;
    });
  return catalog;
}

/** Forget the catalog so the next completion fetches it again. */
export function invalidateBlockReferences(): void {
  catalog = null;
}
