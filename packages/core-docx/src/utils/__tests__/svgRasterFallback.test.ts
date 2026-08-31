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
import { rasterizeSvgFallbacks } from '../imageUtils';
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

  it('keeps a page-sized SVG inside the pixel budget', async () => {
    // A4 at 3x would be 2382x3367 ≈ 8 MP ≈ 32 MB of live RGBA. Two dozen of
    // those in one report took a render past 1.1 GB and had the hosted
    // playground's container killed, so the bitmap is capped by area.
    const page =
      '<svg xmlns="http://www.w3.org/2000/svg" width="8.27in" height="11.69in" viewBox="0 0 827 1169"><rect width="827" height="1169" fill="#EEEEEE"/></svg>';

    const buffer = await generateBufferFromJson(
      doc({ base64: toDataUri(page), width: 793.92, height: 1122.24 })
    );

    const raster = (await mediaOf(buffer)).filter(
      (part) => !isSvgBytes(part.data)
    );
    expect(raster).toHaveLength(1);

    const size = probe.sync(raster[0].data);
    expect(size?.mime).toBe('image/png');
    expect(size!.width * size!.height).toBeLessThanOrEqual(1_000_000);
    // Still large enough to read: the cap trims resolution, it does not
    // collapse the image to a thumbnail.
    expect(size!.width * size!.height).toBeGreaterThan(500_000);
    // The page's own proportions survive the trim.
    expect(size!.width / size!.height).toBeCloseTo(827 / 1169, 1);
  });

  it('skips the fallback for a sliver too extreme to fit the budget', async () => {
    // At an aspect ratio this far from square, even the smallest edge the
    // rasterizer will accept implies an area well over budget — clamping to
    // that minimum would hand back the oversized bitmap the cap exists to
    // prevent, so no fallback is written at all.
    const sliver =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 10000"><rect width="1" height="10000" fill="#333333"/></svg>';
    const warnings: GenerationWarning[] = [];

    const buffer = await generateBufferFromJson(
      doc({ base64: toDataUri(sliver), width: 200, height: 100 }),
      { warnings }
    );

    // The document still renders and the vector still ships; the fallback
    // slot keeps the historical SVG bytes, exactly as it does when the
    // rasterizer is unavailable. What matters is that no oversized bitmap
    // was produced.
    expect(buffer.byteLength).toBeGreaterThan(0);
    const media = await mediaOf(buffer);
    expect(
      media.filter((part) => isSvgBytes(part.data)).length
    ).toBeGreaterThan(0);
    expect(media.filter((part) => !isSvgBytes(part.data))).toHaveLength(0);

    expect(warnings.map((entry) => entry.context?.code)).toContain(
      'IMAGE_SVG_RASTER_SKIPPED'
    );
  });

  it('leaves an SVG below the budget at full 3x resolution', async () => {
    const buffer = await generateBufferFromJson(
      doc({ base64: toDataUri(SVG), width: 120 })
    );

    const raster = (await mediaOf(buffer)).filter(
      (part) => !isSvgBytes(part.data)
    );
    const size = probe.sync(raster[0].data);
    // 120px at 3x, untouched by the area cap.
    expect(size!.width).toBeGreaterThanOrEqual(356);
    expect(size!.width).toBeLessThanOrEqual(364);
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

  it('skips the raster entirely when the caller opts out', async () => {
    const warnings: GenerationWarning[] = [];
    const buffer = await generateBufferFromJson(
      doc({ base64: toDataUri(SVG), width: 200 }),
      { warnings, svgRasterFallback: false }
    );

    // docx.js requires the `fallback` slot to be filled, so the vector bytes
    // go in it — the same thing that ships when a raster cannot be produced.
    // Word 2016+ and LibreOffice draw the vector either way; only readers old
    // enough to need the raster lose the image, which is the trade.
    const media = await mediaOf(buffer);
    expect(media.every((part) => isSvgBytes(part.data))).toBe(true);
    expect(
      media.some((part) => probe.sync(part.data)?.mime === 'image/png')
    ).toBe(false);

    // Opting out is not a failure, so it must not warn about one.
    expect(
      warnings.filter((entry) =>
        String(entry.context?.code ?? '').startsWith('IMAGE_SVG_RASTER')
      )
    ).toEqual([]);
  });

  it('rasterizes a batch off the main thread', async () => {
    // `Resvg.render()` is synchronous native code: awaiting it never yields,
    // so a batch started concurrently would still run one at a time. Going
    // through `renderAsync` puts each raster on libuv's threadpool, which is
    // what makes a document of many small SVGs finish in reasonable time.
    const jobs = Array.from({ length: 8 }, (_, i) => ({
      key: `job-${i}`,
      svg: Buffer.from(SVG, 'utf-8'),
      width: 64,
      height: 64,
    }));

    const rasters = await rasterizeSvgFallbacks(jobs);
    expect(rasters.size).toBe(jobs.length);
    for (const job of jobs) {
      expect(probe.sync(rasters.get(job.key)!)?.mime).toBe('image/png');
    }

    expect((await rasterizeSvgFallbacks(jobs, false)).size).toBe(0);
  });
});
