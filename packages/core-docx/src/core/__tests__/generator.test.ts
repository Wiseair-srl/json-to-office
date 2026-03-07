import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateDocument,
  generateFromConfig,
  generateDocumentFromJson,
} from '../generator';
import * as docx from 'docx';
import type {
  ComponentDefinition,
  ReportProps,
  ReportComponentDefinition,
} from '../../types';

vi.mock('docx');

describe('core/generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateDocument', () => {
    it('should generate a document with minimal config', async () => {
      const minimalComponent: ComponentDefinition = {
        name: 'report',
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

      const result = await generateDocument(minimalComponent);

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(docx.Document);
    });

    it('should handle document with theme', async () => {
      const componentWithTheme: ComponentDefinition = {
        name: 'report',
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

      const result = await generateDocument(componentWithTheme);
      expect(result).toBeDefined();
    });

    it('should handle document with custom components', async () => {
      const componentWithTable: ComponentDefinition = {
        name: 'report',
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

      const result = await generateDocument(componentWithTable);
      expect(result).toBeDefined();
    });

    it('should throw error for invalid component', async () => {
      const invalidComponent = {
        name: 'not-a-report',
        props: {},
        children: [],
      } as any;

      await expect(generateDocument(invalidComponent)).rejects.toThrow(
        'Top-level component must be a report component'
      );
    });

    it('should handle JSON report definition', async () => {
      const jsonDefinition: ReportComponentDefinition = {
        name: 'report',
        $schema: 'https://example.com/schema',
        props: {
          title: 'JSON Document',
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

      const result = await generateDocument(jsonDefinition);
      expect(result).toBeDefined();
    });
  });

  describe('generateFromConfig', () => {
    it('should generate document from config and components', async () => {
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

      const result = await generateFromConfig(config, components);
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(docx.Document);
    });
  });

  describe('generateDocumentFromJson', () => {
    it('should generate document from JSON definition', async () => {
      const jsonDef: ReportComponentDefinition = {
        name: 'report',
        props: {
          title: 'Test Document',
          theme: 'minimal',
        },
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'JSON Title',
            },
          },
          {
            name: 'paragraph',
            props: {
              text: 'JSON content',
            },
          },
        ],
      };

      const result = await generateDocumentFromJson(jsonDef);
      expect(result).toBeDefined();
    });

    it('should handle JSON with metadata', async () => {
      const jsonWithMetadata: ReportComponentDefinition = {
        name: 'report',
        props: {
          title: 'Document with Metadata',
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

      const result = await generateDocumentFromJson(jsonWithMetadata);
      expect(result).toBeDefined();
    });
  });
});
