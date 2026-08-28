/**
 * What compiling a document demands of a backend.
 *
 * The capability gate has two halves: the compiler records a requirement per IR
 * node that needs one, and an adapter declares the set it can satisfy. Only the
 * second half is visible in a renderer's source, so a feature an adapter claims
 * but the compiler never requires is a check that silently cannot fire — the
 * document renders, and a backend that could not express it drops the content
 * without saying so.
 *
 * These tests pin the first half: the feature name and the IR path a given
 * construct demands. A lowering that stops recording its requirement fails here
 * rather than in whichever backend loses the content first.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { DOCX_FEATURES, type DocxFeature } from '../features';
import type { ReportComponentDefinition } from '../../types';

/** Every feature a document demands, with the path that demanded it. */
async function requirementsOf(
  document: unknown
): Promise<Array<{ feature: string; path: string }>> {
  const compiled = await compileDocumentToIr(
    structuredClone(document) as ReportComponentDefinition,
    { validation: { enabled: false } }
  );
  return compiled.required.map(({ feature, path }) => ({ feature, path }));
}

const featuresOf = async (document: unknown): Promise<string[]> =>
  [...new Set((await requirementsOf(document)).map((r) => r.feature))].sort();

describe('feature requirements', () => {
  it('demands text-frames for a floating paragraph, naming the paragraph', async () => {
    const framed = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Floated.',
            floating: {
              width: 2880,
              height: 1440,
              horizontalPosition: { relative: 'page', align: 'right' },
            },
          },
        },
      ],
    };

    expect(await requirementsOf(framed)).toContainEqual({
      feature: 'text-frames',
      path: 'sections[0].children[0]',
    });
  }, 60_000);

  it('demands nothing about frames from a paragraph that does not float', async () => {
    const plain = {
      name: 'docx',
      props: {},
      children: [{ name: 'paragraph', props: { text: 'In the flow.' } }],
    };

    expect(await featuresOf(plain)).not.toContain('text-frames');
  }, 60_000);

  it('demands custom-properties only when the document has any', async () => {
    const withProperties = {
      name: 'docx',
      props: { metadata: { title: 'T', company: 'Wiseair', version: '2' } },
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    };
    const withoutProperties = {
      name: 'docx',
      props: { metadata: { title: 'T' } },
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    };

    expect(await requirementsOf(withProperties)).toContainEqual({
      feature: 'custom-properties',
      path: 'metadata.custom',
    });
    expect(await featuresOf(withoutProperties)).not.toContain(
      'custom-properties'
    );
  }, 60_000);

  /**
   * The vocabulary the compiler can still only declare, not demand.
   *
   * Read off the compiler's source rather than off a fixture: "no input can
   * require this" is a property of the code, and a fixture only ever shows that
   * *one* document did not. A name here is reserved for lowering that is not
   * written — nothing can require it, so no backend has to answer for it, and
   * both adapters deliberately leave it out of their capability sets.
   *
   * The list shrinking is the goal. It growing means a lowering landed without
   * recording what it needs, which is a capability check that cannot fire.
   */
  it('leaves exactly the unlowered vocabulary unrequired', async () => {
    const compiler = await readFile(
      new URL('../compiler.ts', import.meta.url),
      'utf-8'
    );

    const required = new Set<string>();
    for (const [, feature] of compiler.matchAll(
      /features\.require\(\s*'([a-z-]+)'/g
    )) {
      required.add(feature);
    }
    // The one conditional call: `require(note.endnote ? 'endnotes' : …)`.
    for (const [, whenTrue, whenFalse] of compiler.matchAll(
      /features\.require\([^)]*?'([a-z-]+)'\s*:\s*'([a-z-]+)'/g
    )) {
      required.add(whenTrue);
      required.add(whenFalse);
    }

    expect(
      DOCX_FEATURES.filter((feature: DocxFeature) => !required.has(feature))
    ).toEqual([
      'table-merged-cells',
      'cached-fields',
      'shading',
      'borders',
      'rtl',
    ]);
  });

  it('requires every other feature from somewhere', async () => {
    // Guards the regex above: if it stopped matching, everything would look
    // unrequired and the test would still be green on a shrinking list.
    const compiler = await readFile(
      new URL('../compiler.ts', import.meta.url),
      'utf-8'
    );
    const calls = [...compiler.matchAll(/features\.require\(/g)];

    expect(calls.length).toBeGreaterThan(30);
  });
});
