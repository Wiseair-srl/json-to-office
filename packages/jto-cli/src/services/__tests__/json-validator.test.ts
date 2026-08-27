import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertToJsonSchema } from '@json-to-office/shared';
import {
  generateUnifiedDocumentSchema,
  ThemeConfigSchema,
} from '@json-to-office/shared-docx';
import { PptxFormatAdapter } from '@json-to-office/jto-ops';
import { JsonValidator } from '../json-validator.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('JsonValidator custom schemas', () => {
  it('compiles the renderer-discriminated DOCX schema without overflowing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const schemaPath = join(directory, 'document.schema.json');
    const documentPath = join(directory, 'document.json');

    await writeFile(
      schemaPath,
      JSON.stringify(
        convertToJsonSchema(generateUnifiedDocumentSchema(), {
          $id: 'document.schema.json',
        })
      )
    );
    await writeFile(
      documentPath,
      JSON.stringify({ name: 'docx', props: {}, children: [] })
    );

    const [result] = await new JsonValidator('docx').validate(documentPath, {
      schema: schemaPath,
    });

    expect(result).toMatchObject({ valid: true, type: 'custom' });
  });

  it('compiles the deepest branch a document can actually reach', async () => {
    // Ajv compiles lazily, so an empty document proves nothing about the parts
    // of the schema it never visits. A `visual` in a section header is the
    // deepest reachable position — it goes through the renderer's recursive
    // component definition rather than a narrowed child union — and it is
    // where the schema first overflowed V8's stack when `visual.props` grew a
    // second branch. The visual props schemas are hoisted into their own
    // definitions to keep that depth down; this is what notices if they stop
    // being.
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const schemaPath = join(directory, 'document.schema.json');
    const documentPath = join(directory, 'document.json');

    await writeFile(
      schemaPath,
      JSON.stringify(
        convertToJsonSchema(generateUnifiedDocumentSchema(), {
          $id: 'document.schema.json',
        })
      )
    );
    await writeFile(
      documentPath,
      JSON.stringify({
        name: 'docx',
        props: {},
        children: [
          {
            name: 'section',
            props: {
              header: [
                {
                  name: 'visual',
                  props: {
                    canvas: { width: 3, height: 1 },
                    elements: [{ name: 'text', props: { text: 'hi' } }],
                  },
                },
              ],
            },
            children: [{ name: 'paragraph', props: { text: 'body' } }],
          },
        ],
      })
    );

    const [result] = await new JsonValidator('docx').validate(documentPath, {
      schema: schemaPath,
    });

    expect(result).toMatchObject({ valid: true, type: 'custom' });
  }, 60_000);

  it('applies the document\u2019s own renderer rules inside a section header', async () => {
    // A section header reaches components through the recursive component
    // definition, not through the narrowed child union a section body uses.
    // While both renderer branches shared one definition, whichever branch the
    // exporter walked last (office-open) answered for both: a native `visual`
    // was accepted under docxjs, and a docxjs threaded comment was refused.
    // The runtime validator was right about both throughout, so nothing bad
    // shipped — a schema-driven editor just showed the other renderer's
    // diagnostics.
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const schemaPath = join(directory, 'document.schema.json');

    await writeFile(
      schemaPath,
      JSON.stringify(
        convertToJsonSchema(generateUnifiedDocumentSchema(), {
          $id: 'document.schema.json',
        })
      )
    );

    const nativeVisual = {
      name: 'visual',
      props: {
        renderMode: 'native',
        canvas: { width: 4, height: 2 },
        elements: [
          { name: 'text', props: { text: 'hi', x: 0.2, y: 0.2, w: 2, h: 0.4 } },
        ],
      },
    };
    const threadedComment = {
      name: 'paragraph',
      props: {
        text: 'hello',
        comment: {
          text: 'note',
          author: 'reviewer',
          replies: [{ text: 'agreed', author: 'author' }],
          resolved: false,
        },
      },
    };

    const validator = new JsonValidator('docx');
    const validateHeader = async (
      label: string,
      renderer: string | undefined,
      child: unknown
    ) => {
      const documentPath = join(directory, `${label}.json`);
      await writeFile(
        documentPath,
        JSON.stringify({
          name: 'docx',
          ...(renderer ? { renderer } : {}),
          props: {},
          children: [
            { name: 'section', props: { header: [child] }, children: [] },
          ],
        })
      );
      const result = await validator.validateFile(documentPath, {
        schema: schemaPath,
      });
      return result.valid;
    };

    // Omitted renderer means docxjs, which cannot draw a native visual...
    expect(await validateHeader('docxjs-native', undefined, nativeVisual)).toBe(
      false
    );
    // ...but can thread a comment.
    expect(
      await validateHeader('docxjs-thread', undefined, threadedComment)
    ).toBe(true);
    // office-open is the mirror image on both counts.
    expect(await validateHeader('oo-native', 'office-open', nativeVisual)).toBe(
      true
    );
    expect(
      await validateHeader('oo-thread', 'office-open', threadedComment)
    ).toBe(false);
  }, 180_000);

  it('compiles the exported theme schema, which holds componentDefaults', async () => {
    // `componentDefaults` is shared between the document and theme schemas,
    // and its `section.header`/`footer` hold components. Only the document
    // schema carries a component definition to point them at; the theme
    // schema used to get the same `$ref` anyway, to a definition it never
    // had, and Ajv refuses to compile a schema with an unresolvable
    // reference — so every theme validated against the shipped
    // `theme.schema.json` failed on the schema itself, whatever the theme
    // said. With nothing to point at, the item stays untyped instead.
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const schemaPath = join(directory, 'theme.schema.json');
    const themePath = join(directory, 'theme.json');

    await writeFile(
      schemaPath,
      JSON.stringify(
        convertToJsonSchema(ThemeConfigSchema, { $id: 'theme.schema.json' })
      )
    );
    await writeFile(
      themePath,
      JSON.stringify({
        componentDefaults: {
          section: {
            header: [{ name: 'paragraph', props: { text: 'Confidential' } }],
          },
        },
      })
    );

    const [result] = await new JsonValidator('docx').validate(themePath, {
      schema: schemaPath,
    });

    // The theme above is deliberately partial, so it fails on the fields a
    // theme requires — but on *those*, from a schema that compiled. An
    // unresolvable `$ref` throws before any of them is reached and reports
    // one `schema_error` instead.
    const errors = result.errors ?? [];
    expect(errors.map((error) => error.code)).not.toContain('schema_error');
    expect(errors.map((error) => error.path)).not.toContain(
      '/componentDefaults/section/header'
    );
    expect(errors.map((error) => error.message)).toContain(
      "must have required property 'colors'"
    );
  });
});

describe('JsonValidator quality findings', () => {
  it('keeps a schema-valid file valid and returns design warnings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const documentPath = join(directory, 'deck.json');
    await writeFile(
      documentPath,
      JSON.stringify({
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [
          {
            name: 'slide',
            props: {},
            children: [
              { name: 'text', props: { text: 'Unreadable', fontSize: 6 } },
            ],
          },
        ],
      })
    );

    const adapter = new PptxFormatAdapter();
    const [result] = await new JsonValidator('pptx', adapter).validate(
      documentPath
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'W_QUALITY_FONT_SIZE_MIN',
          path: '/children/0/children/0/props',
        }),
      ])
    );

    const [gated] = await new JsonValidator('pptx', adapter).validate(
      documentPath,
      { quality: { policy: { gate: 'warning' } } }
    );
    expect(gated.valid).toBe(false);
    expect(gated.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'W_QUALITY_FONT_SIZE_MIN',
          source: 'quality',
          certainty: 'measured',
        }),
      ])
    );
  });

  it('returns schema errors before quality analysis', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const documentPath = join(directory, 'deck.json');
    await writeFile(
      documentPath,
      JSON.stringify({
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [null, { name: 'slide', props: {}, children: [] }],
      })
    );

    const adapter = new PptxFormatAdapter();
    let qualityCalls = 0;
    adapter.analyzeQuality = async () => {
      qualityCalls += 1;
      throw new TypeError("Cannot read properties of null (reading 'name')");
    };

    const [result] = await new JsonValidator('pptx', adapter).validate(
      documentPath
    );

    expect(result.valid).toBe(false);
    const codes = result.errors?.map((error) => error.code) ?? [];
    expect(codes).not.toContain('validator_error');
    expect(codes.length).toBeGreaterThan(0);
    expect(qualityCalls).toBe(0);
  });

  it('preserves info severity in structured quality warnings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const documentPath = join(directory, 'deck.json');
    await writeFile(
      documentPath,
      JSON.stringify({
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [{ name: 'slide', props: {}, children: [] }],
      })
    );

    const adapter = new PptxFormatAdapter();
    adapter.analyzeQuality = async () => ({
      diagnostics: [
        {
          source: 'quality',
          ruleId: 'pptx/informational',
          code: 'W_QUALITY_INFORMATIONAL',
          category: 'composition',
          certainty: 'deterministic',
          severity: 'info',
          message: 'Informational finding.',
          path: '/props',
          blocking: false,
        },
      ],
      counts: { error: 0, warning: 0, info: 1 },
      blocked: false,
      truncated: false,
      suppressedCount: 0,
      evaluatedRuleIds: ['pptx/informational'],
      ruleErrors: [],
    });

    const validator = new JsonValidator('pptx', adapter);
    const [result] = await validator.validate(documentPath);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'W_QUALITY_INFORMATIONAL',
        severity: 'info',
      })
    );
    expect(JSON.parse(validator.formatResultsAsJson([result]))).toEqual([
      expect.objectContaining({
        warnings: expect.arrayContaining([
          expect.objectContaining({ severity: 'info' }),
        ]),
      }),
    ]);
  });

  it('reports a rule that threw instead of calling the file clean', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jto-json-validator-'));
    directories.push(directory);
    const documentPath = join(directory, 'deck.json');
    await writeFile(
      documentPath,
      JSON.stringify({
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [{ name: 'slide', props: {}, children: [] }],
      })
    );

    const adapter = new PptxFormatAdapter();
    adapter.analyzeQuality = async () => ({
      diagnostics: [],
      counts: { error: 0, warning: 0, info: 0 },
      blocked: false,
      truncated: false,
      suppressedCount: 0,
      evaluatedRuleIds: [],
      ruleErrors: [{ ruleId: 'W_QUALITY_FONT_SIZE_MIN', message: 'boom' }],
    });

    const [result] = await new JsonValidator('pptx', adapter).validate(
      documentPath
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality_rule_error',
          ruleId: 'W_QUALITY_FONT_SIZE_MIN',
        }),
      ])
    );
  });
});
