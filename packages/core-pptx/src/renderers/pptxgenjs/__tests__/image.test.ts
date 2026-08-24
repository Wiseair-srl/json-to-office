import path from 'node:path';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../../types';
import { EMU_PER_INCH, type PptxIrImageElement } from '../../../ir/types';
import { emitImage } from '../emit';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';
const SVG_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(SVG).toString(
  'base64'
)}`;
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAACddGYaAAAAFElEQVR42mNk+M+ACzDiVjBSFQAAxRABAAiEqFQAAAAASUVORK5CYII=';

const image = (props: Record<string, unknown>) => ({ name: 'image', props });
const deck = (
  props: Record<string, unknown>
): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: {},
    children: [{ name: 'slide', props: {}, children: [image(props)] }],
  }) as PresentationComponentDefinition;

async function imageOpts(
  props: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { ir } = await compileDocumentToIr(deck(props));
  const element = ir.slides[0].elements[0] as PptxIrImageElement;
  const calls: Record<string, unknown>[] = [];
  const slide = {
    addImage: (opts: Record<string, unknown>) => calls.push(opts),
  } as unknown as PptxGenJS.Slide;
  emitImage(slide, element, {
    pptx: new PptxGenJS(),
    resources: new Map(ir.resources.map((resource) => [resource.id, resource])),
  });
  expect(calls).toHaveLength(1);
  return calls[0];
}

async function slideXml(props: Record<string, unknown>): Promise<string> {
  const { buffer } = await generateBufferViaIr(deck(props));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('PptxGenJS image adapter', () => {
  it('routes inline and path sources', async () => {
    expect(await imageOpts({ svg: SVG, w: 4, h: 2 })).toMatchObject({
      data: SVG_DATA_URI,
    });
    expect(
      await imageOpts({
        base64: 'data:image/png;base64,AAAA',
        w: 4,
        h: 2,
      })
    ).toMatchObject({ data: 'data:image/png;base64,AAAA' });
    expect(
      await imageOpts({ path: 'https://example.com/x.png', w: 4, h: 2 })
    ).toMatchObject({ path: 'https://example.com/x.png' });
    expect(
      await imageOpts({ path: 'assets/logo.png', w: 4, h: 2 })
    ).toMatchObject({ path: path.resolve(process.cwd(), 'assets/logo.png') });
  });

  it('writes auto-sized and covered images into slide XML', async () => {
    const auto = await slideXml({ svg: SVG, w: 4 });
    expect(auto).toContain(
      `<a:ext cx="${4 * EMU_PER_INCH}" cy="${2 * EMU_PER_INCH}"/>`
    );

    const cover = await slideXml({
      base64: PNG_4X2,
      x: 1,
      y: 1,
      w: 4,
      h: 4,
      sizing: { type: 'cover', w: 4, h: 4 },
    });
    expect(cover).toContain('<a:srcRect l="25000" r="25000" t="0" b="0"/>');
    expect(cover).toContain(
      `<a:ext cx="${4 * EMU_PER_INCH}" cy="${4 * EMU_PER_INCH}"/>`
    );
  });
});
