import { afterEach, describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TypeBoxExporter } from '../typebox-exporter.js';

const temporaryDirectories: string[] = [];

async function temporaryFile(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jto-typebox-'));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('TypeBoxExporter', () => {
  it('exports the supplied component props instead of Type.Any', async () => {
    const outputPath = await temporaryFile('metric-card.schema.ts');
    const exporter = new TypeBoxExporter('docx');

    await exporter.exportComponentSchema(
      'metric-card',
      Type.Object(
        {
          label: Type.String({ minLength: 1 }),
          value: Type.Number({ minimum: 0 }),
          unit: Type.Optional(Type.String()),
        },
        { additionalProperties: false }
      ),
      outputPath
    );

    const source = await readFile(outputPath, 'utf8');
    expect(source).not.toContain('Type.Any');
    expect(source).toContain('MetricCardPropsSchema = Type.Object');
    expect(source).toContain('"label": Type.String({');
    expect(source).toContain('"minLength": 1');
    expect(source).toContain('"unit": Type.Optional(Type.String())');
    expect(source).toContain('props: MetricCardPropsSchema');
    expect(source).toContain('{ additionalProperties: false }');
  });

  it('exports executable registry-backed document schemas with plugin versions', async () => {
    const outputPath = await temporaryFile('document.schema.ts');
    const exporter = new TypeBoxExporter('docx');
    const rootSchema = Type.Object(
      {},
      {
        title: 'Custom document',
        description: 'Document plus plugins',
      }
    );

    await exporter.exportDocumentSchema(rootSchema, outputPath, [
      {
        name: 'metric-card',
        propsSchema: Type.Object({ value: Type.Number() }),
        versionedProps: [
          {
            version: '1.0.0',
            propsSchema: Type.Object({ value: Type.Number() }),
          },
          {
            version: '2.0.0',
            propsSchema: Type.Object({ value: Type.String() }),
          },
        ],
      },
    ]);

    const firstSource = await readFile(outputPath, 'utf8');
    await exporter.exportDocumentSchema(rootSchema, outputPath, [
      {
        name: 'metric-card',
        propsSchema: Type.Object({ value: Type.Number() }),
        versionedProps: [
          {
            version: '1.0.0',
            propsSchema: Type.Object({ value: Type.Number() }),
          },
          {
            version: '2.0.0',
            propsSchema: Type.Object({ value: Type.String() }),
          },
        ],
      },
    ]);
    const secondSource = await readFile(outputPath, 'utf8');

    expect(secondSource).toBe(firstSource);
    expect(secondSource).not.toContain('Type.Any');
    expect(secondSource).not.toMatch(/Generated on:/);
    expect(secondSource).toContain(
      "generateUnifiedDocumentSchema } from '@json-to-office/shared-docx'"
    );
    expect(secondSource).toContain('name: "metric-card"');
    expect(secondSource).toContain('version: "2.0.0"');
    expect(secondSource).toContain('CustomComponent1Version2PropsSchema');
    expect(secondSource).toContain('title: "Custom document"');
  });

  it('emits the PPTX plugin generator shape', async () => {
    const outputPath = await temporaryFile('presentation.schema.ts');
    const exporter = new TypeBoxExporter('pptx');

    await exporter.exportDocumentSchema(Type.Object({}), outputPath, [
      {
        name: 'callout',
        propsSchema: Type.Object({ text: Type.String() }),
        hasChildren: true,
      },
    ]);

    const source = await readFile(outputPath, 'utf8');
    expect(source).not.toContain('Type.Any');
    expect(source).toContain(
      "generateUnifiedDocumentSchema } from '@json-to-office/shared-pptx'"
    );
    expect(source).toContain('versions: [');
    expect(source).toContain('version: "1.0.0"');
    expect(source).toContain('hasChildren: true');
    expect(source).not.toContain('includeStandardComponents');
  });
});
