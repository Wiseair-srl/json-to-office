/**
 * The shape of the public surface, checked at compile time.
 *
 * `@ts-expect-error` is the assertion here: each one fails the build if the
 * thing it marks ever becomes valid again. That is what stops a renderer type,
 * or a removed native API, from creeping back into the published surface.
 */

import { describe, expect, it } from 'vitest';
import * as coreDocx from '../index';
import type { DocxRendererId } from '../index';
import type { JsonGenerationOptions } from '../core/generator';
import type { ReportComponentDefinition } from '../types';

const document = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'paragraph', props: { text: 'x' } }],
} as unknown as ReportComponentDefinition;

describe('public API surface', () => {
  it('no longer exports the renderer-native entry points', () => {
    // @ts-expect-error `generateDocument` returned a docx.js Document
    expect(coreDocx.generateDocument).toBeUndefined();
    // @ts-expect-error same, from a JSON string or object
    expect(coreDocx.generateDocumentFromJson).toBeUndefined();
    // @ts-expect-error same, from a file
    expect(coreDocx.generateDocumentFromFile).toBeUndefined();
    // @ts-expect-error `saveDocument` took a docx.js Document
    expect(coreDocx.saveDocument).toBeUndefined();
    // @ts-expect-error `generateFromConfig` returned a docx.js Document
    expect(coreDocx.generateFromConfig).toBeUndefined();
  });

  it('no longer exports the writer layer the IR replaced', () => {
    // @ts-expect-error the inline text engine was the docx.js binding
    expect(coreDocx.parseTextWithDecorators).toBeUndefined();
    // @ts-expect-error component renderers built docx.js objects
    expect(coreDocx.renderComponent).toBeUndefined();
    // @ts-expect-error same
    expect(coreDocx.createTypedImageRun).toBeUndefined();
  });

  it('no longer exposes generate on DocumentGenerator', () => {
    // @ts-expect-error returned a docx.js Document
    expect(coreDocx.CoreDocumentGenerator.generate).toBeUndefined();
  });

  it('builds a generator whose methods are the ones documented', () => {
    // `docs/reference/api.md` tabulates these. A method appearing or
    // disappearing without the table moving is exactly the drift that sent
    // readers to a `generate()` that no longer exists (#265).
    const generator = coreDocx.createDocumentGenerator({});

    expect(Object.keys(generator).sort()).toEqual([
      'addComponent',
      'expandStandardDefinition',
      'exportSchema',
      'generateBuffer',
      'generateFile',
      'generateSchema',
      'getComponentNames',
      'getStandardComponentsDefinition',
      'validate',
    ]);
  });

  it('keeps the buffer and file entry points', () => {
    expect(typeof coreDocx.generateBufferFromJson).toBe('function');
    expect(typeof coreDocx.generateBufferWithWarnings).toBe('function');
    expect(typeof coreDocx.generateBufferFromConfig).toBe('function');
    expect(typeof coreDocx.generateBufferFromFile).toBe('function');
    expect(typeof coreDocx.generateAndSaveFromJson).toBe('function');
    expect(typeof coreDocx.generateAndSaveFromFile).toBe('function');
  });

  it('returns a Buffer, not a renderer object', async () => {
    const buffer: Buffer = await coreDocx.generateBufferFromJson(document);
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const result: coreDocx.DocxGenerationResult =
      await coreDocx.generateBufferWithWarnings(document);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  }, 30_000);

  it('accepts every registered renderer id and rejects others', () => {
    const valid: DocxRendererId[] = ['docxjs', 'office-open'];
    expect([...coreDocx.docxRendererIds()].sort()).toEqual([...valid].sort());
    expect(coreDocx.DEFAULT_DOCX_RENDERER_ID).toBe('docxjs');
    expect(coreDocx.isDocxRendererId('docxjs')).toBe(true);

    const options: JsonGenerationOptions = { renderer: 'office-open' };
    expect(options.renderer).toBe('office-open');

    // Renderer ids are format-specific: a PPTX id is not a DOCX id.
    // @ts-expect-error 'pptxgenjs' is not a DocxRendererId
    const wrongFormat: JsonGenerationOptions = { renderer: 'pptxgenjs' };
    expect(wrongFormat.renderer).toBe('pptxgenjs');

    // @ts-expect-error an unregistered id is not assignable
    const unknown: JsonGenerationOptions = { renderer: 'nope' };
    expect(unknown.renderer).toBe('nope');
  });

  it('keeps existing option-free and option-bearing calls valid', async () => {
    await expect(
      coreDocx.generateBufferFromJson(document)
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      coreDocx.generateBufferFromJson(document, {
        deterministic: true,
        generatedAt: new Date('2020-01-01T00:00:00Z'),
        validation: { enabled: true },
      })
    ).resolves.toBeInstanceOf(Buffer);
  }, 30_000);

  it('no longer offers a caching option nothing implements', () => {
    // The component render cache went with the IR — compiling holds no
    // cross-document state, so there is nothing left to cache between
    // documents. Keeping the option would have left a documented performance
    // switch that does nothing (#266).
    const options: coreDocx.DocumentGeneratorOptions = {
      // @ts-expect-error `enableCache` was removed with the render cache
      enableCache: true,
    };
    expect(options).toBeDefined();
  });

  it('does not expose the retired component-cache facade', () => {
    // core-docx has no component render cache, so exporting generic cache
    // primitives here implied a renderer-integrated subsystem that did not exist.
    // @ts-expect-error removed with the component render cache
    expect(coreDocx.MemoryCache).toBeUndefined();
    // @ts-expect-error removed with the component render cache
    expect(coreDocx.CacheKeyGenerator).toBeUndefined();
  });

  it('does not export the IR from the package surface', () => {
    // The IR stays internal for this release — see the architecture doc.
    // @ts-expect-error not exported
    expect(coreDocx.compileDocument).toBeUndefined();
    // @ts-expect-error not exported
    expect(coreDocx.DOCX_IR_SCHEMA_VERSION).toBeUndefined();
    // @ts-expect-error not exported
    expect(coreDocx.validateDocxIr).toBeUndefined();
  });
});
