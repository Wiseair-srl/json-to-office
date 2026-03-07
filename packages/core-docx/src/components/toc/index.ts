/**
 * Table of Contents Component
 * Renders TOC using Word's native TableOfContents field with bookmark scoping support
 */

import {
  Paragraph,
  TableOfContents,
  AlignmentType,
  TextRun,
  StyleLevel,
} from 'docx';
import type { ITableOfContentsOptions } from 'docx';
import type { TocProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../../styles';
import type { RenderContext } from '../../types';

export interface TocComponentDefinition {
  name: 'toc';
  id?: string;
  props: TocProps;
}

/**
 * Parse and validate a depth range configuration
 * @param rawDepth - Raw depth configuration from user input
 * @param fieldName - Name of the field (for error messages)
 * @param defaultFrom - Default 'from' value if not specified
 * @param defaultTo - Default 'to' value if not specified
 * @returns Validated depth range with from and to values
 */
function parseDepthRange(
  rawDepth: any,
  fieldName: string,
  defaultFrom = 1,
  defaultTo = 3
): { from: number; to: number } {
  if (typeof rawDepth !== 'object' || rawDepth === null) {
    throw new Error(
      `${fieldName} must be a range object with optional "from" and/or "to" fields, received: ${JSON.stringify(rawDepth)}`
    );
  }

  // Apply defaults for missing values
  const from = rawDepth.from ?? defaultFrom;
  const to = rawDepth.to ?? defaultTo;

  // Validate range
  if (from < 1 || from > 6 || to < 1 || to > 6) {
    throw new Error(
      `${fieldName} range values must be between 1 and 6, received: from=${from}, to=${to}`
    );
  }
  if (from > to) {
    throw new Error(
      `${fieldName} "from" must be less than or equal to "to", received: from=${from}, to=${to}`
    );
  }

  return { from, to };
}

/**
 * Render TOC component using Word's native TableOfContents field with bookmark scoping
 *
 * This creates a dynamic TOC that:
 * - Auto-populates with headings from configured scope
 * - Updates automatically when document structure changes
 * - Includes clickable hyperlinks to content
 * - Shows page numbers (if enabled)
 * - Respects configured depth limits
 *
 * Scope behavior:
 * - scope: 'document' → Scans entire document (default when TOC is at report level)
 * - scope: 'section' → Scans only parent section content (uses bookmark)
 * - scope: 'auto' → Automatically detects: section if inside section, otherwise document
 */
export function renderTocComponent(
  component: TocComponentDefinition,
  theme: ThemeConfig,
  context?: RenderContext
): (Paragraph | TableOfContents)[] {
  const componentProps = component.props;

  // Parse depth parameter - supports range with optional from/to
  const rawDepth = componentProps.depth ?? { to: 3 };
  const depthRange = parseDepthRange(rawDepth, 'TOC depth', 1, 3);
  const depthStart = depthRange.from;
  const depthEnd = depthRange.to;

  // Parse pageNumbersDepth parameter - controls which levels show page numbers
  let pageNumbersStart: number | undefined;
  let pageNumbersEnd: number | undefined;

  if (componentProps.pageNumbersDepth !== undefined) {
    const pageNumbersRange = parseDepthRange(
      componentProps.pageNumbersDepth,
      'TOC pageNumbersDepth',
      1,
      3
    );
    pageNumbersStart = pageNumbersRange.from;
    pageNumbersEnd = pageNumbersRange.to;
  }

  // Note: numberingStyle is not currently used by docx.js TableOfContents API
  // Future enhancement: implement custom numbering via post-processing or XmlComponent
  // const numberingStyle = componentProps.numberingStyle ?? 'numeric';
  const includePageNumbers = componentProps.includePageNumbers !== false; // default true
  const scope = componentProps.scope ?? 'auto';

  // Determine effective scope based on configuration and context
  const effectiveScope =
    scope === 'auto'
      ? context?.section?.sectionBookmarkId
        ? 'section'
        : 'document'
      : scope;

  // Get section bookmark ID if scoped to section
  const sectionBookmarkId =
    effectiveScope === 'section'
      ? context?.section?.sectionBookmarkId
      : undefined;

  // Validate bookmark if section-scoped
  if (effectiveScope === 'section' && !sectionBookmarkId) {
    // Log warning but gracefully fall back to document scope
    console.warn(
      'TOC configured for section scope but no section bookmark found. Falling back to document scope.'
    );
  }

  const paragraphs: (Paragraph | TableOfContents)[] = [];

  // Add TOC title only if explicitly provided
  if (componentProps.title) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: componentProps.title,
            bold: true,
            size: 28, // 14pt (size is in half-points)
          }),
        ],
        spacing: {
          before: theme.componentDefaults?.heading?.spacing?.before ?? 240,
          // Increase spacing between the title and the TOC list
          // 180 ~= 9pt, provides clearer separation by default
          after: 180,
        },
        alignment: AlignmentType.LEFT,
      })
    );
  }

  // Build style mappings for TOC levels based on depth
  // StyleLevel requires styleName (string) and level (number)
  const stylesWithLevels: StyleLevel[] = [];

  // For section-scoped TOCs, exclude heading levels equal to or above the section title level
  // This prevents the section title from appearing in its own TOC
  const sectionTitleLevel = context?.section?.sectionTitleLevel;
  const startLevel =
    effectiveScope === 'section' && sectionTitleLevel
      ? sectionTitleLevel // Start from the level after the section title
      : 0; // Document scope starts from level 1 (index 0)

  // Do NOT map built-in heading styles via \t switch.
  // Use headingStyleRange (\o) exclusively for Heading 1..6 to avoid any interference
  // between TOC styles and document heading styles.

  // Add custom style mappings if provided
  // These allow arbitrary theme styles to appear in the TOC at specified levels
  if (componentProps.styles && componentProps.styles.length > 0) {
    for (const styleMapping of componentProps.styles) {
      // The TOC \t (stylesWithLevels) switch expects Word style DISPLAY NAMES, not IDs.
      // Our theme registers custom styles with:
      //   - id: original key (e.g., "MySpectacularStyle")
      //   - name: Title Case with spaces (e.g., "My Spectacular Style")
      // Convert known custom style IDs to their display names to ensure Word matches them.
      const styleId = styleMapping.styleId;
      const isCustomStyle =
        !!theme.styles &&
        Object.prototype.hasOwnProperty.call(theme.styles, styleId);
      const styleDisplayName = isCustomStyle
        ? styleId
            .replace(/([A-Z])/g, ' $1')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : styleId; // If it's not a custom style key, assume it's already a display name

      stylesWithLevels.push(
        new StyleLevel(styleDisplayName, styleMapping.level)
      );
    }
  }

  // Create Word TOC field with optional bookmark scoping
  // The TableOfContents class generates a field code that Word will populate
  // Format (document scope): { TOC \o "1-N" \h \z \u }
  // Format (section scope): { TOC \b BookmarkName \o "1-N" \h \z \u }
  // - \b BookmarkName: Limit TOC to entries within specified bookmark
  // - \o "1-N": Include outline levels 1 through N
  // - \h: Make TOC entries hyperlinks
  // - \z: Hide page numbers in web layout
  // - \u: Use outline levels instead of TC fields

  // Calculate heading range for \o switch
  // For section-scoped TOCs: start AFTER section title level (e.g., level 2 if section is level 1)
  // For document-scoped TOCs: use depthStart and depthEnd from parsed depth config
  const effectiveDepthStart =
    effectiveScope === 'section' && sectionTitleLevel
      ? Math.max(depthStart, startLevel + 1) // Skip section title level, but respect user's depthStart
      : depthStart;
  const effectiveDepthEnd = depthEnd;

  // Build TOC options
  const tocOptions: ITableOfContentsOptions = {
    hyperlink: true, // Enable clickable hyperlinks (\h switch)
    headingStyleRange: `${effectiveDepthStart}-${effectiveDepthEnd}`, // Outline level range (\o switch)
    stylesWithLevels, // Style-to-TOC-level mappings (\t switch)
    // Add bookmark scope if within a section (\b switch)
    entriesFromBookmark: sectionBookmarkId,
    // Handle page number visibility
    // If pageNumbersDepth is specified, use it to control which levels show page numbers
    // Otherwise, respect includePageNumbers boolean (default true)
    ...(() => {
      if (pageNumbersStart !== undefined && pageNumbersEnd !== undefined) {
        // pageNumbersDepth specified: hide page numbers outside the specified range
        // Word's \n switch omits page numbers for specified levels
        // We need to invert the logic: specify levels to OMIT, not levels to SHOW
        const levelsToOmit: string[] = [];

        // Omit levels before pageNumbersStart
        if (pageNumbersStart > effectiveDepthStart) {
          levelsToOmit.push(`${effectiveDepthStart}-${pageNumbersStart - 1}`);
        }

        // Omit levels after pageNumbersEnd
        if (pageNumbersEnd < effectiveDepthEnd) {
          levelsToOmit.push(`${pageNumbersEnd + 1}-${effectiveDepthEnd}`);
        }

        // Only add the option if there are levels to omit
        return levelsToOmit.length > 0
          ? { pageNumbersEntryLevelsRange: levelsToOmit.join(',') }
          : {};
      } else if (!includePageNumbers) {
        // includePageNumbers is false: omit page numbers for all levels
        return {
          pageNumbersEntryLevelsRange: `${effectiveDepthStart}-${effectiveDepthEnd}`,
        };
      } else {
        // includePageNumbers is true and no pageNumbersDepth: show page numbers for all levels
        return {};
      }
    })(),
    // Add separator between entry text and page number
    // Boolean: true = "\t" (tab, default), false = " " (space)
    ...(componentProps.numberSeparator !== undefined
      ? {
          entryAndPageNumberSeparator: componentProps.numberSeparator
            ? '\t'
            : ' ',
        }
      : { entryAndPageNumberSeparator: '\t' }), // default to tab
  };

  // Insert TOC as a top-level block (not wrapped in a Paragraph).
  // Wrapping TableOfContents inside a Paragraph produces an empty SDT above
  // the actual entries in Word. Adding directly avoids that artifact.
  paragraphs.push(
    new TableOfContents(componentProps.title ?? 'Table of Contents', tocOptions)
  );

  // Do not append an extra empty paragraph after TOC to avoid
  // unwanted blank lines/newlines at the end of the TOC block.

  // Note: Word will automatically handle:
  // - Page number display (based on document view mode)
  // - Numbering style (inherited from heading styles)
  // - Indentation (based on heading levels)
  // - Updates (right-click TOC → Update Field in Word)

  return paragraphs;
}
