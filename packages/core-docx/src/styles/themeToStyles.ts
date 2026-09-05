/**
 * A theme, compiled into the document's style set.
 *
 * The output is DocxIR: style ids and their resolved formatting, in the units
 * OOXML uses, naming no backend. Both adapters map it to their own option
 * shape, so which styles a document defines — and what each one says — is
 * decided once, here, rather than once per renderer.
 */

import { getTheme } from '../templates/themes';
import { synthesizeFamilyName } from '@json-to-office/shared';

/**
 * A right tab at the text-measure edge, which is where a TOC page number sits.
 *
 * Twice `TabStopPosition.MAX` (9026 twips) — the historical value, kept
 * because it is what every recorded document was produced with.
 */
const RIGHT_MARGIN_TAB_TWIPS = 9026 * 2;

/**
 * Style ids a `statistic` lowers to.
 *
 * Exported because the compiler names them on every statistic paragraph it
 * emits and the two must not drift: a `w:pStyle` pointing at a style the
 * document does not define is not an error anywhere in OOXML, it just resolves
 * to Normal — which is how the component came to render as two ordinary body
 * paragraphs with nothing to tell the number from its caption.
 */
export const STATISTIC_NUMBER_STYLE_ID = 'StatisticNumber';
export const STATISTIC_DESCRIPTION_STYLE_ID = 'StatisticDescription';

/**
 * The number's size, in points, per the component's `size` prop.
 *
 * `medium` is what the style itself carries; the compiler overrides the run
 * for the other two, so a document that never states `size` needs no run
 * properties at all and restyling every statistic stays a one-style edit.
 */
export const STATISTIC_SIZE_POINTS: Readonly<Record<string, number>> = {
  small: 20,
  medium: 28,
  large: 40,
};

import type {
  DocxIrAlignment,
  DocxIrBorder,
  DocxIrBorders,
  DocxIrCharacterStyle,
  DocxIrParagraphFormatting,
  DocxIrParagraphStyle,
  DocxIrRunFormatting,
  DocxIrStyles,
  DocxIrTabStop,
} from '../ir/types';
import type { ThemeConfig } from './index';
import { resolveColor } from './utils/colorUtils';
import {
  convertLineSpacing,
  pointsToTwips,
  resolveFontProperties,
  mergeFontAndStyleProperties,
} from './utils/styleHelpers';

// Border types for paragraph borders in theme styles
interface ThemeBorderDefinition {
  style: string; // e.g., 'single', 'double', 'dotted', etc.
  size: number; // width in eighths of a point (docx sz)
  color: string; // hex or theme color key
  space?: number; // space in points
}

interface ThemeBorders {
  top?: ThemeBorderDefinition;
  bottom?: ThemeBorderDefinition;
  left?: ThemeBorderDefinition;
  right?: ThemeBorderDefinition;
  /** w:between — the rule between consecutive paragraphs sharing this set. */
  between?: ThemeBorderDefinition;
}

// Style properties for various text elements
interface StyleProperties {
  fontWeight?: number;
  case?: 'none' | 'upper' | 'smallCaps';
  font?: 'heading' | 'body' | 'mono' | 'light';
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: {
    type: 'single' | 'atLeast' | 'exactly' | 'double' | 'multiple';
    value?: number;
  };
  spacing?: {
    before?: number;
    after?: number;
  };
  characterSpacing?: { type: 'condensed' | 'expanded'; value: number };
  scale?: number;
  priority?: number;
  baseStyle?: string;
  followingStyle?: string;
  widowControl?: boolean;
  keepNext?: boolean;
  keepLinesTogether?: boolean;
  outlineLevel?: number;
  borders?: ThemeBorders;
  indent?: {
    left?: number;
    hanging?: number;
  };
}

/**
 * Type-safe style getter with proper error handling
 */
function getStyleSafe(
  theme: ThemeConfig,
  styleName: string
): StyleProperties | undefined {
  return theme.styles && Object.hasOwn(theme.styles, styleName)
    ? (theme.styles as Record<string, StyleProperties | undefined>)[styleName]
    : undefined;
}

/**
 * Resolves a style with baseStyle inheritance.
 * If a style has a baseStyle property, recursively resolves the base style first
 * and merges its properties with the current style (current overrides base).
 *
 * @param theme - Theme configuration
 * @param styleName - Name of the style to resolve
 * @param visited - Set of visited style names to prevent circular references
 * @returns Resolved style with all inherited properties, or undefined if not found
 */
function resolveStyleWithBaseStyle(
  theme: ThemeConfig,
  styleName: string,
  visited: Set<string> = new Set()
): StyleProperties | undefined {
  // Prevent circular references
  if (visited.has(styleName)) {
    console.warn(
      `Circular baseStyle reference detected: ${Array.from(visited).join(
        ' → '
      )} → ${styleName}`
    );
    return undefined;
  }

  visited.add(styleName);

  // Use type-safe getter instead of type assertion
  const style = getStyleSafe(theme, styleName);
  if (!style) {
    return undefined;
  }

  // If no baseStyle, return style as-is
  if (!style.baseStyle) {
    return style;
  }

  // Recursively resolve base style
  const baseStyle = resolveStyleWithBaseStyle(
    theme,
    style.baseStyle,
    new Set(visited) // Pass copy to allow different branches
  );

  if (!baseStyle) {
    // If baseStyle doesn't exist, just return current style
    return style;
  }

  // Merge: base properties first, then override with current style properties
  // Filter out undefined values from current style to preserve base style values
  const mergedStyle = mergeFontAndStyleProperties(
    baseStyle,
    style
  ) as StyleProperties;

  // Manually merge properties not covered by mergeFontAndStyleProperties
  // Borders: inherit from baseStyle unless explicitly provided in current style
  if (style.borders === undefined && baseStyle.borders !== undefined) {
    mergedStyle.borders = baseStyle.borders;
  } else if (style.borders !== undefined) {
    mergedStyle.borders = style.borders;
  }

  return mergedStyle;
}

function convertAlignment(alignment: string): DocxIrAlignment {
  switch (alignment) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'justify':
      return 'justified';
    default:
      return 'left';
  }
}

/**
 * Resolve spacing from new nested format
 */
function resolveSpacing(spacing?: { before?: number; after?: number }): {
  beforeTwips?: number;
  afterTwips?: number;
} {
  return {
    ...(spacing?.before ? { beforeTwips: pointsToTwips(spacing.before) } : {}),
    ...(spacing?.after ? { afterTwips: pointsToTwips(spacing.after) } : {}),
  };
}

/**
 * Convert merged style properties to docx run properties
 */
function convertRunProperties(
  merged: any,
  theme: ThemeConfig,
  defaultColor?: string,
  defaultSize?: number
): DocxIrRunFormatting {
  const weighted =
    merged.fontWeight !== undefined
      ? synthesizeFamilyName(
          merged.family || 'Arial',
          merged.fontWeight,
          merged.italic === true
        )
      : undefined;
  return {
    fontFamily: weighted?.family ?? merged.family ?? 'Arial',
    sizeHalfPoints: (merged.size || defaultSize || 11) * 2,
    color: {
      hex: resolveColor(
        merged.color || defaultColor || theme.colors.text,
        theme
      ),
    },
    ...(merged.bold !== undefined && { bold: merged.bold }),
    ...(merged.italic !== undefined && { italic: merged.italic }),
    ...(weighted && { bold: weighted.bold, italic: weighted.italic }),
    ...(merged.case !== undefined &&
      (merged.case === 'upper'
        ? { allCaps: true }
        : { smallCaps: merged.case === 'smallCaps' })),
    ...(merged.underline !== undefined &&
      merged.underline && { underline: { type: 'single' } }),
    ...(merged.characterSpacing && {
      characterSpacingTwentieths:
        merged.characterSpacing.type === 'condensed'
          ? -merged.characterSpacing.value
          : merged.characterSpacing.value,
    }),
    ...(merged.scale && { scalePercent: merged.scale }),
  };
}

/** `convertLineSpacing`'s result, in the IR's vocabulary. */
function irLineSpacing(lineSpacing?: unknown): {
  lineTwips?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
} {
  const converted = convertLineSpacing(lineSpacing as never);
  if (!converted) return {};
  return {
    ...(typeof converted.line === 'number'
      ? { lineTwips: converted.line }
      : {}),
    ...(converted.lineRule
      ? { lineRule: converted.lineRule as 'auto' | 'exact' | 'atLeast' }
      : {}),
  };
}

/**
 * Convert merged style properties to docx paragraph properties
 */
function convertParagraphProperties(
  merged: any,
  styleProps?: StyleProperties,
  theme?: ThemeConfig
): DocxIrParagraphFormatting {
  return {
    spacing: {
      ...resolveSpacing(merged.spacing),
      ...irLineSpacing(merged.lineSpacing),
    },
    alignment: convertAlignment(merged.alignment || 'left'),
    ...(styleProps?.keepNext !== undefined && {
      keepNext: styleProps.keepNext,
    }),
    ...(styleProps?.keepLinesTogether !== undefined && {
      keepLines: styleProps.keepLinesTogether,
    }),
    ...(styleProps?.widowControl !== undefined && {
      widowControl: styleProps.widowControl,
    }),
    ...(styleProps?.outlineLevel !== undefined && {
      outlineLevel: styleProps.outlineLevel,
    }),
    ...(styleProps?.borders &&
      theme && {
        borders: convertBorders(styleProps.borders, theme),
      }),
    ...(styleProps?.indent && {
      indent: {
        ...(styleProps.indent.left !== undefined && {
          leftTwips: styleProps.indent.left,
        }),
        ...(styleProps.indent.hanging !== undefined && {
          hangingTwips: styleProps.indent.hanging,
        }),
      },
    }),
  };
}

/**
 * Convert theme border definitions to docx paragraph border options
 */
function convertBorders(
  borders: ThemeBorders | undefined,
  theme: ThemeConfig
): DocxIrBorders | undefined {
  if (!borders) return undefined;

  const mapSide = (side?: ThemeBorderDefinition): DocxIrBorder | undefined =>
    side
      ? {
          style: side.style,
          sizeEighthPoints: side.size,
          color: { hex: resolveColor(side.color, theme) },
          ...(side.space !== undefined ? { spacePoints: side.space } : {}),
        }
      : undefined;

  const sides: (keyof ThemeBorders)[] = [
    'top',
    'bottom',
    'left',
    'right',
    'between',
  ];
  const converted: DocxIrBorders = {};
  for (const side of sides) {
    const value = mapSide(borders[side]);
    if (value) converted[side] = value;
  }

  return Object.keys(converted).length > 0 ? converted : undefined;
}

/**
 * Compile a theme into the document's style set.
 *
 * @param themeNameOrObject The theme to use for styling (name string or theme object)
 * @param language Document-default proofing language (BCP-47)
 */
/**
 * The run a fallback style uses when the theme declares nothing for it.
 *
 * Only the font's own properties are read, so `bold`/`italic`/`underline`
 * appear only when the font declares them — which is why this is not
 * `convertRunProperties` with an empty style.
 */
function fallbackRun(
  fontProps: any,
  theme: ThemeConfig,
  defaultColor: string,
  defaultSize: number
): DocxIrRunFormatting {
  const weighted =
    fontProps.fontWeight !== undefined
      ? synthesizeFamilyName(
          fontProps.family || 'Arial',
          fontProps.fontWeight,
          fontProps.italic === true
        )
      : undefined;
  return {
    fontFamily: weighted?.family ?? fontProps.family ?? 'Arial',
    sizeHalfPoints: (fontProps.size || defaultSize) * 2,
    color: { hex: resolveColor(fontProps.color || defaultColor, theme) },
    ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
    ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
    ...(weighted && { bold: weighted.bold, italic: weighted.italic }),
    ...(fontProps.case !== undefined &&
      (fontProps.case === 'upper'
        ? { allCaps: true }
        : { smallCaps: fontProps.case === 'smallCaps' })),
    ...(fontProps.underline !== undefined &&
      fontProps.underline && { underline: { type: 'single' } }),
  };
}

/** Header and footer runs, which pin their own size rather than inherit one. */
function chromeRun(
  fontProps: any,
  theme: ThemeConfig,
  sizeHalfPoints: number
): DocxIrRunFormatting {
  return {
    fontFamily: fontProps.family || 'Arial',
    sizeHalfPoints,
    color: {
      hex: resolveColor(fontProps.color || theme.colors.secondary, theme),
    },
    ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
    ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
  };
}

export function createDocumentStyles(
  themeNameOrObject: string | ThemeConfig = 'minimal',
  language?: string
): DocxIrStyles {
  const theme: ThemeConfig =
    typeof themeNameOrObject === 'string'
      ? getTheme(themeNameOrObject) || getTheme('minimal')!
      : themeNameOrObject;

  const paragraphStyles: DocxIrParagraphStyle[] = [
    // Normal body text style
    {
      id: 'Normal',
      name: 'Normal',
      quickFormat: true,
      run: (() => {
        const normalStyle =
          resolveStyleWithBaseStyle(theme, 'normal') || theme.styles?.normal;
        const fontProps = resolveFontProperties(theme, normalStyle?.font);
        const merged = mergeFontAndStyleProperties(fontProps, {
          size: normalStyle?.size,
          color: normalStyle?.color,
          bold: normalStyle?.bold,
          fontWeight: normalStyle?.fontWeight,
          case: normalStyle?.case,
          italic: normalStyle?.italic,
          underline: normalStyle?.underline,
          characterSpacing: normalStyle?.characterSpacing,
          scale: normalStyle?.scale,
        });

        return convertRunProperties(merged, theme, theme.colors.text);
      })(),
      paragraph: (() => {
        const normalStyle =
          resolveStyleWithBaseStyle(theme, 'normal') || theme.styles?.normal;
        const fontProps = resolveFontProperties(theme, normalStyle?.font);
        const merged = mergeFontAndStyleProperties(fontProps, {
          alignment: normalStyle?.alignment,
          lineSpacing: normalStyle?.lineSpacing,
          spacing: normalStyle?.spacing,
        });

        return convertParagraphProperties(merged, normalStyle, theme);
      })(),
    },
  ];

  // Generate heading styles from theme configuration
  for (let i = 1; i <= 6; i++) {
    const headingKey = `heading${i}` as keyof typeof theme.styles;
    const rawHeadingStyle = theme.styles?.[headingKey] as
      | StyleProperties
      | undefined;

    if (rawHeadingStyle) {
      const headingStyle =
        resolveStyleWithBaseStyle(theme, headingKey) || rawHeadingStyle;
      paragraphStyles.push({
        id: `Heading${i}`,
        name: `Heading ${i}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: (() => {
          const fontProps = resolveFontProperties(
            theme,
            headingStyle.font || 'heading'
          );
          const merged = mergeFontAndStyleProperties(fontProps, {
            size: headingStyle.size,
            color: headingStyle.color,
            bold: headingStyle.bold,
            fontWeight: headingStyle.fontWeight,
            case: headingStyle.case,
            italic: headingStyle.italic,
            underline: headingStyle.underline,
            characterSpacing: headingStyle.characterSpacing,
            scale: headingStyle.scale,
          });

          return convertRunProperties(merged, theme, theme.colors.primary, 20);
        })(),
        paragraph: (() => {
          const fontProps = resolveFontProperties(
            theme,
            headingStyle.font || 'heading'
          );
          const merged = mergeFontAndStyleProperties(fontProps, {
            alignment: headingStyle.alignment,
            lineSpacing: headingStyle.lineSpacing,
            spacing: headingStyle.spacing,
          });

          return convertParagraphProperties(merged, headingStyle, theme);
        })(),
      });
    } else {
      // Fallback heading style if not defined in theme
      const fontProps = resolveFontProperties(theme, 'heading');
      paragraphStyles.push({
        id: `Heading${i}`,
        name: `Heading ${i}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: fallbackRun(fontProps, theme, theme.colors.primary, 20),
        paragraph: {
          spacing: {
            beforeTwips: 240 - (i - 1) * 40,
            afterTwips: 120 - (i - 1) * 20,
            ...irLineSpacing(fontProps.lineSpacing),
          },
          alignment: convertAlignment(fontProps.alignment || 'left'),
        },
      });
    }
  }

  // Generate display-only heading styles for text components (non-TOC, non-outline)
  for (let i = 1; i <= 6; i++) {
    const headingKey = `heading${i}` as keyof typeof theme.styles;
    const rawHeadingStyle = theme.styles?.[headingKey] as
      | StyleProperties
      | undefined;

    if (rawHeadingStyle) {
      const headingStyle =
        resolveStyleWithBaseStyle(theme, `heading${i}`) || rawHeadingStyle;

      paragraphStyles.push({
        id: `JTD_HeadingText${i}`,
        name: `Heading Text ${i}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: false,
        run: (() => {
          const fontProps = resolveFontProperties(
            theme,
            headingStyle.font || 'heading'
          );
          const merged = mergeFontAndStyleProperties(fontProps, {
            size: headingStyle.size,
            color: headingStyle.color,
            bold: headingStyle.bold,
            fontWeight: headingStyle.fontWeight,
            case: headingStyle.case,
            italic: headingStyle.italic,
            underline: headingStyle.underline,
            characterSpacing: headingStyle.characterSpacing,
            scale: headingStyle.scale,
          });

          return convertRunProperties(merged, theme, theme.colors.primary, 20);
        })(),
        paragraph: (() => {
          const fontProps = resolveFontProperties(
            theme,
            headingStyle.font || 'heading'
          );
          const merged = mergeFontAndStyleProperties(fontProps, {
            alignment: headingStyle.alignment,
            lineSpacing: headingStyle.lineSpacing,
            spacing: headingStyle.spacing,
          });

          // Explicitly drop outlineLevel to avoid TOC participation
          return convertParagraphProperties(
            merged,
            { ...(headingStyle as any), outlineLevel: undefined },
            theme
          );
        })(),
      });
    } else {
      // Fallback display heading style mirrors fallback heading visuals
      const fontProps = resolveFontProperties(theme, 'heading');
      paragraphStyles.push({
        id: `JTD_HeadingText${i}`,
        name: `Heading Text ${i}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: false,
        run: fallbackRun(fontProps, theme, theme.colors.primary, 20),
        paragraph: {
          spacing: {
            beforeTwips: 240 - (i - 1) * 40,
            afterTwips: 120 - (i - 1) * 20,
            ...irLineSpacing(fontProps.lineSpacing),
          },
          alignment: convertAlignment(fontProps.alignment || 'left'),
        },
      });
    }
  }

  // Add Title style from theme configuration
  if (theme.styles?.title) {
    const titleStyle =
      resolveStyleWithBaseStyle(theme, 'title') || theme.styles.title;
    paragraphStyles.push({
      id: 'Title',
      name: 'Title',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: (() => {
        const fontProps = resolveFontProperties(
          theme,
          titleStyle.font || 'heading'
        );
        const merged = mergeFontAndStyleProperties(fontProps, {
          size: titleStyle.size,
          color: titleStyle.color,
          bold: titleStyle.bold,
          fontWeight: titleStyle.fontWeight,
          case: titleStyle.case,
          italic: titleStyle.italic,
          underline: titleStyle.underline,
          characterSpacing: titleStyle.characterSpacing,
          scale: titleStyle.scale,
        });

        return convertRunProperties(merged, theme, theme.colors.primary, 20);
      })(),
      paragraph: (() => {
        const fontProps = resolveFontProperties(
          theme,
          titleStyle.font || 'heading'
        );
        const merged = mergeFontAndStyleProperties(fontProps, {
          alignment: titleStyle.alignment,
          lineSpacing: titleStyle.lineSpacing,
          spacing: titleStyle.spacing,
        });

        return convertParagraphProperties(merged, titleStyle, theme);
      })(),
    });
  } else {
    // Fallback title style if no theme configuration
    const fontProps = resolveFontProperties(theme, 'heading');
    paragraphStyles.push({
      id: 'Title',
      name: 'Title',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: fallbackRun(fontProps, theme, theme.colors.primary, 20),
      paragraph: {
        spacing: {
          afterTwips: 400,
          ...irLineSpacing(fontProps.lineSpacing),
        },
        alignment: convertAlignment(fontProps.alignment || 'left'),
      },
    });
  }

  // Add Subtitle style from theme configuration
  if (theme.styles?.subtitle) {
    const subtitleStyle =
      resolveStyleWithBaseStyle(theme, 'subtitle') || theme.styles.subtitle;
    paragraphStyles.push({
      id: 'Subtitle',
      name: 'Subtitle',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: (() => {
        const fontProps = resolveFontProperties(
          theme,
          subtitleStyle.font || 'body'
        );
        const merged = mergeFontAndStyleProperties(fontProps, {
          size: subtitleStyle.size,
          color: subtitleStyle.color,
          bold: subtitleStyle.bold,
          fontWeight: subtitleStyle.fontWeight,
          case: subtitleStyle.case,
          italic: subtitleStyle.italic,
          underline: subtitleStyle.underline,
          characterSpacing: subtitleStyle.characterSpacing,
          scale: subtitleStyle.scale,
        });

        return convertRunProperties(merged, theme, theme.colors.secondary);
      })(),
      paragraph: (() => {
        const fontProps = resolveFontProperties(
          theme,
          subtitleStyle.font || 'body'
        );
        const merged = mergeFontAndStyleProperties(fontProps, {
          alignment: subtitleStyle.alignment,
          lineSpacing: subtitleStyle.lineSpacing,
          spacing: subtitleStyle.spacing,
        });

        return convertParagraphProperties(merged, subtitleStyle, theme);
      })(),
    });
  } else {
    // Fallback subtitle style if no theme configuration
    const fontProps = resolveFontProperties(theme, 'body');
    paragraphStyles.push({
      id: 'Subtitle',
      name: 'Subtitle',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: fallbackRun(fontProps, theme, theme.colors.secondary, 11),
      paragraph: {
        spacing: {
          afterTwips: 600,
          ...irLineSpacing(fontProps.lineSpacing),
        },
        alignment: convertAlignment(fontProps.alignment || 'left'),
      },
    });
  }

  paragraphStyles.push(
    // Header style
    (() => {
      const fontProps = resolveFontProperties(theme, 'body');
      return {
        id: 'Header',
        name: 'Header',
        basedOn: 'Normal',
        next: 'Header',
        quickFormat: false,
        run: chromeRun(fontProps, theme, 20),
        paragraph: {
          alignment: 'right',
        },
      };
    })(),

    // Footer style
    (() => {
      const fontProps = resolveFontProperties(theme, 'body');
      return {
        id: 'Footer',
        name: 'Footer',
        basedOn: 'Normal',
        next: 'Footer',
        quickFormat: false,
        run: chromeRun(fontProps, theme, 18),
        paragraph: {
          spacing: {
            beforeTwips: 120,
          },
          alignment: 'center',
          // Note: Borders are applied at the paragraph instance level, not in style definitions
        },
      };
    })()
  );

  // Process custom styles (any additional keys in theme.styles beyond predefined ones)
  const predefinedStyleKeys = new Set([
    'normal',
    'heading1',
    'heading2',
    'heading3',
    'heading4',
    'heading5',
    'heading6',
    'title',
    'subtitle',
  ]);

  if (theme.styles) {
    for (const [styleKey, styleValue] of Object.entries(theme.styles)) {
      // Skip predefined styles (already processed above)
      if (predefinedStyleKeys.has(styleKey)) {
        continue;
      }

      // Skip if styleValue is not defined
      if (!styleValue) {
        continue;
      }

      // Generate Word-compatible style ID and name
      // Special-case TOC styles to the canonical Word display name (e.g., 'TOC 1')
      const tocMatch = /^TOC([1-9])$/.exec(styleKey);

      // For TOC styles, DO NOT resolve baseStyle inheritance to prevent coupling with Heading styles
      // TOC styles should only use their explicitly defined properties
      const customStyle = tocMatch
        ? styleValue
        : resolveStyleWithBaseStyle(theme, styleKey) || styleValue;
      // Canonical Word style id. docx hardcodes `w:pStyle w:val="TOC{level}"`
      // when it writes cached TOC entries, so a namespaced id would leave those
      // entries unstyled. docx's own default styles define no TOC id, so there
      // is nothing to collide with.
      const styleId = tocMatch ? `TOC${tocMatch[1]}` : styleKey;
      const styleName = tocMatch
        ? `TOC ${tocMatch[1]}`
        : styleKey.replace(/([A-Z])/g, ' $1').trim(); // Convert camelCase/PascalCase to Title Case

      // Helper: map baseStyle (theme key) to Word style ID
      const mapBaseStyleId = (base?: string) => {
        if (!base) return 'Normal';
        const lower = base.toLowerCase();
        if (lower === 'normal') return 'Normal';
        if (lower === 'title') return 'Title';
        if (lower === 'subtitle') return 'Subtitle';
        const m = lower.match(/^heading([1-6])$/);
        if (m) return `Heading${m[1]}`;
        // Assume custom style ID (already registered with same id)
        return base;
      };

      paragraphStyles.push({
        id: styleId,
        name: styleName,
        basedOn: tocMatch
          ? 'Normal'
          : mapBaseStyleId((customStyle as StyleProperties).baseStyle),
        next: customStyle.followingStyle || 'Normal',
        quickFormat: tocMatch
          ? false
          : customStyle.priority !== undefined
            ? true
            : false,
        run: (() => {
          const fontProps = resolveFontProperties(
            theme,
            customStyle.font || 'body'
          );
          const merged = mergeFontAndStyleProperties(fontProps, {
            size: customStyle.size,
            color: customStyle.color,
            bold: customStyle.bold,
            fontWeight: customStyle.fontWeight,
            case: customStyle.case,
            italic: customStyle.italic,
            underline: customStyle.underline,
            characterSpacing: customStyle.characterSpacing,
            scale: customStyle.scale,
          });

          return convertRunProperties(merged, theme, theme.colors.text);
        })(),
        paragraph: (() => {
          const fontProps = resolveFontProperties(
            theme,
            customStyle.font || 'body'
          );
          const merged = mergeFontAndStyleProperties(fontProps, {
            alignment: customStyle.alignment,
            lineSpacing: customStyle.lineSpacing,
            spacing: customStyle.spacing,
          });

          // Build base properties using converter
          const baseProps = convertParagraphProperties(
            merged,
            // Don't pass outlineLevel for TOC styles
            tocMatch
              ? { ...customStyle, outlineLevel: undefined }
              : customStyle,
            theme
          );

          // Add TOC-specific tab stops if needed
          const tabStops = (customStyle as any).tabStops;
          const defaultTocTabStops = tocMatch
            ? [{ type: 'right', position: 'max', leader: 'none' }]
            : undefined;
          const effectiveTabStops =
            tabStops && tabStops.length > 0 ? tabStops : defaultTocTabStops;

          return {
            ...baseProps,
            ...(effectiveTabStops && {
              tabStops: effectiveTabStops.map(
                (ts: any): DocxIrTabStop => ({
                  type: ts.type,
                  positionTwips:
                    ts.position === 'max'
                      ? RIGHT_MARGIN_TAB_TWIPS
                      : ts.position,
                  ...(ts.leader && { leader: ts.leader }),
                })
              ),
            }),
          };
        })(),
      });
    }
  }

  // Generate TOC level styles (TOC 1..6) using fixed, sober defaults.
  // These defaults do not depend on theme heading styles.
  for (let i = 1; i <= 6; i++) {
    // Skip if user already provided a custom TOC style via theme.styles (id must be 'TOC1'..'TOC6')
    if (
      theme.styles &&
      Object.prototype.hasOwnProperty.call(theme.styles, `TOC${i}`)
    ) {
      continue;
    }

    paragraphStyles.push({
      // Canonical id and display name — see the styleId note above.
      id: `TOC${i}`,
      name: `TOC ${i}`,
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: false,
      run: {
        fontFamily: 'Arial',
        sizeHalfPoints: 22, // 11pt
        color: { hex: resolveColor(theme.colors.text, theme) },
      },
      paragraph: {
        spacing: {
          ...resolveSpacing({ before: 0, after: 6 }), // 0pt before, 6pt after
        },
        alignment: convertAlignment('left'),
        // Increase left indent per level for visual hierarchy
        indent: { leftTwips: (i - 1) * 360 }, // 0.25" per level (360 twips)
      },
    });
  }

  // Note styles: docx ships built-in Footnote/Endnote Text and Reference
  // styles, but they carry Word's defaults, not the theme's — a note in a
  // Georgia document would otherwise set in Calibri. All four hooks live under
  // the `default` key, which is why that key is now always built rather than
  // being emitted only when a document language is set.
  const noteStyle =
    resolveStyleWithBaseStyle(theme, 'normal') || theme.styles?.normal;
  const bodyRun = convertRunProperties(
    mergeFontAndStyleProperties(resolveFontProperties(theme, noteStyle?.font), {
      size: noteStyle?.size,
      color: noteStyle?.color,
    }),
    theme,
    theme.colors.text
  );
  // Word's convention is note text two points below body text. `size` is in
  // half-points here, so that is four — floored so a tiny body size cannot
  // produce an illegible note.
  const noteRun: DocxIrRunFormatting = {
    ...bodyRun,
    ...(typeof bodyRun.sizeHalfPoints === 'number' && {
      sizeHalfPoints: Math.max(12, bodyRun.sizeHalfPoints - 4),
    }),
  };

  return {
    // Document defaults (`w:docDefaults`). A run that states no `w:lang` of its
    // own inherits this, so Word proofs the whole document in the requested
    // language unless a component overrides it.
    defaults: {
      run: { ...(language ? { language } : {}) },
      paragraph: {},
    },
    paragraph: paragraphStyles,
    character: [] as DocxIrCharacterStyle[],
    // Run properties only: the note paragraph defaults a backend already ships
    // (single line spacing, no space after) are what a note wants, and an empty
    // spacing override would drop its line rule.
    builtIn: {
      footnoteText: { run: noteRun },
      footnoteReference: { run: { ...noteRun, superScript: true } },
      endnoteText: { run: noteRun },
      endnoteReference: { run: { ...noteRun, superScript: true } },
    },
  };
}

/**
 * The two paragraph styles a `statistic` lowers to.
 *
 * Separate from `createDocumentStyles`, and appended by the compiler only when
 * the document actually contains a statistic. Defining them unconditionally
 * would rewrite `word/styles.xml` in every document ever produced — including
 * the ones with no statistic in them — to fix a component most documents never
 * use, and every recorded golden with it.
 *
 * A theme that names either id under `styles` has already had it emitted as a
 * custom style, so that one is skipped rather than defined twice: two entries
 * with the same id leave the later one winning, and the later one here is the
 * default, not the theme's.
 */
export function createStatisticStyles(
  theme: ThemeConfig
): DocxIrParagraphStyle[] {
  const definitions = [
    {
      id: STATISTIC_NUMBER_STYLE_ID,
      name: 'Statistic Number',
      font: 'heading' as const,
      sizePoints: STATISTIC_SIZE_POINTS.medium,
      color: theme.colors.primary,
      bold: true,
      // Space above separates the figure from whatever preceded it; none below,
      // because the description is the other half of the same block.
      spacing: { before: 12, after: 0 },
      next: STATISTIC_DESCRIPTION_STYLE_ID,
      // The figure and its caption are one unit; a page break between them
      // reads as a number with no label.
      keepNext: true,
    },
    {
      id: STATISTIC_DESCRIPTION_STYLE_ID,
      name: 'Statistic Description',
      font: 'body' as const,
      sizePoints: 10,
      color: theme.colors.textMuted,
      bold: false,
      spacing: { before: 0, after: 12 },
      next: 'Normal',
      keepNext: false,
    },
  ];

  return definitions
    .filter(
      (definition) =>
        !(
          theme.styles &&
          Object.prototype.hasOwnProperty.call(theme.styles, definition.id)
        )
    )
    .map((definition) => {
      const fontProps = resolveFontProperties(theme, definition.font);
      return {
        id: definition.id,
        name: definition.name,
        basedOn: 'Normal',
        next: definition.next,
        quickFormat: true,
        run: {
          fontFamily: fontProps.family || 'Arial',
          // Pinned, not inherited: the whole point of the style is that the
          // figure is not body text, so a theme's body size must not decide it.
          sizeHalfPoints: definition.sizePoints * 2,
          color: { hex: resolveColor(definition.color, theme) },
          bold: definition.bold,
        },
        paragraph: {
          spacing: {
            ...resolveSpacing(definition.spacing),
            ...irLineSpacing(fontProps.lineSpacing),
          },
          // Centred, matching the compiler's own alignment default — a KPI
          // reads as a block, and an author who wants otherwise says so on the
          // component, which overrides this on the paragraph.
          alignment: convertAlignment('center'),
          keepNext: definition.keepNext,
        },
      };
    });
}
