/**
 * Paragraph Component
 * Standard component for rendering paragraph content in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isParagraphComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createText, createList } from '../core/content';
import {
  globalNumberingRegistry,
  createNumberingConfig,
  type NumberingConfig,
  type ListLevelConfig,
} from '../utils/numberingConfig';

/**
 * Parse markdown list syntax from paragraph text
 * Returns null if no list detected, or { type, items } if list found
 */
function parseMarkdownList(text: string): {
  type: 'unordered' | 'ordered';
  items: { text: string; level: number }[];
} | null {
  const lines = text.split('\n');
  const items: { text: string; level: number }[] = [];
  let isUnordered: boolean | null = null;
  let isOrdered: boolean | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Match unordered list: optional spaces + (- or *) + space + text
    const unorderedMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (unorderedMatch) {
      const indentLevel = Math.floor(unorderedMatch[1].length / 2); // 2 spaces = 1 level
      const text = unorderedMatch[3];
      items.push({ text, level: indentLevel });
      if (isUnordered === null) isUnordered = true;
      continue;
    }

    // Match ordered list: optional spaces + number + . + space + text
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const indentLevel = Math.floor(orderedMatch[1].length / 2); // 2 spaces = 1 level
      const text = orderedMatch[3];
      items.push({ text, level: indentLevel });
      if (isOrdered === null) isOrdered = true;
      continue;
    }

    // If we find a line that doesn't match list syntax, this isn't a list
    return null;
  }

  // If no items found, or mixed list types, not a valid list
  if (items.length === 0 || (isUnordered && isOrdered)) {
    return null;
  }

  return {
    type: isUnordered ? 'unordered' : 'ordered',
    items,
  };
}

/**
 * Render paragraph component
 */
export function renderParagraphComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Paragraph[] {
  if (!isParagraphComponent(component)) return [];

  // Props are pre-resolved by resolveComponentTree
  const resolvedConfig = component.props;

  // Check if text contains markdown list syntax
  const listData = parseMarkdownList(resolvedConfig.text);

  if (listData) {
    // Text is a markdown list - render as proper docx list
    const reference =
      globalNumberingRegistry.generateReference('markdown-list');

    // Create appropriate numbering configuration
    const levels: ListLevelConfig[] = [];

    if (listData.type === 'unordered') {
      // Bullet list with different bullets for each level
      levels.push(
        { level: 0, format: 'bullet', text: '•', alignment: 'left' },
        { level: 1, format: 'bullet', text: '◦', alignment: 'left' },
        { level: 2, format: 'bullet', text: '▪', alignment: 'left' }
      );
    } else {
      // Ordered list with decimal, lowercase letter, lowercase roman
      levels.push(
        { level: 0, format: 'decimal', text: '%1.', alignment: 'left' },
        { level: 1, format: 'lowerLetter', text: '%2.', alignment: 'left' },
        { level: 2, format: 'lowerRoman', text: '%3.', alignment: 'left' }
      );
    }

    const numberingConfig: NumberingConfig = {
      reference,
      levels,
    };

    globalNumberingRegistry.register(createNumberingConfig(numberingConfig));

    // Create list paragraphs
    return createList(listData.items, theme, themeName, {
      numberingReference: reference,
      spacing: resolvedConfig.spacing as
        | { before?: number; after?: number; item?: number }
        | undefined,
      alignment: resolvedConfig.alignment,
    });
  }

  // Not a list - render as regular text paragraph
  // Map themeStyle (theme logical name) to DOCX style id
  // Supports both predefined styles and custom styles from theme.styles
  const styleFromTheme = (() => {
    const key = resolvedConfig.themeStyle;
    if (!key) return undefined;

    const lowerKey = key.toLowerCase();

    // Map predefined style names to Word style IDs
    if (lowerKey === 'normal') return 'Normal';
    if (lowerKey === 'title') return 'Title';
    if (lowerKey === 'subtitle') return 'Subtitle';
    const headingMatch = lowerKey.match(/^heading([1-6])$/);
    if (headingMatch) {
      // For paragraph components, use display-only heading styles that are visually
      // identical but do NOT participate in TOC/outline levels
      return `JTD_HeadingText${headingMatch[1]}`;
    }

    // For custom styles, use the exact key as the style ID
    // Custom styles are registered in themeToDocxAdapter with their exact key as ID
    return key;
  })();

  // Extract outline level from style if present (for TOC support)
  const outlineLevel = (() => {
    const key = resolvedConfig.themeStyle;
    if (!key) return undefined;

    // Never contribute paragraph component paragraphs to TOC when using heading styles
    // Even if the theme sets outlineLevel for heading styles, ignore it here
    const lowerKey = key.toLowerCase();
    const headingMatch = lowerKey.match(/^heading([1-6])$/);
    if (headingMatch) return undefined;

    // Check if this is a custom style with outline level
    const customStyle = theme.styles?.[key as keyof typeof theme.styles];
    if (
      customStyle &&
      typeof customStyle === 'object' &&
      'outlineLevel' in customStyle
    ) {
      return (customStyle as any).outlineLevel;
    }

    return undefined;
  })();

  // Create text paragraph with optional column break and floating positioning
  const text = createText(resolvedConfig.text, theme, themeName, {
    style: styleFromTheme,
    spacing: resolvedConfig.spacing as
      | { before?: number; after?: number }
      | undefined,
    lineSpacing: resolvedConfig.font?.lineSpacing,
    alignment: resolvedConfig.alignment,
    boldColor: resolvedConfig.boldColor,
    columnBreak: resolvedConfig.columnBreak,
    // Pass font properties
    fontFamily: resolvedConfig.font?.family,
    fontSize: resolvedConfig.font?.size,
    fontColor: resolvedConfig.font?.color,
    bold: resolvedConfig.font?.bold,
    fontWeight: (resolvedConfig.font as { fontWeight?: number } | undefined)
      ?.fontWeight,
    italic: resolvedConfig.font?.italic,
    underline: resolvedConfig.font?.underline,
    // Pass outline level for TOC support
    outlineLevel: outlineLevel,
    // Pass floating positioning properties
    floating: resolvedConfig.floating,
    // Pass keepNext property
    keepNext: resolvedConfig.keepNext,
    // Pass keepLines property
    keepLines: resolvedConfig.keepLines,
    // Pass bookmark ID for internal linking
    bookmarkId: resolvedConfig.id,
  });

  return [text];
}
