/**
 * `docx/shapes` is loaded by the first render that draws a group, and by no
 * other. A document without a native visual must not pay for the module —
 * nor, on a docx older than 9.8.0, fail for want of it.
 *
 * The two cases run in order in one module registry: the plain document
 * first, so the count it sees can only be the module never loaded.
 */

import { describe, expect, it, vi } from 'vitest';
import { generateBufferViaIr } from '../../../core/generateFromIr';
import type { ReportComponentDefinition } from '../../../types';

const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock('docx/shapes', async (importOriginal) => {
  loads.count += 1;
  return importOriginal();
});

const documentWith = (
  children: Record<string, unknown>[]
): ReportComponentDefinition =>
  ({
    name: 'docx',
    props: {},
    children,
  }) as unknown as ReportComponentDefinition;

describe('docx/shapes on the docxjs renderer', () => {
  it('is not loaded for a document without a drawing group', async () => {
    await generateBufferViaIr(
      documentWith([
        { name: 'heading', props: { text: 'Plain', level: 1 } },
        { name: 'paragraph', props: { text: 'No drawing here.' } },
      ]),
      { renderer: 'docxjs' }
    );
    expect(loads.count).toBe(0);
  });

  it('is loaded once a native visual needs it', async () => {
    await generateBufferViaIr(
      documentWith([
        {
          name: 'visual',
          props: {
            renderMode: 'native',
            canvas: { width: 2, height: 1 },
            elements: [
              {
                name: 'shape',
                props: { type: 'rect', x: 0, y: 0, w: 1, h: 1 },
              },
            ],
          },
        },
      ]),
      { renderer: 'docxjs' }
    );
    expect(loads.count).toBe(1);
  });
});
