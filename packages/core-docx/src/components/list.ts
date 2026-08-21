/**
 * List Component
 * Standard component for rendering list elements in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isListComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createList } from '../core/content';
import {
  globalNumberingRegistry,
  createNumberingConfig,
  type NumberingConfig,
  type ListLevelConfig,
  type ListMarkerFontConfig,
} from '../utils/numberingConfig';
import { resolveListLevels } from '../utils/listLevels';
import { resolveColor } from '../styles/utils/colorUtils';

/**
 * Resolve a level's marker font against the theme.
 *
 * `color` accepts a theme token exactly like every other colour in the schema,
 * but the numbering config is theme-free by the time docx sees it, so the
 * token is resolved here.
 */
function resolveMarkerFonts(
  levels: ListLevelConfig[],
  theme: ThemeConfig
): ListLevelConfig[] {
  return levels.map((level) => {
    const font = level.font as ListMarkerFontConfig | undefined;
    if (!font?.color) return level;
    return {
      ...level,
      font: { ...font, color: resolveColor(font.color, theme) },
    };
  });
}

/**
 * Render list component
 */
export function renderListComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Paragraph[] {
  if (!isListComponent(component)) return [];

  // Props are pre-resolved by resolveComponentTree
  const resolvedConfig = component.props;

  // Generate or use provided reference ID
  const reference =
    resolvedConfig.reference ||
    globalNumberingRegistry.generateReference('list');

  // Build numbering configuration if not already registered
  if (!globalNumberingRegistry.has(reference)) {
    const config: NumberingConfig = {
      reference,
      levels: resolveMarkerFonts(resolveListLevels(resolvedConfig), theme),
    };
    const numberingConfig = createNumberingConfig(config);
    globalNumberingRegistry.register(numberingConfig);
  }

  // Create the list paragraphs with numbering reference
  return createList(resolvedConfig.items, theme, themeName, {
    numberingReference: reference,
    spacing: resolvedConfig.spacing,
    alignment: resolvedConfig.alignment,
    // Review comment spanning the whole list
    comment: resolvedConfig.comment,
  });
}
