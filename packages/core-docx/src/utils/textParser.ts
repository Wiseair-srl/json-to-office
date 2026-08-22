import {
  TextRun,
  ExternalHyperlink,
  InternalHyperlink,
  FootnoteReferenceRun,
  EndnoteReferenceRun,
  NumberedItemReference,
  NumberedItemReferenceFormat,
  Tab,
} from 'docx';
import {
  processTextWithPlaceholders,
  type PlaceholderChild,
  type PlaceholderContext,
} from './placeholderProcessor';
import { normalizeUnicodeText } from './unicode';
import { globalNumberedItemsRegistry } from './numberedItemsRegistry';

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
   * Resolve a `[^id]` note marker to its document-scoped id and kind, or
   * undefined to leave the marker as literal text.
   *
   * Passing a resolver is what turns `[^…]` into syntax at all: without one,
   * text that merely looks like a marker (a regex character class in a code
   * sample, say) is untouched.
   */
  noteRef?: (id: string) => { id: number; endnote: boolean } | undefined;
}

/**
 * Inline note marker: `[^id]`, where id has no whitespace or `]`.
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

  if (!options.noteRef) return runs(text);
  return splitNoteMarkers(text, options.noteRef, runs);
}

/**
 * Replace resolvable `[^id]` markers with footnote or endnote reference runs,
 * handing the text between them to `runs`.
 *
 * This runs at the leaf, after decorators have been parsed, so a marker inside
 * `**bold[^n]**` keeps the surrounding emphasis — splitting earlier would break
 * the `**` pair across segments and silently drop the formatting.
 *
 * A marker whose id the resolver does not know stays literal; the resolver owns
 * that decision (and any warning), so this never has to guess whether `[^a-z]`
 * was meant as syntax.
 */
function splitNoteMarkers(
  text: string,
  noteRef: (id: string) => { id: number; endnote: boolean } | undefined,
  runs: (segment: string) => TextRun[]
): PlaceholderChild[] {
  const regex = new RegExp(FOOTNOTE_MARKER_REGEX.source, 'g');
  const out: PlaceholderChild[] = [];

  let lastIndex = 0;
  let pending = '';
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const note = noteRef(match[1]);
    if (note === undefined) {
      // Unresolved: keep the marker in the text stream verbatim.
      pending += text.slice(lastIndex, regex.lastIndex);
      lastIndex = regex.lastIndex;
      continue;
    }

    const before = pending + text.slice(lastIndex, match.index);
    pending = '';
    if (before) out.push(...runs(before));
    out.push(
      note.endnote
        ? new EndnoteReferenceRun(note.id)
        : new FootnoteReferenceRun(note.id)
    );
    lastIndex = regex.lastIndex;
  }

  if (out.length === 0) return runs(text);

  const trailing = pending + text.slice(lastIndex);
  if (trailing) out.push(...runs(trailing));
  return out;
}

/**
 * Cross-reference to a numbered heading or list item: `[@id]`, optionally
 * `[@id:relative|no_context|full_context|none]`.
 *
 * The id accepts every character a bookmark id can actually hold, rather than
 * a narrower slug alphabet: `id` is a free string in the schema, so an author
 * who writes `item.1` on a list item must be able to reference it. Whitespace
 * ends the token (an unclosed `[@` cannot swallow a sentence) and `:` is
 * reserved as the format separator.
 *
 * No collision with `[text](url)`: that syntax needs a `(…)` immediately after
 * the bracket, and the alternation below tries it first anyway.
 */
const CROSS_REFERENCE_PATTERN =
  '\\[@([^\\]\\s:]+)(?::(relative|no_context|full_context|none))?\\]';

/** Markdown link syntax: `[text](target)`. */
const MARKDOWN_LINK_PATTERN = '\\[([^\\]]+)\\]\\(([^)]+)\\)';

/**
 * One pass over both bracket syntaxes: parsing them separately would mean
 * re-scanning the segments between one kind of token for the other kind, while
 * the plain text between them still has to reach `parseTextWithDecorators`.
 */
const INLINE_TOKEN_REGEX = `${MARKDOWN_LINK_PATTERN}|${CROSS_REFERENCE_PATTERN}`;

/**
 * True when the text carries a `[@id]` token. `createHeading` renders simple
 * headings through a run builder that never reaches this parser, so it needs to
 * know when a heading is not simple after all.
 */
export function hasCrossReference(text: string): boolean {
  return new RegExp(CROSS_REFERENCE_PATTERN).test(text);
}

/**
 * True when the text carries a markdown link to a target outside the document.
 *
 * An external link is the one construct here that costs the document a
 * relationship, which is document-scoped state a rendered component cannot
 * carry across documents — see `componentBypassReason` in
 * `core/cached-render.ts`. A `#anchor` target becomes an `InternalHyperlink`,
 * which references a bookmark directly and needs no relationship, so it is not
 * counted.
 */
export function hasExternalLink(text: string): boolean {
  const regex = new RegExp(MARKDOWN_LINK_PATTERN, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (!match[2].startsWith('#')) return true;
  }
  return false;
}

const REFERENCE_FORMATS = {
  relative: NumberedItemReferenceFormat.RELATIVE,
  no_context: NumberedItemReferenceFormat.NO_CONTEXT,
  full_context: NumberedItemReferenceFormat.FULL_CONTEXT,
  none: NumberedItemReferenceFormat.NONE,
} as const;

type ReferenceFormatKey = keyof typeof REFERENCE_FORMATS;

/**
 * Turn one `[@id]` token into a Word REF field.
 *
 * The cached value is what makes the reference readable outside Word: headless
 * LibreOffice — and therefore the PDF export path — never updates fields, so an
 * uncached REF exports blank. Word recomputes it on open (the document sets
 * `updateFields`), so an approximate cached value is corrected there.
 *
 * An unresolvable id renders as its literal token text rather than as a field:
 * a REF pointing at a bookmark that does not exist is exactly what makes Word
 * show "Error! Reference source not found".
 */
function createCrossReference(
  id: string,
  format: ReferenceFormatKey,
  token: string,
  baseStyle: TextStyle,
  options: TextDecoratorOptions
): PlaceholderChild[] {
  const info = globalNumberedItemsRegistry.get(id);

  if (!info) {
    // An unseeded registry means no render is in progress (a unit test calling
    // the text primitives directly), so nothing has had the chance to declare
    // the target and there is no authoring mistake to report.
    if (globalNumberedItemsRegistry.isSeeded()) {
      console.warn(
        `[core-docx] Cross-reference ${token} has no target: no heading or list item declares the id "${id}". Rendering the token as literal text.`
      );
    }
    return buildTextRuns(
      token,
      buildRunCommonProps(baseStyle, { boldColor: options.boldColor }),
      { noProof: baseStyle.noProof, noProofWords: options.noProofWords }
    );
  }

  if (format === 'none') {
    return [
      new NumberedItemReference(id, info.text, {
        hyperlink: true,
        referenceFormat: REFERENCE_FORMATS.none,
      }),
    ];
  }

  // `relative` caches the full number: Word resolves it against the reference's
  // own position in the numbering, which generation does not know.
  const cachedValue = format === 'no_context' ? info.own : info.full;
  if (cachedValue === undefined) {
    console.warn(
      `[core-docx] Cross-reference ${token} targets an unnumbered ${info.kind} ("${id}"), so the field carries no cached number and reads blank until the reader updates fields. Use [@${id}:none] to reference its text instead.`
    );
  }

  return [
    new NumberedItemReference(id, cachedValue, {
      hyperlink: true,
      referenceFormat: REFERENCE_FORMATS[format],
    }),
  ];
}

/**
 * Parse text with hyperlinks, cross-references and decorators
 * Supports markdown-style links `[text](url)` and cross-references `[@id]`
 */
function parseTextWithHyperlinks(
  text: string,
  baseStyle: TextStyle = {},
  options: TextDecoratorOptions = {}
): PlaceholderChild[] {
  const normalizedText = normalizeUnicodeText(text);
  const runs: PlaceholderChild[] = [];

  // Fresh instance per call: a shared /g regex carries `lastIndex` between
  // calls and would skip tokens.
  const tokenRegex = new RegExp(INLINE_TOKEN_REGEX, 'g');

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(normalizedText)) !== null) {
    // Add any text before the token
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

    lastIndex = match.index + match[0].length;

    // Group 1 is the hyperlink's text; absent means the cross-reference branch
    // of the alternation matched.
    if (match[1] === undefined) {
      runs.push(
        ...createCrossReference(
          match[3],
          (match[4] as ReferenceFormatKey | undefined) ?? 'relative',
          match[0],
          baseStyle,
          options
        )
      );
      continue;
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
  }

  // Add any remaining text after the last token
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

  // If no tokens were found, fall back to regular decorator parsing
  if (runs.length === 0 && normalizedText) {
    return parseTextWithDecorators(normalizedText, baseStyle, {
      ...options,
      enableHyperlinks: false,
    });
  }

  return runs;
}
