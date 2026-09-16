/**
 * #331: a report that names no theme is set in the house theme, `consulting`.
 *
 * Every fixture here leaves `props.theme` out (or names nothing real) — a
 * fixture pinned to `consulting` would pass whatever the default was.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { createDocumentGenerator } from '../plugin/createDocumentGenerator';

async function parts(buf: Buffer): Promise<{ doc: string; styles: string }> {
  const zip = await JSZip.loadAsync(buf);
  const read = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`${path} missing`);
    return entry.async('string');
  };
  return {
    doc: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
  };
}

const report = (props: Record<string, unknown>) => ({
  name: 'docx',
  props,
  children: [
    {
      name: 'section',
      children: [
        { name: 'heading', props: { text: 'Findings', level: 1 } },
        { name: 'paragraph', props: { text: 'Revenue grew **12%**.' } },
      ],
    },
  ],
});

async function viaCore(props: Record<string, unknown>) {
  return parts(await generateBufferFromJson(report(props) as never, {}));
}

async function viaPlugin(props: Record<string, unknown>) {
  const result = await createDocumentGenerator({}).generateBuffer(
    report(props) as never
  );
  return parts((result as { buffer: Buffer }).buffer ?? (result as Buffer));
}

describe('a report that names no theme', () => {
  it('renders as one that names consulting, through both entry points', async () => {
    const named = await viaCore({ theme: 'consulting' });
    expect(await viaCore({})).toEqual(named);
    expect(await viaPlugin({})).toEqual(named);
  });

  it('is no longer set in minimal', async () => {
    const none = await viaCore({});
    const minimal = await viaCore({ theme: 'minimal' });
    expect(none.styles).not.toEqual(minimal.styles);
    // Consulting's ink and heading face, not minimal's sage ink.
    expect(none.styles).toContain('1A1F26');
    expect(none.styles).toContain('Arial');
    expect(none.styles).not.toContain('2B302B');
  });

  it('gets the same theme when the name it gives matches nothing', async () => {
    expect(await viaCore({ theme: 'no-such-theme' })).toEqual(
      await viaCore({})
    );
  });
});
