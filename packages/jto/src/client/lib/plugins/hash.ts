/**
 * Cheap content hash for change detection (djb2, base-36). Not
 * cryptographic — it only decides whether a plugin source needs recompiling.
 */
export function hashSource(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}
