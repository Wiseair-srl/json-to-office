import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Paragraph, Table, TableRow } from 'docx';
import { createMockTheme, TEST_THEME_NAME } from './helpers';
import type { ComponentDefinition, RenderContext } from '../../types';

// Mock renderComponent function for child components
vi.mock('../../core/render', async () => {
  const { Paragraph } = await vi.importActual<typeof import('docx')>('docx');
  return {
    renderComponent: vi.fn().mockResolvedValue([new Paragraph({})]),
  };
});

import { renderColumnsComponent } from '../columns';
import { renderComponent } from '../../core/render';
const mockRenderComponent = renderComponent as any;

describe('components/columns', () => {
  const mockContext: RenderContext = {
    theme: {
      name: 'test',
      colors: {},
      fonts: {},
      spacing: {},
    },
    fullTheme: createMockTheme(),
    document: {
      title: 'Test Document',
      date: new Date(),
      author: 'Test Author',
    },
    section: {
      currentLayout: 'single',
      columnCount: 1,
      pageNumber: 1,
    },
  } as RenderContext;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock returns paragraphs
    mockRenderComponent.mockResolvedValue([new Paragraph({})]);
  });

  describe('renderColumnsComponent', () => {
    it('should render empty columns component', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 2 },
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(result).toHaveLength(0);
      expect(mockRenderComponent).not.toHaveBeenCalled();
    });

    it('should render columns with single child component', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Column 1 content' },
          },
        ],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(1);
      expect(mockRenderComponent).toHaveBeenCalledWith(
        component.children![0],
        expect.any(Object),
        TEST_THEME_NAME,
        mockContext
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    });

    it('should render columns with multiple child components', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 3 },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Column 1' },
          },
          {
            name: 'paragraph',
            props: { content: 'Column 2' },
          },
          {
            name: 'paragraph',
            props: { content: 'Column 3' },
          },
        ],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('should handle mixed component types in columns', async () => {
      mockRenderComponent
        .mockResolvedValueOnce([new Paragraph({})])
        .mockResolvedValueOnce([
          new Table({ rows: [new TableRow({ children: [] })] }),
        ])
        .mockResolvedValueOnce([new Paragraph({})]);

      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 3 },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Text module' },
          },
          {
            name: 'table',
            props: {
              headers: ['Col1', 'Col2'],
              rows: [['A', 'B']],
            },
          },
          {
            name: 'heading',
            props: { text: 'Heading', level: 2 },
          },
        ],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(Paragraph);
      // Table constructor was called, but we return the mock
      expect(result[1]).toBeDefined();
      expect(result[2]).toBeInstanceOf(Paragraph);
    });

    it('should handle nested columns components', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'columns',
            props: { count: 1 },
            children: [
              {
                name: 'paragraph',
                props: { content: 'Nested content' },
              },
            ],
          },
        ],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(1);
      expect(mockRenderComponent).toHaveBeenCalledWith(
        component.children![0],
        expect.any(Object),
        TEST_THEME_NAME,
        mockContext
      );
      expect(result).toHaveLength(1);
    });

    it('should pass theme configuration to child components', async () => {
      const customTheme = createMockTheme({
        colors: {
          primary: 'FF0000',
          secondary: '00FF00',
          accent: '0000FF',
          text: '000000',
          background: 'FFFFFF',
        },
      });

      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Themed content' },
          },
        ],
      };

      await renderColumnsComponent(
        component,
        customTheme,
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledWith(
        component.children![0],
        customTheme,
        TEST_THEME_NAME,
        mockContext
      );
    });

    it('should pass context to child components', async () => {
      const customContext: RenderContext = {
        theme: {
          name: 'test',
          colors: {},
          fonts: {},
          spacing: {},
        },
        fullTheme: createMockTheme(),
        document: {
          title: 'Custom Title',
          date: new Date('2024-01-01T00:00:00Z'),
          author: 'Custom Author',
          company: 'Engineering',
        },
        section: {
          currentLayout: 'single',
          columnCount: 1,
          pageNumber: 1,
        },
      } as RenderContext;

      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Context test' },
          },
        ],
      };

      await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        customContext
      );

      expect(mockRenderComponent).toHaveBeenCalledWith(
        component.children![0],
        expect.any(Object),
        TEST_THEME_NAME,
        customContext
      );
    });

    it('should handle non-columns component type', async () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: { content: 'Not columns' },
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
      expect(mockRenderComponent).not.toHaveBeenCalled();
    });

    it('should handle columns with configuration options', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: {
          count: 3,
          space: 20,
          equalWidth: true,
          widths: [30, 40, 30],
        },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Col 1' },
          },
          {
            name: 'paragraph',
            props: { content: 'Col 2' },
          },
          {
            name: 'paragraph',
            props: { content: 'Col 3' },
          },
        ],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('should handle empty children array', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 2 },
        children: [],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(result).toHaveLength(0);
      expect(mockRenderComponent).not.toHaveBeenCalled();
    });

    it('should aggregate multiple elements from child components', async () => {
      mockRenderComponent.mockResolvedValue([
        new Paragraph({}),
        new Paragraph({}),
        new Paragraph({}),
      ]);

      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'list',
            props: { items: ['Item 1', 'Item 2', 'Item 3'] },
          },
        ],
      };

      const result = await renderColumnsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3);
      result.forEach((element) => {
        expect(element).toBeInstanceOf(Paragraph);
      });
    });

    it('should handle child component rendering errors gracefully', async () => {
      mockRenderComponent.mockRejectedValueOnce(new Error('Render error'));

      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'paragraph' as any,
            props: { content: 'test' },
          },
        ],
      };

      await expect(
        renderColumnsComponent(
          component,
          createMockTheme(),
          TEST_THEME_NAME,
          mockContext
        )
      ).rejects.toThrow('Render error');
    });

    it('should handle different theme names', async () => {
      const component: ComponentDefinition = {
        name: 'columns',
        props: { count: 1 },
        children: [
          {
            name: 'paragraph',
            props: { content: 'Theme test' },
          },
        ],
      };

      const themeNames = ['minimal', 'classic', 'professional', 'custom'];

      for (const themeName of themeNames) {
        mockRenderComponent.mockClear();
        mockRenderComponent.mockResolvedValue([new Paragraph({})]);

        const result = await renderColumnsComponent(
          component,
          createMockTheme(),
          themeName,
          mockContext
        );

        expect(mockRenderComponent).toHaveBeenCalledWith(
          component.children![0],
          expect.any(Object),
          themeName,
          mockContext
        );
        expect(result).toHaveLength(1);
      }
    });
  });
});
