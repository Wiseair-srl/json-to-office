import { describe, it, expect } from 'vitest';
import {
  mergeAiOutput,
  extractFragmentKeys,
  findKeyValueSpans,
  lineRangeSplice,
  similarity,
} from '../client/lib/apply-merge';

// ── Selection splice ───────────────────────────────────────────────────

describe('mergeAiOutput — selection splice', () => {
  it('splices unique match', () => {
    const doc = '{"a": 1, "b": 2}';
    const { modified } = mergeAiOutput(doc, '"b": 99', { selectedText: '"b": 2' });
    expect(modified).toBe('{"a": 1, "b": 99}');
  });

  it('disambiguates multiple matches with startLine', () => {
    const doc = 'AAA\nBBB\nAAA\nCCC';
    const { modified } = mergeAiOutput(doc, 'XXX', {
      selectedText: 'AAA',
      startLine: 3,
      endLine: 3,
    });
    // Should replace the second AAA (line 3), not the first
    expect(modified).toBe('AAA\nBBB\nXXX\nCCC');
  });

  it('falls back to line-range splice when indexOf fails', () => {
    const doc = 'line1\nline2\nline3\nline4';
    const { modified } = mergeAiOutput(doc, 'REPLACED', {
      selectedText: 'no-match',
      startLine: 2,
      endLine: 3,
    });
    expect(modified).toBe('line1\nREPLACED\nline4');
  });
});

// ── Fragment splice ────────────────────────────────────────────────────

describe('mergeAiOutput — fragment splice', () => {
  const doc = JSON.stringify(
    { title: 'Hello', text: 'old', fontSize: 12 },
    null,
    2
  );

  it('splices a single key', () => {
    const frag = '  "text": "new"';
    const { modified } = mergeAiOutput(doc, frag);
    const parsed = JSON.parse(modified);
    expect(parsed.text).toBe('new');
    expect(parsed.title).toBe('Hello');
    expect(parsed.fontSize).toBe(12);
  });

  it('splices multiple keys', () => {
    const frag = '  "text": "new",\n  "fontSize": 24';
    const { modified } = mergeAiOutput(doc, frag);
    const parsed = JSON.parse(modified);
    expect(parsed.text).toBe('new');
    expect(parsed.fontSize).toBe(24);
  });

  it('ignores key pattern inside a string value', () => {
    // "text" appears as a value in the description field, not as a key
    const docWithValueMatch = JSON.stringify(
      { description: 'the text is here', text: 'old' },
      null,
      2
    );
    const frag = '  "text": "new"';
    const { modified } = mergeAiOutput(docWithValueMatch, frag);
    const parsed = JSON.parse(modified);
    expect(parsed.text).toBe('new');
    expect(parsed.description).toBe('the text is here');
  });

  it('preserves trailing comma (middle property)', () => {
    const { modified } = mergeAiOutput(doc, '  "text": "updated"');
    // Result must be valid JSON
    expect(() => JSON.parse(modified)).not.toThrow();
    expect(JSON.parse(modified).text).toBe('updated');
  });

  it('preserves trailing comma (last property)', () => {
    const { modified } = mergeAiOutput(doc, '  "fontSize": 48');
    expect(() => JSON.parse(modified)).not.toThrow();
    expect(JSON.parse(modified).fontSize).toBe(48);
  });
});

// ── Fragment vs full-doc detection ─────────────────────────────────────

describe('mergeAiOutput — full-doc detection', () => {
  it('returns full replacement when root keys match', () => {
    const doc = JSON.stringify({ a: 1, b: 2 });
    const replacement = JSON.stringify({ a: 99, b: 88 });
    const { modified } = mergeAiOutput(doc, replacement);
    expect(modified).toBe(replacement);
  });

  it('treats as fragment when keys differ', () => {
    const doc = JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2);
    // Raw fragment (not wrapped in {}) so extractFragmentKeys picks it up
    const frag = '  "b": 99';
    const { modified } = mergeAiOutput(doc, frag);
    const parsed = JSON.parse(modified);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(99);
    expect(parsed.c).toBe(3);
  });
});

// ── extractFragmentKeys ────────────────────────────────────────────────

describe('extractFragmentKeys', () => {
  it('extracts keys at base indent', () => {
    const frag = '  "a": 1,\n  "b": 2';
    expect(extractFragmentKeys(frag)).toEqual(['a', 'b']);
  });

  it('skips deeper-indented keys', () => {
    const frag = '  "a": {\n    "nested": 1\n  }';
    expect(extractFragmentKeys(frag)).toEqual(['a']);
  });

  it('skips shallower-indented keys (mixed indentation)', () => {
    const frag = '    "a": 1,\n  "b": 2,\n    "c": 3';
    // baseIndent = 4 (first content line), so "b" at indent 2 is excluded
    expect(extractFragmentKeys(frag)).toEqual(['a', 'c']);
  });

  it('handles blank leading lines', () => {
    const frag = '\n\n  "x": 42';
    expect(extractFragmentKeys(frag)).toEqual(['x']);
  });
});

// ── findKeyValueSpans ──────────────────────────────────────────────────

describe('findKeyValueSpans', () => {
  it('finds key-value span', () => {
    const text = '{"name": "hello", "age": 5}';
    const spans = findKeyValueSpans(text, '"name"');
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe('"name": "hello"');
  });

  it('excludes trailing comma from span', () => {
    const text = '{\n  "a": 1,\n  "b": 2\n}';
    const spans = findKeyValueSpans(text, '"a"');
    expect(spans).toHaveLength(1);
    const sliced = text.slice(spans[0].start, spans[0].end);
    expect(sliced).toBe('"a": 1');
    expect(sliced).not.toContain(',');
  });

  it('skips key pattern inside string values', () => {
    const text = '{"label": "the text is here", "text": "real"}';
    const spans = findKeyValueSpans(text, '"text"');
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe('"text": "real"');
  });
});

// ── lineRangeSplice ────────────────────────────────────────────────────

describe('lineRangeSplice', () => {
  const doc = 'L1\nL2\nL3\nL4';

  it('replaces a range in the middle', () => {
    const result = lineRangeSplice(doc, 'NEW', 2, 3);
    expect(result).not.toBeNull();
    expect(result!.modified).toBe('L1\nNEW\nL4');
  });

  it('replaces from startLine=1', () => {
    const result = lineRangeSplice(doc, 'NEW', 1, 2);
    expect(result).not.toBeNull();
    expect(result!.modified).toBe('NEW\nL3\nL4');
  });

  it('handles endLine > total lines', () => {
    const result = lineRangeSplice(doc, 'NEW', 3, 99);
    expect(result).not.toBeNull();
    expect(result!.modified).toBe('L1\nL2\nNEW');
  });

  it('returns null for invalid startLine', () => {
    expect(lineRangeSplice(doc, 'X', 0, 2)).toBeNull();
    expect(lineRangeSplice(doc, 'X', 5, 6)).toBeNull();
  });
});

// ── similarity ─────────────────────────────────────────────────────────

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(similarity('hello', 'hello')).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(similarity('', 'abc')).toBe(0);
    expect(similarity('abc', '')).toBe(0);
  });

  it('returns partial score for similar strings', () => {
    const score = similarity('"text": "hello"', '"text": "world"');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('handles short strings (< 3 chars)', () => {
    expect(similarity('ab', 'ab')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
  });
});

// ── Named-object splice ─────────────────────────────────────────────────

describe('mergeAiOutput — named-object splice', () => {
  const doc = JSON.stringify(
    {
      name: 'pptx',
      props: {
        templates: [
          { name: 'COVER', background: { color: 'red' }, objects: [] },
          { name: 'CLOSING', background: { color: 'blue' }, objects: [] },
        ],
      },
    },
    null,
    2
  );

  it('replaces only the matching named object', () => {
    const aiOutput = JSON.stringify(
      { name: 'COVER', background: { color: 'green' }, objects: [{ type: 'text' }] },
      null,
      2
    );
    const { modified } = mergeAiOutput(doc, aiOutput);
    const parsed = JSON.parse(modified);
    expect(parsed.props.templates[0].background.color).toBe('green');
    expect(parsed.props.templates[0].objects).toEqual([{ type: 'text' }]);
    // CLOSING should be untouched
    expect(parsed.props.templates[1].background.color).toBe('blue');
  });

  it('replaces second named object without affecting first', () => {
    const aiOutput = JSON.stringify(
      { name: 'CLOSING', background: { color: 'purple' }, objects: [] },
      null,
      2
    );
    const { modified } = mergeAiOutput(doc, aiOutput);
    const parsed = JSON.parse(modified);
    expect(parsed.props.templates[1].background.color).toBe('purple');
    // COVER should be untouched
    expect(parsed.props.templates[0].background.color).toBe('red');
  });

  it('falls through when name not found in doc', () => {
    const aiOutput = JSON.stringify({ name: 'NONEXISTENT', x: 1 }, null, 2);
    const { modified } = mergeAiOutput(doc, aiOutput);
    // Should fall through to other strategies (full-doc replacement as last resort)
    expect(modified).toBe(aiOutput);
  });

  it('falls through when doc is not valid JSON', () => {
    const badDoc = '{ not valid json';
    const aiOutput = JSON.stringify({ name: 'COVER', x: 1 }, null, 2);
    const { modified } = mergeAiOutput(badDoc, aiOutput);
    expect(modified).toBe(aiOutput);
  });

  it('selection splice wins over named-object splice', () => {
    const aiOutput = JSON.stringify(
      { name: 'COVER', background: { color: 'green' }, objects: [] },
      null,
      2
    );
    const selectedText = '"color": "red"';
    const { modified } = mergeAiOutput(doc, aiOutput, { selectedText });
    // Selection splice should replace the selected text, not do a named splice
    expect(modified).toContain(aiOutput);
    expect(modified).not.toContain('"color": "red"');
  });

  it('falls through to full-doc when AI name matches only the root', () => {
    const aiOutput = JSON.stringify({ name: 'pptx', props: { templates: [] } }, null, 2);
    const { modified } = mergeAiOutput(doc, aiOutput);
    // 'pptx' only exists on the root (not inside any array), so named splice
    // can't find it → falls through to full-doc replacement
    expect(modified).toBe(aiOutput);
  });
});

// ── Full integration ───────────────────────────────────────────────────

describe('mergeAiOutput — integration', () => {
  it('no ctx → fragment splice → full replacement chain', () => {
    const doc = JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2);

    // Fragment splice (subset of keys)
    const frag = '  "b": 99';
    const r1 = mergeAiOutput(doc, frag);
    expect(JSON.parse(r1.modified).b).toBe(99);
    expect(JSON.parse(r1.modified).a).toBe(1);

    // Full replacement (same keys)
    const full = JSON.stringify({ a: 10, b: 20, c: 30 });
    const r2 = mergeAiOutput(doc, full);
    expect(r2.modified).toBe(full);
  });
});
