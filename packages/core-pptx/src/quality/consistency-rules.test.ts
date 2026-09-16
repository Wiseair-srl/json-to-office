/**
 * Theme-aware consistency (#332) in a deck: the theme says which sizes exist
 * and what each named style paints, the profile says whether a deck has to
 * keep to them, and where the titles sit is the deck's own convention rather
 * than anything a theme states. On the default profile none of this fires.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzePptxQuality } from './preflight';
import { preparePptxQualityDocument } from './facts';
import type { PresentationComponentDefinition } from '../types';

const CANVAS = { slideWidth: 13.333, slideHeight: 7.5, theme: 'consulting' };
const profile = (id: string) => ({ id, formats: ['pptx'] });
const deck = (...slides: unknown[]) => ({
  name: 'pptx',
  props: { ...CANVAS },
  children: slides,
});
const slide = (...children: unknown[]) => ({ name: 'slide', children });
const text = (
  content: string,
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'text',
  props: { text: content, x: 0.8, y: 0.6, w: 8, h: 1, ...props },
});
const templateDeck = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../jto/src/client/public/templates/consulting-deck-blocks.pptx.json',
        import.meta.url
      ),
      'utf8'
    )
  ) as PresentationComponentDefinition;
const findings = (doc: unknown, code: string, options = {}) =>
  analyzePptxQuality(doc, options).diagnostics.filter(
    (finding) => finding.code === code
  );
const onDeck = (doc: unknown, code: string) =>
  findings(doc, code, { profile: profile('consulting-deck') });

describe('a size off the theme scale', () => {
  it('is off by default and a warning on consulting-deck, with the nearest scale size as the fix', () => {
    const doc = deck(
      slide(text('Body one.', { style: 'body', fontSize: 15 })),
      slide(text('Body two.', { style: 'body', fontSize: 15 }))
    );
    expect(findings(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
    // One finding for the style at that size, patching both places together.
    expect(onDeck(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/0/props/fontSize',
        evidence: expect.objectContaining({
          actual: 15,
          expected: 14,
          unit: 'pt',
          values: { source: 'theme' },
        }),
        fixes: [
          {
            op: 'replace',
            path: '/children/0/children/0/props/fontSize',
            value: 14,
          },
          {
            op: 'replace',
            path: '/children/1/children/0/props/fontSize',
            value: 14,
          },
        ],
      }),
    ]);
  });
  it('says nothing about a size the theme does paint', () => {
    const doc = deck(
      slide(text('On the scale.', { style: 'body', fontSize: 14 }))
    );
    expect(onDeck(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
  });
  it('judges a custom theme by its own values', () => {
    const custom = {
      name: 'house',
      colors: {
        primary: '#123456',
        secondary: '#223344',
        accent: '#334455',
        background: '#FFFFFF',
        text: '#111111',
      },
      fonts: { heading: 'Arial', body: 'Arial' },
      defaults: { fontSize: 15, fontColor: '#111111' },
      styles: { body: { fontSize: 15 } },
    };
    const doc = {
      name: 'pptx',
      props: { slideWidth: 13.333, slideHeight: 7.5, theme: custom },
      children: [
        slide(
          text('Fifteen is this theme’s body.', { style: 'body', fontSize: 15 })
        ),
      ],
    };
    expect(onDeck(doc, QUALITY_CODES.TYPE_OFF_SCALE)).toEqual([]);
  });
});

describe('one style at two sizes', () => {
  it('is reported against the theme’s size for the style, and yields the off-scale finding', () => {
    const doc = deck(
      slide(text('Heading here.', { style: 'heading2' })),
      slide(text('Heading there.', { style: 'heading2', fontSize: 21 }))
    );
    expect(findings(doc, QUALITY_CODES.TYPE_ROLE_DRIFT)).toEqual([]);
    expect(onDeck(doc, QUALITY_CODES.TYPE_ROLE_DRIFT)).toEqual([
      expect.objectContaining({
        path: '/children/1/children/0/props/fontSize',
        evidence: expect.objectContaining({
          actual: 21,
          expected: 18,
          values: { role: 'heading2', source: 'theme' },
        }),
        fixes: [
          {
            op: 'replace',
            path: '/children/1/children/0/props/fontSize',
            value: 18,
          },
        ],
      }),
    ]);
    // The same pointer is not also reported as a size off the scale.
    expect(
      onDeck(doc, QUALITY_CODES.TYPE_OFF_SCALE).map((f) => f.path)
    ).not.toContain('/children/1/children/0/props/fontSize');
  });
  it('leaves a style that is consistently overridden alone', () => {
    const doc = deck(
      slide(text('Heading here.', { style: 'heading2', fontSize: 21 })),
      slide(text('Heading there.', { style: 'heading2', fontSize: 21 }))
    );
    expect(onDeck(doc, QUALITY_CODES.TYPE_ROLE_DRIFT)).toEqual([]);
  });
});

describe('a size nobody wrote', () => {
  it('offers no patch for the size the fit pass chose', () => {
    // The fit pass writes the shrunk size into the processed props. The
    // author wrote none, so there is no member a `replace` could reach.
    const doc = deck(
      slide(
        text('Revenue grew in every region this year', {
          style: 'title',
          w: 6,
          fit: { maxLines: 1, shrink: [23] },
        })
      )
    );
    expect(
      onDeck(doc, QUALITY_CODES.TYPE_OFF_SCALE).flatMap(
        (finding) => finding.fixes ?? []
      )
    ).toEqual([]);
  });
});

describe('the number of sizes a deck paints', () => {
  it('counts what reaches the slides and names the profile that set the ceiling', () => {
    const sizes = [9, 11, 15, 17, 19, 21, 23, 25, 27, 29];
    const doc = deck(
      ...sizes.map((size, i) => slide(text(`Line ${i}.`, { fontSize: size })))
    );
    expect(findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT)).toEqual([]);
    expect(onDeck(doc, QUALITY_CODES.TYPE_SIZE_COUNT)).toEqual([
      expect.objectContaining({
        path: '/props',
        context: expect.objectContaining({ scope: 'deck', maximum: 9 }),
        evidence: expect.objectContaining({
          actual: sizes.length,
          expected: 9,
          values: { source: 'profile' },
        }),
      }),
    ]);
  });

  it('names the policy, not the profile, when a policy set the ceiling', () => {
    const sizes = [9, 11, 15, 17, 19, 21, 23, 25];
    const doc = deck(
      ...sizes.map((size, i) => slide(text(`Line ${i}.`, { fontSize: size })))
    );
    const tightened = findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
      profile: profile('consulting-deck'),
      policy: {
        rules: { 'pptx/size-count': { parameters: { maximumSizes: 7 } } },
      },
    }).filter((finding) => finding.context?.scope === 'deck');
    expect(tightened).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('the quality policy allows 7'),
        evidence: expect.objectContaining({
          expected: 7,
          values: { source: 'policy' },
        }),
      }),
    ]);
  });

  it('counts each slide on its own, the page a deck is read by', () => {
    // Seven sizes on one slide, well inside the deck's nine: the slide is
    // what an audience takes in at once.
    const busy = slide(
      ...[10, 12, 14, 18, 24, 28, 32].map((size, i) =>
        text(`Level ${i}.`, { fontSize: size, y: 0.6 + i * 0.9, h: 0.8 })
      )
    );
    const doc = deck(busy, slide(text('Calm slide.', { fontSize: 18 })));
    expect(onDeck(doc, QUALITY_CODES.TYPE_SIZE_COUNT)).toEqual([
      expect.objectContaining({
        path: '/children/0',
        context: expect.objectContaining({ scope: 'slide', maximum: 6 }),
        evidence: expect.objectContaining({ actual: 7, expected: 6 }),
      }),
    ]);
    // Without a per-slide ceiling the same deck is within the deck's count.
    expect(
      findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
        policy: {
          rules: {
            'pptx/size-count': {
              enabled: true,
              parameters: { maximumSizes: 9, maximumSizesPerSlide: 0 },
            },
          },
        },
      })
    ).toEqual([]);
  });

  it('counts every size a run of rich text paints, and not a hidden slide', () => {
    const runs = slide({
      name: 'text',
      props: {
        x: 0.8,
        y: 0.6,
        w: 8,
        h: 2,
        runs: [
          { text: '40', fontSize: 40 },
          { text: ' units', fontSize: 14, breakLine: true },
          { text: 'Measured this quarter', fontSize: 11 },
        ],
      },
    });
    const hidden = {
      name: 'slide',
      props: { hidden: true },
      children: [
        text('Backup.', { fontSize: 9 }),
        text('More.', { fontSize: 13 }),
      ],
    };
    const doc = deck(runs, hidden);
    expect(
      findings(doc, QUALITY_CODES.TYPE_SIZE_COUNT, {
        policy: {
          rules: {
            'pptx/size-count': {
              enabled: true,
              parameters: { maximumSizes: 2 },
            },
          },
        },
      })
    ).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ sizes: [11, 14, 40] }),
      }),
    ]);
  });
});

describe('where the titles sit', () => {
  const title = (x: number, y: number) =>
    slide(text('An action title.', { style: 'title', x, y, w: 10, h: 1 }));
  const display = (content: string, props: Record<string, unknown> = {}) =>
    slide(
      text(content, { style: 'display', x: 0.5, y: 0.7, w: 10, h: 1, ...props })
    );
  const drift = (doc: unknown) => onDeck(doc, QUALITY_CODES.TITLE_DRIFT);

  it('is silent while the deck keeps one edge', () => {
    const doc = deck(title(0.8, 0.5), title(0.8, 0.5), title(0.8, 0.5));
    expect(drift(doc)).toEqual([]);
  });
  it('reports the title that leaves it, against the edge the others share and the titles sharing it', () => {
    const doc = deck(title(0.8, 0.5), title(0.8, 0.5), title(1.6, 0.5));
    expect(findings(doc, QUALITY_CODES.TITLE_DRIFT)).toEqual([]);
    expect(drift(doc)).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        relatedPaths: ['/children/0/children/0', '/children/1/children/0'],
        certainty: 'estimated',
        context: expect.objectContaining({ axes: ['left edge'] }),
        evidence: expect.objectContaining({
          actual: 115.2,
          expected: 57.6,
          unit: 'pt',
          values: {
            axis: 'left edge',
            lines: 1,
            fontSizePt: 32,
            verticalAlign: 'top',
            source: 'profile',
          },
        }),
      }),
    ]);
  });
  it('says nothing about one title, which has nothing to disagree with', () => {
    expect(drift(deck(title(0.8, 0.5)))).toEqual([]);
  });
  it('catches a hand-placed title set a little below the deck’s line', () => {
    const doc = deck(
      display('A hand-placed title.'),
      display('A hand-placed title.'),
      display('A hand-placed title.', { y: 1 })
    );
    // First baseline: the top of the text and four fifths of a 28pt em.
    expect(drift(doc)).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        context: expect.objectContaining({ axes: ['first baseline'] }),
        evidence: expect.objectContaining({ actual: 94.4, expected: 72.8 }),
      }),
    ]);
  });
  it('leaves a title placed well away as a placement of its own', () => {
    // A statement's assertion in the middle of the slide is not a content
    // title that slid down: past a couple of lines, a title is placed.
    const doc = deck(
      display('A content title.'),
      display('A content title.'),
      display('A statement.', { y: 3 })
    );
    expect(drift(doc)).toEqual([]);
  });

  it('reads a title where its vertical anchor sets the text, not where its box starts', () => {
    // Two boxes drawn differently, both anchored to a foot at 1.7in: one line
    // each, one baseline.
    const anchored = deck(
      display('Foot-anchored.', { y: 0.5, h: 1.2, valign: 'bottom' }),
      display('Foot-anchored.', { y: 0.5, h: 1.2, valign: 'bottom' }),
      display('Foot-anchored.', { y: 0.9, h: 0.8, valign: 'bottom' })
    );
    expect(drift(anchored)).toEqual([]);
    // One box, anchored to its foot: a title that wraps to two lines starts
    // a line higher than the ones that hold one.
    const long =
      'A title long enough to wrap onto a second line at display size';
    const wrapped = deck(
      display('One line.', { y: 0.5, h: 1.5, valign: 'bottom' }),
      display('One line.', { y: 0.5, h: 1.5, valign: 'bottom' }),
      display(long, { y: 0.5, h: 1.5, valign: 'bottom' })
    );
    expect(drift(wrapped)).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        evidence: expect.objectContaining({
          values: expect.objectContaining({
            lines: 2,
            verticalAlign: 'bottom',
          }),
        }),
      }),
    ]);
  });

  it('reads a title at the size the fit pass steps it down to', () => {
    const fit = { w: 6, fit: { maxLines: 1, shrink: [22] } };
    const doc = deck(
      display('Short title.', fit),
      display('Short title.', fit),
      display('A longer title that only fits at 22pt.', fit)
    );
    expect(drift(doc)).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        message: expect.stringContaining(
          'The fit pass sets it at 22pt, where they set at 28pt.'
        ),
        evidence: expect.objectContaining({
          values: expect.objectContaining({ fontSizePt: 22 }),
        }),
      }),
    ]);
  });

  it('reads the edge inside the text insets', () => {
    const inset = { margin: [0, 0, 0, 14] };
    expect(
      drift(
        deck(
          title(0.8, 0.5),
          title(0.8, 0.5),
          slide(
            text('An action title.', {
              style: 'title',
              x: 0.8,
              y: 0.5,
              w: 10,
              h: 1,
              ...inset,
            })
          )
        )
      )
    ).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        evidence: expect.objectContaining({ actual: 71.6, expected: 57.6 }),
      }),
    ]);
    // The same inset in a box drawn 14pt further left sets the text on the
    // edge the others share.
    expect(
      drift(
        deck(
          title(0.8, 0.5),
          title(0.8, 0.5),
          slide(
            text('An action title.', {
              style: 'title',
              x: 0.8 - 14 / 72,
              y: 0.5,
              w: 10,
              h: 1,
              ...inset,
            })
          )
        )
      )
    ).toEqual([]);
  });

  it('compares centred titles on their centre line', () => {
    const centred = (x: number, w: number) =>
      slide(
        text('A centred title.', {
          style: 'title',
          align: 'center',
          x,
          y: 0.5,
          w,
          h: 1,
        })
      );
    // Three boxes of two widths around one centre line.
    expect(
      drift(deck(centred(0.8, 10), centred(1.8, 8), centred(0.8, 10)))
    ).toEqual([]);
    expect(
      drift(deck(centred(0.8, 10), centred(0.8, 10), centred(1.2, 10)))
    ).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        context: expect.objectContaining({ axes: ['centre line'] }),
      }),
    ]);
  });

  it('compares a block’s titles with a title placed by hand, and names the titles it agrees with', () => {
    const doc = templateDeck() as PresentationComponentDefinition & {
      children: Array<Record<string, unknown>>;
    };
    const charts = doc.children.filter(
      (s: any) => s.children?.[0]?.props?.ref === 'action-chart'
    );
    expect(charts.length).toBeGreaterThan(0);
    // Where the block sets its title, read off the analysis itself.
    const prepared = preparePptxQualityDocument(doc);
    const slotNode = prepared.facts.find(
      (fact: any) =>
        fact.kind === 'pptx/chrome-slot' &&
        fact.role === 'actionTitle' &&
        fact.block === 'action-chart'
    ) as any;
    const painted = prepared.facts.find(
      (fact: any) =>
        fact.kind === 'pptx/text' && fact.nodePath === slotNode.nodePath
    ) as any;
    const placed = (nudgeIn: number) => ({
      ...doc,
      children: [
        ...doc.children,
        slide(
          text('A title placed by hand.', {
            style: 'display',
            x: painted.boxXPt / 72,
            y: painted.boxYPt / 72 + nudgeIn,
            w: painted.boxWidthPt / 72,
            h: painted.boxHeightPt / 72,
            valign: 'top',
          })
        ),
      ],
    });
    expect(drift(placed(0))).toEqual([]);
    const nudged = drift(placed(0.25));
    expect(nudged).toEqual([
      expect.objectContaining({
        path: `/children/${doc.children.length}/children/0`,
        context: expect.objectContaining({ axes: ['first baseline'] }),
      }),
    ]);
    expect(nudged[0].relatedPaths).toEqual(
      expect.arrayContaining([slotNode.path])
    );
  });

  it('reads a block’s title off the node its slot filled, not a box that reads alike', () => {
    // A tracker may repeat the title's words; it sits in the chrome band and
    // is not the title.
    const doc = templateDeck() as PresentationComponentDefinition & {
      children: Array<Record<string, unknown>>;
    };
    const same = 'Agenda';
    doc.children = ['Plan', 'Plan', same].map((tracker) => ({
      name: 'slide',
      children: [
        {
          name: 'block',
          props: {
            ref: 'two-column',
            slots: {
              title: same,
              tracker,
              text: 'Body.',
              content: {
                name: 'table',
                props: {
                  rows: [
                    ['Stage', 'Share'],
                    ['Intake', '94%'],
                  ],
                },
              },
              source: 'Source: s.',
            },
          },
        },
      ],
    }));
    expect(drift(doc)).toEqual([]);
  });

  it('compares titles across blocks and keeps the statement’s assertion a placement of its own', () => {
    const doc = analyzePptxQuality(templateDeck(), {
      profile: profile('consulting-deck'),
    });
    expect(
      doc.diagnostics.filter(
        (finding) => finding.code === QUALITY_CODES.TITLE_DRIFT
      )
    ).toEqual([]);
  });
});

describe('the running footer a deck keeps', () => {
  type Deck = PresentationComponentDefinition & {
    props: Record<string, any>;
    children: Array<Record<string, any>>;
  };
  const footers = (
    doc: unknown,
    options = { profile: profile('consulting-deck') }
  ) =>
    findings(doc, QUALITY_CODES.CHROME_MISSING, options).filter(
      (finding) => finding.ruleId === 'pptx/slide-footer'
    );
  /** The house deck with the statement block's page number taken out. */
  const withoutStatementNumber = (): Deck => {
    const doc = templateDeck() as Deck;
    const frame = doc.props.blocks.statement.body[0];
    frame.children = frame.children.filter(
      (child: any) =>
        !String(child?.props?.text ?? '').includes('{PAGE_NUMBER}')
    );
    return doc;
  };
  const statementSlide = (doc: Deck): number =>
    doc.children.findIndex(
      (slide) => slide.children?.[0]?.props?.ref === 'statement'
    );

  it('is satisfied by the house blocks, the cover exempt', () => {
    expect(footers(templateDeck())).toEqual([]);
  });

  it('reports a block-built slide that draws no page number, at the slide', () => {
    const doc = withoutStatementNumber();
    const index = statementSlide(doc);
    expect(index).toBeGreaterThan(0);
    expect(findings(doc, QUALITY_CODES.CHROME_MISSING)).toEqual([]);
    expect(footers(doc)).toEqual([
      expect.objectContaining({
        path: `/children/${index}`,
        context: { slide: index, missing: ['pageNumber'] },
        evidence: expect.objectContaining({
          expected: ['pageNumber'],
          values: { source: 'profile', fromSlide: 1 },
        }),
      }),
    ]);
  });

  it('leaves a slide drawn by coordinates, and a hidden slide, to their author', () => {
    const doc = withoutStatementNumber();
    const index = statementSlide(doc);
    doc.children[index].props = { ...doc.children[index].props, hidden: true };
    doc.children.push(
      slide(text('A slide placed by hand.', { style: 'body' }))
    );
    expect(footers(doc)).toEqual([]);
  });

  it('judges the cover too when a policy starts at the first slide', () => {
    const doc = templateDeck();
    expect(
      footers(doc, {
        policy: {
          rules: {
            'pptx/slide-footer': {
              parameters: { required: ['pageNumber'], fromSlide: 0 },
            },
          },
        },
      } as never).map((finding) => finding.path)
    ).toEqual(['/children/0']);
  });
});

describe('the consulting deck template', () => {
  it('is clean under the profile that turns every consistency rule on', () => {
    const codes = [
      QUALITY_CODES.TYPE_OFF_SCALE,
      QUALITY_CODES.TYPE_SIZE_COUNT,
      QUALITY_CODES.TYPE_ROLE_DRIFT,
      QUALITY_CODES.TITLE_DRIFT,
      QUALITY_CODES.CHROME_MISSING,
    ];
    const diagnostics = analyzePptxQuality(templateDeck(), {
      profile: profile('consulting-deck'),
    }).diagnostics.filter((finding) => codes.includes(finding.code as never));
    expect(diagnostics).toEqual([]);
  });
});
