import { describe, expect, it } from 'vitest';
import {
  collectColorLiterals,
  collectFontFamilies,
  nearestPaletteToken,
} from './brand';

describe('collectColorLiterals', () => {
  it('finds hex written under a colour-bearing key', () => {
    const document = {
      children: [
        { name: 'text', props: { color: '#FF0000', text: 'Warning' } },
        { name: 'shape', props: { fill: { color: '#0a84ff' } } },
        { name: 'table', props: { borderColor: '#CCC' } },
      ],
    };
    expect(collectColorLiterals(document)).toEqual([
      { path: '/children/0/props/color', raw: '#FF0000', hex: '#FF0000' },
      {
        path: '/children/1/props/fill/color',
        raw: '#0a84ff',
        hex: '#0A84FF',
      },
      { path: '/children/2/props/borderColor', raw: '#CCC', hex: '#CCCCCC' },
    ]);
  });

  it('keeps the colour key when the value sits in an array', () => {
    const found = collectColorLiterals({
      props: { chart: { colors: ['#112233', 'primary'] } },
    });
    expect(found).toEqual([
      { path: '/props/chart/colors/0', raw: '#112233', hex: '#112233' },
    ]);
  });

  it('accepts bare hex, which pptx resolves as a literal', () => {
    expect(
      collectColorLiterals({ props: { fontColor: '1A2B3C' } })[0]
    ).toMatchObject({ hex: '#1A2B3C' });
  });

  it('ignores tokens, transparent, and hex outside a colour key', () => {
    expect(
      collectColorLiterals({
        props: {
          color: 'primary',
          backgroundColor: 'transparent',
          text: '#FF0000 is the brand red',
          id: 'abcdef',
        },
      })
    ).toEqual([]);
  });

  it('skips disabled subtrees', () => {
    expect(
      collectColorLiterals({
        children: [{ enabled: false, props: { color: '#FF0000' } }],
      })
    ).toEqual([]);
  });
});

describe('collectFontFamilies', () => {
  it('finds every authored family, whatever the property is called', () => {
    expect(
      collectFontFamilies({
        children: [
          { props: { font: { family: 'Inter', size: 10 } } },
          { props: { fontFace: 'Georgia' } },
          { props: { fontFamily: 'Courier New' } },
          { props: { text: 'Inter' } },
        ],
      })
    ).toEqual([
      { path: '/children/0/props/font/family', family: 'Inter' },
      { path: '/children/1/props/fontFace', family: 'Georgia' },
      { path: '/children/2/props/fontFamily', family: 'Courier New' },
    ]);
  });
});

describe('nearestPaletteToken', () => {
  const palette = {
    primary: '#2B302B',
    accent: '#6E7F71',
    background: '#FFFFFF',
  };

  it('picks the closest token by perceptual distance', () => {
    expect(nearestPaletteToken('#2C312C', palette)).toMatchObject({
      token: 'primary',
      hex: '#2B302B',
    });
    expect(nearestPaletteToken('#FDFDFD', palette)?.token).toBe('background');
  });

  it('breaks ties by token name, so a fix is reproducible', () => {
    const tied = { beta: '#000000', alpha: '#000000' };
    expect(nearestPaletteToken('#010101', tied)?.token).toBe('alpha');
  });

  it('answers nothing for an empty palette or an unreadable colour', () => {
    expect(nearestPaletteToken('#2C312C', {})).toBeUndefined();
    expect(nearestPaletteToken('nonsense', palette)).toBeUndefined();
  });
});
