/**
 * The DOCX parity corpus — block-level components.
 *
 * Covers the three components that sit in the document flow as blocks rather
 * than as text: `image` (inline and floating, with captions and alt text),
 * `statistic`, and `text-box` (both `table` and `shape` renderings).
 *
 * Every image here is an inline base64 data URI: a corpus case is identified by
 * the SHA-256 of the package it produces, so nothing may reach outside the
 * process. The `visual` and `highcharts` components are deliberately absent for
 * the same reason — they need external services — and so is the `svg` image
 * source, whose PNG fallback is rasterized by a native renderer whose bytes are
 * not guaranteed to match across platforms.
 */

import type { CorpusCase } from './corpus-types';

/** A 1x1 transparent PNG. */
export const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A 4x2 PNG, so aspect-ratio maths has something to work with. */
export const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

/** An 8x4 greyscale JPEG — a second content type through the same code path. */
export const JPEG_8X4 =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////wAALCAAEAAgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==';

/** A 4x2 GIF. */
export const GIF_4X2 =
  'data:image/gif;base64,R0lGODdhBAACAIEAAAAAAP///wAAAAAAACwAAAAABAACAAAICAADABhIEEBAADs=';

/** A 4x2 BMP. */
export const BMP_4X2 =
  'data:image/bmp;base64,Qk1OAAAAAAAAADYAAAAoAAAABAAAAAIAAAABABgAAAAAABgAAADEDgAAxA4AAAAAAAAAAAAAPB7IPB7IPB7IPB7IPB7IPB7IPB7IPB7I';

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Corpus', author: 'JTO' },
    ...props,
  },
  children,
});

const section = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'section', props, children });

const image = (props: Record<string, unknown>): unknown => ({
  name: 'image',
  props,
});

const statistic = (props: Record<string, unknown>): unknown => ({
  name: 'statistic',
  props,
});

const paragraph = (
  text: string,
  props: Record<string, unknown> = {}
): unknown => ({ name: 'paragraph', props: { text, ...props } });

const textBox = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'text-box', props, children });

const columns = (
  props: Record<string, unknown>,
  children: unknown[]
): unknown => ({ name: 'columns', props, children });

export const CASES: CorpusCase[] = [
  // ==========================================================================
  // image — inline
  // ==========================================================================
  {
    // Nothing but a source: width defaults to "100%" of the content box,
    // height comes from the intrinsic aspect ratio, alignment defaults to
    // centre.
    name: 'blocks/image-inline-default',
    document: doc([section([image({ base64: PNG_4X2 })])]),
  },
  {
    // Explicit pixels on both axes (aspect ratio deliberately ignored), and
    // width-only so the height is derived from the 4x2 source.
    name: 'blocks/image-sizing-pixels',
    document: doc([
      section([
        image({ base64: PNG_4X2, width: 240, height: 60 }),
        image({ base64: PNG_4X2, width: 200 }),
        image({ base64: PNG_1PX, width: 48, height: 48 }),
      ]),
    ]),
  },
  {
    // Percentage sizing against both reference boxes: the default content box
    // and the full page.
    name: 'blocks/image-sizing-percent',
    document: doc([
      section([
        image({ base64: PNG_4X2, width: '50%' }),
        image({
          base64: PNG_4X2,
          width: '60%',
          widthRelativeTo: 'page',
          height: '10%',
          heightRelativeTo: 'page',
        }),
        image({
          base64: PNG_4X2,
          width: '100%',
          widthRelativeTo: 'content',
          height: '12.5%',
          heightRelativeTo: 'content',
        }),
      ]),
    ]),
  },
  {
    name: 'blocks/image-alignments',
    document: doc([
      section([
        image({ base64: PNG_4X2, width: 120, alignment: 'left' }),
        image({ base64: PNG_4X2, width: 120, alignment: 'center' }),
        image({ base64: PNG_4X2, width: 120, alignment: 'right' }),
      ]),
    ]),
  },
  {
    name: 'blocks/image-spacing-and-keeps',
    document: doc([
      section([
        paragraph('Before the figure.'),
        image({
          base64: PNG_4X2,
          width: 180,
          spacing: { before: 18, after: 24 },
          keepNext: true,
          keepLines: true,
        }),
        paragraph('After the figure.'),
        // Spacing with only one side set, and the keeps explicitly off.
        image({
          base64: PNG_4X2,
          width: 180,
          spacing: { after: 0 },
          keepNext: false,
          keepLines: false,
        }),
      ]),
    ]),
  },
  {
    // A caption with no decorator characters takes the plain-text branch.
    name: 'blocks/image-caption-plain',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 200,
          caption: 'Figure 1: measured concentrations, station A',
        }),
      ]),
    ]),
  },
  {
    // Bold, italic and both-at-once markers take the rich-text branch.
    name: 'blocks/image-caption-rich',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 200,
          caption: 'Figure 2: **bold**, *italic* and ***both*** in one caption',
        }),
        image({
          base64: PNG_4X2,
          width: 200,
          caption: '__underscored bold__ and _underscored italic_',
        }),
      ]),
    ]),
  },
  {
    // Alt text, and the empty-string corners of alt and caption.
    name: 'blocks/image-alt-and-empty-caption',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 160,
          alt: 'A four-by-two swatch used as a placeholder figure',
          caption: 'Described figure',
        }),
        image({ base64: PNG_4X2, width: 160, alt: '', caption: '' }),
      ]),
    ]),
  },
  {
    // One document, four content types, so the type detection that reads the
    // data-URI MIME is exercised end to end.
    name: 'blocks/image-formats',
    document: doc([
      section([
        image({ base64: PNG_4X2, width: 120, caption: 'png' }),
        image({ base64: JPEG_8X4, width: 120, caption: 'jpeg' }),
        image({ base64: GIF_4X2, width: 120, caption: 'gif' }),
        image({ base64: BMP_4X2, width: 120, caption: 'bmp' }),
      ]),
    ]),
  },

  // ==========================================================================
  // image — floating
  // ==========================================================================
  {
    // Aligned floating with square wrapping on both sides plus wrap margins.
    name: 'blocks/image-floating-align-and-wrap',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 160,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'right' },
            verticalPosition: { relative: 'paragraph', align: 'top' },
            wrap: {
              type: 'square',
              side: 'bothSides',
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
            },
          },
        }),
        paragraph(
          'Body text that the floating figure has to wrap around; long enough to run past the anchor and onto a second line.'
        ),
      ]),
    ]),
  },
  {
    // Absolute offsets in twips, page-relative anchors, and every boolean flag
    // the floating schema carries.
    name: 'blocks/image-floating-offsets-and-flags',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 200,
          floating: {
            horizontalPosition: { relative: 'page', offset: 1440 },
            verticalPosition: { relative: 'page', offset: 2160 },
            wrap: { type: 'none' },
            allowOverlap: true,
            behindDocument: true,
            lockAnchor: true,
            layoutInCell: true,
            zIndex: 3,
          },
        }),
        paragraph('Anchored to the page, behind the text.'),
      ]),
    ]),
  },
  {
    // Percentage offsets and percentage wrap margins, resolved against the
    // page/margin reference boxes at generation time.
    name: 'blocks/image-floating-percent-metrics',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: '25%',
          floating: {
            horizontalPosition: { relative: 'column', offset: '10%' },
            verticalPosition: { relative: 'line', offset: '5%' },
            wrap: {
              type: 'square',
              side: 'largest',
              margins: { top: '1%', bottom: '1%', left: '2%', right: '2%' },
            },
            zIndex: 0,
          },
        }),
        paragraph('Percentage-positioned figure.'),
      ]),
    ]),
  },
  {
    // The wrap types and sides an image accepts. 'tight' is excluded: the
    // renderer rejects it outright.
    name: 'blocks/image-floating-wrap-variants',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 100,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'left' },
            wrap: { type: 'topAndBottom' },
          },
        }),
        image({
          base64: PNG_4X2,
          width: 100,
          floating: {
            verticalPosition: { relative: 'margin', align: 'center' },
            wrap: { type: 'around', side: 'left' },
          },
        }),
        image({
          base64: PNG_4X2,
          width: 100,
          floating: {
            horizontalPosition: { relative: 'character', align: 'inside' },
            verticalPosition: { relative: 'text', align: 'outside' },
            wrap: { type: 'through', side: 'right' },
          },
        }),
        paragraph('Wrap variants above.'),
      ]),
    ]),
  },
  {
    // Rotation and visibility are schema-legal on a floating image; this pins
    // whatever the pipeline does with them today.
    name: 'blocks/image-floating-rotation-and-visibility',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 140,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'center' },
            verticalPosition: { relative: 'paragraph', align: 'top' },
            wrap: { type: 'square' },
            rotation: 45,
            visibility: 'hidden',
          },
        }),
        image({
          base64: PNG_4X2,
          width: 140,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'center' },
            rotation: -90,
            visibility: 'inherit',
          },
        }),
        paragraph('Rotated and hidden figures.'),
      ]),
    ]),
  },
  {
    // Caption on a floating image: the caption paragraph is a separate block
    // from the anchored drawing, so the two features have to coexist.
    name: 'blocks/image-floating-with-caption',
    document: doc([
      section([
        image({
          base64: PNG_4X2,
          width: 160,
          alt: 'Floating swatch',
          caption: 'Figure 3: *floating* figure with a caption',
          alignment: 'right',
          spacing: { before: 6, after: 6 },
          floating: {
            horizontalPosition: { relative: 'margin', align: 'left' },
            verticalPosition: { relative: 'paragraph', align: 'top' },
            wrap: { type: 'square', side: 'right' },
          },
        }),
        paragraph('Text beside the captioned float.'),
      ]),
    ]),
  },

  // ==========================================================================
  // statistic
  // ==========================================================================
  {
    name: 'blocks/statistic-minimal',
    document: doc([
      section([
        statistic({ number: '42', description: 'Monitoring stations' }),
      ]),
    ]),
  },
  {
    name: 'blocks/statistic-alignments',
    document: doc([
      section([
        statistic({ number: '12', description: 'Left', alignment: 'left' }),
        statistic({ number: '34', description: 'Centre', alignment: 'center' }),
        statistic({ number: '56', description: 'Right', alignment: 'right' }),
      ]),
    ]),
  },
  {
    // Every optional prop at once, including the ones the renderer does not
    // consume yet — a hash change here says one of them started rendering.
    name: 'blocks/statistic-full-props',
    document: doc([
      section([
        statistic({
          number: '1,142,000',
          description: 'Annual savings',
          unit: 'EUR',
          format: '#,##0',
          trend: 'up',
          trendValue: '42% cost reduction',
          alignment: 'center',
          size: 'large',
          spacing: { before: 12, after: 18 },
        }),
      ]),
    ]),
  },
  {
    name: 'blocks/statistic-trend-and-size-variants',
    document: doc([
      section([
        statistic({
          number: '99.99%',
          description: 'Uptime',
          trend: 'up',
          trendValue: 2.6,
          size: 'small',
        }),
        statistic({
          number: '23 hrs',
          description: 'Downtime',
          trend: 'down',
          trendValue: -11,
          size: 'medium',
        }),
        statistic({
          number: '7.2',
          description: 'Payback, months',
          trend: 'neutral',
          trendValue: 0,
          size: 'large',
        }),
      ]),
    ]),
  },
  {
    // Empty strings are legal for both required props, and spacing may be an
    // empty object.
    name: 'blocks/statistic-empty-strings',
    document: doc([
      section([
        statistic({ number: '', description: '' }),
        statistic({ number: '0', description: '', spacing: {} }),
      ]),
    ]),
  },

  // ==========================================================================
  // text-box — table rendering (the default)
  // ==========================================================================
  {
    // No props at all: an inline, borderless one-cell table around one child.
    name: 'blocks/text-box-inline-default',
    document: doc([section([textBox([paragraph('Inside the box.')])])]),
  },
  {
    // Padding, one border per side with a different style each, a shaded fill,
    // and a percentage width.
    name: 'blocks/text-box-inline-styled',
    document: doc([
      section([
        textBox([paragraph('Styled box.')], {
          width: '60%',
          renderAs: 'table',
          style: {
            padding: { top: 8, right: 12, bottom: 8, left: 12 },
            border: {
              top: { style: 'solid', width: 2, color: '#334155' },
              right: { style: 'dashed', width: 1, color: '#94A3B8' },
              bottom: { style: 'double', width: 3, color: '#334155' },
              left: { style: 'dotted', width: 1, color: 'primary' },
            },
            shading: { fill: '#F1F5F9' },
          },
        }),
        // The other end of the same props: a declared border that draws
        // nothing, zero padding, and a pixel width.
        textBox([paragraph('Bare box.')], {
          width: 320,
          style: {
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            border: { top: { style: 'none' } },
          },
        }),
      ]),
    ]),
  },
  {
    // Floating table rendering: anchors, absolute offsets and wrap margins on
    // the box rather than on an image.
    name: 'blocks/text-box-floating-table',
    document: doc([
      section([
        textBox([paragraph('Pull quote.')], {
          width: 200,
          height: 120,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'right' },
            verticalPosition: { relative: 'paragraph', offset: 720 },
            wrap: {
              type: 'square',
              margins: { top: 100, bottom: 100, left: 150, right: 150 },
            },
            allowOverlap: true,
            zIndex: 2,
          },
          style: { shading: { fill: '#EEF2FF' } },
        }),
        paragraph('Body text running past the floating box.'),
        // Percentage width and percentage offsets, anchored to the page.
        textBox([paragraph('Page-anchored box.')], {
          width: '40%',
          floating: {
            horizontalPosition: { relative: 'page', offset: '10%' },
            verticalPosition: { relative: 'page', offset: '20%' },
            wrap: { type: 'around' },
          },
        }),
      ]),
    ]),
  },
  {
    // Every child type a text box accepts, in one box.
    name: 'blocks/text-box-mixed-children',
    document: doc([
      section([
        textBox(
          [
            { name: 'heading', props: { text: 'Boxed heading', level: 3 } },
            paragraph('A paragraph in the box.'),
            image({ base64: PNG_4X2, width: 120, caption: 'Boxed figure' }),
            paragraph('A second paragraph, after the figure.'),
          ],
          {
            width: '80%',
            style: {
              padding: { top: 6, bottom: 6, left: 10, right: 10 },
              border: { top: { style: 'solid', width: 1, color: '#CBD5E1' } },
            },
          }
        ),
      ]),
    ]),
  },
  {
    // A box with no children at all.
    name: 'blocks/text-box-empty-children',
    document: doc([
      section([textBox([], { width: 240 }), paragraph('After the empty box.')]),
    ]),
  },

  // ==========================================================================
  // text-box — shape rendering
  // ==========================================================================
  {
    // A native Word text box: explicit pixel size, one uniform solid outline.
    name: 'blocks/text-box-shape',
    document: doc([
      section([
        textBox([paragraph('Shape box.')], {
          renderAs: 'shape',
          width: 260,
          height: 120,
          style: {
            border: { top: { style: 'solid', width: 1, color: '#0F172A' } },
          },
        }),
      ]),
    ]),
  },
  {
    // Fill plus padding: the fill wins and the border is dropped, which is the
    // behaviour worth pinning.
    name: 'blocks/text-box-shape-fill-and-padding',
    document: doc([
      section([
        textBox([paragraph('Filled shape.')], {
          renderAs: 'shape',
          width: 300,
          height: 140,
          style: {
            padding: { top: 10, right: 14, bottom: 10, left: 14 },
            border: { top: { style: 'solid', width: 2, color: '#0F172A' } },
            shading: { fill: '#FEF3C7' },
          },
        }),
      ]),
    ]),
  },
  {
    // Percentage sizes on a shape are resolved eagerly against the content box.
    name: 'blocks/text-box-shape-percent-size',
    document: doc([
      section([
        textBox([paragraph('Percent-sized shape.')], {
          renderAs: 'shape',
          width: '50%',
          height: '15%',
        }),
      ]),
    ]),
  },
  {
    // A floating shape, with the anchor and wrap mapping an image would use.
    name: 'blocks/text-box-shape-floating',
    document: doc([
      section([
        textBox([paragraph('Floating shape.')], {
          renderAs: 'shape',
          width: 220,
          height: 100,
          floating: {
            horizontalPosition: { relative: 'margin', align: 'left' },
            verticalPosition: { relative: 'paragraph', align: 'top' },
            wrap: { type: 'square', side: 'right' },
            behindDocument: false,
            zIndex: 1,
          },
          style: {
            border: { top: { style: 'solid', width: 1, color: 'primary' } },
          },
        }),
        paragraph('Text beside the floating shape.'),
      ]),
    ]),
  },
  {
    // Per-side borders that disagree: a shape has one outline, so the first
    // declared side wins and the rest are dropped.
    name: 'blocks/text-box-shape-conflicting-borders',
    document: doc([
      section([
        textBox([paragraph('Conflicting outline.')], {
          renderAs: 'shape',
          width: 240,
          height: 110,
          style: {
            border: {
              top: { style: 'solid', width: 1, color: '#111827' },
              right: { style: 'solid', width: 4, color: '#DC2626' },
              bottom: { style: 'none' },
              left: { style: 'solid', width: 1, color: '#111827' },
            },
          },
        }),
      ]),
    ]),
  },

  // ==========================================================================
  // text-box — nested columns
  // ==========================================================================
  {
    // Columns inside a text box have no section to become, so they become a
    // table of cells within the box's own cell.
    name: 'blocks/text-box-nested-columns',
    document: doc([
      section([
        textBox(
          [
            columns({ columns: 2 }, [
              paragraph('Left column.'),
              paragraph('Right column.'),
            ]),
          ],
          { style: { padding: { top: 6, right: 6, bottom: 6, left: 6 } } }
        ),
      ]),
    ]),
  },
  {
    // Explicit widths and gaps, a percentage among them, and a final column
    // that takes whatever the others left.
    name: 'blocks/text-box-nested-columns-widths',
    document: doc([
      section([
        textBox([
          columns(
            { columns: [{ width: 200, gap: 24 }, { width: '30%' }, {}] },
            [
              paragraph('One.'),
              paragraph('Two.'),
              paragraph('Three.'),
              paragraph('Four.'),
            ]
          ),
        ]),
      ]),
    ]),
  },
  {
    // More columns than items: the ones nothing was dealt to still exist.
    name: 'blocks/text-box-nested-columns-sparse',
    document: doc([
      section([
        textBox([
          columns({ columns: 3, gap: 36 }, [paragraph('Only one item.')]),
        ]),
      ]),
    ]),
  },
  {
    // A floating box whose contents are columns: the box floats, the columns
    // inside it do not.
    name: 'blocks/text-box-nested-columns-floating',
    document: doc([
      section([
        textBox(
          [
            paragraph('Header text.'),
            columns({ columns: [{ width: '50%' }, { width: '50%' }] }, [
              paragraph('Left.'),
              paragraph('Right.'),
            ]),
          ],
          {
            floating: {
              horizontalPosition: { relative: 'margin', align: 'right' },
              verticalPosition: { relative: 'page', align: 'top' },
            },
            width: 300,
          }
        ),
      ]),
    ]),
  },
];
