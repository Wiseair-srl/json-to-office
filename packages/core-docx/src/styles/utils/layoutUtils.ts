import { BorderStyle } from 'docx';
import { LineSpacing } from '@json-to-office/shared-docx';
import { ThemeConfig } from '../index';
import { resolveColor } from './colorUtils';
import {
  resolveTheme,
  resolveFontFamily,
  convertLineSpacing,
  pointsToTwips,
} from './styleHelpers';

/**
 * Subset of a theme StyleProperties entry relevant to paragraph spacing.
 */
interface TableParagraphStyle {
  spacing?: { before?: number; after?: number };
  lineSpacing?: LineSpacing;
}

/**
 * Resolve the paragraph spacing for a table cell/header wrapper paragraph.
 *
 * Table cells render as a single wrapper paragraph. Historically that paragraph
 * inherited the `normal` style, dragging body-prose rhythm (8–10pt after-spacing
 * + 1.4–1.5x line) into every row and inflating row height regardless of font
 * size, padding, or the cell `height` prop. Tables should be dense by default:
 * no extra paragraph spacing, single line. Vertical breathing room is the job of
 * cell padding, not paragraph spacing.
 *
 * Themes may override per context via `styles.tableCell` / `styles.tableHeader`
 * (standard StyleProperties: `spacing.before/after` in points, `lineSpacing`).
 */
const resolveTableParagraphSpacing = (style?: TableParagraphStyle) => {
  const lineSpacing =
    convertLineSpacing(style?.lineSpacing) ??
    convertLineSpacing({ type: 'single' });
  return {
    before:
      style?.spacing?.before !== undefined
        ? pointsToTwips(style.spacing.before)
        : 0,
    after:
      style?.spacing?.after !== undefined
        ? pointsToTwips(style.spacing.after)
        : 0,
    ...lineSpacing,
  };
};

/**
 * Standard page sizes in twips (1/20 of a point, 1/1440 of an inch)
 */
const PAGE_SIZES = {
  A4: { width: 11906, height: 16838 },
  A3: { width: 16838, height: 23811 },
  LETTER: { width: 12240, height: 15840 },
  LEGAL: { width: 12240, height: 20160 },
} as const;

/**
 * Get page dimensions from size (string or object)
 */
function getPageDimensions(
  size: 'A4' | 'A3' | 'LETTER' | 'LEGAL' | { width: number; height: number }
): { width: number; height: number } {
  if (typeof size === 'string') {
    return PAGE_SIZES[size];
  }
  return size;
}

/**
 * Get table style configuration
 * @param theme - Theme configuration object
 * @param themeName - Name of the theme (for fallback to built-in themes)
 * @returns Table style configuration object
 */
export const getTableStyle = (theme?: ThemeConfig, themeName?: string) => {
  const themeConfig = resolveTheme(theme, themeName);

  if (themeConfig && themeConfig.styles?.normal) {
    // Use normal style for run-level header/cell defaults (font, size, color).
    // Paragraph spacing is resolved separately so table rows stay dense and do
    // not inherit `normal`'s body-prose after-spacing/line height.
    const normalStyle = themeConfig.styles.normal;
    const styles = themeConfig.styles as Record<string, TableParagraphStyle>;
    return {
      cellParagraph: resolveTableParagraphSpacing(styles.tableCell),
      headerParagraph: resolveTableParagraphSpacing(styles.tableHeader),
      tableHeader: {
        fill: resolveColor(
          themeConfig.colors?.primary || '#000000',
          themeConfig
        ),
        color: resolveColor(
          themeConfig.colors?.backgroundPrimary || '#FFFFFF',
          themeConfig
        ), // Use background color for header text
        bold: true, // Headers should be bold
        size: (normalStyle.size || 11) * 2, // Convert to half-points
        font: resolveFontFamily(themeConfig, normalStyle.font),
      },
      tableCell: {
        color: resolveColor(normalStyle.color || '#000000', themeConfig),
        size: (normalStyle.size || 11) * 2, // Convert to half-points
        font: resolveFontFamily(themeConfig, normalStyle.font),
      },
      alternatingRow: {
        fill: resolveColor(
          themeConfig.colors?.accent || '#F0F0F0',
          themeConfig
        ),
      },
      borders: {
        top: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: resolveColor(
            themeConfig.colors?.secondary || '#CCCCCC',
            themeConfig
          ),
        },
        bottom: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: resolveColor(
            themeConfig.colors?.secondary || '#CCCCCC',
            themeConfig
          ),
        },
        left: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: resolveColor(
            themeConfig.colors?.secondary || '#CCCCCC',
            themeConfig
          ),
        },
        right: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: resolveColor(
            themeConfig.colors?.secondary || '#CCCCCC',
            themeConfig
          ),
        },
      },
    };
  }

  // This shouldn't happen with minimal themes
  return {
    cellParagraph: resolveTableParagraphSpacing(),
    headerParagraph: resolveTableParagraphSpacing(),
    tableHeader: {
      fill: '000000',
      color: 'FFFFFF',
      bold: true,
      size: 22,
      font: 'Arial',
    },
    tableCell: {
      color: '000000',
      size: 20,
      font: 'Arial',
    },
    alternatingRow: {
      fill: 'F5F5F5',
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: {
        style: BorderStyle.SINGLE,
        size: 1,
        color: '000000',
      },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: {
        style: BorderStyle.SINGLE,
        size: 1,
        color: '000000',
      },
    },
  };
};

/**
 * Get document margins configuration
 * @param theme - Theme configuration object
 * @param themeName - Name of the theme (for fallback to built-in themes)
 * @returns Document margins object
 */
export const getDocumentMargins = (theme?: ThemeConfig, themeName?: string) => {
  const themeConfig = resolveTheme(theme, themeName);

  if (themeConfig?.page?.margins) {
    return themeConfig.page.margins;
  }

  // Default margins for all themes (standard Word document margins)
  return {
    top: 1440, // 1 inch in twips
    right: 1440, // 1 inch in twips
    bottom: 1440, // 1 inch in twips
    left: 1440, // 1 inch in twips
    header: 720, // 0.5 inch in twips
    footer: 720, // 0.5 inch in twips
  };
};

/**
 * Get page setup configuration
 * @param theme - Theme configuration object
 * @param themeName - Name of the theme (for fallback to built-in themes)
 * @returns Page setup object
 */
export const getPageSetup = (theme?: ThemeConfig, themeName?: string) => {
  const themeConfig = resolveTheme(theme, themeName);
  const defaultMargins = getDocumentMargins(theme, themeName);

  if (themeConfig?.page) {
    const margins = themeConfig.page.margins || {};
    const dimensions = getPageDimensions(themeConfig.page.size);
    return {
      size: {
        width: dimensions.width,
        height: dimensions.height,
      },
      margin: {
        top: margins.top ?? defaultMargins.top ?? 1440,
        right: margins.right ?? defaultMargins.right ?? 1440,
        bottom: margins.bottom ?? defaultMargins.bottom ?? 1440,
        left: margins.left ?? defaultMargins.left ?? 1440,
      },
    };
  }

  // Default page setup for all themes
  return {
    size: {
      width: 11906, // 8.5 inches in twips (Letter size)
      height: 16838, // 11.7 inches in twips (Letter size)
    },
    margin: {
      top: defaultMargins.top ?? 1440,
      right: defaultMargins.right ?? 1440,
      bottom: defaultMargins.bottom ?? 1440,
      left: defaultMargins.left ?? 1440,
    },
  };
};
