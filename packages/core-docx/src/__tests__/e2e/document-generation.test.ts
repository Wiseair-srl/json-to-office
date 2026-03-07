import { describe, it, expect } from 'vitest';
import {
  generateDocument,
  generateDocumentFromJson,
} from '../../core/generator';
import { Packer } from 'docx';
import type { ComponentDefinition, ReportComponentDefinition } from '../../types';

describe('E2E: Document Generation', () => {
  describe('Complete Document Generation', () => {
    it('should generate a complete business report', async () => {
      const reportComponent: ComponentDefinition = {
        name: 'report',
        props: {
          theme: 'minimal',
          metadata: {
            title: 'Q4 2024 Business Report',
            author: 'Test Suite',
            description: 'Quarterly business performance report',
          },
        },
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'Executive Summary',
              alignment: 'center',
            },
          },
          {
            name: 'paragraph',
            props: {
              text: 'This report provides a comprehensive overview of our Q4 2024 performance.',
            },
          },
          {
            name: 'heading',
            props: {
              level: 2,
              text: 'Key Metrics',
            },
          },
          {
            name: 'table',
            props: {
              headers: ['Metric', 'Q3 2024', 'Q4 2024', 'Change'],
              rows: [
                ['Revenue', '$1.2M', '$1.5M', '+25%'],
                ['Users', '10,000', '15,000', '+50%'],
                ['Retention', '85%', '90%', '+5%'],
              ],
            },
          },
          {
            name: 'heading',
            props: {
              level: 2,
              text: 'Analysis',
            },
          },
          {
            name: 'paragraph',
            props: {
              text: 'The fourth quarter showed significant growth across all key metrics.',
            },
          },
        ],
      };

      const document = await generateDocument(reportComponent);
      expect(document).toBeDefined();

      const buffer = await Packer.toBuffer(document);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should generate document with multiple sections', async () => {
      const multiSectionComponent: ComponentDefinition = {
        name: 'report',
        props: {
          theme: 'minimal',
        },
        children: [
          {
            name: 'section',
            props: {},
            children: [
              {
                name: 'heading',
                props: {
                  level: 1,
                  text: 'Introduction',
                },
              },
              {
                name: 'paragraph',
                props: {
                  text: 'First section content.',
                },
              },
            ],
          },
          {
            name: 'section',
            props: {
              pageBreak: true,
            },
            children: [
              {
                name: 'heading',
                props: {
                  level: 1,
                  text: 'Main Content',
                },
              },
              {
                name: 'paragraph',
                props: {
                  text: 'Second section content.',
                },
              },
            ],
          },
          {
            name: 'section',
            props: {
              pageBreak: true,
            },
            children: [
              {
                name: 'heading',
                props: {
                  level: 1,
                  text: 'Conclusion',
                },
              },
              {
                name: 'paragraph',
                props: {
                  text: 'Final section content.',
                },
              },
            ],
          },
        ],
      };

      const document = await generateDocument(multiSectionComponent);
      expect(document).toBeDefined();
    });

    it('should generate document with lists', async () => {
      const listComponent: ComponentDefinition = {
        name: 'report',
        props: {},
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'Lists Example',
            },
          },
          {
            name: 'list',
            props: {
              style: 'bullet',
              items: ['First item', 'Second item', 'Third item'],
            },
          },
          {
            name: 'paragraph',
            props: {
              text: 'Now a numbered list:',
            },
          },
          {
            name: 'list',
            props: {
              style: 'number',
              items: ['Step one', 'Step two', 'Step three'],
            },
          },
        ],
      };

      const document = await generateDocument(listComponent);
      expect(document).toBeDefined();
    });

    it('should generate document with columns', async () => {
      const columnsComponent: ComponentDefinition = {
        name: 'report',
        props: {},
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'Two Column Layout',
            },
          },
          {
            name: 'columns',
            props: {
              columns: [
                {
                  width: 50,
                },
                {
                  width: 50,
                },
              ],
            },
            children: [
              {
                name: 'paragraph',
                props: {
                  text: 'Left column content. This text appears in the left column.',
                },
              },
              {
                name: 'paragraph',
                props: {
                  text: 'Right column content. This text appears in the right column.',
                },
              },
            ],
          },
        ],
      };

      const document = await generateDocument(columnsComponent);
      expect(document).toBeDefined();
    });

    it('should generate document with JSON definition', async () => {
      const jsonDefinition: ReportComponentDefinition = {
        name: 'report',
        props: {
          title: 'JSON Document',
          theme: 'minimal',
        },
        children: [
          {
            name: 'heading',
            props: {
              level: 1,
              text: 'JSON Document',
            },
          },
          {
            name: 'paragraph',
            props: {
              text: 'This document was generated from a JSON definition.',
            },
          },
          {
            name: 'table',
            props: {
              headers: ['Column A', 'Column B'],
              rows: [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      };

      const document = await generateDocumentFromJson(jsonDefinition);
      expect(document).toBeDefined();
    });

    it('should generate document with different themes', async () => {
      const themes = ['minimal', 'verizon', 'a2a'];

      for (const theme of themes) {
        const themedComponent: ComponentDefinition = {
          name: 'report',
          props: {
            theme,
          },
          children: [
            {
              name: 'heading',
              props: {
                level: 1,
                text: `Document with ${theme} theme`,
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'This document uses themed styling.',
              },
            },
          ],
        };

        const document = await generateDocument(themedComponent);
        expect(document).toBeDefined();
      }
    });

    it('should generate large document efficiently', async () => {
      const components: ComponentDefinition[] = [];

      for (let i = 1; i <= 10; i++) {
        components.push({
          name: 'heading',
          props: {
            level: 1,
            text: `Chapter ${i}`,
          },
        });
        components.push({
          name: 'paragraph',
          props: {
            text: `Content for chapter ${i}. `.repeat(50),
          },
        });
        components.push({
          name: 'table',
          props: {
            headers: ['Item', 'Value'],
            rows: Array(10)
              .fill(null)
              .map((_, j) => [`Row ${j + 1}`, `Data ${j + 1}`]),
          },
        });
      }

      const largeComponent: ComponentDefinition = {
        name: 'report',
        props: {},
        children: components,
      };

      const start = Date.now();
      const document = await generateDocument(largeComponent);
      const duration = Date.now() - start;

      expect(document).toBeDefined();
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});
