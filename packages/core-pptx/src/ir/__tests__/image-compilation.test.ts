/**
 * Image behaviour, ported from the deleted `components/__tests__/image.test.ts`.
 *
 * The old renderer did everything in one function, so every assertion was made
 * against a mocked `slide.addImage`. Those behaviours now live at three seams:
 *
 * - source precedence, path policy and resource interning — the compiler
 * - intrinsic-size work (aspect fill, contain/cover fitting, probe failures) —
 *   `resolveImageLayout`, the async pre-pass, because probing means I/O and the
 *   compiler is synchronous
 * - `data` vs `path` routing — the PptxGenJS adapter
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../core/generateFromIr';
import { resolveImageLayout } from '../../core/resolveImageLayout';
import { processPresentation } from '../../core/structure';
import type {
  PipelineWarning,
  PresentationComponentDefinition,
} from '../../types';
import { emitImage } from '../../renderers/pptxgenjs/emit';
import { compilePresentation } from '../compiler';
import { EMU_PER_INCH } from '../types';
import type { PptxIrImageElement, PptxIrResource } from '../types';
import { assertValidPptxIr } from '../validation';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';

const SVG_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(
  SVG,
  'utf-8'
).toString('base64')}`;

/** A 4x2 px PNG — an aspect ratio of 2, so fitted sizes are exact. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAACddGYaAAAAFElEQVR42mNk+M+ACzDiVjBSFQAAxRABAAiEqFQAAAAASUVORK5CYII=';

function deck(children: unknown[]): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: {},
    children,
  } as PresentationComponentDefinition;
}

const slide = (children: unknown[]): unknown => ({
  name: 'slide',
  props: {},
  children,
});

const image = (props: Record<string, unknown>): unknown => ({
  name: 'image',
  props,
});

/** One image component, compiled to IR through the public entry point. */
function compileImage(
  props: Record<string, unknown>,
  options?: Parameters<typeof compileDocumentToIr>[1]
): {
  element: PptxIrImageElement | undefined;
  resources: PptxIrResource[];
  warnings: PipelineWarning[];
} {
  const { ir, warnings } = compileDocumentToIr(
    deck([slide([image(props)])]),
    options
  );
  assertValidPptxIr(ir);
  const [element] = ir.slides[0].elements;
  return {
    element: element as PptxIrImageElement | undefined,
    resources: ir.resources,
    warnings,
  };
}

function inlineBytes(resource: PptxIrResource): Uint8Array {
  if (resource.origin.kind !== 'inline') {
    throw new Error(`expected an inline resource, got ${resource.origin.kind}`);
  }
  return resource.origin.bytes;
}

/**
 * The option bag the adapter hands PptxGenJS for one image.
 *
 * The old test mocked `slide.addImage`; this does the same thing one layer
 * down, where the call is now made.
 */
function imageOpts(props: Record<string, unknown>): Record<string, unknown> {
  const { ir } = compileDocumentToIr(deck([slide([image(props)])]));
  const element = ir.slides[0].elements[0] as PptxIrImageElement;
  const calls: Record<string, unknown>[] = [];
  const slideStub = {
    addImage: (opts: Record<string, unknown>) => {
      calls.push(opts);
    },
  } as unknown as PptxGenJS.Slide;

  emitImage(slideStub, element, {
    pptx: new PptxGenJS(),
    resources: new Map(ir.resources.map((resource) => [resource.id, resource])),
  });

  expect(calls).toHaveLength(1);
  return calls[0];
}

/**
 * Run the pre-pass over one image component and return its resolved props.
 *
 * `processPresentation` (rather than `compileDocumentToIr`) so the component
 * arrives in the shape the pre-pass consumes, and so a deliberately invalid
 * document can still be exercised.
 */
async function resolveLayout(props: Record<string, unknown>): Promise<{
  props: Record<string, unknown>;
  warnings: PipelineWarning[];
}> {
  const warnings: PipelineWarning[] = [];
  const resolved = await resolveImageLayout(
    processPresentation(deck([slide([image(props)])])),
    warnings
  );
  return { props: resolved.slides[0].components[0].props, warnings };
}

async function slideXml(
  document: PresentationComponentDefinition
): Promise<string> {
  const { buffer } = await generateBufferViaIr(document);
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('ppt/slides/slide1.xml');
  if (!entry) throw new Error('generated package has no ppt/slides/slide1.xml');
  return entry.async('string');
}

describe('PptxIR image sources', () => {
  it('wraps raw svg markup into an inline image/svg+xml resource', () => {
    const { element, resources } = compileImage({ svg: SVG, w: 4, h: 2 });

    expect(resources).toHaveLength(1);
    expect(resources[0].mediaType).toBe('image/svg+xml');
    expect(Buffer.from(inlineBytes(resources[0])).toString('utf-8')).toBe(SVG);
    expect(element?.resourceId).toBe('res1');
  });

  it('prefers svg over base64 and path (precedence svg > base64 > path)', () => {
    // Authoring more than one source is now a document-level conflict (see the
    // next test), so the precedence rule is exercised at the compiler seam
    // that still applies it, past the validator.
    const warnings: PipelineWarning[] = [];
    const { ir } = compilePresentation(
      processPresentation(
        deck([
          slide([
            image({
              svg: SVG,
              base64: 'data:image/png;base64,AAAA',
              path: 'https://example.com/x.png',
              w: 4,
              h: 2,
            }),
          ]),
        ])
      ),
      warnings
    );

    expect(ir.resources).toHaveLength(1);
    expect(ir.resources[0].mediaType).toBe('image/svg+xml');
    expect(Buffer.from(inlineBytes(ir.resources[0])).toString('utf-8')).toBe(
      SVG
    );
  });

  it('rejects a document that authors more than one source', () => {
    expect(() =>
      compileImage({
        svg: SVG,
        base64: 'data:image/png;base64,AAAA',
        path: 'https://example.com/x.png',
        w: 4,
        h: 2,
      })
    ).toThrow(/only one source/);
  });

  it('routes a base64 data URI to an inline resource', () => {
    const { resources } = compileImage({
      base64: 'data:image/png;base64,AAAA',
      w: 4,
      h: 2,
    });

    expect(resources).toHaveLength(1);
    expect(resources[0].origin.kind).toBe('inline');
    expect(resources[0].mediaType).toBe('image/png');
    expect(Buffer.from(inlineBytes(resources[0])).toString('base64')).toBe(
      'AAAA'
    );
  });

  it('routes a URL to a remote resource, not inline bytes', () => {
    const { resources } = compileImage({
      path: 'https://example.com/x.png',
      w: 4,
      h: 2,
    });

    expect(resources).toHaveLength(1);
    expect(resources[0].origin).toEqual({
      kind: 'remote',
      url: 'https://example.com/x.png',
    });
    expect(resources[0].mediaType).toBe('image/png');
  });

  it('warns and skips when no source is provided', () => {
    const { element, resources, warnings } = compileImage({ w: 4, h: 2 });

    expect(element).toBeUndefined();
    expect(resources).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain('IMAGE_NO_SOURCE');
  });

  it('ignores a blank base64 and falls through to a valid path', () => {
    const { element, resources, warnings } = compileImage({
      base64: '   ',
      path: 'https://example.com/x.png',
      w: 4,
      h: 2,
    });

    expect(element).toBeDefined();
    expect(resources[0].origin).toEqual({
      kind: 'remote',
      url: 'https://example.com/x.png',
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns and skips when all sources are blank', () => {
    const { element, resources, warnings } = compileImage({
      svg: '  ',
      base64: '',
      path: '   ',
      w: 4,
      h: 2,
    });

    expect(element).toBeUndefined();
    expect(resources).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain('IMAGE_NO_SOURCE');
  });
});

describe('PptxIR image path policy', () => {
  it('resolves a relative local path against the working directory', () => {
    const { resources } = compileImage({
      path: 'assets/logo.png',
      w: 4,
      h: 2,
    });

    expect(resources[0].origin).toEqual({
      kind: 'file',
      path: path.resolve(process.cwd(), 'assets/logo.png'),
    });
  });

  it('warns and drops an image whose path escapes the allowed roots', () => {
    const { element, resources, warnings } = compileImage({
      path: '../../../etc/passwd',
      w: 4,
      h: 2,
    });

    expect(element).toBeUndefined();
    // Nothing reaches the renderer: no element *and* no resource to stream.
    expect(resources).toHaveLength(0);
    expect(warnings.map((w) => w.code)).toContain('IMAGE_PATH_OUTSIDE_ROOTS');
  });
});

describe('PptxGenJS image option bag', () => {
  it('passes raw svg markup as an image/svg+xml data URI via data', () => {
    const opts = imageOpts({ svg: SVG, w: 4, h: 2 });

    expect(opts.data).toBe(SVG_DATA_URI);
    expect(opts.path).toBeUndefined();
  });

  it('routes a base64 data URI through data', () => {
    const opts = imageOpts({
      base64: 'data:image/png;base64,AAAA',
      w: 4,
      h: 2,
    });

    expect(opts.data).toBe('data:image/png;base64,AAAA');
    expect(opts.path).toBeUndefined();
  });

  it('routes a URL through path', () => {
    const opts = imageOpts({ path: 'https://example.com/x.png', w: 4, h: 2 });

    expect(opts.path).toBe('https://example.com/x.png');
    expect(opts.data).toBeUndefined();
  });

  it('routes a local file through path, already resolved', () => {
    const opts = imageOpts({ path: 'assets/logo.png', w: 4, h: 2 });

    expect(opts.path).toBe(path.resolve(process.cwd(), 'assets/logo.png'));
    expect(opts.data).toBeUndefined();
  });
});

describe('image layout resolution', () => {
  it('auto-calculates missing height from the svg viewBox aspect ratio', async () => {
    // viewBox 200x100 → aspect 2; width 4in → height 2in
    const { props, warnings } = await resolveLayout({ svg: SVG, w: 4 });

    expect(props.w).toBeCloseTo(4);
    expect(props.h).toBeCloseTo(2);
    expect(warnings).toHaveLength(0);
  });

  it('auto-calculates missing width from a raster aspect ratio', async () => {
    const { props } = await resolveLayout({ base64: PNG_4X2, h: 2 });

    expect(props.h).toBeCloseTo(2);
    expect(props.w).toBeCloseTo(4);
  });

  it('carries the auto-calculated height into the package', async () => {
    const xml = await slideXml(deck([slide([image({ svg: SVG, w: 4 })])]));

    expect(xml).toContain(
      `<a:ext cx="${4 * EMU_PER_INCH}" cy="${2 * EMU_PER_INCH}"/>`
    );
  });

  it('leaves both dimensions alone when both are authored', async () => {
    const { props } = await resolveLayout({ base64: PNG_4X2, w: 3, h: 3 });

    expect(props.w).toBe(3);
    expect(props.h).toBe(3);
  });

  it('fits a contained image inside the box and centres it', async () => {
    // Image aspect 2 in a 4x4in box at (1,1) → 4x2in, centred vertically.
    const { props } = await resolveLayout({
      base64: PNG_4X2,
      x: 1,
      y: 1,
      w: 4,
      h: 4,
      sizing: { type: 'contain', w: 4, h: 4 },
    });

    expect(props.x).toBeCloseTo(1);
    expect(props.y).toBeCloseTo(2);
    expect(props.w).toBeCloseTo(4);
    expect(props.h).toBeCloseTo(2);
    // The element is already the fitted size, so no sizing is passed on —
    // the backend's own `contain` produces negative crops.
    expect(props.sizing).toBeUndefined();
  });

  it('hands cover the intrinsic size and the box', async () => {
    const { props } = await resolveLayout({
      base64: PNG_4X2,
      x: 1,
      y: 1,
      w: 4,
      h: 4,
      sizing: { type: 'cover', w: 4, h: 4 },
    });

    expect(props.w).toBe(4);
    expect(props.h).toBe(2);
    expect(props.sizing).toEqual({ type: 'cover', w: 4, h: 4 });
  });

  it('crops a covered image symmetrically in the package', async () => {
    const xml = await slideXml(
      deck([
        slide([
          image({
            base64: PNG_4X2,
            x: 1,
            y: 1,
            w: 4,
            h: 4,
            sizing: { type: 'cover', w: 4, h: 4 },
          }),
        ]),
      ])
    );

    expect(xml).toContain('<a:srcRect l="25000" r="25000" t="0" b="0"/>');
    expect(xml).toContain(
      `<a:ext cx="${4 * EMU_PER_INCH}" cy="${4 * EMU_PER_INCH}"/>`
    );
  });

  it('warns when the sizing box resolves to zero', async () => {
    const { warnings } = await resolveLayout({
      base64: PNG_4X2,
      x: 1,
      y: 1,
      sizing: { type: 'contain', w: 0, h: 0 },
    });

    expect(warnings.map((w) => w.code)).toContain('IMAGE_ZERO_BOX');
  });

  it('warns when the probe fails', async () => {
    const { props, warnings } = await resolveLayout({
      path: 'no-such-image.png',
      w: 4,
    });

    expect(warnings.map((w) => w.code)).toContain('IMAGE_PROBE_FAILED');
    // The failure is reported, not guessed around: the missing dimension stays
    // missing rather than being invented.
    expect(props.h).toBeUndefined();
  });

  // Without the SSRF guard the probe would attempt the request and report the
  // refusal as IMAGE_PROBE_FAILED, so a silent result is the assertion.
  it.each(['https://localhost/x.png', 'https://169.254.169.254/x.png'])(
    'never probes the private URL %s',
    async (url) => {
      const { props, warnings } = await resolveLayout({ path: url, w: 4 });

      expect(warnings).toHaveLength(0);
      expect(props.h).toBeUndefined();
    }
  );

  it('passes a crop box through to the IR in EMU', () => {
    const { element } = compileImage({
      base64: PNG_4X2,
      x: 1,
      y: 1,
      w: 4,
      h: 4,
      sizing: { type: 'crop', w: 2, h: 1 },
    });

    expect(element?.sizing).toEqual({
      type: 'crop',
      widthEmu: 2 * EMU_PER_INCH,
      heightEmu: 1 * EMU_PER_INCH,
    });
  });
});
