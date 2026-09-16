/**
 * Theme-aware consistency (#332): the theme says which sizes exist, the
 * profile says whether a document has to keep to them. On the default profile
 * nothing here fires; `client-report` warns on a size off the theme's scale,
 * caps the number of distinct sizes, and objects when one role — a heading
 * level, the body style — drifts between sizes. Every finding says what it
 * expected and whether the theme or the profile asked for it.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzeDocxQuality } from './preflight';
import {
  block,
  example,
  invocation,
  para,
  section,
} from '../blocks/__tests__/example';
import { themes } from '../templates/themes';

const profile = (id: string) => ({ id, formats: ['docx'] });
const findings = (doc: unknown, code: string, options = {}) =>
  analyzeDocxQuality(doc, options).diagnostics.filter(
    (finding) => finding.code === code
  );
const onReport = (doc: unknown, code: string) =>
  findings(doc, code, { profile: profile('client-report') });
const sized = (
  text: string,
  size: number,
  extra: Record<string, unknown> = {}
) => ({
  name: 'paragraph',
  props: { text, font: { size }, ...extra },
});
const heading = (text: string, level: number, size?: number) => ({
  name: 'heading',
  props: { text, level, ...(size !== undefined && { font: { size } }) },
});
/** A one-section consulting report holding `children`. */
const report = (...children: unknown[]) => {
  const doc = example();
  doc.props.theme = 'consulting';
  doc.children = [section(...children)];
  return doc;
};
/** A two-column table whose cells may carry sizes of their own. */
const table = (columns: unknown[]) => ({
  name: 'table',
  props: { columns },
});

describe('a size off the theme scale', () => {
  it('is off by default and a warning on client-report, with the nearest scale size as the fix', () => {
    // Both body paragraphs at 14pt: the role is consistent, so this is a
    // size off the scale rather than a role drifting from the theme.
    const doc = report(sized('Lead.', 14), sized('Lead paragraph.', 14));
    expect(findings(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
    // One finding for the role at that size, whose patch snaps both places
    // together: snapping one alone would leave the role at two sizes.
    expect(onReport(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        path: '/children/0/children/0/props/font/size',
        relatedPaths: ['/children/0/children/1/props/font/size'],
        evidence: {
          actual: 14,
          expected: 13,
          unit: 'pt',
          values: { source: 'theme' },
        },
        fixes: [
          {
            op: 'replace',
            path: '/children/0/children/0/props/font/size',
            value: 13,
          },
          {
            op: 'replace',
            path: '/children/0/children/1/props/font/size',
            value: 13,
          },
        ],
      }),
    ]);
  });

  it('accepts every size the theme paints: styles, roles and scale steps', () => {
    const doc = report(
      sized('Subtitle size.', 13),
      sized('Table cell size.', 9.5),
      sized('Display step.', 22),
      heading('Heading two at its own size.', 2, 12.5)
    );
    expect(onReport(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
  });

  it('reads the scale from a custom theme rather than from the house theme', () => {
    const custom = structuredClone(themes.minimal);
    custom.name = 'custom';
    custom.styles = { ...custom.styles, lead: { size: 14 } };
    const doc = report(sized('Lead.', 14));
    doc.props.theme = 'custom';
    expect(
      findings(doc, QUALITY_CODES.TYPE_OFF_SCALE, {
        customThemes: { custom },
        profile: profile('client-report'),
      })
    ).toEqual([]);
  });

  it('offers no patch for a size the theme’s component defaults supplied', () => {
    // componentDefaults merge into the props before the facts are read. The
    // size reaches the page, but the document has no member a `replace` could
    // reach, so the size counts and nothing is patched.
    const custom = structuredClone(themes.minimal);
    custom.name = 'custom';
    custom.componentDefaults = {
      ...custom.componentDefaults,
      paragraph: { font: { size: 17.25 } },
    };
    const doc = report(para('Body at the default size.'));
    doc.props.theme = 'custom';
    const analysis = analyzeDocxQuality(doc, {
      customThemes: { custom },
      profile: profile('client-report'),
    });
    expect(
      analysis.diagnostics.flatMap((finding) => finding.fixes ?? [])
    ).toEqual([]);
    // Counted all the same: the size is on the page.
    const [count] = findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
      customThemes: { custom },
      policy: {
        rules: {
          'docx/size-count': { enabled: true, parameters: { maximumSizes: 0 } },
        },
      },
    });
    expect(count.context?.sizes).toContain(17.25);
  });

  it('holds a custom theme’s heading to the custom theme’s own size', () => {
    const custom = structuredClone(themes.minimal);
    custom.name = 'custom';
    custom.styles = {
      ...custom.styles,
      heading2: { ...(custom.styles as any).heading2, size: 15 },
    };
    const doc = report(
      heading('Two', 2),
      para('Body.'),
      heading('Two again', 2, 13)
    );
    doc.props.theme = 'custom';
    expect(
      findings(doc, QUALITY_CODES.TYPE_ROLE_DRIFT, {
        customThemes: { custom },
        profile: profile('client-report'),
      })
    ).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({ actual: 13, expected: 15 }),
        fixes: [expect.objectContaining({ value: 15 })],
      }),
    ]);
  });

  it('says nothing about sizes a block compiled from its definition', () => {
    const doc = report(invocation('kpi-row'), invocation('cover'));
    expect(onReport(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
  });
});

describe('another profile on the house theme', () => {
  it('inherits none of the report requirements from the theme alone', () => {
    const doc = report(
      sized('Lead paragraph.', 14),
      heading('Two', 2),
      heading('Two again', 2, 16)
    );
    for (const code of [
      QUALITY_CODES.TYPE_OFF_SCALE,
      QUALITY_CODES.TYPE_SIZE_COUNT,
      QUALITY_CODES.TYPE_ROLE_DRIFT,
    ]) {
      expect(
        findings(doc, code, { profile: profile('executive-report') })
      ).toEqual([]);
    }
  });
});

describe('the number of distinct sizes', () => {
  const sprawl = report(
    heading('One', 1),
    para('Body.'),
    sized('a', 8),
    sized('b', 9),
    sized('c', 11),
    sized('d', 12),
    sized('e', 13),
    sized('f', 16),
    sized('g', 18),
    sized('h', 22),
    sized('i', 26),
    sized('j', 30),
    sized('k', 34)
  );

  it('is capped only where the profile sets a maximum, and names every size it counted', () => {
    expect(findings(sprawl, QUALITY_CODES.TYPE_SIZE_COUNT)).toEqual([]);
    const [finding] = findings(sprawl, QUALITY_CODES.TYPE_SIZE_COUNT, {
      profile: profile('client-report'),
    });
    expect(finding).toMatchObject({
      severity: 'warning',
      path: '/props',
      evidence: {
        actual: 12,
        expected: 9,
        values: { source: 'profile' },
      },
    });
    expect(finding.context?.sizes).toEqual([
      8, 9, 10.5, 11, 12, 13, 16, 18, 22, 26, 30, 34,
    ]);
  });

  it('counts what a statistic, a list and a contents field paint', () => {
    const doc = report(
      { name: 'toc', props: {} },
      {
        name: 'statistic',
        props: {
          number: '42',
          unit: '%',
          description: 'of orders shipped on time',
          size: 'large',
        },
      },
      { name: 'list', props: { items: ['One', 'Two'], font: { size: 12 } } }
    );
    const [finding] = findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
      policy: {
        rules: {
          'docx/size-count': { enabled: true, parameters: { maximumSizes: 1 } },
        },
      },
    });
    // On a theme with type roles the figure takes the `stat` role — `large`
    // a scale step above its 22pt — and the unit and description the 9pt
    // `label` role; the list keeps the size the author gave it.
    expect(finding.context?.sizes).toEqual(expect.arrayContaining([9, 12, 26]));
    // A theme without roles keeps the built-in sizes: the figure at 40pt,
    // the unit at half of it, the description at the style's 10pt.
    doc.props.theme = 'minimal';
    const [plain] = findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
      policy: {
        rules: {
          'docx/size-count': { enabled: true, parameters: { maximumSizes: 1 } },
        },
      },
    });
    expect(plain.context?.sizes).toEqual(
      expect.arrayContaining([10, 12, 20, 40])
    );
  });

  it('counts the sizes a report actually paints, blocks included, and passes a report that keeps to its roles', () => {
    const doc = report(
      block('cover', { title: 'Cover', subtitle: 'Sub' }),
      block('section-opener', { number: '01', title: 'One' }),
      invocation('key-takeaways'),
      invocation('kpi-row'),
      invocation('data-table'),
      heading('Two', 2),
      para('Body.'),
      invocation('callout')
    );
    expect(
      findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
        profile: profile('client-report'),
      })
    ).toEqual([]);
  });
});

describe('one role at two sizes', () => {
  it('reports the heading that left its level, with the theme size as the fix', () => {
    const doc = report(
      heading('Two', 2),
      para('Body.'),
      heading('Two again, larger', 2, 16),
      para('Body.')
    );
    expect(findings(doc, QUALITY_CODES.TYPE_ROLE_DRIFT)).toEqual([]);
    const [finding] = onReport(doc, QUALITY_CODES.TYPE_ROLE_DRIFT);
    expect(finding).toMatchObject({
      severity: 'warning',
      path: '/children/0/children/2/props/font/size',
      relatedPaths: ['/children/0/children/0'],
      evidence: {
        actual: 16,
        expected: 12.5,
        unit: 'pt',
        values: { role: 'heading2', source: 'theme' },
      },
      fixes: [
        {
          op: 'replace',
          path: '/children/0/children/2/props/font/size',
          value: 12.5,
        },
      ],
    });
  });

  it('names the sizes the role is actually painted at, and yields no off-scale finding on the same pointer', () => {
    const doc = report(
      heading('Two', 2, 18),
      para('Body.'),
      heading('Two again', 2, 20)
    );
    const drift = onReport(doc, QUALITY_CODES.TYPE_ROLE_DRIFT);
    expect(drift.map((finding) => finding.message)).toEqual([
      '"heading2" is painted at 18pt here and at 20pt elsewhere; the theme sets it at 12.5pt.',
      '"heading2" is painted at 20pt here and at 18pt elsewhere; the theme sets it at 12.5pt.',
    ]);
    expect(drift.map((finding) => finding.relatedPaths)).toEqual([
      undefined,
      undefined,
    ]);
    // 20pt is off the scale too, but one pointer gets one fix.
    expect(onReport(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
  });

  it('is silent when a role is consistent, even at an authored size', () => {
    const doc = report(
      heading('Two', 2, 16),
      sized('Lead.', 13),
      heading('Two again', 2, 16),
      sized('Lead again.', 13)
    );
    expect(onReport(doc, QUALITY_CODES.TYPE_ROLE_DRIFT)).toEqual([]);
  });
});

describe('the surfaces a size can be painted on', () => {
  it('reads a sized cell as its role drifting from the size every other cell inherits', () => {
    const doc = report(
      table([
        {
          header: { content: 'Segment', font: { size: 14 } },
          cells: [{ content: 'Enterprise', font: { size: 14 } }],
        },
        { header: { content: 'Revenue' }, cells: [{ content: '4.2' }] },
      ])
    );
    expect(
      onReport(doc, QUALITY_CODES.TYPE_ROLE_DRIFT).map((finding) => ({
        path: finding.path,
        expected: finding.evidence?.expected,
      }))
    ).toEqual([
      {
        path: '/children/0/children/0/props/columns/0/header/font/size',
        expected: 9,
      },
      {
        path: '/children/0/children/0/props/columns/0/cells/0/font/size',
        expected: 9.5,
      },
    ]);
  });

  it('reads a size off a component nested in a cell, which lives outside the walk', () => {
    const doc = report(
      table([
        {
          header: { content: 'Segment' },
          cells: [
            {
              content: {
                name: 'paragraph',
                props: { text: 'One', font: { size: 14 } },
              },
            },
            {
              content: {
                name: 'paragraph',
                props: { text: 'Two', font: { size: 14 } },
              },
            },
          ],
        },
      ])
    );
    expect(
      onReport(doc, QUALITY_CODES.TYPE_ROLE_DRIFT).map(
        (finding) => finding.path
      )
    ).toEqual([
      '/children/0/children/0/props/columns/0/cells/0/content/props/font/size',
      '/children/0/children/0/props/columns/0/cells/1/content/props/font/size',
    ]);
  });

  it('reads a whole table sized at once as one size off the scale', () => {
    const doc = report({
      name: 'table',
      props: {
        cellDefaults: { font: { size: 14 } },
        columns: [
          { header: { content: 'Segment' }, cells: [{ content: 'One' }] },
        ],
      },
    });
    const [finding] = onReport(doc, QUALITY_CODES.TYPE_OFF_SCALE);
    expect(finding).toMatchObject({
      path: '/children/0/children/0/props/cellDefaults/font/size',
      evidence: { actual: 14, expected: 13, unit: 'pt' },
      fixes: [
        {
          op: 'replace',
          path: '/children/0/children/0/props/cellDefaults/font/size',
          value: 13,
        },
      ],
    });
  });

  it('counts the sizes a table paints even where nothing authored one', () => {
    const doc = report(
      table([{ header: { content: 'Segment' }, cells: [{ content: 'One' }] }])
    );
    const [count] = findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
      profile: { ...profile('client-report'), parameters: {} },
      policy: {
        rules: { 'docx/size-count': { parameters: { maximumSizes: 1 } } },
      },
    });
    // tableHeader 9pt and tableCell 9.5pt, off the theme, with no author to ask.
    expect(count.context?.sizes).toEqual([9, 9.5]);
  });

  it('reads authored sizes off a section header and footer', () => {
    const doc = report(para('Body.'));
    doc.children[0].props = {
      header: [sized('Running head.', 14)],
      footer: [sized('Confidential.', 14)],
    };
    expect(
      onReport(doc, QUALITY_CODES.TYPE_OFF_SCALE).flatMap(
        (finding) => finding.fixes ?? []
      )
    ).toEqual([
      {
        op: 'replace',
        path: '/children/0/props/header/0/props/font/size',
        value: 13,
      },
      {
        op: 'replace',
        path: '/children/0/props/footer/0/props/font/size',
        value: 13,
      },
    ]);
  });

  it('says nothing about chrome a block drew, on a theme whose scale never names its sizes', () => {
    // The running head paints 8pt from the theme's tracker role. On `minimal`
    // there is no such role and no scale, so an authored 8pt would be off
    // scale — but the author never wrote it and has no pointer to patch.
    const doc = report(
      block('running-head', { title: 'Report' }),
      para('Body.')
    );
    doc.props.theme = 'minimal';
    for (const code of [
      QUALITY_CODES.TYPE_OFF_SCALE,
      QUALITY_CODES.TYPE_ROLE_DRIFT,
    ]) {
      expect(onReport(doc, code)).toEqual([]);
    }
  });
});
