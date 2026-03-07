import { TextRun, ExternalHyperlink, InternalHyperlink } from 'docx';
import {
  processTextWithPlaceholders,
  PlaceholderContext,
} from './placeholderProcessor';
import { normalizeUnicodeText } from './unicode';

export interface TextStyle {
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italics?: boolean;
  underline?: {
    type?:
      | 'single'
      | 'double'
      | 'thick'
      | 'dotted'
      | 'dash'
      | 'dotDash'
      | 'dotDotDash'
      | 'wave'
      | 'none'
      | 'words'
      | 'dottedHeavy'
      | 'dashedHeavy'
      | 'dashLong'
      | 'dashLongHeavy'
      | 'dashDotHeavy'
      | 'dashDotDotHeavy'
      | 'wavyHeavy'
      | 'wavyDouble';
    color?: string;
  }; // docx library expects an object or undefined, not boolean
}

export interface TextDecoratorOptions {
  boldColor?: string;
  placeholderContext?: PlaceholderContext;
  enableHyperlinks?: boolean;
}

/**
 * Parses text with inline markdown-style decorators, placeholders, and newlines, returning an array of TextRun objects
 * Supports:
 * - **bold** or __bold__
 * - *italic* or _italic_
 * - ***bold italic*** or ___bold italic___
 * - \n for line breaks
 * - {PLACEHOLDER} for dynamic content
 * - [link text](url) for hyperlinks (when enableHyperlinks is true)
 *
 * @param text The text to parse
 * @param baseStyle The base style to apply to all text runs
 * @param options Additional options for text decoration
 * @returns Array of TextRun and hyperlink objects with appropriate styling
 */
export function parseTextWithDecorators(
  text: string,
  baseStyle: TextStyle = {},
  options: TextDecoratorOptions = {}
): (TextRun | ExternalHyperlink | InternalHyperlink)[] {
  // Guard against undefined or null text
  if (!text) {
    return [new TextRun({ text: '', ...baseStyle })];
  }
  const normalizedText = normalizeUnicodeText(text);

  // Check if text contains placeholders
  const hasPlaceholders = /\{[^}]+\}/.test(normalizedText);

  if (hasPlaceholders) {
    // Use new placeholder processor that handles both decorators and placeholders
    return processTextWithPlaceholders(
      normalizedText,
      baseStyle,
      options.placeholderContext || {}
    );
  }

  // Process hyperlinks first if enabled
  if (options.enableHyperlinks) {
    return parseTextWithHyperlinks(normalizedText, baseStyle, options);
  }

  // Original decorator-only processing
  const runs: (TextRun | ExternalHyperlink | InternalHyperlink)[] = [];

  // Process decorators on the entire text first (including newlines)
  const decoratorRegex =
    /(\*\*\*|___)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = decoratorRegex.exec(normalizedText)) !== null) {
    // Add any text before the match as plain text (handle newlines)
    if (match.index > lastIndex) {
      const plainText = normalizedText.substring(lastIndex, match.index);
      if (plainText) {
        runs.push(...createTextRunsWithNewlines(plainText, baseStyle, options));
      }
    }

    // Determine the style based on the decorator
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

    // Create decorated text runs with newlines
    const decoratedRuns = createTextRunsWithNewlines(
      decoratedText,
      baseStyle,
      options,
      {
        bold,
        italics,
      }
    );
    runs.push(...decoratedRuns);

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last match
  if (lastIndex < normalizedText.length) {
    const remainingText = normalizedText.substring(lastIndex);
    if (remainingText) {
      runs.push(
        ...createTextRunsWithNewlines(remainingText, baseStyle, options)
      );
    }
  }

  // If no decorators were found, return text runs with newlines
  if (runs.length === 0 && normalizedText) {
    runs.push(
      ...createTextRunsWithNewlines(normalizedText, baseStyle, options)
    );
  }

  return runs;
}

/**
 * Helper function to create TextRuns with newlines from text
 */
function createTextRunsWithNewlines(
  text: string,
  baseStyle: TextStyle,
  options: TextDecoratorOptions,
  overrideStyle?: { bold?: boolean; italics?: boolean }
): TextRun[] {
  const runs: TextRun[] = [];
  const lines = text.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const needsLineBreak = lineIndex > 0;

    if (line || needsLineBreak) {
      // Create run even for empty lines if they need a break
      const runStyle = {
        bold: overrideStyle?.bold ?? baseStyle.bold,
        italics: overrideStyle?.italics ?? baseStyle.italics,
      };

      runs.push(
        new TextRun({
          text: line,
          ...(baseStyle.font && { font: baseStyle.font }),
          ...(baseStyle.size && { size: baseStyle.size }),
          ...(baseStyle.color && {
            color:
              runStyle.bold && options.boldColor
                ? options.boldColor
                : baseStyle.color,
          }),
          ...(runStyle.bold !== undefined && { bold: runStyle.bold }),
          ...(runStyle.italics !== undefined && { italics: runStyle.italics }),
          ...(baseStyle.underline && { underline: baseStyle.underline }),
          ...(needsLineBreak && { break: 1 }),
        })
      );
    }
  }

  return runs;
}

/**
 * Parse text with hyperlinks and decorators
 * Supports markdown-style links: [link text](url)
 */
function parseTextWithHyperlinks(
  text: string,
  baseStyle: TextStyle = {},
  options: TextDecoratorOptions = {}
): (TextRun | ExternalHyperlink | InternalHyperlink)[] {
  const normalizedText = normalizeUnicodeText(text);
  const runs: (TextRun | ExternalHyperlink | InternalHyperlink)[] = [];

  // Regex to match markdown-style links: [text](url)
  // This regex handles nested brackets in the link text
  const hyperlinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = hyperlinkRegex.exec(normalizedText)) !== null) {
    // Add any text before the hyperlink
    if (match.index > lastIndex) {
      const plainText = normalizedText.substring(lastIndex, match.index);
      if (plainText) {
        // Recursively parse the plain text for decorators
        const plainRuns = parseTextWithDecorators(plainText, baseStyle, {
          ...options,
          enableHyperlinks: false, // Disable hyperlinks in recursive call
        });
        runs.push(...plainRuns);
      }
    }

    const linkText = match[1];
    const linkUrl = match[2];

    // Determine if this is an internal or external link
    const isInternal = linkUrl.startsWith('#');

    // Parse the link text for decorators (bold, italic, etc.)
    const linkTextRuns = parseTextWithDecorators(linkText, baseStyle, {
      ...options,
      enableHyperlinks: false, // Disable hyperlinks in recursive call
    });

    // Create the appropriate hyperlink type
    if (isInternal) {
      // Internal link (bookmark)
      const bookmarkId = linkUrl.substring(1); // Remove the # prefix
      runs.push(
        new InternalHyperlink({
          children: linkTextRuns as TextRun[], // Cast needed for docx types
          anchor: bookmarkId,
        })
      );
    } else {
      // External link
      runs.push(
        new ExternalHyperlink({
          children: linkTextRuns as TextRun[], // Cast needed for docx types
          link: linkUrl,
        })
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last hyperlink
  if (lastIndex < normalizedText.length) {
    const remainingText = normalizedText.substring(lastIndex);
    if (remainingText) {
      const remainingRuns = parseTextWithDecorators(remainingText, baseStyle, {
        ...options,
        enableHyperlinks: false, // Disable hyperlinks in recursive call
      });
      runs.push(...remainingRuns);
    }
  }

  // If no hyperlinks were found, fall back to regular decorator parsing
  if (runs.length === 0 && normalizedText) {
    return parseTextWithDecorators(normalizedText, baseStyle, {
      ...options,
      enableHyperlinks: false,
    });
  }

  return runs;
}
