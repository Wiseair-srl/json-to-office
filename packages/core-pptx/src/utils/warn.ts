import type { PipelineWarning } from '../types';

export const W = {
  UNKNOWN_COMPONENT: 'UNKNOWN_COMPONENT',
  UNKNOWN_CHART_TYPE: 'UNKNOWN_CHART_TYPE',
  UNKNOWN_SHAPE: 'UNKNOWN_SHAPE',
  CHART_NO_DATA: 'CHART_NO_DATA',
  CHART_INVALID_SERIES: 'CHART_INVALID_SERIES',
  CHART_MULTI_SERIES: 'CHART_MULTI_SERIES',
  IMAGE_NO_SOURCE: 'IMAGE_NO_SOURCE',
  IMAGE_PROBE_FAILED: 'IMAGE_PROBE_FAILED',
  MISSING_TEMPLATE: 'MISSING_TEMPLATE',
  UNKNOWN_PLACEHOLDER: 'UNKNOWN_PLACEHOLDER',
  PLACEHOLDER_NO_POSITION: 'PLACEHOLDER_NO_POSITION',
  THEME_COLOR_FALLBACK: 'THEME_COLOR_FALLBACK',
  UNKNOWN_COLOR: 'UNKNOWN_COLOR',
  GRID_POSITION_CLAMPED: 'GRID_POSITION_CLAMPED',
  IMAGE_ZERO_BOX: 'IMAGE_ZERO_BOX',
  FONT_UNRESOLVED: 'FONT_UNRESOLVED',
  FONT_EMBED_FAILED: 'FONT_EMBED_FAILED',
} as const;

export type WarningCode = (typeof W)[keyof typeof W];

export function warn(
  warnings: PipelineWarning[] | undefined,
  code: WarningCode,
  message: string,
  extra?: Partial<PipelineWarning>
): void {
  if (warnings) {
    warnings.push({ code, message, ...extra });
  } else {
    console.warn(message);
  }
}
