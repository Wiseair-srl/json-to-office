/**
 * The shape of the public surface, checked at compile time.
 *
 * `@ts-expect-error` is the assertion here: each one fails the build if the
 * thing it marks ever becomes valid again. That is what stops a renderer type,
 * or a removed native API, from creeping back into the published surface.
 */

import { describe, expect, it } from 'vitest';
import * as corePptx from '../index';
import type { GenerationOptions, PptxRendererId } from '../index';
import type { PresentationComponentDefinition } from '../types';

const document = {
  name: 'pptx',
  props: {},
  children: [
    {
      name: 'slide',
      props: {},
      children: [{ name: 'text', props: { text: 'x' } }],
    },
  ],
} as unknown as PresentationComponentDefinition;

describe('public API surface', () => {
  it('no longer exports the renderer-native entry points', () => {
    // @ts-expect-error `generatePresentation` returned a PptxGenJS instance
    expect(corePptx.generatePresentation).toBeUndefined();
    // @ts-expect-error `savePresentation` took a PptxGenJS instance
    expect(corePptx.savePresentation).toBeUndefined();
    // @ts-expect-error the component writer layer was the PptxGenJS binding
    expect(corePptx.renderComponent).toBeUndefined();
    // @ts-expect-error same
    expect(corePptx.renderTextComponent).toBeUndefined();
  });

  it('no longer exposes generate/save on PresentationGenerator', () => {
    // @ts-expect-error returned a PptxGenJS instance
    expect(corePptx.PresentationGenerator.generate).toBeUndefined();
    // @ts-expect-error took a PptxGenJS instance
    expect(corePptx.PresentationGenerator.save).toBeUndefined();
  });

  it('keeps the buffer and file entry points', () => {
    expect(typeof corePptx.generateBufferFromJson).toBe('function');
    expect(typeof corePptx.generateBufferWithWarnings).toBe('function');
    expect(typeof corePptx.generateAndSaveFromJson).toBe('function');
    expect(typeof corePptx.generateFromFile).toBe('function');
  });

  it('returns a Buffer, not a renderer object', async () => {
    const buffer: Buffer = await corePptx.generateBufferFromJson(document);
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const result: { buffer: Buffer; warnings: corePptx.PipelineWarning[] } =
      await corePptx.generateBufferWithWarnings(document);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  it('accepts every registered renderer id and rejects others', () => {
    const valid: PptxRendererId[] = ['pptxgenjs', 'office-open'];
    expect(corePptx.pptxRendererIds()).toEqual(valid);
    expect(corePptx.DEFAULT_PPTX_RENDERER_ID).toBe('pptxgenjs');

    const options: GenerationOptions = { renderer: 'office-open' };
    expect(options.renderer).toBe('office-open');

    // Renderer ids are format-specific: a DOCX id is not a PPTX id.
    // @ts-expect-error 'docxjs' is not a PptxRendererId
    const wrongFormat: GenerationOptions = { renderer: 'docxjs' };
    expect(wrongFormat.renderer).toBe('docxjs');

    // @ts-expect-error an unregistered id is not assignable
    const unknown: GenerationOptions = { renderer: 'nope' };
    expect(unknown.renderer).toBe('nope');
  });

  it('keeps existing option-free and option-bearing calls valid', async () => {
    await expect(
      corePptx.generateBufferFromJson(document)
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      corePptx.generateBufferFromJson(document, {
        deterministic: true,
        generatedAt: new Date('2020-01-01T00:00:00Z'),
        validation: { enabled: true },
      })
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('does not export the IR from the package surface', () => {
    // The IR stays internal for this release — see the architecture doc.
    // @ts-expect-error not exported
    expect(corePptx.compilePresentation).toBeUndefined();
    // @ts-expect-error not exported
    expect(corePptx.PPTX_IR_SCHEMA_VERSION).toBeUndefined();
  });
});
