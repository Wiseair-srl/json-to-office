/**
 * The shapes an `image` has to accept, and the sizes they resolve to.
 *
 * Every case uses a real 4×2 PNG so the aspect ratio is readable, which is what
 * makes the sizing assertions meaningful: a width alone implies a height from
 * it, a percentage resolves against the text column, and an image that states
 * no width at all fills the measure.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { getAvailableWidthTwips } from '../../utils/widthUtils';
import { minimalTheme } from '../../templates/themes';
import type { DocxIrBlock, DocxIrImageRun } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

/** A real 4×2 PNG: wide enough that a derived height is unambiguous. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABp32QpAAAAFElEQVR4nGP8z8DwnwEJMKEL0F4AAJ8fAwGZ6HXBAAAAAElFTkSuQmCC';

/** 1px at 96 DPI in EMU, so pixel expectations read as pixels. */
const EMU_PER_PIXEL = 9525;

async function imageBlocks(
  props: Record<string, unknown>
): Promise<DocxIrBlock[]> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'image', props }],
  } as unknown as ReportComponentDefinition);
  return compiled.ir.sections[0].children;
}

async function imageRun(
  props: Record<string, unknown>
): Promise<DocxIrImageRun> {
  const [block] = await imageBlocks(props);
  expect(block.kind).toBe('paragraph');
  if (block.kind !== 'paragraph') throw new Error('not a paragraph');
  const [run] = block.children;
  expect(run.kind).toBe('image');
  return run as DocxIrImageRun;
}

describe('components/image', () => {
  it('fills the measure when no size is stated', async () => {
    // The width defaults to the whole text column, and the height follows the
    // 2:1 ratio of the bytes.
    const contentPx = Math.round(
      (getAvailableWidthTwips(minimalTheme) / 1440) * 96
    );
    const run = await imageRun({ base64: PNG_4X2 });

    expect(run.widthEmu / EMU_PER_PIXEL).toBe(contentPx);
    expect(run.heightEmu / EMU_PER_PIXEL).toBe(Math.round(contentPx / 2));
  });

  it('derives the height from a stated width', async () => {
    const run = await imageRun({ base64: PNG_4X2, width: 240 });

    expect(run.widthEmu / EMU_PER_PIXEL).toBe(240);
    expect(run.heightEmu / EMU_PER_PIXEL).toBe(120);
  });

  it('does not narrow an image to fit a stated height', async () => {
    // A width that is not stated defaults to the full measure before the
    // ratio is ever consulted, so a height alone sets the height and leaves
    // the width filling the column — the proportions are not preserved.
    const contentPx = Math.round(
      (getAvailableWidthTwips(minimalTheme) / 1440) * 96
    );
    const run = await imageRun({ base64: PNG_4X2, height: 60 });

    expect(run.widthEmu / EMU_PER_PIXEL).toBe(contentPx);
    expect(run.heightEmu / EMU_PER_PIXEL).toBe(60);
  });

  it('takes both dimensions as written, ratio or no ratio', async () => {
    const run = await imageRun({ base64: PNG_4X2, width: 100, height: 100 });

    expect(run.widthEmu / EMU_PER_PIXEL).toBe(100);
    expect(run.heightEmu / EMU_PER_PIXEL).toBe(100);
  });

  it.each(['90%', '50%', '100%', '75.5%'])(
    'resolves a width of %s against the text column',
    async (width) => {
      const contentPx = Math.round(
        (getAvailableWidthTwips(minimalTheme) / 1440) * 96
      );
      const run = await imageRun({ base64: PNG_4X2, width });

      expect(run.widthEmu / EMU_PER_PIXEL).toBe(
        Math.round((contentPx * parseFloat(width)) / 100)
      );
    }
  );

  it.each(['left', 'center', 'right'] as const)(
    'aligns an image %s',
    async (alignment) => {
      const [block] = await imageBlocks({ base64: PNG_4X2, alignment });

      expect(block.kind === 'paragraph' && block.formatting?.alignment).toBe(
        alignment
      );
    }
  );

  it('takes the alignment its theme states for images', async () => {
    // The default theme aligns images left; `center` is only the fallback for
    // a theme that says nothing.
    const [block] = await imageBlocks({ base64: PNG_4X2 });

    expect(block.kind === 'paragraph' && block.formatting?.alignment).toBe(
      'left'
    );
  });

  it('adds a caption as a second, left-aligned paragraph', async () => {
    const blocks = await imageBlocks({ base64: PNG_4X2, caption: 'Figure 1' });

    expect(blocks).toHaveLength(2);
    const caption = blocks[1];
    expect(caption.kind === 'paragraph' && caption.styleId).toBe('Normal');
    expect(caption.kind === 'paragraph' && caption.formatting?.alignment).toBe(
      'left'
    );
  });

  it('carries a long caption through whole', async () => {
    const text = 'A caption long enough to wrap several times over. '.repeat(8);
    const blocks = await imageBlocks({ base64: PNG_4X2, caption: text });

    const caption = blocks[1];
    expect(caption.kind).toBe('paragraph');
    if (caption.kind !== 'paragraph') return;
    const rendered = caption.children
      .map((child) => (child.kind === 'text' ? child.text : ''))
      .join('');
    expect(rendered).toBe(text);
  });

  it('embeds the same bytes once however many times they are used', async () => {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: {},
      children: [
        { name: 'image', props: { base64: PNG_4X2, width: 100 } },
        { name: 'image', props: { base64: PNG_4X2, width: 200 } },
      ],
    } as unknown as ReportComponentDefinition);

    expect(compiled.ir.resources).toHaveLength(1);
  });

  it('prefers base64 over path when both are given', async () => {
    // A path that does not exist: reaching for it would fail the compile.
    const run = await imageRun({
      path: '/no/such/image.png',
      base64: PNG_4X2,
      width: 100,
    });

    expect(run.widthEmu / EMU_PER_PIXEL).toBe(100);
  });

  it('refuses an image with no source at all', async () => {
    await expect(imageBlocks({})).rejects.toThrow(
      'Image component requires one of "path", "base64", or "svg" property'
    );
  });

  it('refuses an image whose path is empty', async () => {
    await expect(imageBlocks({ path: '' })).rejects.toThrow(
      'Image component requires one of "path", "base64", or "svg" property'
    );
  });

  it('says which image it could not load', async () => {
    await expect(imageBlocks({ path: '/no/such/image.png' })).rejects.toThrow(
      /Failed to load image/
    );
  });

  it('accepts every option at once', async () => {
    const blocks = await imageBlocks({
      base64: PNG_4X2,
      width: 300,
      height: 150,
      alignment: 'right',
      caption: 'Everything at once',
      spacing: { before: 12, after: 6 },
      keepNext: true,
      keepLines: true,
    });

    expect(blocks).toHaveLength(2);
    const [figure] = blocks;
    expect(figure.kind).toBe('paragraph');
    if (figure.kind !== 'paragraph') return;
    expect(figure.formatting).toEqual(
      expect.objectContaining({
        alignment: 'right',
        spacing: { beforeTwips: 240, afterTwips: 120 },
        keepNext: true,
        keepLines: true,
      })
    );
  });
});
