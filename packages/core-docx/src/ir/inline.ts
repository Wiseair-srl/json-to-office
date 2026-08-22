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
 * Scope: decorators, line breaks, tabs and no-proof words. Hyperlinks,
 * cross-references, note markers and `{PLACEHOLDER}` fields are recognised only
 * so the compiler can refuse them explicitly rather than render them as
 * literal text — see `containsUnsupportedSyntax`.
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

/** Syntax this parser does not lower, each with the feature that would cover it. */
const UNSUPPORTED_SYNTAX: ReadonlyArray<{
  pattern: RegExp;
  what: string;
}> = [
  { pattern: /\[[^\]]*\]\([^)]*\)/, what: 'hyperlink' },
  { pattern: /\[@[^\]]+\]/, what: 'cross-reference' },
  { pattern: /\[\^[^\]]+\]/, what: 'note marker' },
  { pattern: /\{[^}]+\}/, what: 'field placeholder' },
];

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
   * Colour applied to a run only because a decorator made it bold.
   *
   * A separate colour for emphasised text is an authoring feature, so it is
   * resolved here rather than left for a renderer to infer from `bold`.
   */
  boldColor?: { hex: string };
  /** Words to mark `noProof`, each split into a run of its own. */
  noProofWords?: string[];
}

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
      if (tabIndex > 0) out.push({ kind: 'tab' });
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
