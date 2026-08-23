import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertToJsonSchema } from '@json-to-office/shared';
import { generateUnifiedDocumentSchema } from '@json-to-office/shared-docx';
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
    // deepest reachable position — it goes through the shared, recursive
    // `ComponentDefinition` rather than a narrowed child union — and it is
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
});
