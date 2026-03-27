/**
 * Content Creation Functions
 * Pure functions for creating Word document elements without layout concerns
 */

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  ImageRun,
  PageBreak,
  WidthType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  ColumnBreak,
  TableLayoutType,
  VerticalAlign,
  Bookmark,
  ExternalHyperlink,
  InternalHyperlink,
} from 'docx';
import {
  calculateImageDimensions,
  getImageBuffer,
  parseWidthValue,
  parseDimensionValue,
} from '../utils/imageUtils';
import { ThemeConfig } from '../styles';
import { getTableStyle } from '../styles';
import { getThemeColors, getThemeFonts } from '../themes/defaults';
import { parseTextWithDecorators } from '../utils/textParser';
import { processTextWithPlaceholders } from '../utils/placeholderProcessor';
import { normalizeUnicodeText } from '../utils/unicode';
import { getStyleIdForLevel } from '../styles/themeToDocxAdapter';
import { globalBookmarkRegistry } from '../utils/bookmarkRegistry';
import { resolveFontFamily } from '../styles/utils/styleHelpers';
import {
  ComponentDefinition,
  isParagraphComponent,
  ParagraphComponentDefinition,
  isImageComponent,
  ImageComponentDefinition,
} from '../types';
import { resolveColor } from '../styles/utils/colorUtils';
import {
  pointsToTwips,
  convertLineSpacing as convertLineSpacingToDocx,
} from '../styles/utils/styleHelpers';
// width/height utils are imported dynamically where needed

export interface TextOptions {
  style?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
  lineSpacing?:
    | number
    | {
        type: 'single' | 'atLeast' | 'exactly' | 'double' | 'multiple';
        value?: number;
      };
  boldColor?: string;
  columnBreak?: boolean;
  // Font properties
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  // Additional children to prepend (e.g., bookmarks)
  prependChildren?: any[];
  // Outline level for TOC
  outlineLevel?: number;
  // Bookmark ID for internal linking
  bookmarkId?: string;
  // Floating frame properties
  floating?: {
    horizontalPosition?: {
      relative?: 'margin' | 'page' | 'text';
      align?: 'left' | 'center' | 'right' | 'inside' | 'outside';
      offset?: number;
    };
    verticalPosition?: {
      relative?: 'margin' | 'page' | 'text';
      align?: 'top' | 'center' | 'bottom' | 'inside' | 'outside' | 'inline';
      offset?: number;
    };
    wrap?: {
      type: 'around' | 'none' | 'notBeside' | 'through' | 'tight' | 'auto';
    };
    lockAnchor?: boolean;
    width?: number;
    height?: number;
  };
  // Keep paragraph with next paragraph
  keepNext?: boolean;
  // Keep all lines of paragraph together
  keepLines?: boolean;
}

export interface ImageOptions {
  caption?: string;
  width?: number | string;
  height?: number | string;
  widthRelativeTo?: 'content' | 'page';
  heightRelativeTo?: 'content' | 'page';
  alignment?: 'left' | 'center' | 'right';
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
  floating?: {
    horizontalPosition?: {
      relative?: 'character' | 'column' | 'margin' | 'page' | 'text';
      align?: 'left' | 'center' | 'right' | 'inside' | 'outside';
      offset?: number;
    };
    verticalPosition?: {
      relative?: 'margin' | 'page' | 'paragraph' | 'line' | 'text';
      align?: 'top' | 'center' | 'bottom' | 'inside' | 'outside';
      offset?: number;
    };
    wrap?: {
      // 'tight', 'around', 'through' are VML-style; only 'none', 'square', 'topAndBottom' are supported for images
      type: 'none' | 'square' | 'topAndBottom' | 'around' | 'tight' | 'through';
      side?: 'bothSides' | 'left' | 'right' | 'largest';
      margins?: {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
    };
    allowOverlap?: boolean;
    behindDocument?: boolean;
    lockAnchor?: boolean;
    layoutInCell?: boolean;
    zIndex?: number;
    rotation?: number;
    visibility?: 'hidden' | 'inherit';
  };
  // Keep paragraph with next paragraph
  keepNext?: boolean;
  // Keep all lines of paragraph together
  keepLines?: boolean;
}

export interface TableOptions {
  style?: 'minimal' | 'classic' | 'minimal';
}

export interface StatisticData {
  number: string;
  description: string;
  alignment?: 'left' | 'center' | 'right';
}

export interface StatisticOptions {
  spacing?: {
    before?: number; // in points
    after?: number; // in points
  };
}

export interface ListOptions {
  // Reference to the numbering configuration in the Document
  numberingReference?: string;
  spacing?: {
    before?: number; // in points
    after?: number; // in points
    item?: number; // in points
  };
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

/**
 * Create a text paragraph
 */
export function createText(
  content: string,
  theme: ThemeConfig,
  _themeName: string,
  options: TextOptions = {}
): Paragraph {
  const normalizedContent = normalizeUnicodeText(content);
  // Always use Normal style for consistent formatting
  const style = options.style || 'Normal';

  // Convert points to twips for spacing
  const spacing: any = {};
  if (options.spacing?.before !== undefined) {
    spacing.before = pointsToTwips(options.spacing.before);
  }
  if (options.spacing?.after !== undefined) {
    spacing.after = pointsToTwips(options.spacing.after);
  }
  // Add line spacing if provided
  const lineSpacingConfig = convertLineSpacingToDocx(options.lineSpacing);
  if (lineSpacingConfig) {
    spacing.line = lineSpacingConfig.line;
    spacing.lineRule = lineSpacingConfig.lineRule;
  }

  // Build children array
  const children: (
    | TextRun
    | ColumnBreak
    | ExternalHyperlink
    | InternalHyperlink
    | Bookmark
  )[] = [];

  // Add column break if requested
  if (options.columnBreak) {
    children.push(new ColumnBreak());
  }

  // Build base text style from options
  const baseTextStyle = {
    ...(options.fontFamily && { font: options.fontFamily }),
    ...(options.fontSize && { size: options.fontSize * 2 }), // Convert points to half-points
    ...(options.fontColor && {
      color: resolveColor(options.fontColor, theme),
    }),
    ...(options.bold !== undefined && { bold: options.bold }),
    ...(options.italic !== undefined && { italics: options.italic }),
    ...(options.underline !== undefined && {
      underline: options.underline ? { type: 'single' as const } : undefined,
    }),
  };

  // Add text content - parseTextWithDecorators handles both decorators and newlines
  const textRuns = parseTextWithDecorators(normalizedContent, baseTextStyle, {
    boldColor: options.boldColor,
    enableHyperlinks: true,
  });

  // If bookmarkId is provided, wrap text runs in a bookmark
  if (options.bookmarkId) {
    // Register bookmark
    globalBookmarkRegistry.register(
      options.bookmarkId,
      normalizedContent,
      'paragraph'
    );

    // Wrap text runs in bookmark
    children.push(
      new Bookmark({
        id: options.bookmarkId,
        children: textRuns as TextRun[],
      })
    );
  } else {
    // No bookmark, add text runs directly
    children.push(...textRuns);
  }

  // Build frame options for floating text
  const isFloating = !!options.floating;
  const frameOptions =
    isFloating && options.floating
      ? mapFrameOptions(options.floating)
      : undefined;

  return new Paragraph({
    children,
    style,
    alignment: options.alignment ? getAlignment(options.alignment) : undefined,
    spacing,
    ...(options.outlineLevel !== undefined && {
      outlineLevel: options.outlineLevel,
    }),
    ...(frameOptions && { frame: frameOptions }),
    ...(options.keepNext !== undefined && { keepNext: options.keepNext }),
    ...(options.keepLines !== undefined && { keepLines: options.keepLines }),
  });
}

/**
 * Map floating frame configuration to docx.js IFrameOptions
 * IFrameOptions can be either IXYFrameOptions (absolute positioning) or IAlignmentFrameOptions (aligned positioning)
 *
 * Supports mixed positioning: alignment on one axis, offset on the other.
 * When mixing, calculates the position for the aligned axis.
 */
function mapFrameOptions(floating: NonNullable<TextOptions['floating']>): any {
  const hasHorizontalOffset = floating.horizontalPosition?.offset !== undefined;
  const hasVerticalOffset = floating.verticalPosition?.offset !== undefined;
  const hasHorizontalAlign = floating.horizontalPosition?.align !== undefined;
  const hasVerticalAlign = floating.verticalPosition?.align !== undefined;

  // Choose exactly one mode: absolute if any offset is present; otherwise alignment
  const useAbsolute = hasHorizontalOffset || hasVerticalOffset;

  // Base frame options
  const frameWidth = floating.width || 2880; // 2in default
  const frameHeight = floating.height || 1440; // 1in default

  const baseOptions: any = {
    width: frameWidth,
    height: frameHeight,
    anchor: {
      horizontal: floating.horizontalPosition?.relative || 'page',
      vertical: floating.verticalPosition?.relative || 'page',
    },
  };

  if (floating.wrap?.type) {
    baseOptions.wrap = floating.wrap.type;
  }

  // Config lockAnchor maps to docx anchorLock
  if (floating.lockAnchor !== undefined) {
    baseOptions.anchorLock = floating.lockAnchor;
  } else if ((floating as any).anchorLock !== undefined) {
    baseOptions.anchorLock = (floating as any).anchorLock;
  }

  if (useAbsolute) {
    // Absolute positioning: use provided offsets; default missing axis to 0
    const x = floating.horizontalPosition?.offset ?? 0;
    const y = floating.verticalPosition?.offset ?? 0;
    return {
      type: 'absolute',
      position: { x, y },
      ...baseOptions,
    };
  }

  // Alignment positioning: use provided aligns; default missing axis
  const xAlign = hasHorizontalAlign
    ? floating.horizontalPosition!.align!
    : 'left';
  const yAlign = hasVerticalAlign ? floating.verticalPosition!.align! : 'top';
  return {
    type: 'alignment',
    alignment: { x: xAlign, y: yAlign },
    ...baseOptions,
  };
}

/**
 * Create a header paragraph
 */
export function createHeading(
  text: string,
  level: number,
  theme: ThemeConfig,
  _themeName: string,
  options: TextOptions = {}
): Paragraph {
  const normalizedText = normalizeUnicodeText(text);
  const styleId = getStyleIdForLevel(level);

  // Only apply spacing if explicitly provided in options
  // This allows theme style spacing to be used by default
  const spacing: any = {};
  let hasExplicitSpacing = false;

  if (options.spacing?.before !== undefined) {
    spacing.before = pointsToTwips(options.spacing.before);
    hasExplicitSpacing = true;
  }
  if (options.spacing?.after !== undefined) {
    spacing.after = pointsToTwips(options.spacing.after);
    hasExplicitSpacing = true;
  }
  // Add line spacing if provided
  const lineSpacingConfig = convertLineSpacingToDocx(options.lineSpacing);
  if (lineSpacingConfig) {
    spacing.line = lineSpacingConfig.line;
    spacing.lineRule = lineSpacingConfig.lineRule;
    hasExplicitSpacing = true;
  }

  // Build children array
  const children: any[] = [];

  // Add prepended children first (e.g., bookmarks)
  if (options.prependChildren) {
    children.push(...options.prependChildren);
  }

  // Add column break if requested
  if (options.columnBreak) {
    children.push(new ColumnBreak());
  }

  // Check if text has decorators (bold/italic markers)
  const hasDecorators = /(\*\*\*|___|(\*\*|__)|(\*|_))/.test(normalizedText);

  // Build base text style from options (overrides theme style at run level)
  const baseTextStyle = {
    ...(options.fontFamily && { font: options.fontFamily }),
    ...(options.fontSize && { size: options.fontSize * 2 }), // points to half-points
    ...(options.fontColor && { color: resolveColor(options.fontColor, theme) }),
    ...(options.bold !== undefined && { bold: options.bold }),
    ...(options.italic !== undefined && { italics: options.italic }),
    ...(options.underline !== undefined && {
      underline: options.underline ? { type: 'single' as const } : undefined,
    }),
  };

  // Create bookmark if bookmarkId is provided
  if (options.bookmarkId) {
    // Register bookmark
    globalBookmarkRegistry.register(
      options.bookmarkId,
      normalizedText,
      'heading'
    );

    // Wrap heading text in bookmark
    const headingTextChildren: (TextRun | any)[] = [];

    if (hasDecorators) {
      // For headings with decorators, parse text runs first
      const textRuns = parseTextWithDecorators(normalizedText, baseTextStyle, {
        boldColor: options.boldColor,
        enableHyperlinks: true,
      });
      headingTextChildren.push(...textRuns);
    } else {
      // For simple headings, add single text run
      headingTextChildren.push(
        new TextRun({ text: normalizedText, ...baseTextStyle })
      );
    }

    // Wrap in bookmark
    children.push(
      new Bookmark({
        id: options.bookmarkId,
        children: headingTextChildren,
      })
    );
  } else {
    // No bookmark, add text directly
    if (hasDecorators) {
      // For headings with decorators, parse and add text runs
      const textRuns = parseTextWithDecorators(normalizedText, baseTextStyle, {
        boldColor: options.boldColor,
        enableHyperlinks: true,
      });
      children.push(...textRuns);
    } else {
      // For simple headings, add single text run
      children.push(new TextRun({ text: normalizedText, ...baseTextStyle }));
    }
  }

  return new Paragraph({
    children,
    style: styleId,
    alignment: getAlignment(options.alignment || 'left'),
    // Only override spacing if explicitly provided
    spacing: hasExplicitSpacing ? spacing : undefined,
    ...(options.keepNext !== undefined && { keepNext: options.keepNext }),
    ...(options.keepLines !== undefined && { keepLines: options.keepLines }),
  });
}

/**
 * Create title page content
 */
export function createTitleContent(
  title?: string,
  subtitle?: string
): Paragraph[] {
  // If no title, return empty array (skip title section entirely)
  if (!title) {
    return [];
  }

  const normalizedTitle = normalizeUnicodeText(title);
  const elements: Paragraph[] = [];

  elements.push(
    new Paragraph({
      text: normalizedTitle,
      style: 'Title',
    })
  );

  if (subtitle) {
    const normalizedSubtitle = normalizeUnicodeText(subtitle);
    elements.push(
      new Paragraph({
        text: normalizedSubtitle,
        style: 'Subtitle',
      })
    );
  }

  elements.push(new Paragraph({ children: [new PageBreak()] }));

  return elements;
}

/**
 * Create an image with optional caption
 */
export async function createImage(
  path: string,
  theme: ThemeConfig,
  options: ImageOptions = {}
): Promise<Paragraph[]> {
  const elements: Paragraph[] = [];
  const isFloating = !!options.floating;
  const alignment = isFloating
    ? undefined
    : getAlignment(options.alignment || 'center');

  let imagePath = path;
  let imageBuffer: Buffer;

  try {
    // Try to use the provided path first
    imageBuffer = await getImageBuffer(imagePath);

    // Calculate available document width/height for percentage calculations
    const {
      getAvailableWidthTwips,
      getPageWidthTwips,
      getAvailableHeightTwips,
      getPageHeightTwips,
    } = await import('../utils/widthUtils');
    const widthRef = options.widthRelativeTo || 'content';
    const heightRef = options.heightRelativeTo || 'content';
    const availableWidthTwips =
      widthRef === 'page'
        ? getPageWidthTwips(theme)
        : getAvailableWidthTwips(theme);
    const availableHeightTwips =
      heightRef === 'page'
        ? getPageHeightTwips(theme)
        : getAvailableHeightTwips(theme);
    // Convert twips to pixels: 1 twip = 1/1440 inch, 1 inch = 96 pixels (screen DPI)
    const availableWidthPx = Math.round((availableWidthTwips / 1440) * 96);
    const availableHeightPx = Math.round((availableHeightTwips / 1440) * 96);

    // Default size calculations (fallback)
    const columnWidthCm = 7.36;
    const pixelsPerCm = 37.795275591;
    const columnWidthPx = Math.round(columnWidthCm * pixelsPerCm);
    const fallbackHeight = Math.round(columnWidthPx * 0.6);

    // Parse width value (handles both number and percentage string)
    // Default to 100% if no width is specified
    const parsedWidth = parseWidthValue(
      options.width ?? '100%',
      availableWidthPx
    );

    // Parse height value if provided
    const parsedHeight =
      options.height !== undefined
        ? parseDimensionValue(options.height, availableHeightPx)
        : undefined;

    // Calculate dimensions with aspect ratio preservation
    const dimensions = await calculateImageDimensions(
      imagePath,
      parsedWidth,
      parsedHeight,
      columnWidthPx,
      fallbackHeight
    );

    // Build ImageRun configuration with optional floating
    const { mapFloatingOptions } = await import(
      '../utils/docxImagePositioning'
    );
    const floating = isFloating
      ? mapFloatingOptions(options.floating)
      : undefined;

    // Detect image type from path/base64 data URI
    const { detectImageType } = await import('../utils/imageUtils');
    const imageType = detectImageType(imagePath);

    // Create ImageRun based on image type
    const imageRun =
      imageType === 'svg'
        ? new ImageRun({
            type: 'svg',
            data: imageBuffer,
            fallback: {
              type: 'png',
              data: imageBuffer, // Use the same buffer as fallback for now
            },
            transformation: {
              width: dimensions.width,
              height: dimensions.height,
            },
            ...(floating && { floating }),
          })
        : new ImageRun({
            type: imageType,
            data: imageBuffer,
            transformation: {
              width: dimensions.width,
              height: dimensions.height,
            },
            ...(floating && { floating }),
          });

    // Convert spacing from points to twips
    const spacing: any = {};
    if (options.spacing?.before !== undefined) {
      spacing.before = pointsToTwips(options.spacing.before);
    }
    if (options.spacing?.after !== undefined) {
      spacing.after = pointsToTwips(options.spacing.after);
    }

    elements.push(
      new Paragraph({
        children: [imageRun],
        alignment,
        ...(Object.keys(spacing).length > 0 && { spacing }),
        ...(options.keepNext !== undefined && { keepNext: options.keepNext }),
        ...(options.keepLines !== undefined && {
          keepLines: options.keepLines,
        }),
      })
    );
  } catch (error) {
    // If the image cannot be loaded, try the placeholder
    throw new Error(`Failed to load image from ${imagePath}`);
  }

  if (options.caption) {
    // Check if caption has decorators (bold/italic markers)
    const hasDecorators = /(\*\*\*|___|(\*\*|__)|(\*|_))/.test(options.caption);

    if (!hasDecorators) {
      // No decorators - use Normal style for font inheritance
      elements.push(
        new Paragraph({
          text: normalizeUnicodeText(options.caption),
          style: 'Normal',
          alignment: AlignmentType.LEFT, // Captions default to left alignment
        })
      );
    } else {
      // Has decorators - use parseTextWithDecorators (same as text component)
      const textRuns = parseTextWithDecorators(
        options.caption,
        {},
        {
          enableHyperlinks: true,
        }
      );

      elements.push(
        new Paragraph({
          children: textRuns,
          style: 'Normal', // Use Normal style for consistent font inheritance
          alignment: AlignmentType.LEFT, // Captions default to left alignment
        })
      );
    }
  }

  return elements;
}

/**
 * Create a statistic display
 */
export function createStatistic(
  data: StatisticData,
  options: StatisticOptions = {}
): Paragraph[] {
  const alignment = getAlignment(data.alignment || 'center');
  const normalizedNumber = normalizeUnicodeText(data.number);
  const normalizedDescription = normalizeUnicodeText(data.description);

  return [
    new Paragraph({
      text: normalizedNumber,
      style: 'StatisticNumber',
      alignment,
      spacing: options.spacing,
    }),
    new Paragraph({
      text: normalizedDescription,
      style: 'StatisticDescription',
      alignment,
    }),
  ];
}

/**
 * Create a list of items using proper docx numbering
 */
export function createList(
  items: (string | { text: string; level?: number })[],
  _theme: ThemeConfig,
  _themeName: string,
  options: ListOptions = {}
): Paragraph[] {
  if (!items || items.length === 0) {
    return [];
  }

  const paragraphs: Paragraph[] = [];

  items.forEach((item, index) => {
    // Handle both string and object items
    const itemText = typeof item === 'string' ? item : item.text;
    const itemLevel = typeof item === 'object' ? item.level || 0 : 0;

    if (!itemText.trim()) {
      return; // Skip empty items
    }

    // Parse rich text decorators for each item
    // Don't pass font/size/color - let list items inherit from Normal paragraph style
    const textRuns = parseTextWithDecorators(
      itemText,
      {},
      {
        enableHyperlinks: true,
      }
    );

    // Calculate spacing for this item (convert points to twips)
    const spacing: { before?: number; after?: number } = {};
    if (index === 0 && options.spacing?.before) {
      spacing.before = pointsToTwips(options.spacing.before);
    }
    if (index === items.length - 1 && options.spacing?.after) {
      spacing.after = pointsToTwips(options.spacing.after);
    } else if (options.spacing?.item) {
      spacing.after = pointsToTwips(options.spacing.item);
    }

    // Create the paragraph with proper numbering reference
    const paragraph = new Paragraph({
      style: 'Normal', // Apply Normal style for font inheritance
      children: textRuns,
      alignment: options.alignment
        ? getAlignment(options.alignment)
        : AlignmentType.LEFT,
      spacing,
      // Use proper docx numbering instead of prepending text
      ...(options.numberingReference && {
        numbering: {
          reference: options.numberingReference,
          level: itemLevel,
        },
      }),
    });

    paragraphs.push(paragraph);
  });

  return paragraphs;
}

/**
 * Create a table
 */
type TableFontConfig = {
  family?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type BorderColor =
  | string
  | {
      bottom?: string;
      top?: string;
      right?: string;
      left?: string;
    };

type BorderSize =
  | number
  | {
      bottom?: number;
      top?: number;
      right?: number;
      left?: number;
    };

type Padding =
  | number
  | {
      bottom?: number;
      top?: number;
      right?: number;
      left?: number;
    };

type CellDefaults = {
  color?: string;
  backgroundColor?: string;
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  font?: TableFontConfig;
  borderColor?: BorderColor;
  borderSize?: BorderSize;
  padding?: Padding;
  height?: number;
};

// After merging, borders and padding are always normalized to per-side format
type NormalizedCellDefaults = {
  color?: string;
  backgroundColor?: string;
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  font?: TableFontConfig;
  borderColor: { top: string; right: string; bottom: string; left: string };
  borderSize: { top: number; right: number; bottom: number; left: number };
  padding?: { top: number; right: number; bottom: number; left: number };
  height?: number;
};

// Hide borders configuration - can be boolean or per-side object
type HideBorders =
  | boolean
  | {
      top?: boolean;
      right?: boolean;
      bottom?: boolean;
      left?: boolean;
      insideHorizontal?: boolean;
      insideVertical?: boolean;
    };

type TableConfig = {
  borderColor?: BorderColor;
  borderSize?: BorderSize;
  hideBorders?: HideBorders;
  cellDefaults?: CellDefaults;
  headerCellDefaults?: CellDefaults;
  width?: number;
  columns: {
    /** Width in points (number) or as percentage string e.g. "40%" */
    width?: number | string;
    cellDefaults?: CellDefaults;
    header?: CellDefaults & {
      content?: string | ComponentDefinition;
    };
    cells?: (CellDefaults & {
      content?: string | ComponentDefinition;
    })[];
  }[];
  keepInOnePage?: boolean;
  keepNext?: boolean;
  repeatHeaderOnPageBreak?: boolean;
};

export async function createTable(
  columns: TableConfig['columns'],
  tableConfig: TableConfig,
  theme: ThemeConfig,
  themeName: string,
  _options: TableOptions = {}
): Promise<Table> {
  // Note: _options parameter is available for future table customization
  const tableStyle = getTableStyle(theme, themeName);

  // Determine number of rows from the first column
  const numRows = columns[0]?.cells?.length || 0;

  // Default values for missing cell defaults
  const getDefaultCellDefaults = (): CellDefaults => ({
    color: '000000',
    backgroundColor: 'FFFFFF',
    horizontalAlignment: 'left',
    verticalAlignment: 'top',
    font: {
      family: 'Arial',
      size: 11,
      bold: false,
      italic: false,
      underline: false,
    },
    borderColor: '000000',
    borderSize: 1,
  });

  // Helper function to normalize border color to per-side format
  const normalizeBorderColor = (
    border: BorderColor | undefined
  ):
    | { top: string; right: string; bottom: string; left: string }
    | undefined => {
    if (border === undefined) return undefined;
    if (typeof border === 'string') {
      return { top: border, right: border, bottom: border, left: border };
    }
    return {
      top: border.top ?? '',
      right: border.right ?? '',
      bottom: border.bottom ?? '',
      left: border.left ?? '',
    };
  };

  // Helper function to normalize border size to per-side format
  const normalizeBorderSize = (
    border: BorderSize | undefined
  ):
    | { top: number; right: number; bottom: number; left: number }
    | undefined => {
    if (border === undefined) return undefined;
    if (typeof border === 'number') {
      return { top: border, right: border, bottom: border, left: border };
    }
    return {
      top: border.top ?? -1,
      right: border.right ?? -1,
      bottom: border.bottom ?? -1,
      left: border.left ?? -1,
    };
  };

  // Helper function to normalize padding to per-side format
  const normalizePadding = (
    padding: Padding | undefined
  ):
    | { top: number; right: number; bottom: number; left: number }
    | undefined => {
    if (padding === undefined) return undefined;
    if (typeof padding === 'number') {
      return { top: padding, right: padding, bottom: padding, left: padding };
    }
    return {
      top: padding.top ?? -1,
      right: padding.right ?? -1,
      bottom: padding.bottom ?? -1,
      left: padding.left ?? -1,
    };
  };

  // Helper function to merge border colors at the side level
  const mergeBorderColorPerSide = (
    ...borders: (BorderColor | undefined)[]
  ): { top: string; right: string; bottom: string; left: string } => {
    const normalized = borders.map(normalizeBorderColor);
    const defaults = getDefaultCellDefaults();
    const defaultColor =
      typeof defaults.borderColor === 'string'
        ? defaults.borderColor
        : '000000';

    return {
      top: normalized.find((b) => b && b.top !== '')?.top ?? defaultColor,
      right: normalized.find((b) => b && b.right !== '')?.right ?? defaultColor,
      bottom:
        normalized.find((b) => b && b.bottom !== '')?.bottom ?? defaultColor,
      left: normalized.find((b) => b && b.left !== '')?.left ?? defaultColor,
    };
  };

  // Helper function to merge border sizes at the side level
  const mergeBorderSizePerSide = (
    ...borders: (BorderSize | undefined)[]
  ): { top: number; right: number; bottom: number; left: number } => {
    const normalized = borders.map(normalizeBorderSize);
    const defaults = getDefaultCellDefaults();
    const defaultSize =
      typeof defaults.borderSize === 'number' ? defaults.borderSize : 1;

    return {
      top: normalized.find((b) => b && b.top !== -1)?.top ?? defaultSize,
      right: normalized.find((b) => b && b.right !== -1)?.right ?? defaultSize,
      bottom:
        normalized.find((b) => b && b.bottom !== -1)?.bottom ?? defaultSize,
      left: normalized.find((b) => b && b.left !== -1)?.left ?? defaultSize,
    };
  };

  // Helper to create border override for table outer borders based on position
  const getTableOuterBorder = (
    position: {
      isHeader?: boolean;
      isFirstCol?: boolean;
      isLastCol?: boolean;
      isLastRow?: boolean;
    },
    tableBorderColor?: BorderColor,
    tableBorderSize?: BorderSize
  ): {
    borderColor?: Partial<{
      top: string;
      right: string;
      bottom: string;
      left: string;
    }>;
    borderSize?: Partial<{
      top: number;
      right: number;
      bottom: number;
      left: number;
    }>;
  } => {
    const result: {
      borderColor?: Partial<{
        top: string;
        right: string;
        bottom: string;
        left: string;
      }>;
      borderSize?: Partial<{
        top: number;
        right: number;
        bottom: number;
        left: number;
      }>;
    } = {};

    if (tableBorderColor) {
      const normalizedColor = normalizeBorderColor(tableBorderColor);
      if (normalizedColor) {
        result.borderColor = {};
        if (position.isHeader && normalizedColor.top !== '')
          result.borderColor.top = normalizedColor.top;
        if (position.isFirstCol && normalizedColor.left !== '')
          result.borderColor.left = normalizedColor.left;
        if (position.isLastCol && normalizedColor.right !== '')
          result.borderColor.right = normalizedColor.right;
        if (position.isLastRow && normalizedColor.bottom !== '')
          result.borderColor.bottom = normalizedColor.bottom;
      }
    }

    if (tableBorderSize) {
      const normalizedSize = normalizeBorderSize(tableBorderSize);
      if (normalizedSize) {
        result.borderSize = {};
        if (position.isHeader && normalizedSize.top !== -1)
          result.borderSize.top = normalizedSize.top;
        if (position.isFirstCol && normalizedSize.left !== -1)
          result.borderSize.left = normalizedSize.left;
        if (position.isLastCol && normalizedSize.right !== -1)
          result.borderSize.right = normalizedSize.right;
        if (position.isLastRow && normalizedSize.bottom !== -1)
          result.borderSize.bottom = normalizedSize.bottom;
      }
    }

    return result;
  };

  // Helper function to merge padding at the side level
  const mergePaddingPerSide = (
    ...paddings: (Padding | undefined)[]
  ):
    | { top: number; right: number; bottom: number; left: number }
    | undefined => {
    const normalized = paddings.map(normalizePadding);
    const hasAny = normalized.some((p) => p !== undefined);
    if (!hasAny) return undefined;

    return {
      top: normalized.find((p) => p && p.top !== -1)?.top ?? 0,
      right: normalized.find((p) => p && p.right !== -1)?.right ?? 0,
      bottom: normalized.find((p) => p && p.bottom !== -1)?.bottom ?? 0,
      left: normalized.find((p) => p && p.left !== -1)?.left ?? 0,
    };
  };

  // Helper function to merge cell defaults with priority: cell > column > table outer border (for specific sides) > table cellDefaults > default
  const mergeCellDefaults = (
    tableDef?: CellDefaults,
    columnDef?: CellDefaults,
    cellDef?: Partial<CellDefaults>,
    position?: {
      isFirstCol?: boolean;
      isLastCol?: boolean;
      isLastRow?: boolean;
    },
    tableOuterBorder?: { borderColor?: BorderColor; borderSize?: BorderSize }
  ): NormalizedCellDefaults => {
    const defaults = getDefaultCellDefaults();

    // Merge font configs
    const mergedFont: TableFontConfig = {
      ...defaults.font,
      ...tableDef?.font,
      ...columnDef?.font,
      ...cellDef?.font,
    };

    // Get table outer border overrides based on position
    const outerBorder =
      position && tableOuterBorder
        ? getTableOuterBorder(
            position,
            tableOuterBorder.borderColor,
            tableOuterBorder.borderSize
          )
        : {};

    // Merge border colors per side (priority: cell > column > table outer border > table cellDefaults > table borderColor > default)
    // tableOuterBorder.borderColor is used twice: via outerBorder for edge-specific application,
    // and directly as fallback for ALL borders when not overridden by cellDefaults
    const mergedBorderColor = mergeBorderColorPerSide(
      cellDef?.borderColor,
      columnDef?.borderColor,
      outerBorder.borderColor as BorderColor,
      tableDef?.borderColor,
      tableOuterBorder?.borderColor // Apply table-level borderColor to all cells as fallback
    );

    // Merge border sizes per side (priority: cell > column > table outer border > table cellDefaults > table borderSize > default)
    const mergedBorderSize = mergeBorderSizePerSide(
      cellDef?.borderSize,
      columnDef?.borderSize,
      outerBorder.borderSize as BorderSize,
      tableDef?.borderSize,
      tableOuterBorder?.borderSize // Apply table-level borderSize to all cells as fallback
    );

    // Merge padding per side (priority: cell > column > table)
    const mergedPadding = mergePaddingPerSide(
      cellDef?.padding,
      columnDef?.padding,
      tableDef?.padding
    );

    return {
      color:
        cellDef?.color ?? columnDef?.color ?? tableDef?.color ?? defaults.color,
      backgroundColor:
        cellDef?.backgroundColor ??
        columnDef?.backgroundColor ??
        tableDef?.backgroundColor ??
        defaults.backgroundColor,
      horizontalAlignment:
        cellDef?.horizontalAlignment ??
        columnDef?.horizontalAlignment ??
        tableDef?.horizontalAlignment ??
        defaults.horizontalAlignment,
      verticalAlignment:
        cellDef?.verticalAlignment ??
        columnDef?.verticalAlignment ??
        tableDef?.verticalAlignment ??
        defaults.verticalAlignment,
      font: mergedFont,
      borderColor: mergedBorderColor,
      borderSize: mergedBorderSize,
      padding: mergedPadding,
      height: cellDef?.height ?? columnDef?.height ?? tableDef?.height,
    };
  };

  // Helper function to merge header cell defaults with priority: header > columnCellDefaults > table outer border (for specific sides) > headerCellDefaults > cellDefaults > default
  const mergeHeaderCellDefaults = (
    tableDef?: CellDefaults,
    headerTableDef?: CellDefaults,
    columnDef?: CellDefaults,
    headerDef?: Partial<CellDefaults>,
    position?: { isFirstCol?: boolean; isLastCol?: boolean },
    tableOuterBorder?: { borderColor?: BorderColor; borderSize?: BorderSize }
  ): NormalizedCellDefaults => {
    const defaults = getDefaultCellDefaults();

    // Merge font configs with new priority
    const mergedFont: TableFontConfig = {
      ...defaults.font,
      ...tableDef?.font,
      ...headerTableDef?.font,
      ...columnDef?.font,
      ...headerDef?.font,
    };

    // Get table outer border overrides based on position (headers always affect top border)
    const outerBorder =
      position && tableOuterBorder
        ? getTableOuterBorder(
            {
              isHeader: true,
              isFirstCol: position.isFirstCol,
              isLastCol: position.isLastCol,
            },
            tableOuterBorder.borderColor,
            tableOuterBorder.borderSize
          )
        : {};

    // Merge border colors per side (priority: header > columnCellDefaults > table outer border > headerCellDefaults > cellDefaults > table borderColor > default)
    // tableOuterBorder.borderColor is used twice: via outerBorder for edge-specific application,
    // and directly as fallback for ALL borders when not overridden by cellDefaults
    const mergedBorderColor = mergeBorderColorPerSide(
      headerDef?.borderColor,
      columnDef?.borderColor,
      outerBorder.borderColor as BorderColor,
      headerTableDef?.borderColor,
      tableDef?.borderColor,
      tableOuterBorder?.borderColor // Apply table-level borderColor to all cells as fallback
    );

    // Merge border sizes per side (priority: header > columnCellDefaults > table outer border > headerCellDefaults > cellDefaults > table borderSize > default)
    const mergedBorderSize = mergeBorderSizePerSide(
      headerDef?.borderSize,
      columnDef?.borderSize,
      outerBorder.borderSize as BorderSize,
      headerTableDef?.borderSize,
      tableDef?.borderSize,
      tableOuterBorder?.borderSize // Apply table-level borderSize to all cells as fallback
    );

    // Merge padding per side (priority: header > headerCellDefaults > columnCellDefaults > cellDefaults)
    const mergedPadding = mergePaddingPerSide(
      headerDef?.padding,
      headerTableDef?.padding,
      columnDef?.padding,
      tableDef?.padding
    );

    return {
      color:
        headerDef?.color ??
        headerTableDef?.color ??
        columnDef?.color ??
        tableDef?.color ??
        defaults.color,
      backgroundColor:
        headerDef?.backgroundColor ??
        headerTableDef?.backgroundColor ??
        columnDef?.backgroundColor ??
        tableDef?.backgroundColor ??
        defaults.backgroundColor,
      horizontalAlignment:
        headerDef?.horizontalAlignment ??
        headerTableDef?.horizontalAlignment ??
        columnDef?.horizontalAlignment ??
        tableDef?.horizontalAlignment ??
        defaults.horizontalAlignment,
      verticalAlignment:
        headerDef?.verticalAlignment ??
        headerTableDef?.verticalAlignment ??
        columnDef?.verticalAlignment ??
        tableDef?.verticalAlignment ??
        defaults.verticalAlignment,
      font: mergedFont,
      borderColor: mergedBorderColor,
      borderSize: mergedBorderSize,
      padding: mergedPadding,
      height:
        headerDef?.height ??
        headerTableDef?.height ??
        columnDef?.height ??
        tableDef?.height,
    };
  };

  // Helper function to get border value for a specific side
  // After normalization, borders are always objects with side properties
  const getBorderValue = (
    border: {
      top: string | number;
      right: string | number;
      bottom: string | number;
      left: string | number;
    },
    side: 'top' | 'bottom' | 'left' | 'right'
  ) => {
    return border[side];
  };

  // Helper function to get padding value for a specific side
  // After normalization, padding is always an object with side properties or undefined
  const getPaddingValue = (
    padding:
      | { top: number; right: number; bottom: number; left: number }
      | undefined,
    side: 'top' | 'bottom' | 'left' | 'right'
  ): number | undefined => {
    if (padding === undefined) return undefined;
    return padding[side] * 20; // Convert points to twips
  };

  // Helper function to create margins object from padding
  // After normalization, padding is always an object with side properties or undefined
  // Returns ITableCellMarginOptions with marginUnitType set to DXA (twips)
  const createMarginsFromPadding = (
    padding:
      | { top: number; right: number; bottom: number; left: number }
      | undefined
  ) => {
    if (padding === undefined) return undefined;

    return {
      marginUnitType: WidthType.DXA, // Specify that values are in twips
      top: getPaddingValue(padding, 'top') ?? 0,
      bottom: getPaddingValue(padding, 'bottom') ?? 0,
      left: getPaddingValue(padding, 'left') ?? 0,
      right: getPaddingValue(padding, 'right') ?? 0,
    };
  };

  // Normalize hideBorders config to per-side format
  const normalizeHideBorders = (
    hideBorders: HideBorders | undefined
  ): {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
    insideHorizontal: boolean;
    insideVertical: boolean;
  } => {
    if (hideBorders === undefined) {
      return {
        top: false,
        right: false,
        bottom: false,
        left: false,
        insideHorizontal: false,
        insideVertical: false,
      };
    }
    if (typeof hideBorders === 'boolean') {
      return {
        top: hideBorders,
        right: hideBorders,
        bottom: hideBorders,
        left: hideBorders,
        insideHorizontal: hideBorders,
        insideVertical: hideBorders,
      };
    }
    return {
      top: hideBorders.top ?? false,
      right: hideBorders.right ?? false,
      bottom: hideBorders.bottom ?? false,
      left: hideBorders.left ?? false,
      insideHorizontal: hideBorders.insideHorizontal ?? false,
      insideVertical: hideBorders.insideVertical ?? false,
    };
  };

  // Normalized hidden borders config
  const hiddenBorders = normalizeHideBorders(tableConfig.hideBorders);

  // Helper function to create border config
  const createBorder = (size: number, color: string, isHidden?: boolean) => {
    if (size === 0 || isHidden) {
      return { style: BorderStyle.NONE, size: 0, color: '000000' };
    }
    return {
      style: BorderStyle.SINGLE,
      size: size * 8, // Convert points to eighths of a point
      color: color || '000000',
    };
  };

  // Helper to determine if a specific border should be hidden based on cell position
  const shouldHideBorder = (
    side: 'top' | 'right' | 'bottom' | 'left',
    position: {
      isFirstRow?: boolean;
      isLastRow?: boolean;
      isFirstCol?: boolean;
      isLastCol?: boolean;
    }
  ): boolean => {
    // Map cell position to which hideBorders config applies
    // Outer borders use top/right/bottom/left, inner borders use insideHorizontal/insideVertical
    switch (side) {
      case 'top':
        return position.isFirstRow
          ? hiddenBorders.top
          : hiddenBorders.insideHorizontal;
      case 'bottom':
        return position.isLastRow
          ? hiddenBorders.bottom
          : hiddenBorders.insideHorizontal;
      case 'left':
        return position.isFirstCol
          ? hiddenBorders.left
          : hiddenBorders.insideVertical;
      case 'right':
        return position.isLastCol
          ? hiddenBorders.right
          : hiddenBorders.insideVertical;
      default:
        return false;
    }
  };

  // Helper function to process cell content
  const processCellContent = async (
    cell: string | ComponentDefinition | undefined,
    cellDefaults: NormalizedCellDefaults,
    baseCellStyle: typeof tableStyle.tableCell
  ): Promise<
    (TextRun | ImageRun | ExternalHyperlink | InternalHyperlink)[]
  > => {
    let cellChildren: (
      | TextRun
      | ImageRun
      | ExternalHyperlink
      | InternalHyperlink
    )[] = [];

    // Handle undefined or empty content
    if (!cell) {
      return cellChildren;
    }

    // Create merged style with config overrides
    const mergedStyle = {
      font: cellDefaults.font?.family || baseCellStyle.font,
      size: cellDefaults.font?.size
        ? cellDefaults.font.size * 2
        : baseCellStyle.size, // Convert to half-points
      bold: cellDefaults.font?.bold ?? false,
      italics: cellDefaults.font?.italic ?? false,
      underline: cellDefaults.font?.underline
        ? { type: 'single' as const }
        : undefined,
      color: cellDefaults.color || baseCellStyle.color,
    };

    if (typeof cell === 'object' && 'name' in cell && 'props' in cell) {
      // Handle ComponentDefinition
      if (isParagraphComponent(cell)) {
        const textComp = cell as ParagraphComponentDefinition;
        cellChildren = parseTextWithDecorators(
          textComp.props.text,
          mergedStyle,
          { enableHyperlinks: true }
        );
      } else if (isImageComponent(cell)) {
        const imageComp = cell as ImageComponentDefinition;
        try {
          // Get image source (base64 or path)
          const imageSource = imageComp.props.base64 || imageComp.props.path;
          if (!imageSource) {
            throw new Error(
              'Image component requires either "path" or "base64" property'
            );
          }

          // Read from local file, URL, or base64
          const imageBuffer = await getImageBuffer(imageSource);

          // Parse width value if it's a string percentage (like "90%")
          const parsedWidth =
            typeof imageComp.props.width === 'string'
              ? parseWidthValue(imageComp.props.width, 300) // Use a reasonable default for table context
              : imageComp.props.width;

          // Parse height value if it's a string percentage (like "90%")
          const parsedHeight =
            typeof imageComp.props.height === 'string'
              ? parseWidthValue(imageComp.props.height, 200) // Use a reasonable default for table context
              : imageComp.props.height;

          // Calculate dimensions with aspect ratio preservation
          const dimensions = await calculateImageDimensions(
            imageSource,
            parsedWidth,
            parsedHeight,
            60, // fallback width
            20 // fallback height
          );

          const imageRun = new ImageRun({
            type: 'png',
            data: imageBuffer,
            transformation: {
              width: dimensions.width,
              height: dimensions.height,
            },
          });
          cellChildren = [imageRun];
        } catch (error) {
          // Fallback for missing images
          const imageSource =
            imageComp.props.base64 || imageComp.props.path || 'unknown';
          cellChildren = [
            new TextRun({
              text: `[IMAGE: ${imageSource.substring(0, 50)}${imageSource.length > 50 ? '...' : ''}]`,
              font: mergedStyle.font,
              size: mergedStyle.size,
              color: '#999999',
            }),
          ];
        }
      } else {
        // Unsupported component type in table cell
        cellChildren = [
          new TextRun({
            text: `[Unsupported component type: ${cell.name}]`,
            font: mergedStyle.font,
            size: mergedStyle.size,
            color: '#999999',
          }),
        ];
      }
    } else {
      // Handle plain string
      cellChildren = parseTextWithDecorators(cell as string, mergedStyle, {
        enableHyperlinks: true,
      });
    }

    return cellChildren;
  };

  // Create header row by iterating through columns
  // Calculate row height from any header cell that defines it
  const numColumns = columns.length;
  const headerHeight = columns.reduce<number | undefined>(
    (maxHeight, column, colIndex) => {
      const headerCell = column.header;
      const position = {
        isFirstCol: colIndex === 0,
        isLastCol: colIndex === numColumns - 1,
      };
      const mergedDefaults = mergeHeaderCellDefaults(
        tableConfig.cellDefaults,
        tableConfig.headerCellDefaults,
        column.cellDefaults,
        headerCell,
        position,
        {
          borderColor: tableConfig.borderColor,
          borderSize: tableConfig.borderSize,
        }
      );
      if (mergedDefaults.height !== undefined) {
        return maxHeight !== undefined
          ? Math.max(maxHeight, mergedDefaults.height)
          : mergedDefaults.height;
      }
      return maxHeight;
    },
    undefined
  );

  const headerRow = new TableRow({
    tableHeader: tableConfig.repeatHeaderOnPageBreak,
    height:
      headerHeight !== undefined
        ? { value: headerHeight * 20, rule: 'atLeast' as const }
        : undefined,
    children: await Promise.all(
      columns.map(async (column, colIndex) => {
        const headerCell = column.header;

        // Determine position for outer border application and hideBorders
        const position = {
          isFirstRow: true, // Header is always the first row
          isLastRow: numRows === 0, // Header is last row only if no data rows
          isFirstCol: colIndex === 0,
          isLastCol: colIndex === numColumns - 1,
        };

        // Merge cell defaults with priority: header > columnCellDefaults > table outer border > headerCellDefaults > cellDefaults
        const mergedDefaults = mergeHeaderCellDefaults(
          tableConfig.cellDefaults,
          tableConfig.headerCellDefaults,
          column.cellDefaults,
          headerCell,
          position,
          {
            borderColor: tableConfig.borderColor,
            borderSize: tableConfig.borderSize,
          }
        );

        const cellChildren = await processCellContent(
          headerCell?.content,
          mergedDefaults,
          tableStyle.tableHeader
        );

        const horizontalAlignment = mergedDefaults.horizontalAlignment!;
        const verticalAlignment = getVerticalAlignment(
          mergedDefaults.verticalAlignment
        );

        return new TableCell({
          children: [
            new Paragraph({
              ...(tableConfig.keepInOnePage && { keepNext: true }),
              alignment: getAlignment(horizontalAlignment),
              children: cellChildren,
            }),
          ],

          verticalAlign: verticalAlignment,
          shading: {
            fill:
              mergedDefaults.backgroundColor ||
              getThemeColors(theme).background,
          },
          margins: createMarginsFromPadding(mergedDefaults.padding),
          borders: {
            top: createBorder(
              getBorderValue(mergedDefaults.borderSize, 'top') as number,
              getBorderValue(mergedDefaults.borderColor, 'top') as string,
              shouldHideBorder('top', position)
            ),
            bottom: createBorder(
              getBorderValue(mergedDefaults.borderSize, 'bottom') as number,
              getBorderValue(mergedDefaults.borderColor, 'bottom') as string,
              shouldHideBorder('bottom', position)
            ),
            left: createBorder(
              getBorderValue(mergedDefaults.borderSize, 'left') as number,
              getBorderValue(mergedDefaults.borderColor, 'left') as string,
              shouldHideBorder('left', position)
            ),
            right: createBorder(
              getBorderValue(mergedDefaults.borderSize, 'right') as number,
              getBorderValue(mergedDefaults.borderColor, 'right') as string,
              shouldHideBorder('right', position)
            ),
          },
        });
      })
    ),
  });

  // Create data rows
  const dataRows = await Promise.all(
    Array.from({ length: numRows }, async (_, rowIndex) => {
      const isLastRow = rowIndex === numRows - 1;

      // Calculate row height from any cell in this row that defines it
      const rowHeight = columns.reduce<number | undefined>(
        (maxHeight, column, colIndex) => {
          const cell = column.cells?.[rowIndex];
          if (cell) {
            const position = {
              isFirstCol: colIndex === 0,
              isLastCol: colIndex === numColumns - 1,
              isLastRow,
            };
            const mergedDefaults = mergeCellDefaults(
              tableConfig.cellDefaults,
              column.cellDefaults,
              cell,
              position,
              {
                borderColor: tableConfig.borderColor,
                borderSize: tableConfig.borderSize,
              }
            );
            if (mergedDefaults.height !== undefined) {
              return maxHeight !== undefined
                ? Math.max(maxHeight, mergedDefaults.height)
                : mergedDefaults.height;
            }
          }
          return maxHeight;
        },
        undefined
      );

      return new TableRow({
        height:
          rowHeight !== undefined
            ? { value: rowHeight * 20, rule: 'atLeast' as const }
            : undefined,
        children: await Promise.all(
          columns.map(async (column, colIndex) => {
            const cell = column.cells?.[rowIndex];

            // Determine position for outer border application and hideBorders
            const position = {
              isFirstRow: false, // Data rows are never the first row (header is)
              isFirstCol: colIndex === 0,
              isLastCol: colIndex === numColumns - 1,
              isLastRow,
            };

            if (!cell) {
              // Handle missing cell data - merge defaults properly
              const mergedDefaultsForMissing = mergeCellDefaults(
                tableConfig.cellDefaults,
                column.cellDefaults,
                undefined,
                position,
                {
                  borderColor: tableConfig.borderColor,
                  borderSize: tableConfig.borderSize,
                }
              );
              return new TableCell({
                children: [
                  new Paragraph({
                    ...((tableConfig.keepInOnePage && !isLastRow) ||
                    (isLastRow && tableConfig.keepNext)
                      ? { keepNext: true }
                      : {}),
                    alignment: AlignmentType.LEFT,
                    children: [],
                  }),
                ],
                borders: {
                  top: createBorder(
                    getBorderValue(
                      mergedDefaultsForMissing.borderSize,
                      'top'
                    ) as number,
                    getBorderValue(
                      mergedDefaultsForMissing.borderColor,
                      'top'
                    ) as string,
                    shouldHideBorder('top', position)
                  ),
                  bottom: createBorder(
                    getBorderValue(
                      mergedDefaultsForMissing.borderSize,
                      'bottom'
                    ) as number,
                    getBorderValue(
                      mergedDefaultsForMissing.borderColor,
                      'bottom'
                    ) as string,
                    shouldHideBorder('bottom', position)
                  ),
                  left: createBorder(
                    getBorderValue(
                      mergedDefaultsForMissing.borderSize,
                      'left'
                    ) as number,
                    getBorderValue(
                      mergedDefaultsForMissing.borderColor,
                      'left'
                    ) as string,
                    shouldHideBorder('left', position)
                  ),
                  right: createBorder(
                    getBorderValue(
                      mergedDefaultsForMissing.borderSize,
                      'right'
                    ) as number,
                    getBorderValue(
                      mergedDefaultsForMissing.borderColor,
                      'right'
                    ) as string,
                    shouldHideBorder('right', position)
                  ),
                },
              });
            }

            // Merge cell defaults with priority: cell > column > table outer border > table cellDefaults
            const mergedDefaults = mergeCellDefaults(
              tableConfig.cellDefaults,
              column.cellDefaults,
              cell,
              position,
              {
                borderColor: tableConfig.borderColor,
                borderSize: tableConfig.borderSize,
              }
            );

            const cellChildren = await processCellContent(
              cell.content,
              mergedDefaults,
              tableStyle.tableCell
            );

            const horizontalAlignment = mergedDefaults.horizontalAlignment!;
            const verticalAlignment = getVerticalAlignment(
              mergedDefaults.verticalAlignment
            );

            return new TableCell({
              children: [
                new Paragraph({
                  ...((tableConfig.keepInOnePage && !isLastRow) ||
                  (isLastRow && tableConfig.keepNext)
                    ? { keepNext: true }
                    : {}),
                  alignment: getAlignment(horizontalAlignment),
                  children: cellChildren,
                }),
              ],
              verticalAlign: verticalAlignment,
              shading: {
                fill:
                  mergedDefaults.backgroundColor ||
                  getThemeColors(theme).background,
              },
              margins: createMarginsFromPadding(mergedDefaults.padding),
              borders: {
                top: createBorder(
                  getBorderValue(mergedDefaults.borderSize, 'top') as number,
                  getBorderValue(mergedDefaults.borderColor, 'top') as string,
                  shouldHideBorder('top', position)
                ),
                bottom: createBorder(
                  getBorderValue(mergedDefaults.borderSize, 'bottom') as number,
                  getBorderValue(
                    mergedDefaults.borderColor,
                    'bottom'
                  ) as string,
                  shouldHideBorder('bottom', position)
                ),
                left: createBorder(
                  getBorderValue(mergedDefaults.borderSize, 'left') as number,
                  getBorderValue(mergedDefaults.borderColor, 'left') as string,
                  shouldHideBorder('left', position)
                ),
                right: createBorder(
                  getBorderValue(mergedDefaults.borderSize, 'right') as number,
                  getBorderValue(mergedDefaults.borderColor, 'right') as string,
                  shouldHideBorder('right', position)
                ),
              },
            });
          })
        ),
      });
    })
  );

  // Calculate column widths - if any column has explicit width, use DXA for all
  const hasExplicitWidths = columns.some((col) => col.width !== undefined);

  let columnWidths: number[];
  let tableWidth: {
    size: number;
    type: (typeof WidthType)[keyof typeof WidthType];
  };

  if (hasExplicitWidths) {
    // Use explicit widths in DXA (twips) - convert from points
    const { getAvailableWidthTwips, relativeLengthToTwips } = await import(
      '../utils/widthUtils'
    );

    // Get available table width in twips (page width minus margins)
    const availableTableWidth = getAvailableWidthTwips(theme, themeName);

    // Convert explicit column widths (points or percentage strings) to twips
    const columnsWithExplicitWidthTwips = columns.map((col) =>
      col.width !== undefined
        ? relativeLengthToTwips(col.width, availableTableWidth)
        : undefined
    );

    // Calculate total width used by columns with explicit widths
    const totalExplicitWidth = columnsWithExplicitWidthTwips.reduce(
      (sum: number, w) => sum + (w || 0),
      0
    );

    if (totalExplicitWidth > availableTableWidth) {
      console.warn(
        `[json-to-office] Column widths total (${totalExplicitWidth} twips) exceeds available table width (${availableTableWidth} twips). Table may overflow.`
      );
    }

    // Count columns without explicit width
    const columnsWithoutWidth = columns.filter(
      (col) => col.width === undefined
    ).length;

    // Calculate remaining space and distribute among columns without explicit width
    const remainingWidth = Math.max(
      0,
      availableTableWidth - totalExplicitWidth
    );
    const defaultColumnWidth =
      columnsWithoutWidth > 0
        ? remainingWidth / columnsWithoutWidth
        : pointsToTwips(72); // Fallback to 1 inch if all columns have explicit widths

    // Assign widths: use explicit width (in twips) or calculated default
    columnWidths = columnsWithExplicitWidthTwips.map(
      (w) => w || defaultColumnWidth
    );
    const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
    tableWidth = { size: totalWidth, type: WidthType.DXA };
  } else {
    // Use percentage-based equal distribution
    const percentPerColumn = 100 / columns.length;
    columnWidths = columns.map(() => percentPerColumn);
    tableWidth = { size: tableConfig.width ?? 100, type: WidthType.PERCENTAGE };
  }

  return new Table({
    width: tableWidth,
    layout: TableLayoutType.FIXED,
    columnWidths: columnWidths,
    rows: [headerRow, ...dataRows],
  });
}

/**
 * Convert alignment string to docx AlignmentType
 */
function getAlignment(
  alignment: string
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (alignment) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

/**
 * Convert vertical alignment string to docx VerticalAlign
 */
function getVerticalAlignment(
  alignment: string | undefined
):
  | typeof VerticalAlign.TOP
  | typeof VerticalAlign.CENTER
  | typeof VerticalAlign.BOTTOM
  | undefined {
  if (!alignment) return undefined;

  switch (alignment) {
    case 'top':
      return VerticalAlign.TOP;
    case 'middle':
      return VerticalAlign.CENTER;
    case 'bottom':
      return VerticalAlign.BOTTOM;
    default:
      return undefined;
  }
}

/**
 * Create header element from content
 */
export function createHeaderElement(
  children: (Paragraph | Table)[],
  _options?: {
    position?: 'left' | 'center' | 'right';
  }
): Header {
  return new Header({
    children: children,
  });
}

/**
 * Create footer element from content
 */
export function createFooterElement(
  children: (Paragraph | Table)[],
  _options?: {
    position?: 'left' | 'center' | 'right';
  }
): Footer {
  return new Footer({
    children: children,
  });
}

/**
 * Create page number element
 */
export function createPageNumberElement(
  format?: string,
  alignment?: 'left' | 'center' | 'right'
): Paragraph {
  const children: (TextRun | ExternalHyperlink | InternalHyperlink)[] = [];

  if (format) {
    // Use placeholder processor to handle {PAGE} and other placeholders
    children.push(...processTextWithPlaceholders(format, {}));
  } else {
    // Default: just page number
    children.push(
      new TextRun({
        children: [PageNumber.CURRENT],
      })
    );
  }

  return new Paragraph({
    alignment: getAlignment(alignment || 'center'),
    children,
  });
}

/**
 * Create mixed content paragraph with text and image elements
 */
export async function createMixedContentParagraph(
  textContent: string,
  textOptions: {
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
  },
  imagePath?: string,
  imageOptions?: {
    width?: number;
    height?: number;
  },
  alignment?: 'left' | 'center' | 'right',
  theme?: import('../styles').ThemeConfig
): Promise<Paragraph> {
  const children: (TextRun | ImageRun)[] = [];
  const normalizedTextContent = normalizeUnicodeText(textContent);

  // Add text content
  if (normalizedTextContent) {
    children.push(
      new TextRun({
        text: normalizedTextContent,
        font: theme ? getThemeFonts(theme).body.family : undefined,
        size: textOptions.fontSize ? textOptions.fontSize * 2 : 20, // Convert to half-points
        color:
          textOptions.color ||
          (theme ? getThemeColors(theme).textPrimary : undefined),
        bold: textOptions.bold || false,
        italics: textOptions.italic || false,
      })
    );
  }

  // Add image if provided
  if (imagePath) {
    try {
      const imageBuffer = await getImageBuffer(imagePath);

      // Calculate dimensions with aspect ratio preservation
      const dimensions = await calculateImageDimensions(
        imagePath,
        imageOptions?.width,
        imageOptions?.height,
        60, // fallback width
        20 // fallback height
      );

      const imageRun = new ImageRun({
        type: 'png',
        data: imageBuffer,
        transformation: {
          width: dimensions.width,
          height: dimensions.height,
        },
      });

      // Add some spacing before the image
      children.push(new TextRun({ text: '  ' }));
      children.push(imageRun);
    } catch (error) {
      // Fallback for missing images
      children.push(
        new TextRun({
          text: ` [IMAGE: ${imagePath}]`,
          font: theme ? getThemeFonts(theme).body.family : undefined,
          size: (textOptions.fontSize || 10) * 2,
          color: theme ? getThemeColors(theme).secondary : undefined,
          bold: true,
        })
      );
    }
  }

  return new Paragraph({
    alignment: getAlignment(alignment || 'left'),
    children,
  });
}

/**
 * Create a table specifically for headers/footers with custom styling
 */

export async function createHeaderFooterTable(
  rows: (string | ComponentDefinition)[][],
  options: {
    cellAlignments?: ('left' | 'center' | 'right')[];
    fontSize?: number;
    bold?: boolean;
    color?: string;
    noBorders?: boolean;
    cellStyling?: {
      [rowIndex: number]: {
        [cellIndex: number]: {
          bold?: boolean;
          color?: string;
          fontSize?: number;
        };
      };
    };
    theme?: ThemeConfig;
    themeName?: string;
  } = {}
): Promise<Table> {
  const {
    cellAlignments = ['left', 'right'],
    fontSize = 10,
    bold = false,
    color = '#000000',
    noBorders = true,
    cellStyling = {},
    theme,
  } = options;

  // Use theme's normal style for header/footer text since header/footer styles are removed
  const normalStyle = theme?.styles?.normal;

  const defaultFont = theme
    ? resolveFontFamily(theme, normalStyle?.font)
    : 'Arial';
  const defaultSize = normalStyle?.size || fontSize;
  const defaultColor =
    normalStyle?.color && theme
      ? resolveColor(normalStyle.color, theme)
      : color;

  const tableRows = await Promise.all(
    rows.map(
      async (row, rowIndex) =>
        new TableRow({
          children: await Promise.all(
            row.map(async (cell, cellIndex) => {
              const alignment = cellAlignments[cellIndex] || 'left';
              const cellStyle = cellStyling[rowIndex]?.[cellIndex] || {};

              let paragraphChildren: (
                | TextRun
                | ImageRun
                | ExternalHyperlink
                | InternalHyperlink
              )[] = [];

              // Handle ComponentDefinition first
              if (
                typeof cell === 'object' &&
                'name' in cell &&
                'props' in cell
              ) {
                // This is a ComponentDefinition
                if (isParagraphComponent(cell)) {
                  const textComp = cell as ParagraphComponentDefinition;
                  // Use parseTextWithDecorators to support rich text formatting
                  const textStyle = {
                    font:
                      textComp.props.font?.family || (defaultFont as string),
                    size:
                      ((textComp.props.font?.size || defaultSize) as number) *
                      2, // Convert to half-points
                    bold: textComp.props.font?.bold ?? false,
                    color:
                      (textComp.props.font?.color && theme
                        ? resolveColor(textComp.props.font.color, theme)
                        : undefined) || defaultColor,
                  } as const;
                  paragraphChildren = parseTextWithDecorators(
                    textComp.props.text,
                    textStyle,
                    { enableHyperlinks: true }
                  );
                } else if (isImageComponent(cell)) {
                  const imageComp = cell as ImageComponentDefinition;
                  try {
                    // Get image source (base64 or path)
                    const imageSource =
                      imageComp.props.base64 || imageComp.props.path;
                    if (!imageSource) {
                      throw new Error(
                        'Image component requires either "path" or "base64" property'
                      );
                    }

                    // Read from local file, URL, or base64
                    const imageBuffer = await getImageBuffer(imageSource);

                    // Parse width value if it's a string percentage (like "90%")
                    const parsedWidth =
                      typeof imageComp.props.width === 'string'
                        ? parseWidthValue(imageComp.props.width, 300) // Use a reasonable default for table context
                        : imageComp.props.width;

                    // Parse height value if it's a string percentage (like "90%")
                    const parsedHeight =
                      typeof imageComp.props.height === 'string'
                        ? parseWidthValue(imageComp.props.height, 200) // Use a reasonable default for table context
                        : imageComp.props.height;

                    // Calculate dimensions with aspect ratio preservation
                    const dimensions = await calculateImageDimensions(
                      imageSource,
                      parsedWidth,
                      parsedHeight,
                      60, // fallback width
                      20 // fallback height
                    );

                    const imageRun = new ImageRun({
                      type: 'png',
                      data: imageBuffer,
                      transformation: {
                        width: dimensions.width,
                        height: dimensions.height,
                      },
                    });
                    paragraphChildren = [imageRun];
                  } catch (error) {
                    // Fallback for missing images
                    const imageSource =
                      imageComp.props.base64 ||
                      imageComp.props.path ||
                      'unknown';
                    paragraphChildren = [
                      new TextRun({
                        text: `[IMAGE: ${imageSource.substring(0, 50)}${imageSource.length > 50 ? '...' : ''}]`,
                        size: fontSize * 2,
                        bold: true,
                        color: '#999999',
                      }),
                    ];
                  }
                } else {
                  // Unsupported component type in table cell
                  paragraphChildren = [
                    new TextRun({
                      text: `[Unsupported component type: ${cell.name}]`,
                      size: fontSize * 2,
                      color: '#999999',
                    }),
                  ];
                }
              } else if (typeof cell === 'string') {
                // Handle plain string text (including placeholders)
                const textStyle = {
                  font: defaultFont,
                  size: (cellStyle.fontSize || defaultSize) * 2,
                  bold: cellStyle.bold !== undefined ? cellStyle.bold : bold,
                  color: cellStyle.color || defaultColor,
                };

                // Use parseTextWithDecorators which now handles both decorators and placeholders
                paragraphChildren = parseTextWithDecorators(cell, textStyle, {
                  enableHyperlinks: true,
                });
              }

              return new TableCell({
                children: [
                  new Paragraph({
                    alignment: getAlignment(alignment),
                    children: paragraphChildren,
                  }),
                ],
                margins: {
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                },
                borders: noBorders
                  ? {
                      top: { style: BorderStyle.NONE, size: 0 },
                      bottom: { style: BorderStyle.NONE, size: 0 },
                      left: { style: BorderStyle.NONE, size: 0 },
                      right: { style: BorderStyle.NONE, size: 0 },
                    }
                  : undefined,
              });
            })
          ),
        })
    )
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED, // Lock column widths to prevent horizontal resizing
    rows: tableRows,
    borders: noBorders
      ? {
          top: { style: BorderStyle.NONE, size: 0 },
          bottom: { style: BorderStyle.NONE, size: 0 },
          left: { style: BorderStyle.NONE, size: 0 },
          right: { style: BorderStyle.NONE, size: 0 },
          insideHorizontal: { style: BorderStyle.NONE, size: 0 },
          insideVertical: { style: BorderStyle.NONE, size: 0 },
        }
      : undefined,
  });
}
