import { describe, expect, it } from 'vitest';
import {
  applyDocxThemeOverrides,
  resolvePluginTheme,
  resolvePluginThemeDetailed,
} from '../theme-resolution';

const builtin = {
  minimal: { name: 'minimal', colors: { primary: '#000000' } },
  default: { name: 'default', colors: { primary: '#4472C4' } },
};

describe('resolvePluginTheme', () => {
  it('prefers a custom theme, tolerating case for docx', () => {
    const custom = { Brand: { name: 'Brand', colors: { primary: '#ff0000' } } };
    expect(
      resolvePluginTheme(
        { props: { theme: 'brand' } },
        { format: 'docx', customThemes: custom, builtinThemes: builtin }
      )
    ).toBe(custom.Brand);
    expect(
      resolvePluginTheme(
        { props: { theme: 'brand' } },
        { format: 'pptx', customThemes: custom, builtinThemes: builtin }
      )
    ).toBe(builtin.default);
  });

  it('falls back to the built-in the document names, then the format default', () => {
    expect(
      resolvePluginTheme(
        { props: { theme: 'minimal' } },
        { format: 'docx', customThemes: {}, builtinThemes: builtin }
      )
    ).toBe(builtin.minimal);
    expect(
      resolvePluginTheme(
        { props: {} },
        { format: 'pptx', customThemes: {}, builtinThemes: builtin }
      )
    ).toBe(builtin.default);
    expect(
      resolvePluginTheme(
        { props: { theme: 'nope' } },
        { format: 'docx', customThemes: {}, builtinThemes: builtin }
      )
    ).toBe(builtin.minimal);
    expect(
      resolvePluginTheme(
        {},
        { format: 'docx', customThemes: {}, builtinThemes: {} }
      )
    ).toEqual({});
  });

  it('returns an inline pptx theme object as-is', () => {
    const inline = { name: 'inline', colors: {} };
    expect(
      resolvePluginTheme(
        { props: { theme: inline } },
        { format: 'pptx', customThemes: {}, builtinThemes: builtin }
      )
    ).toBe(inline);
  });

  it('merges docx themeOverrides the way the core does', () => {
    const resolved = resolvePluginTheme(
      {
        props: {
          theme: 'minimal',
          themeOverrides: {
            colors: { accent: '#00ff00' },
            fonts: { heading: { family: 'Geist' } },
            styles: { heading1: { size: 30 } },
          },
        },
      },
      {
        format: 'docx',
        customThemes: {},
        builtinThemes: {
          minimal: {
            colors: { primary: '#000000' },
            fonts: { heading: { family: 'Arial', size: 20 } },
            styles: { heading1: { bold: true, size: 24 }, normal: {} },
          },
        },
      }
    ) as any;
    expect(resolved.colors).toEqual({ primary: '#000000', accent: '#00ff00' });
    expect(resolved.fonts.heading).toEqual({ family: 'Geist', size: 20 });
    expect(resolved.styles.heading1).toEqual({ bold: true, size: 30 });
    expect(resolved.styles.normal).toEqual({});
  });

  it('applyDocxThemeOverrides ignores non-object overrides', () => {
    const theme = { colors: { primary: '#000' } };
    expect(applyDocxThemeOverrides(theme, null)).toBe(theme);
  });

  it('reports a theme nobody has, the way the core does, and falls back', () => {
    const resolved = resolvePluginThemeDetailed(
      { props: { theme: 'nope' } },
      {
        format: 'docx',
        customThemes: { corp: { name: 'corp' } },
        builtinThemes: builtin,
      }
    );
    expect(resolved.theme).toBe(builtin.minimal);
    expect(resolved.warning).toMatchObject({
      message: expect.stringContaining('Theme "nope" not found'),
      context: {
        code: 'theme_not_found',
        requested: 'nope',
        available: expect.arrayContaining(['corp', 'minimal']),
      },
    });
    expect(
      resolvePluginThemeDetailed(
        { props: { theme: 'corp' } },
        {
          format: 'docx',
          customThemes: { corp: { name: 'corp' } },
          builtinThemes: builtin,
        }
      ).warning
    ).toBeUndefined();
  });
});
