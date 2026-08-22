/**
 * Renderer selection on the public API.
 *
 * The backend is chosen by an id, never by handing the pipeline an object, and
 * an id it does not know fails before any work happens. What each backend can
 * express is declared rather than discovered: a document needing a feature the
 * selected renderer does not have is refused with the feature name and the IR
 * path that needed it, instead of shipping a file with content missing.
 */

import { describe, expect, it } from 'vitest';
import {
  generateBufferFromJson,
  generateBufferWithWarnings,
} from '../core/generator';
import { createDocumentGenerator } from '../plugin/createDocumentGenerator';
import {
  docxRendererIds,
  isDocxRendererId,
  resolveDocxRenderer,
} from '../renderers/registry';
import { DEFAULT_DOCX_RENDERER_ID } from '../renderers/types';
import type { ReportComponentDefinition } from '../types';

const document = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'paragraph', props: { text: 'Selected.' } }],
} as unknown as ReportComponentDefinition;

describe('the registry', () => {
  it('knows both backends and defaults to docx.js', () => {
    expect([...docxRendererIds()].sort()).toEqual(['docxjs', 'office-open']);
    expect(DEFAULT_DOCX_RENDERER_ID).toBe('docxjs');
    expect(isDocxRendererId('docxjs')).toBe(true);
    expect(isDocxRendererId('office-open')).toBe(true);
    expect(isDocxRendererId('libreoffice')).toBe(false);
  });

  it('resolves the default when no id is given', async () => {
    const renderer = await resolveDocxRenderer();
    expect(renderer.id).toBe('docxjs');
    expect(renderer.format).toBe('docx');
  });

  it('names the valid ids when asked for one it has never heard of', async () => {
    await expect(resolveDocxRenderer('libreoffice' as never)).rejects.toThrow(
      /Unknown docx renderer "libreoffice"/
    );
  });

  it('declares a capability set for each backend', async () => {
    const docxjs = await resolveDocxRenderer('docxjs');
    const officeOpen = await resolveDocxRenderer('office-open');

    for (const renderer of [docxjs, officeOpen]) {
      expect(renderer.capabilities.has('paragraphs')).toBe(true);
      expect(renderer.capabilities.has('tables')).toBe(true);
    }
    // Threading is a verified gap in the second backend: its comment options
    // carry neither a parent nor a resolved state.
    expect(docxjs.capabilities.has('comment-threads')).toBe(true);
    expect(officeOpen.capabilities.has('comment-threads')).toBe(false);
  });
});

describe('generation', () => {
  it('renders through the office-open backend when asked', async () => {
    const buffer = await generateBufferFromJson(structuredClone(document), {
      renderer: 'office-open',
      validation: { enabled: false },
    });

    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  }, 30_000);

  it('selects the backend from the document discriminator', async () => {
    const buffer = await generateBufferFromJson({
      ...structuredClone(document),
      renderer: 'office-open',
    });

    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  }, 30_000);

  it('refuses a document needing a feature the backend does not declare', async () => {
    const threaded = {
      name: 'docx',
      props: {},
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

    await expect(
      generateBufferWithWarnings(threaded, {
        renderer: 'office-open',
        validation: { enabled: false },
      })
    ).rejects.toThrow(/comment-threads/);
  }, 30_000);

  it('still renders that document on the default backend', async () => {
    const threaded = {
      name: 'docx',
      props: {},
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

    const { buffer } = await generateBufferWithWarnings(threaded, {
      validation: { enabled: false },
    });
    expect(buffer.length).toBeGreaterThan(0);
  }, 30_000);

  it('uses the plugin renderer override for validation', async () => {
    const threaded = {
      name: 'docx',
      renderer: 'office-open',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Commented.',
            comment: {
              text: 'Parent',
              replies: [{ text: 'Reply' }],
            },
          },
        },
      ],
    } as unknown as ReportComponentDefinition;

    const generator = createDocumentGenerator({ renderer: 'docxjs' });
    const { buffer } = await generator.generateBuffer(threaded);
    expect(buffer.length).toBeGreaterThan(0);
  }, 30_000);
});
