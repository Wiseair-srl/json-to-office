/**
 * Border utilities for consistent border styling across modules
 */

/**
 * OOXML border styles, by name.
 *
 * The literal values rather than a backend's enum: `w:val` on a border is a
 * plain OOXML token, and this module is read by the compiler, which imports no
 * renderer.
 */
export type BorderStyleName =
  | 'none'
  | 'single'
  | 'double'
  | 'dashed'
  | 'dotted'
  | 'thick';
import { resolveColor } from './colorUtils';
import { ThemeConfig } from '../index';

/**
 * Standard "no borders" configuration for tables
 * Used when borders should be invisible/disabled
 */
export const NONE_BORDERS = {
  top: { style: 'none', size: 0, color: '000000' },
  right: { style: 'none', size: 0, color: '000000' },
  bottom: { style: 'none', size: 0, color: '000000' },
  left: { style: 'none', size: 0, color: '000000' },
  insideHorizontal: { style: 'none', size: 0, color: '000000' },
  insideVertical: { style: 'none', size: 0, color: '000000' },
} as const;

/**
 * Maps a theme border style name to its OOXML token
 * @param s - Border style string ('dashed', 'dotted', 'double', 'none', 'single')
 * @returns The `w:val` OOXML writes for it
 */
export function mapBorderStyle(s?: string): BorderStyleName {
  switch (s) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'double':
      return 'double';
    case 'none':
      return 'none';
    default:
      return 'single';
  }
}

/**
 * Border configuration object
 */
export interface BorderConfig {
  style?: string;
  width?: number;
  color?: string;
}

/**
 * Converts border configuration to docx border format
 * @param b - Border configuration object
 * @param theme - Theme configuration for color resolution
 * @returns Docx border object or undefined if no border
 */
export function convertBorder(
  b: BorderConfig | undefined,
  theme: ThemeConfig
):
  | {
      style: BorderStyleName;
      size: number;
      color: string;
    }
  | undefined {
  if (!b) return undefined;

  return {
    style: mapBorderStyle(b.style),
    size: b.width !== undefined ? Math.max(1, Math.round(b.width * 8)) : 1,
    color: b.color ? resolveColor(b.color, theme) : '000000',
  };
}

/**
 * Borders configuration for all four sides
 */
export interface BordersConfig {
  top?: BorderConfig;
  right?: BorderConfig;
  bottom?: BorderConfig;
  left?: BorderConfig;
}

/**
 * Converts borders configuration object to docx borders format
 * Returns undefined if no borders are defined
 * @param bordersConfig - Configuration for all four borders
 * @param theme - Theme configuration for color resolution
 * @returns Docx borders object or undefined
 */
export function convertBorders(
  bordersConfig: BordersConfig | undefined,
  theme: ThemeConfig
):
  | Record<
      string,
      {
        style: BorderStyleName;
        size: number;
        color: string;
      }
    >
  | undefined {
  if (!bordersConfig) return undefined;

  const borders: Record<
    string,
    {
      style: BorderStyleName;
      size: number;
      color: string;
    }
  > = {};

  const top = convertBorder(bordersConfig.top, theme);
  const right = convertBorder(bordersConfig.right, theme);
  const bottom = convertBorder(bordersConfig.bottom, theme);
  const left = convertBorder(bordersConfig.left, theme);

  if (top) borders.top = top;
  if (right) borders.right = right;
  if (bottom) borders.bottom = bottom;
  if (left) borders.left = left;

  return Object.keys(borders).length > 0 ? borders : undefined;
}
