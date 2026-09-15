/**
 * Content hierarchy and slide integrity (#347) in a deck: what an audience
 * trips over — a wall of bullets, content in the margin, a slide nothing
 * names, a picture out of shape. Each is off until a profile turns it on,
 * except the aspect check, which reads the asset rather than a convention.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzePptxQuality } from './preflight';

const CANVAS = { slideWidth: 13.333, slideHeight: 7.5, theme: 'consulting' };
const profile = (id: string) => ({ id, formats: ['pptx'] });
const deck = (...slides: unknown[]) => ({
  name: 'pptx',
  props: { ...CANVAS },
  children: slides,
});
const slide = (...children: unknown[]) => ({ name: 'slide', children });
const title = (text = 'The claim this slide makes') => ({
  name: 'text',
  props: { text, style: 'title', x: 0.5, y: 0.5, w: 11, h: 1 },
});
const findings = (doc: unknown, code: string, options = {}) =>
  analyzePptxQuality(doc, options).diagnostics.filter(
    (finding) => finding.code === code
  );
const onDeck = (doc: unknown, code: string) =>
  findings(doc, code, { profile: profile('consulting-deck') });
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';
const bullets = (items: string[]) => ({
  name: 'text',
  props: {
    text: items.join('\n'),
    bullet: true,
    x: 0.8,
    y: 2,
    w: 11,
    h: 4,
  },
});

describe('bullets on a slide', () => {
  it('are reported past the profile’s count', () => {
    const many = deck(
      slide(
        title(),
        bullets(['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'])
      )
    );
    expect(findings(many, QUALITY_CODES.BULLET_COUNT)).toEqual([]);
    expect(onDeck(many, QUALITY_CODES.BULLET_COUNT)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1',
        evidence: expect.objectContaining({ actual: 6, expected: 5 }),
      }),
    ]);
  });
  it('are reported past the profile’s length, at the box that holds them', () => {
    const long = deck(
      slide(
        title(),
        bullets([
          'One.',
          'A bullet that keeps going well past the point at which it stopped being a bullet at all.',
        ])
      )
    );
    expect(onDeck(long, QUALITY_CODES.BULLET_LENGTH)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1',
        evidence: expect.objectContaining({ expected: 12, unit: 'words' }),
      }),
    ]);
  });
  it('hold a single bullet to the same length', () => {
    const one = deck(
      slide(
        title(),
        bullets([
          'A lone bullet that keeps going well past the point at which it stopped being a bullet at all.',
        ])
      )
    );
    expect(onDeck(one, QUALITY_CODES.BULLET_LENGTH)).toEqual([
      expect.objectContaining({ path: '/children/0/children/1' }),
    ]);
    expect(onDeck(one, QUALITY_CODES.BULLET_COUNT)).toEqual([]);
  });
  it('are held to the executive profile too', () => {
    const many = deck(
      slide(
        title(),
        bullets(['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'])
      )
    );
    expect(
      findings(many, QUALITY_CODES.BULLET_COUNT, {
        profile: profile('executive-presentation'),
      })
    ).toEqual([expect.objectContaining({ path: '/children/0/children/1' })]);
  });
  it('pass at exactly five of exactly twelve words', () => {
    const twelve =
      'One two three four five six seven eight nine ten eleven twelve.';
    const edge = deck(slide(title(), bullets(Array(5).fill(twelve))));
    expect(onDeck(edge, QUALITY_CODES.BULLET_COUNT)).toEqual([]);
    expect(onDeck(edge, QUALITY_CODES.BULLET_LENGTH)).toEqual([]);
  });
  it('say nothing while they stay inside both bounds', () => {
    const fine = deck(
      slide(title(), bullets(['One.', 'Two claims here.', 'Three.']))
    );
    expect(onDeck(fine, QUALITY_CODES.BULLET_COUNT)).toEqual([]);
    expect(onDeck(fine, QUALITY_CODES.BULLET_LENGTH)).toEqual([]);
  });
});

describe('the theme’s safe area', () => {
  it('reports content that crosses it and names the edge', () => {
    const outside = deck(
      slide(title(), {
        name: 'text',
        props: { text: 'In the margin.', x: 0.1, y: 3, w: 4, h: 1 },
      })
    );
    expect(findings(outside, QUALITY_CODES.SAFE_AREA)).toEqual([]);
    expect(onDeck(outside, QUALITY_CODES.SAFE_AREA)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1',
        context: expect.objectContaining({ edges: ['left'], safeAreaPt: 36 }),
        evidence: expect.objectContaining({ values: { source: 'theme' } }),
      }),
    ]);
  });
  it('lets a full bleed run edge to edge', () => {
    const band = deck(
      slide(title(), {
        name: 'shape',
        props: {
          type: 'rect',
          x: 0,
          y: 0,
          w: 13.333,
          h: 0.6,
          fill: { color: 'primary' },
        },
      })
    );
    expect(onDeck(band, QUALITY_CODES.SAFE_AREA)).toEqual([]);
  });
  it('judges every box a block draws on its own, and lets its chrome alone', () => {
    // One block draws a footer in the margin band and a panel that crosses
    // the safe area. Both report at the one invocation, so reading chrome off
    // that pointer used to excuse the panel with the footer.
    const doc = {
      name: 'pptx',
      props: {
        ...CANVAS,
        blocks: {
          framed: {
            slots: { note: { type: 'string', role: 'source' } },
            body: [
              {
                name: 'text',
                props: {
                  text: 'A panel in the margin.',
                  x: '1%',
                  y: '40%',
                  w: '40%',
                  h: '20%',
                },
              },
              {
                name: 'text',
                props: {
                  text: '1 / 12',
                  style: 'footer',
                  x: '1%',
                  y: '94%',
                  w: '15%',
                  h: '4%',
                },
              },
              {
                name: 'text',
                props: {
                  text: { $slot: '/note' },
                  x: '20%',
                  y: '94%',
                  w: '50%',
                  h: '4%',
                },
              },
            ],
          },
        },
      },
      children: [
        slide(title(), {
          name: 'block',
          props: { ref: 'framed', slots: { note: 'Source: company data' } },
        }),
      ],
    };
    expect(onDeck(doc, QUALITY_CODES.SAFE_AREA)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1',
        message: expect.stringContaining('left'),
      }),
    ]);
  });
  it('lets chrome sit in the margin band', () => {
    const footer = deck(
      slide(title(), {
        name: 'text',
        props: {
          text: '1 / 12',
          style: 'footer',
          x: 0.2,
          y: 7.05,
          w: 2,
          h: 0.3,
        },
      })
    );
    expect(onDeck(footer, QUALITY_CODES.SAFE_AREA)).toEqual([]);
  });
});

describe('a slide nothing names', () => {
  it('is reported when it carries content', () => {
    const untitled = deck(
      slide({
        name: 'text',
        props: { text: 'A claim, unlabelled.', x: 1, y: 2, w: 8, h: 1 },
      })
    );
    expect(findings(untitled, QUALITY_CODES.SLIDE_UNTITLED)).toEqual([]);
    expect(onDeck(untitled, QUALITY_CODES.SLIDE_UNTITLED)).toEqual([
      expect.objectContaining({ path: '/children/0' }),
    ]);
  });
  it('is silent on a divider drawn from a shape with no words', () => {
    const rule = deck(
      slide({
        name: 'shape',
        props: {
          type: 'rect',
          x: 5,
          y: 3,
          w: 3,
          h: 0.1,
          fill: { color: 'accent' },
        },
      })
    );
    expect(onDeck(rule, QUALITY_CODES.SLIDE_UNTITLED)).toEqual([]);
    // A shape that says something is content, whatever it is drawn as.
    const claim = deck(
      slide({
        name: 'shape',
        props: { type: 'rect', x: 5, y: 3, w: 3, h: 1, text: 'A claim' },
      })
    );
    expect(onDeck(claim, QUALITY_CODES.SLIDE_UNTITLED)).toEqual([
      expect.objectContaining({ path: '/children/0' }),
    ]);
  });
  it('knows a title written as rich-text runs', () => {
    const runsTitle = deck(
      slide(
        {
          name: 'text',
          props: {
            style: 'title',
            x: 0.5,
            y: 0.5,
            w: 11,
            h: 1,
            runs: [{ text: 'Revenue ' }, { text: 'grew 12%', bold: true }],
          },
        },
        {
          name: 'text',
          props: { text: 'Body.', x: 1, y: 2, w: 8, h: 1 },
        }
      )
    );
    expect(onDeck(runsTitle, QUALITY_CODES.SLIDE_UNTITLED)).toEqual([]);
  });
  it('is reported under the executive profile as well', () => {
    const untitled = deck(
      slide({
        name: 'text',
        props: { text: 'A claim, unlabelled.', x: 1, y: 2, w: 8, h: 1 },
      })
    );
    expect(
      findings(untitled, QUALITY_CODES.SLIDE_UNTITLED, {
        profile: profile('executive-presentation'),
      })
    ).toEqual([expect.objectContaining({ path: '/children/0' })]);
  });
  it('is silent on a titled slide, and on a slide carrying only chrome', () => {
    expect(
      onDeck(
        deck(
          slide(title(), {
            name: 'text',
            props: { text: 'Body.', x: 1, y: 2, w: 8, h: 1 },
          })
        ),
        QUALITY_CODES.SLIDE_UNTITLED
      )
    ).toEqual([]);
    expect(
      onDeck(
        deck(
          slide({
            name: 'text',
            props: {
              text: '1 / 12',
              style: 'footer',
              x: 1,
              y: 7,
              w: 2,
              h: 0.3,
            },
          })
        ),
        QUALITY_CODES.SLIDE_UNTITLED
      )
    ).toEqual([]);
  });
});

describe('a slot a definition draws twice', () => {
  // A definition may draw one slot at two frames. Both boxes report at the
  // slot the author wrote, so the reader must get one finding, not two.
  const twice = (points: string) => ({
    name: 'pptx',
    props: {
      ...CANVAS,
      blocks: {
        twice: {
          slots: { points: { type: 'string' } },
          body: [
            {
              name: 'group',
              props: { x: '0%', y: '0%', w: '100%', h: '100%' },
              children: [0, 1].map((column) => ({
                name: 'text',
                props: {
                  text: { $slot: '/points' },
                  bullet: true,
                  x: `${column * 50}%`,
                  y: '30%',
                  w: '40%',
                  h: '50%',
                },
              })),
            },
          ],
        },
      },
    },
    children: [
      {
        name: 'slide',
        children: [
          title(),
          { name: 'block', props: { ref: 'twice', slots: { points } } },
        ],
      },
    ],
  });
  it('reports its bullets once, at the slot that holds them', () => {
    const doc = twice('One.\nTwo.\nThree.\nFour.\nFive.\nSix.');
    // The definition draws the frame and sets the bullet, but the bullets
    // are the slot's text: cutting them is an edit to the slot.
    expect(onDeck(doc, QUALITY_CODES.BULLET_COUNT)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1/props/slots/points',
        evidence: expect.objectContaining({ actual: 6, expected: 5 }),
      }),
    ]);
  });
});

describe('a picture nothing names', () => {
  const picture = (props: Record<string, unknown>) => ({
    name: 'image',
    props: { base64: PNG_4X2, x: 1, y: 2, w: 4, h: 2, ...props },
  });
  it('is reported without alt text under the profile, at the image', () => {
    const bare = deck(slide(title(), picture({})));
    expect(findings(bare, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([]);
    expect(onDeck(bare, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([
      expect.objectContaining({ path: '/children/0/children/1' }),
    ]);
  });
  it('is silent with alt text, and on a background that bleeds off the slide', () => {
    expect(
      onDeck(
        deck(slide(title(), picture({ alt: 'Revenue by region, 2026' }))),
        QUALITY_CODES.FIGURE_UNLABELLED
      )
    ).toEqual([]);
    expect(
      onDeck(
        deck(slide(title(), picture({ x: 0, y: 0, w: 13.333, h: 7.5 }))),
        QUALITY_CODES.FIGURE_UNLABELLED
      )
    ).toEqual([]);
    expect(
      onDeck(
        deck(slide(title(), picture({ alt: '   ' }))),
        QUALITY_CODES.FIGURE_UNLABELLED
      )
    ).toHaveLength(1);
  });
  it('asks for the alt text at the slot an image filled', () => {
    const doc = {
      name: 'pptx',
      props: {
        ...CANVAS,
        blocks: {
          framed: {
            slots: { picture: { type: 'component' } },
            body: [
              {
                $slot: '/picture',
                props: { x: '10%', y: '30%', w: '40%' },
              },
            ],
          },
        },
      },
      children: [
        slide(title(), {
          name: 'block',
          props: {
            ref: 'framed',
            slots: { picture: { name: 'image', props: { base64: PNG_4X2 } } },
          },
        }),
      ],
    };
    expect(onDeck(doc, QUALITY_CODES.FIGURE_UNLABELLED)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1/props/slots/picture',
      }),
    ]);
  });
});

describe('an image drawn out of shape', () => {
  const logo = (props: Record<string, unknown>) => ({
    name: 'image',
    props: { base64: PNG_4X2, ...props },
  });
  it('is reported against the asset the deck carries, on any profile', () => {
    const stretched = deck(slide(title(), logo({ x: 1, y: 2, w: 4, h: 1 })));
    expect(findings(stretched, QUALITY_CODES.IMAGE_ASPECT)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1',
        evidence: expect.objectContaining({ actual: 4, expected: 2 }),
      }),
    ]);
  });
  it('says nothing when the asset cannot be read from the deck', () => {
    expect(
      findings(
        deck(
          slide(title(), {
            name: 'image',
            props: { path: 'assets/logo.png', x: 1, y: 2, w: 4, h: 1 },
          })
        ),
        QUALITY_CODES.IMAGE_ASPECT
      )
    ).toEqual([]);
  });
  it('says nothing when the shape is the asset’s, when it is fitted, or when one side follows', () => {
    for (const props of [
      { x: 1, y: 2, w: 4, h: 2 },
      { x: 1, y: 2, w: 4, h: 1, sizing: { type: 'contain' } },
      { x: 1, y: 2, w: 4 },
    ])
      expect(
        findings(deck(slide(title(), logo(props))), QUALITY_CODES.IMAGE_ASPECT)
      ).toEqual([]);
  });
});
