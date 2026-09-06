import {
  BlockEvaluationError,
  isBlockRecord,
  toAuthoredBlockPointer,
  type JsonBlockEvaluator,
} from './evaluator';

type Rec = Record<string, unknown>;

export interface BlockCompositionOptions {
  /** Registered code component names. JSON never loads or installs them. */
  plugins: ReadonlySet<string>;
  /** Expand one registered component at its authored path into standard output. */
  render: (component: Rec, path: string) => Promise<unknown[]>;
  /** Plugin names kept unexpanded in the `preserved` tree (schema export, inspection). */
  preserve?: ReadonlySet<string>;
}

export interface BlockComposition {
  /** Every block and plugin lowered to standard components. */
  standard: unknown;
  /** The same tree with preserved plugins left as authored. */
  preserved: unknown;
}

/**
 * One bounded expansion for document-local JSON and registered code, in both
 * directions: a plugin can emit a block, a block body or component slot can
 * name a plugin, and either can nest. Provenance survives each boundary
 * through the evaluator's source map; emitted output is wrapped in a `group`
 * whose pointer maps back to the plugin's authored node.
 *
 * Format-neutral: the host supplies the evaluator (its format, theme and
 * context) and validates the finished tree.
 */
export async function composeBlocksWithPlugins(
  evaluator: JsonBlockEvaluator,
  document: unknown,
  options: BlockCompositionOptions
): Promise<BlockComposition> {
  const preserve = options.preserve ?? new Set<string>();
  let visited = 0;
  const walk = async (
    value: unknown,
    path: string,
    depth: number
  ): Promise<BlockComposition> => {
    if (depth > 64 || ++visited > 100000)
      throw new BlockEvaluationError([
        {
          path: toAuthoredBlockPointer(evaluator.sourceMap, path),
          code: 'block_expansion_limit',
          message:
            'Combined plugin/block expansion exceeds depth/node limits (64/100000).',
        },
      ]);
    if (Array.isArray(value)) {
      const children: BlockComposition[] = [];
      for (let i = 0; i < value.length; i++)
        children.push(await walk(value[i], `${path}/${i}`, depth + 1));
      return {
        standard: children.map((c) => c.standard),
        preserved: children.map((c) => c.preserved),
      };
    }
    if (!isBlockRecord(value) || value.enabled === false)
      return { standard: value, preserved: value };
    if (value.name === 'block')
      return walk(evaluator.expand(value, path, depth), path, depth + 1);
    const standard: Rec = { ...value };
    const kept: Rec = { ...value };
    for (const [key, item] of Object.entries(value)) {
      if (path === '/props' && key === 'blocks') continue;
      const processed = await walk(item, `${path}/${key}`, depth + 1);
      Object.defineProperty(standard, key, {
        value: processed.standard,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(kept, key, {
        value: processed.preserved,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (typeof value.name === 'string' && options.plugins.has(value.name)) {
      const source = toAuthoredBlockPointer(evaluator.sourceMap, path);
      const emitted = await options.render(standard, source);
      evaluator.sourceMap[`${path}/children`] = source;
      const processed = await walk(emitted, `${path}/children`, depth + 1);
      return {
        standard: { name: 'group', children: processed.standard },
        preserved: preserve.has(value.name)
          ? value
          : { name: 'group', children: processed.preserved },
      };
    }
    return { standard, preserved: kept };
  };
  return walk(document, '', 0);
}
