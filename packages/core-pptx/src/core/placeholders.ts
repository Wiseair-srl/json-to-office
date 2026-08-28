import { mergeWithDefaults } from '@json-to-office/shared';
import type {
  GridConfig,
  PipelineWarning,
  PptxComponentInput,
  PptxThemeConfig,
  ProcessedSlide,
  TemplateSlideDefinition,
} from '../types';
import { getDefaultsForType } from '../utils/componentDefaults';
import { resolveComponentDefaults } from '../utils/resolveComponentTree';
import { W, warn } from '../utils/warn';
import { resolveComponentGridPosition } from './grid';

export interface PlaceholderResolutionOptions {
  theme: PptxThemeConfig;
  slideWidth: number;
  slideHeight: number;
  slideIndex: number;
  warnings?: PipelineWarning[];
}

export interface ResolvedPlaceholderComponent {
  name: string;
  component: PptxComponentInput;
}

/**
 * Merge slide placeholder content with its template declaration.
 *
 * This is renderer normalization, not IR compilation: quality checks reuse it
 * so component defaults, declared positions and declared defaults have one
 * precedence definition everywhere.
 */
export function resolvePlaceholderComponents(
  slide: ProcessedSlide,
  template: TemplateSlideDefinition | undefined,
  effectiveGrid: GridConfig | undefined,
  options: PlaceholderResolutionOptions
): ResolvedPlaceholderComponent[] {
  if (!slide.placeholders) return [];
  const out: ResolvedPlaceholderComponent[] = [];

  if (!template) {
    for (const [name, component] of Object.entries(slide.placeholders)) {
      const defaulted = resolveComponentDefaults(component, options.theme);
      const positioned =
        defaulted.props.x != null ||
        defaulted.props.y != null ||
        defaulted.props.grid;
      if (!positioned) {
        warn(
          options.warnings,
          W.PLACEHOLDER_NO_POSITION,
          `Placeholder "${name}" has no template and no explicit position — skipped`,
          { slide: options.slideIndex }
        );
        continue;
      }
      out.push({
        name,
        component: resolveComponentGridPosition(
          defaulted,
          effectiveGrid,
          options.slideWidth,
          options.slideHeight,
          options.warnings
        ),
      });
    }
    return out;
  }

  const declared = new Map(
    (template.placeholders ?? []).map((placeholder) => [
      placeholder.name,
      placeholder,
    ])
  );

  for (const [name, component] of Object.entries(slide.placeholders)) {
    const definition = declared.get(name);
    if (!definition) {
      warn(
        options.warnings,
        W.UNKNOWN_PLACEHOLDER,
        `Unknown placeholder "${name}" in template "${slide.template}". Available: ${[...declared.keys()].join(', ')}`,
        { slide: options.slideIndex }
      );
      continue;
    }

    const gridResolved = resolveComponentGridPosition(
      component,
      effectiveGrid,
      options.slideWidth,
      options.slideHeight,
      options.warnings
    );
    const typeDefaults = getDefaultsForType(component.name, options.theme);
    const positionDefaults: Record<string, unknown> = {};
    if (definition.x != null) positionDefaults.x = definition.x;
    if (definition.y != null) positionDefaults.y = definition.y;
    if (definition.w != null) positionDefaults.w = definition.w;
    if (definition.h != null) positionDefaults.h = definition.h;

    let props = mergeWithDefaults(positionDefaults, typeDefaults);
    props = mergeWithDefaults(definition.defaults?.props ?? {}, props);
    props = mergeWithDefaults(gridResolved.props, props);

    out.push({ name, component: { ...gridResolved, props } });
  }

  return out;
}
