/**
 * Structure Processing
 * JSON -> internal model
 */

import type {
  PptxComponentInput,
  PresentationComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
  MasterSlideDefinition,
} from '../types';
import { isSlideComponent } from '../types';
import { resolveGridPosition, mergeGridConfigs } from './grid';
import { getPptxTheme } from '../themes';
import type { GenerationOptions } from './generator';

export function processPresentation(
  document: PresentationComponentDefinition,
  options?: GenerationOptions
): ProcessedPresentation {
  const { props, children = [] } = document;

  const themeName = props.theme ?? 'default';
  const theme = options?.customThemes?.[themeName] ?? getPptxTheme(themeName);
  const slideWidth = props.slideWidth ?? 10;
  const slideHeight = props.slideHeight ?? 7.5;

  // Process master slide definitions
  let masters: MasterSlideDefinition[] | undefined;
  if (props.masters && props.masters.length > 0) {
    masters = props.masters.map((m: MasterSlideDefinition) => {
      if (!m.placeholders) return m;
      // Resolve grid positions on placeholders using master's grid (merged with presentation)
      const effectiveGrid = mergeGridConfigs(props.grid, m.grid);
      const resolvedPhs = m.placeholders.map(ph => {
        if (!ph.grid) return ph;
        const abs = resolveGridPosition(ph.grid, effectiveGrid, slideWidth, slideHeight);
        return {
          ...ph,
          x: ph.x ?? abs.x,
          y: ph.y ?? abs.y,
          w: ph.w ?? abs.w,
          h: ph.h ?? abs.h,
          grid: undefined,
        };
      });
      return { ...m, placeholders: resolvedPhs };
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

      slides.push({
        components: slideComponents,
        background: child.props.background,
        notes: child.props.notes,
        layout: child.props.layout,
        hidden: child.props.hidden,
        master: child.props.master,
        placeholders: child.props.placeholders as Record<string, any> | undefined,
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
    slides,
    masters,
  };
}
