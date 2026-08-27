import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzeDocxQuality } from './preflight';

function doc(children: unknown[]) {
  return { name: 'docx', props: {}, children };
}

function docxDiagnostics(input: unknown) {
  return analyzeDocxQuality(input).diagnostics;
}

describe('table widths', () => {
  it('warns when fixed widths overshoot every page setup', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'section',
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  { header: { content: 'A' }, cells: [], width: 300 },
                  { header: { content: 'B' }, cells: [], width: 300 },
                ],
              },
            },
          ],
        },
      ])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
      severity: 'warning',
      path: '/children/0/children/0/props/columns',
    });
    expect(findings[0].context).toMatchObject({ pointSum: 600 });
  });

  it('warns when percentage widths pass 100%', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'table',
          props: {
            columns: [
              { header: { content: 'A' }, cells: [], width: '60%' },
              { header: { content: 'B' }, cells: [], width: '55%' },
            ],
          },
        },
      ])
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
    });
    expect(findings[0].context).toMatchObject({ percentSum: 115 });
  });

  it("leaves plausible widths to the compiler's exact check", () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'table',
          props: {
            columns: [
              { header: { content: 'A' }, cells: [], width: 200 },
              { header: { content: 'B' }, cells: [], width: 200 },
              { header: { content: 'C' }, cells: [] },
            ],
          },
        },
      ])
    );
    expect(findings).toEqual([]);
  });

  it('combines fixed and percentage widths against the same page', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'table',
          props: {
            columns: [
              { header: { content: 'A' }, cells: [], width: 400 },
              { header: { content: 'B' }, cells: [], width: '50%' },
            ],
          },
        },
      ])
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
      context: { pointSum: 400, percentSum: 50 },
    });
  });

  it('accepts a 600pt table when an A3 section has room', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'section',
          props: { page: { size: 'A3' } },
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  { header: { content: 'A' }, cells: [], width: 300 },
                  { header: { content: 'B' }, cells: [], width: 300 },
                ],
              },
            },
          ],
        },
      ])
    );
    expect(findings).toEqual([]);
  });
});

describe('heading hierarchy', () => {
  it('flags a skipped level going down, as info', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'section',
          children: [
            { name: 'heading', props: { text: 'One', level: 1 } },
            { name: 'heading', props: { text: 'Deep', level: 3 } },
          ],
        },
      ])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.HEADING_SKIP,
      severity: 'info',
      path: '/children/0/children/1/props/level',
      context: { level: 3, previousLevel: 1 },
    });
  });

  it('accepts stepping down one level and jumping back up any number', () => {
    const findings = docxDiagnostics(
      doc([
        { name: 'heading', props: { text: 'One', level: 1 } },
        { name: 'heading', props: { text: 'Two', level: 2 } },
        { name: 'heading', props: { text: 'Three', level: 3 } },
        { name: 'heading', props: { text: 'Back', level: 1 } },
      ])
    );
    expect(findings).toEqual([]);
  });

  it('ignores disabled content and disabled subtrees', () => {
    const findings = docxDiagnostics(
      doc([
        { name: 'heading', props: { text: 'One', level: 1 } },
        {
          name: 'section',
          enabled: false,
          children: [
            { name: 'heading', props: { text: 'Skipped', level: 4 } },
            {
              name: 'table',
              props: {
                columns: [{ header: { content: 'A' }, cells: [], width: 900 }],
              },
            },
          ],
        },
        { name: 'heading', props: { text: 'Two', level: 2 } },
      ])
    );
    expect(findings).toEqual([]);
  });
});

describe('robustness', () => {
  it('answers nothing for non-docx or malformed input, never throws', () => {
    expect(docxDiagnostics(undefined)).toEqual([]);
    expect(docxDiagnostics({ name: 'pptx' })).toEqual([]);
    expect(
      docxDiagnostics({
        name: 'docx',
        children: [null, { name: 'table', props: { columns: 'nope' } }],
      })
    ).toEqual([]);
  });

  it('does not hide policy/profile contract errors', () => {
    expect(() =>
      analyzeDocxQuality(doc([]), {
        profile: { id: 'slides-only', formats: ['pptx'] },
      })
    ).toThrow('does not support format');
  });
});
