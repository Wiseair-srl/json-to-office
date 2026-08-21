/**
 * An SVG `ImageRun` carries a raster `fallback` for readers that cannot draw
 * the vector — Word before 2016, and anything else consuming the package.
 * That fallback used to be the SVG bytes relabelled `png`, which those readers
 * render as a broken image.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import probe from 'probe-image-size';
import type { GenerationWarning } from '@json-to-office/shared';
import { generateBufferFromJson } from '../../core/generator';
import type { ReportComponentDefinition } from '../../types';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#3C44E3"/></svg>';

const toDataUri = (markup: string) =>
  `data:image/svg+xml;base64,${Buffer.from(markup, 'utf-8').toString('base64')}`;

/** Minimal 1x1 transparent PNG. */
const PNG_1X1_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function doc(imageProps: Record<string, unknown>): ReportComponentDefinition {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'image', props: imageProps }],
  } as ReportComponentDefinition;
}

interface Media {
  path: string;
  data: Buffer;
}

async function mediaOf(buffer: Buffer): Promise<Media[]> {
  const zip = await JSZip.loadAsync(buffer);
  const media: Media[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith('word/media/')) continue;
    media.push({ path, data: await entry.async('nodebuffer') });
  }
  return media.sort((a, b) => a.path.localeCompare(b.path));
}

const isSvgBytes = (data: Buffer) =>
  data.subarray(0, 512).toString('utf-8').includes('<svg');

describe('inline SVG raster fallback', () => {
  it('ships a real PNG next to the vector instead of relabelled SVG bytes', async () => {
    const warnings: GenerationWarning[] = [];
    const buffer = await generateBufferFromJson(
      doc({ base64: toDataUri(SVG), width: 200 }),
      { warnings }
    );

    const media = await mediaOf(buffer);
    const svg = media.filter((part) => isSvgBytes(part.data));
    const raster = media.filter((part) => !isSvgBytes(part.data));

    // The vector still ships for Word 2016+.
    expect(svg).toHaveLength(1);
    expect(svg[0].data.toString('utf-8')).toContain('<circle');

    // ...and the fallback is now a decodable PNG, not the same markup again.
    expect(raster).toHaveLength(1);
    const size = probe.sync(raster[0].data);
    expect(size?.mime).toBe('image/png');
    // 200px placed at 3x = 600px, within rounding of the placed aspect.
    expect(size!.width).toBeGreaterThanOrEqual(596);
    expect(size!.width).toBeLessThanOrEqual(604);

    expect(
      warnings.filter(
        (entry) => entry.context?.code === 'IMAGE_SVG_RASTER_FAILED'
      )
    ).toEqual([]);
  });

  it('warns and keeps the document renderable when the SVG cannot be parsed', async () => {
    const warnings: GenerationWarning[] = [];
    const buffer = await generateBufferFromJson(
      doc({
        base64: toDataUri('<svg xmlns="http://www.w3.org/2000/svg"><unclosed'),
        width: 200,
      }),
      { warnings }
    );

    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(warnings.map((entry) => entry.context?.code)).toContain(
      'IMAGE_SVG_RASTER_FAILED'
    );

    // Degraded, not broken: the historical bytes still ship, so Word 2016+
    // renders exactly as it did before this pass existed.
    const media = await mediaOf(buffer);
    expect(media.some((part) => isSvgBytes(part.data))).toBe(true);
  });

  it('leaves a raster image untouched', async () => {
    const warnings: GenerationWarning[] = [];
    const buffer = await generateBufferFromJson(
      doc({ base64: PNG_1X1_URI, width: 100 }),
      { warnings }
    );

    const media = await mediaOf(buffer);
    expect(media).toHaveLength(1);
    expect(probe.sync(media[0].data)?.width).toBe(1);
    expect(warnings).toEqual([]);
  });
});
