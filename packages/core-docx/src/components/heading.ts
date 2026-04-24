/**
 * Heading Component
 * Standard component for rendering heading elements in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isHeadingComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createHeading } from '../core/content';
import { globalBookmarkRegistry } from '../utils/bookmarkRegistry';

/**
 * Render heading component
 */
export function renderHeadingComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Paragraph[] {
  if (!isHeadingComponent(component)) return [];

  // Props are pre-resolved by resolveComponentTree (componentDefaults + level-specific defaults)
  const config = component.props;

  // Generate or use bookmark ID for internal linking
  // If component has id, use it; otherwise generate from heading text
  const bookmarkId =
    (component as any).id ||
    globalBookmarkRegistry.generateId(config.text, 'heading');

  // Create heading with optional column break and bookmark
  const header = createHeading(
    config.text,
    config.level || 1,
    theme,
    themeName,
    {
      alignment: config.alignment,
      spacing: config.spacing,
      lineSpacing: config.lineSpacing,
      columnBreak: config.columnBreak,
      // Local font overrides
      fontFamily: config.font?.family,
      fontSize: config.font?.size,
      fontColor: config.font?.color,
      bold: config.font?.bold,
      fontWeight: (config.font as { fontWeight?: number } | undefined)
        ?.fontWeight,
      italic: config.font?.italic,
      underline: config.font?.underline,
      // Pagination control
      keepNext: config.keepNext,
      keepLines: config.keepLines,
      // Bookmark ID for internal linking
      bookmarkId: bookmarkId,
    }
  );

  return [header];
}
