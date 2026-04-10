/**
 * Statistic Component
 * Standard component for rendering statistic displays in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isStatisticComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createStatistic } from '../core/content';

/**
 * Render statistic component
 */
export function renderStatisticComponent(
  component: ComponentDefinition,
  _theme: ThemeConfig
): Paragraph[] {
  if (!isStatisticComponent(component)) return [];

  // Props are pre-resolved by resolveComponentTree
  const resolvedConfig = component.props;

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
