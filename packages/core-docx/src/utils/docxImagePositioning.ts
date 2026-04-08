import {
  TextWrappingType,
  TextWrappingSide,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionAlign,
} from 'docx';

import type { ImageProps } from '../types';
import type { ThemeConfig } from '../styles';
import {
  resolveOffsetTwips,
  getPageWidthTwips,
  getPageHeightTwips,
  getAvailableWidthTwips,
  getAvailableHeightTwips,
} from './widthUtils';

export type FloatingConfig = NonNullable<ImageProps['floating']>;

/**
 * Conversion factor from twips to EMUs (English Metric Units).
 * - 1 inch = 914,400 EMUs
 * - 1 inch = 1,440 twips
 * - Therefore: 1 twip = 914,400 / 1,440 = 635 EMUs
 *
 * docx.js expects offset and margin values in EMUs, but our schema
 * documents these values in twips for consistency with other Word measurements.
 */
const TWIPS_TO_EMU = 635;

export function mapHorizontalRelative(
  rel?: FloatingConfig['horizontalPosition'] extends infer T
    ? T extends { relative?: infer R }
      ? R
      : never
    : never
) {
  switch (rel) {
    case 'character':
      return HorizontalPositionRelativeFrom.CHARACTER;
    case 'column':
      return HorizontalPositionRelativeFrom.COLUMN;
    case 'margin':
      return HorizontalPositionRelativeFrom.MARGIN;
    case 'page':
      return HorizontalPositionRelativeFrom.PAGE;
    default:
      return undefined;
  }
}

export function mapVerticalRelative(
  rel?: FloatingConfig['verticalPosition'] extends infer T
    ? T extends { relative?: infer R }
      ? R
      : never
    : never
) {
  switch (rel) {
    case 'margin':
      return VerticalPositionRelativeFrom.MARGIN;
    case 'page':
      return VerticalPositionRelativeFrom.PAGE;
    case 'paragraph':
      return VerticalPositionRelativeFrom.PARAGRAPH;
    case 'line':
      return VerticalPositionRelativeFrom.LINE;
    default:
      return undefined;
  }
}

export function mapHorizontalAlign(
  align?: 'left' | 'center' | 'right' | 'inside' | 'outside'
) {
  switch (align) {
    case 'left':
      return HorizontalPositionAlign.LEFT;
    case 'center':
      return HorizontalPositionAlign.CENTER;
    case 'right':
      return HorizontalPositionAlign.RIGHT;
    case 'inside':
      return HorizontalPositionAlign.INSIDE;
    case 'outside':
      return HorizontalPositionAlign.OUTSIDE;
    default:
      return undefined;
  }
}

export function mapVerticalAlign(
  align?: 'top' | 'center' | 'bottom' | 'inside' | 'outside'
) {
  switch (align) {
    case 'top':
      return VerticalPositionAlign.TOP;
    case 'center':
      return VerticalPositionAlign.CENTER;
    case 'bottom':
      return VerticalPositionAlign.BOTTOM;
    case 'inside':
      return VerticalPositionAlign.INSIDE;
    case 'outside':
      return VerticalPositionAlign.OUTSIDE;
    default:
      return undefined;
  }
}

export function mapWrapType(
  type?: 'none' | 'square' | 'topAndBottom' | 'around' | 'through'
) {
  switch (type) {
    case 'none':
      return TextWrappingType.NONE;
    case 'square':
      return TextWrappingType.SQUARE;
    case 'topAndBottom':
      return TextWrappingType.TOP_AND_BOTTOM;
    case 'around':
    case 'through':
      // Map VML-style 'around' and 'through' to TIGHT (closest OOXML equivalent)
      return TextWrappingType.TIGHT;
    default:
      return undefined;
  }
}

export function mapWrapSide(side?: 'bothSides' | 'left' | 'right' | 'largest') {
  switch (side) {
    case 'bothSides':
      return TextWrappingSide.BOTH_SIDES;
    case 'left':
      return TextWrappingSide.LEFT;
    case 'right':
      return TextWrappingSide.RIGHT;
    case 'largest':
      return TextWrappingSide.LARGEST;
    default:
      return undefined;
  }
}

/**
 * Map shared floating config to docx ImageRun floating options.
 * Also lifts wrap.margins (if present) to floating.margins as expected by docx.
 */
export function mapFloatingOptions(
  floating?: FloatingConfig,
  theme?: ThemeConfig,
  themeName?: string
): any | undefined {
  if (!floating) return undefined;

  // Disallow 'tight' wrapping: docx emits invalid OOXML for wrapTight without polygon geometry
  // Note: TypeScript correctly prevents this at compile-time, but keep for runtime safety
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Intentional defensive check for runtime input validation
  if (floating.wrap?.type === 'tight') {
    throw new Error(
      "Image floating wrap.type 'tight' is not supported due to invalid OOXML emitted by docx. Use 'square', 'topAndBottom', or 'none'."
    );
  }

  // Determine reference dimensions for percentage resolution
  const hRelative = floating.horizontalPosition?.relative;
  const vRelative = floating.verticalPosition?.relative;
  const hRef =
    hRelative && hRelative !== 'page'
      ? getAvailableWidthTwips(theme, themeName)
      : getPageWidthTwips(theme, themeName);
  const vRef =
    vRelative && vRelative !== 'page'
      ? getAvailableHeightTwips(theme, themeName)
      : getPageHeightTwips(theme, themeName);

  // docx.js requires BOTH horizontal and vertical positions for floating images.
  // If only one is specified, provide sensible defaults for the other.
  const hasHorizontal = Boolean(floating.horizontalPosition);
  const hasVertical = Boolean(floating.verticalPosition);

  const horizontalPosition = floating.horizontalPosition
    ? {
        ...(floating.horizontalPosition.relative && {
          relative: mapHorizontalRelative(floating.horizontalPosition.relative),
        }),
        ...(floating.horizontalPosition.align !== undefined && {
          align: mapHorizontalAlign(floating.horizontalPosition.align),
        }),
        ...(floating.horizontalPosition.offset !== undefined && {
          offset:
            resolveOffsetTwips(floating.horizontalPosition.offset, hRef) *
            TWIPS_TO_EMU,
        }),
      }
    : hasVertical
      ? {
          // Default horizontal: align left relative to margin
          relative: HorizontalPositionRelativeFrom.MARGIN,
          align: HorizontalPositionAlign.LEFT,
        }
      : undefined;

  const verticalPosition = floating.verticalPosition
    ? {
        ...(floating.verticalPosition.relative && {
          relative: mapVerticalRelative(floating.verticalPosition.relative),
        }),
        ...(floating.verticalPosition.align !== undefined && {
          align: mapVerticalAlign(floating.verticalPosition.align),
        }),
        ...(floating.verticalPosition.offset !== undefined && {
          offset:
            resolveOffsetTwips(floating.verticalPosition.offset, vRef) *
            TWIPS_TO_EMU,
        }),
      }
    : hasHorizontal
      ? {
          // Default vertical: align top relative to paragraph
          relative: VerticalPositionRelativeFrom.PARAGRAPH,
          align: VerticalPositionAlign.TOP,
        }
      : undefined;

  const wrap = floating.wrap
    ? {
        ...(floating.wrap.type && { type: mapWrapType(floating.wrap.type) }),
        ...(floating.wrap.side && { side: mapWrapSide(floating.wrap.side) }),
      }
    : undefined;

  // Convert margins from twips (or percentage) to EMUs
  const pageW = getPageWidthTwips(theme, themeName);
  const pageH = getPageHeightTwips(theme, themeName);
  const rawMargins = floating.wrap?.margins || (floating as any).margins;
  const margins = rawMargins
    ? {
        ...(rawMargins.top !== undefined && {
          top: resolveOffsetTwips(rawMargins.top, pageH) * TWIPS_TO_EMU,
        }),
        ...(rawMargins.bottom !== undefined && {
          bottom: resolveOffsetTwips(rawMargins.bottom, pageH) * TWIPS_TO_EMU,
        }),
        ...(rawMargins.left !== undefined && {
          left: resolveOffsetTwips(rawMargins.left, pageW) * TWIPS_TO_EMU,
        }),
        ...(rawMargins.right !== undefined && {
          right: resolveOffsetTwips(rawMargins.right, pageW) * TWIPS_TO_EMU,
        }),
      }
    : undefined;

  // Determine and validate zIndex:
  // - OOXML requires positive integer for relativeHeight
  // - Negative values cause Word to reject the document
  // - CRITICAL: docx.js uses image HEIGHT as relativeHeight when zIndex is undefined,
  //   causing inconsistent values that can corrupt documents
  // - Solution: ALWAYS provide a zIndex value, defaulting to 0
  let zIndex = floating.zIndex !== undefined ? floating.zIndex : 0; // Default to 0 for ALL floating images (behindDocument or normal)

  // Validate: zIndex must be >= 0 (OOXML requirement)
  if (zIndex < 0) {
    console.warn(
      `Invalid zIndex value ${zIndex} for floating image. Using 0 instead. zIndex must be >= 0.`
    );
    zIndex = 0;
  }

  const mapped: any = {
    ...(horizontalPosition && { horizontalPosition }),
    ...(verticalPosition && { verticalPosition }),
    ...(wrap && { wrap }),
    ...(margins && { margins }),
    ...(floating.allowOverlap !== undefined && {
      allowOverlap: floating.allowOverlap,
    }),
    ...(floating.behindDocument !== undefined && {
      behindDocument: floating.behindDocument,
    }),
    ...(floating.lockAnchor !== undefined && {
      lockAnchor: floating.lockAnchor,
    }),
    ...(floating.layoutInCell !== undefined && {
      layoutInCell: floating.layoutInCell,
    }),
    zIndex, // Always include zIndex (now always defined, defaults to 0)
  };

  return Object.keys(mapped).length ? mapped : undefined;
}
