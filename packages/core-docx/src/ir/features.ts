/**
 * DOCX renderer features.
 *
 * A feature is a capability a *backend* must have, not an authoring concept.
 * The compiler records one requirement per IR node that needs one; a renderer
 * declares the set it can satisfy. Anything required but not declared fails
 * before rendering, with the IR path attached.
 *
 * The boundaries are drawn where backends actually differ. `toc` and
 * `cached-toc` are separate because writing the field is easy and baking its
 * entries is not; `footnotes` and `endnotes` are separate because a backend can
 * plausibly have one and not the other.
 */

export const DOCX_FEATURES = [
  /** Paragraphs and text runs — the floor of the format. */
  'paragraphs',
  /** Named paragraph and character styles in `styles.xml`. */
  'styles',
  /** Numbering definitions and numbered paragraphs. */
  'numbering',
  /** Multiple sections with their own page setup. */
  'sections',
  /** Multi-column section layout. */
  'columns',
  /** Header and footer parts, including first/even variants. */
  'headers-footers',
  'tables',
  /** Merged table cells — column span or vertical merge. */
  'table-merged-cells',
  /** A table positioned out of the text flow. */
  'floating-tables',
  /** Inline images. */
  'images',
  /** Anchored images with text wrapping. */
  'floating-images',
  /** SVG images with a raster fallback. */
  'svg-images',
  /** A paragraph positioned as a floating frame. */
  'text-frames',
  /** Native shape text boxes. */
  'text-boxes',
  /**
   * A DrawingML group: shapes, text boxes and pictures sharing one child
   * coordinate space, drawn as a single anchored or inline object.
   *
   * Separate from `text-boxes` because a lone `wps:wsp` run is a far smaller
   * ask than `wpg:wgp` with child transforms, preset geometry and grouped
   * pictures — a backend can plausibly have the first and not the second.
   */
  'drawing-groups',
  /**
   * A native chart part: a `c:chartSpace` with its own embedded workbook.
   *
   * Separate from `images` because a chart is not a picture with extra data —
   * it is its own part, its own relationship and its own workbook, and a
   * backend either writes all three or writes none. docx.js has no chart
   * primitive at all, which is what turns a `chart` component sent to that
   * backend into a named capability error rather than a document missing a
   * figure.
   */
  'charts',
  /** A table-of-contents field. */
  'toc',
  /** TOC entries baked in so an unrefreshed reader still shows them. */
  'cached-toc',
  /** Arbitrary Word fields, e.g. PAGE, NUMPAGES, REF. */
  'fields',
  /** Field results cached for readers that never refresh. */
  'cached-fields',
  'hyperlinks',
  'bookmarks',
  /** Links and REF fields that target a bookmark. */
  'cross-references',
  'comments',
  /** Threaded and resolvable comments. */
  'comment-threads',
  'footnotes',
  'endnotes',
  /** Inserted and deleted content. */
  'revisions',
  /** Page, column and line breaks. */
  'breaks',
  /** Paragraph and table shading. */
  'shading',
  /** Paragraph, table and page borders. */
  'borders',
  /** Tab stops. */
  'tab-stops',
  /** Per-run proofing language and no-proof. */
  'proofing-language',
  /** Custom document properties. */
  'custom-properties',
  /** Right-to-left paragraph direction. */
  'rtl',
] as const;

export type DocxFeature = (typeof DOCX_FEATURES)[number];

/** Every feature, for an adapter that claims the full surface. */
export const ALL_DOCX_FEATURES: ReadonlySet<DocxFeature> = new Set(
  DOCX_FEATURES
);

export function isDocxFeature(value: string): value is DocxFeature {
  return (DOCX_FEATURES as readonly string[]).includes(value);
}
