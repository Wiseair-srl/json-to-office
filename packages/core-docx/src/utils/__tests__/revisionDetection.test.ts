/**
 * `componentHasRevision` drives the cache bypass, so anything it fails to see
 * gets cached — and a cached subtree replays its document-scoped w:ins/w:del
 * ids into every later document. Tables are cacheable and column-major, so
 * their cells need an explicit descent.
 */
import { describe, it, expect } from 'vitest';
import { componentHasRevision } from '../revisionUtils';
import { componentBypassReason } from '../../core/cached-render';
import type { ComponentDefinition } from '../../types';

const REVISION = {
  segments: [
    { type: 'delete', text: 'old' },
    { type: 'insert', text: 'new' },
  ],
};

function table(columns: unknown[]): ComponentDefinition {
  return {
    name: 'table',
    props: { columns },
  } as unknown as ComponentDefinition;
}

describe('componentHasRevision', () => {
  it('is false for a plain table', () => {
    expect(
      componentHasRevision(
        table([{ header: { content: 'A' }, cells: [{ content: 'a1' }] }])
      )
    ).toBe(false);
  });

  it('detects a revision on a cell', () => {
    expect(
      componentHasRevision(
        table([
          { header: { content: 'A' }, cells: [{ content: 'a1' }] },
          {
            header: { content: 'B' },
            cells: [{ content: 'b1' }, { content: 'b2', revision: REVISION }],
          },
        ])
      )
    ).toBe(true);
  });

  it('detects a revision on a header cell', () => {
    expect(
      componentHasRevision(
        table([{ header: { content: 'A', revision: REVISION }, cells: [] }])
      )
    ).toBe(true);
  });

  it('detects a revision on a component nested in a cell', () => {
    expect(
      componentHasRevision(
        table([
          {
            header: { content: 'A' },
            cells: [
              {
                content: {
                  name: 'paragraph',
                  props: { text: 'new', revision: REVISION },
                },
              },
            ],
          },
        ])
      )
    ).toBe(true);
  });

  it('detects a row-parallel structural revision', () => {
    const component = {
      name: 'table',
      props: {
        columns: [{ header: { content: 'A' }, cells: [{ content: 'a1' }] }],
        rows: [{ revision: { type: 'insert' } }],
      },
    } as unknown as ComponentDefinition;
    expect(componentHasRevision(component)).toBe(true);
  });

  it('still detects revisions on props, list items and descendants', () => {
    expect(
      componentHasRevision({ props: { text: 'x', revision: REVISION } })
    ).toBe(true);
    expect(
      componentHasRevision({
        props: { items: [{ text: 'a' }, { text: 'b', revision: REVISION }] },
      })
    ).toBe(true);
    expect(
      componentHasRevision({
        children: [{ props: { text: 'x', revision: REVISION } }],
      })
    ).toBe(true);
  });
});

describe('componentBypassReason', () => {
  it('reports revision-ids for a table with a revised cell', () => {
    expect(
      componentBypassReason(
        table([
          {
            header: { content: 'A' },
            cells: [{ content: 'a', revision: REVISION }],
          },
        ])
      )
    ).toBe('revision-ids');
  });

  it('reports null for a cacheable table', () => {
    expect(
      componentBypassReason(
        table([{ header: { content: 'A' }, cells: [{ content: 'a' }] }])
      )
    ).toBeNull();
  });

  it('reports bookmark-id and dynamic-context unchanged', () => {
    expect(
      componentBypassReason({
        name: 'table',
        id: 'anchor',
        props: { columns: [] },
      } as unknown as ComponentDefinition)
    ).toBe('bookmark-id');
    expect(
      componentBypassReason({
        name: 'paragraph',
        props: { text: 'x' },
      } as unknown as ComponentDefinition)
    ).toBe('dynamic-context');
  });
});
