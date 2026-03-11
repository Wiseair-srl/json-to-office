/**
 * Component Normalizer - Transforms JSON components where business logic requires it
 *
 * This module ONLY handles transformations that are actually necessary:
 * 1. Columns shorthand notation (columns: 3 → array format)
 * 2. Recursive processing of nested components
 * 3. Gap application for columns
 *
 * All other properties are preserved as-is from TypeBox validation.
 * This prevents information loss and maintains single source of truth.
 */

import {
  ComponentDefinition,
  ReportComponentDefinition,
  SectionComponentDefinition,
  ColumnsComponentDefinition,
  ColumnsProps,
} from '../types';

/**
 * Normalize a component definition and its nested children
 * Preserves all validated properties - only transforms where business logic requires
 */
export function normalizeComponent(
  component: ComponentDefinition
): ComponentDefinition {
  // Handle columns component with shorthand notation
  if (component.name === 'columns') {
    return normalizeColumnsComponent(component as ColumnsComponentDefinition);
  }

  // Handle components with children - recursively normalize
  if ('children' in component && component.children) {
    return {
      ...component, // Preserve ALL properties from validated component
      children: component.children.map(normalizeComponent),
    } as ComponentDefinition;
  }

  // Handle section component with header/footer arrays
  if (component.name === 'section') {
    return normalizeSectionComponent(component as SectionComponentDefinition);
  }

  // All other components: return as-is (already validated by TypeBox)
  return component;
}

/**
 * Normalize columns component
 * Converts shorthand notation and applies gap logic
 */
function normalizeColumnsComponent(
  component: ColumnsComponentDefinition
): ColumnsComponentDefinition {
  const cfg = component.props || ({} as any);

  // Helper: apply top-level gap to all columns except last where not overridden
  const applyTopLevelGap = (
    cols: Array<{ width?: unknown; gap?: unknown }>,
    topGap: unknown
  ) =>
    cols.map((c, i) => {
      const isLast = i === cols.length - 1;
      if (!isLast && c.gap === undefined && topGap !== undefined) {
        return { ...c, gap: topGap };
      }
      return c;
    });

  // Helper: normalize 'auto' to unspecified width (internal layout splits remainder)
  const normalizeAutoWidth = (
    cols: Array<{ width?: unknown; gap?: unknown }>
  ) =>
    cols.map((c) => ({
      ...c,
      width: c.width === 'auto' ? undefined : c.width,
    }));

  let columnsArray: Array<{ width?: unknown; gap?: unknown }>;

  if (typeof cfg.columns === 'number' && cfg.columns > 0) {
    // Shorthand: N equal-width columns; apply gap after each except last
    const n = cfg.columns as number;
    const base = Array.from(
      { length: n },
      () => ({}) as { width?: unknown; gap?: unknown }
    );
    const topLevelGap = cfg.gap !== undefined ? cfg.gap : '5%';
    columnsArray = applyTopLevelGap(base, topLevelGap);
  } else if (Array.isArray(cfg.columns)) {
    // Array form; honor per-column config
    columnsArray = cfg.columns as Array<{ width?: unknown; gap?: unknown }>;
    // Apply top-level gap unless column overrides; skip last column
    const topLevelGap = cfg.gap !== undefined ? cfg.gap : '5%';
    columnsArray = applyTopLevelGap(columnsArray, topLevelGap);
    // Normalize 'auto' widths to unspecified so layout can allocate remainder
    columnsArray = normalizeAutoWidth(columnsArray);
  } else {
    // Minimal valid shape
    columnsArray = [{}];
  }

  const normalizedProps: ColumnsProps = {
    columns: columnsArray,
  } as ColumnsProps;

  return {
    ...component, // Preserve any additional properties
    name: 'columns',
    props: normalizedProps,
    children: component.children
      ? component.children.map(normalizeComponent)
      : undefined,
  };
}

/**
 * Normalize section component
 * Handles recursive processing of header/footer component arrays
 */
function normalizeSectionComponent(
  component: SectionComponentDefinition
): SectionComponentDefinition {
  const props = component.props || ({} as any);

  return {
    ...component, // Preserve ALL properties
    props: {
      ...props, // Preserve ALL props properties
      header: props.header
        ? props.header === 'linkToPrevious'
          ? 'linkToPrevious'
          : props.header.map((m: ComponentDefinition) => normalizeComponent(m))
        : undefined,
      footer: props.footer
        ? props.footer === 'linkToPrevious'
          ? 'linkToPrevious'
          : props.footer.map((m: ComponentDefinition) => normalizeComponent(m))
        : undefined,
    },
    children: component.children
      ? component.children.map(normalizeComponent)
      : undefined,
  };
}

/**
 * Normalize entire document (top-level report component)
 * Returns as single-element tuple for backward compatibility
 */
export function normalizeDocument(
  document: ComponentDefinition | ReportComponentDefinition
): [ReportComponentDefinition] {
  // Validate it's a report component
  if (document.name !== 'docx') {
    throw new Error(
      'Top-level document must be a docx component with name="docx"'
    );
  }

  const normalized = normalizeComponent(document) as ReportComponentDefinition;
  return [normalized];
}

/**
 * Validate component structure (container vs content components)
 */
export function validateComponentStructure(component: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Components that can have children
  const containerComponents = ['docx', 'section', 'columns', 'text-box'];

  // Check if content components have children (they shouldn't)
  if (
    !containerComponents.includes(component.name) &&
    component.children &&
    component.children.length > 0
  ) {
    errors.push(
      `Component name "${component.name}" cannot have child components`
    );
  }

  // Recursively validate child components
  if (component.children) {
    component.children.forEach(
      (childComponent: ComponentDefinition, index: number) => {
        const childResult = validateComponentStructure(childComponent);
        if (!childResult.valid) {
          errors.push(
            ...childResult.errors.map(
              (error) => `Component[${index}]: ${error}`
            )
          );
        }
      }
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
