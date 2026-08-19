/**
 * collectTocHeadings — per-document TOC entry pre-pass (#174).
 *
 * `updateFields: true` asks Word to repopulate every TOC field on open, and
 * Word obliges. Headless LibreOffice does not, so a TOC field with no cached
 * content exports to PDF as the bare word "Contents" — and the rasterizer path
 * goes through soffice. Collecting the entries up front lets the renderer pass
 * them to docx as `cachedEntries`, which writes real paragraphs between the
 * field's `separate` and `end` characters.
 *
 * Modelled on `prerasterizeVisuals`: a pure collection pass over the layout,
 * seeded into the render context, consulted by the component that needs it.
 * Over-collection shows a stale entry until the reader refreshes the field;
 * under-collection degrades to today's empty TOC. Neither breaks a render.
 *
 * What the walk must and must not reach:
 * - **Headers and footers are excluded by construction.** They are fields on
 *   `SectionLayout`, not components in `components[]`, and `renderSection`
 *   handles only paragraph/image/table there — a heading in a header renders as
 *   nothing and must never appear in the TOC.
 * - **`text-box` is reachable and does hold headings.** Its children render
 *   through `renderComponent` as real `Heading1..6` paragraphs, which Word's
 *   `\o` switch collects.
 * - **`columns` cannot appear here** — `applyLayout` hoists its children before
 *   this runs. The descent is kept anyway for the text-box-nested case and so a
 *   future layout change cannot silently drop entries.
 * - **Table cells cannot carry headings** (`processCellContent` handles only
 *   paragraph and image), so tables are leaves.
 *
 * Two kinds of entry are collected, because Word populates a TOC from two
 * sources: heading components (the `\o` outline range) and paragraphs whose
 * `themeStyle` a TOC maps via `props.styles` (the `\t` switch). Collecting only
 * the first would make the cached entries disagree with Word's own refresh —
 * exactly the failure `cachedEntries` exists to prevent.
 */

import { getStandardComponent } from '@json-to-office/shared-docx';
import type { ComponentDefinition } from '../types';
import type { SectionLayout } from './layout';
import { computeSectionOrdinals } from './sectionOrdinals';
import { globalSectionBookmarkRegistry } from './sectionBookmarks';
import { normalizeUnicodeText } from '../utils/unicode';

export interface TocHeadingEntry {
  /** Rendered text, with markdown decorators stripped as `createHeading` does. */
  title: string;
  /** Outline level (heading) or the level its style maps to. */
  level: number;
  /**
   * `themeStyle` key for a style-mapped paragraph; undefined for a heading.
   * A TOC includes these only when its own `props.styles` maps the key.
   */
  styleId?: string;
  /** Bookmark of the layout section this entry sits in, when inside one. */
  sectionBookmarkId?: string;
}

/**
 * Strip the inline decorators `createHeading` consumes, so a cached entry shows
 * "Results" rather than "**Results**".
 */
export function normalizeEntryTitle(text: string): string {
  return normalizeUnicodeText(text)
    .replace(/(\*\*\*|___)([\s\S]*?)\1/g, '$2')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .trim();
}

/** Component names whose `children` a rendered heading can hide inside. */
function isContainer(name: string): boolean {
  return getStandardComponent(name)?.hasChildren === true;
}

function isEnabled(component: ComponentDefinition): boolean {
  return !('enabled' in component && component.enabled === false);
}

/**
 * A paragraph contributes a TOC entry only through a custom `themeStyle`.
 * `heading1`..`heading6` are deliberately excluded: those map to the
 * display-only `JTD_HeadingText*` styles, which carry no outline level exactly
 * so paragraph text cannot masquerade as a heading.
 */
function styleEntryKey(props: Record<string, unknown>): string | undefined {
  const themeStyle = props.themeStyle;
  if (typeof themeStyle !== 'string' || !themeStyle) return undefined;
  if (/^heading[1-6]$/i.test(themeStyle)) return undefined;
  if (['normal', 'title', 'subtitle'].includes(themeStyle.toLowerCase())) {
    return undefined;
  }
  return themeStyle;
}

/**
 * Collect every TOC-eligible entry in document order, tagged with the layout
 * section it belongs to so a section-scoped TOC can filter to its own.
 */
export function collectTocHeadings(
  sections: readonly SectionLayout[]
): TocHeadingEntry[] {
  const entries: TocHeadingEntry[] = [];
  const ordinals = computeSectionOrdinals(sections);

  sections.forEach((section, index) => {
    const ordinal = ordinals[index]?.ordinal;
    const sectionBookmarkId = ordinal
      ? globalSectionBookmarkRegistry.forLayoutSection(ordinal).id
      : undefined;

    const visit = (component: ComponentDefinition): void => {
      if (!isEnabled(component)) return;

      const props = (component.props ?? {}) as Record<string, unknown>;

      if (component.name === 'heading') {
        const text = typeof props.text === 'string' ? props.text : '';
        const title = normalizeEntryTitle(text);
        if (title) {
          const level = typeof props.level === 'number' ? props.level : 1;
          entries.push({ title, level, sectionBookmarkId });
        }
        return;
      }

      if (component.name === 'paragraph') {
        const styleId = styleEntryKey(props);
        const text = typeof props.text === 'string' ? props.text : '';
        const title = normalizeEntryTitle(text);
        if (styleId && title) {
          // Level is decided by the TOC's own style mapping, not here.
          entries.push({ title, level: 1, styleId, sectionBookmarkId });
        }
        return;
      }

      if (!isContainer(component.name)) return;
      const children = (component as { children?: ComponentDefinition[] })
        .children;
      if (Array.isArray(children)) children.forEach(visit);
    };

    // `section.components` only — headers and footers live on their own fields
    // and never reach the TOC.
    section.components.forEach(visit);
  });

  return entries;
}
