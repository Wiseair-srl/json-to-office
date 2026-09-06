/**
 * Structure Processing
 * JSON -> internal model
 *
 * The document arrives with every block already expanded (see
 * `blocks/document.ts`); what remains here is theme resolution, component
 * defaults, hyperlink rebasing, and the two engine operations that turn
 * authored composition into the absolute boxes the compiler draws: layout
 * (frames, distribution, grids) and bounded text fit.
 */

import type {
  PptxComponentInput,
  PptxThemeConfig,
  PresentationComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
  SlideComponentDefinition,
} from '../types';
import { isSlideComponent } from '../types';
import { mergeGridConfigs } from './grid';
import { getPptxTheme } from '../themes';
import { resolvePptxDesignSystem, designGrid } from '../themes/design-system';
import type { GenerationOptions } from './generator';
import { resolveComponentTree } from '../utils/resolveComponentTree';
import { remapHyperlinkSlideRefs } from '../utils/hyperlink';
import {
  mergeWithDefaults,
  toAuthoredBlockPointer,
} from '@json-to-office/shared';
import { resolveSlideLayout } from './layout';
import { applyTextFit } from './fit';

/** A slide child is rendered unless it carries `enabled: false`. */
function isSlideEnabled(child: object): boolean {
  return !(
    'enabled' in child && (child as { enabled?: boolean }).enabled === false
  );
}

/**
 * Map authored 1-based slide numbers (disabled slides included) to their
 * position in the generated deck. Dropped slides are absent from the map, so
 * hyperlinks pointing at them resolve to nothing instead of to whichever slide
 * happened to shift into that number.
 */
function buildSlideIndexMap(
  children: PptxComponentInput[]
): Map<number, number> {
  const map = new Map<number, number>();
  let authored = 0;
  let rendered = 0;
  for (const child of children) {
    if (!isSlideComponent(child)) continue;
    authored++;
    if (isSlideEnabled(child)) map.set(authored, ++rendered);
  }
  return map;
}

export function processPresentation(
  document: PresentationComponentDefinition,
  options?: GenerationOptions
): ProcessedPresentation {
  let { props } = document;
  const { children = [] } = document;

  // The generation prologue hands the resolved theme over directly — after
  // the export-mode pre-pass, so a name lookup here would resurrect
  // pre-substitute font families. The `props.theme` resolution below (a name,
  // or an inline theme config object embedded in the document itself —
  // self-contained documents-as-data) is the fallback for direct callers.
  const selectedTheme =
    options?.theme ??
    (typeof props.theme === 'object' && props.theme !== null
      ? (props.theme as PptxThemeConfig)
      : options?.customThemes?.[props.theme ?? 'default'] ??
        getPptxTheme(props.theme ?? 'default'));

  // Idempotent, and deliberately repeated: the generation prologue already
  // resolved the theme it hands over, while a direct caller reaches this with a
  // raw theme. Re-resolving projects the same roles onto styles that already
  // carry them, because a style key present in `styles` wins over the role.
  const baseTheme = resolvePptxDesignSystem(
    selectedTheme,
    props.slideWidth,
    props.slideHeight
  );
  const tokenGrid = designGrid(
    baseTheme,
    props.slideWidth ?? 10,
    props.slideHeight ?? 7.5
  );
  if (tokenGrid)
    props = { ...props, grid: mergeGridConfigs(tokenGrid, props.grid) };

  // Merge presentation-level componentDefaults on top of theme-level ones
  const presDefaults = props.componentDefaults;
  const theme = presDefaults
    ? {
        ...baseTheme,
        componentDefaults: mergeWithDefaults(
          presDefaults,
          baseTheme.componentDefaults || {}
        ),
      }
    : baseTheme;

  const slideWidth = props.slideWidth ?? 10;
  const slideHeight = props.slideHeight ?? 7.5;

  const slideIndexMap = buildSlideIndexMap(children);
  const sourceMap = options?.sourceMap ?? {};
  const toAuthored = (path: string) => toAuthoredBlockPointer(sourceMap, path);

  const slides: ProcessedSlide[] = [];

  children.forEach((child, authoredIndex) => {
    if (!isSlideComponent(child)) return;
    // `enabled: false` drops the slide entirely; absent means enabled
    if (!isSlideEnabled(child)) return;

    // Resolve componentDefaults on all slide components, then rebase
    // slide-targeted hyperlinks onto the generated slide numbering
    const resolvedComponents = resolveComponentTree(
      child.children ?? [],
      theme
    ).map((component) => remapHyperlinkSlideRefs(component, slideIndexMap));

    // Layout, then fit: frames and rows become absolute boxes, and a text
    // that declared bounds is sized within them or refused at its authored
    // pointer.
    const laidOut = resolveSlideLayout(resolvedComponents, {
      grid: props.grid,
      slideWidth,
      slideHeight,
      warnings: options?.warnings,
    });
    const fitted = applyTextFit(laidOut, `/children/${authoredIndex}`, {
      theme,
      slideWidth,
      slideHeight,
      toAuthored,
    });

    // Every slide prop is optional, so validation accepts a slide with no
    // `props` at all (the deep validator checks an empty object in that
    // case). Generation has to accept the same documents validation does.
    const slideProps: NonNullable<SlideComponentDefinition['props']> =
      child.props ?? {};

    slides.push({
      components: fitted,
      background: slideProps.background,
      transition: slideProps.transition,
      notes: slideProps.notes,
      hidden: slideProps.hidden,
    });
  });

  return {
    metadata: {
      title: props.title,
      author: props.author,
      subject: props.subject,
      company: props.company,
    },
    theme,
    grid: props.grid,
    slideWidth,
    slideHeight,
    rtlMode: props.rtlMode ?? false,
    language: props.language,
    pageNumberFormat: props.pageNumberFormat ?? '9',
    slides,
    services: options?.services,
  };
}
