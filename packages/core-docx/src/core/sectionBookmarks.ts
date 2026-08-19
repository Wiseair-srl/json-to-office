/**
 * Section bookmark ids — the single producer.
 *
 * `context.section.sectionBookmarkId` is what a section-scoped TOC resolves its
 * `\b` switch against. It used to have two independent producers writing the
 * same field from two different traversal orders: a loop-carried ordinal fold
 * over `layout.sections[]` in `core/render.ts`, and a DFS counter kept on
 * `context.custom.sectionBookmarks` in `components/section.ts`, whose value
 * shadowed the first for everything below a nested section. Consumers read
 * whichever won.
 *
 * Both call sites now allocate here. Ids stay in two disjoint namespaces
 * (`_Section_*` for layout sections, `_NestedSection_*` for section components
 * rendered inside one) with disjoint numeric link-id ranges, but there is one
 * place that decides both, and one map that remembers what a given section
 * resolved to.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** A resolved OOXML bookmark: its name plus the numeric id start/end share. */
export interface SectionBookmark {
  /** `w:bookmarkStart/@w:name`, and the TOC `\b` switch argument. */
  id: string;
  /** `w:bookmarkStart/@w:id` / `w:bookmarkEnd/@w:id`. */
  linkId: number;
}

/**
 * Nested-section link ids start well above the layout ordinals so the two
 * namespaces cannot collide inside one document.
 */
const NESTED_LINK_ID_BASE = 1_000_000;

interface SectionBookmarkState {
  /** Next ordinal for a section component (DFS order). */
  nextNested: number;
  /** Resolved bookmark per section component, keyed by component identity. */
  resolved: WeakMap<object, SectionBookmark>;
}

function createState(): SectionBookmarkState {
  return { nextNested: 1, resolved: new WeakMap() };
}

/**
 * Per-render allocation state. Async-local so concurrent document renders each
 * get their own counters, matching the bookmark/revision/numbering registries.
 */
class SectionBookmarkRegistry {
  private fallback: SectionBookmarkState = createState();
  private readonly scopes = new AsyncLocalStorage<SectionBookmarkState>();

  private get state(): SectionBookmarkState {
    return this.scopes.getStore() ?? this.fallback;
  }

  /** Run work with an isolated registry that follows its async call chain. */
  runScoped<T>(callback: () => T): T {
    return this.scopes.run(createState(), callback);
  }

  /**
   * The bookmark for a layout section, derived from its ordinal.
   *
   * Every layout chunk of one user-defined section shares an ordinal (see
   * `computeSectionOrdinals`), so they all resolve to the same bookmark — which
   * is the point: the start lands in the first chunk and the end in the last.
   */
  forLayoutSection(ordinal: number): SectionBookmark {
    return { id: `_Section_${ordinal}`, linkId: ordinal };
  }

  /**
   * The bookmark for a `section` component, allocated on first sight and
   * remembered so re-resolving the same component never allocates twice.
   */
  forSectionComponent(component: object): SectionBookmark {
    const state = this.state;
    const existing = state.resolved.get(component);
    if (existing) return existing;

    const ordinal = state.nextNested++;
    const bookmark: SectionBookmark = {
      id: `_NestedSection_${ordinal}`,
      linkId: NESTED_LINK_ID_BASE + ordinal,
    };
    state.resolved.set(component, bookmark);
    return bookmark;
  }

  /** Test-only: reset the unscoped fallback counters. */
  clear(): void {
    if (!this.scopes.getStore()) {
      this.fallback = createState();
    }
  }
}

export const globalSectionBookmarkRegistry = new SectionBookmarkRegistry();
