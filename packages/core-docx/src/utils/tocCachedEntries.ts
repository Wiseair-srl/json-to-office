/**
 * TOC cached-entries pre-pass.
 *
 * Walks the flattened ProcessedSection[] tree, and for every TOC component
 * found, computes the list of heading entries that would appear in that TOC
 * under its scope/depth/styles configuration, then attaches the result as a
 * private `__resolvedCachedEntries` field on the component for the renderer
 * to consume.
 *
 * Why: docx's `TableOfContents` accepts a `cachedEntries` body that Word
 * displays immediately on open. Without it, Word shows either a
 * "right-click to update field" placeholder or pops up the "update fields?"
 * dialog. Computing the entries up-front sidesteps both UX failures
 * without asking the JSON author to maintain a TOC index by hand.
 *
 * Limitations:
 * - Page numbers are not estimated (Word fills them on field update).
 * - Hyperlink targets (`href`) are not populated yet — that would require
 *   coordinating bookmark IDs across the pre-pass and the heading renderer.
 */

import type { ProcessedSection } from '../core/structure';
import type {
  ComponentDefinition,
  HeadingComponentDefinition,
  TocComponentDefinition,
} from '../types';
import {
  isHeadingComponent,
  isTocComponent,
  isColumnsComponent,
  isTextBoxComponent,
} from '../types';
import type { ThemeConfig } from '../styles';

export interface ResolvedTocEntry {
  title: string;
  level: number;
}

/**
 * Internal field name used to carry resolved cached entries from this
 * pre-pass to the TOC renderer. Private — not part of the public schema.
 */
export const RESOLVED_TOC_ENTRIES_FIELD = '__resolvedCachedEntries';

/**
 * Mutate the section list in place: every TOC component gets its computed
 * cached entries attached. Safe to call after extractSections.
 */
export function injectTocCachedEntries(
  sections: ProcessedSection[],
  theme: ThemeConfig
): void {
  for (const section of sections) {
    walkAttachTocEntries(section, sections, theme);
  }
}

function walkAttachTocEntries(
  section: ProcessedSection,
  allSections: ProcessedSection[],
  theme: ThemeConfig
): void {
  visitComponents(section.components, (comp) => {
    if (!isTocComponent(comp)) return;
    const toc = comp as TocComponentDefinition;
    const scope = resolveEffectiveScope(toc, section);

    const sourceComponents =
      scope === 'section'
        ? section.components
        : allSections.flatMap((s) => s.components);

    const headings = collectHeadings(sourceComponents);
    const entries = filterAndMap(headings, toc, theme, section, scope);

    (toc as unknown as Record<string, unknown>)[RESOLVED_TOC_ENTRIES_FIELD] =
      entries;
  });
}

/**
 * Recursively visit every component in a flat list, descending into
 * container components (columns, text-box) that may host headings inline.
 * Section components don't appear here — extractSections already flattened
 * them into headings.
 */
function visitComponents(
  components: ComponentDefinition[],
  visitor: (component: ComponentDefinition) => void
): void {
  for (const component of components) {
    visitor(component);
    if (isColumnsComponent(component) && component.children) {
      visitComponents(component.children, visitor);
    } else if (isTextBoxComponent(component) && component.children) {
      visitComponents(component.children, visitor);
    }
  }
}

/**
 * Flat list of every heading reachable from `components`, in document
 * order. Walks into columns/text-boxes the same way the renderer does.
 */
function collectHeadings(
  components: ComponentDefinition[]
): HeadingComponentDefinition[] {
  const headings: HeadingComponentDefinition[] = [];
  visitComponents(components, (comp) => {
    if (isHeadingComponent(comp)) {
      headings.push(comp as HeadingComponentDefinition);
    }
  });
  return headings;
}

function resolveEffectiveScope(
  toc: TocComponentDefinition,
  section: ProcessedSection
): 'document' | 'section' {
  const requested = toc.props.scope ?? 'auto';
  if (requested === 'document') return 'document';
  if (requested === 'section') return 'section';
  // auto: section if inside an explicit Section, else document. Matches the
  // runtime detection in renderTocComponent.
  return section.isExplicitSection ? 'section' : 'document';
}

function filterAndMap(
  headings: HeadingComponentDefinition[],
  toc: TocComponentDefinition,
  theme: ThemeConfig,
  section: ProcessedSection,
  scope: 'document' | 'section'
): ResolvedTocEntry[] {
  // Depth window — mirrors parseDepthRange defaults in renderTocComponent.
  const fromLevel = toc.props.depth?.from ?? 1;
  const toLevel = toc.props.depth?.to ?? 3;

  // For section-scoped TOCs, skip headings at or above the section title
  // level. The section title is itself a synthetic heading inserted by
  // extractSections and would self-include otherwise.
  const sectionTitleLevel = scope === 'section' ? section.level : undefined;
  const effectiveFrom =
    sectionTitleLevel !== undefined
      ? Math.max(fromLevel, sectionTitleLevel + 1)
      : fromLevel;

  // Custom-style mappings (theme styles → TOC level). When set, headings
  // matching a custom themeStyle also count, at the mapped level. The
  // built-in `level` field always wins for heading components.
  const customStyleLevels = new Map<string, number>();
  if (toc.props.styles) {
    for (const mapping of toc.props.styles) {
      customStyleLevels.set(mapping.styleId, mapping.level);
    }
  }

  const entries: ResolvedTocEntry[] = [];
  for (const heading of headings) {
    const builtinLevel = heading.props.level ?? 1;
    // If this heading uses a custom theme style mapped in styles[], honor
    // that mapping; otherwise use the explicit heading level.
    const themeStyle = (heading.props as Record<string, unknown>).themeStyle as
      | string
      | undefined;
    const customLevel =
      themeStyle && customStyleLevels.has(themeStyle)
        ? customStyleLevels.get(themeStyle)!
        : undefined;
    const level = customLevel ?? builtinLevel;

    if (level < effectiveFrom || level > toLevel) continue;

    const title = (heading.props.text ?? '').trim();
    if (!title) continue;

    entries.push({ title, level });
  }

  // Mark theme as touched — silences lint warning while leaving the
  // parameter wired for future custom-style theme resolution.
  void theme;

  return entries;
}
