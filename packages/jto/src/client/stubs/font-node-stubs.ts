/**
 * Browser stubs for Node-only font modules referenced by @json-to-office/shared.
 *
 * These modules (disk-cache, file-loader) use node:fs / node:path / node:crypto.
 * The playground browser bundle should never actually execute them — FontRegistry
 * only reaches for them on the server side during generate. When Vite/Rollup
 * analyzes the dynamic import chunks at build time, it pulls in node:fs etc.
 * which fails in a browser build. Aliasing to this stub keeps the bundle clean.
 */

export class FontDiskCache {
  constructor(_dir: string) {
    throw new Error('FontDiskCache is not available in the browser');
  }
}

export async function loadFileFontSource(): Promise<never> {
  throw new Error('loadFileFontSource is not available in the browser');
}
