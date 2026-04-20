/**
 * On-disk cache for fetched Google Fonts TTFs.
 * Optional — only active when a cacheDir is provided. Node-only.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export class FontDiskCache {
  private readonly dir: string;
  private ensured = false;

  constructor(dir: string) {
    this.dir = dir;
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
    if (!this.ensured) {
      await mkdir(this.dir, { recursive: true });
      this.ensured = true;
    }
    await writeFile(this.pathFor(key), value);
  }
}
