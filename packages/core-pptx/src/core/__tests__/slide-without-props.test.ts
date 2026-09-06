/**
 * A slide may omit `props` entirely.
 *
 * The deep validator checks an omitted `props` as an empty object, so every
 * slide prop being optional makes `{ "name": "slide", "children": [...] }` a
 * valid document. Generation used to dereference `child.props` unguarded and
 * die on those same documents with a raw TypeError.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { processPresentation } from '../structure';
import { generateBufferFromJson } from '../generator';
import { compileDocumentToIr } from '../generateFromIr';
import type { PresentationComponentDefinition } from '../../types';

const propLessDeck = (): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'No slide props' },
    children: [
      {
        name: 'slide',
        children: [{ name: 'text', props: { text: 'Title slide' } }],
      },
      {
        name: 'slide',
        props: { notes: 'this one has props' },
        children: [{ name: 'text', props: { text: 'Second' } }],
      },
    ],
  }) as PresentationComponentDefinition;

describe('slide without props', () => {
  it('is a valid document, so generation must accept it', () => {
    expect(validatePresentationDocument(propLessDeck()).errors).toEqual([]);
  });

  it('processes into a slide with every prop left undefined', () => {
    const processed = processPresentation(propLessDeck());

    expect(processed.slides).toHaveLength(2);
    expect(processed.slides[0].components).toHaveLength(1);
    expect(processed.slides[0].background).toBeUndefined();
    expect(processed.slides[0].notes).toBeUndefined();
    expect(processed.slides[1].notes).toBe('this one has props');
  });

  it('compiles to IR with both slides intact', async () => {
    const { ir } = await compileDocumentToIr(propLessDeck());

    expect(ir.slides).toHaveLength(2);
  });

  it('generates a real .pptx package', async () => {
    const buffer = await generateBufferFromJson(propLessDeck());
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull();
    expect(zip.file('ppt/slides/slide2.xml')).not.toBeNull();
  });
});
