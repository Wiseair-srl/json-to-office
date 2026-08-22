/**
 * Two documents built in one process must not be able to reach each other.
 *
 * Every id a DOCX carries — `w:ins`/`w:del`, comments, footnotes, bookmarks,
 * relationships — is document-scoped: the same number means something else in
 * the next file. The pre-IR writer kept those counters in async-local
 * registries and had to bypass its component cache for anything that touched
 * one, because a cached subtree would replay another document's ids.
 *
 * The compiler allocates all of them itself, in document order, from state it
 * creates per compilation. That makes the whole class of bug structurally
 * impossible rather than avoided — which is worth a test of its own, because it
 * is the reason the cache bypass no longer needs to exist.
 *
 * One id the compiler does *not* own is `wp:docPr`, which belongs to the
 * drawing a backend writes. Both backends are therefore checked below, on a
 * document that actually carries drawings: an adapter that leaves the id to a
 * library's module-level counter produces a different file on the second call
 * and interleaves under concurrency, and neither shows up on a fixture made of
 * paragraphs.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import type { DocxRendererId } from '../renderers/types';
import type { ReportComponentDefinition } from '../types';

const REVISION = {
  segments: [
    { type: 'delete', text: 'old' },
    { type: 'insert', text: 'new' },
  ],
};

/** A document that touches every document-scoped id space at once. */
function annotated(text: string): ReportComponentDefinition {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'heading',
        id: 'anchor',
        props: { level: 1, text: `${text} heading` },
      },
      {
        name: 'paragraph',
        props: {
          text: `${text} with a note[^n] and a [link](https://example.com).`,
          footnotes: [{ id: 'n', text: `${text} note body` }],
          comment: { text: `${text} comment`, author: 'A' },
        },
      },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'H' },
              cells: [{ content: text, revision: REVISION }],
            },
          ],
        },
      },
    ],
  } as unknown as ReportComponentDefinition;
}

async function partsOf(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string) =>
    (await zip.file(name)?.async('string')) ?? '';
  return {
    document: await read('word/document.xml'),
    comments: await read('word/comments.xml'),
    footnotes: await read('word/footnotes.xml'),
    relationships: await read('word/_rels/document.xml.rels'),
  };
}

describe('documents built in one process', () => {
  it('number their ids from scratch each time', async () => {
    const first = await partsOf(
      (await generateBufferFromJson(annotated('First'), {
        validation: { enabled: false },
      })) as Buffer
    );
    const second = await partsOf(
      (await generateBufferFromJson(annotated('Second'), {
        validation: { enabled: false },
      })) as Buffer
    );

    // Same structure, so the same ids — a counter carried over from the first
    // build would show up here as a higher number in the second.
    const stripText = (xml: string) =>
      xml.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, '<w:t/>');
    expect(stripText(second.document)).toBe(stripText(first.document));
    expect(second.relationships).toBe(first.relationships);
  }, 30_000);

  it('resolve each note, comment and bookmark against their own document', async () => {
    const buffer = (await generateBufferFromJson(annotated('Only'), {
      validation: { enabled: false },
    })) as Buffer;
    const parts = await partsOf(buffer);

    // Every reference in the body has a body of its own in the same package.
    const referenced = [
      ...parts.document.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g),
    ].map((match) => match[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(parts.footnotes).toContain(`w:id="${id}"`);
    }

    const commented = [
      ...parts.document.matchAll(/<w:commentReference w:id="(\d+)"\/>/g),
    ].map((match) => match[1]);
    expect(commented.length).toBeGreaterThan(0);
    for (const id of commented) {
      expect(parts.comments).toContain(`w:id="${id}"`);
    }
  }, 30_000);

  it('give each build its own relationship ids for the same link', async () => {
    // An external link is the one construct that costs a relationship, which
    // is what used to leak between documents through the component cache.
    const buffers = await Promise.all([
      generateBufferFromJson(annotated('A'), {
        validation: { enabled: false },
      }),
      generateBufferFromJson(annotated('B'), {
        validation: { enabled: false },
      }),
    ]);

    for (const buffer of buffers) {
      const parts = await partsOf(buffer as Buffer);
      const linked = [...parts.document.matchAll(/r:id="(rId\d+)"/g)].map(
        (match) => match[1]
      );
      for (const id of linked) {
        expect(parts.relationships).toContain(`Id="${id}"`);
      }
    }
  }, 30_000);
});

/** A 4x2 PNG, small enough to inline and real enough to measure. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

/** Drawings in the body, in a shape, and in a header — three different parts. */
const drawings = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'image', props: { base64: PNG_4X2, width: '40%' } },
    {
      name: 'text-box',
      props: { renderAs: 'shape', width: 200, height: 80, text: 'Boxed' },
    },
    {
      name: 'section',
      props: {
        header: [{ name: 'image', props: { base64: PNG_4X2, width: 40 } }],
      },
      children: [{ name: 'paragraph', props: { text: 'Body.' } }],
    },
  ],
} as unknown as ReportComponentDefinition;

/** Every `wp:docPr` id in the package, by the part that holds it. */
async function drawingIds(buffer: Buffer): Promise<Record<string, string[]>> {
  const zip = await JSZip.loadAsync(buffer);
  const found: Record<string, string[]> = {};
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.endsWith('.xml')) continue;
    const ids = [
      ...(await entry.async('string')).matchAll(
        /<wp:docPr\b[^>]*?\bid="(\d+)"/g
      ),
    ].map((match) => match[1]);
    if (ids.length > 0) found[path] = ids;
  }
  return found;
}

describe.each<[DocxRendererId]>([['docxjs'], ['office-open']])(
  'drawing ids on the %s backend',
  (renderer) => {
    const build = (): Promise<Buffer> =>
      generateBufferFromJson(structuredClone(drawings), {
        renderer,
        validation: { enabled: false },
        generatedAt: '2024-01-01T00:00:00Z',
      });

    it('number from scratch on every build', async () => {
      const first = await build();
      const second = await build();

      expect(await drawingIds(second)).toEqual(await drawingIds(first));
      expect(second.equals(first)).toBe(true);
    }, 30_000);

    it('do not interleave when two documents build at once', async () => {
      const [a, b] = await Promise.all([build(), build()]);

      expect(await drawingIds(b)).toEqual(await drawingIds(a));
      expect(b.equals(a)).toBe(true);
    }, 30_000);

    it('are unique within each part', async () => {
      const parts = await drawingIds(await build());

      expect(Object.keys(parts).length).toBeGreaterThan(1);
      for (const ids of Object.values(parts)) {
        expect(new Set(ids).size).toBe(ids.length);
      }
    }, 30_000);
  }
);
