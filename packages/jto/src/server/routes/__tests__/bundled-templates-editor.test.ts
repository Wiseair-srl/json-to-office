/**
 * Every bundled template opens clean in the editor.
 *
 * The playground validates a document with the JSON language service Monaco
 * embeds, against the schema `/discovery/schemas/document` serves with the
 * document's own block definitions applied. Nothing else checks that pairing:
 * `jto validate` and generation accept looser nesting than the published
 * schema narrows to, so a template can build, render and ship — and still
 * open with a red marker. The cover block's metadata band, a table inside a
 * floating text-box, did exactly that. This drives the editor's own validator
 * over each shipped template, the first thing a visitor opens.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { getLanguageService, TextDocument } from 'vscode-json-languageservice';
import { applyDocumentBlocksToSchema } from '@json-to-office/shared';
import { docxDocumentBlockTargets } from '@json-to-office/shared-docx';
import { preparePptxDocumentBlockTargets } from '@json-to-office/shared-pptx';
import {
  DocxFormatAdapter,
  PluginRegistry,
  PptxFormatAdapter,
} from '@json-to-office/jto-cli';
import { discoveryRouter } from '../discovery';
import { Container } from '../../container';
import { readDocumentBlockDefinitions } from '../../../client/lib/document-blocks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../client/public/templates'
);

const FORMATS = [
  { format: 'docx', adapter: () => new DocxFormatAdapter() },
  { format: 'pptx', adapter: () => new PptxFormatAdapter() },
] as const;

describe.each(FORMATS)(
  '$format templates in the editor',
  ({ format, adapter }) => {
    const templates = fs
      .readdirSync(TEMPLATE_DIR)
      .filter((file) => file.endsWith(`.${format}.json`))
      .sort();
    let baseSchema: unknown;

    beforeAll(async () => {
      // The hosted playground autoloads its example plugin; plugins only add
      // branches, so the plugin-free schema is the stricter of the two.
      Container.initialize(adapter());
      PluginRegistry.cleanup();
      const app = new Hono();
      app.route('/discovery', discoveryRouter as any);
      const res = await app.request('/discovery/schemas/document?plugins=');
      expect(res.status).toBe(200);
      baseSchema = ((await res.json()) as { data: unknown }).data;
    });

    afterAll(() => {
      PluginRegistry.cleanup();
    });

    it('ships templates to check', () => {
      expect(templates.length).toBeGreaterThan(0);
    });

    it.each(templates)(
      '%s validates without a marker',
      async (file) => {
        const text = fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8');
        // What monaco-config installs: the served schema, on a copy, with the
        // document's block definitions applied where invocations live.
        const schema = JSON.parse(JSON.stringify(baseSchema));
        applyDocumentBlocksToSchema(
          schema,
          readDocumentBlockDefinitions(text),
          format === 'docx'
            ? docxDocumentBlockTargets(schema)
            : preparePptxDocumentBlockTargets(schema)
        );
        const service = getLanguageService({});
        service.configure({
          allowComments: false,
          schemas: [
            {
              uri: `test://${format}`,
              fileMatch: [`*.${format}.json`],
              schema,
            },
          ],
        });
        const doc = TextDocument.create(`test://${file}`, 'json', 1, text);
        const diagnostics = await service.doValidation(
          doc,
          service.parseJSONDocument(doc),
          { schemaValidation: 'error', trailingCommas: 'error' }
        );
        expect(
          diagnostics.map(
            (d) =>
              `${file}:${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`
          )
        ).toEqual([]);
      },
      60_000
    );
  }
);
