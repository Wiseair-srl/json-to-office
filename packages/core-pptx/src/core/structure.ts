/**
 * Structure Processing
 * JSON -> internal model
 */

import type {
  PptxComponentInput,
  PptxThemeConfig,
  PresentationComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
  SlideComponentDefinition,
  TemplateSlideDefinition,
} from '../types';
import { isSlideComponent } from '../types';
import {
  resolveGridPosition,
  resolveComponentGridPosition,
  mergeGridConfigs,
} from './grid';
import { getPptxTheme } from '../themes';
import type { GenerationOptions } from './generator';
import { resolveComponentTree } from '../utils/resolveComponentTree';
import {
  remapHyperlinkProps,
  remapHyperlinkSlideRefs,
} from '../utils/hyperlink';
import { mergeWithDefaults } from '@json-to-office/shared';

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
  const { props, children = [] } = document;

  // The generation prologue hands the resolved theme over directly — after
  // the export-mode pre-pass, so a name lookup here would resurrect
  // pre-substitute font families. The `props.theme` resolution below (a name,
  // or an inline theme config object embedded in the document itself —
  // self-contained documents-as-data) is the fallback for direct callers.
  const baseTheme =
    options?.theme ??
    (typeof props.theme === 'object' && props.theme !== null
      ? (props.theme as PptxThemeConfig)
      : options?.customThemes?.[props.theme ?? 'default'] ??
        getPptxTheme(props.theme ?? 'default'));

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

  // Process template slide definitions
  let templates: TemplateSlideDefinition[] | undefined;
  if (props.templates && props.templates.length > 0) {
    templates = props.templates.map((m: TemplateSlideDefinition) => {
      const effectiveGrid = mergeGridConfigs(props.grid, m.grid);

      // Rebase slide refs in placeholder `defaults`, then resolve grid
      // positions. `defaults.props` is merged into the rendered component by
      // core/render.ts, so it reaches the writer just like a component's own
      // props and needs the same remapping.
      const resolvedPhs = m.placeholders?.map((ph) => {
        const phDefaults = ph.defaults;
        const defaultProps = phDefaults?.props
          ? remapHyperlinkProps(phDefaults.props, slideIndexMap)
          : undefined;
        const base =
          phDefaults && defaultProps && defaultProps !== phDefaults.props
            ? { ...ph, defaults: { ...phDefaults, props: defaultProps } }
            : ph;

        if (!base.grid) return base;
        const abs = resolveGridPosition(
          base.grid,
          effectiveGrid,
          slideWidth,
          slideHeight
        );
        return {
          ...base,
          x: base.x ?? abs.x,
          y: base.y ?? abs.y,
          w: base.w ?? abs.w,
          h: base.h ?? abs.h,
          grid: undefined,
        };
      });

      // Resolve componentDefaults then grid positions on fixed objects
      const defaultedObjects = m.objects
        ? resolveComponentTree(m.objects, theme)
        : undefined;
      const resolvedObjects = defaultedObjects?.map((obj) =>
        remapHyperlinkSlideRefs(
          resolveComponentGridPosition(
            obj,
            effectiveGrid,
            slideWidth,
            slideHeight
          ),
          slideIndexMap
        )
      );

      return { ...m, placeholders: resolvedPhs, objects: resolvedObjects };
    });
  }

  const slides: ProcessedSlide[] = [];

  for (const child of children) {
    if (isSlideComponent(child)) {
      // `enabled: false` drops the slide entirely; absent means enabled
      if (!isSlideEnabled(child)) continue;

      const slideComponents: PptxComponentInput[] = [];
      if (child.children) {
        for (const slideChild of child.children) {
          slideComponents.push(slideChild);
        }
      }

      // Resolve componentDefaults on all slide components, then rebase
      // slide-targeted hyperlinks onto the generated slide numbering
      const resolvedComponents = resolveComponentTree(
        slideComponents,
        theme
      ).map((component) => remapHyperlinkSlideRefs(component, slideIndexMap));

      // Every slide prop is optional, so validation accepts a slide with no
      // `props` at all (the deep validator checks an empty object in that
      // case). Generation has to accept the same documents validation does.
      const slideProps: NonNullable<SlideComponentDefinition['props']> =
        child.props ?? {};

      const placeholders = slideProps.placeholders as
        | Record<string, PptxComponentInput>
        | undefined;

      slides.push({
        components: resolvedComponents,
        background: slideProps.background,
        transition: slideProps.transition,
        notes: slideProps.notes,
        layout: slideProps.layout,
        hidden: slideProps.hidden,
        template: slideProps.template,
        placeholders: placeholders
          ? Object.fromEntries(
              Object.entries(placeholders).map(([name, component]) => [
                name,
                remapHyperlinkSlideRefs(component, slideIndexMap),
              ])
            )
          : undefined,
      });
    }
  }

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
    templates,
    services: options?.services,
  };
}
