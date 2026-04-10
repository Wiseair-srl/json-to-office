/**
 * List Component
 * Standard component for rendering list elements in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isListComponent, ListProps } from '../types';
import { ThemeConfig } from '../styles';
import { createList } from '../core/content';
import {
  globalNumberingRegistry,
  createNumberingConfig,
  type NumberingConfig,
  type ListLevelConfig,
} from '../utils/numberingConfig';

/**
 * Convert simplified format to proper level configurations
 */
function createLevelsFromSimplifiedProps(props: ListProps): ListLevelConfig[] {
  const levels: ListLevelConfig[] = [];

  // Determine format from simplified options
  let format: string;
  let text: string | undefined;

  if (props.format) {
    if (props.format === 'numbered') {
      format = 'decimal';
      text = '%1.';
    } else if (props.format === 'none') {
      format = 'none';
      text = '';
    } else {
      format = props.format;
    }
  } else {
    // Default to bullet
    format = 'bullet';
    text = props.bullet || '•';
  }

  // Create level 0 configuration
  const level0: ListLevelConfig = {
    level: 0,
    format,
    text,
    alignment: 'left',
    start: props.start,
  };

  // Add indent if specified
  if (props.indent) {
    if (typeof props.indent === 'number') {
      level0.indent = { left: props.indent };
    } else {
      level0.indent = props.indent;
    }
  }

  levels.push(level0);

  // Add default sublevels for nested lists
  if (format === 'bullet') {
    levels.push(
      { level: 1, format: 'bullet', text: '◦', alignment: 'left' },
      { level: 2, format: 'bullet', text: '▪', alignment: 'left' }
    );
  } else if (format === 'decimal') {
    levels.push(
      { level: 1, format: 'lowerLetter', text: '%2.', alignment: 'left' },
      { level: 2, format: 'lowerRoman', text: '%3.', alignment: 'left' }
    );
  }

  return levels;
}

/**
 * Get the maximum level used in list items
 */
function getMaxLevelFromItems(
  items: (string | { text: string; level?: number })[] | undefined
): number {
  if (!items || !Array.isArray(items)) {
    return 0;
  }

  let maxLevel = 0;
  for (const item of items) {
    if (typeof item === 'object' && item.level !== undefined) {
      maxLevel = Math.max(maxLevel, item.level);
    }
  }
  return maxLevel;
}

/**
 * Fill in missing levels with default configurations
 */
function fillMissingLevels(
  levels: ListLevelConfig[],
  maxLevel: number
): ListLevelConfig[] {
  // Create a map of existing levels
  const levelMap = new Map<number, ListLevelConfig>();
  for (const level of levels) {
    levelMap.set(level.level, level);
  }

  // Get level 0 to determine the base format
  const level0 = levelMap.get(0);
  const baseFormat = level0?.format || 'bullet';

  // Create default levels for any missing ones
  const result: ListLevelConfig[] = [];
  for (let i = 0; i <= maxLevel; i++) {
    if (levelMap.has(i)) {
      result.push(levelMap.get(i)!);
    } else {
      // Create default sublevel based on parent format
      if (baseFormat === 'bullet') {
        const bullets = ['•', '◦', '▪', '▫', '‣'];
        result.push({
          level: i,
          format: 'bullet',
          text: bullets[i % bullets.length],
          alignment: 'left',
        });
      } else if (baseFormat === 'decimal' || baseFormat === 'numbered') {
        const formats = ['decimal', 'lowerLetter', 'lowerRoman'];
        const format = formats[i % formats.length];
        result.push({
          level: i,
          format,
          text: `%${i + 1}.`,
          alignment: 'left',
        });
      } else {
        // For other formats, continue with the same format
        result.push({
          level: i,
          format: baseFormat,
          text: `%${i + 1}.`,
          alignment: 'left',
        });
      }
    }
  }

  return result;
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

  // Determine the maximum level needed from items
  const maxLevel = getMaxLevelFromItems(resolvedConfig.items);

  // Generate or use provided reference ID
  const reference =
    resolvedConfig.reference ||
    globalNumberingRegistry.generateReference('list');

  // Build numbering configuration if not already registered
  if (!globalNumberingRegistry.has(reference)) {
    let levels: ListLevelConfig[];

    if (resolvedConfig.levels && resolvedConfig.levels.length > 0) {
      // Use explicit level configurations, filling in missing levels
      levels = fillMissingLevels(
        resolvedConfig.levels as ListLevelConfig[],
        maxLevel
      );
    } else {
      // Build from simplified options
      const baseLevels = createLevelsFromSimplifiedProps(resolvedConfig);
      levels = fillMissingLevels(baseLevels, maxLevel);
    }

    const config: NumberingConfig = {
      reference,
      levels,
    };
    const numberingConfig = createNumberingConfig(config);
    globalNumberingRegistry.register(numberingConfig);
  }

  // Create the list paragraphs with numbering reference
  return createList(resolvedConfig.items, theme, themeName, {
    numberingReference: reference,
    spacing: resolvedConfig.spacing,
    alignment: resolvedConfig.alignment,
  });
}
