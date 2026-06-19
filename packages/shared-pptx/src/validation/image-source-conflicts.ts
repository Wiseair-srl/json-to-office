/**
 * Image source conflict detection (PPTX)
 *
 * Mirrors core-docx: `path`, `base64`, and `svg` are mutually exclusive on the
 * image component, but all three are optional fields on a single object schema —
 * so a multi-source payload passes the structural check and would otherwise be
 * silently resolved by runtime precedence (svg > base64 > path). This walk runs
 * unconditionally during validation and rejects such payloads. It traverses every
 * nested value, so images inside slides, grids, containers, and table cells are
 * all covered regardless of container shape.
 */

import type { ValidationError } from '@json-to-office/shared';

// Image source fields that are mutually exclusive: exactly one may be set.
const IMAGE_SOURCE_FIELDS = ['path', 'base64', 'svg'] as const;

/**
 * Names of the image source fields that carry a non-empty value on a props object.
 */
export function presentImageSources(props: unknown): string[] {
  if (!props || typeof props !== 'object') return [];
  const p = props as Record<string, unknown>;
  return IMAGE_SOURCE_FIELDS.filter((f) => {
    const v = p[f];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Collect "more than one image source" conflicts anywhere in a presentation.
 */
export function collectImageSourceConflicts(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  const visit = (node: any, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (node.name === 'image') {
      const present = presentImageSources(node.props);
      if (present.length > 1) {
        errors.push({
          path: `${path}/props`,
          message: `Image component accepts only one source, but found ${present
            .map((f) => `"${f}"`)
            .join(', ')}. Use exactly one of "path", "base64", or "svg".`,
          code: 'mutually_exclusive',
        });
      }
    }

    for (const key of Object.keys(node)) {
      visit(node[key], `${path}/${key}`);
    }
  };

  visit(data, '');
  return errors;
}
