import { describe, it, expect } from 'vitest';
import { validate, validateStrict } from '../validation/unified';

const slide = (children: any[], props: Record<string, unknown> = {}) => ({
  name: 'slide',
  props,
  children,
});

const deck = (slides: any[], props: Record<string, unknown> = {}) => ({
  name: 'pptx',
  props: { title: 'Test deck', ...props },
  children: slides,
});

describe('validateJsonPresentationDocument: pptx root recognition', () => {
  it('accepts a minimal pptx document with a text child', () => {
    const json = JSON.stringify(
      deck([
        slide([
          { name: 'text', props: { text: 'Hello', x: 1, y: 1, w: 4, h: 1 } },
        ]),
      ])
    );

    const result = validate.jsonDocument(json);

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a non-pptx root name', () => {
    const result = validate.document({ name: 'pttx', children: [] });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/name',
        message: expect.stringMatching(/invalid name "pttx"/i),
      })
    );
  });

  it('rejects a document missing its children array', () => {
    const result = validate.document({ name: 'pptx', props: {} });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: '/children' })
    );
  });

  it('rejects invalid JSON with a parse error', () => {
    const result = validate.jsonDocument('{ not json');

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: 'json_parse_error' });
  });
});

describe('deep prop validation in nested slide content', () => {
  it('flags an unknown component name at a well-formed /name path', () => {
    const result = validate.document(
      deck([slide([{ name: 'textt', props: { text: 'typo component' } }])])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/name',
        message: 'Unknown component "textt"',
        code: 'unknown_component',
      })
    );
  });

  it('flags a dead prop (fontColor) on a text component', () => {
    const result = validate.document(
      deck([
        slide([
          {
            name: 'text',
            props: { text: 'Hello', fontColor: 'CC785C', x: 1, y: 1 },
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining('/children/0/children/0/props'),
        message: expect.stringMatching(/fontColor/),
      })
    );
  });

  it('flags a bad prop value deep in slide content', () => {
    const result = validate.document(
      deck([slide([{ name: 'text', props: { text: 'Hi', fontSize: 'huge' } }])])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining('/children/0/children/0/props/fontSize'),
      })
    );
  });

  it('flags a text component missing its required text prop', () => {
    const result = validate.document(
      deck([slide([{ name: 'text', props: { x: 1, y: 1 } }])])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining('/children/0/children/0/props'),
        message: expect.stringMatching(/text/i),
      })
    );
  });

  it('flags a content component placed directly under pptx', () => {
    const result = validate.document(
      deck([{ name: 'text', props: { text: 'No slide' } }])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/name',
        message: expect.stringMatching(/not allowed inside "pptx"/),
      })
    );
  });

  it('flags children on a leaf component', () => {
    const result = validate.document(
      deck([
        slide([
          {
            name: 'text',
            props: { text: 'Hi' },
            children: [{ name: 'text', props: { text: 'Nested' } }],
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/children',
        message: expect.stringMatching(/does not accept children/),
      })
    );
  });

  it('flags a non-component entry in a children array', () => {
    const result = validate.document(deck([slide(['just a string' as any])]));

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0',
        message: 'Component must be an object',
      })
    );
  });

  it('flags an entry missing its name', () => {
    const result = validate.document(
      deck([slide([{ props: { text: 'anonymous' } }])])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/name',
        code: 'required_property',
      })
    );
  });

  it('flags an unknown top-level field on a component object', () => {
    const result = validate.document(
      deck([slide([{ name: 'text', props: { text: 'Hi' }, porps: {} }])])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/porps',
        code: 'unknown_field',
      })
    );
  });

  it('flags non-array children on a nested container', () => {
    const result = validate.document(
      deck([{ name: 'slide', props: {}, children: 'oops' }])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children',
        message: 'Field "children" must be an array',
      })
    );
  });
});

describe('slide placeholders', () => {
  it('accepts a slide with valid placeholder components', () => {
    const result = validate.document(
      deck(
        [
          slide([], {
            template: 'content',
            placeholders: {
              title: { name: 'text', props: { text: 'Hello' } },
            },
          }),
        ],
        {
          templates: [
            {
              name: 'content',
              placeholders: [{ name: 'title', x: 1, y: 1, w: 8, h: 1 }],
            },
          ],
        }
      )
    );

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('flags a bad prop inside a placeholder component', () => {
    const result = validate.document(
      deck([
        slide([], {
          placeholders: {
            title: {
              name: 'text',
              props: { text: 'Hello', fontColor: 'CC785C' },
            },
          },
        }),
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining(
          '/children/0/props/placeholders/title/props'
        ),
        message: expect.stringMatching(/fontColor/),
      })
    );
  });

  it('flags an unknown component in a placeholder at a /name path', () => {
    const result = validate.document(
      deck([
        slide([], {
          placeholders: {
            title: { name: 'textt', props: { text: 'typo' } },
          },
        }),
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/props/placeholders/title/name',
        code: 'unknown_component',
      })
    );
  });
});

describe('image source conflicts', () => {
  it('rejects an image with multiple sources anywhere in the tree', () => {
    const result = validate.document(
      deck([
        slide([
          {
            name: 'image',
            props: { path: 'a.png', base64: 'aGk=', x: 1, y: 1, w: 2, h: 2 },
          },
        ]),
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/only one source/),
      })
    );
  });
});

describe('clean documents and options', () => {
  it('accepts a clean multi-slide deck with all content component types', () => {
    const result = validate.document(
      deck([
        slide([
          { name: 'text', props: { text: 'Title', fontSize: 36, bold: true } },
          { name: 'shape', props: { type: 'rect', x: 1, y: 1, w: 2, h: 2 } },
        ]),
        slide([
          {
            name: 'image',
            props: { path: 'logo.png', x: 1, y: 1, w: 2, h: 2 },
          },
          {
            name: 'chart',
            props: {
              type: 'bar',
              data: [{ name: 'S1', labels: ['A'], values: [1] }],
              x: 1,
              y: 1,
              w: 6,
              h: 4,
            },
          },
        ]),
      ])
    );

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('validateStrict mirrors validate for documents', () => {
    const bad = deck([slide([{ name: 'textt', props: {} }])]);

    expect(validateStrict.document(bad).valid).toBe(false);
    expect(validate.document(bad).valid).toBe(false);
  });
});

describe('theme validation', () => {
  it('accepts a minimal valid theme', () => {
    const result = validate.theme({
      name: 'brand',
      colors: {
        primary: '#1A1A1A',
        secondary: '#444444',
        accent: '#CC785C',
        background: '#FFFFFF',
        text: '#1A1A1A',
      },
      fonts: { heading: 'Arial', body: 'Arial' },
      defaults: { fontSize: 18, fontColor: '#1A1A1A' },
    });

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a theme with a wrong-typed field', () => {
    const result = validate.theme({ name: 'brand', colors: 'red' });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
