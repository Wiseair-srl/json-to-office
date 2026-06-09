import { describe, it, expect } from 'vitest';
import { diffWords, stripMarkdown, tokenizeWords } from '../word-diff';

describe('tokenizeWords', () => {
  it('splits into alternating words and whitespace', () => {
    expect(tokenizeWords('The  fee is')).toEqual([
      'The',
      '  ',
      'fee',
      ' ',
      'is',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizeWords('')).toEqual([]);
  });
});

describe('diffWords', () => {
  it('returns a single equal segment for identical text', () => {
    expect(diffWords('same text', 'same text')).toEqual([
      { type: 'equal', text: 'same text' },
    ]);
  });

  it('returns empty for two empty strings', () => {
    expect(diffWords('', '')).toEqual([]);
  });

  it('marks everything inserted when old is empty', () => {
    expect(diffWords('', 'brand new')).toEqual([
      { type: 'insert', text: 'brand new' },
    ]);
  });

  it('marks everything deleted when new is empty', () => {
    expect(diffWords('all gone', '')).toEqual([
      { type: 'delete', text: 'all gone' },
    ]);
  });

  it('diffs a single word replacement', () => {
    const segments = diffWords(
      'The fee is 10% of revenue.',
      'The fee is 12% of revenue.'
    );
    expect(segments).toEqual([
      { type: 'equal', text: 'The fee is ' },
      { type: 'delete', text: '10%' },
      { type: 'insert', text: '12%' },
      { type: 'equal', text: ' of revenue.' },
    ]);
  });

  it('handles word insertion mid-sentence', () => {
    const segments = diffWords('a b d', 'a b c d');
    expect(segments).toEqual([
      { type: 'equal', text: 'a b ' },
      { type: 'insert', text: 'c ' },
      { type: 'equal', text: 'd' },
    ]);
  });

  it('handles word removal mid-sentence', () => {
    const segments = diffWords('a b c d', 'a b d');
    const reconstructedOld = segments
      .filter((s) => s.type !== 'insert')
      .map((s) => s.text)
      .join('');
    const reconstructedNew = segments
      .filter((s) => s.type !== 'delete')
      .map((s) => s.text)
      .join('');
    expect(reconstructedOld).toBe('a b c d');
    expect(reconstructedNew).toBe('a b d');
  });

  it('reconstructs old and new text from any diff (invariant)', () => {
    const cases: [string, string][] = [
      ['the quick brown fox', 'the slow brown fox jumps'],
      ['one two three', 'four five six'],
      ['  leading space', 'leading space  '],
      ['multi\nline\ntext', 'multi\nline edited\ntext'],
    ];
    for (const [oldText, newText] of cases) {
      const segments = diffWords(oldText, newText);
      const oldRecon = segments
        .filter((s) => s.type !== 'insert')
        .map((s) => s.text)
        .join('');
      const newRecon = segments
        .filter((s) => s.type !== 'delete')
        .map((s) => s.text)
        .join('');
      expect(oldRecon).toBe(oldText);
      expect(newRecon).toBe(newText);
    }
  });

  it('merges adjacent segments of the same type', () => {
    const segments = diffWords('x y', 'a b');
    expect(segments).toEqual([
      { type: 'delete', text: 'x y' },
      { type: 'insert', text: 'a b' },
    ]);
  });
});

describe('stripMarkdown', () => {
  it('strips bold, italic and bold-italic markers', () => {
    expect(stripMarkdown('grew **32%** this *quarter*')).toBe(
      'grew 32% this quarter'
    );
    expect(stripMarkdown('***very*** important')).toBe('very important');
    expect(stripMarkdown('__bold__ and _italic_')).toBe('bold and italic');
  });

  it('replaces links with their text', () => {
    expect(stripMarkdown('see [the docs](https://example.com) here')).toBe(
      'see the docs here'
    );
  });

  it('leaves plain text untouched', () => {
    expect(stripMarkdown('no markers at all')).toBe('no markers at all');
  });

  it('matches textParser semantics for content containing * or _', () => {
    // Lazy [\s\S]*? content, exactly like the renderer's decorator regex
    expect(stripMarkdown('**snake_case**')).toBe('snake_case');
    expect(stripMarkdown('**a*b**')).toBe('a*b');
    expect(stripMarkdown('**bold _inner_ text**')).toBe('bold _inner_ text');
  });
});
