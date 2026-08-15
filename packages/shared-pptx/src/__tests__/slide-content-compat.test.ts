import { describe, expect, it } from 'vitest';
import {
  ColorValueSchema as CanonicalColorValueSchema,
  GridPositionSchema as CanonicalGridPositionSchema,
  PPTX_SLIDE_CONTENT_COMPONENTS,
  PptxSlideContentSchema as CanonicalPptxSlideContentSchema,
  StyleNameSchema as CanonicalStyleNameSchema,
  TextPropsSchema as CanonicalTextPropsSchema,
} from '@json-to-office/shared/schemas/slide-content';
import {
  ColorValueSchema,
  PptxSlideContentSchema,
  StyleNameSchema,
  TextPropsSchema,
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

  it('uses the canonical descriptor tuple in the registry', () => {
    const registered = getPptxContentComponents();
    const names = PPTX_SLIDE_CONTENT_COMPONENTS.map(({ name }) => name);

    expect(registered.map(({ name }) => name)).toEqual(names);
    expect(getPptxStandardComponent('slide')?.allowedChildren).toEqual(names);
    registered.forEach((descriptor, index) => {
      expect(descriptor).toBe(PPTX_SLIDE_CONTENT_COMPONENTS[index]);
    });
  });
});
