/**
 * Inputs that the first corpus missed.
 *
 * Every case here is one a differential comparison against the pre-IR pipeline
 * flagged: nine were silent losses or layout changes and are now byte-identical
 * again, three are deliberate fixes recorded in
 * `docs/architecture/office-renderer-ir.md`.
 *
 * They live in their own file because they are not a feature area — they are
 * the specific shapes of input that a corpus built feature-by-feature does not
 * naturally reach: a prop that only matters when combined with another, a
 * default that only shows up when something else is absent.
 */

import type { CorpusCase } from './corpus';

const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const deck = (
  children: unknown[],
  props: Record<string, unknown> = {}
): CorpusCase['document'] =>
  ({
    name: 'pptx',
    props: { title: 'Corpus', author: 'JTO', ...props },
    children,
  }) as CorpusCase['document'];

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

export const CASES: CorpusCase[] = [
  // --- block bodies see the slide they are drawn on -----------------------
  {
    name: 'block/body-page-number',
    document: deck(
      [
        slide([
          { name: 'block', props: { ref: 'base' } },
          { name: 'text', props: { text: 'one' } },
        ]),
        slide([
          { name: 'block', props: { ref: 'base' } },
          { name: 'text', props: { text: 'two' } },
        ]),
      ],
      {
        blocks: {
          base: {
            slots: {},
            body: [
              {
                name: 'text',
                props: {
                  text: '{PAGE_NUMBER}/{PAGE_COUNT}',
                  x: 0.3,
                  y: 0.1,
                  w: 5,
                  h: 0.4,
                },
              },
            ],
          },
        },
      }
    ),
  },
  {
    name: 'block/body-language',
    document: deck(
      [
        slide([
          { name: 'block', props: { ref: 'base' } },
          { name: 'text', props: { text: 'corpo' } },
        ]),
      ],
      {
        language: 'it-IT',
        blocks: {
          base: {
            slots: {},
            body: [
              {
                name: 'text',
                props: { text: 'Intestazione', x: 0.3, y: 0.1, w: 5, h: 0.4 },
              },
            ],
          },
        },
      }
    ),
  },

  // --- component formatting cascades into every run -----------------------
  {
    name: 'text/runs-inherit-underline',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 1,
            y: 1,
            w: 5,
            h: 1,
            underline: true,
            runs: [{ text: 'one ' }, { text: 'two' }],
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/runs-inherit-strike',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 1,
            y: 1,
            w: 5,
            h: 1,
            strike: true,
            runs: [{ text: 'one ' }, { text: 'two' }],
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/runs-override-inherited-underline',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 1,
            y: 1,
            w: 5,
            h: 1,
            underline: true,
            runs: [{ text: 'kept ' }, { text: 'dropped', underline: false }],
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/body-hyperlink-over-runs',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            x: 1,
            y: 1,
            w: 5,
            h: 1,
            hyperlink: { url: 'https://example.com' },
            runs: [{ text: 'one ' }, { text: 'two ' }, { text: 'three' }],
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/underline-false',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            text: 'not underlined',
            x: 1,
            y: 1,
            w: 3,
            h: 1,
            underline: false,
          },
        },
      ]),
    ]),
  },
  {
    name: 'text/bullet-object-form',
    document: deck([
      slide([
        {
          name: 'text',
          props: {
            text: 'bulleted',
            x: 1,
            y: 1,
            w: 3,
            h: 1,
            bullet: { type: 'bullet' },
          },
        },
      ]),
    ]),
  },

  // --- defaults that only surface when something else is absent -----------
  {
    name: 'shape/empty-line-object',
    document: deck([
      slide([
        {
          name: 'shape',
          props: { type: 'rect', x: 1, y: 1, w: 2, h: 1, line: {} },
        },
      ]),
    ]),
  },
  {
    name: 'image/contain-without-box',
    document: deck([
      slide([
        {
          name: 'image',
          props: { base64: PNG_4X2, x: 1, y: 1, sizing: { type: 'contain' } },
        },
      ]),
    ]),
  },

  // --- rounded tables, where the backdrop geometry is derived -------------
  {
    name: 'table/rounded-single-column-width',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [
              [
                { text: 'H', fill: 'primary' },
                { text: 'I', fill: 'primary' },
                { text: 'J', fill: 'primary' },
              ],
              [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
            ],
            x: 1,
            y: 1,
            colW: [2],
            rowH: [0.5, 0.4],
            borderRadius: 0.15,
          },
        },
      ]),
    ]),
  },
  {
    name: 'table/rounded-percent-position',
    document: deck([
      slide([
        {
          name: 'table',
          props: {
            rows: [[{ text: 'H', fill: 'primary' }], [{ text: 'a' }]],
            x: '10%',
            y: '10%',
            colW: [3],
            rowH: [0.5, 0.4],
            borderRadius: 0.15,
          },
        },
      ]),
    ]),
  },

  // --- links on elements rather than on text ------------------------------
  // Two neighbours are absent because the schema does not allow them:
  // `ShapePropsSchema` has no `hyperlink`, and `image` has no `flipH`. Only a
  // picture *rotation* is authorable, which is what `image-transform` covers.
  {
    name: 'link/on-image',
    document: deck([
      slide([
        {
          name: 'image',
          props: {
            base64: PNG_4X2,
            x: 1,
            y: 1,
            w: 2,
            h: 1,
            hyperlink: { url: 'https://example.com' },
          },
        },
      ]),
    ]),
  },
  {
    name: 'image/rotated',
    document: deck([
      slide([
        {
          name: 'image',
          props: { base64: PNG_4X2, x: 1, y: 1, w: 2, h: 1, rotate: 30 },
        },
      ]),
    ]),
  },

  // --- geometry the IR does not have a preset name for -------------------
  {
    name: 'shape/arc-family',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'pie',
            x: 1,
            y: 1,
            w: 2,
            h: 2,
            fill: { color: 'primary' },
          },
        },
        {
          name: 'shape',
          props: {
            type: 'arc',
            x: 4,
            y: 1,
            w: 2,
            h: 2,
            fill: { color: 'accent' },
          },
        },
        {
          name: 'shape',
          props: {
            type: 'blockArc',
            x: 7,
            y: 1,
            w: 2,
            h: 2,
            fill: { color: 'secondary' },
          },
        },
      ]),
    ]),
  },
  {
    name: 'shape/geometry-aliases',
    document: deck([
      slide([
        {
          name: 'shape',
          props: {
            type: 'arrow',
            x: 1,
            y: 1,
            w: 2,
            h: 1,
            fill: { color: 'primary' },
          },
        },
        {
          name: 'shape',
          props: {
            type: 'lightning',
            x: 4,
            y: 1,
            w: 1,
            h: 2,
            fill: { color: 'accent' },
          },
        },
      ]),
    ]),
  },
];
