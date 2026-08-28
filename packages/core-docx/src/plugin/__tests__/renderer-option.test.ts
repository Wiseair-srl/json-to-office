/**
 * Renderer selection through the plugin generator.
 *
 * The plugin path resolves its own theme and expands custom components before
 * handing the document to the compiler, so it is a second entry point into the
 * same pipeline rather than a wrapper around the first. Backend selection has
 * to work the same way on both, and a capability gap has to fail the same way.
 */

import { describe, expect, it } from 'vitest';
import { createDocumentGenerator } from '../createDocumentGenerator';
import type { ReportComponentDefinition } from '../../types';

const document = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { level: 1, text: 'Plugin' } },
    { name: 'paragraph', props: { text: 'Through the plugin generator.' } },
  ],
} as unknown as ReportComponentDefinition;

/** A comment thread, which the office-open backend does not declare. */
const threaded = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'paragraph',
      props: {
        text: 'Commented.',
        comment: {
          text: 'Parent',
          author: 'A',
          replies: [{ text: 'Reply', author: 'B' }],
        },
      },
    },
  ],
} as unknown as ReportComponentDefinition;

describe('the plugin generator', () => {
  it('takes a renderer from the constructor', async () => {
    const generator = createDocumentGenerator({ renderer: 'office-open' });
    const { buffer } = await generator.generateBuffer(document, {
      validation: { enabled: false },
    });

    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  }, 60_000);

  it('lets a call override the constructor renderer', async () => {
    const generator = createDocumentGenerator({ renderer: 'office-open' });

    const viaDefault = await generator.generateBuffer(document, {
      renderer: 'docxjs',
      validation: { enabled: false },
      generatedAt: '2024-01-01T00:00:00Z',
    });
    const viaOfficeOpen = await generator.generateBuffer(document, {
      validation: { enabled: false },
      generatedAt: '2024-01-01T00:00:00Z',
    });

    expect(viaOfficeOpen.buffer.equals(viaDefault.buffer)).toBe(false);
  }, 60_000);

  it('produces the same bytes as the core entry point', async () => {
    // The two paths run different prologues; the document they compile has to
    // be the same one, on either backend.
    const { generateBufferFromJson } = await import('../../core/generator');

    for (const renderer of ['docxjs', 'office-open'] as const) {
      const generator = createDocumentGenerator({ renderer });
      const plugin = await generator.generateBuffer(document, {
        validation: { enabled: false },
        generatedAt: '2024-01-01T00:00:00Z',
      });
      const core = await generateBufferFromJson(structuredClone(document), {
        renderer,
        validation: { enabled: false },
        generatedAt: '2024-01-01T00:00:00Z',
      });

      expect(plugin.buffer.equals(core)).toBe(true);
    }
  }, 60_000);

  it('refuses a feature the selected backend does not declare', async () => {
    const generator = createDocumentGenerator({ renderer: 'office-open' });

    await expect(
      generator.generateBuffer(threaded, { validation: { enabled: false } })
    ).rejects.toThrow(/comment-threads/);
  }, 60_000);

  it('still renders that document on the default backend', async () => {
    const generator = createDocumentGenerator({});
    const { buffer } = await generator.generateBuffer(threaded, {
      validation: { enabled: false },
    });

    expect(buffer.length).toBeGreaterThan(0);
  }, 60_000);
});
