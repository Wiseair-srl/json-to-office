import {
  IStylesOptions,
  IRunStylePropertiesOptions,
  IParagraphStylePropertiesOptions,
  AlignmentType,
  TabStopPosition,
} from 'docx';
import { getTheme } from '../templates/themes';
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
}

// Style properties for various text elements
interface StyleProperties {
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
 * Type-safe style name union
 */
type StyleName =
  | 'normal'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'title'
  | 'subtitle';

/**
 * Type guard to check if a style name is valid
 */
function isValidStyleName(name: string): name is StyleName {
  return [
    'normal',
    'heading1',
    'heading2',
    'heading3',
    'heading4',
    'heading5',
    'heading6',
    'title',
    'subtitle',
  ].includes(name);
}

/**
 * Type-safe style getter with proper error handling
 */
function getStyleSafe(
  theme: ThemeConfig,
  styleName: string
): StyleProperties | undefined {
  if (!isValidStyleName(styleName)) {
    console.warn(`Invalid style name: ${styleName}`);
    return undefined;
  }
  return theme.styles?.[styleName] as StyleProperties | undefined;
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

function convertAlignment(
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
 * Resolve spacing from new nested format
 */
function resolveSpacing(spacing?: { before?: number; after?: number }): {
  before?: number;
  after?: number;
} {
  return {
    before: spacing?.before ? pointsToTwips(spacing.before) : undefined,
    after: spacing?.after ? pointsToTwips(spacing.after) : undefined,
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
): IRunStylePropertiesOptions {
  return {
    font: merged.family || 'Arial',
    size: (merged.size || defaultSize || 11) * 2,
    color: resolveColor(
      merged.color || defaultColor || theme.colors.text,
      theme
    ),
    ...(merged.bold !== undefined && { bold: merged.bold }),
    ...(merged.italic !== undefined && { italic: merged.italic }),
    ...(merged.underline !== undefined &&
      merged.underline && { underline: { type: 'single' } }),
    ...(merged.characterSpacing && {
      characterSpacing:
        merged.characterSpacing.type === 'condensed'
          ? -merged.characterSpacing.value
          : merged.characterSpacing.value,
    }),
  };
}

/**
 * Convert merged style properties to docx paragraph properties
 */
function convertParagraphProperties(
  merged: any,
  styleProps?: StyleProperties,
  theme?: ThemeConfig
): IParagraphStylePropertiesOptions {
  return {
    spacing: {
      ...resolveSpacing(merged.spacing),
      ...convertLineSpacing(merged.lineSpacing),
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
      border: convertBorders(styleProps.borders, theme),
    }),
    ...(styleProps?.indent && {
      indent: {
        ...(styleProps.indent.left !== undefined && {
          left: styleProps.indent.left,
        }),
        ...(styleProps.indent.hanging !== undefined && {
          hanging: styleProps.indent.hanging,
        }),
      },
    }),
  } as IParagraphStylePropertiesOptions;
}

/**
 * Convert theme border definitions to docx paragraph border options
 */
function convertBorders(
  borders: ThemeBorders | undefined,
  theme: ThemeConfig
):
  | {
      top?: { style: string; size: number; color: string; space?: number };
      bottom?: { style: string; size: number; color: string; space?: number };
      left?: { style: string; size: number; color: string; space?: number };
      right?: { style: string; size: number; color: string; space?: number };
    }
  | undefined {
  if (!borders) return undefined;

  const mapSide = (side?: ThemeBorderDefinition) =>
    side
      ? {
        style: side.style,
        size: side.size,
        color: resolveColor(side.color, theme),
        ...(side.space !== undefined ? { space: side.space } : {}),
      }
      : undefined;

  const top = mapSide(borders.top);
  const bottom = mapSide(borders.bottom);
  const left = mapSide(borders.left);
  const right = mapSide(borders.right);

  const anyDefined = top || bottom || left || right;
  return anyDefined
    ? {
      ...(top && { top }),
      ...(bottom && { bottom }),
      ...(left && { left }),
      ...(right && { right }),
    }
    : undefined;
}

export interface WordStyleDefinition {
  id: string;
  name: string;
  basedOn?: string;
  next?: string;
  quickFormat?: boolean;
  run?: IRunStylePropertiesOptions;
  paragraph?: IParagraphStylePropertiesOptions;
}

/**
 * Creates Word document styles from theme configuration
 * @param themeNameOrObject The theme to use for styling (name string or theme object)
 * @returns IStylesOptions for docx Document
 */
export function createWordStyles(
  themeNameOrObject: string | ThemeConfig = 'minimal'
): IStylesOptions {
  const theme: ThemeConfig =
    typeof themeNameOrObject === 'string'
      ? getTheme(themeNameOrObject) || getTheme('minimal')!
      : themeNameOrObject;

  const paragraphStyles: WordStyleDefinition[] = [
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
          italic: normalStyle?.italic,
          underline: normalStyle?.underline,
          characterSpacing: normalStyle?.characterSpacing,
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
            italic: headingStyle.italic,
            underline: headingStyle.underline,
            characterSpacing: headingStyle.characterSpacing,
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
        run: {
          font: fontProps.family || 'Arial',
          size: (fontProps.size || 20) * 2,
          color: resolveColor(fontProps.color || theme.colors.primary, theme),
          ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
          ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
          ...(fontProps.underline !== undefined &&
            fontProps.underline && { underline: { type: 'single' } }),
        },
        paragraph: {
          spacing: {
            before: 240 - (i - 1) * 40,
            after: 120 - (i - 1) * 20,
            ...convertLineSpacing(fontProps.lineSpacing),
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
            italic: headingStyle.italic,
            underline: headingStyle.underline,
            characterSpacing: headingStyle.characterSpacing,
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
        run: {
          font: fontProps.family || 'Arial',
          size: (fontProps.size || 20) * 2,
          color: resolveColor(fontProps.color || theme.colors.primary, theme),
          ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
          ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
          ...(fontProps.underline !== undefined &&
            fontProps.underline && { underline: { type: 'single' } }),
        },
        paragraph: {
          spacing: {
            before: 240 - (i - 1) * 40,
            after: 120 - (i - 1) * 20,
            ...convertLineSpacing(fontProps.lineSpacing),
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
          italic: titleStyle.italic,
          underline: titleStyle.underline,
          characterSpacing: titleStyle.characterSpacing,
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
      run: {
        font: fontProps.family || 'Arial',
        size: (fontProps.size || 20) * 2,
        color: resolveColor(fontProps.color || theme.colors.primary, theme),
        ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
        ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
        ...(fontProps.underline !== undefined &&
          fontProps.underline && { underline: { type: 'single' } }),
      },
      paragraph: {
        spacing: {
          after: 400,
          ...convertLineSpacing(fontProps.lineSpacing),
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
          italic: subtitleStyle.italic,
          underline: subtitleStyle.underline,
          characterSpacing: subtitleStyle.characterSpacing,
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
      run: {
        font: fontProps.family || 'Arial',
        size: (fontProps.size || 11) * 2,
        color: resolveColor(fontProps.color || theme.colors.secondary, theme),
        ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
        ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
        ...(fontProps.underline !== undefined &&
          fontProps.underline && { underline: { type: 'single' } }),
      },
      paragraph: {
        spacing: {
          after: 600,
          ...convertLineSpacing(fontProps.lineSpacing),
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
        run: {
          font: fontProps.family || 'Arial',
          size: 20, // 10pt (override default)
          color: resolveColor(fontProps.color || theme.colors.secondary, theme),
          ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
          ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
        },
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
        run: {
          font: fontProps.family || 'Arial',
          size: 18, // 9pt (override default)
          color: resolveColor(fontProps.color || theme.colors.secondary, theme),
          ...(fontProps.bold !== undefined && { bold: fontProps.bold }),
          ...(fontProps.italic !== undefined && { italic: fontProps.italic }),
        },
        paragraph: {
          spacing: {
            before: 120,
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
      // Use a namespaced ID for TOC styles to avoid any accidental ID collisions
      const styleId = tocMatch ? `JTD_TOC${tocMatch[1]}` : styleKey;
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
            italic: customStyle.italic,
            underline: customStyle.underline,
            characterSpacing: customStyle.characterSpacing,
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
              tabStops: effectiveTabStops.map((ts: any) => ({
                type: ts.type,
                position:
                  ts.position === 'max' ? TabStopPosition.MAX * 2 : ts.position,
                ...(ts.leader && { leader: ts.leader }),
              })),
            }),
          } as IParagraphStylePropertiesOptions;
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
      // Use a namespaced ID but canonical display name
      id: `JTD_TOC${i}`,
      name: `TOC ${i}`,
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: false,
      run: {
        font: 'Arial',
        size: 22, // 11pt
        color: resolveColor(theme.colors.text, theme),
      },
      paragraph: {
        spacing: {
          ...resolveSpacing({ before: 0, after: 6 }), // 0pt before, 6pt after
        },
        alignment: convertAlignment('left'),
        // Increase left indent per level for visual hierarchy
        indent: { left: (i - 1) * 360 }, // 0.25" per level (360 twips)
      },
    });
  }

  return {
    paragraphStyles: paragraphStyles as WordStyleDefinition[], // Cast needed due to docx typing
  };
}

/**
 * Maps section levels to Word style IDs
 */
export function getStyleIdForLevel(level: number): string {
  const styleMap: { [key: number]: string } = {
    1: 'Heading1',
    2: 'Heading2',
    3: 'Heading3',
    4: 'Heading4',
    5: 'Heading5',
    6: 'Heading6',
  };
  return styleMap[level] || 'Heading1';
}
