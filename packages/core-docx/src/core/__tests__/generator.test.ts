/**
 * The generator entry points, on documents that exercise each shape.
 *
 * These assert that a document builds, not what it builds: the corpus goldens
 * pin the bytes. What matters here is that every entry point reaches the
 * pipeline and that a document which is not a `docx` root is rejected with a
 * message that says so.
 */

import { describe, it, expect } from 'vitest';
import { generateBufferFromJson, generateBufferFromConfig } from '../generator';
import type {
  ComponentDefinition,
  ReportProps,
  ReportComponentDefinition,
} from '../../types';

describe('core/generator', () => {
  describe('generateBufferFromJson', () => {
    it('generates from a minimal document', async () => {
      const minimalComponent: ComponentDefinition = {
        name: 'docx',
        props: {
          theme: 'minimal',
        },
        children: [
          {
            name: 'paragraph',
            props: {
              text: 'Test document',
            },
          },
        ],
      };

      const buffer = await generateBufferFromJson(minimalComponent);

      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('generates from a document naming a theme', async () => {
      const componentWithTheme: ComponentDefinition = {
        name: 'docx',
        props: {
          theme: 'verizon',
        },
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'Title',
            },
          },
        ],
      };

      const buffer = await generateBufferFromJson(componentWithTheme);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('generates from a document with a table in the flat shape', async () => {
      const componentWithTable: ComponentDefinition = {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'Document with Table',
            },
          },
          {
            name: 'table',
            props: {
              headers: ['Header 1', 'Header 2'],
              rows: [['Data 1', 'Data 2']],
            },
          },
        ],
      };

      // The flat `headers`/`rows` shape predates the schema, which only knows
      // the column form, so it is generated without validation.
      const buffer = await generateBufferFromJson(componentWithTable, {
        validation: { enabled: false },
      });
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('rejects a root that is not a docx component', async () => {
      const invalidComponent = {
        name: 'not-a-report',
        props: {},
        children: [],
      } as never;

      // Validation off on purpose: the guard under test is the one inside
      // theme resolution, which is what a caller that skips the schema hits.
      await expect(
        generateBufferFromJson(invalidComponent, {
          validation: { enabled: false },
        })
      ).rejects.toThrow('Top-level document must be a docx component');
    });

    it('generates from a definition carrying a $schema', async () => {
      const jsonDefinition: ReportComponentDefinition = {
        name: 'docx',
        $schema: 'https://example.com/schema',
        props: {
          theme: 'minimal',
        },
        children: [
          {
            name: 'paragraph',
            props: {
              text: 'JSON document',
            },
          },
        ],
      };

      const buffer = await generateBufferFromJson(jsonDefinition);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('generates from a definition carrying metadata', async () => {
      const jsonWithMetadata: ReportComponentDefinition = {
        name: 'docx',
        props: {
          theme: 'minimal',
          metadata: {
            title: 'JSON Document',
            author: 'JSON Author',
            description: 'A test JSON document',
          },
        },
        children: [
          {
            name: 'paragraph',
            props: {
              text: 'Content',
            },
          },
        ],
      };

      const buffer = await generateBufferFromJson(jsonWithMetadata);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('generates the same document from a JSON string as from an object', async () => {
      const definition: ReportComponentDefinition = {
        name: 'docx',
        props: { theme: 'minimal' },
        children: [{ name: 'paragraph', props: { text: 'Same either way.' } }],
      };

      const fromObject = await generateBufferFromJson(definition);
      const fromString = await generateBufferFromJson(
        JSON.stringify(definition)
      );

      expect(fromString.equals(fromObject)).toBe(true);
    });
  });

  describe('generateBufferFromConfig', () => {
    it('builds the same document as passing the root directly', async () => {
      const config: ReportProps = {
        theme: 'minimal',
        metadata: {
          title: 'Test Document',
          author: 'Test Author',
        },
      };

      const components: ComponentDefinition[] = [
        {
          name: 'paragraph',
          props: {
            text: 'Test content',
          },
        },
      ];

      const fromConfig = await generateBufferFromConfig(config, components);
      const fromRoot = await generateBufferFromJson({
        name: 'docx',
        props: config,
        children: components,
      } as ReportComponentDefinition);

      expect(fromConfig.equals(fromRoot)).toBe(true);
    });
  });
});
