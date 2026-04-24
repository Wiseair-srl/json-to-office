/**
 * Minimal type declarations for `subset-font`. The package ships no
 * bundled types; we declare only the surface we use. If we expand usage
 * (e.g. adding `noLayoutClosure`), extend here rather than `any`-casting
 * at call sites.
 */
declare module 'subset-font' {
  export interface AxisRange {
    min: number;
    max: number;
    default?: number;
  }

  export interface SubsetFontOptions {
    /** Output format. 'sfnt' keeps plain TTF/OTF. */
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2';
    /** Extra name-table IDs to preserve through the subsetter. */
    preserveNameIds?: number[];
    /**
     * Variable-axis pins or range-reductions. Numbers pin the axis;
     * AxisRange reduces its span. Any axis omitted is left untouched.
     */
    variationAxes?: Record<string, number | AxisRange>;
    /** Skip GSUB layout closure. */
    noLayoutClosure?: boolean;
  }

  /**
   * Subset `originalFont` to the glyphs mapped by codepoints in `text`,
   * optionally pinning variable-font axes via `variationAxes`. Returns
   * the new font as a Buffer in `options.targetFormat`.
   */
  export default function subsetFont(
    originalFont: Buffer,
    text: string,
    options?: SubsetFontOptions
  ): Promise<Buffer>;
}
