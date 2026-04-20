import { describe, it, expect } from 'vitest';
import { collectFontNamesFromDocx, collectFontNamesFromPptx } from '../collect';

describe('collectFontNamesFromDocx', () => {
  it('collects from theme.fonts.{heading,body,mono,light}.family', () => {
    const doc = {
      name: 'docx',
      props: {
        theme: {
          fonts: {
            heading: { family: 'Inter' },
            body: { family: 'Roboto' },
            mono: { family: 'JetBrains Mono' },
            light: { family: 'Inter' },
          },
        },
      },
      children: [],
    };
    const names = collectFontNamesFromDocx(doc);
    expect(names).toEqual(new Set(['Inter', 'Roboto', 'JetBrains Mono']));
  });

  it('collects from component font.family overrides', () => {
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'heading',
          props: { text: 'x', font: { family: 'Playfair Display' } },
        },
        { name: 'paragraph', props: { text: 'y', font: { family: 'Arial' } } },
      ],
    };
    const names = collectFontNamesFromDocx(doc);
    expect(names).toEqual(new Set(['Playfair Display', 'Arial']));
  });

  it('returns empty for a doc with no font references', () => {
    const names = collectFontNamesFromDocx({
      name: 'docx',
      props: {},
      children: [{ name: 'paragraph', props: { text: 'hi' } }],
    });
    expect(names.size).toBe(0);
  });

  it('trims whitespace and drops empty strings', () => {
    const names = collectFontNamesFromDocx({
      props: {},
      children: [
        { name: 'x', props: { font: { family: '  Inter  ' } } },
        { name: 'y', props: { font: { family: '' } } },
      ],
    });
    expect(names).toEqual(new Set(['Inter']));
  });
});

describe('collectFontNamesFromPptx', () => {
  it('collects from theme.fonts.{heading,body} as plain strings', () => {
    const names = collectFontNamesFromPptx({
      name: 'pptx',
      props: { theme: { fonts: { heading: 'Inter', body: 'Roboto' } } },
      children: [],
    });
    expect(names).toEqual(new Set(['Inter', 'Roboto']));
  });

  it('collects fontFace from text components', () => {
    const names = collectFontNamesFromPptx({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'x', fontFace: 'Montserrat' } },
          ],
        },
      ],
    });
    expect(names).toEqual(new Set(['Montserrat']));
  });

  it('collects chart-specific font fields', () => {
    const names = collectFontNamesFromPptx({
      name: 'pptx',
      props: {},
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'chart',
              props: {
                titleFontFace: 'Inter',
                legendFontFace: 'Roboto',
                dataLabelFontFace: 'Arial',
              },
            },
          ],
        },
      ],
    });
    expect(names).toEqual(new Set(['Inter', 'Roboto', 'Arial']));
  });
});
