/**
 * RFC 6901 pointers and RFC 6902 patching, operation by operation.
 *
 * The store's atomicity guarantee is only worth as much as this layer's
 * refusal to half-apply anything, so the interesting cases here are the
 * failures: malformed indices, missing parents, and a syntactically broken
 * operation at the END of an otherwise valid patch.
 */

import { describe, it, expect } from 'vitest';

import {
  applyPatch,
  compilePatch,
  PATCH_ERROR_CODES,
} from '../workspace/json-patch.js';
import {
  cloneJson,
  formatPointer,
  jsonEqual,
  parsePointer,
  resolvePointer,
} from '../workspace/json-pointer.js';

const doc = (): Record<string, unknown> => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { text: 'One', level: 1 } },
    { name: 'paragraph', props: { text: 'Two' } },
  ],
});

function apply(operations: any[], document: unknown = doc()) {
  return applyPatch(document, operations);
}

function expectFailure(result: ReturnType<typeof apply>, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a failure');
  expect(result.problem.code).toBe(code);
  return result.problem;
}

describe('JSON Pointer (RFC 6901)', () => {
  it('parses the empty pointer as the whole document', () => {
    expect(parsePointer('')).toEqual({ ok: true, tokens: [] });
  });

  it('unescapes ~1 before ~0', () => {
    expect(parsePointer('/a~1b')).toEqual({ ok: true, tokens: ['a/b'] });
    expect(parsePointer('/a~0b')).toEqual({ ok: true, tokens: ['a~b'] });
    expect(parsePointer('/m~01')).toEqual({ ok: true, tokens: ['m~1'] });
  });

  it('keeps empty reference tokens', () => {
    expect(parsePointer('//')).toEqual({ ok: true, tokens: ['', ''] });
  });

  it('rejects a pointer that does not start with /', () => {
    const parsed = parsePointer('children/0');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected a parse failure');
    expect(parsed.message).toMatch(/must be empty .* or start with "\/"/);
  });

  it('rejects a dangling escape', () => {
    const parsed = parsePointer('/a~2b');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected a parse failure');
    expect(parsed.message).toMatch(/"~0" or "~1"/);
  });

  it('round-trips through formatPointer', () => {
    const pointer = '/a~1b/c~0d/0';
    const parsed = parsePointer(pointer);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(formatPointer(parsed.tokens)).toBe(pointer);
  });

  it('reports where a walk stopped', () => {
    const found = resolvePointer(doc(), ['children', '5', 'props']);
    expect(found).toEqual({ found: false, at: '/children/5' });
  });

  it('compares values structurally, ignoring member order', () => {
    expect(jsonEqual({ a: 1, b: [2, null] }, { b: [2, null], a: 1 })).toBe(
      true
    );
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });

  it('clones without sharing structure', () => {
    const source = { a: { b: [1] } };
    const copy = cloneJson(source);
    copy.a.b.push(2);
    expect(source.a.b).toEqual([1]);
  });
});

describe('add', () => {
  it('adds a member to an object', () => {
    const result = apply([
      { op: 'add', path: '/props/author', value: 'Wiseair' },
    ]);
    expect((result as any).document.props).toEqual({
      theme: 'minimal',
      author: 'Wiseair',
    });
  });

  it('inserts at an array index, shifting the rest right', () => {
    const result = apply([
      { op: 'add', path: '/children/1', value: { name: 'divider' } },
    ]);
    expect((result as any).document.children.map((c: any) => c.name)).toEqual([
      'heading',
      'divider',
      'paragraph',
    ]);
  });

  it('appends with "-"', () => {
    const result = apply([
      { op: 'add', path: '/children/-', value: { name: 'divider' } },
    ]);
    expect((result as any).document.children).toHaveLength(3);
    expect((result as any).document.children[2]).toEqual({ name: 'divider' });
  });

  it('accepts the index one past the end, and refuses two past', () => {
    expect(apply([{ op: 'add', path: '/children/2', value: {} }]).ok).toBe(
      true
    );
    const problem = expectFailure(
      apply([{ op: 'add', path: '/children/3', value: {} }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.message).toMatch(/past the end of a 2-element array/);
  });

  it('refuses a leading-zero index rather than treating it as decimal', () => {
    const problem = expectFailure(
      apply([{ op: 'add', path: '/children/01', value: {} }]),
      PATCH_ERROR_CODES.INVALID_POINTER
    );
    expect(problem.message).toMatch(/not an array index/);
  });

  it('does not create intermediate containers', () => {
    const problem = expectFailure(
      apply([{ op: 'add', path: '/props/metadata/title', value: 'x' }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.pointer).toBe('/props/metadata');
    expect(problem.suggestion).toMatch(/never creates intermediate/);
  });

  it('replaces the whole document at path ""', () => {
    const result = apply([{ op: 'add', path: '', value: { name: 'pptx' } }]);
    expect((result as any).document).toEqual({ name: 'pptx' });
  });

  it('stores __proto__ as an own member instead of poisoning the prototype', () => {
    const result = apply([
      { op: 'add', path: '/__proto__', value: { polluted: true } },
    ]);
    expect(result.ok).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        (result as any).document,
        '__proto__'
      )
    ).toBe(true);
  });

  it('does not alias the value it inserts', () => {
    const value = { text: 'shared' };
    const result = apply([
      { op: 'add', path: '/children/-', value },
      { op: 'add', path: '/children/-', value },
    ]);
    const children = (result as any).document.children;
    expect(children[2]).not.toBe(children[3]);
    value.text = 'mutated after the fact';
    expect(children[2].text).toBe('shared');
  });
});

describe('remove and replace', () => {
  it('removes an object member and an array element', () => {
    const result = apply([
      { op: 'remove', path: '/props/theme' },
      { op: 'remove', path: '/children/0' },
    ]);
    expect((result as any).document.props).toEqual({});
    expect((result as any).document.children).toHaveLength(1);
    expect((result as any).document.children[0].name).toBe('paragraph');
  });

  it('refuses to remove a member that is not there', () => {
    expectFailure(
      apply([{ op: 'remove', path: '/props/nope' }]),
      PATCH_ERROR_CODES.FAILED
    );
  });

  it('refuses to remove the document root', () => {
    const problem = expectFailure(
      apply([{ op: 'remove', path: '' }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.message).toMatch(/root cannot be removed/);
  });

  it('refuses "-" outside add', () => {
    const problem = expectFailure(
      apply([{ op: 'remove', path: '/children/-' }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.message).toMatch(/only valid for add/);
  });

  it('replaces an existing member but will not create one', () => {
    const ok = apply([
      { op: 'replace', path: '/props/theme', value: 'corporate' },
    ]);
    expect((ok as any).document.props.theme).toBe('corporate');

    const problem = expectFailure(
      apply([{ op: 'replace', path: '/props/author', value: 'x' }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.suggestion).toMatch(/Use add/);
  });
});

describe('move and copy', () => {
  it('reorders an array', () => {
    const result = apply([
      { op: 'move', from: '/children/0', path: '/children/1' },
    ]);
    expect((result as any).document.children.map((c: any) => c.name)).toEqual([
      'paragraph',
      'heading',
    ]);
  });

  it('refuses to move a location into its own child', () => {
    const problem = expectFailure(
      apply([{ op: 'move', from: '/props', path: '/props/inner' }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.message).toMatch(/into its own child/);
  });

  it('treats a move onto itself as a no-op', () => {
    const result = apply([
      { op: 'move', from: '/children/0', path: '/children/0' },
    ]);
    expect(result.ok).toBe(true);
    expect((result as any).document.children[0].name).toBe('heading');
  });

  it('copies a detached value', () => {
    const result = apply([
      { op: 'copy', from: '/children/0', path: '/children/-' },
      { op: 'replace', path: '/children/0/props/text', value: 'changed' },
    ]);
    const children = (result as any).document.children;
    expect(children[0].props.text).toBe('changed');
    expect(children[2].props.text).toBe('One');
  });

  it('reports a source that does not exist', () => {
    const problem = expectFailure(
      apply([{ op: 'copy', from: '/children/9', path: '/children/-' }]),
      PATCH_ERROR_CODES.FAILED
    );
    expect(problem.pointer).toBe('/children/9');
  });
});

describe('test', () => {
  it('passes on a structural match', () => {
    expect(
      apply([{ op: 'test', path: '/props', value: { theme: 'minimal' } }]).ok
    ).toBe(true);
  });

  it('fails with both sides in the diagnostic', () => {
    const problem = expectFailure(
      apply([{ op: 'test', path: '/props/theme', value: 'corporate' }]),
      PATCH_ERROR_CODES.TEST_FAILED
    );
    expect(problem.message).toMatch(/expected "corporate" but found "minimal"/);
    expect(problem.context).toMatchObject({ reason: 'mismatch' });
  });

  it('fails when the location is absent', () => {
    const problem = expectFailure(
      apply([{ op: 'test', path: '/props/author', value: 'x' }]),
      PATCH_ERROR_CODES.TEST_FAILED
    );
    expect(problem.context).toMatchObject({ reason: 'missing' });
  });
});

describe('syntax is checked before anything is applied', () => {
  it('rejects an unknown operation', () => {
    const problem = expectFailure(
      apply([{ op: 'increment', path: '/props/theme', value: 1 }]),
      PATCH_ERROR_CODES.SYNTAX
    );
    expect(problem.suggestion).toMatch(
      /add, remove, replace, move, copy, test/
    );
  });

  it.each([
    [{ op: 'add', path: '/props/x' }, 'value'],
    [{ op: 'move', path: '/props/x' }, 'from'],
    [{ op: 'add', value: 1 }, 'path'],
  ])('rejects %j for its missing member', (operation, member) => {
    const problem = expectFailure(
      apply([operation as any]),
      PATCH_ERROR_CODES.SYNTAX
    );
    expect(problem.message).toContain(member);
  });

  it('leaves the document untouched when a later operation is malformed', () => {
    const document = doc();
    const before = JSON.stringify(document);
    const problem = expectFailure(
      apply(
        [
          { op: 'replace', path: '/props/theme', value: 'corporate' },
          { op: 'add', path: 'children/-', value: {} },
        ],
        document
      ),
      PATCH_ERROR_CODES.INVALID_POINTER
    );
    expect(problem.operationIndex).toBe(1);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('compiles a valid patch without touching a document', () => {
    const compiled = compilePatch([{ op: 'remove', path: '/a~1b' }]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error('expected a compile');
    expect(compiled.compiled[0].tokens).toEqual(['a/b']);
  });
});
