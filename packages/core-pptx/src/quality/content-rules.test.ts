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
  it('reports its bullets once, at the invocation that drew them', () => {
    const doc = twice('One.\nTwo.\nThree.\nFour.\nFive.\nSix.');
    // The box is the definition's, not the slot's — the definition supplies
    // the bullet and the frame — so the invocation is what the author holds.
    expect(onDeck(doc, QUALITY_CODES.BULLET_COUNT)).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1',
        evidence: expect.objectContaining({ actual: 6, expected: 5 }),
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
