import {
  TextRun,
  ExternalHyperlink,
  InternalHyperlink,
  FootnoteReferenceRun,
  Tab,
} from 'docx';
import {
  processTextWithPlaceholders,
  type PlaceholderChild,
  type PlaceholderContext,
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
  // Character width scaling in percent (w:w). 100 is normal.
  scale?: number;
  // Letter tracking (w:spacing) in twentieths of a point (signed).
  characterSpacing?: number;
  // Proofing language (BCP-47) for the run, e.g. { value: 'fr-FR' }
  language?: {
    value?: string;
    eastAsia?: string;
    bidirectional?: string;
  };
  // Disable spell/grammar checking for the run
  noProof?: boolean;
}

export interface TextDecoratorOptions {
  boldColor?: string;
  placeholderContext?: PlaceholderContext;
  enableHyperlinks?: boolean;
  /**
   * "Known words" allowlist: each whole-word, case-insensitive occurrence is
   * emitted as its own no-proof run so Word never flags it, while surrounding
   * text stays spell-checked.
   */
  noProofWords?: string[];
  /**
   * Resolve a `[^id]` footnote marker to its document-scoped footnote id, or
   * undefined to leave the marker as literal text.
   *
   * Passing a resolver is what turns `[^…]` into syntax at all: without one,
   * text that merely looks like a marker (a regex character class in a code
   * sample, say) is untouched.
   */
  footnoteRef?: (id: string) => number | undefined;
}

/**
 * Inline footnote marker: `[^id]`, where id has no whitespace or `]`.
 * Deliberately not global: a shared /g regex carries `lastIndex` between
 * `.test()` calls and would skip every other marker.
 */
const FOOTNOTE_MARKER_REGEX = /\[\^([^\]\s]+)\]/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a matcher for the known-words allowlist, or null when there's nothing
 * to match. Matches each word as a whole token (no letter/number directly
 * adjacent on either side) so "Wiseair" doesn't match inside "Wiseairy", while
 * internal punctuation like "json-to-office" is matched literally.
 */
export function buildNoProofWordsRegex(noProofWords?: string[]): RegExp | null {
  const words = (noProofWords || []).filter((w) => w && w.trim().length > 0);
  if (words.length === 0) return null;
  // Longest first so alternation prefers the most specific match.
  const escaped = words
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`,
    'giu'
  );
}

/**
 * Split a plain string into TextRuns, marking every known-word occurrence as a
 * no-proof run via `makeRun`. When there are no known words, returns a single
 * run for the whole text.
 */
export function splitByNoProofWords(
  text: string,
  makeRun: (segment: string, noProof: boolean) => TextRun,
  noProofWords?: string[]
): TextRun[] {
  const regex = buildNoProofWordsRegex(noProofWords);
  if (!regex || !text) return [makeRun(text, false)];

  const runs: TextRun[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(makeRun(text.slice(lastIndex, match.index), false));
    }
    runs.push(makeRun(match[0], true));
    lastIndex = match.index + match[0].length;
    // Guard against zero-length matches (shouldn't happen, but be safe).
    if (regex.lastIndex === match.index) regex.lastIndex++;
  }
  if (lastIndex < text.length) {
    runs.push(makeRun(text.slice(lastIndex), false));
  }
  return runs.length > 0 ? runs : [makeRun(text, false)];
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
): PlaceholderChild[] {
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
      options.placeholderContext || {},
      options.noProofWords
    );
  }

  // Process hyperlinks first if enabled
  if (options.enableHyperlinks) {
    return parseTextWithHyperlinks(normalizedText, baseStyle, options);
  }

  // Original decorator-only processing
  const runs: PlaceholderChild[] = [];

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
 * Run-level properties shared by every run produced for a piece of text.
 * Single assembly point for both the plain-text and placeholder paths — a
 * prop forwarded here reaches both, so the two cannot drift (issue #137).
 */
export function buildRunCommonProps(
  baseStyle: TextStyle,
  overrides?: { bold?: boolean; italics?: boolean; boldColor?: string }
) {
  const bold = overrides?.bold ?? baseStyle.bold;
  const italics = overrides?.italics ?? baseStyle.italics;
  return {
    ...(baseStyle.font && { font: baseStyle.font }),
    ...(baseStyle.size && { size: baseStyle.size }),
    ...(baseStyle.color && {
      color:
        bold && overrides?.boldColor ? overrides.boldColor : baseStyle.color,
    }),
    ...(bold !== undefined && { bold }),
    ...(italics !== undefined && { italics }),
    ...(baseStyle.underline && { underline: baseStyle.underline }),
    ...(baseStyle.scale && { scale: baseStyle.scale }),
    ...(baseStyle.characterSpacing && {
      characterSpacing: baseStyle.characterSpacing,
    }),
    ...(baseStyle.language && { language: baseStyle.language }),
  };
}

/**
 * Build the runs for a single line of text: split on `\t` into real
 * `<w:tab/>` runs (a tab char inside <w:t> would be silently dropped by
 * Word, and paragraph tabStops only apply to real tab runs), emit no-proof
 * word runs, and attach the line break to the first emitted run only.
 */
function buildLineRuns(
  line: string,
  commonProps: ReturnType<typeof buildRunCommonProps>,
  opts: { needsLineBreak: boolean; noProof?: boolean; noProofWords?: string[] }
): TextRun[] {
  const { needsLineBreak, noProof } = opts;
  // When the whole run is already no-proof, there's nothing to single out,
  // so skip word splitting and emit one run for the line.
  const wholeRunNoProof = noProof === true;
  const wordsForLine = wholeRunNoProof ? undefined : opts.noProofWords;

  // The line break belongs only on the first run of the line.
  let firstSegment = true;
  const lineRuns: TextRun[] = [];
  const tabSegments = line.split('\t');
  tabSegments.forEach((tabSegment, tabIndex) => {
    if (tabIndex > 0) {
      lineRuns.push(
        new TextRun({
          children: [new Tab()],
          ...commonProps,
          ...(needsLineBreak && firstSegment && { break: 1 }),
        })
      );
      firstSegment = false;
    }
    if (!tabSegment && tabSegments.length > 1) return;
    lineRuns.push(
      ...splitByNoProofWords(
        tabSegment,
        (segment, matched) => {
          const run = new TextRun({
            text: segment,
            ...commonProps,
            ...((matched || noProof !== undefined) && {
              noProof: matched || wholeRunNoProof,
            }),
            ...(needsLineBreak && firstSegment && { break: 1 }),
          });
          firstSegment = false;
          return run;
        },
        wordsForLine
      )
    );
  });
  return lineRuns;
}

/**
 * Turn multi-line text into TextRuns: `\n` becomes a run break, `\t` a real
 * tab run, no-proof words their own runs. Shared by the plain-text path
 * (textParser) and the placeholder path (placeholderProcessor) so run-level
 * properties cannot diverge between them.
 */
export function buildTextRuns(
  text: string,
  commonProps: ReturnType<typeof buildRunCommonProps>,
  opts: { noProof?: boolean; noProofWords?: string[] } = {}
): TextRun[] {
  const runs: TextRun[] = [];
  const lines = text.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const needsLineBreak = lineIndex > 0;

    // Create runs even for empty lines if they need a break
    if (line || needsLineBreak) {
      runs.push(
        ...buildLineRuns(line, commonProps, { needsLineBreak, ...opts })
      );
    }
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
): PlaceholderChild[] {
  const runs = (segment: string) =>
    buildTextRuns(
      segment,
      buildRunCommonProps(baseStyle, {
        bold: overrideStyle?.bold,
        italics: overrideStyle?.italics,
        boldColor: options.boldColor,
      }),
      { noProof: baseStyle.noProof, noProofWords: options.noProofWords }
    );

  if (!options.footnoteRef) return runs(text);
  return splitFootnoteMarkers(text, options.footnoteRef, runs);
}

/**
 * Replace resolvable `[^id]` markers with footnote reference runs, handing the
 * text between them to `runs`.
 *
 * This runs at the leaf, after decorators have been parsed, so a marker inside
 * `**bold[^n]**` keeps the surrounding emphasis — splitting earlier would break
 * the `**` pair across segments and silently drop the formatting.
 *
 * A marker whose id the resolver does not know stays literal; the resolver owns
 * that decision (and any warning), so this never has to guess whether `[^a-z]`
 * was meant as syntax.
 */
function splitFootnoteMarkers(
  text: string,
  footnoteRef: (id: string) => number | undefined,
  runs: (segment: string) => TextRun[]
): PlaceholderChild[] {
  const regex = new RegExp(FOOTNOTE_MARKER_REGEX.source, 'g');
  const out: PlaceholderChild[] = [];

  let lastIndex = 0;
  let pending = '';
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const noteId = footnoteRef(match[1]);
    if (noteId === undefined) {
      // Unresolved: keep the marker in the text stream verbatim.
      pending += text.slice(lastIndex, regex.lastIndex);
      lastIndex = regex.lastIndex;
      continue;
    }

    const before = pending + text.slice(lastIndex, match.index);
    pending = '';
    if (before) out.push(...runs(before));
    out.push(new FootnoteReferenceRun(noteId));
    lastIndex = regex.lastIndex;
  }

  if (out.length === 0) return runs(text);

  const trailing = pending + text.slice(lastIndex);
  if (trailing) out.push(...runs(trailing));
  return out;
}

/**
 * Parse text with hyperlinks and decorators
 * Supports markdown-style links: [link text](url)
 */
function parseTextWithHyperlinks(
  text: string,
  baseStyle: TextStyle = {},
  options: TextDecoratorOptions = {}
): PlaceholderChild[] {
  const normalizedText = normalizeUnicodeText(text);
  const runs: PlaceholderChild[] = [];

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
