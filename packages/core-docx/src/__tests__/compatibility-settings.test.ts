/**
 * Word compatibility settings: every document, on both renderers, writes
 * `w:doNotExpandShiftReturn` in settings.xml.
 *
 * A text's `\n` is a manual line break inside its paragraph, and without the
 * flag Word stretches the line before one across the full width of a
 * justified paragraph. On `office-open` the flag replaces the fresh-document
 * compatibility settings rather than adding to them, so those are pinned too.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import type { DocxRendererId } from '../renderers/types';

const RENDERERS: readonly DocxRendererId[] = ['docxjs', 'office-open'];

async function compatXml(renderer: DocxRendererId): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    renderer,
    props: { theme: 'minimal' },
    children: [{ name: 'paragraph', props: { text: 'x' } }],
  } as any);
  const entry = (await JSZip.loadAsync(buf)).file('word/settings.xml');
  if (!entry) throw new Error('word/settings.xml missing');
  const compat = (await entry.async('string')).match(
    /<w:compat>[\s\S]*<\/w:compat>/
  );
  if (!compat) throw new Error('w:compat missing');
  return compat[0];
}

/** Each `w:compatSetting` as name → value, whatever its attribute order. */
function compatSettings(compat: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [element] of compat.matchAll(/<w:compatSetting [^>]*\/>/g)) {
    const name = element.match(/w:name="([^"]+)"/)?.[1];
    const value = element.match(/w:val="([^"]+)"/)?.[1];
    if (name && value) settings[name] = value;
  }
  return settings;
}

describe('compatibility settings', () => {
  it.each(RENDERERS)(
    'writes w:doNotExpandShiftReturn in mode 15 on %s',
    async (renderer) => {
      const compat = await compatXml(renderer);
      // docx.js writes the bare element, office-open w:val="1": both are on.
      expect(compat).toMatch(/<w:doNotExpandShiftReturn(?: w:val="1")?\/>/);
      expect(compatSettings(compat).compatibilityMode).toBe('15');
    }
  );

  it('keeps the office-open fresh-document compatibility settings', async () => {
    expect(compatSettings(await compatXml('office-open'))).toEqual({
      compatibilityMode: '15',
      overrideTableStyleFontSizeAndJustification: '1',
      enableOpenTypeFeatures: '1',
      doNotFlipMirrorIndents: '1',
    });
  });
});
