/**
 * Document Structure Functions
 * Handle document hierarchy and organization without layout concerns
 */

import {
  ComponentDefinition,
  ReportProps,
  ReportComponentDefinition,
  RenderContext,
  isSectionComponent,
  isColumnsComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { formatDate } from '../utils/formatters';
import { resolveComponentTree } from '../styles/utils/resolveComponentTree';
import { mergeWithDefaults } from '../styles/utils/componentDefaults';

export interface ProcessedDocument {
  metadata: DocumentMetadata;
  sections: ProcessedSection[];
  theme: ThemeConfig;
  themeName: string;
  /** Open the generated document in track-changes mode */
  trackRevisions?: boolean;
  /** Default document language (BCP-47) applied to docDefaults proofing */
  language?: string;
}

export interface DocumentMetadata {
  title?: string;
  subtitle?: string;
  description?: string;
  author?: string;
  company?: string;
  version?: string;
  tags?: string[];
  date: Date;
}

export interface ProcessedSection {
  components: ComponentDefinition[];
  header?: ComponentDefinition[] | 'linkToPrevious';
  footer?: ComponentDefinition[] | 'linkToPrevious';
  /** True if this section originates from an explicit Section component */
  isExplicitSection?: boolean;
  /** Whether this section should start on a new page */
  pageBreak?: boolean;
  /** Page configuration override for this section */
  page?: {
    size?: 'A4' | 'A3' | 'LETTER' | 'LEGAL' | { width: number; height: number };
    margins?: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
      header?: number;
      footer?: number;
      gutter?: number;
    };
  };
}

export interface ResolvedDocumentTree {
  theme: ThemeConfig;
  children: ComponentDefinition[];
}

/**
 * Apply document-level defaults to the theme and component tree.
 *
 * Kept synchronous and renderer-free so preflight checks can inspect exactly
 * the props structure processing will render.
 */
export function resolveDocumentTree(
  document: ReportComponentDefinition,
  theme: ThemeConfig
): ResolvedDocumentTree {
  const docDefaults = document.props.componentDefaults;
  const mergedComponentDefaults = docDefaults
    ? mergeWithDefaults(docDefaults, theme.componentDefaults || {})
    : undefined;

  const docNoProofWords = document.props.noProofWords;
  const mergedNoProofWords =
    docNoProofWords || theme.noProofWords
      ? Array.from(
          new Set([...(theme.noProofWords || []), ...(docNoProofWords || [])])
        )
      : undefined;

  const effectiveTheme =
    mergedComponentDefaults || mergedNoProofWords
      ? {
          ...theme,
          ...(mergedComponentDefaults && {
            componentDefaults: mergedComponentDefaults,
          }),
          ...(mergedNoProofWords && { noProofWords: mergedNoProofWords }),
        }
      : theme;

  return {
    theme: effectiveTheme,
    children: resolveComponentTree(document.children || [], effectiveTheme),
  };
}

/**
 * Process document definition into structured format
 */
export async function processDocument(
  document: ReportComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  generationDate?: Date
): Promise<ProcessedDocument> {
  const resolved = resolveDocumentTree(document, theme);
  return processResolvedDocument(document, resolved, themeName, generationDate);
}

/** Process a tree whose effective theme/default cascade is already resolved. */
export async function processResolvedDocument(
  document: ReportComponentDefinition,
  resolved: ResolvedDocumentTree,
  themeName: string,
  generationDate?: Date
): Promise<ProcessedDocument> {
  const metadata = createDocumentMetadata(document.props, generationDate);
  const effectiveTheme = resolved.theme;

  // Create context with effective theme so section-title headings
  // created in extractSections also see document-level defaults
  const context = createRenderContext(
    {
      metadata,
      sections: [],
      theme: effectiveTheme,
      themeName,
    },
    effectiveTheme,
    themeName
  );

  // Resolve componentDefaults on every component before
  // extractSections reads any props (fixes section pageBreak, table defaults, etc.)
  // Extract sections from components
  const sections = await extractSections(resolved.children, context);

  return {
    metadata,
    sections,
    theme: effectiveTheme,
    themeName,
    trackRevisions: document.props.trackRevisions,
    language: document.props.language,
  };
}

/**
 * Extract document metadata from report props
 */
export function createDocumentMetadata(
  props: ReportProps,
  generationDate = new Date()
): DocumentMetadata {
  // `metadata.date` is a display date first: a value Date cannot parse — a
  // scaffold marker, "Q3 2026" — keeps its text for the page and leaves the
  // package timestamps to the generation date, instead of failing the build.
  const parsed = props.metadata?.date
    ? new Date(props.metadata.date)
    : undefined;
  return {
    title: props.metadata?.title,
    subtitle: props.metadata?.subtitle,
    description: props.metadata?.description,
    author: props.metadata?.author,
    company: props.metadata?.company,
    version: props.metadata?.version,
    tags: props.metadata?.tags,
    date: parsed && !Number.isNaN(parsed.getTime()) ? parsed : generationDate,
  };
}

/**
 * Extract and flatten sections from component hierarchy
 */
export async function extractSections(
  components: ComponentDefinition[],
  context: RenderContext
): Promise<ProcessedSection[]> {
  const sections: ProcessedSection[] = [];

  // Filter out components with enabled: false (defaults to true when not specified)
  const activeComponents = components.filter(
    (m) => !('enabled' in m && m.enabled === false)
  );

  for (const component of activeComponents) {
    if (isSectionComponent(component)) {
      const sectionComponents = await flattenComponents(
        component.children || [],
        context
      );

      // Determine if page break should be applied (default to true)
      const shouldPageBreak = component.props?.pageBreak !== false;

      sections.push({
        components: sectionComponents,
        header: component.props?.header,
        footer: component.props?.footer,
        isExplicitSection: true,
        // Page break is handled at layout level (sections render no title of
        // their own — a visible title is an explicit heading child; the
        // authoring label lives in props.meta.title and is never rendered)
        pageBreak: shouldPageBreak,
        // Preserve page configuration override if present
        page: component.props?.page,
      });
    } else {
      // Non-section components at root level become their own section
      sections.push({
        components: [component],
        isExplicitSection: false,
      });
    }
  }

  return sections;
}

/**
 * Flatten nested container components while preserving content components
 */
export async function flattenComponents(
  components: ComponentDefinition[],
  context: RenderContext
): Promise<ComponentDefinition[]> {
  const flattened: ComponentDefinition[] = [];

  // Filter out components with enabled: false (defaults to true when not specified)
  const activeComponents = components.filter(
    (m) => !('enabled' in m && m.enabled === false)
  );

  for (const component of activeComponents) {
    if (isColumnsComponent(component) && component.children) {
      // Preserve columns structure but flatten its contents
      flattened.push({
        ...component,
        children: await flattenComponents(component.children, context),
      });
    } else if (isSectionComponent(component) && component.children) {
      // Flatten nested sections (their meta is authoring-only, nothing renders)
      flattened.push(...(await flattenComponents(component.children, context)));
    } else {
      // Keep content components as-is
      flattened.push(component);
    }
  }

  return flattened;
}

/**
 * Create render context from processed document
 */
export function createRenderContext(
  document: ProcessedDocument,
  theme: ThemeConfig,
  themeName: string
): RenderContext {
  return {
    theme: {
      name: themeName,
      colors: theme.colors || {},
      fonts: theme.fonts
        ? Object.fromEntries(
            Object.entries(theme.fonts).map(([key, font]) => [key, font.family])
          )
        : {},
      spacing: { small: 120, medium: 240, large: 360, section: 480 },
    },
    fullTheme: theme,
    document: document.metadata,
    section: {
      currentLayout: 'single',
      columnCount: 1,
      pageNumber: 1,
    },
    utils: {
      formatDate: (date: Date) => formatDate(date),
      parseText: (text: string) => [{ text }],
      getStyle: (name: string) => ({ name }),
    },
    depth: 0,
  };
}
