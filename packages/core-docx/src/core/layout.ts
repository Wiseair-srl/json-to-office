/**
 * Layout Functions
 * Handle all layout concerns including columns, breaks, and section properties
 */

import { SectionType, Column as DocxColumn } from 'docx';
import {
  ComponentDefinition,
  ColumnSettings,
  isColumnsComponent,
  isSectionComponent,
  isHeadingComponent,
  isParagraphComponent,
  isTocComponent,
} from '../types';
import { ThemeConfig } from '../styles';
import { getPageSetup } from '../styles';
// import { pointsToTwips } from '../styles/utils/styleHelpers';
import { ProcessedSection } from './structure';
import {
  getAvailableWidthTwips,
  relativeLengthToTwips,
} from '../utils/widthUtils';

export interface LayoutPlan {
  sections: SectionLayout[];
}

export interface WordSectionProperties {
  page: {
    size: {
      width: number;
      height: number;
    };
    margin: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  column: ColumnSettings & { children?: DocxColumn[] };
  type?: (typeof SectionType)[keyof typeof SectionType];
}

export interface SectionLayout {
  properties: WordSectionProperties;
  components: ComponentDefinition[];
  layoutType: 'single' | 'multi-column';
  breakBefore: boolean;
  header?: ComponentDefinition[] | 'linkToPrevious';
  footer?: ComponentDefinition[] | 'linkToPrevious';
  /** True if this layout section comes from a user-defined Section component */
  isUserSection: boolean;
  /** True if this layout chunk belongs to a user-defined Section (all chunks of that section) */
  belongsToUserSection: boolean;
  /** The heading level of the section title (e.g., 1 for Heading1) - used by TOCs to exclude section title from section-scoped TOCs */
  sectionTitleLevel?: number;
  /** Page configuration override for this section */
  pageOverride?: {
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

export interface LayoutGroup {
  layout: 'single' | 'multi-column';
  components: ComponentDefinition[];
  breakBefore: boolean;
}

/**
 * Apply layout to processed sections
 */
export function applyLayout(
  sections: ProcessedSection[],
  theme: ThemeConfig,
  themeName: string
): LayoutPlan {
  const layoutSections: SectionLayout[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const layoutGroups = analyzeLayoutGroups(section.components);

    // Determine if this comes from an explicit Section component
    const isSourceUserSection = Boolean(section.isExplicitSection);

    // Handle sections with no components but with headers/footers
    // This ensures headers/footers are rendered even for empty sections
    if (layoutGroups.length === 0 && (section.header || section.footer)) {
      const isFirstSection = i === 0;
      const breakBefore = isFirstSection || Boolean(section.pageBreak);
      const sectionType = breakBefore ? 'nextPage' : 'continuous';

      layoutSections.push({
        properties: createSectionProperties(
          getColumnSettings('single'),
          theme,
          themeName,
          sectionType,
          section.page
        ),
        components: [],
        layoutType: 'single',
        breakBefore,
        header: section.header,
        footer: section.footer,
        isUserSection: isSourceUserSection,
        belongsToUserSection: isSourceUserSection,
        sectionTitleLevel: section.level,
        pageOverride: section.page,
      });
      continue;
    }

    for (let j = 0; j < layoutGroups.length; j++) {
      const group = layoutGroups[j];

      // Special handling: a single Columns component becomes its own section with explicit column children
      const isSingleColumnsGroup =
        group.components.length === 1 && isColumnsComponent(group.components[0]);

      const columnSettings = isSingleColumnsGroup
        ? createColumnSettingsFromConfig(group.components[0], theme, themeName)
        : getColumnSettings(group.layout);

      // Only break page if explicitly requested or this is the first section
      const isFirstSection = i === 0 && j === 0;
      // For titleless sections with pageBreak, apply break to first layout group
      const titlelessSectionBreak = Boolean(section.pageBreak && j === 0);
      const breakBefore =
        group.breakBefore || isFirstSection || titlelessSectionBreak;
      const sectionType = breakBefore ? 'nextPage' : 'continuous';

      // Build content components depending on whether this is an explicit columns group
      const contentComponents = isSingleColumnsGroup
        ? processLayoutComponents(
          (group.components[0] as unknown as { children?: ComponentDefinition[] })
            .children || []
        )
        : processLayoutComponents(group.components);

      layoutSections.push({
        properties: createSectionProperties(
          columnSettings,
          theme,
          themeName,
          sectionType,
          section.page
        ),
        components: contentComponents,
        layoutType: group.layout,
        breakBefore,
        header: section.header,
        footer: section.footer,
        // Only mark the FIRST layout section as user-defined to avoid
        // creating bookmark paragraphs in subsequent sections (e.g., when
        // transitioning to columns layout). This prevents unwanted newlines
        // at the start of column content.
        isUserSection: isSourceUserSection && j === 0,
        belongsToUserSection: isSourceUserSection,
        // Pass section title level for TOC scoping
        sectionTitleLevel: section.level,
        // Pass page override for this section
        pageOverride: section.page,
      });
    }
  }

  return { sections: layoutSections };
}

/**
 * Analyze components to determine layout groups
 */
export function analyzeLayoutGroups(
  components: ComponentDefinition[]
): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  let currentLayout: 'single' | 'multi-column' = 'single';
  let currentComponents: ComponentDefinition[] = [];
  let breakNext = false;

  for (const component of components) {
    // Always isolate explicit Columns components into their own group
    if (isColumnsComponent(component)) {
      if (currentComponents.length > 0) {
        groups.push({
          layout: currentLayout,
          components: currentComponents,
          breakBefore: breakNext,
        });
        currentComponents = [];
        breakNext = false;
      }
      // Determine the actual layout based on the columns component configuration
      const columnsLayout = determineComponentLayout(component);
      groups.push({
        layout: columnsLayout,
        components: [component],
        breakBefore: breakNext,
      });
      breakNext = false;
      continue;
    }

    const componentLayout = determineComponentLayout(component);

    // Check for explicit break indicators
    if (hasPageBreak(component)) {
      if (currentComponents.length > 0) {
        // Finish previous group without break
        groups.push({
          layout: currentLayout,
          components: currentComponents,
          breakBefore: breakNext,
        });
        currentComponents = [];
        breakNext = false;
      }
      // Start new group with break for this component
      currentComponents = [component];
      breakNext = true;
      continue;
    }

    // Layout change requires new group
    if (componentLayout !== currentLayout && currentComponents.length > 0) {
      groups.push({
        layout: currentLayout,
        components: currentComponents,
        breakBefore: breakNext,
      });
      currentLayout = componentLayout;
      currentComponents = [component];
      breakNext = false;
    } else {
      currentComponents.push(component);
    }
  }

  // Add remaining components
  if (currentComponents.length > 0) {
    groups.push({
      layout: currentLayout,
      components: currentComponents,
      breakBefore: breakNext,
    });
  }

  return groups;
}

/**
 * Determine layout type for a component
 */
export function determineComponentLayout(
  component: ComponentDefinition
): 'single' | 'multi-column' {
  if (isColumnsComponent(component)) {
    const columns = (component as any).props?.columns;

    // If columns is an array with specific configurations
    if (Array.isArray(columns)) {
      // Any columns array with 2+ items is multi-column
      return columns.length >= 2 ? 'multi-column' : 'single';
    }

    // No valid array provided; treat as single-column
    return 'single';
  }

  // Check if component contains children
  if ('children' in component && (component as any).children) {
    const hasColumns = (component as any).children.some((child: ComponentDefinition) =>
      isColumnsComponent(child)
    );
    return hasColumns ? 'multi-column' : 'single';
  }

  return 'single';
}

/**
 * Process components for layout (insert breaks where needed)
 */
export function processLayoutComponents(
  components: ComponentDefinition[]
): ComponentDefinition[] {
  const processed: ComponentDefinition[] = [];

  for (let i = 0; i < components.length; i++) {
    const component = components[i];

    // Check if this component should have a column break
    if (shouldInsertColumnBreak()) {
      // Create a new component with columnBreak flag
      if (isHeadingComponent(component)) {
        processed.push({
          ...component,
          props: {
            ...((component as any).props || {}),
            columnBreak: true,
          },
        } as ComponentDefinition);
      } else {
        processed.push(component);
      }
    } else {
      processed.push(component);
    }
  }

  return processed;
}

/**
 * Determine if a column break should be inserted
 */
function shouldInsertColumnBreak(): boolean {
  // Logic to determine column breaks based on content distribution
  // This is simplified - could be enhanced with more sophisticated logic
  return false;
}

/**
 * Check if component indicates a page break
 */
function hasPageBreak(component: ComponentDefinition): boolean {
  if (isSectionComponent(component)) {
    // Default to true for section components when pageBreak is undefined
    return component.props?.pageBreak !== false;
  }
  if (isHeadingComponent(component)) {
    return component.props.pageBreak === true;
  }
  if (isParagraphComponent(component)) {
    return component.props.pageBreak === true;
  }
  // Allow TOC components to request a page break as well
  if (isTocComponent(component)) {
    return component.props?.pageBreak === true;
  }
  return false;
}

/**
 * Get column settings for layout type
 */
export function getColumnSettings(
  layout: 'single' | 'multi-column'
): ColumnSettings {
  switch (layout) {
  case 'multi-column':
    // Default multi-column layout: 2 equal-width columns
    // Note: Specific column components will override this with their own settings via createColumnSettingsFromConfig
    return {
      count: 2,
      equalWidth: true,
      space: 720, // 0.5 inch in twips
    };
  case 'single':
  default:
    return { count: 1 };
  }
}

/**
 * Create Word section properties
 */
export function createSectionProperties(
  columnSettings: ColumnSettings,
  theme: ThemeConfig,
  themeName: string,
  sectionType?: 'continuous' | 'nextPage',
  pageOverride?: {
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
  }
): WordSectionProperties {
  // Get base page setup from theme
  const basePageSetup = getPageSetup(theme, themeName);

  // Apply section-level page overrides if present
  const pageSetup = pageOverride
    ? {
      size: {
        ...basePageSetup.size,
        ...(pageOverride.size && typeof pageOverride.size === 'object'
          ? pageOverride.size
          : pageOverride.size
            ? (() => {
              // Convert string size to dimensions
              const sizes = {
                A4: { width: 11906, height: 16838 },
                A3: { width: 16838, height: 23811 },
                LETTER: { width: 12240, height: 15840 },
                LEGAL: { width: 12240, height: 20160 },
              };
              return sizes[pageOverride.size as keyof typeof sizes];
            })()
            : {}),
      },
      margin: {
        ...basePageSetup.margin,
        ...(pageOverride.margins || {}),
      },
    }
    : basePageSetup;

  const properties: WordSectionProperties = {
    page: pageSetup,
    column: {
      count: columnSettings.count,
      equalWidth: columnSettings.equalWidth,
      space: columnSettings.space,
    },
  };

  // If explicit children were provided, convert to docx Column instances
  if (
    (columnSettings as any).children &&
    Array.isArray((columnSettings as any).children)
  ) {
    const children = (columnSettings as any).children as {
      width?: number;
      space?: number;
    }[];
    // When we have explicit column children, ensure equalWidth is explicitly false
    // so Word doesn't override widths with equal distribution.
    properties.column.equalWidth = false;
    // Also remove top-level space to avoid conflicting with per-column spaces
    delete properties.column.space;

    properties.column.children = children.map(
      (c) =>
        new DocxColumn({
          width: c.width as number,
          ...(c.space !== undefined ? { space: c.space } : {}),
        })
    );
  }

  if (sectionType) {
    properties.type =
      sectionType === 'continuous'
        ? SectionType.CONTINUOUS
        : SectionType.NEXT_PAGE;
  }

  return properties;
}

/**
 * Create explicit column settings from a Columns component props
 * - width/gap accept number (points) or percentage string relative to available width
 */
function createColumnSettingsFromConfig(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): ColumnSettings {
  const cfg = ((component as any).props || {}) as {
    columns?: Array<{ width?: number | string; gap?: number | string }>;
  };

  // Fallback to single column if no valid array is provided
  const columns = (cfg.columns || []) as Array<{
    width?: number | string;
    gap?: number | string;
  }>;

  if (!Array.isArray(columns) || columns.length === 0) {
    return { count: 1 };
  }

  const availableWidthTwips = getAvailableWidthTwips(theme, themeName);

  // First pass: compute defined widths/spaces; collect indexes without width
  const childSettings: { width?: number; space?: number }[] = [];
  let totalDefinedWidth = 0;
  let totalSpace = 0;
  const unspecifiedWidthIndexes: number[] = [];

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const child: { width?: number; space?: number } = {};

    if (c.width !== undefined) {
      const widthTwips = relativeLengthToTwips(c.width, availableWidthTwips);
      if (widthTwips > 0) {
        child.width = widthTwips;
        totalDefinedWidth += widthTwips;
      }
    } else {
      unspecifiedWidthIndexes.push(i);
    }

    if (c.gap !== undefined) {
      const spaceTwips = relativeLengthToTwips(c.gap, availableWidthTwips);
      if (spaceTwips > 0) {
        child.space = spaceTwips;
        totalSpace += spaceTwips;
      }
    }

    childSettings.push(child);
  }

  // Validate that defined widths + gaps do not exceed available width (with tolerance)
  const totalUsedTwips = totalDefinedWidth + totalSpace;
  const tolerance = 0.005; // 0.5%
  const allowed = availableWidthTwips * (1 + tolerance);
  if (totalUsedTwips > allowed) {
    const usedPercent = (totalUsedTwips / availableWidthTwips) * 100;
    // Build diagnostics per column
    const details = childSettings
      .map((c, idx) => {
        const wPct = c.width
          ? ((c.width / availableWidthTwips) * 100).toFixed(1) + '%'
          : 'auto/unspecified';
        const gPct = c.space
          ? ((c.space / availableWidthTwips) * 100).toFixed(1) + '%'
          : '0%';
        return `  - Column ${idx + 1}: width=${wPct}, gap=${gPct}`;
      })
      .join('\n');
    const suggestion =
      'Reduce one or more widths/gaps so total <= 100%, remove the last gap, or set some widths to "auto" to consume remaining space.';
    throw new Error(
      `Columns configuration exceeds available width: widths + gaps = ${usedPercent.toFixed(1)}% (> 100% + ${(
        tolerance * 100
      ).toFixed(
        1
      )}% tolerance)\nDetails:\n${details}\nSuggestion: ${suggestion}`
    );
  }

  // Distribute remaining width equally among unspecified widths
  const remaining = Math.max(
    0,
    availableWidthTwips - totalSpace - totalDefinedWidth
  );
  if (unspecifiedWidthIndexes.length > 0) {
    const each = Math.floor(remaining / unspecifiedWidthIndexes.length);
    for (const idx of unspecifiedWidthIndexes) {
      childSettings[idx].width = each;
    }
  }

  return {
    count: columns.length,
    equalWidth: false,
    children: childSettings,
  };
}

/**
 * Calculate optimal column distribution for content
 */
export function calculateColumnDistribution(
  components: ComponentDefinition[],
  columnCount: number
): ComponentDefinition[][] {
  if (columnCount === 1) {
    return [components];
  }

  // Simple distribution - could be enhanced with content-aware logic
  const columns: ComponentDefinition[][] = Array(columnCount)
    .fill(null)
    .map(() => []);
  let currentColumn = 0;

  for (const component of components) {
    columns[currentColumn].push(component);
    currentColumn = (currentColumn + 1) % columnCount;
  }

  return columns;
}
