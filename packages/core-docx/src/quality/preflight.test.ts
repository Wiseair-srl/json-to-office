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

    // The ready-made repair scales both widths into the section, keeping
    // their proportions (equal columns stay equal).
    const fixes = findings[0].fixes ?? [];
    expect(fixes.map((fix) => fix.path)).toEqual([
      '/children/0/children/0/props/columns/0/width',
      '/children/0/children/0/props/columns/1/width',
    ]);
    const values = fixes.map((fix) => fix.value as number);
    expect(values[0]).toBe(values[1]);
    expect(values[0]).toBeLessThan(300);
    const availablePt = (findings[0].context as any).availableWidthPt;
    expect(values[0] + values[1]).toBeLessThanOrEqual(availablePt);
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

    // Percent widths rescale as percent strings summing to ≤ 100%.
    const values = (findings[0].fixes ?? []).map((fix) => fix.value as string);
    expect(values).toHaveLength(2);
    for (const value of values) expect(value.endsWith('%')).toBe(true);
    const sum = values.reduce((acc, value) => acc + parseFloat(value), 0);
    expect(sum).toBeLessThanOrEqual(100);
    expect(sum).toBeGreaterThan(98);
  });

  it('counts a percentage past 100% at its authored width', () => {
    const table = (...widths: string[]) =>
      doc([
        {
          name: 'table',
          props: {
            columns: widths.map((width) => ({
              header: { content: width },
              cells: [],
              width,
            })),
          },
        },
      ]);
    expect(docxDiagnostics(table('150%', '150%'))[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
      context: { percentSum: 300 },
    });
    expect(docxDiagnostics(table('101%', '5%'))[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
      context: { percentSum: 106 },
    });
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

  it('does not collapse unstated columns with a ready-made fix', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'table',
          props: {
            columns: [
              { header: { content: 'A' }, cells: [], width: 400 },
              { header: { content: 'B' }, cells: [], width: 400 },
              { header: { content: 'C' }, cells: [] },
            ],
          },
        },
      ])
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
    });
    expect(findings[0].fixes).toBeUndefined();
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
      fixes: [
        { op: 'add', path: '/children/0/children/1/props/level', value: 2 },
      ],
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

describe('shipped profiles', () => {
  const skipped = doc([
    { name: 'heading', props: { text: 'One', level: 1 } },
    { name: 'heading', props: { text: 'Deep', level: 3 } },
  ]);

  it('applies a shipped profile named by id alone', () => {
    const analysis = analyzeDocxQuality(skipped, {
      profile: { id: 'executive-report', formats: ['docx'] },
    });
    expect(analysis.profileId).toBe('executive-report');
    expect(analysis.diagnostics[0]).toMatchObject({
      code: QUALITY_CODES.HEADING_SKIP,
      severity: 'warning',
    });
  });

  it("lets the caller's own keys win over the registered profile", () => {
    const analysis = analyzeDocxQuality(skipped, {
      profile: {
        id: 'executive-report',
        formats: ['docx'],
        rules: { 'docx/heading-hierarchy': { enabled: false } },
      },
    });
    expect(analysis.diagnostics).toEqual([]);
  });

  it("keeps a shipped rule's severity when the caller overrides one field", () => {
    const analysis = analyzeDocxQuality(skipped, {
      profile: {
        id: 'executive-report',
        formats: ['docx'],
        rules: { 'docx/heading-hierarchy': { enabled: true } },
      },
    });
    // Without the per-rule merge, `enabled` replaces the whole configuration
    // and the finding drops back to the rule's own `info` default.
    expect(analysis.diagnostics[0]).toMatchObject({ severity: 'warning' });
  });

  it('leaves an unregistered profile exactly as the caller wrote it', () => {
    const analysis = analyzeDocxQuality(skipped, {
      profile: {
        id: 'house-style',
        formats: ['docx'],
        rules: { 'docx/heading-hierarchy': { severity: 'error' } },
      },
    });
    expect(analysis.diagnostics[0]).toMatchObject({ severity: 'error' });
  });
});

describe('preparation failures', () => {
  const broken = { name: 'docx', props: {}, children: 'not an array' };

  it('records the failure rather than reporting a clean document', () => {
    const analysis = analyzeDocxQuality(broken);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ruleErrors).toEqual([
      { ruleId: 'quality/prepare', message: expect.any(String) },
    ]);
    expect(analysis.blocked).toBe(false);
  });

  it('fails closed when a gate is active', () => {
    expect(
      analyzeDocxQuality(broken, { policy: { gate: 'warning' } }).blocked
    ).toBe(true);
    expect(
      analyzeDocxQuality(broken, { policy: { gate: 'none' } }).blocked
    ).toBe(false);
  });

  it('rethrows when the policy asks for it', () => {
    expect(() =>
      analyzeDocxQuality(broken, { policy: { onRuleError: 'throw' } })
    ).toThrow();
  });

  it('still reports an unusable policy or profile', () => {
    // The document being broken is no reason to accept a policy the engine
    // would have rejected: the caller hears about its own configuration first.
    expect(() =>
      analyzeDocxQuality(broken, {
        policy: { onRuleError: 'ignore' } as never,
      })
    ).toThrow(/invalid onRuleError/);
    expect(() =>
      analyzeDocxQuality(broken, {
        profile: {
          id: 'strict',
          rules: { 'docx/heading-hierarchy': { severity: 'fatal' } },
        } as never,
      })
    ).toThrow(/invalid severity/);
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

describe('frame text fit', () => {
  it('warns when a word cannot wrap inside its frame', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'section',
          children: [
            {
              name: 'paragraph',
              props: {
                text: 'Global Footprint',
                font: { size: 107 },
                // 3000 twips = 150pt; "Footprint" needs roughly 420pt.
                floating: { width: 3000 },
              },
            },
          ],
        },
      ])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TEXT_OVERFLOW,
      severity: 'warning',
      path: '/children/0/children/0/props/floating/width',
    });
    expect(findings[0].context).toMatchObject({ longestWord: 'Footprint' });
  });

  it('stays quiet when the frame has room, tracking included', () => {
    expect(
      docxDiagnostics(
        doc([
          {
            name: 'section',
            children: [
              {
                name: 'paragraph',
                props: {
                  text: 'Global Footprint',
                  font: {
                    size: 107,
                    characterSpacing: { type: 'condensed', value: 192 },
                  },
                  floating: { width: 9000 },
                },
              },
            ],
          },
        ])
      )
    ).toEqual([]);
  });

  it('warns when a frame near the foot of the page loses a line to the next', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'section',
          props: { page: { size: 'A4' } },
          children: [
            {
              name: 'paragraph',
              props: {
                // Every word fits the frame; the wrapped block is what runs
                // off the sheet, so this exercises the vertical check rather
                // than the mid-word one.
                text: 'OUR AWARDS FOR THE YEAR',
                font: { size: 76 },
                floating: {
                  width: 9800,
                  verticalPosition: { offset: 14213 },
                },
              },
            },
          ],
        },
      ])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TEXT_OVERFLOW,
      path: '/children/0/children/0/props/floating/verticalPosition/offset',
    });
  });

  it('ignores an overrun smaller than the line it would cost', () => {
    // A frame ending a few twips past the sheet is inside the width model's
    // error; only an overrun that actually displaces a line is reportable.
    expect(
      docxDiagnostics(
        doc([
          {
            name: 'section',
            props: { page: { size: 'A4' } },
            children: [
              {
                name: 'paragraph',
                props: {
                  text: 'Footer note',
                  font: { size: 9 },
                  floating: {
                    width: 5112,
                    verticalPosition: { offset: 16700 },
                  },
                },
              },
            ],
          },
        ])
      )
    ).toEqual([]);
  });
});

describe('svg text bounds', () => {
  it('warns when a baseline falls outside the viewBox', () => {
    const findings = docxDiagnostics(
      doc([
        {
          name: 'section',
          children: [
            {
              name: 'image',
              props: {
                svg: '<svg viewBox="0 0 827 1169"><text x="50" y="1181.9" font-size="69.4">Esg Overview</text></svg>',
              },
            },
          ],
        },
      ])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.SVG_TEXT_CLIPPED,
      severity: 'warning',
      path: '/children/0/children/0/props/svg',
    });
    expect(findings[0].context).toMatchObject({ content: 'Esg Overview' });
  });

  it('accepts a baseline inside the canvas', () => {
    expect(
      docxDiagnostics(
        doc([
          {
            name: 'section',
            children: [
              {
                name: 'image',
                props: {
                  svg: '<svg viewBox="0 0 827 1169"><text x="50" y="1154.9" font-size="69.4">Esg Overview</text></svg>',
                },
              },
            ],
          },
        ])
      )
    ).toEqual([]);
  });
});
