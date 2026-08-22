import { describe, expect, it } from 'vitest';
import { formatDocxIr, snapshotDocxIr } from '../debug';
import { DOCX_IR_SCHEMA_VERSION, type DocxIR } from '../types';
import { sha256Hex } from '../units';

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function ir(): DocxIR {
  return {
    schemaVersion: DOCX_IR_SCHEMA_VERSION,
    metadata: { title: 'Snapshot', author: 'JTO' },
    settings: { updateFields: true, trackRevisions: false },
    styles: {
      defaults: { run: {}, paragraph: {} },
      paragraph: [{ id: 'Normal', name: 'Normal' }],
      character: [],
    },
    numbering: [],
    resources: [
      {
        id: 'res1',
        kind: 'image',
        mediaType: 'image/png',
        bytes,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      },
    ],
    sections: [
      {
        id: 's0',
        path: 'sections[0]',
        properties: {
          page: {
            widthTwips: 11906,
            heightTwips: 16838,
            orientation: 'portrait',
            margins: {
              topTwips: 1440,
              bottomTwips: 1440,
              leftTwips: 1440,
              rightTwips: 1440,
            },
          },
        },
        children: [
          {
            kind: 'paragraph',
            id: 's0.b0',
            path: 'sections[0].children[0]',
            children: [
              { kind: 'text', text: 'first' },
              { kind: 'text', text: 'second', formatting: undefined },
            ],
          },
          {
            kind: 'paragraph',
            id: 's0.b1',
            path: 'sections[0].children[1]',
            children: [
              {
                kind: 'image',
                resourceId: 'res1',
                widthEmu: 914400,
                heightEmu: 457200,
              },
            ],
          },
        ],
      },
    ],
    comments: [],
    footnotes: [],
    endnotes: [],
  };
}

describe('DocxIR debug snapshots', () => {
  it('replaces resource bytes with the hash and byte length', () => {
    const snapshot = snapshotDocxIr(ir()) as {
      resources: Array<Record<string, unknown>>;
    };

    expect(snapshot.resources[0]).toEqual({
      id: 'res1',
      kind: 'image',
      mediaType: 'image/png',
      byteLength: 8,
      sha256: sha256Hex(bytes),
    });
    expect(JSON.stringify(snapshot)).not.toContain('Uint8Array');
  });

  it('is stable across repeated snapshots', () => {
    expect(formatDocxIr(ir())).toBe(formatDocxIr(ir()));
  });

  it('sorts object keys but preserves array order', () => {
    const snapshot = snapshotDocxIr(ir()) as Record<string, unknown> & {
      sections: Array<{ children: Array<{ id: string }> }>;
    };

    const keys = Object.keys(snapshot);
    expect(keys).toEqual([...keys].sort());
    expect(snapshot.sections[0].children.map((b) => b.id)).toEqual([
      's0.b0',
      's0.b1',
    ]);
  });

  it('omits undefined values so optional fields do not churn a snapshot', () => {
    expect(formatDocxIr(ir())).not.toContain('undefined');
  });

  it('serialises to valid JSON with a trailing newline', () => {
    const text = formatDocxIr(ir());
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('matches a recorded snapshot', () => {
    expect(formatDocxIr(ir())).toMatchSnapshot();
  });
});
