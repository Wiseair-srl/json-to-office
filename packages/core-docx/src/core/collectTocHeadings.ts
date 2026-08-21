/**
 * collectDocumentOutline — per-document pre-pass over the layout (#174, #177,
 * #182). One walk, three outputs: TOC entries, heading numbers, and the
 * cross-reference targets `[@id]` resolves against.
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
 *
 * The walk also owns the two counters render cannot keep itself: the heading
 * numbering sequence (a cross-reference needs the number of a heading that may
 * come later in the document) and each list's item counters.
 */

import { getStandardComponent } from '@json-to-office/shared-docx';
import type { ComponentDefinition } from '../types';
import type { SectionLayout } from './layout';
import { computeSectionOrdinals } from './sectionOrdinals';
import { globalSectionBookmarkRegistry } from './sectionBookmarks';
import { normalizeUnicodeText } from '../utils/unicode';
import {
  slugifyBookmarkText,
  dedupeBookmarkId,
} from '../utils/bookmarkRegistry';
import type { NumberedItemInfo } from '../utils/numberedItemsRegistry';
import { resolveListLevels } from '../utils/listLevels';
import type { ListLevelConfig } from '../utils/numberingConfig';
import { formatNumberForLevel } from '../utils/numberFormatting';

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
  /** Multilevel number ("2.1") when heading numbering applies to this entry. */
  number?: string;
}

export interface DocumentOutline {
  entries: TocHeadingEntry[];
  /** Cross-reference targets, keyed by the bookmark id render will emit. */
  numberedItems: Map<string, NumberedItemInfo>;
}

/** Word supports six heading levels; deeper input collapses onto Heading1. */
const MAX_HEADING_LEVEL = 6;
/** Word supports nine list levels. */
const MAX_LIST_LEVEL = 9;

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

/** Item shape a `list` component's `items` array can hold. */
type ListItem = {
  text?: unknown;
  level?: unknown;
  revision?: unknown;
  id?: unknown;
};

/** Per numbering reference: its level definitions and where each counter is. */
interface ListCounterState {
  levels: readonly ListLevelConfig[];
  /** One slot per list level, already decremented to "before the start". */
  counters: number[];
}

function levelStart(levels: readonly ListLevelConfig[], level: number): number {
  return levels[level]?.start ?? 1;
}

/**
 * Walk the document once and derive everything render needs to know about it up
 * front: the TOC entries, the heading numbers, and the cross-reference targets
 * keyed by the bookmark ids render will produce.
 *
 * The id prediction is the delicate part. `renderHeadingComponent` slugs a
 * heading's text and disambiguates it against bookmarks registered *so far*, so
 * this walk must see the same ids in the same order — including the explicit
 * `props.id` a paragraph registers — or a cross-reference resolves against an
 * id that never gets written.
 */
export function collectDocumentOutline(
  sections: readonly SectionLayout[]
): DocumentOutline {
  const entries: TocHeadingEntry[] = [];
  const numberedItems = new Map<string, NumberedItemInfo>();
  const ordinals = computeSectionOrdinals(sections);

  // Bookmark ids already claimed, in walk order — the pre-pass mirror of the
  // bookmark registry render fills as it goes.
  const takenIds = new Set<string>();
  const headingCounters = new Array<number>(MAX_HEADING_LEVEL).fill(0);
  // Lists sharing an explicit `reference` share one numbering definition, so
  // their counters continue. An auto-generated reference is unique per list, so
  // such a list gets a fresh state that nothing else can reach.
  const listCounters = new Map<string, ListCounterState>();

  const visitHeading = (
    component: ComponentDefinition,
    props: Record<string, unknown>,
    sectionBookmarkId: string | undefined
  ): void => {
    const text = typeof props.text === 'string' ? props.text : '';
    const title = normalizeEntryTitle(text);
    const level = typeof props.level === 'number' ? props.level : 1;
    // Mirrors getStyleIdForLevel: an out-of-range level renders as Heading1.
    const styleLevel = level >= 1 && level <= MAX_HEADING_LEVEL ? level : 1;

    let full: string | undefined;
    let own: string | undefined;
    if (props.numbering === true) {
      headingCounters[styleLevel - 1] += 1;
      for (let deeper = styleLevel; deeper < MAX_HEADING_LEVEL; deeper++) {
        headingCounters[deeper] = 0;
      }
      // A level-3 heading with no level-2 above it numbers "1.0.1", exactly as
      // Word does; there is nothing to special-case.
      full = headingCounters.slice(0, styleLevel).join('.');
      own = String(headingCounters[styleLevel - 1]);
    }

    const explicitId = (component as { id?: unknown }).id;
    const bookmarkId =
      typeof explicitId === 'string' && explicitId
        ? explicitId
        : dedupeBookmarkId(slugifyBookmarkText(text), (id) => takenIds.has(id));
    takenIds.add(bookmarkId);
    numberedItems.set(bookmarkId, {
      kind: 'heading',
      text: title,
      ...(full !== undefined && { full, own }),
    });

    if (title) {
      entries.push({
        title,
        level,
        sectionBookmarkId,
        ...(full !== undefined && { number: full }),
      });
    }
  };

  const visitList = (props: Record<string, unknown>): void => {
    const items = Array.isArray(props.items)
      ? (props.items as (string | ListItem)[])
      : [];
    if (items.length === 0) return;

    const reference =
      typeof props.reference === 'string' && props.reference
        ? props.reference
        : undefined;

    const freshState = (): ListCounterState => {
      const levels = resolveListLevels(
        props as Parameters<typeof resolveListLevels>[0]
      );
      return {
        levels,
        counters: Array.from(
          { length: MAX_LIST_LEVEL },
          (_, level) => levelStart(levels, level) - 1
        ),
      };
    };

    let state: ListCounterState;
    if (reference === undefined) {
      state = freshState();
    } else {
      state = listCounters.get(reference) ?? freshState();
      listCounters.set(reference, state);
    }

    for (const item of items) {
      const isObject = typeof item === 'object' && item !== null;
      const raw = isObject ? item.text : item;
      const text = typeof raw === 'string' ? raw : '';
      // Same skip rule as createList: an empty item renders nothing and so
      // never advances the counter.
      if (!text.trim() && !(isObject && item.revision)) continue;

      const rawLevel = isObject ? item.level : undefined;
      const level =
        typeof rawLevel === 'number' && rawLevel >= 0 ? rawLevel : 0;
      if (level >= MAX_LIST_LEVEL) continue;

      state.counters[level] += 1;
      for (let deeper = level + 1; deeper < MAX_LIST_LEVEL; deeper++) {
        state.counters[deeper] = levelStart(state.levels, deeper) - 1;
      }

      const id = isObject ? item.id : undefined;
      if (typeof id !== 'string' || !id) continue;
      takenIds.add(id);
      // A single level's counter, not a "1.a.i" chain: Word's `\r` switch on a
      // list item shows the item's own number.
      const number = formatNumberForLevel(
        state.counters[level],
        state.levels[level]?.format
      );
      numberedItems.set(id, {
        kind: 'list-item',
        text: normalizeUnicodeText(text).trim(),
        ...(number !== undefined && { full: number, own: number }),
      });
    }
  };

  sections.forEach((section, index) => {
    // Ordinal 0 means a continuation chunk that appears before any opening
    // chunk — there is no bookmark to scope to. `renderSection` applies the
    // same truthiness test, so the two must stay in step: making either side
    // treat 0 as a real ordinal would emit entries scoped to a `_Section_0`
    // bookmark the renderer never writes.
    const ordinal = ordinals[index]?.ordinal;
    const sectionBookmarkId = ordinal
      ? globalSectionBookmarkRegistry.forLayoutSection(ordinal).id
      : undefined;

    const visit = (component: ComponentDefinition): void => {
      if (!isEnabled(component)) return;

      const props = (component.props ?? {}) as Record<string, unknown>;

      if (component.name === 'heading') {
        visitHeading(component, props, sectionBookmarkId);
        return;
      }

      if (component.name === 'paragraph') {
        // `props.id` is the bookmark a paragraph registers when it renders;
        // claiming it here keeps a later heading slug dedupe in step.
        if (typeof props.id === 'string' && props.id) takenIds.add(props.id);

        const styleId = styleEntryKey(props);
        const text = typeof props.text === 'string' ? props.text : '';
        const title = normalizeEntryTitle(text);
        if (styleId && title) {
          // Level is decided by the TOC's own style mapping, not here.
          entries.push({ title, level: 1, styleId, sectionBookmarkId });
        }
        return;
      }

      if (component.name === 'list') {
        visitList(props);
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

  return { entries, numberedItems };
}

/**
 * Collect every TOC-eligible entry in document order, tagged with the layout
 * section it belongs to so a section-scoped TOC can filter to its own.
 */
export function collectTocHeadings(
  sections: readonly SectionLayout[]
): TocHeadingEntry[] {
  return collectDocumentOutline(sections).entries;
}
