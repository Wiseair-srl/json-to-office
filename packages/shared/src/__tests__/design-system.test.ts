import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  DesignSystemSchema,
  designCanvas,
  resolveTypeRoles,
  validateDesignColors,
} from '../theme/design-system';

describe('shared visual theme contract', () => {
  it('is additive, strict, and contains no content requirements', () => {
    expect(Value.Check(DesignSystemSchema, {})).toBe(true);
    for (const invalid of [
      { palette: { chart: [] } },
      { palette: { rule: '#xyz' } },
      { typography: { roles: { display: { weight: 1000 } } } },
      { typography: { roles: { typo: {} } } },
      { spacing: { canvas: { a4: { gutterIn: -1 } } } },
      { chrome: { actionTitle: { required: true } } },
      { motif: { kind: 'rule', minCount: 1 } },
    ])
      expect(Value.Check(DesignSystemSchema, invalid)).toBe(false);
    const walk = (schema: Record<string, any>) => {
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        expect(key).not.toMatch(/^(required|must|min|max|archetype|density)/i);
        walk(child as Record<string, any>);
      }
    };
    walk(DesignSystemSchema);
  });

  it('derives canvas sizes deterministically; explicit role sizes win', () => {
    expect(designCanvas('docx', 'LETTER')).toBe('letter');
    expect(designCanvas('docx', 'LEGAL')).toBe('a4');
    expect(designCanvas('pptx', { width: 16, height: 9 })).toBe('wide169');
    expect(designCanvas('pptx', { width: 10, height: 10 })).toBe('standard43');
    const theme = {
      typography: {
        roles: { display: {}, source: { size: 9 } },
        scale: { a4: { base: 12, ratio: 1.25, baselinePt: 4 } },
      },
    };
    expect(resolveTypeRoles(theme, 'a4', 11)).toEqual({
      display: { size: 28 },
      source: { size: 9 },
    });
    expect(resolveTypeRoles(theme, 'letter', 11).display?.size).toBe(11);
  });

  it('rejects cycles and missing palette targets without recursion', () => {
    expect(() =>
      validateDesignColors(
        { palette: { rule: 'textMuted', textMuted: 'rule' } },
        {}
      )
    ).toThrow(/cycle/);
    expect(() =>
      validateDesignColors({ palette: { chart: ['missing'] } }, {})
    ).toThrow(/palette.chart\[0\]/);
    expect(() =>
      validateDesignColors(
        { palette: { chart: ['positive'], positive: 'primary' } },
        { primary: '#123456' }
      )
    ).not.toThrow();
  });
});
