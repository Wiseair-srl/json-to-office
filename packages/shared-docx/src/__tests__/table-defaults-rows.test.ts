/**
 * `componentDefaults.table` and the shallowness of `Type.Partial`.
 *
 * `deepMerge` replaces arrays wholesale rather than merging them element-wise,
 * and `columns` is the one required table prop — so a valid table always
 * supplies its own, and anything a theme put in `columns` (cell text, comments,
 * cell revisions) can never reach it. `rows` is optional, so a theme's `rows`
 * *does* reach any table that does not declare its own, which is why it is the
 * one field excluded from table defaults.
 */
import { describe, it, expect } from 'vitest';
import { mergeWithDefaults } from '@json-to-office/shared';
import { validate } from '../validation/unified';

const table = {
  name: 'table',
  props: {
    columns: [{ header: { content: 'Tier' }, cells: [{ content: 'Basic' }] }],
  },
};

function documentWithTableDefaults(defaults: Record<string, unknown>): string {
  return JSON.stringify({
    name: 'docx',
    props: { theme: 'minimal', componentDefaults: { table: defaults } },
    children: [table],
  });
}

describe('componentDefaults.table', () => {
  it('rejects rows — a theme could otherwise revise a row of every table', () => {
    const result = validate.jsonDocument(
      documentWithTableDefaults({
        rows: [{ revision: { type: 'delete', author: 'INJECTED' } }],
      })
    );

    expect(result.valid).toBe(false);
  });

  it('accepts columns, which cannot reach a table anyway', () => {
    expect(
      validate.jsonDocument(
        documentWithTableDefaults({
          columns: [{ cells: [{ content: 'DEFAULT' }] }],
        })
      ).valid
    ).toBe(true);
  });

  it('still accepts the defaults that actually apply', () => {
    expect(
      validate.jsonDocument(
        documentWithTableDefaults({
          cellDefaults: { padding: 4 },
          borderSize: 1,
          width: 100,
        })
      ).valid
    ).toBe(true);
  });
});

describe('why columns is inert in table defaults', () => {
  it('an instance replaces the theme columns wholesale', () => {
    const merged = mergeWithDefaults(table.props, {
      columns: [
        {
          cells: [
            {
              content: 'INJECTED',
              revision: { segments: [{ type: 'insert', text: 'INJECTED' }] },
            },
          ],
        },
      ],
    } as never) as Record<string, unknown>;

    expect(JSON.stringify(merged.columns)).not.toContain('INJECTED');
    expect(JSON.stringify(merged.columns)).toContain('Basic');
  });

  it('but an omitted rows would inherit the theme rows', () => {
    // The reason `rows` is excluded rather than merely documented.
    const merged = mergeWithDefaults(table.props, {
      rows: [{ revision: { type: 'delete', author: 'INJECTED' } }],
    } as never) as Record<string, unknown>;

    expect(JSON.stringify(merged.rows)).toContain('INJECTED');
  });
});
