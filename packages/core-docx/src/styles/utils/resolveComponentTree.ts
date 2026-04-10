/**
 * Centralized Component Defaults Resolution
 * Walks the component tree and resolves theme componentDefaults
 * on every component before any rendering or structure processing.
 */

import { ComponentDefinition, HeadingProps } from '../../types';
import { ThemeConfig } from '../index';
import {
  resolveHeadingProps,
  resolveParagraphProps,
  resolveImageProps,
  resolveStatisticProps,
  resolveTableProps,
  resolveSectionProps,
  resolveColumnsProps,
  resolveListProps,
  resolveHighchartsProps,
  resolveCustomComponentProps,
  getHeadingDefaultsForLevel,
} from './componentDefaults';

/**
 * Heading resolver that also applies level-specific style defaults
 * (alignment from theme.styles.heading{N}).
 * Moved here from heading.ts to centralize all resolution.
 */
function resolveHeadingWithLevelDefaults(
  props: HeadingProps,
  theme: ThemeConfig
): HeadingProps {
  const resolved = resolveHeadingProps(props, theme);
  const level = resolved.level || 1;
  const levelDefaults = getHeadingDefaultsForLevel(theme, level);
  return {
    ...resolved,
    // Only apply level-specific defaults if no explicit alignment in original props
    ...(props.alignment ? {} : levelDefaults),
  };
}

type Resolver = (props: any, theme: ThemeConfig) => any;

const RESOLVER_MAP: Record<string, Resolver> = {
  heading: resolveHeadingWithLevelDefaults,
  paragraph: resolveParagraphProps,
  image: resolveImageProps,
  statistic: resolveStatisticProps,
  table: resolveTableProps,
  section: resolveSectionProps,
  columns: resolveColumnsProps,
  list: resolveListProps,
  highcharts: resolveHighchartsProps,
};

/**
 * Resolve componentDefaults for a single component.
 * Known components use their typed resolver; unknown names
 * fall back to resolveCustomComponentProps.
 */
export function resolveComponentDefaults(
  component: ComponentDefinition,
  theme: ThemeConfig
): ComponentDefinition {
  if (!component.props) return component;

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
  components: ComponentDefinition[],
  theme: ThemeConfig
): ComponentDefinition[] {
  return components.map((component) => {
    const resolved = resolveComponentDefaults(component, theme);

    const children = (resolved as any).children as
      | ComponentDefinition[]
      | undefined;
    if (children && children.length > 0) {
      return {
        ...resolved,
        children: resolveComponentTree(children, theme),
      };
    }

    return resolved;
  });
}
