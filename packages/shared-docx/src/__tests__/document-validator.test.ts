import { describe, it, expect } from 'vitest';
import { validate, validateStrict } from '../validation/unified';
import {
  isValidDocument,
  validateDocument,
} from '../validation/unified/document-validator';

describe('validateJsonDocument: docx root recognition', () => {
  it('accepts a minimal docx document with a heading child', () => {
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'heading', props: { text: 'Q1 Report', level: 1 } }],
    });

    const result = validate.jsonDocument(json);

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a section-wrapped docx document', () => {
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            { name: 'heading', props: { text: 'Q1 Report', level: 1 } },
          ],
        },
      ],
    });

    const result = validate.jsonDocument(json);

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('never reports the root docx name as an unknown component', () => {
    // Force a real downstream error so the catch-all union path is exercised.
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'heading',
              // bad: level must be 1-6
              props: { text: 'oops', level: 99 },
            },
          ],
        },
      ],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    const messages = (result.errors ?? []).map((e) => e.message);
    expect(messages.some((m) => /Unknown component "docx"/.test(m))).toBe(
      false
    );
    expect(
      messages.some((m) => /Invalid component configuration for 'docx'/.test(m))
    ).toBe(false);
  });

  it('reports a real props validation error without the docx false-positive', () => {
    const json = JSON.stringify({
      name: 'docx',
      // theme must be a string
      props: { theme: 42 },
      children: [],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    const messages = (result.errors ?? []).map((e) => e.message);
    expect(messages.some((m) => /Unknown component "docx"/.test(m))).toBe(
      false
    );
    // At least one error must point at /props/theme.
    expect(
      (result.errors ?? []).some((e) => e.path.includes('/props/theme'))
    ).toBe(true);
  });

  it('flags an invalid root name with the expected message', () => {
    const json = JSON.stringify({
      name: 'slideshow',
      props: {},
      children: [],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    const nameErrors = (result.errors ?? []).filter((e) => e.path === '/name');
    expect(nameErrors.length).toBeGreaterThan(0);
    expect(
      nameErrors.some((e) => /Invalid name "slideshow"/.test(e.message))
    ).toBe(true);
  });

  it('rejects explicit null props on the root component', () => {
    const json = JSON.stringify({
      name: 'docx',
      props: null,
      children: [],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    expect((result.errors ?? []).some((e) => e.path.startsWith('/props'))).toBe(
      true
    );
  });

  it('populates `data` whenever `valid` is true (isValidDocument contract)', () => {
    // Triggers TypeBox failure (heading is not in docx.allowedChildren) so the
    // deep validator is the one declaring the doc valid. Even on that path,
    // `data` must be populated so `isValidDocument` returns true.
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'heading', props: { text: 'Hi', level: 1 } }],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(isValidDocument(result)).toBe(true);
  });
});

describe('image source mutual exclusivity', () => {
  const doc = (imageProps: Record<string, unknown>) => ({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'image', props: imageProps }],
  });

  it('accepts a single inline svg source', () => {
    const result = validate.document(doc({ svg: '<svg/>', width: 100 }));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects svg + base64 together', () => {
    const result = validate.document(
      doc({ svg: '<svg/>', base64: 'data:image/png;base64,AAAA' })
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.code === 'mutually_exclusive')).toBe(
      true
    );
  });

  it('rejects path + base64 together', () => {
    const result = validate.document(
      doc({ path: 'a.png', base64: 'data:image/png;base64,AAAA' })
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.code === 'mutually_exclusive')).toBe(
      true
    );
  });

  it('treats a whitespace-only source as absent (path wins, no conflict)', () => {
    const result = validate.document(doc({ path: 'a.png', svg: '   ' }));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('detects conflicts on images nested in a table cell', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'table',
          props: {
            columns: [
              {
                header: { content: 'X' },
                cells: [
                  {
                    content: {
                      name: 'image',
                      props: { path: 'a.png', svg: '<svg/>' },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.code === 'mutually_exclusive')).toBe(
      true
    );
  });
});

describe('deep prop validation in nested containers and regions', () => {
  it('flags a bad font prop inside a text-box child (any depth)', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'text-box',
              props: { width: 200, height: 100 },
              // font.size is capped at 120; deep inside a text-box this was
              // silently accepted before the whole-tree walk.
              children: [
                {
                  name: 'paragraph',
                  props: { text: 'big', font: { size: 200 } },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) => e.path.includes('/font/size') && /120/.test(e.message)
      )
    ).toBe(true);
  });

  it('flags a bad font prop inside a columns child', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'columns',
              props: { columns: 2 },
              children: [
                {
                  name: 'paragraph',
                  // characterSpacing must be an object, not a number
                  props: { text: 'x', font: { characterSpacing: 0 } },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/font/characterSpacing')
      )
    ).toBe(true);
  });

  it('flags an unknown font property in a section header/footer region', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {
            // header/footer are Type.Array(Type.Any()) on the section schema,
            // so their entries' props are only caught by the deep walk.
            header: [
              {
                name: 'paragraph',
                props: { text: 'h', font: { size: 8, boldColor: '#000000' } },
              },
            ],
            footer: [
              {
                name: 'paragraph',
                props: { text: 'f', font: { size: 8, boldColor: '#000000' } },
              },
            ],
          },
          children: [{ name: 'paragraph', props: { text: 'body' } }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    const headerHit = (result.errors ?? []).some((e) =>
      e.path.includes('/props/header/0/props/font/boldColor')
    );
    const footerHit = (result.errors ?? []).some((e) =>
      e.path.includes('/props/footer/0/props/font/boldColor')
    );
    expect(headerHit).toBe(true);
    expect(footerHit).toBe(true);
  });

  it('accepts a clean deeply-nested document', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {
            header: [
              { name: 'paragraph', props: { text: 'h', font: { size: 8 } } },
            ],
          },
          children: [
            {
              name: 'text-box',
              props: { width: 200, height: 100 },
              children: [
                {
                  name: 'paragraph',
                  props: { text: 'ok', font: { size: 12 } },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('flags non-array children on a nested container (no silent valid)', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        // A nested container with a non-array `children` used to be caught by a
        // `section`-only guard. The whole-tree walk must keep reporting it —
        // otherwise TypeBox's stripped catch-all leaves zero errors and the
        // document flips back to valid.
        { name: 'section', props: {}, children: 'not-an-array' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) =>
          e.path === '/children/0/children' &&
          /must be an array/i.test(e.message)
      )
    ).toBe(true);
  });

  it('flags non-array children on a deeply nested container', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'text-box',
              props: { width: 200, height: 100 },
              children: 'nope',
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) => e.path === '/children/0/children/0/children'
      )
    ).toBe(true);
  });

  it('reports an unknown component in a header at a well-formed /name path', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          // The region path carries an inner `/props` segment
          // (`/props/header/0/props`); the unknown-component error must point at
          // the entry's `/name`, not mangle the earlier `/props`.
          props: { header: [{ name: 'boguscomp', props: {} }] },
          children: [{ name: 'paragraph', props: { text: 'b' } }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) =>
          e.path === '/children/0/props/header/0/name' &&
          /unknown component/i.test(e.message)
      )
    ).toBe(true);
  });

  it('flags a non-component entry in a header region (whole-tree parity)', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          // The static section schema types header as Type.Any(), but the
          // editor's whole-tree schema resolves it to the component union, so a
          // non-object entry must be reported for parity.
          props: { header: [42] },
          children: [{ name: 'paragraph', props: { text: 'b' } }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) =>
          e.path === '/children/0/props/header/0' &&
          /must be an object/i.test(e.message)
      )
    ).toBe(true);
  });

  it('flags a footer entry missing its name (whole-tree parity)', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { footer: [{ props: {} }] },
          children: [{ name: 'paragraph', props: { text: 'b' } }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) =>
          e.path === '/children/0/props/footer/0/name' &&
          /missing required field "name"/i.test(e.message)
      )
    ).toBe(true);
  });

  it('flags a bad prop on a component inside a table cell', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'table',
              // Cell content nests components under `props`, and the static
              // table schema accepts any cell-content props object — so a
              // capped prop deep in a cell was silently accepted by the CLI
              // while the editor's recursive schema rejected it.
              props: {
                columns: [
                  {
                    cells: [
                      {
                        content: {
                          name: 'paragraph',
                          props: { text: 'x', font: { size: 200 } },
                        },
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

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) =>
          e.path ===
            '/children/0/children/0/props/columns/0/cells/0/content/props/font/size' &&
          /120/.test(e.message)
      )
    ).toBe(true);
  });

  it('flags a bad prop on a component in a table column header', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
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
                    header: {
                      content: {
                        name: 'paragraph',
                        props: { text: 'h', font: { boldColor: '#000000' } },
                      },
                    },
                    cells: [{ content: 'plain' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/props/columns/0/header/content/props/font/boldColor')
      )
    ).toBe(true);
  });

  it('walks components nested in a table cell to any depth', () => {
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
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
                    cells: [
                      {
                        // table nested inside a table cell
                        content: {
                          name: 'table',
                          props: {
                            columns: [
                              {
                                cells: [
                                  {
                                    content: {
                                      name: 'paragraph',
                                      props: { text: 'z', font: { size: 200 } },
                                    },
                                  },
                                ],
                              },
                            ],
                          },
                        },
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

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some(
        (e) =>
          e.path.endsWith('/content/props/font/size') && /120/.test(e.message)
      )
    ).toBe(true);
  });

  it('does not invent errors on clean table cell content', () => {
    // A broken sibling forces the whole-tree walk to run; the clean table
    // (component content, plain-string content, and a column header) must
    // contribute zero errors.
    const result = validate.document({
      name: 'docx',
      props: { theme: 'minimal' },
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
                    header: {
                      content: {
                        name: 'paragraph',
                        props: { text: 'h', font: { size: 10 } },
                      },
                    },
                    cells: [
                      {
                        content: {
                          name: 'paragraph',
                          props: { text: 'ok', font: { size: 12 } },
                        },
                      },
                      { content: 'plain string' },
                    ],
                  },
                ],
              },
            },
            { name: 'paragraph', props: { text: 'b', font: { size: 999 } } },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    // Only the broken sibling is flagged — nothing from the clean table.
    const tableErrors = (result.errors ?? []).filter((e) =>
      e.path.includes('/props/columns/')
    );
    expect(tableErrors).toEqual([]);
  });
});

describe('paragraph boldColor accepts the same values as font.color', () => {
  const docWith = (boldColor: string) =>
    JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: { text: 'a **b**', boldColor, font: { color: 'primary' } },
        },
      ],
    });

  it('accepts a theme color token', () => {
    const result = validate.jsonDocument(docWith('primary'));

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a hex value', () => {
    const result = validate.jsonDocument(docWith('#25408F'));

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a value that is neither hex nor a token name', () => {
    const result = validate.jsonDocument(docWith('not a color'));

    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) => e.path.includes('boldColor'))
    ).toBe(true);
  });
});

describe('stage-1 rejection with an empty deep walk fails closed (#292)', () => {
  const base = {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        children: [{ name: 'paragraph', props: { text: 'hi' } }],
      },
    ],
  };

  it('rejects an unknown key next to name/props at the root', () => {
    const doc = { ...base, bogus: 1 };
    const lenient = validate.jsonDocument(JSON.stringify(doc));
    const strict = validateStrict.jsonDocument(JSON.stringify(doc));

    expect(lenient.valid).toBe(false);
    expect(strict.valid).toBe(false);
    expect((lenient.errors ?? []).length).toBeGreaterThan(0);
  });

  it('rejects an unknown sibling key on a nested component', () => {
    const doc = {
      ...base,
      children: [
        {
          name: 'section',
          children: [{ name: 'paragraph', props: { text: 'hi' }, bogus: 1 }],
        },
      ],
    };

    expect(validate.jsonDocument(JSON.stringify(doc)).valid).toBe(false);
    expect(validateStrict.jsonDocument(JSON.stringify(doc)).valid).toBe(false);
  });

  it('still accepts unknown keys when the caller opts into allowUnknownFields', () => {
    const sibling = { ...base, bogus: 1 };
    const inProps = {
      ...base,
      children: [
        {
          name: 'section',
          children: [{ name: 'paragraph', props: { text: 'hi', bogus: 1 } }],
        },
      ],
    };

    expect(validateDocument(sibling, { allowUnknownFields: true }).valid).toBe(
      true
    );
    expect(validateDocument(inProps, { allowUnknownFields: true }).valid).toBe(
      true
    );
  });

  it('still accepts a document that uses a registered plugin component', () => {
    const doc = {
      ...base,
      children: [
        {
          name: 'section',
          children: [{ name: 'my-widget', props: { anything: true } }],
        },
      ],
    };

    const result = validateDocument(doc, {
      knownCustomNames: new Set(['my-widget']),
    });
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a defective document even when custom names are registered but unused', () => {
    const doc = { ...base, bogus: 1 };

    const result = validateDocument(doc, {
      knownCustomNames: new Set(['my-widget']),
    });
    expect(result.valid).toBe(false);
  });
});

describe('wrong-typed sibling keys fail everywhere the schema types them', () => {
  // `enabled`/`id` are known sibling keys, so a key-presence check passes
  // them; only their TYPE is wrong. The live schema rejects the value, and
  // the containment-relaxed rescue gate must not re-admit it — it once did
  // for embedded regions, because the gate was built without the recursive
  // ref and fell back to the static section schema's Type.Any() regions.
  const withHeaderParagraph = (extra: Record<string, unknown>) => ({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        props: {
          header: [{ name: 'paragraph', props: { text: 'x' }, ...extra }],
        },
        children: [{ name: 'paragraph', props: { text: 'body' } }],
      },
    ],
  });

  it('rejects a non-boolean enabled on a paragraph inside a section header', () => {
    const result = validate.jsonDocument(
      JSON.stringify(withHeaderParagraph({ enabled: 'yes' }))
    );
    expect(result.valid).toBe(false);
    expect((result.errors ?? []).some((e) => e.path.includes('/enabled'))).toBe(
      true
    );
  });

  it('rejects a non-string id on a nested child', () => {
    const doc = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [{ name: 'paragraph', props: { text: 'x' }, id: 7 }],
        },
      ],
    };
    const result = validate.jsonDocument(JSON.stringify(doc));
    expect(result.valid).toBe(false);
    expect((result.errors ?? []).some((e) => e.path.includes('/id'))).toBe(
      true
    );
  });

  it('still accepts well-typed sibling keys in a header', () => {
    const result = validate.jsonDocument(
      JSON.stringify(withHeaderParagraph({ enabled: true, id: 'p1' }))
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
