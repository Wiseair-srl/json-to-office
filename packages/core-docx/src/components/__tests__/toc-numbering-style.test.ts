/**
 * Regression: `toc.numberingStyle` has no counterpart in Word's TOC field —
 * every switch the field carries is about which entries appear and where their
 * page numbers go, and none of them controls numbering. The prop stays in the
 * schema for back-compat, so the pipeline must say out loud that it is doing
 * nothing rather than dropping it.
 */

import { describe, it, expect } from 'vitest';
import { resolveTocField } from '../../core/tocField';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { createMockTheme } from './helpers';
import type { ReportComponentDefinition } from '../../types';

const tocDocument = (props: Record<string, unknown>) =>
  ({
    name: 'docx',
    props: {},
    children: [{ name: 'toc', props }],
  }) as unknown as ReportComponentDefinition;

describe('TOC numberingStyle', () => {
  it('warns that numberingStyle is ignored when it is set', async () => {
    const warnings: Array<{ message: string }> = [];
    const compiled = await compileDocumentToIr(
      tocDocument({ numberingStyle: 'bullet' }),
      { warnings: warnings as never }
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('numberingStyle');
    expect(warnings[0].message).toContain('bullet');
    expect(warnings[0].message).toMatch(/ignored/i);

    // The TOC itself still compiles normally.
    const blocks = compiled.ir.sections[0].children;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('toc');
  });

  it('warns for every numberingStyle value, including "none"', () => {
    for (const numberingStyle of ['numeric', 'bullet', 'none'] as const) {
      const field = resolveTocField({ numberingStyle }, createMockTheme(), {});
      expect(field.warnings).toHaveLength(1);
    }
  });

  it('stays silent when numberingStyle is not set', async () => {
    const warnings: Array<{ message: string }> = [];
    const compiled = await compileDocumentToIr(
      tocDocument({ title: 'Contents', depth: { to: 2 } }),
      { warnings: warnings as never }
    );

    expect(warnings).toEqual([]);
    // A title is its own paragraph ahead of the field.
    expect(compiled.ir.sections[0].children).toHaveLength(2);
  });
});
