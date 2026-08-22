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

/**
 * docx declares `ToCEntry` but does not export it, so mirror the shape it
 * accepts for `cachedEntries`. `page` and `href` are optional and deliberately
 * unused — see `selectCachedEntries`.
 */
type ToCEntry = {
  readonly title: string;
  readonly level: number;
  readonly page?: number;
  readonly href?: string;
};
import type { TocProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../../styles';
import type { RenderContext } from '../../types';
import { resolveTocField } from '../../core/tocField';

export interface TocComponentDefinition {
  name: 'toc';
  id?: string;
  props: TocProps;
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

  const field = resolveTocField(componentProps, theme, {
    ...(context?.section?.sectionBookmarkId
      ? { sectionBookmarkId: context.section.sectionBookmarkId }
      : {}),
    ...(context?.tocHeadings ? { collected: context.tocHeadings } : {}),
  });

  for (const warning of field.warnings) {
    // eslint-disable-next-line no-console
    console.warn(warning);
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

  const cachedEntries: ToCEntry[] = field.entries.map((entry) => ({
    title: entry.text,
    level: entry.level,
  }));

  const tocOptions: ITableOfContentsOptions = {
    hyperlink: true, // \h
    headingStyleRange: `${field.headingRange.from}-${field.headingRange.to}`, // \o
    stylesWithLevels: field.styleLevels.map(
      (style) => new StyleLevel(style.styleName, style.level)
    ), // \t
    entriesFromBookmark: field.bookmarkScope, // \b
    ...(field.omitPageNumbersForLevels.length > 0
      ? {
          pageNumbersEntryLevelsRange: field.omitPageNumbersForLevels
            .map((range) => `${range.from}-${range.to}`)
            .join(','),
        }
      : {}), // \n
    entryAndPageNumberSeparator: field.entrySeparator,
  };

  // Insert TOC as a top-level block (not wrapped in a Paragraph).
  // Wrapping TableOfContents inside a Paragraph produces an empty SDT above
  // the actual entries in Word. Adding directly avoids that artifact.
  paragraphs.push(
    new TableOfContents(componentProps.title ?? 'Table of Contents', {
      ...tocOptions,
      ...(cachedEntries.length > 0 && { cachedEntries }),
    })
  );

  return paragraphs;
}
