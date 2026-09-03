/**
 * Placeholder detection, shared by both formats.
 *
 * Two different states wear the same clothes. A **scaffold marker** is a
 * deliberate draft state: `jto_scaffold` writes one into every slot, so
 * validation reports it and generation refuses it. **Filler** is accidental —
 * lorem ipsum copied from a template, a "Your title here" left in from a
 * layout sketch — and only ever advises, because no tool put it there on
 * purpose and no tool can tell whether the author meant it.
 *
 * The vocabulary lives here rather than in either core so the marker an agent
 * is told to write is the marker both formats refuse to render.
 */

import { QUALITY_CODES, type QualityRuleFinding } from './types';

/** The marker shape `jto_scaffold` writes and `jto_generate` refuses. */
export const SCAFFOLD_MARKER_SYNTAX = '{{…}}';

export type PlaceholderKind = 'scaffold-marker' | 'filler';

export interface PlaceholderMatch {
  kind: PlaceholderKind;
  /** Stable id of the pattern that matched — evidence, and generated docs. */
  pattern: string;
  /** The matched text, capped so a diagnostic message stays readable. */
  excerpt: string;
}

const EXCERPT_MAX = 60;

interface Pattern {
  id: string;
  kind: PlaceholderKind;
  expression: RegExp;
}

/**
 * Ordered: the first match wins, and a scaffold marker outranks filler so a
 * half-filled slot is reported as the blocking state it is.
 *
 * Every expression is deliberately narrow. These run over every authored
 * string in a document, and a rule that flags real prose is a rule every
 * consumer learns to ignore — so "TBD" and "N/A", which authors write on
 * purpose, are absent, and a bracketed span only counts when it is the entire
 * string.
 */
const PATTERNS: readonly Pattern[] = [
  {
    id: 'scaffold-marker',
    kind: 'scaffold-marker',
    expression: /\{\{\s*[^{}\n]*?\S[^{}\n]*?\s*\}\}/,
  },
  { id: 'lorem-ipsum', kind: 'filler', expression: /lorem\s+ipsum/i },
  {
    id: 'your-x-here',
    kind: 'filler',
    expression: /\byour\b[^.!?\n]{0,40}?\bhere\b/i,
  },
  {
    id: 'goes-here',
    kind: 'filler',
    expression:
      /\b(?:goes\s+here|go\s+here|(?:text|title|subtitle|content|image|logo|caption|name)\s+here)\b/i,
  },
  {
    id: 'click-to-add',
    kind: 'filler',
    expression: /\bclick\s+to\s+(?:add|edit)\b/i,
  },
  {
    id: 'bracketed',
    kind: 'filler',
    expression: /^\[[^[\]\n]*[A-Za-z][^[\]\n]*\]$/,
  },
  {
    id: 'debris',
    kind: 'filler',
    expression:
      /^(?:todo|fixme|x{3,}|placeholder|sample\s+text|dummy\s+text|insert\s+text)$/i,
  },
];

function excerpt(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > EXCERPT_MAX
    ? `${collapsed.slice(0, EXCERPT_MAX - 1)}…`
    : collapsed;
}

/**
 * The first placeholder in `text`, or `undefined` when it reads as real
 * content. Whole-string patterns (`bracketed`, `debris`) match the trimmed
 * value; the rest may match anywhere, because a marker buried mid-sentence
 * ships just as visibly as one standing alone.
 */
export function detectPlaceholder(text: string): PlaceholderMatch | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  for (const pattern of PATTERNS) {
    const found = pattern.expression.exec(trimmed);
    if (found) {
      return {
        kind: pattern.kind,
        pattern: pattern.id,
        excerpt: excerpt(found[0]),
      };
    }
  }
  return undefined;
}

/** Every pattern id, in match order — the generated guidance reads this. */
export const PLACEHOLDER_PATTERN_IDS: readonly string[] = PATTERNS.map(
  (pattern) => pattern.id
);

export interface PlaceholderOccurrence {
  /** RFC 6901 pointer to the offending string, in the authored document. */
  path: string;
  text: string;
  match: PlaceholderMatch;
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Every placeholder in an authored document, in document order.
 *
 * The walk visits *every* string, not a list of text-bearing props. An
 * allowlist would be the tidier thing to write and the wrong thing to ship:
 * it drifts silently as components gain properties, and a marker it misses is
 * a marker `jto_generate` lets through. The patterns are narrow enough that a
 * colour, a font family or a file path never matches one.
 *
 * Disabled subtrees are skipped: a component with `enabled: false` never
 * reaches the page, so a marker inside one is not a defect.
 */
export function collectPlaceholders(
  document: unknown
): readonly PlaceholderOccurrence[] {
  const found: PlaceholderOccurrence[] = [];
  const visit = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      const match = detectPlaceholder(node);
      if (match) found.push({ path, text: node, match });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (record.enabled === false) return;
    for (const [key, value] of Object.entries(record)) {
      visit(value, `${path}/${pointerSegment(key)}`);
    }
  };
  visit(document, '');
  return found;
}

/**
 * The finding a placeholder produces, worded once for both formats.
 *
 * The two kinds differ in what the author is being told. A scaffold marker is
 * an unfinished slot and generation will refuse it, so the message says so; a
 * filler is a judgement call the author still owns, so it only points at the
 * text. Neither carries a fix: nothing but the author knows what the sentence
 * was meant to say.
 */
export function placeholderFinding(input: {
  path: string;
  kind: PlaceholderKind;
  pattern: string;
  excerpt: string;
}): QualityRuleFinding {
  const marker = input.kind === 'scaffold-marker';
  return {
    code: marker
      ? QUALITY_CODES.SCAFFOLD_MARKER
      : QUALITY_CODES.PLACEHOLDER_TEXT,
    severity: 'warning',
    category: 'integrity',
    certainty: 'deterministic',
    message: marker
      ? `Unfilled scaffold slot: "${input.excerpt}". Generation refuses a document that still carries a marker.`
      : `Placeholder text left in the document: "${input.excerpt}".`,
    path: input.path,
    suggestion: marker
      ? 'Patch the slot with real content, or remove the component that holds it.'
      : 'Replace it with the real content, or delete the component.',
    context: { kind: input.kind, pattern: input.pattern },
    evidence: { summary: input.excerpt },
  };
}
