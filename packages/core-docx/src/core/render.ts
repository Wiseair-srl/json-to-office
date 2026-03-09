/**
 * Render Functions
 * Transform components and layout into Word document elements
 */

import {
  Document,
  Paragraph,
  Table,
  TableOfContents,
  ISectionOptions,
  TextRun,
  ImageRun,
  AlignmentType,
  BookmarkStart,
  BookmarkEnd,
  Textbox,
} from 'docx';
import {
  calculateImageDimensions,
  getImageBuffer,
  parseWidthValue,
} from '../utils/imageUtils';
import {
  getThemeColors,
  getThemeFonts,
  getNormalStyle,
} from '../themes/defaults';
import {
  ComponentDefinition,
  RenderContext,
  isHeadingComponent,
  isParagraphComponent,
  isColumnsComponent,
  isImageComponent,
  isTextBoxComponent,
  isStatisticComponent,
  isTableComponent,
  isSectionComponent,
  isHeaderComponent,
  isFooterComponent,
  isListComponent,
  isTocComponent,
  isHighchartsComponent,
  ParagraphComponentDefinition,
  ImageComponentDefinition,
} from '../types';
import { ThemeConfig } from '../styles';
import { createWordStyles } from '../styles/themeToDocxAdapter';
import { parseTextWithDecorators } from '../utils/textParser';
import { resolveColor } from '../styles/utils/colorUtils';
import { resolveFontFamily } from '../styles/utils/styleHelpers';
import { getPageSetup } from '../styles/utils/layoutUtils';
import { ProcessedDocument, createRenderContext } from './structure';
import { LayoutPlan, SectionLayout } from './layout';
import {
  renderComponentWithCache,
  initializeComponentCache,
} from './cached-render';
import { MemoryCache } from '../cache';
import {
  renderHeadingComponent,
  renderParagraphComponent,
  renderListComponent,
  renderImageComponent,
  renderTableComponent,
  renderSectionComponent,
  renderColumnsComponent,
  renderStatisticComponent,
  renderHeaderComponent,
  renderFooterComponent,
  renderTocComponent,
  renderHighchartsComponent,
  renderTextBoxComponent,
} from '../components';
import { createHeaderElement, createFooterElement } from './content';
import { mapFloatingOptions } from '../utils/docxImagePositioning';

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
 * Render a complete document from structure and layout
 */
export async function renderDocument(
  structure: ProcessedDocument,
  layout: LayoutPlan,
  options?: { cache?: MemoryCache; bypassCache?: boolean }
): Promise<Document> {
  // Initialize component cache if provided
  if (options?.cache) {
    initializeComponentCache(options.cache);
  } else if (!options?.bypassCache) {
    // Initialize with default cache unless bypassed
    initializeComponentCache();
  }

  // Clear the numbering registry for a fresh start
  const { globalNumberingRegistry } = await import('../utils/numberingConfig');
  globalNumberingRegistry.clear();

  const sections: ISectionOptions[] = [];

  // Render all layout sections
  const context = createRenderContext(
    structure,
    structure.theme,
    structure.themeName
  );

  // Initialize bookmark counter for this document (scoped to renderDocument call)
  let sectionBookmarkCounter = 0;

  // Track previous section's headers/footers for 'linkToPrevious' functionality
  let previousHeader: ComponentDefinition[] | undefined = undefined;
  let previousFooter: ComponentDefinition[] | undefined = undefined;

  // Render all layout sections
  for (let idx = 0; idx < layout.sections.length; idx++) {
    const layoutSection = layout.sections[idx];

    /**
     * Compute stable section ordinal for user-defined sections.
     *
     * When a user-defined Section component spans multiple layout chunks (e.g., due to
     * column transitions), all chunks must share the same bookmark ID for TOC scoping
     * to work correctly. This ensures:
     * 1. Bookmark start appears only in the first chunk
     * 2. All chunks use the same stable bookmark ID (no timestamp)
     * 3. Bookmark end appears only in the last chunk
     *
     * Previously used Date.now() in bookmark IDs, which caused different IDs per chunk.
     * Now we use a stable ordinal that's consistent across all chunks of the same section.
     */
    let sectionOrdinal: number | undefined = undefined;
    if (layoutSection.belongsToUserSection) {
      if (layoutSection.isUserSection) {
        // First chunk of this user-defined section: assign ordinal as next index
        sectionOrdinal = sectionBookmarkCounter + 1;
      } else {
        // Subsequent chunk: reuse last assigned ordinal
        sectionOrdinal = sectionBookmarkCounter; // previous value already incremented after first chunk
      }
    }
    // Handle 'linkToPrevious' value for headers
    let headerToUse: ComponentDefinition[] | undefined;
    if (layoutSection.header === 'linkToPrevious') {
      // Use the previous section's header
      headerToUse = previousHeader;
    } else if (layoutSection.header) {
      // Section has its own header
      headerToUse = layoutSection.header as ComponentDefinition[];
      previousHeader = headerToUse; // Update previous for next section
    } else {
      // No header explicitly set for this section.
      // Important: Word links headers/footers to previous by default.
      // To prevent unintended inheritance, emit an explicit empty header
      // when a previous header exists and caller didn't request linking.
      headerToUse = previousHeader ? [] : undefined;
      // Keep previousHeader cached for potential future explicit linkToPrevious
    }

    // Handle 'linkToPrevious' value for footers
    let footerToUse: ComponentDefinition[] | undefined;
    if (layoutSection.footer === 'linkToPrevious') {
      // Use the previous section's footer
      footerToUse = previousFooter;
    } else if (layoutSection.footer) {
      // Section has its own footer
      footerToUse = layoutSection.footer as ComponentDefinition[];
      previousFooter = footerToUse; // Update previous for next section
    } else {
      // No footer explicitly set for this section.
      // Prevent unintended inheritance by emitting an explicit empty footer
      // when a previous footer exists and caller didn't request linking.
      footerToUse = previousFooter ? [] : undefined;
      // Keep previousFooter cached for potential future explicit linkToPrevious
    }

    const sectionToRender = {
      ...layoutSection,
      header: headerToUse,
      footer: footerToUse,
    };

    // Determine if we should close the bookmark in this chunk.
    // Close when this is the last chunk belonging to the same user-defined section.
    let closeBookmark = false;
    if (layoutSection.belongsToUserSection && sectionOrdinal !== undefined) {
      const next = layout.sections[idx + 1];
      if (!next || !next.belongsToUserSection || next.isUserSection) {
        closeBookmark = true;
      }
    }

    const rendered = await renderSection(
      sectionToRender,
      structure.theme,
      structure.themeName,
      context,
      sectionOrdinal,
      closeBookmark
    );

    // Increment counter if this section created a bookmark
    if (layoutSection.isUserSection) {
      sectionBookmarkCounter++;
    }

    if (rendered.children.length > 0) {
      sections.push(rendered);
    }
  }

  // Get all numbering configurations from the registry (already imported above)
  const numberingConfigs = globalNumberingRegistry.getAll();

  return new Document({
    styles: createWordStyles(structure.theme),
    sections,
    features: {
      updateFields: true, // Required for TOC fields to update correctly
    },
    // Add numbering configurations if any lists were rendered
    ...(numberingConfigs.length > 0 && {
      numbering: {
        config: numberingConfigs as readonly {
          readonly levels: readonly import('docx').ILevelsOptions[];
          readonly reference: string;
        }[],
      },
    }),
  });
}

/**
 * Render header/footer components into paragraphs
 */
async function renderHeaderFooterComponents(
  components: ComponentDefinition[] | undefined,
  theme: ThemeConfig,
  _themeName: string,
  _context: RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!components || components.length === 0) {
    return [];
  }

  // Filter out components with enabled: false (defaults to true when not specified)
  const activeComponents = components.filter(
    (m) => !('enabled' in m && m.enabled === false)
  );

  const elements: (Paragraph | Table)[] = [];

  for (const component of activeComponents) {
    if (isParagraphComponent(component)) {
      const textComp = component as ParagraphComponentDefinition;

      // Use theme's normal style for header/footer text since header/footer styles are removed
      const normalStyle = getNormalStyle(theme);

      // Create text style using theme's normal styling
      const textStyle = {
        font:
          textComp.props.font?.family ||
          resolveFontFamily(theme, normalStyle.font) ||
          getThemeFonts(theme).body.family,
        size:
          ((textComp.props.font?.size ?? normalStyle.size ?? 11) as number) * 2, // Convert to half-points
        bold: textComp.props.font?.bold ?? false,
        italics: textComp.props.font?.italic ?? false,
        color:
          (textComp.props.font?.color &&
            resolveColor(textComp.props.font.color, theme)) ||
          (normalStyle.color && resolveColor(normalStyle.color, theme)) ||
          getThemeColors(theme).textPrimary,
      } as const;

      // Use parseTextWithDecorators to support rich text formatting
      const textRuns = parseTextWithDecorators(textComp.props.text, textStyle);

      elements.push(
        new Paragraph({
          children: textRuns,
          alignment: textComp.props.alignment
            ? getAlignment(textComp.props.alignment)
            : undefined,
          style: 'Normal',
        })
      );
    } else if (isImageComponent(component)) {
      const imageComp = component as ImageComponentDefinition;
      // Get image source (base64 or path)
      let imageSource = imageComp.props.base64 || imageComp.props.path;
      if (!imageSource) {
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '[IMAGE: Missing path or base64 property]',
                font: getThemeFonts(theme).body.family,
                size: 20,
                bold: true,
                color: '#FF0000',
              }),
            ],
            alignment: imageComp.props.alignment
              ? getAlignment(imageComp.props.alignment)
              : undefined,
            style: 'Normal',
          })
        );
        continue;
      }

      let imageBuffer: Buffer;

      try {
        // Try to use the provided source first
        imageBuffer = await getImageBuffer(imageSource);
      } catch (error) {
        throw new Error(
          `Failed to load image from ${imageSource.substring(0, 50)}`
        );
      }

      try {
        // Get page setup from theme for proper width calculations
        const pageSetup = getPageSetup(theme);

        // Convert twips to pixels: 1 twip = 1/1440 inch, 1 inch = 96 pixels at 96 DPI
        const TWIPS_TO_PIXELS = 96 / 1440;

        // Calculate page width and content width (page - left margin - right margin) in pixels
        const pageWidthPx = Math.round(pageSetup.size.width * TWIPS_TO_PIXELS);
        const contentWidthPx = Math.round(
          (pageSetup.size.width -
            pageSetup.margin.left -
            pageSetup.margin.right) *
            TWIPS_TO_PIXELS
        );

        // Determine reference dimensions based on widthRelativeTo/heightRelativeTo properties
        const widthRelativeTo = imageComp.props.widthRelativeTo || 'content';
        const heightRelativeTo = imageComp.props.heightRelativeTo || 'content';
        const referenceWidthPx =
          widthRelativeTo === 'page' ? pageWidthPx : contentWidthPx;

        // Calculate page height and content height in pixels
        const pageHeightPx = Math.round(
          pageSetup.size.height * TWIPS_TO_PIXELS
        );
        const contentHeightPx = Math.round(
          (pageSetup.size.height -
            pageSetup.margin.top -
            pageSetup.margin.bottom) *
            TWIPS_TO_PIXELS
        );
        const referenceHeightPx =
          heightRelativeTo === 'page' ? pageHeightPx : contentHeightPx;

        const fallbackHeight = Math.round(referenceWidthPx * 0.6);

        // Parse width value if it's a string percentage (like "90%")
        const parsedWidth =
          typeof imageComp.props.width === 'string'
            ? parseWidthValue(imageComp.props.width, referenceWidthPx) // Use appropriate reference width
            : imageComp.props.width;

        // Parse height value if it's a string percentage (like "90%")
        const parsedHeight =
          typeof imageComp.props.height === 'string'
            ? parseWidthValue(imageComp.props.height, referenceHeightPx) // Use reference height based on heightRelativeTo
            : imageComp.props.height;

        // Calculate dimensions with aspect ratio preservation
        const dimensions = await calculateImageDimensions(
          imageSource,
          parsedWidth,
          parsedHeight,
          referenceWidthPx,
          fallbackHeight
        );

        // Map floating options if present
        const floatingOptions = mapFloatingOptions(imageComp.props.floating);

        const imageRun = new ImageRun({
          type: 'png',
          data: imageBuffer,
          transformation: {
            width: dimensions.width,
            height: dimensions.height,
          },
          ...(floatingOptions && { floating: floatingOptions }),
        });

        elements.push(
          new Paragraph({
            children: [imageRun],
            alignment: imageComp.props.alignment
              ? getAlignment(imageComp.props.alignment)
              : undefined,
            style: 'Normal',
          })
        );
      } catch (error) {
        // Fallback for missing images - log error for debugging
        console.error(
          `[Header/Footer Image Error] Failed to render image: ${imageComp.props.path?.substring(0, 50)}...`,
          error instanceof Error ? error.message : error
        );
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[IMAGE: ${imageComp.props.path}]`,
                font: getThemeFonts(theme).body.family,
                size: 20,
                color: getThemeColors(theme).secondary,
                bold: true,
              }),
            ],
            style: 'Normal',
          })
        );
      }
    } else if (isTableComponent(component)) {
      // Use renderTableComponent for consistent table rendering in headers/footers
      // This ensures cellDefaults, padding, borders, and all table features work correctly
      const tables = await renderTableComponent(component, theme, _themeName);
      elements.push(...tables);
    }
    // Other component types can be added here as needed
  }

  return elements;
}

/**
 * Render a section with layout
 */
export async function renderSection(
  section: SectionLayout,
  theme: ThemeConfig,
  themeName: string,
  context: RenderContext,
  sectionOrdinal?: number,
  closeBookmark?: boolean
): Promise<ISectionOptions> {
  const elements: (Paragraph | Table | TableOfContents)[] = [];

  // Update context for this section
  // Generate a unique bookmark for this section so TOCs can scope to it
  const isFirstLayoutOfUserSection = section.isUserSection;
  // Use a stable bookmark ID across all layout sections of the same user-defined section
  const sharedLinkId =
    section.belongsToUserSection && sectionOrdinal ? sectionOrdinal : undefined;
  const sectionBookmarkId =
    sharedLinkId !== undefined ? `_Section_${sharedLinkId}` : undefined;

  const sectionContext: RenderContext = {
    ...context,
    section: {
      ...context.section,
      currentLayout: section.layoutType,
      columnCount: section.properties.column?.count || 1,
      // Always pass the same bookmark ID for all layout chunks of the same section
      sectionBookmarkId: sectionBookmarkId,
      // Pass section title level for TOC scoping (excludes section title from its own TOC)
      sectionTitleLevel: section.sectionTitleLevel,
    },
  };

  // Add bookmark start before all section content so TOCs can scope to it
  if (
    sectionBookmarkId &&
    isFirstLayoutOfUserSection &&
    sharedLinkId !== undefined
  ) {
    elements.push(
      new Paragraph({
        children: [new BookmarkStart(sectionBookmarkId, sharedLinkId)],
        spacing: {
          before: 0,
          after: 0,
          line: 0,
        },
      })
    );
  }

  // Filter out components with enabled: false and render remaining components (with caching)
  const activeComponents = section.components.filter(
    (m) => !('enabled' in m && m.enabled === false)
  );
  for (const component of activeComponents) {
    const rendered = await renderComponentWithCache(
      component,
      theme,
      themeName,
      sectionContext,
      false // Don't bypass cache
    );
    elements.push(...rendered);
  }

  // Close bookmark after section content
  if (closeBookmark && sharedLinkId !== undefined) {
    elements.push(
      new Paragraph({
        children: [new BookmarkEnd(sharedLinkId)],
      })
    );
  }

  // Build section options with headers/footers if defined
  let headers: ISectionOptions['headers'] | undefined;
  let footers: ISectionOptions['footers'] | undefined;

  if (section.header || section.footer) {
    if (section.header && section.header !== 'linkToPrevious') {
      const headerComponents = section.header as ComponentDefinition[];
      const headerParagraphs = await renderHeaderFooterComponents(
        headerComponents,
        theme,
        themeName,
        sectionContext
      );
      // If components were provided but produced no paragraphs, still create
      // an empty Header to break Word's default link-to-previous behavior.
      if (headerComponents.length === 0 || headerParagraphs.length > 0) {
        headers = {
          default: createHeaderElement(headerParagraphs),
        };
      }
    }

    if (section.footer && section.footer !== 'linkToPrevious') {
      const footerComponents = section.footer as ComponentDefinition[];
      const footerParagraphs = await renderHeaderFooterComponents(
        footerComponents,
        theme,
        themeName,
        sectionContext
      );
      if (footerComponents.length === 0 || footerParagraphs.length > 0) {
        footers = {
          default: createFooterElement(footerParagraphs),
        };
      }
    }
  }

  const sectionOptions: ISectionOptions = {
    properties: section.properties,
    children: elements,
    headers,
    footers,
  };

  return sectionOptions;
}

/**
 * Render a single component to Word elements
 */
export async function renderComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: RenderContext
): Promise<(Paragraph | Table | TableOfContents | Textbox)[]> {
  if (isHeadingComponent(component)) {
    return renderHeadingComponent(component, theme, themeName);
  } else if (isParagraphComponent(component)) {
    return renderParagraphComponent(component, theme, themeName);
  } else if (isColumnsComponent(component)) {
    return await renderColumnsComponent(component, theme, themeName, context);
  } else if (isImageComponent(component)) {
    return await renderImageComponent(component, theme);
  } else if (isTextBoxComponent(component)) {
    return await renderTextBoxComponent(component, theme, themeName, context);
  } else if (isStatisticComponent(component)) {
    return renderStatisticComponent(component, theme);
  } else if (isTableComponent(component)) {
    return await renderTableComponent(component, theme, themeName);
  } else if (isHeaderComponent(component)) {
    return renderHeaderComponent(component, theme, themeName);
  } else if (isFooterComponent(component)) {
    return renderFooterComponent(component, theme, themeName);
  } else if (isListComponent(component)) {
    return renderListComponent(component, theme, themeName);
  } else if (isTocComponent(component)) {
    return renderTocComponent(component, theme, context);
  } else if (isHighchartsComponent(component)) {
    return await renderHighchartsComponent(component, theme, themeName);
  } else if (isSectionComponent(component)) {
    return await renderSectionComponent(component, theme, themeName, context);
  }

  throw new Error(
    `Unknown component type: ${(component as ComponentDefinition).name}`
  );
}
