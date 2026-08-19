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
import { globalSectionBookmarkRegistry } from '../core/sectionBookmarks';

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

  // Resolve this section's bookmark from the single producer, keyed by
  // component identity so re-resolving the same node never allocates twice.
  const { id: sectionBookmarkId, linkId: bookmarkLinkId } =
    globalSectionBookmarkRegistry.forSectionComponent(component);

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
