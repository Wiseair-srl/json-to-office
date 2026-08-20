/**
 * Render Functions
 * Transform components and layout into Word document elements
 */

import {
  Document,
  Paragraph,
  Table,
  TableOfContents,
  IPropertiesOptions,
  ISectionOptions,
  TextRun,
  AlignmentType,
  BookmarkStart,
  BookmarkEnd,
  Textbox,
} from 'docx';
import {
  calculateImageDimensions,
  getImageBuffer,
  parseWidthValue,
  detectImageType,
  createTypedImageRun,
  resolveImageSource,
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
  isVisualComponent,
  isTextBoxComponent,
  isStatisticComponent,
  isTableComponent,
  isSectionComponent,
  isListComponent,
  isTocComponent,
  isHighchartsComponent,
  ParagraphComponentDefinition,
  ImageComponentDefinition,
} from '../types';
import { ThemeConfig } from '../styles';
import { createWordStyles } from '../styles/themeToDocxAdapter';
import { resolveFontFamily } from '../styles/utils/styleHelpers';
import { getPageSetup } from '../styles/utils/layoutUtils';
import {
  DocumentMetadata,
  ProcessedDocument,
  createRenderContext,
} from './structure';
import { LayoutPlan, SectionLayout } from './layout';
import {
  renderComponentWithCache,
  initializeComponentCache,
} from './cached-render';
import { MemoryCache } from '../cache';
import type { ServicesConfig } from '@json-to-office/shared';
import {
  renderHeadingComponent,
  renderParagraphComponent,
  renderListComponent,
  renderImageComponent,
  renderTableComponent,
  renderSectionComponent,
  renderColumnsComponent,
  renderStatisticComponent,
  renderTocComponent,
  renderHighchartsComponent,
  renderVisualComponent,
  renderTextBoxComponent,
} from '../components';
import {
  createText,
  createHeaderElement,
  createFooterElement,
} from './content';
import { mapFloatingOptions } from '../utils/docxImagePositioning';
import { globalBookmarkRegistry } from '../utils/bookmarkRegistry';
import { globalNumberingRegistry } from '../utils/numberingConfig';
import { globalRevisionIdRegistry } from '../utils/revisionUtils';
import { globalCommentRegistry } from '../utils/commentRegistry';
import { globalNoteRegistry } from '../utils/noteRegistry';
import {
  runWithGenerationDate,
  runWithBaseDir,
  getBaseDir,
} from '../utils/generationContext';
import { prerasterizeVisuals } from './prerasterizeVisuals';
import { computeSectionOrdinals } from './sectionOrdinals';
import { collectTocHeadings } from './collectTocHeadings';
import { globalSectionBookmarkRegistry } from './sectionBookmarks';

interface RenderDocumentOptions {
  cache?: MemoryCache;
  bypassCache?: boolean;
  services?: ServicesConfig;
  /**
   * Directory that relative asset paths (image `path` props) resolve
   * against. Defaults to `process.cwd()` when absent (#142).
   */
  baseDir?: string;
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

type CorePropertyOptions = Pick<
  IPropertiesOptions,
  | 'title'
  | 'subject'
  | 'creator'
  | 'description'
  | 'keywords'
  | 'lastModifiedBy'
  | 'customProperties'
>;

/**
 * Map root `props.metadata` onto Word's document properties.
 *
 * `date` is deliberately absent: it drives placeholder resolution, not the
 * package timestamps. dcterms:created/modified come from the `generatedAt`
 * generation option (docx always stamps them with the wall clock and offers no
 * override, so packageDocument rewrites them), which is why `metadata` exposes
 * no created/modified of its own.
 * `company` and `version` have no core-property slot, so they land in
 * docProps/custom.xml.
 */
function coreProperties(metadata: DocumentMetadata): CorePropertyOptions {
  const { title, subtitle, description, author, company, version, tags } =
    metadata;

  const customProperties = [
    ...(company ? [{ name: 'Company', value: company }] : []),
    ...(version ? [{ name: 'Version', value: version }] : []),
  ];

  return {
    ...(title && { title }),
    ...(subtitle && { subject: subtitle }),
    ...(description && { description }),
    // Word surfaces both names; author is the only person the document knows.
    ...(author && { creator: author, lastModifiedBy: author }),
    ...(tags && tags.length > 0 && { keywords: tags.join(', ') }),
    ...(customProperties.length > 0 && { customProperties }),
  };
}

/**
 * Render a complete document from structure and layout
 */
export async function renderDocument(
  structure: ProcessedDocument,
  layout: LayoutPlan,
  options?: RenderDocumentOptions
): Promise<Document> {
  return runWithGenerationDate(structure.metadata.date, () =>
    runWithBaseDir(options?.baseDir, () =>
      globalBookmarkRegistry.runScoped(() =>
        globalRevisionIdRegistry.runScoped(() =>
          globalNumberingRegistry.runScoped(() =>
            globalSectionBookmarkRegistry.runScoped(() =>
              // Comment ids are a separate OOXML namespace from w:ins/w:del,
              // but they need the same per-render isolation: outside this nest
              // concurrent generations would interleave counters and an anchor
              // would point at another document's comment body.
              globalCommentRegistry.runScoped(() =>
                // Footnote ids are document-scoped too: a reference resolved
                // against another render's counter points at the wrong body.
                globalNoteRegistry.runScoped(() =>
                  renderDocumentScoped(structure, layout, options)
                )
              )
            )
          )
        )
      )
    )
  );
}

async function renderDocumentScoped(
  structure: ProcessedDocument,
  layout: LayoutPlan,
  options?: RenderDocumentOptions
): Promise<Document> {
  // Initialize component cache if provided
  if (options?.cache) {
    initializeComponentCache(options.cache);
  } else if (!options?.bypassCache) {
    // Initialize with default cache unless bypassed
    initializeComponentCache();
  }

  const sections: ISectionOptions[] = [];

  // Render all layout sections
  const context = createRenderContext(
    structure,
    structure.theme,
    structure.themeName
  );
  context.services = options?.services;

  // Coalesce the document's visual rasterizations into batched service calls
  // before the (strictly sequential) component walk begins (#153). Purely an
  // accelerator: renderVisualComponent falls back to per-visual rasterization
  // for anything the pre-pass missed, so a pre-pass failure can slow a render
  // but never break one.
  try {
    const visualRasterResults = await prerasterizeVisuals(
      layout.sections,
      options?.services?.pptx,
      { baseDir: getBaseDir() }
    );
    if (visualRasterResults.size > 0) {
      context.visualRasterResults = visualRasterResults;
    }
  } catch (error) {
    console.warn(
      '[core-docx] Visual pre-rasterization failed; falling back to per-visual rasterization:',
      error instanceof Error ? error.message : error
    );
  }

  // Collect TOC entries before rendering so a TOC field can carry cached
  // content for readers that never refresh fields (#174). Same
  // catch-and-degrade discipline as the visual pre-pass: a failure here costs
  // the cached entries, never the document.
  try {
    const tocHeadings = collectTocHeadings(layout.sections);
    if (tocHeadings.length > 0) {
      context.tocHeadings = tocHeadings;
    }
  } catch (error) {
    console.warn(
      '[core-docx] TOC entry collection failed; the TOC field will rely on the reader refreshing it:',
      error instanceof Error ? error.message : error
    );
  }

  /**
   * Resolve every layout chunk's bookmark ordinal up front.
   *
   * When a user-defined Section spans multiple layout chunks (a columns
   * transition starts a new one), all chunks must share one bookmark id for
   * TOC scoping to work: start in the first chunk, end in the last, same
   * stable name throughout. The ordinal is a fold over the chunk list, so it
   * lives in its own pure function rather than as a counter carried through
   * this loop's header/footer bookkeeping.
   */
  const sectionOrdinals = computeSectionOrdinals(layout.sections);

  // Track previous section's headers/footers for 'linkToPrevious' functionality
  let previousHeader: ComponentDefinition[] | undefined = undefined;
  let previousFooter: ComponentDefinition[] | undefined = undefined;

  // Render all layout sections
  for (let idx = 0; idx < layout.sections.length; idx++) {
    const layoutSection = layout.sections[idx];
    const { ordinal: sectionOrdinal, closeBookmark } = sectionOrdinals[idx];

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

    const rendered = await renderSection(
      sectionToRender,
      structure.theme,
      structure.themeName,
      context,
      sectionOrdinal,
      closeBookmark,
      options?.bypassCache === true
    );

    if (rendered.children.length > 0) {
      sections.push(rendered);
    }
  }

  // Get all numbering configurations from the registry (already imported above)
  const numberingConfigs = globalNumberingRegistry.getAll();
  // Comment bodies collected while rendering the anchors
  const comments = globalCommentRegistry.getAll();
  // Note bodies collected while rendering their markers
  const footnotes = globalNoteRegistry.getFootnotes();
  const endnotes = globalNoteRegistry.getEndnotes();

  return new Document({
    styles: createWordStyles(structure.theme, structure.language),
    sections,
    ...coreProperties(structure.metadata),
    features: {
      updateFields: true, // Required for TOC fields to update correctly
      // Word opens the document in review mode (further edits are tracked)
      ...(structure.trackRevisions && { trackRevisions: true }),
    },
    // word/comments.xml, emitted only when something was actually commented
    ...(comments.length > 0 && { comments: { children: comments } }),
    // word/footnotes.xml and word/endnotes.xml bodies, keyed by the id their
    // references carry
    ...(Object.keys(footnotes).length > 0 && { footnotes }),
    ...(Object.keys(endnotes).length > 0 && { endnotes }),
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
  themeName: string,
  context: RenderContext
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
      const font = textComp.props.font;

      // Header/footer text has no dedicated style, so unspecified font
      // properties resolve against the theme's Normal style.
      const normalStyle = getNormalStyle(theme);

      // Render through the shared paragraph primitive (same as body
      // paragraphs) so headers/footers honor lineSpacing, spacing
      // (before/after) and the full font set instead of silently dropping
      // them. When the component omits lineSpacing/spacing, createText leaves
      // them unset and the Normal style supplies the baseline.
      elements.push(
        createText(textComp.props.text, theme, themeName, {
          style: 'Normal',
          alignment: textComp.props.alignment,
          // Resolve explicit run styling against the Normal style, preserving
          // prior header/footer rendering for these properties.
          fontFamily:
            font?.family ||
            resolveFontFamily(theme, normalStyle.font) ||
            getThemeFonts(theme).body.family,
          fontSize: (font?.size ?? normalStyle.size ?? 11) as number,
          // Pass the raw color/token; createText resolves it. Fall back to the
          // Normal style color, then the theme's primary text color.
          fontColor: font?.color || normalStyle.color || 'textPrimary',
          bold: font?.bold ?? false,
          italic: font?.italic ?? false,
          underline: font?.underline,
          fontWeight: (font as { fontWeight?: number } | undefined)?.fontWeight,
          boldColor: textComp.props.boldColor,
          spacing: textComp.props.spacing,
          lineSpacing: font?.lineSpacing,
        })
      );
    } else if (isImageComponent(component)) {
      const imageComp = component as ImageComponentDefinition;
      // Get image source (svg, base64, or path)
      let imageSource = resolveImageSource(imageComp.props);
      if (!imageSource) {
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '[IMAGE: Missing path, base64, or svg property]',
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
      let responseContentType: string | undefined;

      try {
        // Try to use the provided source first
        const imageResult = await getImageBuffer(imageSource);
        imageBuffer = imageResult.buffer;
        responseContentType = imageResult.contentType;
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
        const floatingOptions = mapFloatingOptions(
          imageComp.props.floating,
          theme,
          themeName
        );

        const imageType = detectImageType(imageSource, responseContentType);

        const imageRun = createTypedImageRun({
          type: imageType,
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
        // Fallback for missing images - log error for debugging.
        // Use the resolved source (svg/base64/path), truncated so an inline
        // data URI doesn't dump into the log or the placeholder text.
        const sourcePreview = imageSource.substring(0, 50);
        console.error(
          `[Header/Footer Image Error] Failed to render image: ${sourcePreview}...`,
          error instanceof Error ? error.message : error
        );
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[IMAGE: ${sourcePreview}]`,
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
      const tables = await renderTableComponent(component, theme, themeName);
      elements.push(...tables);
    } else if (isVisualComponent(component)) {
      // A visual desugars to an image; needs the rasterization service from context.
      const visualEls = await renderVisualComponent(
        component,
        theme,
        themeName,
        context
      );
      elements.push(...visualEls);
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
  closeBookmark?: boolean,
  bypassCache = false
): Promise<ISectionOptions> {
  const elements: (Paragraph | Table | TableOfContents)[] = [];

  // Update context for this section
  // Generate a unique bookmark for this section so TOCs can scope to it
  const isFirstLayoutOfUserSection = section.isUserSection;
  // Every layout chunk of one user-defined section resolves to the same
  // bookmark; the registry owns the id format for both producers.
  const bookmark =
    section.belongsToUserSection && sectionOrdinal
      ? globalSectionBookmarkRegistry.forLayoutSection(sectionOrdinal)
      : undefined;
  const sharedLinkId = bookmark?.linkId;
  const sectionBookmarkId = bookmark?.id;

  const sectionContext: RenderContext = {
    ...context,
    section: {
      ...context.section,
      currentLayout: section.layoutType,
      columnCount: section.properties.column?.count || 1,
      // Always pass the same bookmark ID for all layout chunks of the same section
      sectionBookmarkId: sectionBookmarkId,
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
      bypassCache
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
    return await renderImageComponent(component, theme, themeName);
  } else if (isTextBoxComponent(component)) {
    return await renderTextBoxComponent(component, theme, themeName, context);
  } else if (isStatisticComponent(component)) {
    return renderStatisticComponent(component, theme);
  } else if (isTableComponent(component)) {
    return await renderTableComponent(component, theme, themeName);
  } else if (isListComponent(component)) {
    return renderListComponent(component, theme, themeName);
  } else if (isTocComponent(component)) {
    return renderTocComponent(component, theme, context);
  } else if (isHighchartsComponent(component)) {
    return await renderHighchartsComponent(
      component,
      theme,
      themeName,
      context
    );
  } else if (isVisualComponent(component)) {
    return await renderVisualComponent(component, theme, themeName, context);
  } else if (isSectionComponent(component)) {
    return await renderSectionComponent(component, theme, themeName, context);
  }

  throw new Error(
    `Unknown component type: ${(component as ComponentDefinition).name}`
  );
}
