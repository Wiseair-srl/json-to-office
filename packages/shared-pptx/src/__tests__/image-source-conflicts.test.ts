import { describe, it, expect } from 'vitest';
import {
  collectImageSourceConflicts,
  presentImageSources,
} from '../validation/image-source-conflicts';

describe('presentImageSources', () => {
  it('lists only non-empty string sources', () => {
    expect(presentImageSources({ path: 'a', base64: '', svg: '   ' })).toEqual([
      'path',
    ]);
    expect(presentImageSources({ svg: '<svg/>', base64: 'data:...' })).toEqual([
      'base64',
      'svg',
    ]);
    expect(presentImageSources(undefined)).toEqual([]);
  });
});

describe('collectImageSourceConflicts', () => {
  const slide = (imgProps: Record<string, unknown>) => ({
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'image', props: imgProps }],
      },
    ],
  });

  it('accepts a single source', () => {
    expect(collectImageSourceConflicts(slide({ svg: '<svg/>' }))).toEqual([]);
  });

  it('rejects two sources with a mutually_exclusive error', () => {
    const errors = collectImageSourceConflicts(
      slide({ svg: '<svg/>', path: 'x.png' })
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('mutually_exclusive');
    expect(errors[0].message).toMatch(/only one source/);
    expect(errors[0].path).toMatch(/props$/);
  });

  it('treats whitespace-only sources as absent', () => {
    expect(
      collectImageSourceConflicts(slide({ path: 'x.png', base64: '   ' }))
    ).toEqual([]);
  });

  it('finds conflicts nested arbitrarily deep', () => {
    const doc = {
      name: 'pptx',
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'group',
              children: [
                {
                  name: 'image',
                  props: { base64: 'data:...', path: 'x.png' },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(collectImageSourceConflicts(doc)).toHaveLength(1);
  });
});
