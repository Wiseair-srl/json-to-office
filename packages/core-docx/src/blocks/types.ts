import type { ComponentDefinition } from '../types';

/**
 * What lowering one block produces: the primitives, in flow order, and a
 * source map from each emitted pointer to the authored one it came from.
 *
 * Pointers are relative to the block node. A value of `''` maps an emitted
 * node to the block itself; a slot pointer such as `/props/items` maps an
 * emitted region onto the authored slot, and anything beneath it (`/props/
 * items/2`) carries the remainder across unchanged.
 */
export interface BlockCompilation {
  children: ComponentDefinition[];
  sourceMap: Readonly<Record<string, string>>;
}
