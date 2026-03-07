/**
 * Structure Processing
 * JSON -> internal model
 */

import type {
  PptxComponentInput,
  PresentationComponentDefinition,
  ProcessedPresentation,
  ProcessedSlide,
} from '../types';
import { isSlideComponent } from '../types';
import { getPptxTheme } from '../themes';
import type { GenerationOptions } from './generator';

export function processPresentation(
  document: PresentationComponentDefinition,
  options?: GenerationOptions
): ProcessedPresentation {
  const { props, children = [] } = document;

  const themeName = props.theme ?? 'default';
  const theme = options?.customThemes?.[themeName] ?? getPptxTheme(themeName);

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
    slideWidth: props.slideWidth ?? 10,
    slideHeight: props.slideHeight ?? 7.5,
    rtlMode: props.rtlMode ?? false,
    slides,
  };
}
