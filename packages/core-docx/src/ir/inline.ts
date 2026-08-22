/**
 * The inline text mini-language, parsed into IR nodes.
 *
 * Authoring writes `**bold**`, `\n`, `\t` and friends inside a single string.
 * By the time DocxIR exists none of that is markup any more: it is text runs,
 * line breaks and tab runs, each carrying resolved formatting.
 *
 * This is deliberately a separate module from `compiler.ts`. The mini-language
 * is the one piece of DOCX authoring with its own grammar, and it is where the
 * subtle rules live — a decorator pair may straddle a newline, a tab has to
 * become a real tab run because a tab character inside `<w:t>` is dropped, and
 * a no-proof word has to be its own run so the flag can sit on it alone.
 *
 * Scope: decorators, line breaks, tabs, no-proof words, `[text](target)` links
 * and `{PLACEHOLDER}` tokens. Cross-references and note markers are recognised
 * only so the compiler can refuse them explicitly rather than render them as
 * the literal characters an author wrote as markup — see
 * `containsUnsupportedSyntax`.
 */

import { normalizeUnicodeText } from '../utils/unicode';
import { buildNoProofWordsRegex } from '../utils/textParser';
import type { DocxIrInline, DocxIrRunFormatting } from './types';

/**
 * Decorator pairs, longest first so `***` wins over `**` and `*`.
 *
 * `[\s\S]` rather than `.` because a decorated span may cross a newline; the
 * line break inside it still has to break the line.
 */
const DECORATOR =
  /(\*\*\*|___)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5/g;

/** Markdown link syntax: `[text](target)`. */
const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Decorators and `{PLACEHOLDER}` in one pass.
 *
 * They cannot be parsed separately: a placeholder may sit inside a decorated
 * span, and a decorated span may sit between two placeholders.
 */
const DECORATOR_OR_PLACEHOLDER =
  /(\*\*\*|___)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5|\{([^}]+)\}/g;

/** `{NAME}`, the placeholder syntax. */
const PLACEHOLDER = /\{([^}]+)\}/;

/** Syntax this parser does not lower, each with the feature that would cover it. */
const UNSUPPORTED_SYNTAX: ReadonlyArray<{
  pattern: RegExp;
  what: string;
}> = [];

/** `[@id]` or `[@id:format]`, the cross-reference syntax. */
const CROSS_REFERENCE =
  /\[@([^\]\s:]+)(?::(relative|no_context|full_context|none))?\]/;

/**
 * One pass over both bracket syntaxes.
 *
 * Parsing them separately would mean re-scanning the segments between one kind
 * of token for the other kind, while the plain text between them still has to
 * reach the decorator parser.
 */
const INLINE_TOKEN = new RegExp(
  `${LINK.source}|${CROSS_REFERENCE.source}`,
  'g'
);

/** `[^id]`, the note marker syntax. */
const NOTE_MARKER = /\[\^([^\]\s]+)\]/g;

/** True when the text carries a `{PLACEHOLDER}` token. */
export function containsPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/** True when the text carries a `[@id]` cross-reference. */
export function containsCrossReference(text: string): boolean {
  return new RegExp(CROSS_REFERENCE.source).test(text);
}

/** True when the text carries a `[text](target)` link. */
export function containsLink(text: string): boolean {
  return new RegExp(LINK.source).test(text);
}

/**
 * Name the first piece of syntax in `text` this parser cannot lower.
 *
 * The compiler calls this before parsing so an unsupported construct is
 * reported rather than silently rendered as the literal characters an author
 * wrote as markup.
 */
export function containsUnsupportedSyntax(text: string): string | undefined {
  for (const { pattern, what } of UNSUPPORTED_SYNTAX) {
    if (pattern.test(text)) return what;
  }
  return undefined;
}

export interface ParseInlineOptions {
  /** Formatting every run starts from. */
  base: DocxIrRunFormatting;
  /**
   * Lower `[text](target)` into hyperlink nodes.
   *
   * Off by default: a component that does not accept links renders the
   * brackets as the literal characters the author typed, which is what the
   * pipeline has always done.
   */
  hyperlinks?: boolean;
  /**
   * Colour applied to a run only because a decorator made it bold.
   *
   * A separate colour for emphasised text is an authoring feature, so it is
   * resolved here rather than left for a renderer to infer from `bold`.
   */
  boldColor?: { hex: string };
  /** Words to mark `noProof`, each split into a run of its own. */
  noProofWords?: string[];
  /**
   * Resolve a `{NAME}` token. Returning nothing leaves it as literal text.
   *
   * A placeholder's meaning is document state — the generation date, the page
   * being drawn — so the compiler supplies it rather than this module knowing
   * any of it.
   */
  resolvePlaceholder?: (name: string) => PlaceholderResolution | undefined;
  /**
   * Resolve a `[^id]` marker to a note. Returning nothing leaves it literal.
   *
   * Resolution happens at the leaf, after decorators: a marker inside
   * `**bold[^n]**` keeps the surrounding emphasis, which splitting earlier
   * would break by cutting the `**` pair across segments.
   */
  resolveNote?: (
    id: string
  ) => { id: number; noteKind: 'footnote' | 'endnote' } | undefined;
  /**
   * Resolve a `[@id]` token to a field, or to nothing to leave it literal.
   *
   * The target may appear later in the document, so only a pre-pass over the
   * whole outline can answer this — which is why the compiler supplies it.
   */
  resolveCrossReference?: (
    id: string,
    format: CrossReferenceFormat,
    token: string
  ) => DocxIrInline | undefined;
}

/** The `\r`-style switches a `[@id:format]` token may ask for. */
export type CrossReferenceFormat =
  | 'relative'
  | 'no_context'
  | 'full_context'
  | 'none';

/**
 * Parse authored text into inline IR nodes.
 *
 * The shape of the output mirrors what the format needs rather than what the
 * grammar looked like: a decorated span becomes runs with `bold`/`italic` set,
 * a `\n` becomes a `lineBreak` node, a `\t` becomes a `tab` node.
 */
export function parseInline(
  text: string,
  options: ParseInlineOptions
): DocxIrInline[] {
  const normalized = normalizeUnicodeText(text);
  if (!normalized) {
    return [
      { kind: 'text', text: '', formatting: emptyToUndefined(options.base) },
    ];
  }
  // A placeholder-bearing text takes its own parser, which is also where
  // decorators are handled for it — links and note markers never reach it,
  // exactly as in the pre-IR writer.
  if (containsPlaceholder(normalized)) {
    return parsePlaceholders(normalized, options);
  }
  if (options.hyperlinks) return parseLinks(normalized, options);
  return parseDecorated(normalized, options);
}

/**
 * A placeholder resolved to something concrete.
 *
 * `field` is a live field Word recomputes (a page number); `text` is resolved
 * once, at generation time (a date). An unknown name resolves to nothing and
 * the token stays as the characters the author typed.
 */
export type PlaceholderResolution =
  | { kind: 'field'; instruction: string }
  | { kind: 'text'; text: string };

/**
 * Split on decorators and placeholders together.
 *
 * A decorated span is re-parsed rather than emitted directly, because it may
 * contain a placeholder of its own; the emphasis it applies is folded into the
 * base style for that pass.
 */
function parsePlaceholders(
  normalized: string,
  parseOptions: ParseInlineOptions
): DocxIrInline[] {
  // Two things the placeholder path has never done, reproduced rather than
  // tidied: it does not consult a separate colour for emphasised text, so a
  // bold span alongside a placeholder keeps the paragraph's colour; and it does
  // not recognise `[^id]` markers, so one written alongside a placeholder stays
  // as the characters the author typed. The note binding reports that.
  const options: ParseInlineOptions = {
    ...parseOptions,
    boldColor: undefined,
    resolveNote: undefined,
  };
  const out: DocxIrInline[] = [];
  const token = new RegExp(DECORATOR_OR_PLACEHOLDER.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const literal = (text: string, base = options.base): void => {
    if (!text) return;
    out.push(...parseLiteralLines(text, { ...options, base }));
  };

  while ((match = token.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      literal(normalized.slice(lastIndex, match.index));
    }
    lastIndex = match.index + match[0].length;

    if (match[7]) {
      const resolved = options.resolvePlaceholder?.(match[7]);
      if (!resolved) {
        // Unknown name: the token stays as written.
        literal(match[0]);
      } else if (resolved.kind === 'text') {
        literal(resolved.text);
      } else {
        // A field run carries only the character formatting a reader sees on
        // the number itself. Proofing language, scale and letter spacing are
        // properties of prose, and the pipeline has never put them on a field.
        const formatting = emptyToUndefined({
          fontFamily: options.base.fontFamily,
          sizeHalfPoints: options.base.sizeHalfPoints,
          color: options.base.color,
          bold: options.base.bold,
          italic: options.base.italic,
          underline: options.base.underline,
        });
        out.push({
          kind: 'field',
          instruction: resolved.instruction,
          ...(formatting ? { formatting } : {}),
        });
      }
      continue;
    }

    const style = decoratedStyle(match, options.base);
    out.push(
      ...parsePlaceholders(decoratedText(match), {
        ...options,
        base: { ...options.base, ...style },
        // No-proof words do not survive into a decorated span here: the
        // recursion has always been entered without them.
        noProofWords: undefined,
      })
    );
  }

  if (lastIndex < normalized.length) literal(normalized.slice(lastIndex));
  if (out.length === 0 && normalized) literal(normalized);
  return out;
}

/** Text split on newlines, tabs and no-proof words, with no other syntax. */
function parseLiteralLines(
  text: string,
  options: ParseInlineOptions
): DocxIrInline[] {
  const out: DocxIrInline[] = [];
  pushSegment(out, text, options);
  return out;
}

/**
 * Text with no mini-language at all.
 *
 * A heading with no decorators and no cross-reference is rendered character for
 * character: brackets stay brackets, and a newline stays inside the text rather
 * than breaking the line. Only no-proof words are still split out, because the
 * flag has to sit on exactly those runs.
 */
export function parseLiteral(
  text: string,
  options: ParseInlineOptions
): DocxIrInline[] {
  const out: DocxIrInline[] = [];
  pushWords(
    out,
    normalizeUnicodeText(text),
    emptyToUndefined(options.base),
    options
  );
  return out;
}

/**
 * Split on `[text](target)`, parsing each side for decorators.
 *
 * A link's own text is parsed the same way any other span is, so
 * `[**bold link**](url)` keeps its emphasis: the link wraps runs rather than
 * being one.
 */
function parseLinks(
  normalized: string,
  options: ParseInlineOptions
): DocxIrInline[] {
  const out: DocxIrInline[] = [];
  const token = new RegExp(INLINE_TOKEN.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      out.push(
        ...parseDecorated(normalized.slice(lastIndex, match.index), options)
      );
    }
    lastIndex = match.index + match[0].length;

    // Group 1 is the link's text; absent means the cross-reference branch of
    // the alternation matched.
    if (match[1] === undefined) {
      const resolved = options.resolveCrossReference?.(
        match[3],
        (match[4] as CrossReferenceFormat | undefined) ?? 'relative',
        match[0]
      );
      if (resolved) out.push(resolved);
      else out.push(...parseDecorated(match[0], options));
      continue;
    }

    const [, linkText, target] = match;
    out.push({
      kind: 'hyperlink',
      // A `#anchor` target names a bookmark in this document and needs no
      // relationship; anything else leaves the document.
      target: target.startsWith('#')
        ? { kind: 'bookmark', anchor: target.slice(1) }
        : { kind: 'external', url: target },
      children: parseDecorated(linkText, options),
    });
  }

  if (lastIndex < normalized.length) {
    out.push(...parseDecorated(normalized.slice(lastIndex), options));
  }

  if (out.length === 0) return parseDecorated(normalized, options);
  return out;
}

function parseDecorated(
  normalized: string,
  options: ParseInlineOptions
): DocxIrInline[] {
  const out: DocxIrInline[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const decorator = new RegExp(DECORATOR.source, 'g');

  while ((match = decorator.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      pushSegment(out, normalized.slice(lastIndex, match.index), options);
    }
    pushSegment(
      out,
      decoratedText(match),
      options,
      decoratedStyle(match, options.base)
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < normalized.length) {
    pushSegment(out, normalized.slice(lastIndex), options);
  }

  if (out.length === 0) pushSegment(out, normalized, options);
  return out;
}

function decoratedText(match: RegExpExecArray): string {
  if (match[1]) return match[2];
  if (match[3]) return match[4];
  if (match[5]) return match[6];
  return match[0];
}

/**
 * The formatting a decorator imposes.
 *
 * Both flags are stated, not just the one the decorator names: `**bold**` means
 * bold *and not italic*, so the run says so rather than inheriting whatever the
 * surrounding style had.
 */
function decoratedStyle(
  match: RegExpExecArray,
  base: DocxIrRunFormatting
): { bold: boolean; italic: boolean } {
  const bold = base.bold ?? false;
  const italic = base.italic ?? false;
  if (match[1]) return { bold: true, italic: true };
  if (match[3]) return { bold: true, italic };
  if (match[5]) return { bold, italic: true };
  return { bold, italic };
}

/**
 * Emit the nodes for one span of text sharing formatting.
 *
 * Splits on `\n` into lines and on `\t` within a line, then splits each
 * remaining piece around any no-proof word.
 */
function pushSegment(
  out: DocxIrInline[],
  text: string,
  options: ParseInlineOptions,
  override: { bold?: boolean; italic?: boolean } = {}
): void {
  const bold = override.bold ?? options.base.bold;
  const italic = override.italic ?? options.base.italic;
  const formatting = runFormatting(options, { bold, italic });

  const lines = text.split('\n');
  for (const [lineIndex, line] of lines.entries()) {
    // A blank line is only worth a node when a break precedes it: a blank line
    // in the middle of a paragraph is a visible gap, whereas an empty segment
    // — between two decorators, say — is nothing at all.
    if (!line && lineIndex === 0) continue;
    if (lineIndex > 0) out.push({ kind: 'lineBreak' });
    if (!line) {
      out.push({ kind: 'text', text: '', formatting });
      continue;
    }

    const tabSegments = line.split('\t');
    for (const [tabIndex, segment] of tabSegments.entries()) {
      if (tabIndex > 0) out.push({ kind: 'tab', formatting });
      // An empty piece around a tab carries nothing; a line that is *only*
      // empty still needs its run so the break has somewhere to sit.
      if (!segment && tabSegments.length > 1) continue;
      pushWords(out, segment, formatting, options);
    }
  }
}

/**
 * Split around no-proof words so the flag sits on exactly those runs.
 *
 * A run already marked `noProof` has nothing to single out, so it stays whole.
 */
function pushWords(
  out: DocxIrInline[],
  text: string,
  formatting: DocxIrRunFormatting | undefined,
  options: ParseInlineOptions
): void {
  if (options.resolveNote) {
    splitNoteMarkers(out, text, formatting, options);
    return;
  }
  pushNoProofWords(out, text, formatting, options);
}

/**
 * Replace resolvable `[^id]` markers with note reference nodes.
 *
 * A marker whose id the resolver does not know stays literal; the resolver owns
 * that decision, and the warning that goes with it, so this never has to guess
 * whether `[^a-z]` was meant as syntax.
 */
function splitNoteMarkers(
  out: DocxIrInline[],
  text: string,
  formatting: DocxIrRunFormatting | undefined,
  options: ParseInlineOptions
): void {
  const regex = new RegExp(NOTE_MARKER.source, 'g');
  let lastIndex = 0;
  let pending = '';
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const note = options.resolveNote!(match[1]);
    if (note === undefined) {
      // Unresolved: the marker stays in the text stream verbatim.
      pending += text.slice(lastIndex, regex.lastIndex);
      lastIndex = regex.lastIndex;
      continue;
    }

    const before = pending + text.slice(lastIndex, match.index);
    pending = '';
    if (before) pushNoProofWords(out, before, formatting, options);
    out.push({
      kind: 'noteReference',
      noteKind: note.noteKind,
      id: note.id,
    });
    lastIndex = regex.lastIndex;
  }

  const rest = pending + text.slice(lastIndex);
  if (rest) pushNoProofWords(out, rest, formatting, options);
}

function pushNoProofWords(
  out: DocxIrInline[],
  text: string,
  formatting: DocxIrRunFormatting | undefined,
  options: ParseInlineOptions
): void {
  const wholeRunNoProof = options.base.noProof === true;
  const regex = wholeRunNoProof
    ? null
    : buildNoProofWordsRegex(options.noProofWords);

  if (!regex) {
    out.push({ kind: 'text', text, formatting });
    return;
  }

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({
        kind: 'text',
        text: text.slice(lastIndex, match.index),
        formatting,
      });
    }
    out.push({
      kind: 'text',
      text: match[0],
      formatting: { ...formatting, noProof: true },
    });
    lastIndex = match.index + match[0].length;
    if (regex.lastIndex === match.index) regex.lastIndex += 1;
  }
  if (lastIndex < text.length) {
    out.push({ kind: 'text', text: text.slice(lastIndex), formatting });
  }
}

/**
 * Formatting for one run.
 *
 * `boldColor` applies only where a decorator actually made the run bold, which
 * is why the colour is chosen here and not on the base style.
 */
function runFormatting(
  options: ParseInlineOptions,
  state: { bold?: boolean; italic?: boolean }
): DocxIrRunFormatting | undefined {
  const formatting: DocxIrRunFormatting = { ...options.base };
  if (state.bold !== undefined) formatting.bold = state.bold;
  if (state.italic !== undefined) formatting.italic = state.italic;
  if (state.bold && options.boldColor && options.base.color) {
    formatting.color = options.boldColor;
  }
  return emptyToUndefined(formatting);
}

function emptyToUndefined(
  formatting: DocxIrRunFormatting
): DocxIrRunFormatting | undefined {
  const entries = Object.entries(formatting).filter(
    ([, value]) => value !== undefined
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as DocxIrRunFormatting);
}
