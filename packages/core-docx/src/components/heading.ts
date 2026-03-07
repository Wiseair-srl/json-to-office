/**
 * Heading Component
 * Standard component for rendering heading elements in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isHeadingComponent } from '../types';
import { ThemeConfig } from '../styles';
import {
  resolveHeadingProps,
  getHeadingDefaultsForLevel,
} from '../styles/utils/componentDefaults';
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

  // Resolve configuration with theme defaults
  const resolvedConfig = resolveHeadingProps(component.props, theme);

  // Get level-specific theme defaults and merge them
  // Only apply level defaults if no explicit alignment was provided in the original props
  const level = resolvedConfig.level || 1;
  const levelDefaults = getHeadingDefaultsForLevel(theme, level);
  const finalConfig = {
    ...resolvedConfig,
    // Only apply level defaults if no explicit alignment was provided in the original props
    ...(component.props.alignment ? {} : levelDefaults),
  };

  // Generate or use bookmark ID for internal linking
  // If component has id, use it; otherwise generate from heading text
  const bookmarkId =
    (component as any).id ||
    globalBookmarkRegistry.generateId(finalConfig.text, 'heading');

  // Create heading with optional column break and bookmark
  const header = createHeading(
    finalConfig.text,
    finalConfig.level || 1,
    theme,
    themeName,
    {
      alignment: finalConfig.alignment,
      spacing: finalConfig.spacing,
      lineSpacing: finalConfig.lineSpacing,
      columnBreak: finalConfig.columnBreak,
      // Local font overrides
      fontFamily: finalConfig.font?.family,
      fontSize: finalConfig.font?.size,
      fontColor: finalConfig.font?.color,
      bold: finalConfig.font?.bold,
      italic: finalConfig.font?.italic,
      underline: finalConfig.font?.underline,
      // Pagination control
      keepNext: finalConfig.keepNext,
      keepLines: finalConfig.keepLines,
      // Bookmark ID for internal linking
      bookmarkId: bookmarkId,
    }
  );

  return [header];
}
