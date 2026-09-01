/**
 * Level derivation for `list` components.
 *
 * Shared by the renderer (which turns these into `w:abstractNum` levels) and by
 * the document-outline pre-pass (which needs each level's format and start to
 * predict the counter a cross-reference should cache). Keeping one definition
 * is the point: a level the renderer numbers `a., b., c.` and a pre-pass that
 * thinks it is decimal produce a field whose cached value Word overwrites on
 * refresh — the silent disagreement cross-references exist to avoid.
 */

import type { ListLevelConfig } from './numberingConfig';

/** The `list` props this module reads, structurally. */
export interface ListLevelSource {
  items?: readonly (string | { readonly level?: number })[];
  levels?: readonly ListLevelConfig[];
  format?: string;
  bullet?: string;
  start?: number;
  indent?: number | { left?: number; hanging?: number };
}

/**
 * Convert simplified format to proper level configurations
 */
function createLevelsFromSimplifiedProps(
  props: ListLevelSource
): ListLevelConfig[] {
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
      // `bullet` must apply to an explicit `format: 'bullet'` too, or a theme
      // default that states both ships a marker character nothing reads.
      if (format === 'bullet') {
        text = props.bullet || '•';
      }
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
 * Fold `props.start` into level 0.
 *
 * `start` is otherwise only read on the simplified path, so an explicit
 * `levels` array silently discarded it. A `start` declared on the level itself
 * is more specific and wins.
 */
function applyListStart(
  levels: readonly ListLevelConfig[],
  start: number | undefined
): ListLevelConfig[] {
  if (start === undefined) return [...levels];
  return levels.map((level) =>
    level.level === 0 && level.start === undefined ? { ...level, start } : level
  );
}

/**
 * Get the maximum level used in list items
 */
export function getMaxLevelFromItems(
  items: readonly (string | { readonly level?: number })[] | undefined
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
  levels: readonly ListLevelConfig[],
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
 * The levels a list's numbering definition ends up with: explicit `levels` when
 * given (with `props.start` folded in), otherwise the simplified shorthand —
 * either way padded out to the deepest level the items actually use.
 */
export function resolveListLevels(props: ListLevelSource): ListLevelConfig[] {
  const maxLevel = getMaxLevelFromItems(props.items);

  if (props.levels && props.levels.length > 0) {
    return fillMissingLevels(
      applyListStart(props.levels, props.start),
      maxLevel
    );
  }

  return fillMissingLevels(createLevelsFromSimplifiedProps(props), maxLevel);
}
