/**
 * Language: text runs carry a `lang` attribute. A presentation-level
 * `language` becomes the default for every run; a per-text `language`
 * overrides it for that run.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import type { PresentationComponentDefinition } from '../types';

async function readSlideXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(
    Object.entries(zip.files)
      .filter(([p]) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .map(([, entry]) => entry.async('string'))
  );
  return parts.join('\n');
}

describe('pptx language', () => {
  it('applies the presentation default and a per-text override', async () => {
    const doc: PresentationComponentDefinition = {
      name: 'pptx',
      props: { theme: 'default', language: 'en-US' },
      children: [
        {
          name: 'slide',
          props: {},
          children: [
            {
              name: 'text',
              props: { text: 'Inherits default', x: 0.5, y: 0.5, w: 9, h: 1 },
            } as any,
            {
              name: 'text',
              props: {
                text: 'Texte français',
                language: 'fr-FR',
                x: 0.5,
                y: 2,
                w: 9,
                h: 1,
              },
            } as any,
          ],
        } as any,
      ],
    };
    const buf = await generateBufferFromJson(doc);
    const xml = await readSlideXml(buf);
    expect(xml).toContain('lang="en-US"');
    expect(xml).toContain('lang="fr-FR"');
  });
});
