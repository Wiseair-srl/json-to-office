import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Paragraph } from 'docx';
import { createMockTheme, TEST_THEME_NAME } from './helpers';
import type { ComponentDefinition } from '../../types';

// Mock createList function
vi.mock('../../core/content', async () => {
  const { Paragraph } = await vi.importActual<typeof import('docx')>('docx');
  return {
    createList: vi.fn().mockReturnValue([new Paragraph({})]),
  };
});

import { renderListComponent } from '../list';

describe('components/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('renderListComponent', () => {
    it('should render simple bullet list', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Item 1', 'Item 2', 'Item 3'],
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render numbered list', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['First', 'Second', 'Third'],
          type: 'numbered',
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render bullet list with custom bullet character', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Apple', 'Banana', 'Cherry'],
          type: 'bullet',
          bullet: '→',
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle list with alignment', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Left aligned item'],
          alignment: 'left',
        },
      };

      const alignments: Array<'left' | 'center' | 'right' | 'justify'> = [
        'left',
        'center',
        'right',
        'justify',
      ];

      alignments.forEach((alignment) => {
        const alignedComponent = {
          ...component,
          props: { ...component.props, alignment },
        };
        const result = renderListComponent(
          alignedComponent,
          createMockTheme(),
          TEST_THEME_NAME
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Paragraph);
      });
    });

    it('should handle list with custom spacing', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Spaced item 1', 'Spaced item 2'],
          spacing: {
            before: 240,
            after: 240,
          },
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle list with indentation as number', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Indented item'],
          indent: 720, // 0.5 inch
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle list with indentation as object', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Custom indented item'],
          indent: {
            left: 720,
            hanging: 360,
          },
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle list with numbering configuration', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['One', 'Two', 'Three'],
          type: 'numbered',
          numbering: {
            start: 1,
            style: 'decimal',
          },
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle empty list', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: [],
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle list with single item', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Single item'],
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle list with long items', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: [
            'This is a very long list item that contains a lot of text and should wrap properly when rendered in the document',
            'Another long item with multiple sentences. This item also has significant content. It should be handled correctly.',
          ],
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should apply theme styles', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Themed item 1', 'Themed item 2'],
        },
      };

      const theme = createMockTheme({
        componentDefaults: {
          list: {
            spacing: {
              before: 120,
              after: 120,
            },
          },
        },
      });

      const result = renderListComponent(component, theme, TEST_THEME_NAME);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should handle non-list component type', () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: {
          content: 'Not a list',
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('should handle missing config', () => {
      const component: ComponentDefinition = {
        name: 'list',
      } as ComponentDefinition;

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      // Should handle gracefully, likely returning empty or default
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle different theme names', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: ['Item 1', 'Item 2'],
        },
      };

      const themeNames = ['minimal', 'classic', 'professional', 'custom'];

      themeNames.forEach((themeName) => {
        const result = renderListComponent(
          component,
          createMockTheme(),
          themeName
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(Paragraph);
      });
    });

    it('should handle nested list items', () => {
      const component: ComponentDefinition = {
        name: 'list',
        props: {
          items: [
            'Parent item 1',
            { text: 'Nested item 1.1', level: 1 },
            { text: 'Nested item 1.2', level: 1 },
            'Parent item 2',
            { text: 'Nested item 2.1', level: 1 },
          ],
        },
      };

      const result = renderListComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });
  });
});
