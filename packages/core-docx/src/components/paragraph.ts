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
import { parseMarkdownList } from '../core/markdownList';

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

  // Check if text contains markdown list syntax.
  // Revision paragraphs always render as plain text: their segments carry
  // literal text and cannot be re-split into list items.
  const listData = resolvedConfig.revision
    ? null
    : parseMarkdownList(resolvedConfig.text);

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

    // Create list paragraphs. Comments and notes travel with this path too:
    // a markdown list is still the same paragraph the author annotated.
    return createList(listData.items, theme, themeName, {
      numberingReference: reference,
      spacing: resolvedConfig.spacing as
        | { before?: number; after?: number; item?: number }
        | undefined,
      alignment: resolvedConfig.alignment,
      comment: resolvedConfig.comment,
      footnotes: resolvedConfig.footnotes,
      endnotes: resolvedConfig.endnotes,
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
    scale: resolvedConfig.font?.scale,
    characterSpacing: resolvedConfig.font?.characterSpacing,
    // Proofing: local language override + no-proof toggle + known-words list
    language: resolvedConfig.language,
    noProof: resolvedConfig.noProof,
    noProofWords: resolvedConfig.noProofWords,
    // Pass outline level for TOC support
    outlineLevel: outlineLevel,
    // Pass floating positioning properties
    floating: resolvedConfig.floating,
    // Pass keepNext property
    keepNext: resolvedConfig.keepNext,
    // Pass keepLines property
    keepLines: resolvedConfig.keepLines,
    // Paragraph indentation (w:ind) in twips
    indent: resolvedConfig.indent,
    // Tab stops (w:tabs); \t characters in text jump to these positions
    tabStops: resolvedConfig.tabStops,
    // Pass bookmark ID for internal linking
    bookmarkId: resolvedConfig.id,
    // Tracked-change segments (rendered as native Word revisions)
    revision: resolvedConfig.revision,
    // Review comment anchored to this paragraph's text
    comment: resolvedConfig.comment,
    // Note bodies for the `[^id]` markers in this paragraph
    footnotes: resolvedConfig.footnotes,
    endnotes: resolvedConfig.endnotes,
  });

  return [text];
}
