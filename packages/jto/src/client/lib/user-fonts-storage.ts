/**
 * Browser-local storage for user-uploaded fonts (Upload tab in the font
 * picker dialog). Uploads are intentionally device-local — sharing with
 * teammates requires the CLI/library path (options.fonts.extraEntries).
 *
 * Keyed by a deterministic `${family}|${weight}|${italic}` id so re-uploading
 * the same variant overwrites instead of duplicating.
 *
 * Uses idb-keyval directly (independent of the Zustand persist storage) so
 * fonts survive reloads without entangling them with transient UI state.
 */
import { get, set, del, keys } from 'idb-keyval';

const KEY_PREFIX = 'jto-user-font:';

export type UserFontFormat = 'ttf' | 'otf';

export interface StoredUserFont {
  id: string;
  family: string;
  weight: number;
  italic: boolean;
  format: UserFontFormat;
  data: ArrayBuffer;
  addedAt: number;
}

export interface UserFontPayload {
  family: string;
  weight: number;
  italic: boolean;
  format: UserFontFormat;
  /** Base64-encoded bytes, sent to the server on every /generate. */
  data: string;
}

export function makeUserFontId(
  family: string,
  weight: number,
  italic: boolean
): string {
  return `${family}|${weight}|${italic ? 'i' : 'r'}`;
}

function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export async function saveUserFont(font: StoredUserFont): Promise<void> {
  await set(storageKey(font.id), font);
}

export async function deleteUserFont(id: string): Promise<void> {
  await del(storageKey(id));
}

export async function listUserFonts(): Promise<StoredUserFont[]> {
  const allKeys = await keys();
  const fontKeys = allKeys.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(KEY_PREFIX)
  );
  const fonts = await Promise.all(fontKeys.map((k) => get<StoredUserFont>(k)));
  return fonts
    .filter((f): f is StoredUserFont => Boolean(f))
    .sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
}

/** Encode stored fonts for the /generate POST body. */
export async function getAllAsPayload(): Promise<UserFontPayload[]> {
  const fonts = await listUserFonts();
  return fonts.map((f) => ({
    family: f.family,
    weight: f.weight,
    italic: f.italic,
    format: f.format,
    data: arrayBufferToBase64(f.data),
  }));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // btoa needs binary string; chunk to avoid call-stack overflow on large fonts.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
