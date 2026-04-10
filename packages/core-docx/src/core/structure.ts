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
import {
  resolveComponentTree,
  resolveComponentDefaults,
} from '../styles/utils/resolveComponentTree';
import { mergeWithDefaults } from '../styles/utils/componentDefaults';

export interface ProcessedDocument {
  metadata: DocumentMetadata;
  sections: ProcessedSection[];
  theme: ThemeConfig;
  themeName: string;
}

export interface DocumentMetadata {
  title?: string;
  subtitle?: string;
  author?: string;
  company?: string;
  date: Date;
}

export interface ProcessedSection {
  title?: string;
  level?: number;
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

/**
 * Process document definition into structured format
 */
export async function processDocument(
  document: ReportComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Promise<ProcessedDocument> {
  const metadata = createDocumentMetadata(document.props);

  // Merge document-level componentDefaults on top of theme-level ones
  // (document overrides theme)
  const docDefaults = document.props.componentDefaults;
  const effectiveTheme = docDefaults
    ? {
        ...theme,
        componentDefaults: mergeWithDefaults(
          docDefaults,
          theme.componentDefaults || {}
        ),
      }
    : theme;

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
  const resolvedChildren = resolveComponentTree(
    document.children || [],
    effectiveTheme
  );

  // Extract sections from components
  const sections = await extractSections(resolvedChildren, context);

  return {
    metadata,
    sections,
    theme: effectiveTheme,
    themeName,
  };
}

/**
 * Extract document metadata from report props
 */
export function createDocumentMetadata(props: ReportProps): DocumentMetadata {
  return {
    title: props.metadata?.title,
    subtitle: props.metadata?.subtitle,
    author: props.metadata?.author,
    company: props.metadata?.company,
    date: props.metadata?.date ? new Date(props.metadata.date) : new Date(),
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

      // Add section title as heading component if present
      if (component.props?.title) {
        // Ensure level is within valid range (1-6) for heading component
        const headingLevel = Math.min(
          Math.max(component.props.level || 1, 1),
          6
        ) as 1 | 2 | 3 | 4 | 5 | 6;

        sectionComponents.unshift(
          resolveComponentDefaults(
            {
              name: 'heading',
              props: {
                text: component.props.title,
                level: headingLevel,
                pageBreak: shouldPageBreak,
                // Apply zero-spacing to prevent unwanted initial line
                spacing: {
                  before: 0,
                  after: 0,
                },
              },
            },
            context.fullTheme
          )
        );
      }

      sections.push({
        title: component.props?.title,
        level: component.props?.level,
        components: sectionComponents,
        header: component.props?.header,
        footer: component.props?.footer,
        isExplicitSection: true,
        // Store pageBreak for titleless sections to be handled at layout level
        pageBreak: !component.props?.title ? shouldPageBreak : undefined,
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
      // Flatten nested sections
      if (component.props?.title) {
        // Ensure level is within valid range (1-6) for heading component
        const headingLevel = Math.min(
          Math.max(component.props.level || 1, 1),
          6
        ) as 1 | 2 | 3 | 4 | 5 | 6;

        // Convert section title to heading
        flattened.push(
          resolveComponentDefaults(
            {
              name: 'heading',
              props: {
                text: component.props.title,
                level: headingLevel,
                // Apply zero-spacing to prevent unwanted initial line
                spacing: {
                  before: 0,
                  after: 0,
                },
              },
            },
            context.fullTheme
          )
        );
      }
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
