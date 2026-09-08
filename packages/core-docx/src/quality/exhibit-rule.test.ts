/**
 * `docx/exhibit-required`: a client report that argues its numbers in prose.
 * Off by default; the client-report profile asks for one chart or one table
 * of two or more columns. A kpi-row is a summary and does not count.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzeDocxQuality } from './preflight';

const profile = { id: 'client-report', formats: ['docx'] };
const findings = (doc: unknown, options = {}) =>
  analyzeDocxQuality(doc, options).diagnostics.filter(
    (d) => d.code === QUALITY_CODES.EXHIBIT_MISSING
  );
const para = (text: string) => ({ name: 'paragraph', props: { text } });
const table = (columns: number) => ({
  name: 'table',
  props: {
    columns: Array.from({ length: columns }, (_, i) => ({
      header: { content: `Column ${i + 1}` },
      cells: [{ content: 'a' }, { content: 'b' }],
    })),
  },
});
const report = (...children: unknown[]) => ({
  name: 'docx',
  props: { theme: 'consulting' },
  children: [{ name: 'section', children }],
});

describe('docx/exhibit-required', () => {
  it('is silent by default, and reports a prose-only report under client-report', () => {
    const doc = report(para('Numbers argued in prose.'), para('More prose.'));
    expect(findings(doc)).toEqual([]);
    const [finding] = findings(doc, { profile });
    expect(finding).toMatchObject({
      severity: 'warning',
      context: { charts: 0, tables: 0, minimum: 1 },
    });
    expect(finding.message).toMatch(/no data exhibit/);
    expect(finding.suggestion).toMatch(/kpi-row summarises/);
  });

  it('is satisfied by a table of two or more columns, not by a one-column list', () => {
    expect(findings(report(para('Intro'), table(2)), { profile })).toEqual([]);
    expect(findings(report(para('Intro'), table(1)), { profile })).toHaveLength(
      1
    );
  });

  it('is satisfied by a chart', () => {
    const doc = report(para('Intro'), {
      name: 'chart',
      props: {
        type: 'bar',
        categories: ['A', 'B'],
        series: [{ name: 'Revenue', values: [1, 2] }],
      },
    });
    expect(findings(doc, { profile })).toEqual([]);
  });

  it('honours a higher minimum from a policy', () => {
    const doc = report(para('Intro'), table(2));
    const [finding] = findings(doc, {
      profile,
      policy: {
        rules: {
          'docx/exhibit-required': { parameters: { minimumExhibits: 2 } },
        },
      },
    });
    expect(finding?.message).toMatch(/carries 1 data exhibit/);
  });
});
