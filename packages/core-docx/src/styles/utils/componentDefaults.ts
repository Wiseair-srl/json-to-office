/**
 * Component Default Resolution System
 * Provides theme-based default configurations for components
 */

import {
  ThemeConfig,
  ComponentDefaults,
  HeadingComponentDefaults,
  ParagraphComponentDefaults,
  ImageComponentDefaults,
  StatisticComponentDefaults,
  TableComponentDefaults,
  SectionComponentDefaults,
  ColumnsComponentDefaults,
  ListComponentDefaults,
} from '../index';
import {
  HeadingProps,
  ParagraphProps,
  ImageProps,
  StatisticProps,
  TableProps,
  SectionProps,
  ColumnsProps,
  ListProps,
} from '../../types';

/**
 * Get component defaults from theme configuration
 */
export function getComponentDefaults(theme: ThemeConfig): ComponentDefaults {
  return theme.componentDefaults || {};
}

/**
 * Get default configuration for heading components
 */
export function getHeadingDefaults(
  theme: ThemeConfig
): HeadingComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.heading || {};
}

/**
 * Get level-specific heading defaults from theme styles
 */
export function getHeadingDefaultsForLevel(
  theme: ThemeConfig,
  level: number
): Partial<HeadingComponentDefaults> {
  const defaults: Partial<HeadingComponentDefaults> = {};

  // Check styles for level-specific alignment
  if (theme.styles) {
    const styleKey = `heading${level}` as
      | 'heading1'
      | 'heading2'
      | 'heading3'
      | 'heading4'
      | 'heading5'
      | 'heading6';
    const headingStyle = theme.styles[styleKey];

    if (headingStyle?.alignment) {
      defaults.alignment = headingStyle.alignment;
    }
  }

  return defaults;
}

/**
 * Get default configuration for text components
 */
export function getTextDefaults(
  theme: ThemeConfig
): ParagraphComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.paragraph || {};
}

/**
 * Get default configuration for image components
 */
export function getImageDefaults(theme: ThemeConfig): ImageComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.image || {};
}

/**
 * Get default configuration for statistic components
 */
export function getStatisticDefaults(
  theme: ThemeConfig
): StatisticComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.statistic || {};
}

/**
 * Get default configuration for table components
 */
export function getTableDefaults(theme: ThemeConfig): TableComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.table || {};
}

/**
 * Get default configuration for section components
 */
export function getSectionDefaults(
  theme: ThemeConfig
): SectionComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.section || {};
}

/**
 * Get default configuration for columns components
 */
export function getColumnsDefaults(
  theme: ThemeConfig
): ColumnsComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.columns || {};
}

/**
 * Get default configuration for list components
 */
export function getListDefaults(theme: ThemeConfig): ListComponentDefaults {
  const defaults = getComponentDefaults(theme);
  return defaults?.list || {};
}

/**
 * Deep merge helper for nested objects
 */
function deepMerge<T>(target: any, source: any): T {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }

  return output as T;
}

/**
 * Check if value is a plain object
 */
function isObject(item: any): boolean {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Merge theme defaults with user-provided configuration
 * User config takes precedence over theme defaults
 * Uses deep merge to preserve nested objects like floating configuration
 */
export function mergeWithDefaults<T>(
  userConfig: T,
  themeDefaults: Partial<T>
): T {
  return deepMerge<T>(themeDefaults, userConfig);
}

/**
 * Resolve heading component props with theme defaults
 */
export function resolveHeadingProps(
  props: HeadingProps,
  theme: ThemeConfig
): HeadingProps {
  const defaults = getHeadingDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve paragraph component props with theme defaults
 */
export function resolveParagraphProps(
  props: ParagraphProps,
  theme: ThemeConfig
): ParagraphProps {
  const defaults = getTextDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve image component props with theme defaults
 */
export function resolveImageProps(
  props: ImageProps,
  theme: ThemeConfig
): ImageProps {
  const defaults = getImageDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve statistic component props with theme defaults
 */
export function resolveStatisticProps(
  props: StatisticProps,
  theme: ThemeConfig
): StatisticProps {
  const defaults = getStatisticDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve table component props with theme defaults
 */
export function resolveTableProps(
  props: TableProps,
  theme: ThemeConfig
): TableProps {
  const defaults = getTableDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve section component props with theme defaults
 */
export function resolveSectionProps(
  props: SectionProps,
  theme: ThemeConfig
): SectionProps {
  const defaults = getSectionDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve columns component props with theme defaults
 */
export function resolveColumnsProps(
  props: ColumnsProps,
  theme: ThemeConfig
): ColumnsProps {
  const defaults = getColumnsDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve list component props with theme defaults
 */
export function resolveListProps(
  props: ListProps,
  theme: ThemeConfig
): ListProps {
  const defaults = getListDefaults(theme);
  return mergeWithDefaults(props, defaults);
}

/**
 * Resolve highcharts component props with theme defaults
 */
export function resolveHighchartsProps(
  props: import('@json-to-office/shared-docx').HighchartsProps,
  _theme: ThemeConfig
): import('@json-to-office/shared-docx').HighchartsProps {
  // Highcharts component doesn't have theme defaults, just return the props as-is
  return props;
}

/**
 * Get default configuration for custom components
 */
export function getCustomComponentDefaults(
  theme: ThemeConfig,
  componentName: string
): Record<string, unknown> {
  const defaults = getComponentDefaults(theme);
  // Use type assertion since we're dealing with dynamic property access
  return (
    ((defaults as any)?.[componentName] as Record<string, unknown>) || {}
  );
}

/**
 * Resolve custom component props with theme defaults
 */
export function resolveCustomComponentProps<T extends Record<string, unknown>>(
  props: T,
  theme: ThemeConfig,
  componentName: string
): T {
  const defaults = getCustomComponentDefaults(theme, componentName);
  return mergeWithDefaults(props, defaults as Partial<T>);
}
