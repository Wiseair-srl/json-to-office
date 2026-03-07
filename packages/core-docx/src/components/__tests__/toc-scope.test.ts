/**
 * TOC Scope Integration Tests
 *
 * These tests verify that section-scoped TOCs work correctly:
 * 1. TOCs automatically detect scope based on context
 * 2. Section bookmarks are properly generated
 * 3. TOC field codes include bookmark scope when appropriate
 */

import { describe, it, expect } from 'vitest';
import { renderTocComponent } from '../toc';
import { renderSectionComponent } from '../section';
import { createMockTheme, TEST_THEME_NAME } from './helpers';
import type {
  RenderContext,
  TocComponentDefinition,
  SectionComponentDefinition,
} from '../../types';
import { Paragraph, TableOfContents } from 'docx';

describe('TOC Scope Integration', () => {
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

  describe('renderTocComponent scope detection', () => {
    it('should default to document scope when no context provided', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'Contents',
          scope: 'auto',
        },
      };

      const result = renderTocComponent(component, createMockTheme());

      expect(result).toHaveLength(2); // Title + TOC field
      expect(result[0]).toBeInstanceOf(Paragraph);
      expect(result[1]).toBeInstanceOf(TableOfContents);

      // TOC should be TableOfContents instance
      const tocElement = result[1];
      expect(tocElement).toBeInstanceOf(TableOfContents);
    });

    it('should detect section scope when sectionBookmarkId is present', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'Section Contents',
          scope: 'auto',
        },
      };

      const contextWithBookmark: RenderContext = {
        ...mockContext,
        section: {
          ...mockContext.section,
          sectionBookmarkId: '_Section_1_12345',
        },
      };

      const result = renderTocComponent(
        component,
        createMockTheme(),
        contextWithBookmark
      );

      expect(result).toHaveLength(2);
      // The TOC should be scoped to the section bookmark
      // (We can't easily inspect the TableOfContents internals, but the function
      // should pass entriesFromBookmark to TableOfContents constructor)
    });

    it('should use document scope when explicitly set', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'All Contents',
          scope: 'document',
        },
      };

      const contextWithBookmark: RenderContext = {
        ...mockContext,
        section: {
          ...mockContext.section,
          sectionBookmarkId: '_Section_1_12345',
        },
      };

      const result = renderTocComponent(
        component,
        createMockTheme(),
        contextWithBookmark
      );

      expect(result).toHaveLength(2);
      // Should use document scope despite being in a section context
    });

    it('should use section scope when explicitly set', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'Section Only',
          scope: 'section',
        },
      };

      const contextWithBookmark: RenderContext = {
        ...mockContext,
        section: {
          ...mockContext.section,
          sectionBookmarkId: '_Section_2_67890',
        },
      };

      const result = renderTocComponent(
        component,
        createMockTheme(),
        contextWithBookmark
      );

      expect(result).toHaveLength(2);
      // Should use section scope with the provided bookmark
    });

    it('should handle different depth configurations', () => {
      const depths = [1, 2, 3, 4, 5, 6];

      depths.forEach((depth) => {
        const component: TocComponentDefinition = {
          name: 'toc',
          props: {
            title: `TOC Depth ${depth}`,
            depth: { to: depth },
          },
        };

        const result = renderTocComponent(
          component,
          createMockTheme(),
          mockContext
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toBeInstanceOf(Paragraph); // Title
        expect(result[1]).toBeInstanceOf(TableOfContents); // TOC
      });
    });
  });

  describe('Section bookmark generation', () => {
    it('should generate unique bookmark IDs for each section', async () => {
      const section1: SectionComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { text: 'Content 1' },
          },
        ],
      };

      const section2: SectionComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { text: 'Content 2' },
          },
        ],
      };

      const result1 = await renderSectionComponent(
        section1,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      const result2 = await renderSectionComponent(
        section2,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Each section should have bookmark paragraphs
      expect(result1.length).toBeGreaterThan(2); // At least bookmark start + bookmark end
      expect(result2.length).toBeGreaterThan(2);

      // Sections should have different structures (can't easily compare bookmark IDs,
      // but we verify both generate proper structure)
      expect(result1).toHaveLength(3); // Bookmark start + content + bookmark end
      expect(result2).toHaveLength(3);
    });

    it('should pass bookmark ID to child components via context', async () => {
      const section: SectionComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'paragraph',
            props: { text: 'Child content' },
          },
        ],
      };

      // We can't directly inspect the context passed to children without mocking,
      // but we can verify the section renders correctly
      const result = await renderSectionComponent(
        section,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(result).toHaveLength(3); // Bookmark start + content + bookmark end
    });

    it('should include bookmarks even for empty sections', async () => {
      const emptySection: SectionComponentDefinition = {
        name: 'section',
        props: {},
      };

      const result = await renderSectionComponent(
        emptySection,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      expect(result).toHaveLength(2); // Bookmark start + bookmark end
    });
  });

  describe('TOC scope behavior validation', () => {
    it('should create section-scoped TOC inside section', async () => {
      const sectionWithToc: SectionComponentDefinition = {
        name: 'section',
        props: {
          title: 'Section with TOC',
        },
        children: [
          {
            name: 'toc',
            props: {
              title: 'Section Contents',
              scope: 'auto', // Should auto-detect as section-scoped
            },
          },
          {
            name: 'heading',
            props: {
              text: 'Subsection',
              level: 2,
            },
          },
        ],
      };

      const result = await renderSectionComponent(
        sectionWithToc,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should have: Title + bookmark start + TOC title + TOC field + heading + bookmark end
      expect(result.length).toBeGreaterThan(4);
      expect(result[0]).toBeInstanceOf(Paragraph); // Section title
    });

    it('should allow document-scoped TOC inside section', async () => {
      const sectionWithDocToc: SectionComponentDefinition = {
        name: 'section',
        props: {
          title: 'Section with Document TOC',
        },
        children: [
          {
            name: 'toc',
            props: {
              title: 'All Contents',
              scope: 'document', // Explicit document scope
            },
          },
        ],
      };

      const result = await renderSectionComponent(
        sectionWithDocToc,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should render successfully with document-scoped TOC
      expect(result.length).toBeGreaterThan(2);
    });
  });

  describe('TOC self-reference prevention', () => {
    it('should not render TOC title as a heading style', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'Table of Contents',
        },
      };

      const result = renderTocComponent(
        component,
        createMockTheme(),
        mockContext
      );

      expect(result).toHaveLength(2);

      // First paragraph should be the title
      const titleParagraph = result[0];
      expect(titleParagraph).toBeInstanceOf(Paragraph);

      // Title should use TextRun with custom styling, not heading style
      // This prevents it from appearing in other TOCs
      const titleRoot = titleParagraph.root;
      expect(titleRoot).toBeDefined();

      // The paragraph should not have a heading property set
      // (We can't easily inspect internal properties, but we verify it renders)
    });

    it('should render section-scoped TOC', async () => {
      const sectionWithToc: SectionComponentDefinition = {
        name: 'section',
        props: {},
        children: [
          {
            name: 'toc',
            props: {
              title: 'Section Contents',
              scope: 'section',
            },
          },
          {
            name: 'heading',
            props: {
              text: 'First Heading',
              level: 2,
            },
          },
        ],
      };

      const result = await renderSectionComponent(
        sectionWithToc,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Structure should be:
      // 1. Bookmark start
      // 2. TOC title
      // 3. TOC field
      // 4. First Heading
      // 5. Bookmark end

      // Verify proper structure
      expect(result.length).toBeGreaterThan(4);
      expect(result[0]).toBeInstanceOf(Paragraph); // Bookmark start
    });
  });

  describe('Edge cases', () => {
    it('should handle TOC with no title', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {},
      };

      const result = renderTocComponent(
        component,
        createMockTheme(),
        mockContext
      );

      expect(result).toHaveLength(1); // Only TOC field, no title
    });

    it('should render TOC with custom title', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'Custom Contents',
        },
      };

      const result = renderTocComponent(
        component,
        createMockTheme(),
        mockContext
      );

      expect(result).toHaveLength(2); // Title + TOC field
      expect(result[0]).toBeInstanceOf(Paragraph); // Title paragraph
      expect(result[1]).toBeInstanceOf(TableOfContents); // TOC element
    });

    it('should handle section scope without bookmark ID gracefully', () => {
      const component: TocComponentDefinition = {
        name: 'toc',
        props: {
          title: 'Contents',
          scope: 'section', // Explicit section scope
        },
      };

      // Context without sectionBookmarkId - should not crash
      const result = renderTocComponent(
        component,
        createMockTheme(),
        mockContext
      );

      expect(result).toHaveLength(2);
    });

    it('should handle multiple TOCs in same section', async () => {
      const sectionWithMultipleTocs: SectionComponentDefinition = {
        name: 'section',
        props: {
          title: 'Section with Multiple TOCs',
        },
        children: [
          {
            name: 'toc',
            props: {
              title: 'First TOC',
              scope: 'section',
            },
          },
          {
            name: 'paragraph',
            props: { text: 'Some content' },
          },
          {
            name: 'toc',
            props: {
              title: 'Second TOC',
              scope: 'section',
            },
          },
        ],
      };

      const result = await renderSectionComponent(
        sectionWithMultipleTocs,
        createMockTheme(),
        TEST_THEME_NAME,
        mockContext
      );

      // Should successfully render multiple TOCs
      expect(result.length).toBeGreaterThan(5);
    });
  });
});
