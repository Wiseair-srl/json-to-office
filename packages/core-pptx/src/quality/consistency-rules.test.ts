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
  it('is silent while the deck keeps one edge', () => {
    const doc = deck(title(0.8, 0.5), title(0.8, 0.5), title(0.8, 0.5));
    expect(onDeck(doc, QUALITY_CODES.TITLE_DRIFT)).toEqual([]);
  });
  it('reports the title that leaves it, against the edge the others share', () => {
    const doc = deck(title(0.8, 0.5), title(0.8, 0.5), title(1.6, 0.5));
    expect(findings(doc, QUALITY_CODES.TITLE_DRIFT)).toEqual([]);
    expect(onDeck(doc, QUALITY_CODES.TITLE_DRIFT)).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        evidence: expect.objectContaining({
          actual: 115.2,
          expected: 57.6,
          unit: 'pt',
          values: { axis: 'left edge', source: 'profile' },
        }),
      }),
    ]);
  });
  it('says nothing about one title, which has nothing to disagree with', () => {
    expect(onDeck(deck(title(0.8, 0.5)), QUALITY_CODES.TITLE_DRIFT)).toEqual(
      []
    );
  });
  it('catches a hand-placed title that sits below the deck’s line', () => {
    const displayTitle = (y: number) =>
      slide(
        text('A hand-placed title.', {
          style: 'display',
          x: 0.5,
          y,
          w: 10,
          h: 1,
        })
      );
    const doc = deck(displayTitle(0.7), displayTitle(0.7), displayTitle(2.4));
    expect(onDeck(doc, QUALITY_CODES.TITLE_DRIFT)).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0',
        context: expect.objectContaining({ axes: ['baseline'] }),
        evidence: expect.objectContaining({
          actual: 172.8,
          expected: 50.4,
          values: { axis: 'baseline', source: 'profile' },
        }),
      }),
    ]);
  });
  it('compares a block’s titles only with that block’s other titles', () => {
    // The deck's statement slide centres its assertion on purpose; it is not
    // drifting from the action-chart titles above it.
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

describe('the consulting deck template', () => {
  it('is clean under the profile that turns every consistency rule on', () => {
    const codes = [
      QUALITY_CODES.TYPE_OFF_SCALE,
      QUALITY_CODES.TYPE_SIZE_COUNT,
      QUALITY_CODES.TYPE_ROLE_DRIFT,
      QUALITY_CODES.TITLE_DRIFT,
    ];
    const diagnostics = analyzePptxQuality(templateDeck(), {
      profile: profile('consulting-deck'),
    }).diagnostics.filter((finding) => codes.includes(finding.code as never));
    expect(diagnostics).toEqual([]);
  });
});
