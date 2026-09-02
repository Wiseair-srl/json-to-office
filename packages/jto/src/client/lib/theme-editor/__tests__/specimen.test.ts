import { describe, expect, it } from 'vitest';
import { validate as validateDocx } from '@json-to-office/shared-docx';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { createMinimalTheme } from '@json-to-office/shared-docx';
import { buildThemeSpecimen } from '../specimen';
import type { ThemeJson } from '../model';

/**
 * The specimen is the one document the theme editor renders on the author's
 * behalf; it must validate whatever the theme looks like, and it must name
 * every style slot so the preview actually shows the theme.
 */
describe('theme specimen', () => {
  const docxTheme = createMinimalTheme('spec') as unknown as ThemeJson;
  const docxThemeWithTitle: ThemeJson = {
    ...docxTheme,
    colors: { ...(docxTheme.colors as object), accent4: '#112233' },
    styles: {
      ...(docxTheme.styles as object),
      title: { font: 'heading', size: 30 },
      subtitle: { font: 'body', size: 13 },
    },
  };

  it('docx specimen validates with and without optional styles', () => {
    for (const theme of [docxTheme, docxThemeWithTitle, undefined]) {
      const doc = buildThemeSpecimen('docx', 'spec', theme);
      const result = validateDocx.jsonDocument(JSON.stringify(doc));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('docx specimen uses title/subtitle styles only when the theme has them', () => {
    const plain = JSON.stringify(buildThemeSpecimen('docx', 'spec', docxTheme));
    const styled = JSON.stringify(
      buildThemeSpecimen('docx', 'spec', docxThemeWithTitle)
    );
    expect(plain).not.toContain('"themeStyle":"title"');
    expect(styled).toContain('"themeStyle":"title"');
    expect(styled).toContain('"themeStyle":"subtitle"');
  });

  it('docx specimen only names colour tokens the theme defines', () => {
    const doc = JSON.stringify(buildThemeSpecimen('docx', 'spec', docxTheme));
    expect(doc).toContain('"backgroundColor":"primary"');
    expect(doc).not.toContain('"backgroundColor":"accent4"');
    const withAccent = JSON.stringify(
      buildThemeSpecimen('docx', 'spec', docxThemeWithTitle)
    );
    expect(withAccent).toContain('"backgroundColor":"accent4"');
  });

  it('pptx specimen validates and covers every named style', () => {
    const theme: ThemeJson = {
      name: 'spec',
      colors: {
        primary: '#112233',
        secondary: '#223344',
        accent: '#334455',
        background: '#FFFFFF',
        text: '#000000',
        accent4: '#445566',
      },
      fonts: { heading: 'Arial', body: 'Arial' },
      defaults: { fontSize: 18, fontColor: '#000000' },
    };
    for (const candidate of [theme, undefined]) {
      const doc = buildThemeSpecimen('pptx', 'spec', candidate);
      const result = validatePresentationDocument(doc as any);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      const text = JSON.stringify(doc);
      for (const style of [
        'title',
        'subtitle',
        'heading1',
        'heading2',
        'heading3',
        'body',
        'caption',
      ]) {
        expect(text).toContain(`"style":"${style}"`);
      }
    }
    const withSwatches = JSON.stringify(
      buildThemeSpecimen('pptx', 'spec', theme)
    );
    expect(withSwatches).toContain('"fill":{"color":"accent4"}');
    expect(withSwatches).not.toContain('"fill":{"color":"accent5"}');
  });
});
