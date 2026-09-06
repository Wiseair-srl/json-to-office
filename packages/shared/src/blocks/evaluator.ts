import {
  BLOCK_DIRECTIVES,
  BLOCK_OPERAND_ROOTS,
  type BlockOperandRoot,
} from './directives';
import { Value } from '@sinclair/typebox/value';
import {
  BlockDefinitionsSchema,
  type BlockSlot,
  type JsonBlockDefinition,
} from './schema';

type Rec = Record<string, unknown>;
export interface BlockIssue {
  path: string;
  code: string;
  message: string;
}
export class BlockEvaluationError extends Error {
  constructor(public readonly issues: BlockIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
    this.name = 'BlockEvaluationError';
  }
}
export const isBlockRecord = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const blockPointerKey = (s: string): string =>
  s.replace(/~/g, '~0').replace(/\//g, '~1');
const own = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);
export function blockValueAt(root: unknown, path: string): unknown {
  if (path === '') return root;
  if (!path.startsWith('/')) return undefined;
  let value = root;
  for (const part of path.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if ((!isBlockRecord(value) && !Array.isArray(value)) || !own(value, key))
      return undefined;
    value = (value as Rec)[key];
  }
  return value;
}
export function toAuthoredBlockPointer(
  map: Readonly<Record<string, string>>,
  pointer: string
): string {
  let best: string | undefined;
  for (const path of Object.keys(map)) {
    if (
      (pointer === path || pointer.startsWith(`${path}/`)) &&
      (best === undefined || path.length > best.length)
    )
      best = path;
  }
  return best === undefined
    ? pointer
    : `${map[best]}${pointer.slice(best.length)}`;
}
/**
 * Props a component placed in a slot may not carry: placement and group
 * layout belong to the definition. Read by the runtime check below and by the
 * editor schema that flags them inline.
 */
export const BLOCK_SLOT_PLACEMENT_PROPS: readonly string[] = [
  'x',
  'y',
  'w',
  'h',
  'position',
  'grid',
  'gridConfig',
  'direction',
  'gap',
  'weights',
  'alignment',
  'spacing',
];

export const blockWordCount = (text: string): number =>
  text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
const present = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  value !== false &&
  (!Array.isArray(value) || value.length > 0);
const fail = (path: string, code: string, message: string): never => {
  throw new BlockEvaluationError([{ path, code, message }]);
};

/** Slot constraints and defaults are shared by validation and evaluation. */
export function resolveBlockSlot(
  slot: BlockSlot,
  input: unknown,
  path: string,
  issues: BlockIssue[]
): unknown {
  const value =
    input === undefined && slot.default !== undefined
      ? structuredClone(slot.default)
      : input;
  if (value === undefined) {
    if (slot.required)
      issues.push({
        path,
        code: 'block_required_slot',
        message: 'Required block slot is missing.',
      });
    return undefined;
  }
  const validType =
    slot.type === 'array'
      ? Array.isArray(value)
      : slot.type === 'component'
        ? isBlockRecord(value) && typeof value.name === 'string'
        : slot.type === 'object'
          ? isBlockRecord(value)
          : slot.type === 'integer'
            ? typeof value === 'number' && Number.isInteger(value)
            : typeof value === slot.type &&
              (typeof value !== 'number' || Number.isFinite(value));
  if (!validType) {
    issues.push({
      path,
      code: 'block_slot_type',
      message: `Expected ${slot.type}.`,
    });
    return value;
  }
  const issue = (message: string) =>
    issues.push({ path, code: 'block_slot_budget', message });
  if (slot.enum && !slot.enum.includes(value as string | number | boolean))
    issue('Value is not one of the declared choices.');
  if (typeof value === 'string') {
    if (slot.oneLine && /[\r\n]/.test(value))
      issue('Slot must contain one line.');
    if (slot.minLength !== undefined && value.length < slot.minLength)
      issue(`Minimum length is ${slot.minLength}.`);
    if (slot.maxLength !== undefined && value.length > slot.maxLength)
      issue(`Maximum length is ${slot.maxLength}.`);
    if (slot.maxWords !== undefined && blockWordCount(value) > slot.maxWords)
      issue(`Maximum word count is ${slot.maxWords}.`);
  }
  if (typeof value === 'number') {
    if (slot.minimum !== undefined && value < slot.minimum)
      issue(`Minimum value is ${slot.minimum}.`);
    if (slot.maximum !== undefined && value > slot.maximum)
      issue(`Maximum value is ${slot.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (slot.minItems !== undefined && value.length < slot.minItems)
      issue(`Minimum item count is ${slot.minItems}.`);
    if (slot.maxItems !== undefined && value.length > slot.maxItems)
      issue(`Maximum item count is ${slot.maxItems}.`);
    return slot.items
      ? value.map((v, i) =>
          resolveBlockSlot(slot.items!, v, `${path}/${i}`, issues)
        )
      : value;
  }
  if (slot.type === 'component' && isBlockRecord(value)) {
    const checkPlacement = (
      node: unknown,
      pointer: string,
      depth = 0
    ): void => {
      if (depth > 64) {
        issues.push({
          path: pointer,
          code: 'block_expansion_limit',
          message: 'Component slot exceeds 64 levels.',
        });
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, i) =>
          checkPlacement(item, `${pointer}/${i}`, depth + 1)
        );
        return;
      }
      if (!isBlockRecord(node)) return;
      const props =
        typeof node.name === 'string' && isBlockRecord(node.props)
          ? node.props
          : {};
      for (const key of BLOCK_SLOT_PLACEMENT_PROPS) {
        if (own(props, key))
          issues.push({
            path: `${pointer}/props/${key}`,
            code: 'block_slot_placement',
            message:
              'Block placement belongs in the definition, not in a component slot.',
          });
      }
      for (const [key, item] of Object.entries(node))
        checkPlacement(item, `${pointer}/${blockPointerKey(key)}`, depth + 1);
    };
    checkPlacement(value, path);
  }
  if (slot.type === 'object' && isBlockRecord(value) && slot.properties)
    return resolveBlockSlots(slot.properties, value, path, issues);
  return value;
}

function resolveBlockSlots(
  slots: Record<string, BlockSlot>,
  values: Rec,
  path: string,
  issues: BlockIssue[]
): Rec {
  const out: Rec = {};
  for (const key of Object.keys(values)) {
    if (!own(slots, key))
      issues.push({
        path: `${path}/${blockPointerKey(key)}`,
        code: 'block_unknown_slot',
        message: `Unknown slot '${key}'. Expected: ${Object.keys(slots).join(', ')}.`,
      });
  }
  for (const [key, slot] of Object.entries(slots)) {
    const value = resolveBlockSlot(
      slot,
      own(values, key) ? values[key] : undefined,
      `${path}/${blockPointerKey(key)}`,
      issues
    );
    if (value !== undefined)
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return out;
}

const DIRECTIVES: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(BLOCK_DIRECTIVES).map(([key, directive]) => [
    key,
    directive.keys,
  ])
);
function slotDescriptorAt(
  slots: Record<string, BlockSlot>,
  pointer: string
): BlockSlot | undefined {
  let descriptor: BlockSlot | undefined = { type: 'object', properties: slots };
  for (const escaped of pointer.slice(1).split('/')) {
    const key = escaped.replace(/~1/g, '/').replace(/~0/g, '~');
    if (descriptor?.type === 'object') {
      if (!descriptor.properties) return { type: 'object' }; // Deliberately open data.
      descriptor = own(descriptor.properties, key)
        ? descriptor.properties[key]
        : undefined;
    } else if (descriptor?.type === 'array' && /^(0|[1-9]\d*)$/.test(key))
      descriptor = descriptor.items ?? { type: 'object' };
    else if (descriptor?.type === 'component') return { type: 'object' };
    else return undefined;
  }
  return descriptor;
}

/** Directives whose value is an operand rather than a plain pointer. */
const OPERAND_DIRECTIVES = ['$if', '$each', '$count'];
interface BlockOperand {
  root: BlockOperandRoot | '$theme';
  pointer: string;
}
const isPointer = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || value.startsWith('/'));
/**
 * Read a directive's operand. A plain pointer reads a slot (for `$slot`,
 * `$item`, `$theme` and `$context` it is the directive's own root); for
 * `$if`, `$each` and `$count` a one-key reference object names the root
 * instead. Anything else is malformed.
 */
function blockOperand(value: unknown, key: string): BlockOperand | undefined {
  if (isPointer(value))
    return {
      root: OPERAND_DIRECTIVES.includes(key)
        ? '$slot'
        : (key as BlockOperand['root']),
      pointer: value,
    };
  if (!OPERAND_DIRECTIVES.includes(key) || !isBlockRecord(value))
    return undefined;
  const keys = Object.keys(value);
  const root = BLOCK_OPERAND_ROOTS.find((candidate) => candidate === keys[0]);
  if (keys.length !== 1 || !root || !isPointer(value[root])) return undefined;
  return { root, pointer: value[root] as string };
}

function checkTemplate(
  value: unknown,
  path: string,
  slots: Record<string, BlockSlot>,
  issues: BlockIssue[],
  repeated = false,
  depth = 0
): void {
  if (depth > 64) {
    issues.push({
      path,
      code: 'block_depth',
      message: 'Definition exceeds 64 levels.',
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      checkTemplate(v, `${path}/${i}`, slots, issues, repeated, depth + 1)
    );
    return;
  }
  if (!isBlockRecord(value)) return;
  const keys = Object.keys(value).filter((k) => k.startsWith('$'));
  if (keys.length) {
    const key = keys[0];
    const allowed = DIRECTIVES[key];
    if (
      !allowed ||
      keys.length !== 1 ||
      Object.keys(value).some((k) => !allowed.includes(k))
    ) {
      issues.push({
        path,
        code: 'block_invalid_binding',
        message: 'Unknown or malformed block directive.',
      });
      return;
    }
    if (
      [
        '$slot',
        '$item',
        '$theme',
        '$context',
        '$if',
        '$each',
        '$count',
      ].includes(key)
    ) {
      // `$if`, `$each` and `$count` take an operand: a slot pointer, or a
      // reference object that reads the current `$each` item, a slot or the
      // context — so a repeat can walk the current item's own array and a
      // condition can test one of its fields.
      const operand = blockOperand(value[key], key);
      if (!operand)
        issues.push({
          path,
          code: 'block_invalid_binding',
          message: OPERAND_DIRECTIVES.includes(key)
            ? `${key} takes a slot pointer such as /items, or one reference: ${BLOCK_OPERAND_ROOTS.map((root) => `{ "${root}": ... }`).join(', ')}.`
            : 'Bindings use JSON Pointers, e.g. /title.',
        });
      else if (operand.root === '$slot') {
        const descriptor = slotDescriptorAt(slots, operand.pointer);
        if (!descriptor)
          issues.push({
            path,
            code: 'block_unknown_binding',
            message: `No slot field '${operand.pointer}' is declared.`,
          });
        else if (
          ['$each', '$count'].includes(key) &&
          descriptor.type !== 'array'
        )
          issues.push({
            path,
            code: 'block_invalid_binding',
            message: `${key} requires an array slot.`,
          });
      }
      if (operand?.root === '$item' && !repeated)
        issues.push({
          path,
          code: 'block_invalid_binding',
          message: '$item is only available inside $each.',
        });
      if (
        (key === '$slot' || key === '$item') &&
        own(value, 'props') &&
        !isBlockRecord(value.props)
      )
        issues.push({
          path: `${path}/props`,
          code: 'block_invalid_binding',
          message:
            'props must be an object of component props merged beneath a component-slot value.',
        });
    }
    if (
      key === '$join' &&
      value.keepEmpty !== undefined &&
      typeof value.keepEmpty !== 'boolean'
    )
      issues.push({
        path,
        code: 'block_invalid_binding',
        message: 'keepEmpty must be boolean.',
      });
    if (key === '$if' && !own(value, 'then'))
      issues.push({
        path,
        code: 'block_invalid_binding',
        message: '$if requires then.',
      });
    if (
      key === '$each' &&
      (!own(value, 'template') || Array.isArray(value.template))
    )
      issues.push({
        path,
        code: 'block_invalid_binding',
        message:
          '$each requires one template value; use a group for multiple flow children.',
      });
    if (
      key === '$join' &&
      (!Array.isArray(value.$join) ||
        (value.separator !== undefined && typeof value.separator !== 'string'))
    )
      issues.push({
        path,
        code: 'block_invalid_binding',
        message: '$join requires an array and an optional string separator.',
      });
    if (
      key === '$measure' &&
      (!['width', 'height'].includes(String(value.$measure)) ||
        !['pt', 'twip', 'in'].includes(String(value.unit ?? 'pt')) ||
        (value.fraction !== undefined &&
          (typeof value.fraction !== 'number' ||
            value.fraction < 0 ||
            value.fraction > 1)))
    )
      issues.push({
        path,
        code: 'block_invalid_binding',
        message:
          '$measure requires width/height, pt/twip/in and a fraction between 0 and 1.',
      });
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('$') && key !== '$join') continue;
    checkTemplate(
      item,
      `${path}/${blockPointerKey(key)}`,
      slots,
      issues,
      repeated || own(value, '$each'),
      depth + 1
    );
  }
}

export function readBlockDefinitions(
  document: unknown
): Record<string, JsonBlockDefinition> {
  const value =
    isBlockRecord(document) && isBlockRecord(document.props)
      ? document.props.blocks
      : undefined;
  return (value ?? {}) as Record<string, JsonBlockDefinition>;
}

export function validateBlockDefinitions(
  definitions: unknown,
  format: 'docx' | 'pptx',
  reservedNames: readonly string[] = []
): BlockIssue[] {
  if (!Value.Check(BlockDefinitionsSchema, definitions))
    return [...Value.Errors(BlockDefinitionsSchema, definitions)]
      .slice(0, 100)
      .map((e) => ({
        path: `/props/blocks${e.path}`,
        code: 'block_invalid_definition',
        message: e.message,
      }));
  const issues: BlockIssue[] = [];
  for (const [name, def] of Object.entries(definitions)) {
    const path = `/props/blocks/${blockPointerKey(name)}`;
    if (reservedNames.includes(name))
      issues.push({
        path,
        code: 'block_name_collision',
        message: `Block '${name}' conflicts with a registered component.`,
      });
    if (format !== 'docx' && def.section)
      issues.push({
        path: `${path}/section`,
        code: 'block_format',
        message: 'Section effects are DOCX-only.',
      });
    if (format !== 'pptx' && def.slide)
      issues.push({
        path: `${path}/slide`,
        code: 'block_format',
        message: 'Slide effects are PPTX-only.',
      });
    const checkSlot = (slot: BlockSlot, pointer: string): void => {
      if (slot.default !== undefined)
        resolveBlockSlot(slot, slot.default, `${pointer}/default`, issues);
      for (const [minimum, maximum] of [
        ['minItems', 'maxItems'],
        ['minLength', 'maxLength'],
        ['minimum', 'maximum'],
      ] as const) {
        if (
          slot[minimum] !== undefined &&
          slot[maximum] !== undefined &&
          slot[minimum]! > slot[maximum]!
        )
          issues.push({
            path: pointer,
            code: 'block_invalid_definition',
            message: `${minimum} exceeds ${maximum}.`,
          });
      }
      if (slot.items) checkSlot(slot.items, `${pointer}/items`);
      for (const [key, nested] of Object.entries(slot.properties ?? {}))
        checkSlot(nested, `${pointer}/properties/${blockPointerKey(key)}`);
    };
    for (const [key, slot] of Object.entries(def.slots))
      checkSlot(slot, `${path}/slots/${blockPointerKey(key)}`);
    checkTemplate(def.body, `${path}/body`, def.slots, issues);
    if (def.section)
      checkTemplate(def.section, `${path}/section`, def.slots, issues);
    if (def.slide) checkTemplate(def.slide, `${path}/slide`, def.slots, issues);
  }
  return issues;
}

export function validateBlockInvocations(
  document: unknown,
  definitions: Record<string, JsonBlockDefinition>,
  format: 'docx' | 'pptx',
  reservedNames: readonly string[] = []
): BlockIssue[] {
  const issues = validateBlockDefinitions(definitions, format, reservedNames);
  if (issues.length) return issues;
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}/${i}`));
      return;
    }
    if (!isBlockRecord(v) || v.enabled === false) return;
    if (
      v.name === 'block' &&
      isBlockRecord(v.props) &&
      typeof v.props.ref === 'string'
    ) {
      const def = own(definitions, v.props.ref)
        ? definitions[v.props.ref]
        : undefined;
      if (!def)
        issues.push({
          path: `${path}/props/ref`,
          code: 'block_unknown_reference',
          message: `Block '${v.props.ref}' is not defined in this document.`,
        });
      else {
        if (v.props.slots === undefined || isBlockRecord(v.props.slots))
          resolveBlockSlots(
            def.slots,
            (v.props.slots ?? {}) as Rec,
            `${path}/props/slots`,
            issues
          );
        if (def.section && !/^\/children\/\d+\/children\/\d+$/.test(path))
          issues.push({
            path,
            code: 'invalid_placement',
            message:
              'A block with section effects must be a direct child of a top-level section.',
          });
        if (def.slide && !/^\/children\/\d+\/children\/\d+$/.test(path))
          issues.push({
            path,
            code: 'invalid_placement',
            message:
              'A block with slide effects must be a direct child of a slide.',
          });
      }
    }
    for (const [key, item] of Object.entries(v)) {
      if (path === '/props' && key === 'blocks') continue;
      walk(item, `${path}/${blockPointerKey(key)}`);
    }
  };
  walk(document, '');
  return issues;
}

export interface BlockEnvironment {
  slots: Rec;
  slotSources?: Record<string, string>;
  source: string;
  definition: string;
  context: Rec;
  contextSources?: Record<string, string>;
  item?: unknown;
  itemSource?: string;
}
export interface BlockSectionEffect {
  settings: NonNullable<JsonBlockDefinition['section']>;
  environment: BlockEnvironment;
  path: string;
}
export interface BlockSlideEffect {
  settings: NonNullable<JsonBlockDefinition['slide']>;
  environment: BlockEnvironment;
  path: string;
}
export interface BlockEvaluatorOptions {
  format: 'docx' | 'pptx';
  theme?: unknown;
  context?: Rec;
  contextSources?: Record<string, string>;
  reservedNames?: readonly string[];
  contextAt?: (path: string) => Rec;
  measure?: (
    axis: 'width' | 'height',
    unit: 'pt' | 'twip' | 'in',
    context: Rec
  ) => number;
  onSection?: (effect: BlockSectionEffect) => void;
  onSlide?: (effect: BlockSlideEffect) => void;
}

/** Pure bounded JSON composition. Plugins are expanded by the host, never evaluated here. */
export class JsonBlockEvaluator {
  readonly sourceMap: Record<string, string> = {};
  readonly blocks: string[] = [];
  private nodes = 0;
  constructor(
    readonly definitions: Record<string, JsonBlockDefinition>,
    readonly options: BlockEvaluatorOptions
  ) {
    const issues = validateBlockDefinitions(
      definitions,
      options.format,
      options.reservedNames
    );
    if (issues.length) throw new BlockEvaluationError(issues);
  }
  private guard(path: string, depth: number): void {
    if (depth > 64 || ++this.nodes > 50000)
      fail(
        path,
        'block_expansion_limit',
        'Block expansion exceeds the depth/node limit (64/50000).'
      );
  }
  /**
   * A directive operand and the authored pointer it came from: the slot the
   * pointer form names, or the current item, slot or context a reference
   * object names. Definitions are validated before this runs, so a malformed
   * operand cannot reach it.
   */
  private operand(
    raw: unknown,
    key: string,
    env: BlockEnvironment
  ): { value: unknown; source: string; element: (index: number) => string } {
    const { root, pointer } = blockOperand(raw, key)!;
    const { value, source } = this.reference(root, pointer, env);
    return {
      value,
      source,
      // Element i of the array is authored at pointer/i, looked up the same
      // way: a slot the enclosing invocation built from its own repeat maps
      // element by element, and pointer + "/i" is not the same as that.
      element: (index) =>
        this.reference(root, `${pointer}/${index}`, env).source,
    };
  }
  /**
   * What a reference reads and where the author wrote it. One resolution for
   * the binding form and the operand form, so `{ "$context": ... }` is
   * attributed the same way whichever directive carries it.
   */
  private reference(
    root: BlockOperandRoot | '$theme',
    pointer: string,
    env: BlockEnvironment
  ): { value: unknown; source: string } {
    if (root === '$item')
      return {
        value: blockValueAt(env.item, pointer),
        source: `${env.itemSource ?? env.source}${pointer}`,
      };
    if (root === '$context') {
      const authored = toAuthoredBlockPointer(
        env.contextSources ?? {},
        pointer
      );
      return {
        value: blockValueAt(env.context, pointer),
        source: authored === pointer ? env.source : authored,
      };
    }
    if (root === '$theme')
      return {
        value: blockValueAt(this.options.theme, pointer),
        source: env.source,
      };
    return {
      value: blockValueAt(env.slots, pointer),
      source: env.slotSources
        ? toAuthoredBlockPointer(env.slotSources, pointer)
        : `${env.source}/props/slots${pointer}`,
    };
  }
  evaluate(
    value: unknown,
    env: BlockEnvironment,
    out: string,
    definitionPath: string,
    depth = 0
  ): unknown {
    this.guard(env.source, depth);
    this.sourceMap[out] = env.source;
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      value.forEach((v, i) => {
        const evaluated = this.evaluate(
          v,
          env,
          `${out}/${result.length}`,
          `${definitionPath}/${i}`,
          depth + 1
        );
        if (evaluated !== undefined) {
          if (
            isBlockRecord(v) &&
            ('$if' in v || '$each' in v) &&
            Array.isArray(evaluated)
          ) {
            // Directives splice sequences; ordinary arrays remain ordinary arrays.
            const base = `${out}/${result.length}`;
            const maps = Object.entries(this.sourceMap).filter(([key]) =>
              key.startsWith(`${base}/`)
            );
            for (const [key] of maps) delete this.sourceMap[key];
            for (const [key, source] of maps) {
              const rest = key.slice(base.length + 1);
              const [index, ...suffix] = rest.split('/');
              this.sourceMap[
                `${out}/${result.length + Number(index)}${suffix.length ? '/' + suffix.join('/') : ''}`
              ] = source;
            }
            result.push(...evaluated);
          } else result.push(evaluated);
        }
      });
      return result;
    }
    if (!isBlockRecord(value)) return value;
    if (
      '$slot' in value ||
      '$item' in value ||
      '$theme' in value ||
      '$context' in value
    ) {
      const key = ['$slot', '$item', '$theme', '$context'].find(
        (k) => k in value
      )!;
      const pointer = value[key] as string;
      const { value: found, source } = this.reference(
        key as BlockOperandRoot | '$theme',
        pointer,
        env
      );
      this.sourceMap[out] = source;
      let result: unknown =
        found !== undefined ? structuredClone(found) : undefined;
      if (result === undefined && own(value, 'default'))
        result = this.evaluate(
          value.default,
          env,
          out,
          `${definitionPath}/default`,
          depth + 1
        );
      if (result === undefined && key === '$theme')
        return fail(
          definitionPath,
          'block_unknown_theme_binding',
          `Theme value '${pointer}' is missing; declare a fallback or use an existing token.`
        );
      // A component slot takes its placement and styling defaults from the
      // definition: `props` are merged beneath the slot value's own props.
      // The slot content cannot carry placement (rejected at validation), so
      // geometry always comes from the definition; other props stay the
      // author's to override.
      if (
        (key === '$slot' || key === '$item') &&
        own(value, 'props') &&
        isBlockRecord(result) &&
        typeof result.name === 'string'
      ) {
        const origin = this.sourceMap[out];
        const defaults = this.evaluate(
          value.props,
          env,
          `${out}/props`,
          `${definitionPath}/props`,
          depth + 1
        );
        const authored = isBlockRecord(result.props) ? result.props : {};
        for (const propKey of Object.keys(authored)) {
          const pointerKey = `${out}/props/${blockPointerKey(propKey)}`;
          for (const mapped of Object.keys(this.sourceMap))
            if (mapped === pointerKey || mapped.startsWith(`${pointerKey}/`))
              delete this.sourceMap[mapped];
          this.sourceMap[pointerKey] =
            `${origin}/props/${blockPointerKey(propKey)}`;
        }
        result = {
          ...result,
          props: {
            ...(isBlockRecord(defaults) ? defaults : {}),
            ...authored,
          },
        };
      }
      return result;
    }
    if ('$if' in value) {
      const operand = this.operand(value.$if, '$if', env);
      const branch = present(operand.value) ? value.then : value.else;
      const result = this.evaluate(branch, env, out, definitionPath, depth + 1);
      // A literal branch is the tested value's consequence: a finding on it
      // lands on the field that selected it. A binding keeps its own origin.
      const literal =
        !isBlockRecord(branch) ||
        !Object.keys(branch).some((k) => k.startsWith('$'));
      if (literal && this.sourceMap[out] === env.source)
        this.sourceMap[out] = operand.source;
      return result;
    }
    if ('$count' in value) {
      const operand = this.operand(value.$count, '$count', env);
      if (!Array.isArray(operand.value))
        return fail(
          operand.source,
          'block_slot_type',
          '$count requires an array.'
        );
      return operand.value.length;
    }
    if ('$each' in value) {
      const operand = this.operand(value.$each, '$each', env);
      const list = operand.value;
      if (!Array.isArray(list))
        return fail(
          operand.source,
          'block_slot_type',
          '$each requires an array.'
        );
      const result: unknown[] = [];
      list.forEach((item, i) => {
        const pointer = `${out}/${result.length}`;
        const evaluated = this.evaluate(
          value.template,
          {
            ...env,
            item,
            itemSource: operand.element(i),
          },
          pointer,
          `${definitionPath}/template`,
          depth + 1
        );
        if (evaluated !== undefined) {
          // The repeated element belongs to the item that produced it: a
          // finding on a whole column lands on that column, not on the block.
          if (this.sourceMap[pointer] === env.source)
            this.sourceMap[pointer] = operand.element(i);
          result.push(evaluated);
        } else
          for (const key of Object.keys(this.sourceMap)) {
            if (key === pointer || key.startsWith(`${pointer}/`))
              delete this.sourceMap[key];
          }
      });
      return result;
    }
    if ('$join' in value) {
      const values = (value.$join as unknown[]).map((v, i) =>
        this.evaluate(
          v,
          env,
          `${out}/${i}`,
          `${definitionPath}/$join/${i}`,
          depth + 1
        )
      );
      const first = values.findIndex(present);
      if (first >= 0) this.sourceMap[out] = this.sourceMap[`${out}/${first}`];
      return (value.keepEmpty === true ? values : values.filter(present))
        .map((v) => String(v ?? ''))
        .join(String(value.separator ?? ''));
    }
    if ('$measure' in value) {
      if (!this.options.measure)
        return fail(
          definitionPath,
          'block_unsupported_operation',
          'This format does not support $measure.'
        );
      return (
        this.options.measure(
          value.$measure as 'width' | 'height',
          (value.unit ?? 'pt') as 'pt' | 'twip' | 'in',
          env.context
        ) * Number(value.fraction ?? 1)
      );
    }
    const result: Rec = {};
    for (const [key, item] of Object.entries(value)) {
      const evaluated = this.evaluate(
        item,
        env,
        `${out}/${blockPointerKey(key)}`,
        `${definitionPath}/${blockPointerKey(key)}`,
        depth + 1
      );
      if (evaluated !== undefined)
        Object.defineProperty(result, key, {
          value: evaluated,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    return result;
  }
  expand(value: unknown, path = '', depth = 0): unknown {
    this.guard(path, depth);
    if (Array.isArray(value))
      return value.map((v, i) => this.expand(v, `${path}/${i}`, depth + 1));
    if (!isBlockRecord(value)) return value;
    if (value.name === 'block' && value.enabled !== false) {
      if (!isBlockRecord(value.props) || typeof value.props.ref !== 'string')
        return fail(
          path,
          'block_invalid_invocation',
          'A block requires props.ref and optional props.slots.'
        );
      if (
        Object.keys(value.props).some(
          (key) => !['ref', 'slots'].includes(key)
        ) ||
        (value.props.slots !== undefined && !isBlockRecord(value.props.slots))
      )
        return fail(
          path,
          'block_invalid_invocation',
          'Block props accept only ref and an object of slots.'
        );
      const def = own(this.definitions, value.props.ref)
        ? this.definitions[value.props.ref]
        : undefined;
      if (!def)
        return fail(
          `${path}/props/ref`,
          'block_unknown_reference',
          `Block '${value.props.ref}' is not defined in this document.`
        );
      const issues: BlockIssue[] = [];
      const source = toAuthoredBlockPointer(this.sourceMap, path);
      const slotsPath = `${path}/props/slots`;
      const slots = resolveBlockSlots(
        def.slots,
        (value.props.slots ?? {}) as Rec,
        slotsPath,
        issues
      );
      if (issues.length)
        throw new BlockEvaluationError(
          issues.map((issue) => ({
            ...issue,
            path: toAuthoredBlockPointer(this.sourceMap, issue.path),
          }))
        );
      const slotSources = Object.fromEntries([
        ['', toAuthoredBlockPointer(this.sourceMap, slotsPath)],
        ...Object.entries(this.sourceMap)
          .filter(([key]) => key.startsWith(`${slotsPath}/`))
          .map(([key, origin]) => [key.slice(slotsPath.length), origin]),
      ]);
      const env: BlockEnvironment = {
        slots,
        slotSources,
        source,
        definition: `/props/blocks/${blockPointerKey(value.props.ref)}`,
        context: this.options.contextAt?.(path) ?? this.options.context ?? {},
        contextSources: this.options.contextSources,
      };
      if (def.section)
        this.options.onSection?.({
          settings: def.section,
          environment: env,
          path,
        });
      if (def.slide)
        this.options.onSlide?.({ settings: def.slide, environment: env, path });
      // A definition's own nested invocation maps back to the authored
      // invocation that produced it; record each authored invocation once,
      // or its slots would be counted twice by everything that reads `blocks`.
      if (!this.blocks.includes(source)) this.blocks.push(source);
      const children = this.evaluate(
        def.body,
        env,
        `${path}/children`,
        `${env.definition}/body`,
        depth + 1
      );
      return {
        name: 'group',
        ...(value.id !== undefined && { id: value.id }),
        children: this.expand(children, `${path}/children`, depth + 1),
      };
    }
    if (value.enabled === false) return { ...value };
    const result: Rec = { ...value };
    // Traverse the document, never its definition library or unexpanded slot data.
    for (const [key, item] of Object.entries(value)) {
      if (path === '/props' && key === 'blocks') continue;
      Object.defineProperty(result, key, {
        value: this.expand(item, `${path}/${blockPointerKey(key)}`, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
}
