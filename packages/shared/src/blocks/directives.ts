/** Evaluator syntax and result families, shared with authoring-schema generation. */
export const BLOCK_DIRECTIVES = {
  $slot: { keys: ['$slot', 'default', 'props'], result: 'dynamic' },
  $item: { keys: ['$item', 'default', 'props'], result: 'dynamic' },
  $theme: { keys: ['$theme', 'default'], result: 'dynamic' },
  $context: { keys: ['$context', 'default'], result: 'dynamic' },
  $count: { keys: ['$count'], result: 'number' },
  $if: { keys: ['$if', 'then', 'else'], result: 'dynamic' },
  $each: { keys: ['$each', 'template'], result: 'array' },
  $join: { keys: ['$join', 'separator', 'keepEmpty'], result: 'string' },
  $measure: { keys: ['$measure', 'fraction', 'unit'], result: 'number' },
} as const;
export type BlockDirective = keyof typeof BLOCK_DIRECTIVES;
/** Roots a `$if`/`$each`/`$count` operand may name instead of a slot pointer. */
export const BLOCK_OPERAND_ROOTS = ['$item', '$slot', '$context'] as const;
export type BlockOperandRoot = (typeof BLOCK_OPERAND_ROOTS)[number];
