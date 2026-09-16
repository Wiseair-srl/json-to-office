/**
 * Authoring the block engine replaced, named where validation rejects it.
 *
 * A schema can only say that a key is unexpected or a component unknown. An
 * author who wrote a slide template, invoked a definition by its own name, or
 * named a block's definition with `name` needs to hear what replaced it, so
 * the rejection carries the canonical form as its suggestion. Nothing is
 * accepted that was not before: the error stands, and says more.
 */

import { blockValueAt, readBlockDefinitions } from './evaluator';

export interface ExplainableError {
  path: string;
  code?: string;
  message: string;
  suggestion?: string;
}

const SLIDE_TEMPLATES =
  'Slide templates were replaced by JSON blocks: define the shared slide content once in props.blocks and invoke it on each slide with { "name": "block", "props": { "ref": "<definition>" } }.';

const SLIDE_KEYS: Readonly<Record<string, string>> = {
  template:
    'A slide no longer names a template: put { "name": "block", "props": { "ref": "<definition>" } } first among its children, with the definition in props.blocks.',
  placeholders:
    'Placeholders became block slots: fill them in the invocation as { "name": "block", "props": { "ref": "<definition>", "slots": { … } } }.',
  layout:
    'Slide layouts are not read: the block a slide invokes lays it out, from its definition in props.blocks.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The errors with a suggestion added to each one that removed syntax explains. */
export function explainRemovedBlockSyntax<E extends ExplainableError>(
  document: unknown,
  format: 'docx' | 'pptx',
  errors: readonly E[]
): E[] {
  const definitions = readBlockDefinitions(document);
  return errors.map((error) => {
    const suggestion = removedSyntaxSuggestion(
      document,
      format,
      definitions,
      error
    );
    return suggestion ? { ...error, suggestion } : error;
  });
}

function removedSyntaxSuggestion(
  document: unknown,
  format: 'docx' | 'pptx',
  definitions: Record<string, unknown>,
  error: ExplainableError
): string | undefined {
  if (format === 'pptx') {
    if (error.path === '/props/templates') return SLIDE_TEMPLATES;
    const slide =
      /^\/children\/\d+\/props\/(template|placeholders|layout)$/.exec(
        error.path
      );
    if (slide) return SLIDE_KEYS[slide[1]];
  }
  if (error.code === 'unknown_component' && error.path.endsWith('/name')) {
    const name = blockValueAt(document, error.path);
    if (typeof name !== 'string') return undefined;
    return Object.prototype.hasOwnProperty.call(definitions, name)
      ? `"${name}" is a JSON block this document defines, not a component: invoke it as { "name": "block", "props": { "ref": "${name}", "slots": { … } } }.`
      : `If "${name}" is a JSON block, copy its definition from jto://blocks into props.blocks and invoke it as { "name": "block", "props": { "ref": "${name}" } }; blocks are never components.`;
  }
  const invocationName = /^(.*)\/props\/name$/.exec(error.path);
  if (invocationName) {
    const node = blockValueAt(document, invocationName[1]);
    const value = blockValueAt(document, error.path);
    if (isRecord(node) && node.name === 'block' && typeof value === 'string')
      return `A block invocation names its definition with ref: { "name": "block", "props": { "ref": "${value}" } }.`;
  }
  return undefined;
}
