/**
 * What the corpus goldens can and cannot see.
 *
 * A golden that hashes the raw `.pptx` asserts two things at once: that the
 * deck is unchanged, and that the deflate stream is byte-identical. Only the
 * first is this pipeline's to promise — deflate belongs to the runtime, so a
 * Node release with a different zlib fails the whole corpus at once and says
 * nothing about any deck (#264).
 *
 * The digest is therefore over the parts. Both halves are pinned here: a
 * package recompressed differently digests the same, and a package with one
 * part changed digests differently. Without the second, the first would be
 * satisfied by a digest that ignores everything.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { packageDigest } from './fixtures/packageDigest';
import type { PresentationComponentDefinition } from '../types';

const sha256 = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

const deck = {
  name: 'pptx',
  props: { title: 'Digest' },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        {
          name: 'text',
          props: { text: 'Some content to compress.', x: 1, y: 1, w: 6, h: 1 },
        },
      ],
    },
  ],
} as unknown as PresentationComponentDefinition;

/** Rebuild a package part-for-part, optionally rewriting one part's bytes. */
async function rebuild(
  buffer: Buffer,
  mutate?: (name: string, data: Buffer) => Buffer | undefined
): Promise<Buffer> {
  const source = await JSZip.loadAsync(buffer);
  const out = new JSZip();
  for (const [name, entry] of Object.entries(source.files)) {
    if (entry.dir) continue;
    const data = await entry.async('nodebuffer');
    out.file(name, mutate?.(name, data) ?? data, { date: entry.date });
  }
  return out.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    // A different level: the same parts, a different deflate stream.
    compressionOptions: { level: 1 },
  });
}

describe('packageDigest', () => {
  it('ignores how the container is compressed', async () => {
    const buffer = (await generateBufferFromJson(deck)) as Buffer;
    const other = await rebuild(buffer);

    expect(sha256(other)).not.toBe(sha256(buffer));
    await expect(packageDigest(other)).resolves.toBe(
      await packageDigest(buffer)
    );
  });

  it('sees a change to a part', async () => {
    const buffer = (await generateBufferFromJson(deck)) as Buffer;
    const edited = await rebuild(buffer, (name, data) =>
      name === 'ppt/slides/slide1.xml'
        ? Buffer.from(
            data.toString('utf8').replace('compress.', 'compress!'),
            'utf8'
          )
        : undefined
    );

    await expect(packageDigest(edited)).resolves.not.toBe(
      await packageDigest(buffer)
    );
  });
});
