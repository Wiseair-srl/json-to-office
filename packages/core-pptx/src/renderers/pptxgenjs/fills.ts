/**
 * Gradient and pattern fills for the PptxGenJS backend.
 *
 * PptxGenJS has no API for either. The workaround — render a sentinel
 * `<a:solidFill>` on a uniquely-named shape, then splice the real fill element
 * in while packaging — is a property of *this backend*, so it lives here and
 * never in PptxIR or in generic PPTX types. PptxIR describes the gradient
 * semantically; another adapter is free to emit it directly.
 *
 * Colours arriving here are already resolved to hex by the compiler, so
 * building the XML is a pure string operation.
 */

import type {
  PptxIrColor,
  PptxIrFill,
  PptxIrGradient,
  PptxIrRadialFocus,
} from '../../ir/types';

/** OOXML angle unit: 60000ths of a degree. */
const ANGLE_UNIT = 60000;
/** OOXML percentage unit: 1000ths of a percent (0-100 → 0-100000). */
const PCT_UNIT = 1000;

/** `fillToRect` edges (in 1000ths of a percent) per radial focus corner. */
const RADIAL_FOCUS_RECTS: Record<
  PptxIrRadialFocus,
  { l: number; t: number; r: number; b: number }
> = {
  center: { l: 50000, t: 50000, r: 50000, b: 50000 },
  topLeft: { l: 0, t: 0, r: 100000, b: 100000 },
  topRight: { l: 100000, t: 0, r: 0, b: 100000 },
  bottomLeft: { l: 0, t: 100000, r: 100000, b: 0 },
  bottomRight: { l: 100000, t: 100000, r: 0, b: 0 },
};

/**
 * A fill to splice into slide XML during packaging.
 *
 * The shape that registered it carries `cNvPr name="{objectName}"`.
 */
export interface PendingXmlFill {
  objectName: string;
  /** Complete replacement element, e.g. `<a:gradFill>…</a:gradFill>`. */
  xml: string;
}

/** Collects pending fills for one render. Never module-global. */
export type PendingFillSink = PendingXmlFill[];

/**
 * A colour element that can carry an alpha child.
 *
 * Always paired, even with no alpha: gradient stops may gain one, and the
 * paired form is what the slide XML has always contained for them.
 */
function colorXml(color: PptxIrColor): string {
  const alpha =
    color.transparency !== undefined
      ? `<a:alpha val="${Math.round((100 - color.transparency) * PCT_UNIT)}"/>`
      : '';
  return `<a:srgbClr val="${color.hex.toUpperCase()}">${alpha}</a:srgbClr>`;
}

/**
 * The compact colour element used inside a pattern fill.
 *
 * Pattern foreground/background carry no transparency, so the element has no
 * children and is written self-closing.
 */
function opaqueColorXml(color: PptxIrColor): string {
  return `<a:srgbClr val="${color.hex.toUpperCase()}"/>`;
}

export function buildGradientFillXml(gradient: PptxIrGradient): string {
  const stops = gradient.stops
    .map(
      (stop) =>
        `<a:gs pos="${Math.round(stop.position * PCT_UNIT)}">${colorXml(stop.color)}</a:gs>`
    )
    .join('');

  const shade =
    gradient.type === 'radial'
      ? radialShadeXml(gradient.focus)
      : `<a:lin ang="${Math.round(gradient.angleDegrees * ANGLE_UNIT)}" scaled="1"/>`;

  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
}

function radialShadeXml(focus: PptxIrRadialFocus): string {
  const rect = RADIAL_FOCUS_RECTS[focus] ?? RADIAL_FOCUS_RECTS.center;
  return `<a:path path="circle"><a:fillToRect l="${rect.l}" t="${rect.t}" r="${rect.r}" b="${rect.b}"/></a:path>`;
}

export function buildPatternFillXml(
  preset: string,
  foreground: PptxIrColor,
  background: PptxIrColor
): string {
  return (
    `<a:pattFill prst="${preset}">` +
    `<a:fgClr>${opaqueColorXml(foreground)}</a:fgClr>` +
    `<a:bgClr>${opaqueColorXml(background)}</a:bgClr>` +
    `</a:pattFill>`
  );
}

/**
 * Write a sentinel solid fill and register the real fill for splicing.
 *
 * Without a sink — a caller rendering outside the buffer pipeline — the shape
 * keeps the sentinel colour, so the deck still reads as authored instead of
 * falling back to a PptxGenJS default.
 */
export function registerAdvancedFill(
  opts: Record<string, unknown>,
  fill: Extract<PptxIrFill, { kind: 'gradient' | 'pattern' }>,
  elementPath: string,
  sink: PendingFillSink | undefined
): void {
  const sentinel =
    fill.kind === 'gradient' ? fill.gradient.stops[0].color : fill.foreground;

  if (sink) {
    const xml =
      fill.kind === 'gradient'
        ? buildGradientFillXml(fill.gradient)
        : buildPatternFillXml(fill.preset, fill.foreground, fill.background);
    const objectName = `__jto_fill_${sink.length}__`;
    sink.push({ objectName, xml });
    opts.objectName = objectName;
  }

  void elementPath;
  opts.fill = { color: sentinel.hex };
}

/**
 * Splice registered fills into one slide's XML.
 *
 * For every pending fill whose sentinel name appears in this slide, the first
 * `<a:solidFill>` inside that shape's `<p:sp>` — its shape fill; line and run
 * fills come later in the element — is replaced, and the sentinel name is
 * swapped for a normal one so it never ships.
 */
export function applyPendingFills(
  xml: string,
  pendingFills: readonly PendingXmlFill[]
): string {
  let out = xml;
  for (const [index, fill] of pendingFills.entries()) {
    const marker = `name="${fill.objectName}"`;
    const markerIdx = out.indexOf(marker);
    if (markerIdx === -1) continue;

    const spEnd = out.indexOf('</p:sp>', markerIdx);
    const solidStart = out.indexOf('<a:solidFill>', markerIdx);
    const solidEndTag = '</a:solidFill>';
    const solidEnd = out.indexOf(solidEndTag, solidStart);
    if (
      solidStart !== -1 &&
      solidEnd !== -1 &&
      spEnd !== -1 &&
      solidStart < spEnd
    ) {
      out =
        out.slice(0, solidStart) +
        fill.xml +
        out.slice(solidEnd + solidEndTag.length);
    }

    out =
      out.slice(0, markerIdx) +
      `name="Fill ${index + 1}"` +
      out.slice(markerIdx + marker.length);
  }
  return out;
}
