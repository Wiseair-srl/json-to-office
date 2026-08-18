import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inlineTemplateMedia } from '../template-media-inliner';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

let baseDir: string;

beforeAll(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-inline-'));
  await fs.mkdir(path.join(baseDir, 'media'), { recursive: true });
  await fs.writeFile(path.join(baseDir, 'media', 'logo.png'), PNG_BYTES);
  await fs.writeFile(path.join(baseDir, 'media', 'big.png'), PNG_BYTES);
  await fs.writeFile(path.join(baseDir, 'media', 'notes.txt'), 'not an image');
});

afterAll(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe('inlineTemplateMedia', () => {
  it('inlines relative image component paths as data URLs', async () => {
    const doc = {
      children: [{ name: 'image', props: { path: 'media/logo.png' } }],
    };
    const result = (await inlineTemplateMedia(doc, baseDir)) as typeof doc;
    expect(result.children[0].props.path).toBe(PNG_DATA_URL);
    // input untouched
    expect(doc.children[0].props.path).toBe('media/logo.png');
  });

  it('inlines background { image: { path } } objects', async () => {
    const doc = {
      props: { background: { image: { path: 'media/logo.png' } } },
    };
    const result = (await inlineTemplateMedia(doc, baseDir)) as typeof doc;
    expect(result.props.background.image.path).toBe(PNG_DATA_URL);
  });

  it('inlines image elements nested in visual components', async () => {
    const doc = {
      children: [
        {
          name: 'visual',
          props: {
            elements: [
              { name: 'shape', props: { type: 'rect' } },
              { name: 'image', props: { path: 'media/logo.png' } },
            ],
          },
        },
      ],
    };
    const result = (await inlineTemplateMedia(doc, baseDir)) as any;
    expect(result.children[0].props.elements[1].props.path).toBe(PNG_DATA_URL);
  });

  it('leaves URLs, data URLs, and absolute paths untouched', async () => {
    const doc = {
      children: [
        { name: 'image', props: { path: 'https://example.com/a.png' } },
        { name: 'image', props: { path: PNG_DATA_URL } },
        { name: 'image', props: { path: '/etc/passwd' } },
      ],
    };
    const result = (await inlineTemplateMedia(doc, baseDir)) as typeof doc;
    expect(result.children.map((c) => c.props.path)).toEqual(
      doc.children.map((c) => c.props.path)
    );
  });

  it('does not inline paths escaping baseDir or missing files', async () => {
    const escape = path.join('..', path.basename(baseDir), 'media', 'logo.png');
    const doc = {
      children: [
        { name: 'image', props: { path: '../outside.png' } },
        { name: 'image', props: { path: 'media/missing.png' } },
        { name: 'image', props: { path: 'media/../../oops.png' } },
        { name: 'image', props: { path: escape } },
      ],
    };
    const result = (await inlineTemplateMedia(doc, baseDir)) as typeof doc;
    expect(result.children[0].props.path).toBe('../outside.png');
    expect(result.children[1].props.path).toBe('media/missing.png');
    expect(result.children[2].props.path).toBe('media/../../oops.png');
  });

  it('skips non-image extensions and files over the per-file cap', async () => {
    const doc = {
      children: [
        { name: 'image', props: { path: 'media/notes.txt' } },
        { name: 'image', props: { path: 'media/big.png' } },
      ],
    };
    const result = (await inlineTemplateMedia(doc, baseDir, {
      maxFileBytes: 4,
    })) as typeof doc;
    expect(result.children[0].props.path).toBe('media/notes.txt');
    expect(result.children[1].props.path).toBe('media/big.png');
  });

  it('stops inlining once the total budget is exhausted', async () => {
    const doc = {
      children: [
        { name: 'image', props: { path: 'media/logo.png' } },
        { name: 'image', props: { path: 'media/big.png' } },
      ],
    };
    const result = (await inlineTemplateMedia(doc, baseDir, {
      maxTotalBytes: PNG_BYTES.length,
    })) as typeof doc;
    expect(result.children[0].props.path).toBe(PNG_DATA_URL);
    expect(result.children[1].props.path).toBe('media/big.png');
  });

  it('reuses cached data for repeated references without double-charging', async () => {
    const doc = {
      children: [
        { name: 'image', props: { path: 'media/logo.png' } },
        { name: 'image', props: { path: 'media/logo.png' } },
      ],
    };
    const result = (await inlineTemplateMedia(doc, baseDir, {
      maxTotalBytes: PNG_BYTES.length,
    })) as typeof doc;
    expect(result.children[0].props.path).toBe(PNG_DATA_URL);
    expect(result.children[1].props.path).toBe(PNG_DATA_URL);
  });
});
