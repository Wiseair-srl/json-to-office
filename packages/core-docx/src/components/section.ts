/**
 * Section Component
 * Standard component for rendering document sections with child components
 */

import { Paragraph, Table, BookmarkStart, BookmarkEnd } from 'docx';
import {
  ComponentDefinition,
  RenderContext,
  isSectionComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { renderComponent } from '../core/render';

interface SectionBookmarkState {
  next: number;
}

/** Generate a document-scoped, reproducible bookmark ID. */
function generateSectionBookmarkId(context: RenderContext): {
  id: string;
  linkId: number;
} {
  const custom = (context.custom ??= {});
  const state = (custom.sectionBookmarks ??= {
    next: 1,
  }) as SectionBookmarkState;
  const ordinal = state.next++;
  // Keep nested component IDs away from the low ordinals used by layout
  // section bookmarks in core/render.ts.
  const linkId = 1_000_000 + ordinal;
  return {
    id: `_NestedSection_${ordinal}`,
    linkId,
  };
}

/**
 * Render section component with bookmark support for scoped TOCs
 */
export async function renderSectionComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!isSectionComponent(component)) return [];

  const elements: (Paragraph | Table)[] = [];

  // Generate unique bookmark ID for this section
  const { id: sectionBookmarkId, linkId: bookmarkLinkId } =
    generateSectionBookmarkId(context);

  // Add bookmark in a zero-spacing paragraph at section start
  // This prevents visual gaps while maintaining bookmark functionality
  elements.push(
    new Paragraph({
      children: [new BookmarkStart(sectionBookmarkId, bookmarkLinkId)],
      spacing: {
        before: 0,
        after: 0,
        line: 0,
      },
    })
  );

  // Update context with section bookmark ID for child components (especially TOCs)
  const sectionContext: RenderContext = {
    ...context,
    section: {
      ...context.section,
      sectionBookmarkId,
    },
  };

  // Render child components with updated context
  if (component.children) {
    for (const child of component.children) {
      const childElements = await renderComponent(
        child,
        theme,
        themeName,
        sectionContext
      );
      elements.push(...childElements);
    }
  }

  // Add bookmark end after section content
  // Use zero spacing to prevent visual gap
  elements.push(
    new Paragraph({
      children: [new BookmarkEnd(bookmarkLinkId)],
      spacing: {
        before: 0,
        after: 0,
        line: 0,
      },
    })
  );

  return elements;
}
