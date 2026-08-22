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
});
