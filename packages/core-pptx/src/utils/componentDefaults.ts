/**
 * PPTX Component Default Resolution System
 * Provides theme-based default configurations for components
 */

import type { PptxThemeConfig } from '../types';
import type {
  PptxComponentDefaults,
  TextComponentDefaults,
  ImageComponentDefaults,
  ShapeComponentDefaults,
  TableComponentDefaults,
  HighchartsComponentDefaults,
  ChartComponentDefaults,
  TextProps,
  PptxImageProps,
  ShapeProps,
  PptxTableProps,
  PptxHighchartsProps,
  PptxChartProps,
} from '@json-to-office/shared-pptx';
import { mergeWithDefaults } from '@json-to-office/shared';

// ── Getters ──────────────────────────────────────────────────────────

export function getComponentDefaults(
  theme: PptxThemeConfig
): PptxComponentDefaults {
  return theme.componentDefaults || {};
}

export function getTextDefaults(theme: PptxThemeConfig): TextComponentDefaults {
  return getComponentDefaults(theme).text || {};
}

export function getImageDefaults(
  theme: PptxThemeConfig
): ImageComponentDefaults {
  return getComponentDefaults(theme).image || {};
}

export function getShapeDefaults(
  theme: PptxThemeConfig
): ShapeComponentDefaults {
  return getComponentDefaults(theme).shape || {};
}

export function getTableDefaults(
  theme: PptxThemeConfig
): TableComponentDefaults {
  return getComponentDefaults(theme).table || {};
}

export function getHighchartsDefaults(
  theme: PptxThemeConfig
): HighchartsComponentDefaults {
  return getComponentDefaults(theme).highcharts || {};
}

export function getChartDefaults(
  theme: PptxThemeConfig
): ChartComponentDefaults {
  return getComponentDefaults(theme).chart || {};
}

export function getCustomComponentDefaults(
  theme: PptxThemeConfig,
  componentName: string
): Record<string, unknown> {
  const defaults = getComponentDefaults(theme);
  return ((defaults as any)?.[componentName] as Record<string, unknown>) || {};
}

// ── Resolvers ────────────────────────────────────────────────────────

export function resolveTextProps(
  props: TextProps,
  theme: PptxThemeConfig
): TextProps {
  return mergeWithDefaults(props, getTextDefaults(theme));
}

export function resolveImageProps(
  props: PptxImageProps,
  theme: PptxThemeConfig
): PptxImageProps {
  return mergeWithDefaults(props, getImageDefaults(theme));
}

export function resolveShapeProps(
  props: ShapeProps,
  theme: PptxThemeConfig
): ShapeProps {
  return mergeWithDefaults(props, getShapeDefaults(theme));
}

export function resolveTableProps(
  props: PptxTableProps,
  theme: PptxThemeConfig
): PptxTableProps {
  return mergeWithDefaults(props, getTableDefaults(theme));
}

export function resolveHighchartsProps(
  props: PptxHighchartsProps,
  theme: PptxThemeConfig
): PptxHighchartsProps {
  return mergeWithDefaults(props, getHighchartsDefaults(theme));
}

export function resolveChartProps(
  props: PptxChartProps,
  theme: PptxThemeConfig
): PptxChartProps {
  return mergeWithDefaults(props, getChartDefaults(theme));
}

export function resolveCustomComponentProps<T extends Record<string, unknown>>(
  props: T,
  theme: PptxThemeConfig,
  componentName: string
): T {
  const defaults = getCustomComponentDefaults(theme, componentName);
  return mergeWithDefaults(props, defaults as Partial<T>);
}

// ── Generic lookup ───────────────────────────────────────────────────

const TYPE_GETTERS: Record<
  string,
  (t: PptxThemeConfig) => Record<string, unknown>
> = {
  text: getTextDefaults,
  image: getImageDefaults,
  shape: getShapeDefaults,
  table: getTableDefaults,
  highcharts: getHighchartsDefaults,
  chart: getChartDefaults,
};

/**
 * Get the flat componentDefaults object for a given component type.
 * Use this when you need the raw defaults without merging into props
 * (e.g. for injecting into a multi-layer shallow spread).
 */
export function getDefaultsForType(
  componentName: string,
  theme: PptxThemeConfig
): Record<string, unknown> {
  const getter = TYPE_GETTERS[componentName];
  return getter
    ? getter(theme)
    : getCustomComponentDefaults(theme, componentName);
}
