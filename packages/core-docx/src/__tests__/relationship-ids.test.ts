/**
 * Relationship identifiers.
 *
 * docx.js numbers most relationships `rId1`, `rId2`, … but mints ids for
 * external hyperlinks from `Math.random`. Before packaging canonicalized them,
 * any document containing a link produced different bytes on every render —
 * which quietly defeated the whole point of deterministic generation, and made
 * a linked document impossible to pin with a golden hash.
 */

import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { CORPUS } from './fixtures/corpus';

const RUNS = 4;

function open(buffer: Buffer): AdmZip {
  return new AdmZip(buffer);
}

/** Every relationship id declared in a `.rels` part, keyed by that part. */
function declaredIds(zip: AdmZip): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.endsWith('.rels')) continue;
    const xml = entry.getData().toString('utf8');
    out.set(
      entry.entryName,
      new Set([...xml.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]))
    );
  }
  return out;
}

/** Every relationship id referenced from a content part. */
function referencedIds(zip: AdmZip): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (!name.endsWith('.xml') || name.includes('/_rels/')) continue;
    const xml = entry.getData().toString('utf8');
    const ids = [...xml.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)].map(
      (m) => m[1]
    );
    if (ids.length > 0) out.set(name, ids);
  }
  return out;
}

function relsPartFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return slash === -1
    ? `_rels/${partName}.rels`
    : `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

const linkedDocument = {
  name: 'docx',
  props: {},
  children: [
    {
      name: 'section',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'See [alpha](https://example.com/a) and [beta](https://example.com/b).',
          },
        },
        {
          name: 'paragraph',
          props: { text: 'Then [gamma](https://example.com/c).' },
        },
      ],
    },
  ],
} as unknown as Parameters<typeof generateBufferFromJson>[0];

describe('relationship id canonicalization', () => {
  it('produces identical bytes for a document containing hyperlinks', async () => {
    const hashes = new Set<string>();
    for (let run = 0; run < RUNS; run += 1) {
      const buffer = await generateBufferFromJson(
        structuredClone(linkedDocument) as never
      );
      hashes.add(
        createHash('sha256')
          .update(buffer as Buffer)
          .digest('hex')
      );
    }

    expect(hashes.size).toBe(1);
  });

  it('renames every volatile id to the conventional rIdN form', async () => {
    const zip = open(
      (await generateBufferFromJson(
        structuredClone(linkedDocument) as never
      )) as Buffer
    );

    for (const [part, ids] of declaredIds(zip)) {
      for (const id of ids) {
        expect({ part, id }).toEqual({
          part,
          id: expect.stringMatching(/^rId\d+$/),
        });
      }
    }
  });

  it('numbers hyperlinks in the order the document uses them', async () => {
    const zip = open(
      (await generateBufferFromJson(
        structuredClone(linkedDocument) as never
      )) as Buffer
    );
    const rels = zip.readAsText('word/_rels/document.xml.rels');
    const body = zip.readAsText('word/document.xml');

    const targets = new Map(
      [...rels.matchAll(/Id="([^"]+)"[^>]*Target="(https?:[^"]+)"/g)].map(
        (m) => [m[1], m[2]]
      )
    );
    const used = [...body.matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"/g)].map(
      (m) => m[1]
    );

    expect(used.map((id) => targets.get(id))).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('leaves a document with no volatile ids byte-identical', async () => {
    // Canonicalization must be inert when there is nothing to canonicalize;
    // the whole corpus of goldens depends on that.
    const plain = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [{ name: 'paragraph', props: { text: 'No links here.' } }],
        },
      ],
    };

    const first = await generateBufferFromJson(structuredClone(plain) as never);
    const second = await generateBufferFromJson(
      structuredClone(plain) as never
    );

    expect((first as Buffer).equals(second as Buffer)).toBe(true);
  });

  it('leaves no dangling relationship reference anywhere in the corpus', async () => {
    // A reference to an id the relationships part never declares is what Word
    // reports as a damaged file. This runs over every corpus case because the
    // one place it happens today — a markdown link inside a table cell — was
    // found by accident, not by looking.
    const offenders: string[] = [];

    for (const testCase of CORPUS) {
      const zip = open(
        (await generateBufferFromJson(
          structuredClone(testCase.document) as never
        )) as Buffer
      );
      const declared = declaredIds(zip);

      for (const [part, ids] of referencedIds(zip)) {
        const known = declared.get(relsPartFor(part)) ?? new Set<string>();
        for (const id of ids) {
          if (!known.has(id)) {
            offenders.push(`${testCase.name}: ${part} references ${id}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  }, 120_000);

  it('still emits a dangling reference for a link inside a table cell', async () => {
    // A pre-existing defect, pinned rather than fixed: the table-cell path
    // registers the hyperlink relationship somewhere the document part cannot
    // see, so the emitted `r:id` resolves to nothing and the file is damaged.
    // It is deliberately absent from the corpus. When it is fixed, this test
    // fails — which is the point.
    const document = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  {
                    header: { content: 'Docs' },
                    cells: [
                      { content: 'See [alpha](https://example.com/alpha)' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    // The defect is driven by a random id, so it does not reproduce on every
    // run; a handful of attempts is enough to see it.
    let sawDangling = false;
    for (let run = 0; run < 8 && !sawDangling; run += 1) {
      const zip = open(
        (await generateBufferFromJson(
          structuredClone(document) as never
        )) as Buffer
      );
      const declared =
        declaredIds(zip).get('word/_rels/document.xml.rels') ?? new Set();
      const used = referencedIds(zip).get('word/document.xml') ?? [];
      sawDangling = used.some((id) => !declared.has(id));
    }

    expect(sawDangling).toBe(true);
  }, 60_000);
});
