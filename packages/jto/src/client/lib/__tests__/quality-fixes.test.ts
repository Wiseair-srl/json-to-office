import { describe, it, expect } from 'vitest';
import { applyQualityFixes, canApplyFixes } from '../quality-fixes';
import type { QualityFixOp } from '../quality-findings';

/** Cast helper for payloads a server could send but the type forbids. */
const wire = (op: unknown): QualityFixOp => op as QualityFixOp;

/** Deep snapshot, so an accidental in-place mutation is visible afterwards. */
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function expectOk(result: ReturnType<typeof applyQualityFixes>) {
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result;
}

function expectFail(result: ReturnType<typeof applyQualityFixes>) {
  if (result.ok) throw new Error('expected failure, got success');
  return result;
}

describe('applyQualityFixes', () => {
  it('returns the document untouched for an empty patch list', () => {
    const doc = { a: 1 };
    const result = expectOk(applyQualityFixes(doc, []));
    expect(result.applied).toBe(0);
    expect(result.doc).toBe(doc);
  });

  it('adds a new object key', () => {
    const doc = { slides: [{ title: 'One' }] };
    const result = expectOk(
      applyQualityFixes(doc, [
        { op: 'add', path: '/slides/0/subtitle', value: 'Sub' },
      ])
    );
    expect(result.doc).toEqual({
      slides: [{ title: 'One', subtitle: 'Sub' }],
    });
    expect(result.applied).toBe(1);
  });

  it('inserts at an existing array index instead of overwriting', () => {
    const doc = { items: ['a', 'b', 'c'] };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'add', path: '/items/1', value: 'x' }])
    );
    expect(result.doc).toEqual({ items: ['a', 'x', 'b', 'c'] });
  });

  it('overwrites at an existing array index on replace', () => {
    const doc = { items: ['a', 'b', 'c'] };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'replace', path: '/items/1', value: 'x' }])
    );
    expect(result.doc).toEqual({ items: ['a', 'x', 'c'] });
  });

  it("appends when the array index is '-'", () => {
    const doc = { items: ['a'] };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'add', path: '/items/-', value: 'b' }])
    );
    expect(result.doc).toEqual({ items: ['a', 'b'] });
  });

  it("rejects '-' for replace", () => {
    const doc = { items: ['a'] };
    const result = expectFail(
      applyQualityFixes(doc, [{ op: 'replace', path: '/items/-', value: 'b' }])
    );
    expect(result.error).toContain('replace');
    expect(result.error).toContain('/items/-');
  });

  it('allows add one past the end of an array but not beyond', () => {
    const doc = { items: ['a'] };
    expect(
      expectOk(
        applyQualityFixes(doc, [{ op: 'add', path: '/items/1', value: 'b' }])
      ).doc
    ).toEqual({ items: ['a', 'b'] });
    expect(
      expectFail(
        applyQualityFixes(doc, [{ op: 'add', path: '/items/5', value: 'b' }])
      ).error
    ).toContain('/items/5');
  });

  it('splices when removing from the middle of an array', () => {
    const doc = { items: ['a', 'b', 'c'] };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'remove', path: '/items/1' }])
    );
    expect(result.doc).toEqual({ items: ['a', 'c'] });
  });

  it('deletes when removing an object key', () => {
    const doc = { title: 'T', subtitle: 'S' };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'remove', path: '/subtitle' }])
    );
    expect(result.doc).toEqual({ title: 'T' });
  });

  it('fails when removing a key that does not exist', () => {
    const result = expectFail(
      applyQualityFixes({ a: 1 }, [{ op: 'remove', path: '/b' }])
    );
    expect(result.error).toContain('remove');
    expect(result.error).toContain('/b');
  });

  it('refuses to remove the whole document', () => {
    const result = expectFail(
      applyQualityFixes({ a: 1 }, [{ op: 'remove', path: '' }])
    );
    expect(result.error).toContain('remove');
  });

  it('moves a value between paths', () => {
    const doc = { from: { text: 'hello' }, to: {} };
    const result = expectOk(
      applyQualityFixes(doc, [
        { op: 'move', path: '/to/text', from: '/from/text' },
      ])
    );
    expect(result.doc).toEqual({ from: {}, to: { text: 'hello' } });
  });

  it('moves within an array using post-removal indices', () => {
    const doc = { items: ['a', 'b', 'c'] };
    const result = expectOk(
      applyQualityFixes(doc, [
        { op: 'move', path: '/items/2', from: '/items/0' },
      ])
    );
    expect(result.doc).toEqual({ items: ['b', 'c', 'a'] });
  });

  it('treats a move onto itself as a no-op', () => {
    const doc = { a: { b: 1 } };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'move', path: '/a/b', from: '/a/b' }])
    );
    expect(result.doc).toEqual({ a: { b: 1 } });
  });

  it('refuses to move a value into its own child', () => {
    const doc = { a: { b: {} } };
    const result = expectFail(
      applyQualityFixes(doc, [{ op: 'move', path: '/a/b/c', from: '/a' }])
    );
    expect(result.error).toContain('/a');
  });

  it('fails a move whose source does not exist', () => {
    const result = expectFail(
      applyQualityFixes({ a: {} }, [
        { op: 'move', path: '/b', from: '/missing' },
      ])
    );
    expect(result.error).toContain('move');
  });

  it('fails a move with no from pointer', () => {
    const result = expectFail(
      applyQualityFixes({ a: 1 }, [wire({ op: 'move', path: '/b' })])
    );
    expect(result.error).toContain('from');
  });

  it('copies a value without removing the source', () => {
    const doc = { source: { text: 'hello' }, list: [] as unknown[] };
    const result = expectOk(
      applyQualityFixes(doc, [{ op: 'copy', path: '/list/-', from: '/source' }])
    );
    expect(result.doc).toEqual({
      source: { text: 'hello' },
      list: [{ text: 'hello' }],
    });
  });

  it('passes a matching test op deeply', () => {
    const doc = { a: { b: [1, { c: 'd' }] } };
    const result = expectOk(
      applyQualityFixes(doc, [
        { op: 'test', path: '/a', value: { b: [1, { c: 'd' }] } },
        { op: 'replace', path: '/a/b/0', value: 2 },
      ])
    );
    expect(result.doc).toEqual({ a: { b: [2, { c: 'd' }] } });
    expect(result.applied).toBe(2);
  });

  it('fails the whole patch when a test op mismatches', () => {
    const doc = { a: 1, b: 2 };
    const result = expectFail(
      applyQualityFixes(doc, [
        { op: 'replace', path: '/b', value: 99 },
        { op: 'test', path: '/a', value: 2 },
      ])
    );
    expect(result.error).toContain('test');
    expect(result.error).toContain('/a');
    expect(doc).toEqual({ a: 1, b: 2 });
  });

  it('fails a test op on a path that does not exist', () => {
    const result = expectFail(
      applyQualityFixes({ a: 1 }, [{ op: 'test', path: '/missing', value: 1 }])
    );
    expect(result.error).toContain('/missing');
  });

  it('errors instead of creating a missing parent', () => {
    const add = expectFail(
      applyQualityFixes({}, [{ op: 'add', path: '/a/b', value: 1 }])
    );
    expect(add.error).toContain('/a/b');
    const replace = expectFail(
      applyQualityFixes({ a: 1 }, [{ op: 'replace', path: '/a/b/c', value: 1 }])
    );
    expect(replace.error).toContain('/a/b/c');
  });

  it('errors when the path runs through a non-container value', () => {
    const result = expectFail(
      applyQualityFixes({ a: 'text' }, [{ op: 'add', path: '/a/b', value: 1 }])
    );
    expect(result.error).toContain('/a/b');
  });

  it('treats an empty path as the whole document', () => {
    const added = expectOk(
      applyQualityFixes({ a: 1 }, [{ op: 'add', path: '', value: { b: 2 } }])
    );
    expect(added.doc).toEqual({ b: 2 });
    const replaced = expectOk(
      applyQualityFixes({ a: 1 }, [{ op: 'replace', path: '', value: [1, 2] }])
    );
    expect(replaced.doc).toEqual([1, 2]);
    const tested = expectOk(
      applyQualityFixes({ a: 1 }, [{ op: 'test', path: '', value: { a: 1 } }])
    );
    expect(tested.doc).toEqual({ a: 1 });
  });

  it('names an unsupported operation in the error', () => {
    const result = expectFail(
      applyQualityFixes({ a: 1 }, [
        wire({ op: 'invert', path: '/a', value: 1 }),
      ])
    );
    expect(result.error).toContain('invert');
    expect(result.error).toContain('/a');
  });

  it('names the failing operation position, op and path', () => {
    const result = expectFail(
      applyQualityFixes({ a: 1 }, [
        { op: 'replace', path: '/a', value: 2 },
        { op: 'remove', path: '/nope' },
      ])
    );
    expect(result.error).toContain('#2');
    expect(result.error).toContain('remove');
    expect(result.error).toContain('/nope');
  });

  it('never throws, whatever the input', () => {
    expect(() =>
      applyQualityFixes(42, [{ op: 'add', path: '/a', value: 1 }])
    ).not.toThrow();
    expect(() =>
      applyQualityFixes(null, [{ op: 'remove', path: '/a' }])
    ).not.toThrow();
    expect(() =>
      applyQualityFixes({ a: 1 }, [wire({ op: 'add', path: 'not-a-pointer' })])
    ).not.toThrow();
    expect(
      applyQualityFixes(42, [{ op: 'add', path: '/a', value: 1 }]).ok
    ).toBe(false);
  });

  it('leaves the input graph untouched after a successful patch', () => {
    const doc = {
      slides: [{ title: 'One', items: ['a', 'b'] }],
      theme: { font: 'Inter' },
    };
    const before = snapshot(doc);
    const result = expectOk(
      applyQualityFixes(doc, [
        { op: 'add', path: '/slides/0/items/0', value: 'z' },
        { op: 'replace', path: '/slides/0/title', value: 'Two' },
      ])
    );
    expect(doc).toEqual(before);
    expect(doc.slides[0].items).toEqual(['a', 'b']);
    // Untouched subtrees are shared, not copied.
    expect((result.doc as typeof doc).theme).toBe(doc.theme);
  });

  it('leaves the input graph untouched after a failed patch', () => {
    const doc = { items: ['a', 'b'], meta: { keep: true } };
    const before = snapshot(doc);
    const result = expectFail(
      applyQualityFixes(doc, [
        { op: 'remove', path: '/items/0' },
        { op: 'add', path: '/meta/deep/leaf', value: 1 },
      ])
    );
    expect(result.error).toContain('#2');
    expect(doc).toEqual(before);
    expect(doc.items).toEqual(['a', 'b']);
  });
});

describe('canApplyFixes', () => {
  it('is false for a missing or empty list', () => {
    expect(canApplyFixes(undefined)).toBe(false);
    expect(canApplyFixes([])).toBe(false);
  });

  it('is true when every op is supported', () => {
    const fixes: QualityFixOp[] = [
      { op: 'add', path: '/a', value: 1 },
      { op: 'remove', path: '/b' },
      { op: 'replace', path: '/c', value: 2 },
      { op: 'move', path: '/d', from: '/e' },
      { op: 'copy', path: '/f', from: '/g' },
      { op: 'test', path: '/h', value: 3 },
    ];
    expect(canApplyFixes(fixes)).toBe(true);
  });

  it('is false when any op is unsupported', () => {
    expect(
      canApplyFixes([
        { op: 'add', path: '/a', value: 1 },
        wire({ op: 'increment', path: '/b', value: 1 }),
      ])
    ).toBe(false);
  });

  it('is false for a move or copy with no from pointer', () => {
    expect(canApplyFixes([wire({ op: 'move', path: '/a' })])).toBe(false);
    expect(canApplyFixes([wire({ op: 'copy', path: '/a' })])).toBe(false);
  });
});
