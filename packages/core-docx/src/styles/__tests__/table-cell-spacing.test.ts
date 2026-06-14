import { describe, it, expect } from 'vitest';
import { getTableStyle } from '../utils/layoutUtils';
import type { ThemeConfig } from '../index';

/**
 * Fix A: table cells render their own dense paragraph spacing instead of
 * inheriting the `normal` body-prose rhythm. The wrapper paragraph spacing is
 * resolved by getTableStyle into `cellParagraph` / `headerParagraph`.
 */
const baseTheme = (extraStyles: Record<string, unknown> = {}): ThemeConfig =>
  ({
    name: 'test',
    displayName: 'Test',
    description: '',
    version: '1.0.0',
    colors: { primary: '#000000', backgroundPrimary: '#FFFFFF' },
    fonts: { body: { family: 'Arial', size: 11 } },
    page: {},
    styles: {
      normal: { font: 'body', size: 11, color: '#000000' },
      ...extraStyles,
    },
  }) as unknown as ThemeConfig;

describe('getTableStyle — table-cell paragraph spacing', () => {
  it('defaults table cells to dense spacing (no after-spacing, single line)', () => {
    const style = getTableStyle(baseTheme());
    expect(style.cellParagraph).toEqual({
      before: 0,
      after: 0,
      line: 240, // single
      lineRule: 'auto',
    });
    // Headers are dense by default too
    expect(style.headerParagraph).toEqual({
      before: 0,
      after: 0,
      line: 240,
      lineRule: 'auto',
    });
  });

  it('does not inherit the theme normal style after-spacing/line', () => {
    // normal carries body-prose rhythm; table cells must ignore it
    const style = getTableStyle(
      baseTheme({
        normal: {
          font: 'body',
          size: 11,
          spacing: { after: 9 },
          lineSpacing: { type: 'multiple', value: 1.5 },
        },
      })
    );
    expect(style.cellParagraph.after).toBe(0);
    expect(style.cellParagraph.line).toBe(240);
  });

  it('honors styles.tableCell override (points → twips, lineSpacing → line/rule)', () => {
    const style = getTableStyle(
      baseTheme({
        tableCell: {
          spacing: { after: 10 },
          lineSpacing: { type: 'multiple', value: 1.5 },
        },
      })
    );
    expect(style.cellParagraph).toEqual({
      before: 0,
      after: 200, // 10pt → 200 twips
      line: 360, // 1.5 × 240
      lineRule: 'auto',
    });
  });

  it('honors styles.tableHeader override independently of cells', () => {
    const style = getTableStyle(
      baseTheme({
        tableHeader: { spacing: { before: 2, after: 2 } },
      })
    );
    expect(style.headerParagraph).toEqual({
      before: 40, // 2pt → 40 twips
      after: 40,
      line: 240,
      lineRule: 'auto',
    });
    // cells remain dense
    expect(style.cellParagraph.after).toBe(0);
  });
});
