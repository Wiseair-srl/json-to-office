/**
 * Statistic Component
 * Standard component for rendering statistic displays in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isStatisticComponent } from '../types';
import { ThemeConfig } from '../styles';
import { resolveStatisticProps } from '../styles/utils/componentDefaults';
import { createStatistic } from '../core/content';

/**
 * Render statistic component
 */
export function renderStatisticComponent(
  component: ComponentDefinition,
  theme: ThemeConfig
): Paragraph[] {
  if (!isStatisticComponent(component)) return [];

  // Resolve configuration with theme defaults
  const resolvedConfig = resolveStatisticProps(component.props, theme);

  return createStatistic(
    {
      number: resolvedConfig.number,
      description: resolvedConfig.description,
      alignment: resolvedConfig.alignment,
    },
    {
      spacing: resolvedConfig.spacing as
        | { before?: number; after?: number }
        | undefined,
    }
  );
}
