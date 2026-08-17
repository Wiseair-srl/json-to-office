/**
 * Entry-point parity for PPTX, mirroring the DOCX suite.
 *
 * `generateBufferFromJson` and `createPresentationGenerator` each own a copy of
 * the generation prologue — theme resolution (including inline theme objects),
 * export-mode pre-pass and cache-key scoping. In DOCX that duplication silently
 * dropped a root-level prop from the plugin path (#133). PPTX is not unified
 * yet (#132); until it is, these tests fail the moment the two prologues
 * disagree about a document.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';

async function slideXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('ppt/slides/slide1.xml');
  if (!entry) throw new Error('ppt/slides/slide1.xml missing');
  return entry.async('string');
}

async function bothPipelines(doc: unknown): Promise<[string, string]> {
  const viaCore = await generateBufferFromJson(
    structuredClone(doc) as never,
    {}
  );
  const viaPlugin = await createPresentationGenerator({}).generateBuffer(
    structuredClone(doc) as never
  );
  return [
    await slideXml(viaCore as Buffer),
    await slideXml(
      (viaPlugin as { buffer: Buffer }).buffer ?? (viaPlugin as Buffer)
    ),
  ];
}

const deck = (theme: unknown) => ({
  name: 'pptx',
  props: {
    theme,
    slideWidth: 13.333,
    slideHeight: 7.5,
  },
  children: [
    {
      name: 'slide',
      props: { notes: 'parity' },
      children: [
        {
          name: 'text',
          props: {
            text: 'Token',
            x: 1,
            y: 1,
            w: 6,
            h: 1,
            fontSize: 24,
            color: 'primary',
          },
        },
        {
          name: 'shape',
          props: {
            type: 'rect',
            x: 1,
            y: 3,
            w: 4,
            h: 2,
            fill: { color: 'accent' },
          },
        },
      ],
    },
  ],
});

describe('generateBufferFromJson vs createPresentationGenerator', () => {
  it('resolves a built-in theme name identically', async () => {
    const [core, plugin] = await bothPipelines(deck('minimal'));
    expect(plugin).toEqual(core);
  });

  it('resolves an inline theme object identically', async () => {
    // The inline-theme branch is the piece each prologue implements separately.
    const [core, plugin] = await bothPipelines(
      deck({
        name: 'parity-inline',
        colors: {
          primary: '#231F20',
          secondary: '#595959',
          accent: '#E6E620',
          background: '#FFFFFF',
          text: '#000000',
        },
        fonts: { heading: 'Georgia', body: 'Georgia' },
        defaults: { fontSize: 18, fontColor: '#000000' },
      })
    );
    expect(plugin).toContain('231F20');
    expect(plugin).toContain('E6E620');
    expect(plugin).toEqual(core);
  });
});
