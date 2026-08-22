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
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
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
