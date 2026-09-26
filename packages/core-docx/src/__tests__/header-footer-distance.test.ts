/**
 * The header and footer distances a theme states, as the backends write them.
 *
 * `w:pgMar`'s `w:header` and `w:footer` say how far the running head and foot
 * sit from the page edge. Every theme states both, but the page setup dropped
 * them, so each backend wrote its own default in their place — docx.js 708
 * twips, office-open 851 and 992 — and one document's running heads sat in a
 * different place depending on the renderer, and in neither where the theme
 * put them. What is asserted is that attribute pair, section by section, on
 * both backends: the theme's distances, or a section's own where it states
 * them.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { BUILT_IN_DOCX_THEME_NAMES } from '@json-to-office/shared-docx';
import { generateBufferViaIr } from '../core/generateFromIr';
import { getTheme, minimalTheme } from '../templates/themes';
import type { ThemeConfig } from '../styles';
import type { DocxRendererId } from '../renderers/types';

const RENDERERS: DocxRendererId[] = ['docxjs', 'office-open'];

/**
 * Distances no backend would write by itself, so a theme's can only reach the
 * page by being carried there.
 */
const distinctive = {
  ...minimalTheme,
  name: 'distinctive',
  page: {
    ...minimalTheme.page,
    margins: { ...minimalTheme.page.margins, header: 555, footer: 777 },
  },
} as ThemeConfig;

const attribute = (tag: string, name: string): number =>
  Number(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]);

/** Each section's header and footer distance, in document order. */
async function distances(
  theme: string,
  children: unknown[],
  renderer: DocxRendererId
): Promise<Array<{ header: number; footer: number }>> {
  const { buffer } = await generateBufferViaIr(
    { name: 'docx', props: { theme }, children } as never,
    { renderer, customThemes: { distinctive } }
  );
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  return [...xml.matchAll(/<w:pgMar\b[^>]*>/g)].map(([tag]) => ({
    header: attribute(tag, 'w:header'),
    footer: attribute(tag, 'w:footer'),
  }));
}

/** A section with a running head and foot, so the distances place something. */
const section = (text: string, props: Record<string, unknown> = {}) => ({
  name: 'section',
  props: {
    pageBreak: true,
    header: [{ name: 'paragraph', props: { text: 'Running head' } }],
    footer: [{ name: 'paragraph', props: { text: 'Running foot' } }],
    ...props,
  },
  children: [{ name: 'paragraph', props: { text } }],
});

describe.each(RENDERERS)('header and footer distances on %s', (renderer) => {
  it("writes a theme's own distances", async () => {
    expect(
      await distances('distinctive', [section('Body.')], renderer)
    ).toEqual([{ header: 555, footer: 777 }]);
  });

  it.each(BUILT_IN_DOCX_THEME_NAMES)(
    'writes the bundled %s theme’s distances',
    async (name) => {
      const { header, footer } = getTheme(name)!.page.margins;

      expect(await distances(name, [section('Body.')], renderer)).toEqual([
        { header, footer },
      ]);
    }
  );

  it("lets a section's own distances win, for that section alone", async () => {
    expect(
      await distances(
        'distinctive',
        [
          section('The theme’s.'),
          section('Its own.', {
            page: { margins: { header: 300, footer: 400 } },
          }),
          section('A header of its own.', {
            page: { margins: { header: 500 } },
          }),
          section('A size of its own.', { page: { size: 'LETTER' } }),
        ],
        renderer
      )
    ).toEqual([
      { header: 555, footer: 777 },
      { header: 300, footer: 400 },
      { header: 500, footer: 777 },
      { header: 555, footer: 777 },
    ]);
  });
});
