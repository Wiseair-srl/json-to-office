/**
 * Centralized Component Defaults Resolution
 * Walks the component tree and resolves theme componentDefaults
 * on every component before any rendering or structure processing.
 */

import type { PptxComponentInput, PptxThemeConfig } from '../types';
import {
  resolveTextProps,
  resolveImageProps,
  resolveShapeProps,
  resolveTableProps,
  resolveHighchartsProps,
  resolveChartProps,
  resolveCustomComponentProps,
} from './componentDefaults';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- resolver map needs wide input to accept all prop types
type Resolver = (props: any, theme: PptxThemeConfig) => Record<string, unknown>;

const RESOLVER_MAP: Record<string, Resolver> = {
  text: resolveTextProps,
  image: resolveImageProps,
  shape: resolveShapeProps,
  table: resolveTableProps,
  highcharts: resolveHighchartsProps,
  chart: resolveChartProps,
};

/**
 * Resolve componentDefaults for a single component.
 * Known components use their typed resolver; unknown names
 * fall back to resolveCustomComponentProps.
 */
export function resolveComponentDefaults(
  component: PptxComponentInput,
  theme: PptxThemeConfig
): PptxComponentInput {
  const resolver = RESOLVER_MAP[component.name];
  const resolvedProps = resolver
    ? resolver(component.props, theme)
    : resolveCustomComponentProps(
        component.props as Record<string, unknown>,
        theme,
        component.name
      );

  return { ...component, props: resolvedProps };
}

/**
 * Recursively walk the component tree and resolve componentDefaults
 * on every component. Returns a new tree (no mutation).
 */
export function resolveComponentTree(
  components: PptxComponentInput[],
  theme: PptxThemeConfig
): PptxComponentInput[] {
  return components.map((component) => {
    const resolved = resolveComponentDefaults(component, theme);

    if (resolved.children && resolved.children.length > 0) {
      return {
        ...resolved,
        children: resolveComponentTree(resolved.children, theme),
      };
    }

    return resolved;
  });
}
