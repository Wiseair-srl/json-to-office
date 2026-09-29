import JSZip from 'jszip';
import probe from 'probe-image-size';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBufferWithWarnings } from '../../../core/generator';
import {
  repairSvgRasterFallbacks,
  SVG_PREVIEW_PLACEHOLDER,
} from '../svgRasterFallback';
import type {
  PipelineWarning,
  PresentationComponentDefinition,
} from '../../../types';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#3C44E3"/></svg>';

/** PptxGenJS' hardcoded Node fallback: a 100x119 red-X PNG. */
const PLACEHOLDER_BYTES = 1594;

function deck(
  images: Array<Record<string, unknown>>
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'SVG raster fallback' },
    children: [
      {
        name: 'slide',
        props: {},
        children: images.map((props) => ({ name: 'image', props })),
      },
    ],
  } as PresentationComponentDefinition;
}

interface MediaPart {
  path: string;
  data: Buffer;
}

async function mediaOf(
  buffer: Buffer
): Promise<{ png: MediaPart[]; svg: MediaPart[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const png: MediaPart[] = [];
  const svg: MediaPart[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith('ppt/media/')) continue;
    const data = await entry.async('nodebuffer');
    if (path.endsWith('.png')) png.push({ path, data });
    if (path.endsWith('.svg')) svg.push({ path, data });
  }
  const byPath = (a: MediaPart, b: MediaPart) => a.path.localeCompare(b.path);
  return { png: png.sort(byPath), svg: svg.sort(byPath) };
}

describe('inline SVG raster fallbacks', () => {
  it('replaces the broken-image placeholder with a PNG sized to the placed box', async () => {
    const { buffer, warnings } = await generateBufferWithWarnings(
      deck([{ svg: SVG, x: 1, y: 1, w: 2, h: 2 }])
    );
    const { png, svg } = await mediaOf(buffer);

    expect(warnings).toEqual([]);
    expect(png).toHaveLength(1);
    expect(png[0].data.length).not.toBe(PLACEHOLDER_BYTES);

    // 2in at 96 DPI x 3 = 576px.
    const size = probe.sync(png[0].data);
    expect(size?.mime).toBe('image/png');
    expect(size!.width).toBeGreaterThanOrEqual(574);
    expect(size!.width).toBeLessThanOrEqual(578);
    expect(size!.height).toBeGreaterThanOrEqual(574);
    expect(size!.height).toBeLessThanOrEqual(578);

    expect(svg).toHaveLength(1);
    expect(svg[0].data.toString('utf-8')).toBe(SVG);
  });

  it('sizes each preview to its own picture when one SVG is placed twice', async () => {
    const { buffer } = await generateBufferWithWarnings(
      deck([
        { svg: SVG, x: 1, y: 1, w: 2, h: 2 },
        { svg: SVG, x: 4, y: 1, w: 3, h: 3 },
      ])
    );
    const { png } = await mediaOf(buffer);

    expect(png).toHaveLength(2);
    const widths = png
      .map((entry) => probe.sync(entry.data)?.width)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(widths[0]).toBeGreaterThanOrEqual(574);
    expect(widths[0]).toBeLessThanOrEqual(578);
    expect(widths[1]).toBeGreaterThanOrEqual(862);
    expect(widths[1]).toBeLessThanOrEqual(866);
  });

  it('rasterizes a shared preview part at the largest box referencing it', async () => {
    const { buffer } = await generateBufferWithWarnings(
      deck([
        { svg: SVG, x: 1, y: 1, w: 2, h: 2 },
        { svg: SVG, x: 4, y: 1, w: 3, h: 3 },
      ])
    );
    // PptxGenJS keeps one preview part per picture, but its non-SVG branch
    // does collapse duplicate sources. Point both pictures at one preview to
    // pin the behaviour this pass has to survive if that ever changes.
    const zip = await JSZip.loadAsync(buffer);
    const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
    const rels = await zip.file(relsPath)!.async('string');
    const sharedRels = rels.replace(
      'Target="../media/image-1-3.png"',
      'Target="../media/image-1-1.png"'
    );
    // Fail here, not on the width below, if PptxGenJS renames its media parts.
    expect(sharedRels).not.toBe(rels);
    zip.file(relsPath, sharedRels);

    expect(await repairSvgRasterFallbacks(zip)).toBe(true);

    const shared = await zip
      .file('ppt/media/image-1-1.png')!
      .async('nodebuffer');
    const size = probe.sync(shared);
    expect(size!.width).toBeGreaterThanOrEqual(862);
    expect(size!.width).toBeLessThanOrEqual(866);
  });

  it('warns and keeps the placeholder when the SVG cannot be parsed', async () => {
    const { buffer, warnings } = await generateBufferWithWarnings(
      deck([
        {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><unclosed',
          x: 1,
          y: 1,
          w: 2,
          h: 2,
        },
      ])
    );
    const { png } = await mediaOf(buffer);

    expect(warnings.map((entry) => entry.code)).toContain(
      'IMAGE_SVG_RASTER_FAILED'
    );
    expect(png).toHaveLength(1);
    expect(png[0].data.length).toBe(PLACEHOLDER_BYTES);
    expect(png[0].data.equals(SVG_PREVIEW_PLACEHOLDER)).toBe(true);
  });

  it('writes the placeholder on a build that skips finalization', async () => {
    // PptxGenJS 4 writes its own placeholder from a promise nothing awaits,
    // so the part can hold the SVG's text instead. A build that skips
    // finalization returns the backend's buffer when this pass changed
    // nothing, so the placeholder has to count as a change.
    const { buffer } = await generateBufferWithWarnings(
      deck([
        {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><unclosed',
          x: 1,
          y: 1,
          w: 2,
          h: 2,
        },
      ]),
      { deterministic: false }
    );
    const { png } = await mediaOf(buffer);

    expect(png).toHaveLength(1);
    expect(png[0].data.equals(SVG_PREVIEW_PLACEHOLDER)).toBe(true);
  });

  it('writes the placeholder over the raw SVG a raced preview part keeps', async () => {
    const { buffer } = await generateBufferWithWarnings(
      deck([{ svg: SVG, x: 1, y: 1, w: 2, h: 2 }])
    );
    const zip = await JSZip.loadAsync(buffer);
    // What the preview holds when PptxGenJS 4's placeholder write loses the
    // race: the picture's own markup, plus an SVG resvg cannot parse.
    const svgParts = Object.keys(zip.files).filter((name) =>
      name.endsWith('.svg')
    );
    expect(svgParts).toHaveLength(1);
    zip.file('ppt/media/image-1-1.png', '<svg><unclosed');
    zip.file(svgParts[0], '<svg><unclosed');

    const warnings: PipelineWarning[] = [];
    expect(await repairSvgRasterFallbacks(zip, warnings)).toBe(true);
    expect(warnings.map((entry) => entry.code)).toEqual([
      'IMAGE_SVG_RASTER_FAILED',
    ]);
    const preview = await zip
      .file('ppt/media/image-1-1.png')!
      .async('nodebuffer');
    expect(preview.equals(SVG_PREVIEW_PLACEHOLDER)).toBe(true);
  });

  it('leaves a deck without inline SVG untouched', async () => {
    const { buffer } = await generateBufferWithWarnings({
      name: 'pptx',
      props: { title: 'No SVG' },
      children: [
        {
          name: 'slide',
          props: {},
          children: [{ name: 'text', props: { text: 'Plain' } }],
        },
      ],
    } as PresentationComponentDefinition);

    const zip = await JSZip.loadAsync(buffer);
    expect(await repairSvgRasterFallbacks(zip)).toBe(false);
  });

  it('warns instead of authoring a part when the preview target is dangling', async () => {
    const { buffer } = await generateBufferWithWarnings(
      deck([{ svg: SVG, x: 1, y: 1, w: 2, h: 2 }])
    );
    const zip = await JSZip.loadAsync(buffer);
    const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
    const rels = await zip.file(relsPath)!.async('string');
    const dangling = rels.replace(
      'Target="../media/image-1-1.png"',
      'Target="../media/image-1-404.png"'
    );
    expect(dangling).not.toBe(rels);
    zip.file(relsPath, dangling);

    const warnings: PipelineWarning[] = [];
    expect(await repairSvgRasterFallbacks(zip, warnings)).toBe(false);
    expect(warnings.map((entry) => entry.code)).toContain(
      'IMAGE_SVG_RASTER_FAILED'
    );
    expect(zip.file('ppt/media/image-1-404.png')).toBeNull();
  });

  it('repairs a picture carried by a slide layout', async () => {
    const { buffer } = await generateBufferWithWarnings(
      deck([{ svg: SVG, x: 1, y: 1, w: 2, h: 2 }])
    );
    const zip = await JSZip.loadAsync(buffer);
    // Re-home the slide's picture onto a layout part to exercise the
    // PART_PATTERNS branch that no generated deck reaches today.
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const rels = await zip
      .file('ppt/slides/_rels/slide1.xml.rels')!
      .async('string');
    zip.remove('ppt/slides/slide1.xml');
    zip.remove('ppt/slides/_rels/slide1.xml.rels');
    zip.file('ppt/slideLayouts/slideLayout9.xml', slide);
    zip.file('ppt/slideLayouts/_rels/slideLayout9.xml.rels', rels);

    expect(await repairSvgRasterFallbacks(zip)).toBe(true);

    const preview = await zip
      .file('ppt/media/image-1-1.png')!
      .async('nodebuffer');
    expect(preview.byteLength).not.toBe(PLACEHOLDER_BYTES);
    expect(probe.sync(preview)!.width).toBeGreaterThanOrEqual(574);
  });

  it('stays byte-identical across repeated generation', async () => {
    const document = deck([{ svg: SVG, x: 1, y: 1, w: 2, h: 2 }]);
    const first = await generateBufferWithWarnings(document);
    const second = await generateBufferWithWarnings(document);

    expect(first.buffer.equals(second.buffer)).toBe(true);
  });
});

describe('inline SVG raster fallbacks without the rasterizer', () => {
  afterEach(() => {
    vi.doUnmock('@resvg/resvg-js');
    vi.resetModules();
  });

  it('writes the placeholder into every preview when resvg cannot load', async () => {
    const { buffer } = await generateBufferWithWarnings(
      deck([
        { svg: SVG, x: 1, y: 1, w: 2, h: 2 },
        { svg: SVG, x: 4, y: 1, w: 3, h: 3 },
      ])
    );
    const zip = await JSZip.loadAsync(buffer);
    // Stand in for the SVG PptxGenJS 4 can leave in a preview.
    for (const part of ['image-1-1.png', 'image-1-3.png']) {
      expect(zip.file(`ppt/media/${part}`)).not.toBeNull();
      zip.file(`ppt/media/${part}`, SVG);
    }

    vi.resetModules();
    vi.doMock('@resvg/resvg-js', () => {
      throw new Error('native binding missing');
    });
    const { repairSvgRasterFallbacks: repair } = await import(
      '../svgRasterFallback'
    );

    const warnings: PipelineWarning[] = [];
    expect(await repair(zip, warnings)).toBe(true);
    expect(warnings.map((entry) => entry.code)).toEqual([
      'IMAGE_SVG_RASTER_FAILED',
    ]);
    for (const part of ['image-1-1.png', 'image-1-3.png']) {
      const preview = await zip.file(`ppt/media/${part}`)!.async('nodebuffer');
      expect(preview.equals(SVG_PREVIEW_PLACEHOLDER)).toBe(true);
    }
  });
});
