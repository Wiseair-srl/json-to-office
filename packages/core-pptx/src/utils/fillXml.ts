/**
 * OOXML fill XML builders for fills pptxgenjs cannot express.
 *
 * Gradient and pattern fills are rendered as a sentinel solid fill tagged with
 * a unique `objectName`; packagePresentationBuffer then swaps the sentinel
 * `<a:solidFill>` for the XML built here. Colors are resolved (theme tokens →
 * hex) before the XML is built, so the packaging step is a pure string splice.
 */

import type { GradientFill, PatternFill } from '@json-to-office/shared-pptx';
import type { PptxThemeConfig, PipelineWarning } from '../types';
import { resolveColor } from './color';

/** OOXML angle unit: 60000ths of a degree. */
const ANGLE_UNIT = 60000;
/** OOXML percentage unit: 1000ths of a percent (0-100 → 0-100000). */
const PCT_UNIT = 1000;

/** fillToRect l/t/r/b values (in 1000ths of a percent) per focus corner. */
const RADIAL_FOCUS_RECTS: Record<
  NonNullable<GradientFill['focus']>,
  { l: number; t: number; r: number; b: number }
> = {
  center: { l: 50000, t: 50000, r: 50000, b: 50000 },
  topLeft: { l: 0, t: 0, r: 100000, b: 100000 },
  topRight: { l: 100000, t: 0, r: 0, b: 100000 },
  bottomLeft: { l: 0, t: 100000, r: 100000, b: 0 },
  bottomRight: { l: 100000, t: 100000, r: 0, b: 0 },
};

function gradientStopXml(
  color: string,
  pos: number,
  transparency: number | undefined,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): string {
  const hex = resolveColor(color, theme, warnings).toUpperCase();
  const alpha =
    transparency !== undefined
      ? `<a:alpha val="${Math.round((100 - transparency) * PCT_UNIT)}"/>`
      : '';
  return `<a:gs pos="${Math.round(pos * PCT_UNIT)}"><a:srgbClr val="${hex}">${alpha}</a:srgbClr></a:gs>`;
}

/**
 * Build an `<a:gradFill>` element from a gradient fill definition.
 */
export function buildGradientFillXml(
  gradient: GradientFill,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): string {
  const stops = gradient.stops
    .map((stop) =>
      gradientStopXml(stop.color, stop.pos, stop.transparency, theme, warnings)
    )
    .join('');

  let shade: string;
  if (gradient.type === 'radial') {
    const rect = RADIAL_FOCUS_RECTS[gradient.focus ?? 'center'];
    shade = `<a:path path="circle"><a:fillToRect l="${rect.l}" t="${rect.t}" r="${rect.r}" b="${rect.b}"/></a:path>`;
  } else {
    const angle = (((gradient.angle ?? 0) % 360) + 360) % 360;
    shade = `<a:lin ang="${Math.round(angle * ANGLE_UNIT)}" scaled="1"/>`;
  }

  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
}

/**
 * Build an `<a:pattFill>` element from a pattern fill definition.
 */
export function buildPatternFillXml(
  pattern: PatternFill,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): string {
  const fg = resolveColor(pattern.foreground, theme, warnings).toUpperCase();
  const bg = resolveColor(pattern.background, theme, warnings).toUpperCase();
  return `<a:pattFill prst="${pattern.preset}"><a:fgClr><a:srgbClr val="${fg}"/></a:fgClr><a:bgClr><a:srgbClr val="${bg}"/></a:bgClr></a:pattFill>`;
}
