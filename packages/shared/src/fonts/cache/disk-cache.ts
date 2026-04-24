/**
 * On-disk cache for fetched Google Fonts TTFs.
 * Optional — only active when a cacheDir is provided. Node-only.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export class FontDiskCache {
  private readonly dir: string;
  // In-flight promise dedupes the first-write mkdir across concurrent set()
  // calls. Without it, two simultaneous cold-cache writes could both see
  // `ensured=false`, both issue mkdir, and both flip the flag afterwards —
  // harmless today (recursive mkdir is idempotent) but the pattern is
  // right and leaves room to add per-directory locks if we ever need to.
  private ensurePromise: Promise<void> | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  private ensureDir(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = mkdir(this.dir, { recursive: true }).then(
        () => undefined
      );
    }
    return this.ensurePromise;
  }

  private pathFor(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
    return join(this.dir, `${hash}.bin`);
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: Buffer): Promise<void> {
    await this.ensureDir();
    await writeFile(this.pathFor(key), value);
  }
}
