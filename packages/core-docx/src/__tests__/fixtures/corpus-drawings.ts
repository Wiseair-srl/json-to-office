/**
 * The DOCX parity corpus — native drawings.
 *
 * A `visual` with `renderMode: "native"` is a Word drawing group (`wpg:wgp`)
 * of real shapes, text boxes and pictures, drawn by the backend itself with no
 * rasterizer — so unlike a raster visual it needs no service, and belongs in
 * the corpus. Both backends draw it, so these cases also reach the
 * cross-backend comparison.
 *
 * The cases cover what the docx.js adapter has to state or repair itself: a
 * canvas with a background and one without (which docx.js pads with an
 * invisible child to keep the child space), a fractional rotation with both
 * flips, an outline with a colour and no width, transparency, dashes, zero
 * text insets, cropped and contained pictures with alt text, and a group
 * floating with a caption, in a table cell and in a header.
 *
 * Two rules keep the cases comparable across backends. No child reaches past
 * its canvas — the backends deliberately differ on overflow, and the
 * comparison checks every `wp:extent` — and no picture is an SVG, whose PNG
 * fallback is rasterized by a native renderer whose bytes are not guaranteed
 * to match across platforms.
 */

import type { CorpusCase } from './corpus-types';

/** A 4x2 PNG, so the cover crop and the contain fit have something to do. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR42mOIrt34HxkzoAsAAE/xFEFoJgXRAAAAAElFTkSuQmCC';

const doc = (
  children: unknown[],
  sectionProps: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Drawings corpus', author: 'JTO' },
  },
  children: [{ name: 'section', props: sectionProps, children }],
});

const visual = (props: Record<string, unknown>) => ({
  name: 'visual',
  props: { renderMode: 'native', ...props },
});

const paragraph = (text: string) => ({ name: 'paragraph', props: { text } });

/** A small labelled panel, for the placements that need one. */
const badge = (label: string, extra: Record<string, unknown> = {}) =>
  visual({
    canvas: { width: 2, height: 0.75, background: { color: '#E0F2FE' } },
    elements: [
      {
        name: 'text',
        props: {
          text: label,
          x: 0.1,
          y: 0.15,
          w: 1.8,
          h: 0.45,
          fontSize: 11,
          bold: true,
          align: 'center',
          valign: 'middle',
        },
      },
    ],
    ...extra,
  });

export const CASES: CorpusCase[] = [
  {
    name: 'drawings/native-visual-basic',
    document: doc([
      paragraph('Before the drawing.'),
      visual({
        alt: 'A rounded panel beside two labels',
        canvas: { width: 6, height: 2.5, background: { color: '#F5F7FA' } },
        elements: [
          {
            name: 'shape',
            props: {
              type: 'roundRect',
              x: 0.25,
              y: 0.25,
              w: 2.5,
              h: 1.25,
              fill: { color: '#0F172A', transparency: 20 },
              line: { color: '#334155', width: 1.5, dashType: 'dash' },
              text: 'Quarterly focus',
              fontColor: '#FFFFFF',
              align: 'center',
              valign: 'middle',
            },
          },
          {
            name: 'text',
            props: {
              text: 'Editable Word content',
              x: 3,
              y: 0.4,
              w: 2.75,
              h: 0.5,
              fontSize: 18,
              bold: true,
              margin: 0,
            },
          },
          {
            name: 'text',
            props: {
              text: 'Every object stays selectable.',
              x: 3,
              y: 1.1,
              w: 2.75,
              h: 0.5,
              fontSize: 11,
              color: '#334155',
              valign: 'bottom',
            },
          },
        ],
      }),
      paragraph('After the drawing.'),
    ]),
  },
  {
    name: 'drawings/native-visual-no-background',
    document: doc([
      visual({
        canvas: { width: 5, height: 2 },
        elements: [
          {
            name: 'shape',
            props: {
              type: 'arrow',
              x: 0.5,
              y: 0.5,
              w: 2,
              h: 0.75,
              fill: { color: '#2563EB' },
              rotate: 7.5,
              flipH: true,
              flipV: true,
            },
          },
          {
            name: 'shape',
            props: {
              type: 'ellipse',
              x: 3,
              y: 0.2,
              w: 1.25,
              h: 1.25,
              line: { color: '#DC2626' },
            },
          },
          {
            name: 'text',
            props: {
              text: 'No background',
              x: 3,
              y: 1.5,
              w: 1.75,
              h: 0.4,
              fontSize: 10,
            },
          },
        ],
      }),
    ]),
  },
  {
    name: 'drawings/native-visual-pictures',
    document: doc([
      visual({
        canvas: { width: 4, height: 2, background: { color: '#FFFFFF' } },
        elements: [
          {
            name: 'image',
            props: {
              base64: PNG_4X2,
              x: 0.25,
              y: 0.25,
              w: 1.5,
              h: 1.5,
              sizing: { type: 'cover' },
              alt: 'A cropped swatch',
            },
          },
          {
            name: 'image',
            props: {
              base64: PNG_4X2,
              x: 2.25,
              y: 0.25,
              w: 1.5,
              h: 1.5,
              sizing: { type: 'contain' },
            },
          },
        ],
      }),
    ]),
  },
  {
    name: 'drawings/native-visual-placed',
    document: doc(
      [
        paragraph('A floating drawing sits beside this paragraph.'),
        badge('Floating', {
          caption: 'Figure 1. A floating native visual.',
          floating: {
            horizontalPosition: { relative: 'margin', align: 'right' },
            verticalPosition: { relative: 'paragraph', offset: 0 },
            wrap: { type: 'square' },
          },
        }),
        paragraph('The table below holds one in a cell.'),
        {
          name: 'table',
          props: {
            columns: [
              {
                header: { content: 'Drawing' },
                cells: [{ content: badge('In a cell') }],
              },
            ],
          },
        },
      ],
      { header: [badge('In the header')] }
    ),
  },
];
