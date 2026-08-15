/**
 * Slide-targeted hyperlinks
 *
 * `hyperlink.slide` is 1-based over the slides *as authored* in the JSON —
 * slides carrying `enabled: false` still count. Structure processing remaps
 * every ref to the position its target ends up at in the generated deck, so
 * toggling one slide off never silently retargets the links after it.
 *
 * A ref that cannot be resolved — target dropped, or index outside the
 * authored range — is marked unresolved here and dropped by the writer with a
 * warning. It must never reach pptxgenjs: it would emit a relationship to a
 * `slideN.xml` part that is not in the archive, which PowerPoint reports as a
 * damaged file.
 */

import type { PipelineWarning, PptxComponentInput } from '../types';

export const HYPERLINK_SLIDE_UNRESOLVED = 'HYPERLINK_SLIDE_UNRESOLVED';

export interface HyperlinkProps {
  url?: string;
  slide?: number;
  tooltip?: string;
  /** Internal: authored `slide` ref that resolves to no rendered slide. */
  unresolvedSlideRef?: number;
}

/** Authored 1-based slide number -> rendered 1-based slide number. */
export type SlideIndexMap = ReadonlyMap<number, number>;

function remapHyperlink(
  hyperlink: HyperlinkProps,
  map: SlideIndexMap
): HyperlinkProps {
  // `url` wins over `slide` at write time, so leave those refs alone.
  if (hyperlink.url || hyperlink.slide == null) return hyperlink;

  const rendered = map.get(hyperlink.slide);
  if (rendered === undefined) {
    const { slide, ...rest } = hyperlink;
    return { ...rest, unresolvedSlideRef: slide };
  }
  return rendered === hyperlink.slide
    ? hyperlink
    : { ...hyperlink, slide: rendered };
}

/**
 * Rewrite `hyperlink.slide` in a bare props bag. Template placeholder
 * `defaults` are merged into a component at render time without ever being a
 * component themselves, so they need rebasing on their own — otherwise a
 * `defaults.props.hyperlink.slide` reaches the writer as a raw authored index.
 */
export function remapHyperlinkProps<T extends Record<string, unknown>>(
  props: T,
  map: SlideIndexMap
): T {
  const hyperlink = props.hyperlink as HyperlinkProps | undefined;
  if (!hyperlink || typeof hyperlink !== 'object') return props;

  const remapped = remapHyperlink(hyperlink, map);
  return remapped === hyperlink ? props : { ...props, hyperlink: remapped };
}

/** Rewrite every `hyperlink.slide` in a component subtree. Returns a new tree. */
export function remapHyperlinkSlideRefs(
  component: PptxComponentInput,
  map: SlideIndexMap
): PptxComponentInput {
  const hyperlink = component.props?.hyperlink as HyperlinkProps | undefined;
  let next = component;

  if (hyperlink && typeof hyperlink === 'object') {
    const remapped = remapHyperlink(hyperlink, map);
    if (remapped !== hyperlink) {
      next = { ...next, props: { ...next.props, hyperlink: remapped } };
    }
  }

  if (next.children && next.children.length > 0) {
    next = {
      ...next,
      children: next.children.map((child) =>
        remapHyperlinkSlideRefs(child, map)
      ),
    };
  }

  return next;
}

/**
 * Write the pptxgenjs `hyperlink` option, dropping unresolvable slide refs.
 * Shared by every component that accepts a hyperlink.
 */
export function applyHyperlink(
  opts: Record<string, unknown>,
  hyperlink: HyperlinkProps | undefined,
  componentName: string,
  warnings?: PipelineWarning[]
): void {
  if (!hyperlink) return;

  if (hyperlink.url) {
    opts.hyperlink = { url: hyperlink.url, tooltip: hyperlink.tooltip };
    return;
  }

  if (hyperlink.unresolvedSlideRef != null) {
    const message =
      `hyperlink.slide ${hyperlink.unresolvedSlideRef} matches no slide in the generated ` +
      `presentation (slide disabled, or index out of range) — hyperlink dropped`;
    if (warnings) {
      warnings.push({
        code: HYPERLINK_SLIDE_UNRESOLVED,
        message,
        component: componentName,
      });
    } else {
      console.warn(message);
    }
    return;
  }

  if (hyperlink.slide) {
    opts.hyperlink = { slide: hyperlink.slide, tooltip: hyperlink.tooltip };
  }
}
