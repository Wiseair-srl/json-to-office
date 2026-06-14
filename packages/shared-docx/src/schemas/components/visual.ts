/**
 * Visual Component Schema
 *
 * A `visual` is a free-canvas graphic authored as a single pptx slide and
 * embedded into the document as a rasterized PNG. It unlocks absolute
 * positioning, overlapping shapes and layered art that the docx flow layout
 * cannot express — think infographics, diagrams and hero compositions.
 *
 * The pptx slide is rendered to an image by an injected rasterization service
 * (see `PptxServiceConfig` in @json-to-office/shared), exactly the way the
 * `highcharts` component offloads chart rendering to an export server. At
 * render time the component desugars to a plain `image`.
 */

import { Type, Static } from '@sinclair/typebox';
import { PptxSlideContentSchema } from '@json-to-office/shared-pptx';
import {
  AlignmentSchema,
  SpacingSchema,
  FloatingPropertiesSchema,
} from './common';

/**
 * Canvas background — a solid color and/or a background image.
 * Mirrors the pptx slide background shape (kept local to avoid coupling
 * shared-docx to shared-pptx; the rasterizer forwards it verbatim).
 */
export const VisualCanvasBackgroundSchema = Type.Object(
  {
    color: Type.Optional(
      Type.String({
        description:
          'Background color (hex like "#FFFFFF" or a theme color name)',
      })
    ),
    image: Type.Optional(
      Type.Object(
        {
          path: Type.Optional(Type.String()),
          base64: Type.Optional(Type.String()),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);

/**
 * The pptx canvas the visual is drawn on. Width/height are in inches and set
 * both the aspect ratio and the physical print size of the embedded image.
 */
export const VisualCanvasSchema = Type.Object(
  {
    width: Type.Number({
      minimum: 0.1,
      description: 'Canvas width in inches (pptx slideWidth)',
    }),
    height: Type.Number({
      minimum: 0.1,
      description: 'Canvas height in inches (pptx slideHeight)',
    }),
    theme: Type.Optional(
      Type.String({ description: 'pptx theme name applied to the slide' })
    ),
    background: Type.Optional(VisualCanvasBackgroundSchema),
  },
  {
    description: 'pptx canvas definition for the visual',
    additionalProperties: false,
  }
);

/**
 * A single pptx slide content element (text, image, shape, table, highcharts,
 * chart). This is the real PPTX slide-content union from `@json-to-office/shared-pptx`,
 * so every element is fully validated against its component's props — same
 * authoring fidelity as a standalone `.pptx.json`.
 */
export const VisualElementSchema = PptxSlideContentSchema;

export const VisualPropsSchema = Type.Object(
  {
    // ── canvas (drives aspect ratio + physical size) ──
    canvas: VisualCanvasSchema,
    // pptx slide content elements, absolutely positioned on the canvas
    elements: Type.Optional(
      Type.Array(PptxSlideContentSchema, {
        description:
          'pptx slide content elements (text, image, shape, table, highcharts, chart), positioned with x/y/w/h in inches',
      })
    ),

    // ── rasterization ──
    dpi: Type.Optional(
      Type.Number({
        minimum: 36,
        description:
          'Raster resolution in DPI (default 200). Higher = sharper + larger.',
      })
    ),
    serverUrl: Type.Optional(
      Type.String({
        description:
          'Rasterization service URL override (default from services.pptx)',
      })
    ),

    // ── placement in the document (mirrors `image`) ──
    width: Type.Optional(
      Type.Union(
        [
          Type.Number({ minimum: 1, description: 'Rendered width in pixels' }),
          Type.String({
            pattern: '^\\d+(\\.\\d+)?%$',
            description: 'Rendered width as percentage (e.g. "90%")',
          }),
        ],
        {
          description:
            'Rendered width in the document, in pixels (number) or percentage string. Defaults to the canvas physical size.',
        }
      )
    ),
    height: Type.Optional(
      Type.Union([
        Type.Number({ minimum: 1, description: 'Rendered height in pixels' }),
        Type.String({
          pattern: '^\\d+(\\.\\d+)?%$',
          description: 'Rendered height as percentage (e.g. "90%")',
        }),
      ])
    ),
    alignment: Type.Optional(AlignmentSchema),
    caption: Type.Optional(
      Type.String({
        description:
          'Caption (supports rich text with **bold**, *italic*, ***both***)',
      })
    ),
    alt: Type.Optional(
      Type.String({ description: 'Alternative text for accessibility' })
    ),
    spacing: Type.Optional(SpacingSchema),
    floating: Type.Optional(FloatingPropertiesSchema),
    keepNext: Type.Optional(
      Type.Boolean({
        description: 'Keep paragraph with next paragraph on same page',
      })
    ),
    keepLines: Type.Optional(
      Type.Boolean({
        description: 'Keep all lines of paragraph together on same page',
      })
    ),
  },
  {
    description: 'Visual component props (pptx-rendered graphic)',
    additionalProperties: false,
  }
);

export type VisualProps = Static<typeof VisualPropsSchema>;
export type VisualCanvas = Static<typeof VisualCanvasSchema>;
