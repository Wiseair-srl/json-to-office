/**
 * Placeholder Processing System
 * Handles dynamic content replacement in text with support for rich text formatting
 */

import {
  TextRun,
  PageNumber,
  ExternalHyperlink,
  InternalHyperlink,
} from 'docx';
import { parseTextWithDecorators, TextStyle } from './textParser';
import { normalizeUnicodeText } from './unicode';

// Type alias for elements that can appear in a paragraph
type ParagraphChild = TextRun | ExternalHyperlink | InternalHyperlink;

/**
 * Placeholder handler function type
 */
export type PlaceholderHandler = (
  _context?: PlaceholderContext
) => TextRun | TextRun[] | string;

/**
 * Context passed to placeholder handlers
 */
export interface PlaceholderContext {
  style?: TextStyle;
  [key: string]: unknown;
}

/**
 * Placeholder registry for managing dynamic content
 */
export class PlaceholderRegistry {
  private static handlers = new Map<string, PlaceholderHandler>();

  /**
   * Register a placeholder handler
   */
  static register(name: string, handler: PlaceholderHandler): void {
    this.handlers.set(name.toUpperCase(), handler);
  }

  /**
   * Get a placeholder handler
   */
  static get(name: string): PlaceholderHandler | undefined {
    return this.handlers.get(name.toUpperCase());
  }

  /**
   * Check if a placeholder is registered
   */
  static has(name: string): boolean {
    return this.handlers.has(name.toUpperCase());
  }

  /**
   * Get all registered placeholder names
   */
  static getRegisteredNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all registered placeholders
   */
  static clear(): void {
    this.handlers.clear();
  }
}

/**
 * Process text containing placeholders and return array of paragraph children
 */
export function processPlaceholders(
  text: string,
  baseStyle: TextStyle = {},
  context: PlaceholderContext = {}
): ParagraphChild[] {
  const normalizedText = normalizeUnicodeText(text);
  const placeholderRegex = /\{([^}]+)\}/g;
  const result: ParagraphChild[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = placeholderRegex.exec(normalizedText)) !== null) {
    const beforeText = normalizedText.substring(lastIndex, match.index);
    const placeholderName = match[1];

    // Add text before placeholder
    if (beforeText) {
      result.push(...parseTextWithDecorators(beforeText, baseStyle));
    }

    // Process placeholder
    const handler = PlaceholderRegistry.get(placeholderName);
    if (handler) {
      const placeholderResult = handler({ ...context, style: baseStyle });

      if (Array.isArray(placeholderResult)) {
        result.push(...placeholderResult);
      } else if (placeholderResult instanceof TextRun) {
        result.push(placeholderResult);
      } else if (typeof placeholderResult === 'string') {
        result.push(...parseTextWithDecorators(placeholderResult, baseStyle));
      }
    } else {
      // Unknown placeholder - keep as text
      result.push(...parseTextWithDecorators(match[0], baseStyle));
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < normalizedText.length) {
    const remainingText = normalizedText.substring(lastIndex);
    result.push(...parseTextWithDecorators(remainingText, baseStyle));
  }

  // If no placeholders found, process as normal text
  if (result.length === 0) {
    result.push(...parseTextWithDecorators(normalizedText, baseStyle));
  }

  return result;
}

/**
 * Process text with both decorators and placeholders
 */
export function processTextWithPlaceholders(
  text: string,
  baseStyle: TextStyle = {},
  context: PlaceholderContext = {}
): ParagraphChild[] {
  const normalizedText = normalizeUnicodeText(text);
  // Use a more sophisticated approach to handle both decorators and placeholders
  // This regex captures both markdown decorators and placeholders
  const combinedRegex =
    /(\*\*\*|___)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5|\{([^}]+)\}/g;
  const result: ParagraphChild[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = combinedRegex.exec(normalizedText)) !== null) {
    // Add any text before the match as plain text
    if (match.index > lastIndex) {
      const beforeText = normalizedText.substring(lastIndex, match.index);
      if (beforeText) {
        result.push(...createTextRunsWithNewlines(beforeText, baseStyle));
      }
    }

    // Check if this is a placeholder (group 7)
    if (match[7]) {
      const placeholderName = match[7];
      const handler = PlaceholderRegistry.get(placeholderName);
      if (handler) {
        const placeholderResult = handler({ ...context, style: baseStyle });

        if (Array.isArray(placeholderResult)) {
          result.push(...placeholderResult);
        } else if (placeholderResult instanceof TextRun) {
          result.push(placeholderResult);
        } else if (typeof placeholderResult === 'string') {
          result.push(
            ...createTextRunsWithNewlines(placeholderResult, baseStyle)
          );
        }
      } else {
        // Unknown placeholder - keep as text
        result.push(...createTextRunsWithNewlines(match[0], baseStyle));
      }
    } else {
      // This is a decorator match - determine the style
      let decoratedText: string;
      let bold = baseStyle.bold || false;
      let italics = baseStyle.italics || false;

      if (match[1] === '***' || match[1] === '___') {
        // Bold + Italic
        decoratedText = match[2];
        bold = true;
        italics = true;
      } else if (match[3] === '**' || match[3] === '__') {
        // Bold
        decoratedText = match[4];
        bold = true;
      } else if (match[5] === '*' || match[5] === '_') {
        // Italic
        decoratedText = match[6];
        italics = true;
      } else {
        // This shouldn't happen with our regex, but just in case
        decoratedText = match[0];
      }

      // Recursively process the decorated text (it might contain placeholders)
      const decoratedTextRuns = processTextWithPlaceholders(
        decoratedText,
        {
          ...baseStyle,
          bold,
          italics,
        },
        context
      );
      result.push(...decoratedTextRuns);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last match
  if (lastIndex < normalizedText.length) {
    const remainingText = normalizedText.substring(lastIndex);
    if (remainingText) {
      result.push(...createTextRunsWithNewlines(remainingText, baseStyle));
    }
  }

  // If no matches were found, return text runs with newlines
  if (result.length === 0 && normalizedText) {
    result.push(...createTextRunsWithNewlines(normalizedText, baseStyle));
  }

  return result;
}

/**
 * Helper function to create TextRuns with newlines from text
 */
function createTextRunsWithNewlines(
  text: string,
  baseStyle: TextStyle
): TextRun[] {
  const runs: TextRun[] = [];
  const lines = text.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const needsLineBreak = lineIndex > 0;

    if (line || needsLineBreak) {
      runs.push(
        new TextRun({
          text: line,
          font: baseStyle.font,
          size: baseStyle.size,
          color: baseStyle.color,
          bold: baseStyle.bold,
          italics: baseStyle.italics,
          underline: baseStyle.underline,
          break: needsLineBreak ? 1 : undefined,
        })
      );
    }
  }

  return runs;
}

/**
 * Initialize built-in placeholders
 */
export function initializeBuiltinPlaceholders(): void {
  // PAGE placeholder
  PlaceholderRegistry.register('PAGE', (context) => {
    return new TextRun({
      children: [PageNumber.CURRENT],
      font: context?.style?.font,
      size: context?.style?.size,
      color: context?.style?.color,
      bold: context?.style?.bold,
      italics: context?.style?.italics,
      underline: context?.style?.underline,
    });
  });

  // TOTAL_PAGES placeholder
  PlaceholderRegistry.register('TOTAL_PAGES', (context) => {
    return new TextRun({
      children: [PageNumber.TOTAL_PAGES],
      font: context?.style?.font,
      size: context?.style?.size,
      color: context?.style?.color,
      bold: context?.style?.bold,
      italics: context?.style?.italics,
      underline: context?.style?.underline,
    });
  });

  // DATE placeholder
  PlaceholderRegistry.register('DATE', (context) => {
    const today = new Date();
    const dateString = today.toLocaleDateString();
    return new TextRun({
      text: dateString,
      font: context?.style?.font,
      size: context?.style?.size,
      color: context?.style?.color,
      bold: context?.style?.bold,
      italics: context?.style?.italics,
      underline: context?.style?.underline,
    });
  });

  // DATETIME placeholder
  PlaceholderRegistry.register('DATETIME', (context) => {
    const now = new Date();
    const dateTimeString = now.toLocaleString();
    return new TextRun({
      text: dateTimeString,
      font: context?.style?.font,
      size: context?.style?.size,
      color: context?.style?.color,
      bold: context?.style?.bold,
      italics: context?.style?.italics,
      underline: context?.style?.underline,
    });
  });

  // YEAR placeholder
  PlaceholderRegistry.register('YEAR', (context) => {
    const year = new Date().getFullYear().toString();
    return new TextRun({
      text: year,
      font: context?.style?.font,
      size: context?.style?.size,
      color: context?.style?.color,
      bold: context?.style?.bold,
      italics: context?.style?.italics,
      underline: context?.style?.underline,
    });
  });
}

// Initialize built-in placeholders
initializeBuiltinPlaceholders();
