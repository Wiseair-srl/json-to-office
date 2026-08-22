import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';
import { formatPptxIr, snapshotPptxIr } from '../debug';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const document = {
  name: 'pptx',
  props: { title: 'Snapshot deck', slideWidth: 10, slideHeight: 7.5 },
  children: [
    {
      name: 'slide',
      props: { notes: 'a note' },
      children: [
        { name: 'text', props: { text: 'Hello', x: 1, y: 1, w: 4, h: 1 } },
        { name: 'image', props: { base64: PNG_1PX, x: 6, y: 1, w: 1, h: 1 } },
      ],
    },
  ],
} as unknown as PresentationComponentDefinition;

function ir() {
  return compileDocumentToIr(structuredClone(document)).ir;
}

describe('PptxIR debug snapshots', () => {
  it('replaces image bytes with a hash and byte length', () => {
    const snapshot = snapshotPptxIr(ir()) as {
      resources: Array<{ origin: Record<string, unknown> }>;
    };

    expect(snapshot.resources[0].origin).toEqual({
      kind: 'inline',
      byteLength: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(snapshot)).not.toContain('Uint8Array');
  });

  it('is stable across repeated compilations', () => {
    expect(formatPptxIr(ir())).toBe(formatPptxIr(ir()));
  });

  it('sorts object keys but preserves array order', () => {
    const snapshot = snapshotPptxIr(ir()) as Record<string, unknown> & {
      slides: Array<{ elements: Array<{ kind: string }> }>;
    };

    const keys = Object.keys(snapshot);
    expect(keys).toEqual([...keys].sort());
    expect(snapshot.slides[0].elements.map((e) => e.kind)).toEqual([
      'textBox',
      'image',
    ]);
  });

  it('omits undefined values so optional fields do not churn the snapshot', () => {
    expect(formatPptxIr(ir())).not.toContain('undefined');
  });

  it('serialises to JSON with a trailing newline', () => {
    const text = formatPptxIr(ir());
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('matches a recorded snapshot', () => {
    expect(formatPptxIr(ir())).toMatchSnapshot();
  });
});
