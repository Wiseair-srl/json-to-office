/**
 * #331: a deck that names no theme is set in the house theme, `consulting`,
 * and the Office-style `default` theme is gone.
 *
 * Every fixture here leaves `props.theme` out (or names nothing real) — a
 * fixture pinned to `consulting` would pass whatever the default was.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';
import {
  DEFAULT_PPTX_THEME,
  getPptxTheme,
  hasPptxTheme,
} from '../themes/defaults';

async function parts(buf: Buffer): Promise<{ slide: string; theme: string }> {
  const zip = await JSZip.loadAsync(buf);
  const read = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`${path} missing`);
    return entry.async('string');
  };
  return {
    slide: await read('ppt/slides/slide1.xml'),
    theme: await read('ppt/theme/theme1.xml'),
  };
}

const deck = (props: Record<string, unknown>) => ({
  name: 'pptx',
  props: { slideWidth: 13.333, slideHeight: 7.5, ...props },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        {
          name: 'text',
          props: { text: 'The market doubled', style: 'title' },
        },
        {
          name: 'text',
          props: { text: 'Body copy', x: 1, y: 3, w: 6, h: 1 },
        },
      ],
    },
  ],
});

async function viaCore(props: Record<string, unknown>) {
  return parts(
    (await generateBufferFromJson(deck(props) as never, {})) as Buffer
  );
}

async function viaPlugin(props: Record<string, unknown>) {
  const result = await createPresentationGenerator({}).generateBuffer(
    deck(props) as never
  );
  return parts((result as { buffer: Buffer }).buffer ?? (result as Buffer));
}

describe('a deck that names no theme', () => {
  it('renders as one that names consulting, through both entry points', async () => {
    const named = await viaCore({ theme: 'consulting' });
    expect(await viaCore({})).toEqual(named);
    expect(await viaPlugin({})).toEqual(named);
  });

  it('is set in consulting, not the Office look', async () => {
    const { slide } = await viaCore({});
    expect(slide).toContain('1A1F26');
    expect(slide).toContain('Calibri');
    expect(slide).not.toContain('333333');
  });

  it('gets the same theme when the name it gives matches nothing', async () => {
    expect(await viaCore({ theme: 'no-such-theme' })).toEqual(
      await viaCore({})
    );
  });
});

describe('the built-in theme names', () => {
  it('no longer answer to default', async () => {
    expect(hasPptxTheme('default')).toBe(false);
    expect(DEFAULT_PPTX_THEME).toBe(getPptxTheme('consulting'));
    expect(await viaCore({ theme: 'default' })).toEqual(await viaCore({}));
  });
});
