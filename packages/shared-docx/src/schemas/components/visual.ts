/**
 * Visual Component Schema
 *
 * A `visual` is a free-canvas graphic: absolute positioning, overlapping
 * shapes and layered art that the docx flow layout cannot express — think
 * infographics, diagrams and hero compositions.
 *
 * There are two ways to draw one, chosen by `renderMode`.
 *
 * `raster` (the default, and what an omitted `renderMode` means) authors the
 * canvas as a single pptx slide and embeds the result as a PNG. An injected
 * rasterization service renders it (see `PptxServiceConfig` in
 * @json-to-office/shared), exactly the way `highcharts` offloads chart
 * rendering to an export server; at render time the component desugars to a
 * plain `image`. Every pptx slide element is available, and the output is
 * pixels.
 *
 * `native` draws the same canvas as one Word DrawingML group — real text
 * boxes, real shapes, real pictures — with no pptx, no rasterizer and no PNG.
 * The text stays searchable and every object stays editable in Word. It needs
 * the `office-open` renderer, and its content model is the narrower, strictly
 * validated one in `./visual-native`.
 */

import { Type, Static } from '@sinclair/typebox';
import {
  MIN_VISUAL_DPI,
  MAX_VISUAL_DPI,
  DEFAULT_VISUAL_DPI,
} from '@json-to-office/shared';
import { PptxSlideContentSchema } from '@json-to-office/shared/schemas/slide-content';
import {
  AlignmentSchema,
  SpacingSchema,
  FloatingPropertiesSchema,
} from './common';
import {
  NativeVisualCanvasSchema,
  NativeVisualElementSchema,
} from './visual-native';

export * from './visual-native';

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
 * Where the drawing sits on the page, and how big it is.
 *
 * Identical for both render modes: a visual is placed like an image whether
 * its pixels came from a rasterizer or its objects were drawn by Word.
 */
const PlacementProps = {
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
} as const;

// A single pptx slide content element (text, image, shape, table, highcharts,
// chart) is validated against the real PPTX slide-content union
// (`PptxSlideContentSchema` from @json-to-office/shared/schemas/slide-content)
// — same authoring fidelity as a standalone `.pptx.json`. Used directly as the
// `elements` item schema below.

/**
 * The rasterized form: a pptx slide rendered to a PNG.
 *
 * `renderMode` is optional here because omitting it has always meant raster,
 * and every document written before native mode existed must keep rendering
 * byte-for-byte the way it did.
 */
export const VisualRasterPropsSchema = Type.Object(
  {
    renderMode: Type.Optional(
      Type.Literal('raster', {
        description:
          'Render as a rasterized pptx slide (the default when omitted).',
      })
    ),

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
        minimum: MIN_VISUAL_DPI,
        maximum: MAX_VISUAL_DPI,
        default: DEFAULT_VISUAL_DPI,
        description: `Raster resolution in DPI (default ${DEFAULT_VISUAL_DPI}, range ${MIN_VISUAL_DPI}-${MAX_VISUAL_DPI}). Higher = sharper + larger.`,
      })
    ),
    serverUrl: Type.Optional(
      Type.String({
        description:
          'Rasterization service URL override (default from services.pptx)',
      })
    ),

    // ── placement in the document (mirrors `image`) ──
    ...PlacementProps,
  },
  {
    // Hoisted into its own JSON-Schema definition rather than inlined at every
    // position a component can appear. `visual.props` is by far the largest
    // props schema in the registry, and inlining two of them pushed the
    // exported `ComponentDefinition` past the depth Ajv can compile.
    $id: 'DocxVisualRasterProps',
    description: 'Visual component props (pptx-rendered graphic)',
    additionalProperties: false,
  }
);

/**
 * The native form: one Word DrawingML group.
 *
 * `dpi` and `serverUrl` are absent rather than ignored — nothing is
 * rasterized, so a resolution or a service URL would describe work that never
 * happens. `renderMode` is required, which is what makes this branch
 * unreachable by accident.
 */
export const VisualNativePropsSchema = Type.Object(
  {
    renderMode: Type.Literal('native', {
      description:
        'Draw natively as a Word DrawingML group. Requires the "office-open" renderer.',
    }),
    canvas: NativeVisualCanvasSchema,
    elements: Type.Optional(
      Type.Array(NativeVisualElementSchema, {
        description:
          'Native drawing elements (text, shape, image), positioned with x/y/w/h in inches or canvas percentages',
      })
    ),
    ...PlacementProps,
  },
  {
    // Hoisted for the same reason as the raster branch above.
    $id: 'DocxVisualNativeProps',
    description:
      'Visual component props (native Word drawing group; requires renderer "office-open")',
    additionalProperties: false,
  }
);

/**
 * The authoring surface of `visual`, as a union discriminated on `renderMode`.
 *
 * Kept as one canonical schema rather than two registry entries because the
 * runtime validator checks an un-profiled schema: both shapes have to be
 * structurally valid here, and which one a *document* may use is decided by
 * its renderer, in `schemas/renderer.ts`.
 */
export const VisualPropsSchema = Type.Union(
  [VisualRasterPropsSchema, VisualNativePropsSchema],
  {
    description:
      'Visual component props — rasterized pptx slide (default) or a native Word drawing group',
  }
);

export type VisualRasterProps = Static<typeof VisualRasterPropsSchema>;
export type VisualNativeProps = Static<typeof VisualNativePropsSchema>;
export type VisualProps = VisualRasterProps | VisualNativeProps;
export type VisualCanvas = Static<typeof VisualCanvasSchema>;

/** The `renderMode` value that selects the native drawing-group path. */
export const NATIVE_RENDER_MODE = 'native';

/** True when these props ask for the native DrawingML path. */
export function isNativeVisualProps(
  props: VisualProps | undefined | null
): props is VisualNativeProps {
  return (
    !!props &&
    (props as { renderMode?: unknown }).renderMode === NATIVE_RENDER_MODE
  );
}
