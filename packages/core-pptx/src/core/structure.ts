/**
 * Structure Processing
 * JSON -> internal model
 */

import type {
  PptxComponentInput,
  PresentationComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
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
import { mergeWithDefaults } from '@json-to-office/shared';

export function processPresentation(
  document: PresentationComponentDefinition,
  options?: GenerationOptions
): ProcessedPresentation {
  const { props, children = [] } = document;

  const themeName = props.theme ?? 'default';
  const baseTheme =
    options?.customThemes?.[themeName] ?? getPptxTheme(themeName);

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

  // Process template slide definitions
  let templates: TemplateSlideDefinition[] | undefined;
  if (props.templates && props.templates.length > 0) {
    templates = props.templates.map((m: TemplateSlideDefinition) => {
      const effectiveGrid = mergeGridConfigs(props.grid, m.grid);

      // Resolve grid positions on placeholders
      const resolvedPhs = m.placeholders?.map((ph) => {
        if (!ph.grid) return ph;
        const abs = resolveGridPosition(
          ph.grid,
          effectiveGrid,
          slideWidth,
          slideHeight
        );
        return {
          ...ph,
          x: ph.x ?? abs.x,
          y: ph.y ?? abs.y,
          w: ph.w ?? abs.w,
          h: ph.h ?? abs.h,
          grid: undefined,
        };
      });

      // Resolve componentDefaults then grid positions on fixed objects
      const defaultedObjects = m.objects
        ? resolveComponentTree(m.objects, theme)
        : undefined;
      const resolvedObjects = defaultedObjects?.map((obj) =>
        resolveComponentGridPosition(
          obj,
          effectiveGrid,
          slideWidth,
          slideHeight
        )
      );

      return { ...m, placeholders: resolvedPhs, objects: resolvedObjects };
    });
  }

  const slides: ProcessedSlide[] = [];

  for (const child of children) {
    if (isSlideComponent(child)) {
      const slideComponents: PptxComponentInput[] = [];
      if (child.children) {
        for (const slideChild of child.children) {
          slideComponents.push(slideChild);
        }
      }

      // Resolve componentDefaults on all slide components
      const resolvedComponents = resolveComponentTree(slideComponents, theme);

      slides.push({
        components: resolvedComponents,
        background: child.props.background,
        notes: child.props.notes,
        layout: child.props.layout,
        hidden: child.props.hidden,
        template: child.props.template,
        placeholders: child.props.placeholders as
          | Record<string, any>
          | undefined,
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
    pageNumberFormat: props.pageNumberFormat ?? '9',
    slides,
    templates,
    services: options?.services,
  };
}
