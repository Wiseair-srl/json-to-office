import { describe, expect, it } from 'vitest';
import { DOCX_IR_SCHEMA_VERSION } from '../types';
import type {
  DocxIR,
  DocxIrInline,
  DocxIrParagraph,
  DocxIrTable,
} from '../types';
import { assertValidDocxIr, validateDocxIr } from '../validation';

function baseIr(overrides: Partial<DocxIR> = {}): DocxIR {
  return {
    schemaVersion: DOCX_IR_SCHEMA_VERSION,
    metadata: {},
    settings: { updateFields: true, trackRevisions: false },
    styles: {
      defaults: { run: {}, paragraph: {} },
      paragraph: [{ id: 'Normal', name: 'Normal' }],
      character: [],
    },
    numbering: [],
    resources: [],
    sections: [],
    comments: [],
    footnotes: [],
    endnotes: [],
    ...overrides,
  };
}

function paragraph(
  children: DocxIrInline[],
  overrides: Partial<DocxIrParagraph> = {}
): DocxIrParagraph {
  return {
    kind: 'paragraph',
    id: 's0.b0',
    path: 'sections[0].children[0]',
    children,
    ...overrides,
  };
}

function withBody(children: DocxIR['sections'][number]['children']): DocxIR {
  return baseIr({
    sections: [
      {
        id: 's0',
        path: 'sections[0]',
        children,
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
      },
    ],
  });
}

const text = (value: string, overrides = {}): DocxIrInline => ({
  kind: 'text',
  text: value,
  ...overrides,
});

describe('validateDocxIr', () => {
  it('accepts a well-formed document', () => {
    const ir = withBody([paragraph([text('Hello')])]);
    expect(validateDocxIr(ir)).toEqual([]);
    expect(() => assertValidDocxIr(ir)).not.toThrow();
  });

  it('rejects a wrong schema version', () => {
    const ir = { ...baseIr(), schemaVersion: 2 } as unknown as DocxIR;
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'schemaVersion' })
    );
  });

  it('rejects a non-positive page size', () => {
    const ir = withBody([]);
    ir.sections[0].properties.page.widthTwips = 0;
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].properties.page.widthTwips',
      })
    );
  });

  it('rejects a non-integer margin', () => {
    const ir = withBody([]);
    ir.sections[0].properties.page.margins.topTwips = 12.5;
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].properties.page.margins.topTwips',
      })
    );
  });

  it('rejects an unresolved colour token', () => {
    const ir = withBody([
      paragraph([text('x', { formatting: { color: { hex: 'primary' } } })]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].formatting.color',
      })
    );
  });

  it('rejects a lowercase hex colour', () => {
    const ir = withBody([
      paragraph([text('x', { formatting: { color: { hex: 'aabbcc' } } })]),
    ]);
    expect(validateDocxIr(ir)).toHaveLength(1);
  });

  it('rejects a non-integer or non-positive font size', () => {
    const ir = withBody([
      paragraph([text('x', { formatting: { sizeHalfPoints: 0 } })]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].formatting.sizeHalfPoints',
      })
    );
  });

  it('rejects a non-integer twip value', () => {
    const ir = withBody([
      paragraph([text('x')], { formatting: { spacing: { afterTwips: 1.5 } } }),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].formatting.spacing.afterTwips',
      })
    );
  });

  it('rejects a paragraph style that is not registered', () => {
    const ir = withBody([paragraph([text('x')], { styleId: 'Ghost' })]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'sections[0].children[0].styleId' })
    );
  });

  it('rejects numbering that references no definition', () => {
    const ir = withBody([
      paragraph([text('x')], {
        numbering: { reference: 'missing', level: 0 },
      }),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].numbering.reference',
      })
    );
  });

  it('accepts an explicit detach from numbering', () => {
    const ir = withBody([
      paragraph([text('x')], {
        numbering: { reference: '', level: 0, none: true },
      }),
    ]);
    expect(validateDocxIr(ir)).toEqual([]);
  });

  it('rejects an image referencing an unknown resource', () => {
    const ir = withBody([
      paragraph([
        {
          kind: 'image',
          resourceId: 'missing',
          widthEmu: 100,
          heightEmu: 100,
        },
      ]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].resourceId',
      })
    );
  });

  it('rejects a non-integer image extent', () => {
    const ir = withBody([
      paragraph([
        { kind: 'image', resourceId: 'res1', widthEmu: 10.5, heightEmu: 100 },
      ]),
    ]);
    ir.resources = [
      {
        id: 'res1',
        kind: 'image',
        mediaType: 'image/png',
        bytes: new Uint8Array([1]),
        byteLength: 1,
        sha256: 'a'.repeat(64),
      },
    ];
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].widthEmu',
      })
    );
  });

  it('rejects a resource whose byteLength disagrees with its bytes', () => {
    const ir = baseIr({
      resources: [
        {
          id: 'res1',
          kind: 'image',
          mediaType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
          byteLength: 99,
          sha256: 'a'.repeat(64),
        },
      ],
    });
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'resources[0]' })
    );
  });

  it('rejects a duplicate resource id', () => {
    const resource = {
      id: 'res1' as const,
      kind: 'image' as const,
      mediaType: 'image/png',
      bytes: new Uint8Array([1]),
      byteLength: 1,
      sha256: 'a'.repeat(64),
    };
    const ir = baseIr({ resources: [resource, { ...resource }] });
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'resources[1]' })
    );
  });

  it('rejects an unclosed bookmark', () => {
    const ir = withBody([
      paragraph([{ kind: 'bookmarkStart', id: 1, name: 'intro' }]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({ path: 'bookmarks' })
    );
  });

  it('rejects a bookmark end with no start', () => {
    const ir = withBody([paragraph([{ kind: 'bookmarkEnd', id: 7 }])]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].id',
      })
    );
  });

  it('accepts a bookmark that spans two paragraphs', () => {
    const ir = withBody([
      paragraph([{ kind: 'bookmarkStart', id: 1, name: 'intro' }, text('a')]),
      paragraph([text('b'), { kind: 'bookmarkEnd', id: 1 }], {
        id: 's0.b1',
        path: 'sections[0].children[1]',
      }),
    ]);
    expect(validateDocxIr(ir)).toEqual([]);
  });

  it('rejects a comment reference with no matching comment', () => {
    const ir = withBody([paragraph([{ kind: 'commentReference', id: 3 }])]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].id',
      })
    );
  });

  it('rejects a note reference with no matching note', () => {
    const ir = withBody([
      paragraph([{ kind: 'noteReference', noteKind: 'footnote', id: 2 }]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].id',
      })
    );
  });

  it('accepts a note reference that resolves', () => {
    const ir = withBody([
      paragraph([{ kind: 'noteReference', noteKind: 'footnote', id: 2 }]),
    ]);
    ir.footnotes = [
      {
        id: 2,
        children: [
          {
            kind: 'paragraph',
            id: 'fn2.b0',
            path: 'footnotes[0].children[0]',
            children: [text('note body')],
          },
        ],
      },
    ];
    expect(validateDocxIr(ir)).toEqual([]);
  });

  it('rejects a revision with no author or a bad date', () => {
    const ir = withBody([
      paragraph([
        {
          kind: 'revision',
          type: 'insert',
          id: 1,
          author: '',
          date: 'not-a-date',
          children: [text('new')],
        },
      ]),
    ]);
    const paths = validateDocxIr(ir).map((v) => v.path);
    expect(paths).toContain('sections[0].children[0].children[0].author');
    expect(paths).toContain('sections[0].children[0].children[0].date');
  });

  it('validates inside a hyperlink and a revision', () => {
    const ir = withBody([
      paragraph([
        {
          kind: 'hyperlink',
          target: { kind: 'external', url: 'https://example.com' },
          children: [text('x', { formatting: { color: { hex: 'nope' } } })],
        },
      ]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].children[0].formatting.color',
      })
    );
  });

  it('rejects an empty hyperlink url', () => {
    const ir = withBody([
      paragraph([
        {
          kind: 'hyperlink',
          target: { kind: 'external', url: '  ' },
          children: [text('x')],
        },
      ]),
    ]);
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].children[0].target.url',
      })
    );
  });

  it('validates blocks nested in table cells', () => {
    const table: DocxIrTable = {
      kind: 'table',
      id: 's0.b0',
      path: 'sections[0].children[0]',
      rows: [
        {
          cells: [
            {
              children: [
                paragraph([text('x')], {
                  styleId: 'Ghost',
                  id: 's0.b0.r0.c0.b0',
                  path: 'sections[0].children[0].rows[0].cells[0].children[0]',
                }),
              ],
            },
          ],
        },
      ],
      columnGrid: { unit: 'twips' as const, values: [2000] },
      width: { kind: 'auto' },
      layout: 'fixed',
    };
    expect(validateDocxIr(withBody([table]))).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].rows[0].cells[0].children[0].styleId',
      })
    );
  });

  it('rejects a non-integer twips column width', () => {
    const table: DocxIrTable = {
      kind: 'table',
      id: 's0.b0',
      path: 'sections[0].children[0]',
      rows: [],
      columnGrid: { unit: 'twips' as const, values: [2000.5] },
      width: { kind: 'auto' },
      layout: 'fixed',
    };
    expect(validateDocxIr(withBody([table]))).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].columnGrid',
      })
    );
  });

  it('accepts a fractional percentage column grid', () => {
    const table: DocxIrTable = {
      kind: 'table',
      id: 's0.b0',
      path: 'sections[0].children[0]',
      rows: [],
      columnGrid: { unit: 'percent' as const, values: [33.33, 33.33, 33.34] },
      width: { kind: 'percent', value: 100 },
      layout: 'fixed',
    };
    expect(validateDocxIr(withBody([table]))).not.toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].columnGrid',
      })
    );
  });

  it('rejects an out-of-range TOC heading range', () => {
    expect(
      validateDocxIr(
        withBody([
          {
            kind: 'toc',
            id: 's0.b0',
            path: 'sections[0].children[0]',
            headingRange: { from: 3, to: 1 },
          },
        ])
      )
    ).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].children[0].headingRange',
      })
    );
  });

  it('validates header and footer parts too', () => {
    const ir = withBody([]);
    ir.sections[0].headers = {
      default: {
        id: 'header:s0:default',
        children: [
          paragraph([text('x', { formatting: { color: { hex: 'zzz' } } })], {
            id: 'header:s0:default.b0',
            path: 'sections[0].headers.default.children[0]',
          }),
        ],
      },
    };
    expect(validateDocxIr(ir)).toContainEqual(
      expect.objectContaining({
        path: 'sections[0].headers.default.children[0].children[0].formatting.color',
      })
    );
  });

  it('reports every violation at once and names the count when throwing', () => {
    const ir = withBody([
      paragraph([text('x', { formatting: { color: { hex: 'nope' } } })], {
        styleId: 'Ghost',
      }),
    ]);
    expect(validateDocxIr(ir)).toHaveLength(2);
    expect(() => assertValidDocxIr(ir)).toThrow(/failed 2 invariant\(s\)/);
  });
});
