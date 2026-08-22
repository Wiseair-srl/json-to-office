/**
 * What the corpus goldens can and cannot see.
 *
 * A golden that hashes the raw `.docx` asserts two things at once: that the
 * document is unchanged, and that the deflate stream is byte-identical. Only
 * the first is this pipeline's to promise — deflate belongs to the runtime, so
 * a Node release with a different zlib fails all 272 cases at once and says
 * nothing about any document (#264).
 *
 * The digest is therefore over the parts. These tests pin both halves of that:
 * a package recompressed differently digests the same, and a package with one
 * byte of one part changed digests differently. Without the second, the first
 * would be satisfied by a digest that ignores everything.
 */

import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { packageDigest } from './fixtures/packageDigest';
import type { ReportComponentDefinition } from '../types';

const sha256 = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

const document = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { level: 1, text: 'Digest' } },
    { name: 'paragraph', props: { text: 'Some content to compress.' } },
  ],
} as unknown as ReportComponentDefinition;

/**
 * Rewrite a package part-for-part.
 *
 * Every entry keeps its name, its bytes and its timestamp; only the deflate
 * stream is produced again. That is the shape of the difference a runtime
 * change makes.
 */
function recompress(
  buffer: Buffer,
  mutate?: (name: string) => Buffer | undefined
): Buffer {
  const source = new AdmZip(buffer);
  const rebuilt = new AdmZip();
  for (const entry of source.getEntries()) {
    if (entry.isDirectory) continue;
    rebuilt.addFile(
      entry.entryName,
      mutate?.(entry.entryName) ?? entry.getData()
    );
    const added = rebuilt.getEntry(entry.entryName);
    if (added) {
      (added.header as unknown as { timeval: number }).timeval = (
        entry.header as unknown as { timeval: number }
      ).timeval;
    }
  }
  return rebuilt.toBuffer();
}

describe('packageDigest', () => {
  it('ignores how the container is compressed', async () => {
    const buffer = (await generateBufferFromJson(document)) as Buffer;
    const other = recompress(buffer);

    expect(sha256(other)).not.toBe(sha256(buffer));
    expect(packageDigest(other)).toBe(packageDigest(buffer));
  });

  it('sees a change to a part', async () => {
    const buffer = (await generateBufferFromJson(document)) as Buffer;
    const edited = recompress(buffer, (name) =>
      name === 'word/document.xml'
        ? Buffer.from(
            new AdmZip(buffer)
              .getEntry('word/document.xml')!
              .getData()
              .toString('utf8')
              .replace('Digest', 'Digest.'),
            'utf8'
          )
        : undefined
    );

    expect(packageDigest(edited)).not.toBe(packageDigest(buffer));
  });

  it('sees a part that is missing', async () => {
    const buffer = (await generateBufferFromJson(document)) as Buffer;
    const zip = new AdmZip(buffer);
    zip.deleteFile('docProps/app.xml');

    expect(packageDigest(zip.toBuffer())).not.toBe(packageDigest(buffer));
  });

  it('sees a part that moved to another name', async () => {
    const buffer = (await generateBufferFromJson(document)) as Buffer;
    const source = new AdmZip(buffer);
    const renamed = new AdmZip();
    for (const entry of source.getEntries()) {
      if (entry.isDirectory) continue;
      renamed.addFile(
        entry.entryName === 'docProps/app.xml'
          ? 'docProps/app2.xml'
          : entry.entryName,
        entry.getData()
      );
    }

    // Identical bytes in every part; only the name a reader looks them up by
    // has changed, which is enough to break the package.
    expect(packageDigest(renamed.toBuffer())).not.toBe(packageDigest(buffer));
  });
});
