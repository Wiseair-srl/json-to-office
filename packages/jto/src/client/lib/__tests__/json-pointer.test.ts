import { describe, it, expect } from 'vitest';
import {
  decodePointerSegment,
  findPointerRange,
  pathArrayToPointer,
  pointerToPathArray,
} from '../json-pointer';

const doc = {
  name: 'docx',
  props: { title: 'Report' },
  children: [
    { name: 'heading', props: { text: 'Intro', level: 1 } },
    {
      name: 'section',
      children: [{ name: 'text', props: { text: 'Body', fontSize: 11 } }],
    },
  ],
  styles: { '0': { fontSize: 24 }, 'a/b': true, 'c~d': false },
};

const text = JSON.stringify(doc, null, 2);

/** The slice a resolved pointer covers, or null when it does not resolve. */
function slice(pointer: string, source = text): string | null {
  const range = findPointerRange(source, pointer);
  return range ? source.slice(range.start, range.end) : null;
}

describe('decodePointerSegment', () => {
  it('decodes ~1 to / and ~0 to ~', () => {
    expect(decodePointerSegment('a~1b')).toBe('a/b');
    expect(decodePointerSegment('c~0d')).toBe('c~d');
  });

  it('applies ~1 before ~0 so ~01 stays a literal ~1', () => {
    expect(decodePointerSegment('~01')).toBe('~1');
    expect(decodePointerSegment('~1')).toBe('/');
  });

  it('leaves unescaped text alone', () => {
    expect(decodePointerSegment('fontSize')).toBe('fontSize');
    expect(decodePointerSegment('')).toBe('');
  });
});

describe('pointerToPathArray', () => {
  it('maps the empty pointer to an empty path', () => {
    expect(pointerToPathArray('')).toEqual([]);
  });

  it('turns canonical integers into numbers', () => {
    expect(pointerToPathArray('/a/0/b')).toEqual(['a', 0, 'b']);
    expect(pointerToPathArray('/children/12/props/fontSize')).toEqual([
      'children',
      12,
      'props',
      'fontSize',
    ]);
  });

  it('keeps non-canonical numerics as strings', () => {
    expect(pointerToPathArray('/01/-1/1.5')).toEqual(['01', '-1', '1.5']);
  });

  it('decodes escapes inside segments', () => {
    expect(pointerToPathArray('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('preserves empty segments', () => {
    expect(pointerToPathArray('/')).toEqual(['']);
    expect(pointerToPathArray('/a//b')).toEqual(['a', '', 'b']);
  });
});

describe('pathArrayToPointer', () => {
  it('maps the empty path to the empty pointer', () => {
    expect(pathArrayToPointer([])).toBe('');
  });

  it('re-escapes ~ and /', () => {
    expect(pathArrayToPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
  });

  it('round-trips with pointerToPathArray', () => {
    const path = ['a/b', 'c~d', '~1', 'plain', 3, ''];
    expect(pointerToPathArray(pathArrayToPointer(path))).toEqual(path);
  });

  it('round-trips pointers back to themselves', () => {
    for (const pointer of [
      '',
      '/children/0/props/text',
      '/a~1b/c~0d',
      '/a//b',
    ]) {
      expect(pathArrayToPointer(pointerToPathArray(pointer))).toBe(pointer);
    }
  });
});

describe('findPointerRange', () => {
  it('addresses the whole document with the empty pointer', () => {
    expect(slice('')).toBe(text);
  });

  it('resolves nested objects and arrays to their value slice', () => {
    expect(slice('/name')).toBe('"docx"');
    expect(slice('/props/title')).toBe('"Report"');
    expect(slice('/children/0/props/level')).toBe('1');
    expect(slice('/children/1/children/0/props/text')).toBe('"Body"');
    expect(JSON.parse(slice('/children/0/props') as string)).toEqual({
      text: 'Intro',
      level: 1,
    });
    expect(JSON.parse(slice('/children/1') as string)).toEqual(doc.children[1]);
  });

  it('returns offsets that slice the value out of the source text', () => {
    const flat = '{"a":{"b":[10,{"c":"hi"}]}}';
    expect(findPointerRange(flat, '/a/b/1/c')).toEqual({
      start: flat.indexOf('"hi"'),
      end: flat.indexOf('"hi"') + 4,
    });
    expect(findPointerRange(flat, '/a/b/1')).toEqual({
      start: flat.indexOf('{"c"'),
      end: flat.indexOf('{"c"') + '{"c":"hi"}'.length,
    });
    expect(slice('/a/b/0', flat)).toBe('10');
  });

  it('resolves numeric object keys that look like array indices', () => {
    expect(slice('/styles/0/fontSize')).toBe('24');
  });

  it('resolves escaped keys', () => {
    expect(slice('/styles/a~1b')).toBe('true');
    expect(slice('/styles/c~0d')).toBe('false');
  });

  it('returns null for pointers that do not resolve', () => {
    expect(findPointerRange(text, '/nope')).toBeNull();
    expect(findPointerRange(text, '/children/9')).toBeNull();
    expect(findPointerRange(text, '/children/0/props/text/deeper')).toBeNull();
    expect(findPointerRange(text, '/props/0')).toBeNull();
  });

  it('returns null instead of throwing on malformed or truncated JSON', () => {
    const truncated = '{"children": [{"name": "text", "props": {';
    expect(() =>
      findPointerRange(truncated, '/children/0/props/text')
    ).not.toThrow();
    expect(findPointerRange(truncated, '/children/0/props/text')).toBeNull();
    expect(findPointerRange('not json at all', '/children/0')).toBeNull();
    expect(findPointerRange('', '')).toBeNull();
    expect(findPointerRange('   ', '/a')).toBeNull();
  });

  it('still resolves the intact prefix of a mid-edit document', () => {
    const midEdit = '{"children": [{"name": "text"}, {"name": ';
    expect(slice('/children/0/name', midEdit)).toBe('"text"');
    expect(findPointerRange(midEdit, '/children/1/name')).toBeNull();
  });

  it('keeps offsets correct across collapsed-string sentinels', () => {
    const withSentinel = JSON.stringify(
      { children: [{ props: { src: '§jtoc:7§' } }], tail: 'end' },
      null,
      2
    );
    expect(slice('/children/0/props/src', withSentinel)).toBe('"§jtoc:7§"');
    expect(slice('/tail', withSentinel)).toBe('"end"');
  });
});
