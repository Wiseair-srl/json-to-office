/**
 * `revision` and `footnotes`/`endnotes` on the same paragraph cannot both be
 * honoured: tracked-change text renders literally, so a `[^id]` marker inside
 * it never resolves — and `docx` cannot express a footnote reference inside
 * `w:ins`/`w:del` at all, since `InsertedTextRun` wraps exactly one `TextRun`
 * built from its own options.
 *
 * Each half is an independent optional field, so the structural schema accepts
 * the pair; this is the semantic rule that rejects it.
 */
import { describe, it, expect } from 'vitest';
import { collectNoteRevisionConflicts } from '../validation/unified/deep-validator';
import { validate } from '../validation/unified';

const REVISION = {
  segments: [
    { type: 'delete', text: 'old' },
    { type: 'insert', text: 'new' },
  ],
};

function paragraph(props: Record<string, unknown>) {
  return { name: 'paragraph', props };
}

describe('collectNoteRevisionConflicts', () => {
  it('flags footnotes alongside a revision', () => {
    const errors = collectNoteRevisionConflicts(
      paragraph({
        text: 'new[^a]',
        revision: REVISION,
        footnotes: [{ id: 'a', text: 'body' }],
      })
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('/props/footnotes');
    expect(errors[0].code).toBe('mutually_exclusive');
  });

  it('flags endnotes alongside a revision, and both at once', () => {
    const errors = collectNoteRevisionConflicts(
      paragraph({
        text: 'new',
        revision: REVISION,
        footnotes: [{ id: 'a', text: 'body' }],
        endnotes: [{ id: 'b', text: 'body' }],
      })
    );

    expect(errors.map((error) => error.path)).toEqual([
      '/props/footnotes',
      '/props/endnotes',
    ]);
  });

  it('allows each on its own', () => {
    expect(
      collectNoteRevisionConflicts(
        paragraph({ text: 'new', revision: REVISION })
      )
    ).toEqual([]);
    expect(
      collectNoteRevisionConflicts(
        paragraph({ text: 'x[^a]', footnotes: [{ id: 'a', text: 'body' }] })
      )
    ).toEqual([]);
  });

  it('reaches paragraphs nested in containers and table cells', () => {
    const errors = collectNoteRevisionConflicts({
      name: 'docx',
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  {
                    cells: [
                      {
                        content: paragraph({
                          text: 'new',
                          revision: REVISION,
                          endnotes: [{ id: 'a', text: 'body' }],
                        }),
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].path).toContain('/props/endnotes');
  });
});

describe('document validation', () => {
  const document = (paragraphProps: Record<string, unknown>) =>
    JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [paragraph(paragraphProps)],
    });

  it('rejects a document combining them', () => {
    const result = validate.jsonDocument(
      document({
        text: 'new[^a]',
        revision: REVISION,
        footnotes: [{ id: 'a', text: 'body' }],
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors?.some((error) => error.code === 'mutually_exclusive')
    ).toBe(true);
  });

  it('accepts a revision without notes', () => {
    expect(
      validate.jsonDocument(document({ text: 'new', revision: REVISION })).valid
    ).toBe(true);
  });

  it('accepts notes without a revision', () => {
    expect(
      validate.jsonDocument(
        document({ text: 'x[^a]', footnotes: [{ id: 'a', text: 'body' }] })
      ).valid
    ).toBe(true);
  });
});
