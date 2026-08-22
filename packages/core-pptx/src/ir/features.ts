/**
 * PPTX renderer features.
 *
 * A feature is a capability a *backend* must have, not an authoring concept.
 * The compiler records one requirement per IR node that needs one; a renderer
 * declares the set it can satisfy. Anything required but not declared fails
 * before rendering, with the IR path attached.
 *
 * Names are chosen so the boundary is real: `gradient-fills` is separate from
 * `pattern-fills` because a backend can plausibly have one and not the other,
 * while `rich-text` covers multi-run bodies as a single indivisible ability.
 */

export const PPTX_FEATURES = [
  /** Slide masters compiled from authored templates. */
  'masters',
  /** Named placeholder regions declared by a master. */
  'placeholders',
  /** Multiple independently-formatted runs inside one text body. */
  'rich-text',
  /** Text bodies at all (a single run, uniform formatting). */
  'text',
  /** Preset-geometry shapes. */
  'shapes',
  /** Raster and vector images. */
  'images',
  /** SVG images specifically — many backends need a raster fallback. */
  'svg',
  /**
   * Drawing only part of a picture: `cover`, `crop`, or a `contain` fit the
   * compiler could not resolve into the frame.
   *
   * A backend without it draws the whole picture into the frame, which is a
   * different image — the wrong region at the wrong scale — with nothing to
   * show that anything was lost.
   */
  'image-crop',
  /** Masking a picture to rounded corners or a circle. */
  'image-rounding',
  'tables',
  /** Merged table cells (colSpan / rowSpan). */
  'table-merged-cells',
  /**
   * Cell insets on a table.
   *
   * Separate from the inset on a text body: a reader takes a cell's padding
   * from `a:tcPr`, and a backend that can only write text-body insets puts the
   * numbers somewhere nothing reads them.
   */
  'table-insets',
  /**
   * Rounded table corners.
   *
   * A separate ability because OOXML has no such property: a backend realises
   * it by drawing shapes behind the table, or it cannot realise it at all.
   */
  'table-rounded-corners',
  /**
   * Flowing an over-long table onto further slides, header row included.
   *
   * Pagination is the backend's, not the IR's — the IR describes one table and
   * says it may split, so a backend that cannot split has to refuse rather than
   * emit a table running off the slide.
   */
  'table-auto-page',
  /** Native OOXML charts with an embedded workbook. */
  'charts',
  'solid-fills',
  'gradient-fills',
  'pattern-fills',
  'image-fills',
  'lines',
  'shadows',
  /** Slide backgrounds (solid or image). */
  'backgrounds',
  'speaker-notes',
  'hidden-slides',
  'transitions',
  /** Hyperlinks to an external URL. */
  'external-links',
  /** Hyperlinks targeting another slide in the same deck. */
  'internal-links',
  /** A link covering a text body — realisable on the runs inside it. */
  'text-hyperlinks',
  /** A link on a shape or image as a whole, which runs cannot stand in for. */
  'element-hyperlinks',
  /** Rotation on a shape, text box or table. */
  'rotation',
  /**
   * Any transform on a picture — rotation or flip.
   *
   * One feature rather than three: a backend that cannot rotate a picture
   * generally cannot flip one either, because the option carrying both is
   * simply absent from its picture type.
   */
  'image-transform',
  'flip-horizontal',
  'flip-vertical',
  /** Grouped elements sharing a transform. */
  'groups',
  /** Per-run proofing language. */
  'proofing-language',
  /** Right-to-left reading order. */
  'rtl',
] as const;

export type PptxFeature = (typeof PPTX_FEATURES)[number];

/** Every feature, for an adapter that claims the full surface. */
export const ALL_PPTX_FEATURES: ReadonlySet<PptxFeature> = new Set(
  PPTX_FEATURES
);

export function isPptxFeature(value: string): value is PptxFeature {
  return (PPTX_FEATURES as readonly string[]).includes(value);
}
