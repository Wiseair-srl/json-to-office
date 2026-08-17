/**
 * Text content conflict detection (PPTX)
 *
 * `text` and `runs` are mutually exclusive on the text component, but both are
 * optional fields on a single object schema — so a payload carrying both (or
 * neither) passes the structural check and would otherwise be silently resolved
 * by runtime precedence. This walk runs unconditionally during validation and
 * rejects such payloads. It traverses every nested value, so text components
 * inside slides, placeholders, and template objects are all covered.
 *
 * Placeholder `defaults` stubs are exempt from the "neither" rule: they carry
 * styling defaults only, and the actual content arrives with the component
 * placed in the placeholder.
 */

import type { ValidationError } from '@json-to-office/shared';

/**
 * Collect `text`/`runs` mutual-exclusivity conflicts anywhere in a presentation.
 */
export function collectTextContentConflicts(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  const visit = (node: any, path: string, parentKey: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`, parentKey));
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (node.name === 'text' && node.props && typeof node.props === 'object') {
      const hasText = typeof node.props.text === 'string';
      const hasRuns = Array.isArray(node.props.runs);
      if (hasText && hasRuns) {
        errors.push({
          path: `${path}/props`,
          message:
            'Text component accepts either "text" or "runs", not both. Use exactly one of the two.',
          code: 'mutually_exclusive',
        });
      } else if (!hasText && !hasRuns && parentKey !== 'defaults') {
        errors.push({
          path: `${path}/props`,
          message:
            'Text component requires content: set either "text" or "runs".',
          code: 'required_property',
        });
      }
    }

    for (const key of Object.keys(node)) {
      visit(node[key], `${path}/${key}`, key);
    }
  };

  visit(data, '', '');
  return errors;
}
