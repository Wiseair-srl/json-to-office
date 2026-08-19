/**
 * Component-name autocomplete must offer EVERY component legal at the cursor,
 * not just the ones that happen to validate without `props`.
 *
 * Monaco / VS Code (vscode-json-languageservice) resolve value completions in
 * an `anyOf` by keeping only branches that validate cleanly against the
 * partially-typed node. While typing `{ "name": | }`, every branch requiring
 * `props` fails, so its name const vanished from autocomplete — the playground
 * suggested only `image`, `text-box`, `toc` inside a section.
 *
 * The exported schema restructures each name-discriminated union into the
 * canonical if/then dispatch (see @json-to-office/shared discriminated-unions):
 * `properties.name` lists every component, `allOf[].then` activates exactly
 * the named branch. Completion offers everything; diagnostics report the one
 * real problem instead of an arbitrary best-match branch's complaints.
 *
 * These tests drive the real language service (the same library Monaco embeds)
 * against the real exported schema, so a regression in either the generator
 * shape or the union restructuring turns them red.
 */
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { getLanguageService, TextDocument } from 'vscode-json-languageservice';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { convertToJsonSchema } from '../schemas/export';
import { getStandardComponent } from '../schemas/component-registry';

function completionsAt(schema: Record<string, unknown>, text: string) {
  const ls = getLanguageService({});
  ls.configure({
    allowComments: false,
    schemas: [{ uri: 'test://doc', fileMatch: ['*.json'], schema }],
  });
  const doc = TextDocument.create('test://d.json', 'json', 1, text);
  const jsonDoc = ls.parseJSONDocument(doc);
  // cursor inside the last `"name": ""` value — the discriminator being typed
  const offset = text.lastIndexOf('{"name":"') + '{"name":"'.length;
  return ls
    .doComplete(doc, doc.positionAt(offset), jsonDoc)
    .then((list) => (list?.items ?? []).map((i) => i.label.replace(/"/g, '')));
}

const standardSchema = convertToJsonSchema(
  generateUnifiedDocumentSchema({ customComponents: [] })
) as Record<string, unknown>;

describe('component name autocomplete', () => {
  it('offers every allowed component inside section children', async () => {
    const labels = await completionsAt(
      standardSchema,
      '{"name":"docx","children":[{"name":"section","children":[{"name":""}]}]}'
    );
    const allowed = getStandardComponent('section')!.allowedChildren!;
    for (const name of allowed) expect(labels).toContain(name);
    // narrowing still applies: bare sections don't nest
    expect(labels).not.toContain('section');
    expect(labels).not.toContain('docx');
  });

  it('offers section plus content components at the document root', async () => {
    const labels = await completionsAt(
      standardSchema,
      '{"name":"docx","children":[{"name":""}]}'
    );
    expect(labels).toContain('section');
    expect(labels).toContain('heading');
    expect(labels).toContain('paragraph');
    expect(labels).not.toContain('docx');
  });

  it('offers plugin components, including versioned ones requiring props', async () => {
    const weatherProps = Type.Object(
      { city: Type.String() },
      { additionalProperties: false }
    );
    const pluginSchema = convertToJsonSchema(
      generateUnifiedDocumentSchema({
        customComponents: [
          {
            name: 'weather',
            propsSchema: weatherProps,
            description: 'Weather component',
            versionedProps: [
              { version: '1.0.0', propsSchema: weatherProps },
              { version: '2.0.0', propsSchema: weatherProps },
            ],
          },
        ],
      })
    ) as Record<string, unknown>;
    const labels = await completionsAt(
      pluginSchema,
      '{"name":"docx","children":[{"name":"section","children":[{"name":""}]}]}'
    );
    expect(labels).toContain('weather');
    expect(labels).toContain('heading');
  });

  it('keeps validation strict: props still required where demanded', async () => {
    const diagnostics = await diagnosticsFor(
      '{"name":"docx","children":[{"name":"section","children":[{"name":"heading"}]}]}'
    );
    expect(diagnostics).toEqual(['Missing property "props".']);
  });

  it('reports only the discriminator error while name is empty or wrong', async () => {
    for (const name of ['', 'bogus']) {
      const diagnostics = await diagnosticsFor(
        `{"name":"docx","children":[{"name":"section","children":[{"name":"${name}"}]}]}`
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatch(/Value is not accepted. Valid values:/);
      expect(diagnostics[0]).toContain('"heading"');
      expect(diagnostics[0]).toContain('"paragraph"');
    }
  });

  it('reports only the missing discriminator on an empty component', async () => {
    const diagnostics = await diagnosticsFor(
      '{"name":"docx","children":[{"name":"section","children":[{}]}]}'
    );
    expect(diagnostics).toEqual(['Missing property "name".']);
  });

  it('accepts valid documents, propless components included', async () => {
    const diagnostics = await diagnosticsFor(
      '{"name":"docx","children":[{"name":"section","children":[{"name":"toc"},{"name":"heading","props":{"text":"Hi"}}]}]}'
    );
    expect(diagnostics).toEqual([]);
  });
});

async function diagnosticsFor(text: string): Promise<string[]> {
  const ls = getLanguageService({});
  const doc = TextDocument.create('test://d.json', 'json', 1, text);
  const diagnostics = await ls.doValidation(
    doc,
    ls.parseJSONDocument(doc),
    {},
    standardSchema as never
  );
  return diagnostics.map((d) => d.message);
}
