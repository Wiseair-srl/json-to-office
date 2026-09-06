import { describe, expect, it } from 'vitest';
import {
  ColorValueSchema as CanonicalColorValueSchema,
  GridPositionSchema as CanonicalGridPositionSchema,
  PPTX_SLIDE_CONTENT_COMPONENTS,
  PptxSlideContentSchema as CanonicalPptxSlideContentSchema,
  StyleNameSchema as CanonicalStyleNameSchema,
  TextPropsSchema as CanonicalTextPropsSchema,
  pptxComponentRequiresProps as canonicalRequiresProps,
} from '@json-to-office/shared/schemas/slide-content';
import {
  ColorValueSchema,
  PptxSlideContentSchema,
  StyleNameSchema,
  TextPropsSchema,
  pptxComponentRequiresProps as requiresPropsFromEntry,
} from '../index';
import { getPptxContentComponents } from '../schemas/component-registry';
import { getPptxStandardComponent } from '../schemas/component-registry';
import { PptxSlideContentSchema as SubpathSchema } from '../schemas/component-union';
import { GridPositionSchema } from '../schemas/components/common';

describe('shared-pptx slide content compatibility', () => {
  it('keeps root and schema subpath exports canonical', () => {
    expect(PptxSlideContentSchema).toBe(CanonicalPptxSlideContentSchema);
    expect(SubpathSchema).toBe(CanonicalPptxSlideContentSchema);
    expect(TextPropsSchema).toBe(CanonicalTextPropsSchema);
    expect(GridPositionSchema).toBe(CanonicalGridPositionSchema);
    expect(ColorValueSchema).toBe(CanonicalColorValueSchema);
    expect(StyleNameSchema).toBe(CanonicalStyleNameSchema);
  });

  it('reaches the props-requiredness rule from the package entry', () => {
    // The registry calls itself "the single place a consumer has to look", and
    // a consumer looks at the package entry — `pptxComponentRequiresProps` was
    // re-exported from the registry module but never from `index`, so anyone
    // wanting the same answer the generator uses had to deep-import.
    expect(requiresPropsFromEntry).toBe(canonicalRequiresProps);
    expect(requiresPropsFromEntry(getPptxStandardComponent('slide')!)).toBe(
      false
    );
    expect(requiresPropsFromEntry(getPptxStandardComponent('text')!)).toBe(
      true
    );
  });

  it('uses the canonical descriptor tuple in the registry', () => {
    // `block` is a leaf too, but a PPTX-only one: the canonical tuple is
    // what DOCX visuals share, and a block resolves against a deck.
    const registered = getPptxContentComponents().filter(
      ({ name }) => name !== 'block'
    );
    const names = PPTX_SLIDE_CONTENT_COMPONENTS.map(({ name }) => name);

    expect(registered.map(({ name }) => name)).toEqual(names);
    expect(getPptxStandardComponent('slide')?.allowedChildren).toEqual([
      ...names,
      'block',
      'group',
    ]);
    registered.forEach((descriptor, index) => {
      expect(descriptor).toBe(PPTX_SLIDE_CONTENT_COMPONENTS[index]);
    });
  });
});
