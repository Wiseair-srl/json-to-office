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

import { renderSectionComponent } from '../section';
import { renderComponent } from '../../core/render';
const mockRenderComponent = renderComponent as any;

describe('components/section', () => {
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
    },
    section: {
      currentLayout: 'single',
      columnCount: 1,
      pageNumber: 1,
    },
    utils: {
      formatDate: () => '2024-01-01',
      parseText: () => [{ text: 'test' }],
      getStyle: () => ({ name: 'test' }),
    },
    depth: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockRenderComponent.mockResolvedValue([new Paragraph({})]);
  });

  describe('renderSectionComponent', () => {
    it('should render empty section component', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {},
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Empty sections now include 2 bookmark paragraphs (start and end)
      expect(result).toHaveLength(2);
      expect(mockRenderComponent).not.toHaveBeenCalled();
    });

    it('should render section with child components', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { content: 'Section content 1' },
          },
          {
            name: 'paragraph',
            props: { content: 'Section content 2' },
          },
        ],
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(4); // +2 for bookmarks
    });

    it('should render section with child components', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { content: 'Content under section' },
          },
        ],
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3); // bookmark start + content + bookmark end
      expect(result[0]).toBeInstanceOf(Paragraph); // Bookmark start
      expect(result[1]).toBeInstanceOf(Paragraph); // Content
      expect(result[2]).toBeInstanceOf(Paragraph); // Bookmark end
    });

    it('should handle nested sections', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'section',
            props: {},
            children: [
              {
                name: 'paragraph',
                props: { content: 'Nested content' },
              },
            ],
          },
        ],
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(1); // Child section
      expect(result).toHaveLength(3); // bookmark start + child section + bookmark end
    });

    it('should handle mixed component types in section', async () => {
      mockRenderComponent
        .mockResolvedValueOnce([new Paragraph({})])
        .mockResolvedValueOnce([
          new Table({ rows: [new TableRow({ children: [] })] }),
        ])
        .mockResolvedValueOnce([new Paragraph({}), new Paragraph({})]);

      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { content: 'Text content' },
          },
          {
            name: 'table',
            props: {
              headers: ['Col1', 'Col2'],
              rows: [['A', 'B']],
            },
          },
          {
            name: 'list',
            props: { items: ['Item 1', 'Item 2'] },
          },
        ],
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(6); // 1 bookmark-start + 1 paragraph + 1 table + 2 paragraphs + 1 bookmark-end
      expect(result[0]).toBeInstanceOf(Paragraph); // Bookmark start
      expect(result[1]).toBeInstanceOf(Paragraph); // Text
      // Table constructor was called, but we return the mock
      expect(result[2]).toBeDefined(); // Table
      expect(result[3]).toBeInstanceOf(Paragraph); // List item 1
      expect(result[4]).toBeInstanceOf(Paragraph); // List item 2
      expect(result[5]).toBeInstanceOf(Paragraph); // Bookmark end
    });

    it('should pass theme to child components', async () => {
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
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { content: 'Themed content' },
          },
        ],
      };

      await renderSectionComponent(
        component,
        customTheme,
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).toHaveBeenCalledWith(
        component.children![0],
        customTheme,
        TEST_THEME_NAME,
        expect.objectContaining({
          ...mockContext,
          section: expect.objectContaining({
            ...mockContext.section,
            sectionBookmarkId: expect.any(String),
          }),
        })
      );
    });

    it('should pass context to child components', async () => {
      const customContext: RenderContext = {
        theme: {
          name: 'custom',
          colors: {},
          fonts: {},
          spacing: {},
        },
        fullTheme: createMockTheme(),
        document: {
          title: 'Custom Title',
          date: new Date(),
        },
        section: {
          currentLayout: 'single',
          columnCount: 1,
          pageNumber: 1,
        },
        utils: {
          formatDate: () => '2024-01-01',
          parseText: () => [{ text: 'test' }],
          getStyle: () => ({ name: 'test' }),
        },
        depth: 0,
        custom: {
          version: '1.0.0',
        },
      };

      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { content: 'Context test' },
          },
        ],
      };

      await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        customContext
      );

      // Context should be updated with sectionBookmarkId
      expect(mockRenderComponent).toHaveBeenCalledWith(
        component.children![0],
        expect.any(Object),
        TEST_THEME_NAME,
        expect.objectContaining({
          ...customContext,
          section: expect.objectContaining({
            ...customContext.section,
            sectionBookmarkId: expect.any(String),
          }),
        })
      );
    });

    it('should handle non-section component type', async () => {
      const component: ComponentDefinition = {
        name: 'paragraph',
        props: { content: 'Not a section' },
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Non-section components return empty array (early return in renderSectionComponent)
      expect(result).toHaveLength(0);
      expect(mockRenderComponent).not.toHaveBeenCalled();
    });

    it('should handle missing config', async () => {
      const component: ComponentDefinition = {
        name: 'section',
      } as ComponentDefinition;

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Sections now include 2 bookmark paragraphs (start and end) even when empty
      expect(result).toHaveLength(2);
    });

    it('should handle empty children array', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [],
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(mockRenderComponent).not.toHaveBeenCalled();
      // bookmark start (1) + bookmark end (1) = 2 paragraphs
      expect(result).toHaveLength(2);
    });

    it('should handle child component rendering errors gracefully', async () => {
      mockRenderComponent.mockRejectedValueOnce(
        new Error('Child render error')
      );

      const component: ComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { content: 'Test content' },
          },
        ],
      };

      await expect(
        renderSectionComponent(
          component,
          createMockTheme(),
          TEST_THEME_NAME,
          mockContext
        )
      ).rejects.toThrow('Child render error');
    });

    it('should accept page configuration override', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {
          page: {
            size: 'LEGAL',
            margins: {
              top: 720,
              bottom: 720,
              left: 1440,
              right: 1440,
            },
          },
        },
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should render successfully with page config
      expect(result).toHaveLength(2); // bookmark start + bookmark end
    });

    it('should accept partial page configuration (margins only)', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {
          page: {
            margins: {
              left: 2880, // 2 inches
              right: 2880,
            },
          },
        },
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should render successfully with partial page config
      expect(result).toHaveLength(2);
    });

    it('should accept partial page configuration (size only)', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {
          page: {
            size: 'A3',
          },
        },
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should render successfully with size-only page config
      expect(result).toHaveLength(2);
    });

    it('should accept custom page dimensions', async () => {
      const component: ComponentDefinition = {
        name: 'section',
        props: {
          page: {
            size: {
              width: 15000,
              height: 20000,
            },
          },
        },
      };

      const result = await renderSectionComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should render successfully with custom dimensions
      expect(result).toHaveLength(2);
    });
  });
});
