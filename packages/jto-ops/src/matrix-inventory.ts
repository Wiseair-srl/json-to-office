/**
 * The matrix inventory (#343): every JSON block definition the playground
 * templates embed, found by the same extraction MCP discovery publishes as
 * `jto://blocks`, and for each one the conditions it is supported on — theme,
 * canvas, font, slot edge — with a stated reason for every condition it is
 * not. Nothing is omitted silently: a condition a definition does not get is
 * an exclusion with a reason, and a template with no definitions is listed
 * with none.
 *
 * Applicability is decided from the template, never from a list of blocks:
 *
 * - A template on a bundled theme is authored against theme roles and
 *   tokens, so its definitions are supported on every bundled theme of the
 *   format, in the design faces and in the fallback faces. A report's are
 *   supported on every page size its themes scale for; a deck's on the slide
 *   shape the template is drawn on, because that is where its slot budgets
 *   are measured — another shape lays out, but holds fewer words.
 * - A template carrying its own theme object is authored against that
 *   object: absolute geometry fitted to its own faces and its own canvas. Its
 *   definitions are supported there only; a bundled theme, another canvas or
 *   a wider fallback face would be a different design, not a boundary.
 * - A definition with no slots has one document, so `min` is `max`.
 *
 * The profile a template's definitions are judged under is the one the
 * blueprint drawing on that template names; a template no blueprint uses is
 * judged under the format's default. The module is pure: themes, blueprints
 * and profiles are handed in, so a new theme or template gains its cases
 * without an edit here.
 */

import {
  blockReferencesFromDocument,
  readBlockDefinitions,
} from '@json-to-office/shared';
import type { MatrixCanvas, MatrixEdge, MatrixFont } from './block-matrix';

type Rec = Record<string, unknown>;

export type MatrixFormat = 'docx' | 'pptx';

export interface MatrixTemplateSource {
  /** File name, as the gallery and `jto://blocks` name it. */
  name: string;
  document: unknown;
}

export interface MatrixBlueprintSource {
  id: string;
  format: string;
  profile: string;
  /** The template whose definitions the blueprint invokes. */
  definitions: string;
}

export interface MatrixProfileSource {
  id: string;
  rules?: Readonly<
    Record<string, { parameters?: Readonly<Record<string, unknown>> }>
  >;
}

export interface MatrixInventoryOptions {
  /** The bundled theme names of each format. */
  themes: Readonly<Record<MatrixFormat, readonly string[]>>;
  blueprints?: readonly MatrixBlueprintSource[];
  /** Shipped profiles by id, to read the roles a profile requires present. */
  profiles?: Readonly<Record<string, MatrixProfileSource>>;
}

export interface MatrixExclusion {
  /** `theme minimal`, `canvas standard43`, `font fallback`, `edge min`. */
  condition: string;
  reason: string;
}

export interface MatrixConditions {
  themes: string[];
  canvases: MatrixCanvas[];
  fonts: MatrixFont[];
  edges: MatrixEdge[];
}

export interface MatrixInventoryTemplate {
  template: string;
  format: MatrixFormat;
  /** The bundled theme the template names, or `inline` for a theme object. */
  theme: string;
  /** The blueprint profile its definitions are judged under, when one uses it. */
  profile?: string;
  /** Slot roles that profile requires present, so `min` keeps them. */
  requiredRoles: string[];
  /** Every definition the template embeds, in authored order. */
  definitions: string[];
  /** The conditions a whole-template case is supported on. */
  conditions: MatrixConditions;
  exclusions: MatrixExclusion[];
}

export interface MatrixInventoryEntry extends MatrixConditions {
  /** `<template>#<definition pointer>`. */
  id: string;
  template: string;
  format: MatrixFormat;
  name: string;
  definitionPointer: string;
  /** Definitions this one invokes, dependencies first. */
  dependencies: string[];
  profile?: string;
  requiredRoles: string[];
  exclusions: MatrixExclusion[];
}

export interface MatrixInventory {
  templates: MatrixInventoryTemplate[];
  entries: MatrixInventoryEntry[];
}

/** Every condition of a format, whether or not a definition gets it. */
export function matrixUniverse(
  format: MatrixFormat,
  themes: readonly string[]
): MatrixConditions {
  return {
    themes: [...themes],
    canvases: format === 'docx' ? ['A4', 'LETTER'] : ['wide169', 'standard43'],
    fonts: ['design', 'fallback'],
    edges: ['min', 'max'],
  };
}

const isRecord = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function templateFormat(
  name: string,
  document: unknown
): MatrixFormat | undefined {
  const root = isRecord(document) ? document.name : undefined;
  if (root === 'docx' || root === 'pptx') return root;
  if (name.endsWith('.docx.json')) return 'docx';
  if (name.endsWith('.pptx.json')) return 'pptx';
  return undefined;
}

/** The canvas a deck's own slide size is: 16:9 or 4:3, by aspect ratio. */
export function authoredDeckCanvas(props: Rec): MatrixCanvas {
  const width = typeof props.slideWidth === 'number' ? props.slideWidth : 10;
  const height =
    typeof props.slideHeight === 'number' ? props.slideHeight : 7.5;
  return Math.abs(width / height - 16 / 9) < Math.abs(width / height - 4 / 3)
    ? 'wide169'
    : 'standard43';
}

function requiredRoles(
  format: MatrixFormat,
  profile: MatrixProfileSource | undefined
): string[] {
  const required =
    profile?.rules?.[`${format}/required-chrome`]?.parameters?.required;
  return Array.isArray(required)
    ? required.filter((role): role is string => typeof role === 'string')
    : [];
}

function templateConditions(
  format: MatrixFormat,
  props: Rec,
  universe: MatrixConditions
): {
  theme: string;
  conditions: MatrixConditions;
  exclusions: MatrixExclusion[];
} {
  const named = typeof props.theme === 'string' ? props.theme : undefined;
  // A deck's slot budgets are measured on the slide it is drawn on: another
  // shape still lays out, but the words a slot holds there are no promise.
  // A report flows, so every page size its themes scale for is a boundary.
  const canvas: MatrixCanvas | undefined =
    format === 'pptx' ? authoredDeckCanvas(props) : undefined;
  const canvasExclusions = (reason: string): MatrixExclusion[] =>
    canvas === undefined
      ? []
      : universe.canvases
          .filter((c) => c !== canvas)
          .map((c) => ({ condition: `canvas ${c}`, reason }));
  if (named !== undefined && universe.themes.includes(named)) {
    return {
      theme: named,
      conditions: {
        ...structuredClone(universe),
        ...(canvas !== undefined && { canvases: [canvas] }),
      },
      exclusions: canvasExclusions(
        `slot budgets are measured on the ${canvas} slide the template is drawn on; another shape lays out, but holds fewer words`
      ),
    };
  }
  // A theme object, or a name that is no bundled theme: the definitions are
  // authored against something only this template carries.
  const theme = named ?? 'inline';
  const why =
    named === undefined
      ? "authored against the template's own theme object"
      : `authored against "${named}", which is no bundled theme`;
  const exclusions: MatrixExclusion[] = [
    ...universe.themes.map((t) => ({ condition: `theme ${t}`, reason: why })),
    ...canvasExclusions(
      "absolute geometry fitted to the template's own slide size"
    ),
    ...(canvas === undefined
      ? universe.canvases
          .filter((c) => c !== 'A4')
          .map((c) => ({
            condition: `canvas ${c}`,
            reason: "absolute geometry fitted to the template's own page",
          }))
      : []),
    {
      condition: 'font fallback',
      reason:
        "lines fitted to the template's own faces; a wider face is another design, not a boundary",
    },
  ];
  return {
    theme,
    conditions: {
      themes: [theme],
      canvases: [canvas ?? 'A4'],
      fonts: ['design'],
      edges: [...universe.edges],
    },
    exclusions,
  };
}

/** The inventory over every template handed in, in the order given. */
export function buildMatrixInventory(
  templates: readonly MatrixTemplateSource[],
  options: MatrixInventoryOptions
): MatrixInventory {
  const inventory: MatrixInventory = { templates: [], entries: [] };
  for (const source of templates) {
    const format = templateFormat(source.name, source.document);
    if (!format || !isRecord(source.document)) continue;
    const props = isRecord(source.document.props) ? source.document.props : {};
    const universe = matrixUniverse(format, options.themes[format]);
    const blueprint = options.blueprints?.find(
      (b) => b.format === format && b.definitions === source.name
    );
    const profile = blueprint
      ? options.profiles?.[blueprint.profile]
      : undefined;
    const roles = requiredRoles(format, profile);
    const { theme, conditions, exclusions } = templateConditions(
      format,
      props,
      universe
    );
    const definitions = Object.keys(readBlockDefinitions(source.document));
    const references = blockReferencesFromDocument(source.document, {
      template: source.name,
      format,
    });
    const templateExclusions = [...exclusions];
    // Discovery publishes nothing from a template whose definitions do not
    // validate; the matrix says so rather than covering fewer blocks.
    if (definitions.length > 0 && references.length === 0) {
      templateExclusions.push({
        condition: 'definitions',
        reason: 'the definitions do not validate, so discovery publishes none',
      });
    }
    inventory.templates.push({
      template: source.name,
      format,
      theme,
      ...(blueprint && { profile: blueprint.profile }),
      requiredRoles: roles,
      definitions,
      conditions,
      exclusions: templateExclusions,
    });
    for (const reference of references) {
      const slotless =
        Object.keys(reference.definition.slots ?? {}).length === 0;
      inventory.entries.push({
        id: `${source.name}#${reference.definitionPointer}`,
        template: source.name,
        format,
        name: reference.name,
        definitionPointer: reference.definitionPointer,
        dependencies: reference.dependencies,
        ...(blueprint && { profile: blueprint.profile }),
        requiredRoles: roles,
        themes: [...conditions.themes],
        canvases: [...conditions.canvases],
        fonts: [...conditions.fonts],
        edges: slotless ? ['max'] : [...conditions.edges],
        exclusions: [
          ...exclusions,
          ...(slotless
            ? [
                {
                  condition: 'edge min',
                  reason: 'no slots, so min and max are the same document',
                },
              ]
            : []),
        ],
      });
    }
  }
  return inventory;
}

/**
 * Conditions of the universe an entry neither gets nor excludes, and
 * conditions it both gets and excludes. Empty for a complete inventory.
 */
export function inventoryGaps(
  entry: MatrixConditions & { exclusions: readonly MatrixExclusion[] },
  universe: MatrixConditions
): string[] {
  const excluded = new Set(entry.exclusions.map((e) => e.condition));
  const gaps: string[] = [];
  const check = (
    kind: string,
    all: readonly string[],
    got: readonly string[]
  ) => {
    for (const value of all) {
      const condition = `${kind} ${value}`;
      const has = got.includes(value);
      if (has && excluded.has(condition)) gaps.push(`${condition}: both`);
      if (!has && !excluded.has(condition)) gaps.push(`${condition}: neither`);
    }
  };
  check('theme', universe.themes, entry.themes);
  check('canvas', universe.canvases, entry.canvases);
  check('font', universe.fonts, entry.fonts);
  check('edge', universe.edges, entry.edges);
  return gaps;
}

/** One line per template and entry, for a suite's log. */
export function describeInventory(inventory: MatrixInventory): string {
  const lines: string[] = [];
  for (const template of inventory.templates) {
    lines.push(
      `${template.template} (${template.format}, theme ${template.theme}${
        template.profile ? `, profile ${template.profile}` : ''
      }): ${template.definitions.length} definition(s)`
    );
    for (const entry of inventory.entries.filter(
      (e) => e.template === template.template
    )) {
      lines.push(
        `  ${entry.name}: themes ${entry.themes.join(' ')} · canvases ${entry.canvases.join(
          ' '
        )} · fonts ${entry.fonts.join(' ')} · edges ${entry.edges.join(' ')}`
      );
      const reasons = new Map<string, string[]>();
      for (const exclusion of entry.exclusions) {
        reasons.set(exclusion.reason, [
          ...(reasons.get(exclusion.reason) ?? []),
          exclusion.condition,
        ]);
      }
      for (const [reason, conditions] of reasons)
        lines.push(`    not ${conditions.join(', ')}: ${reason}`);
    }
  }
  return lines.join('\n');
}
