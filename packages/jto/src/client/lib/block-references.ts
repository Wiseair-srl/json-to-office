/**
 * The reference block catalog: every definition the server's discovered
 * documents carry, with a working invocation and dependencies each. Fetched
 * once and shared — completion asks for it on every keystroke, and the list
 * only changes when a document on disk does. A failed fetch is remembered
 * for a while rather than retried on the next keystroke.
 */
import type { BlockReference } from '@json-to-office/shared';
import { API_BASE_URL } from '../config/api';

const RETRY_AFTER_MS = 30_000;
let catalog: Promise<BlockReference[]> | null = null;

export function loadBlockReferences(): Promise<BlockReference[]> {
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
      return result.data;
    })
    .catch((error) => {
      console.warn('[blocks] reference catalog unavailable:', error);
      setTimeout(() => {
        catalog = null;
      }, RETRY_AFTER_MS);
      return [];
    });
  return catalog;
}
