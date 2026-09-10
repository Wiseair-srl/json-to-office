/**
 * #361 — every chrome recipe and the motif reach the page.
 *
 * The inventory this pins is in `docs/reference/themes.md`: for each recipe,
 * which composition draws it, and what a theme that states nothing gets
 * instead. Two claims per row, both read off the expanded document rather
 * than the definition, so a binding that stops resolving fails here:
 *
 * - **inherit**: on a theme that declares no chrome, the value falls through
 *   to the type role the composition names, and then to the literal it
 *   declares — the documented fallback.
 * - **override**: on a custom theme whose recipe is deliberately mutated, the
 *   recipe's value wins over the role's.
 *
 * `minimal` is the theme that declares nothing; `consulting` is the theme
 * whose recipes are mutated. Neither is edited in place.
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '@json-to-office/shared-docx';
import { generateBufferWithWarnings } from '../../core/generator';
import { resolveDocxDesignSystem } from '../../themes/design-system';
import { expandBlocks } from '../index';
import { consultingTheme, minimalTheme } from '../../styles';
import type { ThemeConfig } from '../../styles';
import { block, example, on } from './example';

/** The theme as generation sees it: roles materialized, `motif: none` dropped. */
const resolved = (theme: ThemeConfig) =>
  resolveDocxDesignSystem(structuredClone(theme) as ThemeConfig);

/** A copy of `theme` with one JSON-pointer path replaced. */
function mutate(
  theme: ThemeConfig,
  pointer: string,
  value: unknown
): ThemeConfig {
  const copy = structuredClone(theme) as Record<string, any>;
  const parts = pointer.slice(1).split('/');
  let node = copy;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  if (value === undefined) delete node[parts[parts.length - 1]];
  else node[parts[parts.length - 1]] = value;
  return copy as ThemeConfig;
}

const expandOn = (theme: ThemeConfig, ...blocks: unknown[]) => {
  const doc = example();
  doc.children = [{ name: 'section', children: blocks }];
  return expandBlocks(doc, resolved(theme)) as any;
};

/** Every node of the expanded document, in order. */
function nodes(expanded: any): any[] {
  const out: any[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') out.push(record);
    for (const child of Object.values(record)) walk(child);
  };
  walk(expanded.document.children);
  return out;
}
const withText = (expanded: any, text: string) =>
  nodes(expanded).find((node) => node.props?.text === text);

const REPORT = [
  block('cover', {
    title: 'Title',
    subtitle: 'Subtitle',
    client: 'Client',
    date: 'Date',
    confidentiality: 'Confidential',
  }),
  block('key-takeaways', { label: 'Key takeaways', items: ['A', 'B', 'C'] }),
  block('section-opener', { number: '01', title: 'Opener' }),
  block('source-line', { text: 'Company filings' }),
];

interface Row {
  /** The recipe field, as its pointer into the theme. */
  pointer: string;
  /** A pointer to drop first, when a recipe earlier in the chain shadows this one. */
  shadowedBy?: string;
  /** A value no role or literal in the composition could produce. */
  mutation: unknown;
  /** What the composition should paint when the theme states nothing. */
  inherited: unknown;
  read: (expanded: any) => unknown;
}

const ROWS: Record<string, Row> = {
  'cover.type': {
    pointer: '/chrome/cover/type',
    mutation: 'quote',
    inherited: 'display',
    read: (e) => withText(e, 'Title')?.props.themeStyle,
  },
  'cover.color': {
    pointer: '/chrome/cover/color',
    mutation: 'negative',
    inherited: 'textPrimary',
    read: (e) => withText(e, 'Title')?.props.font.color,
  },
  'keyTakeaways.type': {
    pointer: '/chrome/keyTakeaways/type',
    mutation: 'quote',
    inherited: 'label',
    read: (e) => withText(e, 'Key takeaways')?.props.themeStyle,
  },
  'keyTakeaways.color': {
    pointer: '/chrome/keyTakeaways/color',
    mutation: 'negative',
    inherited: 'textPrimary',
    read: (e) => withText(e, 'Key takeaways')?.props.font.color,
  },
  'actionTitle.color': {
    pointer: '/chrome/actionTitle/color',
    mutation: 'negative',
    inherited: 'primary',
    read: (e) => withText(e, 'Opener')?.props.font.color,
  },
  'sourceLine.type': {
    pointer: '/chrome/sourceLine/type',
    mutation: 'quote',
    inherited: 'source',
    read: (e) => withText(e, 'Company filings')?.props.themeStyle,
  },
  'sourceLine.color': {
    pointer: '/chrome/sourceLine/color',
    mutation: 'negative',
    inherited: 'textMuted',
    read: (e) => withText(e, 'Company filings')?.props.font.color,
  },
  'logoSlot.alignment': {
    pointer: '/chrome/logoSlot/alignment',
    mutation: 'center',
    inherited: 'left',
    read: (e) =>
      nodes(e).find((node) => node.name === 'image')?.props.alignment,
  },
};

/** The running head is chrome, so it is read off the section, not the body. */
const headOn = (theme: ThemeConfig) => {
  const doc = example();
  doc.children = [
    {
      name: 'section',
      children: [
        block('running-head', { title: 'Head', confidentiality: 'C' }),
      ],
    },
  ];
  const expanded = expandBlocks(doc, resolved(theme)) as any;
  const { header, footer } = expanded.document.children[0].props;
  return { header: header?.[0], footer: footer?.[1] };
};

const HEAD_ROWS: Record<string, Row> = {
  // The band recipe wins over the text recipe, so the tracker rows are read
  // on a theme whose running head states nothing of its own.
  'tracker.type': {
    pointer: '/chrome/tracker/type',
    shadowedBy: '/chrome/runningHead/type',
    mutation: 'quote',
    inherited: 'tracker',
    read: (e) => e.header?.props.themeStyle,
  },
  'tracker.color': {
    pointer: '/chrome/tracker/color',
    shadowedBy: '/chrome/runningHead/color',
    mutation: 'negative',
    inherited: 'textMuted',
    read: (e) => e.header?.props.font.color,
  },
  'runningHead.type': {
    pointer: '/chrome/runningHead/type',
    mutation: 'label',
    inherited: 'tracker',
    read: (e) => e.header?.props.themeStyle,
  },
  'runningHead.color': {
    pointer: '/chrome/runningHead/color',
    mutation: 'positive',
    inherited: 'textMuted',
    read: (e) => e.header?.props.font.color,
  },
  'runningHead.alignment': {
    pointer: '/chrome/runningHead/alignment',
    mutation: 'center',
    inherited: 'right',
    read: (e) => e.header?.props.alignment,
  },
  'confidentialFooter.type': {
    pointer: '/chrome/confidentialFooter/type',
    mutation: 'quote',
    inherited: 'footer',
    read: (e) => e.footer?.props.themeStyle,
  },
  'confidentialFooter.color': {
    pointer: '/chrome/confidentialFooter/color',
    mutation: 'negative',
    inherited: 'textMuted',
    read: (e) => e.footer?.props.font.color,
  },
  'confidentialFooter.alignment': {
    pointer: '/chrome/confidentialFooter/alignment',
    mutation: 'center',
    inherited: 'left',
    read: (e) => e.footer?.props.alignment,
  },
};

const LOGO = {
  name: 'image',
  props: { path: 'data:image/png;base64,iVBORw0KGgo=' },
};

describe('theme chrome recipes reach the page', () => {
  const report = (theme: ThemeConfig) =>
    expandOn(
      theme,
      block('cover', {
        title: 'Title',
        subtitle: 'Subtitle',
        client: 'Client',
        date: 'Date',
        confidentiality: 'Confidential',
        logo: LOGO,
      }),
      ...REPORT.slice(1)
    );

  it.each(Object.entries(ROWS))(
    '%s falls through to the role on a theme that states none',
    (_name, row) => {
      expect(row.read(report(minimalTheme))).toBe(row.inherited);
    }
  );

  it.each(Object.entries(ROWS))(
    '%s overrides the role when the theme states one',
    (_name, row) => {
      const mutated = mutate(consultingTheme, row.pointer, row.mutation);
      expect(row.read(report(mutated))).toBe(row.mutation);
    }
  );

  it.each(Object.entries(HEAD_ROWS))(
    'running head %s falls through to the role on a theme that states none',
    (_name, row) => {
      expect(row.read(headOn(minimalTheme))).toBe(row.inherited);
    }
  );

  it.each(Object.entries(HEAD_ROWS))(
    'running head %s overrides the role when the theme states one',
    (_name, row) => {
      const base = row.shadowedBy
        ? mutate(consultingTheme, row.shadowedBy, undefined)
        : consultingTheme;
      expect(row.read(headOn(mutate(base, row.pointer, row.mutation)))).toBe(
        row.mutation
      );
    }
  );

  it('draws the source line’s own rule when the theme states one', () => {
    const mutated = mutate(consultingTheme, '/chrome/sourceLine/rule', {
      weightPt: 4,
      color: 'negative',
    });
    const rules = nodes(report(mutated)).filter(
      (node) => node.name === 'divider' && node.props.thickness === 4
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].props.color).toBe('negative');
  });

  it('pads the takeaways rules off the content by padPt', () => {
    const mutated = mutate(consultingTheme, '/chrome/keyTakeaways/padPt', 21);
    const gaps = nodes(report(mutated))
      .filter((node) => node.name === 'divider')
      .flatMap((node) => [
        node.props.spacing?.before,
        node.props.spacing?.after,
      ]);
    expect(gaps.filter((gap) => gap === 21)).toHaveLength(2);
  });

  it('draws the takeaways rule and the cover rule from their recipes', () => {
    const mutated = mutate(
      mutate(consultingTheme, '/chrome/cover/rule/weightPt', 6),
      '/chrome/keyTakeaways/rule/weightPt',
      5
    );
    const dividers = nodes(report(mutated))
      .filter((node) => node.name === 'divider')
      .map((node) => node.props.thickness);
    expect(dividers).toContain(6);
    expect(dividers).toContain(5);
  });
});

describe('the theme motif', () => {
  const covers = (theme: ThemeConfig) =>
    nodes(expandOn(theme, block('cover', { title: 'Title' }))).filter(
      (node) => node.name === 'divider'
    );

  it('marks the top edge of the cover with the theme’s own weight', () => {
    const marks = covers(mutate(consultingTheme, '/motif/weightPt', 7));
    expect(marks[0].props).toMatchObject({ thickness: 7, width: '22%' });
  });

  it('is absent on a theme that declares none', () => {
    expect(covers(minimalTheme).map((d) => d.props.width)).toEqual([undefined]);
  });

  it('is absent when the theme declares kind none', () => {
    const none = mutate(consultingTheme, '/motif', { kind: 'none' });
    expect(covers(none).map((d) => d.props.width)).toEqual([undefined]);
  });
});

describe('type roles reach block paragraphs', () => {
  it('names the role so its face, case and tracking are the theme’s', async () => {
    const doc = on('consulting', block('source-line', { text: 'Filings' }));
    const source = withText(
      expandBlocks(doc, resolved(consultingTheme)),
      'Filings'
    );
    // The role is named and the body face is no longer pinned, so the run
    // inherits face, case and tracking from the style the theme built.
    expect(source?.props.themeStyle).toBe('source');
    expect(source?.props.font.family).toBeUndefined();
  });

  it('generates warning-clean on a theme with no roles at all', async () => {
    const doc = on('minimal', ...REPORT);
    expect(validateDocument(doc).errors).toEqual([]);
    const { warnings } = await generateBufferWithWarnings(doc);
    expect(warnings).toEqual([]);
  });
});
