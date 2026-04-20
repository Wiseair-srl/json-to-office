import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferWithWarnings } from '../core/generator';

const minimalPresentation = {
  name: 'pptx' as const,
  props: {
    title: 'Font Embedding Test',
    slideWidth: 10,
    slideHeight: 7.5,
  },
  children: [
    {
      name: 'slide' as const,
      props: {},
      children: [
        {
          name: 'text',
          props: {
            text: 'Hello',
            x: 1,
            y: 1,
            w: 8,
            h: 1,
            fontSize: 24,
            fontFace: 'Arial',
          },
        },
      ],
    },
  ],
};

describe('E2E: Font embedding (PPTX)', () => {
  it('produces a valid pptx and emits no font warnings when only safe fonts are used', async () => {
    const { buffer, warnings } = await generateBufferWithWarnings(
      minimalPresentation as unknown as Parameters<
        typeof generateBufferWithWarnings
      >[0]
    );
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.files['ppt/presentation.xml']).toBeDefined();
    const fontWarnings = warnings.filter(
      (w) => w.code === 'FONT_UNRESOLVED' || w.code === 'FONT_EMBED_FAILED'
    );
    expect(fontWarnings).toEqual([]);
  });

  it('emits FONT_UNRESOLVED warning for an unregistered non-safe font', async () => {
    const doc = {
      ...minimalPresentation,
      children: [
        {
          name: 'slide' as const,
          props: {},
          children: [
            {
              name: 'text',
              props: {
                text: 'x',
                x: 1,
                y: 1,
                w: 8,
                h: 1,
                fontSize: 24,
                fontFace: 'CompletelyMadeUpFont',
              },
            },
          ],
        },
      ],
    };
    const { warnings } = await generateBufferWithWarnings(
      doc as unknown as Parameters<typeof generateBufferWithWarnings>[0]
    );
    expect(
      warnings.some(
        (w) =>
          w.code === 'FONT_UNRESOLVED' &&
          w.message.includes('CompletelyMadeUpFont')
      )
    ).toBe(true);
  });

  it('throws in strict mode for unregistered non-safe font', async () => {
    const doc = {
      ...minimalPresentation,
      children: [
        {
          name: 'slide' as const,
          props: {},
          children: [
            {
              name: 'text',
              props: {
                text: 'x',
                x: 1,
                y: 1,
                w: 8,
                h: 1,
                fontSize: 24,
                fontFace: 'Nonexistent',
              },
            },
          ],
        },
      ],
    };
    await expect(
      generateBufferWithWarnings(
        doc as unknown as Parameters<typeof generateBufferWithWarnings>[0],
        { fonts: { strict: true } }
      )
    ).rejects.toThrow(/Unresolved font references/);
  });
});
