/**
 * Cell utilities for building table cell configurations
 */

import { Paragraph, Table } from 'docx';
import { pointsToTwips } from './styleHelpers';
import { resolveColor } from './colorUtils';
import { ThemeConfig } from '../index';
import { convertBorders, BordersConfig } from './borderUtils';

/**
 * Padding configuration for all four sides
 */
export interface PaddingConfig {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Shading configuration
 */
export interface ShadingConfig {
  fill?: string;
}

/**
 * Complete cell style configuration
 */
export interface CellStyleConfig {
  padding?: PaddingConfig;
  border?: BordersConfig;
  shading?: ShadingConfig;
}

/**
 * Builds cell options object for TableCell constructor
 * Handles margins (padding), shading, and borders consistently
 * @param children - Child elements to include in the cell
 * @param styleCfg - Style configuration for the cell
 * @param theme - Theme configuration for color resolution
 * @returns Cell options object ready for TableCell constructor
 */
export function buildCellOptions(
  children: (Paragraph | Table)[],
  styleCfg: CellStyleConfig | undefined,
  theme: ThemeConfig
): {
  children: (Paragraph | Table)[];
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  shading?: { fill: string };
  borders?: Record<string, { style: any; size: number; color: string }>;
} {
  const cellOpts: any = {
    children: children.length ? children : [new Paragraph({})],
    margins: {
      top: styleCfg?.padding?.top ? pointsToTwips(styleCfg.padding.top) : 0,
      right: styleCfg?.padding?.right
        ? pointsToTwips(styleCfg.padding.right)
        : 0,
      bottom: styleCfg?.padding?.bottom
        ? pointsToTwips(styleCfg.padding.bottom)
        : 0,
      left: styleCfg?.padding?.left ? pointsToTwips(styleCfg.padding.left) : 0,
    },
  };

  // Apply shading if configured
  if (styleCfg?.shading?.fill) {
    cellOpts.shading = { fill: resolveColor(styleCfg.shading.fill, theme) };
  }

  // Apply borders if configured
  if (styleCfg?.border) {
    const borders = convertBorders(styleCfg.border, theme);
    if (borders && Object.keys(borders).length > 0) {
      cellOpts.borders = borders;
    }
  }

  return cellOpts;
}
